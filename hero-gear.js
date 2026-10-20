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

function hgPlannerHTML(cls) {
  const editing = !!hgPlannerDraft[cls];
  const rows = editing ? hgPlannerDraft[cls] : heroGear[cls].planner;
  const classHeroes = hgClassHeroes(cls);
  const nameOf = id => classHeroes.find(h => String(h.id) === String(id))?.name;
  const cAttr = `data-cls="${hgEsc(cls)}"`;

  const head = `<div class="hg-section-head">Equipment Planner
    ${editing
      ? `<button type="button" class="hg-icon-btn hg-add" ${cAttr} data-act="plan-add" title="Add row">＋</button>
         <button type="button" class="hg-icon-btn hg-add hg-save" ${cAttr} data-act="plan-save" title="Save planner">💾 Save</button>
         <button type="button" class="hg-icon-btn hg-add" ${cAttr} data-act="plan-cancel" title="Cancel">✕ Cancel</button>`
      : `<button type="button" class="hg-icon-btn" ${cAttr} data-act="plan-edit" title="Edit planner">✏️</button>`}
  </div>`;

  const cols = `<div class="hg-plan-row hg-plan-cols"><div>Gear Set</div><div>Artifact Type</div><div>Assigned heroes</div></div>`;

  const body = rows.length === 0
    ? `<div class="hg-text hg-empty">${editing ? "No rows yet — press ＋ to add one." : "No planner rows yet — press ✏️ to start."}</div>`
    : rows.map(r => {
        if (!editing) {
          const names = r.heroIds.map(nameOf).filter(Boolean);
          return `<div class="hg-plan-row">
            <div class="hg-text${r.gearSet ? "" : " hg-empty"}">${hgEsc(r.gearSet || "—")}</div>
            <div class="hg-text${r.artifactType ? "" : " hg-empty"}">${hgEsc(r.artifactType || "—")}</div>
            <div class="hg-text${names.length ? "" : " hg-empty"}">${names.length ? hgEsc(names.join(", ")) : "—"}</div>
          </div>`;
        }
        const chips = classHeroes.length
          ? classHeroes.map(h => `<button type="button" class="hg-chip${r.heroIds.some(x => String(x) === String(h.id)) ? " on" : ""}" ${cAttr} data-act="plan-hero" data-row="${r.id}" data-hero="${hgEsc(h.id)}">${hgEsc(h.name)}</button>`).join("")
          : `<span class="hg-text hg-empty">No ${hgEsc(cls)} heroes added yet</span>`;
        return `<div class="hg-plan-row">
          <input type="text" class="hg-input hg-plan-in" ${cAttr} data-row="${r.id}" data-f="gearSet" value="${hgEsc(r.gearSet)}" placeholder="Gear set">
          <input type="text" class="hg-input hg-plan-in" ${cAttr} data-row="${r.id}" data-f="artifactType" value="${hgEsc(r.artifactType)}" placeholder="Artifact type">
          <div class="hg-plan-heroes">${chips}
            <button type="button" class="hg-icon-btn hg-del" ${cAttr} data-act="plan-del" data-row="${r.id}" title="Delete row">🗑</button>
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
    // Blank rows (no text, no heroes) are dropped rather than saved.
    heroGear[cls].planner = draft
      .map(r => ({ ...r, gearSet: r.gearSet.trim(), artifactType: r.artifactType.trim() }))
      .filter(r => r.gearSet || r.artifactType || r.heroIds.length);
    delete hgPlannerDraft[cls];
    hgMarkChanged();
  } else if (!draft) {
    return;
  } else if (act === "plan-add") {
    draft.push({ id: Date.now() + Math.floor(Math.random() * 1000), gearSet: "", artifactType: "", heroIds: [] });
  } else if (act === "plan-del") {
    hgPlannerDraft[cls] = draft.filter(r => String(r.id) !== row);
  } else if (act === "plan-hero") {
    const r = draft.find(x => String(x.id) === row);
    if (!r) return;
    const i = r.heroIds.findIndex(x => String(x) === hero);
    if (i >= 0) r.heroIds.splice(i, 1);
    else r.heroIds.push(classHeroesId(cls, hero));
  }
  renderHeroGear();
}

// Keep the hero's original id type (number) when toggling from a data-attribute string.
function classHeroesId(cls, idStr) {
  return hgClassHeroes(cls).find(h => String(h.id) === idStr)?.id ?? idStr;
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
