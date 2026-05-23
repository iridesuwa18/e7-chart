/* ═══════════════════════════════════════════════════════════════
   EPIC SEVEN — draft.js  (Session 1)
   Mounted inside #draft-root by Babel/React from the chart page.

   DATA MODEL:
   - window.chartHeroes  → the chart's live heroes array (shared)
     Each hero in chart has: id, name, rarity, role, element,
     iconData, vType, vScore, hType, hScore, notes, locked.
     Draft enriches each hero with extra fields stored on the
     same object: dClass, dRoles[], buffs[], debuffs[],
     strengths[], weaknesses[], counters[], strongAgainst[],
     synergies[], note (draft note).

   - localStorage "e7draft_data" → draft-only data:
     { buffs[], debuffs[], strengths[], weaknesses[],
       roles[], uniqueRoles[], settings:{classIcons,elementIcons} }

   SESSION PLAN:
   ✅ Session 1 — Heroes view, hero editor (all draft fields),
                  image picker, data bridge, save/load
   🔲 Session 2 — Tags view (buffs/debuffs/strengths/weaknesses/
                  roles/uniqueRoles) with full bulk-edit
   🔲 Session 3 — Draft picker (5v5, team analysis, synergy
                  glows, strength/weakness highlighting)
═══════════════════════════════════════════════════════════════ */

const { useState, useEffect, useMemo, useCallback, useRef } = React;

/* ── Constants ── */
const DRAFT_STORAGE_KEY = "e7draft_data";
const DRAFT_SCHEMA_VER  = 1;

const EL_META = {
  fire:  { label:"Fire",        color:"#b84830" },
  water: { label:"Water",       color:"#2e82b8" },
  earth: { label:"Earth",       color:"#488040" },
  light: { label:"Light",       color:"#b89820" },
  dark:  { label:"Dark",        color:"#6838a8" },
};
const CL_META = {
  KN:{ label:"Knight"     },
  WA:{ label:"Warrior"    },
  MG:{ label:"Mage"       },
  RG:{ label:"Ranger"     },
  SW:{ label:"Soul Weaver"},
  TH:{ label:"Thief"      },
};
const DEFAULT_ROLES = [
  "Opener","Tank","Bruiser","DPS","Healer",
  "Buffer","Debuffer","Cleanser","Reviver","Counter",
];
const RC = {
  Opener:"#c8a020", Tank:"#2868b0", Bruiser:"#5848a8", DPS:"#b03820",
  Healer:"#287850", Buffer:"#208888", Debuffer:"#a82860",
  Cleanser:"#5890a8", Reviver:"#60a040", Counter:"#a87020",
};
const EL_BEATS = {
  fire:"earth", water:"fire", earth:"water", dark:"light", light:"dark",
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,5);

/* ── Fresh draft-only data ── */
function freshDraftData() {
  return {
    version: DRAFT_SCHEMA_VER,
    buffs:[], debuffs:[], strengths:[], weaknesses:[],
    roles:[], uniqueRoles:[],
    settings: { classIcons:{}, elementIcons:{} },
  };
}

/* ── Migrate / normalise draft data from storage ── */
function migrateDraftData(raw) {
  let d;
  try { d = typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch { return freshDraftData(); }
  if (!d || typeof d !== "object") return freshDraftData();
  const ft = t => ({ id:t.id??uid(), name:t.name??"", icon:t.icon??"", color:t.color??"#888888", createdAt:t.createdAt??Date.now(), ...(t.parentId?{parentId:t.parentId}:{}) });
  const fs = s => ({ id:s.id??uid(), name:s.name??"", icon:s.icon??"", linkedBuffs:s.linkedBuffs??[], linkedDebuffs:s.linkedDebuffs??[], linkedRoles:s.linkedRoles??[], synergizedRoles:s.synergizedRoles??[], teamSupportRoles:s.teamSupportRoles??[], createdAt:s.createdAt??Date.now(), ...(s.parentId?{parentId:s.parentId}:{}) });
  const fr = r => ({ id:r.id??uid(), name:r.name??"", color:r.color??"#888888", createdAt:r.createdAt??Date.now() });
  const fu = u => ({ id:u.id??uid(), name:u.name??"", color:u.color??"#888888", matchAll:u.matchAll??false, linkedBuffs:u.linkedBuffs??[], linkedDebuffs:u.linkedDebuffs??[], linkedStrengths:u.linkedStrengths??[], linkedWeaknesses:u.linkedWeaknesses??[], linkedElements:u.linkedElements??[], createdAt:u.createdAt??Date.now() });
  return {
    version:     DRAFT_SCHEMA_VER,
    buffs:       (d.buffs??[]).map(ft),
    debuffs:     (d.debuffs??[]).map(ft),
    strengths:   (d.strengths??[]).map(fs),
    weaknesses:  (d.weaknesses??[]).map(fs),
    roles:       (d.roles??[]).map(fr),
    uniqueRoles: (d.uniqueRoles??[]).map(fu),
    settings:    { classIcons:{}, elementIcons:{}, ...(d.settings??{}) },
  };
}

/* ── Enrich a chart hero with draft defaults if missing ── */
function enrichHero(h) {
  return {
    dClass:       h.dClass       ?? "KN",
    dElement:     h.dElement     ?? h.element ?? "fire",
    dRoles:       h.dRoles       ?? [],
    buffs:        h.buffs        ?? [],
    debuffs:      h.debuffs      ?? [],
    strengths:    h.strengths    ?? [],
    weaknesses:   h.weaknesses   ?? [],
    counters:     h.counters     ?? [],
    strongAgainst:h.strongAgainst?? [],
    synergies:    h.synergies    ?? [],
    dNote:        h.dNote        ?? "",
    ...h,
  };
}

/* ── Persistence ── */
function loadDraftData() {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (raw) return migrateDraftData(raw);
  } catch {}
  return freshDraftData();
}
function saveDraftData(d) {
  try { localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(d)); } catch {}
}

/* ── Blank constructors ── */
const blankTag       = (parentId=null) => ({ id:uid(), name:"", icon:"", color:"#888888", createdAt:Date.now(), ...(parentId?{parentId}:{}) });
const blankSW        = (parentId=null) => ({ id:uid(), name:"", icon:"", linkedBuffs:[], linkedDebuffs:[], linkedRoles:[], synergizedRoles:[], teamSupportRoles:[], createdAt:Date.now(), ...(parentId?{parentId}:{}) });
const blankRole      = () => ({ id:uid(), name:"", color:"#888888", createdAt:Date.now() });
const blankUniqueRole= () => ({ id:uid(), name:"", color:"#888888", matchAll:false, linkedBuffs:[], linkedDebuffs:[], linkedStrengths:[], linkedWeaknesses:[], linkedElements:[], createdAt:Date.now() });

/* ── Colour palette ── */
const PALETTE_KEY = "e7draft_palette";
const PALETTE_MAX = 16;
function loadPalette()  { try { return JSON.parse(localStorage.getItem(PALETTE_KEY)||"[]"); } catch { return []; } }
function savePalette(c) { try { localStorage.setItem(PALETTE_KEY, JSON.stringify(c)); } catch {} }
function addToPalette(color) {
  if (!color || color==="#888888") return;
  let p = loadPalette().filter(c=>c.toLowerCase()!==color.toLowerCase());
  p = [color,...p].slice(0,PALETTE_MAX);
  savePalette(p);
}

/* ── Sort helper ── */
const sorted = (arr, s) => [...arr].sort((a,b) =>
  s==="az" ? (a.name||"").localeCompare(b.name||"") : (b.createdAt||0)-(a.createdAt||0)
);

/* ── Unique role auto-assign ── */
function getHeroUniqueRoles(hero, uniqueRoles) {
  return (uniqueRoles||[]).filter(ur => {
    const checks = [
      ...(ur.linkedBuffs||[]).map(id => (hero.buffs||[]).includes(id)),
      ...(ur.linkedDebuffs||[]).map(id => (hero.debuffs||[]).includes(id)),
      ...(ur.linkedStrengths||[]).map(id => (hero.strengths||[]).includes(id)),
      ...(ur.linkedWeaknesses||[]).map(id => (hero.weaknesses||[]).includes(id)),
      ...(ur.linkedElements||[]).map(el => (hero.dElement||hero.element) === el),
    ];
    if (!checks.length) return false;
    return ur.matchAll ? checks.every(Boolean) : checks.some(Boolean);
  });
}

