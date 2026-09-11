/**
 * mindfulness.js — Manages the 1-minute Box Breathing visualizer
 */

let overlay, startBtn, skipBtn, closeBtn, circle, text;
let timer = null;
let onCompleteCallback = null;

const PHASES = [
  { text: "Inhale", class: "inhale" },
  { text: "Hold", class: "hold" },
  { text: "Exhale", class: "exhale" },
  { text: "Hold", class: "hold" }
];

export function initMindfulness() {
  overlay = document.getElementById("mindfulnessOverlay");
  startBtn = document.getElementById("startMindfulness");
  skipBtn = document.getElementById("skipMindfulness");
  closeBtn = document.getElementById("closeMindfulness");
  circle = document.querySelector(".breathing-circle");
  text = document.getElementById("breathingText");

  startBtn.addEventListener("click", startBreathing);
  skipBtn.addEventListener("click", skip);
  closeBtn.addEventListener("click", skip);
}

export function promptMindfulness(onComplete) {
  onCompleteCallback = onComplete;
  resetUI();
  overlay.classList.add("open");
}

function resetUI() {
  clearTimeout(timer);
  circle.className = "breathing-circle";
  text.textContent = "Ready";
  startBtn.style.display = "block";
  skipBtn.style.display = "block";
  closeBtn.style.display = "block";
}

function startBreathing() {
  startBtn.style.display = "none";
  closeBtn.style.display = "none";
  
  let phaseIndex = 0;
  let cycles = 0;
  const maxCycles = 4; // 4 cycles * 16s = 64 seconds

  function runPhase() {
    if (cycles >= maxCycles) {
      endBreathing();
      return;
    }

    const phase = PHASES[phaseIndex];
    circle.className = `breathing-circle ${phase.class}`;
    text.textContent = phase.text;
    
    // Smooth text fade
    text.style.opacity = 0;
    setTimeout(() => {
      text.style.opacity = 1;
    }, 100);

    phaseIndex++;
    if (phaseIndex >= PHASES.length) {
      phaseIndex = 0;
      cycles++;
    }

    timer = setTimeout(runPhase, 4000); // 4 seconds per phase
  }

  // Initial delay for smooth start
  text.textContent = "Prepare...";
  timer = setTimeout(runPhase, 2000);
}

function endBreathing() {
  overlay.classList.remove("open");
  resetUI();
  if (onCompleteCallback) onCompleteCallback();
}

function skip() {
  overlay.classList.remove("open");
  resetUI();
  if (onCompleteCallback) onCompleteCallback();
}
