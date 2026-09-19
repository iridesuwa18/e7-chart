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

// "Last saved" indicator (header ⓘ) — a Date set the moment a Save to
// GitHub succeeds (see saveToServer), or null if nothing's been saved
// yet this session. Declared all the way up here, not next to
// saveToServer/updateLastSavedIndicator further down, because the ⓘ
// click handler gets wired during init() near the top of this script —
// a `let` living further down would still be in its temporal-dead-zone
// at that point and throw the moment the button is clicked.
let lastSavedAt = null;
// The most recently confirmed savedAt actually stored on GitHub right
// now — set alongside lastSavedAt whenever this tab loads or saves
// (since in both cases we just confirmed the two match), and refreshed
// independently by periodic background checks (checkSyncStatus) so a
// save made from a *different* browser/device while this tab stays
// open still gets noticed. Comparing this against lastSavedAt is what
// drives the "refresh browser" vs "in sync" message in the popup.
let serverSavedAt = null;

const RARITY_META = {
  "5ml": { label: "5★ ML / Limited",      color: "#e8c84a",              border: "#c9a227" },
  "5r":  { label: "5★ Regular",           color: "rgba(232,200,74,0.65)", border: "rgba(201,162,39,0.65)" },
  "4":   { label: "4★",                   color: "#a88fd4",              border: "#7a60b0" },
  "3":   { label: "3★",                   color: "#7a9aaa",              border: "#50707f" },
};

/* ── State ── */
let heroes     = [];
let selectedId = null;

// True from the moment any local edit happens (hero, taxonomy, draft —
// anything that flows through saveLocal below) until the next
// successful push to GitHub or a fresh load/sync from it. Drives the
// "you've made changes" reminder banner at the top of the Performance
// Ranking overlay (see updateTaxonomySaveReminder further down).
let hasUnsavedChanges = false;

/* ═══════════════════════════════════════
   REACTION / ENGAGEMENT / FACTOR TAXONOMY
   (Rebuild Spec Section 1.1)

   A separate, top-level store — NOT embedded in individual hero
   records. Heroes only ever hold a `refId` pointing into these lists
   plus their own 0–10 score for that item; renaming/re-tagging a
   Reaction or Engagement here is instantly reflected for every hero
   that references it.

   Persisted as a third key (alongside `heroes` and `draftData`) in
   the same GitHub-backed JSON blob the app already uses — see
   Section 1.3 and the save/load functions further down this file.
═══════════════════════════════════════ */
let taxonomy = {
  reactions:   [], // [{ id, name, factorIds: [] }]
  engagements: [], // [{ id, name, factorIds: [] }]
  factors:     [], // [{ id, name, priorityOrder: [{kind,id}], priorityLocked }]
};

// Sort order per Taxonomy tab (Reactions/Engagements/Factors) —
// "oldest"/"newest" by id (which encodes creation time, see
// newTaxonomyId further down), "az"/"za" by name. Declared all the way
// up here, not next to the rest of the Taxonomy sort code further
// down, because wireTaxonomySort() (in init(), called near the top of
// this script) reads it synchronously while wiring the sort dropdowns
// — not deferred inside an event-listener callback the way the search
// boxes' query state is. A `let` down by the rest of that code would
// still be in its temporal-dead-zone at that point and throw, aborting
// the rest of init() before it ever finishes setting up the page.
let taxonomySortMode = { reactions: "oldest", engagements: "oldest", factors: "oldest" };
// Sort order for the Performance Ranking list — one of "score-desc"
// (default), "score-asc", "az", "za". Separate from taxonomySortMode
// (used by the individual Reactions/Engagements/Factors tabs, which
// sort by creation order or name, never by score). Declared here
// (rather than down near renderTaxonomyRankingPanel) because the
// startup code that wires up the Ranking sort dropdown — and,
// critically, everything that runs after it in that same function,
// including the Admin Panel's Confirm/Cancel button listeners — reads
// this variable before that later part of the file would run. Being
// declared with `let` further down put it in the temporal dead zone
// at that point, throwing "Cannot access before initialization" and
// aborting the rest of startup, which silently left Confirm/Cancel
// unwired.
let taxonomyRankingSortMode = "score-desc";

// Strictly increasing, even for several items created within the same
// millisecond (e.g. adding a handful of Reactions back to back) — this
// used to be Date.now() + a large random offset for uniqueness, but
// that random component (up to ~16 minutes' worth of "ms") completely
// swamped real creation order, so Taxonomy's Oldest/Newest sort could
// show items in an essentially random order whenever they were added
// close together in time, which is the normal case, not an edge one.
let _lastTaxonomyId = 0;
function newTaxonomyId() {
  let id = Date.now();
  if (id <= _lastTaxonomyId) id = _lastTaxonomyId + 1;
  _lastTaxonomyId = id;
  return id;
}

function emptyTaxonomy() {
  return { reactions: [], engagements: [], factors: [] };
}

// Defensive normalizer — old exports, partial data, or a blob missing
// the taxonomy key entirely all come out shaped correctly.
function normalizeTaxonomy(t) {
  if (!t || typeof t !== "object") return emptyTaxonomy();
  const cleanList = (list) => Array.isArray(list)
    ? list.filter(x => x && typeof x === "object" && x.id !== undefined).map(x => ({
        id: x.id,
        name: typeof x.name === "string" ? x.name : "",
        value: Math.max(0, Math.min(10, Number(x.value) || 0)),
        pinned: !!x.pinned,
        locked: !!x.locked,
        marked: !!x.marked,
        ...(Array.isArray(x.factorIds) ? { factorIds: x.factorIds.slice() } : { factorIds: [] }),
      }))
    : [];
  return {
    reactions:   cleanList(t.reactions).map(x => ({ id: x.id, name: x.name, value: x.value, pinned: x.pinned, locked: x.locked, marked: x.marked, factorIds: x.factorIds })),
    engagements: cleanList(t.engagements).map(x => ({ id: x.id, name: x.name, value: x.value, pinned: x.pinned, locked: x.locked, marked: x.marked, factorIds: x.factorIds })),
    factors:     (Array.isArray(t.factors) ? t.factors : [])
      .filter(x => x && typeof x === "object" && x.id !== undefined)
      .map(x => ({
        id: x.id,
        name: typeof x.name === "string" ? x.name : "",
        pinned: !!x.pinned,
        // Manual priority order (see toggleFactorPriority) — a hand-
        // picked click order, {kind,id} pairs pointing at one of this
        // Factor's own tagged Reactions/Engagements. Stale entries
        // (item since untagged/deleted) are filtered here rather than
        // trusted; qdFactorRankedBreakdown filters again at read time
        // for the same reason, since a tag can be untagged from this
        // Factor without ever going through this normalizer again.
        priorityOrder: Array.isArray(x.priorityOrder)
          ? x.priorityOrder
              .filter(p => p && (p.kind === "reactions" || p.kind === "engagements") && p.id !== undefined)
              .map(p => ({ kind: p.kind, id: p.id }))
          : [],
        priorityLocked: !!x.priorityLocked,
      })),
  };
}

// Factor-tag clipboard — lets one Reaction/Engagement's tagged Factors
// be copied and pasted onto another (either kind, either direction,
// since Factors are one shared library). Session-only, not saved/
// exported: just a convenience for tagging several items alike without
// re-picking each Factor from the search box every time. Paste is
// additive (unions into the target's existing tags) rather than a
// destructive overwrite, so pasting can never silently drop a tag the
// target already had.
let taxonomyFactorClipboard = null; // { factorIds: number[], sourceName: string } | null

function copyTaxonomyFactors(kind, id) {
  const item = taxonomy[kind]?.find(x => x.id === id);
  if (!item) return;
  taxonomyFactorClipboard = { factorIds: [...item.factorIds], sourceName: item.name || "(unnamed)" };
}

// Unions the clipboard's Factor ids onto the target item — ids it's
// already tagged with are simply skipped, never duplicated.
function pasteTaxonomyFactors(kind, id) {
  if (!taxonomyFactorClipboard) return;
  const toAdd = taxonomyFactorClipboard.factorIds;
  taxonomy = {
    ...taxonomy,
    [kind]: taxonomy[kind].map(x => {
      if (x.id !== id) return x;
      const merged = [...x.factorIds];
      toAdd.forEach(fid => { if (!merged.includes(fid)) merged.push(fid); });
      return { ...x, factorIds: merged };
    }),
  };
}

// Updates every rendered Paste-Factors button's enabled state, label,
// and tooltip to match the current clipboard — used instead of a full
// panel re-render after a copy, so it doesn't reset which rows' Factor-
// chip strips are open on either tab.
function refreshPasteFactorButtons() {
  document.querySelectorAll(".taxonomy-row-pastefactorsbtn").forEach(btn => {
    if (taxonomyFactorClipboard) {
      btn.disabled = false;
      btn.textContent = `📥 Paste Factors (${taxonomyFactorClipboard.factorIds.length})`;
      btn.title = `Add the ${taxonomyFactorClipboard.factorIds.length} Factor(s) copied from "${taxonomyFactorClipboard.sourceName}" — merges in, doesn't remove existing tags`;
    } else {
      btn.disabled = true;
      btn.textContent = `📥 Paste Factors`;
      btn.title = "Copy Factors from a Reaction or Engagement first";
    }
  });
}

// Pin/unpin a Reaction, Engagement, or Factor (`kind` is "reactions",
// "engagements", or "factors") — pinned items always sort to the top
// of their tab regardless of the active sort mode (see
// applyTaxonomySort below). Pinned state lives on the taxonomy item
// itself, so it round-trips through the same GitHub save/load path as
// everything else in the taxonomy library — hitting Save pushes it,
// and every session that loads from GitHub afterward gets it back.
function toggleTaxonomyPin(kind, id) {
  taxonomy = {
    ...taxonomy,
    [kind]: taxonomy[kind].map(x => x.id === id ? { ...x, pinned: !x.pinned } : x),
  };
}

/* ── Reactions / Engagements CRUD ──
   `kind` is "reactions" or "engagements". Each item carries its own fixed
   `value` (0-10) — this is the ONE place that value is set. Heroes only
   ever reference the item by id; assigning a Reaction/Engagement to a
   hero never lets them override this value (see setHeroTaxonomyScore's
   removal and the RTE assignment UI further down, which is read-only
   with respect to value). */
function addTaxonomyItem(kind, name) {
  const item = { id: newTaxonomyId(), name: String(name || "").trim(), value: 0, factorIds: [], locked: false, marked: false };
  taxonomy = { ...taxonomy, [kind]: [...taxonomy[kind], item] };
  saveLocal();
  return item;
}

function renameTaxonomyItem(kind, id, name) {
  taxonomy = {
    ...taxonomy,
    [kind]: taxonomy[kind].map(x => x.id === id ? { ...x, name: String(name || "").trim() } : x),
  };
  saveLocal();
}

// Duplicates a Reaction/Engagement under a new name — copies its fixed
// value and Factor tags, but starts with no heroes linked (heroes hold
// a link, not the item itself, so a copy can't silently attach itself
// to whoever held the original). Gets its own fresh id, so it sorts as
// newly-created regardless of where the original sits. Also starts
// unlocked, even if the original was locked — a lock is a deliberate
// "stop me from fat-fingering THIS specific score" flag on one item,
// not something that should silently carry over to a copy.
function duplicateTaxonomyItem(kind, id, newName) {
  const item = taxonomy[kind].find(x => x.id === id);
  if (!item) return null;
  const copy = { ...item, id: newTaxonomyId(), name: String(newName || "").trim(), pinned: false, locked: false, marked: false, factorIds: [...item.factorIds] };
  taxonomy = { ...taxonomy, [kind]: [...taxonomy[kind], copy] };
  saveLocal();
  return copy;
}

// Sets a Reaction/Engagement's fixed value (0-10) — the single source of
// truth for its score everywhere it's used (chart axes, Quick Draft
// ranking, etc.). This is the ONLY place the value is ever set. Locked
// items are a hard no-op here (not just a disabled slider) — defense in
// depth so a lock can never be bypassed by any caller, present or future.
function setTaxonomyItemValue(kind, id, value) {
  const item = taxonomy[kind].find(x => x.id === id);
  if (!item || item.locked) return;
  const clamped = Math.max(0, Math.min(10, Number(value) || 0));
  taxonomy = {
    ...taxonomy,
    [kind]: taxonomy[kind].map(x => x.id === id ? { ...x, value: clamped } : x),
  };
  saveLocal();
}

// Toggles a Reaction/Engagement's lock — a locked item's score can't be
// changed by the number input, the slider, or setTaxonomyItemValue
// itself (see above) until it's unlocked again here. Purely a
// "don't let me accidentally bump this one" safeguard, not a
// permissions system — anyone with access to the Taxonomy screen can
// toggle it either way.
function toggleTaxonomyItemLock(kind, id) {
  taxonomy = {
    ...taxonomy,
    [kind]: taxonomy[kind].map(x => x.id === id ? { ...x, locked: !x.locked } : x),
  };
  saveLocal();
}

// Toggles the personal "I edited this" bookmark used in the
// Performance Ranking list (Section 5.4) — teal-blue, purely a memory
// aid with zero effect on scoring/sorting/locking. Round-trips through
// save/load like everything else on a taxonomy item, but nothing else
// in the app ever reads it.
function toggleTaxonomyItemMarked(kind, id) {
  taxonomy = {
    ...taxonomy,
    [kind]: taxonomy[kind].map(x => x.id === id ? { ...x, marked: !x.marked } : x),
  };
  saveLocal();
}

// Deleting a Reaction/Engagement also strips it from every hero that
// referenced it (Section 5 DoD: "cleanly un-links from all heroes"),
// and from every Factor's manual priority order that happened to
// include it (see toggleFactorPriority) — a deleted tag can't stay
// "prioritized" for a Factor that no longer even has it tagged.
function deleteTaxonomyItem(kind, id) {
  taxonomy = {
    ...taxonomy,
    [kind]: taxonomy[kind].filter(x => x.id !== id),
    factors: taxonomy.factors.map(f => (f.priorityOrder && f.priorityOrder.length)
      ? { ...f, priorityOrder: f.priorityOrder.filter(p => !(p.kind === kind && p.id === id)) }
      : f),
  };
  const heroField = kind === "reactions" ? "reactions" : "engagements";
  heroes = heroes.map(h => {
    if (!Array.isArray(h[heroField]) || !h[heroField].some(r => (r.refId ?? r) === id)) return h;
    return { ...h, [heroField]: h[heroField].filter(r => (r.refId ?? r) !== id) };
  });
  saveLocal();
}

// Moves a Reaction to Engagements or vice versa — keeps the same id
// (so oldest/newest sort still reflects when it was actually created),
// name, fixed value, and Factor tags, and re-links every hero that
// held it under the OTHER field so nothing has to be manually
// re-assigned. Purely a re-categorization, never touches scores.
function convertTaxonomyItemKind(fromKind, id) {
  const toKind = fromKind === "reactions" ? "engagements" : "reactions";
  const item = taxonomy[fromKind].find(x => x.id === id);
  if (!item) return;

  taxonomy = {
    ...taxonomy,
    [fromKind]: taxonomy[fromKind].filter(x => x.id !== id),
    [toKind]: [...taxonomy[toKind], item],
    // Any Factor that had this tag manually prioritized keeps it
    // prioritized (same id, same rank) — just re-labeled under its new
    // kind, so a re-categorization doesn't quietly reset the order.
    factors: taxonomy.factors.map(f => (f.priorityOrder && f.priorityOrder.length)
      ? { ...f, priorityOrder: f.priorityOrder.map(p => (p.kind === fromKind && p.id === id) ? { kind: toKind, id } : p) }
      : f),
  };

  heroes = heroes.map(h => {
    const fromList = Array.isArray(h[fromKind]) ? h[fromKind] : [];
    if (!fromList.some(x => (x.refId ?? x) === id)) return h; // hero never held it — nothing to move
    const toList = Array.isArray(h[toKind]) ? h[toKind] : [];
    const alreadyInTo = toList.some(x => (x.refId ?? x) === id); // shouldn't happen, but stay duplicate-safe
    return {
      ...h,
      [fromKind]: fromList.filter(x => (x.refId ?? x) !== id),
      [toKind]: alreadyInTo ? toList : [...toList, { refId: id }],
    };
  });

  saveLocal();
}

function tagFactor(kind, itemId, factorId) {
  taxonomy = {
    ...taxonomy,
    [kind]: taxonomy[kind].map(x => {
      if (x.id !== itemId) return x;
      if (x.factorIds.includes(factorId)) return x;
      return { ...x, factorIds: [...x.factorIds, factorId] };
    }),
  };
  saveLocal();
}

function untagFactor(kind, itemId, factorId) {
  taxonomy = {
    ...taxonomy,
    [kind]: taxonomy[kind].map(x => x.id === itemId ? { ...x, factorIds: x.factorIds.filter(f => f !== factorId) } : x),
    // Untagging a Reaction/Engagement from a Factor also drops it from
    // that Factor's manual priority order, if it was in there — a
    // priority pick only ever makes sense for a tag actually assigned
    // to this Factor.
    factors: taxonomy.factors.map(f => f.id === factorId
      ? { ...f, priorityOrder: (f.priorityOrder || []).filter(p => !(p.kind === kind && p.id === itemId)) }
      : f),
  };
  saveLocal();
}

/* ── Factors CRUD ── */
function addFactor(name) {
  const item = { id: newTaxonomyId(), name: String(name || "").trim(), priorityOrder: [], priorityLocked: false };
  taxonomy = { ...taxonomy, factors: [...taxonomy.factors, item] };
  saveLocal();
  return item;
}

function renameFactor(id, name) {
  taxonomy = { ...taxonomy, factors: taxonomy.factors.map(f => f.id === id ? { ...f, name: String(name || "").trim() } : f) };
  saveLocal();
}

// Duplicates a Factor under a new name, carrying over its tags: any
// Reaction/Engagement that had the original tagged also gets the new
// copy tagged, so the duplicate behaves identically until you choose
// to tag it differently. Starts with a fresh, unlocked, empty priority
// order — same "don't silently carry over" reasoning as a duplicated
// Reaction/Engagement not inheriting its original's lock.
function duplicateFactor(id, newName) {
  const original = taxonomy.factors.find(f => f.id === id);
  if (!original) return null;
  const copy = { id: newTaxonomyId(), name: String(newName || "").trim(), priorityOrder: [], priorityLocked: false };
  taxonomy = {
    ...taxonomy,
    reactions:   taxonomy.reactions.map(r => r.factorIds.includes(id) ? { ...r, factorIds: [...r.factorIds, copy.id] } : r),
    engagements: taxonomy.engagements.map(e => e.factorIds.includes(id) ? { ...e, factorIds: [...e.factorIds, copy.id] } : e),
    factors:     [...taxonomy.factors, copy],
  };
  saveLocal();
  return copy;
}

// Deleting a Factor also un-tags it from every Reaction/Engagement.
function deleteFactor(id) {
  taxonomy = {
    reactions:   taxonomy.reactions.map(r => ({ ...r, factorIds: r.factorIds.filter(f => f !== id) })),
    engagements: taxonomy.engagements.map(e => ({ ...e, factorIds: e.factorIds.filter(f => f !== id) })),
    factors:     taxonomy.factors.filter(f => f.id !== id),
  };
  saveLocal();
}

// ── Manual priority order within a Factor ──────────────────────────
// A hand-picked alternative to the automatic score-based "ranked %
// spread" system (see qdFactorRankedBreakdown) — the moment a Factor
// has at least one tag manually added here, that click order takes
// over completely for THIS Factor: the first tag added is worth the
// full ×2 multiplier, the last worth ×1, spread evenly for whatever
// falls in between (exactly the same ×1–×2 percentage-spread math the
// automatic system already used — see qdFactorRankedBreakdown — just
// driven by hand-picked order instead of raw score). Every other tag
// tagged to this Factor but left out of the order simply stays at
// ×1 (unboosted), same as an unranked tag always has been. Clearing
// the order (clearFactorPriority) reverts this Factor straight back
// to the automatic system — nothing else to toggle.
//
// Toggling a tag already in the order removes it; nothing else is
// renumbered by hand, the remaining entries just shift up to fill the
// gap, same as splicing out of any ordered list.
//
// Both this and clearFactorPriority are hard no-ops while the
// Factor's order is locked (toggleFactorPriorityLock) — same "can't be
// bypassed by any caller, present or future" defense-in-depth pattern
// as a locked Reaction/Engagement score (see setTaxonomyItemValue).
function toggleFactorPriority(factorId, kind, itemId) {
  const factor = taxonomy.factors.find(f => f.id === factorId);
  if (!factor || factor.priorityLocked) return;
  const order = Array.isArray(factor.priorityOrder) ? factor.priorityOrder : [];
  const exists = order.some(p => p.kind === kind && p.id === itemId);
  const nextOrder = exists
    ? order.filter(p => !(p.kind === kind && p.id === itemId))
    : [...order, { kind, id: itemId }];
  taxonomy = { ...taxonomy, factors: taxonomy.factors.map(f => f.id === factorId ? { ...f, priorityOrder: nextOrder } : f) };
  saveLocal();
}

// Resets a Factor's manual priority order back to empty — it falls
// straight back to the automatic score-based ranking the next time
// anything reads qdFactorRankedBreakdown for it. A no-op while locked.
function clearFactorPriority(factorId) {
  const factor = taxonomy.factors.find(f => f.id === factorId);
  if (!factor || factor.priorityLocked || !(factor.priorityOrder && factor.priorityOrder.length)) return;
  taxonomy = { ...taxonomy, factors: taxonomy.factors.map(f => f.id === factorId ? { ...f, priorityOrder: [] } : f) };
  saveLocal();
}

// Locks/unlocks a Factor's manual priority order. Purely a "don't let
// me accidentally reshuffle this one" safeguard, not a permissions
// system — same spirit as a locked Reaction/Engagement score — but
// enforced here (not just in the UI) so toggleFactorPriority/
// clearFactorPriority can never be bypassed by any caller while it's on.
function toggleFactorPriorityLock(factorId) {
  taxonomy = { ...taxonomy, factors: taxonomy.factors.map(f => f.id === factorId ? { ...f, priorityLocked: !f.priorityLocked } : f) };
  saveLocal();
}

/* ── Per-hero assignment ──
   Links a hero to a library Reaction/Engagement by refId only — the
   score/value itself lives on the taxonomy item (set via
   setTaxonomyItemValue above), never per-hero. Removing a link never
   touches the library item itself. */
// Tracks whichever hero most recently got linked to a Reaction or
// Engagement via addHeroTaxonomyLink (the "+Add to Hero" quick-add
// search under a Taxonomy row — see renderTaxonomyHeroSearch further
// down). Session-only, like the search boxes it feeds: it exists so
// that search box can pin your last pick at the top, letting you add
// several heroes to different Reactions/Engagements back-to-back
// without retyping their name each time.
let lastHeroLinkedToTaxonomy = null;

// Tracks whichever hero was most recently opened via "Edit Hero" in
// the roster. Session-only, same lifecycle as lastHeroLinkedToTaxonomy
// above — pinned alongside it at the top of the "search a hero to add"
// box so you can jump between reviewing a hero's roster card and
// tagging it onto Reactions/Engagements without re-searching its name.
let lastHeroViewedInEdit = null;

function addHeroTaxonomyLink(heroId, kind, refId) {
  let didLink = false;
  heroes = heroes.map(h => {
    if (h.id !== heroId) return h;
    const list = Array.isArray(h[kind]) ? h[kind] : [];
    if (list.some(x => (x.refId ?? x) === refId)) return h; // already linked
    didLink = true;
    return { ...h, [kind]: [...list, { refId }] };
  });
  if (didLink) lastHeroLinkedToTaxonomy = heroId;
  saveLocal();
}

function removeHeroTaxonomyLink(heroId, kind, refId) {
  heroes = heroes.map(h => {
    if (h.id !== heroId) return h;
    return { ...h, [kind]: (Array.isArray(h[kind]) ? h[kind] : []).filter(x => (x.refId ?? x) !== refId) };
  });
  saveLocal();
}

// Look up a Reaction/Engagement's fixed value (0-10) from the taxonomy
// library by id — the single source of truth for its score, used
// wherever a hero's linked reactions/engagements need scoring.
function taxonomyValue(kind, id) {
  const item = taxonomy[kind]?.find(x => x.id === id);
  return item ? item.value : 0;
}

/* ── Derived scores (Section 1.2) ──
   Live averages — never stored redundantly, always computed off the
   hero's current reactions[]/engagements[] refs against each item's
   fixed taxonomy value, so they can't drift out of sync. Returns null
   when the hero holds none of that kind (0 would be indistinguishable
   from a genuinely bad score). Each entry may be either { refId } or a
   bare refId number (older exports) — `r.refId ?? r` handles both. */
function computeReactionScore(h) {
  const list = Array.isArray(h?.reactions) ? h.reactions : [];
  if (list.length === 0) return null;
  const sum = list.reduce((acc, r) => acc + taxonomyValue("reactions", r?.refId ?? r), 0);
  return +(sum / list.length).toFixed(1);
}

function computeEngageScore(h) {
  const list = Array.isArray(h?.engagements) ? h.engagements : [];
  if (list.length === 0) return null;
  const sum = list.reduce((acc, e) => acc + taxonomyValue("engagements", e?.refId ?? e), 0);
  return +(sum / list.length).toFixed(1);
}

// Look up a taxonomy item's display name from either library by id —
// used anywhere a hero's reactions/engagements need to render as text
// instead of a bare refId (roster cards, editor UI, tooltips).
function taxonomyName(kind, id) {
  const item = taxonomy[kind]?.find(x => x.id === id);
  return item ? item.name : "(deleted)";
}

// Same padlock design already used for a locked hero's roster-card
// badge (see renderRoster) — reused here for score-locking so the two
// features look like one consistent "lock" language across the app
// instead of two different icon styles.
function qdLockIconSvg(locked, size = 13) {
  return locked
    ? `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`
    : `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`;
}

// A purely personal "I edited this" bookmark for the Performance
// Ranking list — no effect on scoring, sorting, or saving, it just
// paints the row teal-blue so an editing session is easy to retrace at
// a glance. Filled when marked, outline when not, same visual language
// as qdLockIconSvg above.
function qdMarkIconSvg(marked, size = 13) {
  const d = "M6 3.5h12a.5.5 0 0 1 .5.5v16.2a.5.5 0 0 1-.77.42L12 16.5l-5.73 4.12a.5.5 0 0 1-.77-.42V4a.5.5 0 0 1 .5-.5z";
  return marked
    ? `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="${d}"/></svg>`
    : `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="${d}"/></svg>`;
}

// ── Performance Ranking System (Section 5.4) ──
// The narrative ladder shown under the 0–10 slider (see
// ensureQdRankingSlider) — every whole number has a description of how
// consistently/reliably a Reaction or Engagement is actually "active"
// (relevant, triggering) over the course of a match, so a score can be
// picked by matching a description instead of guessing a number.
const QD_PERFORMANCE_LADDER = [
  { value: 10, desc: "Active throughout the game" },
  { value: 9,  desc: "Active almost the entire game, with only rare gaps" },
  { value: 8,  desc: "Active very frequently, with only occasional gaps" },
  { value: 7,  desc: "Active through both enemy and player actions" },
  { value: 6,  desc: "Active through most enemy or player actions, fairly reliable" },
  { value: 5,  desc: "Active through either an enemy or player's actions" },
  { value: 4,  desc: "Active through enemy or player actions, but inconsistently" },
  { value: 3,  desc: "Active only through a slight RNG" },
  { value: 2,  desc: "Active only through noticeable RNG, rarely triggers" },
  { value: 1,  desc: "Active only through pure luck" },
  { value: 0,  desc: "Not useful at all" },
];
// Snaps any value (including the fractional ones the number input still
// allows) to its nearest ladder rung for display purposes only — the
// stored value itself is untouched.
function qdPerformanceLadderDescription(value) {
  const rung = QD_PERFORMANCE_LADDER.reduce((closest, entry) =>
    Math.abs(entry.value - value) < Math.abs(closest.value - value) ? entry : closest
  );
  return rung.desc;
}

// Every Reaction/Engagement tagged against a given Factor id — this is
// the lookup Section 8's recommendation engine will run per ticked
// Factor ("look up every Reaction and Engagement tagged with that
// Factor"). Defined here since it's pure taxonomy-library logic and
// doesn't depend on any Quick Draft state.
function taxonomyItemsForFactor(factorId) {
  return {
    reactions:   taxonomy.reactions.filter(r => r.factorIds.includes(factorId)),
    engagements: taxonomy.engagements.filter(e => e.factorIds.includes(factorId)),
  };
}

// Wires an "X" clear button next to a search input — shared by every
// Taxonomy search box (the 3 tab searches, and the two per-row ones:
// Tag Factors / Add to Hero) so clearing old text to search for
// something else never requires selecting-and-deleting it by hand.
// `onChange` is called both on typing and on clear, with the input's
// current value, so each caller's own filter/re-render logic runs the
// same way either way.
function wireTaxonomySearchClear(input, clearBtn, onChange) {
  if (!input || !clearBtn) return;
  const sync = () => { clearBtn.style.display = input.value ? "flex" : "none"; };
  sync();
  input.addEventListener("input", sync);
  clearBtn.addEventListener("click", () => {
    input.value = "";
    sync();
    onChange();
    input.focus();
  });
}

// Wires a Taxonomy tab's "New [X] name" add row. The input starts
// locked (read-only, showing 'Press "+ Add" to add new [X] name.') so
// it can never be mistaken for the search bar above it — the first tap
// on "+ Add" just unlocks the field for typing; a second tap (or
// Enter) with text in it actually calls `onAdd` and re-locks. Escape,
// or blurring away with nothing typed, also re-locks without adding
// anything.
// Ranking Categories (see hfCategoryOf/hfAllRankingCategories in
// hero-factors.js) — a Reaction/Engagement named "CATEGORY : rest of the
// name" belongs to CATEGORY. These two helpers let a category be
// quick-tapped onto a name input instead of typed by hand every single
// time: applyCategoryPrefixToInput does the actual insert/replace/toggle
// on one input, renderCategoryQuickfillRow (re)draws the chip row that
// calls it. Guarded with typeof checks throughout since hero-factors.js
// (loaded after app.js) is what actually defines hfCategoryOf/
// hfAllRankingCategories — safe here because every call site below only
// runs later, in response to a user opening a modal or unlocking an
// input, by which point hero-factors.js has long since finished loading.
function applyCategoryPrefixToInput(input, cat) {
  if (!input) return;
  const raw = input.value || "";
  const existingCat = typeof hfCategoryOf === "function" ? hfCategoryOf(raw) : null;
  const rest = existingCat !== null ? raw.slice(raw.indexOf(":") + 1).replace(/^\s+/, "") : raw;
  input.value = existingCat === cat ? rest : (rest ? `${cat} : ${rest}` : `${cat} : `);
  // Programmatic value changes don't fire "input" on their own — dispatch
  // one so anything listening for it (quick-add visibility, suggestions)
  // reacts exactly as if this had been typed.
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function renderCategoryQuickfillRow(containerEl, input) {
  if (!containerEl || !input) return;
  const cats = typeof hfAllRankingCategories === "function" ? hfAllRankingCategories() : [];
  if (!cats.length) { containerEl.innerHTML = ""; containerEl.style.display = "none"; return; }
  containerEl.style.display = "flex";
  const currentCat = typeof hfCategoryOf === "function" ? hfCategoryOf(input.value || "") : null;
  containerEl.innerHTML = cats.map(cat => `
    <button type="button" class="qd-factor-priority-chip${currentCat === cat ? " active" : ""}" data-cat="${escAttr(cat)}">${cat}</button>
  `).join("");
  containerEl.querySelectorAll(".qd-factor-priority-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      applyCategoryPrefixToInput(input, chip.dataset.cat);
      renderCategoryQuickfillRow(containerEl, input); // refresh which chip shows as active
    });
  });
}

function wireTaxonomyAddRow(addBtnId, inputId, label, onAdd, categoryChipsId) {
  const btn = document.getElementById(addBtnId);
  const input = document.getElementById(inputId);
  const chipsBox = categoryChipsId ? document.getElementById(categoryChipsId) : null;
  if (!btn || !input) return;
  const lockedPlaceholder = `Press "+ Add" to add new ${label} name.`;
  const editingPlaceholder = `Type new ${label} name…`;

  const lock = () => {
    input.value = "";
    input.readOnly = true;
    input.placeholder = lockedPlaceholder;
    input.classList.add("taxonomy-new-locked");
    if (chipsBox) { chipsBox.innerHTML = ""; chipsBox.style.display = "none"; }
  };
  const unlock = () => {
    input.readOnly = false;
    input.placeholder = editingPlaceholder;
    input.classList.remove("taxonomy-new-locked");
    input.focus();
    if (chipsBox) renderCategoryQuickfillRow(chipsBox, input);
  };

  lock();

  btn.addEventListener("click", () => {
    if (input.readOnly) { unlock(); return; }
    const val = input.value.trim();
    if (!val) { input.focus(); return; }
    onAdd(val);
    lock();
  });

  input.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); btn.click(); }
    else if (e.key === "Escape") { e.preventDefault(); lock(); }
  });

  // Keeps the chip row's "active" highlight matching whatever category
  // prefix is actually typed right now, whether that got there by a
  // click or by hand.
  if (chipsBox) input.addEventListener("input", () => { if (!input.readOnly) renderCategoryQuickfillRow(chipsBox, input); });

  // Clicking "+ Add" while the field is focused-but-empty fires this
  // blur before the click's own listener runs; the timeout lets that
  // click land first so it isn't cancelled out from under it.
  input.addEventListener("blur", () => {
    setTimeout(() => {
      // Also bail if focus has already landed back on this input by
      // the time this fires — a stray/transient blur (e.g. a mobile
      // keyboard's predictive bar, or a browser suggestion popup that
      // briefly steals focus) shouldn't be able to yank the field back
      // to its locked state while it's actually still in use.
      if (!input.readOnly && !input.value.trim() && document.activeElement !== input) lock();
    }, 150);
  });
}

// Every hero currently holding a given Reaction/Engagement — backs both
// the "(N)" count badge on its Taxonomy row and the already-added check
// in the quick "Add to Hero" search (Section 5.3), so a hero can never
// end up linked twice from that panel.
function heroesLinkedToTaxonomyItem(kind, id) {
  return heroes.filter(h => (Array.isArray(h[kind]) ? h[kind] : []).some(x => (x.refId ?? x) === id));
}

// Ensures a hero object has the new Section 1 fields, without
// touching anything else on it (including the existing vType/vScore/
// hType/hScore axis fields, which still drive the chart plot until
// Section 6/7's UI work swaps the plotted axes over to
// reactionScore/engageScore/selfishScore/selflessScore — see this
// session's note in chat for why that wiring is deferred).
function ensureHeroTaxonomyFields(h) {
  if (!h || typeof h !== "object") return h;
  const needsFix = !Array.isArray(h.reactions) || !Array.isArray(h.engagements)
    || typeof h.selfishScore !== "number" || typeof h.selflessScore !== "number";
  if (!needsFix) return h;
  return {
    ...h,
    reactions:    Array.isArray(h.reactions) ? h.reactions : [],
    engagements:  Array.isArray(h.engagements) ? h.engagements : [],
    selfishScore:  typeof h.selfishScore === "number" ? h.selfishScore : 0,
    selflessScore: typeof h.selflessScore === "number" ? h.selflessScore : 0,
  };
}
/* ═══════════════════════════════════════
   SELFISH / SELFLESS SCORING LOGIC
   (Rebuild Spec Section 3)

   Replaces the old Speed/CR-Gain ↔ Tankiness axis. It's one
   continuous 0–10 scale with independent rubrics at each end —
   Selfish (self-skill checklist, Section 3.1) and Selfless (ally-
   support table, Section 3.2). A hero sits at exactly one point on
   the combined scale, from Selfish 10 through Neutral (0) to
   Selfless 10 — never both ends scored at once.

   These are pure functions over caller-supplied checklist answers.
   Section 4's Questionnaire modal is what will actually collect those
   answers (via UI) and call the setHeroX functions below. Wiring this
   axis into the chart plot and the shared slider UI — replacing
   vType/vScore's SPD/TNK — is Section 6/7 work, same deferral pattern
   already used for Section 1's reaction/engage fields above.
═══════════════════════════════════════ */

// 3.1 — fixed 10-item self-skill checklist. Selfish score is simply
// how many of these a hero's kit has, out of 10 (0 checked = Neutral).
const SELF_SKILLS = [
  { id: "spdCr",        label: "Increase Speed or Combat Readiness" },
  { id: "extraTurns",   label: "Extra Turns" },
  { id: "decSpd",       label: "Decrease Speed" },
  { id: "decCr",        label: "Decrease Combat Readiness" },
  { id: "immobDebuff",  label: "Immobility Debuffs" },
  { id: "selfPassive",  label: "Self-Sustaining Passive" },
  { id: "immunity",     label: "Immunity" },
  { id: "shields",      label: "Shields" },
  { id: "lifesteal",    label: "Lifesteal" },
  { id: "injuries",     label: "Injuries" },
];

function computeSelfishScore(checkedSkillIds) {
  const validIds = new Set(SELF_SKILLS.map(s => s.id));
  const checked = new Set(
    (Array.isArray(checkedSkillIds) ? checkedSkillIds : []).filter(id => validIds.has(id))
  );
  return Math.max(0, Math.min(10, checked.size));
}

// 3.2 — Selfless score: a unit-based system. Each ally can contribute up
// to 3 "units" of support — one each for Healing, Passive, and Buff:
//   Healing %  (0-100) → unit = healing / 100
//   Passive %  (0-100) → unit = passive / 100   (e.g. dmg reduction, evasion)
//   Buff count (0-10)  → unit = buffCount / 10
// With up to SELFLESS_MAX_ALLIES (4) allies × 3 units each, the maximum
// is SELFLESS_MAX_UNITS (12), which maps to a score of 10 — each unit is
// worth 10/12 points. This is what makes "100% healing to 1 ally" and
// "25% healing to 4 allies" score identically (1 total unit either way):
// both represent the same total amount of support delivered to the team.
const SELFLESS_MAX_ALLIES = 4;
const SELFLESS_UNITS_PER_ALLY = 3; // healing + passive + buff
const SELFLESS_MAX_UNITS = SELFLESS_MAX_ALLIES * SELFLESS_UNITS_PER_ALLY; // 12

// `supportedAllies` — array of { healing, passive, buffCount }, one entry
// per ally this hero supports. healing/passive are 0-100 (%), buffCount
// is 0-10 (number of buffs granted). Only the first SELFLESS_MAX_ALLIES
// entries count, matching the questionnaire's 0-4 ally-count selector.
function computeSelflessScore(supportedAllies) {
  const list = (Array.isArray(supportedAllies) ? supportedAllies : []).slice(0, SELFLESS_MAX_ALLIES);

  const totalUnits = list.reduce((sum, a) => {
    const healing = Math.max(0, Math.min(100, Number(a?.healing) || 0)) / 100;
    const passive = Math.max(0, Math.min(100, Number(a?.passive) || 0)) / 100;
    const buff    = Math.max(0, Math.min(10,  Number(a?.buffCount) || 0)) / 10;
    return sum + healing + passive + buff;
  }, 0);

  if (totalUnits <= 0) return 0;
  return +Math.min(10, (totalUnits / SELFLESS_MAX_UNITS) * 10).toFixed(2);
}

// Setting one score always zeros the other — one continuous scale,
// not two independent sliders (Section 3's opening paragraph).
function setHeroSelfishScore(heroId, checkedSkillIds) {
  const score = computeSelfishScore(checkedSkillIds);
  heroes = heroes.map(h => h.id === heroId ? { ...h, selfishScore: score, selflessScore: 0 } : h);
  saveLocal();
  return score;
}