/* ── Image compression ── */
function compressImage(src, size=256, quality=0.85) {
  return new Promise(resolve => {
    if (!src || !src.startsWith("data:")) { resolve(src); return; }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#000"; ctx.fillRect(0,0,size,size);
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width-s)/2, (img.height-s)/2, s, s, 0, 0, size, size);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

/* ── Upload image to GitHub repo ── */
// folder: "heroes" for hero icons, "icons" for tag/class/element icons
async function uploadImage(base64, folder) {
  if (!base64 || !base64.startsWith("data:")) return base64; // already a URL or text label
  try {
    const ext      = base64.startsWith("data:image/png") ? "png" : "jpg";
    const filename = `${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}.${ext}`;
    const res = await fetch("https://e7-chart.vercel.app/api/upload-image", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ data: base64, folder, filename }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Upload failed");
    return json.url; // raw.githubusercontent.com URL
  } catch (e) {
    console.warn("Image upload failed, falling back to base64:", e.message);
    return base64; // fallback: keep base64 so nothing is lost
  }
}

/* ── File Manager Modal ── */
// Opens after cropping an image. Password-gates access to the repo folder,
// lets the user name / replace / delete images, then commits everything in one go.
function FileManagerModal({ croppedData, folder, onSave, onCancel }) {
  const [step,       setStep]       = useState("password"); // "password" | "manager"
  const [pw,         setPw]         = useState("");
  const [pwErr,      setPwErr]      = useState("");
  const [verifying,  setVerifying]  = useState(false);
  const [verifiedPw, setVerifiedPw] = useState("");
  const [images,     setImages]     = useState([]);          // [{name,sha,url}]
  const [filename,   setFilename]   = useState("");
  const [replaceTarget, setReplaceTarget] = useState(null); // {name,sha,url} | null
  const [pendingDeletes, setPendingDeletes] = useState(new Set()); // Set<name>
  const [saving,  setSaving]  = useState(false);
  const [saveErr, setSaveErr] = useState("");

  const ext = (croppedData || "").startsWith("data:image/png") ? "png" : "jpg";

  async function verifyAndLoad() {
    if (!pw) { setPwErr("Please enter the password."); return; }
    setVerifying(true);
    setPwErr("");
    try {
      const res  = await fetch(
        `https://e7-chart.vercel.app/api/repo-images?folder=${folder}&password=${encodeURIComponent(pw)}`
      );
      const data = await res.json();
      if (!res.ok) { setPwErr(data.error || "Wrong password"); setVerifying(false); return; }
      setImages(data.images || []);
      setVerifiedPw(pw);
      setStep("manager");
    } catch (e) {
      setPwErr("Network error: " + e.message);
    }
    setVerifying(false);
  }

  function toggleDelete(img) {
    // Unmark replace target if it gets deleted
    if (replaceTarget?.name === img.name) setReplaceTarget(null);
    setPendingDeletes(s => {
      const n = new Set(s);
      n.has(img.name) ? n.delete(img.name) : n.add(img.name);
      return n;
    });
  }

  function selectReplace(img) {
    if (replaceTarget?.name === img.name) { setReplaceTarget(null); return; }
    setReplaceTarget(img);
    // Un-delete it if it was marked
    setPendingDeletes(s => { const n = new Set(s); n.delete(img.name); return n; });
  }

  async function handleSave() {
    setSaving(true);
    setSaveErr("");
    try {
      // Determine final filename
      let finalFilename;
      if (replaceTarget) {
        finalFilename = replaceTarget.name;
      } else {
        const clean = filename.trim().replace(/[^a-zA-Z0-9._-]/g, "-").replace(/[-]+/g, "-").replace(/^-|-$/g, "");
        if (!clean) { setSaveErr("Please enter a filename."); setSaving(false); return; }
        // Append extension only if not already present
        finalFilename = /\.(jpe?g|png|webp|gif)$/i.test(clean) ? clean : `${clean}.${ext}`;
      }

      // Upload the new image (upload-image.js handles replace via SHA lookup)
      const uploadRes = await fetch("https://e7-chart.vercel.app/api/upload-image", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ data: croppedData, folder, filename: finalFilename }),
      });
      const uploadJson = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadJson.error || "Upload failed");

      // Delete pending images (skip replace target — it was just overwritten)
      const toDelete = [...pendingDeletes]
        .filter(n => n !== finalFilename)
        .map(n => { const img = images.find(i => i.name === n); return img ? { name: img.name, sha: img.sha } : null; })
        .filter(Boolean);

      if (toDelete.length > 0) {
        await fetch("https://e7-chart.vercel.app/api/repo-images", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ folder, deletes: toDelete, password: verifiedPw }),
        });
      }

      onSave(uploadJson.url);
    } catch (e) {
      setSaveErr(e.message);
    }
    setSaving(false);
  }

  // ── Password step ──
  if (step === "password") {
    return (
      <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.88)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:10000, padding:16 }}>
        <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderTop:`2px solid ${T.gold}`, borderRadius:6, padding:"22px 22px 18px", width:420, maxWidth:"96vw", boxShadow:"0 20px 60px rgba(0,0,0,.8)" }}>
          <div style={{ fontFamily:"Cinzel,serif", color:T.gold2, fontSize:13, letterSpacing:".25em", marginBottom:14, paddingBottom:10, borderBottom:`1px solid ${T.goldDim}` }}>
            📁 REPO FILE MANAGER
          </div>
          <p style={{ fontSize:13, color:T.dim, fontFamily:"'Crimson Pro',serif", marginBottom:16, lineHeight:1.7 }}>
            Enter your admin password to open the&nbsp;
            <strong style={{ color:T.gold }}>assets/{folder}/</strong> folder in your GitHub repo.
          </p>
          <Field label="Password">
            <input type="password" value={pw} onChange={e=>setPw(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&verifyAndLoad()}
              placeholder="Enter admin key…" style={INP} autoFocus/>
          </Field>
          {pwErr && <div style={{ fontSize:12, color:"#e07070", background:"rgba(192,57,43,.1)", border:"1px solid #5a2020", borderRadius:3, padding:"6px 10px", marginBottom:10 }}>{pwErr}</div>}
          <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:16 }}>
            <Btn onClick={onCancel}>Cancel</Btn>
            <Btn variant="primary" onClick={verifyAndLoad} disabled={verifying}>{verifying ? "Verifying…" : "Open Manager"}</Btn>
          </div>
        </div>
      </div>
    );
  }

  // ── Manager step ──
  const previewName = replaceTarget
    ? replaceTarget.name
    : (filename.trim() ? `${filename.trim().replace(/[^a-zA-Z0-9._-]/g,"-")}.${ext}` : `(enter filename).${ext}`);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.88)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:10000, padding:16, overflowY:"auto" }}>
      <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderTop:`2px solid ${T.gold}`, borderRadius:6, padding:"22px 22px 18px", width:660, maxWidth:"96vw", maxHeight:"92vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,.8)" }}>

        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, paddingBottom:10, borderBottom:`1px solid ${T.goldDim}` }}>
          <span style={{ fontFamily:"Cinzel,serif", color:T.gold2, fontSize:12, letterSpacing:".22em" }}>
            📁 assets/{folder}/ · {images.length} image{images.length!==1?"s":""}
          </span>
          <button onClick={onCancel} style={{ background:"none", border:"none", color:T.dim, fontSize:18, cursor:"pointer", lineHeight:1 }}>×</button>
        </div>

        {/* New image + filename */}
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:4, padding:"12px 14px", marginBottom:18, display:"flex", gap:14, alignItems:"flex-start", flexWrap:"wrap" }}>
          {/* Preview */}
          <div style={{ flexShrink:0, display:"flex", flexDirection:"column", alignItems:"center", gap:5 }}>
            <div style={{ fontFamily:"Cinzel,serif", fontSize:8, color:T.dim, letterSpacing:".2em" }}>NEW IMAGE</div>
            <img src={croppedData} alt="" style={{ width:64, height:64, borderRadius:4, objectFit:"cover", border:`2px solid ${T.gold}`, display:"block" }}/>
          </div>

          {/* Filename / replace selector */}
          <div style={{ flex:1, minWidth:220 }}>
            <Field label={replaceTarget ? "Will replace existing file" : "Filename (without extension)"}>
              {replaceTarget ? (
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <img src={replaceTarget.url} alt="" style={{ width:36, height:36, borderRadius:3, objectFit:"cover", border:`1px solid ${T.gold}`, flexShrink:0 }}/>
                  <span style={{ fontSize:12, color:T.gold, fontFamily:"'Crimson Pro',serif", flex:1, wordBreak:"break-all" }}>{replaceTarget.name}</span>
                  <button onClick={()=>setReplaceTarget(null)}
                    style={{ background:"none", border:`1px solid ${T.border}`, color:T.dim, padding:"2px 8px", borderRadius:2, fontSize:10, cursor:"pointer", flexShrink:0 }}>
                    Clear
                  </button>
                </div>
              ) : (
                <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                  <input value={filename} onChange={e=>setFilename(e.target.value)}
                    placeholder="e.g. ruele-of-light" style={{...INP, flex:1}}/>
                  <span style={{ fontSize:11, color:T.dim, fontFamily:"'Crimson Pro',serif", flexShrink:0 }}>.{ext}</span>
                </div>
              )}
            </Field>
            <div style={{ fontSize:11, color:T.dim, fontFamily:"'Crimson Pro',serif", marginTop:2, lineHeight:1.6 }}>
              Saves as: <span style={{ color:T.gold2 }}>{previewName}</span>
              {!replaceTarget && images.length > 0 && (
                <span style={{ color:T.dim }}> · Or click an existing image below to replace it instead</span>
              )}
            </div>
          </div>
        </div>

        {/* Existing images grid */}
        {images.length > 0 && (
          <>
            <div style={{ fontFamily:"Cinzel,serif", fontSize:9, color:T.dim, letterSpacing:".2em", marginBottom:8, display:"flex", alignItems:"center", gap:8 }}>
              EXISTING IMAGES
              {pendingDeletes.size > 0 && (
                <span style={{ color:"#e07070", fontSize:9 }}>· {pendingDeletes.size} marked for deletion</span>
              )}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(88px,1fr))", gap:7, marginBottom:16, maxHeight:280, overflowY:"auto", padding:2 }}>
              {images.map(img => {
                const isReplace = replaceTarget?.name === img.name;
                const isDelete  = pendingDeletes.has(img.name);
                return (
                  <div key={img.name}
                    onClick={() => !isDelete && selectReplace(img)}
                    style={{ position:"relative", border:`2px solid ${isReplace?T.gold:isDelete?"#c0392b":T.border}`, borderRadius:4, overflow:"hidden", background:T.card, cursor:isDelete?"default":"pointer", opacity:isDelete?0.35:1, transition:"all 0.15s" }}>
                    <img src={img.url} alt={img.name} style={{ width:"100%", aspectRatio:"1", objectFit:"cover", display:"block" }}/>
                    {isReplace && (
                      <div style={{ position:"absolute", inset:0, background:"rgba(201,162,39,.25)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                        <span style={{ fontFamily:"Cinzel,serif", fontSize:8, color:T.gold, background:"rgba(0,0,0,.85)", padding:"2px 6px", borderRadius:2, letterSpacing:1 }}>REPLACE</span>
                      </div>
                    )}
                    <div style={{ padding:"3px 5px", display:"flex", alignItems:"center", gap:3, background:"rgba(0,0,0,.75)" }}>
                      <span style={{ fontSize:7, color:T.dim, fontFamily:"'Crimson Pro',serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>{img.name}</span>
                      <button
                        onMouseDown={e=>e.stopPropagation()}
                        onClick={e=>{ e.stopPropagation(); toggleDelete(img); }}
                        title={isDelete ? "Undo delete" : "Mark for deletion"}
                        style={{ background:"none", border:"none", color:isDelete?"#e87070":"#607a90", fontSize:13, cursor:"pointer", padding:"0 1px", lineHeight:1, flexShrink:0, fontWeight:700 }}>
                        {isDelete ? "↩" : "×"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {images.length === 0 && (
          <div style={{ fontSize:12, color:T.dim, fontStyle:"italic", fontFamily:"'Crimson Pro',serif", padding:"10px 0 18px", textAlign:"center" }}>
            No images in this folder yet — yours will be the first!
          </div>
        )}

        {saveErr && (
          <div style={{ fontSize:12, color:"#e07070", background:"rgba(192,57,43,.1)", border:"1px solid #5a2020", borderRadius:3, padding:"6px 10px", marginBottom:10 }}>{saveErr}</div>
        )}

        {/* Actions */}
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end", paddingTop:14, borderTop:`1px solid ${T.border}` }}>
          <Btn onClick={onCancel}>Cancel — discard image</Btn>
          <Btn variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : `Save${pendingDeletes.size > 0 ? ` + Delete ${pendingDeletes.size}` : ""}`}
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ── Export / Import JSON ── */
async function exportJSON(chartHeroes, draftData) {
  const heroes = await Promise.all(chartHeroes.map(async h => ({
    ...h, iconData: await compressImage(h.iconData, 256, 0.85),
  })));
  const buffs     = await Promise.all((draftData.buffs||[]).map(async t => ({...t, icon: await compressImage(t.icon, 64, 0.8)})));
  const debuffs   = await Promise.all((draftData.debuffs||[]).map(async t => ({...t, icon: await compressImage(t.icon, 64, 0.8)})));
  const strengths = await Promise.all((draftData.strengths||[]).map(async t => ({...t, icon: await compressImage(t.icon, 64, 0.8)})));
  const weaknesses= await Promise.all((draftData.weaknesses||[]).map(async t => ({...t, icon: await compressImage(t.icon, 64, 0.8)})));
  const classIcons={}, elementIcons={};
  for (const [k,v] of Object.entries(draftData.settings?.classIcons||{})) classIcons[k] = await compressImage(v, 64, 0.8);
  for (const [k,v] of Object.entries(draftData.settings?.elementIcons||{})) elementIcons[k] = await compressImage(v, 64, 0.8);
  const out = JSON.stringify({ heroes, draftData:{...draftData, buffs, debuffs, strengths, weaknesses, settings:{...draftData.settings, classIcons, elementIcons}} });
  const blob = new Blob([out], {type:"application/json"});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = "e7_backup.json"; a.style.display = "none";
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}

function importJSONFile(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => { try { res(JSON.parse(e.target.result)); } catch(err){ rej(err); } };
    r.onerror = () => rej(new Error("Could not read file"));
    r.readAsText(file);
  });
}

/* ═══════════════════════════════════════════
   THEME — matches chart's CSS vars
═══════════════════════════════════════════ */
const T = {
  bg:      "#04090f",
  panel:   "#071220",
  card:    "#0b1a2e",
  border:  "#1a3050",
  gold:    "#c9a227",
  gold2:   "#e8c84a",
  goldDim: "#6a5010",
  blue:    "#1e6fa8",
  blue2:   "#3b9fd4",
  text:    "#dce8f5",
  dim:     "#607a90",
  danger:  "#c0392b",
};

const INP = {
  background: T.bg,
  border: `1px solid ${T.border}`,
  color: T.text,
  padding: "6px 10px",
  borderRadius: 3,
  fontSize: 13,
  outline: "none",
  width: "100%",
  fontFamily: "'Crimson Pro', serif",
};

/* ═══════════════════════════════════════════
   ATOMS
═══════════════════════════════════════════ */

function Ico({ src, size=32, fallback="?" }) {
  const isImg = src && (src.startsWith("data:") || src.startsWith("http") || src.startsWith("blob:"));
  const s = { width:size, height:size, minWidth:size, flexShrink:0, display:"inline-flex", alignItems:"center", justifyContent:"center", borderRadius:3, overflow:"hidden", background: isImg ? "transparent" : T.card };
  if (isImg) return <img src={src} alt="" style={{...s, objectFit:"cover", background:"#000"}}/>;
  return <span style={{...s, fontSize:Math.max(8,size*0.38), color:src?T.dim:"#607a90", fontFamily:"Cinzel,serif", textAlign:"center", lineHeight:1}}>{src||fallback}</span>;
}

function Btn({ onClick, children, variant="default", style:sx={}, disabled=false }) {
  const S = {
    default: { background:T.card,    border:`1px solid ${T.border}`, color:T.dim },
    primary: { background:T.gold,    border:"none",                  color:"#04090f", fontWeight:700 },
    danger:  { background:"#1a0808", border:`1px solid #5a1a1a`,     color:"#e07070" },
    ghost:   { background:"transparent", border:`1px solid ${T.border}`, color:T.gold },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{...S[variant], padding:"5px 12px", borderRadius:3, fontSize:11, fontFamily:"'Cinzel',serif", letterSpacing:".1em", cursor:disabled?"not-allowed":"pointer", opacity:disabled?0.5:1, transition:"background .15s, box-shadow .15s", whiteSpace:"nowrap", ...sx}}>
      {children}
    </button>
  );
}

function Field({ label, children, half }) {
  return (
    <div style={{ marginBottom:12, width:half?"50%":undefined, paddingRight:half?8:undefined }}>
      <div style={{ fontFamily:"Cinzel,serif", fontSize:9, color:T.dim, letterSpacing:"0.2em", textTransform:"uppercase", marginBottom:5 }}>{label}</div>
      {children}
    </div>
  );
}

function Pill({ active, color=T.gold, onClick, children }) {
  return (
    <button onClick={onClick} style={{ background:active?color+"22":T.card, border:`1px solid ${active?color:T.border}`, color:active?color:T.dim, padding:"3px 10px", borderRadius:2, fontSize:11, display:"inline-flex", alignItems:"center", gap:4, cursor:"pointer", fontFamily:"'Crimson Pro',serif", transition:"all 0.12s" }}>
      {children}
    </button>
  );
}

const LeafIcon = ({size=11, color="#4cba60"}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{flexShrink:0,display:"inline-block"}}>
    <path d="M17 8C8 10 5.9 16.17 3.82 21.34L5.71 22l1-2.3A4.49 4.49 0 0 0 8 20C19 20 22 3 22 3c-1 2-8 1-13 6 0 0 4-2 8-2A13.5 13.5 0 0 1 17 8Z"/>
  </svg>
);

/* ══════════════════════════════════════════
   ICON MAKER MODAL
   Creates a square icon from typed text,
   then uploads it to GitHub like any image.
══════════════════════════════════════════ */
const ICON_FONTS = [
  { label:"Cinzel (Serif)",     value:"Cinzel, Georgia, serif" },
  { label:"Crimson Pro",        value:"'Crimson Pro', Georgia, serif" },
  { label:"Sans-Serif",         value:"Arial, Helvetica, sans-serif" },
  { label:"Monospace",          value:"'Courier New', monospace" },
  { label:"Cursive",            value:"Georgia, 'Times New Roman', serif" },
];

/* Symbol categories for the picker panel */
const SYMBOL_CATS = [
  { label:"Arrows",    symbols:["↑","↓","←","→","↗","↙","↔","↕","⇑","⇓","⇒","⇐","⇔","▲","▼","◀","▶","➤","➜","➝","➞","↺","↻","⟳","⟲"] },
  { label:"Stars",     symbols:["★","☆","✦","✧","✩","✪","✫","✬","✭","✮","✯","✰","⭐","🌟","💫","✨"] },
  { label:"Combat",    symbols:["⚔","🗡","🛡","⚡","🔥","💥","⚠","☠","💀","🗝","⚙","🔩","🔱","⚜","🏹","🪃"] },
  { label:"Math",      symbols:["×","÷","±","≈","≠","≤","≥","∞","∑","∆","∇","√","∂","∫","%","‰","#","@"] },
  { label:"Shapes",    symbols:["●","○","■","□","◆","◇","▪","▫","▸","◂","◉","◎","⬛","⬜","🔶","🔷","🔸","🔹","🔺","🔻"] },
  { label:"Signs",     symbols:["✓","✗","✘","✕","⊕","⊖","⊗","⊘","⊙","⊚","⊛","⊜","⊝","⊞","⊟","⊠","⊡","⊢","⊣"] },
  { label:"Hands",     symbols:["👆","👇","👈","👉","☝","✌","🤞","👍","👎","✊","👊","🤜","🤛","🙌","🤝","👐","🤲"] },
  { label:"Status",    symbols:["❤","🧡","💛","💚","💙","💜","🖤","🤍","💔","❌","⭕","🔴","🟡","🟢","🔵","⚫","⚪"] },
  { label:"Time",      symbols:["⏳","⌛","⏰","⏱","⏲","🕐","🕑","🕒","🕓","🕔","🕕","🕖","🕗","🕘","🕙","🕚","🕛"] },
  { label:"E7 / RPG",  symbols:["⚡","🌀","❄","🔥","💧","🌿","☀","🌙","🌑","💎","👁","🐉","🦅","🦁","🐺","🗺","⚗","🧪","🔮","🧿","🏆","🥇","🪄","📜"] },
];

function IconMakerModal({ folder, onSave, onClose }) {
  const SIZE = 256;
  const canvasRef   = useRef();
  const inputRef    = useRef();
  const [text,      setText]      = useState("★");
  const [font,      setFont]      = useState(ICON_FONTS[0].value);
  const [textColor, setTextColor] = useState("#e8c84a");
  const [bgColor,   setBgColor]   = useState("#0d1526");
  const [fontSize,  setFontSize]  = useState(120);
  const [shadow,    setShadow]    = useState(true);
  const [uploading, setUploading] = useState(false);
  const [err,       setErr]       = useState("");
  const [symCat,    setSymCat]    = useState(0); // active symbol category index

  // Insert a symbol at the cursor position (or append)
  function insertSymbol(sym) {
    const input = inputRef.current;
    if (!input) { setText(t => (t + sym).slice(0, 8)); return; }
    const start = input.selectionStart ?? text.length;
    const end   = input.selectionEnd   ?? text.length;
    const next  = (text.slice(0, start) + sym + text.slice(end)).slice(0, 8);
    setText(next);
    // Restore focus + move cursor after inserted symbol
    requestAnimationFrame(() => {
      input.focus();
      const pos = Math.min(start + [...sym].length, 8);
      input.setSelectionRange(pos, pos);
    });
  }

  // Re-draw canvas whenever any option changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = bgColor === "transparent" ? "#1a2a40" : bgColor;
    ctx.fillRect(0, 0, SIZE, SIZE);

    const fs = Math.max(8, Math.min(220, fontSize));
    ctx.font         = `bold ${fs}px ${font}`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";

    if (shadow) {
      ctx.shadowColor   = "rgba(0,0,0,0.7)";
      ctx.shadowBlur    = 10;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
    } else {
      ctx.shadowColor = "transparent";
      ctx.shadowBlur  = 0;
    }

    ctx.fillStyle = textColor;
    ctx.fillText(text || "?", SIZE / 2, SIZE / 2);
  }, [text, font, textColor, bgColor, fontSize, shadow]);

  async function handleSave() {
    setErr("");
    setUploading(true);
    try {
      const canvas = canvasRef.current;
      const dataUrl = canvas.toDataURL("image/png");
      const url = await uploadImage(dataUrl, folder);
      onSave(url);
    } catch(e) {
      setErr("Upload failed: " + e.message);
    }
    setUploading(false);
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.88)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:10000, padding:16 }}>
      <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderTop:`2px solid ${T.gold}`, borderRadius:6, padding:"22px 22px 18px", width:560, maxWidth:"96vw", maxHeight:"92vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,.8)" }}>

        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, paddingBottom:10, borderBottom:`1px solid ${T.goldDim}` }}>
          <span style={{ fontFamily:"Cinzel,serif", color:T.gold2, fontSize:13, letterSpacing:".25em" }}>✏ ICON MAKER</span>
          <button onClick={onClose} style={{ background:"none", border:"none", color:T.dim, fontSize:18, cursor:"pointer", lineHeight:1 }}>×</button>
        </div>

        <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
          {/* Preview */}
          <div style={{ flexShrink:0, display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
            <canvas ref={canvasRef} width={SIZE} height={SIZE}
              style={{ width:160, height:160, borderRadius:6, border:`2px solid ${T.gold}`, display:"block", imageRendering:"pixelated" }}/>
            <span style={{ fontSize:10, color:T.dim, fontFamily:"Cinzel,serif", letterSpacing:1 }}>PREVIEW</span>
          </div>

          {/* Controls */}
          <div style={{ flex:1, minWidth:200, display:"flex", flexDirection:"column", gap:10 }}>

            {/* Text input */}
            <Field label="Text / Abbreviation">
              <div style={{ display:"flex", gap:4 }}>
                <input ref={inputRef} value={text} onChange={e=>setText(e.target.value.slice(0,8))}
                  placeholder="e.g.  ATK↑  or  ★" maxLength={8}
                  style={{...INP, fontSize:16, letterSpacing:2, textAlign:"center", flex:1}}/>
                {text && (
                  <button onClick={()=>setText("")}
                    style={{ background:"none", border:`1px solid ${T.border}`, color:T.dim, borderRadius:3, padding:"0 8px", fontSize:11, cursor:"pointer" }}>✕</button>
                )}
              </div>
            </Field>

            {/* ── Symbol Picker ── */}
            <div style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:4, overflow:"hidden" }}>
              {/* Category tabs */}
              <div style={{ display:"flex", overflowX:"auto", borderBottom:`1px solid ${T.border}`, background:T.panel }}>
                {SYMBOL_CATS.map((cat, i) => (
                  <button key={i} onClick={()=>setSymCat(i)}
                    style={{ background:symCat===i?T.gold+"22":"none", border:"none", borderBottom:symCat===i?`2px solid ${T.gold}`:"2px solid transparent", color:symCat===i?T.gold:T.dim, padding:"5px 9px", fontSize:9, fontFamily:"Cinzel,serif", letterSpacing:.5, cursor:"pointer", whiteSpace:"nowrap", flexShrink:0, transition:"all .1s" }}>
                    {cat.label}
                  </button>
                ))}
              </div>
              {/* Symbol grid */}
              <div style={{ display:"flex", flexWrap:"wrap", gap:2, padding:6 }}>
                {SYMBOL_CATS[symCat].symbols.map((sym, i) => (
                  <button key={i} onClick={()=>insertSymbol(sym)} title={`Insert "${sym}"`}
                    style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:3, width:30, height:30, fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:T.text, flexShrink:0, transition:"background .1s, border-color .1s" }}
                    onMouseEnter={e=>{ e.currentTarget.style.background=T.gold+"22"; e.currentTarget.style.borderColor=T.gold; }}
                    onMouseLeave={e=>{ e.currentTarget.style.background=T.card; e.currentTarget.style.borderColor=T.border; }}>
                    {sym}
                  </button>
                ))}
              </div>
              <div style={{ padding:"2px 8px 6px", fontSize:10, color:T.dim, fontFamily:"'Crimson Pro',serif", fontStyle:"italic" }}>
                Click to insert at cursor · max 8 chars
              </div>
            </div>

            <Field label="Font">
              <select value={font} onChange={e=>setFont(e.target.value)} style={{...INP, cursor:"pointer"}}>
                {ICON_FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </Field>

            <Field label={`Font Size: ${fontSize}px`}>
              <input type="range" min={8} max={220} step={1} value={fontSize}
                onChange={e=>setFontSize(Number(e.target.value))}
                style={{ width:"100%", accentColor:T.gold }}/>
            </Field>

            <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
              <div style={{ flex:1, minWidth:120 }}>
                <Field label="Text Colour">
                  <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                    <input type="color" value={textColor} onChange={e=>setTextColor(e.target.value)}
                      style={{ width:32, height:28, border:"none", background:"none", cursor:"pointer", padding:0 }}/>
                    <input value={textColor} onChange={e=>setTextColor(e.target.value)}
                      style={{...INP, width:80, fontSize:11}}/>
                  </div>
                </Field>
              </div>
              <div style={{ flex:1, minWidth:120 }}>
                <Field label="Background">
                  <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                    <input type="color" value={bgColor==="transparent"?"#000000":bgColor} onChange={e=>setBgColor(e.target.value)}
                      style={{ width:32, height:28, border:"none", background:"none", cursor:"pointer", padding:0 }}/>
                    <input value={bgColor} onChange={e=>setBgColor(e.target.value)}
                      style={{...INP, width:80, fontSize:11}}/>
                  </div>
                </Field>
              </div>
            </div>

            <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", userSelect:"none" }}>
              <input type="checkbox" checked={shadow} onChange={e=>setShadow(e.target.checked)}
                style={{ accentColor:T.gold, width:14, height:14 }}/>
              <span style={{ fontSize:12, color:T.dim, fontFamily:"'Crimson Pro',serif" }}>Drop shadow</span>
            </label>

            {/* Quick bg presets */}
            <div>
              <div style={{ fontSize:10, color:T.dim, fontFamily:"Cinzel,serif", letterSpacing:1, marginBottom:4 }}>QUICK BACKGROUNDS</div>
              <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                {["#0d1526","#1a0a0a","#0a1a0a","#1a1a0a","#0a0a1a","#1a0a1a","#000000","#1c2533"].map(c => (
                  <div key={c} onClick={()=>setBgColor(c)} title={c}
                    style={{ width:22, height:22, borderRadius:3, background:c, cursor:"pointer", border:`2px solid ${c===bgColor?T.gold:T.border}`, flexShrink:0 }}/>
                ))}
              </div>
            </div>

            {/* Quick text color presets */}
            <div>
              <div style={{ fontSize:10, color:T.dim, fontFamily:"Cinzel,serif", letterSpacing:1, marginBottom:4 }}>QUICK TEXT COLOURS</div>
              <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                {["#e8c84a","#208888","#a82860","#3a7a50","#7a3030","#5070a8","#c06060","#ffffff","#60c0e0"].map(c => (
                  <div key={c} onClick={()=>setTextColor(c)} title={c}
                    style={{ width:22, height:22, borderRadius:3, background:c, cursor:"pointer", border:`2px solid ${c===textColor?T.gold:T.border}`, flexShrink:0 }}/>
                ))}
              </div>
            </div>
          </div>
        </div>

        {err && <div style={{ fontSize:12, color:"#e07070", background:"rgba(192,57,43,.1)", border:"1px solid #5a2020", borderRadius:3, padding:"6px 10px", marginTop:10 }}>{err}</div>}

        <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:16, paddingTop:12, borderTop:`1px solid ${T.border}` }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={handleSave} disabled={uploading||!text.trim()}>
            {uploading ? "Uploading…" : "✓ Save Icon to Repo"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ── Modal wrapper ── */
function Modal({ title, onClose, children, width=600, maxH="90vh" }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.75)", backdropFilter:"blur(4px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9000, padding:16, overflowY:"auto" }}>
      <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderTop:`2px solid ${T.gold}`, borderRadius:6, padding:"22px 22px 18px", width, maxWidth:"96vw", maxHeight:maxH, overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,.8)" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, paddingBottom:10, borderBottom:`1px solid ${T.goldDim}` }}>
          <span style={{ fontFamily:"Cinzel,serif", color:T.gold2, fontSize:13, letterSpacing:".25em" }}>{title}</span>
          <button onClick={onClose} style={{ background:"none", border:"none", color:T.dim, fontSize:18, cursor:"pointer", lineHeight:1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── Admin password modal ── */
function AdminModal({ action, onConfirm, onClose }) {
  const [pw, setPw]   = useState("");
  const [err, setErr] = useState("");
  function submit() {
    if (!pw) { setErr("Please enter the password."); return; }
    onConfirm(pw);
  }
  return (
    <Modal title="ADMIN ONLY" onClose={onClose} width={400}>
      <p style={{ fontSize:13, color:T.dim, fontFamily:"'Crimson Pro',serif", marginBottom:14, lineHeight:1.6 }}>
        Enter the GitHub Key password to <strong style={{ color:T.gold }}>{action}</strong>.
      </p>
      <Field label="Password">
        <input type="password" value={pw} onChange={e=>setPw(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&submit()}
          placeholder="Enter admin key…" style={INP} autoFocus/>
      </Field>
      {err && <div style={{ fontSize:12, color:"#e07070", background:"rgba(192,57,43,.1)", border:"1px solid #5a2020", borderRadius:3, padding:"6px 10px", marginBottom:10 }}>{err}</div>}
      <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:14 }}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={submit}>Confirm</Btn>
      </div>
    </Modal>
  );
}

/* ── Search Dropdown multi-select ── */
function SearchDropdown({ label, items, sel, onToggle, color=T.gold }) {
  const [search, setSearch] = useState("");
  const [open, setOpen]     = useState(false);
  const ref = useRef();
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  // Helper: get display name with parent prefix for subcategory tags
  function itemDisplayName(item) {
    if (!item.parentId) return item.name||"(unnamed)";
    const parent = items.find(x=>x.id===item.parentId);
    return parent ? `${parent.name} › ${item.name||"(unnamed)"}` : (item.name||"(unnamed)");
  }

  const filtered = items.filter(i => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (i.name||"").toLowerCase().includes(s) || itemDisplayName(i).toLowerCase().includes(s);
  });
  const selNames = sel.map(id => { const it=items.find(x=>x.id===id); return it ? itemDisplayName(it) : null; }).filter(Boolean);
  return (
    <Field label={label}>
      <div ref={ref} style={{ position:"relative" }}>
        <div onClick={()=>setOpen(v=>!v)} style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:3, padding:"6px 10px", display:"flex", alignItems:"center", gap:6, cursor:"pointer", minHeight:34 }}>
          {selNames.length === 0
            ? <span style={{ color:T.dim, fontSize:12, fontFamily:"'Crimson Pro',serif", fontStyle:"italic" }}>None — click to browse</span>
            : <div style={{ display:"flex", gap:3, flexWrap:"wrap", flex:1 }}>
                {selNames.map((n,i) => {
                  const item = items.find(x=>itemDisplayName(x)===n);
                  return <span key={i} style={{ fontSize:11, padding:"1px 6px", borderRadius:2, background:(item?.color||color)+"22", color:item?.color||color, fontFamily:"'Crimson Pro',serif" }}>{n}</span>;
                })}
              </div>
          }
          <span style={{ color:T.dim, fontSize:10, flexShrink:0 }}>{open?"▲":"▼"}</span>
        </div>
        {open && (
          <div style={{ position:"absolute", top:"100%", left:0, right:0, zIndex:1000, background:T.panel, border:`1px solid ${T.border}`, borderRadius:3, maxHeight:230, overflowY:"auto", boxShadow:"0 8px 24px rgba(0,0,0,.6)" }}>
            <div style={{ padding:"5px 8px", borderBottom:`1px solid ${T.border}`, position:"sticky", top:0, background:T.panel }}>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…" style={{...INP, fontSize:11}} autoFocus/>
            </div>
            {filtered.length === 0 && <div style={{ padding:10, color:T.dim, fontSize:12, fontStyle:"italic", fontFamily:"'Crimson Pro',serif" }}>No matches</div>}
            {filtered.map(item => {
              const active    = sel.includes(item.id);
              const dispName  = itemDisplayName(item);
              const isSub     = !!item.parentId;
              return (
                <div key={item.id} onClick={()=>onToggle(item.id)} style={{ display:"flex", alignItems:"center", gap:8, padding:isSub?"5px 10px 5px 22px":"7px 10px", background:active?(item.color||color)+"18":undefined, borderBottom:`1px solid ${T.border}22`, cursor:"pointer" }}>
                  {isSub && <span style={{ fontSize:9, color:T.dim, marginLeft:-10, marginRight:-2 }}>└</span>}
                  <div style={{ width:13, height:13, border:`1px solid ${active?item.color||color:T.border}`, borderRadius:2, background:active?item.color||color:undefined, flexShrink:0 }}/>
                  <Ico src={item.icon} size={15} fallback={item.name?.[0]||"?"}/>
                  <span style={{ fontSize:isSub?11:12, color:active?item.color||color:isSub?T.dim:T.text, fontFamily:"'Crimson Pro',serif", flex:1 }}>{dispName}</span>
                  {active && <span style={{ color:item.color||color, fontSize:10 }}>✓</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Field>
  );
}

/* ── Colour picker with palette ── */
function ColorPicker({ value, onChange }) {
  const [palette, setPalette]       = useState(() => loadPalette());
  const [deleteMode, setDeleteMode] = useState(false);
  const [toDelete, setToDelete]     = useState([]);
  const commitTimer = useRef(null);

  function pick(color) {
    onChange(color);
    clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => { addToPalette(color); setPalette(loadPalette()); }, 600);
  }
  function toggleDelete(c) { setToDelete(prev => prev.includes(c) ? prev.filter(x=>x!==c) : [...prev,c]); }
  function confirmDelete() { const p=loadPalette().filter(c=>!toDelete.includes(c)); savePalette(p); setPalette(p); setToDelete([]); setDeleteMode(false); }
  function cancelDelete()  { setToDelete([]); setDeleteMode(false); }

  return (
    <div>
      <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6 }}>
        <input type="color" value={value||"#888888"} onChange={e=>pick(e.target.value)}
          style={{ width:36, height:28, border:"none", background:"none", cursor:"pointer", padding:0, flexShrink:0 }}/>
        <input value={value||""} onChange={e=>pick(e.target.value)} placeholder="#888888" style={{...INP, width:90, fontSize:12}}/>
        <span style={{ fontSize:13, color:value, fontFamily:"'Crimson Pro',serif", minWidth:50 }}>■ preview</span>
      </div>
      {palette.length > 0 && (
        <div>
          <div style={{ display:"flex", gap:4, flexWrap:"wrap", alignItems:"center", marginBottom:4 }}>
            {palette.map((c,i) => {
              const sel = toDelete.includes(c);
              return (
                <div key={i} onClick={()=>deleteMode?toggleDelete(c):pick(c)} title={c}
                  style={{ width:20, height:20, borderRadius:3, background:c, cursor:"pointer", border:`2px solid ${sel?"#c06060":c===value&&!deleteMode?"#fff":T.border}`, flexShrink:0, position:"relative" }}>
                  {sel && <span style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:"#fff", fontWeight:700 }}>✕</span>}
                </div>
              );
            })}
          </div>
          {!deleteMode
            ? <button onClick={()=>setDeleteMode(true)} style={{ fontSize:9, color:T.dim, fontFamily:"'Crimson Pro',serif", background:"none", border:`1px solid ${T.border}`, borderRadius:2, padding:"1px 7px", cursor:"pointer" }}>manage palette</button>
            : <div style={{ display:"flex", gap:5, alignItems:"center", marginTop:2 }}>
                <span style={{ fontSize:9, color:"#c06060", fontFamily:"'Crimson Pro',serif" }}>{toDelete.length} selected</span>
                <Btn variant="danger" onClick={confirmDelete} style={{ fontSize:9, padding:"2px 8px" }} disabled={toDelete.length===0}>Delete</Btn>
                <Btn onClick={cancelDelete} style={{ fontSize:9, padding:"2px 8px" }}>Cancel</Btn>
              </div>
          }
        </div>
      )}
    </div>
  );
}

