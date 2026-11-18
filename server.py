"""Candle in the Dark - a local player for Carl Sagan's Cosmos: A Personal Voyage (1980).

Stdlib only. Run:  python server.py   then open http://localhost:8765
"""
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
VIDEOS = os.path.join(ROOT, "videos")
STATIC = os.path.join(ROOT, "static")
SUBS = os.path.join(DATA, "subs")
USER_FILE = os.path.join(DATA, "user.json")
ITEM = "CosmosAPersonalVoyage"
PORT = int(os.environ.get("COSMOS_PORT", "8765"))
# 0.0.0.0 so phones on the same Wi-Fi can connect; requests from outside private ranges are refused.
HOST = os.environ.get("COSMOS_HOST", "0.0.0.0")


def lan_ip():
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # no packet is sent; just picks the LAN interface
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def is_private(addr):
    import ipaddress
    try:
        ip = ipaddress.ip_address(addr)
        if ip.version == 6 and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        return ip.is_private or ip.is_loopback or ip.is_link_local
    except ValueError:
        return False

os.makedirs(VIDEOS, exist_ok=True)

with open(os.path.join(DATA, "episodes.json"), encoding="utf-8") as f:
    EPISODES = {e["num"]: e for e in json.load(f)}


def remote_url(ep):
    return f"https://archive.org/download/{ITEM}/{urllib.parse.quote(ep['file'])}"


def video_path(num):
    return os.path.join(VIDEOS, f"cosmos-{num:02d}.mp4")


# ---------------------------------------------------------------- user data
_user_lock = threading.Lock()


def load_user():
    try:
        with open(USER_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"progress": {}, "notes": {}, "seen": {}, "answers": {}}


def save_user(u):
    tmp = USER_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(u, f, indent=1)
    os.replace(tmp, USER_FILE)


def mutate_user(fn):
    with _user_lock:
        u = load_user()
        for k in ("progress", "notes", "seen", "answers"):
            u.setdefault(k, {})
        result = fn(u)
        save_user(u)
        return result


# ---------------------------------------------------------------- downloads
class Downloader:
    """Sequential download queue with resume (HTTP Range) and live progress."""

    def __init__(self):
        self.lock = threading.Lock()
        self.queue = []
        self.status = {}  # num -> {"state","bytes","total","speed","error"}
        self.cancel = set()
        for _ in range(3):  # archive.org throttles per connection; 3 in parallel
            threading.Thread(target=self._worker, daemon=True).start()

    def state(self, num):
        ep = EPISODES[num]
        if os.path.exists(video_path(num)):
            return {"state": "done", "bytes": ep["size"], "total": ep["size"]}
        with self.lock:
            s = self.status.get(num)
            if s:
                return dict(s)
        part = video_path(num) + ".part"
        have = os.path.getsize(part) if os.path.exists(part) else 0
        return {"state": "partial" if have else "none", "bytes": have, "total": ep["size"]}

    def enqueue(self, num):
        with self.lock:
            if num in self.queue or os.path.exists(video_path(num)):
                return
            cur = self.status.get(num, {}).get("state")
            if cur == "downloading":
                return
            self.cancel.discard(num)
            self.queue.append(num)
            self.status[num] = {"state": "queued", "bytes": 0, "total": EPISODES[num]["size"]}

    def stop(self, num):
        with self.lock:
            if num in self.queue:
                self.queue.remove(num)
                self.status.pop(num, None)
            self.cancel.add(num)

    def _worker(self):
        while True:
            with self.lock:
                num = self.queue.pop(0) if self.queue else None
                if num is not None:
                    self.status[num] = {"state": "downloading", "bytes": 0,
                                        "total": EPISODES[num]["size"]}
            if num is None:
                time.sleep(0.5)
                continue
            for attempt in range(5):
                try:
                    self._download(num)
                    break
                except Exception as e:  # network hiccup: retry with resume
                    with self.lock:
                        self.status[num] = {**self.status.get(num, {}), "state": "error", "error": str(e)}
                    if num in self.cancel:
                        break
                    time.sleep(3 * (attempt + 1))

    def _download(self, num):
        ep = EPISODES[num]
        part = video_path(num) + ".part"
        have = os.path.getsize(part) if os.path.exists(part) else 0
        req = urllib.request.Request(remote_url(ep), headers={"User-Agent": "candle-in-the-dark/1.0"})
        if have:
            req.add_header("Range", f"bytes={have}-")
        with urllib.request.urlopen(req, timeout=60) as r:
            if have and r.status != 206:
                have = 0  # server ignored range; restart
            mode = "ab" if have else "wb"
            with open(part, mode) as out:
                t0, b0 = time.time(), have
                speed = 0.0
                while True:
                    if num in self.cancel:
                        with self.lock:
                            self.status.pop(num, None)
                        return
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    out.write(chunk)
                    have += len(chunk)
                    now = time.time()
                    if now - t0 >= 1:
                        speed = (have - b0) / (now - t0)
                        t0, b0 = now, have
                    with self.lock:
                        self.status[num] = {"state": "downloading", "bytes": have,
                                            "total": ep["size"], "speed": speed}
        if have >= ep["size"]:
            os.replace(part, video_path(num))
            with self.lock:
                self.status[num] = {"state": "done", "bytes": have, "total": ep["size"]}
        else:
            raise IOError(f"incomplete: {have}/{ep['size']}")


DL = Downloader()


