"use strict";

let game = null;
let lastFrame = performance.now();
let bannerTimeout = 0;
let rafId = 0;
const dashTouchPointers = new Set();
let pendingHighScoreScore = null;

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function wrap(value, span) {
  return ((value % span) + span) % span;
}

function fmtTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function isPressed(code) {
  return !!(input.keys[code] || input.touchKeys[code]);
}

function getMoveInput() {
  let x = 0;
  let y = 0;
  if (isPressed("KeyW") || isPressed("ArrowUp")) y -= 1;
  if (isPressed("KeyS") || isPressed("ArrowDown")) y += 1;
  if (isPressed("KeyA") || isPressed("ArrowLeft")) x -= 1;
  if (isPressed("KeyD") || isPressed("ArrowRight")) x += 1;
  return { x, y };
}

function getDifficultyPreset(key) {
  return DIFFICULTY_PRESETS[key] || DIFFICULTY_PRESETS.medium;
}

function getTierSuffix(tier) {
  return TIER_SUFFIXES[tier - 1] || String(tier);
}

function getTierAccent(tier) {
  if (tier >= 5) return "#ff5578";
  if (tier >= 4) return "#ff7d6a";
  if (tier >= 3) return "#ffd15c";
  if (tier >= 2) return "#7dff99";
  return "#5ef2ff";
}

function getProgressionSnapshot(state) {
  const preset = getDifficultyPreset(state.baseDifficultyKey || selectedDifficultyKey);
  const waveDuration = preset.waveDuration;
  const wave = 1 + Math.floor(state.time / waveDuration);
  const waveProgress = (state.time % waveDuration) / waveDuration;
  const timeToNextWave = Math.max(0, waveDuration - (state.time % waveDuration));
  const tier = 1 + Math.floor((wave - 1) / 3);
  const tierWave = ((wave - 1) % 3) + 1;
  const rampIndex = Math.max(0, wave - 1);
  const ramp = preset.rampMul;
  const enemySpeedScale = preset.enemySpeedMul * (1 + rampIndex * 0.055 * ramp);
  const enemyHpScale = preset.enemyHpMul * (1 + rampIndex * 0.045 * ramp);
  const spawnRateScale = preset.spawnRateMul * (1 + rampIndex * 0.06 * ramp);
  const maxEnemiesScale = preset.maxEnemiesMul * (1 + rampIndex * 0.05 * ramp);
  const scoreScale = preset.scoreMul * (1 + rampIndex * 0.015 * ramp);

  return {
    preset,
    wave,
    waveDuration,
    waveProgress,
    timeToNextWave,
    tier,
    tierWave,
    tierLabel: preset.label + " " + getTierSuffix(tier),
    enemySpeedScale,
    enemyHpScale,
    spawnRateScale,
    maxEnemiesScale,
    scoreScale
  };
}

function applyProgressionState(state) {
  const snapshot = getProgressionSnapshot(state);
  state.baseDifficultyKey = snapshot.preset.key;
  state.baseDifficultyLabel = snapshot.preset.label;
  state.wave = snapshot.wave;
  state.waveDuration = snapshot.waveDuration;
  state.waveProgress = snapshot.waveProgress;
  state.timeToNextWave = snapshot.timeToNextWave;
  state.difficultyTier = snapshot.tier;
  state.difficultyTierLabel = snapshot.tierLabel;
  state.progression = snapshot;
  return snapshot;
}

function makePlayer() {
  return {
    x: world.w * 0.5,
    y: world.h * 0.5,
    r: 14,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    hp: 5,
    maxHp: 5,
    fireCooldown: 0,
    dashCooldown: 0,
    dashTime: 0,
    invuln: 0,
    trail: [],
    trailEmit: 0,
    hitFlash: 0
  };
}

function freshGameState() {
  const preset = getDifficultyPreset(selectedDifficultyKey);
  const state = {
    mode: "menu",
    time: 0,
    score: 0,
    wave: 1,
    waveShown: 1,
    waveProgress: 0,
    waveDuration: preset.waveDuration,
    timeToNextWave: preset.waveDuration,
    kills: 0,
    combo: 0,
    comboTimer: 0,
    longestCombo: 0,
    spawnTimer: 0.55,
    spawnBudget: 0,
    shake: 0,
    shakeBiasX: 0,
    shakeBiasY: 0,
    heat: 0,
    baseDifficultyKey: preset.key,
    baseDifficultyLabel: preset.label,
    difficultyTier: 1,
    difficultyTierLabel: preset.label + " I",
    progression: null,
    player: makePlayer(),
    enemies: [],
    projectiles: [],
    pickups: [],
    particles: [],
    ripples: []
  };
  applyProgressionState(state);
  return state;
}

function spawnParticle(x, y, opts = {}) {
  const count = opts.count ?? 1;
  for (let i = 0; i < count; i += 1) {
    const angle = opts.angle != null ? opts.angle + rand(-0.55, 0.55) : rand(0, Math.PI * 2);
    const speed = opts.speed != null ? opts.speed * rand(0.65, 1.2) : rand(30, 180);
    const size = opts.size != null ? opts.size * rand(0.7, 1.25) : rand(1.6, 3.6);
    const life = opts.life != null ? opts.life * rand(0.75, 1.15) : rand(0.2, 0.6);
    game.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size,
      life,
      maxLife: life,
      hue: opts.hue ?? 190 + rand(-30, 25),
      sat: opts.sat ?? 95,
      light: opts.light ?? 68,
      drag: opts.drag ?? 2.4
    });
  }
}

function addScreenShake(amount, biasX = 0, biasY = 0) {
  if (!game) return;
  game.shake = Math.max(game.shake, amount);
  const len = Math.hypot(biasX, biasY);
  if (len > 0.001) {
    const force = Math.min(9, amount * 0.55);
    game.shakeBiasX += (biasX / len) * force;
    game.shakeBiasY += (biasY / len) * force;
    game.shakeBiasX = clamp(game.shakeBiasX, -18, 18);
    game.shakeBiasY = clamp(game.shakeBiasY, -18, 18);
  }
}

