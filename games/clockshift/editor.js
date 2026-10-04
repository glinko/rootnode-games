'use strict';

/*
 * ClockShift's public authoring surface.  The editor deliberately writes the
 * same schema consumed by game.js.  It is dependency free so it also works
 * when the catalogue is opened from a simple static file server.
 */
const BOUNDS = Object.freeze({ minX: -4, minY: -3, maxX: 5, maxY: 4 });
const GRID_WIDTH = BOUNDS.maxX - BOUNDS.minX;
const GRID_HEIGHT = BOUNDS.maxY - BOUNDS.minY;
const API = '/api/clockshift/levels';
const $ = id => document.getElementById(id);
const clone = value => JSON.parse(JSON.stringify(value));
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

let draft = starterLevel();
let tool = 'select';
let pointerStart = null;
let pointerCurrent = null;
let savedRows = [];
let editingId = '';
let frame = { x: 0, y: 0, width: 1, height: 1, scale: 1 };
let dpr = 1;

function starterLevel() {
  return {
    schemaVersion: 1,
    id: 'custom-new',
    title: 'Новый уровень',
    bounds: clone(BOUNDS),
    nodes: [
      { id: 'n1', x: -3, y: -1 }, { id: 'n2', x: -2, y: -1 },
      { id: 'n3', x: -2, y: 0 }, { id: 'n4', x: -1, y: 0 },
      { id: 'n5', x: -1, y: 1 }, { id: 'n6', x: 0, y: 1 }
    ],
    player: { pivotId: 'n1', initialAngleDeg: -45, omegaDegSigned: 90, charges: 1 },
    exitNodeId: 'n6', gravity: { x: 0, y: 0 },
    walls: [], bumpers: [], spikes: [], bonuses: [], enemies: [],
    doors: [], switches: [], teleporters: []
  };
}

function ensureDraft() {
  draft.bounds = clone(BOUNDS);
  draft.schemaVersion = 1;
  draft.nodes = Array.isArray(draft.nodes) ? draft.nodes : [];
  ['walls', 'bumpers', 'spikes', 'bonuses', 'enemies', 'doors', 'switches', 'teleporters'].forEach(key => {
    if (!Array.isArray(draft[key])) draft[key] = [];
  });
  draft.player = draft.player || { pivotId: draft.nodes[0] ? draft.nodes[0].id : '', initialAngleDeg: -45, omegaDegSigned: 90, charges: 1 };
  draft.gravity = { x: 0, y: 0 };
}

function setStatus(message, error = false) {
  const node = $('save-status'); node.textContent = message; node.classList.toggle('error', error);
}

function setHint(message) { $('editor-hint').textContent = message; }

function setTool(next) {
  tool = next;
  document.querySelectorAll('.tool-button').forEach(button => button.classList.toggle('active', button.dataset.tool === tool));
  const hints = {
    select: 'Выбор: щёлкните по объекту, чтобы увидеть его место.',
    hinge: 'Шарнир: нажмите на пересечении сетки. Повторный шарнир в той же клетке не создаётся.',
    player: 'Игрок: нажмите на шарнир, с которого должна начинаться стрелка.',
    exit: 'Выход: нажмите на шарнир, который станет конечным.',
    enemy: 'Враг: нажмите на шарнир. Враг будет вращаться на нём по часовой стрелке.',
    wall: 'Стена: протяните от одного пересечения сетки до другого.',
    bumper: 'Бампер: протяните от одного пересечения сетки до другого; стрелка будет отбиваться.',
    door: 'Дверь: протяните от одного пересечения сетки до другого. Первый переключатель свяжется с ней.',
    spike: 'Шип: нажмите в любом месте поля.',
    bonus: 'Бонус: нажмите в любом месте поля.',
    switch: 'Переключатель: нажмите в любом месте поля.',
    teleporter: 'Телепорт: поставьте две точки; они автоматически образуют пару.',
    erase: 'Удалить: нажмите рядом с объектом, чтобы убрать его.'
  };
  setHint(hints[tool] || hints.select);
}

function nextId(prefix, list) {
  const used = new Set(list.map(item => String(item.id || '')));
  let index = 1; let id = prefix + index;
  while (used.has(id)) id = prefix + (++index);
  return id;
}

function nodeAt(point, tolerance = .25) {
  let hit = null; let best = tolerance;
  for (const node of draft.nodes) {
    const distance = Math.hypot(point.x - node.x, point.y - node.y);
    if (distance <= best) { best = distance; hit = node; }
  }
  return hit;
}

