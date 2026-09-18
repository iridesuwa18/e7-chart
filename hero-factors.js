/* ═══════════════════════════════════════════════════════════════════
   HERO FACTORS

   A fullscreen hero grid, filterable by Reaction, Engagement, overall
   score, Ranking Category, and — reusing the exact same scoring
   qdSimpleScoreEntry() already uses for Quick Draft's own
   suggestions — whichever Enemy Factors are currently ticked
   (qdTickedFactorIds, shared global state from app.js's Section 8.1).
   Ticking/untying Factors happens in the existing Enemy Factors picker
   itself; this panel reads that same state rather than keeping its
   own separate copy, so the two never drift out of sync — see the
   "🎯 Edit Enemy Factors" shortcut below.

   Deliberately its own file/script tag (loaded after app.js, sharing
   its top-level `let`/`function` scope the same way multiple classic
   <script> tags on one page always do) rather than folded into app.js,
   which was already getting large. Everything in here uses an hf/Hf
   naming prefix to keep it visually distinct from app.js's own qd
   naming.

   Shell markup/CSS is intentionally the same .qd-factor-menu-overlay/
   -panel pattern the Enemy Factors picker and the taxonomy score
   slider already use (see ensureQdFactorMenu in app.js) — a fullscreen
   sheet on phones, a large centered modal on wider screens — so this
   looks like a natural part of the app rather than a bolted-on
   widget. style.css has a small .hf-* section for the parts that
   pattern doesn't already cover (the grid itself, tile scoring color,
   the wider panel).
═══════════════════════════════════════════════════════════════════ */

// ── Ranking Categories ──────────────────────────────────────────────
// Purely derived from Reaction/Engagement names — nothing stored. Any
// taxonomy item named "CATEGORY : description" contributes CATEGORY
// (exact text before the first colon, trimmed, case preserved as
// typed) as a category; items with no colon simply don't belong to
// one. Recomputed fresh every time the panel opens/re-renders, so
// renaming an item in 🗂 Taxonomy is reflected immediately with
// nothing else to keep in sync.
function hfCategoryOf(name) {
  const raw = String(name || "");
  const i = raw.indexOf(":");
  if (i === -1) return null;
  const cat = raw.slice(0, i).trim();
  return cat || null;
}

function hfAllRankingCategories() {
  const set = new Set();
  [...taxonomy.reactions, ...taxonomy.engagements].forEach(item => {
    const cat = hfCategoryOf(item.name);
    if (cat) set.add(cat);
  });
  return [...set].sort((a, b) => a.localeCompare(b));
}

// Every Reaction/Engagement whose name resolves to this category —
// matching a category means holding at least one of these.
function hfItemsInCategory(cat) {
  return [
    ...taxonomy.reactions.filter(r => hfCategoryOf(r.name) === cat).map(r => ({ kind: "reactions", id: r.id })),
    ...taxonomy.engagements.filter(e => hfCategoryOf(e.name) === cat).map(e => ({ kind: "engagements", id: e.id })),
  ];
}

// ── Filter state — session-only, resets on page load like the rest
//    of Quick Draft's scratch state (qdBanProtectElement etc). ──────
let hfFilters = {
  reactionIds: new Set(),
  engagementIds: new Set(),
  categories: new Set(),
  minScore: 0,
};
let hfSearchQuery = "";
let hfReactionSearch = "";
let hfEngagementSearch = "";
let hfMenuEl = null;

function hfHeroHasTag(h, kind, id) {
  return (Array.isArray(h[kind]) ? h[kind] : []).some(x => (x.refId ?? x) === id);
}

function hfHeroMatchesCategory(h, cat) {
  return hfItemsInCategory(cat).some(ref => hfHeroHasTag(h, ref.kind, ref.id));
}