function setHeroSelflessScore(heroId, supportedAllies) {
  const score = computeSelflessScore(supportedAllies);
  heroes = heroes.map(h => h.id === heroId ? { ...h, selflessScore: score, selfishScore: 0 } : h);
  saveLocal();
  return score;
}

// Combined -10..+10 position on the single scale, for whichever
// session wires this into the shared slider mechanics (negative =
// Selfish side, positive = Selfless side, 0 = Neutral). The two
// setters above keep selfishScore/selflessScore mutually exclusive,
// but if legacy/migrated data ever has both set, Selfless wins the
// tie since it's the "later" half of the combined range.
function heroSelfishSelflessPosition(h) {
  const selfless = Math.max(0, Math.min(10, Number(h?.selflessScore) || 0));
  const selfish  = Math.max(0, Math.min(10, Number(h?.selfishScore) || 0));
  if (selfless > 0) return selfless;
  if (selfish > 0) return -selfish;
  return 0;
}

let dragging   = null;
let dragOffX   = 0, dragOffY = 0;
let editingId  = null;

// The hero edit modal's in-progress Selfish/Selfless value (Section 4) —
// kept as local state, not written to `heroes` directly, so it batches
// with every other field until Add/Save Changes is clicked, exactly like
// vScore/hScore/altStats above. Both the slider and the Questionnaire
// write here; only onModalConfirm() commits it to the hero.
let modalSelfishScore  = 0;
let modalSelflessScore = 0;
// Ghost/alt-stat equivalents (Section 6 open-decision: "extend ghost mode
// to the new axes"). altStats.vType/vScore/hType/hScore stay untouched
// alongside these — Quick Draft's ghost-build ranking still reads those.
let modalAltSelfishScore  = 0;
let modalAltSelflessScore = 0;

// Raw Questionnaire answers behind the score above — which of the 10
// self-skill checklist items were ticked (selfish), or the per-ally
// healing/passive/buff breakdown (selfless). Persisted on the hero
// itself (selfSkillIds/allySupport, altStats.selfSkillIds/allySupport)
// purely so the hero details "ⓘ" can show how the score was derived;
// the score fields above remain the source of truth for scoring/ranking.
let modalSelfSkillIds   = [];
let modalAllySupport    = [];
let modalAltSelfSkillIds = [];
let modalAltAllySupport  = [];

// The hero edit modal's in-progress Reactions/Engagements assignment
// (Rebuild Spec Section 5.3) — same batching pattern as the Selfish/
// Selfless state above: arrays of { refId, score }, local to the modal
// session until Add/Save Changes commits them onto the hero. Ghost no
// longer keeps its own copy of these — it shares modalReactions/
// modalEngagements exactly (only Selfish/Selfless stays independent
// per build) — see rteModalArray further down.
let modalReactions   = [];
let modalEngagements = [];

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
// Rebuild Spec Section 9.2 — Autofill's default team composition. These
// only ever apply through qdRequiredSideForDraft() below; they don't
// change QD_SIZE itself, so a non-default QD_SIZE would just relax once
// both targets are met (see that function's "quotas already met" case).
const QD_SELFLESS_TARGET = 2;
const QD_SELFISH_TARGET  = 3;
let quickDraft = [null, null, null, null, null];

// Fake Enemy Team (practice/testing scratch tool, see the "Enemy Team"
// button wiring above) — [{ hero, side }], session-only, never
// persisted. Regenerated fresh by qdGenerateFakeEnemyTeam(); kept
// around between renders only so re-opening the panel without
// clicking Reroll shows the same team instead of blanking out.
let qdEnemyTeam = [];

// Picks up to n random, non-repeating entries out of pool without
// mutating it (Fisher–Yates-style partial shuffle via splice on a
// copy). Returns fewer than n if the pool itself is smaller.
function qdPickRandomFrom(pool, n) {
  const copy = [...pool];
  const picked = [];
  while (picked.length < n && copy.length) {
    const idx = Math.floor(Math.random() * copy.length);
    picked.push(copy.splice(idx, 1)[0]);
  }
  return picked;
}

// Builds a random 3 Selfish + 2 Selfless "enemy" team from the roster
// — mirrors Autofill's own default composition (QD_SELFISH_TARGET /
// QD_SELFLESS_TARGET), just for a fake opposing side to plan against.
// Heroes already in the user's own Quick Draft team are excluded so
// the two teams can never overlap. Only ever reads primary-build side
// (qdHeroSide with "primary") since there's no Ghost-vs-primary choice
// to make for a hypothetical enemy. Purely a practice/testing tool —
// qdEnemyTeam is never saved to GitHub or touched by save/load at all.
function qdGenerateFakeEnemyTeam() {
  const draftedIds = new Set(quickDraft.filter(raw => raw !== null && raw !== undefined).map(raw => qdParsePick(raw).heroId));
  const available = heroes.filter(h => !draftedIds.has(h.id));
  // Neutral heroes match both sides (qdHeroMatchesSide), so the Selfish
  // draw happens first and its picks are excluded from the Selfless
  // pool — otherwise the same Neutral hero could be drawn into both
  // halves of the fake team at once.
  const selfishPool = available.filter(h => qdHeroMatchesSide(h, "primary", "selfish"));
  const selfishPicks = qdPickRandomFrom(selfishPool, QD_SELFISH_TARGET);
  const usedIds = new Set(selfishPicks.map(h => h.id));
  const selflessPool = available.filter(h => !usedIds.has(h.id) && qdHeroMatchesSide(h, "primary", "selfless"));
  qdEnemyTeam = [
    ...selfishPicks.map(hero => ({ hero, side: "selfish" })),
    ...qdPickRandomFrom(selflessPool, QD_SELFLESS_TARGET).map(hero => ({ hero, side: "selfless" })),
  ];
  renderQdEnemyTeam();
}

function renderQdEnemyTeam() {
  const box = document.getElementById("qd-enemy-team-slots");
  if (!box) return;
  const totalWanted = QD_SELFISH_TARGET + QD_SELFLESS_TARGET;
  if (!qdEnemyTeam.length) {
    box.innerHTML = `<div class="qd-enemy-team-note">Not enough eligible heroes (rated or Neutral) in your roster yet to build a fake team.</div>`;
    return;
  }
  const note = qdEnemyTeam.length < totalWanted
    ? `<div class="qd-enemy-team-note">Only found ${qdEnemyTeam.length}/${totalWanted} — not enough eligible heroes left in your roster (outside your own Quick Draft team) for a full split.</div>`
    : "";
  const slotsHTML = qdEnemyTeam.map(({ hero, side }) => {
    const portrait = hero.iconData ? `<img src="${hero.iconData}">` : "⚔️";
    const sideIcon = side === "selfish" ? "😈" : "🙏";
    // Neutral heroes get drawn into whichever half still needs filling
    // (qdHeroMatchesSide) — flag them here so it's clear this isn't
    // actually a rated Selfish/Selfless pick, just one standing in.
    const isNeutral = qdHeroSide(hero, "primary") === "neutral";
    const neutralNote = isNeutral ? ` <span title="Neutral — unrated, standing in for this side">⚖️</span>` : "";
    return `
      <div class="qd-enemy-slot">
        <div class="qd-slot-portrait">${portrait}</div>
        <div class="qd-slot-name">${hero.name || "Unnamed"}</div>
        <div class="qd-enemy-slot-side">${sideIcon} ${side === "selfish" ? "Selfish" : "Selfless"}${neutralNote}</div>
      </div>`;
  }).join("");
  box.innerHTML = note + slotsHTML;
}
// Section 9.4 — manual override for which side (Selfless/Selfish) Suggest,
// Next Best, and Autofill prioritize for the next open slot. null = follow
// the automatic 3-Selfish/2-Selfless quota (qdRequiredSideForDraft); set to
// "selfless"/"selfish" once the ⇄ switch next to the Avg badge is tapped,
// overriding that quota until Clear resets it (see clearQuickDraft).
let qdManualSideOverride = null;
let quickDraftOpen = false;
let quickDraftSuggestOpen = false;

/* "Next Best" — swaps out whichever slot was most recently filled for
   the next-ranked candidate in that same slot's suggestion list. Doesn't
   persist or remember which heroes you don't own; it's just a pointer
   into the current ranked list for the last-touched slot, walking down
   one rank per click and wrapping back to #1 if you run off the end. */
let qdLastFilledSlot = null;
let qdNextBestRank = 0;

// [NEW FEATURE] heroId -> slotIndex it was swapped OUT of the last time
// Rep. Curr. was pressed. While a heroId is in here, it's excluded from
// every OTHER slot's suggestions (Suggest/Autofill/Randomize/Rep. Curr.)
// — see qdSimpleSuggestForSlot — but the slot it was swapped out of can
// still cycle back to it, since that's not "another" slot. Cleared
// entirely by Clear (clearQuickDraft) and kept in sync with slot shifts
// caused by removing a hero (see qdReindexReplacedHeroOrigins).
let qdReplacedHeroOrigin = new Map();

// Keeps qdReplacedHeroOrigin's slot indices valid after removeFromQuickDraft
// compacts the array. Any exclusion recorded against the slot that just
// emptied out is dropped (that slot's identity changed), everything after
// it shifts down by one, matching the array's own compaction.
function qdReindexReplacedHeroOrigins(removedIndex) {
  if (removedIndex === -1 || removedIndex == null || qdReplacedHeroOrigin.size === 0) return;
  const next = new Map();
  qdReplacedHeroOrigin.forEach((slotIdx, heroId) => {
    if (slotIdx === removedIndex) return;
    next.set(heroId, slotIdx > removedIndex ? slotIdx - 1 : slotIdx);
  });
  qdReplacedHeroOrigin = next;
}
let qdBanProtectElement = null; // the element of the enemy's un-bannable "Ban Protect" pick, if set (Rule 1)
let qdCompetitiveMode = false; // when on: 3★ heroes (chained or support) are excluded from Randomize/Suggest/Autofill unless pvpTag is set. Session-only, like the rest of Quick Draft's state.

// Rebuild Spec Section 8.1 — the enemy Factor checklist. Ticking a Factor
// here means "the enemy has this" and is what now represents the enemy's
// kit during a live draft, replacing the old single-element Ban Protect
// pick for recommendation purposes (Section 8.4) — that element system
// stays in place below purely to back the legacy quadrant/chain rules
// (Section 8.3), it just isn't consulted first anymore. Holds Factor ids
// (taxonomy.factors[].id), session-only like the rest of Quick Draft's
// state — resets on Clear, same as qdBanProtectElement.
let qdTickedFactorIds = new Set();

// Which of the ticked Factors above are additionally "prioritized" —
// each one's per-Factor score is simply doubled (independently of any
// other prioritized Factor) before being averaged into a hero's final
// Factor-mode score — see qdFactorEntryForHero for the actual ranked-
// %-spread scoring formula. Always a subset of qdTickedFactorIds;
// anything pruned from that Set (untick, or the Factor itself gets
// deleted) is pruned from this one too. Session-only, same as
// qdTickedFactorIds.
let qdPrioritizedFactorIds = new Set();

// Enemy Factor dropdown menu state (Section 8.1) — declared up here,
// ahead of renderQdFactorChips()'s definition further down, because
// that function is invoked from top-level init code (not deferred
// inside another function) earlier in this same script. `let` isn't
// hoisted with a value the way `function` is, so if these lived next
// to the rest of the Factor-menu code below instead, that early call
// would hit them mid-TDZ and throw "Cannot access before initialization".
let qdFactorMenuSearch = "";
let qdFactorMenuEl = null;
// One-shot hook fired the moment the Enemy Factors picker actually
// closes (✕, backdrop tap, or Escape — every path runs through the same
// closeMenu() in ensureQdFactorMenu below). Lets a caller that opened
// this picker "on top of" something else — right now, Hero Factors'
// "🎯 Edit Enemy Factors" shortcut — get control back afterward instead
// of the picker simply vanishing with nothing to return to. Cleared
// right before it's called so it can never accidentally double-fire or
// leak into some unrelated later open/close of the same picker.
let qdFactorMenuOnClose = null;

// Quick-tap keyword chips shown under the Enemy Factors search bar —
// common substrings so a frequent filter is one tap instead of typing.
// Clicking one drops it straight into the search box (see
// qdFactorMenuSetSearch); clicking the same one again clears it.
const QD_FACTOR_QUICK_WORDS = [
  "High", "Low", "Evasion", "Buff", "Debuff", "Dispel", "Pen", "Shield",
  "Defen", "Counter", "Additional", "Damage", "Unit", "Soul", "Attack",
  "Heal", "Stun",
];

// Shared by every Quick Draft pick source (Randomize, Suggest, Autofill —
// Autofill just calls into Suggest under the hood) so the ban is applied
// consistently everywhere a hero could be chosen, whether as a chain
// "main" or as a support.
function qdIsBannedByCompetitive(h) {
  return qdCompetitiveMode && h.rarity === "3" && !h.pvpTag;
}
const QD_ELEMENT_COUNTER = { Fire: "Ice", Ice: "Earth", Earth: "Fire", Light: "Dark", Dark: "Light" }; // which element beats which

/* [Section 3] Legacy quadrant/tier/chain engine (Rules 1-5, QD_OPPOSITE_QUADRANT,
   QD_QUADRANT_LABEL) removed here. Replacement simplified scoring engine lands
   in Section 4 (qdSimpleSuggestForSlot / qdSimpleScoreEntry / qdOverallKitScore). */

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
const fIconData    = document.getElementById("f-icon-data");
const fNotes       = document.getElementById("f-notes");
const iconCanvas   = document.getElementById("icon-canvas");
const modalConfirm = document.getElementById("modal-confirm");
const modalDelete  = document.getElementById("modal-delete");
const saveStatus   = document.getElementById("save-status");
const fSsScore     = document.getElementById("f-ss-score");

// Shows/hides a floating "↑ jump to top" button as its scroll container
// is scrolled, and wires its click to scroll that same container back to
// 0. Shared by the Add/Edit Hero overlay (scrollEl is the overlay itself)
// and the Taxonomy modal (scrollEl is .taxonomy-body — the header/tabs
// above it are sticky and never scroll, so tying this to the whole modal
// would never fire). Wired once here at startup (buttons and containers
// are both static markup, present whether or not their modal is
// currently open), rather than re-wired every time a modal opens.
function wireScrollTopBtn(scrollEl, btnId, threshold = 240) {
  const scrollBtn = document.getElementById(btnId);
  if (!scrollEl || !scrollBtn) return;
  scrollEl.addEventListener("scroll", () => {
    scrollBtn.classList.toggle("visible", scrollEl.scrollTop > threshold);
  });
  scrollBtn.addEventListener("click", () => {
    scrollEl.scrollTo({ top: 0, behavior: "smooth" });
  });
}

/* ═══════════════════════════════════════
   INIT
═══════════════════════════════════════ */
(function init() {
  // Heroes and Quick Draft state now start empty every page load — GitHub
  // (via autoLoadFromServer, below) is the only source of truth. Nothing
  // is read from or written to localStorage anymore.

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

  // Floating "↑ jump to top" buttons — only show once scrolled down a
  // bit, so they're not just permanently sitting over content on short
  // screens/short forms. The Taxonomy modal's panels tend to be shorter
  // than the Add/Edit Hero form, so it gets a lower threshold.
  wireScrollTopBtn(overlay, "modal-scroll-top-btn");
  wireScrollTopBtn(document.querySelector(".taxonomy-modal .taxonomy-body"), "taxonomy-scroll-top-btn", 120);

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

  // Reaction/Engagement/Factor Taxonomy Manager (Rebuild Spec Section 5) —
  // same admin gate pattern as Add Hero, since it edits the shared library.
  const btnTaxonomy = document.getElementById("btn-taxonomy");
  if (btnTaxonomy) {
    btnTaxonomy.addEventListener("click", () => {
      if (editSessionUnlocked) openTaxonomyManager();
      else openAdminGate("taxonomy");
    });
  }
  document.getElementById("taxonomy-close").addEventListener("click", closeTaxonomyManager);
  // Deliberately no click-outside-to-close on the overlay: a stray tap
  // while scrolling/reaching for a row (this modal has a lot of dense,
  // tappable controls — search, sort, tag, Add to Hero, delete, ⇄) was
  // closing the whole manager and discarding whatever the person was
  // mid-way through. The ✕ button above is the only way out now.
  document.querySelectorAll(".taxonomy-tab").forEach(btn => {
    btn.addEventListener("click", () => switchTaxonomyTab(btn.dataset.tab));
  });

  // Performance Ranking System — fullscreen overlay, not a tab (see
  // openTaxonomyRankingOverlay). Deliberately no backdrop-tap/Escape
  // close here (unlike the Enemy Factors picker / Know More explainer
  // it shares its shell with) — it now has real editing on it (rename,
  // lock, the score slider), not just a read-only list, so an
  // accidental outside tap could interrupt someone mid-edit the same
  // way it could on the main Taxonomy modal. The ✕ button is the only
  // way out.
  const rankingBtn = document.getElementById("taxonomy-ranking-btn");
  const rankingOverlay = document.getElementById("taxonomy-ranking-overlay");
  if (rankingBtn) rankingBtn.addEventListener("click", openTaxonomyRankingOverlay);
  if (rankingOverlay) {
    rankingOverlay.querySelector("#taxonomy-ranking-close")?.addEventListener("click", closeTaxonomyRankingOverlay);
    // Quick Save — same admin-gated GitHub save as the header's ↑ Save
    // button, just reachable without leaving the Ranking overlay. Reuses
    // openAdminGate so a cached password (this session) saves instantly;
    // otherwise it prompts the same password modal (now above this
    // overlay — see #admin-overlay's z-index).
    rankingOverlay.querySelector("#taxonomy-ranking-quicksave")?.addEventListener("click", () => openAdminGate("save"));
    // Locked/Unlocked/Marked/Unmarked/Unassigned filter chips — each
    // toggles independently and they combine (AND), see taxonomyRankingFilter.
    rankingOverlay.querySelectorAll(".taxonomy-ranking-filter-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const key = chip.dataset.filter;
        taxonomyRankingFilter[key] = !taxonomyRankingFilter[key];
        renderTaxonomyRankingPanel();
      });
    });

    // "☑ Select" — toggles multi-select mode on the list; turning it off
    // also clears whatever was selected, so re-enabling it later always
    // starts from a clean slate rather than an old, possibly-stale pick.
    const selectToggleBtn = rankingOverlay.querySelector("#taxonomy-ranking-select-toggle");
    if (selectToggleBtn) {
      selectToggleBtn.addEventListener("click", () => {
        taxonomyRankingSelectMode = !taxonomyRankingSelectMode;
        if (!taxonomyRankingSelectMode) taxonomyRankingSelected.clear();
        selectToggleBtn.classList.toggle("active", taxonomyRankingSelectMode);
        renderTaxonomyRankingPanel();
      });
    }

    // Bulk score editor — only meaningful once at least one row is
    // selected (see renderTaxonomyRankingBulkBar, which disables these
    // otherwise). "Select All"/"Clear" work against whatever's currently
    // on screen (post filter/search), same scope the count itself uses.
    rankingOverlay.querySelector("#taxonomy-ranking-bulk-selectall")?.addEventListener("click", () => {
      rankingOverlay.querySelectorAll(".taxonomy-ranking-row").forEach(rowEl => {
        taxonomyRankingSelected.add(taxonomyRankingSelKey(rowEl.dataset.kind, Number(rowEl.dataset.id)));
      });
      renderTaxonomyRankingPanel();
    });
    rankingOverlay.querySelector("#taxonomy-ranking-bulk-clear")?.addEventListener("click", () => {
      taxonomyRankingSelected.clear();
      renderTaxonomyRankingPanel();
    });
    rankingOverlay.querySelector("#taxonomy-ranking-bulk-apply")?.addEventListener("click", () => {
      const val = Number(document.getElementById("taxonomy-ranking-bulk-value")?.value);
      applyTaxonomyRankingBulk("set", Number.isFinite(val) ? val : 0);
    });
    rankingOverlay.querySelector("#taxonomy-ranking-bulk-minus")?.addEventListener("click", () => applyTaxonomyRankingBulk("delta", -0.5));
    rankingOverlay.querySelector("#taxonomy-ranking-bulk-plus")?.addEventListener("click", () => applyTaxonomyRankingBulk("delta", 0.5));
  }
  // Rename modal (opened by each row's ✏️ button) — can be triggered
  // from inside the Performance Ranking overlay, where an accidental
  // outside tap while renaming shouldn't silently discard the edit. So,
  // unlike most of the app's other small modals, this one is only
  // closed via its own Cancel button or Escape — never an outside
  // click on the backdrop.
  document.getElementById("rename-modal-save").addEventListener("click", saveRenameModal);
  document.getElementById("rename-modal-cancel").addEventListener("click", closeRenameModal);
  document.getElementById("rename-modal-input").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); saveRenameModal(); }
    else if (e.key === "Escape") { e.preventDefault(); closeRenameModal(); }
  });
  // Live "does this already exist?" suggestions — see
  // renderRenameModalSuggestions. Re-filters on every keystroke; hides
  // on blur (delayed so a click on a suggestion registers first).
  document.getElementById("rename-modal-input").addEventListener("input", renderRenameModalSuggestions);
  document.getElementById("rename-modal-input").addEventListener("input", () => {
    if (renameModalTarget) renderRenameModalCategoryChips(renameModalTarget.kind);
  });
  document.getElementById("rename-modal-input").addEventListener("focus", renderRenameModalSuggestions);
  document.getElementById("rename-modal-input").addEventListener("blur", () => {
    setTimeout(hideRenameModalSuggestions, 150);
  });
  wireTaxonomyAddRow("taxonomy-add-reaction", "taxonomy-new-reaction", "Reaction", val => {
    const item = addTaxonomyItem("reactions", val);
    renderTaxonomyPanel("reactions");
    renderRteSection();
    remindToAddHeroes("reactions", item.id);
  }, "taxonomy-add-reaction-category-chips");
  wireTaxonomyAddRow("taxonomy-add-engagement", "taxonomy-new-engagement", "Engagement", val => {
    const item = addTaxonomyItem("engagements", val);
    renderTaxonomyPanel("engagements");
    renderRteSection();
    remindToAddHeroes("engagements", item.id);
  }, "taxonomy-add-engagement-category-chips");
  wireTaxonomyAddRow("taxonomy-add-factor", "taxonomy-new-factor", "Factor", val => {
    addFactor(val);
    renderFactorsPanel();
    renderQdFactorChips(); // Section 8.1 checklist — new Factor shows up immediately
    if (typeof renderHeroFactorsButton === "function") renderHeroFactorsButton(); // keep Hero Factors' button/grid in sync with the Enemy Factors state it reads
  });

  // Search boxes for each Taxonomy tab — filters that tab's list by
  // name. Each has a matching "-clear" X button in the markup, plus a
  // "+" quick-add button (only shown once the typed text matches
  // nothing currently in the list) that creates a brand-new item using
  // that exact search text as its name — no need to scroll back up to
  // the dedicated "add new" row for something you were just searching
  // for and came up empty.
  const wireTaxonomySearch = (inputId, kind, renderFn, onQuickAdd) => {
    const input = document.getElementById(inputId);
    const clearBtn = document.getElementById(inputId + "-clear");
    const quickAddBtn = document.getElementById(`taxonomy-quickadd-${kind}`);
    if (!input) return;
    const syncQuickAdd = () => {
      if (!quickAddBtn) return;
      const q = input.value.trim();
      const hasMatch = taxonomy[kind].some(x => taxonomyMatchesSearch(kind, x.name));
      quickAddBtn.style.display = (q && !hasMatch) ? "inline-flex" : "none";
    };
    const apply = () => {
      taxonomySearchQuery[kind] = input.value;
      renderFn(kind === "factors" ? undefined : kind);
      syncQuickAdd();
      renderTaxonomyCrossSuggest(kind);
    };
    input.addEventListener("input", apply);
    wireTaxonomySearchClear(input, clearBtn, apply);
    syncQuickAdd();
    // Cross-tab suggestions (Reactions ↔ Engagements only — see
    // TAXONOMY_CROSS_KIND) re-show on focus in case there's already text
    // left over from a previous visit, and hide on blur, delayed so a
    // mousedown on a suggestion registers first.
    if (TAXONOMY_CROSS_KIND[kind]) {
      input.addEventListener("focus", () => renderTaxonomyCrossSuggest(kind));
      input.addEventListener("blur", () => setTimeout(() => hideTaxonomyCrossSuggest(kind), 150));
    }
    if (quickAddBtn && onQuickAdd) {
      quickAddBtn.addEventListener("click", () => {
        const val = input.value.trim();
        if (!val) return;
        onQuickAdd(val);
        // onQuickAdd (Reactions/Engagements) already clears the filter
        // itself via remindToAddHeroes's own stale-filter check; this
        // just covers the Factors case, which has no such flow.
        if (input.value.trim()) {
          input.value = "";
          if (clearBtn) clearBtn.style.display = "none";
          taxonomySearchQuery[kind] = "";
          renderFn(kind === "factors" ? undefined : kind);
        }
        syncQuickAdd();
      });
    }
  };
  wireTaxonomySearch("taxonomy-search-reactions", "reactions", renderTaxonomyPanel, val => {
    const item = addTaxonomyItem("reactions", val);
    renderRteSection();
    remindToAddHeroes("reactions", item.id);
  });
  wireTaxonomySearch("taxonomy-search-engagements", "engagements", renderTaxonomyPanel, val => {
    const item = addTaxonomyItem("engagements", val);
    renderRteSection();
    remindToAddHeroes("engagements", item.id);
  });
  wireTaxonomySearch("taxonomy-search-factors", "factors", renderFactorsPanel, val => {
    addFactor(val);
    renderQdFactorChips(); // Section 8.1 checklist — new Factor shows up immediately
    if (typeof renderHeroFactorsButton === "function") renderHeroFactorsButton(); // keep Hero Factors' button/grid in sync with the Enemy Factors state it reads
  });

  // Ranking tab's search box — simpler than wireTaxonomySearch above
  // since it spans both kinds at once and has no "+ quick add" concept
  // (you can't "add" a combined Reaction/Engagement row).
  (() => {
    const input = document.getElementById("taxonomy-search-ranking");
    const clearBtn = document.getElementById("taxonomy-search-ranking-clear");
    if (!input) return;
    const apply = () => { taxonomyRankingSearchQuery = input.value; renderTaxonomyRankingPanel(); };
    input.addEventListener("input", apply);
    wireTaxonomySearchClear(input, clearBtn, apply);
  })();

  // Quick-fill chips (Increase/Decrease/Passive/Buff/Debuff/Dispel) sit
  // under each tab's search box — clicking one fills/appends that word
  // into the search bar itself (not the "add new" row) and re-runs the
  // filter, so it's a fast way to jump straight to, say, every existing
  // "Buff"-named item — or, combined with the "+" quick-add button next
  // to the search box, to quickly start naming a new one from a common
  // recurring word.
  const wireTaxonomyQuickFill = (quickFillId, searchInputId) => {
    const box = document.getElementById(quickFillId);
    const searchInput = document.getElementById(searchInputId);
    if (!box || !searchInput) return;
    box.querySelectorAll(".taxonomy-quickfill-btn").forEach(chip => {
      chip.addEventListener("click", () => {
        const word = chip.textContent.trim();
        const current = searchInput.value.trim();
        searchInput.value = current ? `${current} ${word}` : word;
        // Programmatic value changes don't fire "input" on their own —
        // dispatch one so the existing search-filter wiring (and the
        // "+" quick-add button's visibility) reacts exactly as if it
        // had been typed.
        searchInput.dispatchEvent(new Event("input", { bubbles: true }));
        searchInput.focus();
        searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
      });
    });
  };
  wireTaxonomyQuickFill("taxonomy-search-reactions-quickfill", "taxonomy-search-reactions");
  wireTaxonomyQuickFill("taxonomy-search-engagements-quickfill", "taxonomy-search-engagements");
  wireTaxonomyQuickFill("taxonomy-search-factors-quickfill", "taxonomy-search-factors");

  // Sort dropdowns for each Taxonomy tab (oldest/newest by creation,
  // or A→Z / Z→A by name) — same independent-per-tab pattern as search.
  const wireTaxonomySort = (selectId, kind, renderFn) => {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.value = taxonomySortMode[kind];
    select.addEventListener("change", () => {
      taxonomySortMode[kind] = select.value;
      renderFn(kind === "factors" ? undefined : kind);
    });
  };
  wireTaxonomySort("taxonomy-sort-reactions", "reactions", renderTaxonomyPanel);
  wireTaxonomySort("taxonomy-sort-engagements", "engagements", renderTaxonomyPanel);
  wireTaxonomySort("taxonomy-sort-factors", "factors", renderFactorsPanel);

  // Same pattern, but a separate select/state (taxonomyRankingSortMode)
  // since the Ranking overlay's options are score-based rather than
  // creation-order-based, and it's a combined Reactions+Engagements
  // list rather than one tab.
  const rankingSort = document.getElementById("taxonomy-sort-ranking");
  if (rankingSort) {
    rankingSort.value = taxonomyRankingSortMode;
    rankingSort.addEventListener("change", () => {
      taxonomyRankingSortMode = rankingSort.value;
      renderTaxonomyRankingPanel();
    });
  }

  // Per-hero Reaction/Engagement assignment (Section 5.3), inside the hero
  // edit modal — search-to-add is wired lazily from renderRteAddSearch()
  // itself (see rte section below) since the search inputs need to bind
  // once and then just be refreshed, not re-wired, on every render.

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

  // "Last saved" ⓘ — click toggles the popup; click anywhere else closes it.
  updateLastSavedIndicator();
  document.getElementById("last-saved-info-btn").addEventListener("click", e => {
    e.stopPropagation();
    toggleLastSavedPopup();
  });
  document.addEventListener("click", e => {
    const popup = document.getElementById("last-saved-popup");
    const btn = document.getElementById("last-saved-info-btn");
    if (!popup || popup.style.display === "none" || !popup.style.display) return;
    if (popup.contains(e.target) || (btn && btn.contains(e.target))) return;
    popup.style.display = "none";
  });
  // Keep it glued to the button while open, same reasoning as the
  // Enemy Factors dropdown: fixed-position coordinates don't update
  // themselves on their own if the page scrolls or the window resizes.
  const repositionLastSavedPopup = () => {
    const popup = document.getElementById("last-saved-popup");
    if (popup && popup.style.display === "block") positionLastSavedPopup();
  };
  window.addEventListener("resize", repositionLastSavedPopup);
  window.addEventListener("scroll", repositionLastSavedPopup, true);

  // Background sync check — catches a save made from a *different*
  // browser/device while this tab stayed open and unrefreshed (the
  // exact scenario "I have it open on my phone but didn't refresh
  // after saving from my laptop"). Runs on an interval while the tab
  // is visible, and again the moment it becomes visible after being
  // backgrounded — checkSyncStatus() itself no-ops while hidden.
  setInterval(checkSyncStatus, 45000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkSyncStatus();
  });

  // Import a save file — merges in only heroes you don't already have;
  // never overwrites or touches any hero already in the current roster.
  // Guarded with existence checks: if some future page includes app.js
  // without these two elements, we skip wiring them up instead of
  // throwing and silently breaking every listener that comes after this
  // in init() (which is exactly what happened here before this fix).
  const btnImport = document.getElementById("btn-import");
  const importFileInput = document.getElementById("import-file-input");
  if (btnImport && importFileInput) {
    btnImport.addEventListener("click", () => {
      if (editSessionUnlocked) triggerImportFilePicker();
      else openAdminGate("import");
    });
    importFileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      e.target.value = ""; // reset so picking the same file twice still fires "change"
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let parsed;
        try { parsed = JSON.parse(reader.result); }
        catch { setStatus("❌ That file isn't valid JSON"); return; }
        handleImportedFile(parsed);
      };
      reader.onerror = () => setStatus("❌ Couldn't read that file");
      reader.readAsText(file);
    });
  }

  // Export — Section 10, the file-based counterpart to Import above.
  // Not gated behind the admin password (read-only, same data the
  // public-load endpoint already serves to every visitor).
  const btnExport = document.getElementById("btn-export");
  if (btnExport) btnExport.addEventListener("click", exportToFile);

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
  // Fake Enemy Team — pure practice/testing scratch tool, session-only
  // (never saved to GitHub, never touches the real quickDraft array).
  // Guarded with null-checks throughout: index.html and quickdraft.html
  // each keep their own separate copy of this drawer's markup, and an
  // unguarded .addEventListener on a missing element has already once
  // taken down every button on the page (see the taxonomy-jump-top fix)
  // — never again assume a button added to one HTML file is present in
  // both without checking.
  const btnEnemyTeam = document.getElementById("btn-qd-enemy-team");
  if (btnEnemyTeam) {
    btnEnemyTeam.addEventListener("click", () => {
      const panel = document.getElementById("qd-enemy-team-panel");
      if (!panel) return;
      const isOpen = panel.style.display !== "none";
      if (isOpen) { panel.style.display = "none"; return; }
      panel.style.display = "block";
      if (!qdEnemyTeam.length) qdGenerateFakeEnemyTeam();
    });
  }
  const btnEnemyReroll = document.getElementById("btn-qd-enemy-reroll");
  if (btnEnemyReroll) btnEnemyReroll.addEventListener("click", qdGenerateFakeEnemyTeam);
  const btnEnemyClose = document.getElementById("btn-qd-enemy-close");
  if (btnEnemyClose) {
    btnEnemyClose.addEventListener("click", () => {
      const panel = document.getElementById("qd-enemy-team-panel");
      if (panel) panel.style.display = "none";
    });
  }
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

  // Enemy Factor checklist (Section 8.1) — unlike the Ban Protect chips
  // just above, these are user-defined, so they're built fresh from the
  // taxonomy library rather than wired one-by-one here.
  renderQdFactorChips();
  if (typeof renderHeroFactorsButton === "function") renderHeroFactorsButton(); // keep Hero Factors' button/grid in sync with the Enemy Factors state it reads

  document.getElementById("btn-quickdraft-autofill").addEventListener("click", autofillTopQuickDraftPick);

  // Competitive mode — bans all 3★ heroes (as chained mains or supports)
  // from Quick Draft's pick pool, except any explicitly PVP-tagged ones.
  // Session-only, like the rest of Quick Draft's state — resets each load.
  const qdCompetitiveCheckbox = document.getElementById("qd-competitive-mode");
  if (qdCompetitiveCheckbox) {
    qdCompetitiveCheckbox.checked = qdCompetitiveMode;
    qdCompetitiveCheckbox.addEventListener("change", () => {
      qdCompetitiveMode = qdCompetitiveCheckbox.checked;
      if (quickDraftSuggestOpen) renderQuickDraftSuggestions();
    });
  }
  const nextBestBtn = document.getElementById("btn-quickdraft-nextbest");
  if (nextBestBtn) nextBestBtn.addEventListener("click", nextBestQuickDraftPick);
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("modal-overlay").addEventListener("click", e => { if (e.target === overlay) closeModal(); });
  modalConfirm.addEventListener("click", onModalConfirm);
  modalDelete.addEventListener("click", onModalDelete);

  // Stat comparison popup

  // Selfish/Selfless slider + Questionnaire (Rebuild Spec Section 3/4)
  fSsScore.addEventListener("input", onSsSliderInput);
  document.getElementById("btn-open-questionnaire").addEventListener("click", () => openQuestionnaireModal("main"));
  document.getElementById("f-alt-ss-score").addEventListener("input", onAltSsSliderInput);
  document.getElementById("btn-open-alt-questionnaire").addEventListener("click", () => openQuestionnaireModal("alt"));
  document.getElementById("ss-choose-selfish").addEventListener("click", () => ssChooseSide("selfish"));
  document.getElementById("ss-choose-selfless").addEventListener("click", () => ssChooseSide("selfless"));
  document.getElementById("ss-modal-back").addEventListener("click", ssBackToChoose);
  document.getElementById("ss-modal-cancel").addEventListener("click", closeQuestionnaireModal);
  document.getElementById("ss-modal-confirm").addEventListener("click", confirmQuestionnaire);
  document.getElementById("ss-ally-count").addEventListener("click", e => {
    const btn = e.target.closest(".ss-count-btn");
    if (btn) ssSetAllyCount(Number(btn.dataset.count));
  });
  document.getElementById("ss-modal-overlay").addEventListener("click", e => {
    if (e.target === document.getElementById("ss-modal-overlay")) closeQuestionnaireModal();
  });

  // Full-screen axis sliders
  document.getElementById("btn-open-h-slider").addEventListener("click", () => openXSlider("main"));
  document.getElementById("btn-open-v-slider").addEventListener("click", () => openYSlider("main"));
  document.getElementById("btn-open-alt-h-slider").addEventListener("click", () => openXSlider("alt"));
  document.getElementById("btn-open-alt-v-slider").addEventListener("click", () => openYSlider("alt"));

  // X viewer is read-only now (Section 6 open-decision) — just open/close.
  document.getElementById("xslider-close").addEventListener("click", closeXSlider);
  document.getElementById("xslider-cancel").addEventListener("click", closeXSlider);
  document.getElementById("xslider-overlay").addEventListener("click", e => {
    if (e.target === document.getElementById("xslider-overlay")) closeXSlider();
  });

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
  // Section 7.3: listen on the wrap, not the thin visual rail.
  const yTrackWrap = document.getElementById("yslider-track-wrap");
  yTrackWrap.addEventListener("pointerdown", ySliderPointerDown);
  yTrackWrap.addEventListener("pointermove", ySliderPointerMove);
  yTrackWrap.addEventListener("pointerup",   ySliderPointerUp);
  yTrackWrap.addEventListener("pointercancel", ySliderPointerUp);

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

  // Icon size control — session-only now (no browser persistence); resets
  // to the CSS default each time the page loads.
  const iconSizeInput = document.getElementById("vis-icon-size");
  iconSizeInput.addEventListener("input", () => {
    const size = Math.max(16, Math.min(80, Number(iconSizeInput.value) || 38));
    document.documentElement.style.setProperty("--icon-size", size + "px");
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
    const legacyFixed = isLegacyHeroShape(h) ? migrateLegacyHero(h) : h;
    const needsFix = legacyFixed.hType === "RS" || legacyFixed.altStats?.hType === "RS";
    const fixed = !needsFix ? legacyFixed : {
      ...legacyFixed,
      hType: legacyFixed.hType === "RS" ? "SST" : legacyFixed.hType,
      altStats: legacyFixed.altStats ? { ...legacyFixed.altStats, hType: legacyFixed.altStats.hType === "RS" ? "SST" : legacyFixed.altStats.hType } : legacyFixed.altStats,
    };
    // Also backfill the new Section 1 fields (reactions/engagements/
    // selfishScore/selflessScore) on every hero as it comes off the
    // wire — a no-op for anything migrateLegacyHero() above already
    // touched, but still needed as a defensive fallback for anything
    // else that might slip through with a partially-shaped object.
    return ensureHeroTaxonomyFields(fixed);
  });
}

/* ═══════════════════════════════════════
   LEGACY IMPORT MIGRATION (Rebuild Spec Section 2)

   A hero object is "legacy" — predates the whole Reaction/Engagement/
   Selfish/Selfless rebuild — only if it has NONE of the four new
   Section 1 keys at all. Checking for the keys' *presence*, not just
   an empty/zero value, is what lets this tell a genuinely old export
   apart from an ordinary hero created after the rebuild that simply
   hasn't been scored yet (which also legitimately starts with
   reactions: [] / selfishScore: 0 — see onModalConfirm()).
═══════════════════════════════════════ */
function isLegacyHeroShape(h) {
  if (!h || typeof h !== "object") return false;
  return !("reactions" in h) && !("engagements" in h)
      && !("selfishScore" in h) && !("selflessScore" in h);
}

