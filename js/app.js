/**
 * app.js — Main application entry point
 *
 * Wires together: TimerEngine, storage, audio, analytics, ui
 */

import { TimerEngine } from "./timer.js";
import { saveNow, saveLater, cancelPendingSave, loadState } from "./storage.js";
import { beep, applySound, setChannelVolume, initAudio, soundState, pauseAll, resumeAll, getMasterGainNode, getAudioContext } from "./audio.js";
import {
  renderAnalytics, renderSelectedMonth, accumulateFocusSecond,
  flushSession, dateKey, monthKey, invalidateCache, calculateStreak,
  getTotalLifetimeSeconds, BADGES
} from "./analytics.js";
import {
  initDOM, updateTimerDisplay, resetRingCache,
  applyBackground, getBgThumb, showToast,
  openPanel, closeAllPanels, openAnalyticsPage, closeAnalyticsPage, els,
  renderAchievements
} from "./ui.js";
import { initMindfulness, promptMindfulness } from "./mindfulness.js";

// ── State ──────────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = { focus: 25, short: 5, long: 15 };

const saved = loadState() || {};

const state = {
  mode:       saved.mode      || "focus",
  remaining:  saved.remaining ?? 25 * 60,   // seconds
  running:    false,
  settings:   { ...DEFAULT_SETTINGS, ...(saved.settings || {}) },
  counts:     { focus: 0, short: 0, long: 0, ...(saved.counts || {}) },
  streak:     0,
  master:     saved.master     ?? 0.55,
  background: saved.background || "city",
  analytics:  saved.analytics  || { daily: {} },
  perfMode:   saved.perfMode   || false,
  strictMode: saved.strictMode || false,
  microBreaks: saved.microBreaks ?? true,
  unlockedBadges: saved.unlockedBadges || [],
};

// Calculate active daily focus streak
state.streak = calculateStreak(state.analytics.daily);

// Validate remaining
if (!Number.isFinite(state.remaining) || state.remaining < 0) {
  state.remaining = state.mode === "stopwatch" ? 0 : state.settings[state.mode] * 60;
}

function duration(mode) { 
  if (mode === "stopwatch") return 0;
  return state.settings[mode] * 60; 
}

// ── Timer engine ───────────────────────────────────────────────────────────────

// Session-level focus-second accumulator (batch flush every 30s or on transition)
let _focusSecsThisTick = 0;
let _lastFlushTime = Date.now();

const engine = new TimerEngine(
  // onTick(remainingMs, remainingSec)
  (timeMs, timeSec) => {
    state.remaining = timeSec;

    // Accumulate focus seconds
    if (state.mode === "focus" || state.mode === "stopwatch") {
      accumulateFocusSecond();
      _focusSecsThisTick++;
    }

    // Flush analytics batch every 30 seconds
    const now = Date.now();
    if (now - _lastFlushTime >= 30000) {
      if (flushSession(state.analytics)) {
        saveLater(state, 0); // save immediately after flush
      }
      _lastFlushTime = now;
    }

    updateTimerDisplay(
      timeSec,
      duration(state.mode),
      state.mode,
      true,
      state.counts,
      state.streak
    );
  },
  // onComplete
  () => {
    state.running = false;
    finishSession();
  }
);

// ── Session logic ──────────────────────────────────────────────────────────────

function handleStrictFailure() {
  engine.stop();
  state.running = false;
  state.remaining = duration(state.mode); // Reset time
  state.streak = 0; // Penalize streak
  resetRingCache();
  updateTimerDisplay(state.remaining, duration(state.mode), state.mode, false, state.counts, state.streak);
  saveNow(state);
  showToast("Focus Guard: Session reset! Streak lost. ❌");
}

function startTimer() {
  if (engine.running) {
    if (state.strictMode && (state.mode === "focus" || state.mode === "stopwatch")) {
      if (!confirm("Strict Mode: Pausing will reset your session. Are you sure?")) {
        return;
      }
      handleStrictFailure();
      return;
    }
    // Pause
    const remainingMs = engine.pause();
    state.remaining = Math.ceil(remainingMs / 1000);
    state.running = false;
    flushSession(state.analytics);
    saveNow(state);
    updateTimerDisplay(state.remaining, duration(state.mode), state.mode, false, state.counts, state.streak);
  } else {
    // Start
    state.running = true;
    engine.start(state.remaining * 1000, state.mode === "stopwatch");
    _lastFlushTime = Date.now();
    updateTimerDisplay(state.remaining, duration(state.mode), state.mode, true, state.counts, state.streak);
  }
}

