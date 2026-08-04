import os, sys, json, socket, urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = 8085
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

def get_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

LAN_IP = get_lan_ip()

class NetflixCloneHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        url_path = urllib.parse.urlparse(self.path).path
        if url_path == '/api/catalog':
            catalog_file = os.path.join(ROOT_DIR, 'catalog.json')
            if os.path.exists(catalog_file):
                with open(catalog_file, 'rb') as f:
                    content = f.read()
            else:
                content = b'{}'
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return

        if url_path == '/':
            self.path = '/login.html'
        return super().do_GET()

    def do_POST(self):
        url_path = urllib.parse.urlparse(self.path).path
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else b''

        if url_path == '/api/catalog':
            catalog_file = os.path.join(ROOT_DIR, 'catalog.json')
            with open(catalog_file, 'wb') as f:
                f.write(body)
            res = json.dumps({'success': True}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(res)))
            self.end_headers()
            self.wfile.write(res)
            return

        if url_path == '/api/upload':
            try:
                data = json.loads(body.decode('utf-8'))
                uploads_dir = os.path.join(ROOT_DIR, 'uploads')
                os.makedirs(uploads_dir, exist_ok=True)
                filename = data.get('filename', f'video_{int(os.path.getmtime(ROOT_DIR))}.mp4')
                base64_str = data.get('base64', '')
                if ',' in base64_str:
                    base64_str = base64_str.split(',', 1)[1]
                import base64
                file_bytes = base64.b64decode(base64_str)
                file_path = os.path.join(uploads_dir, filename)
                with open(file_path, 'wb') as f:
                    f.write(file_bytes)

                res = json.dumps({'success': True, 'url': f'/uploads/{filename}'}).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(res)))
                self.end_headers()
                self.wfile.write(res)
            except Exception as e:
                self.send_response(400)
                self.end_headers()
            return

    def do_PUT(self):
        url_path = urllib.parse.urlparse(self.path).path
        if url_path == '/api/catalog':
            return self.do_POST()
        self.send_response(405)
        self.end_headers()

if __name__ == '__main__':
    server = HTTPServer(('0.0.0.0', PORT), NetflixCloneHandler)
    print("=" * 56)
    print("  HODISHAUNFLIX CROSS-PLATFORM DEV SERVER RUNNING")
    print("=" * 56)
    print(f"  Local PC URL   : http://localhost:{PORT}/login.html")
    print(f"  Mobile/LAN URL : http://{LAN_IP}:{PORT}/login.html")
    print("-" * 56)
    print(f"  Open http://{LAN_IP}:{PORT}/login.html on your phone!")
    print("=" * 56)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
