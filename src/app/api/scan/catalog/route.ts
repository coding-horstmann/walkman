import { NextResponse, type NextRequest } from "next/server";
import { assertApiWriteAccess } from "@/lib/api-auth";
import { runCatalogSync } from "@/lib/scan/catalog-sync";

export async function POST(request: NextRequest) {
  const unauthorized = assertApiWriteAccess(request);
  if (unauthorized) return unauthorized;

  const result = await runCatalogSync({ persist: true });
  return NextResponse.json({
    run: result.run,
    totalHint: result.totalHint
  });
}
