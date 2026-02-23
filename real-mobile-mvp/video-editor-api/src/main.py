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
from typing import Any, Callable, Optional

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
INCIDENTS_DIR = LOGS_DIR / "incidents"
DB_PATH = Path(os.getenv("VIDEO_DB_PATH", STORAGE_ROOT / "video_editor.db")).resolve()
EDITOR_DIR = Path(os.getenv("VIDEO_EDITOR_WEB_DIR", BASE_DIR / "editor")).resolve()
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:8081").rstrip("/")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
MAX_WORKERS = int(os.getenv("VIDEO_MAX_WORKERS", "2"))
VIDEO_EDITOR_MANUAL_ENABLED = os.getenv("VIDEO_EDITOR_MANUAL_ENABLED", "true").lower() == "true"
INCIDENT_WINDOW_MIN = int(os.getenv("INCIDENT_WINDOW_MIN", "15"))
INCIDENT_RESET_MIN = int(os.getenv("INCIDENT_RESET_MIN", "30"))
INCIDENT_L1 = int(os.getenv("INCIDENT_L1", "3"))
INCIDENT_L2 = int(os.getenv("INCIDENT_L2", "5"))
INCIDENT_L3 = int(os.getenv("INCIDENT_L3", "8"))

for d in [INPUT_DIR, WORK_DIR, OUTPUT_DIR, LOGS_DIR, INCIDENTS_DIR, EDITOR_DIR]:
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
            c.execute(
                """
                create table if not exists incident_events (
                  id integer primary key autoincrement,
                  fingerprint text not null,
                  level integer not null default 0,
                  count_15m integer not null default 0,
                  error_type text not null,
                  message text not null,
                  stack text,
                  context_json text,
                  stage text,
                  event text,
                  trace_id text,
                  request_id text,
                  run_id text,
                  event_ts text not null,
                  report_path text
                )
                """
            )
            c.execute("create index if not exists idx_incident_events_fp_ts on incident_events (fingerprint, event_ts)")
            c.execute(
                """
                create table if not exists incident_states (
                  fingerprint text primary key,
                  level integer not null default 0,
                  count_15m integer not null default 0,
                  first_seen_at text not null,
                  last_seen_at text not null,
                  reset_applied integer not null default 0,
                  last_event_json text,
                  last_trace_id text,
                  last_request_id text,
                  last_run_id text,
                  report_path text,
                  updated_at text not null
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


SENSITIVE_KEY_RE = re.compile(r"(token|password|passwd|pwd|cookie|authorization|secret|api[_-]?key)", re.IGNORECASE)
SENSITIVE_VALUE_PATTERNS = [
    re.compile(r"Bearer\s+[A-Za-z0-9._~+/=-]+", re.IGNORECASE),
    re.compile(r"\bsk-[A-Za-z0-9]{8,}\b"),
    re.compile(r"\b(xox[pbars]-[A-Za-z0-9-]{8,})\b", re.IGNORECASE),
]


def now_iso() -> str:
    return dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def now_dt_utc() -> dt.datetime:
    return dt.datetime.utcnow().replace(microsecond=0)


def iso_from_dt(value: dt.datetime) -> str:
    if value.tzinfo is not None:
        value = value.astimezone(dt.timezone.utc).replace(tzinfo=None)
    return value.replace(microsecond=0).isoformat() + "Z"


def parse_iso_utc(raw: str) -> dt.datetime:
    value = (raw or "").strip()
    if not value:
        return dt.datetime.utcfromtimestamp(0)
    with contextlib.suppress(Exception):
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        parsed = dt.datetime.fromisoformat(value)
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(dt.timezone.utc).replace(tzinfo=None)
        return parsed.replace(microsecond=0)
    with contextlib.suppress(Exception):
        return dt.datetime.strptime(raw, "%Y-%m-%dT%H:%M:%SZ")
    return dt.datetime.utcfromtimestamp(0)


def clip_text(value: Any, limit: int) -> str:
    text = str(value if value is not None else "")
    return text[:limit]


def redact_string(raw: str) -> str:
    out = raw
    for pattern in SENSITIVE_VALUE_PATTERNS:
        out = pattern.sub("***", out)
    return out


def redact_data(value: Any, key_hint: str = "", depth: int = 0) -> Any:
    if depth > 8:
        return "***depth_limit***"
    if value is None:
        return None
    if isinstance(value, str):
        if SENSITIVE_KEY_RE.search(key_hint):
            return "***"
        return redact_string(value)[:16000]
    if isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, list):
        return [redact_data(item, key_hint, depth + 1) for item in value[:200]]
    if isinstance(value, tuple):
        return [redact_data(item, key_hint, depth + 1) for item in list(value)[:200]]
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in list(value.items())[:300]:
            redacted[str(key)] = redact_data(item, str(key), depth + 1)
        return redacted
    return redact_string(str(value))[:16000]


def infer_error_type(message: str) -> str:
    text = (message or "").strip()
    if not text:
        return "UnknownError"
    for pattern in [r"\b([A-Za-z]+(?:Error|Exception|Domain))\b", r"^([A-Za-z][A-Za-z0-9_.-]{2,40})"]:
        matched = re.search(pattern, text)
        if matched:
            return matched.group(1)[:80]
    return "ClientEventError"


def meta_lookup(meta: dict[str, Any], keys: list[str]) -> Optional[str]:
    for key in keys:
        value = meta.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text[:160]
    return None


class IncidentManager:
    def __init__(
        self,
        db_ref: Db,
        incidents_dir: Path,
        *,
        window_minutes: int = 15,
        reset_minutes: int = 30,
        level_l1: int = 3,
        level_l2: int = 5,
        level_l3: int = 8,
        now_provider: Optional[Callable[[], dt.datetime]] = None,
    ):
        self.db = db_ref
        self.incidents_dir = incidents_dir
        self.window_minutes = max(1, int(window_minutes))
        self.reset_minutes = max(self.window_minutes, int(reset_minutes))
        self.level_l1 = max(1, int(level_l1))
        self.level_l2 = max(self.level_l1, int(level_l2))
        self.level_l3 = max(self.level_l2, int(level_l3))
        self.now_provider = now_provider
        self.incidents_dir.mkdir(parents=True, exist_ok=True)

    def _now_dt(self) -> dt.datetime:
        if self.now_provider is None:
            return now_dt_utc()
        value = self.now_provider()
        if value.tzinfo is not None:
            value = value.astimezone(dt.timezone.utc).replace(tzinfo=None)
        return value.replace(microsecond=0)

    def _now_iso(self) -> str:
        return iso_from_dt(self._now_dt())

    def level_from_count(self, count_15m: int) -> int:
        if count_15m >= self.level_l3:
            return 3
        if count_15m >= self.level_l2:
            return 2
        if count_15m >= self.level_l1:
            return 1
        return 0

    def _primary_context(self, context: dict[str, Any]) -> dict[str, Any]:
        keys = [
            "stage",
            "event",
            "path",
            "route",
            "platform",
            "source",
            "reason",
            "code",
            "error_code",
            "request_id",
            "run_id",
            "job_id",
            "video_id",
        ]
        out: dict[str, Any] = {}
        for key in keys:
            value = context.get(key)
            if value in (None, "", [], {}):
                continue
            out[key] = value
        if out:
            return out
        for key in sorted(context.keys())[:8]:
            value = context.get(key)
            if value in (None, "", [], {}):
                continue
            out[key] = value
        return out

    def fingerprint(self, error_type: str, message: str, stack: str, context: dict[str, Any]) -> str:
        safe_type = clip_text(error_type, 120)
        safe_message = clip_text(message, 1600)
        safe_stack = clip_text(stack, 6000)
        primary = self._primary_context(context)
        raw = f"{safe_type}|{safe_message}|{safe_stack}|{json.dumps(primary, sort_keys=True, ensure_ascii=True)}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]

    def _impact_for_level(self, level: int) -> str:
        if level >= 3:
            return "Critico: erro recorrente com alta probabilidade de impactar operacao e upload."
        if level >= 2:
            return "Alto: erro recorrente confirmado com impacto direto na experiencia do usuario."
        if level >= 1:
            return "Moderado: repeticao detectada dentro da janela de observacao."
        return "Baixo: evento isolado dentro da janela."

    def _attempts_text(self, context: dict[str, Any]) -> str:
        failures = context.get("failures")
        if isinstance(failures, list) and failures:
            joined = ", ".join([clip_text(item, 120) for item in failures[:8]])
            return joined[:1200]
        reason = context.get("reason") or context.get("message")
        if reason:
            return clip_text(reason, 800)
        return "Sem detalhes adicionais de tentativas."

    def _write_report(
        self,
        *,
        fingerprint: str,
        level: int,
        count_15m: int,
        error_type: str,
        message: str,
        stack: str,
        context: dict[str, Any],
        trace_id: str,
        request_id: Optional[str],
        run_id: Optional[str],
    ) -> str:
        now = self._now_dt()
        stamp = now.strftime("%Y%m%dT%H%M%SZ")
        path = self.incidents_dir / f"incident-{fingerprint}-{stamp}.md"
        status = "critical_open" if level >= 3 else "investigating"
        hypothesis = "Falha intermitente na captura de asset do iOS ou incompatibilidade de representacao do arquivo."
        if error_type:
            hypothesis = f"{hypothesis} Tipo observado: {error_type}."
        lines = [
            "# Relatorio de Incidente",
            "",
            f"- horario: {iso_from_dt(now)}",
            f"- fingerprint: {fingerprint}",
            f"- frequencia: {count_15m} ocorrencias nos ultimos {self.window_minutes} minutos",
            f"- impacto: {self._impact_for_level(level)}",
            f"- hipotese: {clip_text(hypothesis, 1500)}",
            f"- tentativas feitas: {self._attempts_text(context)}",
            "- proximos passos: validar reproducoes no iOS real, revisar fallback de picker e acompanhar incidente por 24h.",
            f"- status: {status}",
            "",
            "## Ultimo Evento",
            f"- trace_id: {clip_text(trace_id, 160)}",
            f"- request_id: {clip_text(request_id or '-', 160)}",
            f"- run_id: {clip_text(run_id or '-', 160)}",
            f"- erro: {clip_text(message, 2400)}",
        ]
        if level >= 3:
            lines.extend(
                [
                    "",
                    "## Trace Completo",
                    "```text",
                    clip_text(stack, 30000),
                    "```",
                ]
            )
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return path.as_posix()

    def register(
        self,
        *,
        error_type: str,
        message: str,
        stack: str,
        context: dict[str, Any],
        stage: str,
        event: str,
        trace_id: str,
        request_id: Optional[str] = None,
        run_id: Optional[str] = None,
    ) -> dict[str, Any]:
        now = self._now_dt()
        now_str = iso_from_dt(now)
        safe_context_raw = redact_data(context or {}, "context")
        safe_context = safe_context_raw if isinstance(safe_context_raw, dict) else {"context": safe_context_raw}
        safe_type = clip_text(redact_data(error_type, "error_type"), 120)
        safe_message = clip_text(redact_data(message, "message"), 3000)
        safe_stack = clip_text(redact_data(stack, "stack"), 60000)
        safe_trace = clip_text(trace_id or "-", 160)
        safe_request = clip_text(request_id or "", 160) or None
        safe_run = clip_text(run_id or "", 160) or None
        safe_stage = clip_text(stage, 120)
        safe_event = clip_text(event, 160)
        fingerprint = self.fingerprint(safe_type, safe_message, safe_stack, safe_context)

        prev = self.db.fetchone("select * from incident_states where fingerprint = ?", (fingerprint,))
        reset_applied = False
        if prev:
            last_seen = parse_iso_utc(prev["last_seen_at"])
            if (now - last_seen) >= dt.timedelta(minutes=self.reset_minutes):
                reset_applied = True

        window_start = iso_from_dt(now - dt.timedelta(minutes=self.window_minutes))
        count_row = self.db.fetchone(
            "select count(1) as c from incident_events where fingerprint = ? and event_ts >= ?",
            (fingerprint, window_start),
        )
        count_15m = int((count_row["c"] if count_row and count_row["c"] is not None else 0)) + 1
        level = self.level_from_count(count_15m)
        prev_level = int(prev["level"]) if prev else 0

        report_path = prev["report_path"] if prev and prev["report_path"] else None
        if level >= 2 and (prev_level < 2 or (prev_level < 3 and level >= 3) or not report_path):
            report_path = self._write_report(
                fingerprint=fingerprint,
                level=level,
                count_15m=count_15m,
                error_type=safe_type,
                message=safe_message,
                stack=safe_stack,
                context=safe_context,
                trace_id=safe_trace,
                request_id=safe_request,
                run_id=safe_run,
            )

        self.db.execute(
            """
            insert into incident_events (
              fingerprint, level, count_15m, error_type, message, stack, context_json,
              stage, event, trace_id, request_id, run_id, event_ts, report_path
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                fingerprint,
                level,
                count_15m,
                safe_type,
                safe_message,
                safe_stack,
                json.dumps(safe_context, ensure_ascii=True),
                safe_stage,
                safe_event,
                safe_trace,
                safe_request,
                safe_run,
                now_str,
                report_path,
            ),
        )

        first_seen = prev["first_seen_at"] if prev and prev["first_seen_at"] else now_str
        last_event = {
            "stage": safe_stage,
            "event": safe_event,
            "error_type": safe_type,
            "message": safe_message[:1200],
            "level": level,
            "count_15m": count_15m,
            "ts": now_str,
        }
        self.db.execute(
            """
            insert into incident_states (
              fingerprint, level, count_15m, first_seen_at, last_seen_at, reset_applied,
              last_event_json, last_trace_id, last_request_id, last_run_id, report_path, updated_at
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(fingerprint) do update set
              level = excluded.level,
              count_15m = excluded.count_15m,
              last_seen_at = excluded.last_seen_at,
              reset_applied = excluded.reset_applied,
              last_event_json = excluded.last_event_json,
              last_trace_id = excluded.last_trace_id,
              last_request_id = excluded.last_request_id,
              last_run_id = excluded.last_run_id,
              report_path = coalesce(excluded.report_path, incident_states.report_path),
              updated_at = excluded.updated_at
            """,
            (
                fingerprint,
                level,
                count_15m,
                first_seen,
                now_str,
                1 if reset_applied else 0,
                json.dumps(last_event, ensure_ascii=True),
                safe_trace,
                safe_request,
                safe_run,
                report_path,
                now_str,
            ),
        )
        return {
            "incident_fingerprint": fingerprint,
            "incident_level": level,
            "incident_count_15m": count_15m,
            "incident_reset_applied": reset_applied,
            "report_path": report_path,
            "last_seen_at": now_str,
            "last_trace_id": safe_trace,
        }

    def _apply_stale_resets(self):
        now = self._now_dt()
        cutoff = iso_from_dt(now - dt.timedelta(minutes=self.reset_minutes))
        now_str = iso_from_dt(now)
        self.db.execute(
            """
            update incident_states
            set level = 0,
                count_15m = 0,
                reset_applied = 1,
                updated_at = ?
            where level > 0 and last_seen_at < ?
            """,
            (now_str, cutoff),
        )

    def tail(self, *, limit: int, fingerprint: Optional[str] = None, min_level: int = 0) -> list[dict[str, Any]]:
        self._apply_stale_resets()
        clauses = ["1 = 1"]
        params: list[Any] = []
        if fingerprint:
            clauses.append("fingerprint = ?")
            params.append(fingerprint)
        if min_level > 0:
            clauses.append("level >= ?")
            params.append(int(min_level))
        params.append(int(limit))
        rows = self.db.fetchall(
            f"select * from incident_states where {' and '.join(clauses)} order by last_seen_at desc limit ?",
            tuple(params),
        )
        out: list[dict[str, Any]] = []
        for row in rows:
            last_event = {}
            if row["last_event_json"]:
                with contextlib.suppress(Exception):
                    last_event = json.loads(row["last_event_json"])
            out.append(
                {
                    "fingerprint": row["fingerprint"],
                    "level": int(row["level"] or 0),
                    "count_15m": int(row["count_15m"] or 0),
                    "last_seen_at": row["last_seen_at"],
                    "last_event": last_event,
                    "last_trace_id": row["last_trace_id"],
                    "last_request_id": row["last_request_id"],
                    "last_run_id": row["last_run_id"],
                    "report_path": row["report_path"],
                    "incident_reset_applied": bool(row["reset_applied"]),
                }
            )
        return out


