import { runEbayDamagedScan } from "@/lib/scan/ebay-damaged";
import { runKleinanzeigenSourcingScan, runVintedSourcingScan } from "@/lib/scan/platform-sourcing";

const persist = hasFlag("persist");
const limit = readNumberArg("limit");
const offset = readNumberArg("offset");
const resultsPerModel = readNumberArg("results-per-model");
const repairCost = readNumberArg("repair-cost");
const tradeCost = readNumberArg("trade-cost");

const ebay = await runEbayDamagedScan({
  persist,
  limit,
  offset,
  resultsPerModel,
  repairCost,
  onProgress: console.log
});

const vinted = await runVintedSourcingScan({
  persist,
  limit,
  offset,
  resultsPerModel,
  repairCost,
  tradeCost,
  onProgress: console.log
});

const kleinanzeigen = await runKleinanzeigenSourcingScan({
  persist,
  limit,
  offset,
  resultsPerModel,
  repairCost,
  tradeCost,
  onProgress: console.log
});

console.log(JSON.stringify({
  ebay: {
    runId: ebay.id,
    status: ebay.status,
    candidatesFound: ebay.candidatesFound,
    candidatesSaved: ebay.candidatesSaved,
    errors: ebay.errors.length
  },
  vinted: {
    runId: vinted.id,
    status: vinted.status,
    candidatesFound: vinted.candidatesFound,
    candidatesSaved: vinted.candidatesSaved,
    errors: vinted.errors.length
  },
  kleinanzeigen: {
    runId: kleinanzeigen.id,
    status: kleinanzeigen.status,
    candidatesFound: kleinanzeigen.candidatesFound,
    candidatesSaved: kleinanzeigen.candidatesSaved,
    errors: kleinanzeigen.errors.length
  }
}, null, 2));

if ([ebay, vinted, kleinanzeigen].some((run) => run.status === "failed")) process.exitCode = 1;

function readNumberArg(name: string): number | undefined {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
