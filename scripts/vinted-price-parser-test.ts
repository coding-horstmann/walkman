import assert from "node:assert/strict";
import { normalizeVintedItemUrl, parseVintedPriceText } from "@/lib/sources/vinted";

const cases: Array<[string, number]> = [
  ["1 150,00 \u20AC", 1150],
  ["1.150,00 \u20AC", 1150],
  ["1150,00 \u20AC", 1150],
  ["150,00 \u20AC", 150],
  ["1\u00A0150,00 \u20AC", 1150],
  ["1\u202F150,00 \u20AC", 1150]
];

for (const [input, expected] of cases) {
  assert.equal(parseVintedPriceText(input), expected, input);
}

assert.equal(
  normalizeVintedItemUrl("/items/8790873468-walkman-sony-tps-l2?referrer=catalog", "https://www.vinted.de"),
  "https://www.vinted.de/items/8790873468-walkman-sony-tps-l2"
);
assert.equal(
  normalizeVintedItemUrl("https://www.vinted.fr/items/8790873468-walkman-sony-tps-l2?referrer=catalog#x", "https://www.vinted.fr"),
  "https://www.vinted.fr/items/8790873468-walkman-sony-tps-l2"
);

console.log(`vinted parser ok (${cases.length} price cases + url normalization)`);