// The single filtered + scored + sorted list the grid renders from.
// Filters (name search, Reaction/Engagement ticks, Ranking Category
// ticks, min score) are ANDed together first; scoring/ordering is
// layered on top exactly the way the feature was asked for — Factor
// mode (any Enemy Factor ticked) ranks by qdSimpleScoreEntry's Factor
// score and drops any hero matching none of the ticked Factors at
// all (same exclusion Quick Draft's own suggestion list already
// applies), falling back to plain overall kit score when nothing's
// ticked.
function hfFilteredHeroes() {
  let list = heroes.slice();

  if (hfSearchQuery.trim()) {
    const q = hfSearchQuery.trim().toLowerCase();
    list = list.filter(h => (h.name || "").toLowerCase().includes(q));
  }
  if (hfFilters.reactionIds.size) {
    list = list.filter(h => [...hfFilters.reactionIds].some(id => hfHeroHasTag(h, "reactions", id)));
  }
  if (hfFilters.engagementIds.size) {
    list = list.filter(h => [...hfFilters.engagementIds].some(id => hfHeroHasTag(h, "engagements", id)));
  }
  if (hfFilters.categories.size) {
    list = list.filter(h => [...hfFilters.categories].some(cat => hfHeroMatchesCategory(h, cat)));
  }
  if (hfFilters.minScore > 0) {
    list = list.filter(h => qdOverallKitScore(h, "primary") >= hfFilters.minScore);
  }

  const factorMode = qdTickedFactorIds.size > 0;
  const scored = list.map(h => {
    const entry = factorMode ? qdSimpleScoreEntry(h, "primary") : null;
    if (factorMode && !entry) return null; // no match on any ticked Factor — excluded, same as Quick Draft's own list
    return {
      hero: h,
      score: entry ? entry.score : qdOverallKitScore(h, "primary"),
      reasons: entry ? entry.reasons : [],
    };
  }).filter(Boolean);

  scored.sort((a, b) => b.score - a.score || (a.hero.name || "").localeCompare(b.hero.name || ""));
  return scored;
}

// ── Menu shell ───────────────────────────────────────────────────────
function ensureHeroFactorsMenu() {
  if (hfMenuEl) return hfMenuEl;

  const overlay = document.createElement("div");
  overlay.className = "qd-factor-menu-overlay";
  overlay.id = "hero-factors-overlay";
  overlay.style.display = "none";
  overlay.innerHTML = `<div class="qd-factor-menu-panel hf-panel" id="hero-factors-panel"></div>`;
  document.body.appendChild(overlay);
  hfMenuEl = overlay;

  overlay.addEventListener("click", e => { if (e.target === overlay) hfClose(); });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && overlay.style.display !== "none") hfClose();
  });

  return overlay;
}

function hfOpen() {
  const overlay = ensureHeroFactorsMenu();
  renderHeroFactorsPanel();
  overlay.style.display = "flex";
  document.body.classList.add("qd-factor-menu-open");
  document.getElementById("hf-search")?.focus();
}

function hfClose() {
  if (!hfMenuEl) return;
  hfMenuEl.style.display = "none";
  document.body.classList.remove("qd-factor-menu-open");
}

// Called from app.js whenever Enemy Factors state changes (ticked,
// untied, prioritized, or a score/Factor edited) — cheap no-op unless
// the panel is actually open right now.
function hfRefreshIfOpen() {
  if (!hfMenuEl || hfMenuEl.style.display === "none") return;
  renderHfFactorStatus(); // ticks/priorities may have changed from outside this panel
  renderHeroFactorsGrid();
}

// Builds/updates the "🧬 Hero Factors ▾" trigger button (mirrors
// renderQdFactorChips' own button-wiring pattern in app.js) and, if
// the panel happens to be open already, refreshes it too. Guarded the
// same way every other optional per-page control in app.js is — not
// every page that includes this script necessarily has the button.
function renderHeroFactorsButton() {
  const btn = document.getElementById("hero-factors-menu-btn");
  if (!btn) return;

  ensureHeroFactorsMenu();

  if (!btn.dataset.wired) {
    btn.dataset.wired = "1";
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const isOpen = hfMenuEl.style.display !== "none";
      if (isOpen) hfClose(); else hfOpen();
    });
  }

  hfRefreshIfOpen();
}

