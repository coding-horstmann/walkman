import crypto from "node:crypto";
import { query } from "@/lib/db/client";
import { classifyListingCondition } from "@/lib/listing-quality";
import type {
  DashboardData,
  ListingFormat,
  ListingLink,
  MarketListing,
  MarketSale,
  ModelMarketSummary,
  PlatformScanSnapshot,
  RepairCandidate,
  ScanRun,
  SourcePlatform,
  PlatformSourcingPlatform,
  WalkmanModel
} from "@/lib/types";

type DbScanRun = {
  id: string;
  run_type: ScanRun["runType"];
  started_at: Date;
  finished_at: Date | null;
  status: ScanRun["status"];
  models_found: number;
  models_saved: number;
  sales_found: number;
  sales_saved: number;
  market_listings_found: number;
  market_listings_saved: number;
  candidates_found: number;
  candidates_saved: number;
  errors: ScanRun["errors"];
};

type DbWalkmanModel = {
  id: string;
  name: string;
  maker: string | null;
  model_code: string | null;
  catalog_url: string | null;
  catalog_image_url: string | null;
  catalog_page: number | null;
  year: number | null;
  description: string | null;
  first_seen: Date;
  last_seen: Date;
};

type DbCandidate = {
  id: string;
  model_id: string;
  listing_id: string;
  listing_url: string;
  title: string;
  query: string;
  price_amount: string | null;
  price_currency: string | null;
  condition: string | null;
  seller_name: string | null;
  seller_account_type: string | null;
  image_url: string | null;
  source_platform: SourcePlatform | null;
  listing_format: ListingFormat | null;
  buying_options: string[] | null;
  item_end_date: Date | null;
  location: string | null;
  source_query_type: string | null;
  issue_terms: string[];
  estimated_market_value: string | null;
  expected_margin: string | null;
  margin_percent: string | null;
  score: number;
  label: RepairCandidate["label"];
  raw_data: Record<string, unknown>;
  last_seen: Date;
  model_name?: string;
  maker?: string | null;
  median_sold_price?: string | null;
  median_active_price?: string | null;
  median_ebay_active_price?: string | null;
  median_walkman_land_active_price?: string | null;
};

type DbSummary = DbWalkmanModel & {
  sales_count: string;
  median_sold_price: string | null;
  average_sold_price: string | null;
  min_sold_price: string | null;
  max_sold_price: string | null;
  market_listing_count: string;
  median_active_price: string | null;
  average_active_price: string | null;
  min_active_price: string | null;
  max_active_price: string | null;
  ebay_market_listing_count: string;
  walkman_land_market_listing_count: string;
  median_ebay_active_price: string | null;
  median_walkman_land_active_price: string | null;
  fixed_market_listing_count: string;
  auction_market_listing_count: string;
  private_market_listing_count: string;
  business_market_listing_count: string;
  candidate_count: string;
  median_candidate_price: string | null;
  median_defective_candidate_price: string | null;
  defective_candidate_count: string;
  unknown_candidate_count: string;
  average_candidate_price: string | null;
  min_candidate_price: string | null;
  max_candidate_price: string | null;
  fixed_candidate_count: string;
  auction_candidate_count: string;
  private_candidate_count: string;
  business_candidate_count: string;
  ebay_candidate_count: string;
  vinted_candidate_count: string;
  vinted_fr_candidate_count: string;
  kleinanzeigen_candidate_count: string;
  wallapop_candidate_count: string;
  vinted_raw_result_count: string | null;
  vinted_scan_candidate_count: string | null;
  vinted_scan_status: PlatformScanSnapshot["status"] | null;
  vinted_scan_error_message: string | null;
  vinted_scanned_at: Date | null;
  vinted_fr_raw_result_count: string | null;
  vinted_fr_scan_candidate_count: string | null;
  vinted_fr_scan_status: PlatformScanSnapshot["status"] | null;
  vinted_fr_scan_error_message: string | null;
  vinted_fr_scanned_at: Date | null;
  kleinanzeigen_raw_result_count: string | null;
  kleinanzeigen_scan_candidate_count: string | null;
  kleinanzeigen_scan_status: PlatformScanSnapshot["status"] | null;
  kleinanzeigen_scan_error_message: string | null;
  kleinanzeigen_scanned_at: Date | null;
  wallapop_raw_result_count: string | null;
  wallapop_scan_candidate_count: string | null;
  wallapop_scan_status: PlatformScanSnapshot["status"] | null;
  wallapop_scan_error_message: string | null;
  wallapop_scanned_at: Date | null;
  best_candidate_price: string | null;
  best_candidate_margin: string | null;
  best_candidate_score: number | null;
  last_sale_seen: Date | null;
  last_market_listing_seen: Date | null;
  last_candidate_seen: Date | null;
};

type PlatformScanResultInput = {
  runId: string;
  modelId: string;
  sourcePlatform: PlatformSourcingPlatform;
  query: string;
  rawResultCount: number;
  candidateCount: number;
  status: PlatformScanSnapshot["status"];
  errorMessage?: string;
  scannedAt: string;
};

type DbListingLink = {
  link_kind: "market" | "candidate";
  model_id: string;
  title: string;
  item_url: string;
  price_amount: string | null;
  price_currency: string | null;
  image_url: string | null;
  source_platform: SourcePlatform | null;
  listing_format: ListingFormat | null;
  seller_account_type: string | null;
  condition: string | null;
  source_query_type: string | null;
  issue_terms: string[] | null;
};

const ACTIVE_REPAIR_SOURCE_RC_SQL = "rc.source_platform IS DISTINCT FROM 'leboncoin'";
const TOP_DEAL_FRESHNESS_DAYS = 7;
const DASHBOARD_LISTING_FRESHNESS_DAYS = 14;

function freshListingSql(alias: string, days: number): string {
  return `${alias}.last_seen >= NOW() - INTERVAL '${days} days'`;
}

function modelTitleMatchSql(titleColumn: string, modelAlias: string): string {
  const modelCode = `NULLIF(${modelAlias}.model_code, '')`;
  return `(${modelCode} IS NOT NULL AND LOWER(COALESCE(${titleColumn}, '')) ~ (
    '(^|[^a-z0-9])'
    || array_to_string(regexp_split_to_array(LOWER(${modelCode}), '[^a-z0-9]+'), '[^a-z0-9]*')
    || '([^a-z0-9]|$)'
  ))`;
}

function defectiveCandidateSql(alias: string): string {
  return `(jsonb_array_length(${alias}.issue_terms) > 0
    OR COALESCE(${alias}.source_query_type, '') ~* 'defect|parts|repair'
    OR ${defectListingSql(`${alias}.title`, `${alias}.condition`)})`;
}

export function modelId(name: string): string {
  return crypto.createHash("sha256").update(`walkman:${name.toLowerCase()}`).digest("hex").slice(0, 32);
}

export function listingId(source: string, value: string): string {
  return crypto.createHash("sha256").update(`${source}:${value}`).digest("hex").slice(0, 32);
}

