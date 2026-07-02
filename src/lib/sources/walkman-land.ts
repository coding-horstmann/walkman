import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { modelId } from "@/lib/db/repository";
import type { WalkmanModel } from "@/lib/types";

const BASE_URL = "https://walkman.land";
const CATALOG_URL = `${BASE_URL}/catalog`;

export type CatalogFetchOptions = {
  maxPages?: number;
  delayMs?: number;
  userAgent?: string;
  onPage?: (event: { page: number; url: string; found: number; totalHint?: number }) => void;
};

export type WalkmanLandEbayOffer = {
  listingId: string;
  title: string;
  itemUrl: string;
  imageUrl?: string;
  priceUsd: number;
  sellerCountry?: string;
};

export async function fetchWalkmanCatalog(options: CatalogFetchOptions = {}): Promise<{
  models: WalkmanModel[];
  totalHint?: number;
}> {
  const maxPages = options.maxPages ?? Number(process.env.CATALOG_MAX_PAGES || 80);
  const delayMs = options.delayMs ?? Number(process.env.CATALOG_DELAY_MS || 2500);
  const seen = new Map<string, WalkmanModel>();
  let totalHint: number | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const url = page === 0 ? CATALOG_URL : `${BASE_URL}/catalog/all/id/desc/${page}`;
    const html = await fetchTextWithRetry(url, options.userAgent);
    const parsed = parseCatalogPage(html, page, url);
    totalHint = totalHint ?? parsed.totalHint;

    for (const model of parsed.models) {
      seen.set(model.name.toLowerCase(), model);
    }

    options.onPage?.({ page, url, found: parsed.models.length, totalHint: parsed.totalHint });

    if (parsed.models.length === 0) break;
    if (totalHint && seen.size >= totalHint) break;
    await sleep(delayMs);
  }

  return {
    models: [...seen.values()].sort((left, right) => left.name.localeCompare(right.name)),
    totalHint
  };
}

export function parseCatalogPage(html: string, page: number, pageUrl = CATALOG_URL): {
  models: WalkmanModel[];
  totalHint?: number;
} {
  const $ = cheerio.load(html);
  const bodyText = $("body").text().replace(/\s+/g, " ");
  const totalHint = readTotalHint(bodyText);
  const models: WalkmanModel[] = [];

  $("h4 a").each((_, element) => {
    const name = cleanName($(element).text());
    if (!isModelName(name)) return;

    const href = $(element).attr("href");
    const card = $(element).closest(".card").first();
    const container = card.length ? card : $(element).closest("article, li, div, section").first();
    const localText = container.text().replace(/\s+/g, " ").trim();
    const year = readYear(localText);
    const description = cleanDescription(localText, name, year);
    const { maker, modelCode } = splitModelName(name);

    models.push({
      id: modelId(name),
      name,
      maker,
      modelCode,
      catalogUrl: href ? new URL(href, pageUrl).toString() : undefined,
      catalogImageUrl: readCatalogImageUrl($, container, pageUrl),
      catalogPage: page,
      year,
      description
    });
  });

  return {
    models: uniqueByName(models),
    totalHint
  };
}

export async function fetchWalkmanLandEbayOffers(
  catalogUrl: string,
  userAgent?: string
): Promise<WalkmanLandEbayOffer[]> {
  return parseWalkmanLandEbayOffers(await fetchTextWithRetry(catalogUrl, userAgent), catalogUrl);
}

