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

/* ── Chart display options ── */
let labelsVisible  = true;   // show hero name labels
let spreadEnabled  = false;  // nudge overlapping icons apart
let focusEnabled   = false;  // dim non-selected heroes
let highlightedId  = null;   // roster-click green highlight

/* ── Visibility modal filter state ── */
let visFilterRarity  = new Set(["5ml","5r","4","3"]);
let visFilterElement = new Set(["Fire","Ice","Earth","Light","Dark",""]);
let visFilterRole    = new Set(["Warrior","Knight","Thief","Ranger","Mage","Soul Weaver",""]);

/* ── Admin gate ── */
let pendingAdminAction = null; // "save" | "load" | "edit-hero" | "add-hero"

/* ── Edit session: once unlocked, editing stays open for the session ── */
let editSessionUnlocked = false;

/* ── Admin password session cache ──
   We deliberately do NOT let the browser's native password manager
   remember this field (it's an admin key, not a login) — see the
   admin-password input in index.html, which uses a masked text field
   instead of type="password" so Chrome never offers to save it.
   Instead, once the password is verified successfully, we cache it in
   sessionStorage so it's remembered for the rest of this browser tab's
   session (cleared automatically when the tab/browser is closed) and
   reused automatically without prompting again. ── */
const ADMIN_PW_KEY = "e7_admin_pw";
function getCachedAdminPassword() {
  try { return sessionStorage.getItem(ADMIN_PW_KEY) || null; } catch { return null; }
}
function setCachedAdminPassword(pw) {
  try { sessionStorage.setItem(ADMIN_PW_KEY, pw); } catch { /* storage unavailable — just skip caching */ }
}
function clearCachedAdminPassword() {
  try { sessionStorage.removeItem(ADMIN_PW_KEY); } catch { /* ignore */ }
}

/* ── Hero Details modal ── */
let detailsHeroId = null; // which hero's details panel is open

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

  // If an admin password was already verified earlier this browser session,
  // stay unlocked (persists across page refreshes until the tab is closed).
  if (getCachedAdminPassword()) editSessionUnlocked = true;

  // Auto-load from server for ALL visitors on page open (no password needed)
  autoLoadFromServer();

  // Double-click the brand emblem to reveal admin controls (Save/Load/Add Hero)
  document.querySelector(".brand-emblem").addEventListener("dblclick", () => {
    const ctrl = document.getElementById("admin-controls");
    const isVisible = ctrl.style.display !== "none";
    ctrl.style.display = isVisible ? "none" : "flex";
  });

  document.getElementById("btn-add").addEventListener("click", () => {
    if (editSessionUnlocked) {
      openAddModal();
    } else {
      openAdminGate("add-hero");
    }
  });

  // Hero details overlay
  document.getElementById("details-overlay").addEventListener("click", e => {
    if (e.target === document.getElementById("details-overlay")) closeHeroDetails();
  });
  document.getElementById("det-close").addEventListener("click", closeHeroDetails);
  document.getElementById("det-edit-btn").addEventListener("click", () => {
    if (editSessionUnlocked) {
      const h = heroes.find(x => x.id === detailsHeroId);
      if (h) { closeHeroDetails(); openEditModal(h); }
    } else {
      openAdminGate("edit-hero");
    }
  });
  document.getElementById("det-delete-btn").addEventListener("click", () => {
    if (!editSessionUnlocked) { openAdminGate("edit-hero"); return; }
    if (detailsHeroId !== null && confirm("Delete this hero? This cannot be undone.")) {
      deleteHero(detailsHeroId);
      closeHeroDetails();
    }
  });
  document.getElementById("btn-save").addEventListener("click", () => openAdminGate("save"));
  document.getElementById("btn-load").addEventListener("click", () => openAdminGate("load"));
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("modal-overlay").addEventListener("click", e => { if (e.target === overlay) closeModal(); });
  modalConfirm.addEventListener("click", onModalConfirm);
  modalDelete.addEventListener("click", onModalDelete);

  // Stat comparison popup
  document.getElementById("btn-compare-v").addEventListener("click", () => openStatCompare("v"));
  document.getElementById("btn-compare-h").addEventListener("click", () => openStatCompare("h"));
  document.getElementById("compare-close").addEventListener("click", closeStatCompare);
  document.getElementById("compare-overlay").addEventListener("click", e => {
    if (e.target === document.getElementById("compare-overlay")) closeStatCompare();
  });

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

  // Alt stats toggle
  document.getElementById("f-alt-enabled").addEventListener("change", e => {
    document.getElementById("alt-stats-inputs").style.display = e.target.checked ? "block" : "none";
  });

  const editorBox = document.getElementById("img-editor-box");
  editorBox.addEventListener("pointerdown", editorPanStart);
  editorBox.addEventListener("pointermove", editorPanMove);
  editorBox.addEventListener("pointerup",   editorPanEnd);
  editorBox.addEventListener("pointercancel", editorPanEnd);

  // Snap toggle (now in chart options bar)
  document.getElementById("btn-snap-toggle").addEventListener("click", () => {
    snapEnabled = !snapEnabled;
    const btn = document.getElementById("btn-snap-toggle");
    btn.classList.toggle("active", snapEnabled);
    btn.title = snapEnabled ? "Grid Snap: ON" : "Grid Snap: OFF";
  });

  // Filter toggle with active indicator
  document.getElementById("btn-filter-toggle").addEventListener("click", () => {
    const fp = document.getElementById("filter-panel");
    const isOpen = fp.style.display !== "none";
    fp.style.display = isOpen ? "none" : "block";
    document.getElementById("btn-filter-toggle").classList.toggle("filter-active", !isOpen);
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

  // ── Chart option buttons ──
  document.getElementById("btn-label-toggle").addEventListener("click", () => {
    labelsVisible = !labelsVisible;
    document.getElementById("btn-label-toggle").classList.toggle("active", !labelsVisible);
    renderChart();
  });

  document.getElementById("btn-spread-toggle").addEventListener("click", () => {
    spreadEnabled = !spreadEnabled;
    document.getElementById("btn-spread-toggle").classList.toggle("active", spreadEnabled);
    renderChart();
  });

  document.getElementById("btn-focus-toggle").addEventListener("click", () => {
    focusEnabled = !focusEnabled;
    document.getElementById("btn-focus-toggle").classList.toggle("active", focusEnabled);
    renderChart();
  });

  // ── Vis modal filter chips ──
  function wireVisChipGroup(containerId, filterSet) {
    document.getElementById(containerId).addEventListener("click", e => {
      const btn = e.target.closest(".vis-chip");
      if (!btn) return;
      const val = btn.dataset.val;
      if (filterSet.has(val)) {
        if (filterSet.size === 1) return;
        filterSet.delete(val);
        btn.classList.remove("active");
      } else {
        filterSet.add(val);
        btn.classList.add("active");
      }
      renderVisibilityPanel();
    });
  }
  wireVisChipGroup("vis-filter-rarity",  visFilterRarity);
  wireVisChipGroup("vis-filter-element", visFilterElement);
  wireVisChipGroup("vis-filter-role",    visFilterRole);

  // Chip toggle — one handler per group
  function wireChipGroup(containerId, filterSet) {
    document.getElementById(containerId).addEventListener("click", e => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      const val = btn.dataset.val;
      if (filterSet.has(val)) {
        // Don't allow deselecting the last active chip
        if (filterSet.size === 1) return;
        filterSet.delete(val);
        btn.classList.remove("active");
      } else {
        filterSet.add(val);
        btn.classList.add("active");
      }
      renderRoster();
    });
  }
  wireChipGroup("filter-rarity",  filterRarity);
  wireChipGroup("filter-role",    filterRole);
  wireChipGroup("filter-element", filterElement);
})();

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

  // Apply vis modal filters
  const filtered = heroes.filter(h => {
    const nameMatch    = !search || (h.name||"").toLowerCase().includes(search);
    const rarityMatch  = visFilterRarity.has(h.rarity || "");
    const elemMatch    = visFilterElement.has(h.element || "");
    const roleMatch    = visFilterRole.has(h.role || "");
    return nameMatch && rarityMatch && elemMatch && roleMatch;
  });

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

