/* ═══════════════════════════════════════════════════════════════════
   HERO EQUIPMENT & ARTIFACTS

   (Each class also has an Equipment Planner table — Gear Set | Artifact
   Type | Assigned heroes. Each row has its own ✏️ Edit → 💾 Save; only
   one row can be edited at a time, and ＋ Add row sits under it.)

   A drawer above Quick Draft with one block per class (Warrior, Knight,
   Thief, Ranger, Mage, Soul Weaver). Each class has two sections —
   Equipment and Artifacts — and each section has:
     • a notes line (✏️ to edit), and
     • any number of entries (➕ to add; ✏️ edit / 🗑 delete each).

   State is the global `heroGear` (declared + normalized in app.js, and
   saved/loaded/exported with everything else). This file is only the UI.
   Loaded after app.js, sharing its top-level scope.
═══════════════════════════════════════════════════════════════════ */

// Which text field is currently being edited: "Knight|equipment|note" or
// "Knight|equipment|item:<id>". Only one at a time keeps things simple.
let hgEditing = null;
let hgUnusedEditing = null; // class whose copy of the shared "sets not in use" note is open for editing
let hgOpen = false;

// Equipment Planner: ONE row at a time can be edited (across the whole
// drawer). hgEdit holds that row's working copy — typing edits the copy,
// 💾 Save commits it into heroGear, Cancel throws it away.
//   { cls, row: {id,gearSet,artifactType,setType,setCount,heroIds},
//     isNew, insertAt }   (insertAt = where a brand-new row will land)
let hgEdit = null;

function hgMarkChanged() {
  hasUnsavedChanges = true;
  if (typeof filterEquip !== "undefined" && filterEquip.size) renderRoster(); // equipment filter depends on the planner
  if (typeof updateTaxonomySaveReminder === "function") updateTaxonomySaveReminder();
}

function hgEsc(str) {
  return String(str ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

// ── Drawers (collapsible sections) ─────────────────────────────────
// The drawer is a tree of <details>: A. CLASS → 1. EQUIPMENT / 2. ARTIFACTS /
// 3. EQUIPMENT PLANNER / 4. NOT FULLY EQUIPPED → (planner) A. GEAR SET →
// 1. ARTIFACT TYPE / 2. HEROES. Letters and numbers alternate level by level
// so you always know where you are. Which drawers are open is remembered in
// hgOpenKeys (by key), so re-rendering after an edit never snaps them shut.
const hgOpenKeys = new Set();
const hgLetter = i => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));

function hgDrawer(key, { idx, title, meta = "", badge = "", level, body }) {
  return `<details class="hg-d hg-d-${level}" data-key="${hgEsc(key)}"${hgOpenKeys.has(key) ? " open" : ""}>
    <summary><span class="hg-idx">${idx}</span><span class="hg-d-title">${title}</span>${badge}${meta ? `<span class="hg-d-meta">${meta}</span>` : ""}</summary>
    <div class="hg-d-body">${body}</div>
  </details>`;
}
// Make sure a planner row (and the drawers above it) are open — used when
// you start editing / adding so the form is never hidden inside a closed drawer.
function hgOpenPath(cls, rowId) {
  hgOpenKeys.add(`c:${cls}`);
  hgOpenKeys.add(`s:${cls}:planner`);
  if (rowId != null) hgOpenKeys.add(`r:${cls}:${rowId}`);
}
const hgPlural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function hgRowHTML(cls, kind, field, text, { isNote = false, deletable = false, placeholder = "" } = {}) {
  const key = `${cls}|${kind}|${field}`;
  const attrs = `data-cls="${hgEsc(cls)}" data-kind="${kind}" data-field="${hgEsc(field)}"`;
  if (hgEditing === key) {
    return `<div class="hg-row">
      <textarea class="hg-input" rows="2" ${attrs} placeholder="${hgEsc(placeholder)}">${hgEsc(text)}</textarea>
      <button type="button" class="hg-icon-btn hg-ok" ${attrs} title="Save">✓</button>
      <button type="button" class="hg-icon-btn hg-cancel" ${attrs} title="Cancel">✕</button>
    </div>`;
  }
  const shown = text.trim() ? hgEsc(text) : hgEsc(placeholder);
  return `<div class="hg-row">
    <div class="hg-text${isNote ? " hg-note" : ""}${text.trim() ? "" : " hg-empty"}">${shown}</div>
    <button type="button" class="hg-icon-btn hg-edit" ${attrs} title="Edit">✏️</button>
    ${deletable ? `<button type="button" class="hg-icon-btn hg-del" ${attrs} title="Delete">🗑</button>` : ""}
  </div>`;
}

// Body of the EQUIPMENT / ARTIFACTS drawers: a notes line, then the entries.
function hgSectionBodyHTML(cls, kind, label) {
  const sec = heroGear[cls][kind];
  return `<div class="hg-add-row"><button type="button" class="hg-pill hg-add" data-cls="${hgEsc(cls)}" data-kind="${kind}" title="Add ${label}">＋ Add entry</button></div>
    ${hgRowHTML(cls, kind, "note", sec.note, { isNote: true, placeholder: "Notes…" })}
    ${sec.items.map(it => hgRowHTML(cls, kind, `item:${it.id}`, it.text, { deletable: true, placeholder: "(empty)" })).join("")}`;
}