function addRipple(x, y, opts = {}) {
  game.ripples.push({
    x,
    y,
    r: opts.r ?? 8,
    dr: opts.dr ?? 180,
    life: opts.life ?? 0.35,
    maxLife: opts.life ?? 0.35,
    color: opts.color ?? "rgba(94,242,255,0.65)",
    line: opts.line ?? 2
  });
}

function spawnPickup(x, y, kind = "core") {
  const baseHue = kind === "heal" ? 135 : 48;
  game.pickups.push({
    x,
    y,
    vx: rand(-40, 40),
    vy: rand(-40, 40),
    r: kind === "heal" ? 8 : 6,
    kind,
    life: kind === "heal" ? 10 : 8,
    pulse: rand(0, Math.PI * 2),
    hue: baseHue
  });
}

function applyEnemyProgression(enemy) {
  const prog = game.progression || applyProgressionState(game);
  const accelScale = clamp(0.9 + (prog.enemySpeedScale - 1) * 0.65 + 0.12, 0.85, 1.75);
  enemy.speed *= prog.enemySpeedScale * rand(0.97, 1.04);
  enemy.accel *= accelScale;
  enemy.hp = Math.max(1, Math.round(enemy.hp * prog.enemyHpScale));
  enemy.maxHp = enemy.hp;
  enemy.value = Math.max(1, Math.round(enemy.value * prog.scoreScale));
}

function spawnPlayerTrailParticles(dt) {
  if (!game || !game.player) return;
  const p = game.player;
  const speed = Math.hypot(p.vx, p.vy);
  const active = p.dashTime > 0 || speed > 36;
  if (!active) return;

  const rate = p.dashTime > 0
    ? (FX.full ? 150 : 78)
    : (FX.full ? 46 : 22);
  p.trailEmit += rate * dt;

  const tailAngle = p.angle + Math.PI;
  const tailX = Math.cos(tailAngle);
  const tailY = Math.sin(tailAngle);
  const anchorX = p.x + tailX * (p.r - 2);
  const anchorY = p.y + tailY * (p.r - 2);

  while (p.trailEmit >= 1) {
    p.trailEmit -= 1;
    const spread = p.dashTime > 0 ? 0.85 : 0.48;
    const ang = tailAngle + rand(-spread, spread);
    const thrust = p.dashTime > 0 ? rand(90, 190) : rand(28, 88);
    const life = p.dashTime > 0 ? rand(0.16, 0.34) : rand(0.1, 0.22);
    game.particles.push({
      x: anchorX + rand(-3, 3),
      y: anchorY + rand(-3, 3),
      vx: Math.cos(ang) * thrust - p.vx * (p.dashTime > 0 ? 0.16 : 0.1),
      vy: Math.sin(ang) * thrust - p.vy * (p.dashTime > 0 ? 0.16 : 0.1),
      size: p.dashTime > 0 ? rand(1.8, 3.9) : rand(1.1, 2.6),
      life,
      maxLife: life,
      hue: p.dashTime > 0 ? 142 + rand(-10, 12) : 192 + rand(-14, 10),
      sat: 96,
      light: p.dashTime > 0 ? 70 : 66,
      drag: p.dashTime > 0 ? 5.5 : 7
    });
  }
}

function spawnEnemyExplosion(enemy, byDash) {
  const radiusScale = clamp(enemy.r / 16, 0.65, 1.75);
  const burstCount = Math.round((FX.full ? 20 : 10) * radiusScale + (byDash ? 8 : 0));
  const sparkCount = Math.round((FX.full ? 10 : 5) * radiusScale);

  spawnParticle(enemy.x, enemy.y, {
    count: burstCount,
    speed: byDash ? 260 : 200,
    size: byDash ? 4.6 : 3.4,
    life: 0.58,
    hue: enemy.hue,
    light: 68,
    drag: 2.1
  });

  spawnParticle(enemy.x, enemy.y, {
    count: Math.max(4, Math.round(6 * radiusScale)),
    speed: byDash ? 120 : 90,
    size: 2.6,
    life: 0.22,
    hue: 42 + rand(-8, 8),
    sat: 100,
    light: 74,
    drag: 7
  });

  for (let i = 0; i < sparkCount; i += 1) {
    const sparkAngle = rand(0, Math.PI * 2);
    spawnParticle(enemy.x, enemy.y, {
      count: 1,
      angle: sparkAngle,
      speed: rand(byDash ? 190 : 130, byDash ? 360 : 250),
      size: rand(1.2, 2.2),
      life: rand(0.18, 0.38),
      hue: enemy.hue + rand(-24, 24),
      sat: 100,
      light: 76,
      drag: 4.4
    });
  }

  if (FX.full) {
    spawnParticle(enemy.x, enemy.y, {
      count: Math.round(4 + radiusScale * 5),
      speed: 70,
      size: 4.8,
      life: 0.34,
      hue: enemy.hue + rand(-10, 10),
      sat: 55,
      light: 42,
      drag: 8
    });
  }

  addScreenShake((byDash ? 4.8 : 2.8) + enemy.r * 0.08);
}

function currentWaveFromTime() {
  return 1 + Math.floor(game.time / 16);
}

