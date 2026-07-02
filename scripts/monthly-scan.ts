import { runMonthlyScan } from "@/lib/scan/monthly";

const result = await runMonthlyScan({
  persist: hasFlag("persist"),
  onProgress: console.log
});

console.log(JSON.stringify({
  catalog: {
    runId: result.catalog.id,
    status: result.catalog.status,
    modelsSaved: result.catalog.modelsSaved,
    errors: result.catalog.errors.length
  },
  market: {
    runId: result.market.id,
    status: result.market.status,
    marketListingsSaved: result.market.marketListingsSaved,
    errors: result.market.errors.length
  },
  walkmanLandMarket: {
    runId: result.walkmanLandMarket.id,
    status: result.walkmanLandMarket.status,
    marketListingsSaved: result.walkmanLandMarket.marketListingsSaved,
    errors: result.walkmanLandMarket.errors.length
  },
  damaged: {
    runId: result.damaged.id,
    status: result.damaged.status,
    candidatesSaved: result.damaged.candidatesSaved,
    errors: result.damaged.errors.length
  },
  vinted: {
    runId: result.vinted.id,
    status: result.vinted.status,
    candidatesSaved: result.vinted.candidatesSaved,
    errors: result.vinted.errors.length
  },
  kleinanzeigen: {
    runId: result.kleinanzeigen.id,
    status: result.kleinanzeigen.status,
    candidatesSaved: result.kleinanzeigen.candidatesSaved,
    errors: result.kleinanzeigen.errors.length
  }
}, null, 2));

if ([result.catalog, result.market, result.walkmanLandMarket, result.damaged, result.vinted, result.kleinanzeigen].some((run) => run.status === "failed")) {
  process.exitCode = 1;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
