// api/save.js
// Saves chart heroes + draft data to a private GitHub Gist.
// Env vars required in Vercel dashboard:
//   GITHUB_TOKEN, GIST_ID, ADMIN_PASSWORD

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const token         = process.env.GITHUB_TOKEN;
  const gistId        = process.env.GIST_ID;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!token)         return res.status(500).json({ error: "GITHUB_TOKEN not set" });
  if (!adminPassword) return res.status(500).json({ error: "ADMIN_PASSWORD not set" });

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: "Invalid JSON body" }); }

  if (!body.password || body.password !== adminPassword)
    return res.status(401).json({ error: "Incorrect password. Admin access only." });

  const { heroes, draftData } = body;
  if (!Array.isArray(heroes))
    return res.status(400).json({ error: "heroes must be an array" });

  const content = JSON.stringify({
    heroes,
    draftData: draftData || null,
    savedAt: new Date().toISOString(),
  }, null, 2);

  try {
    let apiRes;
    if (gistId) {
      apiRes = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: "PATCH",
        headers: { Authorization: `token ${token}`, "Content-Type": "application/json", "User-Agent": "epicseven-chart" },
        body: JSON.stringify({ files: { "epicseven_heroes.json": { content } } }),
      });
    } else {
      apiRes = await fetch("https://api.github.com/gists", {
        method: "POST",
        headers: { Authorization: `token ${token}`, "Content-Type": "application/json", "User-Agent": "epicseven-chart" },
        body: JSON.stringify({ description: "Epic Seven Chart & Draft data", public: false, files: { "epicseven_heroes.json": { content } } }),
      });
    }
    const data = await apiRes.json();
    if (!apiRes.ok) return res.status(apiRes.status).json({ error: data.message || "GitHub API error" });
    return res.status(200).json({ ok: true, gistId: data.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
