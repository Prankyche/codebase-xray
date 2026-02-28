from __future__ import annotations

from .graph import Graph
from analyzer.github_client import GitHubClient

PYTHON_EXTENSIONS = {".py", ".pyi"}
JS_EXTENSIONS = {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"}
JAVA_EXTENSIONS = {".java"}



def parse_github_url(url: str) -> tuple[str, str]:
    url = url.rstrip("/").removesuffix(".git")
    parts = url.split("/")
    if len(parts) < 5 or "github.com" not in parts[2]:
        raise ValueError("Invalid GitHub URL. Expected: https://github.com/owner/repo")
    return parts[3], parts[4]


async def analyze_repo(repo_url: str, token: str | None = None) -> dict:
    from .python_analyzer import PythonAnalyzer
    from .js_analyzer import JsAnalyzer
    from .generic_analyzer import GenericAnalyzer
    from .java_analyzer import JavaAnalyzer


    owner, repo = parse_github_url(repo_url)

    async with GitHubClient(token=token) as client:
        branch = await client.get_default_branch(owner, repo)
        tree = await client.get_tree(owner, repo, branch)

        files: list[dict] = []
        async for file_info in client.fetch_files(owner, repo, tree):
            files.append(file_info)

    graph = Graph()

    python_files = [f for f in files if f["ext"] in PYTHON_EXTENSIONS]
    js_files = [f for f in files if f["ext"] in JS_EXTENSIONS]
    java_files   = [f for f in files if f["ext"] in JAVA_EXTENSIONS]


    generic = GenericAnalyzer()
    for f in files:
        generic.analyze_file(f, graph)

    if python_files:
        py_analyzer = PythonAnalyzer()
        for f in python_files:
            py_analyzer.analyze_file(f, graph)
        py_analyzer.resolve_imports(python_files, graph)

    if js_files:
        js_analyzer = JsAnalyzer()
        for f in js_files:
            js_analyzer.analyze_file(f, graph)
        js_analyzer.resolve_imports(js_files, graph)
    
    if java_files:
        java_analyzer = JavaAnalyzer()
        for f in java_files:
            java_analyzer.analyze_file(f, graph)
        java_analyzer.resolve_imports(java_files, graph)

    graph.resolve_edges()
    result = graph.to_dict()
    result["repo_name"] = repo
    return result

def analyze_local(repo_path: str) -> dict:
    """Analyze a local directory (used for zip uploads)."""
    import os
    from pathlib import Path as _Path
    from .python_analyzer import PythonAnalyzer
    from .js_analyzer import JsAnalyzer
    from .java_analyzer import JavaAnalyzer
    from .generic_analyzer import GenericAnalyzer
    from .github_client import BINARY_EXTENSIONS, SKIP_DIRS

    root = _Path(repo_path).resolve()
    files = []

    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = _Path(dirpath).relative_to(root)
        dirnames[:] = [
            d for d in dirnames
            if d not in SKIP_DIRS and not d.startswith(".")
        ]
        for fname in filenames:
            ext = ("." + fname.rsplit(".", 1)[-1]).lower() if "." in fname else ""
            if ext in BINARY_EXTENSIONS:
                continue
            rel_path = str(rel_dir / fname).replace("\\", "/")
            if rel_path.startswith("./"):
                rel_path = rel_path[2:]
            full_path = str(_Path(dirpath) / fname)
            files.append({
                "full_path": full_path,
                "rel_path": rel_path,
                "name": fname,
                "ext": ext,
                "content": None,  # analyzers will read from disk
            })

    graph = Graph()
    python_files = [f for f in files if f["ext"] in PYTHON_EXTENSIONS]
    js_files     = [f for f in files if f["ext"] in JS_EXTENSIONS]
    java_files   = [f for f in files if f["ext"] in JAVA_EXTENSIONS]

    generic = GenericAnalyzer()
    for f in files:
        generic.analyze_file(f, graph)

    if python_files:
        py = PythonAnalyzer()
        for f in python_files:
            py.analyze_file(f, graph)
        py.resolve_imports(python_files, graph)

    if js_files:
        js = JsAnalyzer()
        for f in js_files:
            js.analyze_file(f, graph)
        js.resolve_imports(js_files, graph)

    if java_files:
        jv = JavaAnalyzer()
        for f in java_files:
            jv.analyze_file(f, graph)
        jv.resolve_imports(java_files, graph)

    graph.resolve_edges()
    result = graph.to_dict()
    result["repo_name"] = root.name
    return result

# from __future__ import annotations

# import os
# from pathlib import Path

# import pathspec

# from .graph import Graph

# ALWAYS_SKIP_DIRS = {
#     ".git",
#     ".hg",
#     ".svn",
#     "__pycache__",
#     "node_modules",
#     ".tox",
#     ".mypy_cache",
#     ".pytest_cache",
#     ".ruff_cache",
#     "dist",
#     "build",
#     ".eggs",
#     "*.egg-info",
#     ".venv",
#     "venv",
#     "env",
#     ".env",
#     ".idea",
#     ".vscode",
#     ".cursor",
#     "coverage",
#     ".next",
#     ".nuxt",
# }

# BINARY_EXTENSIONS = {
#     ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg",
#     ".woff", ".woff2", ".ttf", ".eot",
#     ".zip", ".tar", ".gz", ".bz2", ".rar", ".7z",
#     ".exe", ".dll", ".so", ".dylib",
#     ".pyc", ".pyo", ".class",
#     ".pdf", ".doc", ".docx", ".xls", ".xlsx",
#     ".mp3", ".mp4", ".avi", ".mov", ".wav",
#     ".db", ".sqlite", ".sqlite3",
#     ".lock",
# }

# PYTHON_EXTENSIONS = {".py", ".pyi"}
# JS_EXTENSIONS = {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"}


# def _load_gitignore(repo_path: Path) -> pathspec.PathSpec | None:
#     gitignore = repo_path / ".gitignore"
#     if gitignore.is_file():
#         with open(gitignore, "r", encoding="utf-8", errors="ignore") as f:
#             return pathspec.PathSpec.from_lines("gitwildmatch", f)
#     return None


# def _should_skip_dir(name: str) -> bool:
#     return name in ALWAYS_SKIP_DIRS or name.startswith(".")


# def _is_binary(ext: str) -> bool:
#     return ext.lower() in BINARY_EXTENSIONS


# def collect_files(repo_path: str) -> list[dict]:
#     """Walk the repo and return a list of file info dicts."""
#     root = Path(repo_path).resolve()
#     if not root.is_dir():
#         raise ValueError(f"Not a valid directory: {repo_path}")

#     gitignore_spec = _load_gitignore(root)
#     files: list[dict] = []

#     for dirpath, dirnames, filenames in os.walk(root):
#         rel_dir = Path(dirpath).relative_to(root)

#         dirnames[:] = [
#             d for d in dirnames
#             if not _should_skip_dir(d)
#             and (
#                 gitignore_spec is None
#                 or not gitignore_spec.match_file(str(rel_dir / d) + "/")
#             )
#         ]

#         for fname in filenames:
#             ext = Path(fname).suffix.lower()
#             if _is_binary(ext):
#                 continue

#             rel_path = str(rel_dir / fname).replace("\\", "/")
#             if rel_path.startswith("./"):
#                 rel_path = rel_path[2:]

#             if gitignore_spec and gitignore_spec.match_file(rel_path):
#                 continue

#             full_path = Path(dirpath) / fname
#             files.append({
#                 "full_path": str(full_path),
#                 "rel_path": rel_path,
#                 "ext": ext,
#                 "name": fname,
#             })

#     return files


# def analyze_repo(repo_path: str) -> dict:
#     """Analyze a repository and return the graph as a dict."""
#     from .python_analyzer import PythonAnalyzer
#     from .js_analyzer import JsAnalyzer
#     from .generic_analyzer import GenericAnalyzer

#     files = collect_files(repo_path)
#     graph = Graph()

#     python_files = [f for f in files if f["ext"] in PYTHON_EXTENSIONS]
#     js_files = [f for f in files if f["ext"] in JS_EXTENSIONS]
#     other_files = [f for f in files if f["ext"] not in PYTHON_EXTENSIONS and f["ext"] not in JS_EXTENSIONS]

#     generic = GenericAnalyzer()
#     for f in files:
#         generic.analyze_file(f, graph)

#     if python_files:
#         py_analyzer = PythonAnalyzer()
#         for f in python_files:
#             py_analyzer.analyze_file(f, graph)
#         py_analyzer.resolve_imports(python_files, graph)

#     if js_files:
#         js_analyzer = JsAnalyzer()
#         for f in js_files:
#             js_analyzer.analyze_file(f, graph)
#         js_analyzer.resolve_imports(js_files, graph)

#     graph.resolve_edges()
#     result = graph.to_dict()
#     result["repo_name"] = Path(repo_path).name
#     return result