// Runs a single legacy hero through the Section 2.3 migration path.
//   - Identity fields (portrait/iconData, class/role, element, rarity,
//     name, id, notes, locked, pvpTag, position) are left untouched —
//     spread straight across via `...rest`.
//   - The old Sustainability/Survivability/Tankiness/Speed-CR-Gain
//     numbers (vType/vScore/hType/hScore/altStats) are NOT converted
//     onto the new 0–10 rubrics (Section 2.2 — they don't map
//     cleanly). They're kept only as a "_legacy" rollback net for one
//     release cycle, per the Section 1.2 open decision, and are no
//     longer read by anything active — see the DoD requirement that
//     no old stat numbers leak into the new score fields or the plot.
//   - reactions/engagements/selfishScore/selflessScore are initialized
//     fresh rather than inheriting anything from the old fields.
//   - needsRerating: true — a visible "unrated" badge (see renderRoster
//     and openHeroDetails below) rather than a silent 0, since 0 would
//     be indistinguishable from a genuinely bad score once someone
//     starts using the new Selfish/Selfless scale.
function migrateLegacyHero(h) {
  const { vType, vScore, hType, hScore, altStats, ...rest } = h;
  return {
    ...rest,
    vType_legacy:    vType,
    vScore_legacy:   vScore,
    hType_legacy:    hType,
    hScore_legacy:   hScore,
    altStats_legacy: altStats ?? null,
    reactions: [], engagements: [], selfishScore: 0, selflessScore: 0,
    needsRerating: true,
  };
}

function avgScore(vScore, hScore) {
  const v = Math.max(0, Math.min(10, Number(vScore) || 0));
  const h = Math.max(0, Math.min(10, Number(hScore) || 0));
  return +((v + h) / 2).toFixed(1);
}

/* ═══════════════════════════════════════
   REACTION/ENGAGE ↔ SELFISH/SELFLESS CHART POSITIONING
   (Rebuild Spec Section 6 — the deferred chart-plot wiring)

   Replaces scoresToXY/xyToScores for every CHART-facing surface: the
   main plot, roster cards, hero details, tooltips, and the magnifier.
   Quick Draft (draft.js + the qd* functions above) is intentionally
   LEFT READING vType/vScore/hType/hScore untouched — see the
   QD_QUADRANT_LABEL comment near the top of the Quick Draft section.
   Unifying Quick Draft onto these fields is Section 8/9 work; until
   then it keeps working off the old (now effectively frozen) values
   under its already-renamed display labels.

   X axis: Reaction (left) vs Engage (right) — both are independent
   derived averages (computeReactionScore/computeEngageScore), unlike
   the old SUR/SST fields there's no single "type" a hero is pinned
   to. Whichever score is higher decides which side of centre the dot
   sits on; the other side doesn't affect X position — same
   convention the old hType-gated math used (only the matching field
   ever counted).

   Y axis: Selfish (top) vs Selfless (bottom) — already a single
   continuous 0–10 scale by construction (Section 3: one of the two
   is always 0), so this maps directly the same way vType/vScore did.
═══════════════════════════════════════ */
function heroXAxis(h) {
  const r = Math.max(0, Math.min(10, computeReactionScore(h) || 0));
  const e = Math.max(0, Math.min(10, computeEngageScore(h) || 0));
  return r >= e ? { side: "REACTION", value: r } : { side: "ENGAGE", value: e };
}
function heroYAxis(h) {
  const selfish  = Math.max(0, Math.min(10, Number(h.selfishScore) || 0));
  const selfless = Math.max(0, Math.min(10, Number(h.selflessScore) || 0));
  return selfish >= selfless ? { side: "SELFISH", value: selfish } : { side: "SELFLESS", value: selfless };
}
function heroToXY(h) {
  const xa = heroXAxis(h), ya = heroYAxis(h);
  const x = xa.side === "REACTION" ? 50 - (xa.value / 10) * 50 : 50 + (xa.value / 10) * 50;
  const y = ya.side === "SELFISH"  ? 50 - (ya.value / 10) * 50 : 50 + (ya.value / 10) * 50;
  return { x, y };
}
// Ghost/alt-stat equivalents — Ghost shares the exact same
// Reactions/Engagements as the main build (only Selfish/Selfless
// differs between them), so the X axis is now just heroXAxis itself;
// heroAltYAxis below is the only one still reading from h.altStats.
function heroAltXAxis(h) {
  return heroXAxis(h);
}
function heroAltYAxis(h) {
  const src = h.altStats || {};
  const selfish  = Math.max(0, Math.min(10, Number(src.selfishScore) || 0));
  const selfless = Math.max(0, Math.min(10, Number(src.selflessScore) || 0));
  return selfish >= selfless ? { side: "SELFISH", value: selfish } : { side: "SELFLESS", value: selfless };
}
function heroAltToXY(h) {
  const xa = heroAltXAxis(h), ya = heroAltYAxis(h);
  const x = xa.side === "REACTION" ? 50 - (xa.value / 10) * 50 : 50 + (xa.value / 10) * 50;
  const y = ya.side === "SELFISH"  ? 50 - (ya.value / 10) * 50 : 50 + (ya.value / 10) * 50;
  return { x, y };
}
// Reverse Y-only conversion — dragging a dot on the main chart now only
// ever moves it vertically (X is derived/read-only per the Section 6
// open-decision: "read-only viewer, no drag").
function yToSelfishSelfless(y) {
  const clamped = Math.max(0, Math.min(100, y));
  if (clamped <= 50) return { selfishScore: +((50 - clamped) / 50 * 10).toFixed(1), selflessScore: 0 };
  return { selfishScore: 0, selflessScore: +((clamped - 50) / 50 * 10).toFixed(1) };
}
// Combined "Avg" badge for roster cards / hero details / tooltips —
// mirrors the old avgScore(vScore,hScore) shape (average of the two
// axis-dominant values). avgScore() itself is untouched and still
// backs Quick Draft's own scoring off the old fields.
function heroDisplayAvg(h) {
  return +((heroXAxis(h).value + heroYAxis(h).value) / 2).toFixed(1);
}
function heroAltDisplayAvg(h) {
  return +((heroAltXAxis(h).value + heroAltYAxis(h).value) / 2).toFixed(1);
}
// Tooltip text for a chart dot — primary or ghost.
function heroChartTooltip(h, isGhost) {
  const xa = isGhost ? heroAltXAxis(h) : heroXAxis(h);
  const ya = isGhost ? heroAltYAxis(h) : heroYAxis(h);
  const avg = isGhost ? heroAltDisplayAvg(h) : heroDisplayAvg(h);
  const xLabel = xa.side === "REACTION" ? "Reaction" : "Engage";
  const yLabel = ya.value === 0 ? "Neutral" : (ya.side === "SELFISH" ? "Selfish" : "Selfless");
  return `${xLabel} ${xa.value} | ${yLabel} ${ya.value} | Avg ${avg}`;
}

/* A hero's own vType/vScore/hType/hScore, clamped/formatted the same
   way xyToScores() used to hand back — but read straight off the hero
   object instead of round-tripping through h._x/h._y. Those chart
   coordinates are only (re)computed inside renderChart(), and only for
   heroes that aren't currently hidden (see the `if (h.hidden) return;`
   guard there), so anything reading scores via h._x/h._y showed STALE
   values after an edit for any hero hidden from the chart — the edit
   modal writes the new vScore/hScore straight onto the hero, but
   nothing ever refreshed _x/_y for it since renderChart() skips it. */
function heroScores(h) {
  return {
    vType: h.vType || "SPD",
    vScore: +Math.max(0, Math.min(10, Number(h.vScore) || 0)).toFixed(1),
    hType: h.hType || "SUR",
    hScore: +Math.max(0, Math.min(10, Number(h.hScore) || 0)).toFixed(1),
  };
}

/* Ranking value used by the "Rank" roster sort options.
   If the hero has a ghost (altStats), rank by the Total Avg
   (primary + ghost scores averaged across all 4 axes) — matching the
   "Total Avg" badge shown in the roster card.
   Otherwise, fall back to the hero's regular Avg score. */
function rankValue(h) {
  if (h.altStats) {
    const xa = heroXAxis(h), ya = heroYAxis(h), axa = heroAltXAxis(h), aya = heroAltYAxis(h);
    return +((xa.value + ya.value + axa.value + aya.value) / 4).toFixed(1);
  }
  return heroDisplayAvg(h);
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

// Quick Draft slot picks and Ban Protect element are now pure in-memory,
// per-tab scratch state — nothing is written to or read from localStorage.
// They simply reset to empty each time the page loads.
function saveQuickDraftLocal() { /* no-op — session-only state now */ }
function loadQuickDraftLocal() { /* no-op — session-only state now */ }
function saveQuickDraftModeLocal() { /* no-op — session-only state now */ }

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

/* [Section 6 fix] Used to replay quickDraft[0..uptoIdx-1] and
   reconstruct the old main+supports chain structure (role, quadrant,
   mainIndex, bonus, chain1/chain2/activeMain) — that whole concept is
   gone as of Section 3/4 (no quadrants, no chain shape). This is now
   just a straight per-slot lookup: which hero/variant sits in each
   filled slot, and its score under the current ranking mode (Factor
   score if any Factor is ticked, else overall kit score — same as
   qdSimpleScoreEntry). Returns:
     perSlot — [{ index, heroId, hero, variant, score }] for every
               filled slot in [0, uptoIdx).
   activeMain/chain1/chain2 are kept as null in the return value so any
   caller still destructuring them doesn't throw — see renderQuickDraft,
   which still reads them and needs its own follow-up pass (flagged
   separately, not part of Section 6). */
function qdReplayDraft(uptoIdx, draftArr) {
  draftArr = draftArr || quickDraft;
  const perSlot = [];
  // Same Ban Protect bucket used to rank live suggestions (Rule 1) —
  // recomputed here too so the (i) "why was this hero picked" info
  // popup can explain the elemental side of a pick, not just its score.
  const counterEl = qdBanProtectElement ? QD_ELEMENT_COUNTER[qdBanProtectElement] : null;
  const avoidEl   = qdBanProtectElement ? Object.keys(QD_ELEMENT_COUNTER).find(k => QD_ELEMENT_COUNTER[k] === qdBanProtectElement) : null;
  for (let i = 0; i < uptoIdx; i++) {
    const raw = draftArr[i];
    if (raw === null || raw === undefined) continue;
    const parsed = qdParsePick(raw);
    const hero = heroes.find(h => h.id === parsed.heroId);
    if (!hero) continue;
    const entry = qdSimpleScoreEntry(hero, parsed.variant);
    const elBucket = qdElementBucket(hero, counterEl, avoidEl);
    const elNote = !qdBanProtectElement ? null
      : elBucket === 0 ? `⚔️ Counters the enemy's ${qdBanProtectElement} Ban Protect`
      : elBucket === 2 ? `⚠️ Same element the enemy's ${qdBanProtectElement} Ban Protect already beats`
      : null;
    perSlot.push({
      index: i, heroId: parsed.heroId, hero, variant: parsed.variant,
      score: entry ? entry.score : 0,
      reasons: entry ? entry.reasons : [],
      elNote,
      side: qdHeroSide(hero, parsed.variant),
    });
  }
  return { perSlot, activeMain: null, chain1: null, chain2: null };
}

/* Rule 1 — Ban Protect element bucket for one hero: 0 = counters it
   (best), 1 = neutral (neither counters nor is countered by it), 2 =
   the element Ban Protect itself beats (worst, but still offered — see
   qdSuggestForSlot). Returns 0 for everyone if no Ban Protect is set. */
function qdElementBucket(hero, counterEl, avoidEl) {
  if (!counterEl) return 0;
  if (hero.element === counterEl) return 0;
  if (avoidEl && hero.element === avoidEl) return 2;
  return 1;
}

/* [Section 3] qdSuggestForSlot (quadrant/chain candidate ranking) removed here.
   Section 4 adds qdSimpleSuggestForSlot in its place. */


function qdSuggestForNextSlot() {
  return qdSuggestForNextIdx(quickDraft.indexOf(null));
}

/* ═══════════════════════════════════════
   QUICK DRAFT — SELFISH / SELFLESS SPLIT & AUTOFILL RATIO
   (Rebuild Spec Section 9)

   Two independent concerns, both driven off the same classification:
     - qdHeroSide() buckets any hero+variant into "selfless" / "selfish"
       / "neutral" (unrated — selfishScore and selflessScore both 0),
       purely from Section 3's mutually-exclusive scale. Used to split
       the Suggest panel into its two columns (9.1) — ranking WITHIN
       each column still comes from qdSuggestForNextIdx (Section 8),
       this only partitions its output.
     - qdRequiredSideForDraft() is Autofill/example-team's ratio engine
       (9.2/9.3): given a draft in progress, it returns which side MUST
       be used for the next slot to still hit 3 Selfish + 2 Selfless by
       the time the team is full, or null once both quotas are already
       met (no further restriction) or nothing's actually forcing a
       specific side yet (both still have slack — see below).

   Neutral heroes (unrated — see above) are NOT soft-blocked from Quick
   Draft: every side-matching check in this section goes through
   qdHeroMatchesSide (never a raw `qdHeroSide(...) === "selfish"`/
   "selfless"` comparison) so a Neutral hero satisfies BOTH sides —
   it shows up in both Suggest columns, counts toward whichever quota
   still needs it, and is eligible whenever Autofill/Rep. Curr. has
   narrowed candidates down to one required side. qdHeroSide() itself
   still returns the plain "neutral" classification (unchanged) so the
   UI can mark it with its own ⚖️ indicator wherever a pick is shown. */
function qdHeroSide(h, variant) {
  const src = (variant === "ghost" ? h?.altStats : h) || {};
  const selfless = Math.max(0, Math.min(10, Number(src.selflessScore) || 0));
  const selfish  = Math.max(0, Math.min(10, Number(src.selfishScore)  || 0));
  // Mirrors heroSelfishSelflessPosition()'s tie-break: Selfless wins if
  // legacy/migrated data somehow has both scores set at once.
  if (selfless > 0 && selfless >= selfish) return "selfless";
  if (selfish > 0) return "selfish";
  return "neutral"; // unrated — score of 0 on both ends, e.g. a fresh legacy import (Section 2)
}

// Does this hero+variant qualify for `side` ("selfish" or "selfless")?
// A Neutral hero (see qdHeroSide) matches EITHER side — it's eligible
// wherever a Selfish or a Selfless hero would be, instead of being
// invisible to both, since there's no reason an unrated hero should be
// less usable in Quick Draft than a rated one. Use this everywhere a
// side-match decides eligibility (Suggest columns, Autofill/Rep. Curr.
// side-restriction, the fake enemy team); use the raw qdHeroSide only
// where the exact classification itself needs to be shown or counted.
function qdHeroMatchesSide(h, variant, side) {
  const actual = qdHeroSide(h, variant);
  return actual === side || actual === "neutral";
}


// Which side (if any) the NEXT empty slot in draftArr must fill to still
// land on 3 Selfish + 2 Selfless once the team's full. Returns null when
// there's no forced side — either both quotas are already satisfied, or
// there's still enough slack left that either side is fine for now (in
// which case the caller should prefer whichever has the bigger
// outstanding need, ties favoring Selfless, matching the spec's "3
// Selfless, 2 Selfish" ordering — see the two callers below).
function qdRequiredSideForDraft(draftArr) {
  draftArr = draftArr || quickDraft;
  const filled = draftArr.filter(raw => raw !== null && raw !== undefined);
  const slotsLeft = QD_SIZE - filled.length;
  if (slotsLeft <= 0) return null;

  let selflessCount = 0, selfishCount = 0;
  filled.forEach(raw => {
    const { heroId, variant } = qdParsePick(raw);
    const h = heroes.find(x => x.id === heroId);
    if (!h) return;
    const side = qdHeroSide(h, variant);
    // A drafted Neutral hero counts toward BOTH quotas (see
    // qdHeroMatchesSide above) — it's just as valid a Selfish pick as
    // a Selfless one, so it satisfies whichever side still needs it
    // rather than being invisible to the ratio math entirely.
    if (side === "selfless" || side === "neutral") selflessCount++;
    if (side === "selfish"  || side === "neutral") selfishCount++;
  });

  const selflessNeeded = Math.max(0, QD_SELFLESS_TARGET - selflessCount);
  const selfishNeeded  = Math.max(0, QD_SELFISH_TARGET  - selfishCount);

  if (selflessNeeded === 0 && selfishNeeded === 0) return null; // both quotas already hit
  if (selflessNeeded >= slotsLeft) return "selfless"; // no room left to NOT pick Selfless every remaining slot
  if (selfishNeeded  >= slotsLeft) return "selfish";  // same, for Selfish
  return selflessNeeded >= selfishNeeded ? "selfless" : "selfish";
}

// Section 9.4 — what actually drives Suggest/Next Best/Autofill for the
// live in-progress draft: the manual override if the person has tapped
// the ⇄ switch, otherwise the automatic quota calculation above. Kept
// separate from qdRequiredSideForDraft itself so the "mould examples"
// simulation (qdSimulateChain) can stay purely automatic — it's a
// hypothetical illustration, not the real draft, and shouldn't be
// steered by an override the person set for their actual picks.
function qdEffectiveRequiredSide(draftArr) {
  return qdManualSideOverride || qdRequiredSideForDraft(draftArr);
}

// Flips the manual override — always to whichever side ISN'T currently
// in effect, so tapping ⇄ visibly swaps the indicator every time rather
// than sometimes doing nothing (which a plain null→"selfless" step
// could do, if the automatic calculation already happened to agree).
function qdToggleSideOverride() {
  const current = qdEffectiveRequiredSide(quickDraft) || "selfless"; // default starting side if genuinely unrestricted
  qdManualSideOverride = current === "selfless" ? "selfish" : "selfless";
  renderQuickDraft();
  if (quickDraftSuggestOpen) renderQuickDraftSuggestions();
}

/* ═══════════════════════════════════════
   QUICK DRAFT — SIMPLIFIED SCORING ENGINE
   Replaces the old quadrant/tier/chain system entirely. A slot's ranked
   list is now just: Ban Protect element ordering (priority, not a
   filter) → best score (Factor-matched if any Factor is ticked, else
   overall kit score) → filtered to whichever side (Selfish/Selfless)
   the draft still needs. No quadrants, no tiers, no support targets,
   no fixed chain shape — every slot is picked the same way.
═══════════════════════════════════════ */

// Overall "how good is this kit" fallback score used when no Enemy
// Factor is ticked — plain average across every Reaction + Engagement
// entry the build has. A hero with no rated Reactions/Engagements yet
// scores 0 and simply sorts to the bottom (same "needs rating" outcome
// the old system had for unrated heroes).
// Overall "how good is this kit" fallback score used when no Enemy
// Factor is ticked — plain average across every Reaction + Engagement
// entry the build has. A hero with no rated Reactions/Engagements yet
// scores 0 and simply sorts to the bottom (same "needs rating" outcome
// the old system had for unrated heroes). Ghost shares the exact same
// Reactions/Engagements as the main build (only Selfish/Selfless
// differs between them — see heroAltYAxis), so `variant` no longer
// changes which list this reads; kept as a parameter since callers
// still pass it for the Selfish/Selfless side of scoring elsewhere.
function qdOverallKitScore(h, variant) {
  const reactions   = h.reactions   || [];
  const engagements = h.engagements || [];
  const values = [
    ...reactions.map(r => taxonomyValue("reactions", r?.refId ?? r)),
    ...engagements.map(e => taxonomyValue("engagements", e?.refId ?? e)),
  ];
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return +(sum / values.length).toFixed(1);
}

// One candidate hero+variant, scored for the CURRENT ranking mode
// (Factor mode if any Factor is ticked, else overall kit score).
function qdSimpleScoreEntry(h, variant) {
  if (qdTickedFactorIds.size > 0) {
    const factorEntry = qdFactorEntryForHero(h, variant);
    if (factorEntry) return { heroId: h.id, hero: h, variant, score: factorEntry.score, reasons: factorEntry.reasons };
    return null; // doesn't match any ticked Factor at all — Factor mode excludes it, same as today
  }
  return {
    heroId: h.id, hero: h, variant,
    score: qdOverallKitScore(h, variant),
    reasons: [],
  };
}

// The single ranked candidate list for one slot. Ban Protect element
// ordering is a PRIORITY bucket (never excludes), same philosophy as
// the old Rule 1 — just no longer scoped to quadrants. This is now the
// only ranking function Suggest/Autofill/Rep. Curr./Examples ever call.
function qdSimpleSuggestForSlot(nextIdx, draftArr, banProtectEl) {
  draftArr = draftArr || quickDraft;
  banProtectEl = banProtectEl === undefined ? qdBanProtectElement : banProtectEl;
  if (nextIdx === -1 || nextIdx == null) return [];

  const usedHeroIds = new Set(
    draftArr.filter((raw, i) => raw !== null && i !== nextIdx).map(raw => qdParsePick(raw).heroId)
  );
  // [BUGFIX] Rep. Curr. targets an already-filled slot (nextIdx), so the
  // slot's CURRENT occupant must not count as "already committed" when we
  // work out which Selfish/Selfless side is still required — otherwise a
  // slot's own hero gets double-counted against the 3/2 quota it's still
  // trying to fill, incorrectly narrowing (or relaxing) its own candidate
  // pool. Build a copy of draftArr with nextIdx nulled out purely for that
  // calculation, mirroring how usedHeroIds above already excludes nextIdx.
  const draftArrForQuota = draftArr.map((raw, i) => (i === nextIdx ? null : raw));
  const candidateHeroes = heroes.filter(h => {
    if (usedHeroIds.has(h.id)) return false;
    if (qdIsBannedByCompetitive(h)) return false;
    // [NEW FEATURE] Heroes swapped OUT of a slot via Rep. Curr. are
    // benched from every OTHER slot's suggestions (Suggest/Autofill/
    // Randomize/Rep. Curr.) until Clear is pressed — see
    // qdReplacedHeroOrigin. The slot they were swapped out of is still
    // allowed to cycle back to them (that's "this slot", not "another").
    if (qdReplacedHeroOrigin.has(h.id) && qdReplacedHeroOrigin.get(h.id) !== nextIdx) return false;
    return true;
  });

  const counterEl = banProtectEl ? QD_ELEMENT_COUNTER[banProtectEl] : null;
  const avoidEl   = banProtectEl ? Object.keys(QD_ELEMENT_COUNTER).find(k => QD_ELEMENT_COUNTER[k] === banProtectEl) : null;
  const elNoteFor = bucket => {
    if (!banProtectEl) return null;
    if (bucket === 0) return `⚔️ Counters the enemy's ${banProtectEl} Ban Protect`;
    if (bucket === 2) return `⚠️ Same element the enemy's ${banProtectEl} Ban Protect already beats`;
    return null;
  };

  let entries = [];
  candidateHeroes.forEach(h => {
    ["primary", ...(h.altStats ? ["ghost"] : [])].forEach(variant => {
      const entry = qdSimpleScoreEntry(h, variant);
      if (!entry) return;
      const elBucket = qdElementBucket(h, counterEl, avoidEl);
      entries.push({ ...entry, _bucket: elBucket, _elNote: elNoteFor(elBucket) });
    });
  });

  // Fallback when Factor mode leaves nothing to suggest — a handful of
  // ticked Factors against a small (or niche) roster can genuinely
  // exclude every remaining hero once enough of them are already
  // drafted, which would otherwise stall the draft short of a full
  // team of 5. Rather than leaving the slot impossible to fill, drop
  // back to plain overall kit score for just this slot, same as
  // Factor mode being off — the ticked Factors simply couldn't steer
  // this particular pick, so it falls through to the next-best thing.
  if (qdTickedFactorIds.size > 0 && entries.length === 0) {
    candidateHeroes.forEach(h => {
      ["primary", ...(h.altStats ? ["ghost"] : [])].forEach(variant => {
        const elBucket = qdElementBucket(h, counterEl, avoidEl);
        entries.push({
          heroId: h.id, hero: h, variant,
          score: qdOverallKitScore(h, variant),
          reasons: ["⚠️ No Enemy Factor match left in the pool — showing overall kit score instead"],
          _bucket: elBucket, _elNote: elNoteFor(elBucket),
        });
      });
    });
  }

  // Ban Protect bucket first (0 = counters it, 1 = neutral, 2 = the
  // element Ban Protect itself beats), best score second — exactly
  // Rule 1's old ordering, just applied over the plain score instead
  // of a quadrant-filtered one.
  entries.sort((a, b) => a._bucket - b._bucket || b.score - a.score);

  // Selfish/Selfless quota filter (Section 9 engine, now override-aware
  // via qdEffectiveRequiredSide — see Section 9.4) — same "filter down,
  // but relax back to the full list if that would empty it" pattern the
  // old Autofill/mould code already used.
  const requiredSide = qdEffectiveRequiredSide(draftArrForQuota);
  if (requiredSide) {
    const sideMatches = entries.filter(e => qdHeroMatchesSide(e.hero, e.variant, requiredSide));
    if (sideMatches.length) entries = sideMatches;
  }

  return entries;
}

/* ═══════════════════════════════════════
   QUICK DRAFT — FACTOR-BASED RECOMMENDATION
   (Rebuild Spec Section 8.2)

   This dispatcher is the single point every real pick source (Suggest,
   Autofill, Rep. Curr.) goes through: once any Factor is ticked,
   Factor-based ranking takes over; with nothing ticked, it ranks by
   plain overall kit score. Both modes are handled inside
   qdSimpleSuggestForSlot (via qdSimpleScoreEntry) — the old two-step
   "try Factor, fall back to quadrant engine" dispatch collapses into
   one function now that the quadrant/chain engine is gone. The
   tutorial "how Quick Draft picks a team" mould (qdSimulateChain) is a
   separate, hardcoded-example path and still does NOT go through this
   dispatcher as of this section — see Section 6.
═══════════════════════════════════════ */
function qdSuggestForNextIdx(nextIdx, draftArr, banProtectEl) {
  return qdSimpleSuggestForSlot(nextIdx, draftArr, banProtectEl);
}

// ═══════════════════════════════════════
// Enemy Factor scoring — "ranked % spread" system. Full replacement of
// the old two-level-average + specialist-boost + flat breadth-bonus
// system; nothing from that old system carries over.
//
// For each ticked Factor:
//   1. Rank EVERY Reaction/Engagement tagged to that Factor (not just
//      ones any one hero holds) by their own fixed score, highest to
//      lowest. That rank becomes a percentage spread evenly from 100%
//      at the top down to 0% at the bottom, across however many
//      DISTINCT scores are tagged to the Factor — tags sharing the
//      same score share the same percentage (see
//      qdFactorRankedBaseScores). If the Factor has a manual priority
//      order set instead (🗂 Taxonomy > Factors — see
//      toggleFactorPriority), that hand-picked click order is used in
//      its place: the same 100%-to-0% spread, just by click order
//      instead of score, and only across the tags actually added to
//      it — everything else tagged to the Factor stays at 0%.
//   2. That percentage is a bonus multiplier on the tag's own score:
//      0% → ×1 (unchanged), 100% → ×2 (doubled), linear in between.
//      This is the tag's new "ranked" base score for this Factor.
//   3. A hero's score for this Factor is the sum of the ranked base
//      scores of only the tags it actually holds that are tagged to
//      this Factor, divided by how many of those tags it holds — i.e.
//      the average of its own matched tags' ranked scores.
//   4. If the Factor is prioritized (see renderQdFactorPriorityChips),
//      that average is simply doubled — independently of any other
//      prioritized Factor, no sharing/redistribution between them, so
//      prioritizing a 2nd or 3rd Factor doesn't shrink the doubling on
//      the first.
//
// A hero's FINAL Factor-mode score is then the average of its
// per-Factor scores (step 3/4) across only the ticked Factors it
// actually matched at least one tag for — sum of those divided by how
// many that is. Purely an average at every level, nothing added on
// top, so the ranking is exactly and only what the ranked-%-spread
// scores say it should be.
// ═══════════════════════════════════════

// Precomputed per Factor (not per hero — this only depends on the
// Factor's own tagged Reactions/Engagements and their fixed scores,
// never on which heroes hold them). Returns a Map keyed
// `${kind}:${id}` → ranked base score (that tag's own value × its
// rank-derived ×1–×2 multiplier).
// Full ranked breakdown for one Factor — every Reaction/Engagement
// tagged to it (regardless of which heroes hold them), each with its
// rank-derived percentage, multiplier, and resulting ranked score.
// Sorted highest-ranked-score-first. This is the single source of
// truth for "step 1/2" of the scoring system — qdFactorRankedBaseScores
// below is just this same data flattened into a lookup map, and the
// "Know More" explainer (qdScoreExplainerContent) renders this list
// directly so a person can see exactly where every tag landed, not
// just the ones a given hero happens to hold.
function qdFactorRankedBreakdown(factorId) {
  const factor = taxonomy.factors.find(f => f.id === factorId);
  const { reactions, engagements } = taxonomyItemsForFactor(factorId);
  const items = [
    ...reactions.map(r => ({ key: `reactions:${r.id}`, kind: "reactions", id: r.id, name: r.name || "(unnamed)", value: r.value })),
    ...engagements.map(e => ({ key: `engagements:${e.id}`, kind: "engagements", id: e.id, name: e.name || "(unnamed)", value: e.value })),
  ];
  if (items.length === 0) return [];

  // A manual priority order (🗂 Taxonomy > Factors — see
  // toggleFactorPriority) takes over from the automatic score-based
  // ranking below the moment this Factor has at least one tag added to
  // it. Stale entries pointing at a tag that's since been untagged
  // from this Factor or deleted outright are skipped here rather than
  // trusted, on top of the cleanup untagFactor/deleteTaxonomyItem
  // already do — belt and suspenders, since a leftover reference could
  // otherwise silently keep boosting a tag no longer even part of this
  // Factor.
  const manualOrder = (Array.isArray(factor?.priorityOrder) ? factor.priorityOrder : [])
    .filter(p => items.some(it => it.kind === p.kind && it.id === p.id));

  if (manualOrder.length > 0) {
    const lastIdx = manualOrder.length - 1;
    const rankIndexOf = new Map(manualOrder.map((p, idx) => [`${p.kind}:${p.id}`, idx]));
    return items.map(it => {
      const idx = rankIndexOf.get(it.key);
      const isManualPriority = idx !== undefined;
      // Same ×1–×2 percentage-spread math as the automatic system
      // below — just driven by click-order rank instead of score rank
      // — and, unlike that system, a tag left OUT of the order simply
      // stays unboosted (0%) rather than being ranked against anything.
      const percentage = isManualPriority ? (lastIdx > 0 ? 1 - idx / lastIdx : 1) : 0;
      const multiplier = 1 + percentage;
      return { ...it, percentage, multiplier, rankedScore: it.value * multiplier, isManualPriority, priorityRank: isManualPriority ? idx + 1 : null };
    }).sort((a, b) => b.rankedScore - a.rankedScore || a.name.localeCompare(b.name));
  }

  // Distinct values only, so tags that tie on score land on the exact
  // same rank slot (and so the same %) instead of being spread apart
  // just because more items happen to share that value.
  const distinctDesc = [...new Set(items.map(i => i.value))].sort((a, b) => b - a);
  const lastIdx = distinctDesc.length - 1;
  const rankIndexOf = new Map(distinctDesc.map((v, idx) => [v, idx]));

  return items.map(it => {
    const idx = rankIndexOf.get(it.value);
    // Only one distinct value tagged to this Factor at all → nothing to
    // rank against, so it's simply the top: 100%.
    const percentage = lastIdx > 0 ? 1 - idx / lastIdx : 1;
    const multiplier = 1 + percentage; // 0% → ×1, 100% → ×2
    return { ...it, percentage, multiplier, rankedScore: it.value * multiplier, isManualPriority: false, priorityRank: null };
  }).sort((a, b) => b.rankedScore - a.rankedScore || a.name.localeCompare(b.name));
}

// `${kind}:${id}` -> ranked score lookup for one Factor, derived from
// qdFactorRankedBreakdown above — kept as its own function since most
// callers (the actual scoring path) only need the numbers, not the
// full sorted breakdown.
function qdFactorRankedBaseScores(factorId) {
  const map = new Map();
  qdFactorRankedBreakdown(factorId).forEach(it => map.set(it.key, it.rankedScore));
  return map;
}

function qdFactorEntryForHero(h, variant) {
  const reactions   = h.reactions   || [];
  const engagements = h.engagements || [];
  if (reactions.length === 0 && engagements.length === 0) return null;

  const perFactorScores = []; // one entry per ticked Factor this hero matches at all
  const matchReasons = [];
  const breakdown = []; // structured per-Factor detail for the "Know More" explainer

  qdTickedFactorIds.forEach(factorId => {
    const { reactions: taggedR, engagements: taggedE } = taxonomyItemsForFactor(factorId);
    const taggedRIds = new Set(taggedR.map(r => r.id));
    const taggedEIds = new Set(taggedE.map(e => e.id));
    const rankedItems = qdFactorRankedBreakdown(factorId); // full ranked list for this Factor, every tagged item
    const rankedByKey = new Map(rankedItems.map(it => [it.key, it]));

    // Every one of the hero's own Reactions/Engagements tagged to this
    // Factor counts — not just the single best one.
    const matchedItems = [];
    reactions.forEach(r => {
      const refId = r?.refId ?? r;
      if (!taggedRIds.has(refId)) return;
      const item = rankedByKey.get(`reactions:${refId}`);
      if (item) matchedItems.push(item);
    });
    engagements.forEach(e => {
      const refId = e?.refId ?? e;
      if (!taggedEIds.has(refId)) return;
      const item = rankedByKey.get(`engagements:${refId}`);
      if (item) matchedItems.push(item);
    });
    if (matchedItems.length === 0) return; // hero doesn't match this ticked Factor at all

    // Step 3 — sum of this hero's own matched tags' ranked scores,
    // divided by how many of them it holds.
    const totalPoints = matchedItems.reduce((a, b) => a + b.rankedScore, 0);
    const factorScore = totalPoints / matchedItems.length;

    // Step 4 — a prioritized Factor's score is simply doubled, on its
    // own, independent of any other prioritized Factor.
    const isPrioritized = qdPrioritizedFactorIds.has(factorId);
    const finalFactorScore = isPrioritized ? factorScore * 2 : factorScore;
    perFactorScores.push(finalFactorScore);

    const matchedNames = matchedItems.map(it => it.name);
    breakdown.push({
      factorId,
      factorName: taxonomyName("factors", factorId),
      isPrioritized,
      rankedItems,   // every tagged item for this Factor (for the full step 1/2 listing)
      matchedItems,  // just the ones this hero holds (for step 3/4)
      totalPoints, factorScore, finalFactorScore,
    });

    const boostNote = isPrioritized ? ` ⭐×2 = ${finalFactorScore.toFixed(1)}` : "";
    matchReasons.push(
      `🎯 ${taxonomyName("factors", factorId)} → ${factorScore.toFixed(1)}${boostNote} across ${matchedItems.length} match${matchedItems.length === 1 ? "" : "es"} (${matchedNames.join(", ")})`
    );
  });

  if (perFactorScores.length === 0) return null;

  // Final score — plain average of the per-Factor scores above across
  // however many ticked Factors this hero actually matched. Nothing
  // added on top: no flat breadth bonus, no extra weighting — just the
  // average, so heroes are ranked purely on how well their own tags
  // rank within each selected Factor.
  const finalScore = perFactorScores.reduce((a, b) => a + b, 0) / perFactorScores.length;
  return {
    heroId: h.id, hero: h, variant,
    matchedCount: perFactorScores.length,
    score: +finalScore.toFixed(1),
    breakdown,
    reasons: [
      `Matches ${perFactorScores.length}/${qdTickedFactorIds.size} ticked Factor${qdTickedFactorIds.size === 1 ? "" : "s"}`,
      ...matchReasons,
      `Averaged across ${perFactorScores.length} Factor${perFactorScores.length === 1 ? "" : "s"} = ${finalScore.toFixed(1)}`,
    ],
  };
}


// Ranked candidate list for one slot, driven entirely by ticked
// Factors — no quadrant/tier/chain concept enters into this at all.
// "Multiple ticked Factors should combine — a hero relevant to more of
// the ticked Factors, or with higher scores against them, should rank
// higher" (8.2, rule 3): matched-Factor COUNT is the primary sort key,
// summed per-item score the tiebreaker.
function qdFactorSuggestForSlot(nextIdx, draftArr) {
  draftArr = draftArr || quickDraft;
  if (nextIdx === -1 || nextIdx == null) return [];
  const usedHeroIds = new Set(
    draftArr.filter((raw, i) => raw !== null && i !== nextIdx).map(raw => qdParsePick(raw).heroId)
  );
  const candidateHeroes = heroes.filter(h => !usedHeroIds.has(h.id) && !qdIsBannedByCompetitive(h));

  const entries = [];
  candidateHeroes.forEach(h => {
    const primary = qdFactorEntryForHero(h, "primary");
    if (primary) entries.push(primary);
    if (h.altStats) {
      const ghost = qdFactorEntryForHero(h, "ghost");
      if (ghost) entries.push(ghost);
    }
  });

  entries.sort((a, b) => b.matchedCount - a.matchedCount || b.score - a.score);
  return entries;
}

// Suggest-panel hint shown while Factor mode is driving recommendations
// — replaces qdBanProtectHint/qdChainHint (which describe the quadrant/
// chain system) so the hint text never contradicts what's actually
// ranking the list. See renderQuickDraftSuggestions.
function qdFactorHint() {
  if (qdTickedFactorIds.size === 0) return "";
  const names = [...qdTickedFactorIds].map(id => taxonomyName("factors", id)).join(", ");
  return `🎯 Factor mode — ranked by ticked Enemy Factor${qdTickedFactorIds.size === 1 ? "" : "s"} (${names}). The quadrant/chain rules below aren't being used while any Factor is ticked.`;
}

/* Simulates a full 5-slot Quick Draft from a single fixed first pick,
   entirely separate from the real in-progress draft — used by the "How
   Quick Draft picks a team" mould examples (see quickdraft.html). Each
   remaining slot takes whatever qdSuggestForNextIdx ranks #1 — Section
   9.3 applies the same 3-Selfish/2-Selfless default (via
   qdRequiredSideForDraft) that Autofill uses, so example teams stay
   consistent with what pressing Autofill would actually produce.
   [Section 6] Now goes through the real dispatcher (Factor-aware if any
   Enemy Factor is ticked, else overall kit score) instead of the
   deleted pure-quadrant qdSuggestForSlot. Never touches the global
   quickDraft array or qdBanProtectElement. */
function qdSimulateChain(hero, variant, banProtectEl) {
  const draftArr = [qdMakePickId(hero.id, variant), null, null, null, null];
  for (let i = 1; i < QD_SIZE; i++) {
    const suggestions = qdSuggestForNextIdx(i, draftArr, banProtectEl || null);
    if (!suggestions.length) break;

    const requiredSide = qdRequiredSideForDraft(draftArr);
    let pool = suggestions;
    if (requiredSide) {
      const sideMatches = suggestions.filter(e => qdHeroMatchesSide(e.hero, e.variant, requiredSide));
      if (sideMatches.length) pool = sideMatches; // else relax, same fallback as Autofill
    }

    const top = pool[0];
    draftArr[i] = qdMakePickId(top.heroId, top.variant);
  }
  return qdReplayDraft(QD_SIZE, draftArr).perSlot;
}

/* The single best build for one hero (primary, or Ghost if it beats
   primary), under the CURRENT ranking mode — used to pick a
   representative example hero in the mould examples. [Section 6] No
   longer quadrant-based (qdMainEntriesFor/qdBuildEntry are gone) — uses
   the same qdSimpleScoreEntry as every other pick source. */
function qdBestEntryFor(h) {
  const entries = ["primary", ...(h.altStats ? ["ghost"] : [])]
    .map(variant => qdSimpleScoreEntry(h, variant))
    .filter(Boolean);
  return entries.reduce((best, e) => (!best || e.score > best.score) ? e : best, null);
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
    setStatus("⚠️ Fill a slot first, then Rep. Curr. can swap it.");
    return;
  }
  if (slotIndex !== qdLastFilledSlot) {
    qdLastFilledSlot = slotIndex;
    qdNextBestRank = 0;
  }
  let scored;
  try {
    scored = qdSuggestForNextIdx(slotIndex);
  } catch (err) {
    setStatus(`⚠️ Next Best crashed: ${(err && err.message) || err}`);
    console.error(err);
    return;
  }
  if (scored.length === 0) { setStatus("⚠️ No more heroes left in your Roster to swap in."); return; }

  // [NEW FEATURE] Remember whoever's about to get swapped out of this
  // slot so they stop showing up in every OTHER slot's suggestions until
  // Clear is pressed. Only counts as a "replace" when the heroId itself
  // changes — cycling between a hero's own Primary/Ghost build isn't
  // swapping the hero out, so that doesn't bench it.
  const outgoing = quickDraft[slotIndex] ? qdParsePick(quickDraft[slotIndex]) : null;

  qdNextBestRank = (qdNextBestRank + 1) % scored.length;
  const pick = scored[qdNextBestRank];
  if (outgoing && outgoing.heroId !== pick.heroId) {
    qdReplacedHeroOrigin.set(outgoing.heroId, slotIndex);
  }
  quickDraft[slotIndex] = qdMakePickId(pick.heroId, pick.variant);
  saveQuickDraftLocal();
  renderQuickDraft();
  renderRoster();
  if (quickDraftSuggestOpen) renderQuickDraftSuggestions();

  if (qdNextBestRank === 0) setStatus("🔁 Back to the top pick for this slot.");
  else setStatus(`🔁 Slot ${slotIndex + 1}: ${pick.hero.name || "Unnamed"} (#${qdNextBestRank + 1} best)`);
}

