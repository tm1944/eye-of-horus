// Build src/data/bright-stars.json from the Yale Bright Star Catalogue, 5th revised ed.
// (Hoffleit & Warren 1991), CDS catalog V/50: https://cdsarc.cds.unistra.fr/viz-bin/cat/V/50
// Usage, from apps/web: node scripts/build-star-catalog.mjs
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const SOURCE = "https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz";
const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`${SOURCE}: HTTP ${response.status}`);
const gz = Buffer.from(await response.arrayBuffer());
const text = gunzipSync(gz).toString("latin1");

// Byte columns from the catalog ReadMe (1-indexed, inclusive).
const field = (line, from, to) => line.slice(from - 1, to).trim();
const stars = [];
for (const line of text.split("\n")) {
  const raH = field(line, 76, 77), vmag = field(line, 103, 107);
  if (!raH || !vmag) continue; // novae, galaxies, and other entries without a J2000 position or V magnitude
  const ra = 15 * (Number(raH) + Number(field(line, 78, 79)) / 60 + Number(field(line, 80, 83)) / 3600);
  const dec = (field(line, 84, 84) === "-" ? -1 : 1) * (Number(field(line, 85, 86)) + Number(field(line, 87, 88)) / 60 + Number(field(line, 89, 90)) / 3600);
  const bv = field(line, 110, 114);
  stars.push([ra, dec, Number(vmag), bv ? Number(bv) : 0.6]); // unknown color: roughly solar
}
stars.sort((a, b) => a[2] - b[2]); // brightest first, so a magnitude cutoff is a prefix

const round = (value, digits) => Number(value.toFixed(digits));
const output = {
  source: "Yale Bright Star Catalogue, 5th Revised Ed. (Hoffleit & Warren 1991), CDS V/50",
  url: SOURCE,
  sha256: createHash("sha256").update(gz).digest("hex"),
  fields: ["raDeg", "decDeg", "vmag", "bv"],
  epoch: "J2000",
  stars: stars.flatMap(([ra, dec, vmag, bv]) => [round(ra, 2), round(dec, 2), round(vmag, 2), round(bv, 2)]),
};
writeFileSync(new URL("../src/data/bright-stars.json", import.meta.url), JSON.stringify(output) + "\n");
console.log(`${stars.length} stars, source sha256 ${output.sha256}`);
