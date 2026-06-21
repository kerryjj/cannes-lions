#!/usr/bin/env node
// Pull public lu.ma calendars into data/raw/luma-<name>.json.
//
// lu.ma exposes public JSON with no login/key:
//   resolve a slug -> ids:   https://api.lu.ma/url?url=<slug>
//                            -> data.calendar.api_id ("cal-...")
//   calendar items JSON:     https://api.lu.ma/calendar/get-items?calendar_api_id=cal-XXXX&period=future&pagination_limit=100
// Times are UTC; we convert to Europe/Paris (CEST = +02:00 in June).
//
// Add more Cannes lu.ma calendars by dropping their slug into SOURCES below.
// Run: node scripts/pull-luma.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW_DIR = join(__dirname, "..", "data", "raw");

// slug (as in luma.com/<slug>) -> { name, host } used for the output file + label.
const SOURCES = [
  { slug: "inkwellcannes2026", name: "inkwell", host: "Inkwell Beach" },
];

function toParis(isoZ) {
  if (!isoZ) return null;
  const d = new Date(isoZ);
  const paris = new Date(d.getTime() + 2 * 60 * 60 * 1000); // June = CEST = UTC+2
  return paris.toISOString().replace(/\.\d{3}Z$/, "+02:00");
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

mkdirSync(RAW_DIR, { recursive: true });

for (const src of SOURCES) {
  try {
    const resolved = await getJson(
      `https://api.lu.ma/url?url=${encodeURIComponent(src.slug)}`
    );
    const calId = resolved?.data?.calendar?.api_id;
    if (!calId) {
      console.error(`No calendar id for ${src.slug}; skipping`);
      continue;
    }
    const items = await getJson(
      `https://api.lu.ma/calendar/get-items?calendar_api_id=${calId}&period=future&pagination_limit=100`
    );
    const entries = items?.entries || [];
    const sessions = entries
      .map((row) => row.event)
      .filter((e) => e && e.start_at)
      .filter((e) => (e.start_at || "").startsWith("2026")) // Cannes week only
      .map((e) => {
        const loc =
          e.geo_address_info?.address ||
          e.geo_address_info?.full_address ||
          e.geo_address_info?.city ||
          "";
        return {
          id: `luma-${e.api_id}`.toLowerCase(),
          title: e.name,
          host: src.host,
          venue: loc, // normalize.mjs maps free text -> venueId via guessVenue
          start: toParis(e.start_at),
          end: toParis(e.end_at || e.start_at),
          description: loc ? `Location: ${loc}.` : "",
          url: e.url
            ? e.url.startsWith("http")
              ? e.url
              : `https://luma.com/${e.url}`
            : `https://luma.com/${src.slug}`,
          tags: ["luma", src.name],
        };
      })
      .sort((a, b) => (a.start < b.start ? -1 : 1));

    const out = join(RAW_DIR, `luma-${src.name}.json`);
    writeFileSync(out, JSON.stringify(sessions, null, 2) + "\n");
    console.log(`Wrote ${sessions.length} sessions to ${out} (${calId})`);
  } catch (e) {
    console.error(`Failed ${src.slug}: ${e.message}`);
  }
}