function spawnEnemy(typeOverride) {
  const side = Math.floor(Math.random() * 4);
  const margin = 40;
  let x = 0;
  let y = 0;
  if (side === 0) { x = -margin; y = rand(0, world.h); }
  if (side === 1) { x = world.w + margin; y = rand(0, world.h); }
  if (side === 2) { x = rand(0, world.w); y = -margin; }
  if (side === 3) { x = rand(0, world.w); y = world.h + margin; }

  const wave = game.wave;
  let type = typeOverride;
  if (!type) {
    const roll = Math.random();
    if (wave >= 5 && roll > 0.82) type = "tank";
    else if (wave >= 3 && roll > 0.6) type = "orbiter";
    else if (wave >= 7 && roll > 0.46 && roll < 0.57) type = "splitter";
    else type = "chaser";
  }

  const common = {
    x,
    y,
    vx: 0,
    vy: 0,
    seed: Math.random() * 1000,
    wobble: rand(0.6, 1.35),
    hitFlash: 0
  };

  let enemy;
  if (type === "tank") {
    enemy = {
      ...common,
      type,
      r: rand(20, 25),
      hp: 7 + wave,
      maxHp: 7 + wave,
      speed: rand(65, 82) + wave * 2.4,
      accel: 125,
      value: 28,
      hue: 330,
      touchDamage: 2
    };
  } else if (type === "orbiter") {
    enemy = {
      ...common,
      type,
      r: rand(13, 17),
      hp: 3 + Math.floor(wave * 0.5),
      maxHp: 3 + Math.floor(wave * 0.5),
      speed: rand(92, 116) + wave * 3.2,
      accel: 210,
      value: 18,
      hue: 195,
      orbitDir: Math.random() < 0.5 ? -1 : 1,
      touchDamage: 1
    };
  } else if (type === "splitter") {
    enemy = {
      ...common,
      type,
      r: rand(15, 18),
      hp: 4 + Math.floor(wave * 0.55),
      maxHp: 4 + Math.floor(wave * 0.55),
      speed: rand(86, 102) + wave * 2.6,
      accel: 170,
      value: 22,
      hue: 275,
      touchDamage: 1
    };
  } else if (type === "mini") {
    enemy = {
      ...common,
      type,
      r: rand(8, 10),
      hp: 1,
      maxHp: 1,
      speed: rand(130, 168) + wave * 2.8,
      accel: 260,
      value: 7,
      hue: 50,
      touchDamage: 1
    };
  } else {
    enemy = {
      ...common,
      type: "chaser",
      r: rand(10, 13),
      hp: 2 + Math.floor(wave * 0.33),
      maxHp: 2 + Math.floor(wave * 0.33),
      speed: rand(100, 126) + wave * 3.7,
      accel: 200,
      value: 12,
      hue: 345,
      touchDamage: 1
    };
  }

  applyEnemyProgression(enemy);
  game.enemies.push(enemy);
}

function fireBolt() {
  const p = game.player;
  let tx = input.mouseX;
  let ty = input.mouseY;
  let closest = null;
  let closestDist = Infinity;

  for (let i = 0; i < game.enemies.length; i += 1) {
    const e = game.enemies[i];
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < closestDist) {
      closestDist = d2;
      closest = e;
    }
  }

  if (closest && closestDist < 280 * 280) {
    tx = closest.x;
    ty = closest.y;
  }

  let dx = tx - p.x;
  let dy = ty - p.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  p.angle = Math.atan2(dy, dx);

  const speed = 560;
  const damage = p.dashTime > 0 ? 2 : 1;
  game.projectiles.push({
    x: p.x + dx * (p.r + 5),
    y: p.y + dy * (p.r + 5),
    vx: dx * speed + p.vx * 0.18,
    vy: dy * speed + p.vy * 0.18,
    r: 3,
    life: 0.85,
    damage,
    hue: 190 + rand(-12, 12)
  });

  if (FX.full) {
    spawnParticle(p.x + dx * p.r, p.y + dy * p.r, {
      count: 3,
      speed: 90,
      angle: p.angle,
      size: 2.2,
      life: 0.22,
      hue: 190
    });
  }
}

function queueDash() {
  input.dashQueued = true;
}

function doDash() {
  const p = game.player;
  if (p.dashCooldown > 0 || p.dashTime > 0) return;

  const move = getMoveInput();
  let dx = move.x;
  let dy = move.y;

  if (!dx && !dy) {
    dx = input.mouseX - p.x;
    dy = input.mouseY - p.y;
  }
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;

  p.vx = dx * 620;
  p.vy = dy * 620;
  p.angle = Math.atan2(dy, dx);
  p.dashTime = 0.16;
  p.dashCooldown = 0.95;
  p.invuln = Math.max(p.invuln, 0.25);

  addScreenShake(8, -dx, -dy);
  game.heat = Math.min(1, game.heat + 0.12);
  addRipple(p.x, p.y, { r: 10, dr: 260, life: 0.33, color: "rgba(125,255,153,0.65)", line: 2.4 });
  spawnParticle(p.x, p.y, {
    count: FX.full ? 18 : 8,
    speed: 220,
    size: 3.6,
    life: 0.45,
    hue: 142,
    light: 68
  });
}

function damagePlayer(amount, source) {
  const p = game.player;
  if (p.invuln > 0 || p.dashTime > 0) return;

  p.hp -= amount;
  p.invuln = 0.9;
  p.hitFlash = 0.22;
  addScreenShake(amount >= 2 ? 14 : 10, source ? (p.x - source.x) : 0, source ? (p.y - source.y) : 0);
  game.combo = Math.max(0, Math.floor(game.combo * 0.35));
  game.comboTimer = Math.min(game.comboTimer, 0.9);
  game.heat = Math.min(1, game.heat + 0.22);
  audio.playHit();

  if (source) {
    const dx = p.x - source.x;
    const dy = p.y - source.y;
    const len = Math.hypot(dx, dy) || 1;
    p.vx += (dx / len) * 180;
    p.vy += (dy / len) * 180;
  }

  spawnParticle(p.x, p.y, {
    count: FX.full ? 20 : 10,
    speed: 170,
    size: 3.5,
    life: 0.5,
    hue: 350,
    light: 66
  });
  addRipple(p.x, p.y, { r: 14, dr: 220, life: 0.34, color: "rgba(255,85,120,0.55)", line: 3 });

  if (p.hp <= 0) {
    p.hp = 0;
    showGameOver();
  }
}

function scoreForEnemy(enemy) {
  const comboMul = 1 + game.combo * 0.18;
  return Math.round(enemy.value * comboMul + game.wave * 2);
}

