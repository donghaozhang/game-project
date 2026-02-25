"use strict";

const bestScoreKey = "neon-core-rush-best-score";
const highScoresKey = "neon-core-rush-high-scores-v1";
const lastInitialsKey = "neon-core-rush-last-initials";
let highScores = loadHighScores();
let bestScore = highScores.length ? highScores[0].score : 0;

function sanitizeInitialsDraft(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 3);
}

function sanitizeInitials(value) {
  return sanitizeInitialsDraft(value) || "AAA";
}

function normalizeHighScoreEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const rawScore = Number(entry.score);
  const rawCreatedAt = Number(entry.createdAt);
  const score = Number.isFinite(rawScore)
    ? Math.max(0, Math.floor(rawScore))
    : 0;
  const createdAt = Number.isFinite(rawCreatedAt) ? rawCreatedAt : 0;
  return {
    initials: sanitizeInitials(entry.initials),
    score,
    createdAt
  };
}

function sortHighScores(entries) {
  return entries
    .filter(Boolean)
    .sort((a, b) => (b.score - a.score) || (a.createdAt - b.createdAt))
    .slice(0, 5);
}

function loadHighScores() {
  let loaded = [];
  try {
    const raw = localStorage.getItem(highScoresKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        loaded = sortHighScores(parsed.map(normalizeHighScoreEntry));
      }
    }
  } catch (_) {
    loaded = [];
  }

  if (!loaded.length) {
    try {
      const rawLegacyBest = Number(localStorage.getItem(bestScoreKey));
      const legacyBest = Number.isFinite(rawLegacyBest)
        ? Math.max(0, Math.floor(rawLegacyBest))
        : 0;
      if (legacyBest > 0) {
        loaded = [{ initials: "AAA", score: legacyBest, createdAt: 0 }];
      }
    } catch (_) {
      loaded = [];
    }
  }

  return loaded;
}

function persistHighScores() {
  highScores = sortHighScores(highScores);
  bestScore = highScores.length ? highScores[0].score : 0;
  try {
    localStorage.setItem(highScoresKey, JSON.stringify(highScores));
  } catch (_) {
    /* ignore storage failures */
  }
  try {
    localStorage.setItem(bestScoreKey, String(bestScore));
  } catch (_) {
    /* ignore storage failures */
  }
}

function getPreferredInitials() {
  try {
    return sanitizeInitials(localStorage.getItem(lastInitialsKey));
  } catch (_) {
    return "AAA";
  }
}

function persistPreferredInitials(initials) {
  try {
    localStorage.setItem(lastInitialsKey, sanitizeInitials(initials));
  } catch (_) {
    /* ignore storage failures */
  }
}

function qualifiesForHighScores(score) {
  if (!Number.isFinite(score) || score <= 0) return false;
  if (highScores.length < 5) return true;
  const cutoff = highScores[highScores.length - 1];
  return !!cutoff && score > cutoff.score;
}

function renderScoreboard(message) {
  if (!ui.scoreboardList) return;

  const list = ui.scoreboardList;
  list.textContent = "";

  if (!highScores.length) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "scoreboardEmpty";
    emptyItem.textContent = "No saved scores yet. Reach the top 5 after a run to store your initials on this device.";
    list.appendChild(emptyItem);
  } else {
    for (let i = 0; i < highScores.length; i += 1) {
      const entry = highScores[i];
      const item = document.createElement("li");
      item.className = "scoreboardItem";

      const rank = document.createElement("span");
      rank.className = "scoreboardRank";
      rank.textContent = "#" + String(i + 1);

      const initials = document.createElement("span");
      initials.className = "scoreboardInitials";
      initials.textContent = entry.initials;

      const scoreText = document.createElement("span");
      scoreText.className = "scoreboardScore";
      scoreText.textContent = entry.score.toLocaleString();

      item.appendChild(rank);
      item.appendChild(initials);
      item.appendChild(scoreText);
      list.appendChild(item);
    }
  }

  if (!ui.scoreboardMeta) return;
  if (message) {
    ui.scoreboardMeta.textContent = message;
    return;
  }
  ui.scoreboardMeta.textContent = highScores.length
    ? "Top 5 runs are saved in localStorage for this browser."
    : "Finish a run to add your initials to the board.";
}

function setScoreEntryFormVisible(visible) {
  if (!ui.scoreEntryForm) return;
  ui.scoreEntryForm.hidden = !visible;
}

function focusScoreEntryForm() {
  if (!ui.scoreEntryInitialsInput || pendingHighScoreScore == null) return;
  window.requestAnimationFrame(() => {
    if (!ui.scoreEntryInitialsInput || pendingHighScoreScore == null) return;
    try {
      ui.scoreEntryInitialsInput.focus({ preventScroll: true });
    } catch (_) {
      ui.scoreEntryInitialsInput.focus();
    }
    ui.scoreEntryInitialsInput.select();
  });
}

function clearPendingHighScoreScore() {
  pendingHighScoreScore = null;
  setScoreEntryFormVisible(false);
}

function getScoreboardCutoffMessage(score) {
  if (!qualifiesForHighScores(score)) {
    if (score <= 0) return "Scoreboard saves top 5 runs with initials (scores above 0).";
    const cutoff = highScores.length >= 5 ? highScores[highScores.length - 1].score : 0;
    return "Top 5 cutoff: " + cutoff.toLocaleString() + ".";
  }
  return "";
}

function prepareGameOverScoreEntry(score) {
  if (!qualifiesForHighScores(score)) {
    clearPendingHighScoreScore();
    return getScoreboardCutoffMessage(score);
  }

  if (!ui.scoreEntryForm || !ui.scoreEntryInitialsInput) {
    return saveGameOverScore(score, getPreferredInitials());
  }

  pendingHighScoreScore = score;
  ui.scoreEntryInitialsInput.value = getPreferredInitials();
  setScoreEntryFormVisible(true);
  return "Top 5 run! Enter initials to save (or restart/menu to save automatically).";
}

function saveGameOverScore(score, initials) {
  const safeInitials = sanitizeInitials(initials);
  persistPreferredInitials(safeInitials);

  highScores.push({
    initials: safeInitials,
    score,
    createdAt: Date.now()
  });
  persistHighScores();

  return "Saved " + safeInitials + " • " + Math.floor(score).toLocaleString() + ".";
}

function submitPendingHighScoreScore() {
  if (pendingHighScoreScore == null) return "";

  const scoreToSave = pendingHighScoreScore;
  const initialsValue = ui.scoreEntryInitialsInput
    ? ui.scoreEntryInitialsInput.value
    : getPreferredInitials();
  const message = saveGameOverScore(scoreToSave, initialsValue);

  clearPendingHighScoreScore();
  ui.bestScore.textContent = String(Math.floor(bestScore));
  renderScoreboard(message);
  return message;
}

function flushPendingHighScoreScore() {
  if (pendingHighScoreScore == null) return "";
  return submitPendingHighScoreScore();
}
