'use strict';

const ui = Object.fromEntries(
  ['field', 'score', 'best', 'level', 'lives', 'overlay', 'mode', 'title',
    'description', 'play', 'sound', 'pause', 'credits', 'upgrades', 'power', 'rate',
    'open-shop', 'shop', 'shop-coins', 'cannon-list', 'combat-tools', 'bonus', 'power-status', 'level-picker', 'level-select', 'level-goal'].map(id => [id, document.getElementById(id)])
);
const ctx = ui.field.getContext('2d');
const height = 560;
const floor = 520;
const shipY = floor - 17;
const gravity = 875;
const bounceHeights = [175, 250, 335];
const upgradeLimit = 4;
const accent = '#dcfc68';
const cannons = {
  pulse: {
    name: 'Pulse', description: 'Steady single shots straight up.',
    cost: 0, color: accent, interval: .108, damage: 8, radius: 2, barrels: [[0, 0]]
  },
  twin: {
    name: 'Twin', description: 'Two parallel shots per volley.',
    cost: 15, color: '#83e6ee', interval: .166, damage: 8, radius: 2, barrels: [[-9, 0], [9, 0]]
  },
  scatter: {
    name: 'Scatter', description: 'Three shots fan out across the arena.',
    cost: 30, color: '#ffb279', interval: .235, damage: 8, radius: 2, barrels: [[-8, -235], [0, 0], [8, 235]]
  },
  heavy: {
    name: 'Heavy', description: 'Larger, harder-hitting shots at a slower pace.',
    cost: 45, color: '#c2abff', interval: .254, damage: 28, radius: 5, barrels: [[0, 0]]
  }
};
const bonusCannon = {
  color: '#f9cf70', interval: .16, damage: 50, radius: 6, barrels: [[0, 0]]
};
const bonusLimit = 3;
const bonusDuration = 6;
const powerUps = {
  freeze: { name: 'Freeze', icon: '❄', color: '#9fe7ff', duration: 4 },
  double: { name: 'Double Shot', icon: '×2', color: '#ffb4e5', duration: 8 }
};
const powerUpKinds = Object.keys(powerUps);
const maxBallHealth = 5000;
const rockRadii = [15, 27, 43];
const finalLevel = 31;
const levelProgressKey = 'orbit-breaker-cleared-level';
const ballCountByLevel = [
  1, 2, 2, 3, 2, 3, 3, 4, 3, 4,
  3, 4, 4, 3, 4, 4, 3, 4, 4, 3,
  4, 4, 3, 4, 4, 3, 4, 4, 3, 4, 1
];
const ballHealthBySize = [.25, .5, 1];
const shotPowerPerUpgrade = 4;
const palettes = [
  ['#d9f774', '#687b32', '#242c1b'],
  ['#ff9bad', '#af536f', '#3a1e37'],
  ['#b9a4ff', '#705bc6', '#272244'],
  ['#83e6ee', '#348899', '#14303c']
];
const pressed = new Set();
const movementKeys = ['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const random = (min, max) => min + Math.random() * (max - min);
const format = (number, length) => String(number).padStart(length, '0');

function readBest() {
  try { return Number(localStorage.getItem('orbit-breaker-best')) || 0; }
  catch { return 0; }
}

function readUpgrades() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem('orbit-breaker-upgrades')); } catch {}
  const number = (key, max) => Number.isSafeInteger(saved?.[key]) ? clamp(saved[key], 0, max) : 0;
  const owned = ['pulse', ...Object.keys(cannons).filter(id =>
    id !== 'pulse' && Array.isArray(saved?.owned) && saved.owned.includes(id))];
  return {
    credits: number('credits', Number.MAX_SAFE_INTEGER),
    power: number('power', upgradeLimit),
    rate: number('rate', upgradeLimit),
    owned,
    equipped: owned.includes(saved?.equipped) ? saved.equipped : 'pulse'
  };
}