// ── Rendering ────────────────────────────────────────────────────────
function hfFactorStatusHTML() {
  const n = qdTickedFactorIds.size;
  const text = n === 0
    ? "No Enemy Factors ticked — ranking by plain overall kit score."
    : `🎯 Ranking by ${n} ticked Enemy Factor${n === 1 ? "" : "s"} — same scoring as Quick Draft's own suggestions.`;
  const label = n === 0 ? "🎯 Tick Enemy Factors" : "🎯 Edit Enemy Factors";
  return `
    <span class="hf-factor-status-text">${text}</span>
    <div class="hf-factor-status-actions">
      <button type="button" class="btn btn-ghost btn-xs" id="hf-edit-factors">${label}</button>
      ${n > 0 ? `<button type="button" class="btn btn-ghost btn-xs" id="hf-clear-factors" title="Untick every Enemy Factor without leaving this panel">🗑 Clear Enemy Factors</button>` : ""}
    </div>
  `;
}

// Rebuilds the status line + Clear button + prioritize-chip row and
// rewires their handlers — called on full panel build and whenever
// Enemy Factors state changes (ticked/untied/prioritized/cleared),
// whether that happened right here or back in Quick Draft's own
// picker (hfRefreshIfOpen). Kept separate from renderHeroFactorsPanel
// so a tick change doesn't need to rebuild the whole panel (which
// would cost the search box its focus).
function renderHfFactorStatus() {
  const statusEl = document.getElementById("hf-factor-status");
  if (!statusEl) return;
  statusEl.innerHTML = hfFactorStatusHTML();

  document.getElementById("hf-edit-factors")?.addEventListener("click", () => {
    // Jumps to the real Enemy Factors picker to change what's ticked —
    // hides this panel first (rather than stacking two fullscreen
    // overlays) but deliberately doesn't fully hfClose() it: instead,
    // qdFactorMenuOnClose (app.js) is set so that whenever the Enemy
    // Factors picker itself closes — ✕, backdrop tap, or Escape, it
    // makes no difference which — Hero Factors reopens automatically
    // with the new ticks already reflected, rather than the user
    // landing back on whatever screen was open before Hero Factors in
    // the first place.
    if (hfMenuEl) hfMenuEl.style.display = "none"; // body stays "qd-factor-menu-open" the whole time — Enemy Factors just takes over the same lock
    if (typeof qdFactorMenuOnClose !== "undefined") qdFactorMenuOnClose = () => hfOpen();
    document.getElementById("qd-factor-menu-btn")?.click();
  });

  document.getElementById("hf-clear-factors")?.addEventListener("click", hfClearEnemyFactors);

  renderHfPriorityChips();
}

// Unticks every Enemy Factor (and drops any priority stars with them)
// right from this panel — no trip to Quick Draft's picker needed. Sets
// the exact same qdTickedFactorIds/qdPrioritizedFactorIds state Quick
// Draft itself reads, so its own button label, Factor list, priority-
// chip row, filled slots, and live suggestions all fall back in step
// with this panel rather than drifting out of sync.
function hfClearEnemyFactors() {
  if (qdTickedFactorIds.size === 0 && qdPrioritizedFactorIds.size === 0) return;
  qdTickedFactorIds.clear();
  qdPrioritizedFactorIds.clear();

  if (typeof saveQuickDraftModeLocal === "function") saveQuickDraftModeLocal();
  if (typeof renderQdFactorChips === "function") renderQdFactorChips(); // syncs Quick Draft's own button/list/priority-chip row even though its picker isn't open
  if (typeof renderQuickDraft === "function") renderQuickDraft(); // filled slots' scores/(i) explanations fall back to plain kit score too
  if (typeof quickDraftSuggestOpen !== "undefined" && quickDraftSuggestOpen && typeof renderQuickDraftSuggestions === "function") renderQuickDraftSuggestions();

  renderHfFactorStatus();
  renderHeroFactorsGrid();
}

