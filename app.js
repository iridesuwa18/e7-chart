/* ═══════════════════════════════════════
   EPIC SEVEN — app.js  (v2)
   Sections A–F implemented:
   A) Image-based icons with crop/pan editor
   B) Score system (SPD/TNK, SUR/RS) with axis numbers
   C) Roster: Role, Element, scores display, sort, filter, lock
   D) Average score calculation
   E) Admin password gate for save/load
   F) Credits in footer (HTML)
═══════════════════════════════════════ */

const RARITY_META = {
  "5ml": { label: "5★ ML / Limited",      color: "#e8c84a",              border: "#c9a227" },
  "5r":  { label: "5★ Regular",           color: "rgba(232,200,74,0.65)", border: "rgba(201,162,39,0.65)" },
  "4":   { label: "4★",                   color: "#a88fd4",              border: "#7a60b0" },
  "3":   { label: "3★",                   color: "#7a9aaa",              border: "#50707f" },
};

/* ── State ── */
let heroes     = [];
let selectedId = null;
let dragging   = null;
let dragOffX   = 0, dragOffY = 0;
let editingId  = null;

/* ── Grid snap ── */
let snapEnabled = false;
const SNAP_DIVISIONS = 10; // snaps to 0,1,2…10 on each axis

/* ── Admin gate ── */
let pendingAdminAction = null; // "save" | "load"

/* ── Roster UI state ── */
let rosterSort = "date-desc";
let filterRarity  = new Set(["5ml","5r","4","3"]);
let filterRole    = new Set(["Warrior","Knight","Thief","Ranger","Mage","Soul Weaver",""]);
let filterElement = new Set(["Fire","Ice","Earth","Light","Dark",""]);

/* ── Image editor state ── */
let editorImg   = null;   // loaded HTMLImageElement
let editorPanX  = 0;
let editorPanY  = 0;
let editorZoom  = 1;
let editorDrag  = false;
let editorLX    = 0, editorLY = 0;

/* ── DOM refs ── */
const chart        = document.getElementById("chart");
const rosterList   = document.getElementById("roster-list");
const emptyMsg     = document.getElementById("empty-msg");
const overlay      = document.getElementById("modal-overlay");
const modalTitle   = document.getElementById("modal-title");
const fName        = document.getElementById("f-name");
const fRarity      = document.getElementById("f-rarity");
const fRole        = document.getElementById("f-role");
const fElement     = document.getElementById("f-element");
const fVType       = document.getElementById("f-v-type");
const fVScore      = document.getElementById("f-v-score");
const fHType       = document.getElementById("f-h-type");
const fHScore      = document.getElementById("f-h-score");
const fIconData    = document.getElementById("f-icon-data");
const fNotes       = document.getElementById("f-notes");
const iconCanvas   = document.getElementById("icon-canvas");
const modalConfirm = document.getElementById("modal-confirm");
const modalDelete  = document.getElementById("modal-delete");
const saveStatus   = document.getElementById("save-status");

/* ═══════════════════════════════════════
   INIT
═══════════════════════════════════════ */
(function init() {
  loadLocal();
  renderAll();

  // Auto-load from server for ALL visitors on page open (no password needed)
  autoLoadFromServer();

  // Double-click the brand emblem to reveal admin controls (Save/Load/Add Hero)
  document.querySelector(".brand-emblem").addEventListener("dblclick", () => {
    const ctrl = document.getElementById("admin-controls");
    const isVisible = ctrl.style.display !== "none";
    ctrl.style.display = isVisible ? "none" : "flex";
  });

  document.getElementById("btn-add").addEventListener("click", openAddModal);
  document.getElementById("btn-save").addEventListener("click", () => openAdminGate("save"));
  document.getElementById("btn-load").addEventListener("click", () => openAdminGate("load"));
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("modal-overlay").addEventListener("click", e => { if (e.target === overlay) closeModal(); });
  modalConfirm.addEventListener("click", onModalConfirm);
  modalDelete.addEventListener("click", onModalDelete);

  // Admin modal
  document.getElementById("admin-confirm").addEventListener("click", onAdminConfirm);
  document.getElementById("admin-cancel").addEventListener("click", closeAdminGate);
  document.getElementById("admin-overlay").addEventListener("click", e => { if (e.target === document.getElementById("admin-overlay")) closeAdminGate(); });
  document.getElementById("admin-password").addEventListener("keydown", e => { if (e.key === "Enter") onAdminConfirm(); });

  // Drag events on chart
  chart.addEventListener("pointermove", onPointerMove);
  chart.addEventListener("pointerup",   onPointerUp);
  chart.addEventListener("pointercancel", onPointerUp);

  // Deselect on chart background click
  chart.addEventListener("click", e => {
    if (e.target === chart || e.target.classList.contains("axis-h") || e.target.classList.contains("axis-v")) {
      setSelected(null);
    }
  });

  // Image icon controls
  document.getElementById("btn-paste-icon").addEventListener("click", pasteIcon);
  document.getElementById("f-icon-file").addEventListener("change", onIconFileChange);
  document.getElementById("btn-load-url").addEventListener("click", onLoadUrl);
  document.getElementById("img-zoom").addEventListener("input", drawEditor);
  document.getElementById("btn-crop-confirm").addEventListener("click", cropAndSave);
  document.getElementById("btn-crop-cancel").addEventListener("click", () => {
    document.getElementById("img-editor-wrap").style.display = "none";
    editorImg = null;
  });

  const editorBox = document.getElementById("img-editor-box");
  editorBox.addEventListener("pointerdown", editorPanStart);
  editorBox.addEventListener("pointermove", editorPanMove);
  editorBox.addEventListener("pointerup",   editorPanEnd);
  editorBox.addEventListener("pointercancel", editorPanEnd);

  // Snap toggle
  document.getElementById("btn-snap-toggle").addEventListener("click", () => {
    snapEnabled = !snapEnabled;
    const btn = document.getElementById("btn-snap-toggle");
    btn.classList.toggle("active", snapEnabled);
    btn.title = snapEnabled ? "Grid Snap: ON" : "Grid Snap: OFF";
  });

  // Visibility modal
  document.getElementById("btn-visibility-toggle").addEventListener("click", () => {
    const overlay = document.getElementById("visibility-modal-overlay");
    overlay.classList.add("open");
    renderVisibilityPanel();
  });
  document.getElementById("vis-modal-close").addEventListener("click", () => {
    document.getElementById("visibility-modal-overlay").classList.remove("open");
  });
  document.getElementById("visibility-modal-overlay").addEventListener("click", (e) => {
    if (e.target === document.getElementById("visibility-modal-overlay")) {
      document.getElementById("visibility-modal-overlay").classList.remove("open");
    }
  });
  document.getElementById("vis-search").addEventListener("input", renderVisibilityPanel);
  document.getElementById("vis-check-all").addEventListener("click", () => {
    heroes.forEach(h => h.hidden = false);
    saveLocal(); renderAll(); renderVisibilityPanel();
  });
  document.getElementById("vis-uncheck-all").addEventListener("click", () => {
    heroes.forEach(h => h.hidden = true);
    saveLocal(); renderAll(); renderVisibilityPanel();
  });

  // Icon size control — persisted to localStorage
  const iconSizeInput = document.getElementById("vis-icon-size");
  const savedIconSize = localStorage.getItem("iconSize");
  if (savedIconSize) {
    iconSizeInput.value = savedIconSize;
    document.documentElement.style.setProperty("--icon-size", savedIconSize + "px");
  }
  iconSizeInput.addEventListener("input", () => {
    const size = Math.max(16, Math.min(80, Number(iconSizeInput.value) || 38));
    document.documentElement.style.setProperty("--icon-size", size + "px");
    localStorage.setItem("iconSize", size);
  });
  document.getElementById("roster-sort").addEventListener("change", e => {
    rosterSort = e.target.value;
    renderRoster();
  });

  // Filter toggle
  document.getElementById("btn-filter-toggle").addEventListener("click", () => {
    const fp = document.getElementById("filter-panel");
    fp.style.display = fp.style.display === "none" ? "block" : "none";
  });

  // Filter checkboxes
  document.getElementById("filter-rarity").addEventListener("change", () => {
    filterRarity = getCheckedValues("filter-rarity");
    renderRoster();
  });
  document.getElementById("filter-role").addEventListener("change", () => {
    filterRole = getCheckedValues("filter-role");
    filterRole.add(""); // always show heroes with no role set
    renderRoster();
  });
  document.getElementById("filter-element").addEventListener("change", () => {
    filterElement = getCheckedValues("filter-element");
    filterElement.add(""); // always show heroes with no element set
    renderRoster();
  });
})();

