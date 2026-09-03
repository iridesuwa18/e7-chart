/* ═══════════════════════════════════════
   EPIC SEVEN — app.js  (v2)
   Sections A–F implemented:
   A) Image-based icons with crop/pan editor
   B) Score system (SPD/TNK, SUR/SST) with axis numbers
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
let dotMode        = false;  // icons become small coloured element dots

/* ── Dot mode: element → colour ── */
const ELEMENT_DOT_COLORS = {
  Fire:  "#e0573a",
  Ice:   "#4fc3f7",
  Earth: "#7cb342",
  Light: "#ffd54f",
  Dark:  "#9c6ade",
  "":    "#8a9bab",
};

/* Shortens a hero name to its first two letters of each word, dot-joined.
   e.g. "Last Rider Krau" → "LA.RI.KR" */
function shortenHeroName(name) {
  const words = (name || "Hero").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "??";
  return words.map(w => w.slice(0, 2).toUpperCase()).join(".");
}

/* ── Circle Select mode ── */
let circleMode = false;              // tool armed (click chart to place/move circle)
let circleSel  = null;               // { cx, cy, r } in chart percent coordinates
const CIRCLE_DEFAULT_R = 15;
const CIRCLE_MIN_R = 5, CIRCLE_MAX_R = 40;
let magnifierOpen = false;
let magnifierExcluded = { rarity: new Set(), role: new Set(), element: new Set() };

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
let rosterSearchQuery = "";
let qdHeroSearchQuery = "";
let filterRarity  = new Set(["5ml","5r","4","3"]);
let filterRole    = new Set(["Warrior","Knight","Thief","Ranger","Mage","Soul Weaver",""]);
let filterElement = new Set(["Fire","Ice","Earth","Light","Dark",""]);

/* ── Quick Draft state ──
   Declared up here (not down by the rest of the Quick Draft logic) because
   init() runs immediately below and calls renderRoster() synchronously,
   which reads quickDraft — a `let` further down the file would still be in
   its temporal-dead-zone at that point and throw, which would also abort
   init() before it ever reaches autoLoadFromServer(). ── */
const QD_SIZE = 5;
let quickDraft = [null, null, null, null, null];
let quickDraftOpen = false;
let quickDraftSuggestOpen = false;

/* "Next Best" — swaps out whichever slot was most recently filled for
   the next-ranked candidate in that same slot's suggestion list. Doesn't
   persist or remember which heroes you don't own; it's just a pointer
   into the current ranked list for the last-touched slot, walking down
   one rank per click and wrapping back to #1 if you run off the end. */
let qdLastFilledSlot = null;
let qdNextBestRank = 0;
let qdBanProtectElement = null; // the element of the enemy's un-bannable "Ban Protect" pick, if set (Rule 1)
const QD_ELEMENT_COUNTER = { Fire: "Ice", Ice: "Earth", Earth: "Fire", Light: "Dark", Dark: "Light" }; // which element beats which

/* ── Quick Draft rules (quadrant/tier/chain logic, v3) ──
   This replaced the earlier class-fit system entirely — classes
   (Warrior/Knight/Thief/etc.) no longer factor into drafting at all.
   Every hero build sits in exactly one of 4 quadrants, based on its two
   axis types (not magnitude — this is categorical, always true
   regardless of score):
     TL = Speed + Survivability      TR = Speed + Sustainability
     BL = Tanky + Survivability      BR = Tanky + Sustainability
   Each quadrant's "support" quadrant is its diagonal opposite
   (TL⟷BR, TR⟷BL) — see QD_OPPOSITE_QUADRANT.

   Rule 1 (Ban Protect counter) — unchanged in spirit. Once the enemy's
   un-bannable Ban Protect element is set, remaining picks favor whichever
   element counters it (QD_ELEMENT_COUNTER). If no hero of that countering
   element is available, the fallback avoids ONLY the one element the
   protected element itself beats (its direct victim in the 3-way Fire/
   Ice/Earth cycle) — everything else, including the protected element
   itself, is still fair game. See qdSuggestForSlot.

   Rule 2 (tiers → support count) — a hero/build's own score (1-10)
   determines how many supports it needs if drafted as a chain "main":
     1-3  (Low)  → 3 supports
     4-7  (Mid)  → 2 supports
     8-10 (High) → 1 support
   See qdSupportsRequired.

   Rule 3 (support quadrant + score) — a support must come from the
   main's opposite quadrant. Its score ideally clears a tiered target
   based on the main's own tier, capped at 10 (see qdSupportTargetInfo):
     Low main  (< 4)  → target 1.5x,  support score must be STRICTLY
                          greater (no tie)
     Mid main  (4-7)  → target 1.25x, support score may equal or exceed
     High main (>= 8) → target 1x,    support score must be STRICTLY
                          greater (no tie — at 1x this would otherwise
                          be identical to the plain floor below)
   If nobody in that quadrant reaches the target, it falls back to the
   plain "≥ main's own score" floor (always inclusive, regardless of
   tier); if even that's empty, it falls back to quadrant-match only
   (never leaves the suggestion list empty). Support eligibility/score
   uses a hero's COMBINED stats (best-per-lane across primary + Ghost,
   same "Total Avg" number shown on the roster card) — a hero only gets
   treated as a single, one-build-only entry when picked as a MAIN (see
   Rule 5). See qdSupportQuadrants / qdSupportScore / qdSlotRequirement.

   Rule 4 (chain filling) — slots fill left→right as a sequence of
   main+supports chains: pick a main, fill its required supports, then
   (if room remains) start a new main from a different quadrant, and so
   on. A candidate can only start a new main if its own required support
   count fits in however many slots remain after it — otherwise it's not
   offered as a main option here at all. If the previous chain's
   required supports are already met but a new main wouldn't fit in the
   slots left (e.g. only 1 slot remains and every tier needs ≥1 support
   of its own), that leftover slot is instead offered as a bonus support
   for the still-open chain — this is also where the Ban Protect counter
   naturally lands if it hasn't found a home yet. See qdReplayDraft /
   qdSlotRequirement.

   Rule 5 (Ghosts as standalone picks) — a hero with a Ghost (altStats)
   build can be drafted as a MAIN using either its primary or its Ghost
   build specifically — each is offered as its own suggestion entry,
   using only that build's own quadrant + score (not combined). Once
   locked in as a main, only that one build defines the chain's
   opposite-quadrant/score requirement for its supports. See
   qdMainEntriesFor / qdBuildEntry. */