/* ── Spread: compute nudged positions to reduce icon overlap ── */
function computeSpreadPositions(visibleHeroes) {
  // Dynamic radius: base icon size as % of chart width
  const chartEl = document.getElementById("chart");
  const chartW  = chartEl ? chartEl.getBoundingClientRect().width : 600;
  const iconSize = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--icon-size")) || 38;
  const ICON_PCT = (iconSize / chartW) * 100 * 1.1; // 10% buffer

  const positions = visibleHeroes.map(h => ({ id: h.id, x: h._x, y: h._y }));
  const ITERS = 40;
  for (let iter = 0; iter < ITERS; iter++) {
    for (let i = 0; i < positions.length; i++) {
      let fx = 0, fy = 0;
      for (let j = 0; j < positions.length; j++) {
        if (i === j) continue;
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        const dist = Math.sqrt(dx*dx + dy*dy) || 0.001;
        if (dist < ICON_PCT) {
          const force = (ICON_PCT - dist) / ICON_PCT;
          fx += (dx / dist) * force * 1.1;
          fy += (dy / dist) * force * 1.1;
        }
      }
      positions[i].x = Math.max(2, Math.min(98, positions[i].x + fx));
      positions[i].y = Math.max(2, Math.min(98, positions[i].y + fy));
    }
  }
  return positions;
}

/* ── Detect overlaps for stack badges (when spread is off) ── */
function computeStackCounts(visibleHeroes) {
  const chartEl = document.getElementById("chart");
  const chartW  = chartEl ? chartEl.getBoundingClientRect().width : 600;
  const iconSize = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--icon-size")) || 38;
  const THRESHOLD = (iconSize / chartW) * 100 * 0.8;

  const counts = {}; // id → number of heroes stacked on top of/under this one
  const topOf  = {}; // cluster representative id → total count

  for (let i = 0; i < visibleHeroes.length; i++) {
    for (let j = i + 1; j < visibleHeroes.length; j++) {
      const a = visibleHeroes[i], b = visibleHeroes[j];
      const dx = a._x - b._x, dy = a._y - b._y;
      if (Math.sqrt(dx*dx + dy*dy) < THRESHOLD) {
        counts[a.id] = (counts[a.id] || 1) + 1;
        counts[b.id] = (counts[b.id] || 1) + 1;
      }
    }
  }
  return counts;
}

