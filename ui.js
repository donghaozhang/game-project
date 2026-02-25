"use strict";

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const ui = {
  score: document.getElementById("scoreValue"),
  combo: document.getElementById("comboValue"),
  wave: document.getElementById("waveValue"),
  difficultyCard: document.getElementById("difficultyCard"),
  difficultyValue: document.getElementById("difficultyValue"),
  difficultySubValue: document.getElementById("difficultySubValue"),
  time: document.getElementById("timeValue"),
  hpText: document.getElementById("hpText"),
  hpFill: document.getElementById("hpFill"),
  waveProgressFill: document.getElementById("waveProgressFill"),
  waveProgressText: document.getElementById("waveProgressText"),
  progressMeta: document.getElementById("progressMeta"),
  waveBanner: document.getElementById("waveBanner"),
  audioToggleBtn: document.getElementById("audioToggleBtn"),
  menuOverlay: document.getElementById("menuOverlay"),
  gameOverOverlay: document.getElementById("gameOverOverlay"),
  startBtn: document.getElementById("startBtn"),
  restartBtn: document.getElementById("restartBtn"),
  backToMenuBtn: document.getElementById("backToMenuBtn"),
  menuMuteBtn: document.getElementById("menuMuteBtn"),
  difficultyHelp: document.getElementById("difficultyHelp"),
  difficultyButtons: Array.from(document.querySelectorAll(".difficultyBtn")),
  finalScore: document.getElementById("finalScore"),
  finalCombo: document.getElementById("finalCombo"),
  bestScore: document.getElementById("bestScore"),
  scoreboardList: document.getElementById("scoreboardList"),
  scoreboardMeta: document.getElementById("scoreboardMeta"),
  scoreEntryForm: document.getElementById("scoreEntryForm"),
  scoreEntryInitialsInput: document.getElementById("scoreEntryInitials"),
  scoreEntrySaveBtn: document.getElementById("scoreEntrySaveBtn"),
  touchControls: document.getElementById("touchControls"),
  touchDashBtn: document.getElementById("touchDashBtn"),
  touchMoveButtons: Array.from(document.querySelectorAll("[data-touch-key]"))
};

const FX = {
  full: true
};

const DIFFICULTY_PRESETS = {
  easy: {
    key: "easy",
    label: "Easy",
    description: "More breathing room early on. Slower ramp, fewer spawns, and slightly lower enemy speed.",
    waveDuration: 18,
    enemySpeedMul: 0.88,
    enemyHpMul: 0.92,
    spawnRateMul: 0.86,
    maxEnemiesMul: 0.88,
    scoreMul: 0.92,
    rampMul: 0.85
  },
  medium: {
    key: "medium",
    label: "Medium",
    description: "Balanced pacing with steady escalation. Waves add noticeable speed and spawn pressure.",
    waveDuration: 16,
    enemySpeedMul: 1,
    enemyHpMul: 1,
    spawnRateMul: 1,
    maxEnemiesMul: 1,
    scoreMul: 1,
    rampMul: 1
  },
  hard: {
    key: "hard",
    label: "Hard",
    description: "High pressure from the start. Faster enemies, denser spawns, and sharper wave scaling.",
    waveDuration: 14,
    enemySpeedMul: 1.12,
    enemyHpMul: 1.12,
    spawnRateMul: 1.18,
    maxEnemiesMul: 1.18,
    scoreMul: 1.12,
    rampMul: 1.2
  }
};
const TIER_SUFFIXES = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
let selectedDifficultyKey = "medium";

const input = {
  keys: Object.create(null),
  touchKeys: Object.create(null),
  touchPointers: new Map(),
  mouseX: window.innerWidth * 0.5,
  mouseY: window.innerHeight * 0.5,
  pointerActive: false,
  dashQueued: false,
  touchMode: false
};

const world = { w: window.innerWidth, h: window.innerHeight, dpr: 1 };
const coarsePointerQuery = window.matchMedia ? window.matchMedia("(pointer: coarse)") : null;

