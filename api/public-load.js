// api/public-load.js
// Loads chart heroes + draft data from GitHub Gist WITHOUT a password.
// This is intentionally public — it only reads data, never writes.
// Env vars required: GITHUB_TOKEN, GIST_ID

export default async function handler(req, res) {
  // Allow GET or POST so the browser can call it easily
  if (req.method !== "GET" && req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const token  = process.env.GITHUB_TOKEN;
  const gistId = process.env.GIST_ID;

  if (!token)  return res.status(500).json({ error: "GITHUB_TOKEN not set" });
  if (!gistId) return res.status(500).json({ error: "GIST_ID not set" });

  try {
    const apiRes = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: {
        Authorization: `token ${token}`,
        "User-Agent": "epicseven-chart",
      },
    });
    const data = await apiRes.json();
    if (!apiRes.ok)
      return res.status(apiRes.status).json({ error: data.message || "GitHub API error" });

    const fileContent = data.files?.["epicseven_heroes.json"]?.content;
    if (!fileContent)
      return res.status(404).json({ error: "No saved data found" });

    const parsed = JSON.parse(fileContent);
    return res.status(200).json({
      heroes:    parsed.heroes    || [],
      draftData: parsed.draftData || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