function renderChart() {
  document.querySelectorAll(".hero-dot").forEach(el => el.remove());

  const chartDots = [];

  // Apply label visibility to body
  document.body.classList.toggle("hide-labels", !labelsVisible);

  const visibleHeroes = heroes.filter(h => !h.hidden);

  // Compute positions (spread or raw) — primary positions only
  let posMap = {};
  if (spreadEnabled && visibleHeroes.length > 0) {
    visibleHeroes.forEach(h => {
      const { x, y } = scoresToXY(h.vType || "SPD", h.vScore || 0, h.hType || "SUR", h.hScore || 0);
      h._x = x; h._y = y;
    });
    const spread = computeSpreadPositions(visibleHeroes);
    spread.forEach(p => { posMap[p.id] = { x: p.x, y: p.y }; });
  }

  // Compute stack counts when spread is off
  const stackCounts = spreadEnabled ? {} : computeStackCounts(visibleHeroes);

  heroes.forEach(h => {
    if (h.hidden) return;
    const { x: rawX, y: rawY } = scoresToXY(h.vType || "SPD", h.vScore || 0, h.hType || "SUR", h.hScore || 0);
    h._x = rawX; h._y = rawY;

    const pos = spreadEnabled && posMap[h.id] ? posMap[h.id] : { x: rawX, y: rawY };

    const isHighlighted = h.id === highlightedId;
    const isSelected    = h.id === selectedId;
    const isDimmed      = focusEnabled && highlightedId !== null && !isHighlighted;

    // Primary dot
    const dot = buildHeroDot(h, pos, { isHighlighted, isSelected, isDimmed, isGhost: false });
    const scores = xyToScores(rawX, rawY);
    dot.title = scores.vType + " " + scores.vScore + " | " + scores.hType + " " + scores.hScore + " | Avg " + avgScore(scores.vScore, scores.hScore);

    // Stack badge — only on selected icon, lives on dot (not clipped by inner circle)
    if (!spreadEnabled && stackCounts[h.id] && stackCounts[h.id] > 1 && isSelected) {
      const badge = document.createElement("div");
      badge.className = "hero-dot-stack-badge";
      badge.textContent = "x" + stackCounts[h.id];
      dot.appendChild(badge);
    }

    dot._isHighlighted = isHighlighted;
    dot._isGhost = false;
    chartDots.push(dot);

    // Ghost dot (secondary / alt stats)
    if (h.altStats) {
      const { x: altRawX, y: altRawY } = scoresToXY(
        h.altStats.vType || "SPD", h.altStats.vScore || 0,
        h.altStats.hType || "SUR", h.altStats.hScore || 0
      );
      const ghostDot = buildHeroDot(h, { x: altRawX, y: altRawY }, { isHighlighted, isSelected, isDimmed, isGhost: true });
      const altScores = xyToScores(altRawX, altRawY);
      ghostDot.title = "Ghost: " + altScores.vType + " " + altScores.vScore + " | " + altScores.hType + " " + altScores.hScore + " | Avg " + avgScore(altScores.vScore, altScores.hScore);
      ghostDot._isHighlighted = isHighlighted;
      ghostDot._isGhost = true;
      chartDots.push(ghostDot);
    }
  });

  // Paint order: ghosts behind primaries; highlighted on top
  chartDots.filter(d => !d._isHighlighted &&  d._isGhost).forEach(d => chart.appendChild(d));
  chartDots.filter(d => !d._isHighlighted && !d._isGhost).forEach(d => chart.appendChild(d));
  chartDots.filter(d =>  d._isHighlighted &&  d._isGhost).forEach(d => chart.appendChild(d));
  chartDots.filter(d =>  d._isHighlighted && !d._isGhost).forEach(d => chart.appendChild(d));
}