// ── Equipment Planner (per class) ──────────────────────────────────
function hgClassHeroes(cls) {
  return (typeof heroes !== "undefined" ? heroes : [])
    .filter(h => h.role === cls)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

// Keep the hero's original id type (number) when toggling from a data-attribute string.
function classHeroesId(cls, idStr) {
  return hgClassHeroes(cls).find(h => String(h.id) === idStr)?.id ?? idStr;
}

// Small round profile pic (falls back to ⚔️ when the hero has no icon).
function hgAvatar(h, cls = "hg-avatar") {
  return h && h.iconData
    ? `<img class="${cls}" src="${h.iconData}" alt="">`
    : `<span class="${cls} hg-avatar-fb">⚔️</span>`;
}
const hgHeroById = (cls, id) => hgClassHeroes(cls).find(h => String(h.id) === String(id));

// ── Set pieces ─────────────────────────────────────────────────────
// Every hero wears 6 pieces. A "4 set" row uses 4 of them; a "2 set ×N"
// row uses 2N (×1 = 2, ×2 = 4, ×3 = 6). A hero can be assigned to several
// rows of a class as long as the pieces across those rows total ≤ 6, e.g.
// 4 set + 2 set ×1, or 2 set ×1 + 2 set ×2. A 2 set ×3 fills all six.
const HG_PIECE_LIMIT = 6;

function hgRowPieces(r) {
  return r && r.setType === "2" ? 2 * (Number(r.setCount) || 1) : 4;
}
function hgSetLabel(r) {
  return r && r.setType === "2" ? `2 set ×${Number(r.setCount) || 1}` : "4 set";
}
// Pieces the hero already uses in every row other than `exceptRowId`.
function hgHeroPiecesUsed(rows, heroId, exceptRowId) {
  return rows
    .filter(r => String(r.id) !== String(exceptRowId) && r.heroIds.some(x => String(x) === String(heroId)))
    .reduce((sum, r) => sum + hgRowPieces(r), 0);
}

// The class's rows as they currently look on screen: saved rows, with the
// row being edited swapped for its working copy (or, for a new row, inserted
// at its spot). Same object as hgEdit.row, so edits made through it stick.
function hgEffectiveRows(cls) {
  const saved = heroGear[cls].planner;
  if (!hgEdit || hgEdit.cls !== cls) return saved;
  if (hgEdit.isNew) {
    const out = [...saved];
    out.splice(Math.min(hgEdit.insertAt, out.length), 0, hgEdit.row);
    return out;
  }
  return saved.map(r => String(r.id) === String(hgEdit.row.id) ? hgEdit.row : r);
}

function hgNewRow() {
  return { id: Date.now() + Math.floor(Math.random() * 1000), gearSet: "", artifactType: "", setType: "4", setCount: 1, heroIds: [] };
}

// ── Not fully equipped heroes (per class) ──────────────────────────
// Every hero of the class whose assigned planner rows add up to fewer than
// 6 pieces (heroes in no row at all count as 0/6). Live: it reflects the row
// currently being edited too. Heroes at 6/6 are left out.
function hgNotFullInfo(cls) {
  const all = hgClassHeroes(cls);
  const rows = hgEffectiveRows(cls);
  const used = h => rows
    .filter(r => r.heroIds.some(x => String(x) === String(h.id)))
    .reduce((sum, r) => sum + hgRowPieces(r), 0);
  const list = all
    .map(h => ({ h, n: used(h) }))
    .filter(x => x.n < HG_PIECE_LIMIT)
    .sort((a, b) => gearCmp(a.h.name, b.h.name));

  const html = !all.length
    ? `<div class="hg-text hg-empty">No ${hgEsc(cls)} heroes added yet.</div>`
    : !list.length
      ? `<div class="hg-text hg-empty">All ${hgEsc(cls)} heroes are fully equipped (6/6) ✓</div>`
      : `<div class="hg-nf-list">${list.map(({ h, n }) =>
          `<span class="hg-hero-chip hg-nf-chip" data-hero="${hgEsc(h.id)}">${hgAvatar(h)}${hgEsc(h.name || "Unnamed")} <span class="hg-pick-note">${n}/${HG_PIECE_LIMIT}</span></span>`).join("")}</div>`;
  return { html, count: all.length ? list.length : 0 };
}

// Splits a row's heroes by their "partner" set: for a 4 set row, by the
// 2 set they also wear; for a 2 set row, by the 4 set they also wear. Heroes
// with no such partner row go in "Unassigned" (always last). Groups are A–Z
// by Gear Set name and heroes A–Z inside each.
function hgGroupRowHeroes(cls, rows, r) {
  const want = r.setType === "2" ? "4" : "2";
  const partners = rows.filter(p => String(p.id) !== String(r.id) && (p.setType === "2" ? "2" : "4") === want);
  const groups = new Map(); // key -> { title, label, heroes[] }
  const unassigned = [];
  r.heroIds.map(id => hgHeroById(cls, id)).filter(Boolean).forEach(h => {
    const p = partners.find(x => x.heroIds.some(i => String(i) === String(h.id)));
    if (!p) { unassigned.push(h); return; }
    const title = p.gearSet.trim() || "(no name)";
    const key = `${title.toLowerCase()}|${hgSetLabel(p)}`;
    if (!groups.has(key)) groups.set(key, { title, label: hgSetLabel(p), heroes: [] });
    groups.get(key).heroes.push(h);
  });
  const out = [...groups.values()].sort((a, b) => gearCmp(a.title, b.title));
  out.forEach(gr => gr.heroes.sort((a, b) => gearCmp(a.name, b.name)));
  if (unassigned.length) out.push({ title: "Unassigned", label: "", heroes: unassigned.sort((a, b) => gearCmp(a.name, b.name)), unassigned: true });
  return out;
}

// Body of the EQUIPMENT PLANNER drawer: the shared "not in use" note, then one
// drawer per Gear Set (A, B, C… in A–Z order), then ＋ Add row.
function hgPlannerBodyHTML(cls) {
  const rows = hgEffectiveRows(cls);
  const classHeroes = hgClassHeroes(cls);
  const heroOf = id => classHeroes.find(h => String(h.id) === String(id));
  const cAttr = `data-cls="${hgEsc(cls)}"`;
  const editingHere = !!hgEdit && hgEdit.cls === cls;
  const addBtn = disabled => `<div class="hg-add-row"><button type="button" class="hg-pill" ${cAttr} data-act="plan-add"${disabled ? ' disabled title="Finish editing the other row first"' : ""}>＋ Add gear set</button></div>`;

  // One shared text for every class ("sets I won't use"); editing it from any
  // class changes it everywhere.
  const unusedText = heroGear.unusedSets || "";
  const unusedEditingHere = hgUnusedEditing === cls;
  const unused = `<div class="hg-unused">
      <div class="hg-unused-label">Sets not in use · shared by all classes</div>
      ${unusedEditingHere
        ? `<div class="hg-row">
            <textarea class="hg-input" rows="3" placeholder="e.g. Counter, Torrent, Revenge…">${hgEsc(unusedText)}</textarea>
            <button type="button" class="hg-icon-btn hg-ok" data-gact="unused-ok" title="Save">✓</button>
            <button type="button" class="hg-icon-btn hg-cancel" data-gact="unused-cancel" title="Cancel">✕</button>
          </div>`
        : `<div class="hg-row">
            <div class="hg-text hg-note${unusedText.trim() ? "" : " hg-empty"}">${unusedText.trim() ? hgEsc(unusedText) : "Nothing written yet."}</div>
            <button type="button" class="hg-icon-btn" data-gact="unused-edit" data-ucls="${hgEsc(cls)}" title="Edit"${hgUnusedEditing ? " disabled" : ""}>✏️</button>
          </div>`}
    </div>`;

  const rowDrawers = rows.map((r, idx) => {
    const picked_heroes = r.heroIds.map(heroOf).filter(Boolean).sort((a, b) => gearCmp(a.name, b.name));
    const editingThis = editingHere && r === hgEdit.row;
    const meta = hgPlural(picked_heroes.length, "hero", "heroes");
    const badge = `<span class="hg-set-badge">${hgSetLabel(r)}</span>`;
    const title = hgEsc(r.gearSet.trim() || (editingThis ? "New gear set" : "(no name)"));
    const kv = (n, label, val) => `<div class="hg-kv"><div class="hg-kv-label"><span class="hg-idx">${n}.</span> ${label}</div><div class="hg-kv-val">${val}</div></div>`;

    let inner;
    if (!editingThis) {
      const groups = picked_heroes.length
        ? hgGroupRowHeroes(cls, rows, r).map(gr => `<div class="hg-group${gr.unassigned ? " hg-group-un" : ""}">
            <div class="hg-group-title">${hgEsc(gr.title)}${gr.label ? ` <span class="hg-set-badge">${gr.label}</span>` : ""}</div>
            <div class="hg-group-heroes">${gr.heroes.map(h => `<span class="hg-hero-chip" data-hero="${hgEsc(h.id)}">${hgAvatar(h)}${hgEsc(h.name || "Unnamed")}<button type="button" class="hg-chip-move" ${cAttr} data-act="plan-move" data-row="${r.id}" data-hero="${hgEsc(h.id)}" title="Move ${hgEsc(h.name || "hero")} to another gear set" aria-label="Move to another gear set">⇄</button></span>`).join("")}</div>
          </div>`).join("")
        : `<span class="hg-empty">—</span>`;
      inner = `${kv(1, "ARTIFACT TYPE", r.artifactType.trim() ? hgEsc(r.artifactType) : `<span class="hg-empty">—</span>`)}
        ${kv(2, "HEROES", groups)}
        <div class="hg-row-btns">
          <button type="button" class="hg-pill" ${cAttr} data-act="plan-edit" data-row="${r.id}" title="Edit this gear set">✏️ Edit</button>
          <button type="button" class="hg-pill" ${cAttr} data-act="plan-copy" data-row="${r.id}" title="Copy Gear Set + Artifact Type to another class">⧉ Copy to…</button>
        </div>`;
    } else {
      const picked = picked_heroes.map(h => `<span class="hg-tag">${hgAvatar(h)}${hgEsc(h.name || "Unnamed")}<button type="button" class="hg-tag-x" ${cAttr} data-act="plan-unhero" data-row="${r.id}" data-hero="${hgEsc(h.id)}" title="Remove">✕</button></span>`).join("");
      inner = `<div class="hg-kv"><div class="hg-kv-label">GEAR SET</div>
          <div class="hg-kv-val">
            <input type="text" class="hg-input hg-plan-in" ${cAttr} data-row="${r.id}" data-f="gearSet" value="${hgEsc(r.gearSet)}" placeholder="Gear set" aria-label="Gear set" list="hg-set-names" autocomplete="off">
            <div class="hg-settype">
              <button type="button" class="hg-pill${r.setType !== "2" ? " on" : ""}" ${cAttr} data-act="plan-settype" data-row="${r.id}" data-val="4">4 set</button>
              <button type="button" class="hg-pill${r.setType === "2" ? " on" : ""}" ${cAttr} data-act="plan-settype" data-row="${r.id}" data-val="2">2 set</button>
              ${r.setType === "2" ? [1, 2, 3].map(n => `<button type="button" class="hg-pill${(Number(r.setCount) || 1) === n ? " on" : ""}" ${cAttr} data-act="plan-setcount" data-row="${r.id}" data-val="${n}">×${n}</button>`).join("") : ""}
              <span class="hg-pick-note">${hgRowPieces(r)}/${HG_PIECE_LIMIT} pcs</span>
            </div>
          </div></div>
        ${kv(1, "ARTIFACT TYPE", `<input type="text" class="hg-input hg-plan-in" ${cAttr} data-row="${r.id}" data-f="artifactType" value="${hgEsc(r.artifactType)}" placeholder="Artifact type" aria-label="Artifact type">`)}
        ${kv(2, "HEROES", `<div class="hg-plan-heroes">${picked}<button type="button" class="hg-pill" ${cAttr} data-act="plan-pick" data-row="${r.id}">＋ Heroes</button></div>`)}
        <div class="hg-row-actions">
          <button type="button" class="hg-pill hg-save" ${cAttr} data-act="plan-save" data-row="${r.id}">💾 Save</button>
          <button type="button" class="hg-pill" ${cAttr} data-act="plan-cancel" data-row="${r.id}">✕ Cancel</button>
          <button type="button" class="hg-pill hg-copy-btn" ${cAttr} data-act="plan-copy" data-row="${r.id}" title="Copy Gear Set + Artifact Type to another class">⧉ Copy to…</button>
          <button type="button" class="hg-icon-btn hg-del" ${cAttr} data-act="plan-del" data-row="${r.id}" title="Delete this gear set">🗑</button>
        </div>
        ${addBtn(false)}`;
    }
    return hgDrawer(`r:${cls}:${r.id}`, { idx: hgLetter(idx) + ".", title, badge, meta, level: "row", body: inner });
  }).join("");

  const empty = rows.length === 0 ? `<div class="hg-text hg-empty">No gear sets yet.</div>` : "";
  // The Add button sits under the row being edited; otherwise at the bottom.
  return `${unused}${rowDrawers}${empty}${editingHere ? "" : addBtn(false)}`;
}

// Write the row being edited into heroGear. Returns the index just after it
// (where a follow-up new row should go), or -1 if nothing was edited.
function hgCommitEdit() {
  if (!hgEdit) return -1;
  const { cls, isNew, insertAt } = hgEdit;
  const saved = heroGear[cls].planner;
  const row = hgEdit.row;
  const need = hgRowPieces(row);
  const inRow = new Set();
  // A hero can't exceed 6 pieces across the class's other rows.
  const clean = {
    ...row,
    gearSet: row.gearSet.trim(),
    artifactType: row.artifactType.trim(),
    heroIds: row.heroIds.filter(id => {
      const k = String(id);
      if (inRow.has(k) || hgHeroPiecesUsed(saved, id, row.id) + need > HG_PIECE_LIMIT) return false;
      inRow.add(k);
      return true;
    }),
  };
  const blank = !clean.gearSet && !clean.artifactType && !clean.heroIds.length;
  let pos;
  if (isNew) {
    pos = Math.min(insertAt, saved.length);
    if (!blank) { saved.splice(pos, 0, clean); hgMarkChanged(); pos += 1; }
  } else {
    pos = saved.findIndex(r => String(r.id) === String(row.id));
    if (pos >= 0) {
      if (blank) saved.splice(pos, 1); else { saved[pos] = clean; pos += 1; }
      hgMarkChanged();
    }
  }
  hgEdit = null;
  // Keep the class's rows A–Z by Gear Set; "below this row" follows the row.
  sortPlannerRows(saved);
  if (!blank) { const at = saved.findIndex(r => r.id === clean.id); if (at >= 0) pos = at + 1; }
  return pos;
}

function hgPlannerClick(btn) {
  const { cls, act, row, hero } = btn.dataset;
  if (!heroGear[cls]) return;
  if (act === "plan-copy") { hgOpenCopyMenu(cls, row); return; } // works any time
  if (act === "plan-move") { hgOpenMoveMenu(cls, row, hero); return; } // works any time

  if (act === "plan-edit") {
    if (hgEdit) hgCommitEdit(); // starting another edit saves the open row first (no manual 💾 needed)
    const r = heroGear[cls].planner.find(x => String(x.id) === row);
    if (!r) return;
    hgEdit = { cls, row: { ...r, heroIds: [...r.heroIds] }, isNew: false, insertAt: 0 };
    hgOpenPath(cls, r.id);
  } else if (act === "plan-add") {
    // Adding while a row is open saves that row first (in any class); if it was
    // in this class the new blank row opens directly below it.
    const sameCls = !!hgEdit && hgEdit.cls === cls;
    const at = hgEdit ? hgCommitEdit() : heroGear[cls].planner.length;
    hgEdit = { cls, row: hgNewRow(), isNew: true, insertAt: (!sameCls || at < 0) ? heroGear[cls].planner.length : at };
    hgOpenPath(cls, hgEdit.row.id);
  } else if (!hgEdit || hgEdit.cls !== cls) {
    return;
  } else if (act === "plan-cancel") {
    hgEdit = null;
  } else if (act === "plan-save") {
    hgCommitEdit();
  } else if (act === "plan-del") {
    const r = hgEdit.row;
    const hasContent = r.gearSet.trim() || r.artifactType.trim() || r.heroIds.length;
    if (!hgEdit.isNew) {
      if (hasContent && !confirm("Delete this row?")) return;
      heroGear[cls].planner = heroGear[cls].planner.filter(x => String(x.id) !== String(r.id));
      hgMarkChanged();
    }
    hgEdit = null;
  } else if (act === "plan-settype" || act === "plan-setcount") {
    const r = hgEdit.row;
    const next = { ...r };
    if (act === "plan-settype") next.setType = btn.dataset.val === "2" ? "2" : "4";
    else next.setCount = Number(btn.dataset.val) || 1;
    // Don't let a change push an already-assigned hero past 6 pieces.
    const need = hgRowPieces(next);
    const rowsNow = hgEffectiveRows(cls);
    const over = r.heroIds.filter(id => hgHeroPiecesUsed(rowsNow, id, r.id) + need > HG_PIECE_LIMIT)
      .map(id => hgHeroById(cls, id)?.name || "A hero");
    if (over.length) {
      alert(`Can't change to ${hgSetLabel(next)} (${need} pieces): ${over.join(", ")} would go over ${HG_PIECE_LIMIT}. Remove them from this row first.`);
      return;
    }
    r.setType = next.setType; r.setCount = next.setCount;
  } else if (act === "plan-unhero") {
    hgEdit.row.heroIds = hgEdit.row.heroIds.filter(x => String(x) !== hero);
  } else if (act === "plan-pick") {
    hgOpenPicker(cls, row);
    return; // popup handles its own rendering
  }
  renderHeroGear();
}

// ── Hero picker popup ──────────────────────────────────────────────
// A fullscreen sheet on phones / centered modal on desktop (it reuses the
// Enemy Factors picker's look) listing every hero of the class, so a long
// roster never pushes the planner off-screen. Toggles write straight into
// the planner's working copy; heroes already used in another row are greyed
// out and can't be picked again.
//
// It has its OWN filters — Ranking Category chips, Reactions, Engagements
// and Enemy Factors (with the High/Low/Evasion… quick words) — that look
// and work like the Hero Factors panel's, but live entirely in hgPickFilt
// below. They never touch Quick Draft's ticked Enemy Factors or the Hero
// Factors panel's filters. Matching rules mirror Hero Factors (except Categories, which here need ALL ticked): ticked
// Reactions / Engagements default to ALL held (each has a Has all / Has any toggle), a Category matches if the hero
// holds any item in it, and an Enemy Factor matches
// if the hero holds any Reaction/Engagement tagged to it (any ticked factor).
let hgPickerEl = null;
let hgPickerCtx = null; // { cls, rowId }

const hgPickFilt = {
  search: "",
  categories: new Set(),
  excludeCategories: new Set(), // reverse filter: hide heroes holding anything in these
  reactionMode: "all",          // Reactions ticked: "all" = hero needs every one, "any" = at least one
  engagementMode: "all",        // same for Engagements
  excludeMode: "all",           // "all" = hide only heroes with EVERY hidden category; "any" = hide heroes with ANY of them
  hideRowIds: new Set(),        // hide heroes already assigned to these planner rows
  hideSetTypes: new Set(),      // hide heroes already in ANY row of these set types ("4" / "2")
  reactionIds: new Set(),
  engagementIds: new Set(),
  factorIds: new Set(),
  reactionSearch: "",
  engagementSearch: "",
  factorSearch: "",
};

function hgPickFiltCount() {
  return hgPickFilt.categories.size + hgPickFilt.excludeCategories.size + hgPickFilt.hideRowIds.size + hgPickFilt.hideSetTypes.size + hgPickFilt.reactionIds.size + hgPickFilt.engagementIds.size + hgPickFilt.factorIds.size;
}

function hgHeroMatchesFactor(h, factorId) {
  const { reactions: tr, engagements: te } = taxonomyItemsForFactor(factorId);
  return tr.some(r => hfHeroHasTag(h, "reactions", r.id)) || te.some(e => hfHeroHasTag(h, "engagements", e.id));
}

function hgPickerHeroes(cls) {
  let list = hgClassHeroes(cls);
  const f = hgPickFilt;
  const q = f.search.trim().toLowerCase();
  if (q) list = list.filter(h => String(h.name || "").toLowerCase().includes(q));
  if (f.reactionIds.size) list = list.filter(h => [...f.reactionIds][f.reactionMode === "any" ? "some" : "every"](id => hfHeroHasTag(h, "reactions", id)));
  if (f.engagementIds.size) list = list.filter(h => [...f.engagementIds][f.engagementMode === "any" ? "some" : "every"](id => hfHeroHasTag(h, "engagements", id)));
  // Multiple "Show" categories = the hero must have ALL of them.
  if (f.categories.size) list = list.filter(h => [...f.categories].every(c => hfHeroMatchesCategory(h, c)));
  // Hide heroes already assigned to a chosen row, or to any row of a chosen
  // set type (the row being edited never counts — it's the one being filled).
  if (f.hideRowIds.size || f.hideSetTypes.size) {
    const rows = hgPickerCtx ? hgEffectiveRows(cls).filter(r => String(r.id) !== String(hgPickerCtx.rowId)) : [];
    const hidden = new Set();
    rows.forEach(r => {
      if (f.hideRowIds.has(String(r.id)) || f.hideSetTypes.has(r.setType === "2" ? "2" : "4")) r.heroIds.forEach(id => hidden.add(String(id)));
    });
    list = list.filter(h => !hidden.has(String(h.id)));
  }
  // Reverse filter: drop any hero holding something in an excluded category.
  // Multiple "Hide" categories: per the toggle, hide heroes that have ALL of
  // them (default) or ANY of them.
  if (f.excludeCategories.size) {
    const test = h => f.excludeMode === "any"
      ? [...f.excludeCategories].some(c => hfHeroMatchesCategory(h, c))
      : [...f.excludeCategories].every(c => hfHeroMatchesCategory(h, c));
    list = list.filter(h => !test(h));
  }
  if (f.factorIds.size) list = list.filter(h => [...f.factorIds].some(id => hgHeroMatchesFactor(h, id)));
  return list;
}

function hgEnsurePicker() {
  if (hgPickerEl) return hgPickerEl;
  const el = document.createElement("div");
  el.className = "qd-factor-menu-overlay hg-picker";
  el.style.display = "none";
  el.innerHTML = `<div class="qd-factor-menu-panel hf-panel" id="hg-picker-panel"></div>`;
  document.body.appendChild(el);
  hgPickerEl = el;

  el.addEventListener("click", e => { if (e.target === el) hgClosePicker(); });
  el.addEventListener("keydown", e => { if (e.key === "Escape") hgClosePicker(); });
  return el;
}

// Controls are built once per open (so typing in a search box never loses
// focus); only the hero list underneath re-renders on each change.
function hgBuildPickerPanel() {
  const panel = document.getElementById("hg-picker-panel");
  const f = hgPickFilt;
  const sbox = (id, ph) => `<div class="qd-factor-menu-searchbar"><input type="text" class="taxonomy-search qd-factor-menu-search" id="${id}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${ph}" /></div>`;

  panel.innerHTML = `
    <div class="qd-factor-menu-header">
      <div class="qd-factor-menu-title" id="hg-picker-title"></div>
      <button type="button" class="qd-factor-menu-close" id="hg-picker-close" aria-label="Close">✕</button>
    </div>
    <div class="hf-scroll-body">
      ${sbox("hg-pf-search", "🔍 Search hero name…")}
      <div class="hf-filter-row">
        <span class="hf-count" id="hg-pf-count"></span>
        <button type="button" class="btn btn-ghost btn-xs" id="hg-pf-clear">✕ Clear filters</button>
      </div>
      <div class="hg-chip-label">Show heroes with</div>
      <div class="hf-category-chips" id="hg-pf-cats"></div>
      <div class="hg-chip-label hg-chip-label-x">Hide heroes with
        <span class="hg-mode" id="hg-pf-xmode">
          <button type="button" class="hg-pill${f.excludeMode !== "any" ? " on" : ""}" data-mode="all" title="Hide only heroes that have every selected category">Has all</button>
          <button type="button" class="hg-pill${f.excludeMode === "any" ? " on" : ""}" data-mode="any" title="Hide heroes that have any selected category">Has any</button>
        </span>
      </div>
      <div class="hf-category-chips hg-exclude-chips" id="hg-pf-xcats"></div>
      <div class="hg-chip-label hg-chip-label-x" id="hg-pf-rows-label">Hide heroes already in</div>
      <div class="hf-category-chips hg-exclude-chips" id="hg-pf-rowchips"></div>

      <details class="hf-details" id="hg-pf-d-r"${f.reactionIds.size ? " open" : ""}>
        <summary id="hg-pf-sum-r"></summary>
        <div class="hg-chip-label hg-mode-row">Hero must have
          <span class="hg-mode" id="hg-pf-rmode">
            <button type="button" class="hg-pill${f.reactionMode !== "any" ? " on" : ""}" data-mode="all" title="Hero needs every ticked item">Has all</button>
            <button type="button" class="hg-pill${f.reactionMode === "any" ? " on" : ""}" data-mode="any" title="Hero needs at least one ticked item">Has any</button>
          </span>
        </div>
        ${sbox("hg-pf-rsearch", "🔍 Search Reactions…")}
        <div class="qd-factor-menu-list" id="hg-pf-rlist"></div>
      </details>
      <details class="hf-details" id="hg-pf-d-e"${f.engagementIds.size ? " open" : ""}>
        <summary id="hg-pf-sum-e"></summary>
        <div class="hg-chip-label hg-mode-row">Hero must have
          <span class="hg-mode" id="hg-pf-emode">
            <button type="button" class="hg-pill${f.engagementMode !== "any" ? " on" : ""}" data-mode="all" title="Hero needs every ticked item">Has all</button>
            <button type="button" class="hg-pill${f.engagementMode === "any" ? " on" : ""}" data-mode="any" title="Hero needs at least one ticked item">Has any</button>
          </span>
        </div>
        ${sbox("hg-pf-esearch", "🔍 Search Engagements…")}
        <div class="qd-factor-menu-list" id="hg-pf-elist"></div>
      </details>
      <details class="hf-details" id="hg-pf-d-f"${f.factorIds.size ? " open" : ""}>
        <summary id="hg-pf-sum-f"></summary>
        ${sbox("hg-pf-fsearch", "🔍 Search Enemy Factors…")}
        <div class="qd-factor-menu-quickwords" id="hg-pf-quick"></div>
        <div class="qd-factor-menu-list" id="hg-pf-flist"></div>
      </details>

      <div class="hg-pick-bulk">
        <button type="button" class="hg-pill" id="hg-pick-all" title="Add every hero currently shown (that still has room for this set)">✓ Select all</button>
        <button type="button" class="hg-pill" id="hg-pick-none" title="Remove every hero from this row">✕ Clear all</button>
      </div>
      <div class="hg-picker-list" id="hg-picker-list"></div>
    </div>
    <button type="button" class="btn btn-gold hg-picker-done" id="hg-picker-done">DONE</button>`;

  document.getElementById("hg-picker-close").addEventListener("click", hgClosePicker);
  document.getElementById("hg-picker-done").addEventListener("click", hgClosePicker);

  const bind = (id, key, after) => {
    const inp = document.getElementById(id);
    inp.value = f[key];
    inp.addEventListener("input", () => { f[key] = inp.value; after(); });
  };
  bind("hg-pf-search", "search", hgRenderPickerList);
  bind("hg-pf-rsearch", "reactionSearch", () => hgRenderTagList("reactions"));
  bind("hg-pf-esearch", "engagementSearch", () => hgRenderTagList("engagements"));
  bind("hg-pf-fsearch", "factorSearch", () => { hgRenderQuickWords(); hgRenderFactorList(); });

  [["#hg-pf-rmode", "reactionMode"], ["#hg-pf-emode", "engagementMode"]].forEach(([sel, key]) => {
    document.querySelectorAll(sel + " button").forEach(btn => btn.addEventListener("click", () => {
      f[key] = btn.dataset.mode === "any" ? "any" : "all";
      document.querySelectorAll(sel + " button").forEach(b => b.classList.toggle("on", b === btn));
      hgRenderPickerList();
    }));
  });
  document.querySelectorAll("#hg-pf-xmode button").forEach(btn => btn.addEventListener("click", () => {
    f.excludeMode = btn.dataset.mode === "any" ? "any" : "all";
    document.querySelectorAll("#hg-pf-xmode button").forEach(b => b.classList.toggle("on", b === btn));
    hgRenderPickerList();
  }));

  document.getElementById("hg-pf-clear").addEventListener("click", () => {
    f.search = f.reactionSearch = f.engagementSearch = f.factorSearch = "";
    f.categories.clear(); f.excludeCategories.clear(); f.hideRowIds.clear(); f.hideSetTypes.clear(); f.reactionIds.clear(); f.engagementIds.clear(); f.factorIds.clear();
    hgBuildPickerPanel();
  });

  // Select all adds every hero currently SHOWN (so filters narrow it) that
  // still has room for this row's set; Clear all empties the whole row.
  document.getElementById("hg-pick-all").addEventListener("click", () => {
    if (!hgPickerCtx) return;
    const { cls, rowId } = hgPickerCtx;
    const rows = hgEffectiveRows(cls);
    const r = rows.find(x => String(x.id) === String(rowId));
    if (!r) return;
    const need = hgRowPieces(r);
    hgPickerHeroes(cls).forEach(h => {
      if (r.heroIds.some(x => String(x) === String(h.id))) return;
      if (hgHeroPiecesUsed(rows, h.id, rowId) + need <= HG_PIECE_LIMIT) r.heroIds.push(h.id);
    });
    hgRenderPickerList();
  });
  document.getElementById("hg-pick-none").addEventListener("click", () => {
    if (!hgPickerCtx) return;
    const r = hgEffectiveRows(hgPickerCtx.cls).find(x => String(x.id) === String(hgPickerCtx.rowId));
    if (r) r.heroIds = [];
    hgRenderPickerList();
  });

  document.getElementById("hg-picker-list").addEventListener("click", e => {
    const b = e.target.closest(".hg-pick-item");
    if (!b || b.disabled || !hgPickerCtx) return;
    const { cls, rowId } = hgPickerCtx;
    const draft = hgEffectiveRows(cls);
    const r = draft.find(x => String(x.id) === String(rowId));
    if (!r) return;
    const heroId = b.dataset.hero;
    const idx = r.heroIds.findIndex(x => String(x) === heroId);
    if (idx >= 0) r.heroIds.splice(idx, 1);
    else if (hgHeroPiecesUsed(draft, heroId, rowId) + hgRowPieces(r) <= HG_PIECE_LIMIT) r.heroIds.push(classHeroesId(cls, heroId));
    hgRenderPickerList();
  });

  hgRenderCategoryChips();
  hgRenderRowChips();
  hgRenderTagList("reactions");
  hgRenderTagList("engagements");
  hgRenderQuickWords();
  hgRenderFactorList();
  hgRenderPickerList();
}

function hgRenderCategoryChips() {
  const inc = document.getElementById("hg-pf-cats");
  const exc = document.getElementById("hg-pf-xcats");
  if (!inc || !exc) return;
  const cats = hfAllRankingCategories();
  const labelX = document.querySelector(".hg-chip-label-x");
  const labelI = inc.previousElementSibling;
  if (!cats.length) { inc.innerHTML = exc.innerHTML = ""; if (labelX) labelX.style.display = "none"; if (labelI) labelI.style.display = "none"; return; }

  const f = hgPickFilt;
  inc.innerHTML = cats.map(c => `<button type="button" class="qd-factor-priority-chip${f.categories.has(c) ? " active" : ""}" data-cat="${escAttr(c)}">${hgEsc(c)}</button>`).join("");
  exc.innerHTML = cats.map(c => `<button type="button" class="qd-factor-priority-chip hg-chip-x${f.excludeCategories.has(c) ? " active" : ""}" data-cat="${escAttr(c)}">${hgEsc(c)}</button>`).join("");

  // A category can't be both required and excluded — ticking one side
  // clears the other so the two rows never contradict each other.
  inc.querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
    const c = btn.dataset.cat;
    if (f.categories.has(c)) f.categories.delete(c); else { f.categories.add(c); f.excludeCategories.delete(c); }
    hgRenderCategoryChips();
    hgRenderPickerList();
  }));
  exc.querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
    const c = btn.dataset.cat;
    if (f.excludeCategories.has(c)) f.excludeCategories.delete(c); else { f.excludeCategories.add(c); f.categories.delete(c); }
    hgRenderCategoryChips();
    hgRenderPickerList();
  }));
}