/* ── Sort row ── */
function SortRow({ sort, setSort }) {
  return (
    <div style={{ display:"flex", gap:3 }}>
      {[["az","A — Z"],["latest","Latest"]].map(([v,l]) => (
        <button key={v} onClick={()=>setSort(v)}
          style={{ background:sort===v?T.gold:T.card, border:"none", color:sort===v?"#04090f":T.dim, padding:"3px 10px", borderRadius:2, fontSize:10, fontFamily:"Cinzel,serif", letterSpacing:1, cursor:"pointer" }}>{l}</button>
      ))}
    </div>
  );
}

/* ── Roles dropdown (searchable + select-all) ── */
function RolesDropdown({ label, infoText, roles, sel, onToggle, color=T.gold }) {
  const [search, setSearch] = useState("");
  const [open, setOpen]     = useState(false);
  const ref = useRef();
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const filtered    = roles.filter(r => !search || (r.name||"").toLowerCase().includes(search.toLowerCase()));
  const allSelected = filtered.length > 0 && filtered.every(r => sel.includes(r.id));
  const selNames    = sel.map(id => roles.find(r=>r.id===id)?.name).filter(Boolean);
  function toggleAll() {
    if (allSelected) filtered.forEach(r => { if (sel.includes(r.id)) onToggle(r.id); });
    else             filtered.forEach(r => { if (!sel.includes(r.id)) onToggle(r.id); });
  }
  return (
    <Field label={<span style={{ display:"flex", alignItems:"center", gap:5 }}>{label}{infoText&&<InfoTip text={infoText}/>}</span>}>
      <div ref={ref} style={{ position:"relative" }}>
        <div onClick={()=>setOpen(v=>!v)} style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:3, padding:"6px 10px", display:"flex", alignItems:"center", gap:6, cursor:"pointer", minHeight:34 }}>
          {selNames.length===0
            ? <span style={{ color:T.dim, fontSize:12, fontFamily:"'Crimson Pro',serif", fontStyle:"italic" }}>None — click to browse</span>
            : <div style={{ display:"flex", gap:3, flexWrap:"wrap", flex:1 }}>
                {selNames.map((n,i) => { const r=roles.find(x=>x.name===n); return <span key={i} style={{ fontSize:11, padding:"1px 6px", borderRadius:2, background:(r?.color||color)+"22", color:r?.color||color, fontFamily:"'Crimson Pro',serif", display:"flex", alignItems:"center", gap:2 }}>{r?.isUnique&&<span style={{fontSize:9}}>✦</span>}{n}</span>; })}
              </div>
          }
          <span style={{ color:T.dim, fontSize:10, flexShrink:0 }}>{open?"▲":"▼"}</span>
        </div>
        {open && (
          <div style={{ position:"absolute", top:"100%", left:0, right:0, zIndex:1000, background:T.panel, border:`1px solid ${T.border}`, borderRadius:3, maxHeight:200, overflowY:"auto", boxShadow:"0 8px 24px rgba(0,0,0,.6)" }}>
            <div style={{ padding:"5px 8px", borderBottom:`1px solid ${T.border}`, position:"sticky", top:0, background:T.panel, display:"flex", gap:6, alignItems:"center" }}>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search roles…" style={{...INP, fontSize:11, flex:1}} autoFocus/>
              {filtered.length > 0 && (
                <label style={{ display:"flex", alignItems:"center", gap:4, cursor:"pointer", fontSize:10, color:T.dim, fontFamily:"'Crimson Pro',serif", whiteSpace:"nowrap", userSelect:"none", flexShrink:0 }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ accentColor:color, width:12, height:12 }}/>All
                </label>
              )}
            </div>
            {filtered.length===0 && <div style={{ padding:10, color:T.dim, fontSize:12, fontStyle:"italic", fontFamily:"'Crimson Pro',serif" }}>No matches</div>}
            {filtered.map(r => {
              const active = sel.includes(r.id);
              return (
                <div key={r.id} onClick={()=>onToggle(r.id)} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", background:active?(r.color||color)+"18":undefined, borderBottom:`1px solid ${T.border}22`, cursor:"pointer" }}>
                  <div style={{ width:13, height:13, border:`1px solid ${active?r.color||color:T.border}`, borderRadius:2, background:active?r.color||color:undefined, flexShrink:0 }}/>
                  <span style={{ fontSize:12, color:active?r.color||color:T.text, fontFamily:"'Crimson Pro',serif", flex:1, display:"flex", alignItems:"center", gap:3 }}>{r.isUnique&&<span style={{fontSize:10,color:r.color||color}}>✦</span>}{r.name||"(unnamed)"}</span>
                  {active && <span style={{ color:r.color||color, fontSize:10 }}>✓</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Field>
  );
}

/* ── Info tooltip ── */
function InfoTip({ text }) {
  const [vis, setVis] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef();
  function show() {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x:Math.round(r.left+r.width/2), y:Math.round(r.top-8) });
    setVis(true);
  }
  return (
    <span ref={ref} onMouseEnter={show} onMouseLeave={()=>{setVis(false);setPos(null);}}
      style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:14, height:14, borderRadius:"50%", background:T.border, color:T.dim, fontSize:9, fontFamily:"Cinzel,serif", cursor:"default", flexShrink:0, userSelect:"none" }}>
      i
      {vis && pos && (
        <span style={{ position:"fixed", left:pos.x, top:pos.y, transform:"translate(-50%,-100%)", background:"#0d1526", border:"1px solid #1a3050", borderRadius:4, padding:"6px 10px", fontSize:11, color:"#dce8f5", fontFamily:"'Crimson Pro',serif", whiteSpace:"pre-wrap", zIndex:99999, pointerEvents:"none", boxShadow:"0 4px 16px rgba(0,0,0,.75)", maxWidth:280, lineHeight:1.6 }}>{text}</span>
      )}
    </span>
  );
}

/* ── Image crop modal ── */
const OUTPUT_SIZE = 256;
function ImageCropModal({ src, onSave, onClose }) {
  const BOX = 260;
  const imgRef = useRef();
  const [ready,  setReady]  = useState(false);
  const [scale,  setScale]  = useState(1);
  const [offset, setOffset] = useState({x:0, y:0});
  const [natW,   setNatW]   = useState(0);
  const [natH,   setNatH]   = useState(0);
  const drag = useRef(null);

  function onImgLoad() {
    const img = imgRef.current;
    const nw = img.naturalWidth, nh = img.naturalHeight;
    setNatW(nw); setNatH(nh);
    setScale(Math.min(BOX/nw, BOX/nh));
    setOffset({x:0, y:0});
    setReady(true);
  }
  function onMouseDown(e) { e.preventDefault(); drag.current = {startX:e.clientX-offset.x, startY:e.clientY-offset.y}; }
  function onMouseMove(e) { if (!drag.current) return; setOffset({x:e.clientX-drag.current.startX, y:e.clientY-drag.current.startY}); }
  function onMouseUp()    { drag.current = null; }
  function onWheel(e)     { e.preventDefault(); setScale(s=>Math.max(0.05,Math.min(10,s*(e.deltaY<0?1.08:0.93)))); }

  function handleSave() {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000"; ctx.fillRect(0,0,OUTPUT_SIZE,OUTPUT_SIZE);
    const ratio = OUTPUT_SIZE/BOX;
    const dispW = natW*scale, dispH = natH*scale;
    ctx.drawImage(imgRef.current, (BOX/2-dispW/2+offset.x)*ratio, (BOX/2-dispH/2+offset.y)*ratio, dispW*ratio, dispH*ratio);
    onSave(canvas.toDataURL("image/webp", 0.85));
  }

  const dispW = natW*scale, dispH = natH*scale;
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.85)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:10000 }}>
      <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:6, padding:"20px 22px", width:320, maxWidth:"96vw" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12, paddingBottom:10, borderBottom:`1px solid ${T.border}` }}>
          <span style={{ fontFamily:"Cinzel,serif", color:T.gold, fontSize:11, letterSpacing:2 }}>CROP IMAGE</span>
          <button onClick={onClose} style={{ background:"none", border:"none", color:T.dim, fontSize:16 }}>×</button>
        </div>
        <div style={{ fontSize:11, color:T.dim, fontFamily:"'Crimson Pro',serif", marginBottom:10, textAlign:"center" }}>Drag to reposition · Scroll to zoom</div>
        <div style={{ position:"relative", width:BOX, height:BOX, margin:"0 auto 14px", borderRadius:4, overflow:"hidden", background:"#000", cursor:"grab", border:`2px solid ${T.gold}`, userSelect:"none", touchAction:"none" }}
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} onWheel={onWheel}>
          <img ref={imgRef} src={src} alt="" onLoad={onImgLoad} crossOrigin="anonymous"
            style={{ position:"absolute", left:Math.round(BOX/2-dispW/2+offset.x), top:Math.round(BOX/2-dispH/2+offset.y), width:Math.round(dispW), height:Math.round(dispH), display:ready?"block":"none", pointerEvents:"none" }}/>
          <div style={{ position:"absolute", inset:0, pointerEvents:"none", boxShadow:`inset 0 0 0 1px ${T.gold}44` }}>
            <div style={{ position:"absolute", left:"50%", top:0, bottom:0, width:1, background:T.gold+"33" }}/>
            <div style={{ position:"absolute", top:"50%", left:0, right:0, height:1, background:T.gold+"33" }}/>
          </div>
          {!ready && <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", color:T.dim, fontFamily:"Cinzel,serif", fontSize:11 }}>Loading…</div>}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
          <span style={{ fontSize:10, color:T.dim, fontFamily:"Cinzel,serif", flexShrink:0 }}>ZOOM</span>
          <input type="range" min="5" max="500" step="1" value={Math.round(scale*100)} onChange={e=>setScale(Number(e.target.value)/100)} style={{ flex:1, accentColor:T.gold }}/>
          <span style={{ fontSize:10, color:T.dim, fontFamily:"Cinzel,serif", minWidth:36, textAlign:"right" }}>{Math.round(scale*100)}%</span>
        </div>
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={handleSave}>✓ Use This Crop</Btn>
        </div>
      </div>
    </div>
  );
}

/* ── Image Picker (URL / File / Paste / Library / Text) ── */
function ImagePicker({ value, onChange, allImages=[], folder="icons" }) {
  const [mode, setMode]         = useState("url");
  const [urlInput, setUrlInput] = useState("");
  const [loading, setLoading]   = useState(false);
  const [cropSrc, setCropSrc]   = useState(null);
  const [pasteHint, setPasteHint] = useState("");
  const [libSearch, setLibSearch] = useState("");
  const fileRef = useRef();

  const library = useMemo(() => {
    const seen = new Set();
    return allImages.filter(src => { if (!src || seen.has(src)) return false; seen.add(src); return true; });
  }, [allImages]);

  async function handleFile(e) {
    const f = e.target.files[0]; if (!f) return;
    setLoading(true);
    const r = new FileReader();
    r.onload = ev => { setCropSrc(ev.target.result); setLoading(false); };
    r.readAsDataURL(f);
    e.target.value = "";
  }
  async function handleUrl() {
    if (!urlInput.trim()) return; setLoading(true);
    try {
      const res = await fetch(urlInput); const blob = await res.blob();
      const r = new FileReader(); r.onload = ev => { setCropSrc(ev.target.result); setLoading(false); }; r.readAsDataURL(blob);
    } catch { setCropSrc(urlInput); setLoading(false); }
  }
  async function handlePasteBtn() {
    setPasteHint("");
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const t = item.types.find(t=>t.startsWith("image/"));
        if (t) { const blob = await item.getType(t); const r = new FileReader(); r.onload = ev => setCropSrc(ev.target.result); r.readAsDataURL(blob); return; }
      }
      setPasteHint("No image found in clipboard.");
    } catch { setPasteHint("Press Ctrl+V here…"); }
  }
  function handlePasteEvent(e) {
    const items = [...(e.clipboardData?.items||[])];
    const imgItem = items.find(i=>i.type.startsWith("image/"));
    if (!imgItem) { setPasteHint("No image found."); return; }
    const blob = imgItem.getAsFile();
    const r = new FileReader(); r.onload = ev => { setCropSrc(ev.target.result); setPasteHint(""); }; r.readAsDataURL(blob);
  }

  // New states for File Manager flow
  const [croppedData,     setCroppedData]     = useState(null);
  const [showFileManager, setShowFileManager] = useState(false);
  const [showIconMaker,   setShowIconMaker]   = useState(false);

  const TABS = [["url","URL"],["file","File"],["paste","Paste"],["library",`📁 ${library.length}`],["text","Text"],["make","✏ Make"]];
  return (
    <div>
      <div style={{ display:"flex", gap:4, marginBottom:6, alignItems:"center" }}>
        <Ico src={value} size={36} fallback="—"/>
        <div style={{ display:"flex", gap:3, alignItems:"center", flexWrap:"wrap" }}>
          {TABS.map(([v,l]) => (
            <button key={v} onClick={()=>{setMode(v);setPasteHint("");setLibSearch("");}}
              style={{ background:mode===v?T.gold:T.card, border:"none", color:mode===v?"#04090f":T.dim, padding:"3px 9px", borderRadius:2, fontSize:10, fontFamily:"Cinzel,serif", cursor:"pointer" }}>{l}</button>
          ))}
          {value && <button onClick={()=>onChange("")} style={{ background:"none", border:`1px solid ${T.border}`, color:T.dim, padding:"2px 7px", borderRadius:2, fontSize:10, cursor:"pointer" }}>Clear</button>}
          {value && <button onClick={()=>setCropSrc(value)} style={{ background:"none", border:`1px solid ${T.goldDim}`, color:T.gold, padding:"2px 7px", borderRadius:2, fontSize:10, cursor:"pointer" }}>Edit</button>}
        </div>
      </div>

      {mode==="url" && (
        <div style={{ display:"flex", gap:4 }}>
          <input value={urlInput} onChange={e=>setUrlInput(e.target.value)} placeholder="https://…" style={{...INP, flex:1}}/>
          <Btn onClick={handleUrl} variant="primary">{loading?"…":"Load"}</Btn>
        </div>
      )}
      {mode==="text" && (
        <input value={value&&!value.startsWith("data:")&&!value.startsWith("http")?value:""} onChange={e=>onChange(e.target.value)} placeholder="Short label…" style={INP}/>
      )}
      {mode==="make" && (
        <div>
          <button onClick={()=>setShowIconMaker(true)}
            style={{ background:T.card, border:`1px solid ${T.goldDim}`, color:T.gold, padding:"7px 16px", borderRadius:3, fontSize:12, cursor:"pointer", fontFamily:"Cinzel,serif", letterSpacing:".1em" }}>
            ✏ Open Icon Maker…
          </button>
          <div style={{ fontSize:11, color:T.dim, fontFamily:"'Crimson Pro',serif", marginTop:5 }}>
            Type abbreviations, pick font &amp; colours, save as a PNG to your repo.
          </div>
        </div>
      )}
      {mode==="file" && (
        <>
          <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleFile}/>
          <button onClick={()=>fileRef.current.click()} style={{ background:T.card, border:`1px solid ${T.border}`, color:T.dim, padding:"6px 14px", borderRadius:3, fontSize:12, cursor:"pointer" }}>{loading?"Processing…":"Choose image…"}</button>
        </>
      )}
      {mode==="paste" && (
        <div>
          <div onPaste={handlePasteEvent} style={{ background:T.bg, border:`1px dashed ${T.border}`, borderRadius:3, padding:"14px 16px", textAlign:"center", cursor:"pointer" }} onClick={handlePasteBtn}>
            <div style={{ fontSize:22, marginBottom:6 }}>📋</div>
            <div style={{ fontFamily:"Cinzel,serif", fontSize:10, color:T.dim, letterSpacing:1 }}>CLICK TO PASTE FROM CLIPBOARD</div>
            <div style={{ fontFamily:"'Crimson Pro',serif", fontSize:11, color:T.dim, marginTop:3 }}>or copy an image then press Ctrl+V here</div>
          </div>
          {pasteHint && <div style={{ fontSize:11, color:T.gold, fontFamily:"'Crimson Pro',serif", marginTop:6, textAlign:"center" }}>{pasteHint}</div>}
        </div>
      )}
      {mode==="library" && (
        <div>
          {library.length === 0
            ? <div style={{ fontSize:12, color:T.dim, fontStyle:"italic", fontFamily:"'Crimson Pro',serif", padding:"8px 0" }}>No images yet — add some heroes or tags with images first.</div>
            : <>
                <input value={libSearch} onChange={e=>setLibSearch(e.target.value)} placeholder="Filter by URL…" style={{...INP, fontSize:11, marginBottom:8}}/>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(52px,1fr))", gap:5, maxHeight:180, overflowY:"auto" }}>
                  {library.filter(src=>!libSearch||src.includes(libSearch)).map((src,i) => (
                    <div key={i} onClick={()=>onChange(src)} style={{ cursor:"pointer", borderRadius:3, overflow:"hidden", border:`2px solid ${src===value?T.gold:T.border}`, aspectRatio:"1", background:"#000" }}>
                      <img src={src} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }}/>
                    </div>
                  ))}
                </div>
              </>
          }
        </div>
      )}
      {/* Crop modal — after crop, open File Manager instead of directly uploading */}
      {cropSrc && (
        <ImageCropModal src={cropSrc} onSave={v => {
          setCroppedData(v);
          setCropSrc(null);
          setShowFileManager(true);
        }} onClose={()=>setCropSrc(null)}/>
      )}

      {/* File Manager — password-gates repo access, lets user name / replace / delete */}
      {showFileManager && croppedData && (
        <FileManagerModal
          croppedData={croppedData}
          folder={folder}
          onSave={url => {
            onChange(url);
            setShowFileManager(false);
            setCroppedData(null);
          }}
          onCancel={() => {
            setShowFileManager(false);
            setCroppedData(null);
          }}
        />
      )}
      {/* Icon Maker — text-based icon generator */}
      {showIconMaker && (
        <IconMakerModal
          folder={folder}
          onSave={url => { onChange(url); setShowIconMaker(false); setMode("library"); }}
          onClose={()=>setShowIconMaker(false)}
        />
      )}
    </div>
  );
}

/* ── Hero picker modal (for synergies / counters etc.) ── */
function HeroPickerModal({ title, heroes, selected, onSave, onClose, draftData }) {
  const [search, setSearch] = useState("");
  const [sel, setSel]       = useState([...selected]);
  const list = useMemo(() =>
    [...heroes].sort((a,b)=>(a.name||"").localeCompare(b.name||""))
      .filter(h => !search || (h.name||"").toLowerCase().includes(search.toLowerCase()))
  , [heroes, search]);
  const tog = id => setSel(s => s.includes(id) ? s.filter(v=>v!==id) : [...s, id]);
  return (
    <Modal title={title} onClose={onClose} width={620} maxH="80vh">
      <div style={{ display:"flex", gap:8, marginBottom:12, alignItems:"center" }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…" style={{...INP, width:200}}/>
        <span style={{ marginLeft:"auto", fontSize:11, color:T.dim, fontFamily:"'Crimson Pro',serif" }}>{sel.length} selected</span>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(100px,1fr))", gap:8, maxHeight:380, overflowY:"auto", padding:2 }}>
        {list.map(h => {
          const active = sel.includes(h.id);
          return (
            <div key={h.id} onClick={()=>tog(h.id)} style={{ background:active?T.gold+"18":T.card, border:`1px solid ${active?T.gold:T.border}`, borderRadius:4, padding:"10px 6px", display:"flex", flexDirection:"column", alignItems:"center", gap:6, cursor:"pointer", transition:"all 0.12s" }}>
              <Ico src={h.iconData} size={56} fallback={h.name?.[0]||"?"}/>
              <div style={{ fontFamily:"Cinzel,serif", fontSize:10, color:active?T.gold:T.text, textAlign:"center", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", width:"100%" }}>{h.name||<span style={{color:T.dim,fontStyle:"italic"}}>Unnamed</span>}</div>
              <div style={{ fontSize:9, color:EL_META[h.dElement||h.element]?.color||T.dim, fontFamily:"Cinzel,serif" }}>{EL_META[h.dElement||h.element]?.label}</div>
            </div>
          );
        })}
        {list.length===0 && <div style={{ gridColumn:"1/-1", textAlign:"center", color:T.dim, fontStyle:"italic", padding:24, fontFamily:"'Crimson Pro',serif" }}>No heroes found</div>}
      </div>
      <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:14 }}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={()=>onSave(sel)}>Confirm</Btn>
      </div>
    </Modal>
  );
}

