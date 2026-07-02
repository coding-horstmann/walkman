export type ScanRunType =
  | "catalog"
  | "ebay_sold"
  | "ebay_market"
  | "walkman_land_market"
  | "ebay_damaged"
  | "vinted_sourcing"
  | "vinted_fr_sourcing"
  | "kleinanzeigen_sourcing"
  | "wallapop_sourcing"
  | "monthly";

export type ScanRunStatus = "running" | "completed" | "failed";

export type ScanError = {
  scope: string;
  message: string;
  detail?: string;
};

export type ScanRun = {
  id: string;
  runType: ScanRunType;
  startedAt: string;
  finishedAt?: string;
  status: ScanRunStatus;
  modelsFound: number;
  modelsSaved: number;
  salesFound: number;
  salesSaved: number;
  marketListingsFound: number;
  marketListingsSaved: number;
  candidatesFound: number;
  candidatesSaved: number;
  errors: ScanError[];
};

export type WalkmanModel = {
  id: string;
  name: string;
  maker?: string;
  modelCode?: string;
  catalogUrl?: string;
  catalogImageUrl?: string;
  catalogPage?: number;
  year?: number;
  description?: string;
  firstSeen?: string;
  lastSeen?: string;
};

export type EbayMoney = {
  amount?: number;
  currency?: string;
};

export type SourcePlatform = "ebay" | "walkman_land" | "vinted" | "vinted_fr" | "kleinanzeigen" | "wallapop";
export type PlatformSourcingPlatform = "vinted" | "vinted_fr" | "kleinanzeigen" | "wallapop";

export type ListingFormat = "fixed" | "auction" | "hybrid" | "unknown";
export type ListingConditionBucket = "functional" | "defective" | "unknown";

export type EbayListingBase = {
  listingId: string;
  title: string;
  itemUrl: string;
  imageUrl?: string;
  priceAmount?: number;
  priceCurrency?: string;
  condition?: string;
  sellerName?: string;
  sellerAccountType?: string;
  sourcePlatform?: SourcePlatform;
  listingFormat?: ListingFormat;
  buyingOptions?: string[];
  itemEndDate?: string;
  location?: string;
  sourceQueryType?: string;
  rawData: Record<string, unknown>;
};

export type MarketSale = EbayListingBase & {
  id: string;
  modelId: string;
  soldAt?: string;
  source: "ebay_marketplace_insights";
};

export type MarketListing = EbayListingBase & {
  id: string;
  modelId: string;
  query: string;
  observedAt: string;
};

export type RepairCandidate = EbayListingBase & {
  id: string;
  modelId: string;
  query: string;
  issueTerms: string[];
  observedAt: string;
  estimatedMarketValue?: number;
  expectedMargin?: number;
  marginPercent?: number;
  score: number;
  label: "hot" | "watch" | "thin" | "unknown";
  conditionBucket: ListingConditionBucket;
};

export type ListingLink = {
  title: string;
  itemUrl: string;
  priceAmount?: number;
  priceCurrency?: string;
  imageUrl?: string;
  sourcePlatform: SourcePlatform;
  listingFormat: ListingFormat;
  conditionBucket: ListingConditionBucket;
  sellerAccountType?: string;
  condition?: string;
};

export type PlatformScanSnapshot = {
  rawResultCount: number;
  candidateCount: number;
  status: "completed" | "failed";
  scannedAt?: string;
  errorMessage?: string;
};

export type ModelMarketSummary = WalkmanModel & {
  salesCount: number;
  medianSoldPrice?: number;
  averageSoldPrice?: number;
  minSoldPrice?: number;
  maxSoldPrice?: number;
  marketListingCount: number;
  medianActivePrice?: number;
  averageActivePrice?: number;
  minActivePrice?: number;
  maxActivePrice?: number;
  ebayMarketListingCount: number;
  walkmanLandMarketListingCount: number;
  medianEbayActivePrice?: number;
  medianWalkmanLandActivePrice?: number;
  fixedMarketListingCount: number;
  auctionMarketListingCount: number;
  privateMarketListingCount: number;
  businessMarketListingCount: number;
  candidateCount: number;
  medianCandidatePrice?: number;
  medianDefectiveCandidatePrice?: number;
  defectiveCandidateCount: number;
  unknownCandidateCount: number;
  averageCandidatePrice?: number;
  minCandidatePrice?: number;
  maxCandidatePrice?: number;
  fixedCandidateCount: number;
  auctionCandidateCount: number;
  privateCandidateCount: number;
  businessCandidateCount: number;
  ebayCandidateCount: number;
  vintedCandidateCount: number;
  vintedFrCandidateCount: number;
  kleinanzeigenCandidateCount: number;
  wallapopCandidateCount: number;
  vintedLastScan?: PlatformScanSnapshot;
  vintedFrLastScan?: PlatformScanSnapshot;
  kleinanzeigenLastScan?: PlatformScanSnapshot;
  wallapopLastScan?: PlatformScanSnapshot;
  bestCandidatePrice?: number;
  bestCandidateMargin?: number;
  bestCandidateScore?: number;
  lastSaleSeen?: string;
  lastMarketListingSeen?: string;
  lastCandidateSeen?: string;
  ebaySoldResearchUrl: string;
  ebayActiveSearchUrl: string;
  ebayDamagedSearchUrl: string;
  marketLinks: ListingLink[];
  candidateLinks: ListingLink[];
};

export type DashboardData = {
  generatedAt: string;
  stats: {
    modelCount: number;
    valuedModelCount: number;
    salesCount: number;
    marketListingCount: number;
    marketValuedModelCount: number;
    candidateCount: number;
    hotCandidateCount: number;
    lastCatalogRun?: string;
    lastEbayRun?: string;
  };
  topModels: ModelMarketSummary[];
  candidates: Array<RepairCandidate & {
    modelName: string;
    maker?: string;
    medianSoldPrice?: number;
    medianActivePrice?: number;
    medianEbayActivePrice?: number;
    medianWalkmanLandActivePrice?: number;
    ebayActiveSearchUrl: string;
    marketLinks: ListingLink[];
    candidateLinks: ListingLink[];
  }>;
  runs: ScanRun[];
  dataSource: "database" | "api" | "empty";
};
