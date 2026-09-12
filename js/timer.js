/**
 * timer.js — Timestamp-based precise timer engine
 *
 * Uses Date.now() delta instead of interval counting to eliminate
 * drift caused by browser tab throttling.
 */

export class TimerEngine {
  constructor(onTick, onComplete) {
    this._onTick = onTick;
    this._onComplete = onComplete;
    this._raf = null;
    this._running = false;
    this._lastDisplayedSecond = -1;
    
    this._countUp = false;
    this._baseTime = null; 
  }

  /** Start or resume the timer with the given remaining/elapsed milliseconds */
  start(timeMs, countUp = false) {
    if (this._running) return;
    this._running = true;
    this._countUp = countUp;
    
    if (countUp) {
      this._baseTime = Date.now() - timeMs; // timeMs is elapsedMs
    } else {
      this._baseTime = Date.now() + timeMs; // timeMs is remainingMs
    }
    
    this._lastDisplayedSecond = -1;
    this._tick();
  }

  /** Pause the timer, returns exact current milliseconds */
  pause() {
    if (!this._running) return this._getCurrentMs();
    this._running = false;
    cancelAnimationFrame(this._raf);
    this._raf = null;
    return this._getCurrentMs();
  }

  /** Stop and reset */
  stop() {
    this._running = false;
    cancelAnimationFrame(this._raf);
    clearTimeout(this._bgTimeout);
    this._raf = null;
    this._bgTimeout = null;
    this._baseTime = null;
  }

  /** Handle tab visibility changes to ensure alarm rings when hidden */
  handleVisibility(isHidden) {
    if (!this._running || this._countUp) return;
    
    if (isHidden) {
      const remainingMs = this._getCurrentMs();
      if (remainingMs > 0) {
        this._bgTimeout = setTimeout(() => {
          this._tick();
        }, remainingMs);
      }
    } else {
      clearTimeout(this._bgTimeout);
      this._bgTimeout = null;
      if (!this._raf) {
        this._tick();
      }
    }
  }

  get running() { return this._running; }

  _getCurrentMs() {
    if (this._baseTime === null) return 0;
    if (this._countUp) {
      return Math.max(0, Date.now() - this._baseTime);
    } else {
      return Math.max(0, this._baseTime - Date.now());
    }
  }

  _tick() {
    if (!this._running) return;

    const currentMs = this._getCurrentMs();
    const currentSec = this._countUp ? Math.floor(currentMs / 1000) : Math.ceil(currentMs / 1000);

    // Only fire callbacks when the displayed second changes (minimal DOM updates)
    if (currentSec !== this._lastDisplayedSecond) {
      const deltaSec = this._lastDisplayedSecond === -1 ? 0 : Math.abs(currentSec - this._lastDisplayedSecond);
      this._lastDisplayedSecond = currentSec;
      this._onTick(currentMs, currentSec, deltaSec);
    }

    if (!this._countUp && currentMs <= 0) {
      this._running = false;
      this._baseTime = null;
      this._onComplete();
      return;
    }

    // Schedule next frame
    this._raf = requestAnimationFrame(() => this._tick());
  }
}
