import contextlib
import datetime as dt
import hashlib
import json
import os
import re
import secrets
import shutil
import sqlite3
import subprocess
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

from fastapi import BackgroundTasks, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

APP_NAME = "video-editor-api"
BASE_DIR = Path(__file__).resolve().parents[1]
STORAGE_ROOT = Path(os.getenv("VIDEO_STORAGE_ROOT", BASE_DIR / "storage")).resolve()
INPUT_DIR = STORAGE_ROOT / "input"
WORK_DIR = STORAGE_ROOT / "work"
OUTPUT_DIR = STORAGE_ROOT / "output"
LOGS_DIR = STORAGE_ROOT / "logs"
DB_PATH = Path(os.getenv("VIDEO_DB_PATH", STORAGE_ROOT / "video_editor.db")).resolve()
EDITOR_DIR = Path(os.getenv("VIDEO_EDITOR_WEB_DIR", BASE_DIR / "editor")).resolve()
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:8081").rstrip("/")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
MAX_WORKERS = int(os.getenv("VIDEO_MAX_WORKERS", "2"))
VIDEO_EDITOR_MANUAL_ENABLED = os.getenv("VIDEO_EDITOR_MANUAL_ENABLED", "true").lower() == "true"

for d in [INPUT_DIR, WORK_DIR, OUTPUT_DIR, LOGS_DIR, EDITOR_DIR]:
    d.mkdir(parents=True, exist_ok=True)

app = FastAPI(title=APP_NAME, version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

executor = ThreadPoolExecutor(max_workers=MAX_WORKERS)
active_futures: dict[str, Any] = {}
active_lock = threading.Lock()


class Db:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        self.conn = sqlite3.connect(path.as_posix(), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._init()

    def _init(self):
        with self.lock:
            c = self.conn.cursor()
            c.execute(
                """
                create table if not exists videos (
                  id text primary key,
                  object text not null default 'video',
                  status text not null,
                  created_at text not null,
                  completed_at text,
                  progress real not null default 0,
                  error_code text,
                  error_message text,
                  source_video_id text,
                  caption_template_id text,
                  input_path text,
                  output_path text,
                  subtitles_path text,
                  mode text,
                  style_prompt text,
                  language text,
                  manual_edited integer not null default 0,
                  base_video_id text,
                  edit_session_id text,
                  pipeline_timings_json text,
                  updated_at text not null
                )
                """
            )
            c.execute(
                """
                create table if not exists jobs (
                  id text primary key,
                  type text not null,
                  status text not null,
                  created_at text not null,
                  updated_at text not null,
                  error text,
                  result_json text,
                  video_id text
                )
                """
            )
            c.execute(
                """
                create table if not exists editor_sessions (
                  id text primary key,
                  video_id text not null,
                  token text not null,
                  created_at text not null,
                  expires_at text not null,
                  last_used_at text,
                  metadata_json text
                )
                """
            )
            self.conn.commit()

    def execute(self, sql: str, params: tuple = ()):
        with self.lock:
            cur = self.conn.cursor()
            cur.execute(sql, params)
            self.conn.commit()
            return cur

    def fetchone(self, sql: str, params: tuple = ()):
        with self.lock:
            cur = self.conn.cursor()
            cur.execute(sql, params)
            return cur.fetchone()

    def fetchall(self, sql: str, params: tuple = ()):
        with self.lock:
            cur = self.conn.cursor()
            cur.execute(sql, params)
            return cur.fetchall()


db = Db(DB_PATH)


def now_iso() -> str:
    return dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def short_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()[:12]


def request_trace_id(request: Request) -> str:
    rid = request.headers.get("x-trace-id", "").strip()
    if rid:
        return rid[:120]
    return f"trace_{uuid.uuid4().hex[:16]}"


def write_log(entry: dict[str, Any]):
    ts = now_iso()
    payload = {"ts": ts, "app": APP_NAME, **entry}
    date = ts[:10]
    out = LOGS_DIR / f"video-editor-api-{date}.jsonl"
    with out.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=True) + "\n")
    print(json.dumps(payload, ensure_ascii=True))


def log_event(level: str, trace_id: str, stage: str, event: str, **meta):
    write_log(
        {
            "level": level,
            "trace_id": trace_id,
            "stage": stage,
            "event": event,
            "meta": meta,
        }
    )


def log_error(trace_id: str, stage: str, event: str, error: Exception, **meta):
    write_log(
        {
            "level": "error",
            "trace_id": trace_id,
            "stage": stage,
            "event": event,
            "meta": {**meta, "error": str(error), "stack": traceback.format_exc()},
        }
    )


