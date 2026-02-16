#!/usr/bin/env python3
import argparse
import html
import json
import math
import os
import re
import shutil
import subprocess
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

CODEX_ARCHIVE_DIR = Path.home() / ".codex" / "archived_sessions"
ZSH_HISTORY = Path.home() / ".zsh_history"
WA_BRIDGE_CLI = Path.home() / ".codex" / "skills" / "whatsapp-bridge-ops" / "scripts" / "wa_bridge.py"
PIPER_TTS = Path("/Users/renandiasoliveira/Desktop/keennocodex/scripts/tts_piper_local.py")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


def to_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def shannon_entropy(s: str) -> float:
    if not s:
        return 0.0
    freq = Counter(s)
    length = len(s)
    return -sum((count / length) * math.log2(count / length) for count in freq.values())


def redact_sensitive(text: str) -> str:
    if not text:
        return text
    out = text
    patterns = [
        (r"\bEAA[A-Za-z0-9]+\b", "[REDACTED_META_TOKEN]"),
        (r"\bsk_[A-Za-z0-9]{20,}\b", "[REDACTED_API_KEY]"),
        (r"\bAKIA[0-9A-Z]{16}\b", "[REDACTED_AWS_KEY]"),
        (r"(?i)authorization\s*:\s*bearer\s+[A-Za-z0-9._\-]+", "authorization: bearer [REDACTED]"),
        (r"(?i)(password|passwd|token|secret|api[_-]?key)\s*[=:]\s*[^\s,;]+", r"\1=[REDACTED]"),
    ]
    for pattern, repl in patterns:
        out = re.sub(pattern, repl, out)

    def _mask_long_token(match: re.Match[str]) -> str:
        token = match.group(0)
        if len(token) >= 32 and shannon_entropy(token) >= 3.5:
            return token[:4] + "...[REDACTED]"
        return token

    out = re.sub(r"\b[A-Za-z0-9_\-]{32,}\b", _mask_long_token, out)
    return out


def run_cmd(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, text=True, capture_output=True, check=check)


def parse_jsonl_window(since_dt: datetime, until_dt: datetime) -> dict[str, Any]:
    sessions: dict[str, dict[str, Any]] = {}
    user_messages: list[str] = []
    turn_aborted = 0
    cwd_counter: Counter[str] = Counter()

    files = sorted(CODEX_ARCHIVE_DIR.glob("*.jsonl"), key=lambda p: p.stat().st_mtime)
    for file in files:
        try:
            with file.open("r", encoding="utf-8", errors="ignore") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    ts = parse_iso(obj.get("timestamp"))
                    if ts is None or ts < since_dt or ts > until_dt:
                        continue

                    item_type = obj.get("type")
                    payload = obj.get("payload") if isinstance(obj.get("payload"), dict) else {}

                    if item_type == "session_meta":
                        sid = str(payload.get("id") or "")
                        cwd = str(payload.get("cwd") or "")
                        if sid:
                            sessions[sid] = {"cwd": cwd}
                        if cwd:
                            cwd_counter[cwd] += 1

                    if item_type == "event_msg":
                        ptype = payload.get("type")
                        if ptype == "turn_aborted":
                            turn_aborted += 1
                        if ptype == "user_message":
                            msg = str(payload.get("message") or "").strip()
                            if msg:
                                user_messages.append(redact_sensitive(msg))
    
        except OSError:
            continue

    context_switches = max(0, len(cwd_counter) - 1)
    return {
        "sessions": sessions,
        "user_messages": user_messages,
        "turn_aborted": turn_aborted,
        "cwd_counter": cwd_counter,
        "context_switches": context_switches,
    }


