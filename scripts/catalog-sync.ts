import { runCatalogSync } from "@/lib/scan/catalog-sync";

const result = await runCatalogSync({
  persist: hasFlag("persist"),
  maxPages: readNumberArg("max-pages"),
  onProgress: console.log
});

console.log(JSON.stringify({
  runId: result.run.id,
  status: result.run.status,
  modelsFound: result.run.modelsFound,
  modelsSaved: result.run.modelsSaved,
  totalHint: result.totalHint,
  errors: result.run.errors.length
}, null, 2));

if (result.run.errors.length) {
  console.log(JSON.stringify(result.run.errors, null, 2));
}

if (result.run.status === "failed") process.exitCode = 1;

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
