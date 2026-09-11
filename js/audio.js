/**
 * audio.js — Optimized Web Audio soundscape mixer
 *
 * Key optimizations:
 * - AudioContext created lazily on first user interaction
 * - Crackle / page-turn events use Web Audio scheduled events
 *   (audioCtx.currentTime), not setInterval node-recreation
 * - Master gain and per-channel gains are maintained across volume changes
 *   without rebuilding the graph
 * - Tab visibility pause / resume
 */

let audioCtx = null;
let masterGainNode = null;
const channelGains = {};    // per-sound GainNode
const sourceNodes = {};     // per-sound source (BufferSource or "piano scheduler")
const schedulers = {};      // interval IDs for crackle / page events

// Shared noise buffer per sound (created once, reused)
const noiseBuffers = {};

const DEFAULT_VOLUMES = {
  rain: 0.55,
  fire: 0.48,
  library: 0.38,
  piano: 0.36,
};

export const soundState = {
  rain:    { on: false, volume: DEFAULT_VOLUMES.rain },
  fire:    { on: false, volume: DEFAULT_VOLUMES.fire },
  library: { on: false, volume: DEFAULT_VOLUMES.library },
  piano:   { on: false, volume: DEFAULT_VOLUMES.piano },
};

// ── Context lifecycle ──────────────────────────────────────────────────────────

