// api/save.js
// Vercel serverless function — writes heroes data to a private GitHub Gist.
// Requires these environment variables set in Vercel dashboard:
//   GITHUB_TOKEN  — a GitHub Personal Access Token with "gist" scope
//   GIST_ID       — the ID of the Gist to update (create one manually first,
//                   or leave blank to have this function create it on first save)

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token  = process.env.GITHUB_TOKEN;
  const gistId = process.env.GIST_ID;

  if (!token) {
    return res.status(500).json({ error: "GITHUB_TOKEN env var not set on server" });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const { heroes } = body;
  if (!Array.isArray(heroes)) {
    return res.status(400).json({ error: "heroes must be an array" });
  }

  const content = JSON.stringify({ heroes, savedAt: new Date().toISOString() }, null, 2);

  try {
    let apiRes;

    if (gistId) {
      // Update existing Gist
      apiRes = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: "PATCH",
        headers: {
          Authorization: `token ${token}`,
          "Content-Type": "application/json",
          "User-Agent":   "epicseven-chart",
        },
        body: JSON.stringify({
          files: {
            "epicseven_heroes.json": { content },
          },
        }),
      });
    } else {
      // Create a new private Gist (first time)
      apiRes = await fetch("https://api.github.com/gists", {
        method: "POST",
        headers: {
          Authorization: `token ${token}`,
          "Content-Type": "application/json",
          "User-Agent":   "epicseven-chart",
        },
        body: JSON.stringify({
          description: "Epic Seven Character Quadrant Chart data",
          public: false,
          files: {
            "epicseven_heroes.json": { content },
          },
        }),
      });
    }

    const data = await apiRes.json();

    if (!apiRes.ok) {
      return res.status(apiRes.status).json({ error: data.message || "GitHub API error" });
    }

    return res.status(200).json({ ok: true, gistId: data.id });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