# ---------------------------------------------------------------- http
MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml",
        ".vtt": "text/vtt; charset=utf-8", ".mp4": "video/mp4", ".png": "image/png"}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def parse_request(self):
        ok = super().parse_request()
        if ok and not is_private(self.client_address[0]):
            self.send_error(403, "Candle in the Dark only answers devices on your home network")
            return False
        return ok

    # helpers
    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def send_file(self, path, ctype=None):
        if not os.path.isfile(path):
            return self.send_error(404)
        size = os.path.getsize(path)
        ctype = ctype or MIME.get(os.path.splitext(path)[1], "application/octet-stream")
        start, end = 0, size - 1
        rng = self.headers.get("Range")
        m = re.match(r"bytes=(\d*)-(\d*)", rng or "")
        if m:
            if m.group(1):
                start = int(m.group(1))
                if m.group(2):
                    end = min(int(m.group(2)), size - 1)
            elif m.group(2):
                start = max(0, size - int(m.group(2)))
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        length = end - start + 1
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if ctype.startswith(("text/html", "text/javascript", "text/css", "application/json")):
            self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        try:
            with open(path, "rb") as f:
                f.seek(start)
                left = length
                while left > 0:
                    chunk = f.read(min(1 << 20, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
            pass

    def episodes_payload(self):
        u = load_user()
        out = []
        for num, ep in sorted(EPISODES.items()):
            out.append({
                "num": num, "title": ep["title"], "length": ep["length"], "size": ep["size"],
                "download": DL.state(num),
                "remote": remote_url(ep),
                "hasSubs": os.path.exists(os.path.join(SUBS, f"ep{num:02d}.vtt")),
                "progress": u.get("progress", {}).get(str(num)),
                "noteCount": len(u.get("notes", {}).get(str(num), [])),
            })
        return out

    # routes
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/":
            return self.send_file(os.path.join(STATIC, "index.html"))
        if path.startswith("/static/"):
            p = os.path.normpath(os.path.join(STATIC, path[len("/static/"):]))
            if not p.startswith(STATIC):
                return self.send_error(403)
            return self.send_file(p)
        if path == "/api/episodes":
            return self.send_json(self.episodes_payload())
        if path == "/api/segments":
            with open(os.path.join(DATA, "segments.json"), encoding="utf-8") as f:
                return self.send_json(json.load(f))
        if path == "/api/user":
            return self.send_json(load_user())
        if path == "/api/lan":
            ip = lan_ip()
            return self.send_json({"url": f"http://{ip}:{PORT}" if ip else None})
        m = re.match(r"^/video/(\d+)$", path)
        if m:
            return self.send_file(video_path(int(m.group(1))), "video/mp4")
        m = re.match(r"^/subs/(\d+)\.vtt$", path)
        if m:
            return self.send_file(os.path.join(SUBS, f"ep{int(m.group(1)):02d}.vtt"))
        self.send_error(404)

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        body = self.read_json()
        if path == "/api/download":
            nums = list(EPISODES) if body.get("all") else [int(body["num"])]
            for n in nums:
                DL.enqueue(n)
            return self.send_json({"ok": True})
        if path == "/api/download/stop":
            DL.stop(int(body["num"]))
            return self.send_json({"ok": True})
        m = re.match(r"^/api/progress/(\d+)$", path)
        if m:
            key = m.group(1)

            def f(u):
                u["progress"][key] = {"position": float(body.get("position", 0)),
                                      "duration": float(body.get("duration", 0)),
                                      "updated": time.time()}
            mutate_user(f)
            return self.send_json({"ok": True})
        m = re.match(r"^/api/seen/([\w-]+)$", path)
        if m:
            key = m.group(1)

            def f(u):
                if body.get("seen", True):
                    u["seen"][key] = time.time()
                else:
                    u["seen"].pop(key, None)
            mutate_user(f)
            return self.send_json({"ok": True})
        m = re.match(r"^/api/answers/([\w-]+)$", path)
        if m:
            seg, q, text = m.group(1), str(int(body["q"])), str(body.get("text", ""))

            def f(u):
                a = u["answers"].setdefault(seg, {})
                if text.strip():
                    a[q] = {"text": text, "updated": time.time()}
                else:
                    a.pop(q, None)
                if not a:
                    u["answers"].pop(seg, None)
            mutate_user(f)
            return self.send_json({"ok": True})
        m = re.match(r"^/api/notes/(\d+)$", path)
        if m:
            key = m.group(1)

            def f(u):
                notes = u["notes"].setdefault(key, [])
                nid = body.get("id")
                if nid:
                    for n in notes:
                        if n["id"] == nid:
                            n["text"] = body.get("text", n["text"])
                            n["edited"] = time.time()
                            return n
                n = {"id": f"n{int(time.time() * 1000)}", "t": float(body.get("t", 0)),
                     "text": body.get("text", ""), "created": time.time()}
                notes.append(n)
                notes.sort(key=lambda x: x["t"])
                return n
            return self.send_json(mutate_user(f))
        self.send_error(404)

    def do_DELETE(self):
        path = urllib.parse.urlparse(self.path).path
        m = re.match(r"^/api/notes/(\d+)/(\w+)$", path)
        if m:
            key, nid = m.groups()

            def f(u):
                u["notes"][key] = [n for n in u["notes"].get(key, []) if n["id"] != nid]
            mutate_user(f)
            return self.send_json({"ok": True})
        self.send_error(404)


if __name__ == "__main__":
    import sys
    if "--download-all" in sys.argv:
        for n in EPISODES:
            DL.enqueue(n)
    print(f"Candle in the Dark running at http://localhost:{PORT}")
    if HOST != "127.0.0.1" and lan_ip():
        print(f"On your phone (same Wi-Fi): http://{lan_ip()}:{PORT}")
    class Server(ThreadingHTTPServer):
        daemon_threads = True

        def handle_error(self, request, client_address):
            import sys
            if isinstance(sys.exc_info()[1], (ConnectionError, TimeoutError)):
                return  # browsers drop video connections all the time when you seek
            super().handle_error(request, client_address)

    Server((HOST, PORT), Handler).serve_forever()
