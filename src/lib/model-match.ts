import type { WalkmanModel } from "@/lib/types";

export function modelCodeMatches(modelCode: string | undefined, title: string): boolean {
  if (!modelCode) return false;
  const parts = modelCode.match(/[a-z]+|\d+/gi) || [];
  if (!parts.length) return false;
  const pattern = parts.map(escapeRegex).join("[^a-z0-9]*");
  return new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, "i").test(title);
}

export function modelTitleMatches(model: WalkmanModel, title: string): boolean {
  if (model.modelCode) {
    return modelCodeMatches(model.modelCode, title);
  }

  const tokens = model.name
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && token !== "walkman");
  if (!tokens.length) return false;
  const lowerTitle = title.toLowerCase();
  return tokens.filter((token) => lowerTitle.includes(token)).length >= Math.min(2, tokens.length);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