export async function createScanRun(run: ScanRun): Promise<void> {
  await query(
    `INSERT INTO scan_runs (
      id, run_type, started_at, status, models_found, models_saved,
      sales_found, sales_saved, market_listings_found, market_listings_saved,
      candidates_found, candidates_saved, errors
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
    [
      run.id,
      run.runType,
      run.startedAt,
      run.status,
      run.modelsFound,
      run.modelsSaved,
      run.salesFound,
      run.salesSaved,
      run.marketListingsFound,
      run.marketListingsSaved,
      run.candidatesFound,
      run.candidatesSaved,
      JSON.stringify(run.errors)
    ]
  );
}

export async function finishScanRun(run: ScanRun): Promise<void> {
  await query(
    `UPDATE scan_runs
     SET finished_at = $2,
       status = $3,
       models_found = $4,
       models_saved = $5,
       sales_found = $6,
       sales_saved = $7,
       market_listings_found = $8,
       market_listings_saved = $9,
       candidates_found = $10,
       candidates_saved = $11,
       errors = $12::jsonb
     WHERE id = $1`,
    [
      run.id,
      run.finishedAt || null,
      run.status,
      run.modelsFound,
      run.modelsSaved,
      run.salesFound,
      run.salesSaved,
      run.marketListingsFound,
      run.marketListingsSaved,
      run.candidatesFound,
      run.candidatesSaved,
      JSON.stringify(run.errors)
    ]
  );
}

export async function upsertPlatformScanResult(result: PlatformScanResultInput): Promise<void> {
  const id = crypto
    .createHash("sha256")
    .update(`platform-scan:${result.runId}:${result.modelId}:${result.sourcePlatform}`)
    .digest("hex")
    .slice(0, 32);

  await query(
    `INSERT INTO platform_scan_results (
      id, run_id, model_id, source_platform, query,
      raw_result_count, candidate_count, status, error_message, scanned_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (run_id, model_id, source_platform) DO UPDATE SET
      query = EXCLUDED.query,
      raw_result_count = EXCLUDED.raw_result_count,
      candidate_count = EXCLUDED.candidate_count,
      status = EXCLUDED.status,
      error_message = EXCLUDED.error_message,
      scanned_at = EXCLUDED.scanned_at`,
    [
      id,
      result.runId,
      result.modelId,
      result.sourcePlatform,
      result.query,
      result.rawResultCount,
      result.candidateCount,
      result.status,
      result.errorMessage || null,
      result.scannedAt
    ]
  );
}

export async function upsertWalkmanModel(model: WalkmanModel, runId: string): Promise<boolean> {
  const rows = await query<{ inserted: boolean }>(
    `INSERT INTO walkman_models (
      id, name, maker, model_code, catalog_url, catalog_image_url, catalog_page, year, description, last_catalog_run_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (name) DO UPDATE SET
      maker = EXCLUDED.maker,
      model_code = EXCLUDED.model_code,
      catalog_url = COALESCE(EXCLUDED.catalog_url, walkman_models.catalog_url),
      catalog_image_url = COALESCE(EXCLUDED.catalog_image_url, walkman_models.catalog_image_url),
      catalog_page = EXCLUDED.catalog_page,
      year = COALESCE(EXCLUDED.year, walkman_models.year),
      description = COALESCE(EXCLUDED.description, walkman_models.description),
      last_seen = NOW(),
      last_catalog_run_id = EXCLUDED.last_catalog_run_id
    RETURNING (xmax = 0) AS inserted`,
    [
      model.id,
      model.name,
      model.maker || null,
      model.modelCode || null,
      model.catalogUrl || null,
      model.catalogImageUrl || null,
      model.catalogPage || null,
      model.year || null,
      model.description || null,
      runId
    ]
  );
  return Boolean(rows[0]?.inserted);
}

export async function listModelsForScan(limit: number, offset = 0): Promise<WalkmanModel[]> {
  const rows = await query<DbWalkmanModel>(
    `SELECT *
     FROM walkman_models
     ORDER BY last_seen DESC, name ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows.map(mapModel);
}

export async function upsertMarketSale(sale: MarketSale, runId: string): Promise<boolean> {
  const rows = await query<{ inserted: boolean }>(
    `INSERT INTO market_sales (
      id, model_id, source, listing_id, item_url, title, price_amount,
      price_currency, sold_at, condition, seller_name, seller_account_type, image_url,
      source_platform, listing_format, buying_options, item_end_date, location, raw_data, run_id
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16::jsonb, $17, $18, $19::jsonb, $20
    )
    ON CONFLICT (source, listing_id) DO UPDATE SET
      model_id = EXCLUDED.model_id,
      item_url = EXCLUDED.item_url,
      title = EXCLUDED.title,
      price_amount = EXCLUDED.price_amount,
      price_currency = EXCLUDED.price_currency,
      sold_at = EXCLUDED.sold_at,
      condition = EXCLUDED.condition,
      seller_name = EXCLUDED.seller_name,
      seller_account_type = EXCLUDED.seller_account_type,
      image_url = EXCLUDED.image_url,
      source_platform = EXCLUDED.source_platform,
      listing_format = EXCLUDED.listing_format,
      buying_options = EXCLUDED.buying_options,
      item_end_date = EXCLUDED.item_end_date,
      location = EXCLUDED.location,
      raw_data = EXCLUDED.raw_data,
      last_seen = NOW(),
      run_id = EXCLUDED.run_id
    RETURNING (xmax = 0) AS inserted`,
    [
      sale.id,
      sale.modelId,
      sale.source,
      sale.listingId,
      sale.itemUrl,
      sale.title,
      sale.priceAmount || null,
      sale.priceCurrency || null,
      sale.soldAt || null,
      sale.condition || null,
      sale.sellerName || null,
      sale.sellerAccountType || null,
      sale.imageUrl || null,
      sale.sourcePlatform || "ebay",
      sale.listingFormat || "unknown",
      JSON.stringify(sale.buyingOptions || []),
      sale.itemEndDate || null,
      sale.location || null,
      JSON.stringify(sale.rawData || {}),
      runId
    ]
  );
  return Boolean(rows[0]?.inserted);
}

export async function upsertMarketListing(listing: MarketListing, runId: string): Promise<boolean> {
  const rows = await query<{ inserted: boolean }>(
    `INSERT INTO market_listings (
      id, model_id, listing_id, item_url, title, query, price_amount,
      price_currency, condition, seller_name, seller_account_type, image_url,
      source_platform, listing_format, buying_options, item_end_date, location,
      source_query_type, raw_data, run_id
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15::jsonb, $16, $17, $18, $19::jsonb, $20
    )
    ON CONFLICT (source_platform, item_url) DO UPDATE SET
      model_id = EXCLUDED.model_id,
      listing_id = EXCLUDED.listing_id,
      title = EXCLUDED.title,
      query = EXCLUDED.query,
      price_amount = EXCLUDED.price_amount,
      price_currency = EXCLUDED.price_currency,
      condition = EXCLUDED.condition,
      seller_name = EXCLUDED.seller_name,
      seller_account_type = EXCLUDED.seller_account_type,
      image_url = EXCLUDED.image_url,
      source_platform = EXCLUDED.source_platform,
      listing_format = EXCLUDED.listing_format,
      buying_options = EXCLUDED.buying_options,
      item_end_date = EXCLUDED.item_end_date,
      location = EXCLUDED.location,
      source_query_type = EXCLUDED.source_query_type,
      raw_data = EXCLUDED.raw_data,
      last_seen = NOW(),
      run_id = EXCLUDED.run_id
    RETURNING (xmax = 0) AS inserted`,
    [
      listing.id,
      listing.modelId,
      listing.listingId,
      listing.itemUrl,
      listing.title,
      listing.query,
      listing.priceAmount || null,
      listing.priceCurrency || null,
      listing.condition || null,
      listing.sellerName || null,
      listing.sellerAccountType || null,
      listing.imageUrl || null,
      listing.sourcePlatform || "ebay",
      listing.listingFormat || "unknown",
      JSON.stringify(listing.buyingOptions || []),
      listing.itemEndDate || null,
      listing.location || null,
      listing.sourceQueryType || null,
      JSON.stringify(listing.rawData || {}),
      runId
    ]
  );
  return Boolean(rows[0]?.inserted);
}

export async function deleteMarketListingsForModelSource(
  modelIdValue: string,
  sourcePlatform: SourcePlatform
): Promise<number> {
  const rows = await query<{ id: string }>(
    `DELETE FROM market_listings
     WHERE model_id = $1 AND source_platform = $2
     RETURNING id`,
    [modelIdValue, sourcePlatform]
  );
  return rows.length;
}

export async function upsertRepairCandidate(candidate: RepairCandidate, runId: string): Promise<boolean> {
  const rows = await query<{ inserted: boolean }>(
    `INSERT INTO repair_candidates (
      id, model_id, listing_id, listing_url, title, query, price_amount,
      price_currency, condition, seller_name, seller_account_type, image_url,
      source_platform, listing_format, buying_options, item_end_date, location,
      source_query_type, issue_terms,
      estimated_market_value, expected_margin, margin_percent, score, label, raw_data, run_id
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15::jsonb, $16, $17, $18, $19::jsonb, $20,
      $21, $22, $23, $24, $25::jsonb, $26
    )
    ON CONFLICT (listing_url) DO UPDATE SET
      model_id = EXCLUDED.model_id,
      listing_id = EXCLUDED.listing_id,
      title = EXCLUDED.title,
      query = EXCLUDED.query,
      price_amount = EXCLUDED.price_amount,
      price_currency = EXCLUDED.price_currency,
      condition = EXCLUDED.condition,
      seller_name = EXCLUDED.seller_name,
      seller_account_type = EXCLUDED.seller_account_type,
      image_url = EXCLUDED.image_url,
      source_platform = EXCLUDED.source_platform,
      listing_format = EXCLUDED.listing_format,
      buying_options = EXCLUDED.buying_options,
      item_end_date = EXCLUDED.item_end_date,
      location = EXCLUDED.location,
      source_query_type = EXCLUDED.source_query_type,
      issue_terms = EXCLUDED.issue_terms,
      estimated_market_value = EXCLUDED.estimated_market_value,
      expected_margin = EXCLUDED.expected_margin,
      margin_percent = EXCLUDED.margin_percent,
      score = EXCLUDED.score,
      label = EXCLUDED.label,
      raw_data = EXCLUDED.raw_data,
      last_seen = NOW(),
      run_id = EXCLUDED.run_id
    RETURNING (xmax = 0) AS inserted`,
    [
      candidate.id,
      candidate.modelId,
      candidate.listingId,
      candidate.itemUrl,
      candidate.title,
      candidate.query,
      candidate.priceAmount || null,
      candidate.priceCurrency || null,
      candidate.condition || null,
      candidate.sellerName || null,
      candidate.sellerAccountType || null,
      candidate.imageUrl || null,
      candidate.sourcePlatform || "ebay",
      candidate.listingFormat || "unknown",
      JSON.stringify(candidate.buyingOptions || []),
      candidate.itemEndDate || null,
      candidate.location || null,
      candidate.sourceQueryType || null,
      JSON.stringify(candidate.issueTerms),
      candidate.estimatedMarketValue || null,
      candidate.expectedMargin || null,
      candidate.marginPercent || null,
      candidate.score,
      candidate.label,
      JSON.stringify(candidate.rawData || {}),
      runId
    ]
  );
  return Boolean(rows[0]?.inserted);
}

export async function getMedianSoldPrice(modelIdValue: string): Promise<number | undefined> {
  const rows = await query<{ median: string | null }>(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY price_amount) AS median
     FROM market_sales ms
     JOIN walkman_models wm ON wm.id = ms.model_id
     WHERE ms.model_id = $1
       AND ms.price_amount IS NOT NULL
       AND ${modelTitleMatchSql("ms.title", "wm")}`,
    [modelIdValue]
  );
  return rows[0]?.median ? Number(rows[0].median) : undefined;
}

export async function getMedianActiveMarketPrice(modelIdValue: string): Promise<number | undefined> {
  const rows = await query<{ median: string | null }>(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY price_amount) AS median
     FROM market_listings ml
     JOIN walkman_models wm ON wm.id = ml.model_id
     WHERE ml.model_id = $1
       AND ml.price_amount IS NOT NULL
       AND ${freshListingSql("ml", DASHBOARD_LISTING_FRESHNESS_DAYS)}
       AND ${relevantMarketListingSql("ml.title", "ml.condition")}
       AND ${modelTitleMatchSql("ml.title", "wm")}`,
    [modelIdValue]
  );
  return rows[0]?.median ? Number(rows[0].median) : undefined;
}

export async function getDashboardDataFromDb(): Promise<DashboardData> {
  const [statsRows, topModels, candidates, runs] = await Promise.all([
    query<{
      model_count: string;
      valued_model_count: string;
      sales_count: string;
      market_listing_count: string;
      market_valued_model_count: string;
      candidate_count: string;
      hot_candidate_count: string;
      last_catalog_run: Date | null;
      last_ebay_run: Date | null;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM walkman_models)::text AS model_count,
        (SELECT COUNT(DISTINCT ml.model_id)
         FROM market_listings ml
         JOIN walkman_models wm ON wm.id = ml.model_id
         WHERE ml.price_amount IS NOT NULL
           AND ${freshListingSql("ml", DASHBOARD_LISTING_FRESHNESS_DAYS)}
           AND ${relevantMarketListingSql("ml.title", "ml.condition")}
           AND ${modelTitleMatchSql("ml.title", "wm")})::text AS valued_model_count,
        (SELECT COUNT(*) FROM market_sales)::text AS sales_count,
        (SELECT COUNT(*)
         FROM market_listings ml
         JOIN walkman_models wm ON wm.id = ml.model_id
         WHERE ${freshListingSql("ml", DASHBOARD_LISTING_FRESHNESS_DAYS)}
           AND ${relevantMarketListingSql("ml.title", "ml.condition")}
           AND ${modelTitleMatchSql("ml.title", "wm")})::text AS market_listing_count,
        (SELECT COUNT(DISTINCT ml.model_id)
         FROM market_listings ml
         JOIN walkman_models wm ON wm.id = ml.model_id
         WHERE ml.price_amount IS NOT NULL
           AND ${freshListingSql("ml", DASHBOARD_LISTING_FRESHNESS_DAYS)}
           AND ${relevantMarketListingSql("ml.title", "ml.condition")}
           AND ${modelTitleMatchSql("ml.title", "wm")})::text AS market_valued_model_count,
        (SELECT COUNT(*)
         FROM repair_candidates rc
         JOIN walkman_models wm ON wm.id = rc.model_id
         WHERE ${relevantTitleSql("rc.title")}
           AND ${freshListingSql("rc", DASHBOARD_LISTING_FRESHNESS_DAYS)}
           AND ${ACTIVE_REPAIR_SOURCE_RC_SQL}
           AND ${modelTitleMatchSql("rc.title", "wm")})::text AS candidate_count,
        (SELECT COUNT(*)
         FROM repair_candidates rc
         JOIN walkman_models wm ON wm.id = rc.model_id
         WHERE rc.label = 'hot'
           AND ${relevantTitleSql("rc.title")}
           AND ${freshListingSql("rc", DASHBOARD_LISTING_FRESHNESS_DAYS)}
           AND ${ACTIVE_REPAIR_SOURCE_RC_SQL}
           AND ${modelTitleMatchSql("rc.title", "wm")})::text AS hot_candidate_count,
        (SELECT MAX(started_at) FROM scan_runs WHERE run_type = 'catalog') AS last_catalog_run,
        (SELECT MAX(started_at) FROM scan_runs WHERE run_type IN ('ebay_sold', 'ebay_market', 'ebay_damaged', 'vinted_sourcing', 'vinted_fr_sourcing', 'kleinanzeigen_sourcing', 'wallapop_sourcing', 'monthly')) AS last_ebay_run
    `),
    listModelMarketSummaries(),
    listTopRepairCandidates(40),
    listScanRuns(12)
  ]);

  const stats = statsRows[0];
  return {
    generatedAt: new Date().toISOString(),
    stats: {
      modelCount: Number(stats?.model_count || 0),
      valuedModelCount: Number(stats?.valued_model_count || 0),
      salesCount: Number(stats?.sales_count || 0),
      marketListingCount: Number(stats?.market_listing_count || 0),
      marketValuedModelCount: Number(stats?.market_valued_model_count || 0),
      candidateCount: Number(stats?.candidate_count || 0),
      hotCandidateCount: Number(stats?.hot_candidate_count || 0),
      lastCatalogRun: stats?.last_catalog_run?.toISOString(),
      lastEbayRun: stats?.last_ebay_run?.toISOString()
    },
    topModels,
    candidates,
    runs,
    dataSource: "database"
  };
}

export async function listModelMarketSummaries(limit?: number): Promise<ModelMarketSummary[]> {
  const limitClause = typeof limit === "number" ? " LIMIT $1" : "";
  const rows = await query<DbSummary>(
    `WITH sale_summary AS (
       SELECT
         ms.model_id,
         COUNT(*)::text AS sales_count,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY ms.price_amount)::text AS median_sold_price,
         AVG(ms.price_amount)::text AS average_sold_price,
         MIN(ms.price_amount)::text AS min_sold_price,
         MAX(ms.price_amount)::text AS max_sold_price,
         MAX(ms.last_seen) AS last_sale_seen
       FROM market_sales ms
       JOIN walkman_models wm ON wm.id = ms.model_id
       WHERE ms.price_amount IS NOT NULL
         AND ${modelTitleMatchSql("ms.title", "wm")}
       GROUP BY ms.model_id
     ),
     active_summary AS (
       SELECT
         ml.model_id,
         COUNT(*)::text AS market_listing_count,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY ml.price_amount)::text AS median_active_price,
         AVG(ml.price_amount)::text AS average_active_price,
         MIN(ml.price_amount)::text AS min_active_price,
         MAX(ml.price_amount)::text AS max_active_price,
         COUNT(*) FILTER (WHERE ml.source_platform = 'ebay')::text AS ebay_market_listing_count,
         COUNT(*) FILTER (WHERE ml.source_platform = 'walkman_land')::text AS walkman_land_market_listing_count,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY ml.price_amount)
           FILTER (WHERE ml.source_platform = 'ebay')::text AS median_ebay_active_price,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY ml.price_amount)
           FILTER (WHERE ml.source_platform = 'walkman_land')::text AS median_walkman_land_active_price,
         COUNT(*) FILTER (WHERE ml.listing_format = 'fixed')::text AS fixed_market_listing_count,
         COUNT(*) FILTER (WHERE ml.listing_format = 'auction')::text AS auction_market_listing_count,
         COUNT(*) FILTER (WHERE ml.seller_account_type = 'private')::text AS private_market_listing_count,
         COUNT(*) FILTER (WHERE ml.seller_account_type = 'business')::text AS business_market_listing_count,
         MAX(ml.last_seen) AS last_market_listing_seen
       FROM market_listings ml
       JOIN walkman_models wm ON wm.id = ml.model_id
       WHERE ml.price_amount IS NOT NULL
         AND ${freshListingSql("ml", DASHBOARD_LISTING_FRESHNESS_DAYS)}
         AND ${relevantMarketListingSql("ml.title", "ml.condition")}
         AND ${modelTitleMatchSql("ml.title", "wm")}
       GROUP BY ml.model_id
     ),
     candidate_summary AS (
       SELECT
         rc.model_id,
         COUNT(*)::text AS candidate_count,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY rc.price_amount) FILTER (WHERE rc.price_amount IS NOT NULL)::text AS median_candidate_price,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY rc.price_amount)
           FILTER (WHERE rc.price_amount IS NOT NULL AND ${defectiveCandidateSql("rc")})::text AS median_defective_candidate_price,
         COUNT(*) FILTER (WHERE ${defectiveCandidateSql("rc")})::text AS defective_candidate_count,
         COUNT(*) FILTER (WHERE NOT (${defectiveCandidateSql("rc")}))::text AS unknown_candidate_count,
         AVG(rc.price_amount)::text AS average_candidate_price,
         MIN(rc.price_amount)::text AS min_candidate_price,
         MAX(rc.price_amount)::text AS max_candidate_price,
         COUNT(*) FILTER (WHERE rc.listing_format = 'fixed')::text AS fixed_candidate_count,
         COUNT(*) FILTER (WHERE rc.listing_format = 'auction')::text AS auction_candidate_count,
         COUNT(*) FILTER (WHERE rc.seller_account_type = 'private')::text AS private_candidate_count,
         COUNT(*) FILTER (WHERE rc.seller_account_type = 'business')::text AS business_candidate_count,
         COUNT(*) FILTER (WHERE rc.source_platform = 'ebay')::text AS ebay_candidate_count,
         COUNT(*) FILTER (WHERE rc.source_platform = 'vinted')::text AS vinted_candidate_count,
         COUNT(*) FILTER (WHERE rc.source_platform = 'vinted_fr')::text AS vinted_fr_candidate_count,
         COUNT(*) FILTER (WHERE rc.source_platform = 'kleinanzeigen')::text AS kleinanzeigen_candidate_count,
         COUNT(*) FILTER (WHERE rc.source_platform = 'wallapop')::text AS wallapop_candidate_count,
         MIN(rc.price_amount)::text AS best_candidate_price,
         MAX(rc.expected_margin)::text AS best_candidate_margin,
         MAX(rc.score) AS best_candidate_score,
         MAX(rc.last_seen) AS last_candidate_seen
       FROM repair_candidates rc
       JOIN walkman_models wm ON wm.id = rc.model_id
       WHERE ${relevantTitleSql("rc.title")}
         AND ${freshListingSql("rc", DASHBOARD_LISTING_FRESHNESS_DAYS)}
         AND ${ACTIVE_REPAIR_SOURCE_RC_SQL}
         AND ${modelTitleMatchSql("rc.title", "wm")}
       GROUP BY rc.model_id
     ),
     latest_platform_scan AS (
       SELECT DISTINCT ON (model_id, source_platform)
         model_id,
         source_platform,
         raw_result_count,
         candidate_count,
         status,
         error_message,
         scanned_at
       FROM platform_scan_results
       ORDER BY model_id, source_platform, scanned_at DESC
     )
     SELECT
       wm.*,
       COALESCE(ss.sales_count, '0') AS sales_count,
       ss.median_sold_price,
       ss.average_sold_price,
       ss.min_sold_price,
       ss.max_sold_price,
       COALESCE(active_summary.market_listing_count, '0') AS market_listing_count,
       active_summary.median_active_price,
       active_summary.average_active_price,
       active_summary.min_active_price,
       active_summary.max_active_price,
       COALESCE(active_summary.ebay_market_listing_count, '0') AS ebay_market_listing_count,
       COALESCE(active_summary.walkman_land_market_listing_count, '0') AS walkman_land_market_listing_count,
       active_summary.median_ebay_active_price,
       active_summary.median_walkman_land_active_price,
       COALESCE(active_summary.fixed_market_listing_count, '0') AS fixed_market_listing_count,
       COALESCE(active_summary.auction_market_listing_count, '0') AS auction_market_listing_count,
       COALESCE(active_summary.private_market_listing_count, '0') AS private_market_listing_count,
       COALESCE(active_summary.business_market_listing_count, '0') AS business_market_listing_count,
       COALESCE(cs.candidate_count, '0') AS candidate_count,
       cs.median_candidate_price,
       cs.median_defective_candidate_price,
       COALESCE(cs.defective_candidate_count, '0') AS defective_candidate_count,
       COALESCE(cs.unknown_candidate_count, '0') AS unknown_candidate_count,
       cs.average_candidate_price,
       cs.min_candidate_price,
       cs.max_candidate_price,
       COALESCE(cs.fixed_candidate_count, '0') AS fixed_candidate_count,
       COALESCE(cs.auction_candidate_count, '0') AS auction_candidate_count,
       COALESCE(cs.private_candidate_count, '0') AS private_candidate_count,
       COALESCE(cs.business_candidate_count, '0') AS business_candidate_count,
       COALESCE(cs.ebay_candidate_count, '0') AS ebay_candidate_count,
       COALESCE(cs.vinted_candidate_count, '0') AS vinted_candidate_count,
       COALESCE(cs.vinted_fr_candidate_count, '0') AS vinted_fr_candidate_count,
       COALESCE(cs.kleinanzeigen_candidate_count, '0') AS kleinanzeigen_candidate_count,
       COALESCE(cs.wallapop_candidate_count, '0') AS wallapop_candidate_count,
       vinted_scan.raw_result_count::text AS vinted_raw_result_count,
       vinted_scan.candidate_count::text AS vinted_scan_candidate_count,
       vinted_scan.status AS vinted_scan_status,
       vinted_scan.error_message AS vinted_scan_error_message,
       vinted_scan.scanned_at AS vinted_scanned_at,
       vinted_fr_scan.raw_result_count::text AS vinted_fr_raw_result_count,
       vinted_fr_scan.candidate_count::text AS vinted_fr_scan_candidate_count,
       vinted_fr_scan.status AS vinted_fr_scan_status,
       vinted_fr_scan.error_message AS vinted_fr_scan_error_message,
       vinted_fr_scan.scanned_at AS vinted_fr_scanned_at,
       kleinanzeigen_scan.raw_result_count::text AS kleinanzeigen_raw_result_count,
       kleinanzeigen_scan.candidate_count::text AS kleinanzeigen_scan_candidate_count,
       kleinanzeigen_scan.status AS kleinanzeigen_scan_status,
       kleinanzeigen_scan.error_message AS kleinanzeigen_scan_error_message,
       kleinanzeigen_scan.scanned_at AS kleinanzeigen_scanned_at,
       wallapop_scan.raw_result_count::text AS wallapop_raw_result_count,
       wallapop_scan.candidate_count::text AS wallapop_scan_candidate_count,
       wallapop_scan.status AS wallapop_scan_status,
       wallapop_scan.error_message AS wallapop_scan_error_message,
       wallapop_scan.scanned_at AS wallapop_scanned_at,
       cs.best_candidate_price,
       cs.best_candidate_margin,
       cs.best_candidate_score,
       ss.last_sale_seen,
       active_summary.last_market_listing_seen,
       cs.last_candidate_seen
     FROM walkman_models wm
     LEFT JOIN sale_summary ss ON ss.model_id = wm.id
     LEFT JOIN active_summary ON active_summary.model_id = wm.id
     LEFT JOIN candidate_summary cs ON cs.model_id = wm.id
     LEFT JOIN latest_platform_scan vinted_scan ON vinted_scan.model_id = wm.id AND vinted_scan.source_platform = 'vinted'
     LEFT JOIN latest_platform_scan vinted_fr_scan ON vinted_fr_scan.model_id = wm.id AND vinted_fr_scan.source_platform = 'vinted_fr'
     LEFT JOIN latest_platform_scan kleinanzeigen_scan ON kleinanzeigen_scan.model_id = wm.id AND kleinanzeigen_scan.source_platform = 'kleinanzeigen'
     LEFT JOIN latest_platform_scan wallapop_scan ON wallapop_scan.model_id = wm.id AND wallapop_scan.source_platform = 'wallapop'
     ORDER BY wm.name ASC${limitClause}`,
    typeof limit === "number" ? [limit] : []
  );
  return attachSummaryLinks(rows.map(mapSummary));
}

export async function listTopRepairCandidates(limit = 50): Promise<DashboardData["candidates"]> {
  const queryLimit = Math.max(limit * 20, 1000);
  const rows = await query<DbCandidate>(
    `WITH sold_medians AS (
       SELECT ms.model_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY ms.price_amount)::text AS median_sold_price
       FROM market_sales ms
       JOIN walkman_models wm ON wm.id = ms.model_id
       WHERE ms.price_amount IS NOT NULL
         AND ${modelTitleMatchSql("ms.title", "wm")}
       GROUP BY ms.model_id
     ),
     active_medians AS (
       SELECT
         ml.model_id,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY ml.price_amount)::text AS median_active_price,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY ml.price_amount)
           FILTER (WHERE ml.source_platform = 'ebay')::text AS median_ebay_active_price,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY ml.price_amount)
           FILTER (WHERE ml.source_platform = 'walkman_land')::text AS median_walkman_land_active_price
       FROM market_listings ml
       JOIN walkman_models wm ON wm.id = ml.model_id
       WHERE ml.price_amount IS NOT NULL
         AND ${freshListingSql("ml", DASHBOARD_LISTING_FRESHNESS_DAYS)}
         AND ${relevantMarketListingSql("ml.title", "ml.condition")}
         AND ${modelTitleMatchSql("ml.title", "wm")}
       GROUP BY ml.model_id
     )
     SELECT
       rc.*,
       wm.name AS model_name,
       wm.maker,
       sold_medians.median_sold_price,
       active_medians.median_active_price,
       active_medians.median_ebay_active_price,
       active_medians.median_walkman_land_active_price
     FROM repair_candidates rc
     JOIN walkman_models wm ON wm.id = rc.model_id
     LEFT JOIN sold_medians ON sold_medians.model_id = rc.model_id
     LEFT JOIN active_medians ON active_medians.model_id = rc.model_id
     WHERE ${relevantTitleSql("rc.title")}
       AND ${freshListingSql("rc", TOP_DEAL_FRESHNESS_DAYS)}
       AND ${ACTIVE_REPAIR_SOURCE_RC_SQL}
       AND ${modelTitleMatchSql("rc.title", "wm")}
     ORDER BY rc.score DESC, rc.expected_margin DESC NULLS LAST, rc.last_seen DESC
     LIMIT $1`,
    [queryLimit]
  );
  const candidates = rows.map((row) => recalculateCandidateMarketMetrics({
    ...mapCandidate(row),
    modelName: row.model_name || "Unknown model",
    maker: row.maker || undefined,
    medianSoldPrice: row.median_sold_price ? Number(row.median_sold_price) : undefined,
    medianActivePrice: row.median_active_price ? Number(row.median_active_price) : undefined,
    medianEbayActivePrice: row.median_ebay_active_price ? Number(row.median_ebay_active_price) : undefined,
    medianWalkmanLandActivePrice: row.median_walkman_land_active_price ? Number(row.median_walkman_land_active_price) : undefined,
    ebayActiveSearchUrl: ebayActiveSearchUrl(row.model_name || ""),
    marketLinks: [] as ListingLink[],
    candidateLinks: [] as ListingLink[]
  })).sort((left, right) => (
    right.score - left.score
    || (right.expectedMargin || Number.NEGATIVE_INFINITY) - (left.expectedMargin || Number.NEGATIVE_INFINITY)
    || (left.priceAmount || Number.POSITIVE_INFINITY) - (right.priceAmount || Number.POSITIVE_INFINITY)
  )).slice(0, limit);
  const modelIds = [...new Set(candidates.map((candidate) => candidate.modelId))];
  const [linksByModel, candidateLinksByModel] = await Promise.all([
    listMarketLinksForModels(modelIds, 3),
    listCandidateLinksForModels(modelIds, 16)
  ]);
  return candidates.map((candidate) => ({
    ...candidate,
    marketLinks: linksByModel.get(candidate.modelId) || [],
    candidateLinks: candidateLinksByModel.get(candidate.modelId) || []
  }));
}

function recalculateCandidateMarketMetrics(candidate: DashboardData["candidates"][number]): DashboardData["candidates"][number] {
  const marketValue = candidate.medianActivePrice;
  const acquisitionPrice = candidate.priceAmount;
  const hasRepairTerms = candidate.issueTerms.length > 0 || candidate.sourceQueryType === "defect-title";
  const effectiveCost = hasRepairTerms
    ? Number(process.env.DEFAULT_REPAIR_COST_EUR || 25)
    : Number(process.env.DEFAULT_TRADE_COST_EUR || 10);
  const expectedNetSale = marketValue ? marketValue * 0.82 : undefined;
  const expectedMargin = expectedNetSale && acquisitionPrice
    ? roundMoney(expectedNetSale - acquisitionPrice - effectiveCost)
    : undefined;
  const marginPercent = expectedMargin && acquisitionPrice
    ? Math.round((expectedMargin / acquisitionPrice) * 100)
    : undefined;
  const isPricePotential = Boolean(
    marketValue
    && acquisitionPrice
    && acquisitionPrice <= marketValue * Number(process.env.PLATFORM_SOURCE_MAX_MARKET_RATIO || 0.7)
  );
  const score = recalculateCandidateScore({
    hasRepairTerms,
    isPricePotential,
    marketValue,
    acquisitionPrice,
    expectedMargin,
    marginPercent
  });

  return {
    ...candidate,
    estimatedMarketValue: marketValue,
    expectedMargin,
    marginPercent,
    score,
    label: labelForRecalculatedScore(score, marketValue)
  };
}

function recalculateCandidateScore(input: {
  hasRepairTerms: boolean;
  isPricePotential: boolean;
  marketValue?: number;
  acquisitionPrice?: number;
  expectedMargin?: number;
  marginPercent?: number;
}): number {
  let score = 20;
  if (input.hasRepairTerms) score += 15;
  if (input.isPricePotential) score += 15;
  if ((input.marketValue || 0) >= 120) score += 10;
  if ((input.marketValue || 0) >= 250) score += 10;
  if ((input.expectedMargin || 0) >= 40) score += 20;
  if ((input.expectedMargin || 0) >= 100) score += 15;
  if ((input.marginPercent || 0) >= 60) score += 10;
  if (!input.marketValue) score -= 15;
  if (!input.acquisitionPrice) score -= 10;
  return Math.max(0, Math.min(100, score));
}

function labelForRecalculatedScore(score: number, marketValue?: number): RepairCandidate["label"] {
  if (!marketValue) return "unknown";
  if (score >= 75) return "hot";
  if (score >= 50) return "watch";
  return "thin";
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function listScanRuns(limit = 20): Promise<ScanRun[]> {
  const rows = await query<DbScanRun>(
    `SELECT *
     FROM scan_runs
     WHERE run_type <> 'leboncoin_sourcing'
     ORDER BY started_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map(mapRun);
}