function snapPoint(point) {
  return { x: clamp(Math.round(point.x), BOUNDS.minX, BOUNDS.maxX), y: clamp(Math.round(point.y), BOUNDS.minY, BOUNDS.maxY) };
}

function freePoint(point, margin = .12) {
  return { x: clamp(Number(point.x.toFixed(3)), BOUNDS.minX + margin, BOUNDS.maxX - margin), y: clamp(Number(point.y.toFixed(3)), BOUNDS.minY + margin, BOUNDS.maxY - margin) };
}

function addNode(point) {
  const snapped = snapPoint(point);
  if (nodeAt(snapped, .05)) return nodeAt(snapped, .05);
  const node = { id: nextId('n', draft.nodes), x: snapped.x, y: snapped.y };
  draft.nodes.push(node);
  if (!draft.player.pivotId) draft.player.pivotId = node.id;
  if (!draft.exitNodeId) draft.exitNodeId = node.id;
  return node;
}

function requireNode(point) { return nodeAt(snapPoint(point), .34) || addNode(point); }

function addSegment(kind, start, end) {
  const a = snapPoint(start); const b = snapPoint(end);
  if (a.x === b.x && a.y === b.y) return;
  const list = draft[kind + 's'];
  const segment = { id: nextId(kind, list), x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  if (kind === 'bumper') {
    const dx = b.x - a.x; const dy = b.y - a.y; const length = Math.hypot(dx, dy) || 1;
    segment.normalX = Number((-dy / length).toFixed(4)); segment.normalY = Number((dx / length).toFixed(4));
  }
  list.push(segment);
}

function addFree(kind, point) {
  const p = freePoint(point);
  if (kind === 'spike') draft.spikes.push({ id: nextId('spike_', draft.spikes), x: p.x, y: p.y, radius: .13 });
  if (kind === 'bonus') draft.bonuses.push({ id: nextId('bonus_', draft.bonuses), x: p.x, y: p.y, radius: .13, chargesAdded: 1 });
  if (kind === 'switch') draft.switches.push({ id: nextId('switch_', draft.switches), x: p.x, y: p.y, radius: .20, doorIds: draft.doors[0] ? [draft.doors[0].id] : [], initialOn: false });
  if (kind === 'teleporter') {
    const pairNumber = Math.floor(draft.teleporters.length / 2) + 1;
    draft.teleporters.push({ id: nextId('teleport_', draft.teleporters), x: p.x, y: p.y, radius: .20, linkId: 'pair_' + pairNumber });
  }
}

function addEnemy(point) {
  const node = requireNode(point); if (!node) return;
  draft.enemies.push({ id: nextId('enemy_', draft.enemies), pivotId: node.id, initialAngleDeg: -45, omegaDegSigned: 90 });
}

function eraseAt(point) {
  const node = nodeAt(point, .35);
  if (node) {
    draft.nodes = draft.nodes.filter(item => item.id !== node.id);
    draft.enemies = draft.enemies.filter(item => item.pivotId !== node.id);
    if (draft.player.pivotId === node.id) draft.player.pivotId = draft.nodes[0] ? draft.nodes[0].id : '';
    if (draft.exitNodeId === node.id) draft.exitNodeId = draft.nodes.length ? draft.nodes[draft.nodes.length - 1].id : '';
    draft.enemies.forEach(enemy => { enemy.pathNodeIds = (enemy.pathNodeIds || []).filter(id => id !== node.id); });
    return;
  }
  const nearSegment = (segment) => distanceToSegment(point, { x: segment.x1, y: segment.y1 }, { x: segment.x2, y: segment.y2 }) < .27;
  for (const key of ['walls', 'bumpers', 'doors']) {
    const index = draft[key].findIndex(nearSegment); if (index >= 0) { draft[key].splice(index, 1); return; }
  }
  for (const key of ['spikes', 'bonuses', 'switches', 'teleporters']) {
    const index = draft[key].findIndex(item => Math.hypot(point.x - item.x, point.y - item.y) < .32); if (index >= 0) { draft[key].splice(index, 1); return; }
  }
  const enemyIndex = draft.enemies.findIndex(enemy => { const pivot = draft.nodes.find(item => item.id === enemy.pivotId); return pivot && Math.hypot(point.x - pivot.x, point.y - pivot.y) < .42; });
  if (enemyIndex >= 0) draft.enemies.splice(enemyIndex, 1);
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y; const length = dx * dx + dy * dy;
  const t = length ? clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / length, 0, 1) : 0;
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function applyPointAction(point) {
  if (tool === 'select') return;
  if (tool === 'erase') { eraseAt(point); draw(); return; }
  if (tool === 'hinge') addNode(point);
  if (tool === 'player') { const node = requireNode(point); if (node) draft.player.pivotId = node.id; }
  if (tool === 'exit') { const node = requireNode(point); if (node) draft.exitNodeId = node.id; }
  if (tool === 'enemy') addEnemy(point);
  if (['spike', 'bonus', 'switch', 'teleporter'].includes(tool)) addFree(tool, point);
  draw();
}

function canvasPoint(event) {
  const rect = $('editor-board').getBoundingClientRect();
  const px = event.clientX - rect.left; const py = event.clientY - rect.top;
  return { x: BOUNDS.minX + (px - frame.x) / frame.scale, y: BOUNDS.maxY - (py - frame.y) / frame.scale };
}

function resizeCanvas() {
  const canvas = $('editor-board'); const rect = canvas.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 2); canvas.width = Math.max(240, Math.floor(rect.width * dpr)); canvas.height = Math.max(200, Math.floor(rect.height * dpr));
  const margin = Math.min(rect.width, rect.height) * .065;
  frame.scale = Math.min((rect.width - margin * 2) / GRID_WIDTH, (rect.height - margin * 2) / GRID_HEIGHT);
  frame.width = GRID_WIDTH * frame.scale; frame.height = GRID_HEIGHT * frame.scale; frame.x = (rect.width - frame.width) / 2; frame.y = (rect.height - frame.height) / 2;
  draw();
}