function onEnemyKilled(enemy, byDash) {
  game.kills += 1;
  const gained = scoreForEnemy(enemy);
  game.score += gained;
  game.combo += 1;
  game.comboTimer = 3.0;
  if (game.combo > game.longestCombo) game.longestCombo = game.combo;
  game.heat = Math.min(1, game.heat + (byDash ? 0.12 : 0.06));
  audio.playScore(gained, game.combo, byDash);

  spawnEnemyExplosion(enemy, byDash);
  addRipple(enemy.x, enemy.y, {
    r: enemy.r * 0.65,
    dr: 180 + enemy.r * 2.5,
    life: 0.28,
    color: "hsla(" + enemy.hue + ", 95%, 70%, 0.45)",
    line: 2
  });

  const coreCount = enemy.type === "tank" ? 2 : 1;
  for (let i = 0; i < coreCount; i += 1) {
    spawnPickup(enemy.x + rand(-8, 8), enemy.y + rand(-8, 8), "core");
  }
  if (Math.random() < 0.07 || (enemy.type === "tank" && Math.random() < 0.25)) {
    spawnPickup(enemy.x, enemy.y, "heal");
  }

  if (enemy.type === "splitter") {
    for (let i = 0; i < 2; i += 1) {
      spawnEnemy("mini");
      const mini = game.enemies[game.enemies.length - 1];
      mini.x = enemy.x + rand(-8, 8);
      mini.y = enemy.y + rand(-8, 8);
      const ang = rand(0, Math.PI * 2);
      mini.vx = Math.cos(ang) * rand(90, 160);
      mini.vy = Math.sin(ang) * rand(90, 160);
    }
  }
}

function hitEnemy(enemy, damage, byDash = false) {
  enemy.hp -= damage;
  enemy.hitFlash = 0.08;
  if (enemy.hp <= 0) {
    onEnemyKilled(enemy, byDash);
    return true;
  }
  spawnParticle(enemy.x, enemy.y, {
    count: FX.full ? 4 : 2,
    speed: 120,
    size: 2.4,
    life: 0.2,
    hue: enemy.hue
  });
  return false;
}

