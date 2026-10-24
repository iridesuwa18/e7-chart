/* ═══════════════════════════════════════════════════════════════════
   HERO GRID — full-page popup showing every hero in a grid

   Opened from the "▦ Grid" button in the Roster header. It uses the
   roster's own filters (Rarity / Role / Element / Equipment, search and
   sort) — they are the SAME state as the sidebar's, so changing one here
   updates the roster and vice-versa. No Reactions / Engagements filters.
   Tapping a hero opens their equipment popup (hero-gear.js).

   Shares app.js's globals (filterRarity, filterRole, filterElement,
   filterEquip, rosterSort, rosterSearchQuery, rosterVisibleHeroes…).
═══════════════════════════════════════════════════════════════════ */

let hgrEl = null;

function hgrIsOpen() { return !!hgrEl && hgrEl.style.display !== "none"; }

function hgrEsc(str) {
  return String(str ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function hgrEnsure() {
  if (hgrEl) return hgrEl;
  const el = document.createElement("div");
  el.className = "qd-factor-menu-overlay hgr-overlay";
  el.id = "hero-grid-overlay";
  el.style.display = "none";
  el.innerHTML = `<div class="qd-factor-menu-panel hgr-panel" id="hero-grid-panel"></div>`;
  document.body.appendChild(el);
  hgrEl = el;
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || !hgrIsOpen()) return;
    // Don't close the grid out from under the equipment popup that sits above it.
    if (typeof hgEquipEl !== "undefined" && hgEquipEl && hgEquipEl.style.display !== "none") return;
    hgrClose();
  });
  return el;
}

function hgrOpen() {
  const el = hgrEnsure();
  hgrBuildPanel();
  el.style.display = "flex";
  document.body.classList.add("qd-factor-menu-open");
}

function hgrClose() {
  if (!hgrEl) return;
  hgrEl.style.display = "none";
  document.body.classList.remove("qd-factor-menu-open");
}

// Called from app.js's renderRoster() — keeps an open grid in step with the
// filters/hero list. Cheap no-op while closed.
function hgrRefreshIfOpen() {
  if (hgrIsOpen()) hgrRenderGrid();
}

// Make the sidebar's chips/pills/inputs reflect the shared filter state after
// a change made inside the popup.
function hgrSyncSidebar() {
  [["filter-rarity", filterRarity], ["filter-role", filterRole], ["filter-element", filterElement]].forEach(([id, set]) => {
    document.querySelectorAll(`#${id} .chip`).forEach(c => c.classList.toggle("active", set.has(c.dataset.val)));
  });
  document.querySelectorAll("#filter-equip-mode button").forEach(b => b.classList.toggle("on", b.dataset.mode === filterEquipMode));
  if (typeof hgRefreshEquipFilter === "function") hgRefreshEquipFilter(); // rebuilds equipment chips from filterEquip
}

function hgrChipGroupHTML(label, id, innerChips) {
  return `<div class="filter-group"><div class="filter-label">${label}</div><div class="filter-chips" id="${id}">${innerChips}</div></div>`;
}

