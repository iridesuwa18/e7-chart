// api/load.js
// Vercel serverless function — reads heroes data from a private GitHub Gist.
// Requires these environment variables set in Vercel dashboard:
//   GITHUB_TOKEN   — a GitHub Personal Access Token with "gist" scope
//   GIST_ID        — the ID of the Gist to read from
//   ADMIN_PASSWORD — the password required to load

export default async function handler(req, res) {
  // Accept POST so we can receive the password in the body
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token         = process.env.GITHUB_TOKEN;
  const gistId        = process.env.GIST_ID;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!token)         return res.status(500).json({ error: "GITHUB_TOKEN env var not set on server" });
  if (!gistId)        return res.status(500).json({ error: "GIST_ID env var not set on server" });
  if (!adminPassword) return res.status(500).json({ error: "ADMIN_PASSWORD env var not set on server" });

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  // ── Password check ──
  if (!body.password || body.password !== adminPassword) {
    return res.status(401).json({ error: "Incorrect password. Admin access only." });
  }

  try {
    const apiRes = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: {
        Authorization: `token ${token}`,
        "User-Agent":  "epicseven-chart",
      },
    });

    const data = await apiRes.json();

    if (!apiRes.ok) {
      return res.status(apiRes.status).json({ error: data.message || "GitHub API error" });
    }

    const fileContent = data.files?.["epicseven_heroes.json"]?.content;
    if (!fileContent) {
      return res.status(404).json({ error: "epicseven_heroes.json not found in Gist" });
    }

    const parsed = JSON.parse(fileContent);
    return res.status(200).json({ heroes: parsed.heroes || [] });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