const stars = Array.from({ length: 140 }, (_, i) => {
  const depthSeed = Math.pow(Math.random(), 0.58);
  const depth = 0.12 + depthSeed * 0.88;
  return {
    x: Math.random(),
    y: Math.random(),
    depth,
    size: 0.4 + depth * 2.4,
    speed: 4 + depth * 30,
    sway: 0.4 + depth * 1.5,
    phase: Math.random() * Math.PI * 2,
    hue: 190 + Math.round((Math.random() - 0.5) * 26) + (i % 7 === 0 ? 10 : 0)
  };
});

function getViewportSize() {
  const viewport = window.visualViewport;
  const width = viewport ? viewport.width : window.innerWidth;
  const height = viewport ? viewport.height : window.innerHeight;
  return {
    w: Math.max(1, Math.floor(width || window.innerWidth || 1)),
    h: Math.max(1, Math.floor(height || window.innerHeight || 1))
  };
}

function clearTouchInputs() {
  input.touchPointers.clear();
  dashTouchPointers.clear();
  Object.keys(input.touchKeys).forEach((code) => {
    input.touchKeys[code] = false;
  });
  ui.touchMoveButtons.forEach((button) => {
    button.classList.remove("isActive");
  });
  ui.touchDashBtn.classList.remove("isActive");
}

function syncTouchControls() {
  const visible = !!(input.touchMode && game && game.mode === "running");
  document.body.classList.toggle("touchUi", input.touchMode);
  document.body.classList.toggle("touchUiVisible", visible);
  ui.touchControls.setAttribute("aria-hidden", visible ? "false" : "true");
}

function refreshTouchMode() {
  const hasTouchPoints = (navigator.maxTouchPoints || 0) > 0;
  const coarsePointer = coarsePointerQuery ? coarsePointerQuery.matches : false;
  const nextTouchMode = hasTouchPoints || coarsePointer;
  if (nextTouchMode !== input.touchMode) {
    input.touchMode = nextTouchMode;
    if (!input.touchMode) {
      clearTouchInputs();
      input.pointerActive = false;
    }
  }
  syncTouchControls();
}

function setTouchKey(code, pressed) {
  input.touchKeys[code] = pressed;
  ui.touchMoveButtons.forEach((button) => {
    if (button.dataset.touchKey === code) {
      button.classList.toggle("isActive", pressed);
    }
  });
}

function releaseTouchPointer(pointerId) {
  const keyCode = input.touchPointers.get(pointerId);
  if (!keyCode) return;
  input.touchPointers.delete(pointerId);

  let stillPressed = false;
  input.touchPointers.forEach((code) => {
    if (code === keyCode) stillPressed = true;
  });
  if (!stillPressed) setTouchKey(keyCode, false);
}

function updateDifficultySelectionUI() {
  const preset = getDifficultyPreset(selectedDifficultyKey);
  if (ui.difficultyHelp) ui.difficultyHelp.textContent = preset.description;
  ui.startBtn.textContent = "Start " + preset.label + " Run";
  for (let i = 0; i < ui.difficultyButtons.length; i += 1) {
    const btn = ui.difficultyButtons[i];
    const isActive = btn.dataset.difficulty === selectedDifficultyKey;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  }
}

function setSelectedDifficulty(nextKey) {
  selectedDifficultyKey = getDifficultyPreset(nextKey).key;
  updateDifficultySelectionUI();
  if (game && game.mode === "menu") {
    game.baseDifficultyKey = selectedDifficultyKey;
    applyProgressionState(game);
    updateHud();
  }
}

function resize() {
  const viewport = getViewportSize();
  world.w = viewport.w;
  world.h = viewport.h;
  world.dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(world.w * world.dpr);
  canvas.height = Math.floor(world.h * world.dpr);
  canvas.style.width = world.w + "px";
  canvas.style.height = world.h + "px";
  ctx.setTransform(world.dpr, 0, 0, world.dpr, 0, 0);

  if (game && game.player) {
    const maxX = Math.max(26, world.w - 26);
    const maxY = Math.max(26, world.h - 26);
    game.player.x = clamp(game.player.x, 26, maxX);
    game.player.y = clamp(game.player.y, 26, maxY);
  }
}

