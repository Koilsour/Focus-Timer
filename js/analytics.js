/**
 * analytics.js — Lazy-loaded analytics engine
 *
 * Optimizations:
 * - All computations deferred until analytics panel opens
 * - Precomputed cache for Today / 7d / Week / Month totals
 * - DOM fragments built once and only updated when data changes
 * - Monthly chart rendered only when visible
 */

// ── Date helpers ──────────────────────────────────────────────────────────────

export function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function calculateStreak(daily = {}) {
  const today = new Date();
  const todayKey = dateKey(today);
  
  let checkDate = new Date(today);
  let streak = 0;

  const todaySecs = daily[todayKey] || 0;
  
  if (todaySecs > 0) {
    while (true) {
      const k = dateKey(checkDate);
      if ((daily[k] || 0) > 0) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }
  } else {
    checkDate.setDate(checkDate.getDate() - 1);
    while (true) {
      const k = dateKey(checkDate);
      if ((daily[k] || 0) > 0) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }
  }

  return streak;
}

function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = x.getDay() === 0 ? -6 : 1 - x.getDay();
  x.setDate(x.getDate() + diff);
  return x;
}

function sumRange(daily, startDate, endDate) {
  let total = 0;
  const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  while (d <= end) {
    total += daily[dateKey(d)] || 0;
    d.setDate(d.getDate() + 1);
  }
  return total;
}