/* Randomize — picks a uniformly random BUILD from the Roster (excluding
   anyone already drafted, by heroId) for the next empty slot, then opens
   Suggest for the following slot so the rest of the team strategizes
   around whatever the randomizer landed on.
   FIX: this used to only ever draw from primary builds — a hero's Ghost
   build (if it has one) could never come up no matter how many times you
   clicked, while Autofill could (rarely) land on one. Now each hero
   contributes one "ticket" per build it has (primary always, Ghost too
   if h.altStats exists) to the draw pool, mirroring how qdMainEntriesFor
   already treats primary/Ghost as separate standalone options elsewhere.
   A hero with a Ghost build is therefore twice as likely to be drawn
   overall, split roughly 50/50 between its two builds when it is. */
function randomizeQuickDraft() {
  const idx = quickDraft.indexOf(null);
  if (idx === -1) { setStatus("⚠️ Quick Draft is full (5/5)"); return; }
  const usedHeroIds = new Set(quickDraft.filter(raw => raw !== null).map(raw => qdParsePick(raw).heroId));
  const pool = heroes.filter(h => {
    if (usedHeroIds.has(h.id)) return false;
    if (qdIsBannedByCompetitive(h)) return false;
    // [NEW FEATURE] same Rep. Curr. exclusion as qdSimpleSuggestForSlot —
    // Randomize is filling `idx`, so a hero benched from a different slot
    // still can't be randomly drawn into this one either.
    if (qdReplacedHeroOrigin.has(h.id) && qdReplacedHeroOrigin.get(h.id) !== idx) return false;
    return true;
  });
  if (pool.length === 0) {
    setStatus(qdCompetitiveMode
      ? "⚠️ No eligible heroes left (Competitive mode is banning non-PVP-tagged 3★s)."
      : "⚠️ No more heroes left in your Roster.");
    return;
  }
  const entries = [];
  pool.forEach(h => {
    entries.push({ heroId: h.id, variant: "primary" });
    if (h.altStats) entries.push({ heroId: h.id, variant: "ghost" });
  });
  const pick = entries[Math.floor(Math.random() * entries.length)];
  addToQuickDraft(pick.heroId, pick.variant);
  if (quickDraft.indexOf(null) !== -1) renderQuickDraftSuggestions();
}

/* Autofill — instantly locks in whichever hero currently ranks #1 in
   qdSuggestForNextSlot() (the same "👑 best" row shown in Suggest), then
   opens Suggest for the next empty slot so the pace stays quick.
   Rebuild Spec Section 9.2 — the #1 pick is now taken from whichever
   side (Selfless/Selfish) the team still needs to hit the 3/2 default
   split, not the unrestricted top of the list. Ranking WITHIN that side
   still comes straight from qdSuggestForNextSlot (Factor-based or
   legacy quadrant, per Section 8) — this only narrows which side of the
   list Autofill is allowed to draw its #1 from. */
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

  const requiredSide = qdEffectiveRequiredSide(quickDraft);
  let pool = scored;
  if (requiredSide) {
    const sideMatches = scored.filter(e => qdHeroMatchesSide(e.hero, e.variant, requiredSide));
    // Open decision (Section 9.2/9.3), resolved: if the roster doesn't
    // have enough rated heroes on the required side, relax the ratio
    // rather than leaving Autofill stuck — fall through to the full,
    // unrestricted list so it still fills the slot with its best option.
    if (sideMatches.length) pool = sideMatches;
  }

  addToQuickDraft(pool[0].heroId, pool[0].variant);
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
  const removedIndex = quickDraft.findIndex(x => x !== null && qdParsePick(x).heroId === id);
  quickDraft = quickDraft.filter(x => x === null || qdParsePick(x).heroId !== id);
  while (quickDraft.length < QD_SIZE) quickDraft.push(null);
  qdReindexReplacedHeroOrigins(removedIndex);
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
  qdReplacedHeroOrigin = new Map(); // [NEW FEATURE] new draft, new enemy — clear the Rep. Curr. bench
  document.getElementById("quickdraft-suggestions").style.display = "none";
  saveQuickDraftLocal();

  // Reset the Ban Protect element back to default.
  qdBanProtectElement = null;
  document.querySelectorAll("#qd-ban-protect-chips .qd-el-chip").forEach(chip => chip.classList.remove("active"));

  // Reset the enemy Factor checklist too (Section 8.1) — same "new
  // draft, new enemy" reasoning as the Ban Protect element above.
  qdTickedFactorIds.clear();
  renderQdFactorChips();
  if (typeof renderHeroFactorsButton === "function") renderHeroFactorsButton(); // keep Hero Factors' button/grid in sync with the Enemy Factors state it reads
  saveQuickDraftModeLocal();

  // Reset the manual Selfish/Selfless override too (Section 9.4) — same
  // "new draft, new enemy" reasoning as Ban Protect element and Enemy
  // Factors above: start the next draft back on the automatic quota.
  qdManualSideOverride = null;

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

let qdSlotInfoPopupEl = null;

// Single reusable floating popup (same "append to <body>, position via
// getBoundingClientRect" pattern as the Enemy Factors menu and the
// last-saved info popup above) that explains why a hero landed in a
// given Quick Draft slot — its (i) button's content. One shared
// element rather than one per slot, since only ever one can be open.
function ensureQdSlotInfoPopup() {
  if (qdSlotInfoPopupEl) return qdSlotInfoPopupEl;
  const popup = document.createElement("div");
  popup.className = "qd-slot-info-popup";
  popup.id = "qd-slot-info-popup";
  popup.style.display = "none";
  document.body.appendChild(popup);
  qdSlotInfoPopupEl = popup;

  const reposition = () => {
    if (popup.style.display !== "none" && popup.dataset.anchorIdx) {
      const btn = document.querySelector(`.qd-slot-info-btn[data-idx="${popup.dataset.anchorIdx}"]`);
      if (btn) positionQdSlotInfoPopup(btn);
    }
  };
  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, true);

  document.addEventListener("click", e => {
    if (popup.style.display === "none") return;
    if (popup.contains(e.target) || e.target.closest(".qd-slot-info-btn")) return;
    popup.style.display = "none";
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && popup.style.display !== "none") popup.style.display = "none";
  });

  return popup;
}

// Same left-clamped, always-below-the-button placement as
// positionQdFactorMenu — keeps it from running off the right edge on
// a narrow phone screen, and never flips upward to cover the slot row.
function positionQdSlotInfoPopup(btn) {
  const popup = qdSlotInfoPopupEl;
  if (!btn || !popup) return;
  const r = btn.getBoundingClientRect();
  const popupWidth = popup.offsetWidth || 260;
  let left = r.left - popupWidth + 20; // right-align toward the button rather than left-align, since slots sit in a tight grid near the screen edge
  left = Math.max(8, Math.min(left, window.innerWidth - popupWidth - 8));
  popup.style.left = `${left}px`;
  popup.style.top  = `${r.bottom + 6}px`;
}

// Explains one slot's pick using the exact same data the ranking itself
// used: the Factor-match breakdown when Factor mode was on (or a note
// that overall kit score was used when it wasn't), plus the Ban
// Protect elemental note if one applies. `info` is one entry from
// qdReplayDraft's perSlot array (score/reasons/elNote already computed
// there against the CURRENT ticked Factors and Ban Protect element —
// this is a live explanation of "why does this pick rank the way it
// does right now", not a frozen snapshot from whenever it was drafted).
function qdShowSlotInfo(btn, info) {
  const popup = ensureQdSlotInfoPopup();
  const h = info.hero;
  const nameSuffix = info.variant === "ghost" ? " (Ghost)" : "";
  const sideLine = info.side === "selfish" ? "😈 Selfish"
    : info.side === "selfless" ? "🙏 Selfless"
    : "⚖️ Neutral — unrated, counts toward either side's quota";
  const reasonLines = info.reasons.length
    ? info.reasons.map(r => `<div class="qd-slot-info-line">${r}</div>`).join("")
    : `<div class="qd-slot-info-line">Ranked by overall kit score — the average of every one of ${h.name || "this hero"}'s Reaction/Engagement scores. No Enemy Factors are currently ticked, so nothing more specific was being targeted.</div>`;
  const elLine = info.elNote ? `<div class="qd-slot-info-line">${info.elNote}</div>` : "";
  popup.innerHTML = `
    <div class="qd-slot-info-title">${h.name || "Unnamed"}${nameSuffix} — ${info.score.toFixed(1)}</div>
    <div class="qd-slot-info-line">${sideLine}</div>
    ${reasonLines}
    ${elLine}
    <button type="button" class="qd-slot-info-knowmore" id="qd-slot-info-knowmore">📖 Know More</button>
  `;
  popup.dataset.anchorIdx = btn.dataset.idx;
  popup.style.display = "block";
  positionQdSlotInfoPopup(btn);
  // Opens the fullscreen step-by-step breakdown of exactly how this
  // score was calculated — see ensureQdScoreExplainer/qdShowScoreExplainer.
  popup.querySelector("#qd-slot-info-knowmore").addEventListener("click", () => {
    popup.style.display = "none";
    qdShowScoreExplainer(info.hero, info.variant);
  });
}

let qdScoreExplainerEl = null;

// The "Know More" fullscreen explainer — reuses the exact same
// overlay+panel shell as the Enemy Factors picker (.qd-factor-menu-*,
// see ensureQdFactorMenu) so it floods the screen the same way,
// morphing from an edge-to-edge sheet on phones to a large centered,
// backdrop-dimmed modal on wider screens. Includes its own hero search
// (any hero, not just ones already in the draft — this is a pure
// analysis tool) so a person can look up "why wasn't X picked" and see
// its exact score breakdown without having to draft it first.
function ensureQdScoreExplainer() {
  if (qdScoreExplainerEl) return qdScoreExplainerEl;

  const overlay = document.createElement("div");
  overlay.className = "qd-factor-menu-overlay";
  overlay.id = "qd-score-explainer";
  overlay.style.display = "none";
  overlay.innerHTML = `
    <div class="qd-factor-menu-panel">
      <div class="qd-factor-menu-header">
        <div class="qd-factor-menu-title" id="qd-score-explainer-title">📖 How This Score Was Calculated</div>
        <button type="button" class="qd-factor-menu-close" id="qd-score-explainer-close" aria-label="Close">✕</button>
      </div>
      <div class="qd-factor-menu-searchbar qd-score-explainer-searchbar">
        <input type="text" class="taxonomy-search qd-factor-menu-search" id="qd-score-explainer-search" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="🔍 Search any hero to see its score…" />
        <button type="button" class="qd-factor-menu-clear" id="qd-score-explainer-search-clear" title="Clear search" aria-label="Clear search">✕</button>
      </div>
      <div class="qd-score-explainer-search-results" id="qd-score-explainer-search-results" style="display:none"><!-- populated while searching --></div>
      <div class="qd-score-explainer-body" id="qd-score-explainer-body"><!-- populated per-hero, see qdShowScoreExplainer --></div>
    </div>
  `;
  document.body.appendChild(overlay);
  qdScoreExplainerEl = overlay;

  const closeExplainer = () => {
    overlay.style.display = "none";
    document.body.classList.remove("qd-factor-menu-open");
  };
  overlay.querySelector("#qd-score-explainer-close").addEventListener("click", closeExplainer);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeExplainer(); });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && overlay.style.display !== "none") closeExplainer();
  });

  const searchInput = overlay.querySelector("#qd-score-explainer-search");
  const clearBtn    = overlay.querySelector("#qd-score-explainer-search-clear");
  const resultsBox  = overlay.querySelector("#qd-score-explainer-search-results");

  const runSearch = () => {
    const raw = searchInput.value.trim();
    const q = raw.toLowerCase();
    clearBtn.style.display = q ? "flex" : "none";
    if (!q) { resultsBox.style.display = "none"; resultsBox.innerHTML = ""; return; }

    const matches = heroes.filter(h => (h.name || "").toLowerCase().includes(q)).slice(0, 40);
    resultsBox.style.display = "block";
    if (matches.length === 0) {
      resultsBox.innerHTML = `<div class="qd-score-explainer-search-empty">No heroes match "${raw}"</div>`;
      return;
    }

    // Every candidate's score is shown right on its row — this is
    // deliberately not restricted to heroes eligible for the current
    // draft slot (used/banned/side-locked heroes included), since the
    // whole point is comparing "why did this one lose to that one".
    resultsBox.innerHTML = matches.map(h => {
      const primary = qdExplainerEntryFor(h, "primary");
      const ghost   = h.altStats ? qdExplainerEntryFor(h, "ghost") : null;
      return `
        <div class="qd-score-explainer-search-row">
          <span class="qd-score-explainer-search-name">${h.name || "Unnamed"}</span>
          <button type="button" class="qd-score-explainer-search-pick" data-hero-id="${h.id}" data-variant="primary">${primary.score.toFixed(1)}</button>
          ${ghost ? `<button type="button" class="qd-score-explainer-search-pick" data-hero-id="${h.id}" data-variant="ghost">👻 ${ghost.score.toFixed(1)}</button>` : ""}
        </div>
      `;
    }).join("");

    resultsBox.querySelectorAll(".qd-score-explainer-search-pick").forEach(pickBtn => {
      pickBtn.addEventListener("click", () => {
        const hero = heroes.find(h => h.id === Number(pickBtn.dataset.heroId));
        if (!hero) return;
        // Search stays open (resetSearch: false) so several heroes can
        // be checked back-to-back without retyping the search each time.
        qdShowScoreExplainer(hero, pickBtn.dataset.variant, { resetSearch: false });
      });
    });
  };
  searchInput.addEventListener("input", runSearch);
  clearBtn.addEventListener("click", () => { searchInput.value = ""; runSearch(); searchInput.focus(); });

  return overlay;
}

// Computes a hero's score/breakdown for the CURRENT ticked
// Factors/Ban Protect exactly like the live ranking does, but for ANY
// hero — including ones with zero matches, already in the draft, or
// banned by competitive rules — since this only powers the read-only
// "Know More" explainer, never an actual pick. Unlike qdSimpleScoreEntry
// (which returns null on zero matches so the real ranking can exclude
// the hero), this always returns something to explain, with a plain
// zero score and a reason when there's nothing to show — that's the
// whole point of being able to look up "why wasn't this hero chosen".
function qdExplainerEntryFor(hero, variant) {
  const counterEl = qdBanProtectElement ? QD_ELEMENT_COUNTER[qdBanProtectElement] : null;
  const avoidEl   = qdBanProtectElement ? Object.keys(QD_ELEMENT_COUNTER).find(k => QD_ELEMENT_COUNTER[k] === qdBanProtectElement) : null;
  const elBucket  = qdElementBucket(hero, counterEl, avoidEl);
  const elNote = !qdBanProtectElement ? null
    : elBucket === 0 ? `⚔️ Counters the enemy's ${qdBanProtectElement} Ban Protect`
    : elBucket === 2 ? `⚠️ Same element the enemy's ${qdBanProtectElement} Ban Protect already beats`
    : null;
  const side = qdHeroSide(hero, variant);

  if (qdTickedFactorIds.size > 0) {
    const factorEntry = qdFactorEntryForHero(hero, variant);
    if (factorEntry) return { ...factorEntry, elNote, side };
    return {
      heroId: hero.id, hero, variant, matchedCount: 0, score: 0, breakdown: [],
      reasons: [`⚠️ Doesn't hold any Reaction/Engagement tagged to any of the ${qdTickedFactorIds.size} ticked Enemy Factor${qdTickedFactorIds.size === 1 ? "" : "s"} — scores 0 and is excluded from live suggestions while these Factors stay ticked.`],
      elNote, side,
    };
  }
  return {
    heroId: hero.id, hero, variant, matchedCount: null, breakdown: [],
    score: qdOverallKitScore(hero, variant), reasons: [], elNote, side,
  };
}

// Builds the "step-by-step for THIS hero" section — real numbers, not
// just a description. Walks every currently-ticked Factor (not just
// the ones this hero happens to match, so an unmatched Factor still
// shows up explaining why it contributed nothing) and, for each, lists
// EVERY Reaction/Engagement tagged to it — highest-ranked-score-first
// — marking with ✅ whichever ones this hero actually holds, so it's
// immediately visible which specific tag on the hero (or missing tag)
// is driving its score up or down for adjustment purposes.
function qdScoreExplainerFactorDetailHtml(entry) {
  const h = entry.hero;
  const name = `${h.name || "Unnamed"}${entry.variant === "ghost" ? " (Ghost)" : ""}`;
  const breakdownByFactorId = new Map((entry.breakdown || []).map(b => [b.factorId, b]));

  const factorCards = [...qdTickedFactorIds].map(factorId => {
    const factorName = taxonomyName("factors", factorId);
    const b = breakdownByFactorId.get(factorId);
    const rankedItems = b ? b.rankedItems : qdFactorRankedBreakdown(factorId);
    const matchedKeys = new Set((b ? b.matchedItems : []).map(it => it.key));

    const rankedRowsHtml = rankedItems.length
      ? rankedItems.map(it => {
          const held = matchedKeys.has(it.key);
          const icon = it.kind === "reactions" ? "⚡" : "🛡";
          const priorityBadge = it.isManualPriority ? ` ⭐#${it.priorityRank}` : "";
          return `
            <div class="qd-score-explainer-rank-row${held ? " held" : ""}">
              <span class="qd-score-explainer-rank-name">${held ? "✅ " : ""}${icon} ${it.name}${priorityBadge}</span>
              <span class="qd-score-explainer-rank-nums">${it.value.toFixed(1)} × ${it.multiplier.toFixed(2)} (${Math.round(it.percentage * 100)}%) = <strong>${it.rankedScore.toFixed(1)}</strong></span>
            </div>
          `;
        }).join("")
      : `<div class="qd-score-explainer-rank-empty">Nothing is tagged to this Factor yet.</div>`;

    const usesManualPriority = rankedItems.some(it => it.isManualPriority);
    const rankStepText = usesManualPriority
      ? `Using this Factor's manually-set priority order (🗂 Taxonomy) — hand-picked tags below are ranked ×2 down to ×1 by click order; every other tag tagged to this Factor stays ×1.`
      : `Ranked ${rankedItems.length} tag${rankedItems.length === 1 ? "" : "s"} tagged to this Factor below, highest → lowest ranked score.`;

    const stepsForFactorHtml = b ? `
      <div class="qd-score-explainer-factor-steps">
        <div>① ${rankStepText}</div>
        <div>② Each tag's ranked score = its own base score × its rank multiplier (both shown next to it below).</div>
        <div>③ ${name} holds ${b.matchedItems.length}: ${b.matchedItems.map(it => `${it.name} (${it.rankedScore.toFixed(1)})`).join(" + ")} → ${b.totalPoints.toFixed(1)} ÷ ${b.matchedItems.length} = <strong>${b.factorScore.toFixed(1)}</strong></div>
        <div>④ ${b.isPrioritized ? `Prioritized ⭐ → ${b.factorScore.toFixed(1)} × 2 = <strong>${b.finalFactorScore.toFixed(1)}</strong>` : `Not prioritized → stays <strong>${b.finalFactorScore.toFixed(1)}</strong>`}</div>
      </div>
    ` : `
      <div class="qd-score-explainer-factor-steps">
        <div>① ${rankStepText}</div>
        <div>${name} holds none of them — this Factor contributes <strong>nothing</strong> to its score.</div>
      </div>
    `;

    return `
      <div class="qd-score-explainer-factor-card${b ? "" : " unmatched"}">
        <div class="qd-score-explainer-factor-card-title">${b ? "🎯" : "⛔"} ${factorName}${b && b.isPrioritized ? " ⭐" : ""}</div>
        ${stepsForFactorHtml}
        <div class="qd-score-explainer-rank-list">${rankedRowsHtml}</div>
      </div>
    `;
  }).join("");

  const matchedFinals = (entry.breakdown || []).map(b => b.finalFactorScore);
  const step5Html = matchedFinals.length
    ? `<div class="qd-score-explainer-line">⑤ ${matchedFinals.map(v => v.toFixed(1)).join(" + ")} = ${matchedFinals.reduce((a, b) => a + b, 0).toFixed(1)}, ÷ ${matchedFinals.length} matched Factor${matchedFinals.length === 1 ? "" : "s"} = <strong>${entry.score.toFixed(1)}</strong></div>`
    : `<div class="qd-score-explainer-line">⑤ ${name} matched 0 of the ${qdTickedFactorIds.size} ticked Factor${qdTickedFactorIds.size === 1 ? "" : "s"} → final score is <strong>0</strong>, excluded from live suggestions while these stay ticked.</div>`;

  return `
    <div class="qd-score-explainer-line qd-score-explainer-line-title">Step-by-step for ${name}</div>
    ${factorCards}
    ${step5Html}
  `;
}

