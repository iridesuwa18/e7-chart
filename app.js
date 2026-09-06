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
  factors:     [], // [{ id, name }]
};

function newTaxonomyId() {
  return Date.now() + Math.floor(Math.random() * 1e6);
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
        ...(Array.isArray(x.factorIds) ? { factorIds: x.factorIds.slice() } : { factorIds: [] }),
      }))
    : [];
  return {
    reactions:   cleanList(t.reactions).map(x => ({ id: x.id, name: x.name, factorIds: x.factorIds })),
    engagements: cleanList(t.engagements).map(x => ({ id: x.id, name: x.name, factorIds: x.factorIds })),
    factors:     (Array.isArray(t.factors) ? t.factors : [])
      .filter(x => x && typeof x === "object" && x.id !== undefined)
      .map(x => ({ id: x.id, name: typeof x.name === "string" ? x.name : "" })),
  };
}

/* ── Reactions / Engagements CRUD ──
   `kind` is "reactions" or "engagements". */
function addTaxonomyItem(kind, name) {
  const item = { id: newTaxonomyId(), name: String(name || "").trim(), factorIds: [] };
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

// Deleting a Reaction/Engagement also strips it from every hero that
// referenced it (Section 5 DoD: "cleanly un-links from all heroes").
function deleteTaxonomyItem(kind, id) {
  taxonomy = { ...taxonomy, [kind]: taxonomy[kind].filter(x => x.id !== id) };
  const heroField = kind === "reactions" ? "reactions" : "engagements";
  heroes = heroes.map(h => {
    if (!Array.isArray(h[heroField]) || !h[heroField].some(r => r.refId === id)) return h;
    return { ...h, [heroField]: h[heroField].filter(r => r.refId !== id) };
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
  };
  saveLocal();
}

/* ── Factors CRUD ── */
function addFactor(name) {
  const item = { id: newTaxonomyId(), name: String(name || "").trim() };
  taxonomy = { ...taxonomy, factors: [...taxonomy.factors, item] };
  saveLocal();
  return item;
}

function renameFactor(id, name) {
  taxonomy = { ...taxonomy, factors: taxonomy.factors.map(f => f.id === id ? { ...f, name: String(name || "").trim() } : f) };
  saveLocal();
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

/* ── Per-hero assignment ──
   Attaches/updates/removes a hero's link to a library Reaction or
   Engagement. Removing a link never touches the library item itself. */
function setHeroTaxonomyScore(heroId, kind, refId, score) {
  const clamped = Math.max(0, Math.min(10, Number(score) || 0));
  heroes = heroes.map(h => {
    if (h.id !== heroId) return h;
    const list = Array.isArray(h[kind]) ? h[kind] : [];
    const exists = list.some(x => x.refId === refId);
    const nextList = exists
      ? list.map(x => x.refId === refId ? { ...x, score: clamped } : x)
      : [...list, { refId, score: clamped }];
    return { ...h, [kind]: nextList };
  });
  saveLocal();
}

function removeHeroTaxonomyLink(heroId, kind, refId) {
  heroes = heroes.map(h => {
    if (h.id !== heroId) return h;
    return { ...h, [kind]: (Array.isArray(h[kind]) ? h[kind] : []).filter(x => x.refId !== refId) };
  });
  saveLocal();
}

/* ── Derived scores (Section 1.2) ──
   Live averages — never stored redundantly, always computed off the
   hero's current reactions[]/engagements[] so they can't drift out of
   sync with the underlying per-item scores. Returns null when the
   hero holds none of that kind (0 would be indistinguishable from a
   genuinely bad score). */
function computeReactionScore(h) {
  const list = Array.isArray(h?.reactions) ? h.reactions : [];
  if (list.length === 0) return null;
  const sum = list.reduce((acc, r) => acc + (Math.max(0, Math.min(10, Number(r.score) || 0))), 0);
  return +(sum / list.length).toFixed(1);
}

function computeEngageScore(h) {
  const list = Array.isArray(h?.engagements) ? h.engagements : [];
  if (list.length === 0) return null;
  const sum = list.reduce((acc, e) => acc + (Math.max(0, Math.min(10, Number(e.score) || 0))), 0);
  return +(sum / list.length).toFixed(1);
}

// Look up a taxonomy item's display name from either library by id —
// used anywhere a hero's reactions/engagements need to render as text
// instead of a bare refId (roster cards, editor UI, tooltips).
function taxonomyName(kind, id) {
  const item = taxonomy[kind]?.find(x => x.id === id);
  return item ? item.name : "(deleted)";
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

// The hero edit modal's in-progress Reactions/Engagements assignment
// (Rebuild Spec Section 5.3) — same batching pattern as the Selfish/
// Selfless state above: arrays of { refId, score }, local to the modal
// session until Add/Save Changes commits them onto the hero.
let modalReactions   = [];
let modalEngagements = [];
let modalAltReactions   = [];
let modalAltEngagements = [];

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
const QD_SELFLESS_TARGET = 3;
const QD_SELFISH_TARGET  = 2;
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
  document.getElementById("taxonomy-overlay").addEventListener("click", e => {
    if (e.target === document.getElementById("taxonomy-overlay")) closeTaxonomyManager();
  });
  document.querySelectorAll(".taxonomy-tab").forEach(btn => {
    btn.addEventListener("click", () => switchTaxonomyTab(btn.dataset.tab));
  });
  document.getElementById("taxonomy-add-reaction").addEventListener("click", () => {
    const input = document.getElementById("taxonomy-new-reaction");
    if (!input.value.trim()) return;
    addTaxonomyItem("reactions", input.value);
    input.value = "";
    renderTaxonomyPanel("reactions");
    renderRteSection();
  });
  document.getElementById("taxonomy-new-reaction").addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("taxonomy-add-reaction").click();
  });
  document.getElementById("taxonomy-add-engagement").addEventListener("click", () => {
    const input = document.getElementById("taxonomy-new-engagement");
    if (!input.value.trim()) return;
    addTaxonomyItem("engagements", input.value);
    input.value = "";
    renderTaxonomyPanel("engagements");
    renderRteSection();
  });
  document.getElementById("taxonomy-new-engagement").addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("taxonomy-add-engagement").click();
  });
  document.getElementById("taxonomy-add-factor").addEventListener("click", () => {
    const input = document.getElementById("taxonomy-new-factor");
    if (!input.value.trim()) return;
    addFactor(input.value);
    input.value = "";
    renderFactorsPanel();
    renderQdFactorChips(); // Section 8.1 checklist — new Factor shows up immediately
  });
  document.getElementById("taxonomy-new-factor").addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("taxonomy-add-factor").click();
  });

  // Per-hero Reaction/Engagement assignment (Section 5.3), inside the hero edit modal
  document.getElementById("rte-add-reaction-btn").addEventListener("click", () => addRteItem("reactions", "main"));
  document.getElementById("rte-add-engagement-btn").addEventListener("click", () => addRteItem("engagements", "main"));
  document.getElementById("alt-rte-add-reaction-btn").addEventListener("click", () => addRteItem("reactions", "alt"));
  document.getElementById("alt-rte-add-engagement-btn").addEventListener("click", () => addRteItem("engagements", "alt"));

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
// Ghost/alt-stat equivalents — open-decision answer was "extend ghost
// mode to the new axes", so altStats now also carries its own
// selfishScore/selflessScore/reactions/engagements, independent of the
// primary build's (see modalAltSelfishScore etc. further down).
function heroAltXAxis(h) {
  const src = h.altStats || {};
  const r = Math.max(0, Math.min(10, computeReactionScore(src) || 0));
  const e = Math.max(0, Math.min(10, computeEngageScore(src) || 0));
  return r >= e ? { side: "REACTION", value: r } : { side: "ENGAGE", value: e };
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
  for (let i = 0; i < uptoIdx; i++) {
    const raw = draftArr[i];
    if (raw === null || raw === undefined) continue;
    const parsed = qdParsePick(raw);
    const hero = heroes.find(h => h.id === parsed.heroId);
    if (!hero) continue;
    const entry = qdSimpleScoreEntry(hero, parsed.variant);
    perSlot.push({
      index: i, heroId: parsed.heroId, hero, variant: parsed.variant,
      score: entry ? entry.score : 0,
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
       be used for the next slot to still hit 3 Selfless + 2 Selfish by
       the time the team is full, or null once both quotas are already
       met (no further restriction) or nothing's actually forcing a
       specific side yet (both still have slack — see below).
═══════════════════════════════════════ */
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

// Which side (if any) the NEXT empty slot in draftArr must fill to still
// land on 3 Selfless + 2 Selfish once the team's full. Returns null when
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
    if (side === "selfless") selflessCount++;
    else if (side === "selfish") selfishCount++;
    // "neutral" (unrated) picks count toward neither quota — they're an
    // edge case (see Section 2's "needs re-rating" flag) that shouldn't
    // normally reach Autofill, but shouldn't silently distort the ratio
    // math if one does.
  });

  const selflessNeeded = Math.max(0, QD_SELFLESS_TARGET - selflessCount);
  const selfishNeeded  = Math.max(0, QD_SELFISH_TARGET  - selfishCount);

  if (selflessNeeded === 0 && selfishNeeded === 0) return null; // both quotas already hit
  if (selflessNeeded >= slotsLeft) return "selfless"; // no room left to NOT pick Selfless every remaining slot
  if (selfishNeeded  >= slotsLeft) return "selfish";  // same, for Selfish
  return selflessNeeded >= selfishNeeded ? "selfless" : "selfish";
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
function qdOverallKitScore(h, variant) {
  const reactions   = variant === "ghost" ? (h.altStats?.reactions   || []) : (h.reactions   || []);
  const engagements = variant === "ghost" ? (h.altStats?.engagements || []) : (h.engagements || []);
  const all = [...reactions, ...engagements];
  if (all.length === 0) return 0;
  const sum = all.reduce((acc, r) => acc + Math.max(0, Math.min(10, Number(r.score) || 0)), 0);
  return +(sum / all.length).toFixed(1);
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
  const candidateHeroes = heroes.filter(h => !usedHeroIds.has(h.id) && !qdIsBannedByCompetitive(h));

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

  // Ban Protect bucket first (0 = counters it, 1 = neutral, 2 = the
  // element Ban Protect itself beats), best score second — exactly
  // Rule 1's old ordering, just applied over the plain score instead
  // of a quadrant-filtered one.
  entries.sort((a, b) => a._bucket - b._bucket || b.score - a.score);

  // Selfish/Selfless quota filter (Section 9 engine, unchanged) — same
  // "filter down, but relax back to the full list if that would empty
  // it" pattern the old Autofill/mould code already used.
  const requiredSide = qdRequiredSideForDraft(draftArr);
  if (requiredSide) {
    const sideMatches = entries.filter(e => qdHeroSide(e.hero, e.variant) === requiredSide);
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

// One candidate hero+variant pair, scored against every ticked Factor.
// Returns null when the hero/variant matches none of them, so callers
// can filter losers out with a simple `.filter(Boolean)`.
function qdFactorEntryForHero(h, variant) {
  const reactions   = variant === "ghost" ? (h.altStats?.reactions   || []) : (h.reactions   || []);
  const engagements = variant === "ghost" ? (h.altStats?.engagements || []) : (h.engagements || []);
  if (reactions.length === 0 && engagements.length === 0) return null;

  let score = 0;
  const matchedFactorIds = new Set();
  const matchReasons = [];

  qdTickedFactorIds.forEach(factorId => {
    const { reactions: taggedR, engagements: taggedE } = taxonomyItemsForFactor(factorId);
    const taggedRIds = new Set(taggedR.map(r => r.id));
    const taggedEIds = new Set(taggedE.map(e => e.id));

    // A hero can hold more than one Reaction/Engagement tagged to the
    // SAME Factor (e.g. two different counterattack answers) — take
    // only the single best-scoring one per Factor, so a hero isn't
    // rewarded twice for overlapping coverage of one ticked item. This
    // is what "ranked by their Reaction/Engage score for that specific
    // item (not their overall average)" (8.2) means in practice.
    let best = null;
    reactions.forEach(r => {
      if (!taggedRIds.has(r.refId)) return;
      const s = Math.max(0, Math.min(10, Number(r.score) || 0));
      if (!best || s > best.s) best = { s, name: taxonomyName("reactions", r.refId) };
    });
    engagements.forEach(e => {
      if (!taggedEIds.has(e.refId)) return;
      const s = Math.max(0, Math.min(10, Number(e.score) || 0));
      if (!best || s > best.s) best = { s, name: taxonomyName("engagements", e.refId) };
    });

    if (best) {
      matchedFactorIds.add(factorId);
      score += best.s;
      matchReasons.push(`🎯 ${taxonomyName("factors", factorId)} → ${best.name} (${best.s.toFixed(1)})`);
    }
  });

  if (matchedFactorIds.size === 0) return null;
  return {
    heroId: h.id, hero: h, variant,
    matchedCount: matchedFactorIds.size,
    score: +score.toFixed(1),
    reasons: [
      `Matches ${matchedFactorIds.size}/${qdTickedFactorIds.size} ticked Factor${qdTickedFactorIds.size === 1 ? "" : "s"}`,
      ...matchReasons,
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
   9.3 applies the same 3-Selfless/2-Selfish default (via
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
      const sideMatches = suggestions.filter(e => qdHeroSide(e.hero, e.variant) === requiredSide);
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
  const pool = heroes.filter(h => !usedHeroIds.has(h.id) && !qdIsBannedByCompetitive(h));
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

  const requiredSide = qdRequiredSideForDraft(quickDraft);
  let pool = scored;
  if (requiredSide) {
    const sideMatches = scored.filter(e => qdHeroSide(e.hero, e.variant) === requiredSide);
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

  // Reset the enemy Factor checklist too (Section 8.1) — same "new
  // draft, new enemy" reasoning as the Ban Protect element above.
  qdTickedFactorIds.clear();
  renderQdFactorChips();
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
  statsEl.innerHTML = `
    <span class="qd-stat">${filledCount}/5 Picked</span>
    <span class="qd-stat">Avg ${avgTxt}</span>`;

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
   Rendered fresh from the taxonomy library every time, since Factors
   are user-defined (unlike the fixed 5-element Ban Protect chips this
   sits next to, which can stay hardcoded in the HTML). Called on init,
   whenever the taxonomy Factors panel changes something (add/rename/
   delete — see renderFactorsPanel), and after Suggest re-renders so a
   freshly-ticked chip's state never drifts from qdTickedFactorIds. */
function renderQdFactorChips() {
  const wrap = document.getElementById("qd-factor-chips");
  if (!wrap) return;

  // Prune ticks pointing at a Factor that's since been deleted, so a
  // stale id can't silently keep affecting recommendations forever.
  [...qdTickedFactorIds].forEach(id => {
    if (!taxonomy.factors.some(f => f.id === id)) qdTickedFactorIds.delete(id);
  });

  if (taxonomy.factors.length === 0) {
    wrap.innerHTML = `<span class="qd-factor-empty">No Factors defined yet — add some in 🗂 Taxonomy.</span>`;
    return;
  }

  wrap.innerHTML = taxonomy.factors.map(f => `
    <button type="button" class="qd-factor-chip${qdTickedFactorIds.has(f.id) ? " active" : ""}" data-factor-id="${f.id}">${f.name || "(unnamed)"}</button>
  `).join("");

  wrap.querySelectorAll(".qd-factor-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const factorId = taxonomy.factors.find(f => String(f.id) === chip.dataset.factorId)?.id;
      if (factorId === undefined) return;
      if (qdTickedFactorIds.has(factorId)) qdTickedFactorIds.delete(factorId);
      else qdTickedFactorIds.add(factorId);
      chip.classList.toggle("active", qdTickedFactorIds.has(factorId));
      saveQuickDraftModeLocal();
      if (quickDraftSuggestOpen) renderQuickDraftSuggestions();
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
  return `
    <div class="qd-suggest-row${rank === 0 ? " best" : ""}" data-id="${s.heroId}" data-variant="${s.variant}">
      <div class="qd-suggest-portrait">${portrait}</div>
      <div class="qd-suggest-info">
        <div class="qd-suggest-name">${rank === 0 ? "👑 " : ""}${h.name || "Unnamed"}${nameSuffix}</div>
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
    // output by side (Section 8's Factor/quadrant ranking is untouched);
    // a "neutral" (unrated, see Section 2) hero shows in neither column.
    const selflessRows = scored.filter(s => qdHeroSide(s.hero, s.variant) === "selfless");
    const selfishRows  = scored.filter(s => qdHeroSide(s.hero, s.variant) === "selfish");
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
      <div class="det-field"><div class="det-field-label">SELFISH / SELFLESS</div><div class="det-field-value"><span class="det-score-pill">${vStr}</span></div></div>
      <div class="det-field"><div class="det-field-label">REACTION / ENGAGE</div><div class="det-field-value"><span class="det-score-pill">${hStr}</span></div></div>
      <div class="det-field det-field-full"><div class="det-field-label">NOTES</div><div class="det-field-value det-notes">${h.notes || '<span style="opacity:.45;font-style:italic">No notes.</span>'}</div></div>
    </div>
    ${h.altStats ? `
    <div style="margin-top:14px;padding:10px 12px;background:rgba(224,64,251,.07);border:1px solid rgba(224,64,251,.25);border-radius:5px;">
      <div style="font-family:'Cinzel',serif;font-size:9px;letter-spacing:.2em;color:#e040fb;margin-bottom:8px;">👻 SECONDARY STATS (GHOST)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div class="det-field"><div class="det-field-label">SELFISH / SELFLESS</div><div class="det-field-value"><span class="det-score-pill" style="border-color:rgba(224,64,251,.4);color:#e040fb;background:rgba(224,64,251,.1)">${(() => { const a = heroAltYAxis(h); return (a.value === 0 ? "Neutral" : (a.side === "SELFISH" ? "Selfish" : "Selfless")) + " " + a.value; })()}</span></div></div>
        <div class="det-field"><div class="det-field-label">REACTION / ENGAGE</div><div class="det-field-value"><span class="det-score-pill" style="border-color:rgba(224,64,251,.4);color:#e040fb;background:rgba(224,64,251,.1)">${(() => { const a = heroAltXAxis(h); return (a.side === "REACTION" ? "Reaction" : "Engage") + " " + a.value; })()}</span></div></div>
        <div class="det-field"><div class="det-field-label">GHOST AVG</div><div class="det-field-value"><span class="det-score-pill" style="border-color:rgba(224,64,251,.4);color:#e040fb;background:rgba(224,64,251,.1)">${heroAltDisplayAvg(h)}</span></div></div>
        <div class="det-field" style="border-color:rgba(224,64,251,.3);background:rgba(224,64,251,.06)"><div class="det-field-label" style="color:#e040fb">TOTAL AVG</div><div class="det-field-value"><span class="det-score-pill" style="border-color:rgba(224,64,251,.5);color:#f0a0ff;background:rgba(224,64,251,.18);font-size:13px">${+((xa.value + ya.value + heroAltXAxis(h).value + heroAltYAxis(h).value) / 4).toFixed(1)}</span></div></div>
      </div>
    </div>` : ""}
  `;

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
  updateSelfishSelflessDisplay();
  modalReactions   = [];
  modalEngagements = [];
  renderRteSection("main");
  // Ghost Selfish/Selfless + Reactions/Engagements
  modalAltSelfishScore  = 0;
  modalAltSelflessScore = 0;
  updateAltSelfishSelflessDisplay();
  modalAltReactions   = [];
  modalAltEngagements = [];
  renderRteSection("alt");
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
  updateSelfishSelflessDisplay();
  // Reactions/Engagements (Section 5.3) — clone so editing in the modal
  // never mutates the hero's array directly until Save Changes commits it.
  modalReactions   = Array.isArray(h.reactions)   ? h.reactions.map(x => ({ ...x }))   : [];
  modalEngagements = Array.isArray(h.engagements) ? h.engagements.map(x => ({ ...x })) : [];
  renderRteSection("main");
  // Ghost Selfish/Selfless + Reactions/Engagements
  modalAltSelfishScore  = typeof h.altStats?.selfishScore === "number" ? h.altStats.selfishScore : 0;
  modalAltSelflessScore = typeof h.altStats?.selflessScore === "number" ? h.altStats.selflessScore : 0;
  updateAltSelfishSelflessDisplay();
  modalAltReactions   = Array.isArray(h.altStats?.reactions)   ? h.altStats.reactions.map(x => ({ ...x }))   : [];
  modalAltEngagements = Array.isArray(h.altStats?.engagements) ? h.altStats.engagements.map(x => ({ ...x })) : [];
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

  // Alt / ghost stats — selfishScore/selflessScore/reactions/engagements
  // drive the ghost dot's chart position and Quick Draft's ghost-build
  // ranking alike now that the legacy vType/vScore/hType/hScore fields
  // are gone (Rebuild Spec Section 1 cleanup).
  const altEnabled = document.getElementById("f-alt-enabled").checked;
  const altStats = altEnabled ? {
    selfishScore:  modalAltSelfishScore,
    selflessScore: modalAltSelflessScore,
    reactions:   modalAltReactions.map(x => ({ ...x })),
    engagements: modalAltEngagements.map(x => ({ ...x })),
  } : null;

  // Selfish/Selfless (Section 3/4) — whatever the slider/Questionnaire
  // left in modalSelfishScore/modalSelflessScore for this modal session.
  const selfishScore  = modalSelfishScore;
  const selflessScore = modalSelflessScore;

  // Reactions/Engagements (Section 5.3) — whatever the assignment list
  // in this modal session ended up with (library refs never free text).
  const reactions   = modalReactions.map(x => ({ ...x }));
  const engagements = modalEngagements.map(x => ({ ...x }));

  if (editingId !== null) {
    heroes = heroes.map(h => h.id === editingId
      ? { ...h, name, rarity, role, element, notes, iconData, locked, pvpTag, altStats, selfishScore, selflessScore, reactions, engagements }
      : h
    );
  } else {
    heroes.push({
      id: Date.now(),
      name, rarity, role, element, notes, iconData,
      locked, pvpTag, altStats, selfishScore, selflessScore, reactions, engagements,
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
    ssAllyCount = 0;
    renderSsAllyCountButtons();
    renderSsAllyRows();
    updateSsSelflessPreview();
  }
}

function ssBackToChoose() {
  openQuestionnaireModal(ssTarget);
}

function renderSsSelfishChecklist() {
  const box = document.getElementById("ss-selfish-checklist");
  box.innerHTML = SELF_SKILLS.map(s => `
    <label class="ss-check-item">
      <input type="checkbox" class="ss-selfish-check" value="${s.id}" />
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
// count of distinct buffs granted (buffs are discrete, not a %).
// Each slider is paired with a live numeric readout since range inputs
// don't show their own value.
function ssAllyTypeRowHTML(type, label, max, unit) {
  return `
    <div class="ss-ally-type-row">
      <label class="ss-ally-type-label">${label}</label>
      <input type="range" class="ss-ally-type" data-type="${type}" min="0" max="${max}" step="1" value="0" />
      <span class="ss-ally-type-readout" data-readout-for="${type}">0${unit}</span>
    </div>`;
}

function renderSsAllyRows() {
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
  box.querySelectorAll(".ss-ally-type").forEach(input => {
    input.addEventListener("input", () => {
      const row = input.closest(".ss-ally-row");
      const readout = row.querySelector(`[data-readout-for="${input.dataset.type}"]`);
      const unit = input.dataset.type === "buff" ? "" : "%";
      readout.textContent = input.value + unit;
      updateSsSelflessPreview();
    });
  });
}

function ssCollectSupportedAllies() {
  return Array.from(document.querySelectorAll("#ss-ally-rows .ss-ally-row")).map(row => ({
    healing:   Number(row.querySelector('[data-type="healing"]').value) || 0,
    passive:   Number(row.querySelector('[data-type="passive"]').value) || 0,
    buffCount: Number(row.querySelector('[data-type="buff"]').value) || 0,
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
    if (isAlt) { modalAltSelfishScore = score; modalAltSelflessScore = 0; }
    else       { modalSelfishScore = score;    modalSelflessScore = 0; }
  } else if (ssPhase === "selfless") {
    const score = computeSelflessScore(ssCollectSupportedAllies());
    if (isAlt) { modalAltSelflessScore = score; modalAltSelfishScore = 0; }
    else       { modalSelflessScore = score;    modalSelfishScore = 0; }
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
   free text, always a { refId, score } pointing into the shared
   taxonomy library managed by the Section 5.1/5.2 Taxonomy Manager
   further down this file. Removing an assignment here only drops this
   hero's link; it never touches the library item itself.
═══════════════════════════════════════ */

// Re-renders both assigned lists, both "add" dropdowns, and the live
// Reaction/Engage score badges. Called on modal open and after every
// add/remove/score-edit so the three stay in sync with each other.
// target: "main" (default, primary hero — modalReactions/modalEngagements)
// or "alt" (ghost build — modalAltReactions/modalAltEngagements, Section 6
// open-decision "extend ghost mode to the new axes"). Same DOM structure,
// alt- prefixed ids (see the alt-rte-section markup in index.html).
function renderRteSection(target) {
  target = target || "main";
  renderRteAssignedList("reactions", target);
  renderRteAssignedList("engagements", target);
  renderRteAddSelect("reactions", target);
  renderRteAddSelect("engagements", target);
  updateRteScoreBadges(target);
}

function rteIdPrefix(target) { return target === "alt" ? "alt-rte-" : "rte-"; }

function rteListEl(kind, target) {
  return document.getElementById(rteIdPrefix(target) + (kind === "reactions" ? "reactions-list" : "engagements-list"));
}
function rteModalArray(kind, target) {
  if (target === "alt") return kind === "reactions" ? modalAltReactions : modalAltEngagements;
  return kind === "reactions" ? modalReactions : modalEngagements;
}
function setRteModalArray(kind, target, newArr) {
  if (target === "alt") {
    if (kind === "reactions") modalAltReactions = newArr; else modalAltEngagements = newArr;
  } else {
    if (kind === "reactions") modalReactions = newArr; else modalEngagements = newArr;
  }
}

function renderRteAssignedList(kind, target) {
  const list = rteModalArray(kind, target);
  const box = rteListEl(kind, target);
  if (!list.length) {
    box.innerHTML = `<div class="rte-empty-note">No ${kind} assigned yet.</div>`;
    return;
  }
  box.innerHTML = list.map(item => `
    <div class="rte-assigned-row" data-ref-id="${item.refId}">
      <span class="rte-assigned-name">${taxonomyName(kind, item.refId)}</span>
      <input type="number" class="rte-assigned-score" min="0" max="10" step="0.1" value="${item.score}" data-kind="${kind}" data-ref-id="${item.refId}" data-target="${target}" />
      <button type="button" class="rte-assigned-remove" data-kind="${kind}" data-ref-id="${item.refId}" data-target="${target}" title="Remove — does not delete the ${kind === "reactions" ? "Reaction" : "Engagement"} from the library">✕</button>
    </div>
  `).join("");
  box.querySelectorAll(".rte-assigned-score").forEach(input => {
    input.addEventListener("change", () => {
      updateRteScore(input.dataset.kind, Number(input.dataset.refId), input.value, input.dataset.target);
    });
  });
  box.querySelectorAll(".rte-assigned-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      removeRteItem(btn.dataset.kind, Number(btn.dataset.refId), btn.dataset.target);
    });
  });
}

// Populates the "+ Add a Reaction/Engagement…" dropdown with whatever's
// in the library that this hero doesn't already hold, so the same item
// can't be added twice from here.
function renderRteAddSelect(kind, target) {
  const prefix = rteIdPrefix(target);
  const select = document.getElementById(kind === "reactions" ? prefix + "add-reaction-select" : prefix + "add-engagement-select");
  const assignedIds = new Set(rteModalArray(kind, target).map(x => x.refId));
  const available = taxonomy[kind].filter(item => !assignedIds.has(item.id));
  const placeholder = `<option value="">+ Add ${kind === "reactions" ? "a Reaction" : "an Engagement"}…</option>`;
  select.innerHTML = placeholder + available.map(item => `<option value="${item.id}">${escAttr(item.name)}</option>`).join("");
}

function addRteItem(kind, target) {
  target = target || "main";
  const prefix = rteIdPrefix(target);
  const select = document.getElementById(kind === "reactions" ? prefix + "add-reaction-select" : prefix + "add-engagement-select");
  const scoreInput = document.getElementById(kind === "reactions" ? prefix + "add-reaction-score" : prefix + "add-engagement-score");
  const refId = Number(select.value);
  if (!select.value) return;
  const score = Math.max(0, Math.min(10, parseFloat(scoreInput.value) || 0));
  setRteModalArray(kind, target, [...rteModalArray(kind, target), { refId, score }]);
  scoreInput.value = "5";
  renderRteSection(target);
}

function removeRteItem(kind, refId, target) {
  setRteModalArray(kind, target, rteModalArray(kind, target).filter(x => x.refId !== refId));
  renderRteSection(target);
}

function updateRteScore(kind, refId, value, target) {
  const clamped = Math.max(0, Math.min(10, parseFloat(value) || 0));
  setRteModalArray(kind, target, rteModalArray(kind, target).map(x => x.refId === refId ? { ...x, score: clamped } : x));
  updateRteScoreBadges(target);
}

// Live preview of the derived Reaction/Engage Score (Section 1.2) —
// computed off whatever's currently in the modal, not yet saved.
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

// Taxonomy names are free text; a stray double-quote would otherwise
// break the `value="..."` attribute of the rename inputs below.
function escAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;");
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
  if (tab === "factors") renderFactorsPanel();
  else renderTaxonomyPanel(tab);
}

// Shared renderer for the Reactions and Engagements panels (5.1).
function renderTaxonomyPanel(kind) {
  const box = document.getElementById(kind === "reactions" ? "taxonomy-list-reactions" : "taxonomy-list-engagements");
  const items = taxonomy[kind];
  if (!items.length) {
    box.innerHTML = `<div class="taxonomy-empty-note">No ${kind} yet — add one above.</div>`;
    return;
  }
  box.innerHTML = items.map(item => `
    <div class="taxonomy-row" data-id="${item.id}">
      <div class="taxonomy-row-main">
        <input type="text" class="taxonomy-row-name" value="${escAttr(item.name)}" data-kind="${kind}" data-id="${item.id}" />
        <button type="button" class="btn btn-ghost btn-xs taxonomy-row-tagbtn" data-kind="${kind}" data-id="${item.id}">🏷 Factors (${item.factorIds.length})</button>
        <button type="button" class="taxonomy-row-delete" data-kind="${kind}" data-id="${item.id}" title="Delete — un-links from every hero that holds it">✕</button>
      </div>
      <div class="taxonomy-row-factors" id="taxonomy-factors-${kind}-${item.id}" style="display:none"></div>
    </div>
  `).join("");

  box.querySelectorAll(".taxonomy-row-name").forEach(input => {
    input.addEventListener("change", () => {
      renameTaxonomyItem(input.dataset.kind, Number(input.dataset.id), input.value);
      renderRteSection(); // reflects a rename immediately if the hero modal is open behind this one
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

function renderTaxonomyFactorChips(kind, id) {
  const row = document.getElementById(`taxonomy-factors-${kind}-${id}`);
  const item = taxonomy[kind].find(x => x.id === id);
  if (!item) return;
  if (!taxonomy.factors.length) {
    row.innerHTML = `<div class="taxonomy-empty-note">No Factors defined yet — add one in the Factors tab first.</div>`;
    return;
  }
  row.innerHTML = taxonomy.factors.map(f => `
    <button type="button" class="taxonomy-factor-chip${item.factorIds.includes(f.id) ? " tagged" : ""}" data-factor-id="${f.id}">${f.name}</button>
  `).join("");
  row.querySelectorAll(".taxonomy-factor-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const factorId = Number(chip.dataset.factorId);
      const nowTagged = item.factorIds.includes(factorId);
      if (nowTagged) untagFactor(kind, id, factorId);
      else tagFactor(kind, id, factorId);
      renderTaxonomyPanel(kind); // refresh the tag-count badge too
      toggleTaxonomyRowFactors(kind, id); // reopen it, expanded, post-refresh
    });
  });
}

// Factors panel (5.2) — plain create/rename/delete, no tagging UI here.
function renderFactorsPanel() {
  const box = document.getElementById("taxonomy-list-factors");
  if (!taxonomy.factors.length) {
    box.innerHTML = `<div class="taxonomy-empty-note">No Factors yet — add one above.</div>`;
    return;
  }
  box.innerHTML = taxonomy.factors.map(f => `
    <div class="taxonomy-row" data-id="${f.id}">
      <div class="taxonomy-row-main">
        <input type="text" class="taxonomy-row-name" value="${escAttr(f.name)}" data-id="${f.id}" />
        <button type="button" class="taxonomy-row-delete" data-id="${f.id}" title="Delete — un-tags it from every Reaction/Engagement">✕</button>
      </div>
    </div>
  `).join("");
  box.querySelectorAll(".taxonomy-row-name").forEach(input => {
    input.addEventListener("change", () => { renameFactor(Number(input.dataset.id), input.value); renderQdFactorChips(); });
  });
  box.querySelectorAll(".taxonomy-row-delete").forEach(btn => {
    btn.addEventListener("click", () => {
      const f = taxonomy.factors.find(x => x.id === Number(btn.dataset.id));
      if (!confirm(`Delete "${f?.name || ""}"? This un-tags it from every Reaction/Engagement.`)) return;
      deleteFactor(Number(btn.dataset.id));
      renderFactorsPanel();
      renderQdFactorChips(); // Section 8.1 checklist — drop the deleted Factor's chip too
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
   this just renders the current breakdown for whichever mode it's opened
   in ("main" = modalReactions/modalEngagements, "alt" = the ghost
   build's modalAltReactions/modalAltEngagements). */
function renderXSlider() {
  const isAlt = xSliderState.mode === "alt";
  const reactions   = isAlt ? modalAltReactions   : modalReactions;
  const engagements = isAlt ? modalAltEngagements : modalEngagements;

  const reactionScore = computeReactionScore({ reactions });
  const engageScore   = computeEngageScore({ engagements });

  document.getElementById("xslider-reaction-total").textContent = reactionScore === null ? "—" : reactionScore;
  document.getElementById("xslider-engage-total").textContent   = engageScore === null ? "—" : engageScore;

  const reactionList = document.getElementById("xslider-reaction-list");
  reactionList.innerHTML = reactions.length
    ? reactions.map(item => `<div style="display:flex;justify-content:space-between;color:var(--text-dim)"><span>${taxonomyName("reactions", item.refId)}</span><span>${item.score}</span></div>`).join("")
    : `<div style="color:var(--text-dim);font-style:italic">None assigned.</div>`;

  const engageList = document.getElementById("xslider-engage-list");
  engageList.innerHTML = engagements.length
    ? engagements.map(item => `<div style="display:flex;justify-content:space-between;color:var(--text-dim)"><span>${taxonomyName("engagements", item.refId)}</span><span>${item.score}</span></div>`).join("")
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
  window.dispatchEvent(new CustomEvent("chartHeroesUpdated"));
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
      renderAll();
    }

    // Draft-only data (buffs/debuffs/roles/etc) also comes from GitHub now,
    // instead of localStorage — see window.chartDraftData above.
    if (data.draftData) {
      window.chartDraftData = data.draftData;
    }

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
    const reactions   = origReactions.filter(r => reactionIds.has(r.refId));
    const engagements = origEngagements.filter(e => engagementIds.has(e.refId));
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
  }

  if (importedHeroes) {
    importHeroesMergeOnly(importedHeroes, taxonomyAddedCount);
  } else if (taxonomyAddedCount > 0) {
    setStatus(`✅ Imported ${taxonomyAddedCount} taxonomy item${taxonomyAddedCount === 1 ? "" : "s"}`);
  } else {
    setStatus("⚠️ Nothing new — that taxonomy is already in your library");
  }
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
      renderAll();
      if (data.draftData) window.chartDraftData = data.draftData;
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
