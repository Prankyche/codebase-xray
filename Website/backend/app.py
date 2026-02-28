from __future__ import annotations

import os
import zipfile
import tempfile
import shutil
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from analyzer.orchestrator import analyze_repo, analyze_local

app = FastAPI(title="Code Landscape Viewer")

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

class AnalyzeRequest(BaseModel):
    repo_url: str
    token: str | None = None


class AIRequest(BaseModel):
    prompt: str
    api_key: str


@app.get("/")
async def index():
    return FileResponse(str(FRONTEND_DIR / "index.html"))


@app.get("/landing")
async def landing():
    return FileResponse(str(FRONTEND_DIR / "landing.html"))


@app.get("/api/status")
async def status():
    return {"status": "ok"}


@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest):
    """Analyze a public GitHub repo by URL."""
    repo_url = req.repo_url.strip()
    if not repo_url:
        raise HTTPException(status_code=400, detail="repo_url is required")

    if "github.com" not in repo_url:
        raise HTTPException(status_code=400, detail="Only GitHub URLs are supported")

    try:
        result = await analyze_repo(repo_url, token=req.token or None)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return result


@app.post("/api/analyze-zip")
async def analyze_zip(zip_file: UploadFile = File(...)):
    """Analyze a repo uploaded as a .zip file."""
    if not zip_file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only .zip files are supported")

    tmpdir = tempfile.mkdtemp()
    try:
        zip_path = os.path.join(tmpdir, "upload.zip")
        content = await zip_file.read()
        with open(zip_path, "wb") as f:
            f.write(content)

        try:
            with zipfile.ZipFile(zip_path, "r") as z:
                z.extractall(tmpdir)
        except zipfile.BadZipFile:
            raise HTTPException(status_code=400, detail="Invalid or corrupted zip file")

        extracted = next(
            (p for p in Path(tmpdir).iterdir() if p.is_dir() and p.name not in ("__MACOSX",)),
            Path(tmpdir),
        )

        result = await run_in_threadpool(analyze_local, str(extracted))
        result["repo_name"] = Path(zip_file.filename).stem
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    return result


@app.post("/api/ai/ask")
async def ai_ask(req: AIRequest):
    """Send a prompt to a local Ollama model and return the response."""
    if not req.prompt or len(req.prompt) > 12000:
        raise HTTPException(status_code=400, detail="Prompt must be non-empty and under 12000 chars")

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{req.ollama_url}/api/generate",
                json={
                    "model": req.model,
                    "prompt": req.prompt,
                    "stream": False,
                    "options": {"temperature": 0.3, "num_predict": 1024},
                },
            )
    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail=f"Cannot reach Ollama at {req.ollama_url}. Make sure 'ollama serve' is running."
        )
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Ollama timed out. Try a smaller model or shorter prompt.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Ollama error: {resp.text[:200]}")

    data = resp.json()
    return {"result": data.get("response", "")}


app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
