import type { EbayListingBase } from "@/lib/types";

export type EbaySearchMode = "active" | "sold";

export type EbayItem = {
  itemId?: string;
  legacyItemId?: string;
  title?: string;
  subtitle?: string;
  shortDescription?: string;
  itemWebUrl?: string;
  itemAffiliateWebUrl?: string;
  price?: { value?: string; currency?: string };
  currentBidPrice?: { value?: string; currency?: string };
  itemSoldPrice?: { value?: string; currency?: string };
  lastSoldDate?: string;
  image?: { imageUrl?: string };
  additionalImages?: Array<{ imageUrl?: string }>;
  condition?: string;
  seller?: { username?: string; sellerAccountType?: string };
  buyingOptions?: string[];
  itemCreationDate?: string;
  itemEndDate?: string;
  localizedAspects?: Array<{ name?: string; value?: string }>;
  itemLocation?: { country?: string; city?: string; postalCode?: string };
};

type TokenCache = {
  token: string;
  expiresAt: number;
};

let tokenCache: TokenCache | null = null;
let browseQuotaCache: { remaining?: number; limit?: number; reset?: string; checkedAt: number } | null = null;

export class EbayClient {
  private calls = 0;

  constructor(
    private readonly options: {
      marketplaceId?: string;
      maxCalls?: number;
      delayMs?: number;
    } = {}
  ) {}

  async searchActiveListings(query: string, limit: number, options: {
    conditionIds?: string;
    sellerAccountType?: string;
    buyingOptions?: string;
  } = {}): Promise<EbayListingBase[]> {
    const data = await this.get("https://api.ebay.com/buy/browse/v1/item_summary/search", {
      q: truncateQuery(query),
      limit,
      sort: "newlyListed",
      fieldgroups: "EXTENDED",
      filter: buildActiveFilter(options),
      category_ids: process.env.EBAY_CATEGORY_IDS || undefined
    });
    const items = (data.itemSummaries || []) as EbayItem[];
    await this.delay();
    return items.map((item) => toListing(item)).filter((item) => item.itemUrl);
  }

  async searchSoldListings(query: string, limit: number, monthsBack = 12): Promise<EbayListingBase[]> {
    const end = new Date();
    const start = new Date(end);
    start.setMonth(start.getMonth() - monthsBack);

    const data = await this.get("https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search", {
      q: truncateQuery(query),
      limit,
      sort: "-lastSoldDate",
      filter: `lastSoldDate:[${start.toISOString()}..${end.toISOString()}]`,
      category_ids: process.env.EBAY_CATEGORY_IDS || undefined
    });
    const items = (data.itemSales || []) as EbayItem[];
    await this.delay();
    return items.map((item) => toListing(item)).filter((item) => item.itemUrl);
  }

  private async get(urlValue: string, params: Record<string, string | number | undefined>): Promise<Record<string, unknown>> {
    this.calls += 1;
    const maxCalls = this.options.maxCalls ?? Number(process.env.EBAY_MAX_CALLS_PER_RUN || 1000);
    if (this.calls > maxCalls) throw new Error(`eBay call budget exceeded (${maxCalls})`);
    if (urlValue.includes("/buy/browse/")) await ensureBrowseQuotaReserve(maxCalls);

    const token = await getEbayAccessToken();
    const url = new URL(urlValue);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": this.options.marketplaceId || process.env.EBAY_MARKETPLACE_ID || "EBAY_DE",
        "Accept-Language": process.env.EBAY_ACCEPT_LANGUAGE || "de-DE",
        "User-Agent": "walkman-restoration-scout/1.0"
      }
    });
    const data = await readJson(response);
    if (!response.ok) throw new Error(`eBay HTTP ${response.status}: ${extractEbayError(data)}`);
    return data;
  }

  private async delay(): Promise<void> {
    await sleep(this.options.delayMs ?? Number(process.env.EBAY_API_DELAY_MS || 1100));
  }
}