// "Hide heroes already in …": one chip per other planner row that has heroes
// in it, plus All 4 set / All 2 set. Pressing a chip hides every hero assigned
// to that row (or to any row of that set type) from the list.
function hgRenderRowChips() {
  const box = document.getElementById("hg-pf-rowchips");
  const label = document.getElementById("hg-pf-rows-label");
  if (!box || !hgPickerCtx) return;
  const { cls, rowId } = hgPickerCtx;
  const f = hgPickFilt;
  const rows = hgEffectiveRows(cls).filter(r => String(r.id) !== String(rowId) && r.heroIds.length);
  // Forget picks for rows that no longer exist / are empty.
  [...f.hideRowIds].forEach(id => { if (!rows.some(r => String(r.id) === id)) f.hideRowIds.delete(id); });
  if (!rows.length) { box.innerHTML = ""; if (label) label.style.display = "none"; return; }
  if (label) label.style.display = "";

  const groups = ["4", "2"].filter(t => rows.some(r => (r.setType === "2" ? "2" : "4") === t));
  box.innerHTML =
    groups.map(t => `<button type="button" class="qd-factor-priority-chip hg-chip-x${f.hideSetTypes.has(t) ? " active" : ""}" data-set="${t}">All ${t} set</button>`).join("") +
    rows.map(r => `<button type="button" class="qd-factor-priority-chip hg-chip-x${f.hideRowIds.has(String(r.id)) ? " active" : ""}" data-rid="${hgEsc(r.id)}">${hgEsc(r.gearSet.trim() || "(no name)")} · ${hgSetLabel(r)}</button>`).join("");
  box.querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
    const set = btn.dataset.set ? f.hideSetTypes : f.hideRowIds;
    const key = btn.dataset.set || btn.dataset.rid;
    if (set.has(key)) set.delete(key); else set.add(key);
    hgRenderRowChips();
    hgRenderPickerList();
  }));
}

