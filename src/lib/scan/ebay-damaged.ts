import { hasDatabaseUrl } from "@/lib/db/client";
import { ensureSchema } from "@/lib/db/schema";
import {
  createScanRun,
  finishScanRun,
  getMedianActiveMarketPrice,
  listModelsForScan,
  listingId,
  upsertRepairCandidate
} from "@/lib/db/repository";
import { detectIssueTerms, damagedQueryForModel, EbayClient } from "@/lib/ebay/client";
import { isLikelyAccessoryOrDocumentation } from "@/lib/listing-quality";
import { modelCodeMatches } from "@/lib/model-match";
import { createRun } from "@/lib/scan/catalog-sync";
import type { EbayListingBase, RepairCandidate, ScanRun, WalkmanModel } from "@/lib/types";

export type EbayDamagedScanOptions = {
  persist?: boolean;
  limit?: number;
  offset?: number;
  resultsPerModel?: number;
  repairCost?: number;
  onProgress?: (event: string) => void;
};

export async function runEbayDamagedScan(options: EbayDamagedScanOptions = {}): Promise<ScanRun> {
  const shouldPersist = Boolean(options.persist && hasDatabaseUrl());
  if (options.persist && !hasDatabaseUrl()) throw new Error("DATABASE_URL is required for persistent eBay damaged scan");
  if (shouldPersist) await ensureSchema();

  const run = createRun("ebay_damaged");
  if (shouldPersist) await createScanRun(run);

  const limit = options.limit ?? Number(process.env.EBAY_MODELS_PER_RUN || 50);
  const offset = options.offset ?? Number(process.env.EBAY_MODEL_OFFSET || 0);
  const resultsPerModel = options.resultsPerModel ?? Number(process.env.EBAY_DAMAGED_RESULTS_PER_MODEL || 8);
  const repairCost = options.repairCost ?? Number(process.env.DEFAULT_REPAIR_COST_EUR || 25);
  const models = shouldPersist ? await listModelsForScan(limit, offset) : [];
  const client = new EbayClient({ maxCalls: Number(process.env.EBAY_MAX_CALLS_PER_RUN || 1000) });
  const buyingOptions = readBuyingOptions(process.env.EBAY_DAMAGED_BUYING_OPTIONS || process.env.EBAY_BUYING_OPTIONS);
  const conditionGroups = readDamagedConditionGroups();

  try {
    for (const [index, model] of models.entries()) {
      try {
        const medianActiveMarketPrice = await getMedianActiveMarketPrice(model.id);
        const query = damagedQueryForModel(model.name);
        const listings = dedupeListings(await searchDamagedListings(
          client,
          buyingOptions,
          conditionGroups,
          query,
          resultsPerModel
        ));
        const candidates = listings
          .map((listing) => toRepairCandidate(model, listing, query, medianActiveMarketPrice, repairCost))
          .filter(Boolean) as RepairCandidate[];

        run.candidatesFound += candidates.length;
        for (const candidate of candidates) {
          if (shouldPersist) {
            await upsertRepairCandidate(candidate, run.id);
            run.candidatesSaved += 1;
          }
        }
        options.onProgress?.(`[ebay-damaged] ${offset + index + 1} ${model.name}: found=${candidates.length}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        run.errors.push({ scope: model.name, message });
        options.onProgress?.(`[ebay-damaged] ${model.name}: ${message}`);
      }
    }
    run.status = "completed";
  } catch (error) {
    run.status = "failed";
    run.errors.push({ scope: "ebay_damaged", message: error instanceof Error ? error.message : String(error) });
  } finally {
    run.finishedAt = new Date().toISOString();
    if (shouldPersist) await finishScanRun(run);
  }

  return run;
}

function toRepairCandidate(
  model: WalkmanModel,
  listing: EbayListingBase,
  query: string,
  medianActiveMarketPrice: number | undefined,
  repairCost: number
): RepairCandidate | null {
  const issueTerms = detectIssueTerms(listing);
  if (issueTerms.length === 0) return null;
  if (!modelNameMatches(model, listing.title)) return null;
  if (isLikelyAccessoryOrDocumentation(listing)) return null;

  const acquisitionPrice = listing.priceAmount;
  const expectedNetSale = medianActiveMarketPrice ? medianActiveMarketPrice * 0.82 : undefined;
  const expectedMargin = expectedNetSale && acquisitionPrice
    ? roundMoney(expectedNetSale - acquisitionPrice - repairCost)
    : undefined;
  const marginPercent = expectedMargin && acquisitionPrice
    ? Math.round((expectedMargin / acquisitionPrice) * 100)
    : undefined;
  const score = scoreCandidate({ issueTerms, medianActiveMarketPrice, acquisitionPrice, expectedMargin, marginPercent });

  return {
    ...listing,
    id: listingId("repair-candidate", listing.itemUrl || listing.listingId),
    modelId: model.id,
    query,
    issueTerms,
    observedAt: new Date().toISOString(),
    estimatedMarketValue: medianActiveMarketPrice,
    expectedMargin,
    marginPercent,
    score,
    label: labelForScore(score, medianActiveMarketPrice),
    conditionBucket: "defective"
  };
}

function modelNameMatches(model: WalkmanModel, title: string): boolean {
  return modelCodeMatches(model.modelCode, title);
}

function scoreCandidate(input: {
  issueTerms: string[];
  medianActiveMarketPrice?: number;
  acquisitionPrice?: number;
  expectedMargin?: number;
  marginPercent?: number;
}): number {
  let score = 20;
  if (input.issueTerms.length > 0) score += 20;
  if ((input.medianActiveMarketPrice || 0) >= 120) score += 15;
  if ((input.medianActiveMarketPrice || 0) >= 250) score += 10;
  if ((input.expectedMargin || 0) >= 50) score += 20;
  if ((input.expectedMargin || 0) >= 120) score += 15;
  if ((input.marginPercent || 0) >= 80) score += 10;
  if (!input.medianActiveMarketPrice) score -= 15;
  if (!input.acquisitionPrice) score -= 10;
  return Math.max(0, Math.min(100, score));
}

function labelForScore(score: number, medianActiveMarketPrice?: number): RepairCandidate["label"] {
  if (!medianActiveMarketPrice) return "unknown";
  if (score >= 75) return "hot";
  if (score >= 50) return "watch";
  return "thin";
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function readBuyingOptions(value?: string): string[] {
  if (value) {
    const parsed = value.split(",").map((option) => option.trim()).filter(Boolean);
    if (parsed.length) return parsed;
  }
  return process.env.EBAY_INCLUDE_AUCTIONS === "false" ? ["FIXED_PRICE"] : ["FIXED_PRICE", "AUCTION"];
}

function readDamagedConditionGroups(): Array<{ conditionIds?: string; sourceQueryType: string }> {
  const groups: Array<{ conditionIds?: string; sourceQueryType: string }> = [];
  const damagedConditionIds = process.env.EBAY_DAMAGED_CONDITION_IDS || "7000";
  const usedConditionIds = process.env.EBAY_DAMAGED_USED_CONDITION_IDS || "3000";

  if (process.env.EBAY_DAMAGED_SEARCH_WITHOUT_CONDITION === "true") {
    groups.push({ sourceQueryType: "title-defect-any-condition" });
  }
  if (damagedConditionIds !== "none") {
    groups.push({ conditionIds: damagedConditionIds, sourceQueryType: "parts-or-defective-condition" });
  }
  if (usedConditionIds !== "none") {
    groups.push({ conditionIds: usedConditionIds, sourceQueryType: "used-title-defect" });
  }
  return groups.length ? groups : [{ sourceQueryType: "title-defect-any-condition" }];
}

async function searchDamagedListings(
  client: EbayClient,
  buyingOptions: string[],
  conditionGroups: Array<{ conditionIds?: string; sourceQueryType: string }>,
  query: string,
  resultsPerModel: number
): Promise<EbayListingBase[]> {
  const listings: EbayListingBase[] = [];
  for (const group of conditionGroups) {
    for (const buyingOption of buyingOptions) {
      const found = await client.searchActiveListings(query, resultsPerModel, {
        conditionIds: group.conditionIds,
        sellerAccountType: process.env.EBAY_SELLER_ACCOUNT_TYPE,
        buyingOptions: buyingOption
      });
      listings.push(...found.map((listing) => ({
        ...listing,
        sourceQueryType: group.sourceQueryType
      })));
    }
  }
  return listings;
}

function dedupeListings(listings: EbayListingBase[]): EbayListingBase[] {
  const seen = new Set<string>();
  const unique: EbayListingBase[] = [];
  for (const listing of listings) {
    const key = listing.itemUrl || listing.listingId;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(listing);
  }
  return unique;
}