const upgrades = readUpgrades();
let best = readBest();
let width = 900;
let scene = 'ready';
let soundOn = false;
let audioContext;
let dragPointer = null;
let pointerX = null;
let clock = 0;
let previousTime = 0;
let ship;
let rocks = [];
let shots = [];
let sparks = [];
let drops = [];
let incoming = [];
let arrivalTimer = 0;
let score = 0;
let clearedLevel = 0;
try {
  const saved = Number(localStorage.getItem(levelProgressKey));
  if (Number.isInteger(saved)) clearedLevel = clamp(saved, 0, finalLevel);
} catch {}
let level = Math.min(clearedLevel + 1, finalLevel);
let levelScoreStart = 0;
let lives = 3;
let cooldown = 0;
let clearTime = 0;
let invulnerable = 0;
let levelBanner = 0;
let bonusEarned = 0;
let bonusStock = 0;
let bonusTime = 0;
const powerTime = { freeze: 0, double: 0 };

function updateCombatTools() {
  const active = bonusTime > 0;
  const bonusLabel = active
    ? '50 DMG cannon · ' + Math.ceil(bonusTime) + 's'
    : '50 DMG cannon · ' + bonusStock + ' ready';
  if (ui.bonus.textContent !== bonusLabel) ui.bonus.textContent = bonusLabel;
  ui.bonus.disabled = active || bonusStock === 0 || scene !== 'playing';

  const effects = Object.entries(powerUps).filter(([key]) => powerTime[key] > 0)
    .map(([key, effect]) => effect.name + ' ' + Math.ceil(powerTime[key]) + 's');
  const status = effects.join(' · ');
  if (ui['power-status'].textContent !== status) ui['power-status'].textContent = status;

  const remaining = incoming.length * 7 + rocks.reduce((total, rock) => total + [1, 3, 7][rock.tier], 0);
  const goal = remaining === 0
    ? 'Collect remaining coins'
    : remaining + (remaining === 1 ? ' target left' : ' targets left');
  if (ui['level-goal'].textContent !== goal) ui['level-goal'].textContent = goal;
}

function activateBonus() {
  if (scene !== 'playing' || bonusStock === 0 || bonusTime > 0) return;
  bonusStock--;
  bonusTime = bonusDuration;
  cooldown = 0;
  updateCombatTools();
  tone(530, 950, .18, .08);
}

function activeCannon() {
  return bonusTime > 0 ? bonusCannon : cannons[upgrades.equipped];
}

ui.bonus.addEventListener('click', activateBonus);

function updateHud() {
  ui.score.textContent = format(score, 4);
  ui.best.textContent = format(best, 4);
  ui.level.textContent = format(level, 2);
  ui.lives.textContent = '♥'.repeat(lives) + '♡'.repeat(3 - lives);
  ui.lives.setAttribute('aria-label', lives + (lives === 1 ? ' life' : ' lives'));
}

function upgradeCost(level) {
  return 4 + level * 5;
}

function canChangeLoadout() {
  return ['ready', 'over', 'cleared', 'won'].includes(scene);
}

function chooseCannon(id) {
  if (!canChangeLoadout()) return;
  if (upgrades.equipped === id) return;
  if (!upgrades.owned.includes(id)) {
    const { cost } = cannons[id];
    if (upgrades.credits < cost) return;
    upgrades.credits -= cost;
    upgrades.owned.push(id);
  }
  upgrades.equipped = id;
  saveUpgrades();
  tone(420, 790, .16, .07);
}

const cannonButtons = new Map();
for (const [id, cannon] of Object.entries(cannons)) {
  const row = document.createElement('li');
  row.className = 'cannon-option';
  const details = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = cannon.name;
  name.style.color = cannon.color;
  const description = document.createElement('p');
  description.textContent = cannon.description;
  details.append(name, description);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'utility';
  button.addEventListener('click', () => chooseCannon(id));
  cannonButtons.set(id, button);
  row.append(details, button);
  ui['cannon-list'].append(row);
}

ui['open-shop'].addEventListener('click', () => ui.shop.showModal());

function updateUpgrades() {
  const coins = upgrades.credits.toLocaleString();
  ui.credits.textContent = coins;
  ui['shop-coins'].textContent = coins + ' coins';
  ui['open-shop'].textContent = 'Cannons · ' + cannons[upgrades.equipped].name;
  for (const [id, button] of cannonButtons) {
    const equipped = upgrades.equipped === id;
    const owned = upgrades.owned.includes(id);
    const { name, cost } = cannons[id];
    const label = equipped ? 'Equipped' : owned ? 'Equip' : 'Unlock · ' + cost + ' coins';
    button.textContent = label;
    button.setAttribute('aria-label', name + ' · ' + label);
    button.disabled = equipped || (!owned && upgrades.credits < cost);
  }
  for (const [key, title] of [['power', 'Shot power'], ['rate', 'Fire rate']]) {
    const level = upgrades[key];
    const maxed = level === upgradeLimit;
    const cost = upgradeCost(level);
    ui[key].textContent = maxed ? title + ' · Max' : title + ' ' + (level + 1) + ' · ' + cost + ' coins';
    ui[key].disabled = maxed || upgrades.credits < cost;
  }
}

