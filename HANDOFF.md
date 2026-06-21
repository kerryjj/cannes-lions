# HANDOFF — Cannes Lions 2026 schedule aggregator

Read this first when resuming in a new session. Branch: `claude/cannes-lions-schedule-l4u7md`.

## Goal (from the user)
Pull every Cannes Lions 2026 session (22–26 June) — the official programme **plus**
the side programmes (Canva, Microsoft, LinkedIn, TikTok, AI & Tech Sandbox, beach
activations) — into one place so the group can:
1. see what's on at any given time,
2. tick the sessions they want,
3. export those to Google/Apple calendar, and
4. know the **walking time between venues** so they don't chase talks they can't reach.

Decisions already made with the user:
- **Host:** GitHub Pages (static, shareable link; picks saved per-browser via localStorage).
- **Travel time:** rough estimate (haversine × 1.3 ÷ 80 m/min) — good enough for the Croisette.
- **Data sourcing:** "Both" — open network egress to auto-pull what's public, AND
  paste/grab the login-walled bits.

## What's DONE and working
- `index.html` — the whole app (vanilla JS). Day tabs, host filter, tap **＋** to add to
  agenda, clash detection, **"My agenda"** view with per-leg walk-time + gap warnings
  ("~14min walk but only 5min gap — you won't make it"), and **Export .ics**.
- `data/sessions.json` — normalized schema (currently 3 SEED rows; replace with real data).
- `data/venues.json` — 12 Cannes venues with lat/lng + computed `walkMatrix`.
- `scripts/travel.mjs` — regenerates the walk matrix. Run after adding venues.
- `scripts/normalize.mjs` — merges `data/raw/*.ics` and `data/raw/*.json` → `sessions.json`.
- `data/raw/grab-page-text.js` — browser-console grabber for login-walled pages.
- `data/raw/bookmarklet-official.js` — DOM-scrape template for the official programme.

Pipeline is verified working end-to-end on seed data. `node scripts/travel.mjs` and
`node scripts/normalize.mjs` both run clean.

## THE BLOCKER — ✅ RESOLVED (2026-06-21)
The previous environment's egress proxy returned `Host not in allowlist: <host>`
for every event host. The new environment has open egress, so automated pulling
works. Two real sources are now in via reproducible pullers:
- **Sport Beach (Stagwell)** — 64 sessions — `node scripts/pull-sportbeach.mjs`
  (agenda is in the page's `__NEXT_DATA__` blob at
  `props.pageProps.initial.data.allEvents`; no login).
- **Inkwell Beach** — 15 sessions — `node scripts/pull-luma.mjs` (public lu.ma JSON).

`data/sessions.json` now holds **79 real sessions** (seed rows removed). Rebuild with
the two pullers + `node scripts/normalize.mjs`.

- **Official Cannes Lions programme** — turned out to be **PUBLIC** (not login-walled).
  `node scripts/pull-official.mjs` hits `canneslions.com/api/schedule?siteName=canneslions`
  → ~250 sessions across 22–26 June, including many brand activations.

`data/sessions.json` now holds **~326 real sessions** (3 hosts: Cannes Lions,
Sport Beach, Inkwell Beach; cross-source duplicates de-duped by title+start).