// Builds the explainer body: the general step-by-step methodology
// (Factor mode's 5 steps, or the plain overall-kit-score fallback when
// nothing's ticked), then this SPECIFIC hero's actual numbers walking
// through those same 5 steps (qdScoreExplainerFactorDetailHtml), then
// the compact "Applied to X" summary (reusing the exact same `reasons`
// text the small (i) popup already showed, so the two can never say
// something different), then the formula in symbolic form, ending on
// the final number.
function qdScoreExplainerContent(entry) {
  const h = entry.hero;
  const name = `${h.name || "Unnamed"}${entry.variant === "ghost" ? " (Ghost)" : ""}`;
  const factorMode = qdTickedFactorIds.size > 0;

  const stepsHtml = factorMode ? `
    <ol class="qd-score-explainer-steps">
      <li><strong>Rank every tag.</strong> For each ticked Enemy Factor, every Reaction/Engagement tagged to it (across the whole roster, not just ${name}'s own) is ranked by its own fixed score, highest → lowest. That rank becomes a percentage spread evenly from <strong>100%</strong> at the top down to <strong>0%</strong> at the bottom — tags that tie on score share the same percentage. If that Factor has a manual priority order set instead (🗂 Taxonomy > Factors), that hand-picked click order is used in its place — the tags added to it are spread the same <strong>100%</strong>-to-<strong>0%</strong> way by click order, and every other tag tagged to the Factor stays at <strong>0%</strong>.</li>
      <li><strong>Turn the % into a multiplier.</strong> 0% → ×1 (score unchanged), 100% → ×2 (score doubled), scaling linearly in between. This gives every tag a new "ranked" score for that Factor.</li>
      <li><strong>Score ${name} for that Factor.</strong> Add up the ranked scores of only the tags ${name} actually holds for that Factor, then divide by how many of those tags it holds — the average of its own matches.</li>
      <li><strong>Double it if prioritized.</strong> If that Factor is marked as a priority (⭐), this score is simply doubled — independently of any other prioritized Factor, so prioritizing more than one doesn't shrink either one's doubling.</li>
      <li><strong>Average across every matched Factor.</strong> Add up ${name}'s scores from steps 3–4 for every ticked Factor it matched at all, then divide by how many Factors that is. That average is the final score below.</li>
    </ol>
  ` : `
    <p class="qd-score-explainer-note">No Enemy Factors are currently ticked, so ${name} is ranked by plain <strong>overall kit score</strong> instead — the average of every one of ${name}'s own Reaction and Engagement scores, nothing else factored in. Tick an Enemy Factor from the 🎯 Enemy Factors picker to switch to the step-by-step Factor scoring below.</p>
  `;

  const detailHtml = factorMode ? qdScoreExplainerFactorDetailHtml(entry) : "";

  const appliedHtml = `
    <div class="qd-score-explainer-line qd-score-explainer-line-title">Summary</div>
    ${entry.reasons.length
      ? entry.reasons.map(r => `<div class="qd-score-explainer-line">${r}</div>`).join("")
      : `<div class="qd-score-explainer-line">Average of every one of ${name}'s Reaction/Engagement scores = ${entry.score.toFixed(1)}</div>`}
    ${entry.elNote ? `<div class="qd-score-explainer-line">${entry.elNote}</div>` : ""}
  `;

  const formulaHtml = factorMode ? `
    <div class="qd-score-explainer-formula">
      <div>FactorScore&nbsp;=&nbsp;( Σ ranked scores of ${name}'s matched tags )&nbsp;÷&nbsp;( # matched tags )&nbsp;&nbsp;<em>[×2 if prioritized]</em></div>
      <div>FinalScore&nbsp;=&nbsp;( Σ FactorScore for each Factor ${name} matched )&nbsp;÷&nbsp;( # matched Factors )</div>
    </div>
  ` : `
    <div class="qd-score-explainer-formula">
      <div>FinalScore&nbsp;=&nbsp;( Σ every Reaction + Engagement score )&nbsp;÷&nbsp;( total count )</div>
    </div>
  `;

  return `
    ${stepsHtml}
    ${detailHtml ? `<div class="qd-score-explainer-divider"></div>${detailHtml}` : ""}
    <div class="qd-score-explainer-divider"></div>
    ${appliedHtml}
    <div class="qd-score-explainer-divider"></div>
    <div class="qd-score-explainer-line qd-score-explainer-line-title">Formula</div>
    ${formulaHtml}
    <div class="qd-score-explainer-final">Final score: <strong>${entry.score.toFixed(1)}</strong></div>
  `;
}

function qdShowScoreExplainer(hero, variant, opts) {
  opts = opts || {};
  const overlay = ensureQdScoreExplainer();
  const entry = qdExplainerEntryFor(hero, variant);
  overlay.querySelector("#qd-score-explainer-title").textContent = `📖 How ${hero.name || "this hero"} was scored`;
  const body = overlay.querySelector("#qd-score-explainer-body");
  body.innerHTML = qdScoreExplainerContent(entry);
  body.scrollTop = 0;
  overlay.style.display = "flex";
  document.body.classList.add("qd-factor-menu-open"); // reuses the same background-scroll lock as the Enemy Factors picker

  // A fresh open (from the (i) popup) starts the search box empty; a
  // pick FROM the search results leaves it open (opts.resetSearch:
  // false) so several heroes can be compared back-to-back.
  if (opts.resetSearch !== false) {
    const searchInput = overlay.querySelector("#qd-score-explainer-search");
    const resultsBox  = overlay.querySelector("#qd-score-explainer-search-results");
    const clearBtn    = overlay.querySelector("#qd-score-explainer-search-clear");
    if (searchInput) searchInput.value = "";
    if (resultsBox)  { resultsBox.style.display = "none"; resultsBox.innerHTML = ""; }
    if (clearBtn)    clearBtn.style.display = "none";
  }
}

function renderQuickDraft() {
  const slotsWrap = document.getElementById("quickdraft-slots");
  slotsWrap.innerHTML = "";

  const { perSlot } = qdReplayDraft(QD_SIZE);
  const slotInfoByIndex = {};
  perSlot.forEach(p => { slotInfoByIndex[p.index] = p; });

  quickDraft.forEach((raw, i) => {
    const info = slotInfoByIndex[i] || null;
    const h = info ? info.hero : null;
    const slot = document.createElement("div");
    slot.className = "qd-slot " + (h ? "filled" : "empty");

    if (h) {
      const portrait = h.iconData ? `<img src="${h.iconData}">` : "⚔️";
      const ghostBadge = info.variant === "ghost" ? `<div class="qd-slot-ghost-badge" title="Drafted as its Ghost build">👻</div>` : "";
      slot.innerHTML = `
        ${ghostBadge}
        <button type="button" class="qd-slot-info-btn" data-idx="${i}" title="Why was this hero picked?">ⓘ</button>
        <div class="qd-slot-portrait">${portrait}</div>
        <div class="qd-slot-name">${h.name || "Unnamed"}</div>
        <div class="qd-slot-score">${info.score.toFixed(1)}</div>`;
      slot.title = `Tap to remove ${h.name || "this hero"} from Quick Draft`;
      slot.addEventListener("click", () => removeFromQuickDraft(h.id));
      // The (i) button sits inside the same clickable slot but must NOT
      // trigger the remove-from-draft click above it.
      slot.querySelector(".qd-slot-info-btn").addEventListener("click", e => {
        e.stopPropagation();
        qdShowSlotInfo(e.currentTarget, info);
      });
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

  // Section 9.4 — indicator + switch for which side (Selfless/Selfish)
  // Suggest/Next Best/Autofill will prioritize for the next open slot.
  // Hidden once the team is full since there's no "next slot" left to
  // steer. Reflects the manual override the moment one is set, so the
  // badge and the actual picks Autofill makes can never disagree.
  let sideBadgeHtml = "";
  if (filledCount < QD_SIZE) {
    const effSide = qdEffectiveRequiredSide(quickDraft);
    const sideLabel = effSide === "selfish" ? "⚔ Selfish" : effSide === "selfless" ? "🛡 Selfless" : "⚖ Either";
    const modeNote = qdManualSideOverride ? "Manually set" : "Auto — needed to hit the default 3 Selfish + 2 Selfless split";
    sideBadgeHtml = `
      <span class="qd-stat qd-side-badge" title="${modeNote}. This is what Suggest/Next Best/Autofill will prioritize for the next open slot.">${sideLabel}</span>
      <button type="button" class="qd-side-switch-btn" id="qd-side-switch-btn" title="Switch which side (Selfless/Selfish) is prioritized for the next open slot">⇄</button>`;
  }

  statsEl.innerHTML = `
    <span class="qd-stat">${filledCount}/5 Picked</span>
    <span class="qd-stat">Avg ${avgTxt}</span>${sideBadgeHtml}`;

  const sideSwitchBtn = document.getElementById("qd-side-switch-btn");
  if (sideSwitchBtn) sideSwitchBtn.addEventListener("click", qdToggleSideOverride);

  document.getElementById("btn-quickdraft-suggest").disabled = filledCount >= QD_SIZE;
  document.getElementById("btn-quickdraft-random").disabled = filledCount >= QD_SIZE;
  document.getElementById("btn-quickdraft-autofill").disabled = filledCount >= QD_SIZE;
  const nextBestBtn = document.getElementById("btn-quickdraft-nextbest");
  if (nextBestBtn) {
    const latestSlot = qdLatestFilledSlotIndex();
    nextBestBtn.disabled = latestSlot === null;
    nextBestBtn.title = latestSlot !== null
      ? `Replaces Slot ${latestSlot + 1} (your latest pick) with the next-best pick — does not add a new hero`
      : "Fill a slot first";
  }

  if (quickDraftSuggestOpen) renderQuickDraftSuggestions();
  renderQdHeroSearchResults();
}

/* Rule 1 hint — Ban Protect element reminder. */
/* ── Section 8.1: Enemy Factor checklist ──
   A searchable checklist menu, not a flat chip row — Factors are
   user-defined and can grow past what fits inline, same reasoning as
   the search-to-add UI on Taxonomy rows and the RTE assignment lists.
   Rendered fresh from the taxonomy library every time: on init,
   whenever the taxonomy Factors panel changes something (add/rename/
   delete — see renderFactorsPanel), and after Suggest re-renders so a
   freshly-ticked item's state never drifts from qdTickedFactorIds.

   [Overlap fix] The menu is built once here and appended straight to
   <body>, then positioned with `position:fixed` from the trigger
   button's own bounding box. Previously it lived inline next to the
   button as `position:absolute`, which put it at the mercy of every
   ancestor between it and the button: the Quick Draft drawer clips
   its contents to animate open/closed (`overflow:hidden`), so
   anything that visually extended past the drawer's current box —
   exactly what a popped-open dropdown does — got silently cut off or
   buried behind whatever came next in the drawer (this is what showed
   up as "the menu is hidden underneath the quickdraft box"). A
   fixed-position node appended to <body> has no such ancestor to be
   clipped or out-stacked by, on either index.html or quickdraft.html,
   independent of drawer state or qd-companion mode. (qdFactorMenuSearch
   and qdFactorMenuEl are declared up near qdTickedFactorIds, not here —
   see the comment there for why.) */

function qdFactorMenuLabel() {
  const n = qdTickedFactorIds.size;
  return n === 0 ? "🎯 Enemy Factors ▾" : `🎯 Enemy Factors (${n} ticked) ▾`;
}

// Pushes a new search value into the menu — used by both the text input
// itself and the quick-word chips, so both stay in sync (typing a quick
// word's text manually highlights its chip too, since the chip's
// "active" check is just a string compare against qdFactorMenuSearch).
function qdFactorMenuSetSearch(value, opts) {
  opts = opts || {};
  qdFactorMenuSearch = value;
  const input    = document.getElementById("qd-factor-menu-search");
  const clearBtn = document.getElementById("qd-factor-menu-clear");
  if (input && input.value !== value) input.value = value;
  if (clearBtn) clearBtn.style.display = value ? "flex" : "none";
  renderQdFactorMenuQuickWords();
  renderQdFactorMenuList();
  if (opts.focus && input) input.focus();
}

// The quick-word chip row — one tap fills the search box with that word
// (toggle off by tapping the already-active chip again).
function renderQdFactorMenuQuickWords() {
  const box = document.getElementById("qd-factor-menu-quickwords");
  if (!box) return;
  const active = qdFactorMenuSearch.trim().toLowerCase();

  box.innerHTML = QD_FACTOR_QUICK_WORDS.map(word => `
    <button type="button" class="qd-factor-quickword${active === word.toLowerCase() ? " active" : ""}" data-word="${word}">${word}</button>
  `).join("");

  box.querySelectorAll(".qd-factor-quickword").forEach(chip => {
    chip.addEventListener("click", () => {
      const word = chip.dataset.word;
      const isActive = qdFactorMenuSearch.trim().toLowerCase() === word.toLowerCase();
      qdFactorMenuSetSearch(isActive ? "" : word);
    });
  });
}

// Builds the fullscreen Enemy Factors picker the first time it's needed
// and reuses it after. Rebuilt as a screen-filling overlay+panel (rather
// than a small anchored dropdown) so there's room for every Factor to
// sit in a neat, generously-tappable, vertically-scrolling grid instead
// of a cramped floating box — see .qd-factor-menu-overlay/-panel in
// style.css for how it morphs from a true edge-to-edge sheet on phones
// to a large centered, backdrop-dimmed modal on wider screens.
function ensureQdFactorMenu() {
  if (qdFactorMenuEl) return qdFactorMenuEl;

  const menu = document.createElement("div");
  menu.className = "qd-factor-menu-overlay";
  menu.id = "qd-factor-menu";
  menu.style.display = "none";
  menu.innerHTML = `
    <div class="qd-factor-menu-panel">
      <div class="qd-factor-menu-header">
        <div class="qd-factor-menu-title">🎯 Enemy Factors</div>
        <button type="button" class="qd-factor-menu-close" id="qd-factor-menu-close" aria-label="Close">✕</button>
      </div>
      <div class="qd-factor-menu-searchbar">
        <input type="text" class="taxonomy-search qd-factor-menu-search" id="qd-factor-menu-search" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="🔍 Search Factors…" />
        <button type="button" class="qd-factor-menu-clear" id="qd-factor-menu-clear" title="Clear search" aria-label="Clear search">✕</button>
      </div>
      <div class="qd-factor-menu-quickwords" id="qd-factor-menu-quickwords"><!-- quick-tap keyword chips --></div>
      <div class="qd-factor-menu-list" id="qd-factor-menu-list"><!-- populated from the taxonomy Factors library --></div>
    </div>
  `;
  document.body.appendChild(menu);
  qdFactorMenuEl = menu;

  const searchInput = menu.querySelector("#qd-factor-menu-search");
  const clearBtn    = menu.querySelector("#qd-factor-menu-clear");
  const closeBtn    = menu.querySelector("#qd-factor-menu-close");

  searchInput.addEventListener("input", e => qdFactorMenuSetSearch(e.target.value));
  // Fast X-to-clear next to the search box — wipes the text and hands
  // focus straight back so the next word can be typed immediately,
  // instead of needing a click-then-select-all-then-type round trip.
  clearBtn.addEventListener("click", () => qdFactorMenuSetSearch("", { focus: true }));

  const closeMenu = () => {
    menu.style.display = "none";
    document.body.classList.remove("qd-factor-menu-open");
    // If something (e.g. Hero Factors) asked to be resumed once this
    // closes, do that now instead of just leaving the user with nothing
    // open. Grabbed-and-cleared up front so the callback itself can
    // safely open this same picker again later without re-triggering.
    if (qdFactorMenuOnClose) {
      const cb = qdFactorMenuOnClose;
      qdFactorMenuOnClose = null;
      cb();
    }
  };
  closeBtn.addEventListener("click", closeMenu);
  // Tapping the dimmed backdrop (outside the panel) closes it too — but
  // not a click that started inside the panel and merely bubbled up
  // (e.g. releasing a text selection), so only react when the backdrop
  // itself was the actual target.
  menu.addEventListener("click", e => { if (e.target === menu) closeMenu(); });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && menu.style.display !== "none") closeMenu();
  });

  return menu;
}

// [Fullscreen picker] positionQdFactorMenu was the old anchored-dropdown
// placement logic (compute button rect, glue menu below it, reposition
// on scroll/resize). The picker is now a fixed fullscreen overlay that
// needs no such positioning — kept as a no-op only in case anything
// external still calls it, rather than hunting down every call site.
function positionQdFactorMenu() {}

// Alphabetical (A→Z) row of chips — one per currently-ticked Enemy
// Factor — shown above the Enemy Factors label/dropdown. Clicking a
// chip toggles whether that Factor is "prioritized": prioritized
// Factors get their score simply doubled in Factor-mode scoring (see
// qdFactorEntryForHero). Purely a display+toggle surface —
// the actual tick/untick still happens in the dropdown menu itself
// (renderQdFactorMenuList); this row can only prioritize what's
// already ticked there.
function renderQdFactorPriorityChips() {
  const box = document.getElementById("qd-factor-priority-chips");
  if (!box) return; // this page doesn't have an Enemy Factors control

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
      renderQdFactorPriorityChips(); // just this row — cheap, and avoids losing dropdown scroll/search state
      renderQuickDraft(); // filled slots' scores/(i) explanations shift with the boost
      if (quickDraftSuggestOpen) renderQuickDraftSuggestions();
      if (typeof hfRefreshIfOpen === "function") hfRefreshIfOpen(); // prioritizing a Factor shifts Hero Factors scores too
    });
  });
}

function renderQdFactorChips() {
  const btn = document.getElementById("qd-factor-menu-btn");
  if (!btn) return; // this page doesn't have an Enemy Factors control

  const menu = ensureQdFactorMenu();

  // Prune ticks pointing at a Factor that's since been deleted, so a
  // stale id can't silently keep affecting recommendations forever.
  [...qdTickedFactorIds].forEach(id => {
    if (!taxonomy.factors.some(f => f.id === id)) { qdTickedFactorIds.delete(id); qdPrioritizedFactorIds.delete(id); }
  });

  document.getElementById("qd-factor-menu-btn-label").textContent = qdFactorMenuLabel();
  renderQdFactorMenuQuickWords();
  renderQdFactorMenuList();
  renderQdFactorPriorityChips();

  // Wire the trigger just once — every other call just refreshes the
  // label and list content above, so re-adding a Factor or re-opening
  // the menu never touches this listener twice.
  if (btn.dataset.wired) return;
  btn.dataset.wired = "1";

  btn.addEventListener("click", e => {
    e.stopPropagation();
    const opening = menu.style.display === "none";
    if (opening) {
      // Re-render fresh on every open rather than trusting whatever was
      // last drawn: renderQdFactorChips() can run once at page load
      // before taxonomy.factors has finished loading from storage, and
      // nothing else was forcing a re-render afterward — the list would
      // then sit empty until something incidental (like typing in the
      // search box) triggered renderQdFactorMenuList() again.
      [...qdTickedFactorIds].forEach(id => {
        if (!taxonomy.factors.some(f => f.id === id)) { qdTickedFactorIds.delete(id); qdPrioritizedFactorIds.delete(id); }
      });
      renderQdFactorMenuQuickWords();
      renderQdFactorMenuList();
      menu.style.display = "flex";
      document.body.classList.add("qd-factor-menu-open"); // locks background scroll behind the fullscreen picker
      document.getElementById("qd-factor-menu-search")?.focus();
    } else {
      menu.style.display = "none";
      document.body.classList.remove("qd-factor-menu-open");
    }
  });
}

// Alphabetical (case-insensitive), filtered by the menu's search box.
function renderQdFactorMenuList() {
  const list = document.getElementById("qd-factor-menu-list");
  if (!list) return;

  if (taxonomy.factors.length === 0) {
    list.innerHTML = `<div class="qd-factor-empty">No Factors defined yet — add some in 🗂 Taxonomy.</div>`;
    return;
  }

  const q = qdFactorMenuSearch.trim().toLowerCase();
  const sorted = [...taxonomy.factors].sort((a, b) =>
    (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase())
  );
  const filtered = sorted.filter(f => !q || (f.name || "").toLowerCase().includes(q));

  if (!filtered.length) {
    list.innerHTML = `<div class="qd-factor-empty">No matching Factors.</div>`;
    return;
  }

  // Pills that wrap into a grid of several rows (rather than one
  // vertical list) so many Factors are visible — and quickly tappable
  // — at once instead of requiring scrolling to see more than a few.
  list.innerHTML = filtered.map(f => `
    <label class="qd-factor-menu-item${qdTickedFactorIds.has(f.id) ? " active" : ""}">
      <input type="checkbox" data-factor-id="${f.id}" ${qdTickedFactorIds.has(f.id) ? "checked" : ""} />
      <span>${f.name || "(unnamed)"}</span>
    </label>
  `).join("");

  list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", () => {
      const factorId = taxonomy.factors.find(f => String(f.id) === cb.dataset.factorId)?.id;
      if (factorId === undefined) return;
      if (cb.checked) qdTickedFactorIds.add(factorId); else { qdTickedFactorIds.delete(factorId); qdPrioritizedFactorIds.delete(factorId); }
      cb.closest(".qd-factor-menu-item")?.classList.toggle("active", cb.checked);
      document.getElementById("qd-factor-menu-btn-label").textContent = qdFactorMenuLabel();
      saveQuickDraftModeLocal();
      renderQdFactorPriorityChips(); // the ticked-Factor chip row above the dropdown needs updating too
      renderQuickDraft(); // refresh already-filled slots' scores/(i) explanations too, not just the suggestion panel
      if (quickDraftSuggestOpen) renderQuickDraftSuggestions();
      if (typeof hfRefreshIfOpen === "function") hfRefreshIfOpen(); // Hero Factors grid re-ranks against the same tick
    });
  });
}

function qdBanProtectHint() {
  if (!qdBanProtectElement) return "";
  const counterEl = QD_ELEMENT_COUNTER[qdBanProtectElement];
  return `🛡 Ban Protect is ${qdBanProtectElement} — remaining picks are ranked with ${counterEl} favored first, then other elements, ${qdBanProtectElement}'s own victim last (never excluded outright).`;
}

/* [Section 5 fix] Used to explain the old chain/support/quadrant shape
   of a slot (Rule 4) via qdSlotRequirement — that engine is gone as of
   Section 3/4, so there's nothing chain-shaped left to describe. Kept
   as a no-op (rather than removing the call site in
   renderQuickDraftSuggestions) so a hint can be reintroduced here later
   without touching the render function again. Left uncalled from a
   crash-prone path: previously this ran on every Suggest render with
   no Factor ticked and threw immediately (qdSlotRequirement / 
   QD_QUADRANT_LABEL no longer exist). */
function qdChainHint(nextIdx) {
  return "";
}

function renderQuickDraftSuggestions() {
  const panel = document.getElementById("quickdraft-suggestions");
  // Rebuild Spec Section 9.1 — one shared list is now two independently
  // scrollable columns, Selfless and Selfish. Both still live inside the
  // same panel/hint/label, so everything else about Suggest (open/close,
  // the Slot-N label, the Factor/quadrant hint line) is untouched.
  const listElSelfless = document.getElementById("quickdraft-suggestions-list-selfless");
  const listElSelfish  = document.getElementById("quickdraft-suggestions-list-selfish");
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
    const hints = qdTickedFactorIds.size > 0
      ? [qdFactorHint()]
      : [qdBanProtectHint(), qdChainHint(nextIdx)].filter(Boolean);
    if (hints.length) { hintEl.innerHTML = hints.join("<br>"); hintEl.style.display = "block"; }
    else { hintEl.style.display = "none"; }

    renderQuickDraftSuggestionsInner(nextIdx, listElSelfless, listElSelfish, panel);
  } catch (err) {
    const errHTML = `<div class="qd-suggest-empty" style="color:#ff6b6b; text-align:left; white-space:pre-wrap; font-family:monospace; font-size:11px;">⚠️ Suggest crashed:\n${(err && err.stack) || err}</div>`;
    listElSelfless.innerHTML = errHTML;
    listElSelfish.innerHTML = "";
    panel.style.display = "block";
    quickDraftSuggestOpen = true;
  }
}

// One suggestion row's markup — shared by both columns so Selfless and
// Selfish render identically apart from which slice of `scored` each
// gets. `rank` is the row's position WITHIN ITS OWN column, so "👑 best"
// and the highlighted border mark the top pick of each side independently
// (there are two "bests" now, one per column — see Section 9.1: the two
// lists are independent, not one ranking split in half).
function qdSuggestRowHTML(s, rank) {
  const h = s.hero;
  const portrait = h.iconData ? `<img src="${h.iconData}">` : "⚔️";
  // Warnings float to the front so they survive the 2-reason/1-line
  // truncation on a mobile-width card — previously a ⚠️ pushed in
  // after a long "Supports the… target…" explanation could get cut
  // off entirely, with no way to see the rest on a touch screen
  // (title= tooltips don't show on tap in mobile Safari/Chrome).
  const orderedReasons = [...s.reasons].sort(
    (a, b) => (b.startsWith("⚠️") ? 1 : 0) - (a.startsWith("⚠️") ? 1 : 0)
  );
  const topReasons = orderedReasons.slice(0, 2).join(" · ");
  const nameSuffix = s.variant === "ghost" ? " (Ghost)" : "";
  // Neutral heroes now appear in both Selfless and Selfish columns
  // (qdHeroMatchesSide) instead of neither — flag them here so it's
  // clear this is an unrated stand-in, not an actual Selfless/Selfish
  // rating on this side.
  const neutralBadge = qdHeroSide(h, s.variant) === "neutral"
    ? `<span class="qd-neutral-badge" title="Neutral — no Selfish/Selfless score set; counts toward either side">⚖️</span>`
    : "";
  return `
    <div class="qd-suggest-row${rank === 0 ? " best" : ""}" data-id="${s.heroId}" data-variant="${s.variant}">
      <div class="qd-suggest-portrait">${portrait}</div>
      <div class="qd-suggest-info">
        <div class="qd-suggest-name">${rank === 0 ? "👑 " : ""}${h.name || "Unnamed"}${nameSuffix} ${neutralBadge}</div>
        <div class="qd-suggest-reasons" data-expanded="0">${topReasons}</div>
      </div>
      <div class="qd-suggest-score">${s.score.toFixed(1)}</div>
    </div>`;
}

// Renders one column's rows into listEl and wires up its interactions
// (expand reasons, click-to-draft). `rows` is that column's already-
// filtered/ranked slice of the full `scored` list.
function qdRenderSuggestColumn(listEl, rows, emptyMessage, panel) {
  if (!listEl) return;
  if (rows.length === 0) {
    listEl.innerHTML = `<div class="qd-suggest-empty">${emptyMessage}</div>`;
    return;
  }

  listEl.innerHTML = rows.map((s, rank) => qdSuggestRowHTML(s, rank)).join("");

  // Tap the reasons line itself to expand/collapse the full list, without
  // triggering the row's own click (which adds the hero to the draft).
  listEl.querySelectorAll(".qd-suggest-reasons").forEach((el, i) => {
    const s = rows[i];
    const orderedReasons = [...s.reasons].sort(
      (a, b) => (b.startsWith("⚠️") ? 1 : 0) - (a.startsWith("⚠️") ? 1 : 0)
    );
    const topReasons = orderedReasons.slice(0, 2).join(" · ");
    el.addEventListener("click", e => {
      e.stopPropagation();
      const expanded = el.dataset.expanded === "1";
      el.dataset.expanded = expanded ? "0" : "1";
      el.textContent = expanded ? topReasons : s.reasons.join(" · ");
      el.style.whiteSpace   = expanded ? "" : "normal";
      el.style.overflow     = expanded ? "" : "visible";
      el.style.textOverflow = expanded ? "" : "unset";
    });
  });

  listEl.querySelectorAll(".qd-suggest-row").forEach(row => {
    row.addEventListener("click", () => {
      addToQuickDraft(Number(row.dataset.id), row.dataset.variant);
      if (quickDraft.indexOf(null) !== -1) renderQuickDraftSuggestions();
      else { panel.style.display = "none"; quickDraftSuggestOpen = false; }
    });
  });
}

function renderQuickDraftSuggestionsInner(nextIdx, listElSelfless, listElSelfish, panel) {
  const scored = qdSuggestForNextSlot();

  if (scored.length === 0) {
    const emptyHTML = `<div class="qd-suggest-empty">No more heroes left in your Roster to suggest.</div>`;
    listElSelfless.innerHTML = emptyHTML;
    listElSelfish.innerHTML  = emptyHTML;
  } else {
    // Rebuild Spec Section 9.1 — Selfless heroes and Selfish heroes each
    // get their own independently-scrollable list, so the ratio of each
    // in the draft can be chosen deliberately rather than picked from
    // one blended ranking. This only PARTITIONS qdSuggestForNextSlot's
    // output by side (Section 8's Factor/quadrant ranking is untouched).
    // A "neutral" (unrated, see Section 2) hero is no longer soft-
    // blocked from Quick Draft — it matches BOTH sides
    // (qdHeroMatchesSide) and shows up in both columns, each row
    // flagged with a ⚖️ so it's clear it's an unrated stand-in rather
    // than an actual Selfless/Selfish rating.
    const selflessRows = scored.filter(s => qdHeroMatchesSide(s.hero, s.variant, "selfless"));
    const selfishRows  = scored.filter(s => qdHeroMatchesSide(s.hero, s.variant, "selfish"));
    qdRenderSuggestColumn(listElSelfless, selflessRows, "No Selfless-rated heroes match right now.", panel);
    qdRenderSuggestColumn(listElSelfish,  selfishRows,  "No Selfish-rated heroes match right now.", panel);
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
      const { x, y } = heroToXY(h);
      h._x = x; h._y = y;
    });
    const spread = computeSpreadPositions(visibleHeroes);
    spread.forEach(p => { posMap[p.id] = { x: p.x, y: p.y }; });
  }

  // Compute stack counts when spread is off
  const stackCounts = spreadEnabled ? {} : computeStackCounts(visibleHeroes);

  heroes.forEach(h => {
    if (h.hidden) return;
    const { x: rawX, y: rawY } = heroToXY(h);
    h._x = rawX; h._y = rawY;

    const pos = spreadEnabled && posMap[h.id] ? posMap[h.id] : { x: rawX, y: rawY };

    const isHighlighted = h.id === highlightedId;
    const isSelected    = h.id === selectedId;
    const isDimmed      = focusEnabled && highlightedId !== null && !isHighlighted;

    // Primary dot
    const dot = buildHeroDot(h, pos, { isHighlighted, isSelected, isDimmed, isGhost: false });
    dot.title = heroChartTooltip(h, false);

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
      const { x: altRawX, y: altRawY } = heroAltToXY(h);
      const ghostDot = buildHeroDot(h, { x: altRawX, y: altRawY }, { isHighlighted, isSelected, isDimmed, isGhost: true });
      ghostDot.title = "Ghost: " + heroChartTooltip(h, true);
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

  // Drag — primary only, ghost is not draggable. Vertical-only: X is a
  // derived Reaction/Engage average now (Section 6), so it can't be
  // dragged — only Y (Selfish/Selfless) moves. See onPointerMove.
  if (!isGhost) {
    dot.addEventListener("pointerdown", e => {
      if (h.locked) return;
      e.stopPropagation();
      setSelected(h.id);
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
    const { x, y } = heroToXY(h);
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
    const { x, y } = heroToXY(h);
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
    const meta = RARITY_META[h.rarity] || RARITY_META["5r"];
    const xa = heroXAxis(h), ya = heroYAxis(h);
    const avg  = heroDisplayAvg(h);
    const xLbl = xa.side === "REACTION" ? "Reaction" : "Engage";
    const yLbl = ya.value === 0 ? "Neutral" : (ya.side === "SELFISH" ? "Selfish" : "Selfless");

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
            <span class="score-badge">${xLbl} ${xa.value}</span>
            <span class="score-badge">${yLbl} ${ya.value}</span>
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
    const xa = heroXAxis(h), ya = heroYAxis(h);
    const avg  = heroDisplayAvg(h);
    const xLbl = xa.side === "REACTION" ? "Reaction" : "Engage";
    const yLbl = ya.value === 0 ? "Neutral" : (ya.side === "SELFISH" ? "Selfish" : "Selfless");

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
        <div class="hero-card-name">${h.name || "Unnamed Hero"}${h.locked ? `<span class="lock-badge" title="Locked">${lockSVG}</span>` : ""}${h.pvpTag ? `<span class="lock-badge" title="PVP tag — exempt from Quick Draft's Competitive 3★ ban">🏆</span>` : ""}${h.needsRerating ? `<span class="unrated-badge" title="Imported from a legacy export — needs Selfish/Selfless and Reaction/Engagement scoring">⚠ Unrated</span>` : ""}</div>
        <div class="hero-card-rarity" style="color:${meta.color}">${meta.label}</div>
        <div class="hero-card-tags">${roleEl}${elemEl}</div>
        <div class="hero-card-scores">
          <div class="scores-row">
            <span class="score-badge">${xLbl} ${xa.value}</span>
            <span class="score-badge">${yLbl} ${ya.value}</span>
            <span class="score-badge avg">Avg ${avg}</span>
          </div>
          ${h.altStats ? `
          <div class="scores-row">
            <span class="score-badge alt-v">👻 ${(() => { const a = heroAltXAxis(h); return (a.side === "REACTION" ? "Reaction" : "Engage") + " " + a.value; })()}</span>
            <span class="score-badge alt-h">${(() => { const a = heroAltYAxis(h); return (a.value === 0 ? "Neutral" : (a.side === "SELFISH" ? "Selfish" : "Selfless")) + " " + a.value; })()}</span>
            <span class="score-badge alt-avg">Avg ${heroAltDisplayAvg(h)}</span>
          </div>
          <div class="scores-row scores-row-total">
            <span class="score-badge total-avg">Total Avg ${+((xa.value + ya.value + heroAltXAxis(h).value + heroAltYAxis(h).value) / 4).toFixed(1)}</span>
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

  // Y only — X (Reaction/Engage) is a derived average now and isn't
  // draggable (Section 6 open-decision). The dot's left/% is left alone.
  let y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));

  // Grid snap: snap to nearest 1/SNAP_DIVISIONS interval (0,5,10,…,50,…,95,100%)
  if (snapEnabled) {
    const step = 100 / SNAP_DIVISIONS; // 10% per step
    y = Math.round(y / step) * step;
    y = Math.max(0, Math.min(100, y));
  }

  const dot = chart.querySelector(`.hero-dot[data-id="${dragging}"]`);
  if (dot) { dot.style.top = y + "%"; }

  const hero = heroes.find(h => h.id === dragging);
  if (hero) {
    const { selfishScore, selflessScore } = yToSelfishSelfless(y);
    hero.selfishScore  = selfishScore;
    hero.selflessScore = selflessScore;
    hero._y = y;
    if (dot) dot.title = heroChartTooltip(hero, false);
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

// Renders the "how was this derived" breakdown behind a hero's Selfish/
// Selfless score, for the details view's ⓘ toggle. isAlt reads the
// ghost/secondary stats instead of the primary ones. Falls back to a
// plain note for heroes rated before this breakdown existed (no
// selfSkillIds/allySupport on file) or for Neutral heroes.
function heroSelfishSelflessBreakdownHTML(h, isAlt) {
  const src      = isAlt ? (h.altStats || {}) : h;
  const selfish  = Math.max(0, Number(src.selfishScore)  || 0);
  const selfless = Math.max(0, Number(src.selflessScore) || 0);

  if (selfless > 0) {
    const allies = Array.isArray(src.allySupport) ? src.allySupport : [];
    if (!allies.length) return `<div class="det-breakdown-empty">No ally breakdown on file for this score.</div>`;
    return allies.map((a, i) => `
      <div class="det-breakdown-row"><strong>Ally ${i + 1}:</strong> Healing ${Number(a?.healing) || 0}% · Passive ${Number(a?.passive) || 0}% · Buffs ${Number(a?.buffCount) || 0}</div>
    `).join("");
  }
  if (selfish > 0) {
    const ids = Array.isArray(src.selfSkillIds) ? src.selfSkillIds : [];
    if (!ids.length) return `<div class="det-breakdown-empty">No checklist breakdown on file for this score.</div>`;
    const labels = ids.map(id => SELF_SKILLS.find(s => s.id === id)?.label).filter(Boolean);
    return labels.map(l => `<div class="det-breakdown-row">✓ ${l}</div>`).join("");
  }
  return `<div class="det-breakdown-empty">Neutral — no checklist items ticked.</div>`;
}

// Toggles one details-view breakdown panel open/closed, lazily filling
// it in on first open (cheap either way, but avoids building markup
// for a panel the person never expands).
function toggleDetBreakdown(btnId, boxId, h, isAlt) {
  const box = document.getElementById(boxId);
  if (!box) return;
  const opening = box.style.display === "none";
  if (opening) box.innerHTML = heroSelfishSelflessBreakdownHTML(h, isAlt);
  box.style.display = opening ? "block" : "none";
}

// Renders every Reaction and Engagement attached to a hero, each with
// its current fixed taxonomy score, for the details view's REACTION /
// ENGAGE ⓘ toggle. Ghost shares the exact same reactions/engagements
// as the main build (see the Section 6 comment above heroAltXAxis), so
// this one list serves both the main and ghost toggle buttons. Sorted
// highest-score-first within each group; names wrap instead of
// truncating since some taxonomy names run long.
function heroReactionEngageBreakdownHTML(h) {
  function group(kind, label) {
    const list = Array.isArray(h?.[kind]) ? h[kind] : [];
    if (!list.length) return `<div class="det-breakdown-group"><div class="det-breakdown-group-title">${label}</div><div class="det-breakdown-empty">None attached.</div></div>`;
    const rows = list
      .map(item => {
        const refId = item?.refId ?? item;
        return { name: taxonomyName(kind, refId), value: taxonomyValue(kind, refId) };
      })
      .sort((a, b) => b.value - a.value)
      .map(r => `
        <div class="det-breakdown-row det-breakdown-row-re">
          <span class="det-breakdown-re-name">${r.name}</span>
          <span class="det-breakdown-re-value">${r.value.toFixed(1)}</span>
        </div>`)
      .join("");
    return `<div class="det-breakdown-group"><div class="det-breakdown-group-title">${label} (${list.length})</div>${rows}</div>`;
  }
  return group("reactions", "Reactions") + group("engagements", "Engagements");
}

// Same lazy-fill-on-open pattern as toggleDetBreakdown, but for the
// combined Reaction/Engage list rather than the Selfish/Selfless
// checklist — kept separate since it takes no isAlt flag (both toggle
// buttons show the exact same shared list).
function toggleDetReactionEngageBreakdown(boxId, h) {
  const box = document.getElementById(boxId);
  if (!box) return;
  const opening = box.style.display === "none";
  if (opening) box.innerHTML = heroReactionEngageBreakdownHTML(h);
  box.style.display = opening ? "block" : "none";
}

/* ═══════════════════════════════════════
   HERO DETAILS (read-only view)
═══════════════════════════════════════ */
function openHeroDetails(h) {
  detailsHeroId = h.id;
  const overlay = document.getElementById("details-overlay");
  const meta = RARITY_META[h.rarity] || RARITY_META["5r"];
  const xa = heroXAxis(h), ya = heroYAxis(h);
  const vStr = `${ya.value === 0 ? "Neutral" : (ya.side === "SELFISH" ? "Selfish" : "Selfless")} ${ya.value}`;
  const hStr = `${xa.side === "REACTION" ? "Reaction" : "Engage"} ${xa.value}`;
  const avg  = heroDisplayAvg(h);

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
        <div class="det-hero-name">${h.name || "Unnamed Hero"}${h.needsRerating ? `<span class="unrated-badge" title="Imported from a legacy export — needs Selfish/Selfless and Reaction/Engagement scoring">⚠ Unrated</span>` : ""}</div>
        <div class="det-hero-rarity" style="color:${meta.color}">${meta.label}</div>
      </div>
    </div>
    <div class="det-grid">
      <div class="det-field"><div class="det-field-label">NAME</div><div class="det-field-value">${h.name || "—"}</div></div>
      <div class="det-field"><div class="det-field-label">RARITY</div><div class="det-field-value" style="color:${meta.color}">${meta.label}</div></div>
      <div class="det-field"><div class="det-field-label">ROLE</div><div class="det-field-value">${roleEl}</div></div>
      <div class="det-field"><div class="det-field-label">ELEMENT</div><div class="det-field-value">${elementEl}</div></div>
      <div class="det-field det-field-full">
        <div class="det-field-label">SELFISH / SELFLESS <button type="button" class="det-info-btn" id="det-ss-info-btn" title="See how this score was derived">ⓘ</button></div>
        <div class="det-field-value"><span class="det-score-pill">${vStr}</span></div>
        <div class="det-breakdown" id="det-ss-breakdown" style="display:none"></div>
      </div>
      <div class="det-field det-field-full">
        <div class="det-field-label">REACTION / ENGAGE <button type="button" class="det-info-btn" id="det-re-info-btn" title="See every Reaction/Engagement attached to this hero">ⓘ</button></div>
        <div class="det-field-value">
          <span class="det-score-pill" title="Average of every Reaction attached to this hero">Reaction ${(computeReactionScore(h) ?? 0).toFixed(1)}</span>
          <span class="det-score-pill" style="margin-left:6px">Engage ${(computeEngageScore(h) ?? 0).toFixed(1)}</span>
        </div>
        <div class="det-breakdown det-breakdown-scroll" id="det-re-breakdown" style="display:none"></div>
      </div>
      <div class="det-field det-field-full"><div class="det-field-label">NOTES</div><div class="det-field-value det-notes">${h.notes || '<span style="opacity:.45;font-style:italic">No notes.</span>'}</div></div>
    </div>
    ${h.altStats ? `
    <div style="margin-top:14px;padding:10px 12px;background:rgba(224,64,251,.07);border:1px solid rgba(224,64,251,.25);border-radius:5px;">
      <div style="font-family:'Cinzel',serif;font-size:9px;letter-spacing:.2em;color:#e040fb;margin-bottom:8px;">👻 SECONDARY STATS (GHOST)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div class="det-field" style="grid-column:1 / -1">
          <div class="det-field-label">SELFISH / SELFLESS <button type="button" class="det-info-btn" id="det-alt-ss-info-btn" title="See how this score was derived">ⓘ</button></div>
          <div class="det-field-value"><span class="det-score-pill" style="border-color:rgba(224,64,251,.4);color:#e040fb;background:rgba(224,64,251,.1)">${(() => { const a = heroAltYAxis(h); return (a.value === 0 ? "Neutral" : (a.side === "SELFISH" ? "Selfish" : "Selfless")) + " " + a.value; })()}</span></div>
          <div class="det-breakdown" id="det-alt-ss-breakdown" style="display:none"></div>
        </div>
        <div class="det-field"><div class="det-field-label">REACTION / ENGAGE <button type="button" class="det-info-btn" id="det-alt-re-info-btn" title="See every Reaction/Engagement attached to this hero">ⓘ</button></div><div class="det-field-value"><span class="det-score-pill" style="border-color:rgba(224,64,251,.4);color:#e040fb;background:rgba(224,64,251,.1)">R ${(computeReactionScore(h) ?? 0).toFixed(1)}</span> <span class="det-score-pill" style="border-color:rgba(224,64,251,.4);color:#e040fb;background:rgba(224,64,251,.1);margin-left:4px">E ${(computeEngageScore(h) ?? 0).toFixed(1)}</span><div class="det-breakdown det-breakdown-scroll" id="det-alt-re-breakdown" style="display:none"></div></div></div>
        <div class="det-field"><div class="det-field-label">GHOST AVG</div><div class="det-field-value"><span class="det-score-pill" style="border-color:rgba(224,64,251,.4);color:#e040fb;background:rgba(224,64,251,.1)">${heroAltDisplayAvg(h)}</span></div></div>
        <div class="det-field" style="border-color:rgba(224,64,251,.3);background:rgba(224,64,251,.06)"><div class="det-field-label" style="color:#e040fb">TOTAL AVG</div><div class="det-field-value"><span class="det-score-pill" style="border-color:rgba(224,64,251,.5);color:#f0a0ff;background:rgba(224,64,251,.18);font-size:13px">${+((xa.value + ya.value + heroAltXAxis(h).value + heroAltYAxis(h).value) / 4).toFixed(1)}</span></div></div>
      </div>
    </div>` : ""}
  `;

  // Selfish/Selfless ⓘ toggles — main always present, ghost only if altStats exists.
  document.getElementById("det-ss-info-btn")?.addEventListener("click", () =>
    toggleDetBreakdown("det-ss-info-btn", "det-ss-breakdown", h, false)
  );
  document.getElementById("det-alt-ss-info-btn")?.addEventListener("click", () =>
    toggleDetBreakdown("det-alt-ss-info-btn", "det-alt-ss-breakdown", h, true)
  );
  document.getElementById("det-re-info-btn")?.addEventListener("click", () =>
    toggleDetReactionEngageBreakdown("det-re-breakdown", h)
  );
  document.getElementById("det-alt-re-info-btn")?.addEventListener("click", () =>
    toggleDetReactionEngageBreakdown("det-alt-re-breakdown", h)
  );

  // Draft section — fetch draft-enriched data from window.chartHeroes
  const liveHero = (window.chartHeroes || heroes).find(x => x.id === h.id) || h;
  renderDetailsDraft(liveHero);

  overlay.classList.add("open");
}

function renderDetailsDraft(h) {
  // Draft data now lives in memory only (window.chartDraftData), populated
  // from GitHub on page load and kept in sync by the Draft panel — no
  // localStorage involved.
  const dd = window.chartDraftData || { buffs:[], debuffs:[], strengths:[], weaknesses:[], roles:[], uniqueRoles:[] };

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
  fNotes.value    = "";
  fIconData.value = "";
  document.getElementById("f-locked").checked = false;
  document.getElementById("f-pvp-tag").checked = false;
  document.getElementById("f-alt-enabled").checked = false;
  document.getElementById("alt-stats-inputs").style.display = "none";
  document.getElementById("img-editor-wrap").style.display = "none";
  document.getElementById("f-icon-url").value = "";
  updateIconPreview(null);
  modalSelfishScore  = 0;
  modalSelflessScore = 0;
  modalSelfSkillIds  = [];
  modalAllySupport   = [];
  updateSelfishSelflessDisplay();
  modalReactions   = [];
  modalEngagements = [];
  rteAddSearchQuery = {}; // fresh search boxes for a new hero session
  renderRteSection("main");
  // Ghost Selfish/Selfless (Reactions/Engagements are shared with main —
  // see rteModalArray — so there's nothing Ghost-specific to reset here)
  modalAltSelfishScore  = 0;
  modalAltSelflessScore = 0;
  modalAltSelfSkillIds  = [];
  modalAltAllySupport   = [];
  updateAltSelfishSelflessDisplay();
  renderRteSection("alt");
  overlay.classList.add("open");
  fName.focus();
}

function openEditModal(h) {
  editingId = h.id;
  lastHeroViewedInEdit = h.id;
  modalTitle.textContent = "EDIT HERO";
  modalConfirm.textContent = "Save Changes";
  modalDelete.style.display = "inline-flex";
  fName.value    = h.name    || "";
  fRarity.value  = h.rarity  || "5ml";
  fRole.value    = h.role    || "";
  fElement.value = h.element || "";
  fNotes.value   = h.notes   || "";
  fIconData.value = h.iconData || "";
  document.getElementById("f-locked").checked = h.locked || false;
  document.getElementById("f-pvp-tag").checked = h.pvpTag || false;
  // Alt stats
  const hasAlt = !!(h.altStats);
  document.getElementById("f-alt-enabled").checked = hasAlt;
  document.getElementById("alt-stats-inputs").style.display = hasAlt ? "block" : "none";
  document.getElementById("img-editor-wrap").style.display = "none";
  document.getElementById("f-icon-url").value = "";
  updateIconPreview(h.iconData || null);
  modalSelfishScore  = typeof h.selfishScore === "number" ? h.selfishScore : 0;
  modalSelflessScore = typeof h.selflessScore === "number" ? h.selflessScore : 0;
  modalSelfSkillIds  = Array.isArray(h.selfSkillIds) ? h.selfSkillIds.slice() : [];
  modalAllySupport   = Array.isArray(h.allySupport)  ? h.allySupport.map(a => ({ ...a })) : [];
  updateSelfishSelflessDisplay();
  // Reactions/Engagements (Section 5.3) — clone so editing in the modal
  // never mutates the hero's array directly until Save Changes commits it.
  modalReactions   = Array.isArray(h.reactions)   ? h.reactions.map(x => ({ refId: x?.refId ?? x }))   : [];
  modalEngagements = Array.isArray(h.engagements) ? h.engagements.map(x => ({ refId: x?.refId ?? x })) : [];
  rteAddSearchQuery = {}; // fresh search boxes for this hero's edit session
  renderRteSection("main");
  // Ghost Selfish/Selfless (Reactions/Engagements are shared with main —
  // see rteModalArray — so there's nothing Ghost-specific to load here)
  modalAltSelfishScore  = typeof h.altStats?.selfishScore === "number" ? h.altStats.selfishScore : 0;
  modalAltSelflessScore = typeof h.altStats?.selflessScore === "number" ? h.altStats.selflessScore : 0;
  modalAltSelfSkillIds  = Array.isArray(h.altStats?.selfSkillIds) ? h.altStats.selfSkillIds.slice() : [];
  modalAltAllySupport   = Array.isArray(h.altStats?.allySupport)  ? h.altStats.allySupport.map(a => ({ ...a })) : [];
  updateAltSelfishSelflessDisplay();
  renderRteSection("alt");
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
  const notes    = fNotes.value.trim();
  let   iconData = fIconData.value || null;
  const locked   = document.getElementById("f-locked").checked;
  const pvpTag   = document.getElementById("f-pvp-tag").checked;

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

  // Alt / ghost stats — selfishScore/selflessScore drive the ghost dot's
  // vertical position and its Selfish/Selfless side in Quick Draft.
  // Reactions/Engagements are NOT stored here anymore — Ghost shares
  // the main build's list exactly (see qdOverallKitScore/heroAltXAxis),
  // so there's nothing build-specific left to save for them.
  const altEnabled = document.getElementById("f-alt-enabled").checked;
  const altStats = altEnabled ? {
    selfishScore:  modalAltSelfishScore,
    selflessScore: modalAltSelflessScore,
    selfSkillIds:  modalAltSelfSkillIds.slice(),
    allySupport:   modalAltAllySupport.map(a => ({ ...a })),
  } : null;

  // Selfish/Selfless (Section 3/4) — whatever the slider/Questionnaire
  // left in modalSelfishScore/modalSelflessScore for this modal session.
  const selfishScore  = modalSelfishScore;
  const selflessScore = modalSelflessScore;
  // Raw checklist/ally answers behind the score, kept only so the hero
  // details "ⓘ" can show how it was derived — see the state comment above.
  const selfSkillIds = modalSelfSkillIds.slice();
  const allySupport  = modalAllySupport.map(a => ({ ...a }));

  // Reactions/Engagements (Section 5.3) — whatever the assignment list
  // in this modal session ended up with (library refs never free text).
  const reactions   = modalReactions.map(x => ({ ...x }));
  const engagements = modalEngagements.map(x => ({ ...x }));

  if (editingId !== null) {
    heroes = heroes.map(h => h.id === editingId
      // needsRerating only exists to flag a legacy import that still has
      // stale zeroed-out scores (see migrateLegacyHero) — once the person
      // has actually gone through Save Changes on it, it's been re-rated,
      // so the badge should clear regardless of what values they left it at.
      ? { ...h, name, rarity, role, element, notes, iconData, locked, pvpTag, altStats, selfishScore, selflessScore, selfSkillIds, allySupport, reactions, engagements, needsRerating: false }
      : h
    );
  } else {
    heroes.push({
      id: Date.now(),
      name, rarity, role, element, notes, iconData,
      locked, pvpTag, altStats, selfishScore, selflessScore, selfSkillIds, allySupport, reactions, engagements,
    });
  }

  saveLocal();
  closeModal();
  renderAll();
}

/* ═══════════════════════════════════════
   SELFISH / SELFLESS SLIDER + QUESTIONNAIRE
   (Rebuild Spec Section 4)
═══════════════════════════════════════ */

// Reflects modalSelfishScore/modalSelflessScore onto the slider input,
// its fill bar, and the numeric readout below it. Called after either
// the Questionnaire sets a score or the slider itself is dragged.
function updateSelfishSelflessDisplay() {
  const pos = heroSelfishSelflessPosition({ selfishScore: modalSelfishScore, selflessScore: modalSelflessScore });
  fSsScore.value = pos;

  const fill = document.getElementById("ss-slider-fill");
  const pct  = Math.abs(pos) / 10 * 50; // half-track width per side
  if (pos < 0) {
    fill.style.left  = (50 - pct) + "%";
    fill.style.right = "50%";
    fill.style.background = "#ef9a9a";
  } else if (pos > 0) {
    fill.style.left  = "50%";
    fill.style.right = (50 - pct) + "%";
    fill.style.background = "#81c784";
  } else {
    fill.style.left = "50%";
    fill.style.right = "50%";
  }

  const readout = document.getElementById("ss-slider-readout");
  if (pos === 0) readout.textContent = "Neutral";
  else if (pos < 0) readout.textContent = `Selfish ${(-pos).toFixed(1)}`;
  else readout.textContent = `Selfless ${pos.toFixed(1)}`;
}

// Manually dragging the native range input directly sets whichever
// side it's on and zeroes the other — same "one continuous scale, not
// two sliders" rule the Questionnaire follows (Section 3).
function onSsSliderInput() {
  const pos = parseFloat(fSsScore.value) || 0;
  if (pos < 0)      { modalSelfishScore = -pos; modalSelflessScore = 0; }
  else if (pos > 0) { modalSelflessScore = pos;  modalSelfishScore = 0; }
  else              { modalSelfishScore = 0;     modalSelflessScore = 0; }
  // Dragging the raw slider bypasses the Questionnaire, so whatever
  // checklist/ally breakdown was on file no longer matches this score —
  // drop it rather than show a stale "why" for a number nobody derived.
  modalSelfSkillIds = [];
  modalAllySupport  = [];
  updateSelfishSelflessDisplay();
}

// Ghost/alt-stat equivalent of updateSelfishSelflessDisplay/onSsSliderInput
// above — same "one continuous scale" mechanic, just against the
// modalAltSelfishScore/modalAltSelflessScore pair and the alt-ss- prefixed
// DOM ids (see the alt-stats-inputs markup in index.html).
function updateAltSelfishSelflessDisplay() {
  const pos = heroSelfishSelflessPosition({ selfishScore: modalAltSelfishScore, selflessScore: modalAltSelflessScore });
  const fAltSsScore = document.getElementById("f-alt-ss-score");
  fAltSsScore.value = pos;

  const fill = document.getElementById("alt-ss-slider-fill");
  const pct  = Math.abs(pos) / 10 * 50;
  if (pos < 0) {
    fill.style.left  = (50 - pct) + "%";
    fill.style.right = "50%";
    fill.style.background = "#ef9a9a";
  } else if (pos > 0) {
    fill.style.left  = "50%";
    fill.style.right = (50 - pct) + "%";
    fill.style.background = "#81c784";
  } else {
    fill.style.left = "50%";
    fill.style.right = "50%";
  }

  const readout = document.getElementById("alt-ss-slider-readout");
  if (pos === 0) readout.textContent = "Neutral";
  else if (pos < 0) readout.textContent = `Selfish ${(-pos).toFixed(1)}`;
  else readout.textContent = `Selfless ${pos.toFixed(1)}`;
}

function onAltSsSliderInput() {
  const pos = parseFloat(document.getElementById("f-alt-ss-score").value) || 0;
  if (pos < 0)      { modalAltSelfishScore = -pos; modalAltSelflessScore = 0; }
  else if (pos > 0) { modalAltSelflessScore = pos;  modalAltSelfishScore = 0; }
  else              { modalAltSelfishScore = 0;     modalAltSelflessScore = 0; }
  // Same reasoning as onSsSliderInput above — manual drag invalidates
  // whatever Questionnaire breakdown was on file for the ghost stats.
  modalAltSelfSkillIds = [];
  modalAltAllySupport  = [];
  updateAltSelfishSelflessDisplay();
}

/* ── Questionnaire modal state ──
   Local to the modal's own lifecycle, reset every time it opens.
   ssTarget picks which pair of modal vars/display fn get the result —
   "main" (default) or "alt" (Ghost Questionnaire trigger). */
let ssPhase        = "choose"; // "choose" | "selfish" | "selfless"
let ssAllyCount    = 0;
let ssTarget       = "main";

function openQuestionnaireModal(target) {
  ssTarget = target || "main";
  ssPhase = "choose";
  ssAllyCount = 0;
  document.getElementById("ss-step-choose").style.display   = "block";
  document.getElementById("ss-step-selfish").style.display  = "none";
  document.getElementById("ss-step-selfless").style.display = "none";
  document.getElementById("ss-modal-confirm").style.display = "none";
  document.getElementById("ss-modal-back").style.display    = "none";
  document.getElementById("ss-modal-overlay").classList.add("open");
}

function closeQuestionnaireModal() {
  document.getElementById("ss-modal-overlay").classList.remove("open");
}

function ssChooseSide(side) {
  ssPhase = side;
  document.getElementById("ss-step-choose").style.display = "none";
  document.getElementById("ss-modal-confirm").style.display = "inline-flex";
  document.getElementById("ss-modal-back").style.display    = "inline-flex";

  if (side === "selfish") {
    document.getElementById("ss-step-selfish").style.display  = "block";
    document.getElementById("ss-step-selfless").style.display = "none";
    renderSsSelfishChecklist();
  } else {
    document.getElementById("ss-step-selfish").style.display  = "none";
    document.getElementById("ss-step-selfless").style.display = "block";
    // Re-opening an already-Selfless hero picks up where its saved
    // ally breakdown left off, instead of starting blank every time.
    const priorAllies = (ssTarget === "alt" ? modalAltAllySupport : modalAllySupport) || [];
    ssAllyCount = priorAllies.length;
    renderSsAllyCountButtons();
    renderSsAllyRows(priorAllies);
    updateSsSelflessPreview();
  }
}

function ssBackToChoose() {
  openQuestionnaireModal(ssTarget);
}

function renderSsSelfishChecklist() {
  const box = document.getElementById("ss-selfish-checklist");
  // Re-opening an already-Selfish hero comes back ticked the way it was
  // saved, instead of starting blank every time.
  const priorChecked = new Set((ssTarget === "alt" ? modalAltSelfSkillIds : modalSelfSkillIds) || []);
  // Alphabetical by label for display only — SELF_SKILLS itself stays in
  // its original order since computeSelfishScore/other lookups above key
  // off `id`, not array position, so this can't affect scoring.
  const sortedSkills = [...SELF_SKILLS].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  box.innerHTML = sortedSkills.map(s => `
    <label class="ss-check-item">
      <input type="checkbox" class="ss-selfish-check" value="${s.id}" ${priorChecked.has(s.id) ? "checked" : ""} />
      ${s.label}
    </label>
  `).join("");
  box.querySelectorAll(".ss-selfish-check").forEach(cb =>
    cb.addEventListener("change", updateSsSelfishPreview)
  );
  updateSsSelfishPreview();
}

function updateSsSelfishPreview() {
  const checked = Array.from(document.querySelectorAll(".ss-selfish-check:checked")).map(cb => cb.value);
  const score = computeSelfishScore(checked);
  document.getElementById("ss-selfish-preview").textContent = `Score: ${score} / 10`;
}

function renderSsAllyCountButtons() {
  document.querySelectorAll("#ss-ally-count .ss-count-btn").forEach(btn => {
    btn.classList.toggle("active", Number(btn.dataset.count) === ssAllyCount);
  });
}

function ssSetAllyCount(count) {
  ssAllyCount = Math.max(0, Math.min(4, count));
  renderSsAllyCountButtons();
  renderSsAllyRows();
  updateSsSelflessPreview();
}

// One ally row's markup: Healing and Passive are 0-100% sliders (dmg
// reduction, evasion, etc. all read as "how much"), Buff is a 0-10
// count of distinct buffs granted (buffs are discrete, not a %). Each
// slider is paired with a live numeric input (not just a read-only
// readout) so an exact value can be typed directly instead of only
// dragging the slider to it.
function ssAllyTypeRowHTML(type, label, max, unit) {
  return `
    <div class="ss-ally-type-row">
      <label class="ss-ally-type-label">${label}</label>
      <input type="range" class="ss-ally-range" data-type="${type}" min="0" max="${max}" step="1" value="0" />
      <input type="number" class="ss-ally-type-input" data-type-input="${type}" min="0" max="${max}" step="1" value="0" inputmode="numeric" />
      <span class="ss-ally-type-unit">${unit}</span>
    </div>`;
}

function renderSsAllyRows(prefill) {
  const box = document.getElementById("ss-ally-rows");
  const rows = [];
  for (let i = 1; i <= ssAllyCount; i++) {
    rows.push(`
      <div class="ss-ally-row" data-ally="${i}">
        <div class="ss-ally-row-label">Ally ${i}</div>
        <div class="ss-ally-row-types">
          ${ssAllyTypeRowHTML("healing", "Healing", 100, "%")}
          ${ssAllyTypeRowHTML("passive", "Passive", 100, "%")}
          ${ssAllyTypeRowHTML("buff", "Buffs", 10, "")}
        </div>
      </div>
    `);
  }
  box.innerHTML = rows.join("");
  // "Copy Ally 1 to all below" — only useful with 2+ allies on screen.
  // Rendered here (not static markup) so it only appears/disappears as
  // ssAllyCount changes, same lifecycle as the rows themselves. Placed
  // at the very top of the ally rows (right below the 0-4 ally-count
  // buttons above) rather than after the rows, since it's an action
  // you reach for before filling anything in below it.
  const copyBtnHTML = ssAllyCount > 1
    ? `<button type="button" class="btn btn-ghost btn-sm" id="ss-ally-copy-first">⧉ Copy Ally 1 to All Below</button>`
    : "";
  box.insertAdjacentHTML("afterbegin", copyBtnHTML);
  const copyBtn = document.getElementById("ss-ally-copy-first");
  if (copyBtn) copyBtn.addEventListener("click", ssCopyFirstAllyToRest);

  // Restore any prior values for this ally slot (see the ssChooseSide
  // call site — keeps re-opening the Questionnaire non-destructive).
  box.querySelectorAll(".ss-ally-row").forEach(row => {
    const idx = Number(row.dataset.ally) - 1;
    const prior = prefill && prefill[idx];
    if (!prior) return;
    ["healing", "passive", "buff"].forEach(type => {
      const key = type === "buff" ? "buffCount" : type;
      const val = Number(prior[key]) || 0;
      const range = row.querySelector(`[data-type="${type}"]`);
      const input = row.querySelector(`[data-type-input="${type}"]`);
      range.value = val;
      input.value = val;
    });
  });
  ssWireAllyRowInputs(box);
}

// Wires the range↔number-input pairs for every ally row currently in
// the DOM — dragging the slider updates the number, typing a number
// (clamped to the same 0-max) updates the slider, and either one
// updating refreshes the live Selfless score preview.
function ssWireAllyRowInputs(box) {
  box.querySelectorAll(".ss-ally-range").forEach(range => {
    const row = range.closest(".ss-ally-row");
    const input = row.querySelector(`[data-type-input="${range.dataset.type}"]`);
    range.addEventListener("input", () => {
      input.value = range.value;
      updateSsSelflessPreview();
    });
    input.addEventListener("input", () => {
      const max = Number(input.max) || 0;
      let val = input.value === "" ? "" : Math.max(0, Math.min(max, Math.round(Number(input.value) || 0)));
      range.value = val === "" ? 0 : val;
      updateSsSelflessPreview();
    });
    // On blur, snap a blank/out-of-range typed value back to something
    // concrete so it doesn't linger empty or silently past its max.
    input.addEventListener("blur", () => {
      const max = Number(input.max) || 0;
      input.value = Math.max(0, Math.min(max, Math.round(Number(input.value) || 0)));
      range.value = input.value;
    });
  });
}

// Copies Ally 1's Healing/Passive/Buff values down to every other ally
// row currently rendered, however many that is — Ally 2, 3, 4, etc.
function ssCopyFirstAllyToRest() {
  const firstRow = document.querySelector('#ss-ally-rows .ss-ally-row[data-ally="1"]');
  if (!firstRow) return;
  const values = {};
  firstRow.querySelectorAll("[data-type-input]").forEach(input => {
    values[input.dataset.typeInput] = input.value;
  });
  document.querySelectorAll('#ss-ally-rows .ss-ally-row').forEach(row => {
    if (row.dataset.ally === "1") return;
    Object.entries(values).forEach(([type, val]) => {
      const range = row.querySelector(`[data-type="${type}"]`);
      const input = row.querySelector(`[data-type-input="${type}"]`);
      if (range) range.value = val;
      if (input) input.value = val;
    });
  });
  updateSsSelflessPreview();
}

function ssCollectSupportedAllies() {
  return Array.from(document.querySelectorAll("#ss-ally-rows .ss-ally-row")).map(row => ({
    healing:   Number(row.querySelector('[data-type-input="healing"]').value) || 0,
    passive:   Number(row.querySelector('[data-type-input="passive"]').value) || 0,
    buffCount: Number(row.querySelector('[data-type-input="buff"]').value) || 0,
  }));
}

function updateSsSelflessPreview() {
  const score = computeSelflessScore(ssCollectSupportedAllies());
  document.getElementById("ss-selfless-preview").textContent = `Score: ${score}`;
}

// Writes the computed score into the edit modal's local state (not
// the hero itself — see modalSelfishScore/modalSelflessScore above)
// and updates the slider live, per Section 4's Definition of Done.
function confirmQuestionnaire() {
  const isAlt = ssTarget === "alt";
  if (ssPhase === "selfish") {
    const checked = Array.from(document.querySelectorAll(".ss-selfish-check:checked")).map(cb => cb.value);
    const score = computeSelfishScore(checked);
    if (isAlt) { modalAltSelfishScore = score; modalAltSelflessScore = 0; modalAltSelfSkillIds = checked; modalAltAllySupport = []; }
    else       { modalSelfishScore = score;    modalSelflessScore = 0;    modalSelfSkillIds = checked;    modalAllySupport = []; }
  } else if (ssPhase === "selfless") {
    const allies = ssCollectSupportedAllies();
    const score = computeSelflessScore(allies);
    if (isAlt) { modalAltSelflessScore = score; modalAltSelfishScore = 0; modalAltAllySupport = allies; modalAltSelfSkillIds = []; }
    else       { modalSelflessScore = score;    modalSelfishScore = 0;    modalAllySupport = allies;    modalSelfSkillIds = []; }
  }
  if (isAlt) updateAltSelfishSelflessDisplay();
  else       updateSelfishSelflessDisplay();
  closeQuestionnaireModal();
}

/* ═══════════════════════════════════════
   REACTION / ENGAGEMENT ASSIGNMENT
   (Rebuild Spec Section 5.3)

   Lives inside the hero edit modal. Reads/writes modalReactions /
   modalEngagements (declared alongside modalSelfishScore above) — never
   free text, always a { refId } pointing into the shared taxonomy
   library managed by the Section 5.1/5.2 Taxonomy Manager further down
   this file. The score/value itself is fixed on the taxonomy item, not
   set here — this UI only links/unlinks the hero to it and displays
   whatever value the library currently has. Removing an assignment here
   only drops this hero's link; it never touches the library item itself.
═══════════════════════════════════════ */

// Re-renders the assigned lists, "add" dropdowns, and live Reaction/
// Engage score badges for the main build; for the ghost ("alt") build
// it only refreshes the score badges, since Ghost no longer has its
// own assigned list to show — it shares the main build's exactly (see
// rteModalArray below), so its badges are just a mirror of main's.
// target: "main" (default, primary hero) or "alt" (ghost build).
function renderRteSection(target) {
  target = target || "main";
  if (target === "alt") {
    updateRteScoreBadges("alt");
    return;
  }
  renderRteAssignedList("reactions", target);
  renderRteAssignedList("engagements", target);
  renderRteAddSearch("reactions", target);
  renderRteAddSearch("engagements", target);
  updateRteScoreBadges(target);
  // Ghost mirrors main's Reactions/Engagements exactly now, so any
  // change made here needs to refresh Ghost's (identical) score
  // badges too, even though nothing else in its section needs to
  // re-render — otherwise Ghost's badges would go stale the moment
  // main's list changes, even though the underlying data is the same.
  updateRteScoreBadges("alt");
}

function rteIdPrefix(target) { return target === "alt" ? "alt-rte-" : "rte-"; }

function rteListEl(kind, target) {
  return document.getElementById(rteIdPrefix(target) + (kind === "reactions" ? "reactions-list" : "engagements-list"));
}
// Ghost no longer keeps its own Reactions/Engagements — both targets
// read/write the same (main) list now; only Selfish/Selfless stays
// independent per build. `target` stays a parameter so callers (like
// updateRteScoreBadges, still used for Ghost's now-mirrored badges)
// don't need special-casing.
function rteModalArray(kind, target) {
  return kind === "reactions" ? modalReactions : modalEngagements;
}
function setRteModalArray(kind, target, newArr) {
  if (kind === "reactions") modalReactions = newArr; else modalEngagements = newArr;
}

// Each row shows the item's name and its fixed value (read-only badge —
// see the taxonomy-panel value input further down for the only place
// that value can actually be changed), plus a remove button.
function renderRteAssignedList(kind, target) {
  const list = rteModalArray(kind, target);
  const box = rteListEl(kind, target);
  if (!list.length) {
    box.innerHTML = `<div class="rte-empty-note">No ${kind} assigned yet.</div>`;
    return;
  }
  box.innerHTML = list.map(item => {
    const refId = item?.refId ?? item;
    const value = taxonomyValue(kind, refId);
    return `
    <div class="rte-assigned-row" data-ref-id="${refId}">
      <span class="rte-assigned-name">${taxonomyName(kind, refId)}</span>
      <span class="rte-assigned-value" title="Fixed value — set in 🗂 Taxonomy">${value.toFixed(1)}</span>
      <button type="button" class="rte-assigned-remove" data-kind="${kind}" data-ref-id="${refId}" data-target="${target}" title="Remove — does not delete the ${kind === "reactions" ? "Reaction" : "Engagement"} from the library">✕</button>
    </div>`;
  }).join("");
  box.querySelectorAll(".rte-assigned-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      removeRteItem(btn.dataset.kind, Number(btn.dataset.refId), btn.dataset.target);
    });
  });
}

// Search-to-add for Reactions/Engagements — same reasoning as the Factor
// search under a Taxonomy row (renderTaxonomyFactorChips): dumping the
// whole library into a dropdown/chip list gets unusable as it grows, so
// typing narrows it down instead. Session-only search text, keyed by
// kind+target so main/ghost and Reactions/Engagements don't collide.
let rteAddSearchQuery = {};

// The other kind — Reactions look across at Engagements and vice versa.
function otherRteKind(kind) { return kind === "reactions" ? "engagements" : "reactions"; }

function renderRteAddSearch(kind, target) {
  const prefix = rteIdPrefix(target);
  const inputId   = kind === "reactions" ? prefix + "add-reaction-search"  : prefix + "add-engagement-search";
  const resultsId = kind === "reactions" ? prefix + "add-reaction-results" : prefix + "add-engagement-results";
  const input = document.getElementById(inputId);
  const resultsBox = document.getElementById(resultsId);
  if (!input || !resultsBox) return;

  const key = `${kind}-${target}`;
  const label = kind === "reactions" ? "Reaction" : "Engagement";
  const otherKind = otherRteKind(kind);
  const otherLabel = otherKind === "reactions" ? "Reaction" : "Engagement";

  // Cross-kind hint: while searching Reactions, also check whether the
  // typed text matches anything over in the Engagements library (and
  // vice versa) — so mis-guessing which list something lives in doesn't
  // mean re-typing the same search a second time in the other box.
  // Clicking a hint chip adds that item under its own kind (if it isn't
  // already assigned) and jumps straight to it there.
  const crossHintHTML = (q) => {
    if (!q) return "";
    const otherAssignedIds = new Set(rteModalArray(otherKind, target).map(x => x?.refId ?? x));
    const crossMatches = taxonomy[otherKind].filter(item => item.name.toLowerCase().includes(q)).slice(0, 5);
    if (!crossMatches.length) return "";
    return `
      <div class="rte-cross-hint">
        <span class="rte-cross-hint-label">↔ Also found in ${otherLabel}s:</span>
        ${crossMatches.map(item => {
          const already = otherAssignedIds.has(item.id);
          return `<button type="button" class="rte-cross-chip${already ? " rte-cross-chip-assigned" : ""}" data-kind="${otherKind}" data-ref-id="${item.id}" title="${already ? `Already assigned — jump to it in ${otherLabel}s` : `Add to ${otherLabel}s and jump to it`}">${already ? "→" : "+"} ${escAttr(item.name)} (${item.value.toFixed(1)})</button>`;
        }).join("")}
      </div>`;
  };

  const wireCrossHintChips = () => {
    resultsBox.querySelectorAll(".rte-cross-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const crossKind = chip.dataset.kind;
        const refId = Number(chip.dataset.refId);
        const alreadyAssigned = rteModalArray(crossKind, target).some(x => (x?.refId ?? x) === refId);
        if (!alreadyAssigned) {
          setRteModalArray(crossKind, target, [...rteModalArray(crossKind, target), { refId }]);
        }
        rteAddSearchQuery[key] = ""; // clear this search now that it's been handled
        renderRteSection(target);
        rteJumpToAssigned(crossKind, refId, target);
      });
    });
  };

  const renderResults = () => {
    const q = (rteAddSearchQuery[key] || "").trim().toLowerCase();
    const assignedIds = new Set(rteModalArray(kind, target).map(x => x?.refId ?? x));
    const candidates = taxonomy[kind].filter(item => !assignedIds.has(item.id) && (!q || item.name.toLowerCase().includes(q)));
    if (!q) {
      resultsBox.innerHTML = candidates.length
        ? `<div class="rte-empty-note">Type to search ${candidates.length} available ${label}${candidates.length === 1 ? "" : "s"}…</div>`
        : `<div class="rte-empty-note">Every ${label} is already assigned.</div>`;
      return;
    }
    const ownResultsHTML = candidates.length
      ? candidates.map(item => `<button type="button" class="taxonomy-factor-chip" data-ref-id="${item.id}">+ ${escAttr(item.name)} (${item.value.toFixed(1)})</button>`).join("")
      : `<div class="rte-empty-note">No matching ${label}s.</div>`;
    resultsBox.innerHTML = ownResultsHTML + crossHintHTML(q);
    resultsBox.querySelectorAll(".taxonomy-factor-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const refId = Number(chip.dataset.refId);
        setRteModalArray(kind, target, [...rteModalArray(kind, target), { refId }]);
        rteAddSearchQuery[key] = ""; // clear after a successful add
        renderRteSection(target);
      });
    });
    wireCrossHintChips();
  };

  // The input itself is static markup (see index.html), not rebuilt on
  // every render — wire its listeners once, then just refresh results.
  if (!input.dataset.wired) {
    input.dataset.wired = "1";
    input.addEventListener("input", () => {
      rteAddSearchQuery[key] = input.value;
      renderResults();
    });
    input.addEventListener("keydown", e => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const first = resultsBox.querySelector(".taxonomy-factor-chip");
      if (first) first.click(); // Enter adds the top match
    });
  }

  const query = rteAddSearchQuery[key] || "";
  input.value = query;
  renderResults();
  if (query) input.focus({ preventScroll: true }); // restore focus/cursor after a re-render
}