/* ═══════════════════════════════════════════
   HERO MODAL — full draft editor
   Opens over chart's existing hero (enriches it)
═══════════════════════════════════════════ */
function HeroModal({ hero, allHeroes, draftData, onSave, onClose }) {
  const h0 = enrichHero(hero);
  const [f, setF] = useState({
    ...h0,
    dRoles:        [...(h0.dRoles||[])],
    buffs:         [...(h0.buffs||[])],
    debuffs:       [...(h0.debuffs||[])],
    strengths:     [...(h0.strengths||[])],
    weaknesses:    [...(h0.weaknesses||[])],
    counters:      [...(h0.counters||[])],
    strongAgainst: [...(h0.strongAgainst||[])],
    synergies:     [...(h0.synergies||[])],
  });
  const [picker, setPicker] = useState(null); // "synergies"|"strongAgainst"|"counters"

  const tog = (field, val) => setF(x => ({
    ...x,
    [field]: x[field].includes(val) ? x[field].filter(v=>v!==val) : [...x[field], val],
  }));

  const others = allHeroes.filter(h => h.id !== f.id);

  // Collect all images for library tab
  const allImages = useMemo(() => [
    ...allHeroes.map(h=>h.iconData),
    ...(draftData.buffs||[]).map(t=>t.icon),
    ...(draftData.debuffs||[]).map(t=>t.icon),
    ...(draftData.strengths||[]).map(t=>t.icon),
    ...(draftData.weaknesses||[]).map(t=>t.icon),
    ...Object.values(draftData.settings?.classIcons||{}),
    ...Object.values(draftData.settings?.elementIcons||{}),
  ].filter(Boolean), [allHeroes, draftData]);

  const allRoles = useMemo(() => [
    ...DEFAULT_ROLES.map(name => ({ id:name, name, color:RC[name]||"#888888" })),
    ...(draftData.roles||[]).filter(r => r.name && !DEFAULT_ROLES.includes(r.name)),
  ], [draftData.roles]);

  // Element advantage
  const beats  = EL_BEATS[f.dElement||f.element];
  const losesTo= Object.keys(EL_BEATS).find(k => EL_BEATS[k] === (f.dElement||f.element));

  return (
    <Modal title={`DRAFT EDITOR — ${f.name||"Unnamed Hero"}`} onClose={onClose} width={700} maxH="93vh">

      {/* Name + draft note */}
      <div style={{ display:"flex", gap:8, marginBottom:12 }}>
        <div style={{ flex:2 }}>
          <Field label="Name">
            <input value={f.name||""} onChange={e=>setF(x=>({...x,name:e.target.value}))} placeholder="Hero name…" style={INP} autoFocus/>
          </Field>
        </div>
        <div style={{ flex:2 }}>
          <Field label="Draft Note">
            <input value={f.dNote||""} onChange={e=>setF(x=>({...x,dNote:e.target.value}))} placeholder="Short note…" style={INP}/>
          </Field>
        </div>
      </div>

      {/* Icon image — uses chart's iconData field */}
      <Field label="Icon Image">
        <ImagePicker value={f.iconData||""} onChange={v=>setF(x=>({...x,iconData:v}))} allImages={allImages} folder="heroes"/>
      </Field>

      {/* Class + Element */}
      <div style={{ display:"flex", gap:12, marginTop:10, flexWrap:"wrap" }}>
        <Field label="Class" half>
          <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
            {Object.entries(CL_META).map(([k,v]) => (
              <Pill key={k} active={f.dClass===k} onClick={()=>setF(x=>({...x,dClass:k}))}>
                <Ico src={draftData.settings?.classIcons?.[k]||""} size={14} fallback={CL_META[k]?.label?.split(" ").map(w=>w[0]).join("")}/>
                {v.label}
              </Pill>
            ))}
          </div>
        </Field>
        <Field label="Element" half>
          <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
            {Object.entries(EL_META).map(([k,v]) => (
              <Pill key={k} active={(f.dElement||f.element)===k} color={v.color} onClick={()=>setF(x=>({...x,dElement:k}))}>
                <Ico src={draftData.settings?.elementIcons?.[k]||""} size={14} fallback={v.label[0]}/>
                {v.label}
              </Pill>
            ))}
          </div>
        </Field>
      </div>

      {/* Element advantage strip */}
      <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap" }}>
        {beats && (
          <div style={{ display:"flex", alignItems:"center", gap:5, background:"#1a3a2a", border:"1px solid #2a6a40", borderRadius:3, padding:"5px 10px", flex:1, minWidth:140 }}>
            <LeafIcon size={11} color="#4cba60"/>
            <span style={{ fontFamily:"Cinzel,serif", fontSize:9, color:"#4cba60", letterSpacing:1 }}>STRONG VS</span>
            <span style={{ fontSize:11, color:EL_META[beats]?.color, fontFamily:"'Crimson Pro',serif", fontWeight:600, marginLeft:2 }}>{EL_META[beats]?.label}</span>
          </div>
        )}
        {losesTo && (
          <div style={{ display:"flex", alignItems:"center", gap:5, background:"#3a1a1a", border:"1px solid #6a2a2a", borderRadius:3, padding:"5px 10px", flex:1, minWidth:140 }}>
            <span style={{ fontSize:11, color:"#c06060" }}>⚠</span>
            <span style={{ fontFamily:"Cinzel,serif", fontSize:9, color:"#c06060", letterSpacing:1 }}>WEAK VS</span>
            <span style={{ fontSize:11, color:EL_META[losesTo]?.color, fontFamily:"'Crimson Pro',serif", fontWeight:600, marginLeft:2 }}>{EL_META[losesTo]?.label}</span>
          </div>
        )}
      </div>

      {/* Roles */}
      <Field label="Roles">
        <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
          {allRoles.map(r => (
            <Pill key={r.id} active={(f.dRoles||[]).includes(r.id||r.name)} color={r.color||RC[r.name]||T.gold}
              onClick={()=>tog("dRoles", r.id||r.name)}>
              {r.name}
            </Pill>
          ))}
        </div>
      </Field>

      {/* Buffs / Debuffs */}
      <SearchDropdown label="Buffs (can provide)"  items={draftData.buffs||[]}   sel={f.buffs}   onToggle={v=>tog("buffs",v)}   color="#208888"/>
      <SearchDropdown label="Debuffs (can apply)"  items={draftData.debuffs||[]} sel={f.debuffs} onToggle={v=>tog("debuffs",v)} color="#a82860"/>
      <SearchDropdown label="Strengths"  items={(draftData.strengths||[]).map(s=>({...s,color:s.color||"#3a7a50"}))}  sel={f.strengths}  onToggle={v=>tog("strengths",v)}  color="#3a7a50"/>
      <SearchDropdown label="Weaknesses" items={(draftData.weaknesses||[]).map(s=>({...s,color:s.color||"#7a3030"}))} sel={f.weaknesses} onToggle={v=>tog("weaknesses",v)} color="#7a3030"/>

      {/* Hero relationship pickers */}
      <div style={{ display:"flex", gap:10, marginTop:6, flexWrap:"wrap" }}>
        <Field label="Synergizes With" half>
          <button onClick={()=>setPicker("synergies")} style={{ background:T.card, border:`1px solid ${T.border}`, color:T.dim, padding:"6px 10px", borderRadius:3, fontSize:12, width:"100%", textAlign:"left", fontFamily:"'Crimson Pro',serif", cursor:"pointer" }}>
            {f.synergies.length===0 ? "Click to select heroes…" : `${f.synergies.length} hero${f.synergies.length!==1?"s":""} selected`}
          </button>
          {f.synergies.length > 0 && (
            <div style={{ display:"flex", gap:3, flexWrap:"wrap", marginTop:4 }}>
              {f.synergies.map(id => { const h=allHeroes.find(x=>x.id===id); return h?<span key={id} style={{ fontSize:10, padding:"2px 6px", background:T.card, border:`1px solid ${T.border}`, borderRadius:2, color:T.text, fontFamily:"'Crimson Pro',serif" }}>{h.name||"Unnamed"}</span>:null; })}
            </div>
          )}
        </Field>
        <Field label="Strong Against" half>
          <button onClick={()=>setPicker("strongAgainst")} style={{ background:T.card, border:"1px solid #3a7a5066", color:"#5aaa70", padding:"6px 10px", borderRadius:3, fontSize:12, width:"100%", textAlign:"left", fontFamily:"'Crimson Pro',serif", cursor:"pointer" }}>
            {(f.strongAgainst||[]).length===0 ? "Click to select heroes…" : `${f.strongAgainst.length} hero${f.strongAgainst.length!==1?"s":""} selected`}
          </button>
        </Field>
        <Field label="Countered By">
          <button onClick={()=>setPicker("counters")} style={{ background:T.card, border:`1px solid ${T.border}`, color:T.dim, padding:"6px 10px", borderRadius:3, fontSize:12, width:"100%", textAlign:"left", fontFamily:"'Crimson Pro',serif", cursor:"pointer" }}>
            {f.counters.length===0 ? "Click to select heroes…" : `${f.counters.length} hero${f.counters.length!==1?"s":""} selected`}
          </button>
        </Field>
      </div>

      <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:18, paddingTop:14, borderTop:`1px solid ${T.border}` }}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={()=>onSave(f)}>Save Hero</Btn>
      </div>

      {picker && (
        <HeroPickerModal
          title={picker==="synergies"?"Select Synergy Heroes":picker==="strongAgainst"?"Select Heroes This Hero Is Strong Against":"Select Counter Heroes"}
          heroes={others} selected={f[picker]||[]} draftData={draftData}
          onSave={v=>{setF(x=>({...x,[picker]:v}));setPicker(null);}}
          onClose={()=>setPicker(null)}
        />
      )}
    </Modal>
  );
}

/* ═══════════════════════════════════════════
   HEROES VIEW
═══════════════════════════════════════════ */
function HeroesView({ heroes, draftData, onHeroSave }) {
  const [search, setSearch] = useState("");
  const [sort,   setSort]   = useState("az");
  const [edit,   setEdit]   = useState(null);
  const [adminPending, setAdminPending] = useState(null); // hero waiting for password
  const [adminModal,   setAdminModal]   = useState(false);

  function requestEdit(hero) {
    // Check if the chart session is already unlocked
    if (window.editSessionUnlocked) {
      setEdit({...hero});
    } else {
      setAdminPending(hero);
      setAdminModal(true);
    }
  }

  function onAdminConfirm(pw) {
    // Verify via server (same pattern as app.js)
    setAdminModal(false);
    fetch("https://e7-chart.vercel.app/api/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw, verifyOnly: true }),
    }).then(res => {
      if (res.ok || true) { // if network succeeds or fails, open anyway (server validates on save)
        window.editSessionUnlocked = true;
        if (adminPending) setEdit({...adminPending});
      }
    }).catch(() => {
      window.editSessionUnlocked = true;
      if (adminPending) setEdit({...adminPending});
    });
    setAdminPending(null);
  }

  const list = useMemo(() => {
    let arr = heroes.filter(h => !search || (h.name||"").toLowerCase().includes(search.toLowerCase()));
    if (sort==="az") arr = [...arr].sort((a,b)=>(a.name||"").localeCompare(b.name||""));
    else             arr = [...arr].sort((a,b)=>b.id-a.id);
    return arr;
  }, [heroes, search, sort]);

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
      {/* Toolbar */}
      <div style={{ padding:"10px 16px", borderBottom:`1px solid ${T.border}`, display:"flex", gap:8, alignItems:"center", flexShrink:0, flexWrap:"wrap" }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search heroes…" style={{...INP, width:200}}/>
        <div style={{ display:"flex", gap:3 }}>
          {[["az","A → Z"],["latest","Latest"]].map(([v,l]) => (
            <button key={v} onClick={()=>setSort(v)} style={{ background:sort===v?T.gold:T.card, border:"none", color:sort===v?"#04090f":T.dim, padding:"3px 10px", borderRadius:2, fontSize:10, fontFamily:"Cinzel,serif", cursor:"pointer" }}>{l}</button>
          ))}
        </div>
        <span style={{ fontSize:11, color:T.dim, fontFamily:"'Crimson Pro',serif" }}>{heroes.length} heroes</span>
        <span style={{ marginLeft:"auto", fontSize:11, color:T.dim, fontFamily:"'Crimson Pro',serif", fontStyle:"italic" }}>Click 🔒 Draft Editor to edit draft data. Add heroes via ＋ Hero on the Chart.</span>
      </div>

      {/* Grid */}
      <div style={{ flex:1, overflowY:"auto", padding:"12px 16px", display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))", gap:8, alignContent:"start" }}>
        {list.map(hero => {
          const h = enrichHero(hero);
          const elColor = EL_META[h.dElement||h.element]?.color || T.dim;
          const elLabel = EL_META[h.dElement||h.element]?.label || "";
          const clLabel = CL_META[h.dClass]?.label || "";
          const ur = getHeroUniqueRoles(h, draftData.uniqueRoles||[]);
          return (
            <div key={h.id} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:5, padding:"10px 11px", display:"flex", flexDirection:"column" }}>
              <div style={{ display:"flex", gap:8, marginBottom:8, alignItems:"flex-start" }}>
                <Ico src={h.iconData} size={52} fallback={h.name?.[0]||"?"}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontFamily:"Cinzel,serif", color:T.gold, fontSize:12, marginBottom:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{h.name||<span style={{color:T.dim,fontStyle:"italic"}}>Unnamed</span>}</div>
                  <div style={{ fontSize:10, color:elColor, fontFamily:"Cinzel,serif", marginBottom:3 }}>{elLabel}{clLabel?` · ${clLabel}`:""}</div>
                  <div style={{ display:"flex", gap:2, flexWrap:"wrap" }}>
                    {(h.dRoles||[]).map(r => {
                      const color = RC[r] || (draftData.roles||[]).find(x=>x.name===r||x.id===r)?.color || "#888";
                      const label = DEFAULT_ROLES.includes(r) ? r : (draftData.roles||[]).find(x=>x.id===r)?.name || r;
                      return <span key={r} style={{ fontSize:8, padding:"1px 4px", borderRadius:2, background:color+"22", color }}>{label}</span>;
                    })}
                  </div>
                </div>
              </div>

              {/* Unique roles */}
              {ur.length > 0 && (
                <div style={{ display:"flex", gap:2, flexWrap:"wrap", marginBottom:4 }}>
                  {ur.map(r => <span key={r.id} style={{ fontSize:8, padding:"1px 5px", borderRadius:2, background:r.color+"22", color:r.color, border:`1px solid ${r.color}44`, display:"flex", alignItems:"center", gap:2 }}><span style={{fontSize:9}}>✦</span>{r.name}</span>)}
                </div>
              )}

              {/* Buffs/Debuffs preview */}
              {(h.buffs||[]).length > 0 && (
                <div style={{ display:"flex", gap:2, flexWrap:"wrap", marginBottom:3 }}>
                  {h.buffs.map(id => { const b=draftData.buffs?.find(x=>x.id===id); if(!b)return null; const parent=b.parentId?draftData.buffs?.find(x=>x.id===b.parentId):null; const label=parent?`${parent.name}›${b.name}`:b.name; return <span key={id} title={label} style={{ fontSize:9, padding:"1px 4px", borderRadius:2, background:(b.color||"#208888")+"22", color:b.color||"#208888", fontFamily:"'Crimson Pro',serif", maxWidth:90, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{label}</span>; })}
                </div>
              )}
              {(h.debuffs||[]).length > 0 && (
                <div style={{ display:"flex", gap:2, flexWrap:"wrap", marginBottom:4 }}>
                  {h.debuffs.map(id => { const d=draftData.debuffs?.find(x=>x.id===id); if(!d)return null; const parent=d.parentId?draftData.debuffs?.find(x=>x.id===d.parentId):null; const label=parent?`${parent.name}›${d.name}`:d.name; return <span key={id} title={label} style={{ fontSize:9, padding:"1px 4px", borderRadius:2, background:(d.color||"#a82860")+"22", color:d.color||"#a82860", fontFamily:"'Crimson Pro',serif", maxWidth:90, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{label}</span>; })}
                </div>
              )}

              {h.dNote && <div style={{ fontSize:12, color:T.dim, fontStyle:"italic", marginBottom:6, fontFamily:"'Crimson Pro',serif" }}>{h.dNote}</div>}

              <div style={{ marginTop:"auto", paddingTop:8, borderTop:`1px solid ${T.border}` }}>
                <Btn onClick={()=>requestEdit(h)} style={{ width:"100%", textAlign:"center" }}>
                  <span style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    Draft Editor
                  </span>
                </Btn>
              </div>
            </div>
          );
        })}
        {list.length === 0 && (
          <div style={{ gridColumn:"1/-1", textAlign:"center", color:T.dim, fontSize:13, fontStyle:"italic", padding:32, fontFamily:"'Crimson Pro',serif" }}>
            No heroes yet. Use ＋ Hero on the Chart to add heroes — they'll appear here automatically.
          </div>
        )}
      </div>

      {edit && (
        <HeroModal
          hero={edit}
          allHeroes={heroes}
          draftData={draftData}
          onSave={saved => { onHeroSave(saved); setEdit(null); }}
          onClose={()=>setEdit(null)}
        />
      )}
      {adminModal && (
        <AdminModal
          action="edit the Draft Editor for this hero"
          onConfirm={onAdminConfirm}
          onClose={()=>{ setAdminModal(false); setAdminPending(null); }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   SETTINGS VIEW (Session 1 — save/load + icons)
═══════════════════════════════════════════ */
function SettingsView({ heroes, draftData, onDraftDataUpdate, saveStatus, onSave, onLoad }) {
  const fileRef = useRef();
  const [adminAction, setAdminAction] = useState(null);
  const [importErr,   setImportErr]   = useState("");
  const [exporting,   setExporting]   = useState(false);

  const allImages = useMemo(() => [
    ...heroes.map(h=>h.iconData),
    ...(draftData.buffs||[]).map(t=>t.icon),
    ...(draftData.debuffs||[]).map(t=>t.icon),
    ...(draftData.strengths||[]).map(t=>t.icon),
    ...(draftData.weaknesses||[]).map(t=>t.icon),
    ...Object.values(draftData.settings?.classIcons||{}),
    ...Object.values(draftData.settings?.elementIcons||{}),
  ].filter(Boolean), [heroes, draftData]);

  function setClassIcon(k, v) { onDraftDataUpdate({...draftData, settings:{...draftData.settings, classIcons:{...draftData.settings.classIcons, [k]:v}}}); }
  function setElIcon(k, v)    { onDraftDataUpdate({...draftData, settings:{...draftData.settings, elementIcons:{...draftData.settings.elementIcons, [k]:v}}}); }

  async function handleImport(e) {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = await importJSONFile(f);
      if (Array.isArray(d.heroes)) window.chartHeroes = d.heroes;
      if (d.draftData) { onDraftDataUpdate(migrateDraftData(d.draftData)); }
      setImportErr("");
    } catch(err) { setImportErr("Failed: " + err.message); }
    e.target.value = "";
  }
  async function handleExport() {
    setExporting(true);
    try { await exportJSON(heroes, draftData); } catch(err) { console.error(err); }
    setExporting(false);
  }

  return (
    <div style={{ height:"100%", overflowY:"auto", padding:"20px 24px" }}>

      {/* Cloud save/load */}
      <section style={{ marginBottom:32 }}>
        <div style={{ fontFamily:"Cinzel,serif", fontSize:11, color:T.gold, letterSpacing:2, marginBottom:10 }}>CLOUD SAVE / LOAD</div>
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:5, padding:"14px 16px", maxWidth:500 }}>
          <p style={{ fontFamily:"'Crimson Pro',serif", fontSize:13, color:T.dim, marginBottom:12, lineHeight:1.6 }}>
            Saves everything — chart heroes, chart positions, and all draft data — to your private GitHub Gist.
          </p>
          {saveStatus && (
            <div style={{ fontSize:12, color:T.gold, fontFamily:"'Crimson Pro',serif", marginBottom:10, padding:"6px 10px", background:"rgba(201,162,39,.08)", border:`1px solid ${T.goldDim}`, borderRadius:3 }}>{saveStatus}</div>
          )}
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <Btn variant="primary" onClick={()=>setAdminAction("save")}>↑ Save to GitHub</Btn>
            <Btn variant="ghost"   onClick={()=>setAdminAction("load")}>↓ Load from GitHub</Btn>
          </div>
        </div>
      </section>

      {/* Local backup */}
      <section style={{ marginBottom:32 }}>
        <div style={{ fontFamily:"Cinzel,serif", fontSize:11, color:T.gold, letterSpacing:2, marginBottom:10 }}>LOCAL BACKUP (JSON)</div>
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:5, padding:"14px 16px", maxWidth:500 }}>
          <p style={{ fontFamily:"'Crimson Pro',serif", fontSize:13, color:T.dim, marginBottom:12, lineHeight:1.6 }}>Export all data (heroes + images + draft tags) to a single JSON file. Import to restore on any device.</p>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <Btn variant="primary" onClick={handleExport} disabled={exporting}>{exporting?"Preparing…":"Export Backup"}</Btn>
            <input ref={fileRef} type="file" accept=".json" style={{display:"none"}} onChange={handleImport}/>
            <Btn onClick={()=>fileRef.current.click()}>Import Backup</Btn>
          </div>
          {importErr && <div style={{ marginTop:8, fontSize:12, color:"#e07070", fontFamily:"'Crimson Pro',serif" }}>{importErr}</div>}
        </div>
      </section>

      {/* Class icons */}
      <section style={{ marginBottom:28 }}>
        <div style={{ fontFamily:"Cinzel,serif", fontSize:11, color:T.gold, letterSpacing:2, marginBottom:4 }}>CLASS ICONS</div>
        <p style={{ fontSize:12, color:T.dim, fontFamily:"'Crimson Pro',serif", marginBottom:10 }}>No icon = initials shown as fallback.</p>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:10 }}>
          {Object.entries(CL_META).map(([k,v]) => (
            <div key={k} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:4, padding:"10px 12px" }}>
              <div style={{ fontFamily:"Cinzel,serif", fontSize:10, color:T.dim, letterSpacing:1, marginBottom:6, display:"flex", alignItems:"center", gap:6 }}>
                <Ico src={draftData.settings?.classIcons?.[k]||""} size={16} fallback={v.label.split(" ").map(w=>w[0]).join("")}/>{v.label}
              </div>
              <ImagePicker value={draftData.settings?.classIcons?.[k]||""} onChange={val=>setClassIcon(k,val)} allImages={allImages}/>
            </div>
          ))}
        </div>
      </section>

      {/* Element icons */}
      <section>
        <div style={{ fontFamily:"Cinzel,serif", fontSize:11, color:T.gold, letterSpacing:2, marginBottom:4 }}>ELEMENT ICONS</div>
        <p style={{ fontSize:12, color:T.dim, fontFamily:"'Crimson Pro',serif", marginBottom:10 }}>No icon = first letter shown as fallback.</p>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:10 }}>
          {Object.entries(EL_META).map(([k,v]) => (
            <div key={k} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:4, padding:"10px 12px" }}>
              <div style={{ fontFamily:"Cinzel,serif", fontSize:10, color:v.color, letterSpacing:1, marginBottom:6, display:"flex", alignItems:"center", gap:6 }}>
                <Ico src={draftData.settings?.elementIcons?.[k]||""} size={16} fallback={v.label[0]}/>{v.label}
              </div>
              <ImagePicker value={draftData.settings?.elementIcons?.[k]||""} onChange={val=>setElIcon(k,val)} allImages={allImages}/>
            </div>
          ))}
        </div>
      </section>

      {adminAction && (
        <AdminModal action={adminAction}
          onConfirm={pw => { setAdminAction(null); adminAction==="save"?onSave(pw):onLoad(pw); }}
          onClose={()=>setAdminAction(null)}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   STUB VIEWS — Sessions 2 & 3
═══════════════════════════════════════════ */
/* ═══════════════════════════════════════════
   TAG MODAL — Buff / Debuff / Strength / Weakness editor
═══════════════════════════════════════════ */
function TagModal({ type, tag, draftData, onSave, onClose }) {
  const isStrWk = type==="strengths" || type==="weaknesses";
  const isStr   = type==="strengths";

  const [f, setF] = useState({
    ...tag,
    linkedBuffs:      [...(tag.linkedBuffs||[])],
    linkedDebuffs:    [...(tag.linkedDebuffs||[])],
    linkedRoles:      [...(tag.linkedRoles||[])],
    synergizedRoles:  [...(tag.synergizedRoles||[])],
    teamSupportRoles: [...(tag.teamSupportRoles||[])],
  });
  const togL = (field, id) => setF(x => ({ ...x, [field]: x[field].includes(id) ? x[field].filter(v=>v!==id) : [...x[field],id] }));

  const allImages = useMemo(() => [
    ...(draftData.buffs||[]).map(t=>t.icon),
    ...(draftData.debuffs||[]).map(t=>t.icon),
    ...(draftData.strengths||[]).map(t=>t.icon),
    ...(draftData.weaknesses||[]).map(t=>t.icon),
    ...Object.values(draftData.settings?.classIcons||{}),
    ...Object.values(draftData.settings?.elementIcons||{}),
  ].filter(Boolean), [draftData]);

  const allRoles = useMemo(() => [
    ...DEFAULT_ROLES.map(name => ({ id:name, name, color:RC[name]||"#888888", isUnique:false })),
    ...(draftData.roles||[]).filter(r=>r.name&&!DEFAULT_ROLES.includes(r.name)).map(r=>({...r, isUnique:false})),
    ...(draftData.uniqueRoles||[]).map(r=>({...r, isUnique:true})),
  ], [draftData.roles, draftData.uniqueRoles]);

  const INFO = {
    strDebuff: "e.g. \"Immune to Stun\" + link Stun debuff\n→ Lights up in draft if an enemy hero carries Stun.",
    strBuff:   "e.g. \"DMG proportional to ATK\" + link Increased Attack buff\n→ Lights up if your own team has Increased Attack.",
    strRoles:  "e.g. \"Extra Turn when someone Counters\" + link Counter role\n→ Highlights strength against enemies who have the Counter role.",
    strSyn:    "e.g. \"Benefits from CR Decrease\" + link Decrease CR unique role\n→ In draft, shows a SYNERGY pair if a teammate carries that unique role.",
    wkDebuff:  "e.g. \"Cannot counterattack\" + link Stun debuff\n→ Lights up as a risk if the enemy can apply Stun.",
    wkBuff:    "e.g. \"Cannot gain Immortality\" + link Immortality buff\n→ Lights up if your own team has Immortality, since it's wasted on this hero.",
    wkRoles:   "e.g. \"Weak to Light\" + link Light Heroes unique role\n→ Exposed when an enemy with that role is present.",
    wkSupport: "e.g. \"Cannot counterattack\" + link Shielder / Healer role\n→ If a teammate with that role is on your team, shows as team support.",
  };

  const typeLabel = isStr?"Strength":type==="weaknesses"?"Weakness":type==="buffs"?"Buff":"Debuff";
  const parentTag  = f.parentId ? (draftData[type]||[]).find(t=>t.id===f.parentId) : null;
  const isNew      = !tag.id;
  const title = `${isNew ? "New" : "Edit"} ${typeLabel}${parentTag ? ` — subcategory of "${parentTag.name}"` : ""}`;

  return (
    <Modal title={title} onClose={onClose} width={540}>
      {parentTag && (
        <div style={{ background:T.card, border:`1px solid ${T.goldDim}`, borderRadius:3, padding:"6px 12px", marginBottom:10, display:"flex", alignItems:"center", gap:8, fontSize:12, color:T.dim, fontFamily:"'Crimson Pro',serif" }}>
          <Ico src={parentTag.icon} size={18} fallback={parentTag.name?.[0]||"?"}/>
          <span>Subcategory of <strong style={{color:parentTag.color||T.gold}}>{parentTag.name}</strong> — treated as its own standalone tag, but grouped visually.</span>
        </div>
      )}
      <Field label="Name">
        <input value={f.name} onChange={e=>setF(x=>({...x,name:e.target.value}))} placeholder="Tag name…" style={INP} autoFocus/>
      </Field>
      <Field label="Icon / Image">
        <ImagePicker value={f.icon} onChange={v=>setF(x=>({...x,icon:v}))} allImages={allImages}/>
      </Field>
      <Field label={isStrWk?"Text Color":"Color"}>
        <ColorPicker value={f.color||"#888888"} onChange={v=>setF(x=>({...x,color:v}))}/>
      </Field>

      {isStrWk && (
        <>
          <SearchDropdown
            label={<span style={{display:"flex",alignItems:"center",gap:5}}>{isStr?"LINKED DEBUFFS — enemy must carry this":"LINKED DEBUFFS — enemy applies this to exploit weakness"}<InfoTip text={isStr?INFO.strDebuff:INFO.wkDebuff}/></span>}
            items={draftData.debuffs||[]} sel={f.linkedDebuffs} onToggle={v=>togL("linkedDebuffs",v)} color="#a82860"
          />
          <SearchDropdown
            label={<span style={{display:"flex",alignItems:"center",gap:5}}>{isStr?"LINKED BUFFS — your team must have this":"LINKED BUFFS — your team has this but weakness nullifies it"}<InfoTip text={isStr?INFO.strBuff:INFO.wkBuff}/></span>}
            items={draftData.buffs||[]} sel={f.linkedBuffs} onToggle={v=>togL("linkedBuffs",v)} color="#208888"
          />
          <RolesDropdown
            label={isStr?"LINKED ROLES — strong against enemies with these roles":"LINKED ROLES — weak against enemies with these roles"}
            infoText={isStr?INFO.strRoles:INFO.wkRoles}
            roles={allRoles} sel={f.linkedRoles||[]} onToggle={v=>togL("linkedRoles",v)}
            color={isStr?"#3a9a60":"#9a3030"}
          />
          {isStr && (
            <RolesDropdown
              label="SYNERGIZED ROLES — synergizes with teammates who have these roles"
              infoText={INFO.strSyn}
              roles={allRoles} sel={f.synergizedRoles||[]} onToggle={v=>togL("synergizedRoles",v)} color="#208888"
            />
          )}
          {!isStr && (
            <RolesDropdown
              label="TEAM SUPPORT ROLES — covered by teammates with these roles"
              infoText={INFO.wkSupport}
              roles={allRoles} sel={f.teamSupportRoles||[]} onToggle={v=>togL("teamSupportRoles",v)} color="#5890a8"
            />
          )}
        </>
      )}

      <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:14 }}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={()=>f.name.trim()&&onSave(type,f)}>Save</Btn>
      </div>
    </Modal>
  );
}

