import {
  Activity,
  BadgeEuro,
  CheckCircle2,
  CircleHelp,
  Database,
  ExternalLink,
  Filter,
  Gauge,
  Hammer,
  Link2,
  Radio,
  RefreshCcw,
  Store,
  UserRound,
  Wrench,
  XCircle
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { getDashboardData } from "@/lib/dashboard-data";
import type { DashboardData, ListingLink, PlatformScanSnapshot, RepairCandidate } from "@/lib/types";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0
});

const numberFormat = new Intl.NumberFormat("de-DE");
const sourcingPlatformSources = ["vinted", "vinted_fr", "kleinanzeigen", "wallapop"];
const nonEbaySources = [...sourcingPlatformSources, "walkman_land"];
const focusModelCodes = [
  "TPS-L2",
  "WM-3",
  "WM-2",
  "WM-D6C",
  "WM-D6",
  "WM-D3",
  "WM-DC2",
  "WM-DD",
  "WM-DD2",
  "WM-DD3",
  "WM-DD30",
  "WM-DD33",
  "DD-100",
  "WM-F5",
  "WM-30",
  "WM-501",
  "WM-701C",
  "WM-EX5",
  "HS-PC202",
  "HS-JX2000"
];

type PageSearchParams = Record<string, string | string[] | undefined>;
type DashboardScope = "focus" | "all";

