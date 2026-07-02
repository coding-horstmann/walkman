import { hasDatabaseUrl } from "@/lib/db/client";
import { ensureSchema } from "@/lib/db/schema";
import {
  createScanRun,
  finishScanRun,
  getMedianActiveMarketPrice,
  listModelsForScan,
  listingId,
  upsertPlatformScanResult,
  upsertRepairCandidate
} from "@/lib/db/repository";
import { detectIssueTerms } from "@/lib/ebay/client";
import { classifyListingCondition, isLikelyAccessoryOrDocumentation } from "@/lib/listing-quality";
import { modelCodeMatches, modelTitleMatches } from "@/lib/model-match";
import { createRun } from "@/lib/scan/catalog-sync";
import { KleinanzeigenSearchClient } from "@/lib/sources/kleinanzeigen";
import { VintedSearchClient } from "@/lib/sources/vinted";
import { WallapopSearchClient } from "@/lib/sources/wallapop";
import type { EbayListingBase, PlatformSourcingPlatform, RepairCandidate, ScanRun, ScanRunType, SourcePlatform, WalkmanModel } from "@/lib/types";

type SourceClient = {
  search(query: string, options: { limit?: number; timeoutMs?: number }): Promise<EbayListingBase[]>;
  close?: () => Promise<void>;
};

type PlatformSourcingOptions = {
  persist?: boolean;
  limit?: number;
  offset?: number;
  resultsPerModel?: number;
  repairCost?: number;
  tradeCost?: number;
  onProgress?: (event: string) => void;
};

export function runVintedSourcingScan(options: PlatformSourcingOptions = {}): Promise<ScanRun> {
  return runPlatformSourcingScan("vinted", new VintedSearchClient(), options);
}

export function runVintedFrSourcingScan(options: PlatformSourcingOptions = {}): Promise<ScanRun> {
  return runPlatformSourcingScan("vinted_fr", new VintedSearchClient({
    origin: "https://www.vinted.fr",
    locale: "fr-FR,fr;q=0.9,en;q=0.7",
    sourcePlatform: "vinted_fr",
    envPrefix: "VINTED_FR"
  }), options);
}

export function runKleinanzeigenSourcingScan(options: PlatformSourcingOptions = {}): Promise<ScanRun> {
  return runPlatformSourcingScan("kleinanzeigen", new KleinanzeigenSearchClient(), options);
}

export function runWallapopSourcingScan(options: PlatformSourcingOptions = {}): Promise<ScanRun> {
  return runPlatformSourcingScan("wallapop", new WallapopSearchClient(), options);
}

