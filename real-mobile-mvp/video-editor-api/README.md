# video-editor-api

Servico de edicao de video com FastAPI + FFmpeg + Whisper local.

## Rodar local

```bash
cd video-editor-api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn src.main:app --host 0.0.0.0 --port 8081 --reload
```

## Endpoints principais

- `POST /v1/videos/edits`
- `POST /v1/videos/captions`
- `GET /v1/videos/{id}`
- `GET /v1/videos/{id}/content`
- `POST /v1/videos/{id}/editor-session`
- `POST /v1/videos/{id}/manual-export`
- Compat worker: `/jobs/auto-edit`, `/jobs/subtitles/generate`, `/jobs/subtitles/burn`, `/jobs/deliver`, `/jobs/{id}`
- Logs: `GET /internal/logs/tail`

## Logs

JSONL em `storage/logs/video-editor-api-YYYY-MM-DD.jsonl`.
