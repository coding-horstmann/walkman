import type { EbayListingBase } from "@/lib/types";
import { randomUUID } from "node:crypto";

export type WallapopSearchOptions = {
  limit?: number;
  timeoutMs?: number;
};

type WallapopQueryPlan = {
  query: string;
  pages: number;
};

type WallapopImage = {
  urls?: Record<string, string>;
  urls_by_size?: Record<string, string>;
  url?: string;
  original?: string;
};

type WallapopItem = {
  id?: string;
  title?: string;
  web_slug?: string;
  slug?: string;
  url?: string;
  price?: number | { amount?: number; currency?: string };
  currency?: string;
  images?: WallapopImage[];
  image?: WallapopImage;
  location?: { city?: string; country_code?: string };
  user?: { name?: string };
  seller?: { name?: string };
  description?: string;
  created_at?: number | string;
  modified_at?: number | string;
};

type WallapopSearchComponent = {
  type?: string;
  id?: string;
  type_data?: {
    base_url?: string;
    query_params?: Record<string, string | number | boolean | undefined>;
  };
};

export class WallapopSearchClient {
  private readonly cache = new Map<string, Promise<EbayListingBase[]>>();

  async search(query: string, options: WallapopSearchOptions = {}): Promise<EbayListingBase[]> {
    const timeoutMs = options.timeoutMs || Number(process.env.WALLAPOP_TIMEOUT_MS || 25_000);
    const rawLimit = Number(process.env.WALLAPOP_RAW_RESULTS_PER_QUERY || 500);
    const listings: EbayListingBase[] = [];

    for (const plan of queryPlans(query)) {
      listings.push(...await this.searchCached(plan, timeoutMs, rawLimit));
    }

    return dedupeListings(listings).slice(0, rawLimit);
  }

  async close(): Promise<void> {
    this.cache.clear();
    return undefined;
  }

