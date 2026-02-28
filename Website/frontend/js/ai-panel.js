
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

    // ── Build DOM ──────────────────────────────────────────────────────────────

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

        // Tab clicks
        this.panel.querySelectorAll(".ai-tab").forEach(tab => {
            tab.addEventListener("click", () => this._activateTab(tab.dataset.tab));
        });

        // Model select
        document.getElementById("ai-model-select").addEventListener("change", (e) => {
            this.selectedModel = e.target.value;
        });

        // Close
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

    // ── Ollama model list ──────────────────────────────────────────────────────

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

    // ── AI fetches ─────────────────────────────────────────────────────────────

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

    // ── Core API call ──────────────────────────────────────────────────────────

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

    // ── Rendering helpers ──────────────────────────────────────────────────────

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










// /**
//  * AI Insights Panel — repo summary, node explanations, code quality, dependency warnings.
//  * Talks to /api/ai/* endpoints which proxy to Anthropic.
//  */
// class AIPanel {
//     constructor() {
//         this.panel = document.getElementById('ai-panel');
//         this.apiKey = sessionStorage.getItem('anthropicKey') || '';
//         this.repoContext = null;   // graph data summary sent to AI
//         this.currentNodeId = null;

//         this._buildUI();
//     }

//     setRepoContext(graphData) {
//         this.repoContext = {
//             repo_name: graphData.repo_name,
//             stats: graphData.stats,
//             node_type_counts: graphData.node_type_counts,
//             edge_type_counts: graphData.edge_type_counts,
//             // Send a lightweight node list (no huge metadata)
//             nodes: graphData.nodes.map(n => ({
//                 id: n.id, label: n.label, type: n.type, file_path: n.file_path
//             })),
//             edges: graphData.edges.map(e => ({
//                 source: e.source, target: e.target, type: e.type
//             })),
//         };

//         this._showTab('summary');
//         this._fetchSummary();
//     }

//     onNodeSelected(node, graphData) {
//         this.currentNodeId = node ? node.id : null;
//         if (node) {
//             this._showTab('node');
//             this._fetchNodeInsight(node, graphData);
//         }
//     }

//     _buildUI() {
//         if (!this.panel) return;

//         this.panel.innerHTML = `
//             <div class="ai-panel-header">
//                 <span class="ai-logo">✦ AI Insights</span>
//                 <div class="ai-tabs">
//                     <button class="ai-tab active" data-tab="summary">Summary</button>
//                     <button class="ai-tab" data-tab="node">Node</button>
//                     <button class="ai-tab" data-tab="quality">Quality</button>
//                     <button class="ai-tab" data-tab="deps">Deps</button>
//                 </div>
//                 <button class="ai-close" id="ai-close-btn" aria-label="Close AI panel">×</button>
//             </div>
//             <div class="ai-key-row" id="ai-key-row">
//                 <input id="ai-key-input" type="password" placeholder="Paste Anthropic API key..." class="ai-key-input" />
//                 <button id="ai-key-save" class="ai-key-save">Set</button>
//             </div>
//             <div class="ai-content" id="ai-content">
//                 <div class="ai-empty">Analyze a repo to see AI insights.</div>
//             </div>
//         `;

//         // Tab switching
//         this.panel.querySelectorAll('.ai-tab').forEach(tab => {
//             tab.addEventListener('click', () => {
//                 this.panel.querySelectorAll('.ai-tab').forEach(t => t.classList.remove('active'));
//                 tab.classList.add('active');
//                 this._showTab(tab.dataset.tab);
//             });
//         });

//         // Key input
//         const keyInput = this.panel.querySelector('#ai-key-input');
//         const keySave  = this.panel.querySelector('#ai-key-save');
//         if (this.apiKey) {
//             keyInput.value = this.apiKey;
//             this.panel.querySelector('#ai-key-row').classList.add('has-key');
//         }
//         keySave.addEventListener('click', () => {
//             this.apiKey = keyInput.value.trim();
//             sessionStorage.setItem('anthropicKey', this.apiKey);
//             keySave.textContent = '✓';
//             setTimeout(() => keySave.textContent = 'Set', 1500);
//             if (this.repoContext) this._fetchSummary();
//         });