function ensureContext(masterVolume = 0.55) {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGainNode = audioCtx.createGain();
    masterGainNode.gain.value = masterVolume;
    masterGainNode.connect(audioCtx.destination);
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

export function setMasterVolume(volume, masterGainRef) {
  if (masterGainNode) masterGainNode.gain.setTargetAtTime(volume, audioCtx.currentTime, 0.05);
}

export function getMasterGainNode() { return masterGainNode; }
export function getAudioContext() { return audioCtx; }

// ── Noise buffer factory ───────────────────────────────────────────────────────

function getNoiseBuffer(key, seconds = 2) {
  if (noiseBuffers[key]) return noiseBuffers[key];
  const ctx = audioCtx;
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffers[key] = buf;
  return buf;
}

// ── Sound start / stop ─────────────────────────────────────────────────────────

function ensureChannelGain(name, rawGain) {
  if (!channelGains[name]) {
    channelGains[name] = audioCtx.createGain();
    channelGains[name].gain.value = rawGain;
    channelGains[name].connect(masterGainNode);
  }
  return channelGains[name];
}

function stopChannel(name) {
  // Stop crackle / page schedulers
  if (schedulers[name]) {
    clearInterval(schedulers[name]);
    delete schedulers[name];
  }
  // Stop and disconnect source node
  const src = sourceNodes[name];
  if (src) {
    try { src.stop(); } catch (e) {}
    try { src.disconnect(); } catch (e) {}
    delete sourceNodes[name];
  }
}

// ── Rain ──────────────────────────────────────────────────────────────────────

function startRain(volume) {
  ensureContext();
  const gain = ensureChannelGain("rain", volume * 0.24);
  const src = audioCtx.createBufferSource();
  src.buffer = getNoiseBuffer("rain", 3);
  src.loop = true;
  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 3300;
  src.connect(filter).connect(gain);
  src.start();
  sourceNodes.rain = src;
}

// ── Fire ──────────────────────────────────────────────────────────────────────

function startFire(volume) {
  ensureContext();
  const gain = ensureChannelGain("fire", volume * 0.13);
  const src = audioCtx.createBufferSource();
  src.buffer = getNoiseBuffer("fire", 2);
  src.loop = true;
  const filter = audioCtx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 650;
  filter.Q.value = 0.7;
  src.connect(filter).connect(gain);
  src.start();
  sourceNodes.fire = src;

  // Schedule crackles using Web Audio timing — no new nodes per interval
  // We schedule a burst of crackle work ahead of time
  let nextCrackle = audioCtx.currentTime + 0.2;

  function scheduleCrackles() {
    const ctx = audioCtx;
    if (!ctx || !soundState.fire.on) return;

    const now = ctx.currentTime;
    // Fill 3 seconds ahead
    while (nextCrackle < now + 3) {
      const t = nextCrackle;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(900 + Math.random() * 1800, t);
      o.frequency.exponentialRampToValueAtTime(160, t + 0.07);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(soundState.fire.volume * 0.11, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(g).connect(masterGainNode);
      o.start(t);
      o.stop(t + 0.12);
      // Next crackle in 650ms–1600ms
      nextCrackle += 0.65 + Math.random() * 0.95;
    }
  }

  schedulers.fire = setInterval(scheduleCrackles, 1500);
  scheduleCrackles(); // prime immediately
}

// ── Library ────────────────────────────────────────────────────────────────────

function startLibrary(volume) {
  ensureContext();
  const gain = ensureChannelGain("library", volume * 0.055);
  const src = audioCtx.createBufferSource();
  src.buffer = getNoiseBuffer("library", 3);
  src.loop = true;
  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 500;
  src.connect(filter).connect(gain);
  src.start();
  sourceNodes.library = src;

  // Page-turn events — scheduled ahead of time
  let nextPage = audioCtx.currentTime + 2;

  function schedulePages() {
    const ctx = audioCtx;
    if (!ctx || !soundState.library.on) return;
    const now = ctx.currentTime;
    while (nextPage < now + 8) {
      const t = nextPage;
      const dur = 0.35;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 360 + Math.random() * 200;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(soundState.library.volume * 0.03, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(masterGainNode);
      osc.start(t);
      osc.stop(t + dur + 0.05);
      nextPage += 4.2 + Math.random() * 2.6;
    }
  }

  schedulers.library = setInterval(schedulePages, 3000);
  schedulePages();
}

// ── Piano ──────────────────────────────────────────────────────────────────────

const PIANO_NOTES = [261.63, 329.63, 392.00, 493.88, 523.25, 392.00, 329.63, 293.66];

function startPiano(volume) {
  ensureContext();
  // Piano has no BufferSource, just a scheduler
  let idx = 0;
  let nextNote = audioCtx.currentTime + 0.1;

  function scheduleNotes() {
    const ctx = audioCtx;
    if (!ctx || !soundState.piano.on) return;
    const now = ctx.currentTime;
    while (nextNote < now + 4) {
      const t = nextNote;
      const len = 0.95;
      const freq = PIANO_NOTES[idx % PIANO_NOTES.length];

      // Main note
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      o.type = "sine";
      o.frequency.value = freq;
      f.type = "lowpass";
      f.frequency.value = 1800;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(soundState.piano.volume * 0.075, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(f).connect(g).connect(masterGainNode);
      o.start(t);
      o.stop(t + len + 0.05);

      // Bass note every 4 beats
      if (idx % 4 === 0) {
        const ob = ctx.createOscillator();
        const gb = ctx.createGain();
        ob.type = "sine";
        ob.frequency.value = PIANO_NOTES[(idx + 2) % PIANO_NOTES.length] / 2;
        gb.gain.setValueAtTime(0, t);
        gb.gain.linearRampToValueAtTime(soundState.piano.volume * 0.05, t + 0.05);
        gb.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
        ob.connect(gb).connect(masterGainNode);
        ob.start(t);
        ob.stop(t + 1.25);
      }

      idx++;
      nextNote += 1.05;
    }
  }

  schedulers.piano = setInterval(scheduleNotes, 2000);
  scheduleNotes();
  sourceNodes.piano = { stop: () => {} }; // sentinel for "playing"
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function applySound(name, on, masterVolume = 0.55) {
  soundState[name].on = on;
  stopChannel(name);
  if (!on) {
    // Fade out channel gain if it exists
    if (channelGains[name] && audioCtx) {
      channelGains[name].gain.setTargetAtTime(0, audioCtx.currentTime, 0.2);
    }
    return;
  }
  ensureContext(masterVolume);
  // Restore gain
  if (channelGains[name]) {
    channelGains[name].gain.setTargetAtTime(getChannelGainValue(name), audioCtx.currentTime, 0.1);
  }
  if (name === "rain")    startRain(soundState.rain.volume);
  if (name === "fire")    startFire(soundState.fire.volume);
  if (name === "library") startLibrary(soundState.library.volume);
  if (name === "piano")   startPiano(soundState.piano.volume);
}

function getChannelGainValue(name) {
  const v = soundState[name].volume;
  if (name === "rain")    return v * 0.24;
  if (name === "fire")    return v * 0.13;
  if (name === "library") return v * 0.055;
  return v * 0.075; // piano uses direct gain
}

export function setChannelVolume(name, volume) {
  soundState[name].volume = volume;
  if (channelGains[name] && audioCtx) {
    channelGains[name].gain.setTargetAtTime(getChannelGainValue(name), audioCtx.currentTime, 0.05);
  }
}

export function initAudio(masterVolume = 0.55) {
  ensureContext(masterVolume);
}

/** Pause all sounds (tab hidden) */
export function pauseAll() {
  if (audioCtx && audioCtx.state === "running") audioCtx.suspend();
}

/** Resume all sounds (tab visible) */
export function resumeAll() {
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
}

/** Beep on session complete */
export function beep(masterVolume = 0.55) {
  try {
    ensureContext(masterVolume);
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.14, audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
    o.connect(g).connect(masterGainNode);
    o.start();
    o.stop(audioCtx.currentTime + 0.45);
  } catch (e) {}
}