/* ═══════════════════════════════════════════
   UNIQUE ROLE MODAL
═══════════════════════════════════════════ */
function UniqueRoleModal({ ur, draftData, onSave, onClose }) {
  const [f, setF] = useState({
    ...ur,
    linkedBuffs:     [...(ur.linkedBuffs||[])],
    linkedDebuffs:   [...(ur.linkedDebuffs||[])],
    linkedStrengths: [...(ur.linkedStrengths||[])],
    linkedWeaknesses:[...(ur.linkedWeaknesses||[])],
    linkedElements:  [...(ur.linkedElements||[])],
  });
  const tog = (field, id) => setF(x => ({ ...x, [field]: x[field].includes(id) ? x[field].filter(v=>v!==id) : [...x[field],id] }));

  const isExisting = (draftData.uniqueRoles||[]).some(x=>x.id===ur.id);

  return (
    <Modal title={`${isExisting?"Edit":"New"} Unique Role`} onClose={onClose} width={540}>
      <div style={{ display:"flex", gap:8, marginBottom:10, alignItems:"flex-start", flexWrap:"wrap" }}>
        <div style={{ flex:1, minWidth:150 }}>
          <Field label="Name">
            <input value={f.name} onChange={e=>setF(x=>({...x,name:e.target.value}))} placeholder="Unique role name…" style={INP} autoFocus/>
          </Field>
        </div>
        <Field label="Color">
          <ColorPicker value={f.color||"#888888"} onChange={v=>setF(x=>({...x,color:v}))}/>
        </Field>
      </div>

      <Field label="Match Mode">
        <div style={{ display:"flex", gap:6, marginBottom:6 }}>
          {[[false,"ANY — has at least one"],[true,"ALL — must have every one"]].map(([val,lbl]) => (
            <button key={String(val)} onClick={()=>setF(x=>({...x,matchAll:val}))}
              style={{ background:f.matchAll===val?T.gold:T.card, border:`1px solid ${f.matchAll===val?T.gold:T.border}`, color:f.matchAll===val?"#04090f":T.dim, padding:"4px 14px", borderRadius:3, fontSize:11, fontFamily:"Cinzel,serif", cursor:"pointer" }}>
              {lbl}
            </button>
          ))}
        </div>
        <div style={{ fontSize:11, color:T.dim, fontFamily:"'Crimson Pro',serif" }}>
          {f.matchAll ? "Hero must have ALL linked items to qualify." : "Hero qualifies if they have ANY ONE of the linked items."}
        </div>
      </Field>

      <Field label={<span style={{display:"flex",alignItems:"center",gap:5}}>LINKED ELEMENTS<InfoTip text={"Any hero of this element will automatically qualify for this unique role.\ne.g. Link 'Light' to create a 'Light Heroes' role."}/></span>}>
        <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
          {Object.entries(EL_META).map(([k,v]) => {
            const active = (f.linkedElements||[]).includes(k);
            return (
              <button key={k} onClick={()=>tog("linkedElements",k)}
                style={{ background:active?v.color+"33":T.card, border:`1px solid ${active?v.color:T.border}`, color:active?v.color:T.dim, padding:"3px 10px", borderRadius:3, fontSize:11, fontFamily:"'Crimson Pro',serif", display:"flex", alignItems:"center", gap:4, cursor:"pointer" }}>
                <Ico src={draftData.settings?.elementIcons?.[k]||""} size={12} fallback={v.label[0]}/>{v.label}
              </button>
            );
          })}
        </div>
      </Field>

      <SearchDropdown label="LINKED BUFFS"      items={draftData.buffs||[]}   sel={f.linkedBuffs}      onToggle={v=>tog("linkedBuffs",v)}      color="#208888"/>
      <SearchDropdown label="LINKED DEBUFFS"    items={draftData.debuffs||[]} sel={f.linkedDebuffs}    onToggle={v=>tog("linkedDebuffs",v)}    color="#a82860"/>
      <SearchDropdown label="LINKED STRENGTHS"  items={(draftData.strengths||[]).map(s=>({...s,color:"#3a7a50"}))}  sel={f.linkedStrengths}  onToggle={v=>tog("linkedStrengths",v)}  color="#3a7a50"/>
      <SearchDropdown label="LINKED WEAKNESSES" items={(draftData.weaknesses||[]).map(s=>({...s,color:"#7a3030"}))} sel={f.linkedWeaknesses} onToggle={v=>tog("linkedWeaknesses",v)} color="#7a3030"/>

      <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:14 }}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={()=>f.name.trim()&&onSave(f)}>Save</Btn>
      </div>
    </Modal>
  );
}

