import { NextResponse, type NextRequest } from "next/server";
import { assertApiWriteAccess } from "@/lib/api-auth";
import { hasDatabaseUrl, query } from "@/lib/db/client";
import { ensureSchema } from "@/lib/db/schema";
import { fetchVintedImageFromItemUrl } from "@/lib/sources/vinted";

type MissingVintedImageRow = {
  id: string;
  listing_url: string;
  source_platform: "vinted" | "vinted_fr";
};

type ManualImageUpdate = {
  itemUrl?: string;
  imageUrl?: string;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 250;
const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_CONCURRENCY = 8;

export async function POST(request: NextRequest) {
  const unauthorized = assertApiWriteAccess(request);
  if (unauthorized) return unauthorized;

  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  await ensureSchema();
  const manualUpdates = await readManualUpdates(request);
  if (manualUpdates.length) {
    const result = await applyManualUpdates(manualUpdates);
    return NextResponse.json(result);
  }

  const limit = readLimit(request.nextUrl.searchParams.get("limit"));
  const timeoutMs = readTimeoutMs(request.nextUrl.searchParams.get("timeoutMs"));
  const concurrency = readConcurrency(request.nextUrl.searchParams.get("concurrency"));
  const listOnly = request.nextUrl.searchParams.get("listOnly") === "1";
  const rows = await query<MissingVintedImageRow>(
    `SELECT id, listing_url, source_platform
     FROM repair_candidates
     WHERE source_platform IN ('vinted', 'vinted_fr')
       AND (image_url IS NULL OR image_url = '')
     ORDER BY last_seen DESC
     LIMIT $1`,
    [limit]
  );

  if (listOnly) {
    return NextResponse.json({
      scanned: rows.length,
      rows: rows.map((row) => ({
        itemUrl: row.listing_url,
        sourcePlatform: row.source_platform
      }))
    });
  }

  let updated = 0;
  const errors: Array<{ id: string; message: string }> = [];
  for (let index = 0; index < rows.length; index += concurrency) {
    const batch = rows.slice(index, index + concurrency);
    const results = await Promise.all(batch.map((row) => backfillRowImage(row, timeoutMs)));
    for (const result of results) {
      if (result.updated) updated += 1;
      if (result.error) errors.push(result.error);
    }
  }

  return NextResponse.json({ scanned: rows.length, updated, errors, timeoutMs, concurrency });
}

function readLimit(value: string | null): number {
  const parsed = Number(value || DEFAULT_LIMIT);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(parsed)));
}

function readTimeoutMs(value: string | null): number {
  const parsed = Number(value || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.max(1_000, Math.min(15_000, Math.floor(parsed)));
}

function readConcurrency(value: string | null): number {
  const parsed = Number(value || DEFAULT_CONCURRENCY);
  if (!Number.isFinite(parsed)) return DEFAULT_CONCURRENCY;
  return Math.max(1, Math.min(12, Math.floor(parsed)));
}

async function backfillRowImage(row: MissingVintedImageRow, timeoutMs: number): Promise<{
  updated: boolean;
  error?: { id: string; message: string };
}> {
  try {
    const imageUrl = await fetchVintedImageFromItemUrl(row.listing_url, timeoutMs);
    if (!imageUrl) return { updated: false };
    await query(
      `UPDATE repair_candidates
       SET image_url = $2
       WHERE id = $1`,
      [row.id, imageUrl]
    );
    return { updated: true };
  } catch (error) {
    return {
      updated: false,
      error: {
        id: row.id,
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

async function readManualUpdates(request: NextRequest): Promise<ManualImageUpdate[]> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return [];
  const body = await request.json().catch(() => undefined) as { updates?: ManualImageUpdate[] } | undefined;
  if (!Array.isArray(body?.updates)) return [];
  return body.updates;
}

async function applyManualUpdates(updates: ManualImageUpdate[]): Promise<{
  received: number;
  updated: number;
  skipped: number;
  errors: Array<{ itemUrl?: string; message: string }>;
}> {
  let updated = 0;
  let skipped = 0;
  const errors: Array<{ itemUrl?: string; message: string }> = [];

  for (const update of updates) {
    try {
      const itemUrl = validateHttpUrl(update.itemUrl);
      const imageUrl = validateHttpUrl(update.imageUrl);
      if (!itemUrl || !imageUrl) {
        skipped += 1;
        continue;
      }
      const result = await query<{ id: string }>(
        `UPDATE repair_candidates
         SET image_url = $2
         WHERE listing_url = $1
           AND source_platform IN ('vinted', 'vinted_fr')
           AND (image_url IS NULL OR image_url = '')
         RETURNING id`,
        [itemUrl, imageUrl]
      );
      updated += result.length;
    } catch (error) {
      errors.push({
        itemUrl: update.itemUrl,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { received: updates.length, updated, skipped, errors };
}

function validateHttpUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