def video_row_to_item(row: sqlite3.Row) -> dict[str, Any]:
    if not row:
        raise HTTPException(status_code=404, detail="Video nao encontrado.")
    error = None
    if row["error_message"]:
        error = {"code": row["error_code"] or "processing_error", "message": row["error_message"]}
    return {
        "id": row["id"],
        "object": "video",
        "status": row["status"],
        "created_at": row["created_at"],
        "completed_at": row["completed_at"],
        "progress": float(row["progress"] or 0),
        "error": error,
        "source_video_id": row["source_video_id"],
        "caption_template_id": row["caption_template_id"],
    }


def job_row_to_item(row: sqlite3.Row) -> dict[str, Any]:
    result = {}
    if row["result_json"]:
        with contextlib.suppress(Exception):
            result = json.loads(row["result_json"])
    return {
        "job_id": row["id"],
        "status": row["status"],
        "type": row["type"],
        "error": row["error"],
        "result": result,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def run_cmd(cmd: list[str], trace_id: str, stage: str, video_id: Optional[str] = None, job_id: Optional[str] = None):
    started = time.time()
    log_event("info", trace_id, stage, "command_start", video_id=video_id, job_id=job_id, cmd=cmd)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    duration_ms = int((time.time() - started) * 1000)
    log_event(
        "info",
        trace_id,
        stage,
        "command_end",
        video_id=video_id,
        job_id=job_id,
        cmd=cmd,
        returncode=proc.returncode,
        duration_ms=duration_ms,
        stdout_tail=proc.stdout[-1200:],
        stderr_tail=proc.stderr[-1200:],
    )
    if proc.returncode != 0:
        raise RuntimeError(f"command_failed:{stage}:{proc.returncode}:{proc.stderr[-300:]}")
    return proc


def ffprobe_duration(path: Path, trace_id: str, video_id: Optional[str] = None) -> float:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        path.as_posix(),
    ]
    proc = run_cmd(cmd, trace_id=trace_id, stage="ffprobe_duration", video_id=video_id)
    try:
        return max(0.0, float(proc.stdout.strip()))
    except Exception as error:
        raise RuntimeError(f"ffprobe_parse_failed:{error}")


def parse_silences(stderr: str, total_duration: float, padding_before: float, padding_after: float, min_segment_duration: float):
    silence_starts: list[float] = []
    silence_ends: list[float] = []
    for line in stderr.splitlines():
        m_start = re.search(r"silence_start:\s*([0-9.]+)", line)
        if m_start:
            silence_starts.append(float(m_start.group(1)))
        m_end = re.search(r"silence_end:\s*([0-9.]+)", line)
        if m_end:
            silence_ends.append(float(m_end.group(1)))

    silences: list[tuple[float, float]] = []
    for i, st in enumerate(silence_starts):
        en = silence_ends[i] if i < len(silence_ends) else total_duration
        if en > st:
            silences.append((st, en))

    segments: list[tuple[float, float]] = []
    cursor = 0.0
    for st, en in silences:
        seg_st = max(0.0, cursor - padding_before)
        seg_en = max(seg_st, st + padding_after)
        if seg_en - seg_st >= min_segment_duration:
            segments.append((seg_st, seg_en))
        cursor = en

    if cursor < total_duration:
        seg_st = max(0.0, cursor - padding_before)
        seg_en = total_duration
        if seg_en - seg_st >= min_segment_duration:
            segments.append((seg_st, seg_en))

    if not segments:
        return [(0.0, total_duration)]
    return segments


