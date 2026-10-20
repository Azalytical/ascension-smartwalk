"""Offline, reproducible screen-review video with SAPI narration.

prepare writes narration, title card, captions and a timing manifest.
render requires all real screenshots and only then creates the deliverable MP4.
No browser automation, upload, speech API or application/data edits are performed.
"""

from __future__ import annotations

import argparse
import array
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import wave

from PIL import Image, ImageDraw, ImageFont


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
BUILD = HERE / "build"
VOICE_DIR = BUILD / "audio"
SHOT_CACHE = HERE / "screenshots"
FONT_DIR = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
BG = "#f4f3ec"
INK = "#142c31"
GREEN = "#176b55"


def write_json(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def font(size, bold=False):
    name = "arialbd.ttf" if bold else "arial.ttf"
    return ImageFont.truetype(str(FONT_DIR / name), size)


def wrap_pixels(text, drawing, typeface, width):
    lines, current = [], ""
    for word in text.split():
        test = (current + " " + word).strip()
        if current and drawing.textlength(test, font=typeface) > width:
            lines.append(current)
            current = word
        else:
            current = test
    if current:
        lines.append(current)
    return lines


def base_frame(story, scene, number):
    canvas = Image.new("RGB", (story["width"], story["height"]), BG)
    d = ImageDraw.Draw(canvas)
    d.text((70, 37), story["title"], font=font(34, True), fill=INK)
    d.text((70, 84), "ВИДЕООБЗОР ЭКРАНОВ  /  ПРОТОТИП", font=font(18), fill=GREEN)
    heading = scene["heading"]
    typeface = font(27, True)
    d.text((story["width"] - 70, 48), heading, font=typeface, fill=INK, anchor="ra")
    d.line((70, 119, story["width"] - 70, 119), fill="#d9ded5", width=2)
    d.text((story["width"] - 70, story["height"] - 30), f"{number:02d} / {len(story['scenes']):02d}", font=font(19), fill=GREEN, anchor="ra")
    return canvas


def make_titlecard(story):
    canvas = Image.new("RGB", (story["width"], story["height"]), BG)
    d = ImageDraw.Draw(canvas)
    d.text((120, 195), "ASCENSION", font=font(27, True), fill=GREEN)
    d.text((120, 267), "SmartWalk", font=font(120, True), fill=INK)
    d.text((125, 435), "Хорошая прогулка.", font=font(68, True), fill=INK)
    d.text((125, 523), "Вовремя обратно.", font=font(68, True), fill=GREEN)
    d.line((125, 669, 1775, 669), fill="#d1d9ce", width=2)
    d.text((125, 710), "АСТАНА  /  45 МИНУТ  /  ВОЗВРАЩЕНИЕ + РЕЗЕРВ", font=font(27), fill=INK)
    d.text((125, 797), "Видеообзор экранов прототипа", font=font(31), fill=GREEN)
    path = BUILD / "titlecard.png"
    canvas.save(path)
    return path


def draw_scene(story, scene, index, source):
    if scene["shot"] == "titlecard":
        return Image.open(source).convert("RGB")
    canvas = base_frame(story, scene, index)
    source_im = Image.open(source).convert("RGB")
    # Fit the entire original screenshot; never fabricate, crop or conceal app content.
    source_im.thumbnail((1780, 790), Image.Resampling.LANCZOS)
    # Upscaling is intentionally capped at 1.35 for legibility without excessive blur.
    factor = min(1780 / source_im.width, 790 / source_im.height, 1.35)
    if factor > 1:
        source_im = source_im.resize((round(source_im.width * factor), round(source_im.height * factor)), Image.Resampling.LANCZOS)
    x = (story["width"] - source_im.width) // 2
    y = 145 + (790 - source_im.height) // 2
    canvas.paste(source_im, (x, y))
    ImageDraw.Draw(canvas).rectangle((x - 1, y - 1, x + source_im.width, y + source_im.height), outline="#d8ddd5", width=2)
    return canvas


def wav_info(path):
    with wave.open(str(path), "rb") as wf:
        params = wf.getparams()
        data = wf.readframes(params.nframes)
    values = array.array("h", data)
    rms = math.sqrt(sum(v * v for v in values) / max(1, len(values)))
    peak = max((abs(v) for v in values), default=0)
    return params, data, {"seconds": params.nframes / params.framerate, "rms": round(rms, 2), "peak": peak, "peak_dbfs": round(20 * math.log10(max(peak, 1) / 32768), 2)}


def seconds_srt(seconds):
    total = round(seconds * 1000)
    hours, rest = divmod(total, 3600000)
    minutes, rest = divmod(rest, 60000)
    secs, millis = divmod(rest, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"


def prepare(story, shots_dir, rate):
    BUILD.mkdir(parents=True, exist_ok=True)
    VOICE_DIR.mkdir(exist_ok=True)
    SHOT_CACHE.mkdir(exist_ok=True)
    shell = shutil.which("pwsh") or shutil.which("powershell")
    if not shell:
        raise RuntimeError("PowerShell is needed for offline SAPI narration.")
    command = [shell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(HERE / "narrate.ps1"), "-Storyboard", str(HERE / "storyboard.json"), "-AudioDirectory", str(VOICE_DIR), "-Rate", str(rate)]
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", check=True)
    (BUILD / "sapi-generation.json").write_text(result.stdout, encoding="utf-8")
    make_titlecard(story)
    sample_info, sentence_audio = [], []
    for scene in story["scenes"]:
        for number, text in enumerate(scene["sentences"], 1):
            path = VOICE_DIR / f"{scene['id']}-{number:02}.wav"
            params, data, info = wav_info(path)
            if params.nchannels != 1 or params.sampwidth != 2 or params.framerate != 22050 or info["rms"] < 100:
                raise RuntimeError(f"Unexpected or effectively silent SAPI output: {path}")
            sample_info.append({"file": str(path.relative_to(HERE)), "text": text, **info})
            sentence_audio.append((scene["id"], text, data, info["seconds"]))

    # Small honest pauses keep each on-screen caption aligned with its own TTS file.
    between_sentences = 0.24
    scene_pause = 0.65
    start_pause = 0.35
    spoken_length = sum(item[3] for item in sentence_audio)
    planned_length = start_pause + spoken_length + between_sentences * (len(sentence_audio) - len(story["scenes"])) + scene_pause * len(story["scenes"])
    extra_hold = max(0.0, max(60.0, story.get("target_seconds", 60.0)) - planned_length) / len(story["scenes"])
    total = planned_length + extra_hold * len(story["scenes"])
    if total > 90:
        raise RuntimeError(f"Narration would be {total:.2f}s; rerun prepare with --rate {rate + 1}.")
    silence = lambda length: b"\0\0" * round(length * 22050)
    audio_bytes = bytearray(silence(start_pause))
    cursor = start_pause
    scenes, captions = [], []
    pointer = 0
    for index, scene in enumerate(story["scenes"], 1):
        scene_start = 0.0 if index == 1 else cursor
        for sentence_index, _ in enumerate(scene["sentences"]):
            _, text, data, duration = sentence_audio[pointer]
            pointer += 1
            captions.append({"start": cursor, "end": cursor + duration, "text": text})
            audio_bytes.extend(data)
            cursor += duration
            if sentence_index < len(scene["sentences"]) - 1:
                audio_bytes.extend(silence(between_sentences))
                cursor += between_sentences
        hold = scene_pause + extra_hold
        audio_bytes.extend(silence(hold))
        cursor += hold
        scenes.append({**scene, "start": round(scene_start, 5), "duration": round(cursor - scene_start, 5)})
    with wave.open(str(BUILD / "narration.wav"), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(22050)
        out.writeframes(audio_bytes)
    write_json(BUILD / "audio-qa.json", {"voice": story["voice"], "rate": rate, "total_seconds": round(cursor, 5), "sentence_files": sample_info, "note": "RMS/peak/duration checks confirm non-silent audio. Listening is a separate QA step."})
    (HERE / "narration-ru.txt").write_text("\n\n".join(" ".join(scene["sentences"]) for scene in story["scenes"]) + "\n", encoding="utf-8")
    srt_lines = []
    for index, cap in enumerate(captions, 1):
        srt_lines.extend([str(index), f"{seconds_srt(cap['start'])} --> {seconds_srt(cap['end'])}", cap["text"], ""])
    (HERE / "captions-ru.srt").write_text("\n".join(srt_lines), encoding="utf-8")
    plan = {"format": story["format"], "continuous_capture": False, "voice": story["voice"], "rate": rate, "total_seconds": round(cursor, 5), "scenes": scenes, "captions": captions, "verification": "Screenshot provenance and application claims await root review."}
    write_json(BUILD / "timeline.json", plan)
    refresh_shots(story, shots_dir)
    print(json.dumps({"prepared_seconds": round(cursor, 2), "rate": rate, "missing_screenshots": missing_shots(story), "audio": str(BUILD / 'narration.wav')}, ensure_ascii=False))


def shot_names(story):
    return list(dict.fromkeys(scene[key] for scene in story["scenes"] for key in ("shot", "secondary_shot") if scene.get(key) and scene[key] != "titlecard"))


def refresh_shots(story, shots_dir, require_all=False):
    SHOT_CACHE.mkdir(parents=True, exist_ok=True)
    if require_all:
        absent = [name for name in shot_names(story) if not (shots_dir / name).is_file()]
        if absent:
            raise RuntimeError("Missing final source files; cached copies are not accepted: " + ", ".join(absent))
    manifest_path = HERE / "screenshot-manifest.json"
    history_path = HERE / "screenshot-manifest-history.json"
    previous = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else None
    history = json.loads(history_path.read_text(encoding="utf-8")) if history_path.exists() else {"versions": []}
    if previous and not history["versions"]:
        history["versions"].append({"version": 1, "stage": "initial preparation before final capture", **previous})
    metadata = []
    for name in shot_names(story):
        source = shots_dir / name
        cached = SHOT_CACHE / name
        if source.exists():
            content = source.read_bytes()
            cached.write_bytes(content)
            with Image.open(cached) as im:
                metadata.append({"name": name, "original_path": str(source), "source_modified_utc": datetime.fromtimestamp(source.stat().st_mtime, timezone.utc).isoformat(), "width": im.width, "height": im.height, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()})
    current = {"kind": "User-browser screenshots copied without image-content edits", "refreshed_utc": datetime.now(timezone.utc).isoformat(), "source_policy": "Final rendering rereads all original files; old cached files never substitute for missing originals.", "screenshots": metadata}
    signature = lambda data: [(item["name"], item["sha256"]) for item in data.get("screenshots", [])]
    if not history["versions"] or signature(history["versions"][-1]) != signature(current):
        current["version"] = len(history["versions"]) + 1
        history["versions"].append(current)
    else:
        current["version"] = history["versions"][-1]["version"]
    write_json(manifest_path, current)
    write_json(history_path, history)


def missing_shots(story):
    return [name for name in shot_names(story) if not (SHOT_CACHE / name).exists()]


def make_ass(story, captions):
    def stamp(sec):
        cs = round(sec * 100)
        h, cs = divmod(cs, 360000)
        m, cs = divmod(cs, 6000)
        s, cs = divmod(cs, 100)
        return f"{h}:{m:02}:{s:02}.{cs:02}"
    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial,31,&H00312C14,&H00312C14,&H00ECF3F4,&H00ECF3F4,0,0,0,0,100,100,0,0,3,8,0,2,180,180,74,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = [header]
    for cap in captions:
        text = cap["text"].replace("{", "(").replace("}", ")").replace("\n", r"\N")
        lines.append(f"Dialogue: 0,{stamp(cap['start'])},{stamp(cap['end'])},Caption,,0,0,0,,{text}\n")
    (BUILD / "captions.ass").write_text("".join(lines), encoding="utf-8-sig")


def inspect_and_decode(ffmpeg, output):
    inspection = subprocess.run([ffmpeg, "-hide_banner", "-i", str(output)], capture_output=True, text=True, encoding="utf-8", errors="replace")
    report = inspection.stderr
    (HERE / "mp4-stream-inspection.txt").write_text(report, encoding="utf-8")
    duration_match = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", report)
    video_match = re.search(r"Stream #.*Video: ([^, ]+).*? (\d{3,5})x(\d{3,5})", report)
    audio_match = re.search(r"Stream #.*Audio: ([^, ]+).*? (\d+) Hz", report)
    if not duration_match or not video_match or not audio_match:
        raise RuntimeError("FFmpeg could not confirm video/audio streams and duration.")
    hours, minutes, seconds = duration_match.groups()
    duration = int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    decoded = subprocess.run([ffmpeg, "-hide_banner", "-v", "error", "-i", str(output), "-f", "null", "-"], capture_output=True, text=True, encoding="utf-8", errors="replace")
    (HERE / "mp4-decode-check.txt").write_text(decoded.stderr or "Full audio/video decode completed without errors.\n", encoding="utf-8")
    if decoded.returncode or decoded.stderr.strip():
        raise RuntimeError("Final MP4 reported errors during full audio/video decode.")
    return {"duration": duration, "video_codec": video_match[1], "width": int(video_match[2]), "height": int(video_match[3]), "audio_codec": audio_match[1], "audio_sample_rate": int(audio_match[2]), "full_decode": "passed"}


def render(story, shots_dir, output):
    refresh_shots(story, shots_dir, require_all=True)
    missing = missing_shots(story)
    if missing:
        raise RuntimeError("Missing genuine screenshots: " + ", ".join(missing))
    timeline = json.loads((BUILD / "timeline.json").read_text(encoding="utf-8"))
    frames = BUILD / "frames"
    frames.mkdir(exist_ok=True)
    concat_lines = []
    for number, scene in enumerate(timeline["scenes"], 1):
        source = BUILD / "titlecard.png" if scene["shot"] == "titlecard" else SHOT_CACHE / scene["shot"]
        frame = frames / f"{scene['id']}.png"
        draw_scene(story, scene, number, source).save(frame)
        if scene.get("secondary_shot"):
            first_duration = min(3.6, scene["duration"] * 0.4)
            concat_lines.extend([f"file 'frames/{frame.name}'", f"duration {first_duration:.5f}"])
            second_scene = {**scene, "shot": scene["secondary_shot"]}
            second_frame = frames / f"{scene['id']}-screen.png"
            draw_scene(story, second_scene, number, SHOT_CACHE / second_scene["shot"]).save(second_frame)
            concat_lines.extend([f"file 'frames/{second_frame.name}'", f"duration {scene['duration'] - first_duration:.5f}"])
        else:
            concat_lines.extend([f"file 'frames/{frame.name}'", f"duration {scene['duration']:.5f}"])
    concat_lines.append(f"file 'frames/{timeline['scenes'][-1]['id']}.png'")
    (BUILD / "frames.ffconcat").write_text("\n".join(concat_lines) + "\n", encoding="utf-8")
    make_ass(story, timeline["captions"])
    output = output.resolve()
    allowed = ROOT / "deliverables" / "ascension-smartwalk-demo.mp4"
    if output != allowed.resolve():
        raise RuntimeError("Final output is restricted to deliverables/ascension-smartwalk-demo.mp4.")
    output.parent.mkdir(exist_ok=True)
    args = [story["ffmpeg"], "-y", "-hide_banner", "-f", "concat", "-safe", "1", "-i", "frames.ffconcat", "-i", "narration.wav", "-vf", "fps=30,ass=captions.ass", "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-af", "loudnorm=I=-16:TP=-1.5:LRA=7", "-ar", "48000", "-ac", "1", "-t", str(timeline["total_seconds"]), "-movflags", "+faststart", "-metadata", "title=Ascension SmartWalk - screen review", str(output)]
    result = subprocess.run(args, cwd=BUILD, capture_output=True, text=True, encoding="utf-8", errors="replace")
    (BUILD / "ffmpeg-render.log").write_text(result.stderr, encoding="utf-8")
    if result.returncode:
        raise RuntimeError(f"FFmpeg failed; see {BUILD / 'ffmpeg-render.log'}")
    info = inspect_and_decode(story["ffmpeg"], output)
    duration = info["duration"]
    if info["video_codec"] != "h264" or info["audio_codec"] != "aac" or not 60 <= duration <= 90 or output.stat().st_size > 100_000_000:
        raise RuntimeError("Final MP4 did not meet codec, duration or 100 MB upload constraints.")
    qa = {"file": str(output), "sha256": hashlib.sha256(output.read_bytes()).hexdigest(), "bytes": output.stat().st_size, "duration_seconds": duration, "video_codec": info["video_codec"], "width": info["width"], "height": info["height"], "audio_codec": info["audio_codec"], "audio_sample_rate": info["audio_sample_rate"], "full_decode": info["full_decode"], "recording_type": "Narrated video review of genuine browser screenshots; not continuous screencast", "application_context": story.get("application_context", {}), "listening_review": "Not performed: the tool environment explicitly does not support audio input. Non-silent speech, duration, waveform peaks and full MP4 decoding were checked.", "source_manifest_version": json.loads((HERE / "screenshot-manifest.json").read_text(encoding="utf-8"))["version"], "narration_sha256": hashlib.sha256((BUILD / "narration.wav").read_bytes()).hexdigest(), "captions_sha256": hashlib.sha256((HERE / "captions-ru.srt").read_bytes()).hexdigest()}
    write_json(HERE / "video-qa.json", qa)
    print(json.dumps(qa, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "refresh", "render"])
    parser.add_argument("--shots-dir", type=Path)
    parser.add_argument("--rate", type=int)
    args = parser.parse_args()
    story = json.loads((HERE / "storyboard.json").read_text(encoding="utf-8"))
    shots_dir = args.shots_dir or Path(story["shots_dir"])
    if args.action == "prepare":
        prepare(story, shots_dir, story["voice_rate"] if args.rate is None else args.rate)
    elif args.action == "refresh":
        refresh_shots(story, shots_dir)
        print(json.dumps({"missing_screenshots": missing_shots(story)}, ensure_ascii=False))
    else:
        render(story, shots_dir, ROOT / "deliverables" / "ascension-smartwalk-demo.mp4")


if __name__ == "__main__":
    main()
