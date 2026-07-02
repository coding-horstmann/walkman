import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool(): pg.Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 5),
      ssl: readSslConfig()
    });
  }

  return pool;
}

export async function query<T>(sql: string, values: unknown[] = []): Promise<T[]> {
  const result = await getPool().query(sql, values);
  return result.rows as T[];
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}

function readSslConfig(): pg.PoolConfig["ssl"] {
  if (process.env.PGSSLMODE === "disable") return false;
  if (process.env.DATABASE_URL?.includes("railway.internal")) return false;
  return process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined;
}