const QD_OPPOSITE_QUADRANT = { TL: "BR", BR: "TL", TR: "BL", BL: "TR" };
const QD_QUADRANT_LABEL = {
  TL: "Speed + Survivability",
  TR: "Speed + Sustainability",
  BL: "Tanky + Survivability",
  BR: "Tanky + Sustainability",
};

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
  loadQuickDraftLocal();

  // Quick Draft "companion mode" — visiting index.html?view=quickdraft
  // (e.g. installed as its own home-screen shortcut on Android) shows
  // ONLY the Quick Draft drawer full-screen, for use as a lightweight
  // side app while playing Epic Seven. Everything still reads/writes the
  // same heroes/quickDraft state and still pulls live data from the server.
  // Companion mode is detected two ways: a ?view=quickdraft URL param
  // (works from any link/shortcut), OR the qd-companion class already
  // being present on <body> (quickdraft.html hardcodes it directly in
  // its markup so there's zero flash of the full site on load).
  const qdCompanionMode =
    document.body.classList.contains("qd-companion") ||
    new URLSearchParams(location.search).get("view") === "quickdraft";
  if (qdCompanionMode) {
    document.body.classList.add("qd-companion");
    quickDraftOpen = true;
    document.getElementById("quickdraft-drawer").classList.add("open");
  }

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

  // Quick Draft
  document.getElementById("quickdraft-handle").addEventListener("click", toggleQuickDraftDrawer);
  document.getElementById("btn-quickdraft-random").addEventListener("click", randomizeQuickDraft);
  document.getElementById("btn-quickdraft-suggest").addEventListener("click", () => {
    if (quickDraftSuggestOpen) {
      quickDraftSuggestOpen = false;
      document.getElementById("quickdraft-suggestions").style.display = "none";
    } else {
      renderQuickDraftSuggestions();
    }
  });
  document.getElementById("btn-quickdraft-clear").addEventListener("click", () => {
    if (quickDraft.some(id => id !== null) && !confirm("Clear all Quick Draft slots?")) return;
    clearQuickDraft();
  });
  // Ban Protect element — the opponent's un-bannable pick (Rule 1).
  // Single-select (tap again to clear); once set, suggestions lock onto
  // whichever element counters it (see qdSuggestForNextSlot).
  document.querySelectorAll("#qd-ban-protect-chips .qd-el-chip").forEach(chip => {
    if (qdBanProtectElement === chip.dataset.el) chip.classList.add("active");
    chip.addEventListener("click", () => {
      const el = chip.dataset.el;
      qdBanProtectElement = qdBanProtectElement === el ? null : el;
      document.querySelectorAll("#qd-ban-protect-chips .qd-el-chip").forEach(c => {
        c.classList.toggle("active", qdBanProtectElement === c.dataset.el);
      });
      saveQuickDraftModeLocal();
      if (quickDraftSuggestOpen) renderQuickDraftSuggestions();
    });
  });

  document.getElementById("btn-quickdraft-autofill").addEventListener("click", autofillTopQuickDraftPick);
  const nextBestBtn = document.getElementById("btn-quickdraft-nextbest");
  if (nextBestBtn) nextBestBtn.addEventListener("click", nextBestQuickDraftPick);
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

  // Full-screen axis sliders
  document.getElementById("btn-open-h-slider").addEventListener("click", () => openXSlider("main"));
  document.getElementById("btn-open-v-slider").addEventListener("click", () => openYSlider("main"));
  document.getElementById("btn-open-alt-h-slider").addEventListener("click", () => openXSlider("alt"));
  document.getElementById("btn-open-alt-v-slider").addEventListener("click", () => openYSlider("alt"));

  document.getElementById("xslider-close").addEventListener("click", closeXSlider);
  document.getElementById("xslider-cancel").addEventListener("click", closeXSlider);
  document.getElementById("xslider-apply").addEventListener("click", applyXSlider);
  document.getElementById("xslider-overlay").addEventListener("click", e => {
    if (e.target === document.getElementById("xslider-overlay")) closeXSlider();
  });
  document.getElementById("xslider-fine-toggle").addEventListener("change", e => {
    xSliderState.fine = e.target.checked;
    document.getElementById("xslider-track").classList.toggle("fine-mode", xSliderState.fine);
  });
  const xTrack = document.getElementById("xslider-track");
  xTrack.addEventListener("pointerdown", xSliderPointerDown);
  xTrack.addEventListener("pointermove", xSliderPointerMove);
  xTrack.addEventListener("pointerup",   xSliderPointerUp);
  xTrack.addEventListener("pointercancel", xSliderPointerUp);

  document.getElementById("yslider-close").addEventListener("click", closeYSlider);
  document.getElementById("yslider-cancel").addEventListener("click", closeYSlider);
  document.getElementById("yslider-apply").addEventListener("click", applyYSlider);
  document.getElementById("yslider-overlay").addEventListener("click", e => {
    if (e.target === document.getElementById("yslider-overlay")) closeYSlider();
  });
  document.getElementById("yslider-fine-toggle").addEventListener("change", e => {
    ySliderState.fine = e.target.checked;
    document.getElementById("yslider-track").classList.toggle("fine-mode", ySliderState.fine);
  });
  const yTrack = document.getElementById("yslider-track");
  yTrack.addEventListener("pointerdown", ySliderPointerDown);
  yTrack.addEventListener("pointermove", ySliderPointerMove);
  yTrack.addEventListener("pointerup",   ySliderPointerUp);
  yTrack.addEventListener("pointercancel", ySliderPointerUp);

  // Re-run layout for whichever slider is open on resize/rotate, so the
  // neighbor previews keep fitting the track at its new size.
  window.addEventListener("resize", () => {
    if (document.getElementById("xslider-overlay").classList.contains("open")) renderXSlider();
    if (document.getElementById("yslider-overlay").classList.contains("open")) renderYSlider();
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

  // Deselect on chart background click / place circle when Circle Mode is armed
  chart.addEventListener("click", e => {
    if (e.target !== chart && !e.target.classList.contains("axis-h") && !e.target.classList.contains("axis-v")) return;

    if (circleMode) {
      const rect = chart.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      circleSel = {
        cx: Math.max(0, Math.min(100, x)),
        cy: Math.max(0, Math.min(100, y)),
        r: circleSel ? circleSel.r : CIRCLE_DEFAULT_R,
      };
      renderCircleSelect();
      if (magnifierOpen) renderMagnifier();
      return;
    }

    setSelected(null);
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

  // Roster search box (only present on index.html's sidebar — quickdraft.html
  // doesn't have a roster sidebar, so guard instead of assuming it exists)
  const rosterSearchInput = document.getElementById("roster-search");
  const rosterSearchClear = document.getElementById("roster-search-clear");
  if (rosterSearchInput && rosterSearchClear) {
  rosterSearchInput.addEventListener("input", e => {
    rosterSearchQuery = e.target.value.trim();
    rosterSearchClear.style.display = rosterSearchQuery ? "block" : "none";
    renderRoster();
  });
  rosterSearchClear.addEventListener("click", () => {
    rosterSearchInput.value = "";
    rosterSearchQuery = "";
    rosterSearchClear.style.display = "none";
    renderRoster();
    rosterSearchInput.focus();
  });
  }

  // Quick Draft hero search — only present in the quickdraft.html drawer.
  // Lets you search your Roster and tap a match to drop it straight into
  // the next open slot, without needing the full sidebar/roster list that
  // companion mode hides.
  const qdHeroSearchInput = document.getElementById("qd-hero-search");
  const qdHeroSearchClear = document.getElementById("qd-hero-search-clear");
  if (qdHeroSearchInput && qdHeroSearchClear) {
    qdHeroSearchInput.addEventListener("input", e => {
      qdHeroSearchQuery = e.target.value.trim();
      qdHeroSearchClear.style.display = qdHeroSearchQuery ? "block" : "none";
      renderQdHeroSearchResults();
    });
    qdHeroSearchClear.addEventListener("click", () => {
      qdHeroSearchInput.value = "";
      qdHeroSearchQuery = "";
      qdHeroSearchClear.style.display = "none";
      renderQdHeroSearchResults();
      qdHeroSearchInput.focus();
    });
  }

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

  document.getElementById("btn-dot-toggle").addEventListener("click", () => {
    dotMode = !dotMode;
    document.getElementById("btn-dot-toggle").classList.toggle("active", dotMode);
    document.body.classList.toggle("dot-mode", dotMode);
    renderChart();
  });

  // Origin dot (chart center, 0/0) — only clickable in Dot Mode (CSS also
  // enforces this via pointer-events, this is a belt-and-suspenders check).
  document.getElementById("origin-dot").addEventListener("click", e => {
    e.stopPropagation();
    if (!dotMode) return;
    openOriginLegend();
  });
  document.getElementById("origin-legend-close").addEventListener("click", closeOriginLegend);
  document.getElementById("origin-legend-overlay").addEventListener("click", e => {
    if (e.target === document.getElementById("origin-legend-overlay")) closeOriginLegend();
  });

  // ── Circle Select mode ──
  document.getElementById("btn-circle-toggle").addEventListener("click", () => {
    circleMode = !circleMode;
    document.getElementById("btn-circle-toggle").classList.toggle("active", circleMode);
    chart.classList.toggle("circle-armed", circleMode);
  });

  // ── Capture chart as a downloadable JPG (includes axis labels + all hero icons) ──
  document.getElementById("btn-capture-chart").addEventListener("click", captureChartImage);


  document.getElementById("circle-radius-input").addEventListener("input", e => {
    if (!circleSel) return;
    circleSel.r = Math.max(CIRCLE_MIN_R, Math.min(CIRCLE_MAX_R, Number(e.target.value) || CIRCLE_DEFAULT_R));
    renderCircleSelect();
    if (magnifierOpen) renderMagnifier();
  });

  document.getElementById("btn-circle-clear").addEventListener("click", () => {
    circleSel = null;
    renderCircleSelect();
    if (magnifierOpen) closeMagnifier();
  });

  document.getElementById("btn-circle-magnify").addEventListener("click", openMagnifier);
  document.getElementById("magnifier-close").addEventListener("click", closeMagnifier);
  document.getElementById("magnifier-overlay").addEventListener("click", e => {
    if (e.target === document.getElementById("magnifier-overlay")) closeMagnifier();
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
   X axis: SUR(left) 0=50% / SST(right) 0=50%   [SST = Sustainability, formerly "RS"]
     SUR 10 → x=0%, SUR 0 → x=50%, SST 0 → x=50%, SST 10 → x=100%
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
    x = 50 + (h / 10) * 50; // SST 0 → 50%, SST 10 → 100%
  }

  return { x, y };
}

function xyToScores(x, y) {
  // x: 0..100 → SUR 10..0 (left half) or SST 0..10 (right half)
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
    hType  = "SST";
    hScore = +((x - 50) / 50 * 10).toFixed(1);
  }

  return { vType, vScore, hType, hScore };
}

/* Back-compat: any hero data saved before the RS → SST rename still has
   hType (or altStats.hType) === "RS". scoresToXY treats anything that
   isn't "SUR" as the right-hand side, so old heroes still plot correctly
   without this — but this keeps displayed labels (roster, tooltips,
   compare panel) showing "SST" instead of the retired "RS" code. */
function migrateHeroTypes(list) {
  if (!Array.isArray(list)) return list;
  return list.map(h => {
    const needsFix = h.hType === "RS" || h.altStats?.hType === "RS";
    if (!needsFix) return h;
    return {
      ...h,
      hType: h.hType === "RS" ? "SST" : h.hType,
      altStats: h.altStats ? { ...h.altStats, hType: h.altStats.hType === "RS" ? "SST" : h.altStats.hType } : h.altStats,
    };
  });
}

function avgScore(vScore, hScore) {
  const v = Math.max(0, Math.min(10, Number(vScore) || 0));
  const h = Math.max(0, Math.min(10, Number(hScore) || 0));
  return +((v + h) / 2).toFixed(1);
}

/* Ranking value used by the "Rank" roster sort options.
   If the hero has a ghost (altStats), rank by the Total Avg
   (primary + ghost scores averaged across all 4 axes) — matching the
   "Total Avg" badge shown in the roster card.
   Otherwise, fall back to the hero's regular Avg score. */
function rankValue(h) {
  const scores = xyToScores(h._x ?? 50, h._y ?? 50);
  if (h.altStats) {
    return +((Number(h.vScore || 0) + Number(h.hScore || 0) + Number(h.altStats.vScore) + Number(h.altStats.hScore)) / 4).toFixed(1);
  }
  return avgScore(scores.vScore, scores.hScore);
}

/* ═══════════════════════════════════════
   QUICK DRAFT
   A 5-slot PVP draft board, filled left→right
   from the Roster. Slots compact left when a
   hero is removed. A "Suggest" tool ranks the
   Roster's remaining heroes for whichever slot
   is next empty, using the axis scores plus a
   handful of team-composition rules (see the
   scoreCandidate() comment block below).

   NOTE: the state (quickDraft, QD_SIZE, etc.) is
   declared up near the top of the file, above
   init() — see the comment there for why.
═══════════════════════════════════════ */

function saveQuickDraftLocal() {
  try { localStorage.setItem("e7_quickdraft", JSON.stringify(quickDraft)); } catch { /* ignore */ }
}
function loadQuickDraftLocal() {
  try {
    const raw = localStorage.getItem("e7_quickdraft");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        quickDraft = [0,1,2,3,4].map(i => parsed[i] ?? null);
      }
    }
  } catch { /* ignore, keep default empty slots */ }
  try {
    const rawBp = localStorage.getItem("e7_qd_ban_protect_element");
    qdBanProtectElement = rawBp && rawBp !== "null" ? rawBp : null;
  } catch { /* ignore, keep default null */ }
}
function saveQuickDraftModeLocal() {
  try { localStorage.setItem("e7_qd_ban_protect_element", qdBanProtectElement || "null"); } catch { /* ignore */ }
}

/* Reads a hero build's raw axis values into 4 independent stat lanes.
   Only one of spd/tnk is ever non-zero (a hero is plotted as EITHER a
   speed unit OR a tank on the vertical axis) and likewise for sur/sst —
   that mirrors how the quadrant chart itself works, and means "low tank"
   is automatically true for a speed-leaning hero, etc. */
/* Reads a hero build's raw axis values into 4 independent stat lanes.
   Only one of spd/tnk is ever non-zero (a hero is plotted as EITHER a
   speed unit OR a tank on the vertical axis) and likewise for sur/sst —
   that mirrors how the quadrant chart itself works. */
function qdAxisValues(vType, vScore, hType, hScore) {
  const v = Math.max(0, Math.min(10, Number(vScore) || 0));
  const h = Math.max(0, Math.min(10, Number(hScore) || 0));
  return {
    spd: vType === "SPD" ? v : 0,
    tnk: vType === "TNK" ? v : 0,
    sur: hType === "SUR" ? h : 0,
    sst: hType === "SST" ? h : 0,
  };
}

/* Which of the 4 quadrants a single build sits in — categorical, based
   only on vType/hType, never on the magnitude of the score. */
function qdQuadrantOf(vType, hType) {
  const top = vType === "SPD";
  const left = hType === "SUR";
  if (top && left) return "TL";
  if (top && !left) return "TR";
  if (!top && left) return "BL";
  return "BR";
}

/* Rule 2 — a hero/build's own score (1-10) determines how many supports
   it needs if drafted as a chain "main". Continuous bands so fractional
   scores (e.g. 3.5, 7.5) still fall somewhere sensible:
     score < 4  → 3 supports (Low tier)
     score < 8  → 2 supports (Mid tier)
     otherwise  → 1 support  (High tier) */
function qdSupportsRequired(score) {
  if (score < 4) return 3;
  if (score < 8) return 2;
  return 1;
}

/* Rule 3 — the support target for a main's score, tiered:
     Low  (< 4)  → 1.5x,  STRICT greater-than (no tie)
     Mid  (4-7)  → 1.25x, equal-or-greater
     High (>= 8) → 1x,    STRICT greater-than (no tie — at 1x this would
                            otherwise be identical to the plain floor
                            below and add nothing)
   The plain "≥ main's own score" floor (Rule 3's base requirement) is
   always inclusive regardless of tier — this target is a preference
   layered on top, not a replacement for it. See qdSuggestForSlot. */
function qdSupportTargetInfo(mainScore) {
  if (mainScore < 4) return { multiplier: 1.5, strict: true };
  if (mainScore < 8) return { multiplier: 1.25, strict: false };
  return { multiplier: 1, strict: true };
}

/* A single build's standalone entry — used for MAIN candidates, where a
   Ghost is drafted using ONLY its own stats (Rule 5), never combined
   with the hero's primary build. */
function qdBuildEntry(h, variant) {
  const src = variant === "ghost" ? h.altStats : h;
  const vType = src ? src.vType : h.vType;
  const hType = src ? src.hType : h.hType;
  const vScore = src ? src.vScore : h.vScore;
  const hScore = src ? src.hScore : h.hScore;
  return {
    heroId: h.id,
    hero: h,
    variant,
    quadrant: qdQuadrantOf(vType, hType),
    score: avgScore(vScore, hScore),
  };
}

/* Every MAIN option a hero offers — just its primary build, or both
   primary and Ghost (each as its own separate, standalone entry) if it
   has one. See Rule 5. */
function qdMainEntriesFor(h) {
  const entries = [qdBuildEntry(h, "primary")];
  if (h.altStats) entries.push(qdBuildEntry(h, "ghost"));
  return entries;
}

/* Rule 3 — a hero's SUPPORT eligibility uses combined stats: every
   quadrant covered by ANY of its builds (primary and/or Ghost), since
   in-game you'd simply play whichever build the team needs. */
function qdSupportQuadrants(h) {
  const qs = new Set();
  qs.add(qdQuadrantOf(h.vType, h.hType));
  if (h.altStats) qs.add(qdQuadrantOf(h.altStats.vType, h.altStats.hType));
  return qs;
}

/* Rule 3 — a hero's SUPPORT score is its combined/"Total Avg" score
   (same number as rankValue/the roster card badge) — reusing both
   builds' worth of value, not just one. */
/* Rule 3 — a hero's SUPPORT score is its combined/"Total Avg" score.
   Deliberately NOT calling rankValue(h) here: that function derives a
   non-Ghosted hero's score from xyToScores(h._x, h._y), and _x/_y are
   only ever populated by index.html's renderChart() — which Quick Draft
   never runs. On this page h._x/h._y are always undefined, so rankValue
   silently falls back to the chart's center point (50,50) → score 0 for
   every non-Ghosted hero, regardless of its real stats. This computes
   the same "Total Avg" number directly from the hero's own stored
   fields instead, with no dependency on chart-rendering side effects. */
function qdSupportScore(h) {
  if (h.altStats) {
    return +((Number(h.vScore || 0) + Number(h.hScore || 0) + Number(h.altStats.vScore) + Number(h.altStats.hScore)) / 4).toFixed(1);
  }
  return avgScore(h.vScore, h.hScore);
}

/* Encodes a slot's pick as a single storable value. Ghost mains get a
   "::ghost" suffix so they survive localStorage round-trips; everything
   else (primary mains, and ALL supports — variant is irrelevant for a
   support since Rule 3 always uses combined stats) is stored as the
   plain heroId, which also keeps old saved drafts loading correctly. */
function qdMakePickId(heroId, variant) {
  return variant === "ghost" ? `${heroId}::ghost` : heroId;
}

/* Reverses qdMakePickId. Always returns { heroId (number), variant }. */
function qdParsePick(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.endsWith("::ghost")) {
    return { heroId: Number(raw.slice(0, -7)), variant: "ghost" };
  }
  return { heroId: Number(raw), variant: "primary" };
}