// Alphabetical row of chips — one per currently-ticked Enemy Factor —
// mirrors renderQdFactorPriorityChips' own row in Quick Draft (same
// .qd-factor-priority-chip styling, same qdPrioritizedFactorIds state)
// but lives right here too, so prioritizing doesn't require a trip to
// Quick Draft's picker either. Ticking/unticking Factors themselves
// still only happens there — this row can only prioritize what's
// already ticked.
function renderHfPriorityChips() {
  const box = document.getElementById("hf-priority-chips");
  if (!box) return;

  if (qdTickedFactorIds.size === 0) {
    box.innerHTML = "";
    box.style.display = "none";
    return;
  }
  box.style.display = "flex";

  const tickedFactors = [...qdTickedFactorIds]
    .map(id => taxonomy.factors.find(f => f.id === id))
    .filter(Boolean)
    .sort((a, b) => (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase()));

  box.innerHTML = tickedFactors.map(f => `
    <button type="button" class="qd-factor-priority-chip${qdPrioritizedFactorIds.has(f.id) ? " active" : ""}" data-factor-id="${f.id}" title="${qdPrioritizedFactorIds.has(f.id) ? "Prioritized — click to remove the ×2 boost" : "Click to prioritize (doubles this Factor's score)"}">
      ${qdPrioritizedFactorIds.has(f.id) ? "⭐ " : ""}${f.name || "(unnamed)"}
    </button>
  `).join("");

  box.querySelectorAll(".qd-factor-priority-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const factorId = taxonomy.factors.find(f => String(f.id) === chip.dataset.factorId)?.id;
      if (factorId === undefined) return;
      if (qdPrioritizedFactorIds.has(factorId)) qdPrioritizedFactorIds.delete(factorId);
      else qdPrioritizedFactorIds.add(factorId);

      renderHfPriorityChips(); // just this row
      if (typeof renderQdFactorPriorityChips === "function") renderQdFactorPriorityChips(); // keep Quick Draft's own chip row in sync too
      if (typeof renderQuickDraft === "function") renderQuickDraft();
      if (typeof quickDraftSuggestOpen !== "undefined" && quickDraftSuggestOpen && typeof renderQuickDraftSuggestions === "function") renderQuickDraftSuggestions();
      renderHeroFactorsGrid();
    });
  });
}

function renderHfTagChecklist(kind) {
  const listEl = document.getElementById(kind === "reactions" ? "hf-reaction-list" : "hf-engagement-list");
  if (!listEl) return;
  const q = (kind === "reactions" ? hfReactionSearch : hfEngagementSearch).trim().toLowerCase();
  const selectedSet = kind === "reactions" ? hfFilters.reactionIds : hfFilters.engagementIds;
  const label = kind === "reactions" ? "Reactions" : "Engagements";

  const items = taxonomy[kind]
    .filter(it => !q || (it.name || "").toLowerCase().includes(q))
    .sort((a, b) => (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase()));

  if (items.length === 0) {
    listEl.innerHTML = `<div class="qd-factor-empty">No matching ${label}.</div>`;
    return;
  }

  listEl.innerHTML = items.map(it => `
    <label class="qd-factor-menu-item${selectedSet.has(it.id) ? " active" : ""}">
      <input type="checkbox" data-id="${it.id}" ${selectedSet.has(it.id) ? "checked" : ""} />
      <span>${it.name || "(unnamed)"} (${it.value.toFixed(1)})</span>
    </label>
  `).join("");

  listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", () => {
      const item = taxonomy[kind].find(x => String(x.id) === cb.dataset.id);
      if (!item) return;
      if (cb.checked) selectedSet.add(item.id); else selectedSet.delete(item.id);
      cb.closest(".qd-factor-menu-item")?.classList.toggle("active", cb.checked);
      renderHeroFactorsGrid();
    });
  });
}