function hgRenderTagList(kind) {
  const isR = kind === "reactions";
  const listEl = document.getElementById(isR ? "hg-pf-rlist" : "hg-pf-elist");
  const sumEl = document.getElementById(isR ? "hg-pf-sum-r" : "hg-pf-sum-e");
  if (!listEl) return;
  const sel = isR ? hgPickFilt.reactionIds : hgPickFilt.engagementIds;
  const q = (isR ? hgPickFilt.reactionSearch : hgPickFilt.engagementSearch).trim().toLowerCase();
  const label = isR ? "Reactions" : "Engagements";
  sumEl.textContent = `${isR ? "⚡" : "🛡"} ${label}${sel.size ? ` (${sel.size})` : ""}`;

  const items = taxonomy[kind]
    .filter(it => !q || (it.name || "").toLowerCase().includes(q))
    .sort((a, b) => (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase()));
  if (!items.length) { listEl.innerHTML = `<div class="qd-factor-empty">No matching ${label}.</div>`; return; }

  listEl.innerHTML = items.map(it => `
    <label class="qd-factor-menu-item${sel.has(it.id) ? " active" : ""}">
      <input type="checkbox" data-id="${it.id}" ${sel.has(it.id) ? "checked" : ""} />
      <span>${hgEsc(it.name || "(unnamed)")} (${Number(it.value).toFixed(1)})</span>
    </label>`).join("");
  listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.addEventListener("change", () => {
    const item = taxonomy[kind].find(x => String(x.id) === cb.dataset.id);
    if (!item) return;
    if (cb.checked) sel.add(item.id); else sel.delete(item.id);
    cb.closest(".qd-factor-menu-item")?.classList.toggle("active", cb.checked);
    sumEl.textContent = `${isR ? "⚡" : "🛡"} ${label}${sel.size ? ` (${sel.size})` : ""}`;
    hgRenderPickerList();
  }));
}