function getCheckedValues(containerId) {
  const checks = document.querySelectorAll(`#${containerId} input[type=checkbox]`);
  const s = new Set();
  checks.forEach(c => { if (c.checked) s.add(c.value); });
  return s;
}

/* ═══════════════════════════════════════
   SCORE ↔ POSITION CONVERSION
   X axis: SUR(left) 0=50% / RS(right) 0=50%
     SUR 10 → x=0%, SUR 0 → x=50%, RS 0 → x=50%, RS 10 → x=100%
   Y axis: SPD(top) / TNK(bottom)
     SPD 10 → y=0%, SPD 0 → y=50%, TNK 0 → y=50%, TNK 10 → y=100%
═══════════════════════════════════════ */
function scoresToXY(vType, vScore, hType, hScore) {
  const v = Math.max(0, Math.min(10, Number(vScore) || 0));
  const h = Math.max(0, Math.min(10, Number(hScore) || 0));

  let y; // 0% = top (SPD 10)
  if (vType === "SPD") {
    y = 50 - (v / 10) * 50; // SPD 10 → 0%, SPD 0 → 50%
  } else {
    y = 50 + (v / 10) * 50; // TNK 0 → 50%, TNK 10 → 100%
  }

  let x; // 0% = left (SUR 10)
  if (hType === "SUR") {
    x = 50 - (h / 10) * 50; // SUR 10 → 0%, SUR 0 → 50%
  } else {
    x = 50 + (h / 10) * 50; // RS 0 → 50%, RS 10 → 100%
  }

  return { x, y };
}

function xyToScores(x, y) {
  // x: 0..100 → SUR 10..0 (left half) or RS 0..10 (right half)
  // y: 0..100 → SPD 10..0 (top half)  or TNK 0..10 (bottom half)
  let vType, vScore, hType, hScore;

  if (y <= 50) {
    vType  = "SPD";
    vScore = +((50 - y) / 50 * 10).toFixed(1);
  } else {
    vType  = "TNK";
    vScore = +((y - 50) / 50 * 10).toFixed(1);
  }

  if (x <= 50) {
    hType  = "SUR";
    hScore = +((50 - x) / 50 * 10).toFixed(1);
  } else {
    hType  = "RS";
    hScore = +((x - 50) / 50 * 10).toFixed(1);
  }

  return { vType, vScore, hType, hScore };
}

function avgScore(vScore, hScore) {
  const v = Math.max(0, Math.min(10, Number(vScore) || 0));
  const h = Math.max(0, Math.min(10, Number(hScore) || 0));
  return +((v + h) / 2).toFixed(1);
}

/* ═══════════════════════════════════════
   RENDER
═══════════════════════════════════════ */
function renderAll() {
  renderChart();
  renderRoster();
  if (document.getElementById("visibility-modal-overlay").classList.contains("open")) {
    renderVisibilityPanel();
  }
}

