
(function () {
    "use strict";

    const canvas         = document.getElementById("graph-canvas");
    const tooltip        = document.getElementById("tooltip");
    const repoInput      = document.getElementById("repo-path");
    const analyzeBtn     = document.getElementById("analyze-btn");
    const zipInput       = document.getElementById("zip-upload");
    const zipLabel       = document.getElementById("zip-label");
    const statusMsg      = document.getElementById("status-msg");
    const loadingOverlay = document.getElementById("loading-overlay");
    const detailPanelEl  = document.getElementById("detail-panel");
    const aiToggleBtn    = document.getElementById("ai-toggle-btn");
    const aiPanelEl      = document.getElementById("ai-panel");

    const renderer    = new GraphRenderer(canvas, tooltip);
    const sidebar     = new SidebarController(renderer);
    const detailPanel = new DetailPanel(detailPanelEl, {
        onNavigate: (nodeId) => renderer.zoomToNode(nodeId),
    });
    const aiPanel = new AIPanel();

    let currentGraphData = null;

    renderer.onNodeClick((node) => {
        if (renderer.highlightedNodeId === null) {
            detailPanel.close();
            aiPanel.onNodeSelected(null, currentGraphData);
        } else {
            detailPanel.show(node.id);
            aiPanel.onNodeSelected(node, currentGraphData);
            if (currentGraphData) aiPanelEl.classList.add("open");
        }
    });

    analyzeBtn.addEventListener("click", () => startAnalysis());
    repoInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") startAnalysis();
    });

    if (zipInput) {
        zipInput.addEventListener("change", () => {
            const file = zipInput.files[0];
            if (file) {
                if (zipLabel) zipLabel.textContent = file.name;
                startZipAnalysis(file);
            }
        });
    }

    if (aiToggleBtn) {
        aiToggleBtn.addEventListener("click", () => {
            aiPanelEl.classList.toggle("open");
        });
    }

    window.addEventListener("DOMContentLoaded", () => {
        const params = new URLSearchParams(window.location.search);

        const key = params.get("api_key") || sessionStorage.getItem("anthropicKey");
        if (key) {
            sessionStorage.setItem("anthropicKey", key);
            const keyInput = document.getElementById("ai-key-input");
            if (keyInput) keyInput.value = key;
        }

        if (params.get("mode") === "zip") {
            const b64  = sessionStorage.getItem("pendingZip");
            const name = sessionStorage.getItem("pendingZipName") || "repo.zip";
            sessionStorage.removeItem("pendingZip");
            sessionStorage.removeItem("pendingZipName");
            if (b64) {
                const blob = dataURLtoBlob(b64);
                const file = new File([blob], name, { type: "application/zip" });
                startZipAnalysis(file);
                window.history.replaceState({}, "", "/");
                return;
            }
        }

        const repoUrl = params.get("repo_url");
        if (repoUrl) {
            repoInput.value = repoUrl;
            window.history.replaceState({}, "", "/");
            startAnalysis();
        }
    });

    async function startAnalysis() {
        const repoUrl = repoInput.value.trim();
        if (!repoUrl) {
            setStatus("Please enter a GitHub repository URL.", true);
            return;
        }

        setLoading(true);
        setStatus("Analyzing...");

        try {
            const resp = await fetch("/api/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ repo_url: repoUrl, token : TOKEN }),
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({ detail: resp.statusText }));
                const detail = Array.isArray(err.detail)
                    ? err.detail.map(e => e.msg).join(", ")
                    : (err.detail || "Analysis failed");
                throw new Error(detail);
            }

            const data = await resp.json();
            if (!data.nodes || data.nodes.length === 0) {
                setStatus("No analyzable files found.", true);
                return;
            }

            displayGraph(data);
            setStatus(`${data.stats.total_nodes} nodes · ${data.stats.total_edges} edges`);
        } catch (err) {
            setStatus(err.message, true);
        } finally {
            setLoading(false);
        }
    }

    async function startZipAnalysis(file) {
        setLoading(true);
        setStatus(`Analyzing ${file.name}...`);

        try {
            const formData = new FormData();
            formData.append("zip_file", file);

            const resp = await fetch("/api/analyze-zip", {
                method: "POST",
                body: formData,
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({ detail: resp.statusText }));
                const detail = Array.isArray(err.detail)
                    ? err.detail.map(e => e.msg).join(", ")
                    : (err.detail || "Analysis failed");
                throw new Error(detail);
            }

            const data = await resp.json();
            if (!data.nodes || data.nodes.length === 0) {
                setStatus("No analyzable files found in zip.", true);
                return;
            }

            displayGraph(data);
            setStatus(`${data.stats.total_nodes} nodes · ${data.stats.total_edges} edges`);
        } catch (err) {
            setStatus(err.message, true);
        } finally {
            setLoading(false);
            if (zipInput) zipInput.value = "";
        }
    }

    function displayGraph(data) {
        currentGraphData = data;
        detailPanel.close();
        renderer.setData(data);
        sidebar.populate(data);
        detailPanel.setGraphData(data);
        aiPanel.setRepoContext(data);
        aiPanelEl.classList.add("open");
    }

    function setLoading(on) {
        analyzeBtn.disabled = on;
        loadingOverlay.style.display = on ? "" : "none";
    }

    function setStatus(msg, isError) {
        statusMsg.textContent = msg;
        statusMsg.className = "status-msg" + (isError ? " error" : "");
    }

    function dataURLtoBlob(dataURL) {
        const [header, data] = dataURL.split(",");
        const mime = header.match(/:(.*?);/)[1];
        const binary = atob(data);
        const arr = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
        return new Blob([arr], { type: mime });
    }

    (function initMobileToggle() {
        const sidebarEl = document.getElementById("sidebar");
        const btn = document.createElement("button");
        btn.className = "mobile-toggle";
        btn.setAttribute("aria-label", "Toggle sidebar");
        btn.textContent = "\u2630";
        document.body.appendChild(btn);
        btn.addEventListener("click", () => sidebarEl.classList.toggle("open"));
    })();
})();