function resetRun() {
  flushPendingHighScoreScore();
  game = freshGameState();
  game.mode = "running";
  const snapshot = applyProgressionState(game);
  game.waveShown = snapshot.wave;
  showWaveBanner("Wave " + snapshot.wave + " • " + snapshot.tierLabel);
  ui.menuOverlay.classList.remove("show");
  ui.gameOverOverlay.classList.remove("show");
  clearPendingHighScoreScore();
  syncTouchControls();
  updateHud();
}

function backToMenu() {
  flushPendingHighScoreScore();
  game = freshGameState();
  ui.menuOverlay.classList.add("show");
  ui.gameOverOverlay.classList.remove("show");
  clearPendingHighScoreScore();
  renderScoreboard();
  syncTouchControls();
  updateHud();
}

function showGameOver() {
  if (!game || game.mode === "gameover") return;
  game.mode = "gameover";
  audio.setGameplayAudioActive(false);
  const finalScoreValue = Math.max(0, Math.floor(game.score));
  const isNewBestScore = finalScoreValue > 0 && finalScoreValue > bestScore;
  audio.playGameOver();
  if (isNewBestScore) audio.playHighScore();
  const scoreboardMessage = prepareGameOverScoreEntry(finalScoreValue);
  const displayedBestScore = pendingHighScoreScore == null
    ? bestScore
    : Math.max(bestScore, finalScoreValue);

  ui.finalScore.textContent = String(finalScoreValue);
  ui.finalCombo.textContent = "x" + (1 + game.longestCombo * 0.18).toFixed(1);
  ui.bestScore.textContent = String(Math.floor(displayedBestScore));
  renderScoreboard(scoreboardMessage);
  ui.gameOverOverlay.classList.add("show");
  if (pendingHighScoreScore != null) focusScoreEntryForm();
  syncTouchControls();
}

function showWaveBanner(text) {
  ui.waveBanner.textContent = text;
  ui.waveBanner.classList.add("show");
  if (bannerTimeout) window.clearTimeout(bannerTimeout);
  bannerTimeout = window.setTimeout(() => {
    ui.waveBanner.classList.remove("show");
  }, 1200);
}

function updateHud() {
  if (!game) return;
  const prog = game.progression || applyProgressionState(game);
  ui.score.textContent = String(Math.floor(game.score));
  ui.wave.textContent = String(prog.wave);
  ui.time.textContent = fmtTime(game.time);
  const comboMul = 1 + game.combo * 0.18;
  ui.combo.textContent = "x" + comboMul.toFixed(1);
  ui.hpText.textContent = game.player.hp + " / " + game.player.maxHp;
  ui.hpFill.style.width = (game.player.hp / game.player.maxHp * 100).toFixed(1) + "%";

  const speedDelta = Math.round((prog.enemySpeedScale - 1) * 100);
  const spawnDelta = Math.round((prog.spawnRateScale - 1) * 100);
  const speedDeltaText = (speedDelta >= 0 ? "+" : "") + speedDelta + "%";
  const spawnDeltaText = (spawnDelta >= 0 ? "+" : "") + spawnDelta + "%";

  ui.difficultyCard.style.setProperty("--tier-accent", getTierAccent(prog.tier));
  ui.difficultyValue.textContent = prog.tierLabel;
  ui.difficultySubValue.textContent = "Base " + prog.preset.label + " • T" + prog.tier + " • " + speedDeltaText + " Speed";

  ui.waveProgressFill.style.width = (prog.waveProgress * 100).toFixed(1) + "%";
  ui.waveProgressText.textContent = Math.round(prog.waveProgress * 100) + "%";
  ui.progressMeta.textContent =
    "Wave " + prog.wave + " -> " + (prog.wave + 1) + " • " + Math.ceil(prog.timeToNextWave) + "s • Spawn " + spawnDeltaText;
}
