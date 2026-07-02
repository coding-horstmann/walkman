import * as cheerio from "cheerio";
import type { EbayListingBase } from "@/lib/types";

export type KleinanzeigenSearchOptions = {
  limit?: number;
  timeoutMs?: number;
};

export class KleinanzeigenSearchClient {
  async search(query: string, options: KleinanzeigenSearchOptions = {}): Promise<EbayListingBase[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || Number(process.env.KLEINANZEIGEN_TIMEOUT_MS || 25_000));

    try {
      const url = new URL("https://www.kleinanzeigen.de/s-suchanfrage.html");
      url.searchParams.set("keywords", query);
      url.searchParams.set("sortingField", "SORTING_DATE");
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "Accept-Language": "de-DE,de;q=0.9,en;q=0.7",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
        }
      });
      const html = await response.text();
      if (!response.ok) throw new Error(`Kleinanzeigen HTTP ${response.status}`);
      if (isBlocked(html)) throw new Error("Kleinanzeigen block/captcha detected");
      return extractKleinanzeigenListings(html, options.limit || Number(process.env.KLEINANZEIGEN_RESULTS_PER_MODEL || 8));
    } finally {
      clearTimeout(timeout);
    }
  }
}

function extractKleinanzeigenListings(html: string, limit: number): EbayListingBase[] {
  const $ = cheerio.load(html);
  const listings: EbayListingBase[] = [];
  const seen = new Set<string>();

  $("article.aditem").each((_, element) => {
    if (listings.length >= limit) return false;
    const article = $(element);
    const href = article.attr("data-href") || article.find("a[href*='/s-anzeige/']").first().attr("href");
    if (!href) return;
    const itemUrl = absoluteUrl(href, "https://www.kleinanzeigen.de");
    if (seen.has(itemUrl)) return;
    seen.add(itemUrl);

    const title = cleanText(article.find(".aditem-main--middle h2 a").first().text() || article.find("h2").first().text() || "Kleinanzeigen listing");
    const text = cleanText(article.text());
    const priceText = cleanText(article.find(".aditem-main--middle--price-shipping--price").first().text());
    const price = parseEuro(priceText || text);
    const imageUrl = article.find("img").first().attr("src") || article.find("img").first().attr("data-src");
    const location = cleanText(article.find(".aditem-main--top--left").first().text());

    listings.push({
      listingId: article.attr("data-adid") || itemUrl,
      itemUrl,
      title,
      imageUrl,
      priceAmount: price,
      priceCurrency: price ? "EUR" : undefined,
      sellerAccountType: sellerTypeFromText(text),
      sourcePlatform: "kleinanzeigen",
      listingFormat: "fixed",
      buyingOptions: ["FIXED_PRICE"],
      location,
      rawData: { source: "kleinanzeigen", text: text.slice(0, 500) }
    });
  });

  return listings;
}

function sellerTypeFromText(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("gewerblich") || lower.includes("firma") || lower.includes("händler")) return "business";
  return "private";
}

function parseEuro(text: string): number | undefined {
  if (/vb|zu verschenken|kostenlos/i.test(text) && !/\d/.test(text)) return undefined;
  const match = text.match(/(\d{1,6}(?:\.\d{3})*(?:,\d{1,2})?|\d{1,6}(?:[.,]\d{1,2})?)\s*€/);
  if (!match) return undefined;
  const value = Number(match[1].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function absoluteUrl(href: string, origin: string): string {
  return href.startsWith("http") ? href : new URL(href, origin).toString();
}

function isBlocked(html: string): boolean {
  const text = html.toLowerCase();
  return text.includes("captcha") || text.includes("access denied") || text.includes("zugriff verweigert");
}
