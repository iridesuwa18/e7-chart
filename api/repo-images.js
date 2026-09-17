// api/repo-images.js
// Lists images in assets/heroes/ or assets/icons/ from the GitHub repo.
// Also handles batch deletes of repo images.
// Both operations require ADMIN_PASSWORD.
// Env vars required: GITHUB_TOKEN, ADMIN_PASSWORD

const REPO   = "iridesuwa18/e7-chart";
const BRANCH = "main";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://iridesuwa18.github.io");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const token         = process.env.GITHUB_TOKEN;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!token)         return res.status(500).json({ error: "GITHUB_TOKEN not set" });
  if (!adminPassword) return res.status(500).json({ error: "ADMIN_PASSWORD not set" });

  /* ─────────────────────────────────────
     GET — list images in a folder
     Query: ?folder=heroes|icons&password=xxx
  ───────────────────────────────────── */
  if (req.method === "GET") {
    const { folder, password } = req.query;

    if (!password || password !== adminPassword)
      return res.status(401).json({ error: "Incorrect password" });

    if (!["heroes", "icons"].includes(folder))
      return res.status(400).json({ error: "folder must be 'heroes' or 'icons'" });

    const path = `assets/${folder}`;
    try {
      const apiRes = await fetch(
        `https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}`,
        { headers: { Authorization: `token ${token}`, "User-Agent": "e7-chart" } }
      );

      // Folder doesn't exist yet — just return empty
      if (apiRes.status === 404) return res.status(200).json({ images: [] });

      const data = await apiRes.json();
      if (!apiRes.ok)
        return res.status(apiRes.status).json({ error: data.message || "GitHub API error" });

      const images = data
        .filter(f => f.type === "file" && /\.(jpe?g|png|webp|gif)$/i.test(f.name))
        .map(f => ({
          name: f.name,
          sha:  f.sha,
          url:  `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${path}/${f.name}`,
        }));

      return res.status(200).json({ images });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  /* ─────────────────────────────────────
     POST — delete one or more images
     Body: { folder, deletes: [{name, sha}], password }
  ───────────────────────────────────── */
  if (req.method === "POST") {
    let body;
    try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
    catch { return res.status(400).json({ error: "Invalid JSON body" }); }

    const { folder, deletes, password } = body;

    if (!password || password !== adminPassword)
      return res.status(401).json({ error: "Incorrect password" });

    if (!["heroes", "icons"].includes(folder))
      return res.status(400).json({ error: "folder must be 'heroes' or 'icons'" });

    if (!Array.isArray(deletes) || deletes.length === 0)
      return res.status(400).json({ error: "deletes must be a non-empty array of {name,sha}" });

    const errors = [];
    for (const { name, sha } of deletes) {
      if (!name || !sha) { errors.push({ name, error: "Missing name or sha" }); continue; }
      const path = `assets/${folder}/${name}`;
      try {
        const apiRes = await fetch(
          `https://api.github.com/repos/${REPO}/contents/${path}`,
          {
            method:  "DELETE",
            headers: {
              Authorization:  `token ${token}`,
              "Content-Type": "application/json",
              "User-Agent":   "e7-chart",
            },
            body: JSON.stringify({
              message: `delete ${folder}/${name}`,
              sha,
              branch: BRANCH,
            }),
          }
        );
        if (!apiRes.ok) {
          const d = await apiRes.json();
          errors.push({ name, error: d.message || "GitHub API error" });
        }
      } catch (err) {
        errors.push({ name, error: err.message });
      }
    }

    return res.status(200).json({ ok: true, errors });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
