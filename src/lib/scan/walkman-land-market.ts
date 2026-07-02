import { hasDatabaseUrl } from "@/lib/db/client";
import { ensureSchema } from "@/lib/db/schema";
import {
  createScanRun,
  deleteMarketListingsForModelSource,
  finishScanRun,
  listModelsForScan,
  listingId,
  upsertMarketListing
} from "@/lib/db/repository";
import { isLikelyAccessoryOrDocumentation, isLikelyDefectiveOrPartsListing } from "@/lib/listing-quality";
import { createRun } from "@/lib/scan/catalog-sync";
import { fetchWalkmanLandEbayOffers, type WalkmanLandEbayOffer } from "@/lib/sources/walkman-land";
import type { EbayListingBase, MarketListing, ScanRun, WalkmanModel } from "@/lib/types";

export type WalkmanLandMarketScanOptions = {
  persist?: boolean;
  limit?: number;
  offset?: number;
  delayMs?: number;
  onProgress?: (event: string) => void;
};

export async function runWalkmanLandMarketScan(
  options: WalkmanLandMarketScanOptions = {}
): Promise<ScanRun> {
  const shouldPersist = Boolean(options.persist && hasDatabaseUrl());
  if (options.persist && !hasDatabaseUrl()) {
    throw new Error("DATABASE_URL is required for persistent Walkman.land market scan");
  }
  if (shouldPersist) await ensureSchema();

  const run = createRun("walkman_land_market");
  if (shouldPersist) await createScanRun(run);

  const limit = options.limit ?? Number(process.env.WALKMAN_LAND_MARKET_MODELS_PER_RUN || 1091);
  const offset = options.offset ?? Number(process.env.WALKMAN_LAND_MARKET_MODEL_OFFSET || 0);
  const delayMs = options.delayMs ?? Number(process.env.WALKMAN_LAND_MARKET_DELAY_MS || 1600);
  const models = shouldPersist ? await listModelsForScan(limit, offset) : [];

  try {
    const usdToEur = await fetchUsdToEurRate();
    options.onProgress?.(`[walkman-land-market] USD/EUR=${usdToEur.toFixed(6)}`);

    for (const [index, model] of models.entries()) {
      try {
        if (!model.catalogUrl) {
          options.onProgress?.(`[walkman-land-market] ${offset + index + 1} ${model.name}: no catalog URL`);
          continue;
        }

        const offers = await fetchWalkmanLandEbayOffers(model.catalogUrl);
        const listings = offers
          .map((offer) => toMarketListing(model, offer, usdToEur))
          .filter(Boolean) as MarketListing[];

        run.marketListingsFound += listings.length;
        if (shouldPersist) {
          await deleteMarketListingsForModelSource(model.id, "walkman_land");
          for (const listing of listings) {
            await upsertMarketListing(listing, run.id);
            run.marketListingsSaved += 1;
          }
        }

        options.onProgress?.(
          `[walkman-land-market] ${offset + index + 1} ${model.name}: raw=${offers.length} saved=${listings.length}`
        );
        await sleep(delayMs);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        run.errors.push({ scope: model.name, message });
        options.onProgress?.(`[walkman-land-market] ${model.name}: ${message}`);
      }
    }
    run.status = "completed";
  } catch (error) {
    run.status = "failed";
    run.errors.push({
      scope: "walkman_land_market",
      message: error instanceof Error ? error.message : String(error)
    });
  } finally {
    run.finishedAt = new Date().toISOString();
    if (shouldPersist) await finishScanRun(run);
  }

  return run;
}

function toMarketListing(
  model: WalkmanModel,
  offer: WalkmanLandEbayOffer,
  usdToEur: number
): MarketListing | null {
  const listing: EbayListingBase = {
    listingId: offer.listingId,
    title: offer.title,
    itemUrl: offer.itemUrl,
    imageUrl: offer.imageUrl,
    priceAmount: roundMoney(offer.priceUsd * usdToEur),
    priceCurrency: "EUR",
    sourcePlatform: "walkman_land",
    listingFormat: "unknown",
    buyingOptions: [],
    location: offer.sellerCountry,
    sourceQueryType: "walkman-land-ebay",
    rawData: {
      source: "walkman.land",
      catalogUrl: model.catalogUrl,
      originalPriceAmount: offer.priceUsd,
      originalPriceCurrency: "USD",
      usdToEur
    }
  };

  if (!modelMatches(model, listing.title)) return null;
  const isAccessory = isLikelyAccessoryOrDocumentation(listing);
  const isDefective = isLikelyDefectiveOrPartsListing(listing);

  return {
    ...listing,
    id: listingId("walkman-land-market", `${model.id}:${offer.listingId}`),
    modelId: model.id,
    query: model.catalogUrl || model.name,
    condition: isAccessory
      ? "Zubehör oder Dokumentation"
      : isDefective
        ? "Defekt oder Ersatzteile"
        : "Aktives Angebot",
    observedAt: new Date().toISOString()
  };
}

function modelMatches(model: WalkmanModel, title: string): boolean {
  if (!model.modelCode) return false;
  const parts = model.modelCode.match(/[a-z]+|\d+/gi) || [];
  if (!parts.length) return false;
  const pattern = parts.map(escapeRegex).join("[^a-z0-9]*");
  const codeMatches = new RegExp(`(^|[^a-z0-9])${pattern}(?=[^a-z0-9]|$)`, "i").test(title);
  if (!codeMatches) return false;

  const lowerTitle = title.toLowerCase();
  const maker = (model.maker || model.name.split(/\s+/)[0] || "").toLowerCase();
  const aliases = maker === "victor"
    ? ["victor", "jvc"]
    : maker === "panasonic" || maker === "national"
      ? ["panasonic", "national"]
      : [maker];
  return aliases.some((alias) => alias && lowerTitle.includes(alias))
    || /walkman|cassette|personal stereo|portable audio|tape player|lettore|reproductor|reprodutor/i.test(title);
}

async function fetchUsdToEurRate(): Promise<number> {
  const override = Number(process.env.WALKMAN_LAND_USD_TO_EUR);
  if (Number.isFinite(override) && override > 0) return override;

  const response = await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", {
    headers: {
      Accept: "application/xml,text/xml",
      "User-Agent": "walkman-restoration-scout/1.0"
    }
  });
  if (!response.ok) throw new Error(`ECB exchange-rate HTTP ${response.status}`);
  const xml = await response.text();
  const match = xml.match(/currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/i);
  const usdPerEur = match ? Number(match[1]) : undefined;
  if (!usdPerEur || !Number.isFinite(usdPerEur)) {
    throw new Error("ECB USD exchange rate missing");
  }
  return 1 / usdPerEur;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
