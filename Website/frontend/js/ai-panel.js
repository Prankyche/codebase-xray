
class AIPanel {
    constructor() {
        this.panel = document.getElementById("ai-panel");
        this.repoContext = null;
        this.currentNode = null;
        this.selectedModel = "llama3.2";
        this._activeTab = "summary";
        this._buildUI();
        this._loadModels();
    }

    setRepoContext(graphData) {
        this.repoContext = {
            repo_name: graphData.repo_name,
            stats: graphData.stats,
            node_type_counts: graphData.node_type_counts,
            edge_type_counts: graphData.edge_type_counts,
            nodes: graphData.nodes.map(n => ({
                id: n.id, label: n.label, type: n.type, file_path: n.file_path,
            })),
            edges: graphData.edges.map(e => ({
                source: e.source, target: e.target, type: e.type,
            })),
        };
        this._showTab("summary");
    }

    onNodeSelected(node, graphData) {
        this.currentNode = node;
        this.currentGraphData = graphData;
        if (node) {
            this._activateTab("node");
            this._fetchNodeInsight(node, graphData);
        }
    }

    _buildUI() {
        if (!this.panel) return;

        this.panel.innerHTML = `
            <div class="ai-panel-header">
                <span class="ai-logo">✦ AI</span>
                <div class="ai-tabs">
                    <button class="ai-tab active" data-tab="summary">Summary</button>
                    <button class="ai-tab" data-tab="node">Node</button>
                    <button class="ai-tab" data-tab="quality">Quality</button>
                    <button class="ai-tab" data-tab="deps">Deps</button>
                </div>
                <button class="ai-close" id="ai-close-btn">×</button>
            </div>

            <div class="ai-model-row">
                <span class="ai-model-label">MODEL</span>
                <select id="ai-model-select" class="ai-model-select">
                    <option value="llama3.2">llama3.2</option>
                </select>
                <span class="ai-ollama-status" id="ai-ollama-status" title="Ollama status">●</span>
            </div>

            <div class="ai-content" id="ai-content">
                <div class="ai-empty">Analyze a repo to see AI insights.</div>
            </div>
        `;

        this.panel.querySelectorAll(".ai-tab").forEach(tab => {
            tab.addEventListener("click", () => this._activateTab(tab.dataset.tab));
        });

        document.getElementById("ai-model-select").addEventListener("change", (e) => {
            this.selectedModel = e.target.value;
        });

        document.getElementById("ai-close-btn").addEventListener("click", () => {
            this.panel.classList.remove("open");
        });
    }

    _activateTab(tab) {
        this._activeTab = tab;
        this.panel.querySelectorAll(".ai-tab").forEach(t => {
            t.classList.toggle("active", t.dataset.tab === tab);
        });
        this._showTab(tab);
    }

    _showTab(tab) {
        if (!this.repoContext) return;

        if (tab === "summary") this._fetchSummary();
        else if (tab === "quality") this._fetchQuality();
        else if (tab === "deps") this._fetchDeps();
        else if (tab === "node") {
            if (this.currentNode) {
                this._fetchNodeInsight(this.currentNode, this.currentGraphData);
            } else {
                this._setContent('<div class="ai-empty">Click a node on the graph to see insights.</div>');
            }
        }
    }


    async _loadModels() {
        const statusDot = document.getElementById("ai-ollama-status");
        const select = document.getElementById("ai-model-select");
        if (!statusDot || !select) return;

        try {
            const resp = await fetch("/api/ai/models");
            const data = await resp.json();
            const models = data.models || [];

            if (models.length === 0) {
                statusDot.style.color = "#ff6b6b";
                statusDot.title = "Ollama not running or no models pulled";
                return;
            }

            statusDot.style.color = "#7fffb2";
            statusDot.title = "Ollama running";

            select.innerHTML = models
                .map(m => `<option value="${m}">${m}</option>`)
                .join("");
            this.selectedModel = models[0];
        } catch {
            statusDot.style.color = "#ff6b6b";
            statusDot.title = "Cannot reach Ollama";
        }
    }


    async _fetchSummary() {
        if (this._activeTab !== "summary") return;
        this._setContent(this._spinner("Generating summary..."));

        const result = await this._ask(`
You are analyzing a code repository called "${this.repoContext.repo_name}".

Stats: ${this.repoContext.stats.total_nodes} nodes, ${this.repoContext.stats.total_edges} edges.
Node types: ${JSON.stringify(this.repoContext.node_type_counts)}.
Edge types: ${JSON.stringify(this.repoContext.edge_type_counts)}.

Files and structure:
${this.repoContext.nodes.slice(0, 60).map(n => `[${n.type}] ${n.file_path}`).join("\n")}

Write a concise repository overview in 3 short paragraphs:
1. What this project is and does
2. The architecture pattern (MVC, layered, microservice, etc.)
3. Key components and how they are organized

Plain text only, no markdown, under 180 words.
        `);

        this._setContent(this._textBlock(result));
    }