function mapRun(row: DbScanRun): ScanRun {
  return {
    id: row.id,
    runType: row.run_type,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at?.toISOString(),
    status: row.status,
    modelsFound: row.models_found,
    modelsSaved: row.models_saved,
    salesFound: row.sales_found,
    salesSaved: row.sales_saved,
    marketListingsFound: row.market_listings_found,
    marketListingsSaved: row.market_listings_saved,
    candidatesFound: row.candidates_found,
    candidatesSaved: row.candidates_saved,
    errors: row.errors || []
  };
}

function mapModel(row: DbWalkmanModel): WalkmanModel {
  return {
    id: row.id,
    name: row.name,
    maker: row.maker || undefined,
    modelCode: row.model_code || undefined,
    catalogUrl: row.catalog_url || undefined,
    catalogImageUrl: row.catalog_image_url || undefined,
    catalogPage: row.catalog_page || undefined,
    year: row.year || undefined,
    description: row.description || undefined,
    firstSeen: row.first_seen.toISOString(),
    lastSeen: row.last_seen.toISOString()
  };
}

function mapSummary(row: DbSummary): ModelMarketSummary {
  return {
    ...mapModel(row),
    salesCount: Number(row.sales_count || 0),
    medianSoldPrice: numberOrUndefined(row.median_sold_price),
    averageSoldPrice: numberOrUndefined(row.average_sold_price),
    minSoldPrice: numberOrUndefined(row.min_sold_price),
    maxSoldPrice: numberOrUndefined(row.max_sold_price),
    marketListingCount: Number(row.market_listing_count || 0),
    medianActivePrice: numberOrUndefined(row.median_active_price),
    averageActivePrice: numberOrUndefined(row.average_active_price),
    minActivePrice: numberOrUndefined(row.min_active_price),
    maxActivePrice: numberOrUndefined(row.max_active_price),
    ebayMarketListingCount: Number(row.ebay_market_listing_count || 0),
    walkmanLandMarketListingCount: Number(row.walkman_land_market_listing_count || 0),
    medianEbayActivePrice: numberOrUndefined(row.median_ebay_active_price),
    medianWalkmanLandActivePrice: numberOrUndefined(row.median_walkman_land_active_price),
    fixedMarketListingCount: Number(row.fixed_market_listing_count || 0),
    auctionMarketListingCount: Number(row.auction_market_listing_count || 0),
    privateMarketListingCount: Number(row.private_market_listing_count || 0),
    businessMarketListingCount: Number(row.business_market_listing_count || 0),
    candidateCount: Number(row.candidate_count || 0),
    medianCandidatePrice: numberOrUndefined(row.median_candidate_price),
    medianDefectiveCandidatePrice: numberOrUndefined(row.median_defective_candidate_price),
    defectiveCandidateCount: Number(row.defective_candidate_count || 0),
    unknownCandidateCount: Number(row.unknown_candidate_count || 0),
    averageCandidatePrice: numberOrUndefined(row.average_candidate_price),
    minCandidatePrice: numberOrUndefined(row.min_candidate_price),
    maxCandidatePrice: numberOrUndefined(row.max_candidate_price),
    fixedCandidateCount: Number(row.fixed_candidate_count || 0),
    auctionCandidateCount: Number(row.auction_candidate_count || 0),
    privateCandidateCount: Number(row.private_candidate_count || 0),
    businessCandidateCount: Number(row.business_candidate_count || 0),
    ebayCandidateCount: Number(row.ebay_candidate_count || 0),
    vintedCandidateCount: Number(row.vinted_candidate_count || 0),
    vintedFrCandidateCount: Number(row.vinted_fr_candidate_count || 0),
    kleinanzeigenCandidateCount: Number(row.kleinanzeigen_candidate_count || 0),
    wallapopCandidateCount: Number(row.wallapop_candidate_count || 0),
    vintedLastScan: mapPlatformScanSnapshot(
      row.vinted_raw_result_count,
      row.vinted_scan_candidate_count,
      row.vinted_scan_status,
      row.vinted_scan_error_message,
      row.vinted_scanned_at
    ),
    vintedFrLastScan: mapPlatformScanSnapshot(
      row.vinted_fr_raw_result_count,
      row.vinted_fr_scan_candidate_count,
      row.vinted_fr_scan_status,
      row.vinted_fr_scan_error_message,
      row.vinted_fr_scanned_at
    ),
    kleinanzeigenLastScan: mapPlatformScanSnapshot(
      row.kleinanzeigen_raw_result_count,
      row.kleinanzeigen_scan_candidate_count,
      row.kleinanzeigen_scan_status,
      row.kleinanzeigen_scan_error_message,
      row.kleinanzeigen_scanned_at
    ),
    wallapopLastScan: mapPlatformScanSnapshot(
      row.wallapop_raw_result_count,
      row.wallapop_scan_candidate_count,
      row.wallapop_scan_status,
      row.wallapop_scan_error_message,
      row.wallapop_scanned_at
    ),
    bestCandidatePrice: numberOrUndefined(row.best_candidate_price),
    bestCandidateMargin: numberOrUndefined(row.best_candidate_margin),
    bestCandidateScore: row.best_candidate_score ?? undefined,
    lastSaleSeen: row.last_sale_seen?.toISOString(),
    lastMarketListingSeen: row.last_market_listing_seen?.toISOString(),
    lastCandidateSeen: row.last_candidate_seen?.toISOString(),
    ebaySoldResearchUrl: ebaySoldResearchUrl(row.name),
    ebayActiveSearchUrl: ebayActiveSearchUrl(row.name),
    ebayDamagedSearchUrl: ebayDamagedSearchUrl(row.name),
    marketLinks: [],
    candidateLinks: []
  };
}

