#!/usr/bin/env node
// Pull the Canva Creative Cabana 2026 daily agenda into data/raw/canva.json.
//
// Canva's agenda lives in an iframe at https://public.canva.site/cannes (#page-1).
// It's a Canva *design*, so there is no clean JSON — content is absolutely-positioned
// text fragments. We render it with headless Chromium (which also clears Cloudflare's
// challenge), read every text node with its on-page (x,y), then reconstruct sessions:
//   - left column (x < ~430) holds the time markers + titles + descriptions
//   - right column (x > ~1000) holds speaker name / title / company
//   - the 4 day sections are detected by the time-of-day resetting to the morning
// Festival days: Mon 22 -> Thu 25 June 2026 (Europe/Paris, +02:00).
//
// This adapter is inherently fragile (it depends on Canva's layout). If Canva
// restyles the page, re-check the (x,y) thresholds below.
//
// Requires: npx playwright install chromium
// Run: node scripts/pull-canva.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW_DIR = join(__dirname, "..", "data", "raw");
const URL = "https://public.canva.site/cannes/#page-1";
const DAY_DATES = ["2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25"]; // Mon..Thu

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright not found. Install with: npm i -g playwright && npx playwright install chromium");
  process.exit(1);
}

function to24h(label) {
  const m = String(label).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] || "00";
  const ap = m[3].toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${min}`;
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"],
});
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  locale: "en-US",
  timezoneId: "Europe/Paris",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  viewport: { width: 1600, height: 4000 },
});
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(4000);
await page.evaluate(() => {
  const a = [...document.querySelectorAll("a[href*='page-1']")][0];
  if (a) a.click();
});
await page.waitForTimeout(3000);
await page.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 500) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 100));
  }
});
await page.waitForTimeout(1500);

const nodes = await page.evaluate(() => {
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const t = n.textContent.replace(/\s+/g, " ").trim();
    if (!t || t.length > 400) continue;
    const el = n.parentElement;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none") continue;
    const r = el.getBoundingClientRect();
    out.push({ t, x: Math.round(r.x + window.scrollX), y: Math.round(r.y + window.scrollY) });
  }
  return out;
});
await browser.close();

// Keep only the detailed agenda area, drop nav/boilerplate and any unrendered
// nodes (x===0 means the element had no layout box — happens on lazily-rendered
// sections and would otherwise corrupt the parse).
const junk = /^(home|schedule|speakers|faq|explore more|highlights|open|daily beach)$/i;
const clean = nodes
  .filter((n) => !junk.test(n.t))
  .filter((n) => !/subject to change|more programming/i.test(n.t))
  .filter((n) => n.x > 0);

// Time markers in the left column mark the start of each session.
const isTime = (t) => /^\d{1,2}(?::\d{2})?\s*(AM|PM)$/i.test(t.trim());
// The detailed agenda formats times WITH a space ("9:00 AM"); the top "Daily Beach
// Program" highlights matrix uses no space ("9AM", "10:00AM"). Require the space so
// we only pick up the detailed agenda slots.
const isAgendaTime = (t) => /^\d{1,2}(?::\d{2})?\s+(AM|PM)$/i.test(t.trim());
let times = clean
  .filter((n) => isAgendaTime(n.t) && n.x < 460)
  .sort((a, b) => a.y - b.y);

// Belt-and-suspenders: drop anything that still shares a y-row with another marker
// (matrix rows have 2+ columns; real agenda slots are one-per-row).
times = times.filter((t) => times.filter((o) => Math.abs(o.y - t.y) < 12).length === 1);

// Strip leading "eyebrow" labels Canva puts above some titles.
const EYEBROW = /^(in the c-suite|powered by|presented by|curated by|sponsored by)\b[:\s]*/i;

// Split into day sections: a new day begins when the clock resets to the morning
// after we've already seen an afternoon/evening slot.
let day = 0;
let prevMinutes = -1;
const withDay = [];
for (const tm of times) {
  const hhmm = to24h(tm.t);
  if (!hhmm) continue;
  const minutes = +hhmm.slice(0, 2) * 60 + +hhmm.slice(3);
  if (prevMinutes >= 0 && minutes + 90 < prevMinutes) day++; // big drop => next day
  prevMinutes = minutes;
  if (day > 3) break;
  withDay.push({ ...tm, hhmm, day });
}

const sessions = [];
for (let i = 0; i < withDay.length; i++) {
  const cur = withDay[i];
  const next = withDay[i + 1];
  const yTop = cur.y;
  const yBot = next ? next.y - 1 : cur.y + 600;
  // text fragments belonging to this slot
  const frags = clean.filter((n) => n.y > yTop - 5 && n.y < yBot && !(isTime(n.t) && n.x < 460));
  if (!frags.length) continue;
  // left column = title + description; title is the first short line(s) near the time.
  const left = frags.filter((n) => n.x < 600).sort((a, b) => a.y - b.y || a.x - b.x);
  const right = frags.filter((n) => n.x >= 900).sort((a, b) => a.y - b.y || a.x - b.x);
  if (!left.length) continue;

  // Title: consecutive left lines from the top until we hit a long (sentence) line.
  const titleParts = [];
  const descParts = [];
  let inDesc = false;
  for (const l of left) {
    const isSentence = l.t.length > 45 || /[.!?]$/.test(l.t);
    if (!inDesc && !isSentence && titleParts.join(" ").length < 80) titleParts.push(l.t);
    else { inDesc = true; descParts.push(l.t); }
  }
  let title = titleParts.join(" ").trim();
  const tags = ["canva", "creative-cabana"];
  const eb = title.match(EYEBROW);
  if (eb) {
    tags.push(eb[1].toLowerCase().replace(/\s+/g, "-"));
    title = title.replace(EYEBROW, "").trim();
  }
  if (!title || title.length < 4) continue;

  // Speakers from the right column: group into name / role triples is messy, so just
  // join them as a readable list.
  const speakers = right.map((r) => r.t).filter((t) => !/^[🎶🏳️‍🌈]/.test(t));
  const dateStr = DAY_DATES[cur.day] || DAY_DATES[DAY_DATES.length - 1];
  // No end time in the layout — default to a 30-min slot so it has duration.
  const endMin = (+cur.hhmm.slice(0, 2) * 60 + +cur.hhmm.slice(3) + 30) % (24 * 60);
  const endHhmm = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
  const description = [
    speakers.length ? "Speakers/details: " + speakers.join(" · ") + "." : "",
    descParts.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 600);

  sessions.push({
    id: `canva-${dateStr}-${cur.hhmm}-${title}`
      .replace(/[^a-z0-9]+/gi, "-")
      .slice(0, 70)
      .toLowerCase(),
    title,
    host: "Canva",
    venueId: "vega", // Canva Creative Cabana @ Vega la Plage
    start: `${dateStr}T${cur.hhmm}:00+02:00`,
    end: `${dateStr}T${endHhmm}:00+02:00`,
    description,
    url: "https://www.canva.com/events/cannes/",
    tags,
  });
}

mkdirSync(RAW_DIR, { recursive: true });
const out = join(RAW_DIR, "canva.json");
writeFileSync(out, JSON.stringify(sessions, null, 2) + "\n");
console.log(`Wrote ${sessions.length} Canva Creative Cabana sessions to ${out}`);