// Scrolls the given Reaction/Engagement's assigned row into view and
// flashes it, so clicking a cross-kind hint chip (or any other "jump
// to it" action) actually lands the eye on the right row instead of
// just silently adding it somewhere off-screen. Called right after a
// render, so the row already exists in the DOM.
function rteJumpToAssigned(kind, refId, target) {
  const list = rteListEl(kind, target);
  const row = list?.querySelector(`.rte-assigned-row[data-ref-id="${refId}"]`);
  if (!row) return;
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.add("rte-jump-highlight");
  setTimeout(() => row.classList.remove("rte-jump-highlight"), 1500);
}

function removeRteItem(kind, refId, target) {
  setRteModalArray(kind, target, rteModalArray(kind, target).filter(x => (x?.refId ?? x) !== refId));
  renderRteSection(target);
}

// Live preview of the derived Reaction/Engage Score (Section 1.2) —
// computed off whatever's currently linked in the modal (against each
// item's fixed taxonomy value), not yet saved.
function updateRteScoreBadges(target) {
  target = target || "main";
  const prefix = rteIdPrefix(target);
  const reactionScore = computeReactionScore({ reactions: rteModalArray("reactions", target) });
  const engageScore   = computeEngageScore({ engagements: rteModalArray("engagements", target) });
  document.getElementById(prefix + "reaction-score-badge").textContent =
    `Reaction Score: ${reactionScore === null ? "—" : reactionScore}`;
  document.getElementById(prefix + "engage-score-badge").textContent =
    `Engage Score: ${engageScore === null ? "—" : engageScore}`;
}

/* ═══════════════════════════════════════
   REACTION / ENGAGEMENT / FACTOR TAXONOMY MANAGER
   (Rebuild Spec Section 5.1 / 5.2)

   Admin-side screen for managing the shared library from Section 1.1 —
   fully separate from any individual hero's edit screen. Reactions and
   Engagements are managed identically (create/rename/delete/tag), just
   against different taxonomy[kind] arrays, so one set of render/handler
   functions below takes a `kind` argument for both. Factors get their
   own simpler panel since factor tagging happens from the Reaction/
   Engagement side, not here (Section 5.2).
═══════════════════════════════════════ */

let taxonomyActiveTab = "reactions"; // "reactions" | "engagements" | "factors"
// Search query per tab — kept independently so switching tabs doesn't
// clear what you'd typed in another one.
let taxonomySearchQuery = { reactions: "", engagements: "", factors: "" };

// Applies the current tab's sort mode (taxonomySortMode, declared up
// near the top of this file — see the comment there for why) to an
// already-search-filtered list, without mutating it. Sorting by id
// rather than array position means it stays accurate even for an item
// that just moved from Reactions to Engagements (or back) via
// convertTaxonomyItemKind — its id (and so its place in an
// oldest/newest ordering) never changes.
function applyTaxonomySort(kind, items) {
  const mode = taxonomySortMode[kind] || "oldest";
  const sorted = [...items];
  let cmp;
  if (mode === "az") cmp = (a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
  else if (mode === "za") cmp = (a, b) => (b.name || "").localeCompare(a.name || "", undefined, { sensitivity: "base" });
  else if (mode === "newest") cmp = (a, b) => b.id - a.id;
  // Score sort — only meaningful for Reactions/Engagements (Factors
  // carry no `value`, so both items sort equal and the pinned/id order
  // below decides ties). Ties within the same score fall back to
  // oldest-first so re-sorting doesn't visually shuffle equal-score
  // rows every render.
  else if (mode === "score-desc") cmp = (a, b) => (Number(b.value) || 0) - (Number(a.value) || 0) || a.id - b.id;
  else if (mode === "score-asc") cmp = (a, b) => (Number(a.value) || 0) - (Number(b.value) || 0) || a.id - b.id;
  else cmp = (a, b) => a.id - b.id; // "oldest" (default)
  // Pinned items always float to the top, ahead of the chosen sort
  // mode — the mode still governs ordering *within* the pinned group
  // and within the unpinned group.
  sorted.sort((a, b) => {
    const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    return pinDiff !== 0 ? pinDiff : cmp(a, b);
  });
  return sorted;
}

// Per-row search text for the Factor-tagging search box under a Reaction/
// Engagement row (keyed by "kind-id"), session-only like the tab search
// above. Kept separate so typing in one row's search doesn't touch another.
let taxonomyFactorRowSearch = {};

// Same idea, one level up: per-row search text for the "Add to Hero"
// quick-assign search under a Reaction/Engagement row (Section 5.3),
// keyed by "kind-id" so each row's typing stays independent.
let taxonomyHeroRowSearch = {};

// Taxonomy names are free text; a stray double-quote would otherwise
// break the `value="..."` attribute of the rename inputs below.
function escAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;");
}

/* ── Rename modal ──
   Reactions/Engagements/Factors show their name as wrapped, read-only
   text now (not an input) so the full name is always visible instead
   of being squeezed into a tiny box — this modal is where the actual
   editing happens instead, via the row's ✏️ button. Reuses the app's
   existing .overlay/.modal shell (same one Admin/Details/etc. use) for
   visual consistency rather than introducing a bespoke dialog style. */
function taxonomyKindLabel(kind) {
  return kind === "reactions" ? "Reaction" : kind === "engagements" ? "Engagement" : "Factor";
}

let renameModalTarget = null; // { kind, id, mode: "rename"|"duplicate" } while open, else null

// Ranking Category quick-fill under the rename modal's name field —
// Reactions/Engagements only (Factors have no category concept). See
// renderCategoryQuickfillRow above.
function renderRenameModalCategoryChips(kind) {
  const box = document.getElementById("rename-modal-category-chips");
  if (!box) return;
  const input = document.getElementById("rename-modal-input");
  if ((kind === "reactions" || kind === "engagements") && input) {
    renderCategoryQuickfillRow(box, input);
  } else {
    box.innerHTML = "";
    box.style.display = "none";
  }
}

function openRenameModal(kind, id, currentName) {
  renameModalTarget = { kind, id, mode: "rename" };
  document.getElementById("rename-modal-title").textContent = `Rename ${taxonomyKindLabel(kind)}`;
  document.getElementById("rename-modal-save").textContent = "Save";
  const input = document.getElementById("rename-modal-input");
  input.value = currentName || "";
  hideRenameModalSuggestions();
  renderRenameModalCategoryChips(kind);
  document.getElementById("rename-modal-overlay").classList.add("open");
  input.focus();
  input.select();
}

// Opens the same modal in "duplicate" mode — pre-fills "<name> (copy)"
// as a starting point for the new name rather than reusing the
// original name outright, since Taxonomy names are otherwise free to
// collide but a fresh duplicate having the exact same name as its
// source would be confusing to pick apart in the list right away.
function openDuplicateModal(kind, id, currentName) {
  renameModalTarget = { kind, id, mode: "duplicate" };
  document.getElementById("rename-modal-title").textContent = `Duplicate ${taxonomyKindLabel(kind)} As…`;
  document.getElementById("rename-modal-save").textContent = "Duplicate";
  const input = document.getElementById("rename-modal-input");
  input.value = currentName ? `${currentName} (copy)` : "";
  hideRenameModalSuggestions();
  renderRenameModalCategoryChips(kind);
  document.getElementById("rename-modal-overlay").classList.add("open");
  input.focus();
  input.select();
}

function closeRenameModal() {
  document.getElementById("rename-modal-overlay").classList.remove("open");
  document.getElementById("rename-modal-save").textContent = "Save";
  renameModalTarget = null;
  hideRenameModalSuggestions();
}

function hideRenameModalSuggestions() {
  const box = document.getElementById("rename-modal-suggest");
  if (!box) return;
  box.style.display = "none";
  box.innerHTML = "";
}

// Live "does something like this already exist?" dropdown under the
// rename modal's text box — only for Reactions/Engagements (Factors
// have their own separate naming space, so cross-checking against them
// wouldn't mean anything). Matches against BOTH lists together
// regardless of which one is currently being renamed, since the whole
// point is catching an accidental near-duplicate before it's saved,
// not just duplicates within the same list. Excludes the item
// currently being renamed (renaming something to its own existing name
// isn't a "duplicate" worth flagging).
function renderRenameModalSuggestions() {
  const box = document.getElementById("rename-modal-suggest");
  const input = document.getElementById("rename-modal-input");
  if (!box || !input || !renameModalTarget) return;

  const { kind, id, mode } = renameModalTarget;
  if (kind !== "reactions" && kind !== "engagements") { hideRenameModalSuggestions(); return; }

  const q = input.value.trim().toLowerCase();
  if (!q) { hideRenameModalSuggestions(); return; }

  const candidates = [
    ...taxonomy.reactions.map(item => ({ kind: "reactions", item })),
    ...taxonomy.engagements.map(item => ({ kind: "engagements", item })),
  ].filter(({ kind: k, item }) => {
    if (mode === "rename" && k === kind && item.id === id) return false; // don't suggest itself
    return (item.name || "").toLowerCase().includes(q);
  });

  if (!candidates.length) { hideRenameModalSuggestions(); return; }

  // Names starting with what's typed float above ones that merely
  // contain it somewhere in the middle, then alphabetical; capped at 8
  // so this can never grow into its own scrollable wall of text.
  candidates.sort((a, b) => {
    const an = (a.item.name || "").toLowerCase(), bn = (b.item.name || "").toLowerCase();
    const aStarts = an.startsWith(q) ? 0 : 1, bStarts = bn.startsWith(q) ? 0 : 1;
    return aStarts - bStarts || an.localeCompare(bn);
  });

  box.innerHTML = candidates.slice(0, 8).map(({ kind: k, item }) => {
    const icon = k === "reactions" ? "⚡" : "🛡";
    return `
      <div class="rename-modal-suggest-item" data-name="${escAttr(item.name || "")}">
        <span class="rename-modal-suggest-item-icon">${icon}</span>
        <span class="rename-modal-suggest-item-name">${item.name || "(unnamed)"}</span>
        <span class="rename-modal-suggest-item-score">${item.value.toFixed(1)}</span>
      </div>
    `;
  }).join("");

  // mousedown (not click) fires before the input's blur, and
  // preventDefault on it stops that blur from happening at all — so
  // picking a suggestion fills the box without the dropdown flickering
  // closed-then-reopened, and focus stays put for further editing.
  box.querySelectorAll(".rename-modal-suggest-item").forEach(row => {
    row.addEventListener("mousedown", e => {
      e.preventDefault();
      input.value = row.dataset.name;
      hideRenameModalSuggestions();
      input.focus();
    });
  });

  box.style.display = "block";
}

function saveRenameModal() {
  if (!renameModalTarget) return;
  const { kind, id, mode } = renameModalTarget;
  const newName = document.getElementById("rename-modal-input").value;
  // A duplicate with a blank name would be indistinguishable from any
  // other unnamed item in the list — require actual text for that case
  // only; plain rename keeps its existing (unnamed)-allowed behavior.
  if (mode === "duplicate" && !String(newName || "").trim()) return;

  if (mode === "duplicate") {
    if (kind === "factors") {
      duplicateFactor(id, newName);
      renderFactorsPanel();
      renderQdFactorChips();
      if (typeof renderHeroFactorsButton === "function") renderHeroFactorsButton(); // keep Hero Factors' button/grid in sync with the Enemy Factors state it reads
    } else {
      const copy = duplicateTaxonomyItem(kind, id, newName);
      renderTaxonomyPanel(kind);
      // Jump straight to the new copy — it lands at the end of the
      // array (see duplicateTaxonomyItem), so without this it's just
      // silently added wherever the current sort/pin order puts it,
      // and finding it means scrolling/hunting for the new name.
      if (copy) taxonomyJumpToRow(kind, copy.id);
    }
  } else {
    if (kind === "factors") {
      renameFactor(id, newName);
      renderFactorsPanel();
      renderQdFactorChips(); // Factor names show in the Quick Draft dropdown too
      if (typeof renderHeroFactorsButton === "function") renderHeroFactorsButton(); // keep Hero Factors' button/grid in sync with the Enemy Factors state it reads
    } else {
      renameTaxonomyItem(kind, id, newName);
      renderTaxonomyPanel(kind);
    }
  }
  renderRteSection(); // reflects the change immediately if the hero modal is open behind this one
  if (kind !== "factors" && taxonomyRankingOverlayIsOpen()) renderTaxonomyRankingPanel(); // the Ranking overlay can be open behind this modal too
  closeRenameModal();
}

function openTaxonomyManager() {
  switchTaxonomyTab(taxonomyActiveTab);
  document.getElementById("taxonomy-overlay").classList.add("open");
}

function closeTaxonomyManager() {
  document.getElementById("taxonomy-overlay").classList.remove("open");
}

