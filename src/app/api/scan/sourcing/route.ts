import { NextResponse, type NextRequest } from "next/server";
import { assertApiWriteAccess } from "@/lib/api-auth";
import { runEbayDamagedScan } from "@/lib/scan/ebay-damaged";
import { runKleinanzeigenSourcingScan, runVintedFrSourcingScan, runVintedSourcingScan, runWallapopSourcingScan } from "@/lib/scan/platform-sourcing";

export async function POST(request: NextRequest) {
  const unauthorized = assertApiWriteAccess(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const limit = readNumber(url.searchParams.get("limit"));
  const offset = readNumber(url.searchParams.get("offset"));
  const resultsPerModel = readNumber(url.searchParams.get("resultsPerModel"));
  const repairCost = readNumber(url.searchParams.get("repairCost"));
  const tradeCost = readNumber(url.searchParams.get("tradeCost"));
  const source = url.searchParams.get("source") || "all";

  const runOptions = { persist: true, limit, offset, resultsPerModel, repairCost, tradeCost };
  const ebay = source === "all" || source === "ebay"
    ? await runEbayDamagedScan({ persist: true, limit, offset, resultsPerModel, repairCost })
    : null;
  const vinted = source === "all" || source === "platforms" || source === "vinted"
    ? await runVintedSourcingScan(runOptions)
    : null;
  const vintedFr = source === "all" || source === "platforms" || source === "vinted_fr"
    ? await runVintedFrSourcingScan(runOptions)
    : null;
  const kleinanzeigen = source === "all" || source === "platforms" || source === "kleinanzeigen"
    ? await runKleinanzeigenSourcingScan(runOptions)
    : null;
  const wallapop = source === "all" || source === "platforms" || source === "wallapop"
    ? await runWallapopSourcingScan(runOptions)
    : null;

  return NextResponse.json({ ebay, vinted, vintedFr, kleinanzeigen, wallapop });
}

function readNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}