function saveUpgrades() {
  try { localStorage.setItem('orbit-breaker-upgrades', JSON.stringify(upgrades)); } catch {}
  updateUpgrades();
}

for (const key of ['power', 'rate']) {
  ui[key].addEventListener('click', () => {
    if (!canChangeLoadout()) return;
    const cost = upgradeCost(upgrades[key]);
    if (upgrades[key] >= upgradeLimit || upgrades.credits < cost) return;
    upgrades.credits -= cost;
    upgrades[key]++;
    saveUpgrades();
    tone(420, 790, .16, .07);
  });
}

function fitCanvas() {
  const bounds = ui.field.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const scale = Math.min(devicePixelRatio || 1, 2);
  const oldWidth = width;
  width = height * bounds.width / bounds.height;
  ui.field.width = Math.round(bounds.width * scale);
  ui.field.height = Math.round(bounds.height * scale);
  ctx.setTransform(ui.field.width / width, 0, 0, ui.field.height / height, 0, 0);
  if (!ship) return;
  ship.x = clamp(ship.x / oldWidth * width, 23, width - 23);
  if (pointerX !== null) pointerX = pointerX / oldWidth * width;
  for (const rock of rocks) {
    rock.x = clamp(rock.x / oldWidth * width, rock.radius, width - rock.radius);
  }
  for (const shot of shots) shot.x = shot.x / oldWidth * width;
  for (const drop of drops) drop.x = clamp(drop.x / oldWidth * width, 8, width - 8);
}

