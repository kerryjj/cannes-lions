// ── Universal agenda grabber ─────────────────────────────────────────────
// The cloud build environment can't reach the event sites (WAF/login), so run
// this in YOUR OWN browser on any agenda page. It downloads the page's visible
// text as a .txt file. Send me that file (or paste its contents) and I'll turn
// it into structured sessions in data/sessions.json.
//
// USE: open the agenda page → DevTools console (F12) → paste this → Enter.
// A `<sitename>-agenda.txt` file downloads. Repeat per source:
//   canva.com/events/cannes, aiandtechsandbox.com/agenda,
//   canneslions.com/festival/programme (while logged in), etc.

(function () {
  // Prefer a main/agenda container if present, else whole body.
  const root =
    document.querySelector("main, [class*=agenda], [class*=schedule], #content") ||
    document.body;
  const text = root.innerText.replace(/\n{3,}/g, "\n\n").trim();
  const host = location.hostname.replace(/^www\./, "").split(".")[0];
  const blob = new Blob(
    [`SOURCE: ${location.href}\nCAPTURED: ${new Date().toISOString()}\n\n${text}`],
    { type: "text/plain" }
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${host}-agenda.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
  console.log(`Grabbed ${text.length} chars from ${location.href}`);
})();