  private searchCached(plan: WallapopQueryPlan, timeoutMs: number, rawLimit: number): Promise<EbayListingBase[]> {
    const key = `${plan.query}|${plan.pages}|${rawLimit}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const request = this.searchSingle(plan, timeoutMs, rawLimit);
    this.cache.set(key, request);
    return request;
  }

  private async searchSingle(plan: WallapopQueryPlan, timeoutMs: number, rawLimit: number): Promise<EbayListingBase[]> {
    const deviceId = randomUUID();
    const origin = process.env.WALLAPOP_WEB_ORIGIN || "https://uk.wallapop.com";

    const componentsUrl = new URL("https://api.wallapop.com/api/v3/search/components");
    componentsUrl.searchParams.set("keywords", plan.query);
    componentsUrl.searchParams.set("source", "deep_link");
    componentsUrl.searchParams.set("latitude", process.env.WALLAPOP_LATITUDE || "40.4168");
    componentsUrl.searchParams.set("longitude", process.env.WALLAPOP_LONGITUDE || "-3.7038");
    componentsUrl.searchParams.set("order_by", "newest");

    const componentsResponse = await fetchWithTimeout(componentsUrl, timeoutMs, deviceId, "application/json; sequence=v2", plan.query, origin);
    const componentsText = await componentsResponse.text();
    if (!componentsResponse.ok) throw new Error(`Wallapop HTTP ${componentsResponse.status}`);

    const componentsData = safeJson(componentsText);
    const searchSection = findSearchSection(componentsData);
    if (!searchSection?.type_data?.base_url || !searchSection.type_data.query_params) {
      throw new Error("Wallapop search section missing");
    }

    let sectionUrl = new URL(searchSection.type_data.base_url, "https://api.wallapop.com");
    for (const [key, value] of Object.entries(searchSection.type_data.query_params)) {
      if (value !== undefined) sectionUrl.searchParams.set(key, String(value));
    }

    const items: WallapopItem[] = [];
    for (let page = 0; page < plan.pages && sectionUrl && items.length < rawLimit; page += 1) {
      const sectionResponse = await fetchWithTimeout(sectionUrl, timeoutMs, deviceId, "application/json", plan.query, origin);
      const sectionText = await sectionResponse.text();
      if (!sectionResponse.ok) throw new Error(`Wallapop HTTP ${sectionResponse.status}`);

      const data = safeJson(sectionText);
      items.push(...extractItems(data));

      const nextPage = readNextPage(data);
      if (!nextPage) break;
      sectionUrl = new URL("https://api.wallapop.com/api/v3/search/section");
      sectionUrl.searchParams.set("next_page", nextPage);
    }

    return dedupe(items).slice(0, rawLimit).map(mapItem).filter(Boolean) as EbayListingBase[];
  }
}

function mapItem(item: WallapopItem): EbayListingBase | null {
  const id = item.id || item.url || item.web_slug || item.slug;
  if (!id) return null;
  const itemUrl = item.url || wallapopUrl(item);
  if (!itemUrl) return null;
  const price = readPrice(item.price);

  return {
    listingId: String(id),
    itemUrl,
    title: cleanText(item.title || "Wallapop listing"),
    imageUrl: imageUrl(item),
    priceAmount: price.amount,
    priceCurrency: price.currency || item.currency || "EUR",
    condition: item.description ? cleanText(item.description).slice(0, 120) : undefined,
    sellerName: item.user?.name || item.seller?.name,
    sellerAccountType: "private",
    sourcePlatform: "wallapop",
    listingFormat: "fixed",
    buyingOptions: ["FIXED_PRICE"],
    itemEndDate: readTimestamp(item.created_at || item.modified_at),
    location: [item.location?.city, item.location?.country_code].filter(Boolean).join(", ") || undefined,
    rawData: item as Record<string, unknown>
  };
}

function wallapopUrl(item: WallapopItem): string {
  const origin = process.env.WALLAPOP_WEB_ORIGIN || "https://uk.wallapop.com";
  if (item.web_slug) return `${origin}/item/${item.web_slug}`;
  if (item.slug) return `${origin}/item/${item.slug}`;
  if (item.id) return `${origin}/item/${item.id}`;
  return "";
}

function imageUrl(item: WallapopItem): string | undefined {
  const image = item.images?.[0] || item.image;
  if (!image) return undefined;
  return image.url
    || image.original
    || image.urls?.big
    || image.urls?.medium
    || image.urls?.small
    || image.urls_by_size?.original
    || image.urls_by_size?.large
    || image.urls_by_size?.medium
    || image.urls_by_size?.small;
}

function readPrice(value: WallapopItem["price"]): { amount?: number; currency?: string } {
  if (value === undefined || value === null) return {};
  if (typeof value === "number") return { amount: value, currency: "EUR" };
  return { amount: value.amount, currency: value.currency || "EUR" };
}

function extractItems(data: unknown): WallapopItem[] {
  const found: WallapopItem[] = [];
  visit(data, (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const item = value as WallapopItem;
    if ((item.id || item.web_slug || item.url) && item.title && item.price !== undefined) found.push(item);
  });
  return dedupe(found);
}

function visit(value: unknown, fn: (value: unknown) => void): void {
  fn(value);
  if (Array.isArray(value)) {
    for (const child of value) visit(child, fn);
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) visit(child, fn);
  }
}

function dedupe(items: WallapopItem[]): WallapopItem[] {
  const seen = new Set<string>();
  const unique: WallapopItem[] = [];
  for (const item of items) {
    const key = String(item.id || item.url || item.web_slug || item.slug || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

async function fetchWithTimeout(url: URL, timeoutMs: number, deviceId: string, accept: string, query: string, origin: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: accept,
        "Accept-Encoding": "identity",
        "Accept-Language": process.env.WALLAPOP_ACCEPT_LANGUAGE || "en-GB,en;q=0.9,es;q=0.7",
        deviceos: "0",
        Origin: origin,
        Referer: `${origin}/search?keywords=${encodeURIComponent(query)}&order_by=newest`,
        "User-Agent": process.env.WALLAPOP_USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "X-DeviceID": deviceId,
        "X-DeviceOS": "0"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

function queryPlans(query: string): WallapopQueryPlan[] {
  const exactPages = Number(process.env.WALLAPOP_EXACT_PAGES_PER_QUERY || 1);
  const broadPages = Number(process.env.WALLAPOP_BROAD_PAGES_PER_QUERY || process.env.WALLAPOP_PAGES_PER_QUERY || 15);
  const baseQuery = query.replace(/\s+walkman\s*$/i, "").trim();
  const [maker, ...rest] = baseQuery.split(/\s+/).filter(Boolean);
  const modelCode = rest.join(" ");
  const plans: WallapopQueryPlan[] = [
    { query: baseQuery, pages: exactPages }
  ];

  if (maker) {
    const prefix = codePrefix(modelCode);
    if (prefix) plans.push({ query: `${maker} ${prefix}`, pages: broadPages });
    plans.push({ query: `${maker} walkman`, pages: broadPages });
  }

  plans.push({ query: "walkman", pages: broadPages });
  return uniquePlans(plans.filter((plan) => plan.query.trim().length > 0));
}

function codePrefix(modelCode: string): string {
  const normalized = modelCode.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (normalized.startsWith("wm")) return "wm";
  if (normalized.startsWith("hs")) return "hs";
  if (normalized.startsWith("rq")) return "rq";
  if (normalized.startsWith("kt")) return "kt";
  if (normalized.startsWith("tps")) return "walkman";
  return "";
}

function uniquePlans(plans: WallapopQueryPlan[]): WallapopQueryPlan[] {
  const seen = new Set<string>();
  const unique: WallapopQueryPlan[] = [];
  for (const plan of plans) {
    const key = plan.query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(plan);
  }
  return unique;
}

function dedupeListings(listings: EbayListingBase[]): EbayListingBase[] {
  const seen = new Set<string>();
  const unique: EbayListingBase[] = [];
  for (const listing of listings) {
    const key = listing.itemUrl || listing.listingId;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(listing);
  }
  return unique;
}

function readNextPage(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const nextPage = (data as { meta?: { next_page?: unknown } }).meta?.next_page;
  return typeof nextPage === "string" && nextPage.length > 0 ? nextPage : undefined;
}

function findSearchSection(data: unknown): WallapopSearchComponent | undefined {
  if (!data || typeof data !== "object") return undefined;
  const components = (data as { components?: WallapopSearchComponent[] }).components;
  return components?.find((component) => component.type === "search_section" && component.id === "organic_search_results")
    || components?.find((component) => component.type === "search_section");
}

function readTimestamp(value: WallapopItem["created_at"]): string | undefined {
  if (value === undefined || value === null) return undefined;
  const timestamp = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(timestamp)) return undefined;
  const normalized = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  return new Date(normalized).toISOString();
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Wallapop returned non-JSON response");
  }
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
