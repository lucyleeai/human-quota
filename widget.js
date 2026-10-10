// human-quota widget. Do not paste this file into Scriptable:
// paste install.js instead — it holds your settings and runs the latest copy of this file.
const S = Object.assign({
  codexbarUrl: "", codexbarToken: "", providers: ["claude", "codex"],
  nightscoutUrl: "", nightscoutToken: "", units: "mmol",
  // Approximates the frosted look of Apple's widgets. iOS lightens widget colours on the Home Screen,
  // so pick colours a bit deeper than the glass you want to match.
  background: ["7183D2"],
}, typeof SETTINGS === "object" && SETTINGS ? SETTINGS : {});

const fm = FileManager.local();
const cache = fm.joinPath(fm.libraryDirectory(), "human-quota-snapshot.json");
const draftPath = fm.joinPath(fm.libraryDirectory(), "human-quota-draft.json");
const logging = config.runsInApp && args.queryParameters.log === "1";
if (logging) await recordNote();

async function recordNote() {
  let draft = null;
  try { draft = JSON.parse(fm.readString(draftPath)); } catch (_) {}
  while (true) {
    const input = new Alert(); input.title = "Log";
    input.addTextField("What did you eat or drink?", draft?.notes || "");
    input.addAction("Save"); input.addCancelAction("Cancel");
    if (await input.presentAlert() < 0) return;
    const notes = input.textFieldValue(0).trim();
    if (!notes) continue;
    // Nightscout upserts on created_at + eventType, so a retried draft never duplicates.
    if (!draft || draft.notes !== notes)
      draft = {eventType: "Note", notes, created_at: new Date().toISOString(), enteredBy: "human-quota"};
    fm.writeString(draftPath, JSON.stringify(draft));
    try {
      const request = new Request(S.nightscoutUrl + "/api/v1/treatments?token=" + encodeURIComponent(S.nightscoutToken));
      request.method = "POST"; request.timeoutInterval = 12;
      request.headers = {"Content-Type": "application/json"};
      request.body = JSON.stringify([draft]);
      await request.loadString();
      if (request.response.statusCode !== 200) throw Error("Save failed");
      fm.remove(draftPath);
      const done = new Alert(); done.title = "Saved"; done.addAction("Done");
      await done.presentAlert(); return;
    } catch (_) {
      const error = new Alert(); error.title = "Not saved yet";
      error.message = "Your note is kept on this iPhone. Check the connection and try again.";
      error.addAction("Try again"); error.addCancelAction("Later");
      if (await error.presentAlert() < 0) return;
    }
  }
}

async function getJSON(url, headers = {}) {
  const request = new Request(url);
  request.timeoutInterval = 12; request.headers = headers;
  const body = await request.loadJSON();
  if (request.response.statusCode !== 200) throw Error("HTTP " + request.response.statusCode);
  return body;
}

// CodexBar tags windows by kind; fall back to the label for providers that don't.
function pick(windows, kind, pattern) {
  const w = windows.find(x => x.kind === kind) || windows.find(x => pattern.test(x.label || ""));
  return w && Number.isFinite(w.remainingPercent)
    ? {remaining: w.remainingPercent, resetAt: w.resetAt ? Date.parse(w.resetAt) / 1000 : null} : null;
}

const ARROWS = {DoubleUp: "⇈", SingleUp: "↑", FortyFiveUp: "↗", Flat: "→",
                FortyFiveDown: "↘", SingleDown: "↓", DoubleDown: "⇊"};
let data = {quota: {}, glucose: null};
let quotaOffline = false, glucoseOffline = false;
// readString returns null for a missing file; keep the empty shape then.
try { data = JSON.parse(fm.readString(cache)) || data; } catch (_) {}
if (S.codexbarUrl) {
  try {
    const snapshot = await getJSON(S.codexbarUrl + "/dashboard/v1/snapshot", {Authorization: "Bearer " + S.codexbarToken});
    data.quota = {};
    for (const p of snapshot.providers || []) {
      const windows = p.error ? [] : p.windows || [];
      data.quota[p.id] = {name: p.name, at: Date.parse(p.updatedAt) / 1000,
                          session: pick(windows, "session", /session|5.?h/i), weekly: pick(windows, "weekly", /week/i)};
    }
  } catch (_) { quotaOffline = true; }
}
if (S.nightscoutUrl) {
  try {
    const [entry] = await getJSON(S.nightscoutUrl + "/api/v1/entries/sgv.json?count=1&token=" + encodeURIComponent(S.nightscoutToken));
    if (entry) data.glucose = {at: entry.date / 1000, mgdl: entry.sgv, arrow: ARROWS[entry.direction] || ""};
  } catch (_) { glucoseOffline = true; }
}
fm.writeString(cache, JSON.stringify(data));

