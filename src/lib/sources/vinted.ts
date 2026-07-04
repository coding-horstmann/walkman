import * as cheerio from "cheerio";
import type { EbayListingBase, SourcePlatform } from "@/lib/types";

export type VintedSearchOptions = {
  limit?: number;
  timeoutMs?: number;
};

type VintedClientOptions = {
  origin?: string;
  locale?: string;
  sourcePlatform?: Extract<SourcePlatform, "vinted" | "vinted_fr">;
  envPrefix?: string;
};

type VintedApiItem = {
  id?: number | string;
  title?: string;
  url?: string;
  price?: string | number | { amount?: string | number; currency_code?: string; currency?: string };
  total_item_price?: string | number | { amount?: string | number; currency_code?: string; currency?: string };
  photo?: VintedPhoto;
  photos?: VintedPhoto[];
  status?: string;
  user?: { login?: string; profile_url?: string };
};

type VintedPhoto = {
  url?: string;
  full_size_url?: string;
  is_main?: boolean;
  thumbnails?: Array<{ url?: string; type?: string }>;
};

export class VintedSearchClient {
  private readonly origin: string;
  private readonly locale: string;
  private readonly sourcePlatform: Extract<SourcePlatform, "vinted" | "vinted_fr">;
  private readonly envPrefix: string;
  private cookieHeader = "";

  constructor(options: VintedClientOptions = {}) {
    this.origin = options.origin || "https://www.vinted.de";
    this.locale = options.locale || "de-DE,de;q=0.9,en;q=0.7";
    this.sourcePlatform = options.sourcePlatform || "vinted";
    this.envPrefix = options.envPrefix || "VINTED";
  }

  async search(query: string, options: VintedSearchOptions = {}): Promise<EbayListingBase[]> {
    const limit = options.limit || Number(process.env[`${this.envPrefix}_RESULTS_PER_MODEL`] || process.env.VINTED_RESULTS_PER_MODEL || 8);
    const timeoutMs = options.timeoutMs || Number(process.env[`${this.envPrefix}_TIMEOUT_MS`] || process.env.VINTED_TIMEOUT_MS || 25_000);

    try {
      const apiResults = await this.searchApi(query, limit, timeoutMs);
      if (apiResults.length) return apiResults;
    } catch (error) {
      if (isAuthError(error) || isVintedBlockError(error)) {
        await this.warmUpSession(timeoutMs);
        try {
          const retryResults = await this.searchApi(query, limit, timeoutMs);
          if (retryResults.length) return retryResults;
          return [];
        } catch (retryError) {
          if (isAuthError(retryError) || isVintedBlockError(retryError)) throw retryError;
        }
      } else {
        return this.searchHtml(query, limit, timeoutMs);
      }
    }

    return this.searchHtml(query, limit, timeoutMs);
  }

  async close(): Promise<void> {
    return undefined;
  }

  private async searchApi(query: string, limit: number, timeoutMs: number): Promise<EbayListingBase[]> {
    const url = new URL("/api/v2/catalog/items", this.origin);
    url.searchParams.set("search_text", query);
    url.searchParams.set("order", "newest_first");
    url.searchParams.set("page", "1");
    url.searchParams.set("per_page", String(Math.max(1, Math.min(limit, 96))));

    const data = await this.fetchJson(url, timeoutMs);
    const items = Array.isArray(data.items) ? data.items as VintedApiItem[] : [];
    return items.slice(0, limit).map((item) => this.mapApiItem(item)).filter(Boolean) as EbayListingBase[];
  }

  private async searchHtml(query: string, limit: number, timeoutMs: number): Promise<EbayListingBase[]> {
    const url = new URL("/catalog", this.origin);
    url.searchParams.set("search_text", query);
    url.searchParams.set("order", "newest_first");

    const html = await this.fetchText(url, timeoutMs);
    if (isBlocked(html)) throw new Error("Vinted block/captcha detected");
    return this.extractVintedListings(html, limit);
  }

  private async warmUpSession(timeoutMs: number): Promise<void> {
    const html = await this.fetchText(new URL("/", this.origin), timeoutMs);
    if (isBlocked(html)) throw new Error("Vinted block/captcha detected");
  }