function resetTimer() {
  const wasRunning = engine.running;
  engine.stop();
  state.running = false;
  state.remaining = duration(state.mode);
  if (wasRunning) flushSession(state.analytics);
  resetRingCache();
  updateTimerDisplay(state.remaining, duration(state.mode), state.mode, false, state.counts, state.streak);
  saveNow(state);
}

function skipTimer() {
  const wasRunning = engine.running;
  engine.stop();
  state.running = false;
  if (wasRunning) flushSession(state.analytics);

  if (state.mode === "stopwatch") {
    // If skipping in stopwatch, treat it as finishing the session
    finishSession();
    return;
  }

  const next = state.mode === "focus" ? "short" : "focus";
  switchMode(next);
}

function switchMode(mode, autoStart = false) {
  engine.stop();
  state.mode = mode;
  state.remaining = mode === "stopwatch" ? 0 : duration(mode);
  state.running = false;
  resetRingCache();
  updateTimerDisplay(state.remaining, duration(mode), mode, false, state.counts, state.streak);
  if (autoStart) {
    state.running = true;
    engine.start(state.remaining * 1000, mode === "stopwatch");
    _lastFlushTime = Date.now();
    updateTimerDisplay(state.remaining, duration(mode), mode, true, state.counts, state.streak);
  }
  saveNow(state);
}

function finishSession() {
  // Flush any remaining session seconds
  flushSession(state.analytics);
  invalidateCache();

  if (state.mode === "focus" || state.mode === "stopwatch") {
    state.counts.focus++;
  } else {
    state.counts[state.mode]++;
  }

  // Recalculate daily streak from analytics history
  state.streak = calculateStreak(state.analytics.daily);

  // Check for newly unlocked badges
  if (state.mode === "focus" || state.mode === "stopwatch") {
    const lifetimeSeconds = getTotalLifetimeSeconds(state.analytics.daily);
    const lifetimeHours = Math.floor(lifetimeSeconds / 3600);
    let newBadge = null;

    BADGES.forEach(badge => {
      if (!state.unlockedBadges.includes(badge.id)) {
        let earned = false;
        if (badge.type === "hours" && lifetimeHours >= badge.target) earned = true;
        else if (badge.type === "streak" && state.streak >= badge.target) earned = true;

        if (earned) {
          state.unlockedBadges.push(badge.id);
          newBadge = badge;
        }
      }
    });

    if (newBadge) {
      setTimeout(() => showToast(`Achievement Unlocked: ${newBadge.name} ${newBadge.icon}!`), 3000);
    }
  }

  beep(state.master);
  showToast(`${state.mode === "focus" || state.mode === "stopwatch" ? "Focus" : "Break"} complete! 🎉`);

  const prevMode = state.mode;
  const next = (state.mode === "focus" || state.mode === "stopwatch")
    ? (state.counts.focus % 4 === 0 ? "long" : "short")
    : "focus";

  saveNow(state);
  
  if ((prevMode === "focus" || prevMode === "stopwatch") && state.microBreaks) {
    promptMindfulness(() => switchMode(next, true));
  } else {
    switchMode(next, true);
  }
}

// ── Event listeners ────────────────────────────────────────────────────────────

document.getElementById("startBtn").addEventListener("click", startTimer);
document.getElementById("resetBtn").addEventListener("click", resetTimer);
document.getElementById("skipBtn").addEventListener("click", skipTimer);

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => switchMode(btn.dataset.mode));
});

// ── Settings modal ─────────────────────────────────────────────────────────────

document.getElementById("settingsBtn").addEventListener("click", () => {
  document.getElementById("focusInput").value = state.settings.focus;
  document.getElementById("shortInput").value = state.settings.short;
  document.getElementById("longInput").value  = state.settings.long;
  
  document.getElementById("perfModeToggle").checked = state.perfMode;
  document.getElementById("perfModeToggle").setAttribute("aria-checked", String(state.perfMode));
  document.getElementById("perfModeToggle").classList.toggle("on", state.perfMode);
  
  document.getElementById("strictModeToggle").setAttribute("aria-checked", String(state.strictMode));
  document.getElementById("strictModeToggle").classList.toggle("on", state.strictMode);
  
  document.getElementById("microBreaksToggle").setAttribute("aria-checked", String(state.microBreaks));
  document.getElementById("microBreaksToggle").classList.toggle("on", state.microBreaks);
  
  openPanel("settingsModal");
});