function tone(frequency, end, duration, volume) {
  if (!soundOn || !audioContext || audioContext.state !== 'running') return;
  const time = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(frequency, time);
  oscillator.frequency.exponentialRampToValueAtTime(end, time + duration);
  gain.gain.setValueAtTime(volume, time);
  gain.gain.exponentialRampToValueAtTime(.001, time + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(time);
  oscillator.stop(time + duration);
}

ui.sound.addEventListener('click', async () => {
  soundOn = !soundOn;
  try {
    if (soundOn) {
      audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
      await audioContext.resume();
    }
  } catch { soundOn = false; }
  ui.sound.setAttribute('aria-pressed', String(soundOn));
  ui.sound.textContent = soundOn ? 'Sound on' : 'Sound off';
  tone(400, 620, .11, .05);
});

function updatePlayButton() {
  const selected = Number(ui['level-select'].value);
  if (scene === 'cleared' && selected === level + 1) {
    ui.play.textContent = 'Next level';
    return;
  }
  const action = selected === level && scene === 'over' ? 'Retry' : 'Play';
  ui.play.textContent = action + ' level ' + selected;
}

function showLevelPicker(selected) {
  const unlocked = Math.min(clearedLevel + 1, finalLevel);
  const options = [];
  for (let number = 1; number <= unlocked; number++) {
    const option = document.createElement('option');
    option.value = number;
    option.textContent = 'Level ' + number + (number <= clearedLevel ? ' · Cleared' : '');
    options.push(option);
  }
  ui['level-select'].replaceChildren(...options);
  ui['level-select'].value = selected;
  updatePlayButton();
}

function setScene(value) {
  scene = value;
  pressed.clear();
  pointerX = null;
  dragPointer = null;
  const playing = value === 'playing';
  const paused = value === 'paused';
  const canChoose = canChangeLoadout();
  ui.overlay.hidden = playing;
  ui.overlay.dataset.screen = value;
  ui['combat-tools'].hidden = !playing && !paused;
  ui['level-picker'].hidden = !canChoose;
  ui.upgrades.hidden = !canChoose;
  ui.pause.disabled = !playing && !paused;
  ui.pause.textContent = paused ? 'Resume' : 'Pause';
  updateCombatTools();
  if (playing || value === 'ready') return;

  ui.mode.textContent = 'LEVEL ' + format(level, 2) + ' / ' + finalLevel;
  if (paused) {
    ui.title.textContent = 'Paused';
    ui.description.textContent = 'Your level is on hold.';
    ui.play.textContent = 'Resume level';
  } else if (value === 'over') {
    ui.title.textContent = 'Try again';
    ui.description.textContent = 'Score ' + score.toLocaleString() + ' · Best ' + best.toLocaleString();
    showLevelPicker(level);
  } else {
    ui.title.textContent = value === 'won' ? 'Game cleared' : 'Level cleared';
    const points = score - levelScoreStart;
    const reward = bonusStock > 0 ? ' · ' + bonusStock + ' bonus cannon charges ready' : '';
    ui.description.textContent = '+' + points.toLocaleString() + ' points' + reward;
    showLevelPicker(Math.min(level + 1, finalLevel));
  }
  if (!document.hidden) ui.play.focus({ preventScroll: true });
}

function togglePause() {
  if (scene === 'playing') setScene('paused');
  else if (scene === 'paused') setScene('playing');
}

function ballHealth(tier) {
  const stagesCleared = level - 1;
  const largeBallHealth = 120 + 45 * stagesCleared + 4 * stagesCleared ** 2;
  return Math.min(maxBallHealth, Math.round(largeBallHealth * ballHealthBySize[tier]));
}

function ballHealthLabel(hp) {
  if (hp < 1000) return String(hp);
  return Math.floor(hp / 100) / 10 + 'k';
}

function makeLevelBalls(count) {
  const health = ballHealthBySize.map((_, tier) => {
    const baseline = ballHealth(tier);
    const spread = Math.min(Math.floor(baseline * .18), maxBallHealth - baseline);
    const values = Array(count * 2 ** (2 - tier)).fill(baseline);
    // Balance each random health gain with an equal loss on another ball.
    for (let i = 0; i + 1 < values.length; i += 2) {
      const shift = Math.floor(random(-spread, spread + 1));
      values[i] += shift;
      values[i + 1] -= shift;
    }
    if (values.length % 2 === 1 && Math.random() < .5) values.reverse();
    return values;
  });

  if (count === 1) {
    // A lone large ball shares its health budget with one of its fragments.
    const large = health[2][0];
    const fragment = Math.floor(random(0, health[1].length));
    const spread = Math.floor(ballHealth(1) * .12);
    const shift = Math.floor(random(-spread, Math.min(spread, maxBallHealth - large) + 1));
    health[2][0] += shift;
    health[1][fragment] -= shift;
  }

  const carriers = [];
  function makePlan(tier) {
    const plan = { tier, hp: health[tier].pop(), fragments: [], powerUp: null };
    if (tier > 0) {
      carriers.push(plan);
      plan.fragments = [makePlan(tier - 1), makePlan(tier - 1)];
    }
    return plan;
  }
  const firstSide = Math.random() < .5 ? -1 : 1;
  const balls = Array.from({ length: count }, (_, index) => Object.assign(makePlan(2), {
    side: index % 2 === 0 ? firstSide : -firstSide,
    inset: random(.02, .33),
    startY: random(76, 150),
    startVY: random(35, 110)
  }));
  // Keep one drop per level, with both its type and carrier randomized.
  const carrier = carriers[Math.floor(random(0, carriers.length))];
  carrier.powerUp = powerUpKinds[Math.floor(random(0, powerUpKinds.length))];
  return balls.reverse();
}

function makeRock(x, y, vx, vy, palette, plan) {
  return {
    x, y, vx, vy, palette,
    tier: plan.tier, radius: rockRadii[plan.tier], hp: plan.hp,
    fragments: plan.fragments, powerUp: plan.powerUp,
    spin: random(-1.6, 1.6), angle: random(0, Math.PI * 2), flash: 0
  };
}

function launchRock() {
  const plan = incoming.pop();
  const radius = rockRadii[plan.tier];
  const leftX = radius + (width - 2 * radius) * plan.inset;
  const x = plan.side < 0 ? leftX : width - leftX;
  const speed = Math.min(270, 112 + 13 * level);
  const palette = palettes[(level + incoming.length) % palettes.length];
  rocks.push(makeRock(x, plan.startY, -plan.side * speed, plan.startVY, palette, plan));
  arrivalTimer = Math.max(.46, .9 - level * .025);
}

function startLevel(selectedLevel, continuing = false) {
  if (!continuing) {
    score = 0;
    bonusEarned = 0;
    bonusStock = 0;
  }
  level = selectedLevel;
  levelScoreStart = score;
  lives = 3;
  ship = { x: width / 2 };
  invulnerable = 0;
  cooldown = 0;
  rocks = [];
  shots = [];
  sparks = [];
  drops = [];
  bonusTime = 0;
  powerTime.freeze = 0;
  powerTime.double = 0;
  incoming = makeLevelBalls(ballCountByLevel[level - 1]);
  levelBanner = .9;
  clearTime = 0;
  launchRock();
  updateHud();
  setScene('playing');
}

function completeLevel() {
  if (level > clearedLevel) {
    clearedLevel = level;
    try { localStorage.setItem(levelProgressKey, String(clearedLevel)); } catch {}
  }
  if (bonusEarned < bonusLimit) {
    bonusEarned++;
    bonusStock++;
  }
  tone(350, 820, .24, .065);
  setScene(level === finalLevel ? 'won' : 'cleared');
}

ui['level-select'].addEventListener('change', updatePlayButton);
ui.play.addEventListener('click', () => {
  if (scene === 'paused') {
    togglePause();
    return;
  }
  if (!canChangeLoadout()) return;
  const selected = Number(ui['level-select'].value);
  if (!Number.isInteger(selected) || selected < 1 || selected > Math.min(clearedLevel + 1, finalLevel)) return;
  startLevel(selected, scene === 'cleared' && selected === level + 1);
});
ui.pause.addEventListener('click', togglePause);

window.addEventListener('keydown', event => {
  if (movementKeys.includes(event.code) && scene === 'playing') {
    event.preventDefault();
    pressed.add(event.code);
    pointerX = null;
  }
  if (ui.shop.open) return;
  if (event.code === 'Space' && scene === 'playing' && event.target !== ui.pause && event.target !== ui.sound) {
    event.preventDefault();
    if (!event.repeat) activateBonus();
  }
  if ((event.code === 'KeyP' || event.code === 'Escape') && !event.repeat) togglePause();
});
window.addEventListener('keyup', event => pressed.delete(event.code));
window.addEventListener('blur', () => {
  if (scene === 'playing') setScene('paused');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && scene === 'playing') setScene('paused');
});