incident_manager = IncidentManager(
    db,
    INCIDENTS_DIR,
    window_minutes=INCIDENT_WINDOW_MIN,
    reset_minutes=INCIDENT_RESET_MIN,
    level_l1=INCIDENT_L1,
    level_l2=INCIDENT_L2,
    level_l3=INCIDENT_L3,
)


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
    payload_raw: dict[str, Any] = {"ts": ts, "app": APP_NAME, **entry}
    payload_safe = redact_data(payload_raw, "root")
    payload = payload_safe if isinstance(payload_safe, dict) else payload_raw
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
    safe_meta_raw = redact_data(meta or {}, "meta")
    safe_meta = safe_meta_raw if isinstance(safe_meta_raw, dict) else {"meta": safe_meta_raw}
    stack = traceback.format_exc()
    request_id = meta_lookup(safe_meta, ["request_id", "requestId", "http_request_id"])
    run_id = meta_lookup(safe_meta, ["run_id", "runId", "job_id", "video_id"])
    incident_meta = {
        "incident_fingerprint": None,
        "incident_level": 0,
        "incident_count_15m": 0,
        "incident_reset_applied": False,
    }
    with contextlib.suppress(Exception):
        incident_meta = incident_manager.register(
            error_type=error.__class__.__name__ or "RuntimeError",
            message=str(error),
            stack=stack,
            context={**safe_meta, "stage": stage, "event": event},
            stage=stage,
            event=event,
            trace_id=trace_id,
            request_id=request_id,
            run_id=run_id,
        )
    write_log(
        {
            "level": "error",
            "trace_id": trace_id,
            "stage": stage,
            "event": event,
            "meta": {
                **safe_meta,
                "error": str(error),
                "error_type": error.__class__.__name__ or "RuntimeError",
                "stack": stack,
                **incident_meta,
            },
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


def log_media_streams(path: Path, trace_id: str, stage: str, event: str, video_id: Optional[str] = None):
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "stream=index,codec_type,codec_name,channels,sample_rate",
        "-of",
        "json",
        path.as_posix(),
    ]
    proc = run_cmd(cmd, trace_id=trace_id, stage=f"{stage}_ffprobe_streams", video_id=video_id)
    try:
        payload = json.loads(proc.stdout or "{}")
    except Exception as error:
        log_error(trace_id, stage, "streams_probe_parse_failed", error, video_id=video_id, path=path.as_posix())
        return

    streams = payload.get("streams") or []
    audio_streams = [s for s in streams if s.get("codec_type") == "audio"]
    video_streams = [s for s in streams if s.get("codec_type") == "video"]
    log_event(
        "info",
        trace_id,
        stage,
        event,
        video_id=video_id,
        path=path.as_posix(),
        stream_count=len(streams),
        video_stream_count=len(video_streams),
        audio_stream_count=len(audio_streams),
        audio_codecs=[s.get("codec_name") for s in audio_streams],
        audio_channels=[s.get("channels") for s in audio_streams],
        audio_sample_rates=[s.get("sample_rate") for s in audio_streams],
    )


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
    log_event(
        "info",
        trace_id,
        "silencedetect",
        "start",
        video_id=video_id,
        total_duration_sec=round(total_duration, 3),
        silence_noise_db=silence_noise_db,
        silence_min_duration=silence_min_duration,
    )
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
    kept_duration = sum(max(0.0, en - st) for st, en in segments)
    reduction_pct = max(0.0, 100.0 * (1.0 - (kept_duration / total_duration))) if total_duration > 0 else 0.0
    log_event(
        "info",
        trace_id,
        "silencedetect",
        "segments_built",
        video_id=video_id,
        segment_count=len(segments),
        kept_duration_sec=round(kept_duration, 3),
        reduction_pct=round(reduction_pct, 2),
    )

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
                "-map",
                "0:v:0",
                "-map",
                "0:a?",
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
                "-movflags",
                "+faststart",
                out_seg.as_posix(),
            ]
            run_cmd(cmd, trace_id=trace_id, stage="segment_extract", video_id=video_id)
            log_media_streams(out_seg, trace_id=trace_id, stage="segment_extract", event="segment_streams", video_id=video_id)
            segment_files.append(out_seg)

        if not segment_files:
            shutil.copy2(input_path, output_path)
            return

        concat_list = work_tmp / "concat.txt"
        concat_list.write_text("\n".join([f"file '{p.as_posix()}'" for p in segment_files]), encoding="utf-8")

        cmd_reencode = [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            concat_list.as_posix(),
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
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
            "-movflags",
            "+faststart",
            output_path.as_posix(),
        ]
        run_cmd(cmd_reencode, trace_id=trace_id, stage="segment_concat_reencode", video_id=video_id)
        log_media_streams(output_path, trace_id=trace_id, stage="segment_concat_reencode", event="concat_streams", video_id=video_id)
    finally:
        shutil.rmtree(work_tmp, ignore_errors=True)