document.getElementById("closeSettings").addEventListener("click", closeAllPanels);
document.getElementById("cancelSettings").addEventListener("click", closeAllPanels);

document.querySelectorAll(".preset-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const [f, s, l] = btn.dataset.preset.split(",").map(Number);
    document.getElementById("focusInput").value = f;
    document.getElementById("shortInput").value = s;
    document.getElementById("longInput").value = l;
  });
});

document.getElementById("saveSettings").addEventListener("click", () => {
  const vals = {
    focus: Math.max(1, Math.min(120, Number(document.getElementById("focusInput").value) || 25)),
    short: Math.max(1, Math.min(60,  Number(document.getElementById("shortInput").value) || 5)),
    long:  Math.max(1, Math.min(90,  Number(document.getElementById("longInput").value)  || 15)),
  };
  state.settings = vals;
  state.remaining = state.mode === "stopwatch" ? 0 : duration(state.mode);
  engine.stop();
  state.running = false;
  resetRingCache();
  updateTimerDisplay(state.remaining, duration(state.mode), state.mode, false, state.counts, state.streak);
  closeAllPanels();
  showToast("Timer settings saved");
  saveNow(state);
});

document.getElementById("resetDataBtn").addEventListener("click", () => {
  if (confirm("Are you sure you want to permanently delete all your focus data, streaks, and settings? This cannot be undone.")) {
    localStorage.removeItem("focusTimer_state");
    localStorage.removeItem("focusTimer_analytics");
    location.reload();
  }
});

// ── Toggles (Settings) ─────────────────────────────────────────────────────────

function setupToggle(id, stateKey, onChange) {
  const btn = document.getElementById(id);
  btn.addEventListener("click", (e) => {
    state[stateKey] = !state[stateKey];
    const val = state[stateKey];
    e.currentTarget.setAttribute("aria-checked", String(val));
    e.currentTarget.classList.toggle("on", val);
    if (onChange) onChange(val);
    saveNow(state);
  });
}

setupToggle("perfModeToggle", "perfMode", (val) => {
  document.body.classList.toggle("perf-mode", val);
});

setupToggle("strictModeToggle", "strictMode");
setupToggle("microBreaksToggle", "microBreaks");

// ── Background picker in settings ─────────────────────────────────────────────

document.querySelectorAll(".background-option").forEach(btn => {
  btn.addEventListener("click", () => {
    state.background = btn.dataset.background;
    applyBackground(state.background);
    saveNow(state);
  });
});

// ── Music drawer ───────────────────────────────────────────────────────────────

document.getElementById("musicBtn").addEventListener("click", () => openPanel("musicDrawer"));
document.getElementById("closeMusic").addEventListener("click", closeAllPanels);
document.getElementById("overlay").addEventListener("click", closeAllPanels);

// Master slider — see full implementation below (this duplicate is intentionally removed)

document.querySelectorAll(".sound-card").forEach(card => {
  const name = card.dataset.sound;
  const toggle = card.querySelector(".toggle");
  const slider = card.querySelector(".sound-slider");

  toggle.addEventListener("click", () => {
    const on = !soundState[name].on;
    toggle.classList.toggle("on", on);
    applySound(name, on, state.master);
  });

  slider.addEventListener("input", () => {
    setChannelVolume(name, Number(slider.value) / 100);
  });
});

// ── Master volume slider ───────────────────────────────────────────────────────

document.getElementById("masterSlider").addEventListener("input", (e) => {
  state.master = Number(e.target.value) / 100;
  document.getElementById("masterValue").textContent = e.target.value + "%";
  // Smooth gain ramp via Web Audio if context is already running
  const g = getMasterGainNode();
  const ctx = getAudioContext();
  if (g && ctx) g.gain.setTargetAtTime(state.master, ctx.currentTime, 0.05);
  saveLater(state, 2000);
});

// ── Analytics ──────────────────────────────────────────────────────────────────