function renderVisibilityPanel() {
  const search  = (document.getElementById("vis-search").value || "").toLowerCase();
  const list    = document.getElementById("vis-list");
  list.innerHTML = "";
  const filtered = heroes.filter(h => !search || (h.name||"").toLowerCase().includes(search));
  filtered.forEach(h => {
    const meta = RARITY_META[h.rarity] || RARITY_META["5r"];
    const row  = document.createElement("label");
    row.className = "vis-row";
    const iconHTML = h.iconData
      ? `<img src="${h.iconData}" class="vis-icon"/>`
      : `<span class="vis-icon-fallback">⚔</span>`;
    row.innerHTML = `
      <input type="checkbox" ${h.hidden ? "" : "checked"} data-id="${h.id}"/>
      ${iconHTML}
      <span class="vis-name">${h.name || "Unnamed"}</span>
      <span class="vis-rarity" style="color:${meta.color}">${meta.label}</span>`;
    row.querySelector("input").addEventListener("change", e => {
      const target = heroes.find(x => x.id == e.target.dataset.id);
      if (target) { target.hidden = !e.target.checked; saveLocal(); renderChart(); }
    });
    list.appendChild(row);
  });
  if (filtered.length === 0) {
    list.innerHTML = `<div style="color:#607a90;font-size:12px;font-style:italic;padding:10px 0">No heroes found</div>`;
  }
}

function renderChart() {
  document.querySelectorAll(".hero-dot").forEach(el => el.remove());

  heroes.forEach(h => {
    if (h.hidden) return; // skip hidden heroes
    const { x, y } = scoresToXY(h.vType || "SPD", h.vScore || 0, h.hType || "SUR", h.hScore || 0);
    // Store computed x/y back for reference
    h._x = x; h._y = y;

    const dot = document.createElement("div");
    dot.className = "hero-dot" + (h.id === selectedId ? " selected" : "");
    dot.dataset.id = h.id;
    dot.style.left = x + "%";
    dot.style.top  = y + "%";

    const meta = RARITY_META[h.rarity] || RARITY_META["5r"];
    const inner = document.createElement("div");
    inner.className = "hero-dot-inner";
    inner.style.borderColor = meta.border;
    inner.style.boxShadow   = `0 0 10px ${meta.border}66`;

    if (h.iconData) {
      const img = document.createElement("img");
      img.src = h.iconData;
      img.style.cssText = "width:100%;height:100%;border-radius:50%;object-fit:cover;";
      inner.appendChild(img);
    } else {
      inner.textContent = "⚔️";
    }

    const label = document.createElement("div");
    label.className = "hero-dot-label";
    label.textContent = h.name || "Hero";

    // Score tooltip
    const scores = xyToScores(x, y);
    dot.title = `${scores.vType} ${scores.vScore} | ${scores.hType} ${scores.hScore} | Avg ${avgScore(scores.vScore, scores.hScore)}`;

    dot.appendChild(inner);
    dot.appendChild(label);

    // Drag (only if not locked)
    dot.addEventListener("pointerdown", e => {
      if (h.locked) return;
      e.stopPropagation();
      setSelected(h.id);
      const rect = chart.getBoundingClientRect();
      // Offset = pointer position relative to the dot's center
      // dot is positioned at (x%, y%) which is its center
      const dotCenterX = (x / 100) * rect.width;
      const dotCenterY = (y / 100) * rect.height;
      dragOffX = e.clientX - rect.left - dotCenterX;
      dragOffY = e.clientY - rect.top  - dotCenterY;
      dragging = h.id;
      dot.setPointerCapture(e.pointerId);
    });

    dot.addEventListener("click", e => {
      e.stopPropagation();
      if (selectedId === h.id) {
        openEditModal(h);
      } else {
        setSelected(h.id);
      }
    });

    chart.appendChild(dot);
  });
}

function renderRoster() {
  document.querySelectorAll(".hero-card").forEach(el => el.remove());

  // Sort
  let list = [...heroes];
  if (rosterSort === "az")        list.sort((a,b) => (a.name||"").localeCompare(b.name||""));
  else if (rosterSort === "za")   list.sort((a,b) => (b.name||"").localeCompare(a.name||""));
  else if (rosterSort === "date-asc")  list.sort((a,b) => a.id - b.id);
  else                                 list.sort((a,b) => b.id - a.id);

  // Filter
  list = list.filter(h =>
    filterRarity.has(h.rarity) &&
    filterRole.has(h.role || "") &&
    filterElement.has(h.element || "")
  );

  emptyMsg.style.display = list.length === 0 ? "block" : "none";

  list.forEach(h => {
    const meta = RARITY_META[h.rarity] || RARITY_META["5r"];
    const scores = xyToScores(h._x ?? 50, h._y ?? 50);
    const avg    = avgScore(scores.vScore, scores.hScore);

    const card = document.createElement("div");
    card.className = "hero-card" + (h.id === selectedId ? " selected" : "");
    card.dataset.id = h.id;

    const iconHTML = h.iconData
      ? `<div class="hero-card-icon"><img src="${h.iconData}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;"></div>`
      : `<div class="hero-card-icon">⚔️</div>`;

    const roleEl  = h.role    ? `<span class="tag tag-role">${h.role}</span>`       : "";
    const elemEl  = h.element ? `<span class="tag tag-elem">${h.element}</span>`    : "";
    const lockIcon = h.locked ? "🔒" : "🔓";

    const lockSVG = h.locked
      ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`
      : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`;

    card.innerHTML = `
      ${iconHTML}
      <div class="hero-card-info">
        <div class="hero-card-name">${h.name || "Unnamed Hero"}${h.locked ? `<span class="lock-badge" title="Locked">${lockSVG}</span>` : ""}</div>
        <div class="hero-card-rarity" style="color:${meta.color}">${meta.label}</div>
        <div class="hero-card-tags">${roleEl}${elemEl}</div>
        <div class="hero-card-scores">
          <span class="score-badge">${scores.vType} ${scores.vScore}</span>
          <span class="score-badge">${scores.hType} ${scores.hScore}</span>
          <span class="score-badge avg">Avg ${avg}</span>
        </div>
      </div>
      <div class="hero-card-actions">
        <button class="icon-btn btn-edit" title="Edit">✏️</button>
        <button class="icon-btn btn-del"  title="Delete">🗑️</button>
      </div>`;

    card.querySelector(".btn-edit").addEventListener("click", e => { e.stopPropagation(); openEditModal(h); });
    card.querySelector(".btn-del" ).addEventListener("click", e => { e.stopPropagation(); deleteHero(h.id); });
    card.addEventListener("click", () => setSelected(selectedId === h.id ? null : h.id));

    rosterList.appendChild(card);
  });
}

