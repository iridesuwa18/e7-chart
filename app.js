/* ═══════════════════════════════════════
   EPIC SEVEN — app.js
   All logic: heroes, drag-and-drop, modal,
   save/load via /api/save and /api/load
═══════════════════════════════════════ */

const ICONS = ["⚔️","🛡️","🏹","✨","🔥","❄️","⚡","🌿","💀","👁️","🐉","🦅","🌙","☀️","💎","🗡️","🪄","🧿","🎯","🔮","💫","🌊","🩸","🦋"];

const RARITY_META = {
  "5ml": { label: "5★ ML / Limited", color: "#e8c84a",              border: "#c9a227" },
  "5r":  { label: "5★ Regular",      color: "rgba(232,200,74,0.65)", border: "rgba(201,162,39,0.65)" },
  "4":   { label: "4★",              color: "#a88fd4",              border: "#7a60b0" },
  "3":   { label: "3★",              color: "#7a9aaa",              border: "#50707f" },
};

/* ── State ── */
let heroes     = [];
let selectedId = null;
let dragging   = null;
let dragOffX   = 0, dragOffY = 0;
let editingId  = null;   // null = adding new

/* ── DOM refs ── */
const chart        = document.getElementById("chart");
const rosterList   = document.getElementById("roster-list");
const emptyMsg     = document.getElementById("empty-msg");
const overlay      = document.getElementById("modal-overlay");
const modalTitle   = document.getElementById("modal-title");
const fName        = document.getElementById("f-name");
const fRarity      = document.getElementById("f-rarity");
const fIcon        = document.getElementById("f-icon");
const fNotes       = document.getElementById("f-notes");
const iconPicker   = document.getElementById("icon-picker");
const modalConfirm = document.getElementById("modal-confirm");
const modalDelete  = document.getElementById("modal-delete");
const saveStatus   = document.getElementById("save-status");

/* ══════════════════════════════════════
   INIT
══════════════════════════════════════ */
(function init() {
  buildIconPicker();
  loadLocal();
  renderAll();

  document.getElementById("btn-add").addEventListener("click", openAddModal);
  document.getElementById("btn-save").addEventListener("click", saveToServer);
  document.getElementById("btn-load").addEventListener("click", loadFromServer);
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("modal-overlay").addEventListener("click", e => { if (e.target === overlay) closeModal(); });
  modalConfirm.addEventListener("click", onModalConfirm);
  modalDelete.addEventListener("click", onModalDelete);

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
})();

/* ══════════════════════════════════════
   ICON PICKER
══════════════════════════════════════ */
function buildIconPicker() {
  ICONS.forEach(icon => {
    const el = document.createElement("div");
    el.className = "icon-opt";
    el.textContent = icon;
    el.addEventListener("click", () => {
      document.querySelectorAll(".icon-opt").forEach(o => o.classList.remove("picked"));
      el.classList.add("picked");
      fIcon.value = icon;
    });
    iconPicker.appendChild(el);
  });
}

function setPickedIcon(icon) {
  document.querySelectorAll(".icon-opt").forEach(o => {
    o.classList.toggle("picked", o.textContent === icon);
  });
  fIcon.value = icon;
}

/* ══════════════════════════════════════
   RENDER
══════════════════════════════════════ */
function renderAll() {
  renderChart();
  renderRoster();
}