// The High / Low / Evasion… chips — same words as Quick Draft's Enemy
// Factors picker, but they only fill THIS popup's own factor search box.
function hgRenderQuickWords() {
  const box = document.getElementById("hg-pf-quick");
  if (!box) return;
  const active = hgPickFilt.factorSearch.trim().toLowerCase();
  box.innerHTML = QD_FACTOR_QUICK_WORDS.map(w => `<button type="button" class="qd-factor-quickword${active === w.toLowerCase() ? " active" : ""}" data-word="${w}">${w}</button>`).join("");
  box.querySelectorAll("button").forEach(chip => chip.addEventListener("click", () => {
    const w = chip.dataset.word;
    const isActive = hgPickFilt.factorSearch.trim().toLowerCase() === w.toLowerCase();
    hgPickFilt.factorSearch = isActive ? "" : w;
    document.getElementById("hg-pf-fsearch").value = hgPickFilt.factorSearch;
    hgRenderQuickWords();
    hgRenderFactorList();
  }));
}

function hgRenderFactorList() {
  const listEl = document.getElementById("hg-pf-flist");
  const sumEl = document.getElementById("hg-pf-sum-f");
  if (!listEl) return;
  const sel = hgPickFilt.factorIds;
  const sync = () => { sumEl.textContent = `🎯 Enemy Factors${sel.size ? ` (${sel.size})` : ""}`; };
  sync();

  if (!taxonomy.factors.length) { listEl.innerHTML = `<div class="qd-factor-empty">No Factors defined yet — add some in 🗂 Taxonomy.</div>`; return; }
  const q = hgPickFilt.factorSearch.trim().toLowerCase();
  const items = [...taxonomy.factors]
    .sort((a, b) => (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase()))
    .filter(f => !q || (f.name || "").toLowerCase().includes(q));
  if (!items.length) { listEl.innerHTML = `<div class="qd-factor-empty">No matching Factors.</div>`; return; }

  listEl.innerHTML = items.map(f => `
    <label class="qd-factor-menu-item${sel.has(f.id) ? " active" : ""}">
      <input type="checkbox" data-id="${f.id}" ${sel.has(f.id) ? "checked" : ""} />
      <span>${hgEsc(f.name || "(unnamed)")}</span>
    </label>`).join("");
  listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.addEventListener("change", () => {
    const fac = taxonomy.factors.find(x => String(x.id) === cb.dataset.id);
    if (!fac) return;
    if (cb.checked) sel.add(fac.id); else sel.delete(fac.id);
    cb.closest(".qd-factor-menu-item")?.classList.toggle("active", cb.checked);
    sync();
    hgRenderPickerList();
  }));
}

function hgRenderPickerList() {
  if (!hgPickerCtx) return;
  const { cls, rowId } = hgPickerCtx;
  const draft = hgEffectiveRows(cls);
  const r = draft.find(x => String(x.id) === String(rowId));
  const list = hgPickerHeroes(cls);
  const all = hgClassHeroes(cls);
  const rowNo = draft.findIndex(x => String(x.id) === String(rowId)) + 1;

  document.getElementById("hg-picker-title").textContent =
    `${cls} heroes — Row ${rowNo} · ${hgSetLabel(r)} (${r ? r.heroIds.length : 0} picked)`;
  const countEl = document.getElementById("hg-pf-count");
  if (countEl) countEl.textContent = `${list.length} of ${all.length} ${cls} hero${all.length === 1 ? "" : "es"}${hgPickFiltCount() ? ` · ${hgPickFiltCount()} filter${hgPickFiltCount() === 1 ? "" : "s"}` : ""}`;

  document.getElementById("hg-picker-list").innerHTML = list.length
    ? list.map(h => {
        const on = !!r && r.heroIds.some(x => String(x) === String(h.id));
        const used = hgHeroPiecesUsed(draft, h.id, rowId);
        const need = hgRowPieces(r);
        const blocked = !on && used + need > HG_PIECE_LIMIT;
        const note = on ? `${used + need}/${HG_PIECE_LIMIT} pcs` : blocked ? `no room · ${used}/${HG_PIECE_LIMIT} used` : used ? `${used}/${HG_PIECE_LIMIT} used` : "";
        const icon = hgAvatar(h, "hg-pick-icon");
        return `<button type="button" class="hg-pick-item${on ? " on" : ""}${blocked ? " taken" : ""}" data-hero="${hgEsc(h.id)}"${blocked ? " disabled" : ""}>
          <span class="hg-pick-check">${on ? "✓" : ""}</span>
          ${icon}
          <span class="hg-pick-name">${hgEsc(h.name || "Unnamed")}</span>
          ${note ? `<span class="hg-pick-note">${note}</span>` : ""}
        </button>`;
      }).join("")
    : `<div class="hg-text hg-empty">${all.length ? "No heroes match these filters." : `No ${hgEsc(cls)} heroes added yet.`}</div>`;
}

function hgOpenPicker(cls, rowId) {
  hgPickerCtx = { cls, rowId };
  const el = hgEnsurePicker();
  hgBuildPickerPanel();
  el.style.display = "flex";
  document.body.classList.add("qd-factor-menu-open");
}

function hgClosePicker() {
  if (hgPickerEl) hgPickerEl.style.display = "none";
  document.body.classList.remove("qd-factor-menu-open");
  hgPickerCtx = null;
  renderHeroGear(); // refresh the row's hero tags behind the popup
}

// ── Copy a planner row to other classes ───────────────────────────
// Copies the Gear Set, Artifact Type and set option (4 set / 2 set ×N); Assigned heroes is left empty
// (the heroes belong to the source class). Tick any number of other
// classes, then COPY — classes that already have the row can't be ticked.
// If the target class is mid-edit the copy lands in its working copy
// (still needs its 💾 Save); otherwise it's added and saved straight away.
let hgCopyEl = null;

function hgPlannerRowsFor(cls) {
  return hgEffectiveRows(cls);
}

function hgRowKey(r) {
  return `${r.gearSet.trim().toLowerCase()}|${r.artifactType.trim().toLowerCase()}|${r.setType === "2" ? "2x" + (Number(r.setCount) || 1) : "4"}`;
}

function hgCopyRowTo(srcCls, rowId, targetCls) {
  const src = hgPlannerRowsFor(srcCls).find(r => String(r.id) === String(rowId));
  if (!src) return "missing";
  if (!src.gearSet.trim() && !src.artifactType.trim()) return "empty";
  const targetRows = hgPlannerRowsFor(targetCls);
  if (targetRows.some(r => hgRowKey(r) === hgRowKey(src))) return "dupe";
  heroGear[targetCls].planner.push({
    id: Date.now() + Math.floor(Math.random() * 1e6),
    gearSet: src.gearSet.trim(),
    artifactType: src.artifactType.trim(),
    setType: src.setType === "2" ? "2" : "4",
    setCount: Number(src.setCount) || 1,
    heroIds: [],
  });
  sortPlannerRows(heroGear[targetCls].planner);
  hgMarkChanged();
  return "ok";
}

