import { hasDatabaseUrl } from "@/lib/db/client";
import { ensureSchema } from "@/lib/db/schema";
import { getDashboardDataFromDb } from "@/lib/db/repository";
import { readApiHeaders } from "@/lib/api-auth";
import type { DashboardData } from "@/lib/types";

export async function getDashboardData(): Promise<DashboardData> {
  if (process.env.DATA_API_BASE_URL) {
    return getDashboardDataFromApi(process.env.DATA_API_BASE_URL);
  }

  if (hasDatabaseUrl()) {
    await ensureSchema();
    return getDashboardDataFromDb();
  }

  return emptyDashboard();
}

async function getDashboardDataFromApi(baseUrl: string): Promise<DashboardData> {
  const response = await fetch(new URL("/api/dashboard", baseUrl), {
    headers: readApiHeaders(),
    next: { revalidate: 300 }
  });
  if (!response.ok) throw new Error(`Dashboard API HTTP ${response.status}`);
  const data = await response.json() as DashboardData;
  return { ...data, dataSource: "api" };
}

function emptyDashboard(): DashboardData {
  return {
    generatedAt: new Date().toISOString(),
    stats: {
      modelCount: 0,
      valuedModelCount: 0,
      salesCount: 0,
      marketListingCount: 0,
      marketValuedModelCount: 0,
      candidateCount: 0,
      hotCandidateCount: 0
    },
    topModels: [],
    candidates: [],
    runs: [],
    dataSource: "empty"
  };
}
