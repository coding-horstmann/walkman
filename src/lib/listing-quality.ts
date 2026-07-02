import type { EbayListingBase, ListingConditionBucket } from "@/lib/types";

const DOCUMENTATION_PATTERNS = [
  "service manual",
  "repair manual",
  "user manual",
  "owners manual",
  "owner manual",
  "bedienungsanleitung",
  "anleitung",
  "schaltplan",
  "schematic",
  "wartung",
  "manuel",
  "mode d emploi",
  "manual de servicio"
];

const ACCESSORY_TERMS = [
  "riemen",
  "belt",
  "fett",
  "ol",
  "oel",
  "oil",
  "grease",
  "gummi",
  "rubber",
  "kit",
  "kabel",
  "cable",
  "tasche",
  "case",
  "huelle",
  "remote",
  "fernbedienung",
  "akku",
  "battery",
  "cover",
  "andruckrolle",
  "pinch roller",
  "capstan",
  "gear",
  "zahnrad",
  "kopfhoerer",
  "headphone",
  "earphone",
  "correa",
  "courroie",
  "funda",
  "housse"
];

const FOR_CONNECTORS = ["fuer", "fur", "for", "fits", "compatible", "passend", "pour", "per", "para"];

const NON_AUTHENTIC_TERMS = [
  "clone",
  "clon",
  "replica",
  "replika",
  "replik",
  "reproduction",
  "reproduktion",
  "repro",
  "nachbau",
  "lookalike"
];

const DEFECT_OR_PARTS_TERMS = [
  "defekt",
  "defekte",
  "bastler",
  "ersatzteil",
  "ersatzteile",
  "not working",
  "nicht funktionsfaehig",
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
  "needs repair",
  "as is",
  "junk",
  "non funziona",
  "non funzionante",
  "guasto",
  "guasta",
  "rotto",
  "rotta",
  "difettoso",
  "difettosa",
  "per parti",
  "per parti di ricambio"
];

export function isLikelyAccessoryOrDocumentation(listing: Pick<EbayListingBase, "title">): boolean {
  const title = normalizeText(listing.title);
  if (!title) return true;
  if (DOCUMENTATION_PATTERNS.some((pattern) => title.includes(pattern))) return true;
  if (NON_AUTHENTIC_TERMS.some((term) => title.includes(term))) return true;
  if (startsWithAccessory(title)) return true;
  if (hasAccessoryForDevice(title)) return true;
  return false;
}

export function isLikelyDefectiveOrPartsListing(listing: Pick<EbayListingBase, "title" | "condition">): boolean {
  const text = normalizeText(`${listing.title} ${listing.condition || ""}`);
  return DEFECT_OR_PARTS_TERMS.some((term) => text.includes(term));
}

export function classifyListingCondition(listing: Pick<EbayListingBase, "title" | "condition" | "sourceQueryType"> & {
  issueTerms?: string[];
  assumedFunctional?: boolean;
}): ListingConditionBucket {
  if (listing.issueTerms?.length) return "defective";
  if (listing.sourceQueryType && /defect|parts|repair/i.test(listing.sourceQueryType)) return "defective";
  if (isLikelyDefectiveOrPartsListing(listing)) return "defective";

  const text = normalizeText(`${listing.title} ${listing.condition || ""}`);
  const functionalTerms = [
    "funktioniert",
    "funktionsfaehig",
    "fully working",
    "working",
    "tested",
    "works",
    "sehr gut",
    "gut",
    "good condition",
    "very good",
    "excellent",
    "tres bon etat",
    "bon etat",
    "buen estado",
    "funciona",
    "funziona"
  ];
  if (functionalTerms.some((term) => text.includes(term))) return "functional";
  if (listing.assumedFunctional) return "functional";
  return "unknown";
}

function startsWithAccessory(title: string): boolean {
  return ACCESSORY_TERMS.some((term) => title.startsWith(`${term} `) || title === term);
}

function hasAccessoryForDevice(title: string): boolean {
  const hasAccessory = ACCESSORY_TERMS.some((term) => title.includes(term));
  if (!hasAccessory) return false;
  return FOR_CONNECTORS.some((connector) => title.includes(` ${connector} `));
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