export default async function Home({
  searchParams
}: {
  searchParams?: Promise<PageSearchParams>;
}) {
  const params = await searchParams;
  const data = await getDashboardData();
  const filters = readFilters(params);
  const isSourcingPlatformSource = sourcingPlatformSources.includes(filters.source);
  const isWalkmanLandSource = filters.source === "walkman_land";
  const brandOptions = [...new Set(data.topModels.map((model) => model.maker).filter(Boolean) as string[])].sort((left, right) => left.localeCompare(right));
  const filteredModels = data.topModels.filter((model) => {
    if (filters.scope === "focus" && !isFocusModel(model.name, model.modelCode)) return false;
    if (filters.brand && model.maker !== filters.brand) return false;
    if (filters.market && model.marketListingCount === 0) return false;
    const selectedMedian = marketMedianForSource(model, filters.marketPriceSource);
    if (filters.median && !selectedMedian) return false;
    if (filters.minMarketMedian && (!selectedMedian || selectedMedian < filters.minMarketMedian)) return false;
    if (filters.damaged && model.candidateCount === 0) return false;
    if (filters.format === "fixed" && model.fixedCandidateCount === 0) return false;
    if (filters.format === "auction" && model.auctionCandidateCount === 0) return false;
    if (filters.seller === "private" && model.privateCandidateCount + model.privateMarketListingCount === 0) return false;
    if (filters.seller === "business" && model.businessCandidateCount + model.businessMarketListingCount === 0) return false;
    if (filters.source === "ebay" && model.ebayCandidateCount + model.ebayMarketListingCount === 0) return false;
    if (filters.source === "walkman_land" && model.walkmanLandMarketListingCount === 0) return false;
    if (filters.source === "vinted" && model.vintedCandidateCount === 0) return false;
    if (filters.source === "vinted_fr" && model.vintedFrCandidateCount === 0) return false;
    if (filters.source === "kleinanzeigen" && model.kleinanzeigenCandidateCount === 0) return false;
    if (filters.source === "wallapop" && model.wallapopCandidateCount === 0) return false;
    return true;
  });
  const filteredCandidates = data.candidates.filter((candidate) => {
    if (filters.scope === "focus" && !isFocusModel(candidate.modelName)) return false;
    if (filters.brand && candidate.maker !== filters.brand) return false;
    if (filters.format && candidate.listingFormat !== filters.format) return false;
    if (filters.seller && candidate.sellerAccountType !== filters.seller) return false;
    if (filters.source && candidate.sourcePlatform !== filters.source) return false;
    return true;
  });

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-accent-strong">
              <Radio className="h-4 w-4" aria-hidden="true" />
              Walkman Restoration Scout
            </div>
            <h1 className="text-2xl font-semibold sm:text-3xl">
              Walkman-Kandidaten mit Wiederverkaufswert
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-foreground/70">
              Katalogbasis aus Walkman.land, aktive Marktangebote und aktuelle Sourcing-Angebote mit Zustand, Marge und Plattformlinks.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-foreground/70 sm:flex sm:items-center">
            <Pill label="Quelle" value={sourceLabel(data.dataSource)} />
            <Pill label="Stand" value={formatDate(data.generatedAt)} />
            <Link className="rounded-md border border-line bg-panel px-3 py-2 font-medium text-accent-strong hover:text-accent" href="/runs">
              Letzte Laeufe
            </Link>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Kennzahlen">
          <Metric icon={Database} label="Modelle" value={numberFormat.format(data.stats.modelCount)} />
          <Metric icon={BadgeEuro} label="Bewertet" value={numberFormat.format(data.stats.marketValuedModelCount)} />
          <Metric icon={Activity} label="Marktangebote" value={numberFormat.format(data.stats.marketListingCount)} />
          <Metric icon={Wrench} label="Kandidaten" value={numberFormat.format(data.stats.candidateCount)} />
          <Metric icon={Gauge} label="Hot" value={numberFormat.format(data.stats.hotCandidateCount)} tone="positive" />
        </section>

        <ScopeTabs activeScope={filters.scope} />

        <section className="min-w-0 rounded-lg border border-line bg-panel p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Beste Kandidaten</h2>
              <RefreshCcw className="h-4 w-4 text-foreground/50" aria-hidden="true" />
            </div>
            {filteredCandidates.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1290px] table-fixed border-collapse text-left text-sm">
                  <colgroup>
                    <col className="w-[360px]" />
                    <col className="w-[150px]" />
                    <col className="w-[150px]" />
                    <col className="w-[90px]" />
                    <col className="w-[340px]" />
                    <col className="w-[120px]" />
                    <col className="w-[80px]" />
                  </colgroup>
                  <thead className="border-b border-line text-xs text-foreground/55">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Angebot</th>
                      <th className="py-2 pr-3 font-medium">Zustand</th>
                      <th className="py-2 pr-3 font-medium">Modell</th>
                      <th className="py-2 pr-3 font-medium">Preis</th>
                      <th className="py-2 pr-3 font-medium">Marktwert</th>
                      <th className="py-2 pr-3 font-medium">Marge</th>
                      <th className="py-2 pr-3 font-medium">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCandidates.map((candidate) => (
                      <CandidateRow key={candidate.id} candidate={candidate} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState text="Noch keine Kandidaten fuer diese Auswahl gespeichert." />
            )}
        </section>

        <section id="catalog" className="scroll-mt-4 rounded-lg border border-line bg-panel p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Walkman-Katalog</h2>
            <span className="text-xs text-foreground/55">
              {numberFormat.format(filteredModels.length)} / {numberFormat.format(data.topModels.length)} Modelle
              {data.stats.lastCatalogRun ? ` - Katalog: ${formatDate(data.stats.lastCatalogRun)}` : ""}
            </span>
          </div>
          <form className="mb-4 rounded-md border border-line bg-background p-3 text-sm" action="/#catalog">
            <input type="hidden" name="scope" value={filters.scope} />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <label className="grid gap-1 text-xs font-medium text-foreground/60">
                Marke
                <select
                  name="brand"
                  defaultValue={filters.brand}
                  className="h-10 rounded-md border border-line bg-panel px-3 text-sm text-foreground outline-none focus:border-accent"
                >
                  <option value="">Alle Marken</option>
                  {brandOptions.map((brand) => (
                    <option key={brand} value={brand}>{brand}</option>
                  ))}
                </select>
              </label>
              <SelectFilter name="source" label="Quelle" value={filters.source} options={[
                ["", "Alle Quellen"],
                ["ebay", "eBay"],
                ["walkman_land", "Walkman.land"],
                ["vinted", "Vinted DE"],
                ["vinted_fr", "Vinted FR"],
                ["kleinanzeigen", "Kleinanzeigen"],
                ["wallapop", "Wallapop ES"]
              ]} />
              {isSourcingPlatformSource ? (
                <StaticFilterNote label="Angebotsart" value="Festpreis" detail="Plattform-Quellen" />
              ) : isWalkmanLandSource ? (
                <StaticFilterNote label="Angebotsart" value="Nicht ausgewiesen" detail="Walkman.land/eBay" />
              ) : (
                <SelectFilter name="format" label="eBay-Angebotsart" value={filters.format} options={[
                  ["", "Alle eBay-Arten"],
                  ["fixed", "Festpreis"],
                  ["auction", "Auktion"]
                ]} />
              )}
              <SelectFilter name="seller" label="Verkaeufer" value={filters.seller} options={[
                ["", "Alle"],
                ["private", "Privat"],
                ["business", "Gewerblich"]
              ]} />
              <SelectFilter name="marketPriceSource" label="Marktwert-Quelle" value={filters.marketPriceSource} options={[
                ["combined", "Gesamtmedian"],
                ["ebay", "eBay-Median"],
                ["walkman_land", "Walkman.land-Median"]
              ]} />
              <NumberFilter
                name="minMarketMedian"
                label="Median mindestens"
                value={filters.minMarketMedian}
                suffix="EUR"
              />
            </div>
            <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex flex-wrap gap-2">
                <FilterOption name="market" label="Mit Marktangeboten" checked={filters.market} />
                <FilterOption name="median" label="Mit Markt-Median" checked={filters.median} />
                <FilterOption name="damaged" label="Mit Kandidaten" checked={filters.damaged} />
              </div>
              <div className="flex shrink-0 items-end gap-2">
                <button className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-3 text-sm font-semibold text-white" type="submit">
                  <Filter className="h-4 w-4" aria-hidden="true" />
                  Filtern
                </button>
                <Link className="inline-flex h-10 items-center rounded-md border border-line px-3 text-sm font-medium text-foreground/70" href="/#catalog">
                  Zuruecksetzen
                </Link>
              </div>
            </div>
          </form>
          {filteredModels.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredModels.map((model) => (
                <article key={model.id} className="rounded-lg border border-line bg-panel-muted p-3">
                  <div className="flex items-start gap-3">
                    {model.catalogImageUrl ? (
                      <Image
                        src={model.catalogImageUrl}
                        alt={`${model.name} Produktfoto`}
                        width={72}
                        height={72}
                        unoptimized
                        className="h-[72px] w-[72px] shrink-0 rounded-md border border-line bg-background object-contain"
                      />
                    ) : (
                      <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-md border border-line bg-background">
                        <Radio className="h-6 w-6 text-foreground/35" aria-hidden="true" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold">{model.name}</h3>
                          <p className="mt-1 text-xs text-foreground/60">
                            {model.maker || "Hersteller offen"}
                            {model.modelCode ? ` - ${model.modelCode}` : ""}
                          </p>
                        </div>
                        <span className="rounded-md bg-background px-2 py-1 text-xs font-medium text-accent-strong">
                          {model.bestCandidateScore ?? 0}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                        <MiniStat label="Funktionsfaehig" value={formatMoney(model.medianActivePrice)} />
                        <MiniStat label="Defekt" value={formatMoney(model.medianDefectiveCandidatePrice)} />
                        <MiniStat label="eBay-Median" value={formatMoney(model.medianEbayActivePrice)} />
                        <MiniStat label="Walkman.land" value={formatMoney(model.medianWalkmanLandActivePrice)} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1 text-[11px] text-foreground/65">
                        <Badge icon={Activity} text={`${model.ebayMarketListingCount} eBay aktiv`} />
                        <Badge icon={Activity} text={`${model.walkmanLandMarketListingCount} Walkman.land`} />
                        <Badge icon={Hammer} text={`${model.auctionCandidateCount} Auktion`} />
                        <Badge icon={Store} text={`${model.businessCandidateCount} gewerblich`} />
                        <Badge icon={UserRound} text={`${model.privateCandidateCount} privat`} />
                      </div>
                      <div className="mt-2 grid gap-1 text-[11px] text-foreground/65 sm:grid-cols-2">
                        <PlatformScanChip label="Vinted DE" scan={model.vintedLastScan} />
                        <PlatformScanChip label="Vinted FR" scan={model.vintedFrLastScan} />
                        <PlatformScanChip label="Kleinanzeigen" scan={model.kleinanzeigenLastScan} />
                        <PlatformScanChip label="Wallapop ES" scan={model.wallapopLastScan} />
                      </div>
                      <ListingLinks
                        label="Funktionsfaehig"
                        links={model.marketLinks.filter((link) => link.conditionBucket === "functional")}
                        fallbackLinks={[{ href: model.ebayActiveSearchUrl, label: "eBay oeffnen" }]}
                        showCondition
                      />
                      <ListingLinks
                        label="Defekt"
                        links={model.candidateLinks.filter((link) => link.conditionBucket === "defective")}
                        showCondition
                      />
                      <ListingLinks
                        label="Unbekannt / Preis-Potenzial"
                        links={model.candidateLinks.filter((link) => link.conditionBucket === "unknown")}
                        showCondition
                      />
                      <ListingLinks
                        label="Externe Suche"
                        links={[]}
                        fallbackLinks={platformSearchLinks(model)}
                      />
                      <div className="mt-3 flex flex-wrap gap-3">
                        <ExternalTextLink href={model.ebaySoldResearchUrl} label="Verkaufte bei eBay" />
                        <ExternalTextLink href={model.ebayActiveSearchUrl} label="eBay aktiv" />
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState text="Keine Modelle fuer diese Filter." />
          )}
        </section>
      </div>
    </main>
  );
}

function readFilters(params?: PageSearchParams) {
  const source = firstParam(params?.source);
  const rawFormat = firstParam(params?.format);
  const scope: DashboardScope = firstParam(params?.scope) === "all" ? "all" : "focus";
  return {
    scope,
    brand: firstParam(params?.brand),
    market: firstParam(params?.market) === "1" || firstParam(params?.sales) === "1",
    median: firstParam(params?.median) === "1",
    damaged: firstParam(params?.damaged) === "1",
    source,
    format: nonEbaySources.includes(source) ? "" : rawFormat,
    seller: firstParam(params?.seller),
    marketPriceSource: readMarketPriceSource(firstParam(params?.marketPriceSource)),
    minMarketMedian: readPositiveNumber(firstParam(params?.minMarketMedian))
  };
}

function ScopeTabs({ activeScope }: { activeScope: DashboardScope }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        className={`rounded-md border px-3 py-2 text-sm font-medium ${activeScope === "focus" ? "border-accent bg-accent text-white" : "border-line bg-panel text-foreground/75 hover:text-accent"}`}
        href="/?scope=focus#catalog"
      >
        Fokus 20
      </Link>
      <Link
        className={`rounded-md border px-3 py-2 text-sm font-medium ${activeScope === "all" ? "border-accent bg-accent text-white" : "border-line bg-panel text-foreground/75 hover:text-accent"}`}
        href="/?scope=all#catalog"
      >
        Alle Modelle
      </Link>
    </div>
  );
}

function isFocusModel(name: string, modelCode?: string): boolean {
  return focusModelCodes.some((code) => focusCodeMatches(code, name) || (modelCode ? focusCodeMatches(code, modelCode) : false));
}

function focusCodeMatches(code: string, value: string): boolean {
  const parts = code.match(/[a-z]+|\d+/gi) || [];
  if (!parts.length) return false;
  const pattern = parts.map(escapeRegex).join("[^a-z0-9]*");
  return new RegExp(`(^|[^a-z0-9])${pattern}(?=[^a-z0-9]|$)`, "i").test(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readMarketPriceSource(value: string): "combined" | "ebay" | "walkman_land" {
  if (value === "ebay" || value === "walkman_land") return value;
  return "combined";
}

function readPositiveNumber(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function marketMedianForSource(
  model: DashboardData["topModels"][number],
  source: "combined" | "ebay" | "walkman_land"
): number | undefined {
  if (source === "ebay") return model.medianEbayActivePrice;
  if (source === "walkman_land") return model.medianWalkmanLandActivePrice;
  return model.medianActivePrice;
}

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function Metric({
  icon: Icon,
  label,
  value,
  tone = "default"
}: {
  icon: typeof Database;
  label: string;
  value: string;
  tone?: "default" | "positive";
}) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-foreground/60">{label}</span>
        <Icon className={tone === "positive" ? "h-4 w-4 text-positive" : "h-4 w-4 text-accent"} aria-hidden="true" />
      </div>
      <div className="font-mono text-2xl font-semibold">{value}</div>
    </div>
  );
}

function CandidateRow({
  candidate
}: {
  candidate: DashboardData["candidates"][number];
}) {
  const marketHref = candidate.marketLinks[0]?.itemUrl || candidate.ebayActiveSearchUrl;
  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="max-w-[280px] py-3 pr-3">
        <div className="flex gap-3">
          {candidate.imageUrl ? (
            <Image
              src={candidate.imageUrl}
              alt=""
              width={48}
              height={48}
              unoptimized
              className="h-12 w-12 rounded-md border border-line object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-md border border-line bg-panel-muted">
              <Radio className="h-5 w-5 text-foreground/45" aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0">
            <a className="line-clamp-2 font-medium hover:text-accent-strong" href={candidate.itemUrl} target="_blank" rel="noreferrer">
              {candidate.title}
            </a>
            <div className="mt-1 flex flex-wrap gap-1 text-xs text-foreground/55">
              <span className="rounded bg-background px-1.5 py-0.5">{sourceName(candidate.sourcePlatform)}</span>
              <span className="rounded bg-background px-1.5 py-0.5">{formatName(candidate.listingFormat)}</span>
              {candidate.sellerAccountType ? (
                <span className="rounded bg-background px-1.5 py-0.5">{sellerName(candidate.sellerAccountType)}</span>
              ) : null}
              {candidate.issueTerms.slice(0, 3).map((term) => (
                <span key={term} className="rounded bg-background px-1.5 py-0.5">{term}</span>
              ))}
              <a
                className="inline-flex items-center gap-1 rounded bg-background px-1.5 py-0.5 text-accent-strong hover:text-accent"
                href={ebaySoldResearchUrlForKeywords(candidate.title)}
                target="_blank"
                rel="noreferrer"
              >
                eBay verkauft
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>
      </td>
      <td className="py-3 pr-3">
        <ConditionBadge bucket={candidate.conditionBucket} />
      </td>
      <td className="py-3 pr-3">
        <div className="font-medium">{candidate.modelName}</div>
        <div className="text-xs text-foreground/55">{candidate.maker || "Hersteller offen"}</div>
      </td>
      <td className="py-3 pr-3 font-mono">{formatMoney(candidate.priceAmount)}</td>
      <td className="py-3 pr-3">
        <div className="font-mono">{formatMoney(candidate.medianActivePrice)}</div>
        <div className="mt-1 text-[11px] text-foreground/50">
          eBay {formatMoney(candidate.medianEbayActivePrice)} / Walkman.land {formatMoney(candidate.medianWalkmanLandActivePrice)}
        </div>
        <CandidateDisclosure label="Alle Kandidaten" links={candidate.candidateLinks} showCondition />
        <CandidateDisclosure
          label="Marktwerte"
          links={candidate.marketLinks}
          fallbackLinks={[{ href: marketHref, label: "eBay oeffnen" }]}
          showCondition
        />
      </td>
      <td className={candidate.expectedMargin && candidate.expectedMargin > 0 ? "py-3 pr-3 font-mono text-positive" : "py-3 pr-3 font-mono text-foreground/60"}>
        {formatMoney(candidate.expectedMargin)}
      </td>
      <td className="py-3 pr-3">
        <span className={`rounded-md px-2 py-1 font-mono text-xs font-semibold ${scoreClass(candidate.label)}`}>
          {candidate.score}
        </span>
      </td>
    </tr>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-background px-2 py-2">
      <div className="text-foreground/50">{label}</div>
      <div className="mt-1 truncate font-mono font-semibold">{value}</div>
    </div>
  );
}

function FilterOption({ name, label, checked }: { name: string; label: string; checked: boolean }) {
  return (
    <label className="flex min-h-10 items-center gap-2 rounded-md border border-line bg-panel px-3 py-2 text-sm leading-tight text-foreground/75">
      <input
        className="h-4 w-4 accent-[var(--accent)]"
        type="checkbox"
        name={name}
        value="1"
        defaultChecked={checked}
      />
      {label}
    </label>
  );
}

function StaticFilterNote({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="grid gap-1 text-xs font-medium text-foreground/60">
      {label}
      <div className="flex h-10 flex-col justify-center rounded-md border border-line bg-panel px-3 text-sm text-foreground">
        <span>{value}</span>
        <span className="text-[11px] text-foreground/50">{detail}</span>
      </div>
    </div>
  );
}

function SelectFilter({
  name,
  label,
  value,
  options
}: {
  name: string;
  label: string;
  value: string;
  options: Array<[string, string]>;
}) {
  return (
    <label className="grid gap-1 text-xs font-medium text-foreground/60">
      {label}
      <select
        name={name}
        defaultValue={value}
        className="h-10 rounded-md border border-line bg-panel px-3 text-sm text-foreground outline-none focus:border-accent"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue || "all"} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}

function NumberFilter({
  name,
  label,
  value,
  suffix
}: {
  name: string;
  label: string;
  value?: number;
  suffix: string;
}) {
  return (
    <label className="grid gap-1 text-xs font-medium text-foreground/60">
      {label}
      <div className="flex h-10 items-center rounded-md border border-line bg-panel focus-within:border-accent">
        <input
          name={name}
          type="number"
          min="0"
          step="10"
          defaultValue={value}
          placeholder="0"
          className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-foreground outline-none"
        />
        <span className="pr-3 text-xs text-foreground/45">{suffix}</span>
      </div>
    </label>
  );
}

function Badge({ icon: Icon, text }: { icon: typeof Hammer; text: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-background px-1.5 py-0.5">
      <Icon className="h-3 w-3" aria-hidden="true" />
      {text}
    </span>
  );
}

function PlatformScanChip({
  label,
  scan
}: {
  label: string;
  scan?: PlatformScanSnapshot;
}) {
  const value = scan
    ? scan.status === "failed"
      ? "Fehler"
      : `${numberFormat.format(scan.rawResultCount)} Treffer / ${numberFormat.format(scan.candidateCount)} Kandidaten`
    : "noch kein Scan";

  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded bg-background px-2 py-1">
      <span className="font-medium text-foreground/55">{label}</span>
      <span className="truncate font-mono text-foreground/75" title={scan?.errorMessage || value}>{value}</span>
    </div>
  );
}

function ConditionBadge({ bucket }: { bucket: ListingLink["conditionBucket"] }) {
  const Icon = bucket === "functional" ? CheckCircle2 : bucket === "defective" ? XCircle : CircleHelp;
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${conditionClass(bucket)}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {conditionName(bucket)}
    </span>
  );
}

function ListingLinks({
  label,
  links,
  fallbackLinks,
  showCondition = false
}: {
  label: string;
  links: ListingLink[];
  fallbackLinks?: Array<{ href: string; label: string }>;
  showCondition?: boolean;
}) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-foreground/50">
        <Link2 className="h-3 w-3" aria-hidden="true" />
        {label}
      </div>
      <LinkChips links={links} fallbackLinks={fallbackLinks} showCondition={showCondition} />
    </div>
  );
}