function mapPlatformScanSnapshot(
  rawResultCount: string | null,
  candidateCount: string | null,
  status: PlatformScanSnapshot["status"] | null,
  errorMessage: string | null,
  scannedAt: Date | null
): PlatformScanSnapshot | undefined {
  if (!status || !scannedAt) return undefined;
  return {
    rawResultCount: Number(rawResultCount || 0),
    candidateCount: Number(candidateCount || 0),
    status,
    errorMessage: errorMessage || undefined,
    scannedAt: scannedAt.toISOString()
  };
}

function mapCandidate(row: DbCandidate): RepairCandidate {
  return {
    id: row.id,
    modelId: row.model_id,
    listingId: row.listing_id,
    itemUrl: row.listing_url,
    title: row.title,
    query: row.query,
    priceAmount: numberOrUndefined(row.price_amount),
    priceCurrency: row.price_currency || undefined,
    condition: row.condition || undefined,
    sellerName: row.seller_name || undefined,
    sellerAccountType: row.seller_account_type || undefined,
    imageUrl: row.image_url || undefined,
    sourcePlatform: row.source_platform || "ebay",
    listingFormat: row.listing_format || "unknown",
    buyingOptions: row.buying_options || [],
    itemEndDate: row.item_end_date?.toISOString(),
    location: row.location || undefined,
    sourceQueryType: row.source_query_type || undefined,
    issueTerms: row.issue_terms || [],
    observedAt: row.last_seen.toISOString(),
    estimatedMarketValue: numberOrUndefined(row.estimated_market_value),
    expectedMargin: numberOrUndefined(row.expected_margin),
    marginPercent: numberOrUndefined(row.margin_percent),
    score: row.score,
    label: row.label,
    conditionBucket: classifyListingCondition({
      title: row.title,
      condition: row.condition || undefined,
      sourceQueryType: row.source_query_type || undefined,
      issueTerms: row.issue_terms || []
    }),
    rawData: row.raw_data || {}
  };
}