/* True if the given Roster hero (by heroId) already occupies a slot,
   regardless of which build (primary/Ghost) or role (main/support). */
function qdHeroInDraft(heroId) {
  return quickDraft.some(raw => raw !== null && qdParsePick(raw).heroId === heroId);
}

/* Rule 4 — replays quickDraft[0..uptoIdx-1] in order and reconstructs
   the main+supports chain structure purely from position (the app only
   ever fills slots left→right, so this is always well-defined). Returns:
     perSlot     — per-filled-slot info: { index, heroId, hero, variant,
                   role: 'main'|'support', quadrant, score, mainIndex,
                   bonus }. `quadrant` for a support is the quadrant IT
                   fills (i.e. its main's opposite), and `bonus` marks a
                   support placed after its main's required count was
                   already met (a leftover-slot filler).
     activeMain  — the still-open chain's state at the end of the
                   replay ({ quadrant, score, required, supplied, index })
                   or null if there's no chain in progress. */
function qdReplayDraft(uptoIdx) {
  const perSlot = [];
  let activeMain = null;
  for (let i = 0; i < uptoIdx; i++) {
    const raw = quickDraft[i];
    if (raw === null || raw === undefined) continue;
    const parsed = qdParsePick(raw);
    const hero = heroes.find(h => h.id === parsed.heroId);
    if (!hero) continue;

    if (activeMain && activeMain.supplied < activeMain.required) {
      activeMain.supplied++;
      perSlot.push({
        index: i, heroId: parsed.heroId, hero, variant: parsed.variant, role: "support",
        quadrant: QD_OPPOSITE_QUADRANT[activeMain.quadrant], score: qdSupportScore(hero),
        mainIndex: activeMain.index, bonus: false,
      });
      continue;
    }

    const remainingAfter = QD_SIZE - (i + 1);
    const entry = qdBuildEntry(hero, parsed.variant);
    const required = qdSupportsRequired(entry.score);
    const canStartNewMain = activeMain === null || required <= remainingAfter;

    if (canStartNewMain) {
      activeMain = { quadrant: entry.quadrant, score: entry.score, required, supplied: 0, index: i };
      perSlot.push({
        index: i, heroId: parsed.heroId, hero, variant: parsed.variant, role: "main",
        quadrant: entry.quadrant, score: entry.score, required, mainIndex: i, bonus: false,
      });
    } else {
      activeMain.supplied++;
      perSlot.push({
        index: i, heroId: parsed.heroId, hero, variant: parsed.variant, role: "support",
        quadrant: QD_OPPOSITE_QUADRANT[activeMain.quadrant], score: qdSupportScore(hero),
        mainIndex: activeMain.index, bonus: true,
      });
    }
  }
  return { perSlot, activeMain };
}

/* What the next empty slot needs, derived from the chain replay:
     { type: "support", quadrant, minScore, main, bonus }
       — a required (bonus: false) or leftover/bonus (bonus: true)
         support for the currently-open chain.
     { type: "main", remainingAfter, activeMain }
       — free to start a new chain; remainingAfter is how many slots
         are left AFTER this one, which caps which tiers can start here. */
function qdSlotRequirement(nextIdx) {
  const { activeMain } = qdReplayDraft(nextIdx);
  if (activeMain && activeMain.supplied < activeMain.required) {
    const t = qdSupportTargetInfo(activeMain.score);
    return { type: "support", quadrant: QD_OPPOSITE_QUADRANT[activeMain.quadrant], minScore: activeMain.score, targetScore: Math.min(10, activeMain.score * t.multiplier), targetStrict: t.strict, main: activeMain, bonus: false };
  }
  const remainingAfter = QD_SIZE - (nextIdx + 1);
  if (activeMain && remainingAfter <= 0) {
    const t = qdSupportTargetInfo(activeMain.score);
    return { type: "support", quadrant: QD_OPPOSITE_QUADRANT[activeMain.quadrant], minScore: activeMain.score, targetScore: Math.min(10, activeMain.score * t.multiplier), targetStrict: t.strict, main: activeMain, bonus: true };
  }
  return { type: "main", remainingAfter, activeMain };
}

/* Ranks/labels one candidate entry for whichever slot is next empty.
   Supports rank by "just enough" (smallest excess over the required
   score) rather than raw power, so your strongest heroes aren't forced
   into support duty when a cheaper one would clear the bar just fine.
   Mains rank by raw score (a stronger main needs fewer supports and is
   simply the better anchor for its chain). */
function qdScoreEntry(e, req) {
  const reasons = [];
  let rank;
  if (e.isSupport) {
    // Highest score wins among whichever tier qualified (see
    // qdSuggestForSlot's 3-tier fallback: target → plain floor →
    // quadrant-only). Ranking is always by raw score, never inverted.
    rank = e.score;
    const meetsTarget = req.targetStrict ? e.score > req.targetScore : e.score >= req.targetScore;
    const meetsFloor = e.score >= req.minScore;
    const cmp = req.targetStrict ? ">" : "≥";
    reasons.push(`Supports the ${QD_QUADRANT_LABEL[QD_OPPOSITE_QUADRANT[req.quadrant]]} pick — target ${cmp} ${req.targetScore.toFixed(1)}, floor ≥ ${req.minScore.toFixed(1)}, has ${e.score.toFixed(1)}`);
    if (!meetsTarget && meetsFloor) reasons.push("Doesn't clear the target — no one in this quadrant does, showing the best available above the plain floor");
    if (!meetsFloor) reasons.push(`⚠️ Below the required ${req.minScore.toFixed(1)} — no qualifying hero left in this quadrant, showing the closest option`);
    if (req.bonus) reasons.push("Bonus support — filling a leftover slot after the required count was already met");
  } else {
    rank = e.score;
    reasons.push(`${QD_QUADRANT_LABEL[e.quadrant]} pick${e.variant === "ghost" ? " (Ghost build)" : ""} — needs ${e.supportsNeeded} support${e.supportsNeeded > 1 ? "s" : ""} from the ${QD_QUADRANT_LABEL[QD_OPPOSITE_QUADRANT[e.quadrant]]} side`);
  }
  return { ...e, rank, reasons };
}

/* Ranks every Roster hero not already drafted for the next empty slot.
   Builds the candidate entries per Rule 3 (supports) or Rule 4/5 (mains),
   applies the Ban Protect element filter (Rule 1) on top, then scores
   and sorts. Always falls back gracefully rather than returning an
   empty list, same philosophy as before — the score/quadrant/element
   filters only narrow the pool when doing so wouldn't empty it. */
