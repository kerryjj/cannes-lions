# Cannes Lions 2026 — What's On

A tiny static app that pulls every session (official Cannes Lions programme + the
side programmes from Canva, Microsoft, LinkedIn, TikTok, the AI & Tech Sandbox,
beach activations, etc.) into one timeline so you can see what's on at any moment,
pick the ones you want, check whether you can physically get between them, and
export your picks to Google/Apple/Outlook calendar.

Festival dates: **22–26 June 2026, Cannes.**

## How it works

```
data/
  raw/            # whatever each source gives us (.ics / .json), untouched
  venues.json     # venues + lat/lng + computed walk-time matrix
  sessions.json   # THE normalized file the app reads (single source of truth)
scripts/
  pull-sportbeach.mjs  # Sport Beach agenda -> data/raw/sportbeach.json
  pull-luma.mjs        # public lu.ma calendars -> data/raw/luma-<name>.json
  travel.mjs           # venues.json lat/lng -> walk-time matrix (haversine estimate)
  normalize.mjs        # data/raw/* -> data/sessions.json
index.html             # the whole app (one file, vanilla JS, loads data/*.json)
```

Refresh the data anytime with:

```bash
node scripts/pull-official.mjs     # ~250 official Cannes Lions programme sessions
node scripts/pull-sportbeach.mjs   # 64 Sport Beach (Stagwell) sessions
node scripts/pull-luma.mjs         # Inkwell Beach + any other lu.ma calendars
node scripts/pull-canva.mjs        # 30 Canva Creative Cabana sessions (needs Playwright)
node scripts/pull-aisandbox.mjs    # 25 AI & Tech Sandbox sessions (parses data/sources/aisandbox.txt)
node scripts/normalize.mjs         # rebuild data/sessions.json (de-dupes across sources)
```

`pull-canva.mjs` needs a headless browser once:

```bash
npm i -g playwright && npx playwright install chromium
```

Everything downstream reads only `data/sessions.json`. Each session:

```json
{ "id", "title", "host", "venueId", "start", "end", "description", "url", "tags" }
```

`start`/`end` are ISO8601 with the Paris offset (`+02:00`, CEST in June).

## Sources pulled so far

| Source | How | Status |
| --- | --- | --- |
| **Official Cannes Lions programme** | `scripts/pull-official.mjs` — the page's public `/api/schedule` JSON (no login) | ✅ ~250 sessions, auto |
| **Sport Beach** (Stagwell) | `scripts/pull-sportbeach.mjs` — reads the agenda embedded in the page's `__NEXT_DATA__` | ✅ 64 sessions, auto |
| **Inkwell Beach** | `scripts/pull-luma.mjs` — public lu.ma calendar JSON, no login | ✅ 15 sessions, auto |
| **Canva Creative Cabana** | `scripts/pull-canva.mjs` (Mon–Wed, auto) + `data/raw/canva-thursday.json` (Thu, hand-reconstructed from the page's scrambled hidden layer) | ✅ 38 sessions (Mon–Thu) |
| **AI & Tech Sandbox** | `scripts/pull-aisandbox.mjs` — parses the agenda pasted into `data/sources/aisandbox.txt` (site is DataDome-blocked, grabbed from a real browser) | ✅ 25 sessions |

> The official programme already lists many brand activations (Sport Beach, Meta
> Beach, Microsoft Garden, Canva Cabana, LinkedIn Rooftop, Amazon Port, etc.), so a
> lot of the side programme is covered by `pull-official.mjs` alone.

## Adding a source

1. Drop the source's export into `data/raw/`:
   - **lu.ma / Eventbrite / Sched** events expose an `.ics` feed — save it as e.g.
     `data/raw/canva.ics`. The host name is taken from the filename.
   - Anything else: save a `data/raw/<host>.json` array of session objects.
2. Run `node scripts/normalize.mjs` — it merges, de-dupes, sorts, and rewrites
   `data/sessions.json`.
3. If you add a new venue, add it to `data/venues.json` and re-run
   `node scripts/travel.mjs` to refresh walk times.

### The official programme (now public)

`canneslions.com/festival/programme` turned out to be **public** — the page calls
`/api/schedule?siteName=canneslions` directly with no login. `scripts/pull-official.mjs`
hits that endpoint, so no browser/bookmarklet is needed. (The old
`data/raw/bookmarklet-official.js` is kept only as a fallback.)

## Run locally

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```
(Opening `index.html` via `file://` won't work — browsers block `fetch` there.)

## Deploy (GitHub Pages)

Repo Settings → Pages → Deploy from branch → this branch → `/ (root)`.
The app, data, and everything are static, so the published URL is shareable with
the group. Each person's picks are saved in their own browser (localStorage).

## Features

- Timeline grouped by time slot, one color per host, filter hosts on/off.
- Tap **＋** to add a session to your agenda (saved locally). **Clashes** flagged.
- **★ My agenda** view shows your day with **walking time + gap** between
  consecutive sessions, and warns when you can't physically make the next one.
- **⬇ Export .ics** downloads your picks for Google / Apple / Outlook calendar,
  with the venue address in each event so Maps directions work from the calendar.
