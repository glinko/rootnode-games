'use strict';

/*
 * ClockShift is deliberately a small, dependency-free p5.js port of the
 * Clockwork prototype. The JSON files remain the source of truth for levels;
 * this file owns the fixed-step model and the presentation layer only.
 */
const CFG = Object.freeze({
  step: 1 / 120,
  length: 0.90,
  bodyRadius: 0.035,
  nodeRadius: 0.05,
  captureRadius: 0.12,
  endZone: 0.10,
  baseOmega: Math.PI / 2,
  speedMultiplier: 1.30,
  captureWindow: Math.PI / 12,
  gravity: { x: 0, y: -3 },
  restitution: 0.80,
  epsilon: 1e-7
});

let canvas;
let campaign = [];
let customLevels = [];
let levelIndex = 0;
let sim = null;
let accumulator = 0;
let lastFrame = 0;
let flash = 0;
let flashPoint = null;
let audioContext = null;
let progress = loadProgress();

const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;
const v = (x, y) => ({ x, y });
const add = (a, b) => v(a.x + b.x, a.y + b.y);
const sub = (a, b) => v(a.x - b.x, a.y - b.y);
const mul = (a, n) => v(a.x * n, a.y * n);
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const lengthOf = a => Math.hypot(a.x, a.y);
const unit = angle => v(Math.cos(angle), Math.sin(angle));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const normAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
const finite = n => Number.isFinite(n);

function directedPhase(current, target, omega) {
  let phase = normAngle(target - current);
  if (omega > 0 && phase < 0) phase += TAU;
  if (omega < 0 && phase > 0) phase -= TAU;
  return phase;
}

function distancePointSegment(point, a, b) {
  const d = sub(b, a);
  const dd = dot(d, d);
  const t = dd < 1e-12 ? 0 : clamp(dot(sub(point, a), d) / dd, 0, 1);
  return lengthOf(sub(point, add(a, mul(d, t))));
}

