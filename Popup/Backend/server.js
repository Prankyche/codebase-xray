require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const simpleGit = require("simple-git");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

// ==============================
// AI GitHub Analysis Route
// ==============================
//change 
async function fetchGitHubMetadata(repoUrl) {
  const parts = repoUrl.replace(".git", "").split("/");
  const owner = parts[parts.length - 2];
  const repo = parts[parts.length - 1];

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;

  const response = await axios.get(apiUrl);

  return {
    name: response.data.name,
    description: response.data.description,
    stars: response.data.stargazers_count,
    forks: response.data.forks_count,
    watchers: response.data.watchers_count,
    issues: response.data.open_issues_count,
    language: response.data.language,
    created: response.data.created_at,
    updated: response.data.updated_at,
    owner: response.data.owner.login
  };
}
app.post("/github", async (req, res) => {
  try {
    const repoUrl = req.body.repo;
    const githubMeta = await fetchGitHubMetadata(repoUrl);

    if (!repoUrl) {
      return res.status(400).json({ error: "GitHub URL is required" });
    }

    const repoPath = path.join(__dirname, "uploads", Date.now().toString());

    await simpleGit().clone(repoUrl, repoPath);

    const metadata = extractMetadata(repoPath);

    const aiResponse = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content:
              "You are a senior software architect helping developers understand unfamiliar codebases.",
          },
          {
            role: "user",
            content: `
Analyze this project metadata and explain clearly:
GitHub Metadata:
${JSON.stringify(githubMeta, null, 2)}


1. Overall architecture
2. Core components
3. Execution flow
4. Where a new developer should start
5. Technologies used

Project Metadata:
${metadata}
`,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.json({
      summary: aiResponse.data.choices[0].message.content,
      github: githubMeta
    });

  } catch (err) {
    console.error("GROQ ERROR:", err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data || err.message,
    });
  }
}); // ✅ properly close route

// ==============================
// Metadata Extractor
// ==============================

function extractMetadata(rootPath) {
  let structure = "";
  let importantFiles = "";

  function walk(dir, depth = 0) {
    fs.readdirSync(dir).forEach((file) => {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (depth < 2) {
        structure += "  ".repeat(depth) + "- " + file + "\n";
      }

      if (stat.isDirectory() && file !== "node_modules" && file !== ".git") {
        walk(fullPath, depth + 1);
      }

      if (file === "package.json" || file === "README.md") {
        importantFiles += `\n\n--- ${file} ---\n`;
        importantFiles += fs
          .readFileSync(fullPath, "utf8")
          .slice(0, 3000);
      }
    });
  }

  walk(rootPath);

  return `
Folder Structure:
${structure}

Important Files:
${importantFiles}
`;
}

// ==============================
// Start Server
// ==============================

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});