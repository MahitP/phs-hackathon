"""Download and prepare every sound SkyWindow ships. Re-runnable, like scripts/fetch_story_assets.sh.

    python scripts/fetch_audio.py            download what's missing, then (re)build web/assets/audio/
    python scripts/fetch_audio.py --fetch    download only
    python scripts/fetch_audio.py --report   loudness and true peak of every built file (EBU R128)

scripts/audio_manifest.json lists the sources (URL, licence, credit) and the cues cut from them.
Each source is downloaded into its own folder under .cache/audio/ and is only ever read by ffmpeg.

What the build does to each cue:
  - trims it, with short de-click fades (and the manifest's fades for one-shots)
  - sets its loudness (EBU R128): music -20 LUFS, beds -28, effects -18; true peak at most -1 dBTP.
    Effects under 1.5 s are peak-normalised instead (R128 gating can't measure them)
  - loops (beds): the tail is crossfaded into the head with equal-power curves, then the file is padded
    with a copy of the loop's last and first 0.25 s, so loopStart/loopEnd land on exact samples and any
    AAC priming delay falls inside the padding instead of the loop
  - beds are mono 32 kHz; music and effects 44.1 kHz; output AAC in .m4a (music also at 64 kbps for low tier)
  - writes web/assets/audio/cues.json: file, duration, loop points, kind and credit for every cue
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "scripts" / "audio_manifest.json"
CACHE = ROOT / ".cache" / "audio"
OUT = ROOT / "web" / "assets" / "audio"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"
TARGET = {"music": -20.0, "bed": -28.0, "sfx": -18.0}
PAD = 0.25  # seconds of padding either side of a baked loop


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def encoder():
    out = run(["ffmpeg", "-hide_banner", "-encoders"]).stdout
    return "aac_at" if re.search(r"\saac_at\s", out) else "aac"


# ---------------------------------------------------------------- download

def fetch(sources):
    for name, s in sources.items():
        d = CACHE / name
        ext = Path(s["url"].split("?")[0]).suffix or ".bin"
        dst = d / f"original{ext}"
        if dst.exists() and dst.stat().st_size > 0:
            continue
        d.mkdir(parents=True, exist_ok=True)
        cmd = ["curl", "-sSfL", "--retry", "3", "-A", UA, "-H", "Accept: audio/*,*/*;q=0.8", "-o", str(dst), s["url"]]
        if s.get("referer"):
            cmd[1:1] = ["-e", s["referer"]]
        print(f"fetch {name:16} {s['url']}")
        run(cmd)
        (d / "SOURCE.txt").write_text(f"{s['url']}\n{s.get('page', '')}\n{s['license']}\n{s['credit']}\n", encoding="utf-8")


def original(name):
    hits = [p for p in (CACHE / name).glob("original.*")]
    if not hits:
        raise SystemExit(f"source {name!r} isn't downloaded (run with --fetch)")
    return hits[0]


# ---------------------------------------------------------------- measuring

def probe_duration(path):
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)]).stdout.strip())


def r128(path):
    """Integrated loudness (LUFS) and true peak (dBTP) of a file."""
    err = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    summary = err[err.rfind("Summary:"):]
    i = float(re.search(r"I:\s+(-?[\d.]+|-inf) LUFS", summary).group(1).replace("-inf", "-70"))
    p = re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", summary)
    return i, float(p.group(1).replace("-inf", "-70")) if p else -70.0


def sample_peak(path):
    err = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    return float(re.search(r"max_volume:\s+(-?[\d.]+) dB", err).group(1))


# ---------------------------------------------------------------- building

def build_cue(name, c, tmp, enc):
    kind = c["kind"]
    src = original(c["src"])
    start, end = float(c.get("start", 0)), c.get("end")
    mono = c.get("mono", kind == "bed")
    rate = c.get("rate", 32000 if kind == "bed" else 44100)
    fade_in, fade_out = float(c.get("fadeIn", 0.01)), float(c.get("fadeOut", 0.01))
    filters = list(c.get("filters", []))  # extra ffmpeg filters (EQ etc.), applied first
    seg = tmp / f"{name}-seg.wav"

    # 1. the segment, as float WAV at the output rate and channel count
    trim = ["-ss", f"{start}"] + (["-to", f"{end}"] if end is not None else [])
    af = filters + [f"aresample={rate}"]
    run(["ffmpeg", "-hide_banner", "-y", *trim, "-i", str(src), "-af", ",".join(af), "-ac", "1" if mono else "2", "-c:a", "pcm_f32le", str(seg)])
    dur = probe_duration(seg)

    loop = None
    if c.get("loop"):
        # 2. bake the loop: S[X:D-X] then the tail S[D-X:D] crossfaded into the head S[0:X]
        x = float(c.get("xfade", min(2.0, dur / 4)))
        body, out = tmp / f"{name}-loop.wav", tmp / f"{name}-pad.wav"
        run(["ffmpeg", "-hide_banner", "-y", "-i", str(seg), "-filter_complex",
             f"[0]asplit=2[a][b];[a]atrim=start={x},asetpts=PTS-STARTPTS[tail];[b]atrim=end={x},asetpts=PTS-STARTPTS[head];"
             f"[tail][head]acrossfade=d={x}:c1=qsin:c2=qsin", "-c:a", "pcm_f32le", str(body)])
        L = probe_duration(body)
        # 3. pad with the loop's own last and first PAD seconds
        run(["ffmpeg", "-hide_banner", "-y", "-i", str(body), "-filter_complex",
             f"[0]asplit=3[x][y][z];[x]atrim=start={L - PAD},asetpts=PTS-STARTPTS[t];[z]atrim=end={PAD},asetpts=PTS-STARTPTS[h];"
             f"[t][y][h]concat=n=3:v=0:a=1", "-c:a", "pcm_f32le", str(out)])
        seg, loop = out, [PAD, PAD + L]
    else:
        # one-shots and music: fades at the ends
        faded = tmp / f"{name}-fade.wav"
        run(["ffmpeg", "-hide_banner", "-y", "-i", str(seg), "-af",
             f"afade=t=in:d={fade_in}:curve=qsin,afade=t=out:st={max(0, dur - fade_out)}:d={fade_out}:curve=qsin", "-c:a", "pcm_f32le", str(faded)])
        seg = faded

    # 4. loudness: one constant gain (keeps loops seamless), then keep true peak at or under -1 dBTP
    dur = probe_duration(seg)
    if kind == "sfx" and dur < 1.5:
        gain = -3.0 - sample_peak(seg)
    else:
        lufs, _ = r128(seg)
        gain = TARGET[kind] - lufs
    gain += float(c.get("gain", 0))
    leveled = tmp / f"{name}-lvl.wav"
    run(["ffmpeg", "-hide_banner", "-y", "-i", str(seg), "-af", f"volume={gain:.2f}dB", "-c:a", "pcm_f32le", str(leveled)])
    _, tp = r128(leveled)
    if tp > -1.0:
        run(["ffmpeg", "-hide_banner", "-y", "-i", str(seg), "-af", f"volume={gain - (tp + 1.0) - 0.1:.2f}dB", "-c:a", "pcm_f32le", str(leveled)])

    # 5. encode
    folder = {"music": "music", "bed": "beds", "sfx": "sfx"}[kind]
    (OUT / folder).mkdir(parents=True, exist_ok=True)
    rel = f"{folder}/{name}.m4a"
    br = c.get("bitrate", "128k" if kind == "music" else "48k" if kind == "bed" else "96k" if not mono else "64k")
    run(["ffmpeg", "-hide_banner", "-y", "-i", str(leveled), "-c:a", enc, "-b:a", br, "-movflags", "+faststart", str(OUT / rel)])
    entry = {"file": rel, "kind": kind, "duration": round(dur, 4), "credit": c["src"]}
    if loop:
        entry["loop"] = [round(loop[0], 5), round(loop[1], 5)]
    if kind == "music":
        lo = f"{folder}/{name}-lo.m4a"
        run(["ffmpeg", "-hide_banner", "-y", "-i", str(leveled), "-c:a", enc, "-b:a", "64k", "-movflags", "+faststart", str(OUT / lo)])
        entry["fileLow"] = lo
        entry["xfade"] = float(c.get("xfade", 6))
    for k in ("gainDb", "note"):
        if k in c:
            entry[k] = c[k]
    return entry


def build(manifest):
    enc = encoder()
    cues = {}
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        for name, c in manifest["cues"].items():
            print(f"build {name:18} from {c['src']}")
            cues[name] = build_cue(name, c, tmp, enc)
    credits = {k: {"credit": s["credit"], "license": s["license"], "page": s.get("page", "")} for k, s in manifest["sources"].items()
               if any(c["src"] == k for c in manifest["cues"].values())}
    (OUT / "cues.json").write_text(json.dumps({"cues": cues, "sources": credits}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    write_credits(manifest, credits)
    print(f"wrote {len(cues)} cues to {OUT.relative_to(ROOT)}")


def write_credits(manifest, used):
    lines = ["# Sound credits", "",
             "Every sound in SkyWindow, where it came from and its licence. Built by `scripts/fetch_audio.py`",
             "from `scripts/audio_manifest.json`; the files here are trimmed, loudness-matched and re-encoded.", ""]
    groups = [("Music", lambda l: l.startswith("CC BY")), ("Space", lambda l: l.startswith("NASA")), ("Field recordings and foley (Freesound)", lambda l: l.startswith("CC0"))]
    for title, match in groups:
        rows = [(k, v) for k, v in used.items() if match(v["license"])]
        if not rows:
            continue
        lines += [f"## {title}", ""]
        for k, v in rows:
            cut = ", ".join(n for n, c in manifest["cues"].items() if c["src"] == k)
            lines.append(f"- {v['credit']}. [{v['page']}]({v['page']}). Used for: {cut}.")
        lines.append("")
    lines += ["CC BY 4.0: https://creativecommons.org/licenses/by/4.0/ . CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/ .",
              "NASA media is not copyrighted; NASA asks to be credited as the source.", ""]
    (OUT / "CREDITS.md").write_text("\n".join(lines), encoding="utf-8")


def report():
    data = json.loads((OUT / "cues.json").read_text(encoding="utf-8"))
    print(f"{'cue':20} {'kind':6} {'sec':>7} {'LUFS':>7} {'dBTP':>6}  loop")
    for name, c in data["cues"].items():
        i, tp = r128(OUT / c["file"])
        print(f"{name:20} {c['kind']:6} {c['duration']:7.2f} {i:7.1f} {tp:6.1f}  {c.get('loop', '')}")


if __name__ == "__main__":
    if not shutil.which("ffmpeg"):
        raise SystemExit("needs ffmpeg on the PATH")
    m = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if "--report" in sys.argv:
        report()
    else:
        fetch(m["sources"])
        if "--fetch" not in sys.argv:
            build(m)
