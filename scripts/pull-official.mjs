#!/usr/bin/env node
// Pull the official Cannes Lions 2026 programme into data/raw/official.json.
//
// The programme is PUBLIC (no login): the page calls a JSON API directly.
//   https://www.canneslions.com/api/schedule?siteName=canneslions&search=&agendaType=default
// -> { events: [ { title, description, eventHost, startTime:"HHMM", endTime:"HHMM",
//                  dateIso:"YYYYMMDD", eventLocation:{locationVenue,venue,venueSlug},
//                  eventType, eventThemes, speakerData[], titleSlug, eventId } ] }
// Times are Europe/Paris (CEST = +02:00 in June). Note this feed also lists brand
// activations (Sport Beach, Meta Beach, Canva, Microsoft Garden, etc.).
//
// Run: node scripts/pull-official.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW_DIR = join(__dirname, "..", "data", "raw");
const apiUrl = (agendaType) =>
  `https://www.canneslions.com/api/schedule?siteName=canneslions&search=&agendaType=${agendaType}`;
// The "default" agenda omits the sub-programmes (each festival experience is its
// own agendaType), so pull them all and merge — otherwise e.g. the LIONS Creators
// Beach sessions are missing. See /festival/experiences.
const AGENDA_TYPES = [
  "default",
  "lions-creators",
  "lions-sport",
  "lions-b2b",
  "lions-insights",
  "lions-global-forums",
];

function clean(html = "") {
  return String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// dateIso "20260622" + "HHMM" -> "2026-06-22T14:15:00+02:00"
function toIso(dateIso, hhmm) {
  if (!dateIso || !/^\d{8}$/.test(dateIso)) return null;
  const y = dateIso.slice(0, 4), mo = dateIso.slice(4, 6), d = dateIso.slice(6, 8);
  const t = String(hhmm || "").padStart(4, "0");
  const hh = t.slice(0, 2), mm = t.slice(2, 4);
  return `${y}-${mo}-${d}T${hh}:${mm}:00+02:00`;
}

// Map the official venue strings to a venueId in data/venues.json.
function mapVenue(loc = {}) {
  const text = `${loc.locationVenue || ""} ${loc.venue || ""} ${loc.venueSlug || ""}`.toLowerCase();
  if (/palais|rotonde|lumi|debussy|forum|basement|campus|exhibition|terrace|salle|redac|audi|creators|red carpet|global creative/.test(text))
    return "palais";
  if (/sport beach/.test(text)) return "sportbeach";
  if (/canva|vega/.test(text)) return "vega";
  if (/microsoft/.test(text)) return "ondine";
  if (/spotify/.test(text)) return "spotifybeach";
  if (/martinez/.test(text)) return "martinez";
  if (/majestic|meta beach|adweek/.test(text)) return "majestic";
  if (/marriott/.test(text)) return "jwmarriott";
  if (/carlton|linkedin|b2b summit|lions sport stage/.test(text)) return "carlton";
  return "croisette"; // amazon port, miramar, cafes, etc. still land on the strip
}

// Fetch every agenda type and merge, de-duping by eventId (sessions recur across
// the default + sub-programme feeds).
const byEventId = new Map();
for (const agendaType of AGENDA_TYPES) {
  const res = await fetch(apiUrl(agendaType), { headers: { accept: "application/json" } });
  if (!res.ok) {
    console.error(`  ${agendaType}: HTTP ${res.status} — skipping`);
    continue;
  }
  const data = await res.json();
  const evs = data.events || [];
  let added = 0;
  for (const e of evs) {
    const key = String(e.eventId || `${e.titleSlug}`);
    if (!byEventId.has(key)) { byEventId.set(key, e); added++; }
  }
  console.log(`  ${agendaType}: ${evs.length} events (+${added} new)`);
}
const events = [...byEventId.values()];

const sessions = events
  .filter((e) => e.title && e.dateIso && e.startTime)
  .map((e) => {
    const speakers = (e.speakerData || [])
      .map((s) => {
        const sp = s.speaker || {};
        const who = sp.fullName || [sp.firstName, sp.lastName].filter(Boolean).join(" ");
        const role = [sp.jobTitle, sp.company].filter(Boolean).join(", ");
        return who ? (role ? `${who} (${role})` : who) : "";
      })
      .filter(Boolean);
    const loc = e.eventLocation || {};
    const room = [loc.locationVenue, loc.venue].filter(Boolean).join(" — ");
    // The official feed has 100+ distinct eventHost values; collapsing them all
    // under one "Cannes Lions" host keeps the app's host filter usable. The real
    // presenter is preserved in the description + tags.
    const presenter =
      e.eventHost && e.eventHost.trim() && e.eventHost.trim() !== "Cannes Lions"
        ? e.eventHost.trim()
        : "";
    const descParts = [];
    if (presenter) descParts.push(`Presented by ${presenter}.`);
    if (room) descParts.push(`Location: ${room}.`);
    if (speakers.length) descParts.push("Speakers: " + speakers.join("; ") + ".");
    if (e.description) descParts.push(clean(e.description));
    const themes = (e.eventThemes || []).map((t) => t.eventTheme || t).filter(Boolean);
    return {
      id: `official-${e.eventId || e.titleSlug}`.toLowerCase(),
      title: clean(e.title),
      host: "Cannes Lions",
      venueId: mapVenue(loc),
      room: clean(loc.venue || ""), // specific stage/room within the venue (e.g. "Lumière Theatre")
      start: toIso(e.dateIso, e.startTime),
      end: toIso(e.dateIso, e.endTime || e.startTime),
      description: descParts.join(" ").slice(0, 600),
      url: e.titleSlug
        ? `https://www.canneslions.com/festival/programme/${e.titleSlug}`
        : "https://www.canneslions.com/festival/programme",
      tags: ["official"]
        .concat(e.eventType?.eventTypeSlug ? [e.eventType.eventTypeSlug] : [])
        .concat(presenter ? [presenter.toLowerCase()] : [])
        .concat(themes.map((t) => String(t).toLowerCase())),
    };
  })
  .sort((a, b) => (a.start < b.start ? -1 : 1));

mkdirSync(RAW_DIR, { recursive: true });
const out = join(RAW_DIR, "official.json");
writeFileSync(out, JSON.stringify(sessions, null, 2) + "\n");
console.log(`Wrote ${sessions.length} official programme sessions to ${out}`);
