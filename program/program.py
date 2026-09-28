"""A stable frame clock isolates the encoder from input connections and timestamps."""
import collections
import json
import os
import signal
import subprocess
import threading
import time
import urllib.request

TOKEN = os.environ["INTERNAL_TOKEN"]
BASE = "http://backend:3001"
STOP = threading.Event()
CONFIG = {"settings": {"resolution": "1920x1080", "bitrate": 4500, "graceSeconds": 5, "fallbackEnabled": True}, "connected": False}
METRICS = {"ready": False, "source": "fallback", "frames": 0, "speed": 0, "cpu": 0, "restarts": 0}
FF = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin"]

def request(path, body=None):
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(),
        headers={"x-internal-token": TOKEN, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=3) as response:
        return json.load(response)

def event(message):
    print(message, flush=True)
    try:
        request("/internal/event", {"event": message})
    except Exception:
        pass

def read_exact(stream, size):
    parts = bytearray()
    while len(parts) < size:
        chunk = stream.read(size - len(parts))
        if not chunk:
            return None
        parts.extend(chunk)
    return bytes(parts)

class Decoder:
    def __init__(self, args, width, height):
        self.frame = None
        self.updated = 0.0
        self.audio = collections.deque(maxlen=12)
        self.alive = True
        vr, vw = os.pipe()
        ar, aw = os.pipe()
        vf = f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p"
        self.process = subprocess.Popen(FF + ["-threads", "1"] + args + [
            "-map", "0:v:0", "-vf", vf, "-threads", "1", "-f", "rawvideo", f"pipe:{vw}",
            "-map", "0:a:0?", "-vn", "-ac", "2", "-ar", "48000", "-f", "s16le", f"pipe:{aw}"],
            pass_fds=(vw, aw), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.close(vw)
        os.close(aw)
        def video():
            with os.fdopen(vr, "rb", buffering=0) as pipe:
                while self.alive:
                    frame = read_exact(pipe, width * height * 3 // 2)
                    if frame is None:
                        break
                    self.frame, self.updated = frame, time.monotonic()
        def audio():
            with os.fdopen(ar, "rb", buffering=0) as pipe:
                while self.alive:
                    block = read_exact(pipe, 6400)
                    if block is None:
                        break
                    self.audio.append(block)
        threading.Thread(target=video, daemon=True).start()
        threading.Thread(target=audio, daemon=True).start()

    def close(self):
        self.alive = False
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()

def standby(width, height):
    font = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    vf = (f"drawtext=fontfile={font}:text='VRChat Legends':fontcolor=0xE8ECF5:fontsize={height//16}:x=(w-tw)/2:y=h*0.44,"
          f"drawtext=fontfile={font}:text='The next live moment starts here.':fontcolor=0x8B93A7:fontsize={height//38}:x=(w-tw)/2:y=h*0.56")
    return subprocess.check_output(FF + ["-f", "lavfi", "-i", f"color=c=0x181630:s={width}x{height}:r=30",
        "-vf", vf, "-frames:v", "1", "-pix_fmt", "yuv420p", "-threads", "1", "-f", "rawvideo", "pipe:1"])

def controller():
    global CONFIG
    while not STOP.wait(1):
        try:
            CONFIG = request("/internal/program")
            request("/internal/program", METRICS)
        except Exception:
            pass

threading.Thread(target=controller, daemon=True).start()
signal.signal(signal.SIGTERM, lambda *_: STOP.set())
signal.signal(signal.SIGINT, lambda *_: STOP.set())
while not STOP.is_set() and "key" not in CONFIG:
    STOP.wait(1)

while not STOP.is_set():
    settings = CONFIG["settings"]
    width, height = map(int, settings["resolution"].split("x"))
    slate = standby(width, height)
    initial_format = (settings["resolution"], settings["bitrate"])
    restart_id = CONFIG.get("restartRequested", 0)
    vr, vw = os.pipe()
    ar, aw = os.pipe()
    output = subprocess.Popen(FF + [
        "-thread_queue_size", "8", "-f", "rawvideo", "-pixel_format", "yuv420p",
        "-video_size", f"{width}x{height}", "-framerate", "30", "-i", f"pipe:{vr}",
        "-thread_queue_size", "64", "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", f"pipe:{ar}",
        "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-threads", "2", "-preset", "veryfast",
        "-tune", "zerolatency", "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-b:v", str(settings["bitrate"]) + "k", "-minrate", str(settings["bitrate"]) + "k",
        "-maxrate", str(settings["bitrate"]) + "k", "-bufsize", str(settings["bitrate"] * 2) + "k",
        "-x264-params", "nal-hrd=cbr:force-cfr=1", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0", "-bf", "0",
        "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
        "-progress", "pipe:1", "-stats_period", "2", "-f", "rtsp", "-rtsp_transport", "tcp",
        f"rtsp://service:{TOKEN}@mediamtx:8554/live"],
        pass_fds=(vr, ar), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    os.close(vr)
    os.close(ar)
    cycle_stop = threading.Event()
    inputs = {"obs": None, "fallback": None}
    epoch = time.monotonic()
    last_progress = [epoch]

    def chosen():
        obs = inputs["obs"]
        grace = CONFIG["settings"]["graceSeconds"]
        if obs and obs.frame and time.monotonic() - obs.updated < max(.5, grace):
            METRICS["source"] = "obs"
            return obs
        METRICS["source"] = "fallback"
        return inputs["fallback"] if CONFIG["settings"]["fallbackEnabled"] else None

    def writer(fd, audio=False):
        index = 0
        try:
            with os.fdopen(fd, "wb", buffering=0) as pipe:
                while not cycle_stop.is_set() and not STOP.is_set():
                    wait = epoch + index / 30 - time.monotonic()
                    if wait > 0:
                        cycle_stop.wait(wait)
                    source = chosen()
                    if audio:
                        data = source.audio.popleft() if source and source.audio else bytes(6400)
                    else:
                        data = source.frame if source and source.frame else slate
                    remaining = memoryview(data)
                    while remaining:
                        n = pipe.write(remaining)
                        remaining = remaining[n:]
                    index += 1
        except (BrokenPipeError, OSError):
            cycle_stop.set()

    def progress():
        for raw in output.stdout:
            line = raw.decode(errors="replace").strip()
            if line.startswith("frame="):
                METRICS["frames"] = int(line.split("=")[1])
                METRICS["ready"] = True
                last_progress[0] = time.monotonic()
            if line.startswith("speed="):
                try:
                    METRICS["speed"] = float(line.split("=")[1].strip("x "))
                except ValueError:
                    pass

    threading.Thread(target=writer, args=(vw,), daemon=True).start()
    threading.Thread(target=writer, args=(aw, True), daemon=True).start()
    threading.Thread(target=progress, daemon=True).start()
    event("Continuous program encoder started")
    decoder_key = ""
    fallback_stamp = 0
    cpu_ticks, cpu_time = 0, time.monotonic()
    try:
        while not STOP.wait(.5) and output.poll() is None and not cycle_stop.is_set():
            cfg = CONFIG
            if (cfg["settings"]["resolution"], cfg["settings"]["bitrate"]) != initial_format or cfg.get("restartRequested", 0) != restart_id:
                event("Program format or restart request applied")
                break
            obs = inputs["obs"]
            if cfg.get("connected") and cfg.get("key"):
                if not obs or obs.process.poll() is not None or decoder_key != cfg["key"]:
                    if obs:
                        obs.close()
                    decoder_key = cfg["key"]
                    inputs["obs"] = Decoder(["-rtsp_transport", "tcp", "-timeout", "5000000", "-analyzeduration", "1000000",
                        "-probesize", "1000000", "-i", f"rtsp://service:{TOKEN}@mediamtx:8554/ingest/{decoder_key}"], width, height)
            elif obs and obs.process.poll() is None:
                obs.close()
            fallback_path = "/data/uploads/fallback.mp4"
            stamp = os.stat(fallback_path).st_mtime_ns if os.path.exists(fallback_path) else 0
            fallback = inputs["fallback"]
            if stamp and (stamp != fallback_stamp or not fallback or fallback.process.poll() is not None):
                if fallback:
                    fallback.close()
                inputs["fallback"] = Decoder(["-re", "-stream_loop", "-1", "-i", fallback_path], width, height)
                fallback_stamp = stamp
            now = time.monotonic()
            try:
                stat = open(f"/proc/{output.pid}/stat").read().split()
                ticks = int(stat[13]) + int(stat[14])
                METRICS["cpu"] = round((ticks - cpu_ticks) / os.sysconf("SC_CLK_TCK") / (now - cpu_time) * 100, 1)
                cpu_ticks, cpu_time = ticks, now
            except (OSError, ValueError):
                pass
            if now - last_progress[0] > 15:
                event("Encoder stalled; supervisor restarting it")
                break
    finally:
        METRICS["ready"] = False
        cycle_stop.set()
        for decoder in inputs.values():
            if decoder:
                decoder.close()
        if output.poll() is None:
            output.terminate()
            try:
                output.wait(timeout=3)
            except subprocess.TimeoutExpired:
                output.kill()
                output.wait()
        METRICS["restarts"] += 1
    if not STOP.is_set():
        event("Program encoder recovering")
        STOP.wait(2)

