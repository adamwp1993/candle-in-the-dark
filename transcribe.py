"""Transcribe downloaded Cosmos episodes with faster-whisper -> data/subs/epNN.vtt + epNN.json.

Run with the whisper venv:  .venv-whisper\\Scripts\\python transcribe.py [--watch] [--model small.en]
--watch keeps polling until every episode is downloaded and transcribed.
"""
import glob
import json
import os
import site
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
SUBS = os.path.join(ROOT, "data", "subs")
os.makedirs(SUBS, exist_ok=True)

# Make pip-installed CUDA libs (nvidia-cublas-cu12 / nvidia-cudnn-cu12) loadable on Windows.
for sp in site.getsitepackages():
    for d in glob.glob(os.path.join(sp, "nvidia", "*", "bin")):
        os.add_dll_directory(d)
        os.environ["PATH"] = d + os.pathsep + os.environ["PATH"]

from faster_whisper import WhisperModel  # noqa: E402


def ts(t):
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{s:06.3f}"


def load_model(name):
    try:
        return WhisperModel(name, device="cuda", compute_type="float16")
    except Exception as e:
        print("CUDA unavailable, falling back to CPU:", e, flush=True)
        return WhisperModel(name, device="cpu", compute_type="int8")


def transcribe(model, num):
    src = os.path.join(ROOT, "videos", f"cosmos-{num:02d}.mp4")
    t0 = time.time()
    segments, info = model.transcribe(src, language="en", vad_filter=True, beam_size=5)
    rows = []
    for s in segments:
        rows.append({"s": round(s.start, 2), "e": round(s.end, 2), "t": s.text.strip()})
    with open(os.path.join(SUBS, f"ep{num:02d}.json"), "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=0)
    with open(os.path.join(SUBS, f"ep{num:02d}.vtt"), "w", encoding="utf-8") as f:
        f.write("WEBVTT\n\n")
        for r in rows:
            f.write(f"{ts(r['s'])} --> {ts(r['e'])}\n{r['t']}\n\n")
    print(f"ep{num:02d}: {len(rows)} lines in {time.time() - t0:.0f}s", flush=True)


def main():
    model_name = sys.argv[sys.argv.index("--model") + 1] if "--model" in sys.argv else "small.en"
    watch = "--watch" in sys.argv
    model = load_model(model_name)
    while True:
        pending = [n for n in range(1, 14) if not os.path.exists(os.path.join(SUBS, f"ep{n:02d}.vtt"))]
        if not pending:
            break
        ready = [n for n in pending if os.path.exists(os.path.join(ROOT, "videos", f"cosmos-{n:02d}.mp4"))]
        for n in ready:
            transcribe(model, n)
        if not watch:
            break
        if not ready:
            time.sleep(20)
    print("all done", flush=True)


if __name__ == "__main__":
    main()