function steer(event) {
  const bounds = ui.field.getBoundingClientRect();
  pointerX = clamp((event.clientX - bounds.left) / bounds.width * width, 23, width - 23);
}

ui.field.addEventListener('pointerdown', event => {
  if (scene !== 'playing' || !event.isPrimary) return;
  dragPointer = event.pointerId;
  ui.field.setPointerCapture(event.pointerId);
  steer(event);
});
ui.field.addEventListener('pointermove', event => {
  if (scene === 'playing' && (event.pointerType === 'mouse' || event.pointerId === dragPointer)) {
    steer(event);
  }
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  ui.field.addEventListener(name, event => {
    if (event.pointerId === dragPointer) dragPointer = null;
  });
}

function burst(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = random(0, Math.PI * 2);
    const speed = random(28, 220);
    sparks.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      duration: random(.22, .52), color, radius: random(1.4, 3.8) });
  }
}

function hitRock(rock, index, shot) {
  rock.hp -= shot.damage;
  rock.flash = .065;
  burst(shot.x, shot.y, rock.palette[0], 4);
  if (rock.hp > 0) {
    tone(380, 220, .065, .025);
    return;
  }
  rocks.splice(index, 1);
  burst(rock.x, rock.y, rock.palette[0], 18);
  score += [30, 60, 100][rock.tier];
  drops.push({ x: rock.x, y: rock.y, vy: -115, timeOnFloor: 0, amount: rock.tier + 1 });
  if (rock.powerUp) {
    const x = clamp(rock.x + (rock.x < width / 2 ? 28 : -28), 13, width - 13);
    drops.push({ x, y: rock.y, vy: -200, timeOnFloor: 0, kind: rock.powerUp });
  }
  if (score > best) {
    best = score;
    try { localStorage.setItem('orbit-breaker-best', String(best)); } catch {}
  }
  updateHud();
  tone(170, 63, .22, .08);
  for (const [fragmentIndex, fragment] of rock.fragments.entries()) {
    const direction = fragmentIndex === 0 ? -1 : 1;
    const radius = rockRadii[fragment.tier];
    const x = clamp(rock.x + direction * radius * .85, radius, width - radius);
    rocks.push(makeRock(x, rock.y, direction * Math.min(320, Math.abs(rock.vx) + 54),
      -Math.sqrt(2 * gravity * Math.min(132, Math.max(24, rock.y - radius - 12))),
      rock.palette, fragment));
  }
}

