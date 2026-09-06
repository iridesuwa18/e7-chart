// api/load.js
// Loads hero + draft JSON from iridesuwa18/e7-chart data/e7_data.json.
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

  try {
    const apiRes = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${PATH}?ref=${BRANCH}`,
      { headers: { Authorization: `token ${token}`, "User-Agent": "e7-chart" } }
    );
    const data = await apiRes.json();
    if (!apiRes.ok) return res.status(apiRes.status).json({ error: data.message || "GitHub API error" });

    const parsed = JSON.parse(Buffer.from(data.content, "base64").toString("utf8"));
    return res.status(200).json({
      heroes:    parsed.heroes    || [],
      draftData: parsed.draftData || null,
      taxonomy:  parsed.taxonomy  || { reactions: [], engagements: [], factors: [] },
      // Rebuild Spec Section 10.1/10.2 — pass the stored schema marker
      // straight through so the client can tell a genuinely old blob
      // (written before this field existed) apart from a current one.
      // save.js always stamps schemaVersion, so its absence here means
      // the file predates Section 10 entirely.
      schemaVersion: typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 0,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