function qdSuggestForSlot(nextIdx) {
  if (nextIdx === -1 || nextIdx == null) return [];
  const usedHeroIds = new Set(
    quickDraft.filter((raw, i) => raw !== null && i !== nextIdx).map(raw => qdParsePick(raw).heroId)
  );
  const candidateHeroes = heroes.filter(h => !usedHeroIds.has(h.id));
  const req = qdSlotRequirement(nextIdx);

  let entries = [];
  if (req.type === "support") {
    // Rule 3 — support must clear 1.5x the main's score (capped at 10)
    // ideally; if nobody in the right quadrant reaches that, fall back
    // to the plain "≥ main's score" floor; if even that's empty, fall
    // back to quadrant-match only. Never emptied further than that.
    const inQuadrant = candidateHeroes.filter(h => qdSupportQuadrants(h).has(req.quadrant));
    const toEntries = pool => pool.map(h => ({ heroId: h.id, hero: h, variant: "primary", isSupport: true, quadrant: req.quadrant, score: qdSupportScore(h) }));
    let pool = inQuadrant.filter(h => req.targetStrict ? qdSupportScore(h) > req.targetScore : qdSupportScore(h) >= req.targetScore);
    if (pool.length === 0) pool = inQuadrant.filter(h => qdSupportScore(h) >= req.minScore);
    if (pool.length === 0) pool = inQuadrant.length > 0 ? inQuadrant : candidateHeroes;
    entries = toEntries(pool);
  } else {
    // Rule 4 — if this slot already has an occupant (i.e. this is a
    // Next Best re-suggestion, not a first-time pick), lock candidates
    // to that occupant's SAME quadrant. Otherwise Next Best's pure
    // score-ranking can silently jump the main to a different quadrant
    // entirely, which flips the required support quadrant underneath
    // whatever's already showing in Suggest — looks like a random
    // warning even though the (new, different) requirement is correct.
    // Falls back to any quadrant only if that locked pool is empty.
    let lockedQuadrant = null;
    const currentRaw = quickDraft[nextIdx];
    if (currentRaw !== null && currentRaw !== undefined) {
      const curParsed = qdParsePick(currentRaw);
      const curHero = heroes.find(h => h.id === curParsed.heroId);
      if (curHero) lockedQuadrant = qdBuildEntry(curHero, curParsed.variant).quadrant;
    }
    candidateHeroes.forEach(h => {
      qdMainEntriesFor(h).forEach(build => {
        if (lockedQuadrant && build.quadrant !== lockedQuadrant) return;
        const supportsNeeded = qdSupportsRequired(build.score);
        if (supportsNeeded <= req.remainingAfter) entries.push({ ...build, isSupport: false, supportsNeeded });
      });
    });
    if (entries.length === 0 && lockedQuadrant) {
      // Same-quadrant pool exhausted — relax the quadrant lock before
      // ever falling back further.
      candidateHeroes.forEach(h => {
        qdMainEntriesFor(h).forEach(build => {
          const supportsNeeded = qdSupportsRequired(build.score);
          if (supportsNeeded <= req.remainingAfter) entries.push({ ...build, isSupport: false, supportsNeeded });
        });
      });
    }
    if (entries.length === 0) {
      // Graceful fallback — Roster only has heroes whose tier wouldn't
      // fit the remaining slots; offer them anyway rather than nothing.
      candidateHeroes.forEach(h => {
        qdMainEntriesFor(h).forEach(build => {
          entries.push({ ...build, isSupport: false, supportsNeeded: qdSupportsRequired(build.score) });
        });
      });
    }
  }

  // Rule 1 — Ban Protect counter element, applied last on top of
  // whatever the pool already is. Prefers the countering element;
  // falls back to avoiding only the element the protected one directly
  // beats, never emptying the pool.
  if (qdBanProtectElement) {
    const counterEl = QD_ELEMENT_COUNTER[qdBanProtectElement];
    const avoidEl = Object.keys(QD_ELEMENT_COUNTER).find(k => QD_ELEMENT_COUNTER[k] === qdBanProtectElement);
    let filtered = entries.filter(e => e.hero.element === counterEl);
    if (filtered.length === 0 && avoidEl) filtered = entries.filter(e => e.hero.element !== avoidEl);
    if (filtered.length > 0) entries = filtered;
  }

  const scored = entries.map(e => qdScoreEntry(e, req));
  scored.sort((a, b) => b.rank - a.rank);
  return scored;
}

function qdSuggestForNextSlot() {
  return qdSuggestForSlot(quickDraft.indexOf(null));
}

function addToQuickDraft(heroId, variant = "primary") {
  if (qdHeroInDraft(heroId)) return;
  const idx = quickDraft.indexOf(null);
  if (idx === -1) { setStatus("⚠️ Quick Draft is full (5/5)"); return; }
  quickDraft[idx] = qdMakePickId(heroId, variant);
  qdLastFilledSlot = idx;
  qdNextBestRank = 0;
  saveQuickDraftLocal();
  renderQuickDraft();
  renderRoster();
}

/* Whichever slot is currently the rightmost filled one — i.e. the
   "latest" hero on the team. Recomputed fresh every time rather than
   tracked as a pointer, so removing a hero (which shifts everyone left)
   automatically updates what Next Best targets without needing another
   Autofill/pick first. Slots always fill left-to-right (see
   addToQuickDraft), so the rightmost filled slot is always the most
   recently added one. */
function qdLatestFilledSlotIndex() {
  for (let i = QD_SIZE - 1; i >= 0; i--) {
    if (quickDraft[i] !== null) return i;
  }
  return null;
}

/* Next Best — re-picks whichever slot is currently the latest (rightmost
   filled) one, walking one step further down that slot's own ranked
   suggestion list each time it's clicked (wrapping back to #1 after the
   last option). No memory of "don't have" heroes is kept — it's just a
   live rank pointer for the current session, recomputed fresh from the
   current roster and picks every click. The pointer resets to #1
   whenever the targeted slot itself changes (e.g. after a removal shifts
   which slot is "latest"). When the slot being cycled is a MAIN, the
   candidate pool is locked to its current quadrant (see qdSuggestForSlot)
   — otherwise a pure score-ranked cycle could silently jump the main to
   a different quadrant, which flips the required support quadrant out
   from under whatever's already showing in Suggest. */
function nextBestQuickDraftPick() {
  const slotIndex = qdLatestFilledSlotIndex();
  if (slotIndex === null) {
    setStatus("⚠️ Fill a slot first, then Next Best can swap it.");
    return;
  }
  if (slotIndex !== qdLastFilledSlot) {
    qdLastFilledSlot = slotIndex;
    qdNextBestRank = 0;
  }
  let scored;
  try {
    scored = qdSuggestForSlot(slotIndex);
  } catch (err) {
    setStatus(`⚠️ Next Best crashed: ${(err && err.message) || err}`);
    console.error(err);
    return;
  }
  if (scored.length === 0) { setStatus("⚠️ No more heroes left in your Roster to swap in."); return; }

  qdNextBestRank = (qdNextBestRank + 1) % scored.length;
  const pick = scored[qdNextBestRank];
  quickDraft[slotIndex] = qdMakePickId(pick.heroId, pick.variant);
  saveQuickDraftLocal();
  renderQuickDraft();
  renderRoster();
  if (quickDraftSuggestOpen) renderQuickDraftSuggestions();

  if (qdNextBestRank === 0) setStatus("🔁 Back to the top pick for this slot.");
  else setStatus(`🔁 Slot ${slotIndex + 1}: ${pick.hero.name || "Unnamed"} (#${qdNextBestRank + 1} best)`);
}

/* Randomize — picks a uniformly random hero from the Roster (excluding
   anyone already drafted) for the next empty slot, using its primary
   build (Ghosts are only drafted deliberately via a Suggest row — see
   Rule 5), then opens Suggest for the following slot so the rest of the
   team strategizes around whatever the randomizer landed on. */
function randomizeQuickDraft() {
  const idx = quickDraft.indexOf(null);
  if (idx === -1) { setStatus("⚠️ Quick Draft is full (5/5)"); return; }
  const usedHeroIds = new Set(quickDraft.filter(raw => raw !== null).map(raw => qdParsePick(raw).heroId));
  const pool = heroes.filter(h => !usedHeroIds.has(h.id));
  if (pool.length === 0) { setStatus("⚠️ No more heroes left in your Roster."); return; }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  addToQuickDraft(pick.id);
  if (quickDraft.indexOf(null) !== -1) renderQuickDraftSuggestions();
}

/* Autofill — instantly locks in whichever hero currently ranks #1 in
   qdSuggestForNextSlot() (the same "👑 best" row shown in Suggest), then
   opens Suggest for the next empty slot so the pace stays quick. */
function autofillTopQuickDraftPick() {
  const idx = quickDraft.indexOf(null);
  if (idx === -1) { setStatus("⚠️ Quick Draft is full (5/5)"); return; }
  let scored;
  try {
    scored = qdSuggestForNextSlot();
  } catch (err) {
    setStatus(`⚠️ Autofill crashed: ${(err && err.message) || err}`);
    console.error(err);
    return;
  }
  if (scored.length === 0) { setStatus("⚠️ No more heroes left in your Roster."); return; }
  addToQuickDraft(scored[0].heroId, scored[0].variant);
  if (quickDraft.indexOf(null) !== -1) renderQuickDraftSuggestions();
  else {
    document.getElementById("quickdraft-suggestions").style.display = "none";
    quickDraftSuggestOpen = false;
  }
}

/* Removing a hero compacts the array so everything behind it shifts
   one space left — matches "fills left to right". Matches by heroId, so
   it removes the hero regardless of which build (primary/Ghost) was
   drafted for it. */
function removeFromQuickDraft(id) {
  quickDraft = quickDraft.filter(x => x === null || qdParsePick(x).heroId !== id);
  while (quickDraft.length < QD_SIZE) quickDraft.push(null);
  saveQuickDraftLocal();
  renderQuickDraft();
  renderRoster();
}

function toggleQuickDraftDrawer() {
  quickDraftOpen = !quickDraftOpen;
  document.getElementById("quickdraft-drawer").classList.toggle("open", quickDraftOpen);
  document.getElementById("quickdraft-handle").classList.toggle("open", quickDraftOpen);
  document.getElementById("quickdraft-chevron").textContent = quickDraftOpen ? "▴" : "▾";
}

function clearQuickDraft() {
  quickDraft = [null, null, null, null, null];
  quickDraftSuggestOpen = false;
  qdLastFilledSlot = null;
  qdNextBestRank = 0;
  document.getElementById("quickdraft-suggestions").style.display = "none";
  saveQuickDraftLocal();

  // Reset the Ban Protect element back to default.
  qdBanProtectElement = null;
  document.querySelectorAll("#qd-ban-protect-chips .qd-el-chip").forEach(chip => chip.classList.remove("active"));
  saveQuickDraftModeLocal();

  renderQuickDraft();
  renderRoster();
}

function renderQdHeroSearchResults() {
  const resultsEl = document.getElementById("qd-hero-search-results");
  if (!resultsEl) return; // not present on index.html, only quickdraft.html

  if (!qdHeroSearchQuery) {
    resultsEl.style.display = "none";
    resultsEl.innerHTML = "";
    return;
  }

  const nextIdx = quickDraft.indexOf(null);
  if (nextIdx === -1) {
    resultsEl.innerHTML = `<div class="qd-suggest-empty">Quick Draft is full (5/5).</div>`;
    resultsEl.style.display = "block";
    return;
  }

  const q = qdHeroSearchQuery.toLowerCase();
  const matches = heroes
    .filter(h => !qdHeroInDraft(h.id))
    .filter(h => (h.name || "").toLowerCase().includes(q))
    .slice(0, 8);

  if (matches.length === 0) {
    resultsEl.innerHTML = `<div class="qd-suggest-empty">No matching heroes in your Roster.</div>`;
  } else {
    resultsEl.innerHTML = matches.map(h => {
      const portrait = h.iconData ? `<img src="${h.iconData}">` : "⚔️";
      const roleEl = h.role ? `<span class="tag tag-role">${h.role}</span>` : "";
      const elemEl = h.element ? `<span class="tag tag-elem">${h.element}</span>` : "";
      return `
        <div class="qd-suggest-row" data-id="${h.id}">
          <div class="qd-suggest-portrait">${portrait}</div>
          <div class="qd-suggest-info">
            <div class="qd-suggest-name">${h.name || "Unnamed"}</div>
            <div class="qd-suggest-reasons">${roleEl}${elemEl}</div>
          </div>
        </div>`;
    }).join("");

    resultsEl.querySelectorAll(".qd-suggest-row").forEach(row => {
      row.addEventListener("click", () => {
        addToQuickDraft(Number(row.dataset.id));
        const input = document.getElementById("qd-hero-search");
        const clearBtn = document.getElementById("qd-hero-search-clear");
        if (input) input.value = "";
        if (clearBtn) clearBtn.style.display = "none";
        qdHeroSearchQuery = "";
        resultsEl.style.display = "none";
        resultsEl.innerHTML = "";
      });
    });
  }

  resultsEl.style.display = "block";
}