  private mapApiItem(item: VintedApiItem): EbayListingBase | null {
    const itemUrl = item.url
      ? normalizeVintedItemUrl(item.url, this.origin)
      : item.id ? normalizeVintedItemUrl(`/items/${item.id}`, this.origin) : "";
    if (!itemUrl) return null;
    const price = readPrice(item.price) || readPrice(item.total_item_price);

    return {
      listingId: String(item.id || itemUrl),
      itemUrl,
      title: cleanTitle(item.title || "Vinted listing"),
      imageUrl: readImageUrl(item),
      priceAmount: price.amount,
      priceCurrency: price.currency || "EUR",
      condition: item.status,
      sellerName: item.user?.login,
      sellerAccountType: "private",
      sourcePlatform: this.sourcePlatform,
      listingFormat: "fixed",
      buyingOptions: ["FIXED_PRICE"],
      rawData: item as Record<string, unknown>
    };
  }

  private extractVintedListings(html: string, limit: number): EbayListingBase[] {
    const $ = cheerio.load(html);
    const listings: EbayListingBase[] = [];
    const seen = new Set<string>();

    $("a[href*='/items/']").each((_, element) => {
      if (listings.length >= limit) return false;
      const href = $(element).attr("href");
      if (!href) return;
      const itemUrl = normalizeVintedItemUrl(href, this.origin);
      if (seen.has(itemUrl)) return;
      seen.add(itemUrl);

      const container = $(element).closest("[data-testid], article, div");
      const text = cleanText(container.text() || $(element).text());
      const rawTitle = cleanText(
        $(element).attr("title")
        || container.find("[data-testid*='title']").first().text()
        || text.split("€")[0]
        || "Vinted listing"
      );
      const price = parseEuro(`${text} ${rawTitle}`);
      const imageUrl = container.find("img").first().attr("src") || container.find("img").first().attr("data-src");

      listings.push({
        listingId: itemUrl,
        itemUrl,
        title: cleanTitle(rawTitle),
        imageUrl,
        priceAmount: price,
        priceCurrency: price ? "EUR" : undefined,
        condition: conditionFromText(text),
        sellerAccountType: "private",
        sourcePlatform: this.sourcePlatform,
        listingFormat: "fixed",
        buyingOptions: ["FIXED_PRICE"],
        rawData: { source: this.sourcePlatform, text: text.slice(0, 500) }
      });
    });

    return listings;
  }

  private async fetchJson(url: URL, timeoutMs: number): Promise<Record<string, unknown>> {
    const response = await this.fetchWithTimeout(url, timeoutMs, "application/json");
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(`Vinted HTTP ${response.status}`);
    return data;
  }

  private async fetchText(url: URL, timeoutMs: number): Promise<string> {
    const response = await this.fetchWithTimeout(url, timeoutMs, "text/html");
    const text = await response.text();
    if (!response.ok) throw new Error(`Vinted HTTP ${response.status}`);
    return text;
  }

  private async fetchWithTimeout(url: URL, timeoutMs: number, accept: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          Accept: accept,
          "Accept-Language": this.locale,
          "User-Agent": process.env[`${this.envPrefix}_USER_AGENT`] || process.env.VINTED_USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          Referer: this.origin,
          ...(this.cookieHeader ? { Cookie: this.cookieHeader } : {})
        }
      });
      this.captureCookies(response);
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  private captureCookies(response: Response): void {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const cookies = typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : splitSetCookie(headers.get("set-cookie") || "");
    if (!cookies.length) return;

    const current = new Map(this.cookieHeader
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [name, ...rest] = entry.split("=");
        return [name, rest.join("=")] as const;
      }));
    for (const cookie of cookies) {
      const [pair] = cookie.split(";");
      const [name, ...rest] = pair.split("=");
      if (!name || !rest.length) continue;
      current.set(name.trim(), rest.join("=").trim());
    }
    this.cookieHeader = [...current.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

export async function fetchVintedImageFromItemUrl(itemUrl: string, timeoutMs = 20_000): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(itemUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "text/html",
        "Accept-Language": itemUrl.includes("vinted.fr") ? "fr-FR,fr;q=0.9,en;q=0.7" : "de-DE,de;q=0.9,en;q=0.7",
        "User-Agent": process.env.VINTED_USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Referer: new URL(itemUrl).origin
      }
    });
    const html = await response.text();
    if (!response.ok || isBlocked(html)) return undefined;
    const $ = cheerio.load(html);
    return $("meta[property='og:image']").attr("content")
      || $("meta[name='twitter:image']").attr("content")
      || undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function readImageUrl(item: VintedApiItem): string | undefined {
  const mainPhoto = item.photos?.find((photo) => photo.is_main) || item.photos?.[0] || item.photo;
  return mainPhoto?.url
    || mainPhoto?.full_size_url
    || mainPhoto?.thumbnails?.find((thumbnail) => thumbnail.type?.includes("428") && thumbnail.url)?.url
    || mainPhoto?.thumbnails?.find((thumbnail) => thumbnail.url)?.url;
}