async function attachSummaryLinks(summaries: ModelMarketSummary[]): Promise<ModelMarketSummary[]> {
  const modelIds = summaries.map((summary) => summary.id);
  const [marketLinksByModel, candidateLinksByModel] = await Promise.all([
    listMarketLinksForModels(modelIds, 5),
    listCandidateLinksForModels(modelIds, 4)
  ]);

  return summaries.map((summary) => ({
    ...summary,
    marketLinks: marketLinksByModel.get(summary.id) || [],
    candidateLinks: candidateLinksByModel.get(summary.id) || []
  }));
}

async function listMarketLinksForModels(modelIds: string[], limitPerModel: number): Promise<Map<string, ListingLink[]>> {
  if (!modelIds.length) return new Map();
  const rows = await query<DbListingLink>(
    `WITH ranked AS (
       SELECT
         'market' AS link_kind,
         ml.model_id,
         ml.title,
         ml.item_url,
         ml.price_amount,
         ml.price_currency,
         ml.image_url,
         ml.source_platform,
         ml.listing_format,
         ml.seller_account_type,
         ml.condition,
         ml.source_query_type,
         NULL::jsonb AS issue_terms,
         ROW_NUMBER() OVER (
           PARTITION BY ml.model_id, ml.source_platform
           ORDER BY ml.price_amount ASC NULLS LAST, ml.last_seen DESC
         ) AS rank
       FROM market_listings ml
       JOIN walkman_models wm ON wm.id = ml.model_id
       WHERE ml.model_id = ANY($1::text[])
         AND ${freshListingSql("ml", DASHBOARD_LISTING_FRESHNESS_DAYS)}
         AND (${relevantMarketListingSql("ml.title", "ml.condition")} OR ml.source_platform = 'walkman_land')
         AND ${modelTitleMatchSql("ml.title", "wm")}
     )
     SELECT *
     FROM ranked
     WHERE rank <= $2
     ORDER BY model_id, rank`,
    [modelIds, limitPerModel]
  );
  return groupLinks(rows);
}

