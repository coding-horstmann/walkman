import { NextResponse } from "next/server";
import { hasDatabaseUrl, query } from "@/lib/db/client";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ ok: true, database: "not_configured" });
  }

  await query("SELECT 1");
  return NextResponse.json({ ok: true, database: "ready" });
}
