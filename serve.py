#!/usr/bin/env python3
"""E-Story dev server — serves the static app AND proxies AI calls.

Why a proxy: opencode.ai/zen sends no CORS headers, so a pure browser app
cannot call it directly. This server forwards /api/zen/* to opencode.ai and
injects the API key from the OPENCODE_API_KEY env var, so the browser never
needs (or sees) the key. Same-origin requests => no CORS problem.
"""

import http.server
import json
import os
import sys
import urllib.error
import urllib.request

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.dirname(os.path.abspath(__file__))
API_KEY = os.environ.get("OPENCODE_API_KEY", "")

# Strict allowlist: /api/zen/<rest>  ->  https://opencode.ai/zen/<rest>
PROXY_PREFIX = "/api/zen/"
UPSTREAM_BASE = "https://opencode.ai/zen/"
PROXY_TIMEOUT = 120  # reasoning models are slow


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        try:
            print(f"[E-Story] {fmt % args}")
        except Exception:
            print(f"[E-Story] {' '.join(str(a) for a in args)}")

    def do_POST(self):
        if self.path.startswith(PROXY_PREFIX):
            self._proxy()
        else:
            self._json_error(404, "not_found", f"No POST route for {self.path}")

    def _proxy(self):
        if not API_KEY:
            self._json_error(
                503, "no_key",
                "OPENCODE_API_KEY is not set on the server. "
                "Run: export OPENCODE_API_KEY=sk-... before starting serve.py",
            )
            return

        rest = self.path[len(PROXY_PREFIX):]
        upstream = UPSTREAM_BASE + rest

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b""

        req = urllib.request.Request(
            upstream,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {API_KEY}",
                # Cloudflare (error 1010) blocks the default Python-urllib UA.
                "User-Agent": "curl/8.7.1",
            },
        )

        try:
            with urllib.request.urlopen(req, timeout=PROXY_TIMEOUT) as resp:
                payload = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        except urllib.error.HTTPError as e:
            payload = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except Exception as e:  # noqa: BLE001 — surface any transport failure to the client
            self._json_error(502, "upstream_error", str(e))

    def _json_error(self, status, code, message):
        payload = json.dumps({"error": {"code": code, "message": message}}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == "__main__":
    key_state = "✅ set" if API_KEY else "❌ NOT set (AI calls will fail)"
    print(f"📖 E-Story: http://localhost:{PORT}")
    print(f"   모바일: http://[MAC_IP]:{PORT}/  (같은 와이파이, ifconfig | grep inet)")
    print(f"   AI 프록시: {PROXY_PREFIX}*  ->  {UPSTREAM_BASE}*")
    print(f"   OPENCODE_API_KEY: {key_state}")
    print("   종료: Ctrl+C\n")
    http.server.HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