async function listCandidateLinksForModels(modelIds: string[], limitPerModel: number): Promise<Map<string, ListingLink[]>> {
  if (!modelIds.length) return new Map();
  const rows = await query<DbListingLink>(
    `WITH ranked AS (
       SELECT
         'candidate' AS link_kind,
         rc.model_id,
         rc.title,
         rc.listing_url AS item_url,
         rc.price_amount,
         rc.price_currency,
         rc.image_url,
         rc.source_platform,
         rc.listing_format,
         rc.seller_account_type,
         rc.condition,
         rc.source_query_type,
         rc.issue_terms,
         ROW_NUMBER() OVER (
           PARTITION BY rc.model_id
           ORDER BY rc.score DESC, rc.expected_margin DESC NULLS LAST, rc.price_amount ASC NULLS LAST, rc.last_seen DESC
         ) AS rank
       FROM repair_candidates rc
       JOIN walkman_models wm ON wm.id = rc.model_id
       WHERE rc.model_id = ANY($1::text[])
         AND ${relevantTitleSql("rc.title")}
         AND ${freshListingSql("rc", DASHBOARD_LISTING_FRESHNESS_DAYS)}
         AND ${ACTIVE_REPAIR_SOURCE_RC_SQL}
         AND ${modelTitleMatchSql("rc.title", "wm")}
     )
     SELECT *
     FROM ranked
     WHERE rank <= $2
     ORDER BY model_id, rank`,
    [modelIds, limitPerModel]
  );
  return groupLinks(rows);
}