export function formatStudyTime(seconds) {
  seconds = Math.max(0, Math.round(seconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function monthTotal(daily, key) {
  const [y, m] = key.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  let total = 0;
  for (let day = 1; day <= days; day++) {
    total += daily[`${key}-${String(day).padStart(2, "0")}`] || 0;
  }
  return total;
}

function availableMonths(daily) {
  const keys = Object.keys(daily || {});
  const set = new Set(keys.map(k => k.slice(0, 7)));
  set.add(monthKey(new Date()));
  return [...set].sort().reverse();
}

// ── Precomputed cache ──────────────────────────────────────────────────────────

let _cache = null;

function buildCache(analytics) {
  const daily = analytics?.daily || {};
  const today = new Date();
  const sevenStart = new Date(today); sevenStart.setDate(today.getDate() - 6);
  const weekStart = startOfWeek(today);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);

  return {
    today: daily[dateKey(today)] || 0,
    sevenDays: sumRange(daily, sevenStart, today),
    thisWeek: sumRange(daily, weekStart, weekEnd),
    thisMonth: monthTotal(daily, monthKey(today)),
    weekStart,
    weekEnd,
    months: availableMonths(daily),
    daily,
  };
}

export function invalidateCache() { _cache = null; }

function getCache(analytics) {
  if (!_cache) _cache = buildCache(analytics);
  return _cache;
}

// ── Session accumulator ────────────────────────────────────────────────────────

// Badges Configuration
export const BADGES = [
  // Hours Badges
  { id: 'h_novice', name: 'Deep Work Novice', type: 'hours', target: 10, icon: '🥉', desc: '10 hours of focus' },
  { id: 'h_apprentice', name: 'Apprentice', type: 'hours', target: 50, icon: '🥈', desc: '50 hours of focus' },
  { id: 'h_practitioner', name: 'Practitioner', type: 'hours', target: 100, icon: '🥇', desc: '100 hours of focus' },
  { id: 'h_scholar', name: 'Scholar', type: 'hours', target: 250, icon: '💎', desc: '250 hours of focus' },
  { id: 'h_grandmaster', name: 'Grandmaster', type: 'hours', target: 500, icon: '👑', desc: '500 hours of focus' },
  { id: 'h_legend', name: 'Legend', type: 'hours', target: 1000, icon: '🌟', desc: '1000 hours of focus' },
  // Streak Badges
  { id: 's_7', name: '1-Week Streak', type: 'streak', target: 7, icon: '🔥', desc: '7 consecutive days' },
  { id: 's_14', name: '2-Week Streak', type: 'streak', target: 14, icon: '🔥', desc: '14 consecutive days' },
  { id: 's_30', name: '1-Month Streak', type: 'streak', target: 30, icon: '🔥', desc: '30 consecutive days' },
  { id: 's_180', name: '6-Month Streak', type: 'streak', target: 180, icon: '🔥', desc: '180 consecutive days' }
];

export function getTotalLifetimeSeconds(daily = {}) {
  return Object.values(daily).reduce((sum, secs) => sum + secs, 0);
}

// Accumulates focus-mode seconds in memory and merges to daily on flush
let _sessionSeconds = 0;

export function accumulateFocusSecond() {
  _sessionSeconds++;
}

/**
 * Flush accumulated session seconds into analytics.daily
 * Returns true if any seconds were flushed.
 */
export function flushSession(analytics) {
  if (_sessionSeconds <= 0) return false;
  if (!analytics.daily) analytics.daily = {};
  const k = dateKey(new Date());
  analytics.daily[k] = (analytics.daily[k] || 0) + _sessionSeconds;
  _sessionSeconds = 0;
  _cache = null; // invalidate cache
  return true;
}

// ── DOM helpers ────────────────────────────────────────────────────────────────

function setText(id, text) {
  const el = document.getElementById(id);
  if (el && el.textContent !== text) el.textContent = text;
}

// ── Rendering ──────────────────────────────────────────────────────────────────

export function renderAnalytics(analytics) {
  const cache = getCache(analytics);

  // Stat cards
  setText("analyticsToday", formatStudyTime(cache.today));
  setText("analytics7Days", formatStudyTime(cache.sevenDays));
  setText("analyticsThisWeek", formatStudyTime(cache.thisWeek));
  setText("analyticsThisMonth", formatStudyTime(cache.thisMonth));

  setText("analyticsTodaySub",
    cache.today
      ? `${Math.floor(cache.today / 60)} focused minutes recorded`
      : "Start a Focus session to build today's total"
  );
  setText("analyticsWeekRange",
    `${cache.weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} — ` +
    `${cache.weekEnd.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
  );
  setText("analyticsMonthSub", new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" }));

  // Month select
  const sel = document.getElementById("analyticsMonthSelect");
  const prev = sel.value;
  sel.innerHTML = cache.months.map(k => `<option value="${k}">${monthLabel(k)}</option>`).join("");
  sel.value = cache.months.includes(prev) ? prev : monthKey(new Date());

  renderDailyChart(cache.daily);
  renderWeeklyHistory(cache.daily);
  renderSelectedMonth(cache.daily, sel.value);
}

function renderDailyChart(daily) {
  const chart = document.getElementById("dailyChart");
  if (!chart) return;
  const today = new Date();
  const items = [];
  let max = 1;
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const seconds = daily[dateKey(d)] || 0;
    max = Math.max(max, seconds);
    items.push({ d, seconds });
  }
  const frag = document.createDocumentFragment();
  items.forEach(({ d, seconds }) => {
    const height = Math.max(3, Math.round(seconds / max * 100));
    const col = document.createElement("div");
    col.className = "day-col";
    col.title = `${d.toLocaleDateString()} — ${formatStudyTime(seconds)}`;
    col.innerHTML = `
      <div class="day-bar-wrap"><div class="day-bar" style="height:${height}%"></div></div>
      <div class="day-hours">${formatStudyTime(seconds)}</div>
      <div class="day-date">${d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 3)}</div>`;
    frag.appendChild(col);
  });
  chart.replaceChildren(frag);
}

function renderWeeklyHistory(daily) {
  const list = document.getElementById("weeklyList");
  if (!list) return;
  const today = new Date();
  const currentStart = startOfWeek(today);
  const weeks = [];
  let max = 1;
  for (let i = 5; i >= 0; i--) {
    const s = new Date(currentStart); s.setDate(currentStart.getDate() - i * 7);
    const e = new Date(s); e.setDate(s.getDate() + 6);
    const seconds = sumRange(daily, s, e);
    max = Math.max(max, seconds);
    weeks.push({ s, e, seconds, i });
  }
  const frag = document.createDocumentFragment();
  weeks.forEach(({ s, e, seconds, i }) => {
    const row = document.createElement("div");
    row.className = "week-row";
    const label = i === 0 ? "This week" : i === 1 ? "Last week" : `Week ${6 - i}`;
    row.innerHTML = `
      <div class="week-name">
        ${label}
        <span class="week-range">${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} — ${e.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
      </div>
      <div class="week-progress"><span style="width:${Math.max(2, seconds / max * 100)}%"></span></div>
      <div class="week-hours">${formatStudyTime(seconds)}</div>`;
    frag.appendChild(row);
  });
  list.replaceChildren(frag);
}

export function renderSelectedMonth(daily, key) {
  const [y, m] = key.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  let total = 0;
  let max = 1;
  let focusedDays = 0;
  let bestSeconds = 0;
  let bestDate = null;
  const totals = [];

  for (let day = 1; day <= days; day++) {
    const k = `${key}-${String(day).padStart(2, "0")}`;
    const seconds = daily[k] || 0;
    totals.push(seconds);
    total += seconds;
    if (seconds > 0) focusedDays++;
    if (seconds > bestSeconds) { bestSeconds = seconds; bestDate = new Date(y, m - 1, day); }
    max = Math.max(max, seconds);
  }

  setText("monthlyChartTitle", `${monthLabel(key)} activity`);
  setText("monthlyReportSubtitle", `${focusedDays} day${focusedDays === 1 ? "" : "s"} with recorded focus`);

  // Month bars
  const barsEl = document.getElementById("monthlyBars");
  const labelsEl = document.getElementById("monthlyLabels");
  if (barsEl) {
    const frag = document.createDocumentFragment();
    totals.forEach((seconds, idx) => {
      const h = Math.max(3, Math.round(seconds / max * 100));
      const bar = document.createElement("div");
      bar.className = "month-bar";
      bar.title = `${monthLabel(key)} ${idx + 1} — ${formatStudyTime(seconds)}`;
      bar.innerHTML = `<span style="height:${h}%"></span>`;
      frag.appendChild(bar);
    });
    barsEl.replaceChildren(frag);
  }
  if (labelsEl) {
    const frag = document.createDocumentFragment();
    totals.forEach((_, idx) => {
      const span = document.createElement("span");
      span.textContent = ((idx + 1) % 5 === 0 || idx === 0) ? String(idx + 1) : "";
      frag.appendChild(span);
    });
    labelsEl.replaceChildren(frag);
  }

  const avg = days ? total / days : 0;
  setText("reportTotal", formatStudyTime(total));
  setText("reportAverage", avg >= 3600 ? formatStudyTime(avg) : `${Math.round(avg / 60)}m`);
  setText("reportDays", String(focusedDays));
  setText("reportBest", bestDate ? formatStudyTime(bestSeconds) : "—");
  const bestEl = document.getElementById("reportBest");
  if (bestEl) bestEl.title = bestDate ? bestDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
}