function hgOpenCopyMenu(srcCls, rowId) {
  const src = hgPlannerRowsFor(srcCls).find(r => String(r.id) === String(rowId));
  if (!src) return;
  if (!hgCopyEl) {
    hgCopyEl = document.createElement("div");
    hgCopyEl.className = "qd-factor-menu-overlay hg-picker";
    hgCopyEl.style.display = "none";
    document.body.appendChild(hgCopyEl);
    hgCopyEl.addEventListener("click", e => { if (e.target === hgCopyEl) hgCloseCopyMenu(); });
    hgCopyEl.addEventListener("keydown", e => { if (e.key === "Escape") hgCloseCopyMenu(); });
  }
  const targets = GEAR_CLASSES.filter(c => c !== srcCls);
  const summary = [src.gearSet.trim(), src.artifactType.trim()].filter(Boolean).map(hgEsc).join(" · ");
  // Classes that already have this exact Gear Set + Artifact Type can't be picked.
  const has = c => hgPlannerRowsFor(c).some(r => hgRowKey(r) === hgRowKey(src));
  const selected = new Set();

  const paint = () => {
    const pickable = targets.filter(c => !has(c));
    hgCopyEl.innerHTML = `
      <div class="qd-factor-menu-panel hg-copy-panel">
        <div class="qd-factor-menu-header">
          <div class="qd-factor-menu-title">⧉ Copy to classes</div>
          <button type="button" class="qd-factor-menu-close" id="hg-copy-close" aria-label="Close">✕</button>
        </div>
        <div class="hg-text hg-copy-what">${summary || "(empty row)"}<br><span class="hg-pick-note">Heroes are not copied. Tick one or more classes.</span></div>
        <div class="hg-picker-list">
          ${targets.map(c => {
            const on = selected.has(c), dupe = has(c);
            return `<button type="button" class="hg-pick-item${on ? " on" : ""}${dupe ? " taken" : ""}" data-target="${hgEsc(c)}"${dupe ? " disabled" : ""}>
              <span class="hg-pick-check">${on ? "✓" : ""}</span>
              <span class="hg-pick-name">${hgEsc(c)}</span>
              ${dupe ? `<span class="hg-pick-note">Already has it</span>` : ""}
            </button>`;
          }).join("")}
        </div>
        <div class="hg-copy-actions">
          <button type="button" class="btn btn-ghost btn-xs" id="hg-copy-all"${pickable.length ? "" : " disabled"}>${selected.size === pickable.length && pickable.length ? "Select none" : "Select all"}</button>
          <button type="button" class="btn btn-gold hg-copy-go" id="hg-copy-go"${selected.size ? "" : " disabled"}>COPY TO ${selected.size || ""} ${selected.size === 1 ? "CLASS" : "CLASSES"}</button>
        </div>
      </div>`;
    hgCopyEl.querySelector("#hg-copy-close").addEventListener("click", hgCloseCopyMenu);
    hgCopyEl.querySelectorAll(".hg-pick-item").forEach(b => b.addEventListener("click", () => {
      const c = b.dataset.target;
      if (selected.has(c)) selected.delete(c); else selected.add(c);
      paint();
    }));
    hgCopyEl.querySelector("#hg-copy-all").addEventListener("click", () => {
      if (selected.size === pickable.length) selected.clear(); else pickable.forEach(c => selected.add(c));
      paint();
    });
    hgCopyEl.querySelector("#hg-copy-go").addEventListener("click", () => {
      const done = [...selected].filter(c => hgCopyRowTo(srcCls, rowId, c) === "ok");
      hgCloseCopyMenu();
      if (done.length && typeof setStatus === "function") setStatus(`✅ Copied to ${done.join(", ")}`);
    });
  };
  paint();
  hgCopyEl.style.display = "flex";
  document.body.classList.add("qd-factor-menu-open");
}

function hgCloseCopyMenu() {
  if (hgCopyEl) hgCopyEl.style.display = "none";
  document.body.classList.remove("qd-factor-menu-open");
  renderHeroGear(); // show the new rows in their classes
}

// ── Move a hero to a different gear set ───────────────────────────
// The ⇄ on a hero chip lists the class's other gear sets; picking one takes
// the hero out of the current row and puts them in the chosen one. Works
// without entering Edit mode. A set is greyed out if the hero is already in it
// or the move would push them past 6 pieces.
let hgMoveEl = null;
let hgMoveCtx = null;      // { cls, fromId, heroId } while the move menu is open (restored after a rotate/reload)
let hgEquipHeroId = null;  // hero shown in the equipment popup

function hgMoveHero(cls, fromId, toId, heroId) {
  const rows = heroGear[cls].planner;
  const from = rows.find(r => String(r.id) === String(fromId));
  const to = rows.find(r => String(r.id) === String(toId));
  if (!from || !to) return false;
  from.heroIds = from.heroIds.filter(x => String(x) !== String(heroId));
  if (!to.heroIds.some(x => String(x) === String(heroId))) to.heroIds.push(heroId);
  hgOpenPath(cls, to.id);
  hgMarkChanged();
  return true;
}

function hgOpenMoveMenu(cls, fromId, heroId) {
  if (hgEdit) hgCommitEdit(); // never let a stale working copy overwrite the move
  const rows = heroGear[cls]?.planner || [];
  const from = rows.find(r => String(r.id) === String(fromId));
  const hero = hgHeroById(cls, heroId);
  if (!from || !hero) { renderHeroGear(); return; }
  if (!hgMoveEl) {
    hgMoveEl = document.createElement("div");
    hgMoveEl.className = "qd-factor-menu-overlay hg-picker";
    hgMoveEl.style.display = "none";
    document.body.appendChild(hgMoveEl);
    hgMoveEl.addEventListener("click", e => { if (e.target === hgMoveEl) hgCloseMoveMenu(); });
    hgMoveEl.addEventListener("keydown", e => { if (e.key === "Escape") hgCloseMoveMenu(); });
  }
  const others = rows.filter(r => String(r.id) !== String(fromId))
    .sort((a, b) => gearCmp(a.gearSet, b.gearSet));
  // Pieces the hero wears in every row except the one they leave and the one they join.
  const piecesAfter = tgt => rows
    .filter(r => String(r.id) !== String(fromId) && String(r.id) !== String(tgt.id) && r.heroIds.some(x => String(x) === String(heroId)))
    .reduce((n, r) => n + hgRowPieces(r), 0) + hgRowPieces(tgt);
  const reason = t => t.heroIds.some(x => String(x) === String(heroId)) ? "Already in it"
    : piecesAfter(t) > HG_PIECE_LIMIT ? `Over ${HG_PIECE_LIMIT} pieces` : "";

  hgMoveEl.innerHTML = `
    <div class="qd-factor-menu-panel hg-copy-panel">
      <div class="qd-factor-menu-header">
        <div class="qd-factor-menu-title">⇄ Move ${hgEsc(hero.name || "hero")}</div>
        <button type="button" class="qd-factor-menu-close" data-move-close aria-label="Close">✕</button>
      </div>
      <div class="hg-text hg-copy-what">From <b>${hgEsc(from.gearSet.trim() || "(no name)")}</b> <span class="hg-set-badge">${hgSetLabel(from)}</span><br><span class="hg-pick-note">Pick the gear set to move them to.</span></div>
      <div class="hg-picker-list">
        ${others.length ? others.map(t => {
          const why = reason(t);
          return `<button type="button" class="hg-pick-item${why ? " taken" : ""}" data-to="${hgEsc(t.id)}"${why ? " disabled" : ""}>
            <span class="hg-pick-name">${hgEsc(t.gearSet.trim() || "(no name)")} <span class="hg-set-badge">${hgSetLabel(t)}</span>${t.artifactType.trim() ? `<span class="hg-pick-note"> · ${hgEsc(t.artifactType.trim())}</span>` : ""}</span>
            ${why ? `<span class="hg-pick-note">${why}</span>` : ""}
          </button>`;
        }).join("") : `<div class="hg-text hg-empty">No other gear sets in ${hgEsc(cls)} yet — add one first.</div>`}
      </div>
      <button type="button" class="btn btn-gold hg-picker-done" data-move-close>CANCEL</button>
    </div>`;
  hgMoveEl.querySelectorAll("[data-move-close]").forEach(b => b.addEventListener("click", hgCloseMoveMenu));
  hgMoveEl.querySelectorAll("[data-to]").forEach(b => b.addEventListener("click", () => {
    if (hgMoveHero(cls, fromId, b.dataset.to, hero.id)) {
      const to = rows.find(r => String(r.id) === b.dataset.to);
      hgCloseMoveMenu();
      if (typeof setStatus === "function") setStatus(`✅ Moved ${hero.name || "hero"} to ${to?.gearSet.trim() || "gear set"}`);
    }
  }));
  hgMoveCtx = { cls, fromId, heroId: hero.id };
  hgMoveEl.style.display = "flex";
  document.body.classList.add("qd-factor-menu-open");
}

function hgCloseMoveMenu() {
  hgMoveCtx = null;
  if (hgMoveEl) hgMoveEl.style.display = "none";
  document.body.classList.remove("qd-factor-menu-open");
  renderHeroGear();
}