function readPrice(value: VintedApiItem["price"]): { amount?: number; currency?: string } {
  if (value === undefined || value === null) return {};
  if (typeof value === "object") {
    const amount = readNumber(value.amount);
    return {
      amount,
      currency: value.currency_code || value.currency || (amount ? "EUR" : undefined)
    };
  }
  const amount = readNumber(value);
  return { amount, currency: amount ? "EUR" : undefined };
}

function readNumber(value?: string | number): number | undefined {
  if (value === undefined || value === null) return undefined;
  const normalized = normalizePriceNumber(String(value));
  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function conditionFromText(text: string): string | undefined {
  const conditions = ["Neuf avec etiquette", "Neuf sans etiquette", "Tres bon etat", "Bon etat", "Satisfaisant", "Neu mit Etikett", "Neu ohne Etikett", "Sehr gut", "Gut", "Zufriedenstellend"];
  const normalized = normalizeText(text);
  return conditions.find((condition) => normalized.includes(normalizeText(condition)));
}

export function parseVintedPriceText(text: string): number | undefined {
  const match = text.match(/(\d{1,3}(?:(?:[.\s\u00A0\u202F]\d{3})+)(?:[,.]\d{1,2})?|\d{1,7}(?:[,.]\d{1,2})?)\s*(?:€|â‚¬|EUR)/i);
  if (!match) return undefined;
  return readNumber(match[1]);
}

function parseEuro(text: string): number | undefined {
  const robustPrice = parseVintedPriceText(text);
  if (robustPrice !== undefined) return robustPrice;

  const match = text.match(/(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:€|EUR)/i);
  if (!match) return undefined;
  return readNumber(match[1]);
}

function normalizePriceNumber(value: string): string {
  const compact = value.trim().replace(/[\s\u00A0\u202F]/g, "");
  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    return lastComma > lastDot
      ? compact.replace(/\./g, "").replace(",", ".")
      : compact.replace(/,/g, "");
  }

  if (lastComma >= 0) return compact.replace(/\./g, "").replace(",", ".");

  if (lastDot >= 0) {
    const parts = compact.split(".");
    const fraction = parts.at(-1) || "";
    if (parts.length > 2 || (parts.length === 2 && parts[0].length <= 3 && fraction.length === 3)) {
      return compact.replace(/\./g, "");
    }
  }

  return compact;
}

function cleanTitle(value: string): string {
  return value
    .split(/,\s*marque:/i)[0]
    .split(/,\s*marke:/i)[0]
    .split(/\d{1,5}(?:[.,]\d{1,2})?\s*(?:€|EUR)/i)[0]
    .replace(/,\s*$/, "")
    .trim() || "Vinted listing";
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function absoluteUrl(href: string, origin: string): string {
  return href.startsWith("http") ? href : new URL(href, origin).toString();
}

export function normalizeVintedItemUrl(href: string, origin: string): string {
  const url = new URL(absoluteUrl(href, origin));
  if (url.pathname.startsWith("/items/")) {
    url.search = "";
    url.hash = "";
  }
  return url.toString();
}

function isAuthError(error: unknown): boolean {
  return error instanceof Error && /Vinted HTTP 401/i.test(error.message);
}

export function isVintedBlockError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Vinted HTTP (403|429)|block|captcha|access denied|zugriff verweigert|forbidden|interdit|repeated block signals/i.test(message);
}

function splitSetCookie(value: string): string[] {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,]+=)/g).map((cookie) => cookie.trim()).filter(Boolean);
}

function isBlocked(html: string): boolean {
  const text = html.toLowerCase();
  return text.includes("access denied")
    || text.includes("zugriff verweigert")
    || text.includes("verify you are human")
    || text.includes("are you a human")
    || text.includes("pardon our interruption");
}
