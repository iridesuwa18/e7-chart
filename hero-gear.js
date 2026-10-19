/* ═══════════════════════════════════════════════════════════════════
   HERO EQUIPMENT & ARTIFACTS

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

function renderHeroGear() {
  const body = document.getElementById("hero-gear-body");
  if (!body) return; // page without the drawer (e.g. quickdraft.html)

  body.innerHTML = GEAR_CLASSES.map(cls => `
    <div class="hg-class">
      <div class="hg-class-title">${hgEsc(cls)}</div>
      ${hgSectionHTML(cls, "equipment", "Equipment")}
      ${hgSectionHTML(cls, "artifacts", "Artifacts")}
    </div>`).join("");

  body.querySelector(".hg-input")?.focus();
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
  });
  body.addEventListener("click", hgOnClick);
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