def whisper_transcribe_to_srt(input_path: Path, srt_output: Path, trace_id: str, language: str = "pt", video_id: Optional[str] = None):
    temp_dir = WORK_DIR / f"whisper_{uuid.uuid4().hex[:8]}"
    temp_dir.mkdir(parents=True, exist_ok=True)
    try:
        whisper_model = os.getenv("WHISPER_MODEL", "base")
        whisper_language = "Portuguese" if language.lower().startswith("pt") else language
        preferred = os.getenv("WHISPER_BIN", "").strip()
        candidates: list[list[str]] = []

        if preferred:
            candidates.append([preferred])

        for candidate in [
            "whisper",
            "/root/.local/bin/whisper",
            "/usr/local/bin/whisper",
            str((BASE_DIR / ".venv" / "bin" / "whisper").resolve()),
        ]:
            if shutil.which(candidate) or Path(candidate).exists():
                candidates.append([candidate])

        python_bin = os.getenv("WHISPER_PYTHON_BIN", "python3")
        if shutil.which(python_bin):
            candidates.append([python_bin, "-m", "whisper"])

        seen: set[tuple[str, ...]] = set()
        deduped: list[list[str]] = []
        for c in candidates:
            key = tuple(c)
            if key in seen:
                continue
            seen.add(key)
            deduped.append(c)
        candidates = deduped

        if not candidates:
            raise RuntimeError("whisper_not_configured")

        last_error: Optional[str] = None
        success = False
        for idx, base_cmd in enumerate(candidates):
            cmd = [
                *base_cmd,
                input_path.as_posix(),
                "--language",
                whisper_language,
                "--model",
                whisper_model,
                "--output_format",
                "srt",
                "--output_dir",
                temp_dir.as_posix(),
            ]
            log_event(
                "info",
                trace_id,
                "whisper",
                "candidate_start",
                video_id=video_id,
                candidate_index=idx,
                cmd=cmd,
            )
            try:
                run_cmd(cmd, trace_id=trace_id, stage="whisper", video_id=video_id)
                success = True
                break
            except Exception as error:
                last_error = str(error)
                log_error(trace_id, "whisper", "candidate_failed", error, video_id=video_id, candidate_index=idx, cmd=cmd)

        if not success:
            raise RuntimeError(f"whisper_failed_all_candidates:{last_error or 'unknown'}")

        generated = temp_dir / f"{input_path.stem}.srt"
        if not generated.exists():
            raise RuntimeError("whisper_output_missing")
        shutil.move(generated.as_posix(), srt_output.as_posix())
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def _normalize_font_name(raw: str) -> str:
    cleaned = (raw or "").strip()
    if not cleaned:
        return "Arial"
    mapping = {
        "montserrat": "Montserrat",
        "dm serif display": "DM Serif Display",
        "dmserifdisplay": "DM Serif Display",
        "poppins": "Poppins",
        "bebas": "Bebas Neue",
        "bebasneue": "Bebas Neue",
        "arial": "Arial",
        "system": "Arial",
    }
    key = re.sub(r"\s+", " ", cleaned.lower())
    return mapping.get(key, cleaned[:64])