/* Builds one hero dot element — primary or ghost */
function buildHeroDot(h, pos, { isHighlighted, isSelected, isDimmed, isGhost }) {
  let cls = "hero-dot";
  if (isSelected)    cls += " selected";
  if (isHighlighted) cls += " highlighted";
  if (isDimmed)      cls += " dimmed";
  if (isGhost)       cls += " ghost";

  const dot = document.createElement("div");
  dot.className = cls;
  dot.dataset.id = h.id;
  if (isGhost) dot.dataset.ghost = "true";
  dot.style.left   = pos.x + "%";
  dot.style.top    = pos.y + "%";
  dot.style.zIndex = isHighlighted ? "30" : (isGhost ? "9" : "");

  const meta = RARITY_META[h.rarity] || RARITY_META["5r"];
  const inner = document.createElement("div");
  inner.className = "hero-dot-inner" + (isGhost ? " ghost-inner" : "");

  if (isGhost) {
    inner.style.borderColor = "#e040fb";
    inner.style.boxShadow = isSelected
      ? "0 0 0 3px rgba(224,64,251,.45), 0 0 24px rgba(224,64,251,.9)"
      : "0 0 12px rgba(224,64,251,.55)";
  } else if (isHighlighted) {
    inner.style.borderColor = "#4caf50";
    inner.style.boxShadow   = "0 0 0 3px rgba(76,175,80,.35), 0 0 22px rgba(76,175,80,.6)";
  } else {
    inner.style.borderColor = meta.border;
    inner.style.boxShadow   = "0 0 10px " + meta.border + "66";
  }

  if (h.iconData) {
    const img = document.createElement("img");
    img.src = h.iconData;
    img.style.cssText = "width:100%;height:100%;border-radius:50%;object-fit:cover;";
    inner.appendChild(img);
  } else {
    inner.textContent = "⚔️";
  }

  // Magenta tint overlay for ghost
  if (isGhost) {
    const ov = document.createElement("div");
    ov.className = "ghost-overlay";
    inner.appendChild(ov);
  }

  const label = document.createElement("div");
  label.className = "hero-dot-label" + (isGhost ? " ghost-label" : "");
  label.textContent = isGhost ? "👻 " + (h.name || "Hero") : (h.name || "Hero");

  dot.appendChild(inner);
  dot.appendChild(label);

  // Drag — primary only, ghost is not draggable
  if (!isGhost) {
    const { x: rawX, y: rawY } = scoresToXY(h.vType || "SPD", h.vScore || 0, h.hType || "SUR", h.hScore || 0);
    dot.addEventListener("pointerdown", e => {
      if (h.locked) return;
      e.stopPropagation();
      setSelected(h.id);
      const rect = chart.getBoundingClientRect();
      dragOffX = e.clientX - rect.left - (rawX / 100) * rect.width;
      dragOffY = e.clientY - rect.top  - (rawY / 100) * rect.height;
      dragging = h.id;
      dot.setPointerCapture(e.pointerId);
    });
  }

  dot.addEventListener("click", e => {
    e.stopPropagation();
    if (selectedId === h.id) openHeroDetails(h);
    else setSelected(h.id);
  });

  return dot;
}

