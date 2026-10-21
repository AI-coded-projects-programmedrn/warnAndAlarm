'use strict';

const $ = (id) => document.getElementById(id);
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

let allEvents = [];
let todayKey = '';
let viewYear = 0;
let viewMonth = 0;      // 0-based
let selectedKey = null;
let editingId = null;

/* ---------- 날짜 유틸 ---------- */

const pad = (n) => String(n).padStart(2, '0');
const keyOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function fullLabel(key) {
  const d = parseKey(key);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}
function shortLabel(key) {
  const d = parseKey(key);
  return `${d.getMonth() + 1}.${d.getDate()} (${WEEKDAYS[d.getDay()]})`;
}
function ddayLabel(key) {
  const diff = Math.round((parseKey(key) - parseKey(todayKey)) / 86400000);
  return diff <= 0 ? 'D-DAY' : `D-${diff}`;
}

function eventsOn(key) {
  return allEvents
    .filter((e) => e.date === key)
    .sort((a, b) => a.title.localeCompare(b.title, 'ko'));
}

/* ---------- 렌더 ---------- */

function renderWeekdays() {
  const wd = $('weekdays');
  wd.innerHTML = '';
  WEEKDAYS.forEach((name, i) => {
    const s = document.createElement('span');
    s.textContent = name;
    if (i === 0) s.className = 'sun';
    if (i === 6) s.className = 'sat';
    wd.appendChild(s);
  });
}

function renderGrid() {
  $('cal-title').textContent = `${viewYear}년 ${viewMonth + 1}월`;
  const grid = $('grid');
  grid.innerHTML = '';

  const first = new Date(viewYear, viewMonth, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay()); // 그 주 일요일부터

  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = keyOf(d.getFullYear(), d.getMonth(), d.getDate());
    const dow = d.getDay();

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cell';
    if (d.getMonth() !== viewMonth) cell.classList.add('other');
    if (key === todayKey) cell.classList.add('today');
    if (key === selectedKey) cell.classList.add('selected');
    if (key < todayKey) cell.classList.add('past');
    if (dow === 0) cell.classList.add('sun');
    if (dow === 6) cell.classList.add('sat');

    const num = document.createElement('span');
    num.className = 'daynum';
    num.textContent = d.getDate();
    cell.appendChild(num);

    const evs = eventsOn(key);
    evs.slice(0, 2).forEach((ev) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = ev.title;
      cell.appendChild(chip);
    });
    if (evs.length > 2) {
      const more = document.createElement('span');
      more.className = 'more';
      more.textContent = `+${evs.length - 2}`;
      cell.appendChild(more);
    }

    cell.addEventListener('click', () => selectDate(key));
    grid.appendChild(cell);
  }
}

function renderDayEvents() {
  const list = $('day-events');
  list.innerHTML = '';
  if (!selectedKey) return;
  for (const ev of eventsOn(selectedKey)) {
    const li = document.createElement('li');
    li.className = 'de' + (ev.id === editingId ? ' editing' : '');

    const body = document.createElement('div');
    body.className = 'de-body';
    const title = document.createElement('div');
    title.className = 'de-title';
    title.textContent = ev.title;
    body.appendChild(title);
    if (ev.content) {
      const c = document.createElement('div');
      c.className = 'de-content';
      c.textContent = ev.content;
      body.appendChild(c);
    }
    body.title = '눌러서 수정';
    body.addEventListener('click', () => startEdit(ev));

    const actions = document.createElement('div');
    actions.className = 'de-actions';
    const edit = document.createElement('button');
    edit.className = 'iconbtn';
    edit.textContent = '✎';
    edit.title = '수정';
    edit.addEventListener('click', () => startEdit(ev));
    const del = document.createElement('button');
    del.className = 'iconbtn del';
    del.textContent = '✕';
    del.title = '삭제';
    del.addEventListener('click', () => removeEvent(ev.id));
    actions.append(edit, del);

    li.append(body, actions);
    list.appendChild(li);
  }
}

function renderPanel() {
  $('panel-date').textContent = selectedKey ? fullLabel(selectedKey) : '날짜를 선택하세요';
  renderDayEvents();
  validateForm();
}