function renderHfCategoryChips() {
  const box = document.getElementById("hf-category-chips");
  if (!box) return;
  const cats = hfAllRankingCategories();

  if (cats.length === 0) {
    box.innerHTML = `<div class="qd-factor-empty">No Ranking Categories yet — name a Reaction/Engagement like "PASSIVE : Reacts to dual attack" in 🗂 Taxonomy and its category shows up here.</div>`;
    return;
  }

  box.innerHTML = cats.map(cat => `
    <button type="button" class="qd-factor-priority-chip${hfFilters.categories.has(cat) ? " active" : ""}" data-cat="${escAttr(cat)}">${cat}</button>
  `).join("");

  box.querySelectorAll(".qd-factor-priority-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const cat = btn.dataset.cat;
      if (hfFilters.categories.has(cat)) hfFilters.categories.delete(cat); else hfFilters.categories.add(cat);
      btn.classList.toggle("active");
      renderHeroFactorsGrid();
    });
  });
}

// Grid only — called on every filter/search tweak, so it stays cheap
// and never rebuilds the surrounding controls (which would cost a
// search box its focus/cursor mid-type).
function renderHeroFactorsGrid() {
  const gridEl = document.getElementById("hf-grid");
  const countEl = document.getElementById("hf-count");
  if (!gridEl) return;

  const scored = hfFilteredHeroes();

  if (countEl) countEl.textContent = `${scored.length} hero${scored.length === 1 ? "" : "es"} match${scored.length === 1 ? "es" : ""}`;

  if (scored.length === 0) {
    gridEl.innerHTML = `<div class="hf-empty">No heroes match these filters.</div>`;
    return;
  }

  // Tiles themselves are no longer clickable — opening the full hero
  // detail overlay from here was rarely useful and (worse) rendered
  // BEHIND this fullscreen panel. In its place, a small (i) button opens
  // the exact same "How This Score Was Calculated" explainer Quick
  // Draft's own slot (i) buttons use (qdShowScoreExplainer, defined in
  // app.js) — same breakdown, same ticked-Enemy-Factors state this grid
  // is already scored against, just reached one tap earlier. It's
  // rendered above every other .qd-factor-menu-overlay via #qd-score-
  // explainer's z-index (see style.css) so it never ends up hidden
  // behind this panel.
  gridEl.innerHTML = scored.map(({ hero: h, score, reasons }) => {
    const iconHTML = h.iconData ? `<img src="${h.iconData}" alt="">` : `<div class="hf-tile-fallback">⚔️</div>`;
    const tier = score >= 8 ? "hf-tier-high" : score >= 5 ? "hf-tier-mid" : "hf-tier-low";
    const titleText = [h.name || "Unnamed Hero", `Score ${score.toFixed(1)}`, ...reasons].join(" — ");
    return `
      <div class="hf-tile ${tier}" data-hero-id="${h.id}" title="${escAttr(titleText)}">
        <button type="button" class="hf-tile-info-btn" data-hero-id="${h.id}" title="Why this score?" aria-label="Why this score?">ⓘ</button>
        ${iconHTML}
        <span class="hf-tile-score">${score.toFixed(1)}</span>
        <span class="hf-tile-name">${h.name || "Unnamed"}</span>
      </div>
    `;
  }).join("");

  gridEl.querySelectorAll(".hf-tile-info-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const h = heroes.find(x => String(x.id) === btn.dataset.heroId);
      if (h && typeof qdShowScoreExplainer === "function") qdShowScoreExplainer(h, "primary");
    });
  });
}