function updateDrops(dt) {
  let collectedCoins = false;
  drops = drops.filter(drop => {
    drop.vy += 690 * dt;
    drop.y = Math.min(floor - 8, drop.y + drop.vy * dt);
    if (drop.y >= floor - 8) drop.timeOnFloor += dt;
    if (drop.y >= shipY - 23 && Math.abs(drop.x - ship.x) < 35) {
      if (drop.kind) {
        const effect = powerUps[drop.kind];
        powerTime[drop.kind] = effect.duration;
        burst(drop.x, drop.y, effect.color, 15);
        tone(420, 1200, .2, .065);
      } else {
        upgrades.credits += drop.amount;
        burst(drop.x, drop.y, '#ffd574', 7);
        tone(700, 1040, .09, .045);
        collectedCoins = true;
      }
      return false;
    }
    return drop.timeOnFloor < (drop.kind ? 5 : 3);
  });
  if (collectedCoins) saveUpgrades();
}

function update(dt) {
  const left = pressed.has('ArrowLeft') || pressed.has('KeyA');
  const right = pressed.has('ArrowRight') || pressed.has('KeyD');
  const speed = 870;
  if (left || right) ship.x += (Number(right) - Number(left)) * speed * dt;
  else if (pointerX !== null) ship.x += clamp(pointerX - ship.x, -speed * dt, speed * dt);
  ship.x = clamp(ship.x, 23, width - 23);

  bonusTime = Math.max(0, bonusTime - dt);
  powerTime.freeze = Math.max(0, powerTime.freeze - dt);
  powerTime.double = Math.max(0, powerTime.double - dt);
  const frozen = powerTime.freeze > 0;
  cooldown -= dt;
  if (cooldown <= 0) {
    const cannon = activeCannon();
    const damage = cannon === bonusCannon
      ? cannon.damage
      : cannon.damage + upgrades.power * shotPowerPerUpgrade;
    const volleyOffsets = powerTime.double > 0 ? [-10, 10] : [0];
    for (const shift of volleyOffsets) {
      for (const [offset, vx] of cannon.barrels) {
        shots.push({ x: ship.x + offset + shift, y: shipY - 22, vx, damage,
          radius: cannon.radius, color: cannon.color });
      }
    }
    cooldown = cannon.interval * (1 - upgrades.rate * .13);
  }
  invulnerable -= dt;
  levelBanner -= dt;
  if (!frozen) {
    arrivalTimer -= dt;
    if (incoming.length > 0 && arrivalTimer <= 0) launchRock();
  }

  for (const rock of rocks) {
    rock.flash -= dt;
    if (frozen) continue;
    rock.x += rock.vx * dt;
    rock.vy += gravity * dt;
    rock.y += rock.vy * dt;
    rock.angle += rock.spin * dt;
    if (rock.x < rock.radius || rock.x > width - rock.radius) {
      rock.x = clamp(rock.x, rock.radius, width - rock.radius);
      rock.vx = rock.x <= rock.radius ? Math.abs(rock.vx) : -Math.abs(rock.vx);
    }
    if (rock.y > floor - rock.radius) {
      rock.y = floor - rock.radius;
      rock.vy = -Math.sqrt(2 * gravity * bounceHeights[rock.tier]);
    }
  }

  for (let i = shots.length - 1; i >= 0; i--) {
    const shot = shots[i];
    shot.x += shot.vx * dt;
    shot.y -= 820 * dt;
    const index = rocks.findIndex(rock => Math.hypot(rock.x - shot.x, rock.y - shot.y) < rock.radius + shot.radius);
    if (index >= 0) hitRock(rocks[index], index, shot);
    if (index >= 0 || shot.y < -15 || shot.x < -shot.radius || shot.x > width + shot.radius) {
      shots.splice(i, 1);
    }
  }

  if (!frozen && invulnerable <= 0 && rocks.some(rock => {
    const nearestX = clamp(rock.x, ship.x - 18, ship.x + 18);
    const nearestY = clamp(rock.y, shipY - 11, shipY + 10);
    return Math.hypot(nearestX - rock.x, nearestY - rock.y) < rock.radius * .93;
  })) {
    lives--;
    invulnerable = 1.8;
    burst(ship.x, shipY, '#ff829e', 25);
    tone(120, 42, .34, .12);
    updateHud();
    if (lives === 0) setScene('over');
  }
  for (const spark of sparks) {
    spark.x += spark.vx * dt;
    spark.y += spark.vy * dt;
    spark.vy += 150 * dt;
    spark.duration -= dt;
  }
  sparks = sparks.filter(spark => spark.duration > 0);
  updateDrops(dt);
  if (scene === 'playing' && rocks.length === 0 && incoming.length === 0) {
    clearTime += dt;
    // Allow the last coins to land and be collected before opening the results screen.
    if (clearTime >= 2.6 || (clearTime >= .5 && !drops.some(drop => !drop.kind))) {
      completeLevel();
      return;
    }
  }
  updateCombatTools();
}

