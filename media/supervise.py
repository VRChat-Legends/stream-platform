import hmac
import os
import re
import signal
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

process = None
stopping = False
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass
    def do_POST(self):
        if self.path != "/restart" or not hmac.compare_digest(self.headers.get("x-internal-token", ""), os.environ["INTERNAL_TOKEN"]):
            self.send_error(403)
            return
        if process and process.poll() is None:
            process.terminate()
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"ok":true}')
threading.Thread(target=HTTPServer(("0.0.0.0",9998),Handler).serve_forever,daemon=True).start()
def stop(*_):
    global stopping
    stopping = True
    if process:
        process.terminate()
signal.signal(signal.SIGTERM,stop)
signal.signal(signal.SIGINT,stop)
while not stopping:
    process = subprocess.Popen(["/usr/local/bin/mediamtx","/mediamtx.yml"],stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    for line in process.stdout:
        message = re.sub(r"ingest/[a-f0-9]+","ingest/[redacted]",line.decode(errors="replace"))
        message = message.replace(os.environ["INTERNAL_TOKEN"],"[redacted]")
        print(message,end="",flush=True)
    process.wait()
    if not stopping:
        time.sleep(1)