function renderQuickDraft() {
  const slotsWrap = document.getElementById("quickdraft-slots");
  slotsWrap.innerHTML = "";

  const { perSlot, activeMain } = qdReplayDraft(QD_SIZE);
  const slotInfoByIndex = {};
  perSlot.forEach(p => { slotInfoByIndex[p.index] = p; });

  quickDraft.forEach((raw, i) => {
    const info = slotInfoByIndex[i] || null;
    const h = info ? info.hero : null;
    const slot = document.createElement("div");
    slot.className = "qd-slot " + (h ? "filled" : "empty") + (info && info.role === "main" ? " qd-main" : "") + (info && info.role === "support" ? " qd-support" : "");

    if (h) {
      const portrait = h.iconData ? `<img src="${h.iconData}">` : "⚔️";
      const roleBadge = info.role === "main"
        ? `<div class="qd-slot-protect-badge" title="Main pick — ${QD_QUADRANT_LABEL[info.quadrant]}">🔗</div>`
        : `<div class="qd-slot-protect-badge" title="${info.bonus ? "Bonus support" : "Support"} — ${QD_QUADRANT_LABEL[info.quadrant]}">🛡</div>`;
      const ghostBadge = info.variant === "ghost" ? `<div class="qd-slot-ghost-badge" title="Drafted as its Ghost build">👻</div>` : "";
      slot.innerHTML = `
        ${roleBadge}${ghostBadge}
        <div class="qd-slot-portrait">${portrait}</div>
        <div class="qd-slot-name">${h.name || "Unnamed"}</div>
        <div class="qd-slot-score">${info.score.toFixed(1)}</div>`;
      slot.title = `Tap to remove ${h.name || "this hero"} from Quick Draft`;
      slot.addEventListener("click", () => removeFromQuickDraft(h.id));
    } else {
      slot.innerHTML = `
        <div class="qd-slot-placeholder">＋</div>
        <div class="qd-slot-index">Slot ${i + 1}</div>`;
      slot.title = "Empty — tap ＋ on a Roster hero, or use Suggest";
    }
    slotsWrap.appendChild(slot);
  });

  const filledCount = perSlot.length;
  document.getElementById("quickdraft-handle-sub").textContent = filledCount + "/5";

  const statsEl = document.getElementById("quickdraft-stats");
  const avgTxt = filledCount ? (perSlot.reduce((s, p) => s + p.score, 0) / filledCount).toFixed(1) : "—";
  const quadrantsUsed = new Set(perSlot.map(p => p.quadrant)).size;
  const mainCount = perSlot.filter(p => p.role === "main").length;
  const underSupported = activeMain && activeMain.supplied < activeMain.required && filledCount >= QD_SIZE;
  const quadClass = quadrantsUsed >= Math.min(4, filledCount) ? "good" : (filledCount ? "warn" : "");
  statsEl.innerHTML = `
    <span class="qd-stat">${filledCount}/5 Picked</span>
    <span class="qd-stat">Avg ${avgTxt}</span>
    <span class="qd-stat ${quadClass}">🧭 Quadrants ${quadrantsUsed}/4</span>
    <span class="qd-stat">🔗 Chains ${mainCount}</span>
    ${underSupported ? `<span class="qd-stat warn">⚠️ Under-supported</span>` : ""}`;

  document.getElementById("btn-quickdraft-suggest").disabled = filledCount >= QD_SIZE;
  document.getElementById("btn-quickdraft-random").disabled = filledCount >= QD_SIZE;
  document.getElementById("btn-quickdraft-autofill").disabled = filledCount >= QD_SIZE;
  const nextBestBtn = document.getElementById("btn-quickdraft-nextbest");
  if (nextBestBtn) {
    const latestSlot = qdLatestFilledSlotIndex();
    nextBestBtn.disabled = latestSlot === null;
    nextBestBtn.title = latestSlot !== null
      ? `Swap Slot ${latestSlot + 1} (your latest pick) for the next-best pick`
      : "Fill a slot first";
  }

  if (quickDraftSuggestOpen) renderQuickDraftSuggestions();
  renderQdHeroSearchResults();
}

/* Rule 1 hint — Ban Protect element reminder. */
function qdBanProtectHint() {
  if (!qdBanProtectElement) return "";
  const counterEl = QD_ELEMENT_COUNTER[qdBanProtectElement];
  const avoidEl = Object.keys(QD_ELEMENT_COUNTER).find(k => QD_ELEMENT_COUNTER[k] === qdBanProtectElement);
  return `🛡 Ban Protect is ${qdBanProtectElement} — remaining picks favor ${counterEl}${avoidEl ? `, avoiding only ${avoidEl} if ${counterEl} isn't available` : ""}.`;
}

/* Rule 4 hint — explains whether the next slot is a required support, a
   leftover bonus support, or free to start a new main chain. */
function qdChainHint(nextIdx) {
  if (nextIdx === -1 || nextIdx == null) return "";
  const req = qdSlotRequirement(nextIdx);
  if (req.type === "support") {
    const cmp = req.targetStrict ? ">" : "≥";
    return req.bonus
      ? `🔗 Leftover slot — offered as a bonus ${QD_QUADRANT_LABEL[req.quadrant]} support (targeting ${cmp} ${req.targetScore.toFixed(1)}, floor ≥ ${req.minScore.toFixed(1)}) for the current chain.`
      : `🔗 This slot needs a ${QD_QUADRANT_LABEL[req.quadrant]} support — targeting score ${cmp} ${req.targetScore.toFixed(1)}, floor ≥ ${req.minScore.toFixed(1)} (combined stats).`;
  }
  return `🔗 Free to start a new main pick here — its own tier's required supports must fit within the ${req.remainingAfter} slot${req.remainingAfter === 1 ? "" : "s"} left after it.`;
}

function renderQuickDraftSuggestions() {
  const panel = document.getElementById("quickdraft-suggestions");
  const listEl = document.getElementById("quickdraft-suggestions-list");
  const label = document.getElementById("quickdraft-suggest-slot-label");

  // Wrapped end-to-end: if anything below throws (e.g. a malformed hero
  // record reaching qdSuggestForSlot's chain replay), we used to fail
  // silently mid-render — the panel would just keep showing whatever it
  // last successfully rendered (looks like "stuck on the previous slot's
  // suggestion"), and every future click would hit the same exception
  // (looks like "can't get it to reopen"). Surfacing the real error text
  // directly in the panel means you don't need DevTools to see it — same
  // fix pattern as Summit's Extract-from-Document button.
  try {
    const nextIdx = quickDraft.indexOf(null);

    if (nextIdx === -1) {
      panel.style.display = "none";
      quickDraftSuggestOpen = false;
      setStatus("Quick Draft is already full (5/5)");
      return;
    }

    label.textContent = `for Slot ${nextIdx + 1}`;

    const hintEl = document.getElementById("quickdraft-element-hint");
    const hints = [qdBanProtectHint(), qdChainHint(nextIdx)].filter(Boolean);
    if (hints.length) { hintEl.innerHTML = hints.join("<br>"); hintEl.style.display = "block"; }
    else { hintEl.style.display = "none"; }

    renderQuickDraftSuggestionsInner(nextIdx, listEl, panel);
  } catch (err) {
    listEl.innerHTML = `<div class="qd-suggest-empty" style="color:#ff6b6b; text-align:left; white-space:pre-wrap; font-family:monospace; font-size:11px;">⚠️ Suggest crashed:\n${(err && err.stack) || err}</div>`;
    panel.style.display = "block";
    quickDraftSuggestOpen = true;
  }
}

function renderQuickDraftSuggestionsInner(nextIdx, listEl, panel) {
  const scored = qdSuggestForNextSlot();

  if (scored.length === 0) {
    listEl.innerHTML = `<div class="qd-suggest-empty">No more heroes left in your Roster to suggest.</div>`;
  } else {
    listEl.innerHTML = scored.map((s, rank) => {
      const h = s.hero;
      const portrait = h.iconData ? `<img src="${h.iconData}">` : "⚔️";
      const topReasons = s.reasons.slice(0, 2).join(" · ");
      const nameSuffix = s.variant === "ghost" ? " (Ghost)" : "";
      return `
        <div class="qd-suggest-row${rank === 0 ? " best" : ""}" data-id="${s.heroId}" data-variant="${s.variant}">
          <div class="qd-suggest-portrait">${portrait}</div>
          <div class="qd-suggest-info">
            <div class="qd-suggest-name">${rank === 0 ? "👑 " : ""}${h.name || "Unnamed"}${nameSuffix}</div>
            <div class="qd-suggest-reasons">${topReasons}</div>
          </div>
          <div class="qd-suggest-score">${s.score.toFixed(1)}</div>
        </div>`;
    }).join("");

    listEl.querySelectorAll(".qd-suggest-row").forEach(row => {
      row.addEventListener("click", () => {
        addToQuickDraft(Number(row.dataset.id), row.dataset.variant);
        if (quickDraft.indexOf(null) !== -1) renderQuickDraftSuggestions();
        else { panel.style.display = "none"; quickDraftSuggestOpen = false; }
      });
    });
  }

  panel.style.display = "block";
  quickDraftSuggestOpen = true;
}

