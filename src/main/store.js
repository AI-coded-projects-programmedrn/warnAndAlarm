'use strict';
/**
 * 설정과 오늘 상태를 userData 폴더의 JSON 파일에 저장한다.
 * "하루"의 경계는 사용자가 정한 리셋 시각(기본 01:00)이다.
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const FILE = () => path.join(app.getPath('userData'), 'warn-and-alarm.json');

const DEFAULT_TASKS = [
  '이불 정리하기',
  '물 한 잔 마시기',
  '오늘 할 일 3가지 적기',
  '스트레칭 5분',
];

const DEFAULTS = {
  settings: {
    tasks: [],                  // { id, text }
    idleMinutes: 5,             // 자리 비움 판정 시간
    stretchIntervalMinutes: 60, // 복귀 후 스트레칭 알림 간격
    resetHour: 1,               // 하루 리셋 시각
    resetMinute: 0,
    stretchEnabled: true,
    enforceFocus: true,         // 차단 중 강제 포커스 유지
    showOnStartup: true,        // 앱 시작 시 미완료면 차단 화면 표시
    notifyMode: 'auto',         // 알림 방식: auto | system | balloon
    bedtimeEnabled: true,       // 취침 준비 알림
    bedtimeHour: 23,
    bedtimeMinute: 0,
    bedtimeSnoozeMinutes: 15,
    bedtimeMessage: '슬슬 잘 준비를 시작해요.',
    openCalendarAfterTasks: true, // 매일 할 일을 마치면 달력 창을 연다
    events: [],                 // { id, date: 'YYYY-MM-DD', title, content }
  },
  state: {
    dayKey: null,
    checked: {},                // taskId -> true
    completedAt: null,          // ISO string
    unlockedUntil: null,        // 긴급 해제 만료 시각(ISO). null이면 해제 상태 아님
    emergencyLog: [],           // { at, reason, mode }
    bedtimeShownFor: null,      // 취침 알림을 이미 띄운 날의 dayKey
  },
};

let data = null;

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** 'YYYY-MM-DD' 형식이면 그대로, 아니면 null */
function normDate(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return s;
}

/** 일정 하나를 표준형으로 다듬는다 (날짜/제목이 없으면 나중에 걸러진다) */
function normalizeEvent(e) {
  if (!e || typeof e !== 'object') return { id: uid(), date: null, title: '', content: '' };
  return {
    id: e.id || uid(),
    date: normDate(e.date),
    title: String(e.title ?? '').trim().slice(0, 100),
    content: String(e.content ?? '').trim().slice(0, 2000),
  };
}

/** 날짜 오름차순, 같은 날은 제목순 */
function byDate(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.title.localeCompare(b.title, 'ko');
}

function normalizeEventList(list) {
  return (Array.isArray(list) ? list : [])
    .map(normalizeEvent)
    .filter((e) => e.date && e.title);
}

/** 리셋 시각을 기준으로 한 "논리적 하루" 키 (YYYY-MM-DD) */
function dayKeyFor(date, settings) {
  const offsetMs = (settings.resetHour * 60 + settings.resetMinute) * 60 * 1000;
  const d = new Date(date.getTime() - offsetMs);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 다음 리셋 시각 */
function nextResetAt(date, settings) {
  const n = new Date(date);
  const target = new Date(n.getFullYear(), n.getMonth(), n.getDate(), settings.resetHour, settings.resetMinute, 0, 0);
  if (target <= n) target.setDate(target.getDate() + 1);
  return target;
}

function mergeDefaults(loaded) {
  const out = JSON.parse(JSON.stringify(DEFAULTS));
  if (loaded && typeof loaded === 'object') {
    Object.assign(out.settings, loaded.settings || {});
    Object.assign(out.state, loaded.state || {});
  }
  if (!Array.isArray(out.settings.tasks) || out.settings.tasks.length === 0) {
    out.settings.tasks = DEFAULT_TASKS.map((text) => ({ id: uid(), text }));
  }
  out.settings.tasks = out.settings.tasks
    .filter((t) => t && typeof t.text === 'string' && t.text.trim())
    .map((t) => ({ id: t.id || uid(), text: t.text.trim() }));
  if (!out.state.checked || typeof out.state.checked !== 'object') out.state.checked = {};
  if (!Array.isArray(out.state.emergencyLog)) out.state.emergencyLog = [];
  out.settings.events = normalizeEventList(out.settings.events);
  return out;
}

function load() {
  let loaded = null;
  try {
    loaded = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
  } catch (_) {
    loaded = null;
  }
  data = mergeDefaults(loaded);
  return data;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE()), { recursive: true });
    fs.writeFileSync(FILE(), JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[store] 저장 실패:', err);
  }
}