/* ═══════════════════════════════════════
   SELECTION
═══════════════════════════════════════ */
function setSelected(id) {
  selectedId = id;
  renderAll();
  if (id) {
    const card = document.querySelector(`.hero-card[data-id="${id}"]`);
    if (card) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function toggleLock(id) {
  heroes = heroes.map(h => h.id === id ? { ...h, locked: !h.locked } : h);
  saveLocal();
  renderRoster();
}

/* ═══════════════════════════════════════
   DRAG
═══════════════════════════════════════ */
function onPointerMove(e) {
  if (!dragging) return;
  const rect = chart.getBoundingClientRect();

  // Use offset 0 — track exactly where the pointer is on the chart
  let x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width)  * 100));
  let y = Math.max(0, Math.min(100, ((e.clientY - rect.top)  / rect.height) * 100));

  // Grid snap: snap to nearest 1/SNAP_DIVISIONS interval (0,5,10,…,50,…,95,100%)
  if (snapEnabled) {
    const step = 100 / SNAP_DIVISIONS; // 10% per step
    x = Math.round(x / step) * step;
    y = Math.round(y / step) * step;
    x = Math.max(0, Math.min(100, x));
    y = Math.max(0, Math.min(100, y));
  }

  const dot = chart.querySelector(`.hero-dot[data-id="${dragging}"]`);
  if (dot) { dot.style.left = x + "%"; dot.style.top = y + "%"; }

  const hero = heroes.find(h => h.id === dragging);
  if (hero) {
    const s = xyToScores(x, y);
    hero.vType  = s.vType;
    hero.vScore = s.vScore;
    hero.hType  = s.hType;
    hero.hScore = s.hScore;
    hero._x = x; hero._y = y;
    const dotEl = chart.querySelector(`.hero-dot[data-id="${dragging}"]`);
    if (dotEl) dotEl.title = `${s.vType} ${s.vScore} | ${s.hType} ${s.hScore} | Avg ${avgScore(s.vScore, s.hScore)}`;
  }
}

function onPointerUp() {
  if (dragging) {
    dragging = null;
    saveLocal();
    renderRoster();
  }
}

/* ═══════════════════════════════════════
   IMAGE EDITOR (Section A)
═══════════════════════════════════════ */
const EDITOR_SIZE = 220; // editor box px

function openImageEditor(src) {
  editorImg = new Image();
  editorImg.crossOrigin = "anonymous";
  editorImg.onload = () => {
    editorZoom = Math.max(EDITOR_SIZE / editorImg.naturalWidth, EDITOR_SIZE / editorImg.naturalHeight);
    editorPanX = (EDITOR_SIZE - editorImg.naturalWidth * editorZoom) / 2;
    editorPanY = (EDITOR_SIZE - editorImg.naturalHeight * editorZoom) / 2;
    document.getElementById("img-zoom").min   = editorZoom * 0.5;
    document.getElementById("img-zoom").max   = editorZoom * 4;
    document.getElementById("img-zoom").step  = editorZoom * 0.002;
    document.getElementById("img-zoom").value = editorZoom;
    document.getElementById("img-editor-src").src = src;
    document.getElementById("img-editor-wrap").style.display = "block";
    drawEditor();
  };
  editorImg.onerror = () => alert("Could not load image. Try uploading a file instead.");
  editorImg.src = src;
}

function drawEditor() {
  editorZoom = parseFloat(document.getElementById("img-zoom").value);
  const imgEl = document.getElementById("img-editor-src");
  if (!editorImg) return;
  imgEl.style.width    = (editorImg.naturalWidth  * editorZoom) + "px";
  imgEl.style.height   = (editorImg.naturalHeight * editorZoom) + "px";
  imgEl.style.left     = editorPanX + "px";
  imgEl.style.top      = editorPanY + "px";
  imgEl.style.position = "absolute";
}

function editorPanStart(e) {
  editorDrag = true;
  editorLX = e.clientX;
  editorLY = e.clientY;
  e.currentTarget.setPointerCapture(e.pointerId);
}
function editorPanMove(e) {
  if (!editorDrag) return;
  editorPanX += e.clientX - editorLX;
  editorPanY += e.clientY - editorLY;
  editorLX = e.clientX;
  editorLY = e.clientY;
  drawEditor();
}
function editorPanEnd() { editorDrag = false; }

function cropAndSave() {
  if (!editorImg) return;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d");
  // Circle clip
  ctx.beginPath();
  ctx.arc(256, 256, 256, 0, Math.PI * 2);
  ctx.clip();
  // Draw image at its current pan/zoom, scaled to 512px editor size
  const scale = 512 / EDITOR_SIZE;
  ctx.drawImage(
    editorImg,
    editorPanX * scale,
    editorPanY * scale,
    editorImg.naturalWidth  * editorZoom * scale,
    editorImg.naturalHeight * editorZoom * scale
  );
  const dataURL = canvas.toDataURL("image/webp", 0.9);
  // Hide the crop editor and open File Manager
  document.getElementById("img-editor-wrap").style.display = "none";
  editorImg = null;
  openFileManager(dataURL, "heroes", (finalUrl) => {
    fIconData.value = finalUrl;
    updateIconPreview(finalUrl);
  });
}

function updateIconPreview(dataURL) {
  const ctx = iconCanvas.getContext("2d");
  ctx.clearRect(0, 0, 128, 128);
  if (!dataURL) {
    ctx.fillStyle = "#1a3050";
    ctx.beginPath(); ctx.arc(64,64,62,0,Math.PI*2); ctx.fill();
    return;
  }
  const img = new Image();
  img.onload = () => {
    ctx.beginPath(); ctx.arc(64,64,64,0,Math.PI*2); ctx.clip();
    ctx.drawImage(img, 0, 0, 128, 128);
  };
  img.src = dataURL;
}

async function pasteIcon() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find(t => t.startsWith("image/"));
      if (type) {
        const blob = await item.getType(type);
        const url  = URL.createObjectURL(blob);
        openImageEditor(url);
        return;
      }
    }
    alert("No image found on clipboard. Copy an image first.");
  } catch {
    alert("Clipboard access denied. Try uploading a file or using a URL.");
  }
}

function onIconFileChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => openImageEditor(ev.target.result);
  reader.readAsDataURL(file);
}

function onLoadUrl() {
  const url = document.getElementById("f-icon-url").value.trim();
  if (!url) return;
  openImageEditor(url);
}

/* ═══════════════════════════════════════
   MODAL
═══════════════════════════════════════ */
function openAddModal() {
  editingId = null;
  modalTitle.textContent = "ADD HERO";
  modalConfirm.textContent = "Add to Chart";
  modalDelete.style.display = "none";
  fName.value     = "";
  fRarity.value   = "5ml";
  fRole.value     = "";
  fElement.value  = "";
  fVType.value    = "SPD";
  fVScore.value   = "0";
  fHType.value    = "SUR";
  fHScore.value   = "0";
  fNotes.value    = "";
  fIconData.value = "";
  document.getElementById("f-locked").checked = false;
  document.getElementById("img-editor-wrap").style.display = "none";
  document.getElementById("f-icon-url").value = "";
  updateIconPreview(null);
  overlay.classList.add("open");
  fName.focus();
}

function openEditModal(h) {
  editingId = h.id;
  modalTitle.textContent = "EDIT HERO";
  modalConfirm.textContent = "Save Changes";
  modalDelete.style.display = "inline-flex";
  fName.value    = h.name    || "";
  fRarity.value  = h.rarity  || "5ml";
  fRole.value    = h.role    || "";
  fElement.value = h.element || "";
  fVType.value   = h.vType   || "SPD";
  fVScore.value  = h.vScore  !== undefined ? h.vScore : 0;
  fHType.value   = h.hType   || "SUR";
  fHScore.value  = h.hScore  !== undefined ? h.hScore : 0;
  fNotes.value   = h.notes   || "";
  fIconData.value = h.iconData || "";
  document.getElementById("f-locked").checked = h.locked || false;
  document.getElementById("img-editor-wrap").style.display = "none";
  document.getElementById("f-icon-url").value = "";
  updateIconPreview(h.iconData || null);
  overlay.classList.add("open");
  fName.focus();
}

function closeModal() {
  overlay.classList.remove("open");
  editingId = null;
  editorImg = null;
}

function onModalConfirm() {
  const name     = fName.value.trim() || "Unnamed Hero";
  const rarity   = fRarity.value;
  const role     = fRole.value;
  const element  = fElement.value;
  const vType    = fVType.value;
  const vScore   = Math.max(0, Math.min(10, parseFloat(fVScore.value) || 0));
  const hType    = fHType.value;
  const hScore   = Math.max(0, Math.min(10, parseFloat(fHScore.value) || 0));
  const notes    = fNotes.value.trim();
  const iconData = fIconData.value || null;
  const locked   = document.getElementById("f-locked").checked;

  if (editingId !== null) {
    heroes = heroes.map(h => h.id === editingId
      ? { ...h, name, rarity, role, element, vType, vScore, hType, hScore, notes, iconData, locked }
      : h
    );
  } else {
    heroes.push({
      id: Date.now(),
      name, rarity, role, element, vType, vScore, hType, hScore, notes, iconData,
      locked: false,
    });
  }

  saveLocal();
  closeModal();
  renderAll();
}

function onModalDelete() {
  if (editingId !== null) deleteHero(editingId);
  closeModal();
}

function deleteHero(id) {
  heroes = heroes.filter(h => h.id !== id);
  if (selectedId === id) selectedId = null;
  saveLocal();
  renderAll();
}

/* ═══════════════════════════════════════
   LOCAL STORAGE
═══════════════════════════════════════ */
function saveLocal() {
  localStorage.setItem("e7_heroes", JSON.stringify(heroes));
}

function loadLocal() {
  try {
    const raw = localStorage.getItem("e7_heroes");
    if (raw) heroes = JSON.parse(raw);
    // Back-compat: convert old x/y to scores
    heroes = heroes.map(h => {
      if (h.vType === undefined) {
        const s = xyToScores(h.x ?? 50, h.y ?? 50);
        return { ...h, vType: s.vType, vScore: s.vScore, hType: s.hType, hScore: s.hScore };
      }
      return h;
    });
  } catch { heroes = []; }
}

/* ═══════════════════════════════════════
   ADMIN GATE (Section E)
═══════════════════════════════════════ */
function openAdminGate(action) {
  pendingAdminAction = action;
  document.getElementById("admin-action-label").textContent = action;
  document.getElementById("admin-password").value = "";
  document.getElementById("admin-error").style.display = "none";
  document.getElementById("admin-overlay").classList.add("open");
  setTimeout(() => document.getElementById("admin-password").focus(), 100);
}

function closeAdminGate() {
  document.getElementById("admin-overlay").classList.remove("open");
  pendingAdminAction = null;
}

async function onAdminConfirm() {
  const pw = document.getElementById("admin-password").value;
  if (!pw) {
    showAdminError("Please enter the password.");
    return;
  }
  closeAdminGate();
  if (pendingAdminAction === "save" || !pendingAdminAction) {
    await saveToServer(pw);
  } else {
    await loadFromServer(pw);
  }
}

function showAdminError(msg) {
  const el = document.getElementById("admin-error");
  el.textContent = msg;
  el.style.display = "block";
}

/* ═══════════════════════════════════════
   GITHUB GIST VIA VERCEL API (Section E)
═══════════════════════════════════════ */
function setStatus(msg, timeout = 4000) {
  saveStatus.textContent = msg;
  if (timeout) setTimeout(() => { saveStatus.textContent = ""; }, timeout);
}

// Called on every page load for ALL visitors — no password needed.
// Server data always wins over local storage so everyone sees the latest.
async function autoLoadFromServer() {
  try {
    const res = await fetch("https://e7-chart.vercel.app/api/public-load", { method: "GET" });
    if (!res.ok) return; // silently fail — local data stays
    const data = await res.json();
    if (Array.isArray(data.heroes) && data.heroes.length > 0) {
      heroes = data.heroes;
      saveLocal();
      renderAll();
    }
  } catch {
    // Network error — silently fall back to local storage
  }
}

