#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <video_path> <out_dir>" >&2
  exit 1
fi

VIDEO_PATH="$1"
OUT_DIR="$2"
mkdir -p "$OUT_DIR/frames"

if ! command -v ffprobe >/dev/null 2>&1; then
  echo "ffprobe not found" >&2
  exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found" >&2
  exit 1
fi

{
  echo "video_path=$VIDEO_PATH"
  ffprobe -v error \
    -show_entries format=duration,size,bit_rate \
    -show_entries stream=index,codec_name,codec_type,width,height,r_frame_rate,duration \
    -of default=noprint_wrappers=1 "$VIDEO_PATH"
} > "$OUT_DIR/report.txt"

ffmpeg -y -i "$VIDEO_PATH" \
  -vf "fps=1,scale=540:-1" \
  -q:v 3 \
  "$OUT_DIR/frames/frame_%04d.jpg" >/dev/null 2>&1

echo "ok: $OUT_DIR"