function groupLinks(rows: DbListingLink[]): Map<string, ListingLink[]> {
  const grouped = new Map<string, ListingLink[]>();
  for (const row of rows) {
    const links = grouped.get(row.model_id) || [];
    links.push(mapListingLink(row));
    grouped.set(row.model_id, links);
  }
  return grouped;
}

function mapListingLink(row: DbListingLink): ListingLink {
  return {
    title: row.title,
    itemUrl: row.item_url,
    priceAmount: numberOrUndefined(row.price_amount),
    priceCurrency: row.price_currency || undefined,
    imageUrl: row.image_url || undefined,
    sourcePlatform: row.source_platform || "ebay",
    listingFormat: row.listing_format || "unknown",
    conditionBucket: classifyListingCondition({
      title: row.title,
      condition: row.condition || undefined,
      sourceQueryType: row.source_query_type || undefined,
      issueTerms: row.issue_terms || [],
      assumedFunctional: row.link_kind === "market"
    }),
    sellerAccountType: row.seller_account_type || undefined,
    condition: row.condition || undefined
  };
}

function relevantMarketListingSql(titleColumn: string, conditionColumn: string): string {
  return `(${relevantTitleSql(titleColumn)}) AND NOT (${defectListingSql(titleColumn, conditionColumn)})`;
}