function ellipse(x, y, radiusX, radiusY, angle, color, stroke = false) {
  ctx.beginPath();
  ctx.ellipse(x, y, radiusX, radiusY, angle, 0, Math.PI * 2);
  if (stroke) {
    ctx.strokeStyle = color;
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function background() {
  const glow = ctx.createRadialGradient(width * .72, 202, 20, width * .72, 250, width * .68 + 80);
  glow.addColorStop(0, '#302743');
  glow.addColorStop(1, '#141421');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#b2a6cf19';
  ctx.beginPath();
  for (let x = width % 44 / 2; x < width; x += 44) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, floor);
  }
  for (let y = 36; y < floor; y += 44) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  for (let i = 0; i < 53; i++) {
    const x = ((i * 347 + 27) % 997) / 997 * width;
    const y = (i * 73 + 53) % 501;
    ctx.fillStyle = i % 7 === 0 ? '#c5b9ee8e' : '#9c8db856';
    ctx.fillRect(x, y, i % 7 === 0 ? 2.3 : 1.15, i % 7 === 0 ? 2.3 : 1.15);
  }
  ctx.fillStyle = '#15151f';
  ctx.fillRect(0, floor, width, height - floor);
  ctx.fillStyle = '#55516b';
  ctx.fillRect(0, floor, width, 1.5);
  ctx.fillStyle = '#71678355';
  for (let x = 15; x < width; x += 24) ctx.fillRect(x, floor + 5, 1, 7);
}

function planetoid(rock, showHealth = true) {
  const { x, y, radius, palette, angle } = rock;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const fill = ctx.createRadialGradient(-radius * .3, -radius * .35, 0, 0, 0, radius * 1.1);
  fill.addColorStop(0, rock.flash > 0 ? '#ffffff' : palette[1]);
  fill.addColorStop(1, palette[2]);
  ctx.lineWidth = Math.max(1, radius * .035);
  ellipse(0, 0, radius, radius, 0, fill);
  ellipse(0, 0, radius, radius, 0, palette[0], true);
  if (showHealth && powerTime.freeze > 0) {
    ellipse(0, 0, radius - 1, radius - 1, 0, '#9fe7ff55');
    ellipse(0, 0, radius + 2, radius + 2, 0, powerUps.freeze.color, true);
  }
  ellipse(-radius * .36, -radius * .38, radius * .23, radius * .14, -.5, palette[2] + '88');
  ellipse(radius * .42, radius * .2, radius * .25, radius * .14, -.5, palette[2] + '88');
  ellipse(-radius * .12, radius * .57, radius * .16, radius * .09, .3, palette[2] + 'bb');
  ctx.restore();
  if (showHealth) {
    ctx.font = 'bold ' + Math.max(13, radius * .65) + 'px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = palette[2];
    ctx.lineWidth = 3;
    const label = ballHealthLabel(rock.hp);
    ctx.strokeText(label, x, y + 1, radius * 1.65);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x, y + 1, radius * 1.65);
  }
}