function updateRunning(dt) {
  const p = game.player;
  game.time += dt;
  game.heat = Math.max(0, game.heat - dt * 0.08);
  game.shake = Math.max(0, game.shake - dt * 18);
  game.shakeBiasX *= Math.exp(-11 * dt);
  game.shakeBiasY *= Math.exp(-11 * dt);

  const prevWave = game.wave;
  const progression = applyProgressionState(game);
  if (progression.wave !== prevWave) {
    showWaveBanner("Wave " + progression.wave + " • " + progression.tierLabel);
    game.spawnTimer = Math.min(game.spawnTimer, 0.12);
  }

  const moveInput = getMoveInput();
  let moveX = moveInput.x;
  let moveY = moveInput.y;
  const moving = moveX !== 0 || moveY !== 0;

  if (moving) {
    const len = Math.hypot(moveX, moveY) || 1;
    moveX /= len;
    moveY /= len;
    const accel = p.dashTime > 0 ? 450 : 820;
    p.vx += moveX * accel * dt;
    p.vy += moveY * accel * dt;
    p.angle = Math.atan2(moveY, moveX);
  }

  if (input.pointerActive) {
    const aimDx = input.mouseX - p.x;
    const aimDy = input.mouseY - p.y;
    if (Math.hypot(aimDx, aimDy) > 3) p.angle = Math.atan2(aimDy, aimDx);
  }

  if (input.dashQueued) {
    doDash();
    input.dashQueued = false;
  }

  p.dashCooldown = Math.max(0, p.dashCooldown - dt);
  p.dashTime = Math.max(0, p.dashTime - dt);
  p.invuln = Math.max(0, p.invuln - dt);
  p.hitFlash = Math.max(0, p.hitFlash - dt);

  const maxSpeed = p.dashTime > 0 ? 620 : 300;
  const drag = p.dashTime > 0 ? 2.8 : 6.2;
  const decay = Math.exp(-drag * dt);
  p.vx *= decay;
  p.vy *= decay;
  const speed = Math.hypot(p.vx, p.vy);
  if (speed > maxSpeed) {
    const s = maxSpeed / speed;
    p.vx *= s;
    p.vy *= s;
  }

  p.x += p.vx * dt;
  p.y += p.vy * dt;

  const margin = p.r + 4;
  if (p.x < margin) { p.x = margin; p.vx = Math.abs(p.vx) * 0.35; }
  if (p.x > world.w - margin) { p.x = world.w - margin; p.vx = -Math.abs(p.vx) * 0.35; }
  if (p.y < margin) { p.y = margin; p.vy = Math.abs(p.vy) * 0.35; }
  if (p.y > world.h - margin) { p.y = world.h - margin; p.vy = -Math.abs(p.vy) * 0.35; }

  spawnPlayerTrailParticles(dt);

  p.fireCooldown -= dt;
  const fireRate = p.dashTime > 0 ? 0.07 : 0.12;
  if (p.fireCooldown <= 0) {
    fireBolt();
    p.fireCooldown = fireRate;
  }

  p.trail.push({ x: p.x, y: p.y, t: p.dashTime > 0 ? 0.2 : 0.12, a: p.angle });
  if (p.trail.length > 14) p.trail.shift();
  for (let i = p.trail.length - 1; i >= 0; i -= 1) {
    p.trail[i].t -= dt;
    if (p.trail[i].t <= 0) p.trail.splice(i, 1);
  }

  game.spawnTimer -= dt;
  const targetOnScreen = Math.max(3, Math.round((2 + Math.floor(game.wave * 1.35)) * progression.maxEnemiesScale));
  const spawnCap = targetOnScreen + 2 + Math.floor(progression.tier * 0.75);
  if (game.spawnTimer <= 0 && game.enemies.length < spawnCap) {
    spawnEnemy();
    if (
      progression.tier >= 2 &&
      progression.tierWave === 1 &&
      game.enemies.length < spawnCap &&
      Math.random() < clamp(0.1 + progression.tier * 0.04, 0.1, 0.28)
    ) {
      spawnEnemy();
    }
    const baseInterval = clamp(0.84 - game.wave * 0.028, 0.12, 0.84);
    const interval = clamp(baseInterval / progression.spawnRateScale, 0.09, 0.9);
    game.spawnTimer = interval * rand(0.68, 1.12);
  }

  for (let i = game.projectiles.length - 1; i >= 0; i -= 1) {
    const b = game.projectiles[i];
    b.life -= dt;
    if (b.life <= 0) {
      game.projectiles.splice(i, 1);
      continue;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < -30 || b.x > world.w + 30 || b.y < -30 || b.y > world.h + 30) {
      game.projectiles.splice(i, 1);
      continue;
    }
  }

  for (let i = game.pickups.length - 1; i >= 0; i -= 1) {
    const pick = game.pickups[i];
    pick.life -= dt;
    pick.pulse += dt * 8;
    if (pick.life <= 0) {
      game.pickups.splice(i, 1);
      continue;
    }

    const dx = p.x - pick.x;
    const dy = p.y - pick.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist < 150) {
      const pull = (1 - dist / 150) * 650;
      pick.vx += (dx / dist) * pull * dt;
      pick.vy += (dy / dist) * pull * dt;
    }
    pick.vx *= Math.exp(-4.5 * dt);
    pick.vy *= Math.exp(-4.5 * dt);
    pick.x += pick.vx * dt;
    pick.y += pick.vy * dt;

    if (dist < p.r + pick.r + 3) {
      if (pick.kind === "heal") {
        if (p.hp < p.maxHp) {
          p.hp = Math.min(p.maxHp, p.hp + 1);
          game.score += 20;
        } else {
          game.score += 35;
        }
        spawnParticle(pick.x, pick.y, { count: 10, speed: 140, size: 2.8, life: 0.32, hue: 135 });
        addRipple(pick.x, pick.y, { r: 8, dr: 140, life: 0.25, color: "rgba(125,255,153,0.5)" });
      } else {
        game.score += Math.round(8 * (1 + game.combo * 0.06));
        game.comboTimer = Math.max(game.comboTimer, 2.2);
        spawnParticle(pick.x, pick.y, { count: 8, speed: 120, size: 2.6, life: 0.28, hue: 48, light: 70 });
      }
      audio.playCollect(pick.kind);
      game.pickups.splice(i, 1);
    }
  }

  for (let i = game.enemies.length - 1; i >= 0; i -= 1) {
    const e = game.enemies[i];
    e.hitFlash = Math.max(0, e.hitFlash - dt);

    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;

    let steerX = nx;
    let steerY = ny;

    if (e.type === "orbiter") {
      const tangentX = -ny * e.orbitDir;
      const tangentY = nx * e.orbitDir;
      const waveBias = Math.sin(game.time * 3 * e.wobble + e.seed) * 0.45;
      steerX = nx * 0.72 + tangentX * (0.65 + waveBias * 0.25);
      steerY = ny * 0.72 + tangentY * (0.65 + waveBias * 0.25);
    } else if (e.type === "tank") {
      const push = 0.12 + Math.sin(game.time * 2 + e.seed) * 0.08;
      steerX = nx + (-ny) * push;
      steerY = ny + (nx) * push;
    } else if (e.type === "mini") {
      const jitter = Math.sin(game.time * 7 + e.seed * 2) * 0.22;
      steerX = nx + jitter;
      steerY = ny - jitter;
    } else if (e.type === "splitter") {
      const sway = Math.sin(game.time * 4 + e.seed) * 0.32;
      steerX = nx + (-ny) * sway;
      steerY = ny + (nx) * sway;
    }

    const steerLen = Math.hypot(steerX, steerY) || 1;
    steerX /= steerLen;
    steerY /= steerLen;

    e.vx += steerX * e.accel * dt;
    e.vy += steerY * e.accel * dt;

    const dragEnemy = e.type === "mini" ? 1.8 : 3.1;
    const enemyDecay = Math.exp(-dragEnemy * dt);
    e.vx *= enemyDecay;
    e.vy *= enemyDecay;

    const eSpeed = Math.hypot(e.vx, e.vy);
    if (eSpeed > e.speed) {
      const s = e.speed / eSpeed;
      e.vx *= s;
      e.vy *= s;
    }

    e.x += e.vx * dt;
    e.y += e.vy * dt;

    const postDx = p.x - e.x;
    const postDy = p.y - e.y;
    const postDist = Math.hypot(postDx, postDy) || 1;

    if (p.dashTime > 0 && postDist < p.r + e.r + 4) {
      const destroyed = hitEnemy(e, e.type === "tank" ? 3 : 99, true);
      if (destroyed) {
        game.enemies.splice(i, 1);
      } else {
        e.vx += nx * -180;
        e.vy += ny * -180;
      }
      continue;
    }

    if (postDist < p.r + e.r) {
      damagePlayer(e.touchDamage, e);
    }
  }

  for (let i = game.projectiles.length - 1; i >= 0; i -= 1) {
    const b = game.projectiles[i];
    let removed = false;
    for (let j = game.enemies.length - 1; j >= 0; j -= 1) {
      const e = game.enemies[j];
      const dx = e.x - b.x;
      const dy = e.y - b.y;
      const rr = e.r + b.r;
      if (dx * dx + dy * dy <= rr * rr) {
        const dead = hitEnemy(e, b.damage, false);
        spawnParticle(b.x, b.y, { count: 2, speed: 70, size: 1.8, life: 0.14, hue: b.hue });
        game.projectiles.splice(i, 1);
        removed = true;
        if (dead) game.enemies.splice(j, 1);
        break;
      }
    }
    if (removed) continue;
  }

  for (let i = game.particles.length - 1; i >= 0; i -= 1) {
    const part = game.particles[i];
    part.life -= dt;
    if (part.life <= 0) {
      game.particles.splice(i, 1);
      continue;
    }
    const partDecay = Math.exp(-(part.drag || 2.4) * dt);
    part.vx *= partDecay;
    part.vy *= partDecay;
    part.x += part.vx * dt;
    part.y += part.vy * dt;
  }

  for (let i = game.ripples.length - 1; i >= 0; i -= 1) {
    const r = game.ripples[i];
    r.life -= dt;
    if (r.life <= 0) {
      game.ripples.splice(i, 1);
      continue;
    }
    r.r += r.dr * dt;
  }

  if (game.combo > 0) {
    game.comboTimer -= dt;
    if (game.comboTimer <= 0) {
      game.combo = 0;
      game.comboTimer = 0;
    }
  }

  updateHud();
}