function switchTaxonomyTab(tab) {
  taxonomyActiveTab = tab;
  document.querySelectorAll(".taxonomy-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  document.getElementById("taxonomy-panel-reactions").style.display   = tab === "reactions"   ? "block" : "none";
  document.getElementById("taxonomy-panel-engagements").style.display = tab === "engagements" ? "block" : "none";
  document.getElementById("taxonomy-panel-factors").style.display     = tab === "factors"     ? "block" : "none";
  // Scroll the (now-visible) panel's own scroll container back to the
  // top — otherwise switching tabs can land you mid-scroll on the new
  // list if the previous tab was scrolled down.
  const body = document.querySelector(".taxonomy-modal .taxonomy-body");
  if (body) body.scrollTop = 0;
  if (tab === "factors") renderFactorsPanel();
  else renderTaxonomyPanel(tab);
}

// Performance Ranking System — a fullscreen overlay (not a tab; see
// .qd-factor-menu-overlay/-panel, shared with the Enemy Factors picker
// and Know More explainer), opened via the "📊 Ranking" button next to
// the Taxonomy modal's own title.
function openTaxonomyRankingOverlay() {
  const overlay = document.getElementById("taxonomy-ranking-overlay");
  if (!overlay) return;
  renderTaxonomyRankingPanel();
  overlay.style.display = "flex";
  document.body.classList.add("qd-factor-menu-open");
}
function closeTaxonomyRankingOverlay() {
  const overlay = document.getElementById("taxonomy-ranking-overlay");
  if (!overlay) return;
  overlay.style.display = "none";
  document.body.classList.remove("qd-factor-menu-open");
  // Select mode is a temporary "working on scores right now" state, not
  // something worth remembering between visits — start clean next time.
  taxonomyRankingSelectMode = false;
  taxonomyRankingSelected.clear();
  document.getElementById("taxonomy-ranking-select-toggle")?.classList.remove("active");
}
function taxonomyRankingOverlayIsOpen() {
  const overlay = document.getElementById("taxonomy-ranking-overlay");
  return !!overlay && overlay.style.display !== "none";
}

// Which Taxonomy kind's list a given tab's search box cross-checks —
// Reactions search surfaces Engagements matches and vice versa. Factors
// have no counterpart (same reasoning as renderRenameModalSuggestions
// below) so they're simply absent from this map.
const TAXONOMY_CROSS_KIND = { reactions: "engagements", engagements: "reactions" };

// Live "it's actually on the other tab" dropdown under a Reactions/
// Engagements search box — lets someone searching Reactions for
// something that's actually named on the Engagements tab (or vice
// versa) jump straight there instead of having to repeat the search by
// hand on the other tab. Matches ONLY the other kind's list — the
// current tab's own matches are already the list rendered below the
// search box, so mirroring them here too would just be noise.
function renderTaxonomyCrossSuggest(kind) {
  const otherKind = TAXONOMY_CROSS_KIND[kind];
  if (!otherKind) return;
  const box = document.getElementById(`taxonomy-search-${kind}-suggest`);
  if (!box) return;

  const q = (taxonomySearchQuery[kind] || "").trim().toLowerCase();
  if (!q) { box.style.display = "none"; box.innerHTML = ""; return; }

  const matches = taxonomy[otherKind].filter(item => (item.name || "").toLowerCase().includes(q));
  if (!matches.length) { box.style.display = "none"; box.innerHTML = ""; return; }

  // Same "starts with" priority then alphabetical as the rename modal's
  // version, capped a bit tighter (6 vs 8) since this sits right above a
  // list that's already showing this tab's own matches underneath it.
  matches.sort((a, b) => {
    const an = (a.name || "").toLowerCase(), bn = (b.name || "").toLowerCase();
    const aStarts = an.startsWith(q) ? 0 : 1, bStarts = bn.startsWith(q) ? 0 : 1;
    return aStarts - bStarts || an.localeCompare(bn);
  });

  const otherLabel = otherKind === "reactions" ? "Reactions" : "Engagements";
  const icon = otherKind === "reactions" ? "⚡" : "🛡";
  box.innerHTML = matches.slice(0, 6).map(item => `
    <div class="rename-modal-suggest-item" data-kind="${otherKind}" data-id="${item.id}">
      <span class="rename-modal-suggest-item-icon">${icon}</span>
      <span class="rename-modal-suggest-item-name">${item.name || "(unnamed)"}</span>
      <span class="rename-modal-suggest-item-score">in ${otherLabel}</span>
    </div>
  `).join("");

  // mousedown (not click), same reasoning as renderRenameModalSuggestions
  // below — fires before the input's blur so the jump isn't cancelled by
  // the dropdown closing out from under the click.
  box.querySelectorAll(".rename-modal-suggest-item").forEach(row => {
    row.addEventListener("mousedown", e => {
      e.preventDefault();
      const targetKind = row.dataset.kind;
      const targetId = Number(row.dataset.id);
      hideTaxonomyCrossSuggest(kind);
      switchTaxonomyTab(targetKind);
      taxonomyJumpToRow(targetKind, targetId);
    });
  });

  box.style.display = "block";
}
function hideTaxonomyCrossSuggest(kind) {
  const box = document.getElementById(`taxonomy-search-${kind}-suggest`);
  if (!box) return;
  box.style.display = "none";
  box.innerHTML = "";
}

// Case-insensitive substring match against the current tab's search box.
function taxonomyMatchesSearch(kind, name) {
  const q = (taxonomySearchQuery[kind] || "").trim().toLowerCase();
  if (!q) return true;
  return (name || "").toLowerCase().includes(q);
}

// Scrolls a Reaction/Engagement's row into view in the Taxonomy Manager
// and flashes it — used right after duplicating one (see saveRenameModal)
// so the new copy is immediately visible instead of needing to be hunted
// down in whatever order/position it landed at. If the panel's current
// search text would hide the row (e.g. the copy was given a name that no
// longer matches an old filter), the filter is cleared first so "jump to
// it" can't land on nothing.
function taxonomyJumpToRow(kind, id) {
  const item = taxonomy[kind]?.find(x => x.id === id);
  if (!item) return;
  if (!taxonomyMatchesSearch(kind, item.name)) {
    taxonomySearchQuery[kind] = "";
    const input = document.getElementById(`taxonomy-search-${kind}`);
    if (input) input.value = "";
    const clearBtn = document.getElementById(`taxonomy-search-${kind}-clear`);
    if (clearBtn) clearBtn.style.display = "none";
    renderTaxonomyPanel(kind);
  }
  const box = document.getElementById(kind === "reactions" ? "taxonomy-list-reactions" : "taxonomy-list-engagements");
  const row = box?.querySelector(`.taxonomy-row[data-id="${id}"]`);
  if (!row) return;
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.add("rte-jump-highlight");
  setTimeout(() => row.classList.remove("rte-jump-highlight"), 1500);
}

let qdRankingSliderEl = null;
let qdRankingSliderRafId = null;

// Coalesces the slider's expensive downstream re-renders to at most one
// per animation frame instead of one per "input" event — see the call
// site in applyValue for why. If a frame is already queued, later calls
// before it fires are just dropped, since only the latest value matters.
function qdScheduleRankingSliderHeavyRefresh() {
  if (qdRankingSliderRafId !== null) return;
  qdRankingSliderRafId = requestAnimationFrame(() => {
    qdRankingSliderRafId = null;
    if (taxonomyRankingOverlayIsOpen()) renderTaxonomyRankingPanel();
    renderRteSection();
    if (quickDraftSuggestOpen) renderQuickDraftSuggestions();
    if (typeof hfRefreshIfOpen === "function") hfRefreshIfOpen(); // a changed score can shift Hero Factors' ranking too
  });
}

// The 0–10 score slider popup — shared by the Performance Ranking list
// AND the normal Reactions/Engagements tabs (via the 🎚 button next to
// each row's number input), so there's exactly one way this works
// everywhere. Reuses the same fullscreen overlay+panel shell as the
// Enemy Factors picker / Know More explainer (.qd-factor-menu-*) so it
// scales to any screen size the same way they do.
function ensureQdRankingSlider() {
  if (qdRankingSliderEl) return qdRankingSliderEl;

  const overlay = document.createElement("div");
  overlay.className = "qd-factor-menu-overlay";
  overlay.id = "qd-ranking-slider";
  overlay.style.display = "none";
  overlay.innerHTML = `
    <div class="qd-factor-menu-panel">
      <div class="qd-factor-menu-header">
        <div class="qd-factor-menu-title" id="qd-ranking-slider-title">Set Score</div>
        <div class="qd-ranking-slider-header-actions">
          <button type="button" class="qd-ranking-slider-lock-btn" id="qd-ranking-slider-lock-btn">${qdLockIconSvg(false)} Lock</button>
          <button type="button" class="qd-factor-menu-close" id="qd-ranking-slider-close" aria-label="Close">✕</button>
        </div>
      </div>
      <div class="qd-ranking-slider-body">
        <input type="number" id="qd-ranking-slider-value-input" class="qd-ranking-slider-value-input" min="0" max="10" step="0.1" inputmode="decimal" value="0" />
        <input type="range" id="qd-ranking-slider-input" min="0" max="10" step="0.1" value="0" />
        <div class="qd-ranking-slider-scale"><span>0</span><span>10</span></div>
        <div class="qd-ranking-slider-desc" id="qd-ranking-slider-desc"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  qdRankingSliderEl = overlay;

  const closeSlider = () => {
    overlay.style.display = "none";
    document.body.classList.remove("qd-factor-menu-open");
  };
  overlay.querySelector("#qd-ranking-slider-close").addEventListener("click", closeSlider);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeSlider(); });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && overlay.style.display !== "none") closeSlider();
  });

  return overlay;
}

// Opens the slider popup for one Reaction/Engagement, live-saving on
// every drag (same "no confirm step" philosophy as the rest of Quick
// Draft/Taxonomy) and refreshing every screen that reads this value —
// the number input back in its own tab, any hero's open edit screen,
// live Quick Draft suggestions, and the Performance Ranking list.
// Steps in full 0.1 increments (matching the number input's own
// precision) rather than whole numbers, but the Performance Ranking
// ladder descriptions only exist at whole numbers — see
// qdPerformanceLadderDescription — so the description line is simply
// left blank while sitting on a fractional value instead of showing a
// misleading "closest" description for a number the ladder never
// actually defined.
function qdShowRankingSlider(kind, id) {
  const overlay = ensureQdRankingSlider();
  const item = taxonomy[kind]?.find(x => x.id === id);
  if (!item) return;
  const label = kind === "reactions" ? "⚡ Reaction" : "🛡 Engagement";

  overlay.querySelector("#qd-ranking-slider-title").textContent = `${label} — ${item.name || "(unnamed)"}`;
  const input = overlay.querySelector("#qd-ranking-slider-input");
  const valueEl = overlay.querySelector("#qd-ranking-slider-value-input");
  const descEl = overlay.querySelector("#qd-ranking-slider-desc");
  const lockBtn = overlay.querySelector("#qd-ranking-slider-lock-btn");

  // Just repaints both controls + the description from a known-good
  // value — used on open and once typing is done (blur/Enter), never
  // mid-keystroke (see applyValue's keepTyping below).
  const renderDisplay = value => {
    input.value = value;
    valueEl.value = value.toFixed(1);
    descEl.textContent = Number.isInteger(value) ? qdPerformanceLadderDescription(value) : "";
  };
  const refreshLockUI = () => {
    const locked = !!taxonomy[kind]?.find(x => x.id === id)?.locked;
    input.disabled = locked;
    valueEl.disabled = locked;
    lockBtn.innerHTML = `${qdLockIconSvg(locked)} ${locked ? "Locked" : "Lock"}`;
    lockBtn.classList.toggle("locked", locked);
  };

  renderDisplay(item.value);
  refreshLockUI();

  // Applies a new value from either control, keeps the other control
  // (and every other view of this same number — its own tab, hero
  // screens, Quick Draft) in sync, and persists it immediately.
  // `keepTyping` skips overwriting the number input's own value so a
  // mid-edit cursor (e.g. typing "7." on the way to "7.5", or briefly
  // clearing the field) isn't clobbered on every keystroke — the range
  // slider and everything else still update live either way.
  const applyValue = (value, { keepTyping = false } = {}) => {
    const clamped = Math.max(0, Math.min(10, Number.isFinite(value) ? value : 0));
    input.value = clamped;
    if (!keepTyping) valueEl.value = clamped.toFixed(1);
    descEl.textContent = Number.isInteger(clamped) ? qdPerformanceLadderDescription(clamped) : "";
    setTaxonomyItemValue(kind, id, clamped); // no-ops while locked — both controls are also disabled above as the visible half of that
    const numberInput = document.getElementById(`taxonomy-value-${kind}-${id}`);
    if (numberInput) numberInput.value = clamped.toFixed(1);
    // The three calls below (Ranking list, hero edit screen, Quick Draft
    // suggestions) each rebuild a chunk of DOM from scratch, and Ranking
    // in particular re-walks every hero per row (heroesLinkedToTaxonomyItem).
    // Dragging the range input can fire many more "input" events than the
    // screen can actually repaint, especially on mobile touch — running
    // all three on every single one of those events is what made the
    // slider feel laggy. Coalescing them into a single rAF-scheduled
    // refresh keeps this in step with the display instead of the touch
    // events, while the slider handle/number above still update instantly
    // since those stay synchronous.
    qdScheduleRankingSliderHeavyRefresh();
  };

  input.oninput = () => applyValue(Number(input.value));
  valueEl.oninput = () => {
    if (valueEl.value === "" || valueEl.value === "-") return; // let them keep typing before clamping/persisting
    applyValue(Number(valueEl.value), { keepTyping: true });
  };
  // Blur/Enter is when we normalize the *displayed* text (clamp a typed
  // 15 down to 10.0, round out a stray "7." to "7.0", etc) — the actual
  // score was already clamped and persisted on every keystroke above.
  valueEl.onblur = () => renderDisplay(Math.max(0, Math.min(10, Number(valueEl.value) || 0)));
  valueEl.onkeydown = e => { if (e.key === "Enter") valueEl.blur(); };

  lockBtn.onclick = () => {
    toggleTaxonomyItemLock(kind, id);
    refreshLockUI();
    // Reflect the new lock state everywhere else it's shown too.
    if (taxonomyRankingOverlayIsOpen()) renderTaxonomyRankingPanel();
    if (taxonomyActiveTab === kind) renderTaxonomyPanel(kind);
  };

  overlay.style.display = "flex";
  document.body.classList.add("qd-factor-menu-open");
}

let taxonomyRankingSearchQuery = "";

// Independent, combinable (AND'd) toggle filters for the Performance
// Ranking list — all false is "All" (no filtering), the default.
// unlocked/unmarked are the inverse of locked/marked, not just a UI
// mirror of the same state — e.g. Locked finds rows to double-check
// before a big rebalance, Unlocked finds the rows that are still free
// to bulk-edit.
let taxonomyRankingFilter = { locked: false, marked: false, unassigned: false, unlocked: false, unmarked: false };

// "☑ Select" mode — lets several rows be picked at once so their scores
// can be changed together via the bulk bar, rather than opening the
// slider on each one individually. Selection is a set of "kind:id"
// keys so a Reaction and an Engagement sharing a numeric id can never
// collide. Both reset the moment Select mode is turned off, and the
// selection is quietly pruned of anything filtered out of view or
// deleted, so an old stale key can never sit around waiting to affect a
// future selection.
let taxonomyRankingSelectMode = false;
let taxonomyRankingSelected = new Set();
const taxonomyRankingSelKey = (kind, id) => `${kind}:${id}`;

// Repaints just the bulk bar (count + enabled/disabled state of its
// buttons) — cheap enough to call after every checkbox click without
// re-rendering the whole list.
function renderTaxonomyRankingBulkBar() {
  const bar = document.getElementById("taxonomy-ranking-bulk-bar");
  if (!bar) return;
  if (!taxonomyRankingSelectMode) { bar.style.display = "none"; return; }
  bar.style.display = "flex";
  const n = taxonomyRankingSelected.size;
  const countEl = document.getElementById("taxonomy-ranking-bulk-count");
  if (countEl) countEl.textContent = `${n} selected`;
  ["taxonomy-ranking-bulk-apply", "taxonomy-ranking-bulk-minus", "taxonomy-ranking-bulk-plus"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = n === 0;
  });
}

// Applies either an absolute value (mode "set") or a relative nudge
// (mode "delta") to every currently-selected row. Locked items are
// simply skipped — setTaxonomyItemValue already no-ops on them, but
// checking here too means a locked row is never even counted as
// "changed" for anyone watching. Re-renders the whole list afterward
// (scores, and possibly filter membership if a filter like "score-asc"
// sort is active) plus everything else a score change can affect.
function applyTaxonomyRankingBulk(mode, amount) {
  if (taxonomyRankingSelected.size === 0) return;
  taxonomyRankingSelected.forEach(key => {
    const [kind, idStr] = key.split(":");
    const id = Number(idStr);
    const item = taxonomy[kind]?.find(x => x.id === id);
    if (!item || item.locked) return;
    const next = mode === "delta" ? item.value + amount : amount;
    setTaxonomyItemValue(kind, id, next);
  });
  renderTaxonomyRankingPanel();
  renderRteSection();
  if (quickDraftSuggestOpen) renderQuickDraftSuggestions();
  if (typeof hfRefreshIfOpen === "function") hfRefreshIfOpen();
}

// The Performance Ranking System (Section 5.4) — every Reaction AND
// Engagement together in one score-sorted, vertically-scrolling list,
// so the whole taxonomy's scoring stays internally consistent at a
// glance instead of having to flip between two separate tabs to
// compare, say, a 7-scored Reaction against an 8-scored Engagement.
function renderTaxonomyRankingPanel() {
  const box = document.getElementById("taxonomy-ranking-list");
  if (!box) return;

  updateTaxonomySaveReminder(); // keep the reminder banner in sync every time this list redraws

  const q = taxonomyRankingSearchQuery.trim().toLowerCase();
  const combined = [
    ...taxonomy.reactions.map(item => ({ kind: "reactions", item })),
    ...taxonomy.engagements.map(item => ({ kind: "engagements", item })),
  ]
    // heroCount computed once up front so both the filter chips and the
    // row template below can use it without asking twice.
    .map(x => ({ ...x, heroCount: heroesLinkedToTaxonomyItem(x.kind, x.item.id).length }))
    .filter(({ item }) => !q || (item.name || "").toLowerCase().includes(q))
    .filter(({ item }) => !taxonomyRankingFilter.locked || item.locked)
    .filter(({ item }) => !taxonomyRankingFilter.unlocked || !item.locked)
    .filter(({ item }) => !taxonomyRankingFilter.marked || item.marked)
    .filter(({ item }) => !taxonomyRankingFilter.unmarked || !item.marked)
    .filter(({ heroCount }) => !taxonomyRankingFilter.unassigned || heroCount === 0)
    .sort((a, b) => {
      const an = (a.item.name || "").toLowerCase(), bn = (b.item.name || "").toLowerCase();
      switch (taxonomyRankingSortMode) {
        case "score-asc": return a.item.value - b.item.value || an.localeCompare(bn);
        case "az":         return an.localeCompare(bn) || b.item.value - a.item.value;
        case "za":         return bn.localeCompare(an) || b.item.value - a.item.value;
        case "score-desc":
        default:
          // Highest score first; ties broken alphabetically so the
          // order stays stable and predictable rather than shuffling
          // on re-render.
          return b.item.value - a.item.value || an.localeCompare(bn);
      }
    });

  // Keep the chip row's pressed-state in sync with taxonomyRankingFilter
  // every time this list redraws (e.g. after a chip click, or simply on
  // open) rather than only when a chip itself is clicked.
  document.querySelectorAll(".taxonomy-ranking-filter-chip").forEach(chip => {
    chip.classList.toggle("active", !!taxonomyRankingFilter[chip.dataset.filter]);
  });

  // Selection is only ever meaningful for what's actually on screen —
  // drop anything that's been filtered/searched out (or deleted) so the
  // bulk bar's count can't silently include rows the user can no longer
  // even see.
  const visibleKeys = new Set(combined.map(({ kind, item }) => taxonomyRankingSelKey(kind, item.id)));
  [...taxonomyRankingSelected].forEach(key => { if (!visibleKeys.has(key)) taxonomyRankingSelected.delete(key); });
  renderTaxonomyRankingBulkBar();

  const anyFilterActive = taxonomyRankingFilter.locked || taxonomyRankingFilter.marked || taxonomyRankingFilter.unassigned
    || taxonomyRankingFilter.unlocked || taxonomyRankingFilter.unmarked;
  if (combined.length === 0) {
    box.innerHTML = (taxonomy.reactions.length + taxonomy.engagements.length) === 0
      ? `<div class="taxonomy-empty-note">No Reactions or Engagements yet — add some in their own tabs first.</div>`
      : anyFilterActive
        ? `<div class="taxonomy-empty-note">Nothing matches the active filter${q ? " and search" : ""}.</div>`
        : `<div class="taxonomy-empty-note">No Reactions or Engagements match your search.</div>`;
    return;
  }

  box.innerHTML = combined.map(({ kind, item, heroCount }) => {
    const icon = kind === "reactions" ? "⚡" : "🛡";
    const key = taxonomyRankingSelKey(kind, item.id);
    const selected = taxonomyRankingSelected.has(key);
    const checkboxHtml = taxonomyRankingSelectMode
      ? `<input type="checkbox" class="taxonomy-ranking-row-checkbox" data-kind="${kind}" data-id="${item.id}"${selected ? " checked" : ""} title="Select for bulk score editing" />`
      : "";
    return `
      <div class="taxonomy-ranking-row${item.locked ? " locked" : ""}${item.marked ? " marked" : ""}${selected ? " selected" : ""}" data-kind="${kind}" data-id="${item.id}">
        ${checkboxHtml}
        <span class="taxonomy-ranking-row-icon">${icon}</span>
        <span class="taxonomy-ranking-row-name">${item.name || "(unnamed)"}</span>
        ${heroCount === 0 ? `<span class="taxonomy-ranking-row-unassigned" title="Not assigned to any hero yet">⚠️ Unassigned</span>` : ""}
        <button type="button" class="taxonomy-ranking-row-mark${item.marked ? " marked" : ""}" data-kind="${kind}" data-id="${item.id}" title="${item.marked ? "Marked as edited — click to unmark" : "Mark as edited (just a reminder for you)"}">${qdMarkIconSvg(item.marked)}</button>
        <button type="button" class="taxonomy-ranking-row-edit" data-kind="${kind}" data-id="${item.id}" title="Edit name">✏️</button>
        <button type="button" class="taxonomy-ranking-row-lock" data-kind="${kind}" data-id="${item.id}" title="${item.locked ? "Locked — click to unlock" : "Lock this score so it can't be changed"}">${qdLockIconSvg(item.locked)}</button>
        <button type="button" class="taxonomy-ranking-row-score" data-kind="${kind}" data-id="${item.id}" title="Tap to open the slider">${item.value.toFixed(1)}</button>
      </div>
    `;
  }).join("");

  const toggleRowSelection = (kind, id, rowEl) => {
    const key = taxonomyRankingSelKey(kind, id);
    if (taxonomyRankingSelected.has(key)) taxonomyRankingSelected.delete(key); else taxonomyRankingSelected.add(key);
    rowEl.classList.toggle("selected", taxonomyRankingSelected.has(key));
    const cb = rowEl.querySelector(".taxonomy-ranking-row-checkbox");
    if (cb) cb.checked = taxonomyRankingSelected.has(key);
    renderTaxonomyRankingBulkBar();
  };

  box.querySelectorAll(".taxonomy-ranking-row-checkbox").forEach(cb => {
    // The row itself also toggles selection below (for a bigger tap
    // target) — stopPropagation here so a tap directly on the checkbox
    // doesn't fire that handler too and cancel itself back out.
    cb.addEventListener("click", e => e.stopPropagation());
    cb.addEventListener("change", () => {
      const rowEl = cb.closest(".taxonomy-ranking-row");
      const key = taxonomyRankingSelKey(cb.dataset.kind, Number(cb.dataset.id));
      if (cb.checked) taxonomyRankingSelected.add(key); else taxonomyRankingSelected.delete(key);
      rowEl?.classList.toggle("selected", cb.checked);
      renderTaxonomyRankingBulkBar();
    });
  });
  // While Select mode is on, tapping anywhere on a row (other than one
  // of its own action buttons or the checkbox, handled above) toggles
  // its selection too — a bigger, easier target than the checkbox alone.
  if (taxonomyRankingSelectMode) {
    box.querySelectorAll(".taxonomy-ranking-row").forEach(rowEl => {
      rowEl.addEventListener("click", e => {
        if (e.target.closest(".taxonomy-ranking-row-checkbox, .taxonomy-ranking-row-score, .taxonomy-ranking-row-edit, .taxonomy-ranking-row-lock, .taxonomy-ranking-row-mark")) return;
        toggleRowSelection(rowEl.dataset.kind, Number(rowEl.dataset.id), rowEl);
      });
    });
  }

  box.querySelectorAll(".taxonomy-ranking-row-score").forEach(btn => {
    btn.addEventListener("click", () => qdShowRankingSlider(btn.dataset.kind, Number(btn.dataset.id)));
  });
  box.querySelectorAll(".taxonomy-ranking-row-edit").forEach(btn => {
    btn.addEventListener("click", () => {
      const item = taxonomy[btn.dataset.kind].find(x => x.id === Number(btn.dataset.id));
      openRenameModal(btn.dataset.kind, Number(btn.dataset.id), item?.name || "");
    });
  });
  box.querySelectorAll(".taxonomy-ranking-row-lock").forEach(btn => {
    btn.addEventListener("click", () => {
      toggleTaxonomyItemLock(btn.dataset.kind, Number(btn.dataset.id));
      renderTaxonomyRankingPanel();
      if (taxonomyActiveTab === btn.dataset.kind) renderTaxonomyPanel(btn.dataset.kind);
    });
  });
  box.querySelectorAll(".taxonomy-ranking-row-mark").forEach(btn => {
    btn.addEventListener("click", () => {
      toggleTaxonomyItemMarked(btn.dataset.kind, Number(btn.dataset.id));
      renderTaxonomyRankingPanel();
    });
  });
}

// Shared renderer for the Reactions and Engagements panels (5.1). Each
// row includes a fixed 0–10 value input — this IS the score used
// everywhere the item is assigned (chart axes, Quick Draft ranking);
// it is never editable from a hero's own edit screen.
function renderTaxonomyPanel(kind) {
  const box = document.getElementById(kind === "reactions" ? "taxonomy-list-reactions" : "taxonomy-list-engagements");
  const items = applyTaxonomySort(kind, taxonomy[kind].filter(item => taxonomyMatchesSearch(kind, item.name)));
  if (!items.length) {
    box.innerHTML = taxonomy[kind].length
      ? `<div class="taxonomy-empty-note">No ${kind} match your search.</div>`
      : `<div class="taxonomy-empty-note">No ${kind} yet — add one above.</div>`;
    return;
  }
  const label = kind === "reactions" ? "Reaction" : "Engagement";
  const otherKind = kind === "reactions" ? "engagements" : "reactions";
  const otherLabel = kind === "reactions" ? "Engagement" : "Reaction";
  box.innerHTML = items.map(item => {
    const heroCount = heroesLinkedToTaxonomyItem(kind, item.id).length;
    return `
    <div class="taxonomy-row${item.pinned ? " pinned" : ""}" data-id="${item.id}">
      <div class="taxonomy-row-main">
        <div class="taxonomy-row-name-wrap">
          <button type="button" class="taxonomy-row-pinbtn${item.pinned ? " active" : ""}" data-kind="${kind}" data-id="${item.id}" title="${item.pinned ? "Unpin" : "Pin to top"}">📌</button>
          <div class="taxonomy-row-name-text">${item.name || "(unnamed)"}</div>
          <button type="button" class="taxonomy-row-editbtn" data-kind="${kind}" data-id="${item.id}" title="Edit name">✏️</button>
          <button type="button" class="taxonomy-row-editbtn taxonomy-row-dupbtn" data-kind="${kind}" data-id="${item.id}" title="Duplicate as new ${label}">⎘</button>
        </div>
        <div class="taxonomy-row-value">
          <label for="taxonomy-value-${kind}-${item.id}">Value</label>
          <input type="number" id="taxonomy-value-${kind}-${item.id}" class="taxonomy-row-value-input" min="0" max="10" step="0.1" value="${item.value.toFixed(1)}" data-kind="${kind}" data-id="${item.id}" title="Fixed score (0-10) used everywhere this ${label} is assigned"${item.locked ? " disabled" : ""} />
          <button type="button" class="taxonomy-row-slider-btn" data-kind="${kind}" data-id="${item.id}" title="Open the slider (with the Performance Ranking description) instead">🎚</button>
          <button type="button" class="taxonomy-row-lockbtn${item.locked ? " locked" : ""}" data-kind="${kind}" data-id="${item.id}" title="${item.locked ? "Locked — click to unlock" : "Lock this score so it can't be changed"}">${qdLockIconSvg(item.locked)}</button>
        </div>
        <button type="button" class="btn btn-ghost btn-xs taxonomy-row-tagbtn" data-kind="${kind}" data-id="${item.id}">🏷 Factors (${item.factorIds.length})</button>
        <button type="button" class="btn btn-ghost btn-xs taxonomy-row-copyfactorsbtn" data-kind="${kind}" data-id="${item.id}" title="Copy this ${label}'s tagged Factors, to paste onto another Reaction or Engagement">📋 Copy Factors</button>
        <button type="button" class="btn btn-ghost btn-xs taxonomy-row-pastefactorsbtn" data-kind="${kind}" data-id="${item.id}"${taxonomyFactorClipboard ? "" : " disabled"} title="${taxonomyFactorClipboard ? `Add the ${taxonomyFactorClipboard.factorIds.length} Factor(s) copied from &quot;${taxonomyFactorClipboard.sourceName}&quot; — merges in, doesn't remove existing tags` : "Copy Factors from a Reaction or Engagement first"}">📥 Paste Factors${taxonomyFactorClipboard ? ` (${taxonomyFactorClipboard.factorIds.length})` : ""}</button>
        <button type="button" class="btn btn-ghost btn-xs taxonomy-row-herobtn" data-kind="${kind}" data-id="${item.id}" title="Search a hero and add this ${label} to them instantly, without opening their edit screen">➕ Add to Hero${heroCount ? ` (${heroCount})` : ""}</button>
        <button type="button" class="btn btn-ghost btn-xs taxonomy-row-convertbtn" data-kind="${kind}" data-id="${item.id}" title="Move this ${label} to ${otherLabel}s — keeps its value, Factor tags, and every hero it's linked to">⇄ Make ${otherLabel}</button>
        <button type="button" class="taxonomy-row-delete" data-kind="${kind}" data-id="${item.id}" title="Delete — un-links from every hero that holds it">✕</button>
      </div>
      <div class="taxonomy-row-factors" id="taxonomy-factors-${kind}-${item.id}" style="display:none"></div>
      <div class="taxonomy-row-heroes" id="taxonomy-heroes-${kind}-${item.id}" style="display:none"></div>
    </div>
  `;
  }).join("");

  box.querySelectorAll(".taxonomy-row-editbtn:not(.taxonomy-row-dupbtn)").forEach(btn => {
    btn.addEventListener("click", () => {
      const item = taxonomy[btn.dataset.kind].find(x => x.id === Number(btn.dataset.id));
      openRenameModal(btn.dataset.kind, Number(btn.dataset.id), item?.name || "");
    });
  });
  box.querySelectorAll(".taxonomy-row-dupbtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const item = taxonomy[btn.dataset.kind].find(x => x.id === Number(btn.dataset.id));
      openDuplicateModal(btn.dataset.kind, Number(btn.dataset.id), item?.name || "");
    });
  });
  box.querySelectorAll(".taxonomy-row-pinbtn").forEach(btn => {
    btn.addEventListener("click", () => {
      toggleTaxonomyPin(btn.dataset.kind, Number(btn.dataset.id));
      renderTaxonomyPanel(btn.dataset.kind);
    });
  });
  box.querySelectorAll(".taxonomy-row-value-input").forEach(input => {
    input.addEventListener("change", () => {
      setTaxonomyItemValue(input.dataset.kind, Number(input.dataset.id), input.value);
      input.value = taxonomyValue(input.dataset.kind, Number(input.dataset.id)).toFixed(1);
      renderRteSection(); // any hero currently open needs its live score badges refreshed
      if (quickDraftSuggestOpen) renderQuickDraftSuggestions(); // scores feed Quick Draft too
    });
  });
  box.querySelectorAll(".taxonomy-row-slider-btn").forEach(btn => {
    btn.addEventListener("click", () => qdShowRankingSlider(btn.dataset.kind, Number(btn.dataset.id)));
  });
  box.querySelectorAll(".taxonomy-row-lockbtn").forEach(btn => {
    btn.addEventListener("click", () => {
      toggleTaxonomyItemLock(btn.dataset.kind, Number(btn.dataset.id));
      renderTaxonomyPanel(btn.dataset.kind);
      if (taxonomyRankingOverlayIsOpen()) renderTaxonomyRankingPanel();
    });
  });
  box.querySelectorAll(".taxonomy-row-delete").forEach(btn => {
    btn.addEventListener("click", () => {
      const item = taxonomy[btn.dataset.kind].find(x => x.id === Number(btn.dataset.id));
      const label = btn.dataset.kind === "reactions" ? "Reaction" : "Engagement";
      if (!confirm(`Delete "${item?.name || ""}"? This un-links it from every hero that holds it.`)) return;
      deleteTaxonomyItem(btn.dataset.kind, Number(btn.dataset.id));
      renderTaxonomyPanel(btn.dataset.kind);
      renderRteSection();
    });
  });
  box.querySelectorAll(".taxonomy-row-tagbtn").forEach(btn => {
    btn.addEventListener("click", () => toggleTaxonomyRowFactors(btn.dataset.kind, Number(btn.dataset.id)));
  });
  box.querySelectorAll(".taxonomy-row-copyfactorsbtn").forEach(btn => {
    btn.addEventListener("click", () => {
      copyTaxonomyFactors(btn.dataset.kind, Number(btn.dataset.id));
      // Update every Paste button in-place (both tabs, including rows
      // whose Factor-chip strip is currently open) rather than a full
      // re-render, so copying doesn't collapse anything you had open.
      refreshPasteFactorButtons();
    });
  });
  box.querySelectorAll(".taxonomy-row-pastefactorsbtn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!taxonomyFactorClipboard) return;
      const kind = btn.dataset.kind, id = Number(btn.dataset.id);
      // Re-rendering the panel resets every row's Factor-chip strip back
      // to closed (it's always emitted with display:none, see the row
      // template above) — so remember whether this one was open and
      // reopen it afterward, otherwise pasting silently closes whatever
      // you were looking at.
      const wasOpen = document.getElementById(`taxonomy-factors-${kind}-${id}`)?.style.display !== "none";
      pasteTaxonomyFactors(kind, id);
      renderTaxonomyPanel(kind);
      if (wasOpen) toggleTaxonomyRowFactors(kind, id);
    });
  });
  box.querySelectorAll(".taxonomy-row-herobtn").forEach(btn => {
    btn.addEventListener("click", () => toggleTaxonomyRowHeroes(btn.dataset.kind, Number(btn.dataset.id)));
  });
  box.querySelectorAll(".taxonomy-row-convertbtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const fromKind = btn.dataset.kind;
      const id = Number(btn.dataset.id);
      const item = taxonomy[fromKind].find(x => x.id === id);
      const toLabel = fromKind === "reactions" ? "Engagements" : "Reactions";
      if (!confirm(`Move "${item?.name || ""}" to ${toLabel}? It keeps its value, Factor tags, and every hero it's linked to.`)) return;
      convertTaxonomyItemKind(fromKind, id);
      renderTaxonomyPanel("reactions");
      renderTaxonomyPanel("engagements");
      renderRteSection(); // reflects the move immediately if the hero modal is open behind this one
      if (quickDraftSuggestOpen) renderQuickDraftSuggestions(); // scores/factors feed Quick Draft too
    });
  });
}

// Expands/collapses the Factor-tagging chip row under a Reaction or
// Engagement — this is where "tag Factors onto a Reaction/Engagement
// from this same screen" (5.1) actually happens.
function toggleTaxonomyRowFactors(kind, id) {
  const row = document.getElementById(`taxonomy-factors-${kind}-${id}`);
  const isOpen = row.style.display !== "none";
  if (isOpen) { row.style.display = "none"; return; }
  row.style.display = "flex";
  renderTaxonomyFactorChips(kind, id);
}

// Tagged Factors show as removable chips; everything else is reached by
// searching instead of dumping the whole Factors library into the row —
// once there are dozens of Factors that list would be unusable here.
function renderTaxonomyFactorChips(kind, id) {
  const row = document.getElementById(`taxonomy-factors-${kind}-${id}`);
  const item = taxonomy[kind].find(x => x.id === id);
  if (!item) return;
  if (!taxonomy.factors.length) {
    row.innerHTML = `<div class="taxonomy-empty-note">No Factors defined yet — add one in the Factors tab first.</div>`;
    return;
  }

  const rowKey = `${kind}-${id}`;
  const query = taxonomyFactorRowSearch[rowKey] || "";
  const taggedFactors = item.factorIds
    .map(fid => taxonomy.factors.find(f => f.id === fid))
    .filter(Boolean);

  row.innerHTML = `
    <div class="taxonomy-tagged-chips">
      ${taggedFactors.length
        ? taggedFactors.map(f => `<button type="button" class="taxonomy-factor-chip tagged" data-factor-id="${f.id}" title="Remove">${f.name} ✕</button>`).join("")
        : `<div class="taxonomy-empty-note">No Factors tagged yet — search below to add one.</div>`}
    </div>
    <div class="taxonomy-search-wrap">
      <input type="text" class="taxonomy-search taxonomy-factor-search" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="🔍 Search Factors to add…" value="${escAttr(query)}" />
      <button type="button" class="taxonomy-search-clear" title="Clear search" aria-label="Clear search">✕</button>
    </div>
    <div class="taxonomy-factor-search-results"></div>
  `;

  // Click a tagged chip to remove it.
  row.querySelectorAll(".taxonomy-tagged-chips .taxonomy-factor-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      untagFactor(kind, id, Number(chip.dataset.factorId));
      renderTaxonomyPanel(kind); // refresh the tag-count badge too (rebuilds row closed)
      toggleTaxonomyRowFactors(kind, id); // reopen it, expanded, post-refresh
    });
  });

  const searchInput = row.querySelector(".taxonomy-factor-search");
  const resultsBox = row.querySelector(".taxonomy-factor-search-results");

  const renderResults = () => {
    const q = (taxonomyFactorRowSearch[rowKey] || "").trim().toLowerCase();
    const candidates = taxonomy.factors.filter(f =>
      !item.factorIds.includes(f.id) && (!q || f.name.toLowerCase().includes(q))
    );
    if (!q) {
      resultsBox.innerHTML = candidates.length
        ? `<div class="taxonomy-empty-note">Type to search ${candidates.length} untagged Factor${candidates.length === 1 ? "" : "s"}…</div>`
        : `<div class="taxonomy-empty-note">Every Factor is already tagged here.</div>`;
      return;
    }
    resultsBox.innerHTML = candidates.length
      ? candidates.map(f => `<button type="button" class="taxonomy-factor-chip" data-factor-id="${f.id}">+ ${f.name}</button>`).join("")
      : `<div class="taxonomy-empty-note">No matching Factors.</div>`;
    resultsBox.querySelectorAll(".taxonomy-factor-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        tagFactor(kind, id, Number(chip.dataset.factorId));
        taxonomyFactorRowSearch[rowKey] = ""; // clear search after a successful add
        renderTaxonomyPanel(kind); // refresh the tag-count badge too (rebuilds row closed)
        toggleTaxonomyRowFactors(kind, id); // reopen it, expanded, post-refresh
      });
    });
  };

  searchInput.addEventListener("input", () => {
    taxonomyFactorRowSearch[rowKey] = searchInput.value;
    renderResults();
  });
  searchInput.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const firstResult = resultsBox.querySelector(".taxonomy-factor-chip");
    if (firstResult) firstResult.click(); // Enter adds the top match
  });
  wireTaxonomySearchClear(searchInput, row.querySelector(".taxonomy-search-clear"), () => {
    taxonomyFactorRowSearch[rowKey] = "";
    renderResults();
  });

  renderResults();
  if (query) searchInput.focus({ preventScroll: true }); // restore focus/cursor after a re-render
}

/* ── Section 5.3: quick "Add to Hero" search ──
   Lets a Reaction/Engagement be assigned straight to a hero from this
   list — search their name, tap +, done — instead of opening that
   hero's own edit screen just to link one item. Saves immediately
   (addHeroTaxonomyLink already calls saveLocal()) and refuses to
   double-add: a hero that already holds this item shows a disabled
   "✓ Added" badge instead of a clickable + button, and the lookup
   itself is keyed off the hero's actual current links every render,
   so it can't drift out of sync with what's really assigned. */
function toggleTaxonomyRowHeroes(kind, id) {
  const row = document.getElementById(`taxonomy-heroes-${kind}-${id}`);
  if (!row) return;
  const isOpen = row.style.display !== "none";
  if (isOpen) { row.style.display = "none"; return; }
  row.style.display = "flex";
  renderTaxonomyHeroSearch(kind, id);
}

// Fires right after a brand-new Reaction/Engagement is created — this
// is the "forgot to actually go add heroes to it" moment the user
// asked to be reminded about. Instead of a passive banner, it forces
// the point: auto-expands that item's "search a hero to add" panel,
// focuses the search box, scrolls it into view, and gives the row a
// brief gold pulse so it's unmistakable which one just got made.
function remindToAddHeroes(kind, id) {
  // An active search filter left over from earlier browsing could hide
  // the new item entirely — clear it first so the reminder can never
  // silently fail to show up.
  if (taxonomySearchQuery[kind]) {
    const clearBtn = document.getElementById(`taxonomy-search-${kind}-clear`);
    if (clearBtn) clearBtn.click();
    else { taxonomySearchQuery[kind] = ""; renderTaxonomyPanel(kind); }
  }
  const heroRow = document.getElementById(`taxonomy-heroes-${kind}-${id}`);
  if (!heroRow) return; // shouldn't happen post-clear, but don't throw if it somehow does
  heroRow.style.display = "flex";
  renderTaxonomyHeroSearch(kind, id);
  const searchInput = heroRow.querySelector(".taxonomy-hero-row-search");
  if (searchInput) searchInput.focus();
  const box = document.getElementById(kind === "reactions" ? "taxonomy-list-reactions" : "taxonomy-list-engagements");
  const parentRow = box ? box.querySelector(`.taxonomy-row[data-id="${id}"]`) : null;
  if (parentRow) {
    parentRow.scrollIntoView({ behavior: "smooth", block: "center" });
    parentRow.classList.add("just-created");
    setTimeout(() => parentRow.classList.remove("just-created"), 2200);
  }
}

function renderTaxonomyHeroSearch(kind, id) {
  const row  = document.getElementById(`taxonomy-heroes-${kind}-${id}`);
  const item = taxonomy[kind].find(x => x.id === id);
  if (!item || !row) return;

  const label = kind === "reactions" ? "Reaction" : "Engagement";
  const rowKey = `${kind}-${id}`;
  const query = taxonomyHeroRowSearch[rowKey] || "";
  const linkedHeroes = heroesLinkedToTaxonomyItem(kind, id);

  row.innerHTML = `
    <div class="taxonomy-search-wrap">
      <input type="text" class="taxonomy-search taxonomy-hero-row-search" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="🔍 Search a hero to add…" value="${escAttr(query)}" />
      <button type="button" class="taxonomy-search-clear" title="Clear search" aria-label="Clear search">✕</button>
    </div>
    <div class="taxonomy-hero-row-results"></div>
    <div class="taxonomy-tagged-chips">
      ${linkedHeroes.length
        // Newest-tagged first: there's no per-link timestamp stored, so
        // this reverses roster order (heroes are always appended, so
        // last-in-roster == most recently added) as the closest proxy.
        ? [...linkedHeroes].reverse().map(h => `<span class="taxonomy-hero-chip" title="Already has this ${label}">✅ ${h.name || "Unnamed"}</span>`).join("")
        : `<div class="taxonomy-empty-note">Not assigned to any hero yet — search above to add one.</div>`}
    </div>
  `;

  const searchInput = row.querySelector(".taxonomy-hero-row-search");
  const resultsBox  = row.querySelector(".taxonomy-hero-row-results");

  const renderResults = () => {
    const q = (taxonomyHeroRowSearch[rowKey] || "").trim().toLowerCase();
    // Two heroes get pinned to the top of the list, with or without a
    // search typed: whichever hero was last opened via "Edit Hero" in
    // the roster (viewedHero), above whichever hero was last linked to
    // any Reaction/Engagement (linkedHero) — that's the order the user
    // asked for. If they're the same hero, it's only shown once, not
    // duplicated.
    const viewedHero = lastHeroViewedInEdit != null ? heroes.find(h => h.id === lastHeroViewedInEdit) : null;
    const linkedHero = lastHeroLinkedToTaxonomy != null ? heroes.find(h => h.id === lastHeroLinkedToTaxonomy) : null;
    const pinnedHeroes = [];
    const pinReasons = {}; // heroId -> ["viewed"|"linked", ...], drives the label/icon below
    if (viewedHero) { pinnedHeroes.push(viewedHero); pinReasons[viewedHero.id] = ["viewed"]; }
    if (linkedHero) {
      if (pinReasons[linkedHero.id]) pinReasons[linkedHero.id].push("linked");
      else { pinnedHeroes.push(linkedHero); pinReasons[linkedHero.id] = ["linked"]; }
    }
    const pinnedIds = new Set(pinnedHeroes.map(h => h.id));
    const rest = heroes
      .filter(h => !pinnedIds.has(h.id) && (!q || (h.name || "").toLowerCase().includes(q)))
      .slice(0, Math.max(0, 12 - pinnedHeroes.length));
    const matches = [...pinnedHeroes, ...rest];
    if (!matches.length) {
      resultsBox.innerHTML = q
        ? `<div class="taxonomy-empty-note">No matching heroes.</div>`
        : `<div class="taxonomy-empty-note">Type a hero's name…</div>`;
      return;
    }
    resultsBox.innerHTML = matches.map(h => {
      const already = (Array.isArray(h[kind]) ? h[kind] : []).some(x => (x.refId ?? x) === id);
      const reasons = pinReasons[h.id];
      const isPinned = !!reasons;
      const pinIcon = !reasons ? "" : reasons.includes("viewed") && reasons.includes("linked") ? "👁️🕐 " : reasons.includes("viewed") ? "👁️ " : "🕐 ";
      const portrait = h.iconData ? `<img src="${h.iconData}">` : "⚔️";
      return `
        <div class="taxonomy-hero-result${already ? " already" : ""}${isPinned ? " pinned" : ""}" data-hero-id="${h.id}">
          <div class="taxonomy-hero-result-portrait">${portrait}</div>
          <div class="taxonomy-hero-result-name">${pinIcon}${h.name || "Unnamed"}</div>
          ${already
            ? `<span class="taxonomy-hero-added-badge">✓ Added</span>`
            : `<button type="button" class="taxonomy-hero-add-btn" data-hero-id="${h.id}">+ Add</button>`}
        </div>`;
    }).join("");

    resultsBox.querySelectorAll(".taxonomy-hero-add-btn").forEach(addBtn => {
      addBtn.addEventListener("click", () => {
        const heroId = Number(addBtn.dataset.heroId);
        addHeroTaxonomyLink(heroId, kind, id); // no-ops harmlessly if somehow already linked
        taxonomyHeroRowSearch[rowKey] = ""; // clear search after a successful add, ready for the next hero
        renderTaxonomyPanel(kind); // refresh the "Add to Hero (N)" badge too
        toggleTaxonomyRowHeroes(kind, id); // reopen it, expanded, post-refresh
        renderRteSection(); // reflect the new link immediately if that hero's edit screen is open behind this one
        if (quickDraftSuggestOpen) renderQuickDraftSuggestions(); // scores/factors feed Quick Draft too
      });
    });
  };

  searchInput.addEventListener("input", () => {
    taxonomyHeroRowSearch[rowKey] = searchInput.value;
    renderResults();
  });
  searchInput.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const firstAddable = resultsBox.querySelector(".taxonomy-hero-add-btn");
    if (firstAddable) firstAddable.click(); // Enter adds the top matching, not-yet-added hero
  });
  wireTaxonomySearchClear(searchInput, row.querySelector(".taxonomy-search-clear"), () => {
    taxonomyHeroRowSearch[rowKey] = "";
    renderResults();
  });

  renderResults();
  if (query) searchInput.focus({ preventScroll: true }); // restore focus/cursor after a re-render
}

