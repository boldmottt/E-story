#!/usr/bin/env python3
"""E-Story Books HTTP Server — serve Books/ folder for mobile import"""

import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
DIR = os.path.join(os.path.dirname(__file__), 'Books')

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)
    
    def end_headers(self):
        # CORS for mobile/GPages access
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        super().end_headers()
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()
    
    def log_message(self, format, *args):
        print(f"[E-Story] {args[0]} {args[1]} {args[2]}")

if __name__ == '__main__':
    if not os.path.isdir(DIR):
        print(f"❌ Books/ 폴더를 찾을 수 없습니다: {DIR}")
        print("   이 스크립트를 E-story 프로젝트 루트에서 실행해주세요.")
        sys.exit(1)
    
    print(f"📚 E-Story Books Server: http://localhost:{PORT}")
    print(f"   모바일에서 http://[MAC_IP]:{PORT}/ 로 접속")
    print(f"   (같은 와이파이 필요, MAC_IP는 ifconfig | grep inet 으로 확인)")
    print("   종료: Ctrl+C")
    print()
    
    http.server.HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
