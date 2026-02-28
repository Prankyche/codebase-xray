from __future__ import annotations

import re
from pathlib import Path

from .graph import Graph, Node, Edge


# --- Regexes ---

RE_PACKAGE = re.compile(r"""^\s*package\s+([\w.]+)\s*;""", re.MULTILINE)
RE_IMPORT = re.compile(r"""^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;""", re.MULTILINE)

RE_CLASS = re.compile(
    r"""(?:public|protected|private|abstract|final|static)?\s*(?:class|interface|enum|record)\s+(\w+)"""
    r"""(?:\s+extends\s+([\w<>, ]+?))?(?:\s+implements\s+([\w<>, ]+?))?\s*\{""",
    re.MULTILINE,
)

RE_METHOD = re.compile(
    r"""(?:public|protected|private|static|final|abstract|synchronized|native|default)[\w\s<>\[\],?]*"""
    r"""\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*[\{;]""",
    re.MULTILINE,
)

RE_ANNOTATION = re.compile(r"""@([\w.]+)(?:\s*\([^)]*\))?""")

RE_SPRING_MAPPING = re.compile(
    r"""@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)"""
    r"""(?:\s*\(\s*(?:value\s*=\s*)?["']([^"']*)["']\s*\))?""",
)

RE_FIELD_TYPE = re.compile(
    r"""(?:private|protected|public)\s+(?:final\s+)?(?:static\s+)?"""
    r"""([\w<>\[\],? ]+?)\s+(\w+)\s*[;=]"""
)

RE_METHOD_CALL = re.compile(r"""(\w+)\s*\.\s*(\w+)\s*\(""")

SPRING_COMPONENT_ANNOTATIONS = {
    "Component", "Service", "Repository", "Controller", "RestController",
    "Configuration", "Bean", "Entity", "Table", "Mapper", "Aspect",
}

SPRING_ENDPOINT_ANNOTATIONS = {
    "GetMapping", "PostMapping", "PutMapping", "DeleteMapping",
    "PatchMapping", "RequestMapping",
}

DB_READ_METHODS = {
    "findById", "findAll", "findOne", "findBy", "getById", "getOne",
    "select", "query", "fetch", "executeQuery", "createQuery",
    "findAllBy", "existsById", "count",
}

DB_WRITE_METHODS = {
    "save", "saveAll", "delete", "deleteById", "deleteAll",
    "insert", "update", "merge", "persist", "flush",
    "execute", "executeUpdate", "bulkInsert",
}

HTTP_CLIENT_METHODS = {
    "getForObject", "postForObject", "put", "delete", "exchange",
    "getForEntity", "postForEntity", "execute", "send",
}

HTTP_CLIENT_OBJECTS = {
    "restTemplate", "webClient", "httpClient", "okHttpClient",
    "restTemplate", "WebClient", "RestTemplate", "HttpClient",
}

ANNOTATION_TO_HTTP = {
    "GetMapping": "GET",
    "PostMapping": "POST",
    "PutMapping": "PUT",
    "DeleteMapping": "DELETE",
    "PatchMapping": "PATCH",
    "RequestMapping": "GET",
}


def _get_source(file_info: dict) -> str | None:
    if file_info.get("content") is not None:
        return file_info["content"]
    full_path = file_info.get("full_path")
    if full_path:
        try:
            with open(full_path, "r", encoding="utf-8", errors="ignore") as f:
                return f.read()
        except (OSError, UnicodeDecodeError):
            pass
    return None


def _classify_java_file(annotations: set[str], class_name: str, rel_path: str) -> str:
    name_lower = class_name.lower()
    path_parts = set(Path(rel_path).parts)

    if "RestController" in annotations or "Controller" in annotations:
        return "endpoint"
    if "Service" in annotations or "service" in name_lower:
        return "service"
    if "Repository" in annotations or "repository" in name_lower or "dao" in name_lower:
        return "model"
    if "Entity" in annotations or "Table" in annotations or "model" in name_lower or "entity" in name_lower:
        return "model"
    if "Configuration" in annotations or "config" in name_lower:
        return "config"
    if "Aspect" in annotations or "aspect" in name_lower:
        return "middleware"
    if "util" in name_lower or "helper" in name_lower or "utils" in name_lower:
        return "utility"
    if "test" in name_lower or "test" in {p.lower() for p in path_parts}:
        return "test"
    if "Component" in annotations:
        return "service"

    return "class"