function get() {
  if (!data) load();
  return data;
}

const settings = () => get().settings;
const state = () => get().state;

/**
 * 날짜가 넘어갔으면 오늘 상태를 초기화한다.
 * @returns {boolean} 초기화가 일어났는지 여부
 */
function rolloverIfNeeded(now = new Date()) {
  const s = get();
  const key = dayKeyFor(now, s.settings);
  if (s.state.dayKey === key) return false;
  s.state.dayKey = key;
  s.state.checked = {};
  s.state.completedAt = null;
  s.state.unlockedUntil = null;
  save();
  return true;
}

/** 현재 설정된 할 일이 모두 체크되었는지 */
function isComplete() {
  const s = get();
  const tasks = s.settings.tasks;
  if (tasks.length === 0) return true;
  return tasks.every((t) => !!s.state.checked[t.id]);
}

/** 지금 화면을 가려야 하는 상태인지 */
function shouldBlock(now = new Date()) {
  const s = get();
  if (isComplete()) return false;
  if (s.state.unlockedUntil && new Date(s.state.unlockedUntil) > now) return false;
  return true;
}

function setChecked(taskId, value) {
  const s = get();
  if (!s.settings.tasks.some((t) => t.id === taskId)) return;
  if (value) s.state.checked[taskId] = true;
  else delete s.state.checked[taskId];
  s.state.completedAt = isComplete() ? new Date().toISOString() : null;
  save();
}

function emergencyUnlock({ reason, minutes }) {
  const s = get();
  const now = new Date();
  const until = minutes === null || minutes === undefined
    ? nextResetAt(now, s.settings)
    : new Date(now.getTime() + minutes * 60 * 1000);
  s.state.unlockedUntil = until.toISOString();
  s.state.emergencyLog.unshift({
    at: now.toISOString(),
    reason: String(reason || '').slice(0, 300),
    mode: minutes ? `${minutes}분 미루기` : '오늘 하루 해제',
  });
  s.state.emergencyLog = s.state.emergencyLog.slice(0, 30);
  save();
  return until;
}

