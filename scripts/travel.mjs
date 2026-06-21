#!/usr/bin/env node
// Compute an approximate walking-time matrix between venues.
// Method: haversine straight-line distance × 1.3 detour factor ÷ 80 m/min walking speed.
// Cannes is compact and flat along the Croisette, so this is good enough.
// Run: node scripts/travel.mjs   (rewrites data/venues.json with walkMatrix filled in)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VENUES_PATH = join(__dirname, "..", "data", "venues.json");

const DETOUR = 1.3; // straight-line → street distance fudge factor
const WALK_M_PER_MIN = 80; // ~4.8 km/h

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function walkMinutes(a, b) {
  if (a.id === b.id) return 0;
  const meters = haversineMeters(a, b) * DETOUR;
  return Math.max(1, Math.round(meters / WALK_M_PER_MIN));
}

const data = JSON.parse(readFileSync(VENUES_PATH, "utf8"));
const venues = data.venues;
const matrix = {};
for (const a of venues) {
  matrix[a.id] = {};
  for (const b of venues) {
    matrix[a.id][b.id] = walkMinutes(a, b);
  }
}
data.walkMatrix = matrix;
writeFileSync(VENUES_PATH, JSON.stringify(data, null, 2) + "\n");

console.log("Walk matrix (minutes):");
const ids = venues.map((v) => v.id);
console.log("".padEnd(14) + ids.map((i) => i.slice(0, 6).padStart(7)).join(""));
for (const a of ids) {
  console.log(a.slice(0, 13).padEnd(14) + ids.map((b) => String(matrix[a][b]).padStart(7)).join(""));
}
