# SPDX-License-Identifier: Apache-2.0
"""serve_nocache.py -- the dev page server with caching off, so a test run always loads the current src/*.js (Chrome kept
old ES modules from `python3 -m http.server` and a rerun after a fix still ran the old code).
  python3 tools/serve_nocache.py 8077      (from the worldgen-poc folder)
"""
import http.server
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8077
    http.server.ThreadingHTTPServer(("127.0.0.1", port), NoCache).serve_forever()