function screenPoint(point) { return { x: frame.x + (point.x - BOUNDS.minX) * frame.scale, y: frame.y + frame.height - (point.y - BOUNDS.minY) * frame.scale }; }

function drawGear(ctx, x, y, radius, color, teeth) {
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = color; ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) { const angle = i * Math.PI / teeth; const r = i % 2 ? radius * .82 : radius; ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r); }
  ctx.closePath(); ctx.fill(); ctx.fillStyle = '#071d24aa'; ctx.beginPath(); ctx.arc(0, 0, radius * .34, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

function drawSegment(ctx, item, color, width) {
  const a = screenPoint({ x: item.x1, y: item.y1 }); const b = screenPoint({ x: item.x2, y: item.y2 });
  ctx.strokeStyle = color + '55'; ctx.lineWidth = width * 2.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}

function drawCircle(ctx, item, color, radius, label = '') {
  const p = screenPoint(item); const r = Math.max(6, frame.scale * radius);
  ctx.fillStyle = color + '33'; ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
  if (label) { ctx.fillStyle = '#f7e8af'; ctx.font = '700 11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, p.x, p.y); }
}

function drawArrow(ctx, body, color, pivotId) {
  const pivot = draft.nodes.find(node => node.id === pivotId); if (!pivot) return;
  const angle = Number(body.initialAngleDeg || 0) * Math.PI / 180; const end = { x: pivot.x + Math.cos(angle) * .9, y: pivot.y + Math.sin(angle) * .9 };
  const a = screenPoint(pivot); const b = screenPoint(end); const width = Math.max(5, frame.scale * .07);
  ctx.strokeStyle = color + '55'; ctx.lineWidth = width * 2.2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.fillStyle = '#f7e8af'; ctx.beginPath(); ctx.arc(a.x, a.y, width * .72, 0, Math.PI * 2); ctx.fill();
}

function draw() {
  const canvas = $('editor-board'); if (!canvas) return; const rect = canvas.getBoundingClientRect(); const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height);
  const gradient = ctx.createLinearGradient(0, 0, rect.width, rect.height); gradient.addColorStop(0, '#082d38'); gradient.addColorStop(1, '#061b23'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, rect.width, rect.height);
  drawGear(ctx, rect.width * .06, rect.height * .1, Math.min(rect.width, rect.height) * .13, '#c58b3630', 12); drawGear(ctx, rect.width * .94, rect.height * .88, Math.min(rect.width, rect.height) * .15, '#c58b3628', 11);
  ctx.fillStyle = '#0a3540'; ctx.fillRect(frame.x, frame.y, frame.width, frame.height); ctx.strokeStyle = '#e3ad4d'; ctx.lineWidth = 3; ctx.strokeRect(frame.x, frame.y, frame.width, frame.height);
  ctx.strokeStyle = '#73aab02c'; ctx.lineWidth = 1;
  for (let x = BOUNDS.minX; x <= BOUNDS.maxX; x++) { const a = screenPoint({ x, y: BOUNDS.minY }); const b = screenPoint({ x, y: BOUNDS.maxY }); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  for (let y = BOUNDS.minY; y <= BOUNDS.maxY; y++) { const a = screenPoint({ x: BOUNDS.minX, y }); const b = screenPoint({ x: BOUNDS.maxX, y }); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  draft.walls.forEach(item => drawSegment(ctx, item, '#e46c5c', Math.max(4, frame.scale * .055)));
  draft.doors.forEach(item => drawSegment(ctx, item, '#cf744c', Math.max(5, frame.scale * .065)));
  draft.bumpers.forEach(item => drawSegment(ctx, item, '#ffd34d', Math.max(5, frame.scale * .07)));
  draft.spikes.forEach(item => { const p = screenPoint(item); const r = Math.max(7, frame.scale * .18); ctx.fillStyle = '#ff5d4d'; ctx.beginPath(); ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x - r * .75, p.y + r * .7); ctx.lineTo(p.x + r * .75, p.y + r * .7); ctx.closePath(); ctx.fill(); });
  draft.bonuses.forEach(item => drawCircle(ctx, item, '#f6bd3f', .15, '+'));
  draft.switches.forEach(item => drawCircle(ctx, item, '#7de5ba', .20, 'S'));
  draft.teleporters.forEach(item => { const p = screenPoint(item); const r = Math.max(8, frame.scale * .2); ctx.strokeStyle = '#72d9ed'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#8be9f3'; ctx.beginPath(); ctx.arc(p.x, p.y, r * .28, 0, Math.PI * 2); ctx.fill(); });
  draft.enemies.forEach(enemy => drawArrow(ctx, enemy, '#ef6554', enemy.pivotId)); drawArrow(ctx, draft.player, '#29d7dc', draft.player.pivotId);
  draft.nodes.forEach(node => { const exit = node.id === draft.exitNodeId; drawCircle(ctx, node, exit ? '#51e783' : '#d29d43', exit ? .075 : .06, exit ? 'E' : ''); });
  if (pointerStart && pointerCurrent && ['wall', 'bumper', 'door'].includes(tool)) {
    const a = screenPoint(snapPoint(pointerStart)); const b = screenPoint(snapPoint(pointerCurrent)); ctx.setLineDash([8, 6]); ctx.strokeStyle = '#f6e4a1'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
  }
}

function pointerDown(event) {
  event.preventDefault(); const point = canvasPoint(event); pointerStart = point; pointerCurrent = point; $('editor-board').setPointerCapture?.(event.pointerId);
  if (['wall', 'bumper', 'door'].includes(tool)) { draw(); return; }
  applyPointAction(point);
}

function pointerMove(event) { if (!pointerStart) return; pointerCurrent = canvasPoint(event); if (['wall', 'bumper', 'door'].includes(tool)) draw(); }

function pointerUp(event) {
  if (!pointerStart) return; pointerCurrent = canvasPoint(event);
  if (['wall', 'bumper', 'door'].includes(tool)) addSegment(tool, pointerStart, pointerCurrent);
  pointerStart = null; pointerCurrent = null; draw();
}

function slug(value) {
  const result = String(value || 'level').toLowerCase().trim().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return result || 'level';
}

function buildRow() {
  ensureDraft();
  const title = String($('level-title').value || '').trim(); if (!title) throw new Error('Введите название уровня.');
  if (draft.nodes.length < 2) throw new Error('Добавьте хотя бы два шарнира.');
  if (!draft.player.pivotId || !draft.nodes.some(node => node.id === draft.player.pivotId)) throw new Error('Назначьте шарнир игроком.');
  if (!draft.exitNodeId || !draft.nodes.some(node => node.id === draft.exitNodeId)) throw new Error('Назначьте шарнир выходом.');
  draft.title = title.slice(0, 80); draft.player.charges = clamp(Number($('player-charges').value) || 0, 0, 9); draft.player.initialAngleDeg = clamp(Number($('player-angle').value) || 0, -360, 360); draft.player.omegaDegSigned = clamp(Number($('player-speed').value) || 0, -360, 360);
  if (Math.abs(draft.player.omegaDegSigned) < 1) draft.player.omegaDegSigned = 90;
  const id = editingId || 'custom-' + slug(title) + '-' + Date.now().toString(36);
  return { id, level: clone(draft) };
}

function localRows() { try { const rows = JSON.parse(localStorage.getItem('clockshift.customLevels.v1') || '[]'); return Array.isArray(rows) ? rows : []; } catch (_) { return []; } }

function writeLocalRow(row) {
  const rows = localRows().filter(item => item.id !== row.id); rows.push(row);
  try { localStorage.setItem('clockshift.customLevels.v1', JSON.stringify(rows.slice(-200))); } catch (_) { /* private mode */ }
}

function mergeRows(rows, remoteIsAuthoritative = false) {
  const map = new Map(); [...(remoteIsAuthoritative ? [] : localRows()), ...(Array.isArray(rows) ? rows : [])].forEach(row => { if (row && row.id && row.level) map.set(row.id, row); });
  savedRows = [...map.values()].sort((a, b) => String(a.level.title || a.id).localeCompare(String(b.level.title || b.id), 'ru'));
  const select = $('saved-levels'); select.textContent = '';
  if (!savedRows.length) { const option = document.createElement('option'); option.value = ''; option.textContent = 'Пока нет сохранённых уровней'; select.append(option); return; }
  savedRows.forEach(row => { const option = document.createElement('option'); option.value = row.id; option.textContent = row.level.title + ' · ' + row.id; select.append(option); });
  if (editingId && savedRows.some(row => row.id === editingId)) select.value = editingId;
}

async function refreshRows() {
  let remote = [];
  let remoteIsAuthoritative = false;
  try { const response = await fetch(API, { cache: 'no-store' }); if (response.ok) { const payload = await response.json(); remote = Array.isArray(payload) ? payload : payload.levels || []; remoteIsAuthoritative = true; } } catch (_) { /* local fallback is intentional */ }
  mergeRows(remote, remoteIsAuthoritative);
  const requested = new URLSearchParams(window.location.search).get('id'); if (requested) { const row = savedRows.find(item => item.id === requested); if (row) loadRow(row); }
}

function loadRow(row) {
  if (!row || !row.level) return;
  editingId = row.id; draft = clone(row.level); ensureDraft(); $('level-title').value = draft.title || row.id; $('player-charges').value = draft.player.charges ?? 1; $('player-angle').value = draft.player.initialAngleDeg ?? -45; $('player-speed').value = draft.player.omegaDegSigned ?? 90; $('saved-levels').value = row.id; setStatus('Открыт уровень «' + draft.title + '».'); draw();
}

async function saveLevel() {
  try {
    const row = buildRow(); writeLocalRow(row); editingId = row.id; mergeRows([]); $('saved-levels').value = row.id;
    try {
      const response = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row) });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      setStatus('Сохранено на общем сервере. Уровень виден всем посетителям.');
      await refreshRows();
    } catch (error) { setStatus('Сохранено на этом устройстве; сервер пока недоступен (' + error.message + ').', true); }
  } catch (error) { setStatus(error.message, true); }
}

function updateFormFromDraft() {
  $('level-title').value = draft.title || 'Новый уровень'; $('player-charges').value = draft.player.charges ?? 1; $('player-angle').value = draft.player.initialAngleDeg ?? -45; $('player-speed').value = draft.player.omegaDegSigned ?? 90;
}

function init() {
  ensureDraft(); updateFormFromDraft(); setTool('select');
  document.querySelectorAll('.tool-button').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
  $('editor-board').addEventListener('pointerdown', pointerDown); $('editor-board').addEventListener('pointermove', pointerMove); $('editor-board').addEventListener('pointerup', pointerUp); $('editor-board').addEventListener('pointercancel', pointerUp);
  $('save-level').addEventListener('click', saveLevel); $('load-level').addEventListener('click', () => { const row = savedRows.find(item => item.id === $('saved-levels').value); if (row) loadRow(row); });
  $('new-level').addEventListener('click', () => { editingId = ''; draft = starterLevel(); updateFormFromDraft(); setStatus('Создан новый черновик.'); draw(); });
  $('play-level').addEventListener('click', () => { try { const row = buildRow(); writeLocalRow(row); window.location.href = 'index.html?level=' + encodeURIComponent(row.id); } catch (error) { setStatus(error.message, true); } });
  window.addEventListener('resize', resizeCanvas); if (window.ResizeObserver) new ResizeObserver(resizeCanvas).observe($('editor-board'));
  resizeCanvas(); refreshRows();
}

document.addEventListener('DOMContentLoaded', init);