function drawBackground() {
  const heat = game ? game.heat : 0;
  const t = game ? game.time : performance.now() * 0.001;
  const wobbleX = Math.sin(t * 0.23) * 20;
  const wobbleY = Math.cos(t * 0.17) * 18;

  const grad = ctx.createRadialGradient(
    world.w * 0.25 + wobbleX,
    world.h * 0.2 + wobbleY,
    10,
    world.w * 0.5,
    world.h * 0.55,
    Math.max(world.w, world.h) * 0.9
  );
  grad.addColorStop(0, "rgba(34, 86, 146, " + (0.22 + heat * 0.12) + ")");
  grad.addColorStop(0.45, "rgba(21, 37, 64, 0.14)");
  grad.addColorStop(1, "rgba(2, 4, 8, 0.92)");

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, world.w, world.h);

  const grid = 52;
  ctx.save();
  ctx.globalAlpha = FX.full ? 0.16 : 0.09;
  ctx.strokeStyle = "rgba(94,242,255,0.28)";
  ctx.lineWidth = 1;
  ctx.translate((-(t * 18)) % grid, (-(t * 12)) % grid);
  ctx.beginPath();
  for (let x = -grid; x <= world.w + grid; x += grid) {
    ctx.moveTo(x, -grid);
    ctx.lineTo(x, world.h + grid);
  }
  for (let y = -grid; y <= world.h + grid; y += grid) {
    ctx.moveTo(-grid, y);
    ctx.lineTo(world.w + grid, y);
  }
  ctx.stroke();
  ctx.restore();

  ctx.save();
  const px = game && game.player ? game.player.x : world.w * 0.5;
  const py = game && game.player ? game.player.y : world.h * 0.5;
  const lookX = px - world.w * 0.5;
  const lookY = py - world.h * 0.5;
  for (let i = 0; i < stars.length; i += 1) {
    const s = stars[i];
    const depth = s.depth;
    const pad = 50 + depth * 65;
    const spanX = world.w + pad * 2;
    const spanY = world.h + pad * 2;
    const driftX = t * s.speed;
    const driftY = Math.sin(t * s.sway + s.phase) * (6 + depth * 10);
    const x = wrap(s.x * spanX + driftX - lookX * depth * 0.24, spanX) - pad;
    const y = wrap(s.y * spanY + driftY - lookY * depth * 0.18, spanY) - pad;
    const twinkle = 0.7 + Math.sin(t * (1.05 + depth * 2.2) + s.phase) * 0.3;
    const alpha = (0.08 + depth * 0.48) * twinkle * (FX.full ? 1 : 0.7);
    const size = s.size * (0.92 + twinkle * 0.22);
    ctx.fillStyle = "hsla(" + s.hue + ", 78%, " + (74 + depth * 16).toFixed(1) + "%, " + alpha.toFixed(3) + ")";
    ctx.fillRect(x, y, size, size);

    if (FX.full && depth > 0.62 && twinkle > 0.92) {
      ctx.strokeStyle = "hsla(" + s.hue + ", 90%, 78%, " + (alpha * 0.38).toFixed(3) + ")";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 2 - depth * 2, y + size * 0.5);
      ctx.lineTo(x + size + 2 + depth * 2, y + size * 0.5);
      ctx.moveTo(x + size * 0.5, y - 2 - depth * 2);
      ctx.lineTo(x + size * 0.5, y + size + 2 + depth * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawProjectile(b) {
  const alpha = clamp(b.life / 0.85, 0, 1);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = "hsla(" + b.hue.toFixed(0) + ", 100%, 72%, " + (0.35 * alpha) + ")";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(b.x - b.vx * 0.014, b.y - b.vy * 0.014);
  ctx.lineTo(b.x + b.vx * 0.004, b.y + b.vy * 0.004);
  ctx.stroke();
  ctx.fillStyle = "hsla(" + b.hue.toFixed(0) + ", 100%, 72%, " + (0.9 * alpha) + ")";
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r + 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawEnemy(e) {
  const hurt = e.hitFlash > 0;
  const hpRatio = clamp(e.hp / e.maxHp, 0, 1);
  const pulse = Math.sin((game.time * 3 + e.seed) * e.wobble) * 0.6 + 0.4;
  const glow = hurt ? 0.95 : 0.55 + pulse * 0.2;

  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = "hsla(" + e.hue + ", 95%, " + (hurt ? 84 : 62) + "%, " + glow + ")";
  ctx.shadowColor = "hsla(" + e.hue + ", 100%, 65%, 0.55)";
  ctx.shadowBlur = 16;
  ctx.beginPath();

  if (e.type === "tank") {
    const spikes = 6;
    for (let i = 0; i < spikes; i += 1) {
      const a = (i / spikes) * Math.PI * 2 + game.time * 0.5;
      const r = i % 2 ? e.r * 0.78 : e.r;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else if (e.type === "splitter") {
    ctx.moveTo(0, -e.r);
    ctx.lineTo(e.r * 0.9, 0);
    ctx.lineTo(0, e.r);
    ctx.lineTo(-e.r * 0.9, 0);
    ctx.closePath();
  } else {
    ctx.arc(0, 0, e.r, 0, Math.PI * 2);
  }
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.fillStyle = hurt ? "rgba(255,255,255,0.95)" : "rgba(6, 12, 22, 0.9)";
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(3, e.r * 0.35), 0, Math.PI * 2);
  ctx.fill();

  if (e.hp < e.maxHp) {
    ctx.globalCompositeOperation = "source-over";
    const w = e.r * 1.9;
    const h = 4;
    ctx.fillStyle = "rgba(7,10,16,0.6)";
    ctx.fillRect(-w / 2, e.r + 7, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fillRect(-w / 2, e.r + 7, w * hpRatio, h);
    ctx.fillStyle = "hsla(" + e.hue + ", 95%, 65%, 0.75)";
    ctx.fillRect(-w / 2, e.r + 7, w * hpRatio, h);
  }
  ctx.restore();
}

function drawPickup(pick) {
  const pulse = 1 + Math.sin(pick.pulse) * 0.16;
  const hue = pick.kind === "heal" ? 135 : 48;
  ctx.save();
  ctx.translate(pick.x, pick.y);
  ctx.globalCompositeOperation = "lighter";
  ctx.shadowColor = "hsla(" + hue + ", 100%, 70%, 0.55)";
  ctx.shadowBlur = pick.kind === "heal" ? 18 : 14;
  if (pick.kind === "heal") {
    ctx.fillStyle = "hsla(135, 96%, 68%, 0.85)";
    ctx.beginPath();
    ctx.arc(0, 0, pick.r * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(7, 15, 14, 0.92)";
    ctx.fillRect(-1.5, -5, 3, 10);
    ctx.fillRect(-5, -1.5, 10, 3);
  } else {
    const r = pick.r * pulse;
    ctx.fillStyle = "hsla(48, 100%, 66%, 0.9)";
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.75, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r * 0.75, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawPlayer() {
  const p = game.player;

  for (let i = 0; i < p.trail.length; i += 1) {
    const tr = p.trail[i];
    const alpha = clamp(tr.t / 0.2, 0, 1) * (p.dashTime > 0 ? 0.55 : 0.2);
    if (alpha <= 0.01) continue;
    ctx.save();
    ctx.translate(tr.x, tr.y);
    ctx.rotate(tr.a);
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = p.dashTime > 0
      ? "rgba(125,255,153," + alpha.toFixed(3) + ")"
      : "rgba(94,242,255," + alpha.toFixed(3) + ")";
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-10, 8);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-10, -8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  ctx.globalCompositeOperation = "lighter";

  const invulnBlink = p.invuln > 0 ? (Math.sin(game.time * 28) > 0 ? 0.45 : 1) : 1;
  const bodyAlpha = invulnBlink * (p.hitFlash > 0 ? 0.95 : 0.8);
  const coreColor = p.dashTime > 0 ? "rgba(125,255,153," + bodyAlpha + ")" : "rgba(94,242,255," + bodyAlpha + ")";

  ctx.shadowColor = p.dashTime > 0 ? "rgba(125,255,153,0.7)" : "rgba(94,242,255,0.75)";
  ctx.shadowBlur = p.dashTime > 0 ? 22 : 18;
  ctx.fillStyle = coreColor;

  ctx.beginPath();
  ctx.moveTo(16, 0);
  ctx.lineTo(-10, 9);
  ctx.lineTo(-5, 0);
  ctx.lineTo(-10, -9);
  ctx.closePath();
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(6, 12, 20, 0.95)";
  ctx.beginPath();
  ctx.moveTo(7, 0);
  ctx.lineTo(-5.5, 4.5);
  ctx.lineTo(-2.5, 0);
  ctx.lineTo(-5.5, -4.5);
  ctx.closePath();
  ctx.fill();

  if (p.dashCooldown > 0) {
    const cd = clamp(p.dashCooldown / 0.95, 0, 1);
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 22, -Math.PI / 2, Math.PI * 1.5);
    ctx.stroke();
    ctx.strokeStyle = "rgba(125,255,153,0.6)";
    ctx.beginPath();
    ctx.arc(0, 0, 22, -Math.PI / 2, -Math.PI / 2 + (1 - cd) * Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawParticles() {
  if (!game.particles.length) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < game.particles.length; i += 1) {
    const p = game.particles[i];
    const alpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.fillStyle = "hsla(" + p.hue.toFixed(0) + ", " + p.sat + "%, " + p.light + "%, " + (alpha * 0.9).toFixed(3) + ")";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (0.55 + alpha * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawRipples() {
  if (!game.ripples.length) return;
  ctx.save();
  for (let i = 0; i < game.ripples.length; i += 1) {
    const r = game.ripples[i];
    const alpha = clamp(r.life / r.maxLife, 0, 1);
    ctx.strokeStyle = r.color.replace(/[\d.]+\)$/g, alpha.toFixed(3) + ")");
    ctx.lineWidth = r.line;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawVignette() {
  const grad = ctx.createRadialGradient(
    world.w * 0.5,
    world.h * 0.45,
    Math.min(world.w, world.h) * 0.12,
    world.w * 0.5,
    world.h * 0.5,
    Math.max(world.w, world.h) * 0.7
  );
  grad.addColorStop(0, "rgba(0, 0, 0, 0)");
  grad.addColorStop(1, "rgba(0, 0, 0, 0.48)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, world.w, world.h);

  if (game && game.player && game.player.hitFlash > 0) {
    ctx.fillStyle = "rgba(255, 84, 118, " + (game.player.hitFlash * 0.25).toFixed(3) + ")";
    ctx.fillRect(0, 0, world.w, world.h);
  }
}

function renderFrame() {
  ctx.clearRect(0, 0, world.w, world.h);
  drawBackground();

  if (!game) return;

  let shakeX = 0;
  let shakeY = 0;
  if (game.shake > 0) {
    const jitterScale = FX.full ? 1 : 0.4;
    shakeX = game.shakeBiasX + (Math.random() - 0.5) * game.shake * jitterScale;
    shakeY = game.shakeBiasY + (Math.random() - 0.5) * game.shake * jitterScale;
  }

  ctx.save();
  ctx.translate(shakeX, shakeY);

  for (let i = 0; i < game.pickups.length; i += 1) drawPickup(game.pickups[i]);
  for (let i = 0; i < game.projectiles.length; i += 1) drawProjectile(game.projectiles[i]);
  for (let i = 0; i < game.enemies.length; i += 1) drawEnemy(game.enemies[i]);
  drawParticles();
  drawPlayer();
  drawRipples();

  ctx.restore();
  drawVignette();
}

function loop(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.033);
  lastFrame = now;

  if (!game) game = freshGameState();
  if (game.mode === "running") {
    updateRunning(dt);
  } else {
    if (game) {
      game.shake = Math.max(0, game.shake - dt * 18);
      game.shakeBiasX *= Math.exp(-11 * dt);
      game.shakeBiasY *= Math.exp(-11 * dt);
    }
    if (game && game.particles.length) {
      for (let i = game.particles.length - 1; i >= 0; i -= 1) {
        const part = game.particles[i];
        part.life -= dt;
        if (part.life <= 0) game.particles.splice(i, 1);
        else {
          part.vx *= Math.exp(-2.6 * dt);
          part.vy *= Math.exp(-2.6 * dt);
          part.x += part.vx * dt;
          part.y += part.vy * dt;
        }
      }
    }
    if (game && game.ripples.length) {
      for (let i = game.ripples.length - 1; i >= 0; i -= 1) {
        const r = game.ripples[i];
        r.life -= dt;
        if (r.life <= 0) game.ripples.splice(i, 1);
        else r.r += r.dr * dt;
      }
    }
  }

  audio.setGameplayAudioActive(!!(game && game.mode === "running"));
  audio.tick();
  renderFrame();
  rafId = requestAnimationFrame(loop);
}

function preventScrollKeys(event) {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
    event.preventDefault();
  }
}

ui.touchMoveButtons.forEach((button) => {
  const onRelease = (event) => {
    releaseTouchPointer(event.pointerId);
  };

  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    refreshTouchMode();
    const keyCode = button.dataset.touchKey;
    if (!keyCode) return;
    input.touchPointers.set(event.pointerId, keyCode);
    setTouchKey(keyCode, true);
    if (button.setPointerCapture) {
      try { button.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
    }
  });
  button.addEventListener("pointerup", onRelease);
  button.addEventListener("pointercancel", onRelease);
  button.addEventListener("lostpointercapture", onRelease);
  button.addEventListener("contextmenu", (event) => event.preventDefault());
});

const releaseDashTouch = (event) => {
  dashTouchPointers.delete(event.pointerId);
  ui.touchDashBtn.classList.toggle("isActive", dashTouchPointers.size > 0);
};

ui.touchDashBtn.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  refreshTouchMode();
  dashTouchPointers.add(event.pointerId);
  ui.touchDashBtn.classList.add("isActive");
  if (ui.touchDashBtn.setPointerCapture) {
    try { ui.touchDashBtn.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
  }
  if (game && game.mode === "running") queueDash();
});
ui.touchDashBtn.addEventListener("pointerup", releaseDashTouch);
ui.touchDashBtn.addEventListener("pointercancel", releaseDashTouch);
ui.touchDashBtn.addEventListener("lostpointercapture", releaseDashTouch);
ui.touchDashBtn.addEventListener("contextmenu", (event) => event.preventDefault());

if (ui.scoreEntryInitialsInput) {
  ui.scoreEntryInitialsInput.addEventListener("input", () => {
    const cleaned = sanitizeInitialsDraft(ui.scoreEntryInitialsInput.value);
    if (ui.scoreEntryInitialsInput.value !== cleaned) {
      ui.scoreEntryInitialsInput.value = cleaned;
    }
  });
}

if (ui.scoreEntryForm) {
  ui.scoreEntryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (pendingHighScoreScore == null) return;
    audio.ensure();
    audio.playMenu();
    submitPendingHighScoreScore();
  });
}

window.addEventListener("keydown", (event) => {
  const scoreEntryIsActive = !!(
    ui.scoreEntryForm &&
    !ui.scoreEntryForm.hidden &&
    event.target instanceof HTMLElement &&
    ui.scoreEntryForm.contains(event.target)
  );
  if (!scoreEntryIsActive) {
    preventScrollKeys(event);
  }
  audio.ensure();
  if (!scoreEntryIsActive) {
    input.keys[event.code] = true;
  }

  if (event.code === "Space") {
    if (game && game.mode === "running") queueDash();
  }

  if (event.code === "Enter") {
    if (scoreEntryIsActive) {
      return;
    }
    if (game && game.mode === "gameover") {
      audio.playMenu();
      resetRun();
    } else if (game && game.mode === "menu") {
      audio.playMenu();
      resetRun();
    }
  }
});

window.addEventListener("keyup", (event) => {
  input.keys[event.code] = false;
});

canvas.addEventListener("pointermove", (event) => {
  const rect = canvas.getBoundingClientRect();
  input.mouseX = event.clientX - rect.left;
  input.mouseY = event.clientY - rect.top;
  input.pointerActive = true;
});

canvas.addEventListener("pointerdown", (event) => {
  audio.ensure();
  const rect = canvas.getBoundingClientRect();
  input.mouseX = event.clientX - rect.left;
  input.mouseY = event.clientY - rect.top;
  input.pointerActive = true;
  if (event.pointerType === "touch" || event.pointerType === "pen") {
    refreshTouchMode();
  }
});

canvas.addEventListener("pointerleave", () => {
  input.pointerActive = false;
});

canvas.addEventListener("pointerup", (event) => {
  if (event.pointerType !== "mouse") input.pointerActive = false;
});

canvas.addEventListener("pointercancel", () => {
  input.pointerActive = false;
});

for (let i = 0; i < ui.difficultyButtons.length; i += 1) {
  const btn = ui.difficultyButtons[i];
  btn.addEventListener("click", () => {
    setSelectedDifficulty(btn.dataset.difficulty);
  });
}

ui.startBtn.addEventListener("click", () => {
  if (typeof audio !== "undefined") { audio.ensure(); audio.playMenu(); }
  resetRun();
});
ui.restartBtn.addEventListener("click", () => {
  if (typeof audio !== "undefined") { audio.ensure(); audio.playMenu(); }
  resetRun();
});
ui.backToMenuBtn.addEventListener("click", () => {
  if (typeof audio !== "undefined") { audio.ensure(); audio.playMenu(); }
  backToMenu();
});
if (ui.audioToggleBtn) {
  ui.audioToggleBtn.addEventListener("click", () => {
    audio.toggleMute();
  });
}
ui.menuMuteBtn.addEventListener("click", () => {
  audio.ensure();
  audio.playMenu();
  FX.full = !FX.full;
  ui.menuMuteBtn.textContent = FX.full ? "Toggle Glow FX" : "Enable Glow FX";
});

window.addEventListener("resize", resize);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", resize);
  window.visualViewport.addEventListener("scroll", resize);
}
if (coarsePointerQuery) {
  if (coarsePointerQuery.addEventListener) coarsePointerQuery.addEventListener("change", refreshTouchMode);
  else if (coarsePointerQuery.addListener) coarsePointerQuery.addListener(refreshTouchMode);
}
window.addEventListener("blur", () => {
  Object.keys(input.keys).forEach((k) => { input.keys[k] = false; });
  input.dashQueued = false;
  input.pointerActive = false;
  clearTouchInputs();
});
document.addEventListener("visibilitychange", audio.handleVisibility);

refreshTouchMode();
resize();
updateDifficultySelectionUI();
backToMenu();
updateHud();
if (rafId) cancelAnimationFrame(rafId);
rafId = requestAnimationFrame(loop);