def _hex_to_ass_bgr(color_hex: str) -> str:
    raw = (color_hex or "").strip()
    match = re.match(r"^#?([0-9a-fA-F]{6})$", raw)
    if not match:
        return "&H00FFFFFF"
    rgb = match.group(1)
    rr, gg, bb = rgb[0:2], rgb[2:4], rgb[4:6]
    return f"&H00{bb.upper()}{gg.upper()}{rr.upper()}"


def parse_subtitle_style(style_prompt: str) -> dict[str, str]:
    text = style_prompt or ""
    font_name = "Arial"
    color_hex = "#FFFFFF"

    font_match = re.search(r"(?:fonte|font)\s*[=:]\s*([^;\n]+)", text, flags=re.IGNORECASE)
    if font_match:
        font_name = _normalize_font_name(font_match.group(1))

    color_match = re.search(r"(?:cor|color)\s*[=:]\s*(#[0-9a-fA-F]{6})", text, flags=re.IGNORECASE)
    if color_match:
        color_hex = color_match.group(1).upper()

    return {
        "font_name": font_name,
        "color_hex": color_hex,
        "ass_primary": _hex_to_ass_bgr(color_hex),
    }


def burn_subtitles(
    input_path: Path,
    subtitles_path: Path,
    output_path: Path,
    trace_id: str,
    video_id: Optional[str] = None,
    style_prompt: str = "",
):
    escaped_sub = subtitles_path.as_posix().replace("'", "\\\\'")
    style_cfg = parse_subtitle_style(style_prompt)
    style = (
        f"FontName={style_cfg['font_name']},"
        "FontSize=20,"
        f"PrimaryColour={style_cfg['ass_primary']},"
        "OutlineColour=&H00000000,Outline=2,Shadow=1,Alignment=2,MarginV=40"
    )
    log_event(
        "info",
        trace_id,
        "burn_subtitles",
        "subtitle_style_applied",
        video_id=video_id,
        font_name=style_cfg["font_name"],
        color_hex=style_cfg["color_hex"],
        ass_primary=style_cfg["ass_primary"],
    )
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        input_path.as_posix(),
        "-vf",
        f"subtitles='{escaped_sub}':force_style='{style}'",
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
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
        "-movflags",
        "+faststart",
        output_path.as_posix(),
    ]
    run_cmd(cmd, trace_id=trace_id, stage="burn_subtitles", video_id=video_id)
    log_media_streams(output_path, trace_id=trace_id, stage="burn_subtitles", event="burn_output_streams", video_id=video_id)