function updateSettings(patch) {
  const s = get();
  const next = { ...s.settings, ...patch };
  // 1분처럼 짧게 쓰고 싶은 경우도 있으므로 하한을 두지 않는다 (최소 1분)
  next.idleMinutes = clamp(Number(next.idleMinutes) || 5, 1, 1440);
  next.stretchIntervalMinutes = clamp(Number(next.stretchIntervalMinutes) || 60, 1, 1440);
  next.resetHour = clamp(Math.floor(Number(next.resetHour)), 0, 23);
  next.resetMinute = clamp(Math.floor(Number(next.resetMinute)), 0, 59);
  next.stretchEnabled = !!next.stretchEnabled;
  next.enforceFocus = !!next.enforceFocus;
  next.showOnStartup = !!next.showOnStartup;
  next.notifyMode = ['auto', 'system', 'balloon'].includes(next.notifyMode) ? next.notifyMode : 'auto';
  next.bedtimeEnabled = !!next.bedtimeEnabled;
  next.bedtimeHour = clamp(Math.floor(Number(next.bedtimeHour)), 0, 23);
  next.bedtimeMinute = clamp(Math.floor(Number(next.bedtimeMinute)), 0, 59);
  next.bedtimeSnoozeMinutes = clamp(Number(next.bedtimeSnoozeMinutes) || 15, 1, 240);
  next.bedtimeMessage = String(next.bedtimeMessage ?? '').trim().slice(0, 120) || '슬슬 잘 준비를 시작해요.';
  next.openCalendarAfterTasks = !!next.openCalendarAfterTasks;
  next.tasks = (Array.isArray(next.tasks) ? next.tasks : [])
    .map((t) => ({ id: t.id || uid(), text: String(t.text || '').trim().slice(0, 120) }))
    .filter((t) => t.text);
  next.events = normalizeEventList(next.events);
  s.settings = next;
  // 없어진 할 일의 체크 기록 정리
  const ids = new Set(next.tasks.map((t) => t.id));
  for (const k of Object.keys(s.state.checked)) if (!ids.has(k)) delete s.state.checked[k];
  s.state.completedAt = isComplete() ? (s.state.completedAt || new Date().toISOString()) : null;
  save();
  return next;
}

function clamp(v, min, max) {
  if (Number.isNaN(v)) return min;
  return Math.min(max, Math.max(min, v));
}

/**
 * 오늘(= 리셋 기준 하루) 예정된 취침 준비 알림 시각.
 * 하루의 경계가 01:00 이면 23:00 도, 00:30 도 같은 하루에 속한다.
 */
function bedtimeAt(now = new Date()) {
  const s = settings();
  const resetMinutes = s.resetHour * 60 + s.resetMinute;
  const bedMinutes = s.bedtimeHour * 60 + s.bedtimeMinute;
  // 지금이 속한 '논리적 하루'의 시작 날짜를 구한다 (리셋 01:00 이면 00:30 은 아직 어제)
  const dayStart = new Date(now.getTime() - resetMinutes * 60 * 1000);
  const target = new Date(
    dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(),
    s.bedtimeHour, s.bedtimeMinute, 0, 0
  );
  // 취침 시각이 리셋 시각보다 이르면 그 하루의 '다음 날 새벽'에 해당한다 (예: 리셋 01:00, 취침 00:30)
  if (bedMinutes < resetMinutes) target.setDate(target.getDate() + 1);
  return target;
}

/** 지금 취침 준비 알림을 띄워야 하는가 */
function bedtimeDue(now = new Date()) {
  const s = get();
  if (!s.settings.bedtimeEnabled) return false;
  // state.dayKey 에 기대지 않고 직접 계산한다 (아직 비어 있을 수 있다)
  if (s.state.bedtimeShownFor === dayKeyFor(now, s.settings)) return false;
  return now >= bedtimeAt(now);
}

function markBedtimeShown(now = new Date()) {
  const s = get();
  s.state.bedtimeShownFor = dayKeyFor(now, s.settings);
  save();
}

/** '오늘은 이미 띄웠음' 표시를 지운다 (알림 시각을 새로 정했을 때) */
function clearBedtimeShown() {
  const s = get();
  s.state.bedtimeShownFor = null;
  save();
}

/* ---------------- 일정 (달력) ---------------- */

/** 등록된 모든 일정을 날짜순으로 */
function listEvents() {
  return [...settings().events].sort(byDate);
}

/**
 * 지금(리셋 기준 하루)을 기준으로 '아직 지나지 않은' 일정만, 가까운 날짜순으로.
 * 예: 오늘이 10-11이면 10-11·10-12는 나오지만 10-10은 빠진다.
 */
function upcomingEvents(now = new Date()) {
  const today = dayKeyFor(now, settings());
  return listEvents().filter((e) => e.date >= today);
}