// Full rebuild — controls + grid. Only called on open and after
// "Clear filters" (nothing mid-typing to lose focus on in either
// case); everything else re-renders just its own piece.
function renderHeroFactorsPanel() {
  const panel = document.getElementById("hero-factors-panel");
  if (!panel) return;

  panel.innerHTML = `
    <div class="qd-factor-menu-header">
      <div class="qd-factor-menu-title">🧬 Hero Factors</div>
      <button type="button" class="qd-factor-menu-close" id="hf-close" aria-label="Close">✕</button>
    </div>

    <div class="qd-factor-menu-searchbar">
      <input type="text" class="taxonomy-search qd-factor-menu-search" id="hf-search" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="🔍 Search hero name…" />
      <button type="button" class="qd-factor-menu-clear" id="hf-search-clear" title="Clear search" aria-label="Clear search">✕</button>
    </div>

    <div class="hf-factor-status" id="hf-factor-status"></div>
    <div class="qd-factor-priority-chips hf-priority-chips" id="hf-priority-chips" style="display:none"></div>

    <div class="hf-filter-row">
      <label class="hf-minscore-label">Min overall score
        <input type="number" id="hf-min-score" min="0" max="10" step="0.5" value="${hfFilters.minScore}" />
      </label>
      <button type="button" class="btn btn-ghost btn-xs" id="hf-clear-filters">✕ Clear filters</button>
    </div>

    <div class="hf-category-chips" id="hf-category-chips"><!-- Ranking Categories --></div>

    <details class="hf-details">
      <summary>⚡ Reactions${hfFilters.reactionIds.size ? ` (${hfFilters.reactionIds.size})` : ""}</summary>
      <div class="qd-factor-menu-searchbar">
        <input type="text" class="taxonomy-search qd-factor-menu-search" id="hf-reaction-search" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="🔍 Search Reactions…" />
      </div>
      <div class="qd-factor-menu-list" id="hf-reaction-list"></div>
    </details>

    <details class="hf-details">
      <summary>🛡 Engagements${hfFilters.engagementIds.size ? ` (${hfFilters.engagementIds.size})` : ""}</summary>
      <div class="qd-factor-menu-searchbar">
        <input type="text" class="taxonomy-search qd-factor-menu-search" id="hf-engagement-search" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="🔍 Search Engagements…" />
      </div>
      <div class="qd-factor-menu-list" id="hf-engagement-list"></div>
    </details>

    <div class="hf-count" id="hf-count"></div>
    <div class="hf-grid" id="hf-grid"></div>
  `;

  document.getElementById("hf-close").addEventListener("click", hfClose);

  const searchInput = document.getElementById("hf-search");
  searchInput.value = hfSearchQuery;
  searchInput.addEventListener("input", () => { hfSearchQuery = searchInput.value; renderHeroFactorsGrid(); });
  document.getElementById("hf-search-clear").addEventListener("click", () => {
    hfSearchQuery = "";
    searchInput.value = "";
    renderHeroFactorsGrid();
    searchInput.focus();
  });

  document.getElementById("hf-min-score").addEventListener("input", e => {
    const v = Number(e.target.value);
    hfFilters.minScore = Number.isFinite(v) ? Math.max(0, Math.min(10, v)) : 0;
    renderHeroFactorsGrid();
  });

  document.getElementById("hf-clear-filters").addEventListener("click", () => {
    hfFilters = { reactionIds: new Set(), engagementIds: new Set(), categories: new Set(), minScore: 0 };
    hfSearchQuery = "";
    hfReactionSearch = "";
    hfEngagementSearch = "";
    renderHeroFactorsPanel();
  });

  renderHfFactorStatus(); // status text, Clear Enemy Factors button, and the prioritize-chip row

  renderHfCategoryChips();

  const reactionSearchInput = document.getElementById("hf-reaction-search");
  reactionSearchInput.addEventListener("input", () => { hfReactionSearch = reactionSearchInput.value; renderHfTagChecklist("reactions"); });
  renderHfTagChecklist("reactions");

  const engagementSearchInput = document.getElementById("hf-engagement-search");
  engagementSearchInput.addEventListener("input", () => { hfEngagementSearch = engagementSearchInput.value; renderHfTagChecklist("engagements"); });
  renderHfTagChecklist("engagements");

  renderHeroFactorsGrid();
}

// ── Self-init ────────────────────────────────────────────────────────
// app.js calls renderHeroFactorsButton() itself whenever Enemy Factors
// state changes later on — but on the very first page load, app.js's
// top-level code (including its own initial wiring pass) finishes
// running BEFORE this file is even fetched, since classic <script>
// tags execute strictly in document order. Every one of those
// typeof-guarded calls from app.js is therefore a silent no-op the
// first time around — the button exists in the DOM but has no click
// listener yet. This call is what actually wires it on load; by the
// time this line runs, app.js (and the button it renders) is already
// fully in place.
renderHeroFactorsButton();