// Provider glyphs from CodexBar (MIT), white on transparent; anything else falls back to an SF Symbol.
const GLYPHS = {
  claude: "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",
  codex: "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",
};
// Apple's system colours, exactly as the Battery widget uses them. iOS applies the same Home Screen
// treatment to every widget, so on screen they match the Battery widget next to this one.
const GREEN = "34C759", YELLOW = "FFCC00", ORANGE = "FF9500", RED = "FF3B30", DEEP_RED = "B3261E";
const tone = remaining => remaining <= 10 ? RED : remaining <= 20 ? YELLOW : GREEN; // Battery logic
// The five consensus bands (Battelino et al., Diabetes Care 2019; ADA Standards of Care 2026), cut in mg/dL so
// mmol rounding can't misplace a reading: very low <54, low 54–69, in range 70–180, high 181–250, very high >250.
// Lows and highs get different colours so the ring keeps the direction. Very low has no Apple system colour;
// a deeper red follows the AGP report's convention.
const glucoseTone = mgdl => mgdl < 54 ? DEEP_RED : mgdl < 70 ? RED : mgdl <= 180 ? GREEN : mgdl <= 250 ? YELLOW : ORANGE;

const widget = new ListWidget();
widget.setPadding(0, 6, 0, 6);
const bg = [].concat(S.background);
if (bg.length > 1) {
  const gradient = new LinearGradient();
  gradient.colors = bg.map(hex => new Color(hex)); gradient.locations = bg.map((_, i) => i / (bg.length - 1));
  gradient.startPoint = new Point(0, 0); gradient.endPoint = new Point(1, 1);
  widget.backgroundGradient = gradient;
} else widget.backgroundColor = new Color(bg[0]);
const runURL = "scriptable:///run/" + encodeURIComponent(Script.name());
widget.url = runURL + "?refresh=1";
widget.refreshAfterDate = new Date(Date.now() + 300000);
const white = new Color("FFFFFF"), muted = new Color("FFFFFF", 0.55);
const now = Date.now() / 1000;
function fresh(at, seconds) { return Number.isFinite(at) && now - at >= -60 && now - at < seconds; }