// Refreshes every place a Factor's scoring might already be on screen
// — filled Quick Draft slots, its live suggestion panel (if open), and
// Hero Factors' grid (if open) — after a priority order/lock change
// below. Safe to call unconditionally: every one of these is already a
// no-op if that Factor isn't currently ticked or that panel isn't open.
function qdRefreshFactorScoreViews() {
  renderQuickDraft();
  if (quickDraftSuggestOpen) renderQuickDraftSuggestions();
  if (typeof hfRefreshIfOpen === "function") hfRefreshIfOpen();
}

// Factors panel (5.2) — create/rename/delete, plus each Factor's own
// manual priority order: click one of the chips below (each one of
// this Factor's tagged Reactions/Engagements) to add it to the
// priority queue, click again to remove it. Click ORDER is the
// priority order — first click is worth the full ×2, each one after
// spreads evenly down to ×1 for however many are queued (see
// toggleFactorPriority/qdFactorRankedBreakdown for the actual math).
function renderFactorsPanel() {
  const box = document.getElementById("taxonomy-list-factors");
  const items = applyTaxonomySort("factors", taxonomy.factors.filter(f => taxonomyMatchesSearch("factors", f.name)));
  if (!items.length) {
    box.innerHTML = taxonomy.factors.length
      ? `<div class="taxonomy-empty-note">No Factors match your search.</div>`
      : `<div class="taxonomy-empty-note">No Factors yet — add one above.</div>`;
    return;
  }
  box.innerHTML = items.map(f => {
    // Reverse lookup — which Reactions/Engagements actually carry this
    // Factor's tag, straight from the same taxonomyItemsForFactor used
    // by the tag-picker on those rows, so this can never drift out of
    // sync with what's really assigned.
    const tagged = taxonomyItemsForFactor(f.id);
    const priorityOrder = Array.isArray(f.priorityOrder) ? f.priorityOrder : [];
    const priorityCount = priorityOrder.length;
    const rankOf = (kind, id) => {
      const idx = priorityOrder.findIndex(p => p.kind === kind && p.id === id);
      return idx === -1 ? null : idx;
    };
    const multiplierForRank = idx => priorityCount > 1 ? 2 - idx / (priorityCount - 1) : 2;

    // Priority picks float to the front in click order (so the queue
    // reads top-to-bottom exactly the way it'll score); everything
    // else falls back to the old highest-score-first ordering, now
    // interleaved across both types rather than Reactions-then-
    // Engagements, since with priority picks in play "what carries the
    // most weight" is no longer purely a per-type question.
    const allTagged = [
      ...tagged.reactions.map(r => ({ kind: "reactions", item: r, icon: "⚡" })),
      ...tagged.engagements.map(e => ({ kind: "engagements", item: e, icon: "🛡" })),
    ].sort((a, b) => {
      const ra = rankOf(a.kind, a.item.id), rb = rankOf(b.kind, b.item.id);
      if (ra !== null && rb !== null) return ra - rb;
      if (ra !== null) return -1;
      if (rb !== null) return 1;
      return b.item.value - a.item.value;
    });

    const chips = allTagged.map(({ kind, item, icon }) => {
      const rank = rankOf(kind, item.id);
      const isPriority = rank !== null;
      const mult = isPriority ? multiplierForRank(rank) : null;
      const kindClass = kind === "reactions" ? "reaction" : "engagement";
      const priorityBadge = isPriority ? `<span class="taxonomy-factor-tag-priority">⭐#${rank + 1} ×${mult.toFixed(2)}</span>` : "";
      const title = f.priorityLocked
        ? "This Factor's priority order is locked — unlock it first to change"
        : isPriority
          ? `Priority #${rank + 1} (×${mult.toFixed(2)}) — click to remove from the priority order`
          : "Click to add to this Factor's priority order";
      return `<button type="button" class="taxonomy-factor-tag ${kindClass}${isPriority ? " priority" : ""}${f.priorityLocked ? " locked" : ""}" data-factor-id="${f.id}" data-kind="${kind}" data-item-id="${item.id}" title="${escAttr(title)}">${icon} ${item.name || "(unnamed)"} <span class="taxonomy-factor-tag-score">${item.value.toFixed(1)}</span>${priorityBadge}</button>`;
    });

    const priorityHint = priorityCount === 0
      ? "Click a tag below to prioritize it — first click doubles its score (×2), later clicks spread evenly down to ×1. Leave none clicked to keep ranking automatically by score."
      : `🎯 Priority order (${priorityCount}) — click a tag to add/remove.`;

    return `
    <div class="taxonomy-row${f.pinned ? " pinned" : ""}" data-id="${f.id}">
      <div class="taxonomy-row-main">
        <div class="taxonomy-row-name-wrap">
          <button type="button" class="taxonomy-row-pinbtn${f.pinned ? " active" : ""}" data-id="${f.id}" title="${f.pinned ? "Unpin" : "Pin to top"}">📌</button>
          <div class="taxonomy-row-name-text">${f.name || "(unnamed)"}</div>
          <button type="button" class="taxonomy-row-editbtn" data-id="${f.id}" title="Edit name">✏️</button>
          <button type="button" class="taxonomy-row-editbtn taxonomy-row-dupbtn" data-id="${f.id}" title="Duplicate as new Factor">⎘</button>
        </div>
        <button type="button" class="taxonomy-row-delete" data-id="${f.id}" title="Delete — un-tags it from every Reaction/Engagement">✕</button>
      </div>
      <div class="taxonomy-factor-tags">
        ${chips.length ? chips.join("") : `<div class="taxonomy-empty-note">Not tagged to any Reaction/Engagement yet.</div>`}
      </div>
      ${chips.length ? `
      <div class="taxonomy-factor-priority-bar">
        <span class="taxonomy-factor-priority-hint">${priorityHint}</span>
        <div class="taxonomy-factor-priority-actions">
          ${priorityCount > 0 && !f.priorityLocked ? `<button type="button" class="btn btn-ghost btn-xs" data-clear-priority="${f.id}">✕ Clear priority</button>` : ""}
          <button type="button" class="btn btn-ghost btn-xs taxonomy-factor-lock-btn${f.priorityLocked ? " locked" : ""}" data-lock-priority="${f.id}" title="${f.priorityLocked ? "Unlock — allow the priority order to change again" : "Lock — prevent this Factor's priority order from changing"}">${f.priorityLocked ? "🔒 Locked" : "🔓 Lock order"}</button>
        </div>
      </div>
      ` : ""}
    </div>
  `;
  }).join("");
  box.querySelectorAll(".taxonomy-row-editbtn:not(.taxonomy-row-dupbtn)").forEach(btn => {
    btn.addEventListener("click", () => {
      const f = taxonomy.factors.find(x => x.id === Number(btn.dataset.id));
      openRenameModal("factors", Number(btn.dataset.id), f?.name || "");
    });
  });
  box.querySelectorAll(".taxonomy-row-dupbtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const f = taxonomy.factors.find(x => x.id === Number(btn.dataset.id));
      openDuplicateModal("factors", Number(btn.dataset.id), f?.name || "");
    });
  });
  box.querySelectorAll(".taxonomy-row-pinbtn").forEach(btn => {
    btn.addEventListener("click", () => {
      toggleTaxonomyPin("factors", Number(btn.dataset.id));
      renderFactorsPanel();
    });
  });
  box.querySelectorAll(".taxonomy-row-delete").forEach(btn => {
    btn.addEventListener("click", () => {
      const f = taxonomy.factors.find(x => x.id === Number(btn.dataset.id));
      if (!confirm(`Delete "${f?.name || ""}"? This un-tags it from every Reaction/Engagement.`)) return;
      deleteFactor(Number(btn.dataset.id));
      renderFactorsPanel();
      renderQdFactorChips(); // Section 8.1 checklist — drop the deleted Factor's chip too
      if (typeof renderHeroFactorsButton === "function") renderHeroFactorsButton(); // keep Hero Factors' button/grid in sync with the Enemy Factors state it reads
    });
  });
  box.querySelectorAll(".taxonomy-factor-tag").forEach(btn => {
    btn.addEventListener("click", () => {
      toggleFactorPriority(Number(btn.dataset.factorId), btn.dataset.kind, Number(btn.dataset.itemId));
      renderFactorsPanel();
      qdRefreshFactorScoreViews();
    });
  });
  box.querySelectorAll("[data-clear-priority]").forEach(btn => {
    btn.addEventListener("click", () => {
      clearFactorPriority(Number(btn.dataset.clearPriority));
      renderFactorsPanel();
      qdRefreshFactorScoreViews();
    });
  });
  box.querySelectorAll("[data-lock-priority]").forEach(btn => {
    btn.addEventListener("click", () => {
      toggleFactorPriorityLock(Number(btn.dataset.lockPriority));
      renderFactorsPanel();
    });
  });
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

/* ═══════════════════════════════════════
   FULL-SCREEN AXIS SLIDERS
   X = Reaction ⟷ Engage (read-only viewer). Y = Selfish ⟷ Selfless,
   the real slider on the Add/Edit Hero form (main and ghost).

   Internally the Y slider works on a single unified position `p`
   from -10..+10, then converts back to {selfishScore, selflessScore}
   on apply — see ssToP/pToSs below.
═══════════════════════════════════════ */

// Rebuild Spec Section 7.1: the old per-value descriptive captions
// (SUR/SST/SPD/TNK_DESC tables) that used to render under the slider
// have been dropped entirely — sliders now show only the numeric
// score and which end it's closer to. See renderXSlider/renderYSlider.

let xSliderState = { mode: "main" }; // read-only viewer now — no p/fine/dragging needed
let ySliderState = { p: 0, fine: false, dragging: false, mode: "main" };

/* ── conversions between the {selfishScore, selflessScore} model and the
   unified -10..10 p the Y slider's rail/handle/neighbor math already runs
   on (same convention vToP/pToV used to: positive = top = Selfish here,
   matching heroYAxis's "Selfish top" convention). ── */
function ssToP(selfishScore, selflessScore) {
  const sh = Math.max(0, Math.min(10, Number(selfishScore) || 0));
  const sl = Math.max(0, Math.min(10, Number(selflessScore) || 0));
  if (sh === 0 && sl === 0) return 0;
  return sh >= sl ? sh : -sl;
}
function pToSs(p) {
  const r = Math.round(p * 10) / 10;
  if (r === 0) return { selfishScore: 0, selflessScore: 0 };
  return r > 0 ? { selfishScore: r, selflessScore: 0 } : { selfishScore: 0, selflessScore: -r };
}
// mode-aware read of whichever Selfish/Selfless pair the Y slider is
// currently pointed at — "main" (modalSelfishScore/modalSelflessScore) or
// "alt" (modalAltSelfishScore/modalAltSelflessScore, the ghost build).
function ssModalValues(mode) {
  return mode === "alt"
    ? { selfishScore: modalAltSelfishScore, selflessScore: modalAltSelflessScore }
    : { selfishScore: modalSelfishScore, selflessScore: modalSelflessScore };
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

/* ── Live "who's above/below" lookup for the Y (Selfish/Selfless) slider ──
   Returns the closest hero on each side of `targetP` on the unified -10..10
   scale. In "alt" (ghost) mode it compares against other heroes' ghost
   Selfish/Selfless, since that's the more meaningful comparison for a
   ghost value. The X slider no longer has neighbors (read-only viewer). */
function heroAxisP(h, axis, mode) {
  if (mode === "alt") {
    if (!h.altStats) return null;
    return ssToP(h.altStats.selfishScore, h.altStats.selflessScore);
  }
  return ssToP(h.selfishScore, h.selflessScore);
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
  const type = entry.p > 0 ? "Selfish" : "Selfless";
  document.getElementById(labelId).innerHTML =
    `<span class="aneigh-stat">${type} ${val}</span><span class="aneigh-name">${h.name || "Unnamed"}</span>`;
  drawSliderPortrait(document.getElementById(canvasId), h.iconData || "");
}

function pulseNode(el) {
  el.classList.remove("snap-pulse");
  void el.offsetWidth; // restart animation
  el.classList.add("snap-pulse");
}

/* ── X (horizontal) viewer — read-only (Section 6 open-decision) ──
   Reaction/Engage is a derived live average, so there's nothing to drag;
   this just renders the current breakdown. Ghost shares the exact same
   Reactions/Engagements as the main build now, so both "main" and "alt"
   modes read modalReactions/modalEngagements — this viewer still exists
   in "alt" mode for its ghost-specific neighbor comparison, even though
   the underlying Reaction/Engage numbers are now identical either way. */
function renderXSlider() {
  const reactions   = modalReactions;
  const engagements = modalEngagements;

  const reactionScore = computeReactionScore({ reactions });
  const engageScore   = computeEngageScore({ engagements });

  document.getElementById("xslider-reaction-total").textContent = reactionScore === null ? "—" : reactionScore;
  document.getElementById("xslider-engage-total").textContent   = engageScore === null ? "—" : engageScore;

  const reactionList = document.getElementById("xslider-reaction-list");
  reactionList.innerHTML = reactions.length
    ? reactions.map(item => {
        const refId = item?.refId ?? item;
        return `<div style="display:flex;justify-content:space-between;color:var(--text-dim)"><span>${taxonomyName("reactions", refId)}</span><span>${taxonomyValue("reactions", refId).toFixed(1)}</span></div>`;
      }).join("")
    : `<div style="color:var(--text-dim);font-style:italic">None assigned.</div>`;

  const engageList = document.getElementById("xslider-engage-list");
  engageList.innerHTML = engagements.length
    ? engagements.map(item => {
        const refId = item?.refId ?? item;
        return `<div style="display:flex;justify-content:space-between;color:var(--text-dim)"><span>${taxonomyName("engagements", refId)}</span><span>${taxonomyValue("engagements", refId).toFixed(1)}</span></div>`;
      }).join("")
    : `<div style="color:var(--text-dim);font-style:italic">None assigned.</div>`;
}

function openXSlider(mode) {
  xSliderState.mode = mode || "main";
  document.getElementById("xslider-overlay").querySelector(".axis-slider-screen")
    .classList.toggle("ghost-mode", xSliderState.mode === "alt");
  drawSliderPortrait(document.getElementById("xslider-portrait-canvas"));
  renderXSlider();
  document.getElementById("xslider-overlay").classList.add("open");
}
function closeXSlider() {
  document.getElementById("xslider-overlay").classList.remove("open");
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
  document.getElementById("yslider-readout-num").textContent =
    p === 0 ? "Neutral" : `${p > 0 ? "Selfish" : "Selfless"} ${dispVal.toFixed(fine ? 1 : 0)}`;

  layoutYNeighbors(pct);
}

/* Same fixed-offset docking approach the old X-slider neighbor layout used
   (before it became a read-only viewer), just vertical:
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

  const { below, above } = getSliderNeighbors("ss", ySliderState.mode, ySliderState.p);

  // below-value → lower on screen (larger px); above-value → higher (smaller px)
  const belowPx = clampNeighborPx(centerPx + offset, centerPx, +1, minGap, half, 0, h);
  const abovePx = clampNeighborPx(centerPx - offset, centerPx, -1, minGap, half, 0, h);

  document.getElementById("yslider-neighbor-below").style.top = belowPx + "px";
  document.getElementById("yslider-neighbor-above").style.top = abovePx + "px";

  paintNeighbor("yslider-neighbor-below", "yslider-neighbor-below-label", "yslider-neighbor-below-canvas", below, "ss");
  paintNeighbor("yslider-neighbor-above", "yslider-neighbor-above-label", "yslider-neighbor-above-canvas", above, "ss");
}

function ySliderPFromClientY(clientY) {
  const rect = document.getElementById("yslider-track").getBoundingClientRect();
  let frac = (clientY - rect.top) / rect.height;
  frac = Math.max(0, Math.min(1, frac));
  return 10 - frac * 20;
}

function ySliderPointerDown(e) {
  e.preventDefault();
  // Section 7.3: capture on the wrap, which spans the full rail height
  // and a generous width, instead of the thin 6px visual rail.
  const wrap = document.getElementById("yslider-track-wrap");
  wrap.setPointerCapture(e.pointerId);
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
  const { selfishScore, selflessScore } = ssModalValues(ySliderState.mode);
  ySliderState.p = ssToP(selfishScore, selflessScore);
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
// Commits the live-dragged p back into modalSelfishScore/modalSelflessScore
// (or the alt pair) and refreshes the compact slider — this is the "keep
// both in sync" open-decision: the full-screen slider and the compact
// slider are two views onto the same modal state, not two separate values.
function applyYSlider() {
  const { selfishScore, selflessScore } = pToSs(ySliderState.p);
  if (ySliderState.mode === "alt") {
    modalAltSelfishScore  = selfishScore;
    modalAltSelflessScore = selflessScore;
    updateAltSelfishSelflessDisplay();
  } else {
    modalSelfishScore  = selfishScore;
    modalSelflessScore = selflessScore;
    updateSelfishSelflessDisplay();
  }
  closeYSlider();
}

/* ═══════════════════════════════════════
   HEROES CHANGE NOTIFIER
   (Renamed in spirit from the old localStorage
   "saveLocal" — GitHub is the only place heroes
   actually get saved now. This just tells the
   Draft panel the in-memory roster changed.)
═══════════════════════════════════════ */
function saveLocal() {
  hasUnsavedChanges = true;
  updateTaxonomySaveReminder();
  window.dispatchEvent(new CustomEvent("chartHeroesUpdated"));
}

// Shows/hides the teal reminder banner at the top of the Performance
// Ranking overlay based on hasUnsavedChanges. Safe to call any time —
// no-ops if the overlay's markup isn't there for some reason.
function updateTaxonomySaveReminder() {
  const el = document.getElementById("taxonomy-ranking-save-reminder");
  if (!el) return;
  el.style.display = hasUnsavedChanges ? "flex" : "none";
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
    if (action === "taxonomy") { editSessionUnlocked = true; openTaxonomyManager(); return; }
    if (action === "import") { editSessionUnlocked = true; triggerImportFilePicker(); return; }
    if (action === "edit-hero") {
      editSessionUnlocked = true;
      if (detailsHeroId !== null) {
        const h = heroes.find(x => x.id === detailsHeroId);
        if (h) { closeHeroDetails(); openEditModal(h); }
      }
      return;
    }
  }

  const label = action === "save" ? "save" : action === "load" ? "load" : action === "add-hero" ? "add a hero" : action === "taxonomy" ? "manage Reactions/Engagements/Factors" : action === "import" ? "import a save file" : "edit this hero";
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
  // For edit/add/import actions, verify password via a lightweight server ping
  if (pendingAdminAction === "edit-hero" || pendingAdminAction === "add-hero" || pendingAdminAction === "taxonomy" || pendingAdminAction === "import") {
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
    } else if (pendingAdminAction === "taxonomy") {
      openTaxonomyManager();
    } else if (pendingAdminAction === "import") {
      triggerImportFilePicker();
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
// GitHub is now the ONLY source for heroes and draft data — there is no
// local copy to merge with anymore, so whatever comes back here simply
// becomes the app's state.
async function autoLoadFromServer() {
  try {
    const res = await fetch("https://e7-chart.vercel.app/api/public-load", { method: "GET" });
    if (!res.ok) return; // silently fail — page just stays empty until retried
    const data = await res.json();

    // Reaction/Engagement/Factor library (Section 1.1) — a third key
    // alongside heroes/draftData in the same GitHub-backed blob.
    // Normalized *before* heroes below so Section 10.2's dangling-ref
    // cleanup has the real library to check against.
    taxonomy = normalizeTaxonomy(data.taxonomy);

    if (Array.isArray(data.heroes)) {
      const migrated = migrateHeroTypes(data.heroes);
      heroes = cleanDanglingTaxonomyRefs(migrated, taxonomy);
      saveLocal(); // notifies Draft panel, no browser storage involved
      // The page just opened with exactly what's on GitHub — not a
      // local edit, so it shouldn't trip the unsaved-changes reminder.
      hasUnsavedChanges = false;
      updateTaxonomySaveReminder();
      renderAll();
    }

    // Draft-only data (buffs/debuffs/roles/etc) also comes from GitHub now,
    // instead of localStorage — see window.chartDraftData above.
    if (data.draftData) {
      window.chartDraftData = data.draftData;
    }

    applyLoadedSavedAt(data); // "Last saved" reflects the true GitHub timestamp on page open, not "not saved this session"

    if (isLegacySchema(data)) {
      console.info("[e7-chart] Loaded a pre-Schema-v2 save (Rebuild Spec Section 10) — heroes were migrated through the Section 2 legacy path and flagged \u201cneeds re-rating\u201d where applicable.");
    }
  } catch {
    // Network error — page stays empty; user can retry with the Load button
  }
}

/* ═══════════════════════════════════════
   EXPORT / IMPORT SCHEMA v2 (Rebuild Spec Section 10)

   Everything the rebuild added (taxonomy library, reactions/
   engagements, selfish/selfless scores) needs to round-trip through
   both the GitHub save/load path (Section 1.3/E — see saveToServer/
   loadFromServer/autoLoadFromServer below) and the local file-based
   Export/Import path added here. Both paths share the same three
   pieces of machinery defined in this block:
     - SCHEMA_VERSION / isLegacySchema — tell a current blob apart
       from one written before this field existed.
     - cleanDanglingTaxonomyRefs — a hero's reactions[]/engagements[]
       can reference a refId that doesn't exist in whichever taxonomy
       library is being loaded alongside it (deleted item, or a file
       that only ever had a partial/no taxonomy). Dangling refs are
       dropped and the hero is flagged the same way an unrated legacy
       import is (Section 2.2) rather than silently left pointing at
       nothing.
     - mergeTaxonomyAdditive — the same "never overwrites, only adds
       what you don't already have" contract heroes import already
       uses (see importHeroesMergeOnly), applied to the taxonomy
       library so importing a shared taxonomy file can't clobber
       anything already tagged locally.
═══════════════════════════════════════ */
const SCHEMA_VERSION = 2;

// A blob "is legacy" if it has no schemaVersion at all (predates
// Section 10) or an older one than current. This is a coarse,
// whole-file signal used for status messages / logging; the actual
// per-hero migration still runs unconditionally via migrateHeroTypes
// below, since isLegacyHeroShape is a safety net even a currently-
// stamped blob could technically fail (e.g. a hand-edited file).
function isLegacySchema(data) {
  return !data || typeof data.schemaVersion !== "number" || data.schemaVersion < SCHEMA_VERSION;
}

// Section 10.2 — strips any reaction/engagement refId not present in
// `tax` from every hero in `list`, flagging affected heroes the same
// way a fresh legacy import is flagged. Heroes with no dangling refs
// are returned unchanged (same object identity) so callers that rely
// on reference equality elsewhere aren't disturbed.
function cleanDanglingTaxonomyRefs(list, tax) {
  if (!Array.isArray(list)) return list;
  const reactionIds   = new Set((tax?.reactions   || []).map(x => x.id));
  const engagementIds = new Set((tax?.engagements || []).map(x => x.id));
  return list.map(h => {
    const origReactions   = Array.isArray(h.reactions)   ? h.reactions   : [];
    const origEngagements = Array.isArray(h.engagements) ? h.engagements : [];
    // Normalize each entry to { refId } as we go — accepts older exports
    // that stored a bare refId number or a { refId, score } object.
    const reactions   = origReactions
      .filter(r => reactionIds.has(r?.refId ?? r))
      .map(r => ({ refId: r?.refId ?? r }));
    const engagements = origEngagements
      .filter(e => engagementIds.has(e?.refId ?? e))
      .map(e => ({ refId: e?.refId ?? e }));
    if (reactions.length === origReactions.length && engagements.length === origEngagements.length) return h;
    return { ...h, reactions, engagements, needsRerating: true };
  });
}

// Section 10.1 — additive-only merge for the taxonomy library, mirroring
// heroes import: an incoming Reaction/Engagement/Factor is added only if
// its id isn't already present locally; anything already here is left
// untouched (no rename/re-tag from an imported file).
function mergeTaxonomyAdditive(current, incoming) {
  const mergeList = (kind) => {
    const existingIds = new Set(current[kind].map(x => x.id));
    const toAdd = (incoming?.[kind] || []).filter(x => x && x.id !== undefined && !existingIds.has(x.id));
    return [...current[kind], ...toAdd];
  };
  return {
    reactions:   mergeList("reactions"),
    engagements: mergeList("engagements"),
    factors:     mergeList("factors"),
  };
}

// Downloads the current roster + taxonomy library as a standalone
// Schema v2 JSON file — the file-based counterpart to the GitHub Save
// button, for off-server backups or sharing a taxonomy/roster with
// someone else to Import (below). Read-only with respect to the
// server, so unlike Save/Load/Import this isn't gated behind the
// admin password — it only ever reads what's already visible via the
// public-load endpoint.
function exportToFile() {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    heroes,
    taxonomy,
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `e7-chart-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("✅ Export downloaded");
}

/* ═══════════════════════════════════════
   IMPORT (merge-only, never overwrites)
   Lets you pull heroes in from an old export
   or a downloaded save file without touching
   anything already in your current roster.
═══════════════════════════════════════ */
function triggerImportFilePicker() {
  const input = document.getElementById("import-file-input");
  if (input) input.click();
}

// A hero "already exists" if its id matches OR its name+rarity+role match
// (case/whitespace-insensitive) — covers re-imports where the id changed
// (e.g. across two different exports) as well as true duplicates.
function heroIdentityKey(h) {
  return [h.name, h.rarity, h.role]
    .map(v => String(v ?? "").trim().toLowerCase())
    .join("|");
}

function importHeroesMergeOnly(importedHeroes, taxonomyAddedCount = 0) {
  if (!Array.isArray(importedHeroes)) {
    setStatus("❌ That file doesn't contain a heroes list");
    return;
  }

  const existingIds  = new Set(heroes.map(h => h.id));
  const existingKeys = new Set(heroes.map(heroIdentityKey));

  const toAdd = [];
  let skipped = 0;

  importedHeroes.forEach(h => {
    if (!h || typeof h !== "object") return;
    const idMatch  = h.id !== undefined && h.id !== null && existingIds.has(h.id);
    const keyMatch = existingKeys.has(heroIdentityKey(h));
    if (idMatch || keyMatch) { skipped++; return; }

    // Assign a fresh id if this one is missing or collides with something
    // already in the roster (or already queued from earlier in this same
    // file) — never reuse/overwrite an existing hero's id.
    let id = h.id;
    if (id === undefined || id === null || existingIds.has(id) || toAdd.some(x => x.id === id)) {
      id = Date.now() + Math.floor(Math.random() * 1e6);
    }

    toAdd.push({ ...h, id });
    existingKeys.add(heroIdentityKey(h)); // guard against dupes within the same file
  });

  const taxonomyNote = taxonomyAddedCount > 0
    ? ` and ${taxonomyAddedCount} taxonomy item${taxonomyAddedCount === 1 ? "" : "s"}`
    : "";

  if (toAdd.length === 0) {
    setStatus(skipped > 0
      ? `⚠️ Nothing new — all ${skipped} hero${skipped === 1 ? "" : "es"} in that file are already in your roster` + taxonomyNote
      : "⚠️ No heroes found in that file" + taxonomyNote);
    return;
  }

  // Section 10.2 — run incoming heroes through the same legacy-shape
  // migration a server load gets (migrateHeroTypes), then drop any
  // reaction/engagement refId that isn't in the (possibly just-merged,
  // see handleImportedFile) current taxonomy library, flagging affected
  // heroes as needing re-rating rather than leaving a dangling link.
  const migratedToAdd = migrateHeroTypes(toAdd);
  const cleanedToAdd  = cleanDanglingTaxonomyRefs(migratedToAdd, taxonomy);

  heroes = [...heroes, ...cleanedToAdd];
  saveLocal();
  renderAll();
  setStatus(`✅ Imported ${toAdd.length} hero${toAdd.length === 1 ? "" : "es"}${taxonomyNote}` +
    (skipped ? ` (skipped ${skipped} already in your roster)` : ""));
}

// Section 10.1 — orchestrates a local file Import: the file may carry
// a heroes list, a taxonomy library, both (a full export from
// exportToFile above), or just a standalone taxonomy blob (no heroes
// key at all) for sharing a Reaction/Engagement/Factor set on its own.
function handleImportedFile(parsed) {
  const isBareHeroArray = Array.isArray(parsed);
  const importedHeroes   = isBareHeroArray ? parsed : (Array.isArray(parsed?.heroes) ? parsed.heroes : null);
  const importedTaxonomy = !isBareHeroArray && parsed?.taxonomy && typeof parsed.taxonomy === "object"
    ? parsed.taxonomy
    : null;

  if (!importedHeroes && !importedTaxonomy) {
    setStatus("❌ That file doesn't contain heroes or a taxonomy library");
    return;
  }

  let taxonomyAddedCount = 0;
  if (importedTaxonomy) {
    const countOf = (t) => t.reactions.length + t.engagements.length + t.factors.length;
    const before = countOf(taxonomy);
    taxonomy = mergeTaxonomyAdditive(taxonomy, normalizeTaxonomy(importedTaxonomy));
    taxonomyAddedCount = countOf(taxonomy) - before;
    saveLocal();
    renderTaxonomyPanel("reactions");
    renderFactorsPanel();
    renderQdFactorChips();
    if (typeof renderHeroFactorsButton === "function") renderHeroFactorsButton(); // keep Hero Factors' button/grid in sync with the Enemy Factors state it reads
  }

  if (importedHeroes) {
    importHeroesMergeOnly(importedHeroes, taxonomyAddedCount);
  } else if (taxonomyAddedCount > 0) {
    setStatus(`✅ Imported ${taxonomyAddedCount} taxonomy item${taxonomyAddedCount === 1 ? "" : "s"}`);
  } else {
    setStatus("⚠️ Nothing new — that taxonomy is already in your library");
  }
}

/* ── "Last saved" indicator (header ⓘ) ──
   lastSavedAt/serverSavedAt are declared at the very top of this file
   (see the comment there for why) — this is just their display logic.
   Click toggles a small popup showing the actual date/time, rather
   than relying on hover (which doesn't work on touch devices at all).
   A small dot on the ⓘ itself flags out-of-sync data even before the
   popup is opened, since that's the state someone actually needs to
   notice and act on. */
function updateLastSavedIndicator() {
  const btn = document.getElementById("last-saved-info-btn");
  if (!btn) return;
  btn.title = lastSavedAt ? `Last saved ${lastSavedAt.toLocaleString()}` : "Not saved yet this session";
  btn.classList.toggle("stale", isDataStale());

  // If the popup happens to already be open (e.g. a background sync
  // check just resolved while someone was looking at it), refresh its
  // text — and reposition, in case the text length/window size changed
  // since it opened — instead of leaving it stale or possibly misaligned.
  const popup = document.getElementById("last-saved-popup");
  if (popup && popup.style.display === "block") {
    renderLastSavedPopup(popup);
    positionLastSavedPopup();
  }
}

// True once we've actually confirmed GitHub has something newer than
// what this tab loaded/saved — i.e. someone saved from elsewhere (a
// different browser/device) while this tab stayed open and unrefreshed.
// A ~2s tolerance absorbs normal network round-trip slack between the
// client's and server's clocks for the "we just saved/loaded this
// exact version" case, without being loose enough to miss a real
// external change (which will always differ by far more than 2s).
function isDataStale() {
  if (!lastSavedAt || !serverSavedAt) return false; // nothing to compare yet
  return serverSavedAt.getTime() - lastSavedAt.getTime() > 2000;
}

function renderLastSavedPopup(popup) {
  const dateLine = lastSavedAt
    ? `Last saved: ${lastSavedAt.toLocaleString()}`
    : "Not saved yet this session.";

  let statusLine = "";
  let statusClass = "";
  if (isDataStale()) {
    statusLine = "⚠️ Refresh browser — updates have been made.";
    statusClass = "stale";
  } else if (lastSavedAt && serverSavedAt) {
    statusLine = "✅ Latest data is in sync. Free to save over.";
    statusClass = "synced";
  }
  // If we simply haven't checked the server yet (serverSavedAt still
  // null — e.g. offline, or the very first paint before autoLoad
  // resolves), show only the date line rather than guessing.

  popup.innerHTML = `
    <div class="last-saved-date-line">${dateLine}</div>
    ${statusLine ? `<div class="last-saved-status-line ${statusClass}">${statusLine}</div>` : ""}
  `;
}

// Pulls the persisted savedAt timestamp (see saveToServer's payload)
// out of a loaded blob, if present. Used by both the explicit Load
// button and the automatic load-on-page-open, so "Last saved" reflects
// when the data was truly last saved — even across a refresh or a
// brand-new tab — rather than resetting to "not saved this session"
// the moment the page reloads.
function applyLoadedSavedAt(data) {
  if (!data || !data.savedAt) return;
  const d = new Date(data.savedAt);
  if (isNaN(d.getTime())) return; // malformed/missing — leave lastSavedAt as-is
  lastSavedAt = d;
  // Whatever we just loaded IS, by definition, what's currently on
  // GitHub — so this also answers the sync-status question with
  // certainty, no need to wait for the next periodic check.
  serverSavedAt = d;
  updateLastSavedIndicator();
}

// Background check: is GitHub's stored data still what this tab has
// loaded/saved, or has someone saved a newer version from elsewhere
// (a different browser/device) while this tab stayed open? Read-only —
// deliberately never applies the fetched heroes/taxonomy/draftData to
// the live app state, since that would silently discard any
// in-progress unsaved edits. Only the timestamp is used.
let syncCheckInFlight = false;
async function checkSyncStatus() {
  if (syncCheckInFlight || document.hidden) return; // skip while backgrounded — nothing to show anyone right now
  syncCheckInFlight = true;
  try {
    const res = await fetch("https://e7-chart.vercel.app/api/saved-at");
    const data = await res.json();
    if (data && data.savedAt) {
      const d = new Date(data.savedAt);
      if (!isNaN(d.getTime())) serverSavedAt = d;
    }
  } catch {
    // Offline/network hiccup — leave serverSavedAt as it was rather
    // than falsely flagging "out of sync" from a failed check.
  } finally {
    syncCheckInFlight = false;
    updateLastSavedIndicator();
  }
}

// Anchors the popup under the ⓘ button using fixed viewport coordinates
// (not CSS position:absolute) so it can never run off the left/right
// edge of the screen regardless of where the button ends up sitting in
// the header's flex-wrap — it used to be pinned to the wrap's right
// edge, which pushed it past the left edge of a narrow phone screen
// once the button moved further right, next to Save.
function positionLastSavedPopup() {
  const btn = document.getElementById("last-saved-info-btn");
  const popup = document.getElementById("last-saved-popup");
  if (!btn || !popup) return;

  const r = btn.getBoundingClientRect();
  const popupWidth = popup.offsetWidth || 220;

  // Prefer right-aligned under the button (its usual look), but clamp
  // both edges so it always stays fully on-screen either way.
  let left = r.right - popupWidth;
  left = Math.max(8, Math.min(left, window.innerWidth - popupWidth - 8));

  popup.style.left = `${left}px`;
  popup.style.top  = `${r.bottom + 6}px`;
}

function toggleLastSavedPopup() {
  const popup = document.getElementById("last-saved-popup");
  if (!popup) return;
  const opening = popup.style.display === "none" || !popup.style.display;
  if (!opening) { popup.style.display = "none"; return; }
  renderLastSavedPopup(popup);
  popup.style.display = "block";
  positionLastSavedPopup(); // real width only known once it's actually visible
  checkSyncStatus(); // opening the popup is also a good moment to double-check
}

async function saveToServer(password) {
  setStatus("⏳ Saving…", 0);
  try {
    // Always include the current draftData too — the server overwrites
    // whatever's on GitHub with exactly what's sent, so leaving this out
    // would silently wipe your buffs/debuffs/roles/etc every time you hit
    // Save from the main chart (rather than from inside the Draft panel).
    const res = await fetch("https://e7-chart.vercel.app/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        heroes,
        draftData: window.chartDraftData || null,
        taxonomy,
        password,
      }),
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
    // save.js returns the exact timestamp it just wrote to GitHub —
    // trust that over any client-side guess, since a guess taken before
    // the request went out could drift from what's actually stored by
    // however long the round trip took.
    lastSavedAt = data.savedAt ? new Date(data.savedAt) : new Date();
    // We just wrote this exact value ourselves, so there's no need to
    // wait for the next periodic sync check to confirm it — we already
    // know with certainty that GitHub now matches what this tab has.
    serverSavedAt = lastSavedAt;
    updateLastSavedIndicator();
    // Everything in memory just made it to GitHub, so there's nothing
    // left unsaved — clears the Ranking overlay's reminder banner too,
    // whether this save came from Quick Save or the header's ↑ Save.
    hasUnsavedChanges = false;
    updateTaxonomySaveReminder();
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
      // Section 10.2 — taxonomy normalized first so dangling-ref
      // cleanup below has the real library to check heroes against.
      taxonomy = normalizeTaxonomy(data.taxonomy);
      const migrated = migrateHeroTypes(data.heroes);
      heroes = cleanDanglingTaxonomyRefs(migrated, taxonomy);
      saveLocal();
      // A fresh load from GitHub is in sync by definition — overrides
      // the dirty flag saveLocal() just set above.
      hasUnsavedChanges = false;
      updateTaxonomySaveReminder();
      renderAll();
      if (data.draftData) window.chartDraftData = data.draftData;
      applyLoadedSavedAt(data); // the actual last-saved time, not "not saved this session"
      setStatus(isLegacySchema(data) ? "✅ Loaded from GitHub (legacy format — migrated)" : "✅ Loaded from GitHub");
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

// Let Draft (and app.js's own hero-details panel) read/write the live
// draft-only data (buffs, debuffs, roles, etc). Populated from GitHub by
// autoLoadFromServer() below and kept in memory only — never persisted to
// the browser. The Draft panel calls the setter whenever it changes
// something so app.js's non-Draft views (e.g. hero details) stay current.
let _chartDraftData = null;
Object.defineProperty(window, "chartDraftData", {
  get: () => _chartDraftData,
  set: (val) => {
    _chartDraftData = val;
    window.dispatchEvent(new CustomEvent("chartDraftDataUpdated"));
  },
});

// Let the (future) Reaction/Engagement/Factor editor UI (Section 5) and
// Quick Draft's Factor checklist (Section 8) read/write the live
// taxonomy library the same way chartHeroes/chartDraftData work above.
Object.defineProperty(window, "chartTaxonomy", {
  get: () => taxonomy,
  set: (val) => {
    taxonomy = normalizeTaxonomy(val);
    saveLocal();
    window.dispatchEvent(new CustomEvent("chartTaxonomyUpdated"));
  },
});
