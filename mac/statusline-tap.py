#!/usr/bin/env python3
"""Claude Code statusLine wrapper: save the rate limits Claude Code already sends, then run your
own status line command unchanged.

Claude Code passes a JSON document to the statusLine command on stdin after each response. For
Pro and Max plans it includes rate_limits.five_hour and rate_limits.seven_day (used_percentage,
resets_at). This script writes those two windows to ~/.human-quota/claude.json and then hands the
same stdin to the command given after "--" (or prints nothing if there is none).

settings.json:
  "statusLine": {"type": "command",
                 "command": "python3 ~/opt/human-quota/statusline-tap.py -- your-old-command args"}

No login, token or cookie is read. It never fails the status line: any error is ignored.
"""
import json, os, subprocess, sys, time

OUT = os.path.expanduser(os.environ.get("HQ_CLAUDE_FILE", "~/.human-quota/claude.json"))


def save(raw):
    try:
        limits = (json.loads(raw) or {}).get("rate_limits") or {}
        windows = {k: limits[k] for k in ("five_hour", "seven_day") if isinstance(limits.get(k), dict)}
        if not windows:
            return
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        tmp = f"{OUT}.{os.getpid()}.tmp"
        with open(tmp, "w") as f:
            json.dump({"captured_at": time.time(), "rate_limits": windows}, f)
        os.replace(tmp, OUT)
    except Exception:
        pass


def main():
    raw = sys.stdin.buffer.read()
    save(raw)
    args = sys.argv[1:]
    if args[:1] == ["--"]:
        args = args[1:]
    if args:
        result = subprocess.run(args, input=raw, stdout=subprocess.PIPE)
        sys.stdout.buffer.write(result.stdout)
        sys.exit(result.returncode)


if __name__ == "__main__":
    main()