def deliver_social(input_path: Path, output_path: Path, trace_id: str, video_id: Optional[str] = None, width: int = 1080, height: int = 1920):
    vf = f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p"
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        input_path.as_posix(),
        "-vf",
        vf,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
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
        "-movflags",
        "+faststart",
        output_path.as_posix(),
    ]
    run_cmd(cmd, trace_id=trace_id, stage="deliver", video_id=video_id)
    log_media_streams(output_path, trace_id=trace_id, stage="deliver", event="deliver_output_streams", video_id=video_id)


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
    style_prompt = row["style_prompt"] or ""

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
            silence_noise_db=-30,
            silence_min_duration=0.25,
            padding_before=0.05,
            padding_after=0.10,
            min_segment_duration=0.18,
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
                burn_subtitles(
                    auto_out,
                    subtitles_out,
                    captioned_out,
                    trace_id=trace_id,
                    video_id=video_id,
                    style_prompt=style_prompt,
                )
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
    caption_mode: str = "auto"  # auto | manual | none
    segments: list[dict[str, Any]] = Field(default_factory=list)
    manual_captions: list[dict[str, Any]] = Field(default_factory=list)
    subtitles_language: str = "pt-BR"


class EditorSessionInput(BaseModel):
    order_id: Optional[str] = None


