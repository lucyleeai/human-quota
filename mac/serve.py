#!/usr/bin/env python3
"""human-quota snapshot server: Claude and Codex limits from files already on this Mac.

- Claude: ~/.human-quota/claude.json, written by statusline-tap.py from the rate_limits that
  Claude Code passes to its status line.
- Codex: the newest rate_limits event in Codex's own session logs (~/.codex/sessions).

No login, token, cookie or Keychain read, and no network call. Serves the same JSON shape as
`codexbar serve` (GET /dashboard/v1/snapshot, Bearer token), so the widget works with either.

Env: HQ_TOKEN (or CODEXBAR_DASHBOARD_TOKEN), HQ_HOSTS (comma list, default 127.0.0.1),
HQ_PORT (default 8784). Run `serve.py --print` to print one snapshot and exit.
"""
import datetime as dt, glob, hmac, json, os, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOME = os.path.expanduser("~")
CLAUDE_FILE = os.path.expanduser(os.environ.get("HQ_CLAUDE_FILE", "~/.human-quota/claude.json"))
CODEX_DIR = os.path.expanduser(os.environ.get("HQ_CODEX_SESSIONS", "~/.codex/sessions"))
TOKEN = os.environ.get("HQ_TOKEN") or os.environ.get("CODEXBAR_DASHBOARD_TOKEN") or ""
STALE_AFTER = 900


def iso(epoch):
    return dt.datetime.fromtimestamp(epoch, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if epoch else None


def window(kind, label, used, resets_at, now):
    """A window whose reset time has passed is full again: nothing can have used it unseen
    except other Claude/Codex clients, and the next reading corrects that."""
    if resets_at and resets_at <= now:
        used, resets_at = 0.0, None
    used = max(0.0, min(100.0, float(used)))
    return {"kind": kind, "label": label, "usedPercent": round(used, 1),
            "remainingPercent": round(100 - used, 1), "resetAt": iso(resets_at)}


def claude(now):
    p = {"id": "claude", "name": "Claude", "source": "statusline", "enabled": True, "windows": []}
    try:
        with open(CLAUDE_FILE) as f:
            d = json.load(f)
        rl = d["rate_limits"]
        for key, kind, label in (("five_hour", "session", "Session"), ("seven_day", "weekly", "Weekly")):
            w = rl.get(key)
            if w and w.get("used_percentage") is not None:
                p["windows"].append(window(kind, label, w["used_percentage"], w.get("resets_at"), now))
        p["updatedAt"], p["error"] = iso(d["captured_at"]), None
    except Exception as e:
        p["updatedAt"], p["error"] = None, f"no Claude Code reading yet ({type(e).__name__})"
    return p


def latest_codex_limits():
    """Newest token_count event carrying rate_limits, across the most recently written rollouts."""
    files = sorted(glob.glob(os.path.join(CODEX_DIR, "*", "*", "*", "*.jsonl")),
                   key=os.path.getmtime, reverse=True)[:8]
    best = None
    for path in files:
        try:
            with open(path, "rb") as f:
                f.seek(0, 2); size = f.tell(); f.seek(max(0, size - 1_000_000))
                lines = f.read().splitlines()
        except OSError:
            continue
        for line in reversed(lines):
            if b'"rate_limits"' not in line:
                continue
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            rl = (ev.get("payload") or {}).get("rate_limits")
            if not rl:
                continue
            at = dt.datetime.fromisoformat(ev["timestamp"].replace("Z", "+00:00")).timestamp()
            if best is None or at > best[0]:
                best = (at, rl)
            break
    return best


def codex(now):
    p = {"id": "codex", "name": "Codex", "source": "session-log", "enabled": True, "windows": []}
    found = latest_codex_limits()
    if not found:
        p["updatedAt"], p["error"] = None, "no Codex rate_limits event found"
        return p
    at, rl = found
    for slot in ("primary", "secondary"):
        w = rl.get(slot)
        if not w or w.get("used_percent") is None:
            continue
        minutes = w.get("window_minutes") or 0
        kind, label = ("weekly", "Weekly") if minutes >= 1440 else ("session", "Session")
        p["windows"].append(window(kind, label, w["used_percent"], w.get("resets_at"), now))
    p["updatedAt"], p["error"] = iso(at), None
    return p


def snapshot():
    now = time.time()
    return {"schemaVersion": 1, "generatedAt": iso(now), "staleAfterSeconds": STALE_AFTER,
            "host": {"server": "human-quota", "usageBarsShowUsed": False},
            "providers": [claude(now), codex(now)]}


class Handler(BaseHTTPRequestHandler):
    def send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/health":
            return self.send(200, {"ok": True})
        if path != "/dashboard/v1/snapshot":
            return self.send(404, {"error": "not found"})
        sent = self.headers.get("Authorization", "")
        if not TOKEN or not hmac.compare_digest(sent.encode(), f"Bearer {TOKEN}".encode()):
            return self.send(401, {"error": "unauthorized"})
        self.send(200, snapshot())

    def log_message(self, format, *args):
        sys.stderr.write("%s %s %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), self.address_string(), format % args))


def main():
    if "--print" in sys.argv:
        print(json.dumps(snapshot(), indent=2)); return
    if not TOKEN:
        sys.exit("set HQ_TOKEN (or CODEXBAR_DASHBOARD_TOKEN) first")
    port = int(os.environ.get("HQ_PORT", "8784"))
    hosts = [h.strip() for h in os.environ.get("HQ_HOSTS", "127.0.0.1").split(",") if h.strip()]
    servers = [ThreadingHTTPServer((h, port), Handler) for h in hosts]
    for s in servers[1:]:
        threading.Thread(target=s.serve_forever, daemon=True).start()
    sys.stderr.write(f"human-quota serving on {', '.join(hosts)}:{port}\n")
    servers[0].serve_forever()


if __name__ == "__main__":
    main()
