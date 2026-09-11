/**
 * storage.js — Debounced state persistence
 * Saves to localStorage only on meaningful state changes,
 * not on every timer tick.
 */

const STORAGE_KEY = "focusTimerState_v2";

let _dirtyTimer = null;

/**
 * Immediate save — use for critical state transitions
 * (settings change, session complete, page hide)
 */
export function saveNow(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      mode: state.mode,
      remaining: state.remaining,
      settings: state.settings,
      counts: state.counts,
      streak: state.streak,
      master: state.master,
      background: state.background,
      analytics: state.analytics,
      perfMode: state.perfMode,
      strictMode: state.strictMode,
      microBreaks: state.microBreaks,
      unlockedBadges: state.unlockedBadges,
    }));
  } catch (e) {
    // QuotaExceededError — analytics data too large
    console.warn("storage: save failed", e);
  }
}

/**
 * Debounced save — batches rapid state changes.
 * Analytics data is flushed at most once every 30 seconds during a session.
 */
export function saveLater(state, delay = 30000) {
  clearTimeout(_dirtyTimer);
  _dirtyTimer = setTimeout(() => saveNow(state), delay);
}

/** Cancel any pending debounced save */
export function cancelPendingSave() {
  clearTimeout(_dirtyTimer);
}

/** Load saved state from storage */
export function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch (e) {
    return null;
  }
}
