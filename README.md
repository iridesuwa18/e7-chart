# Epic Seven — Character Quadrant Chart

A personal web app to place E7 heroes on a 4-quadrant chart
(Speed vs Slow / Survivability vs Requires Support).

Data is saved privately to a GitHub Gist via Vercel serverless functions.
Your token never touches the browser.

---

## Setup (one time, ~10 minutes)

### 1. Create a GitHub Gist
1. Go to https://gist.github.com
2. Create a new **secret** gist
3. Filename: `epicseven_heroes.json`, content: `{"heroes":[]}`
4. Copy the Gist ID from the URL:
   `https://gist.github.com/YOUR_USERNAME/THIS_PART_IS_THE_ID`

### 2. Create a GitHub Personal Access Token
1. Go to https://github.com/settings/tokens
2. Click **Generate new token (classic)**
3. Give it a name (e.g. "E7 Chart")
4. Check only the **gist** scope
5. Click Generate — copy the token (`ghp_...`)

### 3. Push this project to GitHub
```
git init
git add .
git commit -m "init"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 4. Deploy to Vercel
1. Go to https://vercel.com and sign in with GitHub
2. Click **Add New Project** → import your repo
3. Leave all settings as default, click **Deploy**
4. Once deployed, go to **Settings → Environment Variables** and add:

| Name           | Value                        |
|----------------|------------------------------|
| `GITHUB_TOKEN` | `ghp_xxxxxxxxxxxxxxxxxxxx`   |
| `GIST_ID`      | `your_gist_id_here`          |

5. Go to **Deployments** → click the three dots → **Redeploy** (so it picks up the env vars)

### Done!
Visit your Vercel URL. Use **↑ Save** and **↓ Load** to sync data.

---

## File structure
```
/
├── index.html       ← Main UI
├── style.css        ← Blue & gold theme
├── app.js           ← Chart logic, drag & drop, modal
├── vercel.json      ← Routing config
└── api/
    ├── save.js      ← POST /api/save  (writes to Gist)
    └── load.js      ← GET  /api/load  (reads from Gist)
```

## Notes
- Data autosaves to **localStorage** on every drag/edit, so it persists between sessions even without GitHub sync.
- GitHub is your cloud backup/sync — hit **↑ Save** when you want to commit changes.
- The token is only ever on Vercel's servers, never in the browser.