def auto_cut_video(
    input_path: Path,
    output_path: Path,
    trace_id: str,
    video_id: Optional[str],
    max_duration_seconds: Optional[float],
    silence_noise_db: float,
    silence_min_duration: float,
    padding_before: float,
    padding_after: float,
    min_segment_duration: float,
):
    total_duration = ffprobe_duration(input_path, trace_id=trace_id, video_id=video_id)
    detect_cmd = [
        "ffmpeg",
        "-i",
        input_path.as_posix(),
        "-af",
        f"silencedetect=noise={silence_noise_db}dB:d={silence_min_duration}",
        "-f",
        "null",
        "-",
        "-y",
    ]
    started = time.time()
    proc = subprocess.run(detect_cmd, capture_output=True, text=True)
    duration_ms = int((time.time() - started) * 1000)
    log_event(
        "info",
        trace_id,
        "silencedetect",
        "finished",
        video_id=video_id,
        returncode=proc.returncode,
        duration_ms=duration_ms,
        stderr_tail=proc.stderr[-1200:],
    )

    segments = parse_silences(proc.stderr, total_duration, padding_before, padding_after, min_segment_duration)

    if max_duration_seconds and max_duration_seconds > 0:
        clipped: list[tuple[float, float]] = []
        acc = 0.0
        for st, en in segments:
            seg_len = en - st
            if acc >= max_duration_seconds:
                break
            room = max_duration_seconds - acc
            if seg_len > room:
                clipped.append((st, st + room))
                acc += room
                break
            clipped.append((st, en))
            acc += seg_len
        if clipped:
            segments = clipped

    work_tmp = WORK_DIR / f"segments_{uuid.uuid4().hex[:10]}"
    work_tmp.mkdir(parents=True, exist_ok=True)
    segment_files: list[Path] = []

    try:
        for idx, (st, en) in enumerate(segments):
            out_seg = work_tmp / f"seg_{idx:03d}.mp4"
            cmd = [
                "ffmpeg",
                "-y",
                "-ss",
                f"{st:.3f}",
                "-to",
                f"{en:.3f}",
                "-i",
                input_path.as_posix(),
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                out_seg.as_posix(),
            ]
            run_cmd(cmd, trace_id=trace_id, stage="segment_extract", video_id=video_id)
            segment_files.append(out_seg)

        if not segment_files:
            shutil.copy2(input_path, output_path)
            return

        concat_list = work_tmp / "concat.txt"
        concat_list.write_text("\n".join([f"file '{p.as_posix()}'" for p in segment_files]), encoding="utf-8")

        cmd_concat = [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            concat_list.as_posix(),
            "-c",
            "copy",
            output_path.as_posix(),
        ]
        try:
            run_cmd(cmd_concat, trace_id=trace_id, stage="segment_concat_copy", video_id=video_id)
        except Exception:
            cmd_reencode = [
                "ffmpeg",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                concat_list.as_posix(),
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                output_path.as_posix(),
            ]
            run_cmd(cmd_reencode, trace_id=trace_id, stage="segment_concat_reencode", video_id=video_id)
    finally:
        shutil.rmtree(work_tmp, ignore_errors=True)


def whisper_transcribe_to_srt(input_path: Path, srt_output: Path, trace_id: str, language: str = "pt", video_id: Optional[str] = None):
    temp_dir = WORK_DIR / f"whisper_{uuid.uuid4().hex[:8]}"
    temp_dir.mkdir(parents=True, exist_ok=True)
    try:
        cmd = [
            "whisper",
            input_path.as_posix(),
            "--language",
            "Portuguese" if language.lower().startswith("pt") else language,
            "--model",
            os.getenv("WHISPER_MODEL", "base"),
            "--output_format",
            "srt",
            "--output_dir",
            temp_dir.as_posix(),
        ]
        run_cmd(cmd, trace_id=trace_id, stage="whisper", video_id=video_id)
        generated = temp_dir / f"{input_path.stem}.srt"
        if not generated.exists():
            raise RuntimeError("whisper_output_missing")
        shutil.move(generated.as_posix(), srt_output.as_posix())
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def burn_subtitles(input_path: Path, subtitles_path: Path, output_path: Path, trace_id: str, video_id: Optional[str] = None):
    escaped_sub = subtitles_path.as_posix().replace("'", "\\\\'")
    style = "FontName=Arial,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=1,Alignment=2,MarginV=40"
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        input_path.as_posix(),
        "-vf",
        f"subtitles='{escaped_sub}':force_style='{style}'",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        output_path.as_posix(),
    ]
    run_cmd(cmd, trace_id=trace_id, stage="burn_subtitles", video_id=video_id)


def deliver_social(input_path: Path, output_path: Path, trace_id: str, video_id: Optional[str] = None, width: int = 1080, height: int = 1920):
    vf = f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p"
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        input_path.as_posix(),
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        output_path.as_posix(),
    ]
    run_cmd(cmd, trace_id=trace_id, stage="deliver", video_id=video_id)


def upsert_video_status(
    video_id: str,
    status: str,
    progress: float,
    error_code: Optional[str] = None,
    error_message: Optional[str] = None,
    completed: bool = False,
    output_path: Optional[Path] = None,
    subtitles_path: Optional[Path] = None,
    pipeline_timings: Optional[dict[str, int]] = None,
):
    now = now_iso()
    db.execute(
        """
        update videos
        set status = ?,
            progress = ?,
            error_code = ?,
            error_message = ?,
            completed_at = case when ? = 1 then ? else completed_at end,
            output_path = coalesce(?, output_path),
            subtitles_path = coalesce(?, subtitles_path),
            pipeline_timings_json = coalesce(?, pipeline_timings_json),
            updated_at = ?
        where id = ?
        """,
        (
            status,
            float(progress),
            error_code,
            error_message,
            1 if completed else 0,
            now,
            output_path.as_posix() if output_path else None,
            subtitles_path.as_posix() if subtitles_path else None,
            json.dumps(pipeline_timings or {}) if pipeline_timings is not None else None,
            now,
            video_id,
        ),
    )