/** 오늘(리셋 기준) 이후의 일정만 가까운 날짜순으로 */
function renderUpcoming() {
  const list = $('upcoming-list');
  list.innerHTML = '';
  const upcoming = allEvents
    .filter((e) => e.date >= todayKey)
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.title.localeCompare(b.title, 'ko')));

  if (upcoming.length === 0) {
    const li = document.createElement('li');
    li.className = 'up-empty';
    li.textContent = '다가오는 일정이 없습니다. 달력에서 날짜를 눌러 추가하세요.';
    list.appendChild(li);
    return;
  }
  for (const ev of upcoming) {
    const li = document.createElement('li');
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'up' + (ev.date === todayKey ? ' today' : '');
    item.title = ev.content || '';

    const date = document.createElement('span');
    date.className = 'up-date';
    date.textContent = shortLabel(ev.date);
    const title = document.createElement('span');
    title.className = 'up-title';
    title.textContent = ev.title;
    const dday = document.createElement('span');
    dday.className = 'up-dday';
    dday.textContent = ddayLabel(ev.date);

    item.append(date, title, dday);
    item.addEventListener('click', () => gotoDate(ev.date, false)); // 그 날짜로 이동해서 자세히 보기
    li.appendChild(item);
    list.appendChild(li);
  }
}

function renderAll() {
  renderGrid();
  renderUpcoming();
  renderPanel();
}

/* ---------- 상호작용 ---------- */

function selectDate(key, focus = true) {
  selectedKey = key;
  cancelEdit(); // 다른 날짜를 고르면 수정 모드는 해제
  renderAll();
  if (focus) $('ev-title').focus();
}

function validateForm() {
  const ok = !!selectedKey && $('ev-title').value.trim().length > 0;
  $('btn-submit').disabled = !ok;
}

function startEdit(ev) {
  editingId = ev.id;
  selectedKey = ev.date;
  $('ev-title').value = ev.title;
  $('ev-content').value = ev.content || '';
  $('form-label').textContent = '일정 수정';
  $('btn-submit').textContent = '수정';
  $('btn-cancel-edit').hidden = false;
  renderAll();
  $('ev-title').focus();
}

function cancelEdit() {
  editingId = null;
  $('ev-title').value = '';
  $('ev-content').value = '';
  $('form-label').textContent = '이 날짜에 일정 추가';
  $('btn-submit').textContent = '추가';
  $('btn-cancel-edit').hidden = true;
}

function hint(text, kind) {
  const el = $('form-hint');
  el.textContent = text || '';
  el.className = 'form-hint' + (kind ? ' ' + kind : '');
}

function applyPayload(payload) {
  if (payload && Array.isArray(payload.events)) {
    allEvents = payload.events;
    if (payload.todayKey) todayKey = payload.todayKey;
  }
}

async function submitForm(e) {
  e.preventDefault();
  const title = $('ev-title').value.trim();
  const content = $('ev-content').value.trim();
  if (!selectedKey || !title) return;

  const res = editingId
    ? await window.api.events.update(editingId, { title, content })
    : await window.api.events.add({ date: selectedKey, title, content });

  if (!res.ok) { hint(res.error || '저장하지 못했습니다.', 'bad'); return; }
  applyPayload(res);
  const wasEdit = !!editingId;
  cancelEdit();
  renderAll();
  hint(wasEdit ? '수정했습니다.' : '추가했습니다.', 'ok');
  setTimeout(() => hint(''), 1800);
}

async function removeEvent(id) {
  if (editingId === id) cancelEdit();
  applyPayload(await window.api.events.remove(id));
  renderAll();
}

function gotoToday(focus = true) {
  gotoDate(todayKey, focus);
}

/** 달력을 그 날짜가 있는 달로 옮기고 그 날짜를 선택한다 */
function gotoDate(key, focus = true) {
  const d = parseKey(key);
  viewYear = d.getFullYear();
  viewMonth = d.getMonth();
  selectDate(key, focus);
}

/* ---------- 초기화 ---------- */

function bind() {
  $('btn-min').addEventListener('click', () => window.api.window.minimize());
  $('btn-close-win').addEventListener('click', () => window.api.window.close());
  $('btn-prev').addEventListener('click', () => {
    if (--viewMonth < 0) { viewMonth = 11; viewYear--; }
    renderGrid();
  });
  $('btn-next').addEventListener('click', () => {
    if (++viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderGrid();
  });
  $('btn-today').addEventListener('click', gotoToday);
  $('add-form').addEventListener('submit', submitForm);
  $('btn-cancel-edit').addEventListener('click', () => { cancelEdit(); renderDayEvents(); });
  $('ev-title').addEventListener('input', validateForm);

  // 날짜가 바뀌는 등 바깥에서 일정이 갱신되면 반영 (입력 중인 폼은 건드리지 않음)
  window.api.events.onChange((payload) => {
    applyPayload(payload);
    renderGrid();
    renderUpcoming();
    renderDayEvents();
  });
}

(async function init() {
  bind();
  renderWeekdays();
  applyPayload(await window.api.events.list());
  if (!todayKey) {
    const n = new Date();
    todayKey = keyOf(n.getFullYear(), n.getMonth(), n.getDate());
  }
  gotoToday(false);          // 처음엔 달력이 보이도록 입력창 포커스는 하지 않는다
  document.querySelector('.wrap').scrollTop = 0;
})();
