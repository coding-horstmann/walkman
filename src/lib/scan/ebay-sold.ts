import { hasDatabaseUrl } from "@/lib/db/client";
import { ensureSchema } from "@/lib/db/schema";
import {
  createScanRun,
  finishScanRun,
  listModelsForScan,
  listingId,
  upsertMarketSale
} from "@/lib/db/repository";
import { createRun } from "@/lib/scan/catalog-sync";
import { EbayClient, soldQueryForModel } from "@/lib/ebay/client";
import type { MarketSale, ScanRun } from "@/lib/types";

export type EbaySoldScanOptions = {
  persist?: boolean;
  limit?: number;
  offset?: number;
  resultsPerModel?: number;
  monthsBack?: number;
  onProgress?: (event: string) => void;
};

export async function runEbaySoldScan(options: EbaySoldScanOptions = {}): Promise<ScanRun> {
  const shouldPersist = Boolean(options.persist && hasDatabaseUrl());
  if (options.persist && !hasDatabaseUrl()) throw new Error("DATABASE_URL is required for persistent eBay sold scan");
  if (shouldPersist) await ensureSchema();

  const run = createRun("ebay_sold");
  if (shouldPersist) await createScanRun(run);

  const limit = options.limit ?? Number(process.env.EBAY_MODELS_PER_RUN || 50);
  const offset = options.offset ?? Number(process.env.EBAY_MODEL_OFFSET || 0);
  const resultsPerModel = options.resultsPerModel ?? Number(process.env.EBAY_SOLD_RESULTS_PER_MODEL || 8);
  const models = shouldPersist ? await listModelsForScan(limit, offset) : [];
  const client = new EbayClient({ maxCalls: Number(process.env.EBAY_MAX_CALLS_PER_RUN || 1000) });

  try {
    for (const [index, model] of models.entries()) {
      try {
        const listings = await client.searchSoldListings(soldQueryForModel(model.name), resultsPerModel, options.monthsBack);
        run.salesFound += listings.length;
        for (const listing of listings) {
          if (!listing.priceAmount) continue;
          const sale: MarketSale = {
            ...listing,
            id: listingId("market-sale", `${model.id}:${listing.listingId}`),
            modelId: model.id,
            source: "ebay_marketplace_insights",
            soldAt: readSoldAt(listing.rawData)
          };
          if (shouldPersist) {
            await upsertMarketSale(sale, run.id);
            run.salesSaved += 1;
          }
        }
        options.onProgress?.(`[ebay-sold] ${offset + index + 1} ${model.name}: found=${listings.length}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        run.errors.push({ scope: model.name, message });
        options.onProgress?.(`[ebay-sold] ${model.name}: ${message}`);
        if (/access denied|insufficient permissions|marketplace insights|requested scope is invalid|exceeds the scope/i.test(message)) break;
      }
    }
    run.status = "completed";
  } catch (error) {
    run.status = "failed";
    run.errors.push({ scope: "ebay_sold", message: error instanceof Error ? error.message : String(error) });
  } finally {
    run.finishedAt = new Date().toISOString();
    if (shouldPersist) await finishScanRun(run);
  }

  return run;
}

function readSoldAt(rawData: Record<string, unknown>): string | undefined {
  const value = rawData.lastSoldDate || rawData.itemEndDate;
  return typeof value === "string" ? value : undefined;
}
