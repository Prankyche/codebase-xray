from __future__ import annotations

import base64
from typing import AsyncIterator

import httpx


BINARY_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico",
    ".woff", ".woff2", ".ttf", ".eot",
    ".zip", ".tar", ".gz", ".bz2", ".rar", ".7z",
    ".exe", ".dll", ".so", ".dylib",
    ".pyc", ".pyo", ".class",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".mp3", ".mp4", ".avi", ".mov", ".wav",
    ".db", ".sqlite", ".sqlite3",
    ".lock",
}

SKIP_DIRS = {
    ".git", ".hg", ".svn", "__pycache__", "node_modules",
    ".tox", ".mypy_cache", ".pytest_cache", ".ruff_cache",
    "dist", "build", ".eggs", ".venv", "venv", "env", ".env",
    ".idea", ".vscode", ".cursor", "coverage", ".next", ".nuxt",
}


class GitHubClient:
    def __init__(self, token: str | None = None):
        headers = {"Accept": "application/vnd.github+json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self._client = httpx.AsyncClient(
            base_url="https://api.github.com",
            headers=headers,
            timeout=30,
        )

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self._client.aclose()

    async def get_default_branch(self, owner: str, repo: str) -> str:
        r = await self._client.get(f"/repos/{owner}/{repo}")
        r.raise_for_status()
        return r.json()["default_branch"]

    async def get_tree(self, owner: str, repo: str, branch: str) -> list[dict]:
        """Fetch the full recursive file tree in a single API call."""
        r = await self._client.get(
            f"/repos/{owner}/{repo}/git/trees/{branch}",
            params={"recursive": "1"},
        )
        r.raise_for_status()
        data = r.json()
        return [item for item in data["tree"] if item["type"] == "blob"]

    async def get_file_content(self, owner: str, repo: str, path: str) -> str | None:
        """Fetch a single file's content. Returns decoded text or None on failure."""
        r = await self._client.get(f"/repos/{owner}/{repo}/contents/{path}")
        if r.status_code != 200:
            return None
        data = r.json()
        if data.get("encoding") != "base64":
            return None
        try:
            return base64.b64decode(data["content"]).decode("utf-8", errors="ignore")
        except Exception:
            return None

    async def fetch_files(
        self,
        owner: str,
        repo: str,
        tree_items: list[dict],
        max_size: int = 200_000,
    ) -> AsyncIterator[dict]:
        """
        Yield file info dicts (compatible with existing analyzers) for each
        relevant file in the tree, fetching content from the API.
        """
        for item in tree_items:
            path = item["path"]
            size = item.get("size", 0)

            # Skip oversized files
            if size > max_size:
                continue

            # Derive name and extension
            name = path.split("/")[-1]
            ext = ("." + name.rsplit(".", 1)[-1]).lower() if "." in name else ""

            # Skip binary files
            if ext in BINARY_EXTENSIONS:
                continue

            # Skip files inside ignored directories
            parts = path.split("/")
            if any(p in SKIP_DIRS or p.startswith(".") for p in parts[:-1]):
                continue

            content = await self.get_file_content(owner, repo, path)
            if content is None:
                continue

            yield {
                "rel_path": path,
                "name": name,
                "ext": ext,
                "full_path": None,   # not on disk — analyzers must use "content"
                "content": content,
            }