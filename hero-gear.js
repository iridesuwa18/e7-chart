/* ═══════════════════════════════════════════════════════════════════
   HERO EQUIPMENT & ARTIFACTS

   (Each class also has an Equipment Planner table — Gear Set | Artifact
   Type | Assigned heroes — edited per class with ✏️ then 💾 Save.)

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
let hgOpen = false;

// Equipment Planner: a class whose planner is in edit mode has a working
// copy here (planner draft) — typing edits the copy, Save commits it to
// heroGear, Cancel throws it away. { Knight: [{id,gearSet,artifactType,heroIds}] }
const hgPlannerDraft = {};

function hgMarkChanged() {
  hasUnsavedChanges = true;
  if (typeof updateTaxonomySaveReminder === "function") updateTaxonomySaveReminder();
}

function hgEsc(str) {
  return String(str ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

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

function hgSectionHTML(cls, kind, label) {
  const sec = heroGear[cls][kind];
  return `<div class="hg-section">
    <div class="hg-section-head">${label}
      <button type="button" class="hg-icon-btn hg-add" data-cls="${hgEsc(cls)}" data-kind="${kind}" title="Add ${label}">＋</button>
    </div>
    ${hgRowHTML(cls, kind, "note", sec.note, { isNote: true, placeholder: "Notes…" })}
    ${sec.items.map(it => hgRowHTML(cls, kind, `item:${it.id}`, it.text, { deletable: true, placeholder: "(empty)" })).join("")}
  </div>`;
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

// A hero can sit in only ONE planner row per class. Returns the (1-based)
// number of the first row OTHER than `exceptRowId` that already has them, or 0.
function hgHeroRowElsewhere(rows, heroId, exceptRowId) {
  const i = rows.findIndex(r => String(r.id) !== String(exceptRowId) && r.heroIds.some(x => String(x) === String(heroId)));
  return i + 1;
}

function hgPlannerHTML(cls) {
  const editing = !!hgPlannerDraft[cls];
  const rows = editing ? hgPlannerDraft[cls] : heroGear[cls].planner;
  const classHeroes = hgClassHeroes(cls);
  const heroOf = id => classHeroes.find(h => String(h.id) === String(id));
  const cAttr = `data-cls="${hgEsc(cls)}"`;

  const head = `<div class="hg-section-head">Equipment Planner
    ${editing
      ? `<button type="button" class="hg-pill" ${cAttr} data-act="plan-add">＋ Row</button>
         <button type="button" class="hg-pill hg-save" ${cAttr} data-act="plan-save">💾 Save</button>
         <button type="button" class="hg-pill" ${cAttr} data-act="plan-cancel">✕ Cancel</button>`
      : `<button type="button" class="hg-pill" ${cAttr} data-act="plan-edit">✏️ Edit</button>`}
  </div>`;

  const cols = `<div class="hg-plan-row hg-plan-cols"><div>Gear Set</div><div>Artifact Type</div><div>Assigned heroes</div></div>`;

  const body = rows.length === 0
    ? `<div class="hg-text hg-empty">${editing ? "No rows yet — press ＋ Row to add one." : "No planner rows yet — press ✏️ Edit to start."}</div>`
    : rows.map((r, idx) => {
        const picked_heroes = r.heroIds.map(heroOf).filter(Boolean);
        if (!editing) {
          return `<div class="hg-plan-row">
            <div class="hg-text${r.gearSet ? "" : " hg-empty"}" data-label="Gear Set">${hgEsc(r.gearSet || "—")}</div>
            <div class="hg-text${r.artifactType ? "" : " hg-empty"}" data-label="Artifact Type">${hgEsc(r.artifactType || "—")}</div>
            <div class="hg-text hg-heroes-view${picked_heroes.length ? "" : " hg-empty"}" data-label="Heroes">${picked_heroes.length ? picked_heroes.map(h => `<span class="hg-hero-chip">${hgAvatar(h)}${hgEsc(h.name || "Unnamed")}</span>`).join("") : "—"}</div>
          </div>`;
        }
        const picked = picked_heroes.map(h => { const id = h.id; return `<span class="hg-tag">${hgAvatar(h)}${hgEsc(h.name || "Unnamed")}<button type="button" class="hg-tag-x" ${cAttr} data-act="plan-unhero" data-row="${r.id}" data-hero="${hgEsc(id)}" title="Remove">✕</button></span>`; }).join("");
        return `<div class="hg-plan-row">
          <input type="text" class="hg-input hg-plan-in" ${cAttr} data-row="${r.id}" data-f="gearSet" value="${hgEsc(r.gearSet)}" placeholder="Gear set" aria-label="Gear set">
          <input type="text" class="hg-input hg-plan-in" ${cAttr} data-row="${r.id}" data-f="artifactType" value="${hgEsc(r.artifactType)}" placeholder="Artifact type" aria-label="Artifact type">
          <div class="hg-plan-heroes">
            ${picked}
            <button type="button" class="hg-pill" ${cAttr} data-act="plan-pick" data-row="${r.id}">＋ Heroes</button>
            <button type="button" class="hg-icon-btn hg-del" ${cAttr} data-act="plan-del" data-row="${r.id}" title="Delete row #${idx + 1}">🗑</button>
          </div>
        </div>`;
      }).join("");

  return `<div class="hg-section hg-planner">${head}${cols}${body}</div>`;
}

function hgPlannerClick(btn) {
  const { cls, act, row, hero } = btn.dataset;
  if (!heroGear[cls]) return;
  const draft = hgPlannerDraft[cls];
  if (act === "plan-edit") {
    hgPlannerDraft[cls] = heroGear[cls].planner.map(r => ({ ...r, heroIds: [...r.heroIds] }));
  } else if (act === "plan-cancel") {
    delete hgPlannerDraft[cls];
  } else if (act === "plan-save") {
    // Blank rows are dropped; a hero can only live in one row, so any
    // duplicate from older data is kept in its first row only.
    const seen = new Set();
    heroGear[cls].planner = draft
      .map(r => ({
        ...r,
        gearSet: r.gearSet.trim(),
        artifactType: r.artifactType.trim(),
        heroIds: r.heroIds.filter(id => !seen.has(String(id)) && seen.add(String(id))),
      }))
      .filter(r => r.gearSet || r.artifactType || r.heroIds.length);
    delete hgPlannerDraft[cls];
    hgMarkChanged();
  } else if (!draft) {
    return;
  } else if (act === "plan-add") {
    draft.push({ id: Date.now() + Math.floor(Math.random() * 1000), gearSet: "", artifactType: "", heroIds: [] });
  } else if (act === "plan-del") {
    hgPlannerDraft[cls] = draft.filter(r => String(r.id) !== row);
  } else if (act === "plan-unhero") {
    const r = draft.find(x => String(x.id) === row);
    if (r) r.heroIds = r.heroIds.filter(x => String(x) !== hero);
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
// Factors panel's filters. Matching rules mirror Hero Factors: ticked
// Reactions / Engagements must ALL be held, a Category matches if the hero
// holds any item in it (any ticked category), and an Enemy Factor matches
// if the hero holds any Reaction/Engagement tagged to it (any ticked factor).
let hgPickerEl = null;
let hgPickerCtx = null; // { cls, rowId }

const hgPickFilt = {
  search: "",
  categories: new Set(),
  reactionIds: new Set(),
  engagementIds: new Set(),
  factorIds: new Set(),
  reactionSearch: "",
  engagementSearch: "",
  factorSearch: "",
};

function hgPickFiltCount() {
  return hgPickFilt.categories.size + hgPickFilt.reactionIds.size + hgPickFilt.engagementIds.size + hgPickFilt.factorIds.size;
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
  if (f.reactionIds.size) list = list.filter(h => [...f.reactionIds].every(id => hfHeroHasTag(h, "reactions", id)));
  if (f.engagementIds.size) list = list.filter(h => [...f.engagementIds].every(id => hfHeroHasTag(h, "engagements", id)));
  if (f.categories.size) list = list.filter(h => [...f.categories].some(c => hfHeroMatchesCategory(h, c)));
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
      <div class="hf-category-chips" id="hg-pf-cats"></div>

      <details class="hf-details" id="hg-pf-d-r"${f.reactionIds.size ? " open" : ""}>
        <summary id="hg-pf-sum-r"></summary>
        ${sbox("hg-pf-rsearch", "🔍 Search Reactions…")}
        <div class="qd-factor-menu-list" id="hg-pf-rlist"></div>
      </details>
      <details class="hf-details" id="hg-pf-d-e"${f.engagementIds.size ? " open" : ""}>
        <summary id="hg-pf-sum-e"></summary>
        ${sbox("hg-pf-esearch", "🔍 Search Engagements…")}
        <div class="qd-factor-menu-list" id="hg-pf-elist"></div>
      </details>
      <details class="hf-details" id="hg-pf-d-f"${f.factorIds.size ? " open" : ""}>
        <summary id="hg-pf-sum-f"></summary>
        ${sbox("hg-pf-fsearch", "🔍 Search Enemy Factors…")}
        <div class="qd-factor-menu-quickwords" id="hg-pf-quick"></div>
        <div class="qd-factor-menu-list" id="hg-pf-flist"></div>
      </details>

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

  document.getElementById("hg-pf-clear").addEventListener("click", () => {
    f.search = f.reactionSearch = f.engagementSearch = f.factorSearch = "";
    f.categories.clear(); f.reactionIds.clear(); f.engagementIds.clear(); f.factorIds.clear();
    hgBuildPickerPanel();
  });

  document.getElementById("hg-picker-list").addEventListener("click", e => {
    const b = e.target.closest(".hg-pick-item");
    if (!b || b.disabled || !hgPickerCtx) return;
    const { cls, rowId } = hgPickerCtx;
    const draft = hgPlannerDraft[cls];
    const r = draft?.find(x => String(x.id) === String(rowId));
    if (!r) return;
    const heroId = b.dataset.hero;
    const idx = r.heroIds.findIndex(x => String(x) === heroId);
    if (idx >= 0) r.heroIds.splice(idx, 1);
    else if (!hgHeroRowElsewhere(draft, heroId, rowId)) r.heroIds.push(classHeroesId(cls, heroId));
    hgRenderPickerList();
  });

  hgRenderCategoryChips();
  hgRenderTagList("reactions");
  hgRenderTagList("engagements");
  hgRenderQuickWords();
  hgRenderFactorList();
  hgRenderPickerList();
}

function hgRenderCategoryChips() {
  const box = document.getElementById("hg-pf-cats");
  if (!box) return;
  const cats = hfAllRankingCategories();
  if (!cats.length) { box.innerHTML = ""; return; }
  box.innerHTML = cats.map(c => `<button type="button" class="qd-factor-priority-chip${hgPickFilt.categories.has(c) ? " active" : ""}" data-cat="${escAttr(c)}">${hgEsc(c)}</button>`).join("");
  box.querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
    const c = btn.dataset.cat;
    if (hgPickFilt.categories.has(c)) hgPickFilt.categories.delete(c); else hgPickFilt.categories.add(c);
    btn.classList.toggle("active");
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
  const draft = hgPlannerDraft[cls] || [];
  const r = draft.find(x => String(x.id) === String(rowId));
  const list = hgPickerHeroes(cls);
  const all = hgClassHeroes(cls);
  const rowNo = draft.findIndex(x => String(x.id) === String(rowId)) + 1;

  document.getElementById("hg-picker-title").textContent =
    `${cls} heroes — Row ${rowNo} (${r ? r.heroIds.length : 0} picked)`;
  const countEl = document.getElementById("hg-pf-count");
  if (countEl) countEl.textContent = `${list.length} of ${all.length} ${cls} hero${all.length === 1 ? "" : "es"}${hgPickFiltCount() ? ` · ${hgPickFiltCount()} filter${hgPickFiltCount() === 1 ? "" : "s"}` : ""}`;

  document.getElementById("hg-picker-list").innerHTML = list.length
    ? list.map(h => {
        const on = !!r && r.heroIds.some(x => String(x) === String(h.id));
        const other = on ? 0 : hgHeroRowElsewhere(draft, h.id, rowId);
        const icon = hgAvatar(h, "hg-pick-icon");
        return `<button type="button" class="hg-pick-item${on ? " on" : ""}${other ? " taken" : ""}" data-hero="${hgEsc(h.id)}"${other ? " disabled" : ""}>
          <span class="hg-pick-check">${on ? "✓" : ""}</span>
          ${icon}
          <span class="hg-pick-name">${hgEsc(h.name || "Unnamed")}</span>
          ${other ? `<span class="hg-pick-note">in Row ${other}</span>` : ""}
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

function renderHeroGear() {
  const body = document.getElementById("hero-gear-body");
  if (!body) return; // page without the drawer (e.g. quickdraft.html)

  body.innerHTML = GEAR_CLASSES.map(cls => `
    <div class="hg-class">
      <div class="hg-class-title">${hgEsc(cls)}</div>
      ${hgSectionHTML(cls, "equipment", "Equipment")}
      ${hgSectionHTML(cls, "artifacts", "Artifacts")}
      ${hgPlannerHTML(cls)}
    </div>`).join("");

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
  }
}

function hgOnClick(e) {
  const btn = e.target.closest("button");
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

function initHeroGear() {
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
  body.addEventListener("click", hgOnClick);
  // Planner text fields write straight into the working copy (no re-render,
  // so typing never loses focus). Nothing is saved until 💾 Save.
  body.addEventListener("input", e => {
    const inp = e.target.closest?.(".hg-plan-in");
    if (!inp) return;
    const r = hgPlannerDraft[inp.dataset.cls]?.find(x => String(x.id) === inp.dataset.row);
    if (r) r[inp.dataset.f] = inp.value;
  });
  // Ctrl/Cmd+Enter saves the field being edited; Escape cancels it.
  body.addEventListener("keydown", e => {
    const ta = e.target.closest?.(".hg-input");
    if (!ta) return;
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ta.closest(".hg-row").querySelector(".hg-ok")?.click(); }
    else if (e.key === "Escape") { e.preventDefault(); ta.closest(".hg-row").querySelector(".hg-cancel")?.click(); }
  });
  renderHeroGear();
}

initHeroGear();
