// api/save.js
// Saves hero + draft JSON to iridesuwa18/e7-chart as data/e7_data.json.
// Images are already URLs (uploaded separately via api/upload-image.js).
// Env vars required: GITHUB_TOKEN, ADMIN_PASSWORD

const REPO   = "iridesuwa18/e7-chart";
const BRANCH = "main";
const PATH   = "data/e7_data.json";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://iridesuwa18.github.io");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const token         = process.env.GITHUB_TOKEN;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!token)         return res.status(500).json({ error: "GITHUB_TOKEN not set" });
  if (!adminPassword) return res.status(500).json({ error: "ADMIN_PASSWORD not set" });

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: "Invalid JSON body" }); }

  if (!body.password || body.password !== adminPassword)
    return res.status(401).json({ error: "Incorrect password. Admin access only." });

  const { heroes, draftData, taxonomy } = body;
  if (!Array.isArray(heroes))
    return res.status(400).json({ error: "heroes must be an array" });

  const content = JSON.stringify({
    heroes,
    draftData: draftData || null,
    // Reaction / Engagement / Factor library (Rebuild Spec Section 1.1) —
    // a third top-level key alongside heroes/draftData. Same blind-overwrite
    // contract as draftData above: the caller (app.js) is expected to
    // always send its current in-memory taxonomy, not just diffs.
    taxonomy: taxonomy || { reactions: [], engagements: [], factors: [] },
    schemaVersion: 2,
    savedAt: new Date().toISOString(),
  }, null, 2);

  // Base64-encode the JSON content for the GitHub API
  const encoded = Buffer.from(content, "utf8").toString("base64");

  // Check if file already exists (need its SHA to update)
  let sha;
  try {
    const check = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${PATH}?ref=${BRANCH}`,
      { headers: { Authorization: `token ${token}`, "User-Agent": "e7-chart" } }
    );
    if (check.ok) { const existing = await check.json(); sha = existing.sha; }
  } catch { /* file doesn't exist yet */ }

  try {
    const apiRes = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${PATH}`,
      {
        method:  "PUT",
        headers: { Authorization: `token ${token}`, "Content-Type": "application/json", "User-Agent": "e7-chart" },
        body: JSON.stringify({
          message: `update e7 data ${new Date().toISOString()}`,
          content: encoded,
          branch:  BRANCH,
          ...(sha ? { sha } : {}),
        }),
      }
    );
    const data = await apiRes.json();
    if (!apiRes.ok) return res.status(apiRes.status).json({ error: data.message || "GitHub API error" });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