async function ensureBrowseQuotaReserve(maxCalls: number): Promise<void> {
  if (process.env.EBAY_QUOTA_GUARD === "false") return;
  const reserve = Number(process.env.EBAY_DAILY_CALL_RESERVE || 200);
  const quota = await getBrowseQuota().catch(() => undefined);
  if (!quota?.remaining && quota?.remaining !== 0) return;

  const minimumRemaining = Math.max(reserve, Math.min(maxCalls, reserve));
  if (quota.remaining <= minimumRemaining) {
    const resetText = quota.reset ? ` Reset: ${quota.reset}.` : "";
    throw new Error(`eBay Browse daily quota reserve reached (${quota.remaining}/${quota.limit ?? "unknown"} remaining).${resetText}`);
  }
}

async function getBrowseQuota(): Promise<{ remaining?: number; limit?: number; reset?: string }> {
  const cacheMs = Number(process.env.EBAY_QUOTA_CACHE_MS || 60_000);
  if (browseQuotaCache && browseQuotaCache.checkedAt > Date.now() - cacheMs) return browseQuotaCache;

  const token = await getEbayAccessToken();
  const response = await fetch("https://api.ebay.com/developer/analytics/v1_beta/rate_limit/", {
    headers: {
      Authorization: `Bearer ${token}`,
      "Accept-Language": process.env.EBAY_ACCEPT_LANGUAGE || "de-DE",
      "User-Agent": "walkman-restoration-scout/1.0"
    }
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error(`eBay analytics HTTP ${response.status}: ${extractEbayError(data)}`);

  const quota = findBrowseQuota(data);
  browseQuotaCache = { ...quota, checkedAt: Date.now() };
  return browseQuotaCache;
}

function findBrowseQuota(data: unknown): { remaining?: number; limit?: number; reset?: string } {
  const candidates: Array<{ remaining?: number; limit?: number; reset?: string; score: number }> = [];
  visitQuotaNode(data, [], (path, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    const remaining = readNumber(record.remaining);
    const limit = readNumber(record.limit);
    if (remaining === undefined || limit === undefined) return;

    const joined = `${path.join(" ")} ${Object.values(record).filter((entry) => typeof entry === "string").join(" ")}`.toLowerCase();
    let score = 0;
    if (joined.includes("browse")) score += 4;
    if (joined.includes("item_summary") || joined.includes("item_summary/search")) score += 3;
    if (joined.includes("buy")) score += 1;
    candidates.push({ remaining, limit, reset: typeof record.reset === "string" ? record.reset : undefined, score });
  });
  return candidates.sort((left, right) => right.score - left.score)[0] || {};
}

function visitQuotaNode(value: unknown, path: string[], fn: (path: string[], value: unknown) => void): void {
  fn(path, value);
  if (Array.isArray(value)) {
    for (const child of value) visitQuotaNode(child, path, fn);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      visitQuotaNode(child, [...path, key], fn);
    }
  }
}

function readNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function damagedQueryForModel(modelName: string): string {
  return `${modelName} (defekt,ersatzteil,bastler,repair,spares,not working,nicht funktionsfähig)`;
}

export function marketQueryForModel(modelName: string): string {
  return `${modelName} walkman`;
}

export function soldQueryForModel(modelName: string): string {
  return `${modelName} walkman`;
}

export function detectIssueTerms(listing: EbayListingBase): string[] {
  const text = normalizeIssueText(`${listing.title} ${listing.condition || ""}`);
  const terms = [
    "defekt",
    "defekte",
    "bastler",
    "ersatzteil",
    "ersatzteile",
    "repair",
    "spares",
    "not working",
    "nicht funktionsfaehig",
    "nicht funktionsfähig",
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
    "riemen",
    "kein ton",
    "spielt nicht",
    "reparatur",
    "pour pieces",
    "pieces detachees",
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
    "para reparar",
    "desguace",
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
    "non funziona",
    "non funzionante",
    "guasto",
    "guasta",
    "rotto",
    "rotta",
    "difettoso",
    "difettosa",
    "per parti"
  ];
  return terms.filter((term) => text.includes(term));
}

function normalizeIssueText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/Ã¤/g, "ae")
    .replace(/Ã¶/g, "oe")
    .replace(/Ã¼/g, "ue")
    .replace(/ÃŸ/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildActiveFilter(options: { conditionIds?: string; sellerAccountType?: string; buyingOptions?: string }): string {
  const filters = [
    "priceCurrency:EUR",
    options.conditionIds
      ? `conditionIds:{${options.conditionIds}}`
      : undefined,
    options.buyingOptions
      ? `buyingOptions:{${options.buyingOptions}}`
      : undefined,
    options.sellerAccountType
      ? `sellerAccountTypes:{${options.sellerAccountType}}`
      : undefined
  ];
  return filters.filter(Boolean).join(",");
}

async function getEbayAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are required");

  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: process.env.EBAY_OAUTH_SCOPE || "https://api.ebay.com/oauth/api_scope"
    })
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error(`eBay token HTTP ${response.status}: ${extractEbayError(data)}`);

  tokenCache = {
    token: String(data.access_token || ""),
    expiresAt: Date.now() + Number(data.expires_in || 7200) * 1000
  };
  return tokenCache.token;
}

