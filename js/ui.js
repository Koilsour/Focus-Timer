/**
 * ui.js — DOM manager, background switcher, minimal diff updates
 *
 * Key optimizations:
 * - Cache DOM references at startup
 * - Only update DOM nodes when values actually change
 * - SVG ring uses stroke-dashoffset for smooth, GPU-composited progress
 * - Background images are external file URLs (not base64)
 * - No backdrop-filter on non-modal elements
 */

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const $q = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const els = {
  time:         null,
  ringProgress: null,
  startBtn:     null,
  startText:    null,
  smallIcon:    null,
  sessionText:  null,
  focusCount:   null,
  shortCount:   null,
  longCount:    null,
  streak:       null,
  quote:        null,
  bgContainer:  null,
  tabs:         [],
};

// SVG ring geometry
const CIRCUMFERENCE = 2 * Math.PI * 46; // r=46, matching the SVG

/** Cache all DOM references — call once at startup */
export function initDOM() {
  els.time         = $("time");
  els.ringProgress = $("ringProgress");
  els.startBtn     = $("startBtn");
  els.startText    = $("startText");
  els.smallIcon    = $q(".small-icon");
  els.sessionText  = $("sessionText");
  els.focusCount   = $("focusCount");
  els.shortCount   = $("shortCount");
  els.longCount    = $("longCount");
  els.streak       = $("streak");
  els.quote        = $("quote");
  els.bgContainer  = $("bgContainer");
  els.tabs         = $$(".tab");

  if (els.ringProgress) {
    els.ringProgress.style.strokeDasharray = CIRCUMFERENCE;
    els.ringProgress.style.strokeDashoffset = CIRCUMFERENCE;
  }
}

// ── Diff helpers ──────────────────────────────────────────────────────────────

function setTextIfChanged(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

// ── Timer display ──────────────────────────────────────────────────────────────

export function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

let _lastTimeStr = "";
let _lastPercent = -1;
let _lastMode = "";
let _lastRunning = null;

export function updateTimerDisplay(remainingSec, totalSec, mode, running, counts, streak) {
  const timeStr = formatTime(remainingSec);
  if (timeStr !== _lastTimeStr) {
    setTextIfChanged(els.time, timeStr);
    _lastTimeStr = timeStr;

    // Update page title
    document.title = `${timeStr} — ${mode === "focus" ? "Focus" : mode === "stopwatch" ? "Stopwatch" : "Break"}`;
  }

  // SVG ring progress
  if (mode === "stopwatch") {
    if (els.ringProgress) els.ringProgress.classList.add("spinning");
  } else {
    if (els.ringProgress) els.ringProgress.classList.remove("spinning");
    const percent = totalSec > 0 ? 100 * (1 - remainingSec / totalSec) : 0;
    if (Math.abs(percent - _lastPercent) >= 0.5) {
      const offset = CIRCUMFERENCE * (1 - percent / 100);
      if (els.ringProgress) els.ringProgress.style.strokeDashoffset = String(offset);
      _lastPercent = percent;
    }
  }

  // Session text
  if (mode !== _lastMode) {
    const label = mode === "focus" ? "Focus session" 
                : mode === "short" ? "Short break" 
                : mode === "stopwatch" ? "Stopwatch focus"
                : "Long break";
    setTextIfChanged(els.sessionText, label);

    // Tab active states
    els.tabs.forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
    _lastMode = mode;
  }

  // Button state
  if (running !== _lastRunning) {
    setTextIfChanged(els.startText, running ? "PAUSE" : "START");
    setTextIfChanged(els.smallIcon, running ? "Ⅱ" : "▶");
    _lastRunning = running;
  }

  // Counts & streak
  setTextIfChanged(els.focusCount, String(counts.focus));
  setTextIfChanged(els.shortCount, String(counts.short));
  setTextIfChanged(els.longCount, String(counts.long));
  
  if (els.streak && els.streak.textContent !== String(streak)) {
    els.streak.textContent = String(streak);
    const badge = els.streak.closest(".session-badge");
    if (badge) {
      badge.classList.remove("pop");
      void badge.offsetWidth;
      badge.classList.add("pop");
    }
  }
}

export function resetRingCache() {
  _lastTimeStr = "";
  _lastPercent = -1;
  _lastMode = "";
  _lastRunning = null;
}

// ── Background ─────────────────────────────────────────────────────────────────

const BG_IMAGES = {
  city:   "assets/images/city.webp",
  castle: "assets/images/castle.webp",
};

const BG_THUMBS = {
  city:   "assets/images/city_thumb.webp",
  castle: "assets/images/castle_thumb.webp",
};

let _currentBg = null;

export function applyBackground(name) {
  if (!BG_IMAGES[name]) name = "city";
  if (name === _currentBg) return;
  _currentBg = name;

  const bgContainer = els.bgContainer || $("bgContainer");
  if (bgContainer) {
    bgContainer.style.backgroundImage =
      `linear-gradient(180deg,rgba(4,7,8,.42) 0%,rgba(4,7,8,.56) 52%,rgba(4,7,8,.80) 100%), url("${BG_IMAGES[name]}")`;
  }

  // Update thumbnail active states in settings
  $$(".background-option").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.background === name);
  });
}