export function parseWalkmanLandEbayOffers(html: string, pageUrl: string): WalkmanLandEbayOffer[] {
  const $ = cheerio.load(html);
  const offers: WalkmanLandEbayOffer[] = [];

  $(".ebay > div").each((_, element) => {
    const container = $(element);
    const link = container.find('a[href*="ebay."]').first();
    const itemUrlValue = link.attr("href");
    const title = cleanName(link.text());
    const priceUsd = parseUsdPrice(container.find("span").first().text());
    if (!itemUrlValue || !title || priceUsd === undefined) return;

    const itemUrl = toAbsoluteUrl(itemUrlValue, pageUrl);
    if (!itemUrl) return;
    const listingId = ebayListingId(itemUrl);
    if (!listingId) return;

    const imageValue = container.find("img").first().attr("data-src")
      || container.find("img").first().attr("src");
    offers.push({
      listingId,
      title,
      itemUrl,
      imageUrl: imageValue ? toAbsoluteUrl(imageValue, pageUrl) : undefined,
      priceUsd,
      sellerCountry: cleanName(container.find("b").first().text()) || undefined
    });
  });

  const seen = new Set<string>();
  return offers.filter((offer) => {
    if (seen.has(offer.listingId)) return false;
    seen.add(offer.listingId);
    return true;
  });
}

function readCatalogImageUrl(
  $: cheerio.CheerioAPI,
  container: cheerio.Cheerio<AnyNode>,
  pageUrl: string
): string | undefined {
  const srcset = container.find("source[data-srcset], source[srcset]").first().attr("data-srcset")
    || container.find("source[srcset]").first().attr("srcset");
  const srcsetUrl = firstSrcsetUrl(srcset);
  if (srcsetUrl) return toAbsoluteUrl(srcsetUrl, pageUrl);

  const img = container.find("img").first();
  const src = img.attr("data-src") || img.attr("src");
  if (!src || /\/loading\./i.test(src)) return undefined;
  return toAbsoluteUrl(src, pageUrl);
}

function firstSrcsetUrl(srcset?: string): string | undefined {
  return srcset
    ?.split(",")
    .map((item) => item.trim().split(/\s+/)[0])
    .find(Boolean);
}

function toAbsoluteUrl(value: string, pageUrl: string): string | undefined {
  try {
    return new URL(value, pageUrl).toString();
  } catch {
    return undefined;
  }
}

function parseUsdPrice(value: string): number | undefined {
  const match = value.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*\$/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

function ebayListingId(value: string): string | undefined {
  const match = value.match(/\/itm\/(?:[^/?]+\/)?(\d+)/i);
  return match?.[1];
}

function readTotalHint(text: string): number | undefined {
  const match = text.match(/Showing\s+\d+\s*-\s*\d+\s*\/\s*(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

function readYear(text: string): number | undefined {
  const match = text.match(/\b(19[6-9]\d|20[0-2]\d)\b/);
  return match ? Number(match[1]) : undefined;
}

function cleanDescription(text: string, name: string, year?: number): string | undefined {
  const withoutName = text.replace(name, " ");
  const withoutYear = year ? withoutName.replace(String(year), " ") : withoutName;
  const cleaned = withoutYear
    .replace(/\bCompare\b|\bGallery\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, 1000) : undefined;
}

function splitModelName(name: string): { maker?: string; modelCode?: string } {
  const [maker, ...rest] = name.split(/\s+/);
  return {
    maker: maker || undefined,
    modelCode: rest.join(" ") || undefined
  };
}

function cleanName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isModelName(value: string): boolean {
  if (!value || value.length < 4 || value.length > 80) return false;
  if (/^(compare|gallery|catalog|login|register)$/i.test(value)) return false;
  return /\b[A-Z0-9][A-Z0-9_.-]{1,}\b/.test(value);
}

function uniqueByName(models: WalkmanModel[]): WalkmanModel[] {
  const seen = new Map<string, WalkmanModel>();
  for (const model of models) seen.set(model.name.toLowerCase(), model);
  return [...seen.values()];
}

async function fetchTextWithRetry(url: string, userAgent?: string): Promise<string> {
  const attempts = Number(process.env.CATALOG_FETCH_RETRIES || 3);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchText(url, userAgent);
    } catch (error) {
      lastError = error;
      await sleep(4000 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchText(url: string, userAgent?: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent || process.env.CATALOG_USER_AGENT || "walkman-restoration-scout/1.0",
      Accept: "text/html,application/xhtml+xml"
    }
  });
  if (!response.ok) throw new Error(`Walkman.land HTTP ${response.status} for ${url}`);
  return response.text();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
