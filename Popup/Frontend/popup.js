const PROJECT2_URL = "http://localhost:8000";

let lastRepo = "";

document.getElementById("analyze").addEventListener("click", async () => {
    const repo = document.getElementById("repo").value.trim();
    const output = document.getElementById("output");

    if (!repo) {
        alert("Enter GitHub URL");
        return;
    }

    lastRepo = repo;
    output.innerText = "Analyzing... Please wait ⏳";

    document.getElementById("githubMeta").style.display = "none";

    try {
        const response = await fetch("http://localhost:3000/github", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ repo })
        });

        const data = await response.json();

        if (!response.ok) {
            output.innerText = "Error: " + (data.error || "Server error");
            return;
        }

        if (data.error) {
            output.innerText = "Error: " + data.error;
            return;
        }

        output.innerText = data.summary;

        if (data.github) {
            const g = data.github;
            document.getElementById("stars").innerHTML   = ` ${g.stars ?? "–"}<br><small>Stars</small>`;
            document.getElementById("forks").innerHTML   = ` ${g.forks ?? "–"}<br><small>Forks</small>`;
            document.getElementById("language").innerHTML = ` ${g.language ?? "–"}<br><small>Language</small>`;
            document.getElementById("issues").innerHTML  = ` ${g.issues ?? "–"}<br><small>Issues</small>`;
            document.getElementById("githubMeta").style.display = "";
        }

    } catch (error) {
        output.innerText = "Server not running or wrong route.";
        console.error(error);
    }
});

// ✅ "View Detailed Report" opens Project 2 with the repo pre-loaded
document.getElementById("openPageBtn").addEventListener("click", () => {
    if (!lastRepo) {
        alert("Please analyze a repository first.");
        return;
    }

    const url = `${PROJECT2_URL}/?repo_url=${encodeURIComponent(lastRepo)}`;
    chrome.tabs.create({ url });
});
