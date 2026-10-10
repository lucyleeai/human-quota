// Runs install.js (which downloads and runs widget.js) against a fake Scriptable runtime
// and canned API responses. Usage: node test/smoke.mjs   (no network, no iPhone needed)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = name => readFileSync(new URL("../" + name, import.meta.url), "utf8");
const now = Date.now();
const iso = ms => new Date(now + ms).toISOString();
const routes = {
  "/dashboard/v1/snapshot": {providers: [
    {id: "codex", name: "Codex", updatedAt: iso(0), error: null,
     windows: [{kind: "weekly", label: "Weekly", remainingPercent: 89, resetAt: iso(4 * 86400e3)}]},
    {id: "claude", name: "Claude", updatedAt: iso(0), error: null, windows: [
      {kind: "session", label: "Session", remainingPercent: 15, resetAt: iso(35 * 60e3)},
      {kind: "weekly", label: "Weekly", remainingPercent: 72, resetAt: iso(3 * 86400e3)},
      {kind: "claude-weekly-scoped-fable", label: "Fable only", remainingPercent: 100}]}]},
  "/api/v1/entries/sgv.json": [{sgv: 74, date: now - 60000, direction: "Flat"}],
};

function run({settings = true, log = false, fail = {}, files = {}, source = read("widget.js"), sgv = 74} = {}) {
  routes["/api/v1/entries/sgv.json"] = [{sgv, date: now - 60000, direction: "Flat"}];
  const texts = [], colors = [], posts = [], alerts = [], strokes = [];
  class Color { constructor(hex) { this.hex = hex; } }
  class Stack { addStack() { return new Stack(); } addSpacer() {}
    addText(t) { texts.push(t); const el = {}; Object.defineProperty(el, "textColor", {set: c => colors.push([t, c?.hex])}); return el; }
    addDate() { return {applyTimeStyle() {}, applyDateStyle() {}}; }
    addImage() { return {}; } layoutVertically() {} centerAlignContent() {} topAlignContent() {} setPadding() {} }
  class Request {
    constructor(url) { this.url = url; this.response = {}; }
    async loadString() {
      if (this.method === "POST") { posts.push(JSON.parse(this.body)); this.response.statusCode = 200; return "[]"; }
      if (fail.source) throw Error("offline");
      this.response.statusCode = 200; return source;
    }
    async loadJSON() { const path = new URL(this.url).pathname;
      if (fail[path]) { this.response.statusCode = 500; return {}; }
      this.response.statusCode = 200; return routes[path]; }
  }
  class Alert { addTextField() {} addAction() {} addCancelAction() {}
    async presentAlert() { alerts.push(this.title); return 0; } textFieldValue() { return "oat latte"; } }
  const g = {
    Request, Alert, Color, ListWidget: Stack, LinearGradient: class {}, Point: class {}, Size: class {}, Rect: class {},
    Path: class { move() {} addLine() {} }, Font: {mediumSystemFont() {}, regularSystemFont() {}, semiboldSystemFont() {}},
    Image: {fromData: () => ({})}, Data: {fromBase64String: () => ({})},
    DrawContext: class { setLineWidth() {} setStrokeColor(c) { strokes.push(c.hex); } strokeEllipse() {} addPath() {} strokePath() {}
      setFillColor() {} fillEllipse() {} getImage() {} },
    SFSymbol: {named: () => ({image: {}})},
    FileManager: {local: () => ({libraryDirectory: () => "/lib", joinPath: (a, b) => a + "/" + b,
      fileExists: p => p in files,
      readString: p => (p in files ? files[p] : null), // Scriptable returns null, not an error
      writeString: (p, s) => { files[p] = s; }, remove: p => { delete files[p]; }})},
    Script: {name: () => "Quota", setWidget() {}, complete() {}},
    config: {runsInApp: log}, args: {queryParameters: log ? {log: "1"} : {}},
  };
  Object.assign(globalThis, g); // the loader's AsyncFunction runs in global scope, like in Scriptable
  let src = read("install.js");
  if (settings) src = src
    .replace('codexbarUrl: ""', 'codexbarUrl: "http://mac:8784"')
    .replace('nightscoutUrl: ""', 'nightscoutUrl: "https://mac"');
  source = source.replace("await widget.presentMedium();", "");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return new AsyncFunction(src)().then(() => ({texts, colors, posts, alerts, files, strokes}));
}

let r = await run();
assert.ok(r.texts.includes("4.1→"), "glucose in mmol with trend");
assert.ok(r.texts.includes("15%"), "Claude shows one number: the window that stops you first");
assert.ok(r.texts.includes("89%"), "Codex shows its weekly window");
assert.ok(!r.texts.some(t => /5h|wk|Claude|Codex/.test(t)), "no names or window labels as text: icons only");
assert.ok(r.strokes.includes("FFCC00"), "Claude 5-hour at 15% turns Battery-widget yellow");
assert.ok(r.strokes.includes("34C759") && !r.strokes.includes("FF3B30"), "healthy rings and in-range glucose stay green");
assert.ok(r.files["/lib/human-quota-widget.js"], "loader keeps a copy for offline runs");

r = await run({sgv: 65});
assert.ok(r.texts.includes("3.6→") && r.strokes.includes("FF3B30"), "low (54–69 mg/dL) is red");
r = await run({sgv: 50});
assert.ok(r.strokes.includes("B3261E"), "very low (<54 mg/dL) gets its own deeper red");
r = await run({sgv: 200});
assert.ok(r.strokes.includes("FFCC00") && !r.strokes.includes("FF3B30"), "high (181–250) is yellow, not the low red");
r = await run({sgv: 270});
assert.ok(r.strokes.includes("FF9500"), "very high (>250) is orange");
r = await run();
assert.ok(r.texts.includes(new Date(now - 60000).toTimeString().slice(0, 5) + " · ＋ Log"), "measurement time and the log entry under glucose");

const cached = r.files;
r = await run({fail: {source: true}, files: {...cached}});
assert.ok(r.texts.includes("15%"), "offline loader runs the saved copy");
r = await run({source: "this is not javascript (", files: {...cached}});
assert.ok(r.texts.includes("15%"), "a broken download never replaces the working copy");

r = await run({fail: {"/dashboard/v1/snapshot": true}});
assert.ok(r.texts.includes("4.1→"), "quota outage must not hide fresh glucose");
assert.ok(r.texts.includes("—") && !r.texts.includes("15%"), "failed quota shows a dash");

r = await run({settings: false});
assert.ok(r.texts.includes("Open the script to add your settings"));

r = await run({log: true});
assert.equal(r.posts.length, 1);
assert.equal(r.posts[0][0].eventType, "Note");
assert.equal(r.posts[0][0].notes, "oat latte");
assert.ok(r.alerts.includes("Saved"));
console.log("smoke ok");