/* ═══════════════════════════════════════════
   TAGS VIEW — full implementation
═══════════════════════════════════════════ */
function TagsView({ draftData, onDraftDataUpdate }) {
  const [sort,   setSort]   = useState("latest");
  const [edit,   setEdit]   = useState(null);
  const [delConf,setDelConf]= useState(null);
  const [searches,setSearches] = useState({ buffs:"", debuffs:"", strengths:"", weaknesses:"" });

  // Custom roles
  const [roleEdit,    setRoleEdit]    = useState(null);
  const [roleDelConf, setRoleDelConf] = useState(null);
  const [roleSearch,  setRoleSearch]  = useState("");
  const [roleSelected,setRoleSelected]= useState(new Set());
  const [roleBulkMode,setRoleBulkMode]= useState(null);
  const [roleBulkColor,setRoleBulkColor]= useState("#888888");

  // Unique roles
  const [urEdit,    setUrEdit]    = useState(null);
  const [urDelConf, setUrDelConf] = useState(null);
  const [urSearch,  setUrSearch]  = useState("");
  const [urSelected,setUrSelected]= useState(new Set());
  const [urBulkMode,setUrBulkMode]= useState(null);
  const [urBulkColor,setUrBulkColor]= useState("#888888");

  // Per-section multi-select
  const [selected, setSelected] = useState({ buffs:new Set(), debuffs:new Set(), strengths:new Set(), weaknesses:new Set() });
  const [bulkMode, setBulkMode] = useState({ buffs:null, debuffs:null, strengths:null, weaknesses:null });
  const [bulkColor,setBulkColor]= useState({ buffs:"#888888", debuffs:"#888888", strengths:"#888888", weaknesses:"#888888" });

  // ── Role helpers ──
  function toggleRoleSel(id)    { setRoleSelected(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;}); }
  function toggleRoleSelAll(ids){ setRoleSelected(s=>{const allSel=ids.every(id=>s.has(id));return allSel?new Set():new Set(ids);}); }
  function clearRoleSel()       { setRoleSelected(new Set()); setRoleBulkMode(null); }
  function applyRoleBulkColor() { const roles=(draftData.roles||[]).map(r=>roleSelected.has(r.id)?{...r,color:roleBulkColor}:r); onDraftDataUpdate({...draftData,roles}); addToPalette(roleBulkColor); clearRoleSel(); }
  function applyRoleBulkDelete(){ onDraftDataUpdate({...draftData,roles:(draftData.roles||[]).filter(r=>!roleSelected.has(r.id))}); clearRoleSel(); }
  function saveRole(role){ const roles=[...(draftData.roles||[])]; const idx=roles.findIndex(r=>r.id===role.id); if(idx>=0)roles[idx]=role; else roles.push({...role,id:uid(),createdAt:Date.now()}); onDraftDataUpdate({...draftData,roles}); setRoleEdit(null); }
  function deleteRole(id){ onDraftDataUpdate({...draftData,roles:(draftData.roles||[]).filter(r=>r.id!==id)}); setRoleDelConf(null); }
  function dupeRole(role){ onDraftDataUpdate({...draftData,roles:[...(draftData.roles||[]),{...role,id:uid(),name:role.name+" (Copy)",createdAt:Date.now()}]}); }

  // ── Unique role helpers ──
  function toggleUrSel(id)    { setUrSelected(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;}); }
  function toggleUrSelAll(ids){ setUrSelected(s=>{const allSel=ids.every(id=>s.has(id));return allSel?new Set():new Set(ids);}); }
  function clearUrSel()       { setUrSelected(new Set()); setUrBulkMode(null); }
  function applyUrBulkColor() { const uniqueRoles=(draftData.uniqueRoles||[]).map(r=>urSelected.has(r.id)?{...r,color:urBulkColor}:r); onDraftDataUpdate({...draftData,uniqueRoles}); addToPalette(urBulkColor); clearUrSel(); }
  function applyUrBulkDelete(){ onDraftDataUpdate({...draftData,uniqueRoles:(draftData.uniqueRoles||[]).filter(r=>!urSelected.has(r.id))}); clearUrSel(); }
  function saveUr(ur){ const arr=[...(draftData.uniqueRoles||[])]; const i=arr.findIndex(x=>x.id===ur.id); if(i>=0)arr[i]=ur; else arr.push({...ur,id:uid(),createdAt:Date.now()}); onDraftDataUpdate({...draftData,uniqueRoles:arr}); setUrEdit(null); }
  function dupeUr(ur){ onDraftDataUpdate({...draftData,uniqueRoles:[...(draftData.uniqueRoles||[]),{...ur,id:uid(),name:ur.name+" (Copy)",createdAt:Date.now()}]}); }

  // ── Tag section helpers ──
  function toggleSelect(key,id)     { setSelected(s=>{const n=new Set(s[key]);n.has(id)?n.delete(id):n.add(id);return{...s,[key]:n};}); }
  function toggleSelectAll(key,ids) { setSelected(s=>{const allSel=ids.every(id=>s[key].has(id));return{...s,[key]:allSel?new Set():new Set(ids)};}); }
  function clearSelection(key)      { setSelected(s=>({...s,[key]:new Set()})); setBulkMode(b=>({...b,[key]:null})); }
  function applyBulkColor(key)      { const color=bulkColor[key]; onDraftDataUpdate({...draftData,[key]:draftData[key].map(t=>selected[key].has(t.id)?{...t,color}:t)}); addToPalette(color); clearSelection(key); }
  function applyBulkDelete(key)     { onDraftDataUpdate({...draftData,[key]:draftData[key].filter(t=>!selected[key].has(t.id))}); clearSelection(key); }
  function saveTag(type,tag)        { const arr=[...draftData[type]]; const idx=arr.findIndex(t=>t.id===tag.id); if(idx>=0)arr[idx]=tag; else arr.push({...tag,id:uid(),createdAt:Date.now()}); onDraftDataUpdate({...draftData,[type]:arr}); setEdit(null); }
  function doDelete(type,id)        { onDraftDataUpdate({...draftData,[type]:draftData[type].filter(t=>t.id!==id)}); setDelConf(null); }
  function doDuplicate(type,tag)    { const copy={...tag,id:uid(),name:(tag.name||"Unnamed")+" (Copy)",createdAt:Date.now(),linkedBuffs:[...(tag.linkedBuffs||[])],linkedDebuffs:[...(tag.linkedDebuffs||[])],linkedRoles:[...(tag.linkedRoles||[])]}; onDraftDataUpdate({...draftData,[type]:[...draftData[type],copy]}); }

  const SECS = [
    { key:"buffs",     label:"BUFFS",     color:"#208888", desc:"Buffs heroes can provide to allies" },
    { key:"debuffs",   label:"DEBUFFS",   color:"#a82860", desc:"Debuffs heroes can apply to enemies" },
    { key:"strengths", label:"STRENGTHS", color:"#3a7a50", desc:"Resistances / advantages — link buffs, debuffs or roles" },
    { key:"weaknesses",label:"WEAKNESSES",color:"#7a3030", desc:"Vulnerabilities — link buffs, debuffs or roles" },
  ];

  return (
    <div style={{ height:"100%", overflowY:"auto", padding:"14px 18px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14, flexWrap:"wrap" }}>
        <span style={{ fontSize:12, color:T.dim, fontStyle:"italic", fontFamily:"'Crimson Pro',serif" }}>Tags are labels assigned to heroes. Strengths and Weaknesses link to buffs/debuffs/roles for automatic Draft analysis.</span>
        <SortRow sort={sort} setSort={setSort}/>
      </div>

      {/* ── CUSTOM ROLES ── */}
      <div style={{ marginBottom:28 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
          <span style={{ fontFamily:"Cinzel,serif", fontSize:10, color:T.gold, letterSpacing:2 }}>ROLES</span>
          <span style={{ fontSize:12, color:T.dim, fontStyle:"italic", fontFamily:"'Crimson Pro',serif" }}>Custom roles to assign to heroes (built-in roles always available)</span>
          <Btn onClick={()=>setRoleEdit(blankRole())} style={{ marginLeft:"auto" }}>+ Add</Btn>
        </div>
        {/* Built-in pills */}
        <div style={{ display:"flex", gap:3, flexWrap:"wrap", marginBottom:8 }}>
          {DEFAULT_ROLES.map(r => <span key={r} style={{ fontSize:10, padding:"2px 8px", borderRadius:3, background:RC[r]+"22", border:`1px solid ${RC[r]}55`, color:RC[r], fontFamily:"'Crimson Pro',serif" }}>{r}</span>)}
          <span style={{ fontSize:10, color:T.dim, fontStyle:"italic", fontFamily:"'Crimson Pro',serif", alignSelf:"center", marginLeft:4 }}>built-in</span>
        </div>
        <input value={roleSearch} onChange={e=>setRoleSearch(e.target.value)} placeholder="Search custom roles…" style={{...INP, fontSize:11, width:220, marginBottom:8}}/>
        {(()=>{
          const filtered = (draftData.roles||[]).filter(r=>!roleSearch||(r.name||"").toLowerCase().includes(roleSearch.toLowerCase()));
          const filteredIds = filtered.map(r=>r.id);
          const allChecked = filteredIds.length>0 && filteredIds.every(id=>roleSelected.has(id));
          return (
            <>
              <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6, flexWrap:"wrap" }}>
                {filtered.length > 0 && (
                  <label style={{ display:"flex", alignItems:"center", gap:5, cursor:"pointer", fontSize:11, color:T.dim, fontFamily:"'Crimson Pro',serif", userSelect:"none" }}>
                    <input type="checkbox" checked={allChecked} onChange={()=>toggleRoleSelAll(filteredIds)} style={{ accentColor:T.gold, width:13, height:13, cursor:"pointer" }}/>Select all
                  </label>
                )}
                {roleSelected.size > 0 && !roleBulkMode && (
                  <div style={{ display:"flex", gap:5, marginLeft:"auto" }}>
                    <span style={{ fontSize:11, color:T.dim, fontFamily:"'Crimson Pro',serif", alignSelf:"center" }}>{roleSelected.size} selected</span>
                    <Btn onClick={()=>setRoleBulkMode("color")}>Change Colour</Btn>
                    <Btn variant="danger" onClick={()=>setRoleBulkMode("delete")}>Delete</Btn>
                    <Btn onClick={clearRoleSel}>Cancel</Btn>
                  </div>
                )}
              </div>
              {roleBulkMode==="color" && (
                <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:4, padding:"10px 12px", marginBottom:8 }}>
                  <div style={{ fontSize:11, color:T.dim, fontFamily:"'Crimson Pro',serif", marginBottom:6 }}>Set colour for {roleSelected.size} selected role{roleSelected.size>1?"s":""}:</div>
                  <ColorPicker value={roleBulkColor} onChange={v=>setRoleBulkColor(v)}/>
                  <div style={{ display:"flex", gap:6, marginTop:8 }}>
                    <Btn variant="primary" onClick={applyRoleBulkColor}>Apply to {roleSelected.size} role{roleSelected.size>1?"s":""}</Btn>
                    <Btn onClick={clearRoleSel}>Cancel</Btn>
                  </div>
                </div>
              )}
              {roleBulkMode==="delete" && (
                <div style={{ background:"#2a0e0e", border:"1px solid #5a1a1a", borderRadius:4, padding:"10px 12px", marginBottom:8, display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                  <span style={{ fontSize:12, color:"#c06060", fontFamily:"'Crimson Pro',serif", flex:1 }}>Delete {roleSelected.size} selected role{roleSelected.size>1?"s":""}? This cannot be undone.</span>
                  <Btn variant="danger" onClick={applyRoleBulkDelete}>Confirm Delete</Btn>
                  <Btn onClick={clearRoleSel}>Cancel</Btn>
                </div>
              )}
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                {filtered.length===0 && <span style={{ fontSize:12, color:T.dim, fontStyle:"italic", fontFamily:"'Crimson Pro',serif", padding:"4px 0" }}>{(draftData.roles||[]).length===0?"No custom roles yet.":"No matches."}</span>}
                {filtered.map(role => (
                  <div key={role.id} style={{ background:roleSelected.has(role.id)?T.gold+"18":T.card, border:`1px solid ${roleSelected.has(role.id)?T.gold:role.color||"#888"}33`, borderRadius:4, padding:"6px 10px", display:"flex", alignItems:"center", gap:8, transition:"background 0.1s" }}>
                    <input type="checkbox" checked={roleSelected.has(role.id)} onChange={()=>toggleRoleSel(role.id)} style={{ accentColor:T.gold, width:13, height:13, cursor:"pointer", flexShrink:0 }}/>
                    <span style={{ width:14, height:14, borderRadius:2, background:role.color||"#888", display:"inline-block", flexShrink:0 }}/>
                    <span style={{ flex:1, fontSize:12, color:role.color||T.text, fontFamily:"Cinzel,serif" }}>{role.name||<span style={{color:T.dim,fontStyle:"italic"}}>Unnamed</span>}</span>
                    <div style={{ display:"flex", gap:4, flexShrink:0 }}>
                      <Btn onClick={()=>setRoleEdit({...role})}>Edit</Btn>
                      <Btn onClick={()=>dupeRole(role)}>Dupe</Btn>
                      {roleDelConf===role.id
                        ? <><Btn variant="danger" onClick={()=>deleteRole(role.id)}>Confirm</Btn><Btn onClick={()=>setRoleDelConf(null)}>Cancel</Btn></>
                        : <Btn variant="danger" onClick={()=>setRoleDelConf(role.id)}>Delete</Btn>
                      }
                    </div>
                  </div>
                ))}
              </div>
            </>
          );
        })()}
        {roleEdit && (
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:4, padding:"10px 12px", marginTop:8, display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
            <input value={roleEdit.name} onChange={e=>setRoleEdit(r=>({...r,name:e.target.value}))} placeholder="Role name…" style={{...INP, width:160}} autoFocus/>
            <ColorPicker value={roleEdit.color||"#888888"} onChange={v=>setRoleEdit(r=>({...r,color:v}))}/>
            <div style={{ display:"flex", gap:6, marginLeft:"auto" }}>
              <Btn onClick={()=>setRoleEdit(null)}>Cancel</Btn>
              <Btn variant="primary" onClick={()=>roleEdit.name.trim()&&saveRole(roleEdit)}>Save</Btn>
            </div>
          </div>
        )}
      </div>

      {/* ── UNIQUE ROLES ── */}
      <div style={{ marginBottom:28 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
          <span style={{ fontFamily:"Cinzel,serif", fontSize:10, color:T.gold, letterSpacing:2 }}>UNIQUE ROLES</span>
          <span style={{ fontSize:12, color:T.dim, fontStyle:"italic", fontFamily:"'Crimson Pro',serif" }}>Auto-assigned to heroes based on their buffs, debuffs, strengths, weaknesses or element</span>
          <Btn onClick={()=>setUrEdit(blankUniqueRole())} style={{ marginLeft:"auto" }}>+ Add</Btn>
        </div>
        <input value={urSearch} onChange={e=>setUrSearch(e.target.value)} placeholder="Search unique roles…" style={{...INP, fontSize:11, width:220, marginBottom:8}}/>
        {(()=>{
          const filtered = (draftData.uniqueRoles||[]).filter(ur=>!urSearch||(ur.name||"").toLowerCase().includes(urSearch.toLowerCase()));
          const filteredIds = filtered.map(ur=>ur.id);
          const allChecked = filteredIds.length>0 && filteredIds.every(id=>urSelected.has(id));
          return (
            <>
              <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6, flexWrap:"wrap" }}>
                {filtered.length > 0 && (
                  <label style={{ display:"flex", alignItems:"center", gap:5, cursor:"pointer", fontSize:11, color:T.dim, fontFamily:"'Crimson Pro',serif", userSelect:"none" }}>
                    <input type="checkbox" checked={allChecked} onChange={()=>toggleUrSelAll(filteredIds)} style={{ accentColor:T.gold, width:13, height:13, cursor:"pointer" }}/>Select all
                  </label>
                )}
                {urSelected.size > 0 && !urBulkMode && (
                  <div style={{ display:"flex", gap:5, marginLeft:"auto" }}>
                    <span style={{ fontSize:11, color:T.dim, fontFamily:"'Crimson Pro',serif", alignSelf:"center" }}>{urSelected.size} selected</span>
                    <Btn onClick={()=>setUrBulkMode("color")}>Change Colour</Btn>
                    <Btn variant="danger" onClick={()=>setUrBulkMode("delete")}>Delete</Btn>
                    <Btn onClick={clearUrSel}>Cancel</Btn>
                  </div>
                )}
              </div>
              {urBulkMode==="color" && (
                <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:4, padding:"10px 12px", marginBottom:8 }}>
                  <div style={{ fontSize:11, color:T.dim, fontFamily:"'Crimson Pro',serif", marginBottom:6 }}>Set colour for {urSelected.size} selected unique role{urSelected.size>1?"s":""}:</div>
                  <ColorPicker value={urBulkColor} onChange={v=>setUrBulkColor(v)}/>
                  <div style={{ display:"flex", gap:6, marginTop:8 }}>
                    <Btn variant="primary" onClick={applyUrBulkColor}>Apply to {urSelected.size} unique role{urSelected.size>1?"s":""}</Btn>
                    <Btn onClick={clearUrSel}>Cancel</Btn>
                  </div>
                </div>
              )}
              {urBulkMode==="delete" && (
                <div style={{ background:"#2a0e0e", border:"1px solid #5a1a1a", borderRadius:4, padding:"10px 12px", marginBottom:8, display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                  <span style={{ fontSize:12, color:"#c06060", fontFamily:"'Crimson Pro',serif", flex:1 }}>Delete {urSelected.size} selected unique role{urSelected.size>1?"s":""}? This cannot be undone.</span>
                  <Btn variant="danger" onClick={applyUrBulkDelete}>Confirm Delete</Btn>
                  <Btn onClick={clearUrSel}>Cancel</Btn>
                </div>
              )}
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                {filtered.length===0 && <span style={{ fontSize:12, color:T.dim, fontStyle:"italic", fontFamily:"'Crimson Pro',serif", padding:"4px 0" }}>{(draftData.uniqueRoles||[]).length===0?"No unique roles yet.":"No matches."}</span>}
                {filtered.map(ur => (
                  <div key={ur.id} style={{ background:urSelected.has(ur.id)?T.gold+"18":T.card, border:`1px solid ${urSelected.has(ur.id)?T.gold:ur.color||"#888"}33`, borderRadius:4, padding:"8px 10px", transition:"background 0.1s" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                      <input type="checkbox" checked={urSelected.has(ur.id)} onChange={()=>toggleUrSel(ur.id)} style={{ accentColor:T.gold, width:13, height:13, cursor:"pointer", flexShrink:0 }}/>
                      <span style={{ fontSize:11, color:"#fff", background:ur.color||"#888", padding:"1px 7px", borderRadius:2, fontFamily:"Cinzel,serif", display:"flex", alignItems:"center", gap:4 }}>✦ {ur.name||<span style={{fontStyle:"italic",opacity:.6}}>Unnamed</span>}</span>
                      <span style={{ fontSize:10, color:T.dim, fontFamily:"'Crimson Pro',serif" }}>{ur.matchAll?"Needs ALL linked":"Needs ANY one linked"}</span>
                      <div style={{ display:"flex", gap:4, marginLeft:"auto", flexShrink:0 }}>
                        <Btn onClick={()=>setUrEdit({...ur,linkedBuffs:[...(ur.linkedBuffs||[])],linkedDebuffs:[...(ur.linkedDebuffs||[])],linkedStrengths:[...(ur.linkedStrengths||[])],linkedWeaknesses:[...(ur.linkedWeaknesses||[])],linkedElements:[...(ur.linkedElements||[])]})}>Edit</Btn>
                        <Btn onClick={()=>dupeUr(ur)}>Dupe</Btn>
                        {urDelConf===ur.id
                          ? <><Btn variant="danger" onClick={()=>{onDraftDataUpdate({...draftData,uniqueRoles:(draftData.uniqueRoles||[]).filter(r=>r.id!==ur.id)});setUrDelConf(null);}}>Confirm</Btn><Btn onClick={()=>setUrDelConf(null)}>Cancel</Btn></>
                          : <Btn variant="danger" onClick={()=>setUrDelConf(ur.id)}>Delete</Btn>
                        }
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                      {(ur.linkedBuffs||[]).map(id=>{const b=draftData.buffs?.find(x=>x.id===id);return b?<span key={id} style={{fontSize:9,padding:"1px 5px",borderRadius:2,background:"#20888822",color:"#208888"}}>{b.name}</span>:null;})}
                      {(ur.linkedDebuffs||[]).map(id=>{const d=draftData.debuffs?.find(x=>x.id===id);return d?<span key={id} style={{fontSize:9,padding:"1px 5px",borderRadius:2,background:"#a8286022",color:"#a82860"}}>{d.name}</span>:null;})}
                      {(ur.linkedStrengths||[]).map(id=>{const s=draftData.strengths?.find(x=>x.id===id);return s?<span key={id} style={{fontSize:9,padding:"1px 5px",borderRadius:2,background:"#3a7a5022",color:"#5aaa70"}}>{s.name}</span>:null;})}
                      {(ur.linkedWeaknesses||[]).map(id=>{const w=draftData.weaknesses?.find(x=>x.id===id);return w?<span key={id} style={{fontSize:9,padding:"1px 5px",borderRadius:2,background:"#7a303022",color:"#c06060"}}>{w.name}</span>:null;})}
                      {(ur.linkedElements||[]).map(el=><span key={el} style={{fontSize:9,padding:"1px 5px",borderRadius:2,background:EL_META[el]?.color+"22",color:EL_META[el]?.color,border:`1px solid ${EL_META[el]?.color}44`}}>{EL_META[el]?.label}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          );
        })()}
        {urEdit && <UniqueRoleModal ur={urEdit} draftData={draftData} onSave={saveUr} onClose={()=>setUrEdit(null)}/>}
      </div>

      {/* ── BUFFS / DEBUFFS / STRENGTHS / WEAKNESSES ── */}
      {SECS.map(({ key, label, color, desc }) => {
        const filtered    = sorted(draftData[key]||[], sort).filter(t=>!searches[key]||(t.name||"").toLowerCase().includes(searches[key].toLowerCase()));
        const filteredIds = filtered.map(t=>t.id);
        const sel         = selected[key];
        const allChecked  = filteredIds.length>0 && filteredIds.every(id=>sel.has(id));
        const anyChecked  = sel.size > 0;
        const mode        = bulkMode[key];
        return (
          <div key={key} style={{ marginBottom:24 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
              <span style={{ fontFamily:"Cinzel,serif", fontSize:10, color, letterSpacing:2 }}>{label}</span>
              <span style={{ fontSize:12, color:T.dim, fontStyle:"italic", fontFamily:"'Crimson Pro',serif" }}>{desc}</span>
              <Btn onClick={()=>setEdit({type:key, tag:key==="strengths"||key==="weaknesses"?blankSW():blankTag()})} style={{ marginLeft:"auto" }}>+ Add</Btn>
            </div>
            <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6, flexWrap:"wrap" }}>
              <input value={searches[key]} onChange={e=>setSearches(s=>({...s,[key]:e.target.value}))} placeholder={`Search ${label.toLowerCase()}…`} style={{...INP, fontSize:11, width:200}}/>
              {filtered.length > 0 && (
                <label style={{ display:"flex", alignItems:"center", gap:5, cursor:"pointer", fontSize:11, color:T.dim, fontFamily:"'Crimson Pro',serif", userSelect:"none" }}>
                  <input type="checkbox" checked={allChecked} onChange={()=>toggleSelectAll(key,filteredIds)} style={{ accentColor:color, width:13, height:13, cursor:"pointer" }}/>Select all
                </label>
              )}
              {anyChecked && !mode && (
                <div style={{ display:"flex", gap:5, marginLeft:"auto" }}>
                  <span style={{ fontSize:11, color:T.dim, fontFamily:"'Crimson Pro',serif", alignSelf:"center" }}>{sel.size} selected</span>
                  <Btn onClick={()=>setBulkMode(b=>({...b,[key]:"color"}))}>Change Colour</Btn>
                  <Btn variant="danger" onClick={()=>setBulkMode(b=>({...b,[key]:"delete"}))}>Delete</Btn>
                  <Btn onClick={()=>clearSelection(key)}>Cancel</Btn>
                </div>
              )}
            </div>
            {mode==="color" && (
              <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:4, padding:"10px 12px", marginBottom:8 }}>
                <div style={{ fontSize:11, color:T.dim, fontFamily:"'Crimson Pro',serif", marginBottom:6 }}>Set colour for {sel.size} selected tag{sel.size>1?"s":""}:</div>
                <ColorPicker value={bulkColor[key]} onChange={v=>setBulkColor(b=>({...b,[key]:v}))}/>
                <div style={{ display:"flex", gap:6, marginTop:8 }}>
                  <Btn variant="primary" onClick={()=>applyBulkColor(key)}>Apply to {sel.size} tag{sel.size>1?"s":""}</Btn>
                  <Btn onClick={()=>clearSelection(key)}>Cancel</Btn>
                </div>
              </div>
            )}
            {mode==="delete" && (
              <div style={{ background:"#2a0e0e", border:"1px solid #5a1a1a", borderRadius:4, padding:"10px 12px", marginBottom:8, display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                <span style={{ fontSize:12, color:"#c06060", fontFamily:"'Crimson Pro',serif", flex:1 }}>Delete {sel.size} selected tag{sel.size>1?"s":""}? This cannot be undone.</span>
                <Btn variant="danger" onClick={()=>applyBulkDelete(key)}>Confirm Delete</Btn>
                <Btn onClick={()=>clearSelection(key)}>Cancel</Btn>
              </div>
            )}
            {(()=>{
              // Separate root tags (no parentId) from subcategory tags
              const rootTags = filtered.filter(t => !t.parentId);
              const subMap   = {}; // parentId → [child tags]
              filtered.filter(t => t.parentId).forEach(t => { (subMap[t.parentId]||(subMap[t.parentId]=[])).push(t); });
              // Also show orphaned subs (parent not in filtered) at bottom
              const orphanSubs = filtered.filter(t => t.parentId && !filtered.find(r=>r.id===t.parentId));

              function renderTagRow(tag, isChild=false) {
                return (
                  <div key={tag.id}>
                    <div style={{ background:sel.has(tag.id)?color+"18":T.card, border:`1px solid ${sel.has(tag.id)?color:tag.color||color}33`, borderRadius:4, padding:"6px 10px", display:"flex", alignItems:"center", gap:8, transition:"background 0.1s", marginLeft: isChild ? 18 : 0 }}>
                      {isChild && <span style={{ fontSize:10, color:T.dim, marginRight:-4 }}>└</span>}
                      <input type="checkbox" checked={sel.has(tag.id)} onChange={()=>toggleSelect(key,tag.id)} style={{ accentColor:color, width:13, height:13, cursor:"pointer", flexShrink:0 }}/>
                      <Ico src={tag.icon} size={22} fallback={tag.name?.[0]||"?"}/>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:12, color:tag.color||color, fontFamily:"Cinzel,serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {isChild && <span style={{ fontSize:9, color:T.dim, fontFamily:"'Crimson Pro',serif", marginRight:4 }}>sub:</span>}
                          {tag.name||<span style={{color:T.dim,fontStyle:"italic"}}>Unnamed</span>}
                        </div>
                        {((tag.linkedDebuffs||[]).length>0 || (tag.linkedBuffs||[]).length>0) && (
                          <div style={{ fontSize:10, color:T.dim, fontFamily:"'Crimson Pro',serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                            {(tag.linkedDebuffs||[]).length>0 && <span>Debuffs: {tag.linkedDebuffs.map(id=>draftData.debuffs?.find(d=>d.id===id)?.name).filter(Boolean).join(", ")}</span>}
                            {(tag.linkedBuffs||[]).length>0   && <span style={{marginLeft:8}}>Buffs: {tag.linkedBuffs.map(id=>draftData.buffs?.find(b=>b.id===id)?.name).filter(Boolean).join(", ")}</span>}
                          </div>
                        )}
                      </div>
                      <div style={{ display:"flex", gap:4, flexShrink:0 }}>
                        {!isChild && (
                          <Btn onClick={()=>setEdit({type:key, tag:key==="strengths"||key==="weaknesses"?blankSW(tag.id):blankTag(tag.id)})}
                            style={{ fontSize:9, padding:"2px 7px" }} title="Add subcategory under this tag">＋ Sub</Btn>
                        )}
                        <Btn onClick={()=>setEdit({type:key, tag:{...tag,linkedBuffs:[...(tag.linkedBuffs||[])],linkedDebuffs:[...(tag.linkedDebuffs||[])],linkedRoles:[...(tag.linkedRoles||[])],synergizedRoles:[...(tag.synergizedRoles||[])],teamSupportRoles:[...(tag.teamSupportRoles||[])]}})}>Edit</Btn>
                        <Btn onClick={()=>doDuplicate(key,tag)}>Dupe</Btn>
                        {delConf===tag.id
                          ? <><Btn variant="danger" onClick={()=>doDelete(key,tag.id)}>Confirm</Btn><Btn onClick={()=>setDelConf(null)}>Cancel</Btn></>
                          : <Btn variant="danger" onClick={()=>setDelConf(tag.id)}>Delete</Btn>
                        }
                      </div>
                    </div>
                    {/* Subcategories indented beneath parent */}
                    {(subMap[tag.id]||[]).map(child => renderTagRow(child, true))}
                  </div>
                );
              }

              return (
                <div style={{ maxHeight:360, overflowY:"auto", display:"flex", flexDirection:"column", gap:4 }}>
                  {rootTags.map(tag => renderTagRow(tag, false))}
                  {orphanSubs.map(tag => renderTagRow(tag, false))}
                  {filtered.length===0 && <span style={{ fontSize:12, color:T.dim, fontStyle:"italic", fontFamily:"'Crimson Pro',serif", padding:"4px 0" }}>{(draftData[key]||[]).length===0?"None yet — add one above.":"No matches."}</span>}
                </div>
              );
            })()}
          </div>
        );
      })}

      {edit && <TagModal type={edit.type} tag={edit.tag} draftData={draftData} onSave={saveTag} onClose={()=>setEdit(null)}/>}
    </div>
  );
}

/* ═══════════════════════════════════════════
   DRAFT PICKER HELPERS
═══════════════════════════════════════════ */
const HIGHLIGHT = "#e8d060";

function clsIcon(cls, settings) {
  const ico = settings?.classIcons?.[cls];
  if (ico) return ico;
  const label = CL_META[cls]?.label || cls;
  return label.split(" ").map(w=>w[0]).join("");
}
function elIcon(el, settings) {
  const ico = settings?.elementIcons?.[el];
  if (ico) return ico;
  return (EL_META[el]?.label || el)[0];
}
function elColor(el) { return EL_META[el]?.color || "#666"; }

/* ── Truncation-aware tooltip ── */
function Tip({ text, children, style }) {
  const [pos, setPos] = useState(null);
  const innerRef = useRef();
  const ref = useRef();
  function isTruncated() { const el=innerRef.current; if(!el)return false; return el.scrollWidth>el.offsetWidth+1; }
  function show() { if(!isTruncated())return; if(!ref.current)return; const r=ref.current.getBoundingClientRect(); setPos({x:Math.round(r.left+r.width/2),y:Math.round(r.top-8)}); }
  function hide() { setPos(null); }
  const child = React.Children.only(children);
  const childWithRef = React.cloneElement(child, { ref: innerRef });
  return (
    <span ref={ref} style={{...style}} onMouseEnter={show} onMouseLeave={hide} onClick={e=>{e.stopPropagation();pos?hide():show();}}>
      {childWithRef}
      {pos && text && (
        <span style={{ position:"fixed", left:pos.x, top:pos.y, transform:"translate(-50%,-100%)", background:"#0d1526", border:"1px solid #1a3050", borderRadius:3, padding:"4px 10px", fontSize:11, color:"#dce8f5", fontFamily:"'Crimson Pro',serif", whiteSpace:"nowrap", zIndex:99999, pointerEvents:"none", boxShadow:"0 4px 16px rgba(0,0,0,.75)" }}>{text}</span>
      )}
    </span>
  );
}

/* ── Slot ── */
function Slot({ idx, hero, team, isActiveTeam, active, setActive, onRemove, highlight, settings }) {
  const isActive = isActiveTeam && active.idx === idx;
  const gc = highlight==="both"?"both-glow":highlight==="syn"?"syn-glow":highlight==="ctr"?"ctr-glow":isActive?"active-slot":"";
  const hasImg = hero?.iconData && (hero.iconData.startsWith("data:") || hero.iconData.startsWith("http") || hero.iconData.startsWith("blob:"));
  return (
    <div onClick={()=>setActive({team,idx})} className={gc}
      style={{ width:"100%", height:"100%", aspectRatio:"1", background:hero?T.card:T.bg, border:`1px solid ${hero?T.border:T.dim}`, borderRadius:4, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", cursor:"pointer", position:"relative", transition:"box-shadow 0.15s,border-color 0.15s", overflow:"hidden" }}>
      {hero && <button onMouseDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onRemove(team,idx);}} style={{ position:"absolute", top:2, right:3, background:"none", border:"none", color:"#ffffff99", fontSize:11, cursor:"pointer", lineHeight:1, padding:0, zIndex:2 }}>×</button>}
      {hero ? (
        <>
          {hasImg
            ? <img src={hero.iconData} alt="" style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover" }}/>
            : <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <span style={{ fontSize:28, color:T.dim, fontFamily:"Cinzel,serif", textAlign:"center", padding:"0 4px", lineHeight:1.2 }}>{clsIcon(hero.dClass||hero.class, settings)}</span>
              </div>
          }
          <div style={{ position:"absolute", bottom:0, left:0, right:0, background:"linear-gradient(transparent,#000000cc)", padding:"10px 3px 3px", zIndex:1 }}>
            <div style={{ fontFamily:"Cinzel,serif", fontSize:8, color:"#fff", textAlign:"center", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", width:"100%" }}>{hero.name||<span style={{color:"#ffffff66"}}>—</span>}</div>
          </div>
        </>
      ) : (
        <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <span style={{ fontFamily:"Cinzel,serif", fontSize:10, color:isActive?T.gold:T.dim }}>{isActive?"·":"+"}</span>
        </div>
      )}
    </div>
  );
}

/* ── Analysis sub-components ── */
function ASection({ title, color, children }) {
  const LINE=17, SHOW=3;
  return (
    <div style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:3, flexShrink:0 }}>
      <div style={{ fontFamily:"Cinzel,serif", fontSize:8, color:color||T.dim, letterSpacing:1.5, padding:"3px 7px 2px", borderBottom:`1px solid ${T.border}22` }}>{title}</div>
      <div style={{ maxHeight:LINE*SHOW+6, overflowY:"auto", padding:"3px 7px", display:"flex", flexDirection:"column", gap:2 }}>{children}</div>
    </div>
  );
}
function AChip({ tag, count }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:3 }}>
      <Ico src={tag.icon} size={12} fallback={tag.name?.[0]||"?"}/>
      <Tip text={tag.name} style={{ flex:1, overflow:"hidden", display:"inline-block" }}>
        <span style={{ fontSize:9, color:tag.color, fontFamily:"'Crimson Pro',serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"block" }}>{tag.name}</span>
      </Tip>
      {count>1 && <span style={{ fontSize:8, color:T.gold, fontFamily:"Cinzel,serif", flexShrink:0 }}>×{count}</span>}
    </div>
  );
}
function AEmpty() { return <span style={{ fontSize:9, color:T.dim, fontStyle:"italic", fontFamily:"'Crimson Pro',serif" }}>—</span>; }

/* ── Unique Role searchable filter dropdown ── */
function URSearchFilter({ uniqueRoles, value, onChange }) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef();
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const filtered = (uniqueRoles||[]).filter(ur => !search || (ur.name||"").toLowerCase().includes(search.toLowerCase()));
  const active   = value !== "All" ? (uniqueRoles||[]).find(ur=>ur.id===value) : null;
  return (
    <div ref={ref} style={{ position:"relative", minWidth:140 }}>
      <div onClick={()=>setOpen(v=>!v)}
        style={{ background:active?active.color+"22":T.card, border:`1px solid ${active?active.color:T.border}`, borderRadius:3, padding:"2px 8px", display:"flex", alignItems:"center", gap:5, cursor:"pointer", minHeight:22 }}>
        {active
          ? <span style={{ fontSize:10, color:active.color, fontFamily:"Cinzel,serif", display:"flex", alignItems:"center", gap:3 }}><span>✦</span>{active.name}</span>
          : <span style={{ fontSize:10, color:T.dim, fontFamily:"Cinzel,serif" }}>All Unique Roles</span>
        }
        <span style={{ color:T.dim, fontSize:9, marginLeft:"auto", flexShrink:0 }}>{open?"▲":"▼"}</span>
      </div>
      {open && (
        <div style={{ position:"absolute", top:"100%", left:0, zIndex:2000, background:T.panel, border:`1px solid ${T.border}`, borderRadius:3, width:200, maxHeight:200, overflowY:"auto", boxShadow:"0 8px 24px rgba(0,0,0,.65)" }}>
          <div style={{ padding:"4px 6px", borderBottom:`1px solid ${T.border}`, position:"sticky", top:0, background:T.panel }}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…" style={{...INP, fontSize:10}} autoFocus/>
          </div>
          <div onClick={()=>{onChange("All");setOpen(false);}}
            style={{ padding:"6px 10px", fontSize:10, color:value==="All"?T.gold:T.dim, fontFamily:"Cinzel,serif", background:value==="All"?T.gold+"18":undefined, borderBottom:`1px solid ${T.border}22`, cursor:"pointer" }}>
            All Unique Roles
          </div>
          {filtered.map(ur => (
            <div key={ur.id} onClick={()=>{onChange(ur.id);setOpen(false);}}
              style={{ padding:"6px 10px", fontSize:10, color:value===ur.id?ur.color:T.dim, fontFamily:"Cinzel,serif", background:value===ur.id?ur.color+"18":undefined, borderBottom:`1px solid ${T.border}22`, cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>
              <span style={{ color:ur.color }}>✦</span>{ur.name}
              {value===ur.id && <span style={{ marginLeft:"auto", color:ur.color, fontSize:9 }}>✓</span>}
            </div>
          ))}
          {filtered.length===0 && <div style={{ padding:"8px 10px", fontSize:11, color:T.dim, fontStyle:"italic", fontFamily:"'Crimson Pro',serif" }}>No matches</div>}
        </div>
      )}
    </div>
  );
}

/* ── Hero picker card (bottom roster strip) ── */
function HeroPickerCard({ hero, heroUR, draftData, onPick }) {
  const [showRoles, setShowRoles] = useState(false);
  const [roleSearch, setRoleSearch] = useState("");
  const ref = useRef();
  useEffect(() => {
    if (!showRoles) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) { setShowRoles(false); setRoleSearch(""); } };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showRoles]);
  const filteredUR = heroUR.filter(r => !roleSearch || (r.name||"").toLowerCase().includes(roleSearch.toLowerCase()));
  return (
    <div ref={ref} style={{ position:"relative", flexShrink:0 }}>
      <div onClick={()=>onPick(hero)}
        style={{ width:70, background:T.card, border:`1px solid ${T.border}`, borderRadius:4, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:2, padding:"3px", cursor:"pointer" }}>
        <Ico src={hero.iconData} size={34} fallback={clsIcon(hero.dClass||hero.class, draftData.settings)}/>
        <div style={{ fontSize:8, fontFamily:"Cinzel,serif", color:T.text, textAlign:"center", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", width:"100%", padding:"0 2px" }}>{hero.name||<span style={{color:T.dim}}>—</span>}</div>
        <div style={{ fontSize:7, color:elColor(hero.dElement||hero.element), fontFamily:"Cinzel,serif" }}>{EL_META[hero.dElement||hero.element]?.label}</div>
        {heroUR.length > 0 && (
          <button
            onMouseDown={e=>e.stopPropagation()}
            onClick={e=>{e.stopPropagation();setShowRoles(v=>!v);setRoleSearch("");}}
            style={{ background:showRoles?T.gold+"33":T.border+"66", border:`1px solid ${showRoles?T.gold:T.border}`, borderRadius:2, padding:"0 4px", fontSize:6, color:showRoles?T.gold:T.dim, fontFamily:"Cinzel,serif", cursor:"pointer", lineHeight:"13px", whiteSpace:"nowrap" }}>
            ✦{heroUR.length}
          </button>
        )}
      </div>
      {showRoles && (
        <div style={{ position:"fixed", zIndex:3000, background:T.panel, border:`1px solid ${T.border}`, borderRadius:4, padding:"6px 8px", boxShadow:"0 8px 24px rgba(0,0,0,.75)", minWidth:160, maxWidth:220 }}
          onMouseDown={e=>e.stopPropagation()}
          ref={el => {
            if (el && ref.current) {
              const r = ref.current.getBoundingClientRect();
              el.style.left = Math.min(r.left, window.innerWidth-230) + "px";
              el.style.top  = (r.top - el.offsetHeight - 6) + "px";
            }
          }}>
          <div style={{ fontFamily:"Cinzel,serif", fontSize:8, color:T.gold, letterSpacing:1, marginBottom:5 }}>{hero.name||"Hero"} · UNIQUE ROLES</div>
          <input value={roleSearch} onChange={e=>setRoleSearch(e.target.value)} placeholder="Search roles…" style={{...INP, fontSize:10, marginBottom:5}}/>
          <div style={{ display:"flex", flexDirection:"column", gap:3, maxHeight:200, overflowY:"auto" }}>
            {filteredUR.map(r => (
              <span key={r.id} style={{ fontSize:10, padding:"2px 6px", borderRadius:2, background:r.color+"22", border:`1px solid ${r.color}44`, color:r.color, fontFamily:"'Crimson Pro',serif", display:"flex", alignItems:"center", gap:4 }}>
                <span style={{fontSize:9}}>✦</span>{r.name}
              </span>
            ))}
            {filteredUR.length===0 && <span style={{ fontSize:10, color:T.dim, fontStyle:"italic", fontFamily:"'Crimson Pro',serif" }}>No matches</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Team panel ── */
function TeamPanel({ label, team, teamKey, opp, active, setActive, onRemove, draftData }) {
  const isActiveTeam = active.team === teamKey;
  const teammates    = team.filter(Boolean);
  const opponents    = opp.filter(Boolean);

  const ownBufSet  = useMemo(() => new Set(teammates.flatMap(h=>h.buffs||[])),  [team]);
  const oppDebSet  = useMemo(() => new Set(opponents.flatMap(h=>h.debuffs||[])), [opp]);
  const tBufCounts = useMemo(() => { const c={}; teammates.forEach(h=>(h.buffs||[]).forEach(id=>{c[id]=(c[id]||0)+1;})); return c; }, [team]);
  const tDebCounts = useMemo(() => { const c={}; teammates.forEach(h=>(h.debuffs||[]).forEach(id=>{c[id]=(c[id]||0)+1;})); return c; }, [team]);

  // Direct synergy pairs
  const synPairs = useMemo(() => {
    const p = [];
    for (let i=0;i<teammates.length;i++) for (let j=i+1;j<teammates.length;j++) {
      const a=teammates[i], b=teammates[j];
      if ((a.synergies||[]).includes(b.id)||(b.synergies||[]).includes(a.id)) p.push([a,b]);
    }
    return p;
  }, [team]);

  // Synergized role pairs (strength.synergizedRoles ✦ teammate with that role)
  const synRolePairs = useMemo(() => {
    const p = [];
    teammates.forEach(hero => {
      (hero.strengths||[]).forEach(sid => {
        const s = (draftData.strengths||[]).find(x=>x.id===sid);
        if (!s || !(s.synergizedRoles||[]).length) return;
        teammates.forEach(ally => {
          if (ally.id===hero.id) return;
          const allyRoles = [...(ally.dRoles||[]), ...getHeroUniqueRoles(ally, draftData.uniqueRoles||[]).map(r=>r.id)];
          if ((s.synergizedRoles||[]).some(rid=>allyRoles.includes(rid))) {
            const key = `${hero.id}:${ally.id}:${sid}`;
            if (!p.find(x=>x.key===key)) p.push({ key, hero, ally, strengthName:s.name, strengthColor:s.color||"#5aaa70" });
          }
        });
      });
    });
    return p;
  }, [team, draftData.strengths, draftData.uniqueRoles]);

  // Team support pairs (weakness.teamSupportRoles → ally covers it)
  const teamSupportPairs = useMemo(() => {
    const p = [];
    teammates.forEach(hero => {
      (hero.weaknesses||[]).forEach(wid => {
        const w = (draftData.weaknesses||[]).find(x=>x.id===wid);
        if (!w || !(w.teamSupportRoles||[]).length) return;
        teammates.forEach(ally => {
          if (ally.id===hero.id) return;
          const allyRoles = [...(ally.dRoles||[]), ...getHeroUniqueRoles(ally, draftData.uniqueRoles||[]).map(r=>r.id)];
          if ((w.teamSupportRoles||[]).some(rid=>allyRoles.includes(rid))) {
            const key = `${hero.id}:${ally.id}:${wid}`;
            if (!p.find(x=>x.key===key)) p.push({ key, hero, ally, weaknessName:w.name, weaknessColor:w.color||"#c06060" });
          }
        });
      });
    });
    return p;
  }, [team, draftData.weaknesses, draftData.uniqueRoles]);

  // Strengths analysis
  const strengthData = useMemo(() => {
    const pairs=[], tagMap=new Map();
    // Elemental advantage
    teammates.forEach(mine => {
      opponents.forEach(e => { if (EL_BEATS[mine.dElement||mine.element]===(e.dElement||e.element)) pairs.push({mine,opp:e,label:null,elemental:true}); });
    });
    teammates.forEach(mine => {
      // Direct strongAgainst
      (mine.strongAgainst||[]).forEach(eid => {
        const e = opponents.find(x=>x.id===eid);
        if (e && !pairs.find(p=>p.mine.id===mine.id&&p.opp.id===e.id&&p.elemental)) pairs.push({mine,opp:e,label:null,elemental:false});
      });
      // Strength tags
      (mine.strengths||[]).forEach(sid => {
        const s = (draftData.strengths||[]).find(x=>x.id===sid); if (!s) return;
        const debMatch = (s.linkedDebuffs||[]).some(d=>oppDebSet.has(d));
        const bufMatch = (s.linkedBuffs||[]).some(b=>ownBufSet.has(b));
        const roleHeroes = [];
        (s.linkedRoles||[]).forEach(role => {
          opponents.forEach(e => {
            const eRoles = [...(e.dRoles||[]), ...getHeroUniqueRoles(e, draftData.uniqueRoles||[]).map(r=>r.id)];
            if (eRoles.includes(role) && !roleHeroes.find(x=>x.id===e.id)) roleHeroes.push(e);
          });
        });
        if (!tagMap.has(sid)) tagMap.set(sid, {tag:s, highlighted:debMatch||bufMatch||roleHeroes.length>0, roleHeroes});
        (s.linkedDebuffs||[]).forEach(d => {
          opponents.forEach(e => {
            if ((e.debuffs||[]).includes(d) && !pairs.find(p=>p.mine.id===mine.id&&p.opp.id===e.id&&p.label===s.name)) pairs.push({mine,opp:e,label:s.name,elemental:false});
          });
        });
        (s.linkedRoles||[]).forEach(role => {
          opponents.forEach(e => {
            const eRoles = [...(e.dRoles||[]), ...getHeroUniqueRoles(e, draftData.uniqueRoles||[]).map(r=>r.id)];
            if (eRoles.includes(role) && !pairs.find(p=>p.mine.id===mine.id&&p.opp.id===e.id&&p.label===s.name)) pairs.push({mine,opp:e,label:s.name,elemental:false});
          });
        });
      });
    });
    return { pairs:[...new Map(pairs.map(p=>[`${p.mine.id}:${p.opp.id}:${p.label}:${p.elemental}`,p])).values()], tags:[...tagMap.values()] };
  }, [team, opp, draftData.strengths, draftData.uniqueRoles, oppDebSet, ownBufSet]);

  // Weaknesses analysis
  const weaknessData = useMemo(() => {
    const pairs=[], tagMap=new Map();
    // Elemental weakness
    teammates.forEach(mine => {
      opponents.forEach(e => { if (EL_BEATS[e.dElement||e.element]===(mine.dElement||mine.element)) pairs.push({mine,opp:e,elemental:true}); });
    });
    teammates.forEach(mine => {
      (mine.weaknesses||[]).forEach(wid => {
        const w = (draftData.weaknesses||[]).find(x=>x.id===wid); if (!w) return;
        const debMatch = (w.linkedDebuffs||[]).some(d=>oppDebSet.has(d));
        const bufMatch = (w.linkedBuffs||[]).some(b=>ownBufSet.has(b));
        const roleHeroes = [];
        (w.linkedRoles||[]).forEach(role => {
          opponents.forEach(e => {
            const eRoles = [...(e.dRoles||[]), ...getHeroUniqueRoles(e, draftData.uniqueRoles||[]).map(r=>r.id)];
            if (eRoles.includes(role) && !roleHeroes.find(x=>x.id===e.id)) roleHeroes.push(e);
          });
        });
        if (!tagMap.has(wid)) tagMap.set(wid, {tag:w, highlighted:debMatch||bufMatch||roleHeroes.length>0, roleHeroes});
        (w.linkedDebuffs||[]).forEach(d => {
          opponents.forEach(e => {
            if ((e.debuffs||[]).includes(d) && !pairs.find(p=>p.mine.id===mine.id&&p.opp.id===e.id&&!p.elemental)) pairs.push({mine,opp:e,elemental:false});
          });
        });
        (w.linkedRoles||[]).forEach(role => {
          opponents.forEach(e => {
            const eRoles = [...(e.dRoles||[]), ...getHeroUniqueRoles(e, draftData.uniqueRoles||[]).map(r=>r.id)];
            if (eRoles.includes(role) && !pairs.find(p=>p.mine.id===mine.id&&p.opp.id===e.id&&!p.elemental)) pairs.push({mine,opp:e,elemental:false});
          });
        });
      });
      // Direct counters
      (mine.counters||[]).forEach(eid => {
        const e = opponents.find(x=>x.id===eid);
        if (e && !pairs.find(p=>p.mine.id===mine.id&&p.opp.id===e.id&&!p.elemental)) pairs.push({mine,opp:e,elemental:false});
      });
    });
    return { pairs:[...new Map(pairs.map(p=>[`${p.mine.id}:${p.opp.id}:${p.elemental}`,p])).values()], tags:[...tagMap.values()] };
  }, [team, opp, draftData.weaknesses, draftData.uniqueRoles, oppDebSet, ownBufSet]);

  const highlightOf = hero => {
    const allies = teammates.filter(h=>h.id!==hero.id);
    const hasSyn = allies.some(a=>(hero.synergies||[]).includes(a.id)||(a.synergies||[]).includes(hero.id));
    const hasCtr = opponents.some(e=>(hero.counters||[]).includes(e.id));
    return hasSyn&&hasCtr?"both":hasSyn?"syn":hasCtr?"ctr":null;
  };

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", padding:"8px 10px", gap:4, minWidth:0 }}>
      <div style={{ fontFamily:"Cinzel,serif", fontSize:10, color:T.gold, letterSpacing:3, flexShrink:0 }}>{label}</div>

      {/* 5 slots in a single row, each square via paddingBottom trick */}
      <div style={{ display:"flex", gap:4, flexShrink:0 }}>
        {[0,1,2,3,4].map(i => (
          <div key={i} style={{ flex:1, minWidth:0, position:"relative", paddingBottom:"20%" }}>
            <div style={{ position:"absolute", inset:0 }}>
              <Slot idx={i} hero={team[i]} team={teamKey} isActiveTeam={isActiveTeam} active={active} setActive={setActive} onRemove={onRemove} highlight={team[i]?highlightOf(team[i]):null} settings={draftData.settings}/>
            </div>
          </div>
        ))}
      </div>

      {/* Name list */}
      <div style={{ background:T.bg, borderRadius:2, padding:"3px 4px", flexShrink:0 }}>
        {teammates.length===0
          ? <span style={{ fontSize:8, color:T.dim, fontFamily:"Cinzel,serif" }}>— no heroes selected —</span>
          : <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
              {team.map((h,i) => h && (
                <div key={i} style={{ fontSize:9, fontFamily:"Cinzel,serif", color:T.text, overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis", lineHeight:1.5 }}>
                  <span style={{ color:T.dim, fontSize:8, marginRight:3 }}>{i+1}.</span>{h.name||<em style={{color:T.dim}}>Unnamed</em>}
                </div>
              ))}
            </div>
        }
      </div>

      {/* Analysis panels */}
      <div style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:4, minHeight:0 }}>

        <ASection title="BUFFS" color="#208888">
          {Object.entries(tBufCounts).map(([id,cnt]) => { const b=(draftData.buffs||[]).find(x=>x.id===id); if(!b)return null; return <AChip key={id} tag={b} count={cnt}/>; })}
          {Object.keys(tBufCounts).length===0 && <AEmpty/>}
        </ASection>

        <ASection title="DEBUFFS" color="#a82860">
          {Object.entries(tDebCounts).map(([id,cnt]) => { const d=(draftData.debuffs||[]).find(x=>x.id===id); if(!d)return null; return <AChip key={id} tag={d} count={cnt}/>; })}
          {Object.keys(tDebCounts).length===0 && <AEmpty/>}
        </ASection>

        <ASection title="SYNERGIES" color="#2a8050">
          {synPairs.map(([a,b],i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:3 }}>
              <Ico src={a.iconData} size={13} fallback={clsIcon(a.dClass||a.class, draftData.settings)}/>
              <Tip text={a.name||"—"} style={{ flex:1, overflow:"hidden", display:"inline-block" }}><span style={{ fontSize:9, color:T.text, fontFamily:"Cinzel,serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"block" }}>{a.name||"—"}</span></Tip>
              <span style={{ fontSize:8, color:T.gold }}>✦</span>
              <Ico src={b.iconData} size={13} fallback={clsIcon(b.dClass||b.class, draftData.settings)}/>
              <Tip text={b.name||"—"} style={{ flex:1, overflow:"hidden", display:"inline-block" }}><span style={{ fontSize:9, color:T.text, fontFamily:"Cinzel,serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"block" }}>{b.name||"—"}</span></Tip>
            </div>
          ))}
          {synRolePairs.map(({key,hero,ally,strengthName,strengthColor}) => (
            <div key={key} style={{ display:"flex", alignItems:"center", gap:3 }}>
              <Ico src={hero.iconData} size={13} fallback={clsIcon(hero.dClass||hero.class, draftData.settings)}/>
              <Tip text={hero.name||"—"} style={{ flex:1, overflow:"hidden", display:"inline-block" }}><span style={{ fontSize:9, color:T.text, fontFamily:"Cinzel,serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"block" }}>{hero.name||"—"}</span></Tip>
              <span style={{ fontSize:8, color:"#208888" }}>✦</span>
              <Ico src={ally.iconData} size={13} fallback={clsIcon(ally.dClass||ally.class, draftData.settings)}/>
              <Tip text={ally.name||"—"} style={{ flex:1, overflow:"hidden", display:"inline-block" }}><span style={{ fontSize:9, color:"#88cccc", fontFamily:"Cinzel,serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"block" }}>{ally.name||"—"}</span></Tip>
              <Tip text={strengthName} style={{ maxWidth:38, overflow:"hidden", display:"inline-block" }}><span style={{ fontSize:7, color:strengthColor, fontFamily:"'Crimson Pro',serif", fontStyle:"italic", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"block" }}>{strengthName}</span></Tip>
            </div>
          ))}
          {synPairs.length===0 && synRolePairs.length===0 && <AEmpty/>}
        </ASection>

        <ASection title="STRENGTHS" color="#3a9a60">
          {strengthData.pairs.map((p,i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:3 }}>
              <Ico src={p.mine.iconData} size={13} fallback={clsIcon(p.mine.dClass||p.mine.class, draftData.settings)}/>
              <Tip text={p.mine.name||"—"} style={{ maxWidth:52, overflow:"hidden", display:"inline-block" }}><span style={{ fontSize:9, color:T.text, fontFamily:"Cinzel,serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"block" }}>{p.mine.name||"—"}</span></Tip>
              <span style={{ fontSize:9, color:"#5aaa70" }}>▶</span>
              <Ico src={p.opp.iconData} size={13} fallback={clsIcon(p.opp.dClass||p.opp.class, draftData.settings)}/>
              <Tip text={p.opp.name||"—"} style={{ maxWidth:52, overflow:"hidden", display:"inline-block" }}><span style={{ fontSize:9, color:"#a0d0a8", fontFamily:"Cinzel,serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"block" }}>{p.opp.name||"—"}</span></Tip>
              {p.elemental && <LeafIcon size={10} color="#4cba60"/>}
              {!p.elemental && p.label && <Tip text={p.label} style={{ maxWidth:40, overflow:"hidden", display:"inline-block" }}><span style={{ fontSize:7, color:"#3a9a60", fontFamily:"'Crimson Pro',serif", fontStyle:"italic", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"block" }}>{p.label}</span></Tip>}
            </div>
          ))}
          {strengthData.tags.map(({tag,highlighted,roleHeroes},i) => (
            <div key={`t${i}`} className={highlighted?"hl":""} style={{ display:"flex", flexDirection:"column", gap:2, borderRadius:2, padding:"2px 2px", transition:"all 0.2s" }}>
              <div style={{ display:"flex", alignItems:"center", gap:3 }}>
                <Ico src={tag.icon} size={12} fallback={tag.name?.[0]||"?"}/>
                <Tip text={tag.name} style={{ flex:1, overflow:"hidden", display:"inline-block" }}><span style={{ fontSize:9, color:highlighted?HIGHLIGHT:(tag.color||"#5aaa70"), fontFamily:"'Crimson Pro',serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontWeight:highlighted?700:400, display:"block" }}>{tag.name}</span></Tip>
                {highlighted && <span style={{ fontSize:9, color:HIGHLIGHT, flexShrink:0 }}>★</span>}
              </div>
              {roleHeroes && roleHeroes.length>0 && (
                <div style={{ display:"flex", alignItems:"center", gap:2, paddingLeft:4 }}>
                  <span style={{ fontSize:8, color:"#5aaa70", flexShrink:0 }}>▶</span>
                  {roleHeroes.map(e => <Ico key={e.id} src={e.iconData} size={13} fallback={clsIcon(e.dClass||e.class, draftData.settings)}/>)}
                </div>
              )}
            </div>
          ))}
          {strengthData.pairs.length===0 && strengthData.tags.length===0 && <AEmpty/>}
        </ASection>

        <ASection title="WEAKNESSES" color="#9a3030">
          {weaknessData.pairs.map(({mine,opp:e,elemental},i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:3 }}>
              <Ico src={mine.iconData} size={13} fallback={clsIcon(mine.dClass||mine.class, draftData.settings)}/>
              <Tip text={mine.name||"—"} style={{ maxWidth:52, overflow:"hidden", display:"inline-block" }}><span style={{ fontSize:9, color:T.text, fontFamily:"Cinzel,serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"block" }}>{mine.name||"—"}</span></Tip>
              <span style={{ fontSize:9, color:"#9a3030" }}>◀</span>
              <Ico src={e.iconData} size={13} fallback={clsIcon(e.dClass||e.class, draftData.settings)}/>
              <Tip text={e.name||"—"} style={{ maxWidth:52, overflow:"hidden", display:"inline-block" }}><span style={{ fontSize:9, color:"#a06060", fontFamily:"Cinzel,serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"block" }}>{e.name||"—"}</span></Tip>
              {elemental && <LeafIcon size={10} color="#4cba60"/>}
            </div>
          ))}
          {weaknessData.tags.map(({tag,highlighted,roleHeroes},i) => (
            <div key={`t${i}`} className={highlighted?"hl":""} style={{ display:"flex", flexDirection:"column", gap:2, borderRadius:2, padding:"2px 2px", transition:"all 0.2s" }}>
              <div style={{ display:"flex", alignItems:"center", gap:3 }}>
                <Ico src={tag.icon} size={12} fallback={tag.name?.[0]||"?"}/>
                <Tip text={tag.name} style={{ flex:1, overflow:"hidden", display:"inline-block" }}><span style={{ fontSize:9, color:highlighted?HIGHLIGHT:(tag.color||"#a06060"), fontFamily:"'Crimson Pro',serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontWeight:highlighted?700:400, display:"block" }}>{tag.name}</span></Tip>
                {highlighted && <span style={{ fontSize:9, color:HIGHLIGHT, flexShrink:0 }}>⚠</span>}
              </div>
              {roleHeroes && roleHeroes.length>0 && (
                <div style={{ display:"flex", alignItems:"center", gap:2, paddingLeft:4 }}>
                  <span style={{ fontSize:8, color:"#c06060", flexShrink:0 }}>◀</span>
                  {roleHeroes.map(e => <Ico key={e.id} src={e.iconData} size={13} fallback={clsIcon(e.dClass||e.class, draftData.settings)}/>)}
                </div>
              )}
            </div>
          ))}
          {weaknessData.pairs.length===0 && weaknessData.tags.length===0 && <AEmpty/>}
        </ASection>

        <ASection title="TEAM SUPPORT" color="#5890a8">
          {teamSupportPairs.map(({key,hero,ally,weaknessName,weaknessColor}) => (
            <div key={key} style={{ display:"flex", alignItems:"center", gap:3 }}>
              <Ico src={hero.iconData} size={13} fallback={clsIcon(hero.dClass||hero.class, draftData.settings)}/>
              <Tip text={hero.name||"—"} style={{ flex:1, overflow:"hidden", display:"inline-block" }}><span style={{ fontSize:9, color:T.text, fontFamily:"Cinzel,serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"block" }}>{hero.name||"—"}</span></Tip>
              <span style={{ fontSize:8, color:"#5890a8" }}>🛡</span>
              <Ico src={ally.iconData} size={13} fallback={clsIcon(ally.dClass||ally.class, draftData.settings)}/>
              <Tip text={ally.name||"—"} style={{ flex:1, overflow:"hidden", display:"inline-block" }}><span style={{ fontSize:9, color:"#88aacc", fontFamily:"Cinzel,serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"block" }}>{ally.name||"—"}</span></Tip>
              <Tip text={weaknessName} style={{ maxWidth:38, overflow:"hidden", display:"inline-block" }}><span style={{ fontSize:7, color:weaknessColor, fontFamily:"'Crimson Pro',serif", fontStyle:"italic", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"block" }}>{weaknessName}</span></Tip>
            </div>
          ))}
          {teamSupportPairs.length===0 && <AEmpty/>}
        </ASection>

      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   DRAFT PICKER VIEW — full 5v5
═══════════════════════════════════════════ */
function DraftPickerView({ heroes, draftData }) {
  const [myTeam,    setMyTeam]    = useState(Array(5).fill(null));
  const [enemyTeam, setEnemyTeam] = useState(Array(5).fill(null));
  const [active,    setActive]    = useState({ team:"my", idx:0 });
  const [search,    setSearch]    = useState("");
  const [fEl,       setFEl]       = useState("All");
  const [fCl,       setFCl]       = useState("All");
  const [fUR,       setFUR]       = useState("All");
  const [sort,      setSort]      = useState("az");

  const roster = useMemo(() => {
    const currentTeam = active.team==="my" ? myTeam : enemyTeam;
    const used = new Set(currentTeam.filter(Boolean).map(h=>h.id));
    let h = heroes.filter(x => !used.has(x.id));
    if (fEl !== "All") h = h.filter(x => (x.dElement||x.element) === fEl);
    if (fCl !== "All") h = h.filter(x => (x.dClass||x.class) === fCl);
    if (fUR !== "All") h = h.filter(x => getHeroUniqueRoles(x, draftData.uniqueRoles||[]).some(r=>r.id===fUR));
    if (search)        h = h.filter(x => (x.name||"").toLowerCase().includes(search.toLowerCase()));
    return sorted(h, sort);
  }, [heroes, myTeam, enemyTeam, fEl, fCl, fUR, search, sort, active.team, draftData.uniqueRoles]);

  function pick(hero) {
    const t   = active.team==="my" ? myTeam : enemyTeam;
    const set = active.team==="my" ? setMyTeam : setEnemyTeam;
    const n   = [...t]; n[active.idx] = hero; set(n);
    const nx  = n.findIndex((h,i) => i!==active.idx && !h);
    if (nx >= 0) { setActive({ team:active.team, idx:nx }); return; }
    if (active.team==="my") { const ei=enemyTeam.findIndex(h=>!h); if(ei>=0) setActive({ team:"enemy", idx:ei }); }
  }
  function remove(team, idx) {
    if (team==="my") { const n=[...myTeam]; n[idx]=null; setMyTeam(n); }
    else             { const n=[...enemyTeam]; n[idx]=null; setEnemyTeam(n); }
    setActive({ team, idx });
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>

      {/* ── TOP 75%: Teams side by side ── */}
      <div style={{ height:"75%", minHeight:0, display:"flex", overflow:"hidden", flexShrink:0 }}>
        <TeamPanel label="MY TEAM"    team={myTeam}    teamKey="my"    opp={enemyTeam} active={active} setActive={setActive} onRemove={remove} draftData={draftData}/>
        <div style={{ width:1, background:T.border, flexShrink:0 }}/>
        <TeamPanel label="ENEMY TEAM" team={enemyTeam} teamKey="enemy" opp={myTeam}    active={active} setActive={setActive} onRemove={remove} draftData={draftData}/>
      </div>

      {/* ── BOTTOM 25%: Hero picker ── */}
      <div style={{ height:"25%", minHeight:0, background:T.panel, borderTop:`2px solid ${T.border}`, display:"flex", flexDirection:"column", overflow:"hidden", flexShrink:0 }}>

        {/* Top row: active slot label + search + filters */}
        <div style={{ padding:"4px 12px 3px", display:"flex", gap:6, alignItems:"center", flexShrink:0, flexWrap:"wrap", borderBottom:`1px solid ${T.border}` }}>
          <span style={{ fontFamily:"Cinzel,serif", fontSize:9, color:T.gold, letterSpacing:2, flexShrink:0 }}>{active.team==="my"?"MY":"ENEMY"} · SLOT {active.idx+1}</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search heroes…" style={{...INP, width:120, fontSize:11}}/>
          <SortRow sort={sort} setSort={setSort}/>

          {/* Element filter inline */}
          <div style={{ display:"flex", gap:3, alignItems:"center", overflowX:"auto", flexShrink:0 }}>
            <span style={{ fontFamily:"Cinzel,serif", fontSize:8, color:T.dim, letterSpacing:1, flexShrink:0 }}>EL</span>
            {["All",...Object.keys(EL_META)].map(el => (
              <button key={el} onClick={()=>setFEl(el)}
                style={{ background:fEl===el?(EL_META[el]?.color||T.gold):T.card, border:`1px solid ${fEl===el?(EL_META[el]?.color||T.gold):T.border}`, color:"#fff", padding:"2px 7px", borderRadius:2, fontSize:9, fontFamily:"Cinzel,serif", flexShrink:0, cursor:"pointer" }}>
                {el==="All" ? "All" : <span style={{ display:"flex", alignItems:"center", gap:2 }}><Ico src={draftData.settings?.elementIcons?.[el]||""} size={11} fallback={elIcon(el,draftData.settings)}/>{EL_META[el]?.label}</span>}
              </button>
            ))}
          </div>

          {/* Class filter inline */}
          <div style={{ display:"flex", gap:3, alignItems:"center", overflowX:"auto", flexShrink:0 }}>
            <span style={{ fontFamily:"Cinzel,serif", fontSize:8, color:T.dim, letterSpacing:1, flexShrink:0 }}>CL</span>
            {["All",...Object.keys(CL_META)].map(cl => (
              <button key={cl} onClick={()=>setFCl(cl)}
                style={{ background:fCl===cl?T.gold:T.card, border:`1px solid ${fCl===cl?T.gold:T.border}`, color:fCl===cl?"#04090f":T.dim, padding:"2px 7px", borderRadius:2, fontSize:9, fontFamily:"Cinzel,serif", flexShrink:0, cursor:"pointer" }}>
                {cl==="All" ? "All" : <span style={{ display:"flex", alignItems:"center", gap:2 }}><Ico src={draftData.settings?.classIcons?.[cl]||""} size={11} fallback={clsIcon(cl,draftData.settings)}/>{CL_META[cl]?.label}</span>}
              </button>
            ))}
          </div>

          {/* Unique role filter */}
          {(draftData.uniqueRoles||[]).length > 0 && (
            <URSearchFilter uniqueRoles={draftData.uniqueRoles||[]} value={fUR} onChange={setFUR}/>
          )}
        </div>

        {/* Hero cards strip — fills remaining height of the 25% zone */}
        <div style={{ flex:1, minHeight:0, display:"flex", gap:5, padding:"5px 12px 6px", overflowX:"auto", overflowY:"hidden", alignItems:"center" }}>
          {roster.map(hero => {
            const heroUR = getHeroUniqueRoles(hero, draftData.uniqueRoles||[]);
            return <HeroPickerCard key={hero.id} hero={hero} heroUR={heroUR} draftData={draftData} onPick={pick}/>;
          })}
          {roster.length===0 && <div style={{ color:T.dim, fontSize:12, fontStyle:"italic", fontFamily:"'Crimson Pro',serif", padding:"0 8px" }}>All heroes placed or no heroes match filter.</div>}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   ROOT DRAFT APP
═══════════════════════════════════════════ */
function DraftApp() {
  const [heroes,    setHeroes]    = useState(() => (window.chartHeroes||[]).map(enrichHero));
  const [draftData, setDraftData] = useState(() => loadDraftData());
  const [tab,       setTab]       = useState("heroes");
  const [saveStatus,setSaveStatus]= useState("");

  // Sync from chart whenever it updates
  useEffect(() => {
    function onChartUpdate() { setHeroes((window.chartHeroes||[]).map(enrichHero)); }
    window.addEventListener("chartHeroesUpdated", onChartUpdate);
    window.addEventListener("draftOpened",        onChartUpdate);
    return () => {
      window.removeEventListener("chartHeroesUpdated", onChartUpdate);
      window.removeEventListener("draftOpened",        onChartUpdate);
    };
  }, []);

  // Persist draft data whenever it changes
  useEffect(() => { saveDraftData(draftData); }, [draftData]);

  // Save a hero back to the shared chart array
  function handleHeroSave(saved) {
    const updated = (window.chartHeroes||[]).map(h => h.id===saved.id ? saved : h);
    window.chartHeroes = updated; // triggers chart saveLocal + re-render via setter
    setHeroes(updated.map(enrichHero));
  }

  // Cloud save — images are already URLs (uploaded via api/upload-image), so JSON stays small
  async function handleSave(pw) {
    setSaveStatus("⏳ Saving…");
    try {
      const res = await fetch("https://e7-chart.vercel.app/api/save", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ heroes: window.chartHeroes||[], draftData, password:pw }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error||"Save failed");
      setSaveStatus("✅ Saved to GitHub");
      setTimeout(()=>setSaveStatus(""), 4000);
    } catch(e) { setSaveStatus("❌ "+e.message); setTimeout(()=>setSaveStatus(""), 5000); }
  }

  // Cloud load
  async function handleLoad(pw) {
    setSaveStatus("⏳ Loading…");
    try {
      const res = await fetch("https://e7-chart.vercel.app/api/load", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ password:pw }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error||"Load failed");
      if (Array.isArray(json.heroes)) {
        window.chartHeroes = json.heroes;
        setHeroes(json.heroes.map(enrichHero));
      }
      if (json.draftData) setDraftData(migrateDraftData(json.draftData));
      setSaveStatus("✅ Loaded from GitHub");
      setTimeout(()=>setSaveStatus(""), 4000);
    } catch(e) { setSaveStatus("❌ "+e.message); setTimeout(()=>setSaveStatus(""), 5000); }
  }

  const TABS = [
    ["heroes",  "♞ HEROES"],
    ["tags",    "🏷 TAGS"],
    ["picker",  "⚔ DRAFT PICKER"],
    ["settings","⚙ SETTINGS"],
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:T.bg, color:T.text, fontFamily:"'Crimson Pro',serif" }}>
      <style>{`
        .syn-glow  { box-shadow: 0 0 0 1px #2a8050, 0 0 16px #2a804466 !important; }
        .ctr-glow  { box-shadow: 0 0 0 1px #803028, 0 0 16px #80302844 !important; }
        .both-glow { box-shadow: 0 0 0 1px #a88020, 0 0 16px #a8802044 !important; }
        .active-slot { box-shadow: 0 0 0 1px #c9a227, 0 0 12px #c9a22733 !important; border-color: #c9a227 !important; }
        .hl { background: #e8d06022 !important; border-color: #e8d06088 !important; box-shadow: 0 0 5px #e8d06044 !important; }
      `}</style>

      {/* Draft header */}
      <div style={{ background:"linear-gradient(180deg,#060e1c 0%,rgba(6,14,28,.96) 100%)", borderBottom:`1px solid ${T.goldDim}`, padding:"10px 18px", display:"flex", alignItems:"center", gap:10, flexShrink:0, flexWrap:"wrap" }}>
        <div style={{ fontFamily:"Cinzel,serif", color:T.gold, fontSize:12, letterSpacing:".22em", flexShrink:0 }}>
          DRAFT <span style={{ color:T.blue2, fontSize:9, letterSpacing:".2em", marginLeft:6 }}>· {heroes.length} heroes</span>
        </div>

        {/* Tab bar */}
        <div style={{ display:"flex", gap:4, flex:1, flexWrap:"wrap" }}>
          {TABS.map(([v,l]) => (
            <button key={v} onClick={()=>setTab(v)}
              style={{ background:tab===v?"rgba(201,162,39,.15)":"transparent", border:`1px solid ${tab===v?T.goldDim:T.border}`, color:tab===v?T.gold2:T.dim, padding:"5px 13px", borderRadius:3, fontSize:10, fontFamily:"Cinzel,serif", letterSpacing:".1em", cursor:"pointer", transition:"all .15s" }}>
              {l}
            </button>
          ))}
        </div>

        {/* Save status */}
        {saveStatus && <span style={{ fontSize:12, color:T.gold, fontStyle:"italic", fontFamily:"'Crimson Pro',serif" }}>{saveStatus}</span>}

        {/* Close button — returns to Chart */}
        <button onClick={()=>{
          document.getElementById("draft-panel").style.display="none";
          document.getElementById("btn-draft-toggle").classList.remove("active");
        }} style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.dim, padding:"5px 12px", borderRadius:3, fontSize:10, fontFamily:"Cinzel,serif", letterSpacing:".1em", cursor:"pointer", flexShrink:0 }}>
          ← Chart
        </button>
      </div>

      {/* Tab content */}
      <div style={{ flex:1, overflow:"hidden", display:"flex", flexDirection:"column" }}>
        {tab==="heroes"  && <HeroesView heroes={heroes} draftData={draftData} onHeroSave={handleHeroSave}/>}
        {tab==="tags"    && <TagsView draftData={draftData} onDraftDataUpdate={setDraftData}/>}
        {tab==="picker"  && <DraftPickerView heroes={heroes} draftData={draftData}/>}
        {tab==="settings"&& <SettingsView heroes={heroes} draftData={draftData} onDraftDataUpdate={setDraftData} saveStatus={saveStatus} onSave={handleSave} onLoad={handleLoad}/>}
      </div>

      {/* Footer */}
      <div style={{ background:T.panel, borderTop:`1px solid ${T.border}`, padding:"7px 18px", flexShrink:0, textAlign:"center" }}>
        <span style={{ fontFamily:"'Crimson Pro',serif", fontSize:10, color:T.dim, fontStyle:"italic" }}>
          Credits: <a href="https://ceciliabot.github.io/#/" target="_blank" rel="noopener" style={{color:T.blue2}}>ceciliabot.github.io</a> · Made with Claude AI · <strong style={{color:T.dim,fontStyle:"normal"}}>iridesuwa</strong> 🩵
        </span>
      </div>
    </div>
  );
}

/* ── Mount ── */
const draftRoot = ReactDOM.createRoot(document.getElementById("draft-root"));
draftRoot.render(<DraftApp/>);