async function saveToServer(password) {
  setStatus("⏳ Saving…", 0);
  try {
    const res = await fetch("https://e7-chart.vercel.app/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ heroes, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Save failed");
    setStatus("✅ Saved to GitHub");
  } catch (e) {
    setStatus("❌ " + e.message);
  }
}

async function loadFromServer(password) {
  setStatus("⏳ Loading…", 0);
  try {
    const res = await fetch("https://e7-chart.vercel.app/api/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Load failed");
    if (Array.isArray(data.heroes)) {
      heroes = data.heroes;
      saveLocal();
      renderAll();
      setStatus("✅ Loaded from GitHub");
    } else {
      setStatus("⚠️ No data found");
    }
  } catch (e) {
    setStatus("❌ " + e.message);
  }
}

/* ═══════════════════════════════════════
   FILE MANAGER (vanilla JS)
   Opens after crop in the Add/Edit Hero modal.
   Password-gates repo access, lets the user name
   or replace an existing file, then commits it
   via api/upload-image. Mirrors FileManagerModal
   in draft.js but in plain DOM / ES6.
═══════════════════════════════════════ */

let _fmCallback = null; // called with final URL on success

function openFileManager(croppedData, folder, onSave) {
  _fmCallback = onSave;

  // Inject overlay HTML if not already present
  if (!document.getElementById("fm-overlay")) {
    const el = document.createElement("div");
    el.id = "fm-overlay";
    el.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;z-index:10000;padding:16px";
    el.innerHTML = `
      <div id="fm-box" style="background:#071220;border:1px solid #1a3050;border-top:2px solid #c9a227;border-radius:6px;padding:22px 22px 18px;width:440px;max-width:96vw;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.8)">

        <!-- Password step -->
        <div id="fm-step-pw">
          <div style="font-family:Cinzel,serif;color:#e8c84a;font-size:13px;letter-spacing:.25em;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid #6a5010">
            📁 REPO FILE MANAGER
          </div>
          <p style="font-size:13px;color:#607a90;font-family:'Crimson Pro',serif;margin-bottom:16px;line-height:1.7">
            Enter your admin password to open the
            <strong style="color:#c9a227" id="fm-folder-label">assets/heroes/</strong> folder.
          </p>
          <label style="font-family:Cinzel,serif;font-size:9px;color:#607a90;letter-spacing:.2em;display:block;margin-bottom:5px">PASSWORD</label>
          <input id="fm-pw" type="password" placeholder="Enter admin key…"
            style="background:#04090f;border:1px solid #1a3050;color:#dce8f5;padding:6px 10px;border-radius:3px;font-size:13px;width:100%;box-sizing:border-box;font-family:'Crimson Pro',serif;outline:none;margin-bottom:10px"/>
          <div id="fm-pw-err" style="font-size:12px;color:#e07070;background:rgba(192,57,43,.1);border:1px solid #5a2020;border-radius:3px;padding:6px 10px;margin-bottom:10px;display:none"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
            <button id="fm-pw-cancel" style="background:#0b1a2e;border:1px solid #1a3050;color:#607a90;padding:5px 12px;border-radius:3px;font-size:11px;font-family:Cinzel,serif;letter-spacing:.1em;cursor:pointer">Cancel</button>
            <button id="fm-pw-open"   style="background:#c9a227;border:none;color:#04090f;font-weight:700;padding:5px 12px;border-radius:3px;font-size:11px;font-family:Cinzel,serif;letter-spacing:.1em;cursor:pointer">Open Manager</button>
          </div>
        </div>

        <!-- Manager step (hidden until password verified) -->
        <div id="fm-step-mgr" style="display:none">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid #6a5010">
            <span style="font-family:Cinzel,serif;color:#e8c84a;font-size:13px;letter-spacing:.25em">📁 REPO FILE MANAGER</span>
            <button id="fm-mgr-cancel" style="background:none;border:none;color:#607a90;font-size:18px;cursor:pointer;line-height:1">×</button>
          </div>

          <!-- New image row -->
          <div style="background:#0b1a2e;border:1px solid #1a3050;border-radius:4px;padding:12px 14px;margin-bottom:18px;display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
            <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:5px">
              <div style="font-family:Cinzel,serif;font-size:8px;color:#607a90;letter-spacing:.2em">NEW IMAGE</div>
              <img id="fm-preview-img" src="" alt="" style="width:64px;height:64px;border-radius:4px;object-fit:cover;border:2px solid #c9a227;display:block"/>
            </div>
            <div style="flex:1;min-width:200px">
              <div id="fm-filename-row">
                <label style="font-family:Cinzel,serif;font-size:9px;color:#607a90;letter-spacing:.2em;display:block;margin-bottom:5px">FILENAME (without extension)</label>
                <div style="display:flex;gap:6px;align-items:center">
                  <input id="fm-filename" placeholder="e.g. ruele-of-light"
                    style="background:#04090f;border:1px solid #1a3050;color:#dce8f5;padding:6px 10px;border-radius:3px;font-size:13px;flex:1;font-family:'Crimson Pro',serif;outline:none"/>
                  <span id="fm-ext-label" style="font-size:11px;color:#607a90;font-family:'Crimson Pro',serif;flex-shrink:0">.webp</span>
                </div>
              </div>
              <div id="fm-replace-row" style="display:none">
                <label style="font-family:Cinzel,serif;font-size:9px;color:#607a90;letter-spacing:.2em;display:block;margin-bottom:5px">WILL REPLACE EXISTING FILE</label>
                <div style="display:flex;align-items:center;gap:8px">
                  <img id="fm-replace-thumb" src="" alt="" style="width:36px;height:36px;border-radius:3px;object-fit:cover;border:1px solid #c9a227;flex-shrink:0"/>
                  <span id="fm-replace-name" style="font-size:12px;color:#c9a227;font-family:'Crimson Pro',serif;flex:1;word-break:break-all"></span>
                  <button id="fm-replace-clear" style="background:none;border:1px solid #1a3050;color:#607a90;padding:2px 8px;border-radius:2px;font-size:10px;cursor:pointer;flex-shrink:0">Clear</button>
                </div>
              </div>
              <div id="fm-save-hint" style="font-size:11px;color:#607a90;font-family:'Crimson Pro',serif;margin-top:6px;line-height:1.6"></div>
            </div>
          </div>

          <!-- Existing images grid -->
          <div id="fm-existing-section">
            <div style="font-family:Cinzel,serif;font-size:9px;color:#607a90;letter-spacing:.2em;margin-bottom:8px;display:flex;align-items:center;gap:8px">
              EXISTING IMAGES
              <span id="fm-delete-count" style="color:#e07070;font-size:9px;display:none"></span>
            </div>
            <div id="fm-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:7px;margin-bottom:16px;max-height:260px;overflow-y:auto;padding:2px"></div>
          </div>
          <div id="fm-empty-msg" style="font-size:12px;color:#607a90;font-style:italic;font-family:'Crimson Pro',serif;padding:10px 0 18px;text-align:center;display:none">
            No images in this folder yet — yours will be the first!
          </div>

          <div id="fm-save-err" style="font-size:12px;color:#e07070;background:rgba(192,57,43,.1);border:1px solid #5a2020;border-radius:3px;padding:6px 10px;margin-bottom:10px;display:none"></div>

          <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:14px;border-top:1px solid #1a3050">
            <button id="fm-discard" style="background:#0b1a2e;border:1px solid #1a3050;color:#607a90;padding:5px 12px;border-radius:3px;font-size:11px;font-family:Cinzel,serif;letter-spacing:.1em;cursor:pointer">Cancel — discard image</button>
            <button id="fm-save"    style="background:#c9a227;border:none;color:#04090f;font-weight:700;padding:5px 12px;border-radius:3px;font-size:11px;font-family:Cinzel,serif;letter-spacing:.1em;cursor:pointer">Save</button>
          </div>
        </div>

      </div>`;
    document.body.appendChild(el);
  }

  // --- state ---
  let verifiedPw     = "";
  let existingImages = []; // [{name,sha,url}]
  let replaceTarget  = null; // {name,sha,url} | null
  let pendingDeletes = new Set();

  const ext = croppedData.startsWith("data:image/png") ? "png" : "webp";

  // --- helpers ---
  function showErr(id, msg) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.style.display = msg ? "block" : "none";
  }
  function setHint() {
    const fname  = (document.getElementById("fm-filename").value.trim() || "").replace(/[^a-zA-Z0-9._-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"");
    const final  = replaceTarget
      ? replaceTarget.name
      : (/\.(jpe?g|png|webp|gif)$/i.test(fname) ? fname : (fname ? `${fname}.${ext}` : ""));
    document.getElementById("fm-save-hint").textContent = final ? `Saves as: ${final}` : "Enter a filename above";
    const delCount = pendingDeletes.size;
    document.getElementById("fm-delete-count").textContent = delCount > 0 ? `· ${delCount} marked for deletion` : "";
    document.getElementById("fm-delete-count").style.display = delCount > 0 ? "inline" : "none";
    document.getElementById("fm-save").textContent = delCount > 0 ? `Save + Delete ${delCount}` : "Save";
  }
  function renderGrid() {
    const grid = document.getElementById("fm-grid");
    grid.innerHTML = "";
    existingImages.forEach(img => {
      const isReplace = replaceTarget?.name === img.name;
      const isDelete  = pendingDeletes.has(img.name);
      const cell = document.createElement("div");
      cell.style.cssText = `position:relative;border:2px solid ${isReplace?"#c9a227":isDelete?"#c0392b":"#1a3050"};border-radius:4px;overflow:hidden;background:#0b1a2e;cursor:${isDelete?"default":"pointer"};opacity:${isDelete?0.35:1};transition:all 0.15s`;
      cell.innerHTML = `
        <img src="${img.url}" alt="${img.name}" style="width:100%;aspect-ratio:1;object-fit:cover;display:block"/>
        ${isReplace ? `<div style="position:absolute;inset:0;background:rgba(201,162,39,.25);display:flex;align-items:center;justify-content:center"><span style="font-family:Cinzel,serif;font-size:8px;color:#c9a227;background:rgba(0,0,0,.85);padding:2px 6px;border-radius:2px;letter-spacing:1px">REPLACE</span></div>` : ""}
        <div style="padding:3px 5px;display:flex;align-items:center;gap:3px;background:rgba(0,0,0,.75)">
          <span style="font-size:7px;color:#607a90;font-family:'Crimson Pro',serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${img.name}</span>
          <button data-del="${img.name}" style="background:none;border:none;color:${isDelete?"#e87070":"#607a90"};font-size:13px;cursor:pointer;padding:0 1px;line-height:1;flex-shrink:0;font-weight:700">${isDelete?"↩":"×"}</button>
        </div>`;
      // Click image = select as replace target
      cell.querySelector("img").addEventListener("click", () => {
        if (isDelete) return;
        if (replaceTarget?.name === img.name) {
          replaceTarget = null;
        } else {
          replaceTarget = img;
          pendingDeletes.delete(img.name);
        }
        updateReplaceUI();
        renderGrid();
        setHint();
      });
      // Click × = toggle delete
      cell.querySelector("button[data-del]").addEventListener("mousedown", e => e.stopPropagation());
      cell.querySelector("button[data-del]").addEventListener("click", e => {
        e.stopPropagation();
        if (replaceTarget?.name === img.name) replaceTarget = null;
        if (pendingDeletes.has(img.name)) pendingDeletes.delete(img.name);
        else pendingDeletes.add(img.name);
        updateReplaceUI();
        renderGrid();
        setHint();
      });
      grid.appendChild(cell);
    });
    document.getElementById("fm-existing-section").style.display = existingImages.length > 0 ? "block" : "none";
    document.getElementById("fm-empty-msg").style.display         = existingImages.length === 0 ? "block" : "none";
  }
  function updateReplaceUI() {
    const filenameRow = document.getElementById("fm-filename-row");
    const replaceRow  = document.getElementById("fm-replace-row");
    if (replaceTarget) {
      filenameRow.style.display = "none";
      replaceRow.style.display  = "block";
      document.getElementById("fm-replace-thumb").src  = replaceTarget.url;
      document.getElementById("fm-replace-name").textContent = replaceTarget.name;
    } else {
      filenameRow.style.display = "block";
      replaceRow.style.display  = "none";
    }
  }

  // --- populate and show ---
  document.getElementById("fm-folder-label").textContent = `assets/${folder}/`;
  document.getElementById("fm-ext-label").textContent    = `.${ext}`;
  document.getElementById("fm-preview-img").src          = croppedData;
  document.getElementById("fm-filename").value           = "";
  document.getElementById("fm-pw").value                 = "";
  document.getElementById("fm-step-pw").style.display    = "block";
  document.getElementById("fm-step-mgr").style.display   = "none";
  showErr("fm-pw-err", "");
  showErr("fm-save-err", "");
  document.getElementById("fm-overlay").style.display    = "flex";

  // --- event wiring ---
  // Password step
  async function doVerify() {
    const pw = document.getElementById("fm-pw").value;
    if (!pw) { showErr("fm-pw-err", "Please enter the password."); return; }
    document.getElementById("fm-pw-open").textContent = "Verifying…";
    document.getElementById("fm-pw-open").disabled    = true;
    showErr("fm-pw-err", "");
    try {
      const res  = await fetch(`https://e7-chart.vercel.app/api/repo-images?folder=${folder}&password=${encodeURIComponent(pw)}`);
      const data = await res.json();
      if (!res.ok) { showErr("fm-pw-err", data.error || "Wrong password"); return; }
      verifiedPw     = pw;
      existingImages = data.images || [];
      replaceTarget  = null;
      pendingDeletes = new Set();
      renderGrid();
      updateReplaceUI();
      setHint();
      document.getElementById("fm-step-pw").style.display  = "none";
      document.getElementById("fm-step-mgr").style.display = "block";
    } catch (e) {
      showErr("fm-pw-err", "Network error: " + e.message);
    } finally {
      document.getElementById("fm-pw-open").textContent = "Open Manager";
      document.getElementById("fm-pw-open").disabled    = false;
    }
  }

  // Replace stale listeners by cloning buttons
  function rebind(id, handler) {
    const old = document.getElementById(id);
    const neo = old.cloneNode(true);
    old.parentNode.replaceChild(neo, old);
    document.getElementById(id).addEventListener("click", handler);
  }
  rebind("fm-pw-open",   doVerify);
  rebind("fm-pw-cancel", closeFileManager);
  rebind("fm-mgr-cancel", closeFileManager);
  rebind("fm-discard",   closeFileManager);

  document.getElementById("fm-pw").onkeydown = e => { if (e.key === "Enter") doVerify(); };
  document.getElementById("fm-filename").oninput = setHint;

  rebind("fm-replace-clear", () => {
    replaceTarget = null;
    updateReplaceUI();
    renderGrid();
    setHint();
  });

  rebind("fm-save", async () => {
    showErr("fm-save-err", "");
    // Determine final filename
    let finalFilename;
    if (replaceTarget) {
      finalFilename = replaceTarget.name;
    } else {
      const raw   = document.getElementById("fm-filename").value.trim();
      const clean = raw.replace(/[^a-zA-Z0-9._-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"");
      if (!clean) { showErr("fm-save-err", "Please enter a filename."); return; }
      finalFilename = /\.(jpe?g|png|webp|gif)$/i.test(clean) ? clean : `${clean}.${ext}`;
    }

    document.getElementById("fm-save").textContent = "Saving…";
    document.getElementById("fm-save").disabled    = true;

    try {
      // Upload new image
      const upRes = await fetch("https://e7-chart.vercel.app/api/upload-image", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ data: croppedData, folder, filename: finalFilename }),
      });
      const upJson = await upRes.json();
      if (!upRes.ok) throw new Error(upJson.error || "Upload failed");

      // Delete pending files
      const toDelete = [...pendingDeletes]
        .filter(n => n !== finalFilename)
        .map(n => { const img = existingImages.find(i => i.name === n); return img ? { name: img.name, sha: img.sha } : null; })
        .filter(Boolean);
      if (toDelete.length > 0) {
        await fetch("https://e7-chart.vercel.app/api/repo-images", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ folder, deletes: toDelete, password: verifiedPw }),
        });
      }

      closeFileManager();
      if (_fmCallback) _fmCallback(upJson.url);
    } catch (e) {
      showErr("fm-save-err", e.message);
    } finally {
      document.getElementById("fm-save").textContent = "Save";
      document.getElementById("fm-save").disabled    = false;
    }
  });
}

function closeFileManager() {
  const el = document.getElementById("fm-overlay");
  if (el) el.style.display = "none";
  _fmCallback = null;
}

/* ═══════════════════════════════════════
   DRAFT BRIDGE
   Exposes chart heroes to Draft and
   keeps both sides in sync.
═══════════════════════════════════════ */

// Draft toggle button
document.getElementById("btn-draft-toggle").addEventListener("click", () => {
  const panel  = document.getElementById("draft-panel");
  const btn    = document.getElementById("btn-draft-toggle");
  const isOpen = panel.style.display !== "none";
  panel.style.display = isOpen ? "none" : "flex";
  btn.classList.toggle("active", !isOpen);
  // Notify Draft that it is now visible so it can re-render
  if (!isOpen) window.dispatchEvent(new CustomEvent("draftOpened"));
});

// Let Draft read the live heroes array
Object.defineProperty(window, "chartHeroes", {
  get: () => heroes,
  set: (val) => { heroes = val; saveLocal(); renderAll(); },
});

// Fired by app.js saveLocal — lets Draft know the roster changed
const _origSaveLocal = saveLocal;
saveLocal = function () {
  _origSaveLocal();
  window.dispatchEvent(new CustomEvent("chartHeroesUpdated"));
};