async function runPlatformSourcingScan(
  source: PlatformSourcingPlatform,
  client: SourceClient,
  options: PlatformSourcingOptions
): Promise<ScanRun> {
  const shouldPersist = Boolean(options.persist && hasDatabaseUrl());
  if (options.persist && !hasDatabaseUrl()) throw new Error("DATABASE_URL is required for persistent platform sourcing scan");
  if (shouldPersist) await ensureSchema();

  const run = createRun(runTypeForSource(source));
  if (shouldPersist) await createScanRun(run);

  const envPrefix = envPrefixForSource(source);
  const limit = options.limit ?? Number(process.env[`${envPrefix}_MODELS_PER_RUN`] || process.env.PLATFORM_MODELS_PER_RUN || 50);
  const offset = options.offset ?? readOffset(envPrefix, limit);
  const resultsPerModel = options.resultsPerModel ?? Number(process.env[`${envPrefix}_RESULTS_PER_MODEL`] || 8);
  const repairCost = options.repairCost ?? Number(process.env.DEFAULT_REPAIR_COST_EUR || 25);
  const tradeCost = options.tradeCost ?? Number(process.env.DEFAULT_TRADE_COST_EUR || 10);
  const models = shouldPersist ? await listModelsForScan(limit, offset) : [];
  let consecutiveBlocks = 0;

  try {
    for (const [index, model] of models.entries()) {
      const query = platformQueryForModel(model.name);
      try {
        const medianActiveMarketPrice = await getMedianActiveMarketPrice(model.id);
        const listings = dedupeListings(await client.search(query, { limit: resultsPerModel }));
        const candidates = listings
          .map((listing) => toPlatformCandidate(source, model, listing, query, medianActiveMarketPrice, repairCost, tradeCost))
          .filter(Boolean) as RepairCandidate[];

        run.candidatesFound += candidates.length;
        if (shouldPersist) {
          await upsertPlatformScanResult({
            runId: run.id,
            modelId: model.id,
            sourcePlatform: source,
            query,
            rawResultCount: listings.length,
            candidateCount: candidates.length,
            status: "completed",
            scannedAt: new Date().toISOString()
          });
        }
        for (const candidate of candidates) {
          if (shouldPersist) {
            await upsertRepairCandidate(candidate, run.id);
            run.candidatesSaved += 1;
          }
        }
        consecutiveBlocks = 0;
        options.onProgress?.(`[${source}] ${offset + index + 1} ${model.name}: found=${candidates.length}`);
        await randomDelay(envPrefix);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        run.errors.push({ scope: model.name, message });
        if (shouldPersist) {
          await upsertPlatformScanResult({
            runId: run.id,
            modelId: model.id,
            sourcePlatform: source,
            query,
            rawResultCount: 0,
            candidateCount: 0,
            status: "failed",
            errorMessage: message,
            scannedAt: new Date().toISOString()
          });
        }
        options.onProgress?.(`[${source}] ${model.name}: ${message}`);
        if (isBlockError(message)) consecutiveBlocks += 1;
        if (consecutiveBlocks >= Number(process.env[`${envPrefix}_MAX_BLOCK_ERRORS`] || 3)) {
          throw new Error(`${source} stopped after repeated block signals`);
        }
      }
    }
    run.status = "completed";
  } catch (error) {
    run.status = "failed";
    run.errors.push({ scope: source, message: error instanceof Error ? error.message : String(error) });
  } finally {
    await client.close?.().catch(() => undefined);
    run.finishedAt = new Date().toISOString();
    if (shouldPersist) await finishScanRun(run);
  }

  return run;
}

function toPlatformCandidate(
  source: SourcePlatform,
  model: WalkmanModel,
  listing: EbayListingBase,
  query: string,
  medianActiveMarketPrice: number | undefined,
  repairCost: number,
  tradeCost: number
): RepairCandidate | null {
  if (!modelNameMatches(model, listing.title)) return null;
  if (isLikelyAccessoryOrDocumentation(listing)) return null;

  const issueTerms = detectIssueTerms(listing);
  const acquisitionPrice = listing.priceAmount;
  const maxMarketRatio = Number(process.env.PLATFORM_SOURCE_MAX_MARKET_RATIO || 0.7);
  const isPricePotential = Boolean(
    medianActiveMarketPrice
    && acquisitionPrice
    && acquisitionPrice <= medianActiveMarketPrice * maxMarketRatio
  );
  if (issueTerms.length === 0 && !isPricePotential) return null;

  const effectiveCost = issueTerms.length > 0 ? repairCost : tradeCost;
  const expectedNetSale = medianActiveMarketPrice ? medianActiveMarketPrice * 0.82 : undefined;
  const expectedMargin = expectedNetSale && acquisitionPrice
    ? roundMoney(expectedNetSale - acquisitionPrice - effectiveCost)
    : undefined;
  const marginPercent = expectedMargin && acquisitionPrice
    ? Math.round((expectedMargin / acquisitionPrice) * 100)
    : undefined;
  const score = scoreCandidate({ issueTerms, medianActiveMarketPrice, acquisitionPrice, expectedMargin, marginPercent, isPricePotential });

  return {
    ...listing,
    id: listingId(`${source}-sourcing`, listing.itemUrl || listing.listingId),
    modelId: model.id,
    query,
    sourcePlatform: source,
    sourceQueryType: issueTerms.length > 0 ? "defect-title" : "price-potential",
    issueTerms,
    observedAt: new Date().toISOString(),
    estimatedMarketValue: medianActiveMarketPrice,
    expectedMargin,
    marginPercent,
    score,
    label: labelForScore(score, medianActiveMarketPrice),
    conditionBucket: classifyListingCondition({
      title: listing.title,
      condition: listing.condition,
      sourceQueryType: issueTerms.length > 0 ? "defect-title" : "price-potential",
      issueTerms
    })
  };
}