def create_video_record(
    *,
    input_path: Path,
    mode: str,
    language: str,
    style_prompt: str,
    caption_template_id: Optional[str] = None,
    source_video_id: Optional[str] = None,
    base_video_id: Optional[str] = None,
    manual_edited: bool = False,
):
    video_id = str(uuid.uuid4())
    now = now_iso()
    db.execute(
        """
        insert into videos (
          id,status,created_at,completed_at,progress,error_code,error_message,
          source_video_id,caption_template_id,input_path,output_path,subtitles_path,
          mode,style_prompt,language,manual_edited,base_video_id,updated_at
        ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            video_id,
            "QUEUED",
            now,
            None,
            0.0,
            None,
            None,
            source_video_id,
            caption_template_id,
            input_path.as_posix(),
            None,
            None,
            mode,
            style_prompt,
            language,
            1 if manual_edited else 0,
            base_video_id,
            now,
        ),
    )
    return video_id


def get_video_row(video_id: str):
    row = db.fetchone("select * from videos where id = ?", (video_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Video nao encontrado.")
    return row


def process_video_pipeline(video_id: str, trace_id: str, include_subtitles: bool = True, max_duration_seconds: Optional[float] = None):
    started = time.time()
    timings: dict[str, int] = {}
    row = get_video_row(video_id)
    input_path = Path(row["input_path"])
    mode = row["mode"] or "cut_captions"
    language = row["language"] or "pt-BR"

    upsert_video_status(video_id, "PROCESSING", 0.1)
    auto_out = OUTPUT_DIR / f"auto_{video_id}.mp4"
    subtitles_out = OUTPUT_DIR / f"subs_{video_id}.srt"
    captioned_out = OUTPUT_DIR / f"captioned_{video_id}.mp4"
    final_out = OUTPUT_DIR / f"final_{video_id}.mp4"

    try:
        t0 = time.time()
        auto_cut_video(
            input_path=input_path,
            output_path=auto_out,
            trace_id=trace_id,
            video_id=video_id,
            max_duration_seconds=max_duration_seconds,
            silence_noise_db=-35,
            silence_min_duration=0.35,
            padding_before=0.08,
            padding_after=0.12,
            min_segment_duration=0.2,
        )
        timings["autoCutMs"] = int((time.time() - t0) * 1000)
        upsert_video_status(video_id, "PROCESSING", 0.45)

        render_input = auto_out
        subtitles_status = "disabled"

        if include_subtitles and mode in ["cut_captions", "captions"]:
            t1 = time.time()
            try:
                whisper_transcribe_to_srt(auto_out, subtitles_out, trace_id=trace_id, language=language, video_id=video_id)
                timings["subtitleGenerateMs"] = int((time.time() - t1) * 1000)

                t2 = time.time()
                burn_subtitles(auto_out, subtitles_out, captioned_out, trace_id=trace_id, video_id=video_id)
                timings["subtitleBurnMs"] = int((time.time() - t2) * 1000)
                render_input = captioned_out
                subtitles_status = "applied"
            except Exception as sub_error:
                subtitles_status = "failed"
                log_error(trace_id, "subtitles", "subtitles_failed_fallback", sub_error, video_id=video_id)

        upsert_video_status(video_id, "PROCESSING", 0.8, subtitles_path=subtitles_out if subtitles_out.exists() else None)

        t3 = time.time()
        deliver_social(render_input, final_out, trace_id=trace_id, video_id=video_id)
        timings["deliverMs"] = int((time.time() - t3) * 1000)

        total_ms = int((time.time() - started) * 1000)
        timings["totalMs"] = total_ms

        upsert_video_status(
            video_id,
            "COMPLETE",
            1.0,
            completed=True,
            output_path=final_out,
            subtitles_path=subtitles_out if subtitles_out.exists() else None,
            pipeline_timings={**timings, "subtitlesStatus": subtitles_status},
        )
        log_event(
            "info",
            trace_id,
            "pipeline",
            "video_pipeline_complete",
            video_id=video_id,
            output_path=final_out.as_posix(),
            output_hash=short_hash(final_out),
            duration_ms=total_ms,
        )
    except Exception as error:
        upsert_video_status(video_id, "FAILED", 1.0, error_code="processing_failed", error_message=str(error), completed=True)
        log_error(trace_id, "pipeline", "video_pipeline_failed", error, video_id=video_id)


def process_manual_source_pipeline(video_id: str, trace_id: str):
    started = time.time()
    timings: dict[str, int] = {}
    row = get_video_row(video_id)
    input_path = Path(row["input_path"])
    final_out = OUTPUT_DIR / f"final_{video_id}.mp4"

    try:
        upsert_video_status(video_id, "PROCESSING", 0.2)
        t0 = time.time()
        deliver_social(input_path, final_out, trace_id=trace_id, video_id=video_id)
        timings["manualPrepareDeliverMs"] = int((time.time() - t0) * 1000)
        timings["totalMs"] = int((time.time() - started) * 1000)
        upsert_video_status(
            video_id,
            "COMPLETE",
            1.0,
            completed=True,
            output_path=final_out,
            pipeline_timings=timings,
        )
        log_event(
            "info",
            trace_id,
            "manual_prepare",
            "manual_source_ready",
            video_id=video_id,
            output_path=final_out.as_posix(),
            output_hash=short_hash(final_out),
            duration_ms=timings["totalMs"],
        )
    except Exception as error:
        upsert_video_status(video_id, "FAILED", 1.0, error_code="manual_source_failed", error_message=str(error), completed=True)
        log_error(trace_id, "manual_prepare", "manual_source_failed", error, video_id=video_id)


class JobAutoEditInput(BaseModel):
    input_path: str
    max_duration_seconds: Optional[float] = 15
    remove_silence: bool = True
    silence_noise_db: float = -35
    silence_min_duration: float = 0.35
    padding_before: float = 0.08
    padding_after: float = 0.12
    min_segment_duration: float = 0.2
    output_name: Optional[str] = None


class JobSubtitleGenerateInput(BaseModel):
    input_path: str
    language: str = "pt"
    max_chars_per_line: int = 36
    output_name: Optional[str] = None


class JobSubtitleBurnInput(BaseModel):
    input_path: str
    subtitles_path: str
    style: dict[str, Any] = Field(default_factory=dict)
    output_name: Optional[str] = None


class JobDeliverInput(BaseModel):
    input_path: str
    preset: str = "social"
    width: int = 1080
    height: int = 1920
    output_name: Optional[str] = None


class ManualExportInput(BaseModel):
    token: str
    start_seconds: float = 0.0
    end_seconds: Optional[float] = None
    include_subtitles: bool = True


class EditorSessionInput(BaseModel):
    order_id: Optional[str] = None


def resolve_existing_path(raw: str) -> Path:
    candidate = Path(raw)
    if candidate.exists():
        return candidate.resolve()
    for base in [INPUT_DIR, WORK_DIR, OUTPUT_DIR]:
        scoped = (base / raw).resolve()
        if scoped.exists():
            return scoped
    raise HTTPException(status_code=400, detail=f"Arquivo nao encontrado: {raw}")


def create_job(job_type: str, video_id: Optional[str] = None) -> str:
    job_id = str(uuid.uuid4())
    now = now_iso()
    db.execute(
        "insert into jobs (id,type,status,created_at,updated_at,error,result_json,video_id) values (?,?,?,?,?,?,?,?)",
        (job_id, job_type, "queued", now, now, None, None, video_id),
    )
    return job_id


def update_job(job_id: str, status: str, result: Optional[dict[str, Any]] = None, error: Optional[str] = None):
    db.execute(
        "update jobs set status = ?, updated_at = ?, result_json = ?, error = ? where id = ?",
        (status, now_iso(), json.dumps(result or {}), error, job_id),
    )


def submit_async_job(job_id: str, trace_id: str, fn):
    def wrapped():
        try:
            update_job(job_id, "running")
            result = fn()
            update_job(job_id, "succeeded", result=result)
            return result
        except Exception as error:
            update_job(job_id, "failed", error=str(error))
            log_error(trace_id, "jobs", "job_failed", error, job_id=job_id)
            return None
        finally:
            with active_lock:
                active_futures.pop(job_id, None)

    fut = executor.submit(wrapped)
    with active_lock:
        active_futures[job_id] = fut


@app.middleware("http")
async def trace_middleware(request: Request, call_next):
    trace_id = request_trace_id(request)
    request.state.trace_id = trace_id
    started = time.time()
    try:
        response = await call_next(request)
    except Exception as error:
        log_error(trace_id, "http", "request_unhandled_exception", error, method=request.method, path=request.url.path)
        raise
    duration_ms = int((time.time() - started) * 1000)
    log_event(
        "info",
        trace_id,
        "http",
        "request_done",
        method=request.method,
        path=request.url.path,
        status=response.status_code,
        duration_ms=duration_ms,
    )
    response.headers["x-trace-id"] = trace_id
    return response


@app.get("/health")
def health():
    return {"ok": True, "app": APP_NAME, "db": DB_PATH.as_posix()}


@app.get("/v1/videos/captions/templates")
def list_templates():
    return {
        "object": "list",
        "data": [
            {
                "id": "default-pt-br",
                "object": "caption_template",
                "name": "Padrao PT-BR",
                "preview_url": "",
                "ass_style_json": {
                    "font_name": "Arial",
                    "font_size": 52,
                    "primary_color": "&H00FFFFFF",
                    "outline_color": "&H00000000",
                    "outline": 3,
                    "shadow": 1,
                    "alignment": 2,
                    "margin_v": 88,
                },
                "is_active": True,
                "created_at": now_iso(),
            }
        ],
    }


@app.post("/v1/videos/edits")
async def create_video_edit(
    request: Request,
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    mode: str = Form("cut_captions"),
    language: str = Form("pt-BR"),
    style_prompt: str = Form(""),
):
    trace_id = request.state.trace_id
    safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "_", video.filename or "upload.mp4")
    input_path = INPUT_DIR / f"src_{uuid.uuid4().hex[:10]}_{safe_name}"
    payload = await video.read()
    input_path.write_bytes(payload)

    log_event(
        "info",
        trace_id,
        "upload",
        "video_received",
        file_name=safe_name,
        bytes=len(payload),
        input_path=input_path.as_posix(),
        file_hash=short_hash(input_path),
        mode=mode,
        language=language,
    )

    video_id = create_video_record(
        input_path=input_path,
        mode=mode,
        language=language,
        style_prompt=style_prompt,
        caption_template_id="default-pt-br" if mode == "cut_captions" else None,
    )

    def run_pipeline():
        process_video_pipeline(video_id, trace_id=trace_id, include_subtitles=mode == "cut_captions")

    background_tasks.add_task(run_pipeline)
    row = get_video_row(video_id)
    return video_row_to_item(row)


@app.post("/v1/videos/captions")
async def create_video_caption_compat(
    request: Request,
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    language: str = Form("pt-BR"),
    instructions: str = Form(""),
    caption_template_id: Optional[str] = Form(None),
):
    trace_id = request.state.trace_id
    safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "_", video.filename or "upload.mp4")
    input_path = INPUT_DIR / f"src_{uuid.uuid4().hex[:10]}_{safe_name}"
    payload = await video.read()
    input_path.write_bytes(payload)

    log_event(
        "info",
        trace_id,
        "upload",
        "video_received_legacy",
        file_name=safe_name,
        bytes=len(payload),
        input_path=input_path.as_posix(),
        file_hash=short_hash(input_path),
        language=language,
    )

    video_id = create_video_record(
        input_path=input_path,
        mode="cut_captions",
        language=language,
        style_prompt=instructions,
        caption_template_id=caption_template_id or "default-pt-br",
    )

    def run_pipeline():
        process_video_pipeline(video_id, trace_id=trace_id, include_subtitles=True)

    background_tasks.add_task(run_pipeline)
    row = get_video_row(video_id)
    return video_row_to_item(row)


@app.post("/v1/videos/manual-source")
async def create_video_manual_source(
    request: Request,
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    language: str = Form("pt-BR"),
):
    trace_id = request.state.trace_id
    safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "_", video.filename or "upload.mp4")
    input_path = INPUT_DIR / f"manual_src_{uuid.uuid4().hex[:10]}_{safe_name}"
    payload = await video.read()
    input_path.write_bytes(payload)

    log_event(
        "info",
        trace_id,
        "upload",
        "manual_source_received",
        file_name=safe_name,
        bytes=len(payload),
        input_path=input_path.as_posix(),
        file_hash=short_hash(input_path),
        language=language,
    )

    video_id = create_video_record(
        input_path=input_path,
        mode="manual_source",
        language=language,
        style_prompt="",
        caption_template_id=None,
    )

    def run_pipeline():
        process_manual_source_pipeline(video_id, trace_id=trace_id)

    background_tasks.add_task(run_pipeline)
    row = get_video_row(video_id)
    return video_row_to_item(row)


@app.get("/v1/videos/{video_id}")
def get_video(video_id: str):
    return video_row_to_item(get_video_row(video_id))


@app.get("/v1/videos/{video_id}/content")
def get_video_content(video_id: str):
    row = get_video_row(video_id)
    output_path = row["output_path"]
    if not output_path:
        raise HTTPException(status_code=404, detail="Conteudo ainda nao disponivel.")
    path = Path(output_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Arquivo final nao encontrado.")
    return FileResponse(path.as_posix(), media_type="video/mp4", filename=path.name)


@app.post("/v1/videos/{video_id}/editor-session")
def create_editor_session(video_id: str, payload: EditorSessionInput, request: Request):
    trace_id = request.state.trace_id
    if not VIDEO_EDITOR_MANUAL_ENABLED:
        raise HTTPException(status_code=409, detail="manual_editor_disabled")

    row = get_video_row(video_id)
    if row["status"] != "COMPLETE":
        raise HTTPException(status_code=409, detail="video_not_ready_for_manual_edit")

    session_id = str(uuid.uuid4())
    token = secrets.token_urlsafe(32)
    created = now_iso()
    expires = (dt.datetime.utcnow() + dt.timedelta(hours=8)).replace(microsecond=0).isoformat() + "Z"
    db.execute(
        "insert into editor_sessions (id,video_id,token,created_at,expires_at,last_used_at,metadata_json) values (?,?,?,?,?,?,?)",
        (session_id, video_id, token, created, expires, None, json.dumps({"order_id": payload.order_id})),
    )

    db.execute("update videos set edit_session_id = ?, updated_at = ? where id = ?", (session_id, now_iso(), video_id))

    editor_url = f"{PUBLIC_BASE_URL}/editor/index.html?videoId={video_id}&token={token}"
    log_event("info", trace_id, "manual", "editor_session_created", video_id=video_id, session_id=session_id)
    return {
        "editorUrl": editor_url,
        "sessionToken": token,
        "expiresAt": expires,
        "editSessionId": session_id,
    }


def validate_editor_token(video_id: str, token: str):
    row = db.fetchone(
        "select * from editor_sessions where video_id = ? and token = ? order by created_at desc limit 1",
        (video_id, token),
    )
    if not row:
        raise HTTPException(status_code=401, detail="invalid_editor_token")
    if row["expires_at"] < now_iso():
        raise HTTPException(status_code=401, detail="expired_editor_token")
    db.execute("update editor_sessions set last_used_at = ? where id = ?", (now_iso(), row["id"]))
    return row


@app.post("/v1/videos/{video_id}/manual-export")
def manual_export(video_id: str, payload: ManualExportInput, request: Request, background_tasks: BackgroundTasks):
    trace_id = request.state.trace_id
    validate_editor_token(video_id, payload.token)

    base_row = get_video_row(video_id)
    if base_row["status"] != "COMPLETE":
        raise HTTPException(status_code=409, detail="base_video_not_complete")

    source_output = base_row["output_path"]
    if not source_output or not Path(source_output).exists():
        raise HTTPException(status_code=404, detail="base_video_output_missing")

    copied_input = INPUT_DIR / f"manual_src_{uuid.uuid4().hex[:10]}.mp4"
    shutil.copy2(source_output, copied_input)

    manual_video_id = create_video_record(
        input_path=copied_input,
        mode="manual",
        language=base_row["language"] or "pt-BR",
        style_prompt=base_row["style_prompt"] or "",
        source_video_id=video_id,
        base_video_id=video_id,
        manual_edited=True,
    )

    start_s = max(0.0, float(payload.start_seconds or 0.0))
    end_s = float(payload.end_seconds) if payload.end_seconds is not None else None

    def run_manual_pipeline():
        try:
            upsert_video_status(manual_video_id, "PROCESSING", 0.1)
            inp = copied_input
            trimmed = OUTPUT_DIR / f"manual_trim_{manual_video_id}.mp4"
            final = OUTPUT_DIR / f"final_{manual_video_id}.mp4"

            cmd = ["ffmpeg", "-y", "-ss", f"{start_s:.3f}", "-i", inp.as_posix()]
            if end_s is not None and end_s > start_s:
                cmd.extend(["-to", f"{end_s:.3f}"])
            cmd.extend([
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                trimmed.as_posix(),
            ])
            run_cmd(cmd, trace_id=trace_id, stage="manual_trim", video_id=manual_video_id)
            upsert_video_status(manual_video_id, "PROCESSING", 0.55)

            subtitles_path = base_row["subtitles_path"]
            render_input = trimmed
            if payload.include_subtitles and subtitles_path and Path(subtitles_path).exists():
                with contextlib.suppress(Exception):
                    burn_tmp = OUTPUT_DIR / f"manual_captioned_{manual_video_id}.mp4"
                    burn_subtitles(trimmed, Path(subtitles_path), burn_tmp, trace_id=trace_id, video_id=manual_video_id)
                    render_input = burn_tmp

            deliver_social(render_input, final, trace_id=trace_id, video_id=manual_video_id)
            upsert_video_status(manual_video_id, "COMPLETE", 1.0, completed=True, output_path=final)
            log_event(
                "info",
                trace_id,
                "manual",
                "manual_export_complete",
                video_id=manual_video_id,
                base_video_id=video_id,
                output_path=final.as_posix(),
                output_hash=short_hash(final),
            )
        except Exception as error:
            upsert_video_status(
                manual_video_id,
                "FAILED",
                1.0,
                error_code="manual_export_failed",
                error_message=str(error),
                completed=True,
            )
            log_error(trace_id, "manual", "manual_export_failed", error, video_id=manual_video_id, base_video_id=video_id)

    background_tasks.add_task(run_manual_pipeline)
    return {
        "video": video_row_to_item(get_video_row(manual_video_id)),
        "baseVideoId": video_id,
    }


@app.post("/jobs/auto-edit")
def jobs_auto_edit(payload: JobAutoEditInput, request: Request):
    trace_id = request.state.trace_id
    job_id = create_job("auto-edit")

    def run():
        inp = resolve_existing_path(payload.input_path)
        out_name = payload.output_name or f"auto_{job_id}.mp4"
        out = OUTPUT_DIR / out_name
        auto_cut_video(
            inp,
            out,
            trace_id=trace_id,
            video_id=None,
            max_duration_seconds=payload.max_duration_seconds,
            silence_noise_db=payload.silence_noise_db,
            silence_min_duration=payload.silence_min_duration,
            padding_before=payload.padding_before,
            padding_after=payload.padding_after,
            min_segment_duration=payload.min_segment_duration,
        )
        return {"output_path": out.as_posix()}

    submit_async_job(job_id, trace_id=trace_id, fn=run)
    return {"job_id": job_id}


@app.post("/jobs/subtitles/generate")
def jobs_subtitles_generate(payload: JobSubtitleGenerateInput, request: Request):
    trace_id = request.state.trace_id
    job_id = create_job("subtitles-generate")

    def run():
        inp = resolve_existing_path(payload.input_path)
        out_name = payload.output_name or f"subs_{job_id}.srt"
        out = OUTPUT_DIR / out_name
        whisper_transcribe_to_srt(inp, out, trace_id=trace_id, language=payload.language, video_id=None)
        return {"output_path": out.as_posix()}

    submit_async_job(job_id, trace_id=trace_id, fn=run)
    return {"job_id": job_id}


@app.post("/jobs/subtitles/burn")
def jobs_subtitles_burn(payload: JobSubtitleBurnInput, request: Request):
    trace_id = request.state.trace_id
    job_id = create_job("subtitles-burn")

    def run():
        inp = resolve_existing_path(payload.input_path)
        subs = resolve_existing_path(payload.subtitles_path)
        out_name = payload.output_name or f"captioned_{job_id}.mp4"
        out = OUTPUT_DIR / out_name
        burn_subtitles(inp, subs, out, trace_id=trace_id, video_id=None)
        return {"output_path": out.as_posix()}

    submit_async_job(job_id, trace_id=trace_id, fn=run)
    return {"job_id": job_id}


@app.post("/jobs/deliver")
def jobs_deliver(payload: JobDeliverInput, request: Request):
    trace_id = request.state.trace_id
    job_id = create_job("deliver")

    def run():
        inp = resolve_existing_path(payload.input_path)
        out_name = payload.output_name or f"final_{job_id}.mp4"
        out = OUTPUT_DIR / out_name
        deliver_social(inp, out, trace_id=trace_id, video_id=None, width=payload.width, height=payload.height)
        return {"output_path": out.as_posix()}

    submit_async_job(job_id, trace_id=trace_id, fn=run)
    return {"job_id": job_id}


@app.get("/jobs/{job_id}")
def jobs_get(job_id: str):
    row = db.fetchone("select * from jobs where id = ?", (job_id,))
    if not row:
        raise HTTPException(status_code=404, detail="job_not_found")
    return job_row_to_item(row)


@app.get("/internal/logs/tail")
def logs_tail(
    request: Request,
    videoId: Optional[str] = Query(default=None),
    orderId: Optional[str] = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    x_api_key: Optional[str] = Header(default=None),
):
    trace_id = request.state.trace_id
    if INTERNAL_API_KEY and x_api_key != INTERNAL_API_KEY:
        raise HTTPException(status_code=401, detail="unauthorized")

    files = sorted(LOGS_DIR.glob("video-editor-api-*.jsonl"), reverse=True)
    out: list[dict[str, Any]] = []
    for fp in files:
        lines = fp.read_text(encoding="utf-8", errors="ignore").splitlines()
        for raw in reversed(lines):
            if len(out) >= limit:
                break
            with contextlib.suppress(Exception):
                item = json.loads(raw)
                m = item.get("meta", {})
                if videoId and str(m.get("video_id", "")) != str(videoId):
                    continue
                if orderId and str(m.get("order_id", "")) != str(orderId):
                    continue
                out.append(item)
        if len(out) >= limit:
            break

    log_event("info", trace_id, "logs", "tail_read", count=len(out), video_id=videoId, order_id=orderId, limit=limit)
    return {"count": len(out), "items": out}


@app.exception_handler(HTTPException)
async def http_exc(_request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


app.mount("/media/storage/output", StaticFiles(directory=OUTPUT_DIR.as_posix()), name="output-media")
app.mount("/editor", StaticFiles(directory=EDITOR_DIR.as_posix(), html=True), name="editor-web")
