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