function scoreCandidate(input: {
  issueTerms: string[];
  medianActiveMarketPrice?: number;
  acquisitionPrice?: number;
  expectedMargin?: number;
  marginPercent?: number;
  isPricePotential: boolean;
}): number {
  let score = 20;
  if (input.issueTerms.length > 0) score += 15;
  if (input.isPricePotential) score += 15;
  if ((input.medianActiveMarketPrice || 0) >= 120) score += 10;
  if ((input.medianActiveMarketPrice || 0) >= 250) score += 10;
  if ((input.expectedMargin || 0) >= 40) score += 20;
  if ((input.expectedMargin || 0) >= 100) score += 15;
  if ((input.marginPercent || 0) >= 60) score += 10;
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

function modelNameMatches(model: WalkmanModel, title: string): boolean {
  if (model.modelCode) {
    return modelCodeMatches(model.modelCode, title) && hasProductContext(model, title);
  }

  return modelTitleMatches(model, title);
}

function hasProductContext(model: WalkmanModel, title: string): boolean {
  const lowerTitle = title.toLowerCase();
  const maker = (model.maker || model.name.split(/\s+/)[0] || "").toLowerCase();
  const aliases = maker === "victor"
    ? ["victor", "jvc"]
    : maker === "panasonic" || maker === "national"
      ? ["panasonic", "national"]
      : [maker];
  if (aliases.some((alias) => alias && lowerTitle.includes(alias))) return true;

  return /walkman|cassette|musicassette|personal stereo|portable audio|tape player|cassette player|lettore|reproductor|reprodutor|registratore|grabador|radio cassette/i.test(title);
}

function platformQueryForModel(modelName: string): string {
  return `${modelName} walkman`;
}

function readOffset(envPrefix: string, limit: number): number {
  const explicit = process.env[`${envPrefix}_MODEL_OFFSET`] || process.env.PLATFORM_MODEL_OFFSET;
  if (explicit !== undefined) return Number(explicit || 0);
  const rotate = process.env[`${envPrefix}_ROTATE_OFFSET`] || process.env.PLATFORM_ROTATE_OFFSET;
  if (rotate !== "true") return 0;

  const modelCount = Number(process.env[`${envPrefix}_MODEL_COUNT_ESTIMATE`] || process.env.PLATFORM_MODEL_COUNT_ESTIMATE || 1091);
  const chunkCount = Math.max(1, Math.ceil(modelCount / Math.max(1, limit)));
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  const rotationStart = process.env[`${envPrefix}_ROTATION_START_DATE`] || process.env.PLATFORM_ROTATION_START_DATE;
  const startDayIndex = rotationStart ? dayIndexForDate(rotationStart) : 0;
  const chunkIndex = positiveModulo(dayIndex - startDayIndex, chunkCount);
  return chunkIndex * limit;
}

function dayIndexForDate(value: string): number {
  const timestamp = Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) return 0;
  return Math.floor(timestamp / 86_400_000);
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function runTypeForSource(source: PlatformSourcingPlatform): ScanRunType {
  if (source === "vinted") return "vinted_sourcing";
  if (source === "vinted_fr") return "vinted_fr_sourcing";
  if (source === "kleinanzeigen") return "kleinanzeigen_sourcing";
  return "wallapop_sourcing";
}

function envPrefixForSource(source: PlatformSourcingPlatform): string {
  if (source === "vinted") return "VINTED";
  if (source === "vinted_fr") return "VINTED_FR";
  if (source === "kleinanzeigen") return "KLEINANZEIGEN";
  return "WALLAPOP";
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

async function randomDelay(envPrefix: string): Promise<void> {
  const min = Number(process.env[`${envPrefix}_DELAY_MIN_MS`] || process.env.PLATFORM_DELAY_MIN_MS || 1_500);
  const max = Number(process.env[`${envPrefix}_DELAY_MAX_MS`] || process.env.PLATFORM_DELAY_MAX_MS || 4_500);
  const delay = Math.floor(min + Math.random() * Math.max(0, max - min));
  await new Promise((resolve) => setTimeout(resolve, delay));
}

function isBlockError(message: string): boolean {
  return /block|captcha|access denied|zugriff verweigert|forbidden|http 403|interdit/i.test(message);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