def parse_zsh_history(since_dt: datetime, until_dt: datetime) -> dict[str, Any]:
    commands: list[str] = []
    timed_commands: list[tuple[datetime, str]] = []
    if not ZSH_HISTORY.exists():
        return {"commands": commands, "timed_commands": timed_commands}

    pattern = re.compile(r"^: (\d+):\d+;(.*)$")
    with ZSH_HISTORY.open("r", encoding="utf-8", errors="ignore") as fh:
        for raw in fh:
            raw = raw.rstrip("\n")
            m = pattern.match(raw)
            if not m:
                continue
            epoch = int(m.group(1))
            cmd = m.group(2).strip()
            dt = datetime.fromtimestamp(epoch, tz=timezone.utc)
            if since_dt <= dt <= until_dt and cmd:
                cmd_red = redact_sensitive(cmd)
                commands.append(cmd_red)
                timed_commands.append((dt, cmd_red))

    return {"commands": commands, "timed_commands": timed_commands}


def detect_repeated_chains(commands: list[str]) -> list[dict[str, Any]]:
    base = [c.split()[0] for c in commands if c]
    pair_counter: Counter[str] = Counter()
    for i in range(len(base) - 1):
        pair = f"{base[i]} -> {base[i+1]}"
        pair_counter[pair] += 1
    return [{"chain": k, "count": v} for k, v in pair_counter.most_common(8) if v > 1]


def top_recent_files(cwds: list[str], since_dt: datetime, until_dt: datetime) -> dict[str, Any]:
    recent_files: list[str] = []
    ext_counter: Counter[str] = Counter()
    ignored = {".git", "node_modules", ".venv", "venv", "dist", "build", "__pycache__"}
    since_ts = since_dt.timestamp()
    until_ts = until_dt.timestamp()

    for cwd in cwds[:5]:
        root = Path(cwd)
        if not root.exists() or not root.is_dir():
            continue
        scanned = 0
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in ignored]
            for filename in filenames:
                scanned += 1
                if scanned > 2500:
                    break
                path = Path(dirpath) / filename
                try:
                    mtime = path.stat().st_mtime
                except OSError:
                    continue
                if since_ts <= mtime <= until_ts:
                    recent_files.append(str(path))
                    ext = path.suffix.lower() or "[noext]"
                    ext_counter[ext] += 1
            if scanned > 2500:
                break

    return {
        "recent_files": sorted(recent_files)[:60],
        "top_extensions": ext_counter.most_common(10),
    }


def detect_themes(messages: list[str], commands: list[str]) -> Counter[str]:
    text = "\n".join(messages + commands).lower()
    keywords = {
        "sales": ["venda", "dm", "checkout", "oferta", "receita", "cliente"],
        "automation": ["automacao", "automation", "agente", "cron", "recorrente"],
        "infra": ["docker", "deploy", "server", "ssh", "cloud"],
        "content": ["post", "video", "imagem", "social", "whatsapp"],
        "coding": ["python", "node", "typescript", "bug", "teste"],
        "finance": ["ads", "meta", "campanha", "roas", "cpl", "cpa"],
    }
    counts: Counter[str] = Counter()
    for theme, words in keywords.items():
        counts[theme] = sum(text.count(w) for w in words)
    return counts


@dataclass
class Recommendation:
    type: str
    title: str
    money_score: float
    execution_score: float
    life_score: float
    effort_score: float
    evidence: list[str]
    next_step: str

    @property
    def score(self) -> float:
        raw = 0.30 * self.money_score + 0.30 * self.execution_score + 0.20 * self.life_score + 0.20 * (100.0 - self.effort_score)
        return round(raw, 2)


