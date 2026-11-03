#!/usr/bin/env python3
"""Skybreak local server.

Serves the game and relays messages between the game and a phone controller
on the same Wi-Fi. Standard library only.

    python3 server.py            # port 8000
    python3 server.py 8123       # another port

Open http://localhost:<port> on the computer with the webcam.
Scan the QR code in the game's menu with your phone (or open /pad on it).
"""
import http.server
import json
import os
import queue
import socket
import socketserver
import sys
import threading

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
LISTENERS = {}          # channel name -> set of queues
LOCK = threading.Lock()
CHANNELS = {"pad", "feedback"}


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # no packets are sent; this just picks the outgoing interface
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/relay/"):
            return self.stream(self.path[len("/relay/"):])
        if self.path == "/info":
            body = json.dumps({"ip": lan_ip(), "port": PORT}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path in ("/pad", "/pad/"):
            self.path = "/pad.html"
        return super().do_GET()

    def do_POST(self):
        if not self.path.startswith("/relay/"):
            return self.send_error(404)
        ch = self.path[len("/relay/"):]
        if ch not in CHANNELS:
            return self.send_error(404)
        n = min(int(self.headers.get("Content-Length", 0) or 0), 4096)
        data = self.rfile.read(n).replace(b"\n", b" ")
        with LOCK:
            qs = list(LISTENERS.get(ch, ()))
        for q in qs:
            try:
                q.put_nowait(data)
            except queue.Full:
                pass
        self.send_response(204)
        self.end_headers()

    def stream(self, ch):
        if ch not in CHANNELS:
            return self.send_error(404)
        q = queue.Queue(maxsize=64)
        with LOCK:
            LISTENERS.setdefault(ch, set()).add(q)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            self.wfile.write(b": connected\n\n")
            self.wfile.flush()
            while True:
                try:
                    data = q.get(timeout=10)
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    continue
                self.wfile.write(b"data: " + data + b"\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with LOCK:
                LISTENERS.get(ch, set()).discard(q)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    ip = lan_ip()
    with Server(("0.0.0.0", PORT), Handler) as httpd:
        print("Skybreak is running.")
        print(f"  Game (this computer):  http://localhost:{PORT}")
        print(f"  Phone controller:      http://{ip}:{PORT}/pad   (same Wi-Fi)")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