class ClientEventInput(BaseModel):
    trace_id: str = Field(..., min_length=4, max_length=120)
    stage: str = Field(..., min_length=1, max_length=80)
    event: str = Field(..., min_length=1, max_length=120)
    level: str = Field(default="info", min_length=1, max_length=16)
    meta: dict[str, Any] = Field(default_factory=dict)


def resolve_existing_path(raw: str) -> Path:
    candidate = Path(raw)
    if candidate.exists():
        return candidate.resolve()
    for base in [INPUT_DIR, WORK_DIR, OUTPUT_DIR]:
        scoped = (base / raw).resolve()
        if scoped.exists():
            return scoped
    raise HTTPException(status_code=400, detail=f"Arquivo nao encontrado: {raw}")


def normalize_segments(
    segments: list[dict[str, Any]],
    default_start: float,
    default_end: Optional[float],
    total_duration: float,
) -> list[tuple[float, float]]:
    normalized: list[tuple[float, float]] = []
    if segments:
        for seg in segments:
            try:
                st = max(0.0, float(seg.get("start_seconds", 0.0)))
                en = float(seg.get("end_seconds", st))
                enabled = bool(seg.get("enabled", True))
            except Exception:
                continue
            if not enabled:
                continue
            st = min(st, total_duration)
            en = min(max(st, en), total_duration)
            if en - st >= 0.05:
                normalized.append((st, en))
    else:
        st = max(0.0, float(default_start or 0.0))
        en = float(default_end) if default_end is not None else total_duration
        st = min(st, total_duration)
        en = min(max(st, en), total_duration)
        if en - st >= 0.05:
            normalized.append((st, en))

    normalized.sort(key=lambda x: (x[0], x[1]))
    merged: list[tuple[float, float]] = []
    for st, en in normalized:
        if not merged:
            merged.append((st, en))
            continue
        last_st, last_en = merged[-1]
        if st <= last_en + 0.02:
            merged[-1] = (last_st, max(last_en, en))
        else:
            merged.append((st, en))
    return merged


def concat_from_segments(source_path: Path, segments: list[tuple[float, float]], output_path: Path, trace_id: str, video_id: str):
    work_tmp = WORK_DIR / f"manual_segments_{uuid.uuid4().hex[:10]}"
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
                source_path.as_posix(),
                "-map",
                "0:v:0",
                "-map",
                "0:a?",
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
                "-movflags",
                "+faststart",
                out_seg.as_posix(),
            ]
            run_cmd(cmd, trace_id=trace_id, stage="manual_segment_extract", video_id=video_id)
            log_media_streams(out_seg, trace_id=trace_id, stage="manual_segment_extract", event="manual_segment_streams", video_id=video_id)
            segment_files.append(out_seg)

        if not segment_files:
            shutil.copy2(source_path, output_path)
            return

        concat_list = work_tmp / "concat.txt"
        concat_list.write_text("\n".join([f"file '{p.as_posix()}'" for p in segment_files]), encoding="utf-8")
        cmd_reencode = [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            concat_list.as_posix(),
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
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
            "-movflags",
            "+faststart",
            output_path.as_posix(),
        ]
        run_cmd(cmd_reencode, trace_id=trace_id, stage="manual_segment_concat_reencode", video_id=video_id)
        log_media_streams(output_path, trace_id=trace_id, stage="manual_segment_concat_reencode", event="manual_concat_streams", video_id=video_id)
    finally:
        shutil.rmtree(work_tmp, ignore_errors=True)