function renderRoster() {
  document.querySelectorAll(".hero-card").forEach(el => el.remove());

  // Sort
  let list = [...heroes];
  if (rosterSort === "az")        list.sort((a,b) => (a.name||"").localeCompare(b.name||""));
  else if (rosterSort === "za")   list.sort((a,b) => (b.name||"").localeCompare(a.name||""));
  else if (rosterSort === "date-asc")  list.sort((a,b) => a.id - b.id);
  else                                 list.sort((a,b) => b.id - a.id);

  // Filter — role/element use exact value; "" matches unassigned heroes via "None" chip
  list = list.filter(h =>
    filterRarity.has(h.rarity) &&
    filterRole.has(h.role ?? "") &&
    filterElement.has(h.element ?? "")
  );

  emptyMsg.style.display = list.length === 0 ? "block" : "none";

  list.forEach(h => {
    const meta = RARITY_META[h.rarity] || RARITY_META["5r"];
    const scores = xyToScores(h._x ?? 50, h._y ?? 50);
    const avg    = avgScore(scores.vScore, scores.hScore);

    const card = document.createElement("div");
    const isHL = h.id === highlightedId;
    card.className = "hero-card" + (h.id === selectedId ? " selected" : "") + (isHL ? " highlighted" : "");
    if (isHL) card.style.borderColor = "#4caf50";
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
          <div class="scores-row">
            <span class="score-badge">${scores.vType} ${scores.vScore}</span>
            <span class="score-badge">${scores.hType} ${scores.hScore}</span>
            <span class="score-badge avg">Avg ${avg}</span>
          </div>
          ${h.altStats ? `
          <div class="scores-row">
            <span class="score-badge alt-v">👻 ${h.altStats.vType} ${h.altStats.vScore}</span>
            <span class="score-badge alt-h">${h.altStats.hType} ${h.altStats.hScore}</span>
            <span class="score-badge alt-avg">Avg ${avgScore(h.altStats.vScore, h.altStats.hScore)}</span>
          </div>
          <div class="scores-row scores-row-total">
            <span class="score-badge total-avg">Total Avg ${+((Number(h.vScore||0) + Number(h.hScore||0) + Number(h.altStats.vScore) + Number(h.altStats.hScore)) / 4).toFixed(1)}</span>
          </div>` : ""}
        </div>
      </div>
      <div class="hero-card-actions">
        <button class="icon-btn btn-view" title="Hero Details">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>`;

    card.querySelector(".btn-view").addEventListener("click", e => { e.stopPropagation(); openHeroDetails(h); });
    card.addEventListener("click", () => setHighlighted(h.id));

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

/* Called when a roster card is clicked — highlights on chart with green ring */
function setHighlighted(id) {
  // Toggle off if clicking the same hero
  highlightedId = (highlightedId === id) ? null : id;
  selectedId    = highlightedId; // also select it so chart dot gets focus
  renderAll();
  if (highlightedId) {
    const card = document.querySelector(`.hero-card[data-id="${highlightedId}"]`);
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
  fIconData.value = dataURL;
  updateIconPreview(dataURL);
  document.getElementById("img-editor-wrap").style.display = "none";
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
   HERO DETAILS (read-only view)
═══════════════════════════════════════ */
function openHeroDetails(h) {
  detailsHeroId = h.id;
  const overlay = document.getElementById("details-overlay");
  const meta = RARITY_META[h.rarity] || RARITY_META["5r"];
  const vStr = `${h.vType || "SPD"} ${h.vScore !== undefined ? h.vScore : 0}`;
  const hStr = `${h.hType || "SUR"} ${h.hScore !== undefined ? h.hScore : 0}`;
  const avg  = avgScore(h.vScore || 0, h.hScore || 0);

  // Chart section
  const iconHTML = h.iconData
    ? `<img src="${h.iconData}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid ${meta.border};box-shadow:0 0 14px ${meta.border}55"/>`
    : `<div style="width:64px;height:64px;border-radius:50%;background:#0b1a2e;border:2px solid ${meta.border};display:flex;align-items:center;justify-content:center;font-size:28px">⚔️</div>`;

  const roleEl    = h.role    ? `<span class="det-tag det-tag-role">${h.role}</span>` : `<span class="det-tag det-tag-none">— None —</span>`;
  const elementEl = h.element ? `<span class="det-tag det-tag-elem">${h.element}</span>` : `<span class="det-tag det-tag-none">— None —</span>`;

  document.getElementById("det-chart-body").innerHTML = `
    <div class="det-hero-header">
      <div class="det-icon-wrap">${iconHTML}</div>
      <div class="det-hero-meta">
        <div class="det-hero-name">${h.name || "Unnamed Hero"}</div>
        <div class="det-hero-rarity" style="color:${meta.color}">${meta.label}</div>
      </div>
    </div>
    <div class="det-grid">
      <div class="det-field"><div class="det-field-label">NAME</div><div class="det-field-value">${h.name || "—"}</div></div>
      <div class="det-field"><div class="det-field-label">RARITY</div><div class="det-field-value" style="color:${meta.color}">${meta.label}</div></div>
      <div class="det-field"><div class="det-field-label">ROLE</div><div class="det-field-value">${roleEl}</div></div>
      <div class="det-field"><div class="det-field-label">ELEMENT</div><div class="det-field-value">${elementEl}</div></div>
      <div class="det-field"><div class="det-field-label">VERTICAL</div><div class="det-field-value"><span class="det-score-pill">${vStr}</span></div></div>
      <div class="det-field"><div class="det-field-label">HORIZONTAL</div><div class="det-field-value"><span class="det-score-pill">${hStr}</span></div></div>
      <div class="det-field det-field-full"><div class="det-field-label">NOTES</div><div class="det-field-value det-notes">${h.notes || '<span style="opacity:.45;font-style:italic">No notes.</span>'}</div></div>
    </div>
    ${h.altStats ? `
    <div style="margin-top:14px;padding:10px 12px;background:rgba(224,64,251,.07);border:1px solid rgba(224,64,251,.25);border-radius:5px;">
      <div style="font-family:'Cinzel',serif;font-size:9px;letter-spacing:.2em;color:#e040fb;margin-bottom:8px;">👻 SECONDARY STATS (GHOST)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div class="det-field"><div class="det-field-label">VERTICAL</div><div class="det-field-value"><span class="det-score-pill" style="border-color:rgba(224,64,251,.4);color:#e040fb;background:rgba(224,64,251,.1)">${h.altStats.vType} ${h.altStats.vScore}</span></div></div>
        <div class="det-field"><div class="det-field-label">HORIZONTAL</div><div class="det-field-value"><span class="det-score-pill" style="border-color:rgba(224,64,251,.4);color:#e040fb;background:rgba(224,64,251,.1)">${h.altStats.hType} ${h.altStats.hScore}</span></div></div>
        <div class="det-field"><div class="det-field-label">GHOST AVG</div><div class="det-field-value"><span class="det-score-pill" style="border-color:rgba(224,64,251,.4);color:#e040fb;background:rgba(224,64,251,.1)">${avgScore(h.altStats.vScore, h.altStats.hScore)}</span></div></div>
        <div class="det-field" style="border-color:rgba(224,64,251,.3);background:rgba(224,64,251,.06)"><div class="det-field-label" style="color:#e040fb">TOTAL AVG</div><div class="det-field-value"><span class="det-score-pill" style="border-color:rgba(224,64,251,.5);color:#f0a0ff;background:rgba(224,64,251,.18);font-size:13px">${+((Number(h.vScore||0) + Number(h.hScore||0) + Number(h.altStats.vScore) + Number(h.altStats.hScore)) / 4).toFixed(1)}</span></div></div>
      </div>
    </div>` : ""}
  `;

  // Draft section — fetch draft-enriched data from window.chartHeroes
  const liveHero = (window.chartHeroes || heroes).find(x => x.id === h.id) || h;
  renderDetailsDraft(liveHero);

  overlay.classList.add("open");
}

function renderDetailsDraft(h) {
  // We need to access draft data. It's stored in localStorage.
  let dd = { buffs:[], debuffs:[], strengths:[], weaknesses:[], roles:[], uniqueRoles:[] };
  try {
    const raw = localStorage.getItem("e7draft_data");
    if (raw) dd = JSON.parse(raw);
  } catch {}

  const dClass   = h.dClass || "KN";
  const dElement = h.dElement || h.element || "fire";
  const dNote    = h.dNote || "";

  const CL_META_L = { KN:"Knight", WA:"Warrior", MG:"Mage", RG:"Ranger", SW:"Soul Weaver", TH:"Thief" };
  const EL_META_L = { fire:"🔥 Fire", water:"💧 Water", earth:"🌿 Earth", light:"☀️ Light", dark:"💀 Dark" };
  const EL_COLOR  = { fire:"#b84830", water:"#2e82b8", earth:"#488040", light:"#b89820", dark:"#6838a8" };
  const RC_L = { Opener:"#c8a020", Tank:"#2868b0", Bruiser:"#5848a8", DPS:"#b03820", Healer:"#287850", Buffer:"#208888", Debuffer:"#a82860", Cleanser:"#5890a8", Reviver:"#60a040", Counter:"#a87020" };
  const DEFAULT_ROLES_L = ["Opener","Tank","Bruiser","DPS","Healer","Buffer","Debuffer","Cleanser","Reviver","Counter"];

  function pillsHTML(ids, pool, colorKey, defaultColor) {
    if (!ids || ids.length === 0) return `<span style="opacity:.4;font-style:italic;font-size:12px">None assigned</span>`;
    return ids.map(id => {
      const item = pool.find(x => x.id === id || x.name === id);
      const name = item ? (item.name || id) : id;
      const color = item ? (item[colorKey] || defaultColor) : defaultColor;
      return `<span class="det-pill" style="background:${color}22;color:${color};border:1px solid ${color}44">${name}</span>`;
    }).join("");
  }

  function heroPillsHTML(ids) {
    const allH = window.chartHeroes || heroes;
    if (!ids || ids.length === 0) return `<span style="opacity:.4;font-style:italic;font-size:12px">None</span>`;
    return ids.map(id => {
      const hero = allH.find(x => x.id === id);
      return hero ? `<span class="det-pill" style="background:#1a3050;color:#dce8f5">${hero.name || "Unnamed"}</span>` : null;
    }).filter(Boolean).join("") || `<span style="opacity:.4;font-style:italic;font-size:12px">None</span>`;
  }

  // Build roles display
  const allRoles = [
    ...DEFAULT_ROLES_L.map(name => ({ id: name, name, color: RC_L[name] || "#888" })),
    ...(dd.roles || []).filter(r => r.name && !DEFAULT_ROLES_L.includes(r.name)),
  ];
  const dRolesHTML = pillsHTML(h.dRoles, allRoles, "color", "#c9a227");

  document.getElementById("det-draft-body").innerHTML = `
    <div class="det-grid">
      <div class="det-field"><div class="det-field-label">DRAFT NOTE</div><div class="det-field-value">${dNote || '<span style="opacity:.45;font-style:italic">None</span>'}</div></div>
      <div class="det-field"><div class="det-field-label">CLASS</div><div class="det-field-value">${CL_META_L[dClass] || dClass}</div></div>
      <div class="det-field"><div class="det-field-label">ELEMENT</div><div class="det-field-value" style="color:${EL_COLOR[dElement]||"#dce8f5"}">${EL_META_L[dElement] || dElement}</div></div>
      <div class="det-field det-field-full"><div class="det-field-label">DRAFT ROLES</div><div class="det-field-value det-pills-wrap">${dRolesHTML}</div></div>
      <div class="det-field det-field-full"><div class="det-field-label">BUFFS</div><div class="det-field-value det-pills-wrap">${pillsHTML(h.buffs, dd.buffs || [], "color", "#208888")}</div></div>
      <div class="det-field det-field-full"><div class="det-field-label">DEBUFFS</div><div class="det-field-value det-pills-wrap">${pillsHTML(h.debuffs, dd.debuffs || [], "color", "#a82860")}</div></div>
      <div class="det-field det-field-full"><div class="det-field-label">STRENGTHS</div><div class="det-field-value det-pills-wrap">${pillsHTML(h.strengths, dd.strengths || [], "color", "#3a7a50")}</div></div>
      <div class="det-field det-field-full"><div class="det-field-label">WEAKNESSES</div><div class="det-field-value det-pills-wrap">${pillsHTML(h.weaknesses, dd.weaknesses || [], "color", "#7a3030")}</div></div>
      <div class="det-field det-field-full"><div class="det-field-label">SYNERGIZES WITH</div><div class="det-field-value det-pills-wrap">${heroPillsHTML(h.synergies)}</div></div>
      <div class="det-field det-field-full"><div class="det-field-label">STRONG AGAINST</div><div class="det-field-value det-pills-wrap">${heroPillsHTML(h.strongAgainst)}</div></div>
      <div class="det-field det-field-full"><div class="det-field-label">COUNTERED BY</div><div class="det-field-value det-pills-wrap">${heroPillsHTML(h.counters)}</div></div>
    </div>
  `;
}

function closeHeroDetails() {
  document.getElementById("details-overlay").classList.remove("open");
  detailsHeroId = null;
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
  document.getElementById("f-alt-enabled").checked = false;
  document.getElementById("alt-stats-inputs").style.display = "none";
  document.getElementById("f-alt-v-type").value  = "SPD";
  document.getElementById("f-alt-v-score").value = "0";
  document.getElementById("f-alt-h-type").value  = "SUR";
  document.getElementById("f-alt-h-score").value = "0";
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
  // Alt stats
  const hasAlt = !!(h.altStats);
  document.getElementById("f-alt-enabled").checked = hasAlt;
  document.getElementById("alt-stats-inputs").style.display = hasAlt ? "block" : "none";
  document.getElementById("f-alt-v-type").value  = h.altStats?.vType  || "SPD";
  document.getElementById("f-alt-v-score").value = h.altStats?.vScore !== undefined ? h.altStats.vScore : 0;
  document.getElementById("f-alt-h-type").value  = h.altStats?.hType  || "SUR";
  document.getElementById("f-alt-h-score").value = h.altStats?.hScore !== undefined ? h.altStats.hScore : 0;
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

  // Alt / ghost stats
  const altEnabled = document.getElementById("f-alt-enabled").checked;
  const altStats = altEnabled ? {
    vType:  document.getElementById("f-alt-v-type").value,
    vScore: Math.max(0, Math.min(10, parseFloat(document.getElementById("f-alt-v-score").value) || 0)),
    hType:  document.getElementById("f-alt-h-type").value,
    hScore: Math.max(0, Math.min(10, parseFloat(document.getElementById("f-alt-h-score").value) || 0)),
  } : null;

  if (editingId !== null) {
    heroes = heroes.map(h => h.id === editingId
      ? { ...h, name, rarity, role, element, vType, vScore, hType, hScore, notes, iconData, locked, altStats }
      : h
    );
  } else {
    heroes.push({
      id: Date.now(),
      name, rarity, role, element, vType, vScore, hType, hScore, notes, iconData,
      locked, altStats,
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
   STAT COMPARISON POPUP
   Shows the closest hero(es) below and above
   the value currently entered in the form,
   plus any heroes with the exact same value.
═══════════════════════════════════════ */
function normScore(v) {
  // Round to 1 decimal to avoid floating-point equality issues (step is 0.1)
  return Math.round((Number(v) || 0) * 10) / 10;
}

function openStatCompare(axis) {
  const type   = (axis === "v" ? fVType : fHType).value;
  const target = normScore((axis === "v" ? fVScore : fHScore).value);

  // Compare against every other hero using the same stat type on this axis
  // (e.g. only other SPD heroes when the current axis is set to SPD).
  // The hero currently being edited is excluded from its own comparison.
  const pool = heroes.filter(h =>
    h.id !== editingId && (axis === "v" ? h.vType : h.hType) === type
  );
  const scoreOf = h => normScore(axis === "v" ? h.vScore : h.hScore);

  const same = pool.filter(h => scoreOf(h) === target);

  const belowScores = pool.filter(h => scoreOf(h) < target).map(scoreOf);
  const aboveScores = pool.filter(h => scoreOf(h) > target).map(scoreOf);
  const belowVal = belowScores.length ? Math.max(...belowScores) : null;
  const aboveVal = aboveScores.length ? Math.min(...aboveScores) : null;
  const below = belowVal !== null ? pool.filter(h => scoreOf(h) === belowVal) : [];
  const above = aboveVal !== null ? pool.filter(h => scoreOf(h) === aboveVal) : [];

  document.getElementById("compare-title").textContent = `${type} COMPARISON`;
  document.getElementById("compare-body").innerHTML = `
    <div class="compare-target">
      <div class="compare-target-label">Your Selected Value</div>
      <div class="compare-target-value">${type} ${target.toFixed(1)}</div>
    </div>
    ${compareSectionHTML("Closest Below", "below", belowVal, below, axis, "No hero found below this value — you may be at the low extreme.")}
    ${compareSectionHTML("Same Value", "same", target, same, axis, "No other hero shares this exact value.")}
    ${compareSectionHTML("Closest Above", "above", aboveVal, above, axis, "No hero found above this value — you may be at the high extreme.")}
  `;
  document.getElementById("compare-overlay").classList.add("open");
}

function compareSectionHTML(label, cls, val, list, axis, emptyMsg) {
  const valTag = (val !== null && val !== undefined)
    ? `<span class="compare-val-tag" style="background:${sectionColor(cls)};color:var(--bg)">${val.toFixed(1)}</span>`
    : "";
  const inner = list.length
    ? `<div class="compare-grid">${list.map(h => compareCardHTML(h, axis)).join("")}</div>`
    : `<div class="compare-empty">${emptyMsg}</div>`;
  return `
    <div class="compare-section">
      <div class="compare-section-label ${cls}">${label} ${valTag}</div>
      ${inner}
    </div>`;
}

function sectionColor(cls) {
  return cls === "below" ? "#4fc3f7" : cls === "above" ? "#ef9a9a" : "#81c784";
}

function compareCardHTML(h, axis) {
  const meta  = RARITY_META[h.rarity] || RARITY_META["5r"];
  const type  = axis === "v" ? h.vType : h.hType;
  const score = normScore(axis === "v" ? h.vScore : h.hScore).toFixed(1);
  const iconHTML = h.iconData
    ? `<div class="compare-card-icon"><img src="${h.iconData}"></div>`
    : `<div class="compare-card-icon"><div class="compare-card-icon-fallback">⚔️</div></div>`;
  return `
    <div class="compare-card">
      ${iconHTML}
      <div class="compare-card-info">
        <div class="compare-card-name">${h.name || "Unnamed Hero"}</div>
        <div class="compare-card-score" style="color:${meta.color}">${meta.label} · ${type} ${score}</div>
      </div>
    </div>`;
}

function closeStatCompare() {
  document.getElementById("compare-overlay").classList.remove("open");
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

  // Reuse the password already verified earlier this session, if we have
  // one cached — skips the prompt entirely instead of asking again.
  const cachedPw = getCachedAdminPassword();
  if (cachedPw) {
    if (action === "save") { saveToServer(cachedPw); return; }
    if (action === "load") { loadFromServer(cachedPw); return; }
    if (action === "add-hero") { editSessionUnlocked = true; openAddModal(); return; }
    if (action === "edit-hero") {
      editSessionUnlocked = true;
      if (detailsHeroId !== null) {
        const h = heroes.find(x => x.id === detailsHeroId);
        if (h) { closeHeroDetails(); openEditModal(h); }
      }
      return;
    }
  }

  const label = action === "save" ? "save" : action === "load" ? "load" : action === "add-hero" ? "add a hero" : "edit this hero";
  document.getElementById("admin-action-label").textContent = label;
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
  // For edit/add actions, verify password via a lightweight server ping
  if (pendingAdminAction === "edit-hero" || pendingAdminAction === "add-hero") {
    // Attempt a lightweight verification
    try {
      const res = await fetch("https://e7-chart.vercel.app/api/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw, verifyOnly: true }),
      });
      if (!res.ok) {
        // Try save endpoint as alternative check
        const res2 = await fetch("https://e7-chart.vercel.app/api/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ heroes, password: pw, verifyOnly: true }),
        });
        if (!res2.ok) {
          showAdminError("Wrong password.");
          return;
        }
      }
    } catch {
      // If network fails, we trust locally — session continues
    }
    editSessionUnlocked = true;
    setCachedAdminPassword(pw);
    closeAdminGate();
    if (pendingAdminAction === "edit-hero" && detailsHeroId !== null) {
      const h = heroes.find(x => x.id === detailsHeroId);
      if (h) {
        closeHeroDetails();
        openEditModal(h);
      }
    } else if (pendingAdminAction === "add-hero") {
      openAddModal();
    }
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
// Server data is the source of truth for positions/scores, but local-only
// fields (altStats) are preserved if the server copy doesn't have them.
async function autoLoadFromServer() {
  try {
    const res = await fetch("https://e7-chart.vercel.app/api/public-load", { method: "GET" });
    if (!res.ok) return; // silently fail — local data stays
    const data = await res.json();
    if (Array.isArray(data.heroes) && data.heroes.length > 0) {
      // Build a map of local heroes so we can preserve local-only fields
      const localMap = {};
      heroes.forEach(h => { localMap[h.id] = h; });

      heroes = data.heroes.map(serverHero => {
        const local = localMap[serverHero.id];
        if (!local) return serverHero;
        // Server is authoritative for all core fields.
        // Preserve local altStats only if server copy doesn't have it.
        return {
          ...serverHero,
          altStats: serverHero.altStats ?? local.altStats ?? null,
        };
      });

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
    if (!res.ok) {
      if (res.status === 401) {
        // Cached password (or the one just typed) was rejected — forget it
        // and ask again.
        clearCachedAdminPassword();
        setStatus("❌ " + (data.error || "Wrong password"));
        openAdminGate("save");
        return;
      }
      throw new Error(data.error || "Save failed");
    }
    setCachedAdminPassword(password);
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
    if (!res.ok) {
      if (res.status === 401) {
        clearCachedAdminPassword();
        setStatus("❌ " + (data.error || "Wrong password"));
        openAdminGate("load");
        return;
      }
      throw new Error(data.error || "Load failed");
    }
    setCachedAdminPassword(password);
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