// ── Jump to a hero's gear in the Equipment Planner ─────────────────
// Opens 🛡 Hero Equipment and Artifacts → the hero's class → Equipment
// Planner, opens EVERY gear set the hero is in, and scrolls to the 4 set
// (or, if they have no 4 set, their first 2 set). A hero in no gear set lands
// on the class's "Not Fully Equipped Heroes" list, with their name flashed.
// Returns false when this page has no drawer (Quick Draft page / companion
// mode) so callers can fall back to the little popup.
function hgJumpToHero(h) {
  const handle = document.getElementById("hero-gear-handle");
  const cls = h && h.role;
  if (!handle || handle.offsetParent === null || !GEAR_CLASSES.includes(cls)) return false;

  // Get the grid / popups out of the way.
  if (typeof hgrClose === "function") hgrClose();
  if (hgEquipEl) hgEquipEl.style.display = "none";
  document.body.classList.remove("qd-factor-menu-open");

  const wasOpen = hgOpen;
  if (!hgOpen) handle.click(); // opens + renders the drawer
  const rows = hgEffectiveRows(cls).filter(r => r.heroIds.some(x => String(x) === String(h.id)));
  const four = rows.filter(r => r.setType !== "2").sort((a, b) => gearCmp(a.gearSet, b.gearSet));
  const twos = rows.filter(r => r.setType === "2").sort((a, b) => gearCmp(a.gearSet, b.gearSet));
  const first = four[0] || twos[0] || null;

  hgOpenKeys.add(`c:${cls}`);
  let targetKey;
  if (first) {
    hgOpenKeys.add(`s:${cls}:planner`);
    [...four, ...twos].forEach(r => hgOpenKeys.add(`r:${cls}:${r.id}`));
    targetKey = `r:${cls}:${first.id}`;
  } else {
    hgOpenKeys.add(`s:${cls}:notfull`);
    targetKey = `s:${cls}:notfull`;
  }
  renderHeroGear();

  // A drawer that was just opened is still sliding down, so wait for it before scrolling.
  setTimeout(() => {
    const find = key => [...document.querySelectorAll("#hero-gear-body details[data-key]")].find(d => d.dataset.key === key);
    const target = find(targetKey);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.classList.remove("hg-flash"); void target.offsetWidth; target.classList.add("hg-flash");
    const scope = first ? [...four, ...twos].map(r => find(`r:${cls}:${r.id}`)).filter(Boolean) : [target];
    scope.forEach(d => d.querySelectorAll(".hg-hero-chip").forEach(c => {
      if (c.dataset.hero === String(h.id)) { c.classList.remove("hg-chip-flash"); void c.offsetWidth; c.classList.add("hg-chip-flash"); }
    }));
  }, wasOpen ? 30 : 450);
  return true;
}

// What the "E" buttons call: jump to the planner when this page has one,
// otherwise show the quick popup.
function hgEquipAction(h) {
  if (!hgJumpToHero(h)) openHeroEquipment(h);
}

// "Find a hero" box under 🛡 Hero Equipment and Artifacts.
function initHeroGearSearch() {
  const input = document.getElementById("hg-hero-search");
  const box = document.getElementById("hg-hero-results");
  if (!input || !box) return;
  const summary = h => {
    if (!GEAR_CLASSES.includes(h.role)) return "No class set";
    const rows = heroGear[h.role].planner.filter(r => r.heroIds.some(x => String(x) === String(h.id)));
    if (!rows.length) return "No gear sets yet";
    const f = rows.filter(r => r.setType !== "2").map(r => r.gearSet.trim() || "(no name)");
    const t = rows.filter(r => r.setType === "2").map(r => r.gearSet.trim() || "(no name)");
    return [f.length ? `4: ${f.join(", ")}` : "", t.length ? `2: ${t.join(", ")}` : ""].filter(Boolean).join(" · ");
  };
  const paint = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { box.innerHTML = ""; box.style.display = "none"; return; }
    const list = heroes.filter(h => (h.name || "").toLowerCase().includes(q))
      .sort((a, b) => gearCmp(a.name, b.name)).slice(0, 12);
    box.style.display = "block";
    box.innerHTML = list.length
      ? list.map(h => `<button type="button" class="hg-search-item" data-id="${hgEsc(h.id)}">
          ${hgAvatar(h)}
          <span class="hg-search-main"><span class="hg-search-name">${hgEsc(h.name || "Unnamed")}</span>${h.role ? ` <span class="hg-pick-note">${hgEsc(h.role)}</span>` : ""}
          <span class="hg-pick-note hg-search-sets">${hgEsc(summary(h))}</span></span>
        </button>`).join("")
      : `<div class="hg-text hg-empty hg-search-none">No heroes match “${hgEsc(input.value.trim())}”.</div>`;
  };
  input.addEventListener("input", paint);
  input.addEventListener("keydown", e => {
    if (e.key === "Escape") { input.value = ""; paint(); }
    else if (e.key === "Enter") { box.querySelector(".hg-search-item")?.click(); }
  });
  box.addEventListener("click", e => {
    const b = e.target.closest(".hg-search-item");
    if (!b) return;
    const h = heroes.find(x => String(x.id) === b.dataset.id);
    if (!h) return;
    input.value = ""; paint();
    if (!hgJumpToHero(h)) openHeroEquipment(h);
  });
}

// index.html?equip=<heroId> (from the Quick Draft page's popup) jumps straight
// to that hero once the roster has loaded.
(function () {
  let id;
  try { id = new URLSearchParams(location.search).get("equip"); } catch (e) { return; }
  if (!id) return;
  let tries = 0;
  const attempt = () => {
    const h = (typeof heroes !== "undefined" ? heroes : []).find(x => String(x.id) === id);
    if (h && hgJumpToHero(h)) { try { history.replaceState(null, "", location.pathname); } catch (e) {} return; }
    if (++tries < 40) setTimeout(attempt, 300);
  };
  setTimeout(attempt, 600);
})();

// ── Hero equipment popup (the "E" button on each roster card) ──────
// Shows which 4 set and 2 set(s) a hero is equipped with, read from the
// Equipment Planner rows of the hero's class that list them.
let hgEquipEl = null;

