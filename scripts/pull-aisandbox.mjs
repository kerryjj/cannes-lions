#!/usr/bin/env node
// Parse the AI & Tech Sandbox agenda into data/raw/aisandbox.json.
//
// aiandtechsandbox.com is behind DataDome, which blocks server-side fetches AND
// headless browsers from a datacenter IP. So the agenda is grabbed manually from a
// real browser and pasted into data/sources/aisandbox.txt; this script parses it.
//
// Block shape per session in the source text:
//   <title>
//   <Month DD, YYYY | h:mmAM - h:mmPM>      <- viewer LOCAL time (ignored)
//   <Stage> @ AI & Tech Sandbox             <- location
//   <smushed speaker names>                 <- skipped
//   <Name,> / <Role, Company> pairs ...
//   <description paragraph(s)>
//   🕑 h:mm AM - h:mm PM (CEST)             <- REAL Cannes time (used)
//   <Stage track>                           <- "Main Stage" / "Meet Up"
//
// To refresh: re-grab the page text, replace data/sources/aisandbox.txt, re-run.
// Run: node scripts/pull-aisandbox.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "data", "sources", "aisandbox.txt");
const RAW_DIR = join(__dirname, "..", "data", "raw");

const MONTHS = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };
const DATE_RE = /^([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})\s*\|/;

// Parse a single clock token like "10:00 AM", "03:15PM", "1:15" (no meridiem).
function parseClock(tok, fallbackMeridiem) {
  const m = tok.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] || "00";
  const mer = (m[3] || fallbackMeridiem || "").toUpperCase();
  if (!mer) return null;
  if (mer === "PM" && h !== 12) h += 12;
  if (mer === "AM" && h === 12) h = 0;
  return { hhmm: `${String(h).padStart(2, "0")}:${min}`, meridiem: mer };
}

// "🕑 4:15-5:00 PM (CEST)" -> { start:"16:15", end:"17:00" }
function parseCestLine(line) {
  const s = line.replace(/\(CEST\)/i, "").replace(/[^\x00-\x7F]/g, " ").trim(); // strip emoji
  const parts = s.split(/\s*[-–—]\s*/);
  if (parts.length < 2) return null;
  const end = parseClock(parts[1]);
  if (!end) return null;
  const start = parseClock(parts[0], end.meridiem); // start may lack AM/PM -> borrow end's
  if (!start) return null;
  return { start: start.hhmm, end: end.hhmm };
}

const lines = readFileSync(SRC, "utf8").split(/\r?\n/);

// Find the session anchors: a date line whose previous non-empty line is the title.
const anchors = [];
for (let i = 0; i < lines.length; i++) {
  if (DATE_RE.test(lines[i].trim())) {
    let p = i - 1;
    while (p >= 0 && !lines[p].trim()) p--;
    if (p >= 0) anchors.push({ titleIdx: p, dateIdx: i });
  }
}

const sessions = [];
for (let a = 0; a < anchors.length; a++) {
  const { titleIdx, dateIdx } = anchors[a];
  const end = a + 1 < anchors.length ? anchors[a + 1].titleIdx : lines.length;
  const block = lines.slice(dateIdx, end).map((l) => l.trim());

  const title = lines[titleIdx].trim();
  const dm = block[0].match(DATE_RE);
  const date = `${dm[3]}-${MONTHS[dm[1].toLowerCase()]}-${String(dm[2]).padStart(2, "0")}`;

  // location line is right after the date line
  const location = block[1] || "";
  const stage = /meet up/i.test(block.find((l) => /^meet up$/i.test(l)) || location) ? "Meet Up" : "Main Stage";

  // Cannes time from the 🕑 (CEST) line
  const cestLine = block.find((l) => /\(CEST\)/i.test(l));
  const times = cestLine ? parseCestLine(cestLine) : null;
  if (!times) {
    console.error(`No CEST time for "${title}" — skipping`);
    continue;
  }

  // Speakers: walk lines after the location, pairing "<Name>," with the next role line.
  // Skip the smushed-names line (doesn't end with a comma).
  const speakers = [];
  let j = 2; // block[0]=date, block[1]=location
  // advance past any leading non-comma name-smush lines
  while (j < block.length && block[j] && !block[j].endsWith(",") && !/\(CEST\)/i.test(block[j]) && speakers.length === 0) {
    // only skip if it looks like a (smushed) name line, i.e. no sentence end
    if (/[.!?]$/.test(block[j]) || block[j].length > 220) break;
    j++;
  }
  while (j + 1 < block.length && block[j].endsWith(",")) {
    const name = block[j].replace(/\s*,\s*$/, "").replace(/\s+/g, " ").trim();
    const role = block[j + 1].replace(/\s+/g, " ").trim();
    if (name) speakers.push(role && !role.endsWith(",") ? `${name} (${role})` : name);
    j += 2;
  }

  // Description: everything from here up to the 🕑 line, minus "🎤 more speakers" notes.
  const descLines = [];
  for (; j < block.length; j++) {
    const l = block[j];
    if (/\(CEST\)/i.test(l)) break;
    if (!l || /^🎤/.test(l) || /more speakers/i.test(l)) continue;
    descLines.push(l);
  }
  const description = [
    speakers.length ? "Speakers: " + speakers.join("; ") + "." : "",
    descLines.join(" "),
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 700);

  sessions.push({
    id: `aisandbox-${date}-${times.start}-${title}`.replace(/[^a-z0-9]+/gi, "-").slice(0, 70).toLowerCase(),
    title,
    host: "AI & Tech Sandbox",
    venueId: "aisandbox",
    start: `${date}T${times.start}:00+02:00`,
    end: `${date}T${times.end}:00+02:00`,
    description,
    url: "https://aiandtechsandbox.com/agenda",
    tags: ["aisandbox", "pmg", "ai", stage.toLowerCase().replace(/\s+/g, "-")],
  });
}

mkdirSync(RAW_DIR, { recursive: true });
const out = join(RAW_DIR, "aisandbox.json");
writeFileSync(out, JSON.stringify(sessions, null, 2) + "\n");
console.log(`Wrote ${sessions.length} AI & Tech Sandbox sessions to ${out}`);