// Controls are built once per open (so typing in the search box keeps focus);
// only the count + grid re-render as filters change.
function hgrBuildPanel() {
  const panel = document.getElementById("hero-grid-panel");

  // Reuse the sidebar's own chip markup so labels/values always match it.
  const cloneChips = (srcId, set) => {
    const src = document.getElementById(srcId);
    if (!src) return "";
    return [...src.querySelectorAll(".chip")].map(c =>
      `<button type="button" class="chip${set.has(c.dataset.val) ? " active" : ""}" data-val="${hgrEsc(c.dataset.val)}">${c.innerHTML}</button>`).join("");
  };
  const sortSrc = document.getElementById("roster-sort");
  const sortOptions = sortSrc
    ? [...sortSrc.options].map(o => `<option value="${hgrEsc(o.value)}"${o.value === rosterSort ? " selected" : ""}>${o.textContent}</option>`).join("")
    : `<option value="date-desc">Newest</option>`;

  const names = typeof hgUsedSetNames === "function" ? hgUsedSetNames() : new Map();
  const equipChips = names.size
    ? [...names.entries()].map(([k, n]) => `<button type="button" class="chip${filterEquip.has(k) ? " active" : ""}" data-val="${hgrEsc(k)}">${hgrEsc(n)}</button>`).join("")
    : `<div class="hg-pick-note">No gear sets yet — add some under 🛡 Hero Equipment and Artifacts.</div>`;

  panel.innerHTML = `
    <div class="qd-factor-menu-header">
      <div class="qd-factor-menu-title">▦ Hero Grid</div>
      <button type="button" class="qd-factor-menu-close" id="hgr-close" aria-label="Close">✕</button>
    </div>
    <div class="hf-scroll-body">
      <div class="hgr-top">
        <div class="qd-factor-menu-searchbar hgr-search">
          <input type="text" class="taxonomy-search qd-factor-menu-search" id="hgr-search" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="🔍 Search heroes…" value="${hgrEsc(rosterSearchQuery || "")}" />
        </div>
        <select id="hgr-sort" class="roster-mini-select" title="Sort">${sortOptions}</select>
      </div>
      <div class="filter-panel hgr-filters">
        ${hgrChipGroupHTML("RARITY", "hgr-rarity", cloneChips("filter-rarity", filterRarity))}
        ${hgrChipGroupHTML("ROLE", "hgr-role", cloneChips("filter-role", filterRole))}
        ${hgrChipGroupHTML("ELEMENT", "hgr-element", cloneChips("filter-element", filterElement))}
        <div class="filter-group">
          <div class="filter-label">EQUIPMENT
            <span class="hg-mode" id="hgr-equip-mode">
              <button type="button" class="hg-pill${filterEquipMode !== "any" ? " on" : ""}" data-mode="all" title="Hero must have every ticked gear set">Has all</button>
              <button type="button" class="hg-pill${filterEquipMode === "any" ? " on" : ""}" data-mode="any" title="Hero must have at least one ticked gear set">Has any</button>
            </span>
          </div>
          <div class="filter-chips" id="hgr-equip">${equipChips}</div>
        </div>
      </div>
      <div class="hf-count hgr-count" id="hgr-count"></div>
      <div class="hgr-grid" id="hgr-grid"></div>
    </div>`;

  document.getElementById("hgr-close").addEventListener("click", hgrClose);

  // Search + sort write through to the sidebar controls (so the roster stays in step).
  document.getElementById("hgr-search").addEventListener("input", e => {
    const v = e.target.value;
    const si = document.getElementById("roster-search");
    if (si) { si.value = v; si.dispatchEvent(new Event("input", { bubbles: true })); } // sidebar handler updates + re-renders
    else { rosterSearchQuery = v.trim(); renderRoster(); }
  });
  document.getElementById("hgr-sort").addEventListener("change", e => {
    rosterSort = e.target.value;
    const ss = document.getElementById("roster-sort");
    if (ss) ss.value = rosterSort;
    renderRoster();
  });

  // Rarity / Role / Element: same rule as the sidebar — can't untick the last one.
  [["hgr-rarity", filterRarity], ["hgr-role", filterRole], ["hgr-element", filterElement]].forEach(([id, set]) => {
    document.getElementById(id).addEventListener("click", e => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      const v = btn.dataset.val;
      if (set.has(v)) {
        if (set.size === 1) return;
        set.delete(v); btn.classList.remove("active");
      } else {
        set.add(v); btn.classList.add("active");
      }
      hgrSyncSidebar();
      renderRoster();
    });
  });

  // Equipment: nothing ticked = no filter (same as the sidebar's EQUIPMENT group).
  document.getElementById("hgr-equip").addEventListener("click", e => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    const v = btn.dataset.val;
    if (filterEquip.has(v)) filterEquip.delete(v); else filterEquip.add(v);
    btn.classList.toggle("active", filterEquip.has(v));
    hgrSyncSidebar();
    renderRoster();
  });
  document.querySelectorAll("#hgr-equip-mode button").forEach(btn => btn.addEventListener("click", () => {
    filterEquipMode = btn.dataset.mode === "any" ? "any" : "all";
    document.querySelectorAll("#hgr-equip-mode button").forEach(b => b.classList.toggle("on", b === btn));
    hgrSyncSidebar();
    renderRoster();
  }));

  // Tapping a tile opens that hero's equipment popup.
  document.getElementById("hgr-grid").addEventListener("click", e => {
    const tile = e.target.closest(".hgr-tile");
    if (!tile) return;
    const h = heroes.find(x => String(x.id) === tile.dataset.heroId);
    if (h && typeof openHeroEquipment === "function") openHeroEquipment(h);
  });

  hgrRenderGrid();
}

function hgrRenderGrid() {
  const grid = document.getElementById("hgr-grid");
  const count = document.getElementById("hgr-count");
  if (!grid) return;
  const list = rosterVisibleHeroes();
  if (count) count.textContent = `${list.length} of ${heroes.length} hero${heroes.length === 1 ? "" : "es"}`;
  if (!list.length) {
    grid.innerHTML = `<div class="hf-empty">${heroes.length ? "No heroes match these filters." : "No heroes yet."}</div>`;
    return;
  }
  grid.innerHTML = list.map(h => {
    const icon = h.iconData ? `<img src="${h.iconData}" alt="">` : `<div class="hf-tile-fallback hgr-fallback">⚔️</div>`;
    const sub = [h.role, h.element].filter(Boolean).join(" · ");
    return `<button type="button" class="hgr-tile" data-hero-id="${hgrEsc(h.id)}" title="${hgrEsc((h.name || "Unnamed Hero") + " — tap for equipment")}">
      ${icon}
      <span class="hgr-tile-name">${hgrEsc(h.name || "Unnamed")}</span>
      ${sub ? `<span class="hgr-tile-sub">${hgrEsc(sub)}</span>` : ""}
    </button>`;
  }).join("");
}

// "▦ Grid" button in the Roster header.
(function () {
  const btn = document.getElementById("btn-roster-grid");
  if (btn) btn.addEventListener("click", hgrOpen);
})();
