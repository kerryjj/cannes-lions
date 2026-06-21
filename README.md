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
node scripts/pull-sportbeach.mjs   # 64 Sport Beach (Stagwell) sessions
node scripts/pull-luma.mjs         # Inkwell Beach + any other lu.ma calendars
node scripts/normalize.mjs         # rebuild data/sessions.json
```

Everything downstream reads only `data/sessions.json`. Each session:

```json
{ "id", "title", "host", "venueId", "start", "end", "description", "url", "tags" }
```

`start`/`end` are ISO8601 with the Paris offset (`+02:00`, CEST in June).

## Sources pulled so far

| Source | How | Status |
| --- | --- | --- |
| **Sport Beach** (Stagwell) | `scripts/pull-sportbeach.mjs` — reads the agenda embedded in the page's `__NEXT_DATA__` | ✅ 64 sessions, auto |
| **Inkwell Beach** | `scripts/pull-luma.mjs` — public lu.ma calendar JSON, no login | ✅ 15 sessions, auto |
| Canva, AI & Tech Sandbox | JS-rendered + bot-protected (403) — need a headless browser or the in-browser grab | ⏳ pending |
| Official Cannes programme | LIONS Membership login + WAF | ⏳ needs browser grab (below) |

## Adding a source

1. Drop the source's export into `data/raw/`:
   - **lu.ma / Eventbrite / Sched** events expose an `.ics` feed — save it as e.g.
     `data/raw/canva.ics`. The host name is taken from the filename.
   - Anything else: save a `data/raw/<host>.json` array of session objects.
2. Run `node scripts/normalize.mjs` — it merges, de-dupes, sorts, and rewrites
   `data/sessions.json`.
3. If you add a new venue, add it to `data/venues.json` and re-run
   `node scripts/travel.mjs` to refresh walk times.

### The official programme (login-walled)

`canneslions.com/festival/programme` is behind a WAF **and** a LIONS Membership
login, so it can't be fetched from a server. Use `data/raw/bookmarklet-official.js`:
run it in your own logged-in browser on the programme page; it downloads
`official.json` which you drop into `data/raw/`. (You'll need to tweak the CSS
selectors to match the live markup — it's a template.)

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