//         // Close
//         document.getElementById('ai-close-btn').addEventListener('click', () => {
//             this.panel.classList.remove('open');
//         });
//     }

//     _showTab(tab) {
//         this._activeTab = tab;
//         if (!this.repoContext) return;

//         if (tab === 'summary') this._fetchSummary();
//         else if (tab === 'quality') this._fetchQuality();
//         else if (tab === 'deps') this._fetchDeps();
//         else if (tab === 'node' && this.currentNodeId) {
//             // node insight already fetched on selection
//         } else {
//             this._setContent('<div class="ai-empty">Select a node on the graph to see insights.</div>');
//         }
//     }

//     async _fetchSummary() {
//         if (!this._activeTab === 'summary') return;
//         this._setContent(this._spinner());
//         const result = await this._ask(`
// You are analyzing a code repository called "${this.repoContext.repo_name}".

// Repository stats:
// - Total nodes: ${this.repoContext.stats.total_nodes}
// - Total edges: ${this.repoContext.stats.total_edges}
// - Node types: ${JSON.stringify(this.repoContext.node_type_counts)}
// - Edge types: ${JSON.stringify(this.repoContext.edge_type_counts)}

// Key files and structure:
// ${this.repoContext.nodes.slice(0, 60).map(n => `- [${n.type}] ${n.file_path}`).join('\n')}

// Write a concise repository overview in 3–4 short paragraphs:
// 1. What this project likely is and does
// 2. The architecture pattern used (MVC, layered, microservice, etc.)
// 3. Key components and how they're organized
// 4. Any notable observations about the structure

// Use plain text, no markdown headers, keep it under 200 words.
//         `);
//         this._setContent(this._textBlock(result));
//     }

//     async _fetchNodeInsight(node, graphData) {
//         this._setContent(this._spinner());

//         // Find connected nodes for context
//         const connected = graphData.edges
//             .filter(e => e.source === node.id || e.target === node.id)
//             .map(e => {
//                 const otherId = e.source === node.id ? e.target : e.source;
//                 const other = graphData.nodes.find(n => n.id === otherId);
//                 return other ? `${e.type} → ${other.label} (${other.type})` : null;
//             })
//             .filter(Boolean)
//             .slice(0, 15);

//         const result = await this._ask(`
// You are analyzing a specific node in a codebase called "${this.repoContext?.repo_name || 'unknown'}".

// Node details:
// - Name: ${node.label}
// - Type: ${node.type}
// - File: ${node.file_path}
// - Line: ${node.line_number || 'unknown'}

// Connections (${connected.length}):
// ${connected.join('\n') || 'No connections found'}

// Write a brief explanation (2–3 sentences) of:
// 1. What this ${node.type} likely does based on its name and type
// 2. Its role in the system based on its connections

// Then on a new line starting with "ROLE:", state its architectural role in one phrase (e.g. "ROLE: Data access layer").
// Keep it under 80 words total. Plain text only.
//         `);

//         const [explanation, role] = result.split(/\nROLE:/);
//         this._setContent(`
//             <div class="ai-node-card">
//                 <div class="ai-node-name">${node.label}</div>
//                 <div class="ai-node-type-badge">${node.type}</div>
//                 <div class="ai-node-file">${node.file_path}</div>
//                 <div class="ai-node-explanation">${(explanation || result).trim()}</div>
//                 ${role ? `<div class="ai-node-role">◆ ${role.trim()}</div>` : ''}
//             </div>
//         `);
//     }

//     async _fetchQuality() {
//         this._setContent(this._spinner());
//         const result = await this._ask(`
// You are doing a code quality analysis of "${this.repoContext.repo_name}".