def build_recommendations(
    codex_data: dict[str, Any],
    hist_data: dict[str, Any],
    chain_data: list[dict[str, Any]],
    file_data: dict[str, Any],
    themes: Counter[str],
) -> list[Recommendation]:
    sessions_count = len(codex_data["sessions"])
    cmd_count = len(hist_data["commands"])
    aborted = codex_data["turn_aborted"]
    context_switches = codex_data["context_switches"]
    repeated = sum(c["count"] for c in chain_data)

    top_ext = ", ".join(f"{ext} ({count})" for ext, count in file_data["top_extensions"][:4]) or "none"
    top_chains = ", ".join(f"{c['chain']} x{c['count']}" for c in chain_data[:3]) or "none"

    recs: list[Recommendation] = []

    recs.append(
        Recommendation(
            type="automation",
            title="Automation: Command Chain Runner",
            money_score=min(90, 55 + repeated * 2),
            execution_score=min(96, 60 + repeated * 3),
            life_score=min(92, 50 + repeated * 2),
            effort_score=35,
            evidence=[
                f"Repeated command chains detected: {top_chains}",
                f"Commands in window: {cmd_count}",
            ],
            next_step="Create a reusable runner that batches the top 3 command chains behind one CLI.",
        )
    )

    recs.append(
        Recommendation(
            type="skill",
            title="Skill: Prompt-to-Execution Preflight",
            money_score=min(86, 50 + aborted * 8),
            execution_score=min(95, 58 + aborted * 10),
            life_score=min(80, 45 + aborted * 6),
            effort_score=28,
            evidence=[
                f"Aborted turns detected: {aborted}",
                f"Sessions in window: {sessions_count}",
            ],
            next_step="Create a skill that checks clarity, dependencies, and acceptance criteria before long runs.",
        )
    )

    recs.append(
        Recommendation(
            type="automation",
            title="Automation: Workspace Context Switch Guard",
            money_score=min(84, 45 + context_switches * 8),
            execution_score=min(94, 58 + context_switches * 8),
            life_score=min(90, 52 + context_switches * 6),
            effort_score=32,
            evidence=[
                f"Context switches (cwd changes): {context_switches}",
                f"Most active workspaces: {', '.join(list(codex_data['cwd_counter'].keys())[:3]) or 'none'}",
            ],
            next_step="Trigger a focus recommendation when >3 context switches happen inside the same window.",
        )
    )

    recs.append(
        Recommendation(
            type="skill",
            title="Skill: Revenue Experiment Tracker",
            money_score=min(95, 60 + themes["sales"] * 6 + themes["finance"] * 4),
            execution_score=min(90, 52 + themes["sales"] * 4),
            life_score=min(76, 42 + themes["sales"] * 3),
            effort_score=38,
            evidence=[
                f"Sales/finance theme hits: sales={themes['sales']}, finance={themes['finance']}",
                f"Recent file types: {top_ext}",
            ],
            next_step="Track each experiment with expected ROI, owner, and deadline, and auto-rank next actions.",
        )
    )

    recs.append(
        Recommendation(
            type="automation",
            title="Automation: WhatsApp Outcome Broadcast",
            money_score=min(88, 50 + themes["content"] * 5),
            execution_score=min(92, 55 + themes["content"] * 4),
            life_score=min(88, 50 + themes["content"] * 4),
            effort_score=30,
            evidence=[
                f"Content/WhatsApp theme hits: {themes['content']}",
                "Delivery channel preference is WhatsApp control chat.",
            ],
            next_step="Publish daily wins/blockers to WhatsApp with one-click suggested next actions.",
        )
    )

    recs.append(
        Recommendation(
            type="skill",
            title="Skill: Local Artifact Packaging",
            money_score=min(75, 45 + len(file_data["recent_files"]) // 8),
            execution_score=min(90, 55 + len(file_data["recent_files"]) // 8),
            life_score=min(85, 50 + len(file_data["recent_files"]) // 10),
            effort_score=22,
            evidence=[
                f"Recent files touched in active cwds: {len(file_data['recent_files'])}",
                f"Top extensions: {top_ext}",
            ],
            next_step="Package run outputs into standardized folders with latest pointers and changelog.",
        )
    )

    recs.sort(key=lambda r: r.score, reverse=True)
    return recs


def write_dashboard_files(run_dir: Path, payload: dict[str, Any]) -> None:
    embedded_json = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")
    index_html = """<!doctype html>
<html lang=\"en\">
  <head>
    <meta charset=\"UTF-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />
    <title>Skill Radar</title>
    <link rel=\"stylesheet\" href=\"styles.css\" />
  </head>
  <body>
    <main class=\"wrap\">
      <header>
        <h1>Skill & Automation Radar</h1>
        <p id=\"window\"></p>
      </header>
      <section class=\"kpis\" id=\"kpis\"></section>
      <section>
        <h2>Top Recommendations</h2>
        <div id=\"cards\" class=\"cards\"></div>
      </section>
    </main>
    <script id=\"radar-data\" type=\"application/json\">__EMBEDDED_JSON__</script>
    <script src=\"app.js\"></script>
  </body>
</html>
"""
    styles_css = """:root {
  --bg: #f4f7f9;
  --panel: #ffffff;
  --ink: #102a43;
  --muted: #486581;
  --accent: #0e7490;
  --ok: #1f9d55;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Avenir Next", "Trebuchet MS", sans-serif;
  background: radial-gradient(circle at top right, #d9f1f5, var(--bg));
  color: var(--ink);
}
.wrap { max-width: 1080px; margin: 0 auto; padding: 24px; }
header h1 { margin: 0 0 8px 0; letter-spacing: 0.2px; }
header p { margin: 0; color: var(--muted); }
.kpis {
  margin: 20px 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}
.kpi, .card {
  background: var(--panel);
  border-radius: 14px;
  padding: 14px;
  box-shadow: 0 8px 30px rgba(16, 42, 67, 0.08);
}
.kpi strong { display: block; font-size: 24px; color: var(--accent); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
.card h3 { margin: 0 0 6px 0; font-size: 16px; }
.badge { display: inline-block; padding: 3px 8px; border-radius: 20px; background: #e2f7fb; color: var(--accent); font-size: 12px; }
.score { font-size: 20px; color: var(--ok); font-weight: 700; margin: 10px 0; }
ul { margin: 0; padding-left: 18px; color: var(--muted); }
.next { margin-top: 10px; font-size: 13px; color: var(--ink); }
@media (max-width: 640px) {
  .wrap { padding: 14px; }
}
"""
    app_js = """async function loadData() {
  const embedded = document.getElementById('radar-data');
  if (embedded && embedded.textContent && embedded.textContent.trim()) {
    return JSON.parse(embedded.textContent);
  }
  const res = await fetch('insights.json');
  return await res.json();
}

async function main() {
  const data = await loadData();

  document.getElementById('window').textContent =
    `Run ${data.run_id} | ${data.window.start} -> ${data.window.end}`;

  const kpis = [
    ['Sessions', data.kpis.sessions],
    ['Turn Aborted', data.kpis.turn_aborted],
    ['Commands', data.kpis.commands],
    ['Repeated Chains', data.kpis.repeated_command_chains],
    ['Context Switches', data.kpis.context_switches],
  ];

  const kpiNode = document.getElementById('kpis');
  for (const [label, value] of kpis) {
    const el = document.createElement('article');
    el.className = 'kpi';
    el.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    kpiNode.appendChild(el);
  }

  const cards = document.getElementById('cards');
  for (const rec of data.recommendations) {
    const card = document.createElement('article');
    card.className = 'card';
    const evidence = rec.evidence.map((e) => `<li>${e}</li>`).join('');
    card.innerHTML = `
      <span class='badge'>${rec.type}</span>
      <h3>${rec.title}</h3>
      <div class='score'>Score ${rec.score}</div>
      <ul>${evidence}</ul>
      <p class='next'><strong>Next:</strong> ${rec.next_step}</p>
    `;
    cards.appendChild(card);
  }
}

main();
"""
    index_html = index_html.replace("__EMBEDDED_JSON__", embedded_json)
    (run_dir / "index.html").write_text(index_html, encoding="utf-8")
    (run_dir / "styles.css").write_text(styles_css, encoding="utf-8")
    (run_dir / "app.js").write_text(app_js, encoding="utf-8")

    kpis = payload.get("kpis", {})
    recs = payload.get("recommendations", [])
    kpi_html = "".join(
        f"<article class='kpi'><span>{html.escape(label)}</span><strong>{html.escape(str(value))}</strong></article>"
        for label, value in [
            ("Sessions", kpis.get("sessions", 0)),
            ("Turn Aborted", kpis.get("turn_aborted", 0)),
            ("Commands", kpis.get("commands", 0)),
            ("Repeated Chains", kpis.get("repeated_command_chains", 0)),
            ("Context Switches", kpis.get("context_switches", 0)),
        ]
    )
    cards_html = ""
    for rec in recs:
        evidence_html = "".join(f"<li>{html.escape(str(item))}</li>" for item in rec.get("evidence", []))
        cards_html += (
            "<article class='card'>"
            f"<span class='badge'>{html.escape(str(rec.get('type', '')))}</span>"
            f"<h3>{html.escape(str(rec.get('title', '')))}</h3>"
            f"<div class='score'>Score {html.escape(str(rec.get('score', '')))}</div>"
            f"<ul>{evidence_html}</ul>"
            f"<p class='next'><strong>Next:</strong> {html.escape(str(rec.get('next_step', '')))}</p>"
            "</article>"
        )

    standalone_html = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Skill Radar</title>
    <style>{styles_css}</style>
  </head>
  <body>
    <main class="wrap">
      <header>
        <h1>Skill & Automation Radar</h1>
        <p>Run {html.escape(str(payload.get("run_id", "")))} | {html.escape(str(payload.get("window", {}).get("start", "")))} -&gt; {html.escape(str(payload.get("window", {}).get("end", "")))}</p>
      </header>
      <section class="kpis">{kpi_html}</section>
      <section>
        <h2>Top Recommendations</h2>
        <div class="cards">{cards_html}</div>
      </section>
    </main>
  </body>
</html>
"""
    (run_dir / "dashboard_share.html").write_text(standalone_html, encoding="utf-8")


def render_screenshot(run_dir: Path) -> Path | None:
    output = run_dir / "dashboard.png"
    index_file = run_dir / "index.html"
    cmd = [
        "npx",
        "--yes",
        "playwright",
        "screenshot",
        "--viewport-size=1366,900",
        index_file.as_uri(),
        str(output),
    ]
    try:
        run_cmd(cmd, check=True)
        return output
    except Exception:
        return None


def render_audio(run_dir: Path, text: str) -> Path | None:
    output = run_dir / "dashboard.opus"
    text_file = run_dir / "summary.txt"
    text_file.write_text(text, encoding="utf-8")
    if not PIPER_TTS.exists():
        return None
    try:
        run_cmd(["python3", str(PIPER_TTS), "--text-file", str(text_file), "--out", str(output)], check=True)
        return output if output.exists() else None
    except Exception:
        return None


def render_video(run_dir: Path, image_path: Path | None, audio_path: Path | None) -> Path | None:
    if image_path is None or audio_path is None:
        return None
    output = run_dir / "dashboard.mp4"
    cmd = [
        "ffmpeg",
        "-y",
        "-loop",
        "1",
        "-i",
        str(image_path),
        "-i",
        str(audio_path),
        "-c:v",
        "libx264",
        "-tune",
        "stillimage",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-shortest",
        str(output),
    ]
    try:
        run_cmd(cmd, check=True)
        return output if output.exists() else None
    except Exception:
        return None


def send_whatsapp(
    remote_jid: str,
    text_summary: str,
    html_file: Path,
    image_path: Path | None,
    audio_path: Path | None,
    video_path: Path | None,
    send_audio: bool,
    send_html_document: bool,
    send_media: bool,
    run_dir: Path,
) -> dict[str, Any]:
    status: dict[str, Any] = {"text": False}
    if send_audio:
        status["audio"] = False
    if send_html_document:
        status["document"] = False
    if send_media:
        status["image"] = False
        status["video"] = False

    def _exec(args: list[str], require_delivered: bool = False) -> tuple[bool, str]:
        cp = run_cmd(["python3", str(WA_BRIDGE_CLI)] + args, check=False)
        ok = cp.returncode == 0 and "\"ok\": true" in (cp.stdout or "")
        raw = (cp.stdout + "\n" + cp.stderr).strip()
        if ok and require_delivered:
            delivered = False
            for line in (cp.stdout or "").splitlines()[::-1]:
                line = line.strip()
                if not line.startswith("{"):
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                delivered = bool(obj.get("delivered_to_bridge"))
                break
            ok = ok and delivered
        return ok, raw

    ok_text, out_text = _exec(["send", "--remote-jid", remote_jid, "--text", text_summary], require_delivered=True)
    status["text"] = ok_text
    logs: list[str] = [f"TEXT: {out_text}"]

    if send_audio and audio_path:
        ok_audio, out_audio = _exec([
            "send-audio",
            "--remote-jid",
            remote_jid,
            "--file",
            str(audio_path),
            "--mimetype",
            "audio/ogg; codecs=opus",
            "--ptt",
            "1",
            "--timeout-ms",
            "60000",
        ], require_delivered=True)
        status["audio"] = ok_audio
        logs.append(f"AUDIO: {out_audio}")

    if send_html_document:
        ok_doc, out_doc = _exec([
            "send-document",
            "--remote-jid",
            remote_jid,
            "--file",
            str(html_file),
            "--mimetype",
            "text/html",
            "--caption",
            "Keen: Dashboard HTML do ciclo",
            "--timeout-ms",
            "120000",
        ], require_delivered=True)
        status["document"] = ok_doc
        logs.append(f"DOCUMENT: {out_doc}")

    if send_media and image_path:
        ok_img, out_img = _exec([
            "send-image",
            "--remote-jid",
            remote_jid,
            "--file",
            str(image_path),
            "--mimetype",
            "image/png",
            "--caption",
            "Keen: Dashboard visual do ciclo",
            "--timeout-ms",
            "120000",
        ], require_delivered=True)
        status["image"] = ok_img
        logs.append(f"IMAGE: {out_img}")

    if send_media and video_path:
        ok_video, out_video = _exec([
            "send-video",
            "--remote-jid",
            remote_jid,
            "--file",
            str(video_path),
            "--mimetype",
            "video/mp4",
            "--caption",
            "Keen: Resumo em video do ciclo",
            "--timeout-ms",
            "180000",
        ], require_delivered=True)
        status["video"] = ok_video
        logs.append(f"VIDEO: {out_video}")

    if not all(status.values()):
        fallback_msg = "Keen: Ciclo executado com falha parcial de midia. Veja inbox_summary.md para detalhes objetivos."
        ok_fb, out_fb = _exec(["send", "--remote-jid", remote_jid, "--text", fallback_msg])
        logs.append(f"FALLBACK: {out_fb}")
        status["fallback"] = ok_fb

    (run_dir / "whatsapp_delivery.log").write_text("\n\n".join(logs), encoding="utf-8")
    return status


def copy_latest(run_dir: Path, latest_dir: Path) -> None:
    if latest_dir.exists():
        shutil.rmtree(latest_dir)
    shutil.copytree(run_dir, latest_dir)


def load_state(state_file: Path) -> dict[str, Any]:
    if not state_file.exists():
        return {}
    try:
        return json.loads(state_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def save_state(state_file: Path, data: dict[str, Any]) -> None:
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Skill & Automation Radar runner")
    parser.add_argument("--since-state", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--fallback-hours", type=int, default=24)
    parser.add_argument("--top", type=int, default=5)
    parser.add_argument("--send-whatsapp", action=argparse.BooleanOptionalAction, default=False)
    parser.add_argument("--send-audio", action=argparse.BooleanOptionalAction, default=False)
    parser.add_argument("--send-html-document", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--send-media", action=argparse.BooleanOptionalAction, default=False)
    parser.add_argument("--remote-jid", type=str, default="5517996533627@s.whatsapp.net")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("/Users/renandiasoliveira/Desktop/real/reports/skill_radar"),
    )
    args = parser.parse_args()

    output_dir: Path = args.output_dir
    runs_dir = output_dir / "runs"
    latest_dir = output_dir / "latest"
    state_file = output_dir / "state.json"

    output_dir.mkdir(parents=True, exist_ok=True)
    runs_dir.mkdir(parents=True, exist_ok=True)

    now_dt = now_utc()
    state = load_state(state_file)
    since_dt = now_dt - timedelta(hours=args.fallback_hours)
    if args.since_state and state.get("last_success_at"):
        parsed = parse_iso(str(state["last_success_at"]))
        if parsed is not None:
            since_dt = parsed

    run_id = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir = runs_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=False)

    codex_data = parse_jsonl_window(since_dt=since_dt, until_dt=now_dt)
    hist_data = parse_zsh_history(since_dt=since_dt, until_dt=now_dt)
    chains = detect_repeated_chains(hist_data["commands"])
    top_cwds = [cwd for cwd, _ in codex_data["cwd_counter"].most_common(8)]
    file_data = top_recent_files(top_cwds, since_dt=since_dt, until_dt=now_dt)
    themes = detect_themes(codex_data["user_messages"], hist_data["commands"])

    recommendations = build_recommendations(codex_data, hist_data, chains, file_data, themes)
    recommendations = recommendations[: max(1, args.top)]

    payload = {
        "run_id": run_id,
        "window": {"start": to_iso(since_dt), "end": to_iso(now_dt)},
        "kpis": {
            "sessions": len(codex_data["sessions"]),
            "turn_aborted": codex_data["turn_aborted"],
            "commands": len(hist_data["commands"]),
            "repeated_command_chains": sum(c["count"] for c in chains),
            "context_switches": codex_data["context_switches"],
        },
        "recommendations": [
            {
                "type": rec.type,
                "title": rec.title,
                "score": rec.score,
                "money_score": round(rec.money_score, 2),
                "execution_score": round(rec.execution_score, 2),
                "life_score": round(rec.life_score, 2),
                "effort_score": round(rec.effort_score, 2),
                "evidence": [redact_sensitive(e) for e in rec.evidence],
                "next_step": redact_sensitive(rec.next_step),
            }
            for rec in recommendations
        ],
    }

    insights_file = run_dir / "insights.json"
    insights_file.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    write_dashboard_files(run_dir, payload)

    summary_lines = [
        f"Keen: Skill Radar {run_id}",
        f"Janela: {payload['window']['start']} -> {payload['window']['end']}",
        "Top 3 recomendacoes:",
    ]
    for i, rec in enumerate(payload["recommendations"][:3], start=1):
        summary_lines.append(f"{i}. [{rec['type']}] {rec['title']} (score {rec['score']})")
    summary_lines.append(f"Dashboard: {run_dir / 'index.html'}")
    summary_text = "\n".join(summary_lines)

    (run_dir / "inbox_summary.md").write_text(
        summary_text
        + "\n\nAcoes:\n"
        + "\n".join(f"- {rec['next_step']}" for rec in payload["recommendations"][:3]),
        encoding="utf-8",
    )

    audio_path: Path | None = None
    if args.send_audio:
        audio_path = render_audio(run_dir, summary_text)
    image_path: Path | None = None
    video_path: Path | None = None
    if args.send_media:
        image_path = render_screenshot(run_dir)
        video_path = render_video(run_dir, image_path, audio_path)

    wa_status: dict[str, Any] = {}
    if args.send_whatsapp:
        wa_status = send_whatsapp(
            remote_jid=args.remote_jid,
            text_summary=summary_text,
            html_file=run_dir / "dashboard_share.html",
            image_path=image_path,
            audio_path=audio_path,
            video_path=video_path,
            send_audio=args.send_audio,
            send_html_document=args.send_html_document,
            send_media=args.send_media,
            run_dir=run_dir,
        )

    copy_latest(run_dir, latest_dir)

    save_state(
        state_file,
        {
            "last_success_at": to_iso(now_dt),
            "last_run_id": run_id,
            "last_run_dir": str(run_dir),
            "last_whatsapp_status": wa_status,
        },
    )

    print(json.dumps({
        "ok": True,
        "run_id": run_id,
        "run_dir": str(run_dir),
        "latest_dir": str(latest_dir),
        "whatsapp": wa_status,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
