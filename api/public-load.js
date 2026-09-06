// api/public-load.js
// Loads hero + draft JSON from iridesuwa18/e7-chart data/e7_data.json.
// No password — read-only public endpoint for all visitors.
// Env vars required: GITHUB_TOKEN

const REPO   = "iridesuwa18/e7-chart";
const BRANCH = "main";
const PATH   = "data/e7_data.json";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://iridesuwa18.github.io");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: "GITHUB_TOKEN not set" });

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
      // See api/load.js — same Section 10 schema-marker passthrough,
      // needed here too since this is the endpoint every visitor's
      // page load actually calls (autoLoadFromServer).
      schemaVersion: typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 0,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
