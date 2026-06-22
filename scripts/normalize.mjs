#!/usr/bin/env node
// Normalize raw source dumps in data/raw/* into data/sessions.json.
//
// Each source is messy in its own way, so we keep one small adapter per source.
// An adapter takes the raw file contents and returns an array of normalized sessions:
//   { id, title, host, venueId, start, end, description, url, tags }
// where start/end are ISO8601 with the Paris offset (+02:00 in June).
//
// Supported raw formats out of the box:
//   *.ics  -> parsed as iCalendar (lu.ma / Eventbrite / Sched exports)
//   *.json -> expected to already be an array of normalized-ish session objects
//
// Run: node scripts/normalize.mjs
// Add a new source by dropping its export into data/raw/ and (if needed) tweaking
// the host/venue mapping below.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename, extname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW_DIR = join(__dirname, "..", "data", "raw");
const OUT_PATH = join(__dirname, "..", "data", "sessions.json");
const VENUES_PATH = join(__dirname, "..", "data", "venues.json");

if (!existsSync(RAW_DIR)) mkdirSync(RAW_DIR, { recursive: true });

const venues = JSON.parse(readFileSync(VENUES_PATH, "utf8")).venues;
const venueIds = new Set(venues.map((v) => v.id));

// Map a free-text location string to a known venueId (best effort).
function guessVenue(locationText = "") {
  const t = locationText.toLowerCase();
  if (t.includes("palais")) return "palais";
  if (t.includes("majestic")) return "majestic";
  if (t.includes("marriott")) return "jwmarriott";
  if (t.includes("carlton")) return "carlton";
  if (t.includes("martinez")) return "martinez";
  if (t.includes("spotify")) return "spotifybeach";
  if (t.includes("croisette") || t.includes("beach") || t.includes("plage")) return "croisette";
  return "croisette"; // fallback so it still maps onto the map/walk matrix
}

// --- minimal iCalendar parser (enough for lu.ma / Eventbrite / Sched feeds) ---
function unfoldIcs(text) {
  // RFC5545 line folding: continuation lines start with a space or tab.
  return text.replace(/\r?\n[ \t]/g, "");
}

function parseIcsDate(value, params) {
  // value like 20260622T090000Z, 20260622T090000, or 20260622 (all-day)
  const tzid = (params.match(/TZID=([^;:]+)/) || [])[1];
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const [, y, mo, d, hh = "00", mm = "00", ss = "00", z] = m;
  if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss)).toISOString();
  // No 'Z' -> treat as Europe/Paris local (CEST = +02:00 in June).
  // tzid is ignored beyond this; Cannes events are all Paris time.
  return `${y}-${mo}-${d}T${hh}:${mm}:${ss}+02:00`;
}

function parseIcs(text, host) {
  const out = [];
  const blocks = unfoldIcs(text).split("BEGIN:VEVENT").slice(1);
  for (const block of blocks) {
    const body = block.split("END:VEVENT")[0];
    const field = (name) => {
      const re = new RegExp(`^${name}([^:\\n]*):(.*)$`, "m");
      const m = body.match(re);
      return m ? { params: m[1], value: m[2].trim() } : null;
    };
    const summary = field("SUMMARY");
    const dtstart = field("DTSTART");
    const dtend = field("DTEND");
    if (!summary || !dtstart) continue;
    const loc = field("LOCATION");
    const url = field("URL");
    const desc = field("DESCRIPTION");
    const uid = field("UID");
    const start = parseIcsDate(dtstart.value, dtstart.params);
    const end = dtend ? parseIcsDate(dtend.value, dtend.params) : start;
    out.push({
      id: `${host}-${(uid?.value || summary.value).replace(/[^a-z0-9]+/gi, "-").slice(0, 40).toLowerCase()}`,
      title: decodeIcsText(summary.value),
      host,
      venueId: guessVenue(loc?.value || ""),
      start,
      end,
      description: desc ? decodeIcsText(desc.value).slice(0, 500) : "",
      url: url?.value || "",
      tags: [host.toLowerCase()],
    });
  }
  return out;
}

function decodeIcsText(s) {
  return s.replace(/\\n/g, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

// host label derived from the raw filename, e.g. "canva.ics" -> "Canva", "luma-microsoft.json" -> "Microsoft"
function hostFromFilename(file) {
  let name = basename(file, extname(file)).replace(/^luma-|^eventbrite-|^raw-/i, "");
  return name
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function normalizeJsonObjects(arr, host) {
  return arr.map((s, i) => ({
    id: s.id || `${host}-${i}`,
    title: s.title,
    host: s.host || host,
    venueId: venueIds.has(s.venueId) ? s.venueId : guessVenue(s.venue || s.location || s.venueId || ""),
    room: s.room || "",
    start: s.start,
    end: s.end || s.start,
    description: s.description || "",
    url: s.url || "",
    registerUrl: s.registerUrl || "",
    tags: s.tags || [host.toLowerCase()],
  }));
}

const all = [];
const files = existsSync(RAW_DIR) ? readdirSync(RAW_DIR) : [];
for (const file of files) {
  const path = join(RAW_DIR, file);
  const ext = extname(file).toLowerCase();
  const host = hostFromFilename(file);
  try {
    if (ext === ".ics") {
      all.push(...parseIcs(readFileSync(path, "utf8"), host));
    } else if (ext === ".json") {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      const arr = Array.isArray(parsed) ? parsed : parsed.sessions || [];
      all.push(...normalizeJsonObjects(arr, host));
    }
  } catch (e) {
    console.error(`Skipping ${file}: ${e.message}`);
  }
}

if (all.length === 0) {
  console.log("No raw sources found in data/raw/. Keeping existing data/sessions.json.");
  process.exit(0);
}

// de-dupe by id first, then collapse the same session arriving from two sources
// (same title + same start time) — keep the richer entry (longer description).
const byId = new Map();
for (const s of all) byId.set(s.id, s);

const byTitleTime = new Map();
for (const s of byId.values()) {
  const key = `${(s.title || "").toLowerCase().trim()}|${s.start}`;
  const existing = byTitleTime.get(key);
  if (!existing || (s.description || "").length > (existing.description || "").length) {
    byTitleTime.set(key, s);
  }
}
const sessions = [...byTitleTime.values()].sort((a, b) => (a.start < b.start ? -1 : 1));

writeFileSync(
  OUT_PATH,
  JSON.stringify({ _comment: "Generated by scripts/normalize.mjs", sessions }, null, 2) + "\n"
);
console.log(`Wrote ${sessions.length} sessions to data/sessions.json from ${files.length} raw file(s).`);