class JavaAnalyzer:
    def analyze_file(self, file_info: dict, graph: Graph) -> None:
        source = _get_source(file_info)
        if source is None:
            return

        file_id = f"file:{file_info['rel_path']}"

        # Strip comments to avoid false matches
        source_clean = re.sub(r"//[^\n]*", "", source)
        source_clean = re.sub(r"/\*.*?\*/", "", source_clean, flags=re.DOTALL)

        # Package and imports
        package = ""
        m = RE_PACKAGE.search(source_clean)
        if m:
            package = m.group(1)

        imports = [m.group(1) for m in RE_IMPORT.finditer(source_clean)]

        # Top-level annotations on the class
        annotations: set[str] = set()
        for m in RE_ANNOTATION.finditer(source_clean[:2000]):  # only look near top
            annotations.add(m.group(1).split(".")[-1])

        # Primary class name from filename
        class_name = Path(file_info["name"]).stem
        node_type = _classify_java_file(annotations, class_name, file_info["rel_path"])

        # Add file node
        graph.add_node(Node(
            id=file_id,
            label=file_info["name"],
            type=node_type,
            file_path=file_info["rel_path"],
            metadata={
                "package": package,
                "annotations": list(annotations),
                "extension": ".java",
            },
        ))

        # Add class node
        self._extract_classes(source_clean, file_info, file_id, graph, annotations)

        # Imports → deferred edges
        self._extract_imports(imports, file_id, graph)

        # Spring endpoints
        self._extract_endpoints(source_clean, file_info, file_id, graph)

        # DB and HTTP call edges
        self._extract_calls(source_clean, file_id, graph)

    def _extract_classes(self, source: str, file_info: dict, file_id: str, graph: Graph, file_annotations: set[str]) -> None:
        for m in RE_CLASS.finditer(source):
            name = m.group(1)
            extends = m.group(2)
            implements = m.group(3)

            # Collect annotations just before this class declaration
            preceding = source[max(0, m.start() - 300): m.start()]
            local_annotations: set[str] = set()
            for am in RE_ANNOTATION.finditer(preceding):
                local_annotations.add(am.group(1).split(".")[-1])
            all_annotations = file_annotations | local_annotations

            node_type = _classify_java_file(all_annotations, name, file_info["rel_path"])
            class_id = f"class:{file_info['rel_path']}:{name}"

            graph.add_node(Node(
                id=class_id,
                label=name,
                type=node_type,
                file_path=file_info["rel_path"],
                line_number=source[:m.start()].count("\n") + 1,
                metadata={
                    "extends": extends.strip() if extends else None,
                    "implements": [i.strip() for i in implements.split(",")] if implements else [],
                    "annotations": list(all_annotations),
                },
            ))
            graph.add_edge(Edge(source=file_id, target=class_id, type="uses"))

            # Inheritance edges
            if extends:
                for base in re.split(r"[,<>]", extends):
                    base = base.strip()
                    if base and base not in ("Object",):
                        ref_id = f"class_ref:{base}"
                        graph.add_node(Node(id=ref_id, label=base, type="class", metadata={"external_ref": True}))
                        graph.add_edge_deferred(Edge(source=class_id, target=ref_id, type="inherits"))

            if implements:
                for iface in implements.split(","):
                    iface = re.sub(r"<.*>", "", iface).strip()
                    if iface:
                        ref_id = f"class_ref:{iface}"
                        graph.add_node(Node(id=ref_id, label=iface, type="class", metadata={"external_ref": True}))
                        graph.add_edge_deferred(Edge(source=class_id, target=ref_id, type="inherits"))

    def _extract_imports(self, imports: list[str], file_id: str, graph: Graph) -> None:
        for imp in imports:
            graph.add_edge_deferred(Edge(
                source=file_id,
                target=f"module:{imp}",
                type="imports",
            ))

    def _extract_endpoints(self, source: str, file_info: dict, file_id: str, graph: Graph) -> None:
        # Find class-level RequestMapping prefix
        prefix = ""
        cm = re.search(r"""@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']*)["']""", source[:1000])
        if cm:
            prefix = cm.group(1).rstrip("/")

        for m in RE_SPRING_MAPPING.finditer(source):
            annotation = m.group(1)
            path = m.group(2) or ""
            full_path = prefix + "/" + path.lstrip("/") if path else prefix or "/"
            http_method = ANNOTATION_TO_HTTP.get(annotation, "GET")

            lineno = source[:m.start()].count("\n") + 1
            ep_id = f"endpoint:{file_info['rel_path']}:{http_method}:{full_path}"

            graph.add_node(Node(
                id=ep_id,
                label=f"{http_method} {full_path}",
                type="endpoint",
                file_path=file_info["rel_path"],
                line_number=lineno,
                metadata={"method": http_method, "path": full_path},
            ))
            graph.add_edge(Edge(source=file_id, target=ep_id, type="endpoint_handler"))

    def _extract_calls(self, source: str, file_id: str, graph: Graph) -> None:
        for m in RE_METHOD_CALL.finditer(source):
            obj = m.group(1)
            method = m.group(2)

            if method in DB_READ_METHODS:
                graph.add_edge_deferred(Edge(
                    source=file_id, target=file_id, type="db_read",
                    metadata={"method": method, "object": obj},
                ))
            elif method in DB_WRITE_METHODS:
                graph.add_edge_deferred(Edge(
                    source=file_id, target=file_id, type="db_write",
                    metadata={"method": method, "object": obj},
                ))

            if obj.lower() in {h.lower() for h in HTTP_CLIENT_OBJECTS} or method in HTTP_CLIENT_METHODS:
                graph.add_edge_deferred(Edge(
                    source=file_id, target=file_id, type="api_call",
                    metadata={"method": method, "object": obj},
                ))

    def resolve_imports(self, java_files: list[dict], graph: Graph) -> None:
        """Resolve Java import statements to actual file nodes."""
        # Build map: fully.qualified.ClassName -> file_id
        package_map: dict[str, str] = {}
        class_name_map: dict[str, str] = {}  # simple name -> file_id

        for f in java_files:
            rel = f["rel_path"]
            file_id = f"file:{rel}"
            class_name = Path(rel).stem

            # Derive package from path (src/main/java/com/example/Foo.java -> com.example.Foo)
            parts = Path(rel).with_suffix("").parts
            try:
                java_idx = next(i for i, p in enumerate(parts) if p == "java")
                pkg_parts = parts[java_idx + 1:]
                fqn = ".".join(pkg_parts)
                package_map[fqn] = file_id
            except StopIteration:
                # Fallback: use full path as dotted name
                fqn = ".".join(Path(rel).with_suffix("").parts)
                package_map[fqn] = file_id

            class_name_map[class_name] = file_id

        for edge in graph.edges:
            if edge.type == "imports" and edge.target.startswith("module:"):
                imp = edge.target[len("module:"):]

                # Exact FQN match
                if imp in package_map:
                    edge.target = package_map[imp]
                    continue

                # Wildcard: com.example.* — match any file in that package
                if imp.endswith(".*"):
                    prefix = imp[:-2]
                    for fqn, fid in package_map.items():
                        if fqn.startswith(prefix + "."):
                            edge.target = fid
                            break
                    continue

                # Simple class name fallback
                simple = imp.split(".")[-1]
                if simple in class_name_map:
                    edge.target = class_name_map[simple]