- **Canva Creative Cabana** — DONE via headless browser. `scripts/pull-canva.mjs`
  uses Playwright (full Chromium clears Cloudflare's challenge), loads the agenda
  iframe `public.canva.site/cannes/#page-1`, and reconstructs sessions from the
  Canva design's absolutely-positioned text (no clean JSON exists). Yields 30
  sessions Mon–Wed. **Thursday 25 June doesn't extract** — that day's text nodes
  render with x=0 (no layout box), so left/right columns can't be separated.
  This adapter is fragile: if Canva restyles, re-check the (x,y) thresholds.

### Still pending (commercial anti-bot — not solvable from this network)
- **AI & Tech Sandbox** (`aiandtechsandbox.com`) is behind **DataDome**, which
  blocks even real headless Chromium from this datacenter IP (the TLS-intercepting
  egress proxy changes the fingerprint). Needs a human browser grab.
- **Canva Thursday** — see above; would need a different extraction (DOM order).

## NEXT STEPS (in the new environment)

### 0. Confirm egress is open
```bash
curl -sS -m 15 "https://api.lu.ma/url?url=inkwellcannes2026" | head -c 200
```
If you get JSON (not "Host not in allowlist"), you're good.

### 1. Pull lu.ma-hosted events (the ONLY clean machine-readable feed)
lu.ma exposes public JSON/ICS with **no login/key**:
- Resolve a slug → ids:  `https://api.lu.ma/url?url=<slug-or-url>`
  → returns `data.event.api_id` (`evt-…`) and `data.calendar.api_id` (`cal-…`).
- Whole calendar ICS:    `https://api.lu.ma/ics/get?entity=calendar&id=cal-XXXX`
- Calendar items JSON:   `https://api.lu.ma/calendar/get-items?calendar_api_id=cal-XXXX&period=future&pagination_limit=100`
- Single event JSON:     `https://api.lu.ma/event/get?event_api_id=evt-XXXX`
(Undocumented but production-stable; can change without notice. Times are UTC.)
Confirmed Cannes lu.ma event: **Inkwell Beach** → `https://luma.com/inkwellcannes2026`.
Save pulls into `data/raw/<host>.ics` or `.json`, then `node scripts/normalize.mjs`.

### 2. Try the user-provided pages directly
- Canva: `https://www.canva.com/events/cannes/`
- AI & Tech Sandbox: `https://aiandtechsandbox.com/agenda` (at **Miramar Beach**, powered by PMG)
Fetch; if HTML, parse the agenda into `data/raw/<host>.json` (array of
`{title, host, venue, start, end, url, description}`, times ISO `+02:00`).

### 3. Official programme (likely STILL login-gated even with egress open)
`https://www.canneslions.com/festival/programme` — full agenda is behind the
pass-holder login (app built on **Eventbase**). Ask the user to run
`data/raw/grab-page-text.js` in their logged-in browser and send the `.txt`, then
parse it. Note: the official programme also lists brand activations
(e.g. `…/programme/meta-beach-happy-hour-e1-76743`), so it's high-value.

### 4. Normalize, verify, deploy
```bash
node scripts/normalize.mjs        # raw/* -> data/sessions.json
node scripts/travel.mjs           # if venues changed
python3 -m http.server 8000       # eyeball index.html locally
```
Then enable GitHub Pages: repo Settings → Pages → Deploy from branch →
`claude/cannes-lions-schedule-l4u7md` → `/ (root)`. Share that URL.

## Source research summary (don't re-research)
Festival: 22–26 June 2026, all on/near Bd de la Croisette (~2 km strip).
**No source exposes a public feed EXCEPT lu.ma.** Official programme = login-gated
(Eventbase). All brand sites = bespoke RSVP forms, no `.ics`/JSON. Aggregators with
many RSVP links: `cannes.propellergroup.com`, `native-spaces.com/events/cannes-lions`,
`adage.com/events-awards/cannes-lions/aa-calendar-2026/`.

Confirmed venues (already in `data/venues.json`):
- Palais des Festivals — 1 Bd de la Croisette
- Le Majestic (Barrière) — 10 Bd de la Croisette  · Meta Beach (Plage Majestic), Adobe base
- Canva Creative Cabana — Vega La Plage, 13 Bd de la Croisette
- Sport Beach (Stagwell) — La Plage du Festival, 52 Bd de la Croisette
- JW Marriott — 50 Bd de la Croisette
- Carlton — 58 Bd de la Croisette · LinkedIn rooftop, TikTok garden, Pinterest Manifestival
- Microsoft Gardens — Ondine/Vilebrequin, 64 Bd de la Croisette
- Martinez — 73 Bd de la Croisette · FQ Beach
- Influential Beach (Publicis) — La Mandala Beach
- AI & Tech Sandbox — Miramar Beach (NOT yet a separate venue entry — add it; ~43.548, 7.024)
- Spotify Beach / Croisette beach clubs — beachfront strip
Missing/unconfirmed: Google Beach (no public 2026 page found), exact Amazon Port address.

## Data contract (every session in sessions.json)
`{ id, title, host, venueId, start, end, description, url, tags }`
`start`/`end` = ISO8601 with Paris offset `+02:00` (CEST). `venueId` must exist in
`venues.json` (normalize.mjs maps free-text locations via `guessVenue`).