// Stats:
// - ${this.repoContext.stats.total_nodes} nodes, ${this.repoContext.stats.total_edges} edges
// - Node types: ${JSON.stringify(this.repoContext.node_type_counts)}
// - Edge types: ${JSON.stringify(this.repoContext.edge_type_counts)}

// Files:
// ${this.repoContext.nodes.slice(0, 80).map(n => `[${n.type}] ${n.file_path}`).join('\n')}

// Give exactly 4 code quality observations as a numbered list.
// Each item: one short title (5 words max) followed by a colon, then one sentence of explanation.
// Focus on: test coverage, separation of concerns, coupling, naming conventions.
// Plain text only, no markdown.
//         `);

//         const items = result.split(/\n/).filter(l => /^\d\./.test(l.trim()));
//         const html = items.length
//             ? items.map(item => {
//                 const [title, ...rest] = item.replace(/^\d\.\s*/, '').split(':');
//                 return `<div class="ai-quality-item">
//                     <div class="ai-quality-title">${title}</div>
//                     <div class="ai-quality-desc">${rest.join(':').trim()}</div>
//                 </div>`;
//               }).join('')
//             : this._textBlock(result);

//         this._setContent(`<div class="ai-quality-list">${html}</div>`);
//     }

//     async _fetchDeps() {
//         this._setContent(this._spinner());

//         // Find external modules (module: prefixed edges that weren't resolved)
//         const externalImports = [...new Set(
//             this.repoContext.edges
//                 .filter(e => e.type === 'imports')
//                 .map(e => e.target.replace('module:', ''))
//                 .filter(t => !t.startsWith('file:'))
//                 .slice(0, 40)
//         )];

//         const result = await this._ask(`
// You are analyzing dependencies of "${this.repoContext.repo_name}".

// Detected external imports:
// ${externalImports.join('\n') || 'None detected'}

// Node types in project:
// ${JSON.stringify(this.repoContext.node_type_counts)}

// Give up to 4 dependency observations as a numbered list.
// Focus on: known problematic packages, security concerns, missing common patterns, outdated approaches.
// Each item: short title (5 words max) then colon then one sentence.
// If no imports detected, comment on what's missing or unusual.
// Plain text only.
//         `);

//         const items = result.split(/\n/).filter(l => /^\d\./.test(l.trim()));
//         const html = items.length
//             ? items.map(item => {
//                 const [title, ...rest] = item.replace(/^\d\.\s*/, '').split(':');
//                 return `<div class="ai-quality-item">
//                     <div class="ai-quality-title">${title}</div>
//                     <div class="ai-quality-desc">${rest.join(':').trim()}</div>
//                 </div>`;
//               }).join('')
//             : this._textBlock(result);

//         this._setContent(`<div class="ai-quality-list">${html}</div>`);
//     }

//     async _ask(prompt) {
//         if (!this.apiKey) {
//             return 'No API key set. Paste your Anthropic API key above to enable AI insights.';
//         }
//         try {
//             const resp = await fetch('/api/ai/ask', {
//                 method: 'POST',
//                 headers: { 'Content-Type': 'application/json' },
//                 body: JSON.stringify({ prompt, api_key: this.apiKey }),
//             });
//             if (!resp.ok) {
//                 const err = await resp.json().catch(() => ({}));
//                 return `Error: ${err.detail || resp.statusText}`;
//             }
//             const data = await resp.json();
//             return data.result || 'No response.';
//         } catch (e) {
//             return `Failed to reach AI: ${e.message}`;
//         }
//     }

//     _setContent(html) {
//         const el = document.getElementById('ai-content');
//         if (el) el.innerHTML = html;
//     }

//     _spinner() {
//         return `<div class="ai-spinner"><div class="ai-spin-ring"></div><span>Thinking...</span></div>`;
//     }

//     _textBlock(text) {
//         return `<div class="ai-text">${(text || '').replace(/\n/g, '<br>')}</div>`;
//     }
// }