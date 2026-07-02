import { runWalkmanLandMarketScan } from "@/lib/scan/walkman-land-market";

const run = await runWalkmanLandMarketScan({
  persist: hasFlag("persist"),
  limit: readNumberArg("limit"),
  offset: readNumberArg("offset"),
  delayMs: readNumberArg("delay-ms"),
  onProgress: console.log
});

console.log(JSON.stringify({
  runId: run.id,
  status: run.status,
  marketListingsFound: run.marketListingsFound,
  marketListingsSaved: run.marketListingsSaved,
  errors: run.errors
}, null, 2));

if (run.status === "failed") process.exitCode = 1;

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