/* ═══════════════════════════════════════
   RENDER
═══════════════════════════════════════ */
function renderAll() {
  renderChart();
  renderRoster();
  renderQuickDraft();
  if (document.getElementById("visibility-modal-overlay").classList.contains("open")) {
    renderVisibilityPanel();
  }
  if (circleSel) renderCircleSelect();
  if (magnifierOpen) renderMagnifier();
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

/* ── Capture the chart (grid, axis labels, quadrant labels, and every
   hero icon currently on it) and download it as a JPG. Uses html2canvas
   since the chart is plain DOM/CSS, not a single canvas element. ── */
function captureChartImage() {
  const btn = document.getElementById("btn-capture-chart");
  if (btn.dataset.busy === "1") return; // guard against double-clicks
  if (typeof html2canvas !== "function") {
    alert("Image capture library failed to load — check your connection and try again.");
    return;
  }

  const chartOuter   = document.querySelector(".chart-outer");
  const optionsBar   = document.querySelector(".chart-options-bar");
  const circlePanel  = document.getElementById("circle-control-panel");
  const circleRing   = document.getElementById("circle-select-ring");

  // Hide the floating UI chrome that sits inside .chart-outer so the
  // exported image only shows the chart itself, then restore afterward.
  const restoreDisplay = [];
  [optionsBar, circlePanel].forEach(el => {
    if (el) { restoreDisplay.push([el, el.style.display]); el.style.display = "none"; }
  });
  let ringWasHidden = false;
  if (circleRing && circleRing.style.display !== "none") {
    ringWasHidden = true;
    circleRing.style.display = "none";
  }

  btn.dataset.busy = "1";
  btn.classList.add("active");

  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#04090f";

  html2canvas(chartOuter, {
    backgroundColor: bg,
    scale: Math.min(3, (window.devicePixelRatio || 1) * 2),
    useCORS: true,
    logging: false
  }).then(canvas => {
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    link.download = `hero-chart-${stamp}.jpg`;
    link.href = canvas.toDataURL("image/jpeg", 0.95);
    document.body.appendChild(link);
    link.click();
    link.remove();
  }).catch(err => {
    console.error("Chart capture failed:", err);
    alert("Sorry, capturing the chart image failed. Please try again.");
  }).finally(() => {
    restoreDisplay.forEach(([el, val]) => { el.style.display = val; });
    if (ringWasHidden) circleRing.style.display = "";
    btn.dataset.busy = "0";
    btn.classList.remove("active");
  });
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
  if (dotMode)       cls += " dot-mode";

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

  if (dotMode && !isGhost) {
    // Dot mode: plain coloured circle keyed to element, no artwork
    inner.style.background = ELEMENT_DOT_COLORS[h.element] || ELEMENT_DOT_COLORS[""];
  } else if (h.iconData) {
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
  const displayName = dotMode ? shortenHeroName(h.name) : (h.name || "Hero");
  label.textContent = isGhost ? "👻 " + displayName : displayName;

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

/* ═══════════════════════════════════════
   CIRCLE SELECT + MAGNIFIER
═══════════════════════════════════════ */

// Heroes (visible, non-ghost primary position) whose distance from the
// circle centre is within its radius — all in chart percent coordinates.
function getHeroesInCircle() {
  if (!circleSel) return [];
  return heroes.filter(h => {
    if (h.hidden) return false;
    const { x, y } = scoresToXY(h.vType || "SPD", h.vScore || 0, h.hType || "SUR", h.hScore || 0);
    const dx = x - circleSel.cx, dy = y - circleSel.cy;
    return Math.sqrt(dx * dx + dy * dy) <= circleSel.r;
  });
}

function renderCircleSelect() {
  const ring  = document.getElementById("circle-select-ring");
  const panel = document.getElementById("circle-control-panel");
  if (!circleSel) {
    ring.style.display  = "none";
    panel.style.display = "none";
    return;
  }
  ring.style.display = "block";
  ring.style.left    = circleSel.cx + "%";
  ring.style.top     = circleSel.cy + "%";
  ring.style.width   = (circleSel.r * 2) + "%";
  ring.style.height  = (circleSel.r * 2) + "%";

  panel.style.display = "flex";
  document.getElementById("circle-radius-input").value = circleSel.r;
  const count = getHeroesInCircle().length;
  document.getElementById("circle-count-label").textContent = count + " hero" + (count === 1 ? "" : "s") + " in range";
}

function openMagnifier() {
  if (!circleSel) return;
  magnifierOpen = true;
  document.getElementById("magnifier-overlay").classList.add("open");
  renderMagnifier();
}

function closeMagnifier() {
  magnifierOpen = false;
  document.getElementById("magnifier-overlay").classList.remove("open");
}

function renderMagnifier() {
  if (!circleSel) { closeMagnifier(); return; }

  const inCircle = getHeroesInCircle();
  document.getElementById("magnifier-count-label").textContent =
    inCircle.length + " hero" + (inCircle.length === 1 ? "" : "s") + " in selection · radius " + circleSel.r.toFixed(0);

  renderMagnifierFilterBar(inCircle);

  const filtered = inCircle.filter(h =>
    !magnifierExcluded.rarity.has(h.rarity) &&
    !magnifierExcluded.role.has(h.role ?? "") &&
    !magnifierExcluded.element.has(h.element ?? "")
  );

  // ── Mini grid: remap each hero's position from the circle's bounding
  //    square (cx±r, cy±r) onto a fresh 0–100% square. This is a real
  //    re-plot on a cropped sub-grid, not a CSS zoom/scale of the main chart. ──
  const grid = document.getElementById("magnifier-grid");
  grid.querySelectorAll(".magnifier-dot").forEach(el => el.remove());

  const left = circleSel.cx - circleSel.r;
  const top  = circleSel.cy - circleSel.r;
  const size = circleSel.r * 2;

  filtered.forEach(h => {
    const { x, y } = scoresToXY(h.vType || "SPD", h.vScore || 0, h.hType || "SUR", h.hScore || 0);
    const nx = ((x - left) / size) * 100;
    const ny = ((y - top)  / size) * 100;
    grid.appendChild(buildMagnifierDot(h, nx, ny));
  });

  renderMagnifierList(filtered);
}

function buildMagnifierDot(h, x, y) {
  const meta = RARITY_META[h.rarity] || RARITY_META["5r"];
  const dot  = document.createElement("div");
  dot.className    = "hero-dot magnifier-dot" + (dotMode ? " dot-mode" : "");
  dot.style.left   = x + "%";
  dot.style.top    = y + "%";

  const inner = document.createElement("div");
  inner.className = "hero-dot-inner";
  inner.style.borderColor = meta.border;
  inner.style.boxShadow   = "0 0 10px " + meta.border + "66";

  if (dotMode) {
    inner.style.background = ELEMENT_DOT_COLORS[h.element] || ELEMENT_DOT_COLORS[""];
  } else if (h.iconData) {
    const img = document.createElement("img");
    img.src = h.iconData;
    img.style.cssText = "width:100%;height:100%;border-radius:50%;object-fit:cover;";
    inner.appendChild(img);
  } else {
    inner.textContent = "⚔️";
  }

  const label = document.createElement("div");
  label.className = "hero-dot-label";
  label.textContent = dotMode ? shortenHeroName(h.name) : (h.name || "Hero");

  dot.appendChild(inner);
  dot.appendChild(label);
  dot.addEventListener("click", e => { e.stopPropagation(); openHeroDetails(h); });
  return dot;
}

// Filter chips scoped only to the heroes currently inside the circle
function renderMagnifierFilterBar(inCircle) {
  const bar = document.getElementById("magnifier-filter-bar");

  const rarities = [...new Set(inCircle.map(h => h.rarity))];
  const roles    = [...new Set(inCircle.map(h => h.role ?? ""))];
  const elements = [...new Set(inCircle.map(h => h.element ?? ""))];

  function chip(val, excludedSet, label) {
    const active = !excludedSet.has(val);
    return `<button type="button" class="chip magnifier-chip${active ? " active" : ""}" data-val="${val}">${label}</button>`;
  }

  const groups = [];
  if (rarities.length > 1) {
    groups.push(`<div class="filter-group"><div class="filter-label">RARITY</div><div class="filter-chips" data-group="rarity">${
      rarities.map(v => chip(v, magnifierExcluded.rarity, (RARITY_META[v] || RARITY_META["5r"]).label)).join("")
    }</div></div>`);
  }
  if (roles.length > 1) {
    groups.push(`<div class="filter-group"><div class="filter-label">ROLE</div><div class="filter-chips" data-group="role">${
      roles.map(v => chip(v, magnifierExcluded.role, v || "— None —")).join("")
    }</div></div>`);
  }
  if (elements.length > 1) {
    groups.push(`<div class="filter-group"><div class="filter-label">ELEMENT</div><div class="filter-chips" data-group="element">${
      elements.map(v => chip(v, magnifierExcluded.element, v || "— None —")).join("")
    }</div></div>`);
  }

  bar.innerHTML = groups.join("") || `<div style="color:#607a90;font-size:11px;font-style:italic">All heroes shown — nothing to filter by.</div>`;

  bar.querySelectorAll(".magnifier-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const group = btn.parentElement.dataset.group;
      const val   = btn.dataset.val;
      const set   = magnifierExcluded[group];
      if (set.has(val)) set.delete(val); else set.add(val);
      renderMagnifier();
    });
  });
}

function renderMagnifierList(filtered) {
  const list = document.getElementById("magnifier-list");
  list.innerHTML = "";

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state">No heroes match the current filters.</div>`;
    return;
  }

  filtered.forEach(h => {
    const meta   = RARITY_META[h.rarity] || RARITY_META["5r"];
    const scores = xyToScores(h._x ?? 50, h._y ?? 50);
    const avg    = avgScore(scores.vScore, scores.hScore);

    const iconHTML = h.iconData
      ? `<div class="hero-card-icon"><img src="${h.iconData}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;"></div>`
      : `<div class="hero-card-icon">⚔️</div>`;
    const roleEl = h.role    ? `<span class="tag tag-role">${h.role}</span>`    : "";
    const elemEl = h.element ? `<span class="tag tag-elem">${h.element}</span>` : "";

    const card = document.createElement("div");
    card.className = "hero-card";
    card.innerHTML = `
      ${iconHTML}
      <div class="hero-card-info">
        <div class="hero-card-name">${h.name || "Unnamed Hero"}</div>
        <div class="hero-card-rarity" style="color:${meta.color}">${meta.label}</div>
        <div class="hero-card-tags">${roleEl}${elemEl}</div>
        <div class="hero-card-scores">
          <div class="scores-row">
            <span class="score-badge">${scores.vType} ${scores.vScore}</span>
            <span class="score-badge">${scores.hType} ${scores.hScore}</span>
            <span class="score-badge avg">Avg ${avg}</span>
          </div>
        </div>
      </div>`;
    card.addEventListener("click", () => openHeroDetails(h));
    list.appendChild(card);
  });
}