export function getBgThumb(name) {
  return BG_THUMBS[name] || BG_THUMBS.city;
}

// ── Toast ──────────────────────────────────────────────────────────────────────

let _toastTimer = null;

export function showToast(msg) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

// ── Panels / overlay ───────────────────────────────────────────────────────────

export function openPanel(panelId) {
  $("overlay")?.classList.add("open");
  $(panelId)?.classList.add("open");
}

export function closeAllPanels() {
  $("overlay")?.classList.remove("open");
  $("musicDrawer")?.classList.remove("open");
  $("settingsModal")?.classList.remove("open");
  $("achievementsModal")?.classList.remove("open");
}

export function openAnalyticsPage() {
  closeAllPanels();
  $("analyticsPage")?.classList.add("open");
}

export function closeAnalyticsPage() {
  $("analyticsPage")?.classList.remove("open");
}

// ── Achievements ───────────────────────────────────────────────────────────────

export function renderAchievements(lifetimeSeconds, currentStreak, badges) {
  const lifetimeHours = Math.floor(lifetimeSeconds / 3600);
  const displayHours = (lifetimeSeconds / 3600).toLocaleString(undefined, { maximumFractionDigits: 1 });
  
  const $hoursGrid = $("hoursBadgesGrid");
  const $streakGrid = $("streakBadgesGrid");
  const $lifetimeHours = $("lifetimeHours");
  const $currentStreak = $("currentStreak");

  if (!$hoursGrid || !$streakGrid) return;

  $lifetimeHours.textContent = displayHours;
  $currentStreak.textContent = currentStreak;

  let hoursHtml = "";
  let streakHtml = "";

  badges.forEach(badge => {
    let earned = false;
    let progress = 0;

    if (badge.type === "hours") {
      earned = lifetimeHours >= badge.target;
      progress = Math.min(100, Math.round((lifetimeHours / badge.target) * 100));
      const html = `
        <div class="badge-card ${earned ? 'earned' : 'locked'}">
          <span class="badge-icon">${badge.icon}</span>
          <div class="badge-name">${badge.name}</div>
          <div class="badge-desc">${badge.desc}</div>
        </div>
      `;
      hoursHtml += html;
    } else if (badge.type === "streak") {
      earned = currentStreak >= badge.target;
      progress = Math.min(100, Math.round((currentStreak / badge.target) * 100));
      const html = `
        <div class="badge-card ${earned ? 'earned' : 'locked'}">
          <span class="badge-icon">${badge.icon}</span>
          <div class="badge-name">${badge.name}</div>
          <div class="badge-desc">${badge.desc}</div>
        </div>
      `;
      streakHtml += html;
    }
  });

  $hoursGrid.innerHTML = hoursHtml;
  $streakGrid.innerHTML = streakHtml;
}
