"use strict";

const audioVolumeKey = "neon-core-rush-audio-volume";

function createAudioSystem() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const volumeLevels = [0, 0.22, 0.48];
  let volumeIndex = 2;

  try {
    const storedRaw = localStorage.getItem(audioVolumeKey);
    if (storedRaw != null && storedRaw !== "") {
      const stored = Number(storedRaw);
      if (Number.isInteger(stored) && stored >= 0 && stored < volumeLevels.length) {
        volumeIndex = stored;
      }
    }
  } catch (_) {
    volumeIndex = 2;
  }
  let lastNonZeroVolumeIndex = volumeIndex > 0 ? volumeIndex : 2;

  const state = {
    supported: Boolean(AudioCtx),
    ctx: null,
    master: null,
    musicBus: null,
    sfxBus: null,
    nextStepTime: 0,
    step: 0,
    tempo: 108,
    lookAhead: 0.3,
    musicActive: false,
    lastScoreFxTime: -Infinity
  };

  const bassPattern = [40, null, 40, null, 43, null, 47, null, 38, null, 38, null, 43, null, 45, null];
  const leadPattern = [64, 67, 71, 74, 76, 74, 71, 67, 62, 66, 69, 74, 71, 69, 66, 62];
  const chordPattern = [
    [52, 55, 59],
    [50, 54, 57],
    [48, 52, 55],
    [50, 54, 57]
  ];

  function currentLevel() {
    return volumeLevels[volumeIndex];
  }

  function isAudible() {
    return currentLevel() > 0.0001;
  }

  function stepDuration() {
    return 60 / state.tempo / 2;
  }

  function midiToHz(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function persistVolume() {
    try {
      localStorage.setItem(audioVolumeKey, String(volumeIndex));
    } catch (_) {
      /* ignore storage failures */
    }
  }

  function updateButton() {
    if (!ui.audioToggleBtn) return;
    if (!state.supported) {
      ui.audioToggleBtn.textContent = "Audio: Off";
      ui.audioToggleBtn.disabled = true;
      ui.audioToggleBtn.setAttribute("aria-pressed", "true");
      return;
    }
    const muted = volumeIndex === 0;
    ui.audioToggleBtn.textContent = muted ? "Audio: Muted" : "Audio: On";
    ui.audioToggleBtn.disabled = false;
    ui.audioToggleBtn.setAttribute("aria-pressed", String(muted));
    ui.audioToggleBtn.setAttribute("aria-label", muted ? "Unmute audio" : "Mute audio");
  }

  function createGraph() {
    if (!state.supported || state.ctx) return;

    state.ctx = new AudioCtx();

    const master = state.ctx.createGain();
    const musicBus = state.ctx.createGain();
    const sfxBus = state.ctx.createGain();
    const limiter = state.ctx.createDynamicsCompressor();

    limiter.threshold.value = -20;
    limiter.knee.value = 16;
    limiter.ratio.value = 10;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;

    master.gain.value = 0;
    musicBus.gain.value = 0.0001;
    sfxBus.gain.value = 0.9;

    musicBus.connect(master);
    sfxBus.connect(master);
    master.connect(limiter);
    limiter.connect(state.ctx.destination);

    state.master = master;
    state.musicBus = musicBus;
    state.sfxBus = sfxBus;
    state.nextStepTime = state.ctx.currentTime + 0.06;
    state.step = 0;
  }

  function applyVolume() {
    if (!state.ctx || !state.master) return;
    const now = state.ctx.currentTime;
    state.master.gain.cancelScheduledValues(now);
    state.master.gain.setTargetAtTime(currentLevel(), now, 0.025);
  }

  function applyMusicActivity(resetClock = false) {
    if (!state.ctx || !state.musicBus) return;
    const now = state.ctx.currentTime;
    if (resetClock) {
      state.nextStepTime = now + 0.06;
    }
    const targetGain = state.musicActive && isAudible() ? 0.42 : 0.0001;
    state.musicBus.gain.cancelScheduledValues(now);
    state.musicBus.gain.setTargetAtTime(targetGain, now, 0.035);
  }

  function ensure() {
    if (!state.supported) return false;
    createGraph();
    if (!state.ctx) return false;
    if (state.ctx.state === "suspended") {
      state.ctx.resume().catch(() => {});
    }
    applyVolume();
    return true;
  }

  function setGameplayAudioActive(active) {
    const next = !!active;
    if (state.musicActive === next) return;

    if (next && currentLevel() > 0) ensure();
    state.musicActive = next;
    applyMusicActivity(next);
  }

  function disposeNodes(nodes) {
    nodes.forEach((node) => {
      if (!node) return;
      try { node.disconnect(); } catch (_) { /* ignore */ }
    });
  }

  function synthTone(target, opts) {
    if (!state.ctx || !target) return;

    const when = Math.max(opts.time ?? state.ctx.currentTime, state.ctx.currentTime);
    const osc = state.ctx.createOscillator();
    const amp = state.ctx.createGain();
    const finalNode = amp;
    let filter = null;

    osc.type = opts.type || "square";
    osc.frequency.setValueAtTime(opts.freq, when);
    if (opts.freqEnd && opts.freqEnd > 0) {
      osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, when + (opts.duration || 0.08));
    }
    if (opts.detune) {
      osc.detune.setValueAtTime(opts.detune, when);
    }

    if (opts.filter) {
      filter = state.ctx.createBiquadFilter();
      filter.type = opts.filter.type || "lowpass";
      filter.frequency.setValueAtTime(opts.filter.freq || 1200, when);
      if (opts.filter.q != null) filter.Q.value = opts.filter.q;
      osc.connect(filter);
      filter.connect(amp);
    } else {
      osc.connect(amp);
    }

    const attack = opts.attack ?? 0.004;
    const hold = opts.duration ?? 0.06;
    const release = opts.release ?? 0.05;
    const peak = Math.max(0.0001, opts.gain ?? 0.03);

    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.linearRampToValueAtTime(peak, when + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, when + hold + release);

    finalNode.connect(target);
    osc.start(when);
    osc.stop(when + hold + release + 0.02);
    osc.addEventListener("ended", () => disposeNodes([osc, filter, amp]));
  }

  function scheduleKick(time) {
    synthTone(state.musicBus, {
      time,
      type: "sine",
      freq: 130,
      freqEnd: 42,
      duration: 0.16,
      gain: 0.11,
      attack: 0.003,
      release: 0.06
    });
  }

  function scheduleHat(time) {
    synthTone(state.musicBus, {
      time,
      type: "square",
      freq: 4600,
      duration: 0.012,
      gain: 0.01,
      attack: 0.001,
      release: 0.012,
      filter: { type: "highpass", freq: 2500, q: 0.7 }
    });
    synthTone(state.musicBus, {
      time: time + 0.016,
      type: "square",
      freq: 3600,
      duration: 0.01,
      gain: 0.007,
      attack: 0.001,
      release: 0.01,
      filter: { type: "highpass", freq: 2200, q: 0.6 }
    });
  }

  function scheduleChord(time, midiNotes) {
    const gate = stepDuration() * 1.9;
    for (let i = 0; i < midiNotes.length; i += 1) {
      const detune = i === 0 ? -4 : i === 1 ? 0 : 5;
      synthTone(state.musicBus, {
        time,
        type: "sawtooth",
        freq: midiToHz(midiNotes[i]),
        detune,
        duration: gate,
        gain: i === 0 ? 0.018 : 0.014,
        attack: 0.012,
        release: 0.09,
        filter: { type: "lowpass", freq: 1200, q: 0.35 }
      });
    }
  }

  function scheduleLead(time, midi) {
    const baseGain = 0.034;
    const hz = midiToHz(midi);
    synthTone(state.musicBus, {
      time,
      type: "square",
      freq: hz,
      duration: stepDuration() * 0.68,
      gain: baseGain,
      attack: 0.002,
      release: 0.04,
      filter: { type: "lowpass", freq: 3200, q: 0.5 }
    });
    synthTone(state.musicBus, {
      time: time + stepDuration() * 0.5,
      type: "square",
      freq: hz,
      duration: stepDuration() * 0.35,
      gain: baseGain * 0.35,
      attack: 0.002,
      release: 0.03,
      filter: { type: "lowpass", freq: 2600, q: 0.4 }
    });
  }

  function scheduleBass(time, midi) {
    synthTone(state.musicBus, {
      time,
      type: "triangle",
      freq: midiToHz(midi),
      duration: stepDuration() * 0.88,
      gain: 0.05,
      attack: 0.003,
      release: 0.05,
      filter: { type: "lowpass", freq: 620, q: 0.25 }
    });
  }

  function scheduleMusicStep(time, stepIndex) {
    const step = stepIndex % 16;
    if (step % 4 === 0) scheduleKick(time);
    if (step % 2 === 1) scheduleHat(time);

    const bass = bassPattern[step];
    if (bass != null) scheduleBass(time, bass);

    const lead = leadPattern[step];
    if (lead != null) scheduleLead(time + (step % 4 === 3 ? 0.01 : 0), lead);

    if (step % 4 === 0) {
      scheduleChord(time, chordPattern[(step / 4) % chordPattern.length]);
    }
  }

  function tick() {
    if (!state.ctx || !state.musicBus || !state.master) return;
    if (state.ctx.state !== "running" || !isAudible() || !state.musicActive) return;

    const now = state.ctx.currentTime;
    const stepLen = stepDuration();
    if (!Number.isFinite(state.nextStepTime) || state.nextStepTime < now - stepLen) {
      state.nextStepTime = now + 0.05;
    }

    while (state.nextStepTime < now + state.lookAhead) {
      scheduleMusicStep(state.nextStepTime, state.step);
      state.nextStepTime += stepLen;
      state.step += 1;
    }
  }

  function playMenu() {
    if (!ensure() || !isAudible()) return;
    const t = state.ctx.currentTime + 0.004;
    synthTone(state.sfxBus, {
      time: t,
      type: "square",
      freq: 720,
      duration: 0.024,
      gain: 0.035,
      attack: 0.002,
      release: 0.018
    });
    synthTone(state.sfxBus, {
      time: t + 0.038,
      type: "square",
      freq: 980,
      duration: 0.02,
      gain: 0.028,
      attack: 0.002,
      release: 0.016
    });
  }

  function playCollect(kind) {
    if (!ensure() || !isAudible()) return;
    const t = state.ctx.currentTime + 0.003;
    if (kind === "heal") {
      [660, 880, 1108].forEach((freq, index) => {
        synthTone(state.sfxBus, {
          time: t + index * 0.028,
          type: "triangle",
          freq,
          duration: 0.045,
          gain: 0.033,
          attack: 0.002,
          release: 0.035
        });
      });
      return;
    }
    synthTone(state.sfxBus, {
      time: t,
      type: "square",
      freq: 540,
      duration: 0.018,
      gain: 0.03,
      attack: 0.002,
      release: 0.02
    });
    synthTone(state.sfxBus, {
      time: t + 0.022,
      type: "square",
      freq: 820,
      duration: 0.02,
      gain: 0.026,
      attack: 0.002,
      release: 0.02
    });
  }

  function playScore(points, combo = 0, byDash = false) {
    if (!ensure() || !isAudible()) return;
    const now = state.ctx.currentTime;
    if (now - state.lastScoreFxTime < 0.035) return;
    state.lastScoreFxTime = now;

    const comboTier = Math.min(7, Math.floor(combo / 3));
    const base = byDash ? 430 : 360;
    const lead = base + Math.min(220, Math.floor(points || 0) * 2) + comboTier * 16;
    const t = now + 0.002;

    synthTone(state.sfxBus, {
      time: t,
      type: byDash ? "sawtooth" : "square",
      freq: lead,
      duration: 0.026,
      gain: byDash ? 0.032 : 0.026,
      attack: 0.0018,
      release: 0.022,
      filter: { type: "lowpass", freq: byDash ? 1800 : 2300, q: 0.4 }
    });
    synthTone(state.sfxBus, {
      time: t + 0.018,
      type: "triangle",
      freq: lead * (comboTier >= 2 ? 1.5 : 1.333),
      duration: 0.03,
      gain: 0.016 + comboTier * 0.0015,
      attack: 0.002,
      release: 0.024
    });
  }

  function playHit() {
    if (!ensure() || !isAudible()) return;
    const t = state.ctx.currentTime + 0.002;
    synthTone(state.sfxBus, {
      time: t,
      type: "sawtooth",
      freq: 230,
      freqEnd: 95,
      duration: 0.09,
      gain: 0.065,
      attack: 0.002,
      release: 0.05,
      filter: { type: "lowpass", freq: 900, q: 0.4 }
    });
    synthTone(state.sfxBus, {
      time: t + 0.012,
      type: "square",
      freq: 120,
      duration: 0.06,
      gain: 0.028,
      attack: 0.002,
      release: 0.03
    });
  }

  function playGameOver() {
    if (!ensure() || !isAudible()) return;
    const t = state.ctx.currentTime + 0.01;
    [523, 392, 294, 220].forEach((freq, index) => {
      synthTone(state.sfxBus, {
        time: t + index * 0.11,
        type: index % 2 ? "triangle" : "square",
        freq,
        duration: 0.08,
        gain: 0.044 - index * 0.006,
        attack: 0.003,
        release: 0.06
      });
    });
    synthTone(state.sfxBus, {
      time: t + 0.36,
      type: "sawtooth",
      freq: 180,
      freqEnd: 72,
      duration: 0.24,
      gain: 0.05,
      attack: 0.003,
      release: 0.08,
      filter: { type: "lowpass", freq: 760, q: 0.45 }
    });
  }

  function playHighScore() {
    if (!ensure() || !isAudible()) return;
    const t = state.ctx.currentTime + 0.18;
    const notes = [784, 988, 1174, 1568];
    for (let i = 0; i < notes.length; i += 1) {
      synthTone(state.sfxBus, {
        time: t + i * 0.055,
        type: i % 2 ? "triangle" : "square",
        freq: notes[i],
        duration: 0.05,
        gain: 0.024 + i * 0.004,
        attack: 0.002,
        release: 0.04,
        filter: { type: "lowpass", freq: 2600 + i * 300, q: 0.35 }
      });
    }
    synthTone(state.sfxBus, {
      time: t + 0.22,
      type: "sawtooth",
      freq: 1046,
      duration: 0.12,
      gain: 0.018,
      attack: 0.002,
      release: 0.07,
      filter: { type: "lowpass", freq: 2200, q: 0.4 }
    });
  }

  function toggleMute() {
    if (!state.supported) {
      updateButton();
      return;
    }

    const wasMuted = volumeIndex === 0;
    if (wasMuted) {
      volumeIndex = lastNonZeroVolumeIndex > 0 ? lastNonZeroVolumeIndex : 2;
      ensure();
    } else {
      if (volumeIndex > 0) lastNonZeroVolumeIndex = volumeIndex;
      volumeIndex = 0;
    }
    persistVolume();
    applyVolume();
    if (state.ctx && state.musicBus) {
      applyMusicActivity(wasMuted && state.musicActive);
    }
    updateButton();
    if (wasMuted && currentLevel() > 0) playMenu();
  }

  function handleVisibility() {
    if (!state.ctx) return;
    if (document.hidden) {
      state.ctx.suspend().catch(() => {});
      return;
    }
    if (currentLevel() > 0) {
      state.nextStepTime = state.ctx.currentTime + 0.06;
      state.ctx.resume().catch(() => {});
      if (state.musicActive) applyMusicActivity(true);
    }
  }

  updateButton();

  return {
    ensure,
    setGameplayAudioActive,
    tick,
    playMenu,
    playCollect,
    playScore,
    playHit,
    playGameOver,
    playHighScore,
    toggleMute,
    updateButton,
    handleVisibility
  };
}

const audio = createAudioSystem();