function defectListingSql(titleColumn: string, conditionColumn: string): string {
  const value = `LOWER(COALESCE(${titleColumn}, '') || ' ' || COALESCE(${conditionColumn}, ''))`;
  const terms = [
    "defekt",
    "defekte",
    "bastler",
    "ersatzteil",
    "ersatzteile",
    "not working",
    "nicht funktionsfaehig",
    "nicht funktionsfähig",
    "nicht funktionsfÃ¤hig",
    "funktioniert nicht",
    "ohne funktion",
    "geht nicht",
    "kaputt",
    "for parts",
    "parts only",
    "broken",
    "defective",
    "ungetestet",
    "untested",
    "kein ton",
    "spielt nicht",
    "reparatur",
    "pour pieces",
    "pour pièces",
    "pour piÃ¨ces",
    "pieces detachees",
    "pièces détachées",
    "piÃ¨ces dÃ©tachÃ©es",
    "ne fonctionne",
    "non fonctionnel",
    "non fonctionnelle",
    "pour reparation",
    "a reparer",
    "en panne",
    "hors service",
    "averiado",
    "averiada",
    "no funciona",
    "sin funcionar",
    "para piezas",
    "repuestos",
    "roto",
    "rota",
    "estropeado",
    "estropeada",
    "pezzi di ricambio",
    "pezzi ricambio",
    "parti di ricambio",
    "ricambi",
    "da riparare",
    "per riparazione",
    "needs repair",
    "as is",
    "junk",
    "non funziona",
    "non funzionante",
    "guasto",
    "guasta",
    "rotto",
    "rotta",
    "difettoso",
    "difettosa",
    "per parti",
    "per parti di ricambio",
    "pour réparation",
    "pour rÃ©paration"
  ];
  return terms.map((term) => `${value} LIKE '%${term}%'`).join(" OR ");
}

function relevantTitleSql(column: string): string {
  const value = `LOWER(COALESCE(${column}, ''))`;
  const documentation = [
    "service manual",
    "repair manual",
    "user manual",
    "owners manual",
    "owner manual",
    "bedienungsanleitung",
    "anleitung",
    "schaltplan",
    "schematic",
    "wartung",
    "manuel",
    "mode d emploi",
    "manual de servicio"
  ];
  const accessoryTerms = [
    "riemen",
    "belt",
    "fett",
    "ol",
    "oel",
    "öl",
    "oil",
    "grease",
    "gummi",
    "rubber",
    "kit",
    "kabel",
    "cable",
    "tasche",
    "case",
    "huelle",
    "hülle",
    "remote",
    "fernbedienung",
    "akku",
    "battery",
    "cover",
    "andruckrolle",
    "pinch roller",
    "capstan",
    "gear",
    "zahnrad",
    "kopfhörer",
    "kopfhoerer",
    "headphone",
    "earphone",
    "correa",
    "courroie",
    "funda",
    "housse"
  ];
  const connectors = [" für ", " fuer ", " fur ", " for ", " fits ", " compatible ", " passend ", " pour ", " per ", " para "];
  const nonAuthenticTerms = ["clone", "clon", "replica", "replika", "replik", "reproduction", "reproduktion", "repro", "nachbau", "lookalike"];
  const docSql = documentation.map((term) => `${value} LIKE '%${term}%'`).join(" OR ");
  const nonAuthenticSql = nonAuthenticTerms.map((term) => `${value} LIKE '%${term}%'`).join(" OR ");
  const startsSql = accessoryTerms.map((term) => `${value} LIKE '${term} %' OR ${value} = '${term}'`).join(" OR ");
  const termSql = accessoryTerms.map((term) => `${value} LIKE '%${term}%'`).join(" OR ");
  const connectorSql = connectors.map((term) => `${value} LIKE '%${term}%'`).join(" OR ");
  return `NOT ((${docSql}) OR (${nonAuthenticSql}) OR (${startsSql}) OR ((${termSql}) AND (${connectorSql})))`;
}

function numberOrUndefined(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function ebaySoldResearchUrl(modelName: string): string {
  const url = new URL("https://www.ebay.de/sh/research");
  url.searchParams.set("categoryId", "0");
  url.searchParams.set("dayRange", "365");
  url.searchParams.set("keywords", `${modelName} walkman`);
  url.searchParams.set("limit", "50");
  url.searchParams.set("marketplace", "EBAY-DE");
  url.searchParams.set("offset", "0");
  url.searchParams.set("tabName", "SOLD");
  url.searchParams.set("tz", "Europe/Berlin");
  return url.toString();
}

function ebayActiveSearchUrl(modelName: string): string {
  const url = new URL("https://www.ebay.de/sch/i.html");
  url.searchParams.set("_nkw", `${modelName} walkman`);
  url.searchParams.set("_sop", "10");
  url.searchParams.set("LH_BIN", "1");
  return url.toString();
}

function ebayDamagedSearchUrl(modelName: string): string {
  const url = new URL("https://www.ebay.de/sch/i.html");
  url.searchParams.set("_nkw", `${modelName} walkman defekt`);
  url.searchParams.set("_sop", "10");
  return url.toString();
}
