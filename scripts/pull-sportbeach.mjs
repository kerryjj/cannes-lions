#!/usr/bin/env node
// Pull the Stagwell Sport Beach 2026 agenda into data/raw/sportbeach.json.
//
// Sport Beach (https://www.sportbeach.com/cannes2026/schedule) is a Next.js app.
// The full agenda is embedded in the page's __NEXT_DATA__ JSON blob under
// props.pageProps.initial.data.allEvents (no login / no API key needed).
//
// Each raw event looks like:
//   { title, startTime, endTime, location, description, speakers[], registrationLink, ... }
// times are UTC ("...Z"). We convert to Europe/Paris (CEST = +02:00 in June) and
// emit objects in the normalized-ish shape that scripts/normalize.mjs expects.
//
// Run: node scripts/pull-sportbeach.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW_DIR = join(__dirname, "..", "data", "raw");
const URL = "https://www.sportbeach.com/cannes2026/schedule";

// Strip HTML tags / collapse whitespace from the rich-text descriptions.
function clean(html = "") {
  return String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// UTC ISO ("2026-06-24T10:00:00.000Z") -> Paris local ISO with +02:00 offset.
function toParis(isoZ) {
  if (!isoZ) return null;
  const d = new Date(isoZ);
  const paris = new Date(d.getTime() + 2 * 60 * 60 * 1000); // June = CEST = UTC+2
  return paris.toISOString().replace(/\.\d{3}Z$/, "+02:00");
}

const res = await fetch(URL, {
  headers: {
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    accept: "text/html",
  },
});
if (!res.ok) throw new Error(`Sport Beach fetch failed: HTTP ${res.status}`);
const html = await res.text();

const m = html.match(
  /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
);
if (!m) throw new Error("Could not find __NEXT_DATA__ in Sport Beach page");
const next = JSON.parse(m[1]);
const allEvents = next?.props?.pageProps?.initial?.data?.allEvents;
if (!Array.isArray(allEvents))
  throw new Error("allEvents array not found in __NEXT_DATA__");

const sessions = allEvents
  .filter((e) => e.startTime && e.title && e.displayOnAgenda !== false)
  .map((e) => {
    const speakers = (e.speakers || [])
      .filter(Boolean)
      .map((s) =>
        [s.firstName, s.lastName].filter(Boolean).join(" ") +
        (s.sport ? ` (${s.sport})` : "")
      )
      .map((s) => s.trim())
      .filter(Boolean);
    const subVenue = clean(e.location || "");
    const descParts = [];
    if (speakers.length) descParts.push("With: " + speakers.join(", "));
    if (e.description) descParts.push(clean(e.description));
    return {
      id: `sportbeach-${e.id || e.cventId || e.title}`
        .replace(/[^a-z0-9]+/gi, "-")
        .slice(0, 60)
        .toLowerCase(),
      title: clean(e.title),
      host: "Sport Beach",
      venueId: "sportbeach", // all sub-areas live inside the Sport Beach venue
      start: toParis(e.startTime),
      end: toParis(e.endTime || e.startTime),
      description: [subVenue ? `Area: ${subVenue}.` : "", ...descParts]
        .filter(Boolean)
        .join(" ")
        .slice(0, 500),
      url: URL, // the agenda page — for verifying time/place
      registerUrl: e.registrationLink || "", // optional RSVP/registration link
      tags: ["sportbeach", "stagwell", "sport"].concat(
        subVenue ? [subVenue.toLowerCase()] : []
      ),
    };
  })
  .sort((a, b) => (a.start < b.start ? -1 : 1));

mkdirSync(RAW_DIR, { recursive: true });
const out = join(RAW_DIR, "sportbeach.json");
writeFileSync(out, JSON.stringify(sessions, null, 2) + "\n");
console.log(`Wrote ${sessions.length} Sport Beach sessions to ${out}`);
