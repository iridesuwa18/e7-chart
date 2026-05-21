// api/upload-image.js
// Uploads a base64 image to iridesuwa18/e7-chart and returns the raw GitHub URL.
// Called automatically by draft.js whenever a user sets a hero icon or tag icon.
// Env vars required: GITHUB_TOKEN
//
// POST body: { data: "data:image/jpeg;base64,…", folder: "heroes"|"icons", filename: "abc123.jpg" }
// Response:  { url: "https://raw.githubusercontent.com/…" }

const REPO  = "iridesuwa18/e7-chart";
const BRANCH = "main";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://iridesuwa18.github.io");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: "GITHUB_TOKEN not set" });

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: "Invalid JSON body" }); }

  const { data, folder, filename } = body;
  if (!data || !folder || !filename)
    return res.status(400).json({ error: "Missing data, folder, or filename" });

  if (!["heroes", "icons"].includes(folder))
    return res.status(400).json({ error: "folder must be 'heroes' or 'icons'" });

  // Strip the data URL prefix to get raw base64
  const base64 = data.replace(/^data:[^;]+;base64,/, "");
  const path   = `assets/${folder}/${filename}`;

  // Check if file already exists (need its SHA to update)
  let sha;
  try {
    const check = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}`,
      { headers: { Authorization: `token ${token}`, "User-Agent": "e7-chart" } }
    );
    if (check.ok) {
      const existing = await check.json();
      sha = existing.sha;
    }
  } catch { /* file doesn't exist yet, sha stays undefined */ }

  // Create or update the file
  const payload = {
    message: `upload ${folder}/${filename}`,
    content: base64,
    branch:  BRANCH,
    ...(sha ? { sha } : {}),
  };

  try {
    const apiRes = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${path}`,
      {
        method:  "PUT",
        headers: { Authorization: `token ${token}`, "Content-Type": "application/json", "User-Agent": "e7-chart" },
        body:    JSON.stringify(payload),
      }
    );
    const result = await apiRes.json();
    if (!apiRes.ok) return res.status(apiRes.status).json({ error: result.message || "GitHub API error" });

    const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${path}`;
    return res.status(200).json({ url });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