function renderRoster() {
  document.querySelectorAll(".hero-card").forEach(el => el.remove());

  // Sort
  let list = [...heroes];
  if (rosterSort === "az")        list.sort((a,b) => (a.name||"").localeCompare(b.name||""));
  else if (rosterSort === "za")   list.sort((a,b) => (b.name||"").localeCompare(a.name||""));
  else if (rosterSort === "date-asc")  list.sort((a,b) => a.id - b.id);
  else if (rosterSort === "rank-desc") list.sort((a,b) => rankValue(b) - rankValue(a));
  else if (rosterSort === "rank-asc")  list.sort((a,b) => rankValue(a) - rankValue(b));
  else                                 list.sort((a,b) => b.id - a.id);

  // Filter — role/element use exact value; "" matches unassigned heroes via "None" chip
  list = list.filter(h =>
    filterRarity.has(h.rarity) &&
    filterRole.has(h.role ?? "") &&
    filterElement.has(h.element ?? "")
  );

  // Search — case-insensitive substring match on hero name
  if (rosterSearchQuery) {
    const q = rosterSearchQuery.toLowerCase();
    list = list.filter(h => (h.name || "").toLowerCase().includes(q));
  }

  emptyMsg.style.display = list.length === 0 ? "block" : "none";
  if (list.length === 0) {
    emptyMsg.innerHTML = heroes.length === 0
      ? "No heroes yet.<br>Tap ＋ Hero to add one."
      : "No heroes match your search/filters.";
  }

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
        <button class="icon-btn btn-quickdraft-add${qdHeroInDraft(h.id) ? " active" : ""}" title="${qdHeroInDraft(h.id) ? "Remove from Quick Draft" : "Add to Quick Draft"}">
          ${qdHeroInDraft(h.id)
            ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`}
        </button>
      </div>`;

    card.querySelector(".btn-view").addEventListener("click", e => { e.stopPropagation(); openHeroDetails(h); });
    card.querySelector(".btn-quickdraft-add").addEventListener("click", e => {
      e.stopPropagation();
      if (qdHeroInDraft(h.id)) removeFromQuickDraft(h.id);
      else addToQuickDraft(h.id);
    });
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

// Turns a hero name into a safe filename slug, e.g. "Lots of Legend Yufine!" -> "lots-of-legend-yufine"
function slugifyName(name) {
  return (name || "hero")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "hero";
}

// If iconData is a freshly-pasted/uploaded/cropped image, it'll be a base64
// data: URL. Upload it to assets/heroes/ on GitHub and swap in the raw URL
// instead, so we never store base64 blobs in e7_data.json. If it's already
// a URL (unchanged existing icon, or no icon at all), leave it as-is.
async function uploadIconIfNeeded(name, iconData) {
  if (!iconData || !iconData.startsWith("data:")) return iconData;
  const filename = `${slugifyName(name)}.webp`;
  const password = getCachedAdminPassword();
  const res = await fetch("https://e7-chart.vercel.app/api/upload-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: iconData, folder: "heroes", filename, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) clearCachedAdminPassword();
    throw new Error(data.error || "Icon upload failed");
  }
  return data.url;
}

async function onModalConfirm() {
  const name     = fName.value.trim() || "Unnamed Hero";
  const rarity   = fRarity.value;
  const role     = fRole.value;
  const element  = fElement.value;
  const vType    = fVType.value;
  const vScore   = Math.max(0, Math.min(10, parseFloat(fVScore.value) || 0));
  const hType    = fHType.value;
  const hScore   = Math.max(0, Math.min(10, parseFloat(fHScore.value) || 0));
  const notes    = fNotes.value.trim();
  let   iconData = fIconData.value || null;
  const locked   = document.getElementById("f-locked").checked;

  // Upload any new pasted/cropped image to GitHub before saving the hero,
  // so heroes[] and e7_data.json only ever hold a small URL, not base64.
  if (iconData && iconData.startsWith("data:")) {
    modalConfirm.disabled = true;
    setStatus("⏳ Uploading icon…", 0);
    try {
      iconData = await uploadIconIfNeeded(name, iconData);
    } catch (e) {
      setStatus("❌ " + e.message);
      modalConfirm.disabled = false;
      return;
    }
    modalConfirm.disabled = false;
    setStatus("✅ Icon uploaded");
  }

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

/* ── Origin legend (plus-sign popup) ──
   Explains what a score of 0 means on each axis. Triggered by clicking
   the origin dot at chart center — Dot Mode only, see wiring above. */
function openOriginLegend() {
  document.getElementById("origin-legend-overlay").classList.add("open");
}
function closeOriginLegend() {
  document.getElementById("origin-legend-overlay").classList.remove("open");
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
   FULL-SCREEN AXIS SLIDERS
   Visual drag-to-set popups for the Horizontal (SUR/SST) and
   Vertical (SPD/TNK) score fields on the Add/Edit Hero form.

   Internally each slider works on a single unified position `p`
   from -10..+10, then converts back to {type, score} on apply:
     X axis: p<0 → SUR side, p>0 → SST side, 0 = midpoint
     Y axis: p>0 → SPD side (top), p<0 → TNK side (bottom), 0 = midpoint
═══════════════════════════════════════ */

const SUR_DESC = {
  10: "Can survive in a 1v4 without support",
  9:  "Can survive in a 1v3 without support",
  8:  "Can survive in a 1v2 without support",
  7:  "Can survive in a 1v1 without support",
  6:  "Can survive in a 1v4 with support",
  5:  "Can survive in a 1v3 with support",
  4:  "Can survive in a 1v2 with support",
  3:  "Can survive in a 1v1 with support",
  2:  "Requires support to survive",
  1:  "Cannot survive without any support",
  0:  "Cannot survive or sustain at all.",
};
const SST_DESC = {
  0:  "Cannot survive or sustain at all.",
  1:  "Cannot sustain without any support",
  2:  "Requires support to sustain",
  3:  "Can sustain in a 1v1 with support",
  4:  "Can sustain in a 1v2 with support",
  5:  "Can sustain in a 1v3 with support",
  6:  "Can sustain in a 1v4 with support",
  7:  "Can sustain in a 1v1 without support",
  8:  "Can sustain in a 1v2 without support",
  9:  "Can sustain in a 1v3 without support",
  10: "Can sustain in a 1v4 without support",
};
const SPD_DESC = {
  10: "Can gain 3 turns effectively.",
  9:  "Can gain 2 turns effectively.",
  8:  "Can gain 1 turn effectively.",
  7:  "Can gain 50% CR / equivalent of that speed effectively",
  6:  "Can gain 40% CR / equivalent of that speed effectively",
  5:  "Can gain 30% CR / equivalent of that speed effectively",
  4:  "Can gain 20% CR / equivalent of that speed effectively",
  3:  "Can gain 10% CR / equivalent of that speed effectively",
  2:  "Can gain 5% CR or less / equivalent of that speed effectively",
  1:  "Cannot gain CR efficiently / lack of speed",
  0:  "No speed / tanky at all.",
};
const TNK_DESC = {
  0:  "No speed / tanky at all.",
  1:  "No in-built tankiness",
  2:  "Has one of HP / DEF / SHD",
  3:  "Has one of HP / DEF / SHD + minor defensive utility",
  4:  "Has two of HP / DEF / SHD",
  5:  "Has HP / DEF / SHD + Tank Passive",
  6:  "Has two of HP / DEF / SHD + Damage Prevention OR Tank Passive",
  7:  "Has two of HP / DEF / SHD + Tank Passive",
  8:  "Has two of HP / DEF / SHD + Damage Prevention + Tank Passive",
  9:  "Has all three HP / DEF / SHD + either Damage Prevention OR Tank Passive",
  10: "Has HP + DEF + SHD + Damage Prevention + Tank Passive",
};

let xSliderState = { p: 0, fine: false, dragging: false, mode: "main" };
let ySliderState = { p: 0, fine: false, dragging: false, mode: "main" };

/* ── conversions between the form's {type, score} model and unified p ── */
function hFields(mode) {
  return mode === "alt"
    ? { type: document.getElementById("f-alt-h-type"), score: document.getElementById("f-alt-h-score") }
    : { type: fHType, score: fHScore };
}
function vFields(mode) {
  return mode === "alt"
    ? { type: document.getElementById("f-alt-v-type"), score: document.getElementById("f-alt-v-score") }
    : { type: fVType, score: fVScore };
}

function hToP(hType, hScore) {
  const s = Math.max(0, Math.min(10, Number(hScore) || 0));
  if (s === 0) return 0;
  return hType === "SST" ? s : -s;
}
function pToH(p, mode) {
  const r = Math.round(p * 10) / 10;
  if (r === 0) return { hType: hFields(mode).type.value || "SUR", hScore: 0 };
  return r > 0 ? { hType: "SST", hScore: r } : { hType: "SUR", hScore: -r };
}
function vToP(vType, vScore) {
  const s = Math.max(0, Math.min(10, Number(vScore) || 0));
  if (s === 0) return 0;
  return vType === "SPD" ? s : -s;
}
function pToV(p, mode) {
  const r = Math.round(p * 10) / 10;
  if (r === 0) return { vType: vFields(mode).type.value || "SPD", vScore: 0 };
  return r > 0 ? { vType: "SPD", vScore: r } : { vType: "TNK", vScore: -r };
}

function sliderQuantize(p, fine) {
  const clamped = Math.max(-10, Math.min(10, p));
  return fine ? Math.round(clamped * 10) / 10 : Math.round(clamped);
}

/* ── ticks ── */
function buildAxisTicksX(container) {
  let html = "";
  for (let i = -10; i <= 10; i++) {
    const pct = ((i + 10) / 20) * 100;
    const cls = i === 0 ? "axis-tick axis-tick-mid" : (i % 5 === 0 ? "axis-tick axis-tick-major" : "axis-tick");
    html += `<div class="${cls}" style="left:${pct}%"><span class="axis-tick-label">${Math.abs(i)}</span></div>`;
  }
  container.innerHTML = html;
}
function buildAxisTicksY(container) {
  let html = "";
  for (let i = -10; i <= 10; i++) {
    const pct = ((10 - i) / 20) * 100;
    const cls = i === 0 ? "axis-tick-y axis-tick-mid" : (i % 5 === 0 ? "axis-tick-y axis-tick-major" : "axis-tick-y");
    html += `<div class="${cls}" style="top:${pct}%"><span class="axis-tick-label-y">${Math.abs(i)}</span></div>`;
  }
  container.innerHTML = html;
}

/* ── portrait preview. Defaults to whatever icon is currently on the form;
   pass iconSrc explicitly (e.g. for neighbor previews) to draw a different
   hero's icon instead. ── */
function drawSliderPortrait(canvasEl, iconSrc) {
  const ctx  = canvasEl.getContext("2d");
  const size = canvasEl.width || 128;
  ctx.clearRect(0, 0, size, size);
  const src = iconSrc !== undefined ? iconSrc : fIconData.value;
  if (!src) {
    ctx.fillStyle = "#1a3050";
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2); ctx.fill();
    return;
  }
  const img = new Image();
  img.onload = () => {
    ctx.save();
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(img, 0, 0, size, size);
    ctx.restore();
  };
  img.src = src;
}

/* ── Live "who's above/below" lookup for the axis sliders ──
   Returns the closest hero on each side of `targetP` on the unified -10..10
   scale, so it works whether the neighbor uses the opposite type (e.g.
   SUR vs SST) — same trick the {h,v}ToP conversions already use elsewhere.
   In "alt" (ghost) mode it compares against other heroes' ghost stats,
   since that's the more meaningful comparison for a ghost value. */
function heroAxisP(h, axis, mode) {
  if (mode === "alt") {
    if (!h.altStats) return null;
    return axis === "h" ? hToP(h.altStats.hType, h.altStats.hScore) : vToP(h.altStats.vType, h.altStats.vScore);
  }
  return axis === "h" ? hToP(h.hType, h.hScore) : vToP(h.vType, h.vScore);
}
function getSliderNeighbors(axis, mode, targetP) {
  let below = null, belowP = -Infinity;
  let above = null, aboveP = Infinity;
  heroes.forEach(h => {
    if (h.id === editingId) return;
    const s = heroAxisP(h, axis, mode);
    if (s === null) return;
    if (s < targetP && s > belowP) { belowP = s; below = h; }
    if (s > targetP && s < aboveP) { aboveP = s; above = h; }
  });
  return {
    below: below ? { hero: below, p: belowP } : null,
    above: above ? { hero: above, p: aboveP } : null,
  };
}

/* Clamp one neighbor's pixel position: keep it on its correct side of the
   handle (at least minGap away, so it never crosses over/collides with the
   handle or its sibling — this is what keeps things safe when two heroes'
   real values are only 0.1 apart), then keep it inside the visible track
   so it never gets cut off, however close to an edge the handle is. */
function clampNeighborPx(desired, center, sign, minGap, half, lo, hi) {
  let px = sign > 0 ? Math.max(desired, center + minGap) : Math.min(desired, center - minGap);
  return Math.max(lo + half, Math.min(hi - half, px));
}

/* Fill in one neighbor preview (or hide it if there's no hero on that side) */
function paintNeighbor(elId, labelId, canvasId, entry, axis) {
  const el = document.getElementById(elId);
  if (!entry) {
    el.classList.add("is-hidden");
    return;
  }
  el.classList.remove("is-hidden");
  const h    = entry.hero;
  const val  = Math.abs(Math.round(entry.p * 10) / 10).toFixed(1);
  const type = axis === "h" ? (entry.p < 0 ? "SUR" : "SST") : (entry.p > 0 ? "SPD" : "TNK");
  document.getElementById(labelId).innerHTML =
    `<span class="aneigh-stat">${type} ${val}</span><span class="aneigh-name">${h.name || "Unnamed"}</span>`;
  drawSliderPortrait(document.getElementById(canvasId), h.iconData || "");
}

function pulseNode(el) {
  el.classList.remove("snap-pulse");
  void el.offsetWidth; // restart animation
  el.classList.add("snap-pulse");
}

/* ── X (horizontal) slider ── */
function renderXSlider() {
  const p   = xSliderState.p;
  const pct = ((p + 10) / 20) * 100;

  document.getElementById("xslider-handle").style.left   = pct + "%";
  document.getElementById("xslider-portrait").style.left = pct + "%";

  const fill = document.getElementById("xslider-fill");
  const left = Math.min(50, pct);
  fill.style.left  = left + "%";
  fill.style.width = Math.abs(pct - 50) + "%";

  const fine    = xSliderState.fine;
  const dispVal = Math.abs(fine ? Math.round(p * 10) / 10 : Math.round(p));
  const side    = p < 0 ? "SUR" : (p > 0 ? "SST" : (hFields(xSliderState.mode).type.value === "SST" ? "SST" : "SUR"));
  document.getElementById("xslider-readout-num").textContent = `${side} ${dispVal.toFixed(fine ? 1 : 0)}`;

  const key   = Math.max(0, Math.min(10, Math.round(Math.abs(p))));
  const table = p <= 0 ? SUR_DESC : SST_DESC;
  document.getElementById("xslider-desc").textContent = table[key] || "";

  layoutXNeighbors(pct);
}

/* Position + paint the two flanking previews. They dock a fixed pixel
   distance to either side of the handle (not at their own literal value
   position) and are clamped to stay inside the track — this is what keeps
   them from ever overlapping each other, the handle, or their own text,
   even when the real values are 0.1 apart or the handle sits at an
   extreme (-10/+10) edge of the track. Runs on every drag frame so the
   identity of "closest below/above" stays live as the value moves. */
function layoutXNeighbors(pct) {
  const track = document.getElementById("xslider-track");
  const w     = track.clientWidth;
  if (!w) return;
  const narrow  = window.innerWidth <= 720;
  const offset  = narrow ? 38 : 62;
  const minGap  = narrow ? 34 : 36;
  const half    = narrow ? 26 : 42; // half-width of a neighbor block, incl. label
  const centerPx = (pct / 100) * w;

  const { below, above } = getSliderNeighbors("h", xSliderState.mode, xSliderState.p);

  const belowPx = clampNeighborPx(centerPx - offset, centerPx, -1, minGap, half, 0, w);
  const abovePx = clampNeighborPx(centerPx + offset, centerPx, +1, minGap, half, 0, w);

  document.getElementById("xslider-neighbor-below").style.left = belowPx + "px";
  document.getElementById("xslider-neighbor-above").style.left = abovePx + "px";

  paintNeighbor("xslider-neighbor-below", "xslider-neighbor-below-label", "xslider-neighbor-below-canvas", below, "h");
  paintNeighbor("xslider-neighbor-above", "xslider-neighbor-above-label", "xslider-neighbor-above-canvas", above, "h");
}

function xSliderPToClientX(clientX) {
  const rect = document.getElementById("xslider-track").getBoundingClientRect();
  let frac = (clientX - rect.left) / rect.width;
  frac = Math.max(0, Math.min(1, frac));
  return frac * 20 - 10;
}

function xSliderPointerDown(e) {
  e.preventDefault();
  const track = document.getElementById("xslider-track");
  track.setPointerCapture(e.pointerId);
  xSliderState.dragging = true;
  updateXSliderFromClientX(e.clientX);
}
function xSliderPointerMove(e) {
  if (!xSliderState.dragging) return;
  updateXSliderFromClientX(e.clientX);
}
function xSliderPointerUp() {
  xSliderState.dragging = false;
}
function updateXSliderFromClientX(clientX) {
  const raw = xSliderPToClientX(clientX);
  const q   = sliderQuantize(raw, xSliderState.fine);
  const changed = q !== xSliderState.p;
  xSliderState.p = q;
  renderXSlider();
  if (changed && !xSliderState.fine) {
    pulseNode(document.getElementById("xslider-handle"));
    pulseNode(document.getElementById("xslider-portrait"));
  }
}

function openXSlider(mode) {
  xSliderState.dragging = false;
  xSliderState.fine     = false;
  xSliderState.mode     = mode || "main";
  const { type, score } = hFields(xSliderState.mode);
  xSliderState.p = hToP(type.value, parseFloat(score.value) || 0);
  document.getElementById("xslider-fine-toggle").checked = false;
  document.getElementById("xslider-track").classList.remove("fine-mode");
  document.getElementById("xslider-overlay").querySelector(".axis-slider-screen")
    .classList.toggle("ghost-mode", xSliderState.mode === "alt");
  buildAxisTicksX(document.getElementById("xslider-ticks"));
  drawSliderPortrait(document.getElementById("xslider-portrait-canvas"));
  document.getElementById("xslider-overlay").classList.add("open");
  renderXSlider(); // after "open" so the track has real dimensions for neighbor layout
}
function closeXSlider() {
  document.getElementById("xslider-overlay").classList.remove("open");
}
function applyXSlider() {
  const { hType, hScore } = pToH(xSliderState.p, xSliderState.mode);
  const { type, score }   = hFields(xSliderState.mode);
  type.value  = hType;
  score.value = (Math.round(hScore * 10) / 10).toFixed(1);
  closeXSlider();
}

/* ── Y (vertical) slider ── */
function renderYSlider() {
  const p   = ySliderState.p;
  const pct = ((10 - p) / 20) * 100;

  document.getElementById("yslider-handle").style.top     = pct + "%";
  document.getElementById("yslider-side-panel").style.top = pct + "%";

  const fill = document.getElementById("yslider-fill");
  const top  = Math.min(50, pct);
  fill.style.top    = top + "%";
  fill.style.height = Math.abs(pct - 50) + "%";

  const fine    = ySliderState.fine;
  const dispVal = Math.abs(fine ? Math.round(p * 10) / 10 : Math.round(p));
  const side    = p > 0 ? "SPD" : (p < 0 ? "TNK" : (vFields(ySliderState.mode).type.value === "TNK" ? "TNK" : "SPD"));
  document.getElementById("yslider-readout-num").textContent = `${side} ${dispVal.toFixed(fine ? 1 : 0)}`;

  const key   = Math.max(0, Math.min(10, Math.round(Math.abs(p))));
  const table = p >= 0 ? SPD_DESC : TNK_DESC;
  document.getElementById("yslider-desc").textContent = table[key] || "";

  layoutYNeighbors(pct);
}

/* Same fixed-offset docking approach as layoutXNeighbors, just vertical:
   the "above" (higher-value) neighbor docks above the handle, the "below"
   one docks under it, both clamped to stay inside the track and never
   cross past the handle — which is what keeps the whole 3-portrait cluster
   readable and centered around the handle no matter how tall the track is
   or how close to an edge the handle sits. */
function layoutYNeighbors(pct) {
  const track = document.getElementById("yslider-track");
  const h     = track.clientHeight;
  if (!h) return;
  const narrow  = window.innerWidth <= 720;
  const offset  = narrow ? 46 : 58;
  const minGap  = narrow ? 30 : 40;
  const half    = narrow ? 18 : 24; // half-height of a neighbor row
  const centerPx = (pct / 100) * h;

  const { below, above } = getSliderNeighbors("v", ySliderState.mode, ySliderState.p);

  // below-value → lower on screen (larger px); above-value → higher (smaller px)
  const belowPx = clampNeighborPx(centerPx + offset, centerPx, +1, minGap, half, 0, h);
  const abovePx = clampNeighborPx(centerPx - offset, centerPx, -1, minGap, half, 0, h);

  document.getElementById("yslider-neighbor-below").style.top = belowPx + "px";
  document.getElementById("yslider-neighbor-above").style.top = abovePx + "px";

  paintNeighbor("yslider-neighbor-below", "yslider-neighbor-below-label", "yslider-neighbor-below-canvas", below, "v");
  paintNeighbor("yslider-neighbor-above", "yslider-neighbor-above-label", "yslider-neighbor-above-canvas", above, "v");
}

function ySliderPFromClientY(clientY) {
  const rect = document.getElementById("yslider-track").getBoundingClientRect();
  let frac = (clientY - rect.top) / rect.height;
  frac = Math.max(0, Math.min(1, frac));
  return 10 - frac * 20;
}

function ySliderPointerDown(e) {
  e.preventDefault();
  const track = document.getElementById("yslider-track");
  track.setPointerCapture(e.pointerId);
  ySliderState.dragging = true;
  updateYSliderFromClientY(e.clientY);
}
function ySliderPointerMove(e) {
  if (!ySliderState.dragging) return;
  updateYSliderFromClientY(e.clientY);
}
function ySliderPointerUp() {
  ySliderState.dragging = false;
}
function updateYSliderFromClientY(clientY) {
  const raw = ySliderPFromClientY(clientY);
  const q   = sliderQuantize(raw, ySliderState.fine);
  const changed = q !== ySliderState.p;
  ySliderState.p = q;
  renderYSlider();
  if (changed && !ySliderState.fine) {
    pulseNode(document.getElementById("yslider-handle"));
    pulseNode(document.getElementById("yslider-side-panel"));
  }
}

function openYSlider(mode) {
  ySliderState.dragging = false;
  ySliderState.fine     = false;
  ySliderState.mode     = mode || "main";
  const { type, score } = vFields(ySliderState.mode);
  ySliderState.p = vToP(type.value, parseFloat(score.value) || 0);
  document.getElementById("yslider-fine-toggle").checked = false;
  document.getElementById("yslider-track").classList.remove("fine-mode");
  document.getElementById("yslider-overlay").querySelector(".axis-slider-screen")
    .classList.toggle("ghost-mode", ySliderState.mode === "alt");
  buildAxisTicksY(document.getElementById("yslider-ticks"));
  drawSliderPortrait(document.getElementById("yslider-portrait-canvas"));
  document.getElementById("yslider-overlay").classList.add("open");
  renderYSlider(); // after "open" so the track has real dimensions for neighbor layout
}
function closeYSlider() {
  document.getElementById("yslider-overlay").classList.remove("open");
}
function applyYSlider() {
  const { vType, vScore } = pToV(ySliderState.p, ySliderState.mode);
  const { type, score }   = vFields(ySliderState.mode);
  type.value  = vType;
  score.value = (Math.round(vScore * 10) / 10).toFixed(1);
  closeYSlider();
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
    heroes = migrateHeroTypes(heroes);
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
      heroes = migrateHeroTypes(heroes);

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
      heroes = migrateHeroTypes(data.heroes);
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