function openHeroEquipment(h) {
  if (!hgEquipEl) {
    hgEquipEl = document.createElement("div");
    hgEquipEl.className = "qd-factor-menu-overlay hg-picker";
    hgEquipEl.style.display = "none";
    document.body.appendChild(hgEquipEl);
    const close = () => { hgEquipEl.style.display = "none"; document.body.classList.remove("qd-factor-menu-open"); };
    hgEquipEl.addEventListener("click", e => { if (e.target === hgEquipEl || e.target.closest("[data-equip-close]")) close(); });
    hgEquipEl.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  }
  hgEquipHeroId = h.id;
  const cls = h.role;
  const known = GEAR_CLASSES.includes(cls);
  const rows = known ? heroGear[cls].planner.filter(r => r.heroIds.some(x => String(x) === String(h.id))) : [];
  const four = rows.filter(r => r.setType !== "2").sort((a, b) => gearCmp(a.gearSet, b.gearSet));
  const twos = rows.filter(r => r.setType === "2").sort((a, b) => gearCmp(a.gearSet, b.gearSet));
  const used = rows.reduce((sum, r) => sum + hgRowPieces(r), 0);

  const line = r => `<div class="hg-equip-line">
      <span class="hg-equip-name">${hgEsc(r.gearSet.trim() || "(no name)")}</span>
      <span class="hg-set-badge">${hgSetLabel(r)}</span>
      ${r.artifactType.trim() ? `<div class="hg-pick-note">Artifact: ${hgEsc(r.artifactType.trim())}</div>` : ""}
    </div>`;
  const block = (title, list) => `<div class="hg-equip-block">
      <div class="hg-group-title">${title}</div>
      ${list.length ? list.map(line).join("") : `<div class="hg-text hg-empty">— none yet —</div>`}
    </div>`;

  const icon = hgAvatar(h, "hg-avatar hg-equip-avatar");
  hgEquipEl.innerHTML = `
    <div class="qd-factor-menu-panel hg-copy-panel">
      <div class="qd-factor-menu-header">
        <div class="qd-factor-menu-title">${icon} ${hgEsc(h.name || "Unnamed Hero")} — Equipment</div>
        <button type="button" class="qd-factor-menu-close" data-equip-close aria-label="Close">✕</button>
      </div>
      ${!known
        ? `<div class="hg-text hg-empty">This hero has no class set, so there's no equipment planner for them.</div>`
        : `${block("4 set", four)}${block("2 set" + (twos.length > 1 ? "s" : ""), twos)}
           <div class="hg-pick-note hg-equip-total">${used}/${HG_PIECE_LIMIT} pieces${used < HG_PIECE_LIMIT ? ` — ${HG_PIECE_LIMIT - used} open` : " — fully equipped"}</div>`}
      ${known ? (document.getElementById("hero-gear-drawer")
        ? `<button type="button" class="btn btn-ghost hg-picker-done" data-equip-jump>🛡 Open in Equipment Planner</button>`
        : `<a class="btn btn-ghost hg-picker-done hg-equip-link" href="index.html?equip=${encodeURIComponent(h.id)}">🖥 Open in Equipment Planner (full site)</a>`) : ""}
      <button type="button" class="btn btn-gold hg-picker-done" data-equip-close>DONE</button>
    </div>`;
  hgEquipEl.querySelector("[data-equip-jump]")?.addEventListener("click", () => hgJumpToHero(h));
  hgEquipEl.style.display = "flex";
  document.body.classList.add("qd-factor-menu-open");
}

function renderHeroGear() {
  hgRefreshEquipFilter(); // roster chips + autocomplete follow the planners (also on pages with no drawer)
  const body = document.getElementById("hero-gear-body");
  if (!body) return; // page without the drawer (e.g. quickdraft.html)
  // A reload/import can drop the row being edited — never edit a ghost.
  if (hgEdit && !hgEdit.isNew && !heroGear[hgEdit.cls].planner.some(r => String(r.id) === String(hgEdit.row.id))) hgEdit = null;

  const scroll = body.scrollTop;
  body.innerHTML = GEAR_CLASSES.map((cls, ci) => {
    const nf = hgNotFullInfo(cls);
    const sec = (n, name, key, meta, html) => hgDrawer(`s:${cls}:${key}`, { idx: n + ".", title: name, meta, level: "sec", body: html });
    const eqN = heroGear[cls].equipment.items.length, arN = heroGear[cls].artifacts.items.length;
    const rows = hgEffectiveRows(cls);
    const inner =
      sec(1, "Equipment", "equipment", hgPlural(eqN, "entry", "entries"), hgSectionBodyHTML(cls, "equipment", "Equipment")) +
      sec(2, "Artifacts", "artifacts", hgPlural(arN, "entry", "entries"), hgSectionBodyHTML(cls, "artifacts", "Artifacts")) +
      sec(3, "Equipment Planner", "planner", hgPlural(rows.length, "gear set", "gear sets"), hgPlannerBodyHTML(cls)) +
      sec(4, "Not Fully Equipped Heroes", "notfull", `${nf.count}`, nf.html);
    return hgDrawer(`c:${cls}`, { idx: hgLetter(ci) + ".", title: hgEsc(cls), meta: hgPlural(rows.length, "gear set", "gear sets"), level: "class", body: inner });
  }).join("");
  body.scrollTop = scroll;

  body.querySelector("textarea.hg-input")?.focus();
}

function hgFindItem(cls, kind, field) {
  const id = field.slice(5);
  return heroGear[cls][kind].items.find(it => String(it.id) === id);
}

function hgCommit(cls, kind, field, value) {
  if (field === "note") {
    if (heroGear[cls][kind].note !== value) { heroGear[cls][kind].note = value; hgMarkChanged(); }
  } else {
    const it = hgFindItem(cls, kind, field);
    if (!it) return;
    if (!value.trim()) {
      // Saving an emptied entry just removes it rather than leaving a blank row.
      heroGear[cls][kind].items = heroGear[cls][kind].items.filter(x => x !== it);
      hgMarkChanged();
    } else if (it.text !== value) { it.text = value; hgMarkChanged(); }
    sortGearEntries(heroGear[cls][kind].items);
  }
}

function hgOnClick(e) {
  const btn = e.target.closest("button");
  if (btn && btn.dataset.gact) {
    if (btn.dataset.gact === "unused-edit") hgUnusedEditing = btn.dataset.ucls;
    else if (btn.dataset.gact === "unused-ok") {
      const v = btn.closest(".hg-row").querySelector(".hg-input").value;
      if (v !== (heroGear.unusedSets || "")) { heroGear.unusedSets = v; hgMarkChanged(); }
      hgUnusedEditing = null;
    } else hgUnusedEditing = null; // unused-cancel
    renderHeroGear();
    return;
  }
  if (!btn || !btn.dataset.cls) return;
  if (btn.dataset.act) { hgPlannerClick(btn); return; }
  const { cls, kind, field } = btn.dataset;
  if (!heroGear[cls]) return;

  if (btn.classList.contains("hg-add")) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    heroGear[cls][kind].items.push({ id, text: "" });
    hgEditing = `${cls}|${kind}|item:${id}`;
    renderHeroGear();
    return;
  }
  if (btn.classList.contains("hg-edit")) {
    hgEditing = `${cls}|${kind}|${field}`;
    renderHeroGear();
    return;
  }
  if (btn.classList.contains("hg-ok")) {
    const ta = btn.closest(".hg-row").querySelector(".hg-input");
    hgCommit(cls, kind, field, ta.value);
    hgEditing = null;
    renderHeroGear();
    return;
  }
  if (btn.classList.contains("hg-cancel")) {
    // Cancelling a brand-new, never-filled entry discards it.
    if (field !== "note") {
      const it = hgFindItem(cls, kind, field);
      if (it && !it.text.trim()) heroGear[cls][kind].items = heroGear[cls][kind].items.filter(x => x !== it);
    }
    hgEditing = null;
    renderHeroGear();
    return;
  }
  if (btn.classList.contains("hg-del")) {
    const it = hgFindItem(cls, kind, field);
    if (!it) return;
    if (it.text.trim() && !confirm("Delete this entry?")) return;
    heroGear[cls][kind].items = heroGear[cls][kind].items.filter(x => x !== it);
    hgMarkChanged();
    renderHeroGear();
  }
}

// ── Roster equipment filter, built from YOUR gear sets ─────────────
// The roster's ⚙ Filter → EQUIPMENT chips (and the Gear Set autocomplete) are
// the Gear Set names actually used in the Equipment Planners, across all
// classes — no presets. Same name in different classes (any capitalisation)
// is one chip. A hero matches a chip when one of the planner rows they're
// assigned to has that Gear Set name.
const hgSetKey = s => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

// Map of key -> display name (first spelling found), A–Z by name.
function hgUsedSetNames() {
  const m = new Map();
  GEAR_CLASSES.forEach(c => (heroGear[c]?.planner || []).forEach(r => {
    const k = hgSetKey(r.gearSet);
    if (k && !m.has(k)) m.set(k, r.gearSet.trim());
  }));
  return new Map([...m.entries()].sort((a, b) => gearCmp(a[1], b[1])));
}

// The gear-set keys a hero has equipped (used by the roster filter).
function heroEquipTypes(h) {
  const out = new Set();
  if (!GEAR_CLASSES.includes(h.role)) return out;
  heroGear[h.role].planner.forEach(r => {
    if (r.heroIds.some(x => String(x) === String(h.id)) && hgSetKey(r.gearSet)) out.add(hgSetKey(r.gearSet));
  });
  return out;
}

// Rebuild the roster chips + the Gear Set autocomplete from the current
// planners. Called whenever the planners render/change/load.
function hgRefreshEquipFilter() {
  const names = hgUsedSetNames();

  const dl = document.getElementById("hg-set-names") || Object.assign(document.createElement("datalist"), { id: "hg-set-names" });
  if (!dl.parentNode) document.body.appendChild(dl);
  dl.innerHTML = [...names.values()].map(n => `<option value="${hgEsc(n)}"></option>`).join("");

  const box = document.getElementById("filter-equip");
  if (!box || typeof filterEquip === "undefined") return;
  // Drop ticks for gear sets that no longer exist.
  let pruned = false;
  [...filterEquip].forEach(k => { if (!names.has(k)) { filterEquip.delete(k); pruned = true; } });
  box.innerHTML = names.size
    ? [...names.entries()].map(([k, n]) => `<button type="button" class="chip${filterEquip.has(k) ? " active" : ""}" data-val="${hgEsc(k)}">${hgEsc(n)}</button>`).join("")
    : `<div class="hg-pick-note">No gear sets yet — add some under 🛡 Hero Equipment and Artifacts.</div>`;
  if (pruned) renderRoster();
}

function initHeroGearRosterFilter() {
  const box = document.getElementById("filter-equip");
  if (!box) return;
  box.addEventListener("click", e => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    const v = btn.dataset.val;
    if (filterEquip.has(v)) filterEquip.delete(v); else filterEquip.add(v);
    btn.classList.toggle("active", filterEquip.has(v));
    renderRoster();
  });
  document.querySelectorAll("#filter-equip-mode button").forEach(btn => btn.addEventListener("click", () => {
    filterEquipMode = btn.dataset.mode === "any" ? "any" : "all";
    document.querySelectorAll("#filter-equip-mode button").forEach(b => b.classList.toggle("on", b === btn));
    if (filterEquip.size) renderRoster();
  }));
  hgRefreshEquipFilter();
}

function initHeroGear() {
  initHeroGearRosterFilter();
  initHeroGearSearch();
  const handle = document.getElementById("hero-gear-handle");
  const drawer = document.getElementById("hero-gear-drawer");
  const body = document.getElementById("hero-gear-body");
  if (!handle || !drawer || !body) return;

  handle.addEventListener("click", () => {
    hgOpen = !hgOpen;
    drawer.classList.toggle("open", hgOpen);
    handle.classList.toggle("open", hgOpen);
    if (hgOpen) renderHeroGear(); // pick up heroes added since last render
  });
  // Remember which drawers are open (toggle doesn't bubble, so listen in capture).
  body.addEventListener("toggle", e => {
    const key = e.target?.dataset?.key;
    if (!key) return;
    if (e.target.open) hgOpenKeys.add(key); else hgOpenKeys.delete(key);
  }, true);
  body.addEventListener("click", hgOnClick);
  // Planner text fields write straight into the working copy (no re-render,
  // so typing never loses focus). Nothing is saved until 💾 Save.
  body.addEventListener("input", e => {
    const inp = e.target.closest?.(".hg-plan-in");
    if (!inp) return;
    if (hgEdit && hgEdit.cls === inp.dataset.cls && String(hgEdit.row.id) === inp.dataset.row) hgEdit.row[inp.dataset.f] = inp.value;
  });
  // Ctrl/Cmd+Enter saves the field being edited; Escape cancels it.
  body.addEventListener("keydown", e => {
    const ta = e.target.closest?.(".hg-input");
    if (!ta) return;
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ta.closest(".hg-row").querySelector(".hg-ok")?.click(); }
    else if (e.key === "Escape") { e.preventDefault(); ta.closest(".hg-row").querySelector(".hg-cancel")?.click(); }
  });
  renderHeroGear();

  // Heroes added / renamed / re-classed / deleted / loaded → refresh the drawer
  // so hero chips and "Not Fully Equipped" never go stale. Skipped while a
  // field is mid-edit (a re-render would steal focus / drop typing).
  window.addEventListener("chartHeroesUpdated", () => {
    if (hgEdit || hgEditing || hgUnusedEditing || (typeof hgPickerCtx !== "undefined" && hgPickerCtx)) return;
    renderHeroGear();
  });
}

initHeroGear();