function LinkChips({
  links,
  fallbackLinks,
  showCondition = false
}: {
  links: ListingLink[];
  fallbackLinks?: Array<{ href: string; label: string }>;
  showCondition?: boolean;
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {links.length ? links.map((link) => (
        <span key={link.itemUrl} className="inline-flex max-w-full flex-wrap gap-1">
          <a
            className="max-w-full truncate rounded bg-background px-2 py-1 text-[11px] font-medium text-accent-strong hover:text-accent"
            href={link.itemUrl}
            target="_blank"
            rel="noreferrer"
            title={link.title}
          >
            {formatMoney(link.priceAmount)} - {sourceName(link.sourcePlatform)}
            {showCondition ? ` - ${conditionName(link.conditionBucket)}` : ""}
          </a>
          <a
            className="rounded border border-line bg-background px-2 py-1 text-[11px] font-medium text-foreground/60 hover:text-accent"
            href={ebaySoldResearchUrlForKeywords(link.title)}
            target="_blank"
            rel="noreferrer"
            title={`Verkaufte eBay-Daten fuer ${link.title}`}
          >
            eBay verkauft
          </a>
        </span>
      )) : fallbackLinks?.length ? fallbackLinks.map((link) => (
        <a
          key={link.href}
          className="rounded bg-background px-2 py-1 text-[11px] font-medium text-accent-strong hover:text-accent"
          href={link.href}
          target="_blank"
          rel="noreferrer"
        >
          {link.label}
        </a>
      )) : <span className="text-[11px] text-foreground/40">Keine geprueften Angebote</span>}
    </div>
  );
}