    async _fetchNodeInsight(node, graphData) {
        if (this._activeTab !== "node") return;
        this._setContent(this._spinner("Analyzing node..."));

        const connected = (graphData?.edges || [])
            .filter(e => e.source === node.id || e.target === node.id)
            .map(e => {
                const otherId = e.source === node.id ? e.target : e.source;
                const other = (graphData?.nodes || []).find(n => n.id === otherId);
                return other ? `${e.type} → ${other.label} (${other.type})` : null;
            })
            .filter(Boolean)
            .slice(0, 12);

        const result = await this._ask(`
Analyze this code element from the "${this.repoContext?.repo_name || "repo"}" codebase.

Name: ${node.label}
Type: ${node.type}
File: ${node.file_path}

Connections (${connected.length}):
${connected.join("\n") || "None"}

In 2-3 sentences: what does this ${node.type} likely do, and what is its role based on its connections?
Then on a new line write: ROLE: [one short phrase describing its architectural role]
Plain text only, under 80 words.
        `);

        const roleMatch = result.match(/ROLE:\s*(.+)/i);
        const explanation = result.replace(/ROLE:.*/i, "").trim();

        this._setContent(`
            <div class="ai-node-card">
                <div class="ai-node-name">${node.label}</div>
                <span class="ai-node-type-badge">${node.type}</span>
                <div class="ai-node-file">${node.file_path}</div>
                <div class="ai-node-explanation">${explanation}</div>
                ${roleMatch ? `<div class="ai-node-role">◆ ${roleMatch[1].trim()}</div>` : ""}
            </div>
        `);
    }

    async _fetchQuality() {
        if (this._activeTab !== "quality") return;
        this._setContent(this._spinner("Checking quality..."));

        const result = await this._ask(`
Code quality analysis for "${this.repoContext.repo_name}".

Stats: ${this.repoContext.stats.total_nodes} nodes, ${this.repoContext.stats.total_edges} edges.
Node types: ${JSON.stringify(this.repoContext.node_type_counts)}.

Files:
${this.repoContext.nodes.slice(0, 80).map(n => `[${n.type}] ${n.file_path}`).join("\n")}

Give exactly 4 observations as a numbered list (1. 2. 3. 4.).
Each item: a short title (4 words max) then a colon then one sentence.
Focus on: test coverage, separation of concerns, coupling, naming.
Plain text only.
        `);

        this._setContent(this._numberedList(result));
    }

    async _fetchDeps() {
        if (this._activeTab !== "deps") return;
        this._setContent(this._spinner("Scanning dependencies..."));

        const externalImports = [...new Set(
            this.repoContext.edges
                .filter(e => e.type === "imports" && e.target.startsWith("module:"))
                .map(e => e.target.replace("module:", ""))
                .slice(0, 40)
        )];

        const result = await this._ask(`
Dependency analysis for "${this.repoContext.repo_name}".

Detected external imports:
${externalImports.join("\n") || "None detected"}

Node types: ${JSON.stringify(this.repoContext.node_type_counts)}.

Give exactly 4 observations as a numbered list (1. 2. 3. 4.).
Each: short title (4 words max) then colon then one sentence.
Focus on: notable packages, security, missing patterns, outdated approaches.
Plain text only.
        `);

        this._setContent(this._numberedList(result));
    }

    async _ask(prompt) {
        try {
            const resp = await fetch("/api/ai/ask", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: prompt.trim(),
                    model: this.selectedModel,
                }),
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                return `Error: ${err.detail || resp.statusText}`;
            }

            const data = await resp.json();
            return data.result || "No response.";
        } catch (e) {
            return `Failed to reach AI: ${e.message}`;
        }
    }


    _setContent(html) {
        const el = document.getElementById("ai-content");
        if (el) el.innerHTML = html;
    }

    _spinner(label = "Thinking...") {
        return `
            <div class="ai-spinner">
                <div class="ai-spin-ring"></div>
                <span>${label}</span>
            </div>`;
    }

    _textBlock(text) {
        return `<div class="ai-text">${(text || "").replace(/\n/g, "<br>")}</div>`;
    }

    _numberedList(text) {
        const items = (text || "").split("\n").filter(l => /^\d[\.\)]/.test(l.trim()));
        if (!items.length) return this._textBlock(text);

        const html = items.map(item => {
            const cleaned = item.replace(/^\d[\.\)]\s*/, "");
            const colonIdx = cleaned.indexOf(":");
            if (colonIdx === -1) return `<div class="ai-quality-item"><div class="ai-quality-desc">${cleaned}</div></div>`;
            const title = cleaned.slice(0, colonIdx).trim();
            const desc = cleaned.slice(colonIdx + 1).trim();
            return `
                <div class="ai-quality-item">
                    <div class="ai-quality-title">${title}</div>
                    <div class="ai-quality-desc">${desc}</div>
                </div>`;
        }).join("");

        return `<div class="ai-quality-list">${html}</div>`;
    }
}