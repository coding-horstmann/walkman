import crypto from "node:crypto";
import { hasDatabaseUrl } from "@/lib/db/client";
import { ensureSchema } from "@/lib/db/schema";
import { createScanRun, finishScanRun, upsertWalkmanModel } from "@/lib/db/repository";
import { fetchWalkmanCatalog } from "@/lib/sources/walkman-land";
import type { ScanRun, WalkmanModel } from "@/lib/types";

export type CatalogSyncOptions = {
  persist?: boolean;
  maxPages?: number;
  onProgress?: (event: string) => void;
};

export async function runCatalogSync(options: CatalogSyncOptions = {}): Promise<{
  run: ScanRun;
  models: WalkmanModel[];
  totalHint?: number;
}> {
  const shouldPersist = Boolean(options.persist && hasDatabaseUrl());
  if (options.persist && !hasDatabaseUrl()) throw new Error("DATABASE_URL is required for persistent catalog sync");
  if (shouldPersist) await ensureSchema();

  const run = createRun("catalog");
  if (shouldPersist) await createScanRun(run);

  try {
    const result = await fetchWalkmanCatalog({
      maxPages: options.maxPages,
      onPage: (event) => {
        options.onProgress?.(`[catalog] page=${event.page} found=${event.found} totalHint=${event.totalHint || "unknown"}`);
      }
    });

    run.modelsFound = result.models.length;
    if (shouldPersist) {
      for (const model of result.models) {
        await upsertWalkmanModel(model, run.id);
        run.modelsSaved += 1;
      }
    } else {
      run.modelsSaved = result.models.length;
    }
    run.status = "completed";
    return { run, models: result.models, totalHint: result.totalHint };
  } catch (error) {
    run.status = "failed";
    run.errors.push({ scope: "catalog", message: error instanceof Error ? error.message : String(error) });
    return { run, models: [] };
  } finally {
    run.finishedAt = new Date().toISOString();
    if (shouldPersist) await finishScanRun(run);
  }
}

export function createRun(runType: ScanRun["runType"]): ScanRun {
  return {
    id: crypto.randomUUID(),
    runType,
    startedAt: new Date().toISOString(),
    status: "running",
    modelsFound: 0,
    modelsSaved: 0,
    salesFound: 0,
    salesSaved: 0,
    marketListingsFound: 0,
    marketListingsSaved: 0,
    candidatesFound: 0,
    candidatesSaved: 0,
    errors: []
  };
}
