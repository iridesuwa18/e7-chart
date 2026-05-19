// api/load.js
// Vercel serverless function — reads heroes data from a private GitHub Gist.
// Requires these environment variables set in Vercel dashboard:
//   GITHUB_TOKEN  — a GitHub Personal Access Token with "gist" scope
//   GIST_ID       — the ID of the Gist to read from

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token  = process.env.GITHUB_TOKEN;
  const gistId = process.env.GIST_ID;

  if (!token)  return res.status(500).json({ error: "GITHUB_TOKEN env var not set on server" });
  if (!gistId) return res.status(500).json({ error: "GIST_ID env var not set on server" });

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