def _sec_to_srt(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int(round((seconds - int(seconds)) * 1000))
    if ms >= 1000:
        s += 1
        ms -= 1000
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def remap_manual_captions_from_source(manual_captions: list[dict[str, Any]], kept_segments: list[tuple[float, float]]) -> list[tuple[float, float, str]]:
    mapped: list[tuple[float, float, str]] = []
    for cap in manual_captions:
        text = str(cap.get("text", "")).strip()
        if not text:
            continue
        try:
            src_start = float(cap.get("start_seconds", 0.0))
            src_end = float(cap.get("end_seconds", src_start + 1.2))
        except Exception:
            continue
        if src_end <= src_start:
            continue

        acc = 0.0
        for seg_st, seg_en in kept_segments:
            seg_len = seg_en - seg_st
            ov_st = max(src_start, seg_st)
            ov_en = min(src_end, seg_en)
            if ov_en > ov_st:
                out_st = acc + (ov_st - seg_st)
                out_en = acc + (ov_en - seg_st)
                if out_en - out_st >= 0.1:
                    mapped.append((out_st, out_en, text))
            acc += seg_len
    return mapped


def write_manual_srt(captions: list[tuple[float, float, str]], srt_path: Path):
    lines: list[str] = []
    for idx, (st, en, text) in enumerate(captions, start=1):
        lines.extend(
            [
                str(idx),
                f"{_sec_to_srt(st)} --> {_sec_to_srt(en)}",
                text,
                "",
            ]
        )
    srt_path.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")


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
    total_duration = ffprobe_duration(copied_input, trace_id=trace_id, video_id=manual_video_id)
    normalized_segments = normalize_segments(payload.segments, start_s, end_s, total_duration)
    caption_mode = (payload.caption_mode or "auto").strip().lower()
    if caption_mode not in {"auto", "manual", "none"}:
        caption_mode = "auto"
    log_event(
        "info",
        trace_id,
        "manual",
        "manual_export_received",
        video_id=manual_video_id,
        base_video_id=video_id,
        total_duration_sec=round(total_duration, 3),
        segment_count=len(normalized_segments),
        caption_mode=caption_mode,
        include_subtitles=payload.include_subtitles,
        manual_captions_count=len(payload.manual_captions or []),
    )

    def run_manual_pipeline():
        try:
            upsert_video_status(manual_video_id, "PROCESSING", 0.1)
            inp = copied_input
            trimmed = OUTPUT_DIR / f"manual_cut_{manual_video_id}.mp4"
            final = OUTPUT_DIR / f"final_{manual_video_id}.mp4"
            auto_subs = OUTPUT_DIR / f"manual_auto_subs_{manual_video_id}.srt"
            manual_subs = OUTPUT_DIR / f"manual_subs_{manual_video_id}.srt"

            if not normalized_segments:
                raise RuntimeError("manual_no_valid_segments")

            concat_from_segments(inp, normalized_segments, trimmed, trace_id=trace_id, video_id=manual_video_id)
            upsert_video_status(manual_video_id, "PROCESSING", 0.55)

            render_input = trimmed
            subtitles_status = "disabled"

            if caption_mode != "none" and payload.include_subtitles:
                try:
                    burn_tmp = OUTPUT_DIR / f"manual_captioned_{manual_video_id}.mp4"
                    if caption_mode == "manual":
                        mapped_captions = remap_manual_captions_from_source(payload.manual_captions or [], normalized_segments)
                        if not mapped_captions:
                            raise RuntimeError("manual_captions_empty")
                        write_manual_srt(mapped_captions, manual_subs)
                        burn_subtitles(
                            trimmed,
                            manual_subs,
                            burn_tmp,
                            trace_id=trace_id,
                            video_id=manual_video_id,
                            style_prompt=base_row["style_prompt"] or "",
                        )
                    else:
                        whisper_transcribe_to_srt(
                            trimmed,
                            auto_subs,
                            trace_id=trace_id,
                            language=(payload.subtitles_language or base_row["language"] or "pt-BR"),
                            video_id=manual_video_id,
                        )
                        burn_subtitles(
                            trimmed,
                            auto_subs,
                            burn_tmp,
                            trace_id=trace_id,
                            video_id=manual_video_id,
                            style_prompt=base_row["style_prompt"] or "",
                        )
                    render_input = burn_tmp
                    subtitles_status = "applied"
                except Exception as sub_error:
                    subtitles_status = "failed"
                    log_error(
                        trace_id,
                        "manual_subtitles",
                        "manual_subtitles_failed_fallback",
                        sub_error,
                        video_id=manual_video_id,
                        caption_mode=caption_mode,
                    )

            deliver_social(render_input, final, trace_id=trace_id, video_id=manual_video_id)
            upsert_video_status(
                manual_video_id,
                "COMPLETE",
                1.0,
                completed=True,
                output_path=final,
                subtitles_path=manual_subs if manual_subs.exists() else (auto_subs if auto_subs.exists() else None),
                pipeline_timings={
                    "segmentCount": len(normalized_segments),
                    "captionMode": caption_mode,
                    "subtitlesStatus": subtitles_status,
                },
            )
            log_event(
                "info",
                trace_id,
                "manual",
                "manual_export_complete",
                video_id=manual_video_id,
                base_video_id=video_id,
                output_path=final.as_posix(),
                output_hash=short_hash(final),
                segment_count=len(normalized_segments),
                caption_mode=caption_mode,
                subtitles_status=subtitles_status,
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


def should_track_client_incident(level: str, event_name: str) -> bool:
    if level in {"warn", "error"}:
        return True
    lowered = (event_name or "").lower()
    return "failed" in lowered or "error" in lowered


def build_client_incident_context(stage: str, event_name: str, meta: dict[str, Any], request: Request) -> dict[str, Any]:
    return {
        "stage": stage,
        "event": event_name,
        "source": meta.get("source"),
        "platform": meta.get("platform"),
        "reason": meta.get("reason"),
        "code": meta.get("code") or meta.get("error_code"),
        "video_id": meta.get("video_id"),
        "order_id": meta.get("order_id"),
        "job_id": meta.get("job_id"),
        "request_id": meta.get("request_id") or meta.get("requestId"),
        "run_id": meta.get("run_id") or meta.get("runId"),
        "path": request.url.path,
    }


@app.post("/v1/debug/client-events")
def client_events(payload: ClientEventInput, request: Request):
    request_trace = request.state.trace_id
    trace_id = (payload.trace_id or "").strip()[:120] or request_trace
    safe_level = payload.level.lower().strip()
    if safe_level not in {"info", "warn", "error"}:
        safe_level = "info"
    raw_meta = payload.meta or {}
    safe_meta_raw = redact_data(raw_meta, "meta")
    meta = safe_meta_raw if isinstance(safe_meta_raw, dict) else {"meta": safe_meta_raw}
    stage = payload.stage.strip()[:80]
    event_name = payload.event.strip()[:120]
    incident_meta = {
        "incident_fingerprint": None,
        "incident_level": 0,
        "incident_count_15m": 0,
        "incident_reset_applied": False,
    }

    if should_track_client_incident(safe_level, event_name):
        error_message = clip_text(meta.get("error") or meta.get("raw_error") or meta.get("reason") or event_name, 2500)
        error_stack = clip_text(meta.get("stack") or meta.get("error_stack") or "", 20000)
        error_type = clip_text(meta.get("error_type") or infer_error_type(error_message), 120)
        request_id = meta_lookup(meta, ["request_id", "requestId"])
        run_id = meta_lookup(meta, ["run_id", "runId", "job_id", "video_id"])
        with contextlib.suppress(Exception):
            incident_meta = incident_manager.register(
                error_type=error_type,
                message=error_message,
                stack=error_stack,
                context=build_client_incident_context(stage, event_name, meta, request),
                stage=f"client_{stage}",
                event=event_name,
                trace_id=trace_id,
                request_id=request_id,
                run_id=run_id,
            )

    log_event(
        safe_level,
        trace_id,
        f"client_{stage}",
        event_name,
        **meta,
        **incident_meta,
        client_ip=request.client.host if request.client else None,
        user_agent=(request.headers.get("user-agent", "")[:240]),
    )
    return {"ok": True}


@app.get("/internal/logs/tail")
def logs_tail(
    request: Request,
    videoId: Optional[str] = Query(default=None),
    orderId: Optional[str] = Query(default=None),
    traceId: Optional[str] = Query(default=None),
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
                if traceId and str(item.get("trace_id", "")) != str(traceId):
                    continue
                out.append(item)
        if len(out) >= limit:
            break

    log_event("info", trace_id, "logs", "tail_read", count=len(out), video_id=videoId, order_id=orderId, trace_id_filter=traceId, limit=limit)
    return {"count": len(out), "items": out}


@app.get("/internal/incidents/tail")
def incidents_tail(
    request: Request,
    limit: int = Query(default=200, ge=1, le=1000),
    fingerprint: Optional[str] = Query(default=None),
    minLevel: int = Query(default=0, ge=0, le=3),
    x_api_key: Optional[str] = Header(default=None),
):
    trace_id = request.state.trace_id
    if INTERNAL_API_KEY and x_api_key != INTERNAL_API_KEY:
        raise HTTPException(status_code=401, detail="unauthorized")

    items = incident_manager.tail(limit=limit, fingerprint=fingerprint, min_level=minLevel)
    log_event(
        "info",
        trace_id,
        "incidents",
        "tail_read",
        count=len(items),
        limit=limit,
        fingerprint=fingerprint,
        min_level=minLevel,
    )
    return {"count": len(items), "items": items}


@app.exception_handler(HTTPException)
async def http_exc(_request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


app.mount("/media/storage/output", StaticFiles(directory=OUTPUT_DIR.as_posix()), name="output-media")
app.mount("/editor", StaticFiles(directory=EDITOR_DIR.as_posix(), html=True), name="editor-web")