function cannon(x, y, scale = 1) {
  const { barrels, color, radius } = activeCannon();
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.lineJoin = 'round';
  ctx.fillStyle = '#858497';
  ctx.fillRect(-22, 7, 44, 6);
  ctx.fillStyle = '#1c2231';
  ctx.beginPath();
  ctx.moveTo(-21, 7);
  ctx.lineTo(-12, -7);
  ctx.lineTo(12, -7);
  ctx.lineTo(21, 7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = color;
  const barrelWidth = radius > 2 ? 13 : 7;
  for (const [offset] of barrels) {
    ctx.fillRect(offset - barrelWidth / 2, -23, barrelWidth, 17);
  }
  ctx.fillRect(-14, 2, 28, 3);
  ctx.restore();
}

function titleArt() {
  const x = width * .73;
  const y = 236;
  const radius = Math.min(width * .21, 135);
  ctx.save();
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 7]);
  ellipse(x, y, radius * 1.6, radius * .59, -.55, '#bcb0e772', true);
  ellipse(x, y, radius * 1.85, radius * .78, -.55, '#bcb0e744', true);
  ctx.setLineDash([]);
  planetoid({ x, y: y + Math.sin(clock) * 7, radius, angle: clock * .08, palette: palettes[2] }, false);
  planetoid({ x: x + radius * .96, y: y - radius * .96, radius: radius * .29,
    angle: .6, palette: palettes[0] }, false);
  planetoid({ x: x - radius * .99, y: y + radius * .89, radius: radius * .21,
    angle: -.8, palette: palettes[1] }, false);
  ctx.restore();
  cannon(x + radius * .15, shipY - 24, 2);
}

function draw() {
  background();
  if (scene === 'ready') {
    titleArt();
    return;
  }

  for (const shot of shots) {
    ctx.save();
    ctx.translate(shot.x, shot.y);
    ctx.rotate(Math.atan2(shot.vx, 820));
    ctx.fillStyle = shot.color + '66';
    ctx.fillRect(-shot.radius - 1, -6, shot.radius * 2 + 2, 21);
    ctx.fillStyle = shot.color;
    ctx.fillRect(-shot.radius / 1.5, -6, shot.radius * 2 / 1.5, 13);
    ctx.restore();
  }
  for (const rock of rocks) planetoid(rock);
  for (const drop of drops) {
    const effect = powerUps[drop.kind];
    const lifetime = effect ? 5 : 3;
    ctx.globalAlpha = clamp((lifetime - drop.timeOnFloor) / .55, 0, 1);
    ctx.lineWidth = 1.5;
    if (effect) {
      ellipse(drop.x, drop.y - 4, 11, 11, 0, '#1b2030');
      ellipse(drop.x, drop.y - 4, 11, 11, 0, effect.color, true);
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = effect.color;
      ctx.fillText(effect.icon, drop.x, drop.y - 3);
    } else {
      ellipse(drop.x, drop.y, 6.5, 6.5, 0, '#ffd574');
      ellipse(drop.x, drop.y, 3.4, 3.4, 0, '#9a5b22', true);
    }
  }
  ctx.globalAlpha = 1;
  for (const spark of sparks) {
    ctx.globalAlpha = clamp(spark.duration * 4, 0, 1);
    ctx.fillStyle = spark.color;
    ctx.fillRect(spark.x, spark.y, spark.radius, spark.radius);
  }
  ctx.globalAlpha = 1;
  if (lives > 0 && (invulnerable <= 0 || Math.floor(invulnerable * 12) % 2 === 0)) {
    cannon(ship.x, shipY);
  }

  if (levelBanner > 0 || clearTime > 0) {
    ctx.font = 'bold 21px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = accent;
    ctx.strokeStyle = '#1a1927';
    ctx.lineWidth = 5;
    const message = clearTime > 0 ? 'LEVEL CLEARED' : 'LEVEL ' + format(level, 2);
    ctx.strokeText(message, width / 2, 32);
    ctx.fillText(message, width / 2, 32);
  }
}

function frame(time) {
  const dt = Math.min((time - previousTime) / 1000, .032);
  previousTime = time;
  clock += dt;
  if (scene === 'playing') {
    update(dt / 2);
    if (scene === 'playing') update(dt / 2);
  }
  draw();
  requestAnimationFrame(frame);
}

new ResizeObserver(fitCanvas).observe(ui.field);
fitCanvas();
showLevelPicker(level);
updateHud();
updateUpgrades();
requestAnimationFrame(frame);