function CandidateDisclosure({
  label,
  links,
  fallbackLinks,
  showCondition = false
}: {
  label: string;
  links: ListingLink[];
  fallbackLinks?: Array<{ href: string; label: string }>;
  showCondition?: boolean;
}) {
  return (
    <details className="group mt-1">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-accent-strong hover:text-accent [&::-webkit-details-marker]:hidden">
        <span className="inline-block w-3 text-center text-[10px] transition-transform group-open:rotate-90">▶</span>
        {label}
      </summary>
      <div className="mt-2 max-h-56 max-w-[320px] overflow-y-auto rounded-md border border-line bg-background p-2 shadow-sm">
        <LinkChips links={links} fallbackLinks={fallbackLinks} showCondition={showCondition} />
      </div>
    </details>
  );
}

function ExternalTextLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      className="inline-flex items-center gap-1 text-xs font-medium text-accent-strong hover:text-accent"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {label}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-panel px-3 py-2">
      <span className="mr-2 text-foreground/45">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-panel-muted px-4 py-8 text-center text-sm text-foreground/60">
      {text}
    </div>
  );
}

function formatMoney(value?: number): string {
  return value ? money.format(value) : "-";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function sourceLabel(source: DashboardData["dataSource"]): string {
  if (source === "api") return "Railway API";
  if (source === "database") return "Postgres";
  return "leer";
}

function sourceName(source?: string): string {
  if (source === "walkman_land") return "Walkman.land";
  if (source === "vinted") return "Vinted DE";
  if (source === "vinted_fr") return "Vinted FR";
  if (source === "kleinanzeigen") return "Kleinanzeigen";
  if (source === "wallapop") return "Wallapop ES";
  return "eBay";
}

function formatName(format?: string): string {
  if (format === "auction") return "Auktion";
  if (format === "hybrid") return "Auktion+Festpreis";
  if (format === "fixed") return "Festpreis";
  return "Format offen";
}

function sellerName(seller?: string): string {
  if (seller === "business") return "Gewerblich";
  if (seller === "private") return "Privat";
  return "Verkaeufer offen";
}

function conditionName(bucket: ListingLink["conditionBucket"]): string {
  if (bucket === "functional") return "Funktionsfaehig";
  if (bucket === "defective") return "Defekt";
  return "Unbekannt";
}

function conditionClass(bucket: ListingLink["conditionBucket"]): string {
  if (bucket === "functional") return "bg-positive/15 text-positive";
  if (bucket === "defective") return "bg-danger/15 text-danger";
  return "bg-foreground/10 text-foreground/60";
}

function platformSearchLinks(model: Pick<DashboardData["topModels"][number], "name" | "maker" | "modelCode">): Array<{ href: string; label: string }> {
  const query = exactSearchQueryForModel(model);
  const vintedDe = new URL("https://www.vinted.de/catalog");
  vintedDe.searchParams.set("search_text", query);
  vintedDe.searchParams.set("order", "newest_first");
  const vintedFr = new URL("https://www.vinted.fr/catalog");
  vintedFr.searchParams.set("search_text", query);
  vintedFr.searchParams.set("order", "newest_first");
  const kleinanzeigen = new URL("https://www.kleinanzeigen.de/s-suchanfrage.html");
  kleinanzeigen.searchParams.set("keywords", query);
  kleinanzeigen.searchParams.set("sortingField", "SORTING_DATE");
  const wallapop = new URL("https://es.wallapop.com/search");
  wallapop.searchParams.set("keywords", query);
  wallapop.searchParams.set("order_by", "newest");

  return [
    { href: ebaySearchUrlForQuery(query), label: "eBay Suche" },
    { href: vintedDe.toString(), label: "Vinted DE Suche" },
    { href: vintedFr.toString(), label: "Vinted FR Suche" },
    { href: kleinanzeigen.toString(), label: "Kleinanzeigen Suche" },
    { href: wallapop.toString(), label: "Wallapop ES Suche" }
  ];
}

function exactSearchQueryForModel(model: Pick<DashboardData["topModels"][number], "name" | "maker" | "modelCode">): string {
  if (model.modelCode) {
    return `"${[model.maker, model.modelCode].filter(Boolean).join(" ")}"`;
  }
  return `"${model.name}"`;
}

function ebaySearchUrlForQuery(query: string): string {
  const url = new URL("https://www.ebay.de/sch/i.html");
  url.searchParams.set("_nkw", query);
  url.searchParams.set("_sop", "10");
  return url.toString();
}

function ebaySoldResearchUrlForKeywords(keywords: string): string {
  const url = new URL("https://www.ebay.de/sh/research");
  url.searchParams.set("marketplace", "EBAY-DE");
  url.searchParams.set("keywords", keywords);
  url.searchParams.set("dayRange", "1095");
  url.searchParams.set("categoryId", "0");
  url.searchParams.set("tabName", "SOLD");
  url.searchParams.set("tz", "Europe/Berlin");
  url.searchParams.set("limit", "50");
  url.searchParams.set("offset", "0");
  return url.toString();
}

function scoreClass(label: RepairCandidate["label"]): string {
  if (label === "hot") return "bg-positive/15 text-positive";
  if (label === "watch") return "bg-accent/15 text-accent-strong";
  if (label === "thin") return "bg-warning/15 text-warning";
  return "bg-foreground/10 text-foreground/60";
}