function renderChart() {
  // Remove old hero dots
  document.querySelectorAll(".hero-dot").forEach(el => el.remove());

  heroes.forEach(h => {
    const dot = document.createElement("div");
    dot.className = "hero-dot" + (h.id === selectedId ? " selected" : "");
    dot.dataset.id = h.id;
    dot.style.left = h.x + "%";
    dot.style.top  = h.y + "%";

    const meta = RARITY_META[h.rarity] || RARITY_META["5r"];
    const inner = document.createElement("div");
    inner.className = "hero-dot-inner";
    inner.style.borderColor = meta.border;
    inner.style.boxShadow   = `0 0 10px ${meta.border}66`;
    inner.textContent = h.icon || "⚔️";

    const label = document.createElement("div");
    label.className = "hero-dot-label";
    label.textContent = h.name || "Hero";

    dot.appendChild(inner);
    dot.appendChild(label);

    // Drag
    dot.addEventListener("pointerdown", e => {
      e.stopPropagation();
      setSelected(h.id);
      const rect = chart.getBoundingClientRect();
      const hxPx = (h.x / 100) * rect.width;
      const hyPx = (h.y / 100) * rect.height;
      dragOffX = e.clientX - rect.left - hxPx;
      dragOffY = e.clientY - rect.top  - hyPx;
      dragging = h.id;
      dot.setPointerCapture(e.pointerId);
    });

    // Click to select / open edit
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
  // Remove old cards (keep empty-msg)
  document.querySelectorAll(".hero-card").forEach(el => el.remove());
  emptyMsg.style.display = heroes.length === 0 ? "block" : "none";

  heroes.forEach(h => {
    const meta = RARITY_META[h.rarity] || RARITY_META["5r"];
    const card = document.createElement("div");
    card.className = "hero-card" + (h.id === selectedId ? " selected" : "");
    card.dataset.id = h.id;
    card.innerHTML = `
      <div class="hero-card-icon">${h.icon || "⚔️"}</div>
      <div class="hero-card-info">
        <div class="hero-card-name">${h.name || "Unnamed Hero"}</div>
        <div class="hero-card-rarity" style="color:${meta.color}">${meta.label}</div>
      </div>
      <div class="hero-card-actions">
        <button class="icon-btn" title="Edit">✏️</button>
        <button class="icon-btn" title="Delete">🗑️</button>
      </div>`;

    card.addEventListener("click", e => {
      if (e.target.closest(".icon-btn[title=Edit]"))   { openEditModal(h); return; }
      if (e.target.closest(".icon-btn[title=Delete]")) { deleteHero(h.id); return; }
      setSelected(selectedId === h.id ? null : h.id);
    });

    rosterList.appendChild(card);
  });
}

/* ══════════════════════════════════════
   SELECTION
══════════════════════════════════════ */
function setSelected(id) {
  selectedId = id;
  renderAll();
  // Scroll card into view on mobile
  if (id) {
    const card = document.querySelector(`.hero-card[data-id="${id}"]`);
    if (card) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

/* ══════════════════════════════════════
   DRAG
══════════════════════════════════════ */
function onPointerMove(e) {
  if (!dragging) return;
  const rect = chart.getBoundingClientRect();
  const x = Math.max(2, Math.min(98, ((e.clientX - rect.left - dragOffX) / rect.width)  * 100));
  const y = Math.max(2, Math.min(98, ((e.clientY - rect.top  - dragOffY) / rect.height) * 100));

  const dot = chart.querySelector(`.hero-dot[data-id="${dragging}"]`);
  if (dot) { dot.style.left = x + "%"; dot.style.top = y + "%"; }

  const hero = heroes.find(h => h.id === dragging);
  if (hero) { hero.x = x; hero.y = y; }
}

function onPointerUp() {
  if (dragging) {
    dragging = null;
    saveLocal();
    renderRoster(); // refresh roster in case anything changed
  }
}

/* ══════════════════════════════════════
   MODAL
══════════════════════════════════════ */
function openAddModal() {
  editingId = null;
  modalTitle.textContent = "ADD HERO";
  modalConfirm.textContent = "Add to Chart";
  modalDelete.style.display = "none";
  fName.value = "";
  fRarity.value = "5ml";
  fNotes.value = "";
  setPickedIcon(ICONS[0]);
  overlay.classList.add("open");
  fName.focus();
}

function openEditModal(h) {
  editingId = h.id;
  modalTitle.textContent = "EDIT HERO";
  modalConfirm.textContent = "Save Changes";
  modalDelete.style.display = "inline-flex";
  fName.value   = h.name   || "";
  fRarity.value = h.rarity || "5ml";
  fNotes.value  = h.notes  || "";
  setPickedIcon(h.icon || ICONS[0]);
  overlay.classList.add("open");
  fName.focus();
}

function closeModal() {
  overlay.classList.remove("open");
  editingId = null;
}

function onModalConfirm() {
  const name   = fName.value.trim() || "Unnamed Hero";
  const rarity = fRarity.value;
  const icon   = fIcon.value.trim() || ICONS[0];
  const notes  = fNotes.value.trim();

  if (editingId !== null) {
    // Edit existing
    heroes = heroes.map(h => h.id === editingId ? { ...h, name, rarity, icon, notes } : h);
  } else {
    // Add new — place roughly center with small random offset
    heroes.push({
      id:     Date.now(),
      name, rarity, icon, notes,
      x: 42 + Math.random() * 16,
      y: 42 + Math.random() * 16,
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

/* ══════════════════════════════════════
   LOCAL STORAGE
══════════════════════════════════════ */
function saveLocal() {
  localStorage.setItem("e7_heroes", JSON.stringify(heroes));
}

function loadLocal() {
  try {
    const raw = localStorage.getItem("e7_heroes");
    if (raw) heroes = JSON.parse(raw);
  } catch { heroes = []; }
}

/* ══════════════════════════════════════
   GITHUB GIST VIA VERCEL API
══════════════════════════════════════ */
function setStatus(msg, timeout = 4000) {
  saveStatus.textContent = msg;
  if (timeout) setTimeout(() => { saveStatus.textContent = ""; }, timeout);
}

async function saveToServer() {
  setStatus("⏳ Saving…", 0);
  try {
    const res = await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ heroes }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Save failed");
    setStatus("✅ Saved to GitHub");
  } catch (e) {
    setStatus("❌ " + e.message);
  }
}

async function loadFromServer() {
  setStatus("⏳ Loading…", 0);
  try {
    const res = await fetch("/api/load");
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
