"""Run inside the program container: python /tmp/continuity.py.
This publishes a 720p test feed, then verifies continuous 1080p HLS decoding.
Do not run during a real broadcast.
"""
import json, os, re, subprocess, threading, time, urllib.request
from urllib.parse import urljoin
TOKEN=os.environ["INTERNAL_TOKEN"]
HOST="https://"+os.environ["STREAM_HOST"]
WATCH="https://"+os.environ["WATCH_HOST"]
def get(url, private=False):
    req=urllib.request.Request(url,headers={"x-internal-token":TOKEN} if private else {})
    with urllib.request.urlopen(req,timeout=8) as r:
        return r.read().decode(),r.headers
config=json.loads(get("http://backend:3001/internal/program",True)[0])
assert not config["connected"], "A real publisher is active; test aborted"
assert json.loads(get(WATCH+"/api/status")[0])["pipelineReady"]
key=config["key"]
master,headers=get(HOST+"/live/index.m3u8")
assert "mpegurl" in headers.get("Content-Type","").lower()
media=next(l for l in master.splitlines() if l and not l.startswith("#"))
playlist=urljoin(HOST+"/live/index.m3u8",media)
frames=[]
client=subprocess.Popen(["ffmpeg","-v","warning","-i",HOST+"/live/index.m3u8","-map","0:v:0","-vf","scale=32:18","-f","framemd5","pipe:1"],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
def read():
    for line in client.stdout:
        text=line.decode().strip()
        if text and not text.startswith("#"):
            fields=text.split(",")
            frames.append((time.time(),int(fields[2]),fields[-1].strip()))
threading.Thread(target=read,daemon=True).start()
sequences=[]
sources=[]
errors=[]
publisher=None
began=time.time()
connected_at=None
disconnected_at=None
try:
    for second in range(72):
        if second==12:
            publisher=subprocess.Popen(["ffmpeg","-hide_banner","-loglevel","error","-re","-f","lavfi","-i","color=c=0xd63c4c:s=1280x720:r=30","-f","lavfi","-i","sine=frequency=440:sample_rate=48000","-c:v","libx264","-threads","1","-preset","ultrafast","-b:v","2500k","-g","60","-bf","0","-pix_fmt","yuv420p","-c:a","aac","-b:a","160k","-ac","2","-ar","48000","-f","flv","rtmp://mediamtx:1935/ingest/"+key],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            connected_at=time.time()
            print("Test publisher connected",flush=True)
        if second==37:
            publisher.terminate()
            publisher.wait(timeout=8)
            disconnected_at=time.time()
            print("Test publisher disconnected",flush=True)
        try:
            text,_=get(playlist)
            assert "#EXT-X-ENDLIST" not in text
            seq=int(re.search(r"#EXT-X-MEDIA-SEQUENCE:(\d+)",text).group(1))
            assert not sequences or seq>=sequences[-1]
            sequences.append(seq)
            segments=[l for l in text.splitlines() if l and not l.startswith("#")]
            assert segments
            with urllib.request.urlopen(urljoin(playlist,segments[-1]),timeout=8) as response:
                assert response.status==200
                response.read(188)
            status=json.loads(get(WATCH+"/api/status")[0])
            sources.append(status["programSource"])
            assert client.poll() is None, "HLS client exited"
        except Exception as e:
            errors.append(str(e))
        if second%10==0:
            print(json.dumps({"elapsed":second,"sequence":sequences[-1] if sequences else None,"decodedFrames":len(frames),"source":sources[-1] if sources else None}),flush=True)
        time.sleep(max(0,began+second+1-time.time()))
finally:
    if publisher and publisher.poll() is None:
        publisher.terminate()
    client.terminate()
    client.wait(timeout=8)
assert not errors,errors
assert "obs" in sources and sources[-1]=="fallback",sources
assert len(frames)>1000,len(frames)
assert all(b[1]>a[1] for a,b in zip(frames,frames[1:])),"Backward or repeated decoded timestamp"
hashes=[x[2] for x in frames]
assert len(set(hashes))>=2,"The video did not visually change"
assert hashes[0]==hashes[-1],"Video did not return to fallback"
assert sequences[-1]>sequences[0]+25,"Playlist did not advance"
gaps=[b[0]-a[0] for a,b in zip(frames,frames[1:])]
result={"passed":True,"durationSeconds":round(time.time()-began),"sequenceStart":sequences[0],"sequenceEnd":sequences[-1],"decodedFrames":len(frames),"uniqueFrameHashes":len(set(hashes)),"maxDecodeGapSeconds":round(max(gaps),2),"timestampMonotonic":True,"switchedToObsAndBack":True,"playlistErrors":errors}
print(json.dumps(result,indent=2),flush=True)
open("/tmp/continuity-result.json","w").write(json.dumps(result,indent=2))