function distanceSegments(a, b, c, d) {
  const ab = sub(b, a), cd = sub(d, c);
  const denominator = cross(ab, cd);
  if (Math.abs(denominator) > 1e-12) {
    const t = cross(sub(c, a), cd) / denominator;
    const u = cross(sub(c, a), ab) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(distancePointSegment(a, c, d), distancePointSegment(b, c, d),
    distancePointSegment(c, a, b), distancePointSegment(d, a, b));
}

function copyPoint(point) { return v(point.x, point.y); }

function nodeById(level, id) {
  return level.nodes.find(node => node.id === id) || null;
}

function bodyEnds(body) {
  const direction = unit(body.angle);
  return [sub(body.center, mul(direction, CFG.length / 2)), add(body.center, mul(direction, CFG.length / 2))];
}

function bodySegment(body) {
  const ends = bodyEnds(body);
  return { a: ends[0], b: ends[1], ends };
}

function syncAttached(body, levelOverride = null) {
  const level = levelOverride || (sim && sim.level); if (!level) return;
  const pivot = nodeById(level, body.pivotId);
  if (!pivot) return;
  body.anchor = v(pivot.x, pivot.y);
  body.center = add(body.anchor, mul(unit(body.angle), body.pivotEnd === 0 ? CFG.length / 2 : -CFG.length / 2));
  body.velocity = v(0, 0);
}

function spawn(spawnData, enemy = false, levelOverride = null) {
  const angle = Number(spawnData.initialAngleDeg) * Math.PI / 180;
  const omega = Number(spawnData.omegaDegSigned) * Math.PI / 180 * CFG.speedMultiplier;
  const body = {
    mode: 'attached', pivotId: spawnData.pivotId, pivotEnd: 0,
    angle, omega, center: v(0, 0), anchor: v(0, 0), velocity: v(0, 0),
    enemy, routeIndex: 0, routeDirection: 1, routeTimer: 0,
    routePending: false, contacts: new Set(), alive: true
  };
  syncAttached(body, levelOverride);
  return body;
}

function validateLevel(level) {
  if (!level || level.schemaVersion !== 1) throw new Error('Unsupported level schema');
  if (!level.id || !level.bounds || !level.player || !Array.isArray(level.nodes)) throw new Error('Incomplete level data');
  if (!nodeById(level, level.player.pivotId) || !nodeById(level, level.exitNodeId)) throw new Error('Level references an unknown hinge');
  const ids = new Set(); const coordinates = new Set();
  for (const node of level.nodes) {
    if (!node.id || ids.has(node.id) || !Number.isInteger(node.x) || !Number.isInteger(node.y)) throw new Error('Invalid hinge');
    ids.add(node.id); const key = node.x + ',' + node.y;
    if (coordinates.has(key)) throw new Error('Duplicate hinge coordinate');
    coordinates.add(key);
  }
  for (const group of ['walls', 'bumpers', 'spikes', 'bonuses', 'enemies', 'doors', 'switches', 'teleporters']) {
    if (!Array.isArray(level[group])) level[group] = [];
  }
  return level;
}

function loadProgress() {
  try {
    const raw = JSON.parse(localStorage.getItem('clockshift.progress.v1') || '{}');
    return { completed: Array.isArray(raw.completed) ? raw.completed : [], last: Number.isInteger(raw.last) ? raw.last : 0 };
  } catch (_) { return { completed: [], last: 0 }; }
}

function saveProgress() {
  try { localStorage.setItem('clockshift.progress.v1', JSON.stringify(progress)); } catch (_) { /* private browsing may deny storage */ }
}

function readLocalCustomLevels() {
  try {
    const raw = JSON.parse(localStorage.getItem('clockshift.customLevels.v1') || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (_) { return []; }
}

function validateCustomRow(row) {
  if (!row || typeof row !== 'object' || !row.level || typeof row.level !== 'object') return null;
  const level = { ...row.level, id: String(row.id || row.level.id || '') };
  if (!level.id || level.id.startsWith('training_')) return null;
  try {
    validateLevel(level);
    level.source = 'custom';
    level.title = String(level.title || 'Community level').slice(0, 80);
    return level;
  } catch (_) { return null; }
}

async function loadCustomLevels() {
  const localRows = readLocalCustomLevels();
  let remoteRows = [];
  try {
    const response = await fetch('/api/clockshift/levels', { cache: 'no-store' });
    if (response.ok) {
      const payload = await response.json();
      remoteRows = Array.isArray(payload) ? payload : Array.isArray(payload.levels) ? payload.levels : [];
    }
  } catch (_) { /* a static preview can continue with its local cache */ }
  const merged = new Map();
  [...localRows, ...remoteRows].forEach(row => { if (row && row.id) merged.set(row.id, row); });
  customLevels = [...merged.values()].map(validateCustomRow).filter(Boolean);
  return customLevels;
}

async function loadCampaign() {
  try {
    const files = Array.from({ length: 10 }, (_, index) => 'levels/training_' + String(index + 1).padStart(2, '0') + '.json');
    const loaded = await Promise.all(files.map(file => fetch(file).then(response => {
      if (!response.ok) throw new Error('Could not load ' + file);
      return response.json();
    })));
    campaign = loaded.map(validateLevel);
    await loadCustomLevels();
    campaign = campaign.concat(customLevels);
    const requestedId = new URLSearchParams(window.location.search).get('level');
    const requestedIndex = requestedId ? campaign.findIndex(level => level.id === requestedId) : -1;
    levelIndex = requestedIndex >= 0 ? requestedIndex : clamp(progress.last, 0, campaign.length - 1);
    buildLevelList();
    resetLevel();
  } catch (error) {
    $('hint').textContent = 'Level data could not be loaded: ' + error.message;
    $('level-title').textContent = 'Load error';
    console.error(error);
  }
}

function resetLevel() {
  if (!campaign.length) return;
  const level = campaign[levelIndex];
  const player = spawn(level.player, false, level);
  const enemies = level.enemies.map(enemy => {
    const body = spawn(enemy, true, level);
    if (enemy.pathNodeIds && enemy.pathNodeIds.length >= 2) body.routeTimer = 1 / Math.max(Number(enemy.pathSpeed) || 1, 0.01);
    return body;
  });
  sim = {
    level,
    player,
    enemies,
    charges: Math.max(0, Number(level.player.charges) || 0),
    collected: new Set(),
    switches: new Set(level.switches.filter(item => item.initialOn).map(item => item.id)),
    switchContacts: new Set(),
    ignoredPivot: null,
    teleportCooldown: 0,
    teleportCooldownId: null,
    time: 0,
    paused: false,
    event: '',
    mode: 'attached',
    diagnostic: '',
    completed: false
  };
  accumulator = 0; flash = 0; flashPoint = null;
  hideResult();
  progress.last = levelIndex; saveProgress();
  updateHud();
}

function setEvent(name, point) {
  if (!sim) return;
  sim.event = name;
  if (point) { flashPoint = copyPoint(point); flash = .35; }
  beep(name);
}

function beep(name) {
  if (!audioContext || audioContext.state !== 'running') return;
  const frequency = name === 'death' ? 130 : name === 'capture' ? 520 : name === 'bonus' ? 720 : 320;
  const oscillator = audioContext.createOscillator(); const gain = audioContext.createGain();
  oscillator.frequency.value = frequency; oscillator.type = 'sine'; gain.gain.value = .035;
  oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.start(); oscillator.stop(audioContext.currentTime + .07);
}

function ensureAudio() {
  try {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
  } catch (_) { audioContext = null; }
}

function neighborNodes(body) {
  const pivot = nodeById(sim.level, body.pivotId); if (!pivot) return [];
  return sim.level.nodes.filter(node => Math.abs(node.x - pivot.x) + Math.abs(node.y - pivot.y) === 1);
}

function directionFromPivot(body) { return body.angle + (body.pivotEnd === 0 ? 0 : Math.PI); }

function findCaptureTarget(body) {
  const direction = directionFromPivot(body);
  const candidates = neighborNodes(body).map(node => {
    const desired = Math.atan2(node.y - body.anchor.y, node.x - body.anchor.x);
    return { node, desired, phase: directedPhase(direction, desired, body.omega) };
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => Math.abs(a.phase) - Math.abs(b.phase) || String(a.node.id).localeCompare(String(b.node.id)));
  return candidates[0];
}

function transitionAttached(body, node) {
  const oldPivot = body.pivotId;
  const desired = Math.atan2(node.y - body.anchor.y, node.x - body.anchor.x);
  body.angle = normAngle(desired - (body.pivotEnd === 0 ? 0 : Math.PI));
  body.pivotId = node.id; body.pivotEnd = 1 - body.pivotEnd;
  body.omega = -body.omega;
  syncAttached(body);
  if (body === sim.player) {
    sim.mode = 'attached';
    setEvent('capture', node);
    if (node.id === sim.level.exitNodeId) winLevel();
  }
  return oldPivot;
}

function requestCapture() {
  if (!sim || sim.mode !== 'attached' || sim.player.mode !== 'attached') return;
  const candidate = findCaptureTarget(sim.player); if (!candidate) return;
  const phase = candidate.phase;
  if (Math.abs(phase) <= CFG.captureWindow + CFG.epsilon) {
    transitionAttached(sim.player, candidate.node);
  } else {
    sim.player.pendingCapture = candidate.node.id;
    setEvent('armed');
  }
}

function reversePlayer() {
  if (!sim || sim.mode !== 'attached' || sim.player.mode !== 'attached' || sim.charges <= 0) return;
  sim.charges -= 1; sim.player.omega = -sim.player.omega; sim.player.pendingCapture = null; setEvent('reverse');
}

function releasePlayer() {
  if (!sim || sim.mode !== 'attached' || sim.player.mode !== 'attached') return;
  const p = sim.player; const pivot = nodeById(sim.level, p.pivotId); if (!pivot) return;
  p.center = add(pivot, mul(unit(p.angle), p.pivotEnd === 0 ? CFG.length / 2 : -CFG.length / 2));
  p.velocity = mul(v(-Math.sin(p.angle), Math.cos(p.angle)), p.omega * (p.pivotEnd === 0 ? CFG.length / 2 : -CFG.length / 2));
  // The velocity above is the exact omega x r expression for the center.
  p.mode = 'free'; p.pendingCapture = null; sim.mode = 'free'; sim.ignoredPivot = p.pivotId; p.pivotId = null;
  setEvent('release');
}

function isDoorOpen(doorId) {
  return sim.switches.size && sim.level.switches.some(item => sim.switches.has(item.id) && item.doorIds.includes(doorId));
}

function closedDoors() {
  return sim.level.doors.filter(door => !isDoorOpen(door.id));
}

function segmentsForLevel() {
  const level = sim.level; const bounds = level.bounds;
  const segments = [];
  for (const wall of level.walls) segments.push({ ...wall, kind: 'wall' });
  for (const door of closedDoors()) segments.push({ ...door, kind: 'door' });
  segments.push({ id: '$bottom', x1: bounds.minX, y1: bounds.minY, x2: bounds.maxX, y2: bounds.minY, kind: 'boundary' });
  segments.push({ id: '$top', x1: bounds.minX, y1: bounds.maxY, x2: bounds.maxX, y2: bounds.maxY, kind: 'boundary' });
  segments.push({ id: '$left', x1: bounds.minX, y1: bounds.minY, x2: bounds.minX, y2: bounds.maxY, kind: 'boundary' });
  segments.push({ id: '$right', x1: bounds.maxX, y1: bounds.minY, x2: bounds.maxX, y2: bounds.maxY, kind: 'boundary' });
  return segments;
}

function bodyTouchesSegment(body, segment, extra = 0) {
  const part = bodySegment(body);
  return distanceSegments(part.a, part.b, v(segment.x1, segment.y1), v(segment.x2, segment.y2)) <= CFG.bodyRadius + extra + 1e-6;
}

function clearBumperContacts(body) {
  for (const bumper of sim.level.bumpers) {
    const key = 'bumper:' + bumper.id;
    const active = bodyTouchesSegment(body, bumper);
    if (!active) body.contacts.delete(key);
  }
}

function lineTouchesCircle(body, circle, radius = circle.radius) {
  const part = bodySegment(body);
  return distancePointSegment(v(circle.x, circle.y), part.a, part.b) <= radius + CFG.bodyRadius + 1e-6;
}

function collectBonuses(body) {
  for (const bonus of sim.level.bonuses) {
    if (sim.collected.has(bonus.id) || !lineTouchesCircle(body, bonus)) continue;
    sim.collected.add(bonus.id); sim.charges += Math.max(1, Number(bonus.chargesAdded) || 1);
    setEvent('bonus', bonus);
  }
}

function touchSwitches(body) {
  for (const item of sim.level.switches) {
    const touching = lineTouchesCircle(body, item);
    if (touching && !sim.switchContacts.has(item.id)) {
      if (sim.switches.has(item.id)) sim.switches.delete(item.id); else sim.switches.add(item.id);
      sim.switchContacts.add(item.id); setEvent('switch', item);
    } else if (!touching) sim.switchContacts.delete(item.id);
  }
}

function teleportIfNeeded(body) {
  if (body !== sim.player || body.mode !== 'free' || sim.teleportCooldown > 0) return;
  for (const source of sim.level.teleporters) {
    if (source.id === sim.teleportCooldownId || !lineTouchesCircle(body, source)) continue;
    const target = sim.level.teleporters.find(item => item.linkId === source.linkId && item.id !== source.id);
    if (!target) continue;
    body.center = add(body.center, v(target.x - source.x, target.y - source.y));
    sim.teleportCooldown = .16; sim.teleportCooldownId = target.id; setEvent('teleport', target); break;
  }
}

function bumperContact(body) {
  for (const bumper of sim.level.bumpers) {
    const key = 'bumper:' + bumper.id;
    if (!bodyTouchesSegment(body, bumper)) continue;
    if (body.contacts.has(key)) continue;
    body.contacts.add(key);
    const normal = v(Number(bumper.normalX) || 0, Number(bumper.normalY) || 0);
    if (body.mode === 'attached') {
      body.omega = -body.omega; setEvent('bounce', v(Number(bumper.x1), Number(bumper.y1)));
    } else {
      const velocityAtBody = body.velocity;
      const incoming = dot(velocityAtBody, normal);
      if (incoming < 0) body.velocity = sub(body.velocity, mul(normal, (1 + CFG.restitution) * incoming));
      body.omega = -body.omega; setEvent('bounce', v(Number(bumper.x1), Number(bumper.y1)));
      body.center = add(body.center, mul(normal, CFG.bodyRadius * 1.5));
    }
  }
}

function enemyCollision(body) {
  const part = bodySegment(body);
  for (const enemy of sim.enemies) {
    if (!enemy.alive || (body.mode === 'attached' && enemy.pivotId && enemy.pivotId === body.pivotId)) continue;
    const other = bodySegment(enemy);
    if (distanceSegments(part.a, part.b, other.a, other.b) <= CFG.bodyRadius * 2 + 1e-6) return true;
  }
  return false;
}

function bodyHitsNodeSide(body, node, endCandidate) {
  const part = bodySegment(body);
  const ends = part.ends;
  const nearEnd = Math.min(lengthOf(sub(ends[0], v(node.x, node.y))), lengthOf(sub(ends[1], v(node.x, node.y))));
  if (endCandidate && nearEnd <= CFG.captureRadius + (1 - CFG.length) + 1e-6) return false;
  const direction = unit(body.angle);
  const a = add(part.a, mul(direction, CFG.endZone));
  const b = sub(part.b, mul(direction, CFG.endZone));
  return distancePointSegment(v(node.x, node.y), a, b) <= CFG.nodeRadius + CFG.bodyRadius + 1e-6;
}

function bodyHazard(body, free = false) {
  const part = bodySegment(body);
  if (segmentsForLevel().some(segment => bodyTouchesSegment(body, segment))) return true;
  if (sim.level.spikes.some(spike => lineTouchesCircle(body, spike))) return true;
  if (enemyCollision(body)) return true;
  if (free) {
    for (const node of sim.level.nodes) {
      if (node.id === sim.ignoredPivot) continue;
      const candidate = part.ends.some(end => lengthOf(sub(end, v(node.x, node.y))) <= CFG.captureRadius + (1 - CFG.length) + 1e-6);
      if (!candidate && bodyHitsNodeSide(body, node, false)) return true;
    }
  }
  return false;
}

function checkAttachedInteractions(body) {
  collectBonuses(body); touchSwitches(body); clearBumperContacts(body); bumperContact(body);
  if (bodyHazard(body, false)) { kill('hazard'); return false; }
  return true;
}

function checkFreeInteractions(body) {
  collectBonuses(body); touchSwitches(body); teleportIfNeeded(body); clearBumperContacts(body); bumperContact(body);
  if (bodyHazard(body, true)) { kill('hazard'); return false; }
  return true;
}

function autoCapture(body) {
  const part = bodySegment(body); const candidates = [];
  for (const node of sim.level.nodes) {
    if (node.id === sim.ignoredPivot) continue;
    for (let end = 0; end < 2; end++) {
      const distance = lengthOf(sub(part.ends[end], v(node.x, node.y)));
      if (distance <= CFG.captureRadius + (1 - CFG.length) + 1e-6) candidates.push({ node, end, distance });
    }
  }
  if (!candidates.length) return false;
  candidates.sort((a, b) => a.distance - b.distance || String(a.node.id).localeCompare(String(b.node.id)) || a.end - b.end);
  const hit = candidates[0];
  const beforeOmega = body.omega;
  body.pivotId = hit.node.id; body.pivotEnd = hit.end; body.mode = 'attached'; sim.mode = 'attached';
  body.center = sub(body.center, sub(part.ends[hit.end], v(hit.node.x, hit.node.y)));
  body.omega = Math.abs(beforeOmega) < 1e-6 ? (beforeOmega < 0 ? -1 : 1) * CFG.baseOmega : -beforeOmega;
  body.velocity = v(0, 0); sim.ignoredPivot = null; syncAttached(body); setEvent('capture', hit.node);
  if (hit.node.id === sim.level.exitNodeId) winLevel();
  return true;
}

function stepAttached(body, dt) {
  let remaining = dt;
  if (body.pendingCapture) {
    const target = nodeById(sim.level, body.pendingCapture);
    if (!target) body.pendingCapture = null;
    else {
      const desired = Math.atan2(target.y - body.anchor.y, target.x - body.anchor.x);
      const current = directionFromPivot(body);
      const phase = directedPhase(current, desired, body.omega);
      const travel = Math.abs(body.omega) * remaining;
      if (Math.abs(phase) <= travel + CFG.epsilon) {
        body.angle += Math.sign(body.omega || 1) * Math.abs(phase); syncAttached(body);
        body.pendingCapture = null; transitionAttached(body, target); remaining = 0;
      } else body.angle += body.omega * remaining;
    }
  } else body.angle += body.omega * remaining;
  syncAttached(body);
  if (body === sim.player && body.mode === 'attached') checkAttachedInteractions(body);
}

function stepFree(body, dt) {
  body.center = add(body.center, add(mul(body.velocity, dt), mul(sim.level.gravity || CFG.gravity, .5 * dt * dt)));
  body.velocity = add(body.velocity, mul(sim.level.gravity || CFG.gravity, dt)); body.angle += body.omega * dt;
  if (body === sim.player && body.mode === 'free') {
    if (sim.ignoredPivot) {
      const ignored = nodeById(sim.level, sim.ignoredPivot);
      if (ignored && distancePointSegment(v(ignored.x, ignored.y), bodySegment(body).a, bodySegment(body).b) > CFG.captureRadius + .18) sim.ignoredPivot = null;
    }
    if (!checkFreeInteractions(body)) return;
    if (autoCapture(body)) return;
    if (body.center.x < sim.level.bounds.minX - .5 || body.center.x > sim.level.bounds.maxX + .5 || body.center.y < sim.level.bounds.minY - .5 || body.center.y > sim.level.bounds.maxY + .5) kill('fall');
  }
}

function routeNext(enemyData, body) {
  const path = enemyData.pathNodeIds || []; if (path.length < 2) return null;
  let next = body.routeIndex + body.routeDirection;
  if (enemyData.pathLoop) {
    if (next >= path.length) next = 0; if (next < 0) next = path.length - 1;
  } else if (next >= path.length || next < 0) {
    body.routeDirection *= -1; next = body.routeIndex + body.routeDirection;
  }
  return nodeById(sim.level, path[clamp(next, 0, path.length - 1)]);
}

function transitionEnemy(body, enemyData, target) {
  const desired = Math.atan2(target.y - body.anchor.y, target.x - body.anchor.x);
  body.angle = normAngle(desired - (body.pivotEnd === 0 ? 0 : Math.PI));
  body.pivotId = target.id; body.pivotEnd = 1 - body.pivotEnd;
  body.omega = -body.omega; body.routeIndex += body.routeDirection;
  if (enemyData.pathLoop) {
    if (body.routeIndex >= enemyData.pathNodeIds.length) body.routeIndex = 0;
    if (body.routeIndex < 0) body.routeIndex = enemyData.pathNodeIds.length - 1;
  } else if (body.routeIndex < 0 || body.routeIndex >= enemyData.pathNodeIds.length) {
    body.routeIndex = clamp(body.routeIndex, 0, enemyData.pathNodeIds.length - 1);
  }
  body.routePending = false; body.routeTimer = 1 / Math.max(Number(enemyData.pathSpeed) || 1, .01); syncAttached(body);
}

function updateEnemy(body, enemyData, dt) {
  if (!body.alive) return;
  if (!enemyData.pathNodeIds || enemyData.pathNodeIds.length < 2) {
    body.angle += body.omega * dt; syncAttached(body);
  } else {
    if (!body.routePending) {
      body.angle += body.omega * dt; body.routeTimer -= dt;
      if (body.routeTimer <= 0) body.routePending = true;
    }
    if (body.routePending) {
      const target = routeNext(enemyData, body);
      if (target) {
        const desired = Math.atan2(target.y - body.anchor.y, target.x - body.anchor.x);
        const phase = directedPhase(directionFromPivot(body), desired, body.omega);
        if (Math.abs(body.omega) < 1e-6 || Math.abs(phase) <= Math.abs(body.omega) * dt + CFG.epsilon) {
          transitionEnemy(body, enemyData, target);
        } else body.angle += body.omega * dt;
      }
    }
    syncAttached(body);
  }
  clearBumperContacts(body); bumperContact(body);
  // Enemies bounce from ordinary walls and the boundary, instead of dying.
  if (segmentsForLevel().some(segment => bodyTouchesSegment(body, segment))) body.omega = -body.omega;
}

function updateEnemies(dt) {
  for (let index = 0; index < sim.enemies.length; index++) updateEnemy(sim.enemies[index], sim.level.enemies[index], dt);
}

function kill(reason = 'hazard') {
  if (!sim || sim.mode === 'dead' || sim.mode === 'won') return;
  sim.mode = 'dead'; sim.player.mode = 'dead'; sim.event = 'death'; setEvent('death');
  showResult(false, reason);
}

function winLevel() {
  if (!sim || sim.mode === 'won') return;
  sim.mode = 'won'; sim.player.mode = 'won'; sim.completed = true;
  if (!progress.completed.includes(sim.level.id)) progress.completed.push(sim.level.id);
  saveProgress(); setEvent('win'); showResult(true);
}

function simulate(dt) {
  if (!sim || sim.paused || sim.mode === 'dead' || sim.mode === 'won') return;
  sim.time += dt; sim.teleportCooldown = Math.max(0, sim.teleportCooldown - dt);
  updateEnemies(dt);
  if (sim.player.mode === 'attached') stepAttached(sim.player, dt);
  else if (sim.player.mode === 'free') stepFree(sim.player, dt);
  if (sim.mode === 'attached' && sim.player.pivotId === sim.level.exitNodeId) winLevel();
}

function action(name) {
  ensureAudio();
  if (!sim || sim.mode === 'dead' || sim.mode === 'won') return;
  if (name === 'reverse') reversePlayer();
  if (name === 'release') releasePlayer();
  if (name === 'capture') requestCapture();
}

function togglePause() {
  if (!sim || sim.mode === 'dead' || sim.mode === 'won') return;
  sim.paused = !sim.paused; accumulator = 0; updateHud();
}

function nextLevel(offset) {
  if (!campaign.length) return;
  levelIndex = (levelIndex + offset + campaign.length) % campaign.length; progress.last = levelIndex; saveProgress(); resetLevel(); buildLevelList();
}

function showResult(won, reason) {
  const result = $('result'); if (!result) return;
  result.hidden = false; $('result-glyph').textContent = won ? '✦' : reason === 'hazard' ? 'ϟ' : '↯';
  $('result-title').textContent = won ? 'Level complete' : 'Mechanism damaged';
  $('result-copy').textContent = won ? 'The exit hinge is secured. Continue when you are ready.' : 'The arrow touched a wall, spike, hinge, or enemy. Restart and try a different phase.';
  $('result-button').textContent = won ? (levelIndex === campaign.length - 1 ? 'Restart campaign' : 'Next level') : 'Try again';
}

function hideResult() { const result = $('result'); if (result) result.hidden = true; }

function resultAction() {
  if (!sim) return;
  if (sim.mode === 'won') {
    if (levelIndex === campaign.length - 1) { levelIndex = 0; progress.last = 0; saveProgress(); resetLevel(); }
    else nextLevel(1);
  } else resetLevel();
}

function boardFrame() {
  if (!sim) return { x: 0, y: 0, width, height, scale: 1 };
  const bounds = sim.level.bounds; const margin = Math.min(width, height) * .055;
  const scale = Math.min((width - margin * 2) / (bounds.maxX - bounds.minX), (height - margin * 2) / (bounds.maxY - bounds.minY));
  const boardWidth = (bounds.maxX - bounds.minX) * scale; const boardHeight = (bounds.maxY - bounds.minY) * scale;
  return { x: (width - boardWidth) / 2, y: (height - boardHeight) / 2, width: boardWidth, height: boardHeight, scale, bounds };
}

function worldToScreen(point) {
  const frame = boardFrame(); const bounds = frame.bounds;
  return v(frame.x + (point.x - bounds.minX) * frame.scale, frame.y + frame.height - (point.y - bounds.minY) * frame.scale);
}

function drawGear(x, y, radius, color, teeth = 10) {
  push(); translate(x, y); noStroke(); fill(color);
  beginShape();
  for (let i = 0; i < teeth * 2; i++) {
    const angle = i * Math.PI / teeth; const r = i % 2 ? radius * .82 : radius;
    vertex(Math.cos(angle) * r, Math.sin(angle) * r);
  }
  endShape(CLOSE); fill('#071d24aa'); circle(0, 0, radius * .35); pop();
}

function drawBoardBackground(frame) {
  noStroke(); fill('#061a21'); rect(0, 0, width, height);
  drawGear(width * .05, height * .09, Math.min(width, height) * .13, '#c58b3630', 12);
  drawGear(width * .94, height * .17, Math.min(width, height) * .17, '#c58b3628', 11);
  drawGear(width * .92, height * .9, Math.min(width, height) * .14, '#c58b3624', 10);
  drawGear(width * .08, height * .88, Math.min(width, height) * .11, '#c58b3625', 9);
  fill('#0a3540'); rect(frame.x, frame.y, frame.width, frame.height, 8);
  stroke('#e3ad4d'); strokeWeight(3); noFill(); rect(frame.x, frame.y, frame.width, frame.height, 8);
  stroke('#603e20'); strokeWeight(1); rect(frame.x + 8, frame.y + 8, frame.width - 16, frame.height - 16, 5);
  // A faint regular grid makes the authored hinge positions legible without
  // changing their collision semantics.
  stroke('#73aab02c'); strokeWeight(1);
  for (let x = Math.ceil(frame.bounds.minX); x <= Math.floor(frame.bounds.maxX); x++) {
    const a = worldToScreen(v(x, frame.bounds.minY)); const b = worldToScreen(v(x, frame.bounds.maxY)); line(a.x, a.y, b.x, b.y);
  }
  for (let y = Math.ceil(frame.bounds.minY); y <= Math.floor(frame.bounds.maxY); y++) {
    const a = worldToScreen(v(frame.bounds.minX, y)); const b = worldToScreen(v(frame.bounds.maxX, y)); line(a.x, a.y, b.x, b.y);
  }
}

function drawSegment(segment, color, weight = 5, glow = false) {
  const a = worldToScreen(v(segment.x1, segment.y1)); const b = worldToScreen(v(segment.x2, segment.y2));
  if (glow) { stroke(color + '40'); strokeWeight(weight * 3); line(a.x, a.y, b.x, b.y); }
  stroke(color); strokeWeight(weight); line(a.x, a.y, b.x, b.y);
}

function drawLevelObjects(frame) {
  const level = sim.level;
  for (const wall of level.walls) drawSegment(wall, '#d9584c', Math.max(3, frame.scale * .045), true);
  for (const door of level.doors) drawSegment(door, isDoorOpen(door.id) ? '#4f8e88' : '#d56c4e', Math.max(3, frame.scale * .055), true);
  for (const bumper of level.bumpers) {
    drawSegment(bumper, '#ffd54c', Math.max(4, frame.scale * .06), true);
    const a = worldToScreen(v(bumper.x1, bumper.y1)); const b = worldToScreen(v(bumper.x2, bumper.y2));
    stroke('#fff1a0'); strokeWeight(2); const dx = b.x - a.x, dy = b.y - a.y; const distance = Math.hypot(dx, dy);
    for (let t = 0; t <= distance; t += 13) { const qx = a.x + dx * t / Math.max(distance, 1), qy = a.y + dy * t / Math.max(distance, 1); point(qx, qy); }
  }
  for (const spike of level.spikes) {
    const p = worldToScreen(v(spike.x, spike.y)); const radius = Math.max(6, frame.scale * (spike.radius + .07));
    noStroke(); fill('#ff514a55'); circle(p.x, p.y, radius * 2.3); fill('#ff5d4d'); triangle(p.x, p.y - radius, p.x - radius * .72, p.y + radius * .75, p.x + radius * .72, p.y + radius * .75);
  }
  for (const bonus of level.bonuses) {
    if (sim.collected.has(bonus.id)) continue;
    const p = worldToScreen(v(bonus.x, bonus.y)); const r = Math.max(7, frame.scale * bonus.radius * 1.25);
    noStroke(); fill('#ffc83e25'); circle(p.x, p.y, r * 3); fill('#f6bd3f'); circle(p.x, p.y, r * 1.5); fill('#fff2a4'); circle(p.x - r * .25, p.y - r * .3, r * .4); fill('#78451d'); textAlign(CENTER, CENTER); textSize(r * .85); text('+1', p.x, p.y + r * .05);
  }
  for (const item of level.switches) {
    const p = worldToScreen(v(item.x, item.y)); const r = Math.max(7, frame.scale * item.radius); noStroke(); fill(sim.switches.has(item.id) ? '#75e4ba' : '#bd5662'); circle(p.x, p.y, r * 2.5); fill('#12252a'); circle(p.x, p.y, r * 1.25); fill(sim.switches.has(item.id) ? '#8affce' : '#fa7a77'); circle(p.x, p.y, r * .75);
  }
  for (const item of level.teleporters) {
    const p = worldToScreen(v(item.x, item.y)); const r = Math.max(8, frame.scale * item.radius * 1.2); noFill(); stroke('#72d9ed'); strokeWeight(3); circle(p.x, p.y, r * 2); stroke('#d5fbff66'); circle(p.x, p.y, r * 2.8); noStroke(); fill('#8be9f3'); circle(p.x, p.y, r * .45);
  }
  for (const node of level.nodes) {
    const p = worldToScreen(v(node.x, node.y)); const isExit = node.id === level.exitNodeId; const r = Math.max(5, frame.scale * CFG.nodeRadius * (isExit ? 1.45 : 1.15));
    noStroke(); fill(isExit ? '#5be98740' : '#0008'); circle(p.x + 2, p.y + 3, r * 2.8); fill(isExit ? '#39dc75' : '#d29d43'); circle(p.x, p.y, r * 2); fill(isExit ? '#d4ff9f' : '#ffe6a0'); circle(p.x - r * .2, p.y - r * .23, r * .65);
  }
}

function drawArrow(body, color, pivotColor) {
  const frame = boardFrame(); const part = bodySegment(body); const a = worldToScreen(part.a), b = worldToScreen(part.b); const weight = Math.max(5, frame.scale * .07);
  stroke(color + '45'); strokeWeight(weight * 2.4); line(a.x, a.y, b.x, b.y); stroke(color); strokeWeight(weight); line(a.x, a.y, b.x, b.y);
  const pivot = body.pivotEnd === 0 ? a : b; const free = body.pivotEnd === 0 ? b : a;
  noStroke(); fill('#061a21aa'); circle(pivot.x + 2, pivot.y + 3, weight * 1.65); fill(pivotColor); circle(pivot.x, pivot.y, weight * 1.55); fill('#f6e7ad'); circle(pivot.x - weight * .17, pivot.y - weight * .2, weight * .45);
  fill(color); circle(free.x, free.y, weight * 1.35); fill('#f7efc2'); circle(free.x - weight * .12, free.y - weight * .15, weight * .35);
  // A small triangular tip shows the axis without the old directional dots.
  const direction = v(free.x - pivot.x, free.y - pivot.y); const d = Math.max(1, Math.hypot(direction.x, direction.y)); const nx = direction.x / d, ny = direction.y / d; const px = -ny, py = nx; noStroke(); fill(color); triangle(free.x + nx * weight * .56, free.y + ny * weight * .56, free.x - nx * weight * .45 + px * weight * .36, free.y - ny * weight * .45 + py * weight * .36, free.x - nx * weight * .45 - px * weight * .36, free.y - ny * weight * .45 - py * weight * .36);
}

function drawFlash(frame) {
  if (flash <= 0 || !flashPoint) return;
  const p = worldToScreen(flashPoint); const alpha = clamp(flash / .35, 0, 1);
  noFill(); stroke('#fff0a2' + Math.floor(alpha * 255).toString(16).padStart(2, '0')); strokeWeight(4); circle(p.x, p.y, frame.scale * (.25 + (.35 - flash) * 1.4));
}

function drawPause() {
  if (!sim || !sim.paused) return;
  noStroke(); fill('#03121999'); rect(0, 0, width, height); textAlign(CENTER, CENTER); fill('#ffdda0'); textSize(Math.max(20, width * .035)); text('PAUSED', width / 2, height / 2);
}

function draw() {
  try {
    const dt = Math.min((deltaTime || 16.7) / 1000, .05);
    if (!sim) { background('#061a21'); return; }
    if (sim && !sim.paused && sim.mode !== 'dead' && sim.mode !== 'won' && !document.hidden) {
      accumulator += dt;
      while (accumulator >= CFG.step && sim.mode !== 'dead' && sim.mode !== 'won') { simulate(CFG.step); accumulator -= CFG.step; }
    }
    if (flash > 0) flash = Math.max(0, flash - dt);
    const frame = boardFrame(); drawBoardBackground(frame);
    if (sim) { drawLevelObjects(frame); for (const enemy of sim.enemies) if (enemy.alive) drawArrow(enemy, '#ef6554', '#e7b24d'); if (sim.player && sim.player.mode !== 'dead') drawArrow(sim.player, '#29d7dc', '#f5df8a'); drawFlash(frame); }
    drawPause(); updateHud();
  } catch (error) {
    if ($('hint')) $('hint').textContent = 'Runtime error: ' + (error && error.message ? error.message : String(error));
    console.error('ClockShift draw error', error); noLoop();
  }
}

function updateHud() {
  if (!sim || !campaign.length) return;
  const level = sim.level; const complete = progress.completed.includes(level.id); const custom = level.source === 'custom';
  $('level-number').textContent = custom ? 'COMMUNITY' : 'TRAINING ' + String(levelIndex + 1).padStart(2, '0');
  $('level-title').textContent = level.title;
  $('timer').textContent = formatTime(sim.time);
  $('charges').textContent = String(sim.charges);
  $('mode-label').textContent = (custom ? 'COMMUNITY' : 'TRAINING') + ' · ' + (levelIndex + 1) + ' / ' + campaign.length + (complete ? ' · CLEARED' : '');
  $('hint').textContent = sim.paused ? 'Simulation paused. Press pause again to continue.' : hintForLevel(level);
  // Keep the rendered model and the DOM state in sync; this also makes a
  // missing level asset immediately visible during static-host smoke tests.
  $('pause').textContent = sim.paused ? '▶' : 'Ⅱ'; $('pause').setAttribute('aria-label', sim.paused ? 'Resume' : 'Pause');
  const attached = sim.mode === 'attached' && sim.player && sim.player.mode === 'attached';
  $('reverse').disabled = !attached || sim.charges <= 0; $('release').disabled = !attached; $('capture').disabled = !attached;
  $('reverse').classList.toggle('ready', attached && sim.charges > 0);
}

function hintForLevel(level) {
  if (sim && sim.event === 'release') return 'Free flight: either end can capture the next hinge automatically.';
  if (level.doors.length) return 'Touch a switch to toggle the door, then capture the exit hinge.';
  if (level.teleporters.length) return 'Free flight can cross a teleporter pair without losing angular momentum.';
  if (level.bumpers.length) return 'A yellow bumper reverses the arrow without spending a charge.';
  if (level.enemies.length) return 'Enemy arrows are dangerous. Watch their hinge and route phases.';
  return 'Press D when the free end points at a neighbouring hinge. A small window is accepted.';
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60); const remainder = seconds - minutes * 60;
  return String(minutes).padStart(2, '0') + ':' + remainder.toFixed(1).padStart(4, '0');
}

function buildLevelList() {
  const list = $('level-list'); if (!list) return; list.textContent = '';
  campaign.forEach((level, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'level-row' + (index === levelIndex ? ' current' : '');
    const number = document.createElement('b'); number.textContent = String(index + 1).padStart(2, '0');
    const copy = document.createElement('span'); const title = document.createElement('strong'); title.textContent = level.title; const note = document.createElement('small'); note.textContent = level.source === 'custom' ? 'Community level' : progress.completed.includes(level.id) ? 'Cleared' : level.enemies.length ? 'Hazards active' : 'Training'; copy.append(title, note);
    const marker = document.createElement('span'); marker.textContent = progress.completed.includes(level.id) ? '✓' : '›'; marker.setAttribute('aria-hidden', 'true'); button.append(number, copy, marker);
    button.addEventListener('click', () => { levelIndex = index; progress.last = index; saveProgress(); resetLevel(); buildLevelList(); $('levels-dialog').close(); }); list.append(button);
  });
}

function bindUi() {
  $('reverse').addEventListener('click', () => action('reverse'));
  $('release').addEventListener('click', () => action('release'));
  $('capture').addEventListener('click', () => action('capture'));
  $('pause').addEventListener('click', togglePause);
  $('restart').addEventListener('click', () => { ensureAudio(); resetLevel(); });
  $('previous').addEventListener('click', () => nextLevel(-1)); $('next').addEventListener('click', () => nextLevel(1));
  $('result-button').addEventListener('click', resultAction);
  $('levels-open').addEventListener('click', () => { buildLevelList(); $('levels-dialog').showModal(); });
  $('levels-close').addEventListener('click', () => $('levels-dialog').close());
  $('levels-dialog').addEventListener('click', event => { if (event.target === $('levels-dialog')) $('levels-dialog').close(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'a' || event.key === 'A') { event.preventDefault(); action('reverse'); }
    else if (event.key === 's' || event.key === 'S') { event.preventDefault(); action('release'); }
    else if (event.key === 'd' || event.key === 'D') { event.preventDefault(); action('capture'); }
    else if (event.key === 'r' || event.key === 'R') { event.preventDefault(); resetLevel(); }
    else if (event.key === 'Escape') { event.preventDefault(); togglePause(); }
  });
  document.addEventListener('visibilitychange', () => { accumulator = 0; lastFrame = performance.now(); });
}

function setup() {
  const stage = $('stage'); const initialWidth = Math.max(300, stage.clientWidth || 900); const initialHeight = Math.max(220, stage.clientHeight || 540);
  pixelDensity(Math.min(window.devicePixelRatio || 1, 2)); canvas = createCanvas(initialWidth, initialHeight); canvas.parent(stage);
  const resize = () => { const rect = stage.getBoundingClientRect(); if (rect.width > 0 && rect.height > 0) resizeCanvas(Math.max(240, rect.width), Math.max(200, rect.height)); };
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage); window.addEventListener('resize', resize); resize();
  window.addEventListener('error', event => {
    const message = event && event.error && event.error.message ? event.error.message : (event.message || 'Unknown runtime error');
    if ($('hint')) $('hint').textContent = 'Runtime error: ' + message;
    console.error('ClockShift runtime error', event.error || event);
  });
  bindUi(); loadCampaign(); lastFrame = performance.now();
}

// p5 calls setup/draw globally. Keeping the handlers at the end makes the
// simulation usable in a plain static page without a bundler.
