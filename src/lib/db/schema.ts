import { getPool } from "@/lib/db/client";

let schemaReady: Promise<void> | null = null;

export async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = createSchema().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  return schemaReady;
}

async function createSchema(): Promise<void> {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [45010917]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS scan_runs (
        id TEXT PRIMARY KEY,
        run_type TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        finished_at TIMESTAMPTZ,
        status TEXT NOT NULL,
        models_found INTEGER NOT NULL DEFAULT 0,
        models_saved INTEGER NOT NULL DEFAULT 0,
        sales_found INTEGER NOT NULL DEFAULT 0,
        sales_saved INTEGER NOT NULL DEFAULT 0,
        market_listings_found INTEGER NOT NULL DEFAULT 0,
        market_listings_saved INTEGER NOT NULL DEFAULT 0,
        candidates_found INTEGER NOT NULL DEFAULT 0,
        candidates_saved INTEGER NOT NULL DEFAULT 0,
        errors JSONB NOT NULL DEFAULT '[]'::jsonb
      )
    `);

    await client.query(`ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS market_listings_found INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS market_listings_saved INTEGER NOT NULL DEFAULT 0`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS walkman_models (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        maker TEXT,
        model_code TEXT,
        catalog_url TEXT UNIQUE,
        catalog_image_url TEXT,
        catalog_page INTEGER,
        year INTEGER,
        description TEXT,
        first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_catalog_run_id TEXT REFERENCES scan_runs(id)
      )
    `);

    await client.query(`ALTER TABLE walkman_models ADD COLUMN IF NOT EXISTS catalog_image_url TEXT`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS market_sales (
        id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL REFERENCES walkman_models(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        listing_id TEXT NOT NULL,
        item_url TEXT NOT NULL,
        title TEXT NOT NULL,
        price_amount NUMERIC,
        price_currency TEXT,
        sold_at TIMESTAMPTZ,
        condition TEXT,
        seller_name TEXT,
        seller_account_type TEXT,
        image_url TEXT,
        source_platform TEXT NOT NULL DEFAULT 'ebay',
        listing_format TEXT NOT NULL DEFAULT 'unknown',
        buying_options JSONB NOT NULL DEFAULT '[]'::jsonb,
        item_end_date TIMESTAMPTZ,
        location TEXT,
        raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        run_id TEXT REFERENCES scan_runs(id),
        UNIQUE(source, listing_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS market_listings (
        id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL REFERENCES walkman_models(id) ON DELETE CASCADE,
        listing_id TEXT NOT NULL,
        item_url TEXT NOT NULL,
        title TEXT NOT NULL,
        query TEXT NOT NULL,
        price_amount NUMERIC,
        price_currency TEXT,
        condition TEXT,
        seller_name TEXT,
        seller_account_type TEXT,
        image_url TEXT,
        source_platform TEXT NOT NULL DEFAULT 'ebay',
        listing_format TEXT NOT NULL DEFAULT 'unknown',
        buying_options JSONB NOT NULL DEFAULT '[]'::jsonb,
        item_end_date TIMESTAMPTZ,
        location TEXT,
        source_query_type TEXT,
        raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        run_id TEXT REFERENCES scan_runs(id),
        UNIQUE(item_url)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS repair_candidates (
        id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL REFERENCES walkman_models(id) ON DELETE CASCADE,
        listing_id TEXT NOT NULL,
        listing_url TEXT NOT NULL,
        title TEXT NOT NULL,
        query TEXT NOT NULL,
        price_amount NUMERIC,
        price_currency TEXT,
        condition TEXT,
        seller_name TEXT,
        seller_account_type TEXT,
        image_url TEXT,
        source_platform TEXT NOT NULL DEFAULT 'ebay',
        listing_format TEXT NOT NULL DEFAULT 'unknown',
        buying_options JSONB NOT NULL DEFAULT '[]'::jsonb,
        item_end_date TIMESTAMPTZ,
        location TEXT,
        source_query_type TEXT,
        issue_terms JSONB NOT NULL DEFAULT '[]'::jsonb,
        estimated_market_value NUMERIC,
        expected_margin NUMERIC,
        margin_percent NUMERIC,
        score INTEGER NOT NULL,
        label TEXT NOT NULL,
        raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        run_id TEXT REFERENCES scan_runs(id),
        UNIQUE(listing_url)
      )
    `);

    await client.query(`ALTER TABLE market_sales ADD COLUMN IF NOT EXISTS seller_account_type TEXT`);
    await client.query(`ALTER TABLE market_sales ADD COLUMN IF NOT EXISTS source_platform TEXT NOT NULL DEFAULT 'ebay'`);
    await client.query(`ALTER TABLE market_sales ADD COLUMN IF NOT EXISTS listing_format TEXT NOT NULL DEFAULT 'unknown'`);
    await client.query(`ALTER TABLE market_sales ADD COLUMN IF NOT EXISTS buying_options JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await client.query(`ALTER TABLE market_sales ADD COLUMN IF NOT EXISTS item_end_date TIMESTAMPTZ`);
    await client.query(`ALTER TABLE market_sales ADD COLUMN IF NOT EXISTS location TEXT`);

    await client.query(`ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS seller_account_type TEXT`);
    await client.query(`ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS source_platform TEXT NOT NULL DEFAULT 'ebay'`);
    await client.query(`ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS listing_format TEXT NOT NULL DEFAULT 'unknown'`);
    await client.query(`ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS buying_options JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await client.query(`ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS item_end_date TIMESTAMPTZ`);
    await client.query(`ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS location TEXT`);
    await client.query(`ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS source_query_type TEXT`);
    await client.query(`ALTER TABLE market_listings DROP CONSTRAINT IF EXISTS market_listings_item_url_key`);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'market_listings_source_platform_item_url_key'
        ) THEN
          ALTER TABLE market_listings
          ADD CONSTRAINT market_listings_source_platform_item_url_key
          UNIQUE (source_platform, item_url);
        END IF;
      END $$;
    `);

    await client.query(`ALTER TABLE repair_candidates ADD COLUMN IF NOT EXISTS seller_account_type TEXT`);
    await client.query(`ALTER TABLE repair_candidates ADD COLUMN IF NOT EXISTS source_platform TEXT NOT NULL DEFAULT 'ebay'`);
    await client.query(`ALTER TABLE repair_candidates ADD COLUMN IF NOT EXISTS listing_format TEXT NOT NULL DEFAULT 'unknown'`);
    await client.query(`ALTER TABLE repair_candidates ADD COLUMN IF NOT EXISTS buying_options JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await client.query(`ALTER TABLE repair_candidates ADD COLUMN IF NOT EXISTS item_end_date TIMESTAMPTZ`);
    await client.query(`ALTER TABLE repair_candidates ADD COLUMN IF NOT EXISTS location TEXT`);
    await client.query(`ALTER TABLE repair_candidates ADD COLUMN IF NOT EXISTS source_query_type TEXT`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS platform_scan_results (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL REFERENCES walkman_models(id) ON DELETE CASCADE,
        source_platform TEXT NOT NULL,
        query TEXT NOT NULL,
        raw_result_count INTEGER NOT NULL DEFAULT 0,
        candidate_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        error_message TEXT,
        scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(run_id, model_id, source_platform)
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_walkman_models_maker ON walkman_models(maker)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_walkman_models_last_seen ON walkman_models(last_seen DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_market_sales_model ON market_sales(model_id, sold_at DESC NULLS LAST)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_market_sales_price ON market_sales(price_amount)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_market_listings_model ON market_listings(model_id, last_seen DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_market_listings_price ON market_listings(price_amount)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_market_listings_platform ON market_listings(source_platform, listing_format, seller_account_type)`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_market_listings_source_url ON market_listings(source_platform, item_url)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_repair_candidates_score ON repair_candidates(score DESC, last_seen DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_repair_candidates_model ON repair_candidates(model_id, score DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_repair_candidates_platform ON repair_candidates(source_platform, listing_format, seller_account_type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_scan_runs_started ON scan_runs(started_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_platform_scan_results_model ON platform_scan_results(model_id, source_platform, scanned_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_platform_scan_results_run ON platform_scan_results(run_id, source_platform)`);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
