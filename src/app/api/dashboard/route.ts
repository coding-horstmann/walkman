import { NextResponse, type NextRequest } from "next/server";
import { assertApiWriteAccess } from "@/lib/api-auth";
import { hasDatabaseUrl } from "@/lib/db/client";
import { ensureSchema } from "@/lib/db/schema";
import { getDashboardDataFromDb } from "@/lib/db/repository";

export async function GET(request: NextRequest) {
  const unauthorized = assertApiWriteAccess(request);
  if (unauthorized) return unauthorized;

  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  await ensureSchema();
  return NextResponse.json(await getDashboardDataFromDb());
}
