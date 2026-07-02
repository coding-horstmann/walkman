import { runCatalogSync } from "@/lib/scan/catalog-sync";
import { runEbayDamagedScan } from "@/lib/scan/ebay-damaged";
import { runEbayMarketScan } from "@/lib/scan/ebay-market";
import { runKleinanzeigenSourcingScan, runVintedSourcingScan } from "@/lib/scan/platform-sourcing";
import { runWalkmanLandMarketScan } from "@/lib/scan/walkman-land-market";

export async function runMonthlyScan(options: {
  persist?: boolean;
  onProgress?: (event: string) => void;
} = {}) {
  const catalog = await runCatalogSync({ persist: options.persist, onProgress: options.onProgress });
  const market = await runEbayMarketScan({ persist: options.persist, onProgress: options.onProgress });
  const walkmanLandMarket = await runWalkmanLandMarketScan({ persist: options.persist, onProgress: options.onProgress });
  const damaged = await runEbayDamagedScan({ persist: options.persist, onProgress: options.onProgress });
  const vinted = await runVintedSourcingScan({ persist: options.persist, onProgress: options.onProgress });
  const kleinanzeigen = await runKleinanzeigenSourcingScan({ persist: options.persist, onProgress: options.onProgress });

  return {
    catalog: catalog.run,
    market,
    walkmanLandMarket,
    damaged,
    vinted,
    kleinanzeigen
  };
}
