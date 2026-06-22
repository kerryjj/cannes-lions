#!/usr/bin/env node
// Pull the ADWEEK House: Cannes Lions 2026 agenda into data/raw/adweek.json.
//
// The agenda (Swoogo) is server-rendered HTML at
//   https://event.adweek.com/awh-cannes-2026/agenda
// as day-tabbed tables. Each row is: <td>TIME</td><td class="session">…</td> with
//   .type_id   -> "ADWEEK House | Le Majestic Hotel | Invite Only" (room/track/venue)
//   .name      -> session title
//   .c_xxxxx   -> "Presented in Partnership with …" note
//   .speakersLinks -> speaker names/roles (or &nbsp;)
//   .more_info a   -> /awh-cannes-2026/session/<id>/<slug> (details link)
// Day tabs map w_..._tab_N -> June (20+N) 2026. Times are Cannes local (CEST).
//
// Run: node scripts/pull-adweek.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW_DIR = join(__dirname, "..", "data", "raw");
const BASE = "https://event.adweek.com";
const URL = `${BASE}/awh-cannes-2026/agenda`;

function decode(s = "") {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function to24h(tok) {
  const m = tok.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] || "00";
  const ap = m[3].toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${min}`;
}

function mapVenue(typeId = "") {
  const t = typeId.toLowerCase();
  if (t.includes("majestic")) return "majestic"; // ADWEEK House is at Le Majestic
  if (t.includes("pantiero") || t.includes("esplanade") || t.includes("empower")) return "palais"; // old-port side, by the Palais
  return "majestic";
}

const res = await fetch(URL, {
  headers: {
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    accept: "text/html",
  },
});
if (!res.ok) throw new Error(`ADWEEK fetch failed: HTTP ${res.status}`);
const html = await res.text();

// Split into day panes: <div id="w_<wid>_tab_N" class="tab-pane …"> … </div(next pane)>
const paneRe = /id="(w_\d+_tab_(\d+))"\s+class="tab-pane[^"]*"/g;
const panes = [];
let pm;
while ((pm = paneRe.exec(html))) panes.push({ tab: +pm[2], idx: pm.index });
panes.sort((a, b) => a.idx - b.idx);

const sessions = [];
const seenIds = new Set();
for (let i = 0; i < panes.length; i++) {
  const dayNum = panes[i].tab; // tab_1 -> June 21
  const date = `2026-06-${String(20 + dayNum).padStart(2, "0")}`;
  const chunk = html.slice(panes[i].idx, i + 1 < panes.length ? panes[i + 1].idx : html.length);

  // each session row: a time cell followed by a td.session
  const rowRe = /<td[^>]*>\s*([0-9]{1,2}:[0-9]{2}\s*[AP]M(?:\s*-\s*[0-9]{1,2}:[0-9]{2}\s*[AP]M)?)\s*<\/td>\s*<td class="session"[^>]*>([\s\S]*?)<\/td>/g;
  let rm;
  while ((rm = rowRe.exec(chunk))) {
    const timeText = rm[1];
    const body = rm[2];
    const times = timeText.match(/(\d{1,2}:\d{2}\s*[AP]M)/gi) || [];
    const start = to24h(times[0] || "");
    const end = to24h(times[1] || times[0] || "");
    if (!start) continue;

    const pick = (cls) => {
      const m = body.match(new RegExp(`<div class='${cls}[^']*'>([\\s\\S]*?)</div>`, "i"));
      return m ? decode(m[1]) : "";
    };
    const typeId = pick("type_id");
    const name = pick("name");
    if (!name) continue;
    const note = (body.match(/<div class='c_\d+'>([\s\S]*?)<\/div>/i) || [, ""])[1];
    const speakers = pick("speakersLinks");
    const hrefM = body.match(/href="(\/awh-cannes-2026\/session\/[^"]+)"/i);
    const url = hrefM ? BASE + hrefM[1].replace(/&amp;/g, "&") : URL;
    const idM = hrefM && hrefM[1].match(/session\/(\d+)/);
    const id = `adweek-${idM ? idM[1] : `${date}-${start}`}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const descParts = [];
    if (typeId) descParts.push(typeId + ".");
    if (speakers) descParts.push("Speakers: " + speakers + ".");
    if (note) descParts.push(decode(note));
    sessions.push({
      id,
      title: name,
      host: "ADWEEK House",
      venueId: mapVenue(typeId),
      start: `${date}T${start}:00+02:00`,
      end: `${date}T${end}:00+02:00`,
      description: descParts.join(" ").slice(0, 600),
      url,
      registerUrl: "",
      tags: ["adweek", "adweek-house"].concat(/invite only/i.test(typeId) ? ["invite-only"] : []),
    });
  }
}

sessions.sort((a, b) => (a.start < b.start ? -1 : 1));
mkdirSync(RAW_DIR, { recursive: true });
const out = join(RAW_DIR, "adweek.json");
writeFileSync(out, JSON.stringify(sessions, null, 2) + "\n");
console.log(`Wrote ${sessions.length} ADWEEK House sessions to ${out}`);
