// api/saved-at.js
// Returns ONLY the savedAt timestamp from data/e7_data.json — no heroes,
// no taxonomy, no draftData. Exists purely so the "Last saved"/sync-
// status indicator (app.js: checkSyncStatus, polled every 45s while a
// tab is open) doesn't have to pull the entire saved blob over the
// wire just to compare one timestamp. Same GitHub file and auth as
// api/public-load.js — this is a trimmed-down sibling of it, not a
// separate data source, so the two can never disagree about what's
// actually saved.
// No password — read-only public endpoint, same as api/public-load.js.
// Env vars required: GITHUB_TOKEN

const REPO   = "iridesuwa18/e7-chart";
const BRANCH = "main";
const PATH   = "data/e7_data.json";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://iridesuwa18.github.io");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: "GITHUB_TOKEN not set" });

  try {
    // Still has to fetch the whole file from GitHub internally (there's
    // no cheaper way to read one field out of a single JSON blob file),
    // but that GitHub-to-Vercel hop isn't what was piling up — the part
    // that mattered was the Vercel-to-browser response, which this
    // trims down to just the one field that's actually needed.
    const apiRes = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${PATH}?ref=${BRANCH}`,
      { headers: { Authorization: `token ${token}`, "User-Agent": "e7-chart" } }
    );
    const data = await apiRes.json();
    if (!apiRes.ok) return res.status(apiRes.status).json({ error: data.message || "GitHub API error" });

    const parsed = JSON.parse(Buffer.from(data.content, "base64").toString("utf8"));
    return res.status(200).json({ savedAt: parsed.savedAt || null });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