function arc(ctx, radius, width, percent, hex) {
  ctx.setLineWidth(width);
  ctx.setStrokeColor(new Color("FFFFFF", 0.18));
  ctx.strokeEllipse(new Rect(37 - radius, 37 - radius, radius * 2, radius * 2));
  if (percent === null || percent <= 0) return;
  const color = new Color(hex), path = new Path(), end = Math.PI * 2 * Math.min(100, percent) / 100;
  const steps = Math.max(1, Math.ceil(end * 40));
  for (let i = 0; i <= steps; i++) {
    const angle = -Math.PI / 2 + end * i / steps;
    const point = new Point(37 + radius * Math.cos(angle), 37 + radius * Math.sin(angle));
    if (i === 0) path.move(point); else path.addLine(point);
  }
  ctx.setStrokeColor(color); ctx.addPath(path); ctx.strokePath(); ctx.setFillColor(color);
  for (const angle of [-Math.PI / 2, end - Math.PI / 2])
    ctx.fillEllipse(new Rect(37 - width / 2 + radius * Math.cos(angle), 37 - width / 2 + radius * Math.sin(angle), width, width));
}
// rings: [{percent, hex}] from outside in. Outer = weekly, inner = 5-hour.
function slot(rings, glyph, value, valueColor, url, note = " ") {
  const ctx = new DrawContext();
  ctx.size = new Size(74, 74); ctx.opaque = false; ctx.respectScreenScale = true;
  rings.forEach((r, i) => arc(ctx, 32 - i * 9, i ? 5 : 6, r.percent, r.hex));
  const column = metrics.addStack(); column.layoutVertically(); if (url) column.url = url;
  const ringRow = column.addStack(); ringRow.size = new Size(96, 74); ringRow.addSpacer();
  const ring = ringRow.addStack(); ringRow.addSpacer(); ring.size = new Size(74, 74); ring.backgroundImage = ctx.getImage();
  ring.centerAlignContent(); ring.addSpacer();
  const icon = ring.addImage(glyph); icon.imageSize = new Size(18, 18); icon.tintColor = white;
  ring.addSpacer();
  column.addSpacer(8);
  const row = column.addStack(); row.size = new Size(96, 0); row.addSpacer();
  const text = row.addText(value); text.font = Font.semiboldSystemFont(17); text.textColor = valueColor;
  text.lineLimit = 1; text.minimumScaleFactor = 0.6; row.addSpacer();
  // Second line: the glucose reading's measurement time; blank for quota so all numbers line up.
  // One line only, wider than the ring: a wrapped note would push this column's number out of line.
  const noteRow = column.addStack(); noteRow.size = new Size(96, 0); noteRow.addSpacer();
  const small = noteRow.addText(note); small.font = Font.mediumSystemFont(10); small.textColor = muted;
  small.lineLimit = 1; small.minimumScaleFactor = 0.7; noteRow.addSpacer();
  metrics.addSpacer();
}
const glyph = id => GLYPHS[id] ? Image.fromData(Data.fromBase64String(GLYPHS[id])) : SFSymbol.named("circle.dashed").image;

widget.addSpacer();
const metrics = widget.addStack(); metrics.centerAlignContent(); metrics.addSpacer();
if (!S.codexbarUrl && !S.nightscoutUrl) {
  const hint = metrics.addText("Open the script to add your settings");
  hint.font = Font.mediumSystemFont(11); hint.textColor = muted; metrics.addSpacer();
}
if (S.nightscoutUrl) {
  // You: your own quota. Tap it to log what you ate or drank.
  const reading = data.glucose, valid = !glucoseOffline && fresh(reading?.at, 600);
  const mmol = reading ? reading.mgdl / 18 : null;
  const value = reading ? (S.units === "mmol" ? mmol.toFixed(1) : String(reading.mgdl)) + (valid ? reading.arrow : "") : "—";
  // The sensor's own measurement time, not the widget's refresh time: CGM data arrives with a delay.
  // Tapping this column opens the log; "＋ Log" says so without breaking the ring.
  const measured = (reading ? new Date(reading.at * 1000).toTimeString().slice(0, 5) + " · " : "") + "＋ Log";
  slot([{percent: valid ? 100 : null, hex: valid ? glucoseTone(reading.mgdl) : GREEN}], SFSymbol.named("drop.fill").image,
       value, valid ? white : muted, runURL + "?log=1", measured);
}
for (const id of S.codexbarUrl ? S.providers.slice(0, S.nightscoutUrl ? 2 : 3) : []) {
  const q = data.quota?.[id] || {};
  const live = !quotaOffline && fresh(q.at, 900);
  const session = live ? q.session : null, weekly = live ? q.weekly : null;
  const single = q.weekly && !q.session; // remembered from the last good fetch, so offline keeps the shape
  const ring = w => ({percent: w?.remaining ?? null, hex: tone(w?.remaining ?? 100)});
  const tight = [session, weekly].filter(Boolean).sort((a, b) => a.remaining - b.remaining)[0];
  // Name the window behind the number, so Claude's 5-hour % isn't read as comparable to Codex's weekly %.
  slot(single ? [ring(weekly)] : [ring(weekly), ring(session)], glyph(id),
       tight ? Math.round(tight.remaining) + "%" : "—", tight ? white : muted, null,
       tight ? (tight === session ? "5-hour" : "weekly") : " ");
}
widget.addSpacer();
Script.setWidget(widget);
if (config.runsInApp && !logging) await widget.presentMedium();
Script.complete();
