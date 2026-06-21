// ── Cannes Lions official programme grabber ──────────────────────────────
// The official programme (canneslions.com/festival/programme) sits behind a
// WAF + login, so it can't be scraped from a server. Run this IN YOUR OWN
// logged-in browser instead: it reads the rendered programme and downloads a
// JSON file you drop into data/raw/ as `official.json`, then `node scripts/normalize.mjs`.
//
// HOW TO USE
// 1. Log in at https://www.canneslions.com and open the programme page.
// 2. Open DevTools console (F12) and paste this whole file, OR save it as a
//    bookmarklet (prefix with `javascript:` and minify).
// 3. Adjust the SELECTORS below if the markup differs — inspect one session
//    card and update the querySelectors. This is a starting template.
//
// The goal: produce an array of { title, host, venue, start, end, url, description }
// with start/end as ISO strings (Paris time, +02:00).

(function () {
  const out = [];
  // ⚠️ TEMPLATE SELECTORS — inspect the page and adjust these to the real cards.
  const cards = document.querySelectorAll('[data-session], .session, .programme-item, article');
  cards.forEach((el) => {
    const text = (sel) => el.querySelector(sel)?.textContent.trim() || "";
    const title = text("h3, h2, .title, [class*=title]");
    if (!title) return;
    out.push({
      title,
      host: "Cannes Lions",
      venue: text(".venue, .location, [class*=location], [class*=stage]"),
      // Times often live in a <time datetime> attr — prefer that:
      start: el.querySelector("time")?.getAttribute("datetime") || text(".time, [class*=time]"),
      end: el.querySelectorAll("time")[1]?.getAttribute("datetime") || "",
      url: el.querySelector("a")?.href || "",
      description: text(".description, [class*=desc], p"),
      tags: ["official"],
    });
  });
  console.log(`Captured ${out.length} sessions`, out);
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "official.json";
  a.click();
})();
