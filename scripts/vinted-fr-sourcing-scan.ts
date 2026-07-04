import { runVintedFrSourcingScan } from "@/lib/scan/platform-sourcing";
import { isVintedBlockError } from "@/lib/sources/vinted";

const run = await runVintedFrSourcingScan({
  persist: hasFlag("persist"),
  limit: readNumberArg("limit"),
  offset: readNumberArg("offset"),
  resultsPerModel: readNumberArg("results-per-model"),
  repairCost: readNumberArg("repair-cost"),
  tradeCost: readNumberArg("trade-cost"),
  onProgress: console.log
});

console.log(JSON.stringify({
  runId: run.id,
  status: run.status,
  candidatesFound: run.candidatesFound,
  candidatesSaved: run.candidatesSaved,
  errors: run.errors.length
}, null, 2));

const blockOnlyFailure = run.status === "failed"
  && run.errors.length > 0
  && run.errors.every((error) => isVintedBlockError(error.message));

if (blockOnlyFailure) {
  console.log("[vinted_fr] blocked by Vinted; keeping process exit 0 to avoid Railway crash notification");
} else if (run.status === "failed") {
  process.exitCode = 1;
}

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
