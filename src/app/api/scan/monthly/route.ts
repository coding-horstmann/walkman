import { NextResponse, type NextRequest } from "next/server";
import { assertApiWriteAccess } from "@/lib/api-auth";
import { runMonthlyScan } from "@/lib/scan/monthly";

export async function POST(request: NextRequest) {
  const unauthorized = assertApiWriteAccess(request);
  if (unauthorized) return unauthorized;

  const result = await runMonthlyScan({ persist: true });
  return NextResponse.json(result);
}
