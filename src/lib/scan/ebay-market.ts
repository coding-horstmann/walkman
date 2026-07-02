import { hasDatabaseUrl } from "@/lib/db/client";
import { ensureSchema } from "@/lib/db/schema";
import {
  createScanRun,
  finishScanRun,
  listModelsForScan,
  listingId,
  upsertMarketListing
} from "@/lib/db/repository";
import { EbayClient, marketQueryForModel } from "@/lib/ebay/client";
import { isLikelyAccessoryOrDocumentation, isLikelyDefectiveOrPartsListing } from "@/lib/listing-quality";
import { modelCodeMatches } from "@/lib/model-match";
import { createRun } from "@/lib/scan/catalog-sync";
import type { EbayListingBase, MarketListing, ScanRun, WalkmanModel } from "@/lib/types";

export type EbayMarketScanOptions = {
  persist?: boolean;
  limit?: number;
  offset?: number;
  resultsPerModel?: number;
  onProgress?: (event: string) => void;
};

export async function runEbayMarketScan(options: EbayMarketScanOptions = {}): Promise<ScanRun> {
  const shouldPersist = Boolean(options.persist && hasDatabaseUrl());
  if (options.persist && !hasDatabaseUrl()) throw new Error("DATABASE_URL is required for persistent eBay market scan");
  if (shouldPersist) await ensureSchema();

  const run = createRun("ebay_market");
  if (shouldPersist) await createScanRun(run);

  const limit = options.limit ?? Number(process.env.EBAY_MARKET_MODELS_PER_RUN || process.env.EBAY_MODELS_PER_RUN || 50);
  const offset = options.offset ?? Number(process.env.EBAY_MODEL_OFFSET || 0);
  const resultsPerModel = options.resultsPerModel ?? Number(process.env.EBAY_MARKET_RESULTS_PER_MODEL || 8);
  const models = shouldPersist ? await listModelsForScan(limit, offset) : [];
  const client = new EbayClient({ maxCalls: Number(process.env.EBAY_MAX_CALLS_PER_RUN || 1000) });
  const buyingOptions = readBuyingOptions(process.env.EBAY_MARKET_BUYING_OPTIONS || process.env.EBAY_BUYING_OPTIONS);

  try {
    for (const [index, model] of models.entries()) {
      try {
        const query = marketQueryForModel(model.name);
        const listings = dedupeListings(await searchListingsByBuyingOption(
          client,
          buyingOptions,
          query,
          resultsPerModel,
          {
            conditionIds: process.env.EBAY_MARKET_CONDITION_IDS,
            sellerAccountType: process.env.EBAY_SELLER_ACCOUNT_TYPE
          }
        ));
        const marketListings = listings
          .map((listing) => toMarketListing(model, listing, query))
          .filter(Boolean) as MarketListing[];

        run.marketListingsFound += marketListings.length;
        for (const listing of marketListings) {
          if (shouldPersist) {
            await upsertMarketListing(listing, run.id);
            run.marketListingsSaved += 1;
          }
        }
        options.onProgress?.(`[ebay-market] ${offset + index + 1} ${model.name}: found=${marketListings.length}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        run.errors.push({ scope: model.name, message });
        options.onProgress?.(`[ebay-market] ${model.name}: ${message}`);
      }
    }
    run.status = "completed";
  } catch (error) {
    run.status = "failed";
    run.errors.push({ scope: "ebay_market", message: error instanceof Error ? error.message : String(error) });
  } finally {
    run.finishedAt = new Date().toISOString();
    if (shouldPersist) await finishScanRun(run);
  }

  return run;
}

function toMarketListing(
  model: WalkmanModel,
  listing: EbayListingBase,
  query: string
): MarketListing | null {
  if (!listing.priceAmount || !modelNameMatches(model, listing.title)) return null;
  if (isLikelyAccessoryOrDocumentation(listing)) return null;
  if (isLikelyDefectiveOrPartsListing(listing)) return null;

  return {
    ...listing,
    id: listingId("market-listing", listing.itemUrl || listing.listingId),
    modelId: model.id,
    query,
    observedAt: new Date().toISOString()
  };
}

function modelNameMatches(model: WalkmanModel, title: string): boolean {
  return modelCodeMatches(model.modelCode, title);
}

function readBuyingOptions(value?: string): string[] {
  if (value) {
    const parsed = value.split(",").map((option) => option.trim()).filter(Boolean);
    if (parsed.length) return parsed;
  }
  return process.env.EBAY_INCLUDE_AUCTIONS === "false" ? ["FIXED_PRICE"] : ["FIXED_PRICE", "AUCTION"];
}

async function searchListingsByBuyingOption(
  client: EbayClient,
  buyingOptions: string[],
  query: string,
  resultsPerModel: number,
  baseOptions: { conditionIds?: string; sellerAccountType?: string }
): Promise<EbayListingBase[]> {
  const listings: EbayListingBase[] = [];
  for (const buyingOption of buyingOptions) {
    listings.push(...await client.searchActiveListings(query, resultsPerModel, {
      ...baseOptions,
      buyingOptions: buyingOption
    }));
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