function addEvent({ date, title, content } = {}) {
  const ev = normalizeEvent({ date, title, content });
  if (!ev.date) return { ok: false, error: '날짜가 올바르지 않습니다.' };
  if (!ev.title) return { ok: false, error: '제목을 입력해 주세요.' };
  settings().events.push(ev);
  save();
  return { ok: true, event: ev };
}

function updateEvent(id, patch = {}) {
  const ev = settings().events.find((e) => e.id === id);
  if (!ev) return { ok: false, error: '일정을 찾을 수 없습니다.' };
  if (patch.date !== undefined) {
    const d = normDate(patch.date);
    if (!d) return { ok: false, error: '날짜가 올바르지 않습니다.' };
    ev.date = d;
  }
  if (patch.title !== undefined) {
    const t = String(patch.title).trim().slice(0, 100);
    if (!t) return { ok: false, error: '제목을 입력해 주세요.' };
    ev.title = t;
  }
  if (patch.content !== undefined) ev.content = String(patch.content).trim().slice(0, 2000);
  save();
  return { ok: true, event: ev };
}

function deleteEvent(id) {
  const arr = settings().events;
  const i = arr.findIndex((e) => e.id === id);
  if (i >= 0) { arr.splice(i, 1); save(); }
  return { ok: true };
}

/* ---------------- 설정 내보내기 / 불러오기 ---------------- */

const EXPORT_KEYS = [
  'tasks', 'idleMinutes', 'stretchIntervalMinutes', 'resetHour', 'resetMinute',
  'stretchEnabled', 'enforceFocus', 'showOnStartup', 'notifyMode',
  'bedtimeEnabled', 'bedtimeHour', 'bedtimeMinute', 'bedtimeSnoozeMinutes', 'bedtimeMessage',
  'openCalendarAfterTasks', 'events',
];

/** 다른 컴퓨터로 옮길 수 있는 설정 묶음 (오늘의 체크 상태는 포함하지 않는다) */
function exportSettings() {
  const s = settings();
  const out = { format: 'warn-and-alarm/settings', version: 1, exportedAt: new Date().toISOString() };
  for (const k of EXPORT_KEYS) out[k] = s[k];
  out.tasks = s.tasks.map((t) => ({ text: t.text })); // id 는 옮기지 않는다
  out.events = s.events.map((e) => ({ date: e.date, title: e.title, content: e.content }));
  return out;
}

/**
 * 내보낸 묶음을 적용한다. 알 수 없는 값은 무시되고, 범위를 벗어난 값은 보정된다.
 * @returns {{ ok: boolean, error?: string, settings?: object }}
 */
function importSettings(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, error: '내용을 읽을 수 없습니다.' };
  if (payload.format !== 'warn-and-alarm/settings') {
    return { ok: false, error: '이 앱의 설정 파일이 아닙니다.' };
  }
  const patch = {};
  for (const k of EXPORT_KEYS) if (payload[k] !== undefined) patch[k] = payload[k];
  if (patch.tasks !== undefined) {
    if (!Array.isArray(patch.tasks)) return { ok: false, error: '할 일 목록 형식이 올바르지 않습니다.' };
    patch.tasks = patch.tasks
      .map((t) => ({ id: uid(), text: typeof t === 'string' ? t : String((t && t.text) || '') }))
      .filter((t) => t.text.trim());
  }
  if (patch.events !== undefined) {
    if (!Array.isArray(patch.events)) return { ok: false, error: '일정 형식이 올바르지 않습니다.' };
    patch.events = normalizeEventList(patch.events.map((e) => ({ ...e, id: undefined })));
  }
  return { ok: true, settings: updateSettings(patch) };
}

module.exports = {
  load, save, get, settings, state,
  uid, dayKeyFor, nextResetAt,
  rolloverIfNeeded, isComplete, shouldBlock,
  setChecked, emergencyUnlock, updateSettings,
  exportSettings, importSettings,
  bedtimeAt, bedtimeDue, markBedtimeShown, clearBedtimeShown,
  listEvents, upcomingEvents, addEvent, updateEvent, deleteEvent,
};