function toListing(item: EbayItem): EbayListingBase {
  const itemUrl = item.itemWebUrl || item.itemAffiliateWebUrl || "";
  const price = readPrice(item);
  return {
    listingId: item.itemId || item.legacyItemId || itemUrl,
    itemUrl,
    title: item.title || "eBay listing",
    priceAmount: price.amount,
    priceCurrency: price.currency,
    imageUrl: item.image?.imageUrl || item.additionalImages?.find((image) => image.imageUrl)?.imageUrl,
    condition: item.condition,
    sellerName: item.seller?.username,
    sellerAccountType: normalizeSellerAccountType(item.seller?.sellerAccountType),
    sourcePlatform: "ebay",
    listingFormat: listingFormatFromBuyingOptions(item.buyingOptions || []),
    buyingOptions: item.buyingOptions || [],
    itemEndDate: item.itemEndDate,
    location: formatLocation(item.itemLocation),
    rawData: item as Record<string, unknown>
  };
}

function readPrice(item: EbayItem): { amount?: number; currency?: string } {
  const money = item.itemSoldPrice || item.price || item.currentBidPrice;
  const amount = money?.value ? Number(money.value) : undefined;
  return {
    amount: amount && Number.isFinite(amount) ? amount : undefined,
    currency: money?.currency
  };
}

function listingFormatFromBuyingOptions(options: string[]): EbayListingBase["listingFormat"] {
  const normalized = options.map((option) => option.toUpperCase());
  const hasAuction = normalized.includes("AUCTION");
  const hasFixed = normalized.includes("FIXED_PRICE");
  if (hasAuction && hasFixed) return "hybrid";
  if (hasAuction) return "auction";
  if (hasFixed) return "fixed";
  return "unknown";
}

function normalizeSellerAccountType(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized.includes("business")) return "business";
  if (normalized.includes("individual") || normalized.includes("private")) return "private";
  return normalized;
}

function formatLocation(location?: EbayItem["itemLocation"]): string | undefined {
  if (!location) return undefined;
  return [location.postalCode, location.city, location.country].filter(Boolean).join(", ") || undefined;
}

function truncateQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 100);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

function extractEbayError(data: Record<string, unknown>): string {
  const errors = data.errors;
  if (Array.isArray(errors) && errors[0] && typeof errors[0] === "object") {
    const error = errors[0] as { message?: string; longMessage?: string };
    return error.longMessage || error.message || "Unknown eBay error";
  }
  return String(data.error_description || data.message || data.raw || "Unknown eBay error");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