document.getElementById("tasksBtn").addEventListener("click", () => {
  // Flush any in-progress session seconds before showing analytics
  if (engine.running) flushSession(state.analytics);
  openAnalyticsPage();
  renderAnalytics(state.analytics);
});

document.getElementById("closeAnalytics").addEventListener("click", closeAnalyticsPage);

document.getElementById("analyticsMonthSelect").addEventListener("change", (e) => {
  renderSelectedMonth(state.analytics.daily || {}, e.target.value);
});

// ── Achievements ───────────────────────────────────────────────────────────────

document.getElementById("achievementsBtn").addEventListener("click", () => {
  if (engine.running) flushSession(state.analytics);
  const lifetime = getTotalLifetimeSeconds(state.analytics.daily);
  renderAchievements(lifetime, state.streak, BADGES);
  openPanel("achievementsModal");
});
document.getElementById("closeAchievements").addEventListener("click", closeAllPanels);

// ── Fullscreen ─────────────────────────────────────────────────────────────────

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (e) {
    showToast("Fullscreen not available in this browser");
  }
}
document.getElementById("fullscreenBtn").addEventListener("click", toggleFullscreen);

// ── Quote rotator ──────────────────────────────────────────────────────────────

const QUOTES = [
  "\u201cThe secret of getting ahead is getting started.\u201d",
  "\u201cDo something today that your future self will thank you for.\u201d",
  "\u201cSmall steps every day become extraordinary results.\u201d",
  "\u201cConcentrate all your thoughts upon the work at hand.\u201d",
  "\u201cThe expert in anything was once a beginner.\u201d",
  "\u201cFocus is the bridge between dreaming and doing.\u201d",
];
let _qIdx = Math.floor(Math.random() * QUOTES.length);
document.getElementById("quote").textContent = QUOTES[_qIdx];
document.getElementById("challengeBtn").addEventListener("click", () => {
  _qIdx = (_qIdx + 1) % QUOTES.length;
  document.getElementById("quote").textContent = QUOTES[_qIdx];
});

document.getElementById("aboutBtn").addEventListener("click", () => {
  showToast("Focus Timer · Space = start/pause · F = fullscreen · Esc = close");
});

// ── Keyboard shortcuts ─────────────────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  const tag = document.activeElement?.tagName;
  if (e.code === "Space" && !["INPUT", "TEXTAREA", "SELECT"].includes(tag)) {
    e.preventDefault();
    startTimer();
  }
  if (e.key.toLowerCase() === "f") toggleFullscreen();
  if (e.key === "Escape") {
    closeAnalyticsPage();
    closeAllPanels();
  }
});

// ── Visibility — pause audio & analytics flush when tab hidden ─────────────────

document.addEventListener("visibilitychange", () => {
  engine.handleVisibility(document.hidden);
  
  if (document.hidden) {
    pauseAll();
    if (engine.running) {
      if (state.strictMode && (state.mode === "focus" || state.mode === "stopwatch")) {
        if (!window._isUnloading) handleStrictFailure();
      } else {
        flushSession(state.analytics);
        saveNow(state);
      }
    }
  } else {
    resumeAll();
  }
});

// ── Page unload — final save ───────────────────────────────────────────────────

window.addEventListener("beforeunload", (e) => {
  window._isUnloading = true;
  setTimeout(() => window._isUnloading = false, 100);

  if (state.strictMode && (state.mode === "focus" || state.mode === "stopwatch") && engine.running) {
    e.preventDefault();
    e.returnValue = "Focus Guard is active. Leaving will reset your session!";
  }
  
  cancelPendingSave();
  if (engine.running) {
    const remainingMs = engine.pause();
    state.remaining = Math.ceil(remainingMs / 1000);
  }
  flushSession(state.analytics);
  saveNow(state);
});

// ── Init ───────────────────────────────────────────────────────────────────────

function initAudioOnce() {
  ensureContext(state.master);
}
document.addEventListener("click", initAudioOnce, { once: true });
document.addEventListener("keydown", initAudioOnce, { once: true });

initDOM();
initMindfulness();
applyBackground(state.background);
document.body.classList.toggle("perf-mode", state.perfMode);
document.getElementById("masterSlider").value = Math.round(state.master * 100);
document.getElementById("masterValue").textContent = Math.round(state.master * 100) + "%";
updateTimerDisplay(state.remaining, duration(state.mode), state.mode, false, state.counts, state.streak);
