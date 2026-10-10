// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: green; icon-glyph: battery-half;

// human-quota — paste this once into Scriptable and fill in your settings.
// It downloads the latest widget.js on every run, so updates arrive without re-pasting.
const SETTINGS = {
  codexbarUrl: "",        // e.g. "http://100.x.y.z:8784" (your Mac's Tailscale IP)
  codexbarToken: "",      // the CODEXBAR_DASHBOARD_TOKEN you set on the Mac
  providers: ["claude", "codex"],
  nightscoutUrl: "",      // optional, e.g. "https://your-mac.your-tailnet.ts.net"
  nightscoutToken: "",    // optional, token with roles: readable, careportal
  units: "mmol",          // "mmol" or "mg/dL"
};
// Pin a release instead of main by replacing "main" with a tag, e.g. "v1.0.0".
const SOURCE = "https://raw.githubusercontent.com/lucyleeai/human-quota/main/widget.js";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const files = FileManager.local();
const saved = files.joinPath(files.libraryDirectory(), "human-quota-widget.js");
let run = null;
try {
  const request = new Request(SOURCE);
  request.timeoutInterval = 8;
  const code = await request.loadString();
  if (request.response.statusCode === 200) {
    run = new AsyncFunction("SETTINGS", code); // throws on a broken download, so the saved copy survives
    files.writeString(saved, code);
  }
} catch (_) {}
if (!run) {
  const code = files.fileExists(saved) ? files.readString(saved) : null;
  if (!code) throw new Error("Could not download the widget yet. Check your connection and run again.");
  run = new AsyncFunction("SETTINGS", code);
}
await run(SETTINGS);
