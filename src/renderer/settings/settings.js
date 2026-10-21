'use strict';

const $ = (id) => document.getElementById(id);

let settings = null;   // 편집 중인 사본
let saved = null;      // 마지막으로 저장된 값
let dirty = false;

/* ---------- 렌더 ---------- */

function pad(n) { return String(n).padStart(2, '0'); }

function renderTasks() {
  const list = $('items');
  list.innerHTML = '';
  if (settings.tasks.length === 0) {
    const li = document.createElement('li');
    li.className = 'items-empty';
    li.textContent = '항목이 없습니다. 아래에서 추가하세요. (비워두면 차단 화면이 뜨지 않습니다)';
    list.appendChild(li);
    return;
  }
  settings.tasks.forEach((task, i) => {
    const li = document.createElement('li');
    li.className = 'item';
    li.dataset.index = String(i);

    // 번호 자리가 곧 드래그 손잡이다 (올려두면 손잡이 모양으로 바뀐다)
    const grip = document.createElement('span');
    grip.className = 'grip';
    grip.title = '끌어서 순서 바꾸기';
    const gripNum = document.createElement('span');
    gripNum.className = 'grip-num';
    gripNum.textContent = pad(i + 1);
    const gripDots = document.createElement('span');
    gripDots.className = 'grip-dots';
    gripDots.textContent = '⠿';
    grip.append(gripNum, gripDots);
    // 손잡이를 잡았을 때만 끌 수 있게 한다 (입력란 텍스트 선택을 방해하지 않도록)
    grip.addEventListener('mousedown', () => { li.draggable = true; });
    grip.addEventListener('mouseup', () => { li.draggable = false; });
    li.addEventListener('dragstart', (e) => {
      li.classList.add('dragging');
      $('items').classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', li.dataset.index);
    });
    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
      li.draggable = false;
      $('items').classList.remove('dragging');
      commitDraggedOrder();
    });

    const input = document.createElement('input');
    input.type = 'text';
    input.value = task.text;
    input.maxLength = 120;
    input.spellcheck = false;
    input.addEventListener('input', () => {
      task.text = input.value;
      markDirty();
    });

    const up = iconButton('↑', '위로', i === 0, () => move(i, -1));
    const down = iconButton('↓', '아래로', i === settings.tasks.length - 1, () => move(i, 1));
    const del = iconButton('✕', '삭제', false, () => {
      settings.tasks.splice(i, 1);
      markDirty();
      renderTasks();
    });
    del.classList.add('del');

    li.append(grip, input, up, down, del);
    list.appendChild(li);
  });
}

function iconButton(label, title, disabled, onClick) {
  const b = document.createElement('button');
  b.className = 'iconbtn';
  b.textContent = label;
  b.title = title;
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

/** 드래그 중인 항목이 놓일 위치를 커서 높이로 찾는다 */
function elementAfterPointer(list, y) {
  const others = [...list.querySelectorAll('.item:not(.dragging)')];
  let closest = null;
  let closestOffset = Number.NEGATIVE_INFINITY;
  for (const el of others) {
    const box = el.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closestOffset) {
      closestOffset = offset;
      closest = el;
    }
  }
  return closest;
}

/** 화면에 놓인 순서를 실제 목록에 반영한다 */
function commitDraggedOrder() {
  const list = $('items');
  const order = [...list.querySelectorAll('.item')].map((el) => Number(el.dataset.index));
  const before = settings.tasks;
  const next = order.map((i) => before[i]).filter(Boolean);
  if (next.length !== before.length) return renderTasks(); // 이상하면 원래대로 다시 그린다
  const changed = next.some((t, i) => t !== before[i]);
  settings.tasks = next;
  if (changed) markDirty();
  renderTasks();
}

function move(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= settings.tasks.length) return;
  const [item] = settings.tasks.splice(index, 1);
  settings.tasks.splice(target, 0, item);
  markDirty();
  renderTasks();
}

function addTask() {
  const input = $('new-task');
  const text = input.value.trim();
  if (!text) return;
  settings.tasks.push({ id: '', text });
  input.value = '';
  markDirty();
  renderTasks();
  // 연달아 입력할 수 있도록 포커스는 입력창에 그대로 둔다
  input.focus();
  const list = $('items');
  list.scrollTop = list.scrollHeight;
}

function renderLog(log) {
  const list = $('log');
  list.innerHTML = '';
  if (!log || log.length === 0) {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = '아직 긴급 해제를 사용한 적이 없습니다.';
    list.appendChild(li);
    return;
  }
  for (const entry of log) {
    const d = new Date(entry.at);
    const li = document.createElement('li');

    const meta = document.createElement('div');
    meta.className = 'meta';
    const when = document.createElement('span');
    when.textContent = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const mode = document.createElement('b');
    mode.textContent = entry.mode || '';
    meta.append(when, mode);

    const reason = document.createElement('div');
    reason.className = 'reason';
    reason.textContent = entry.reason || '(사유 없음)';

    li.append(meta, reason);
    list.appendChild(li);
  }
}

function fillForm() {
  $('reset-time').value = `${pad(settings.resetHour)}:${pad(settings.resetMinute)}`;
  $('idle').value = settings.idleMinutes;
  $('stretch').value = settings.stretchIntervalMinutes;
  $('stretch-enabled').checked = settings.stretchEnabled;
  $('notify-mode').value = settings.notifyMode || 'auto';
  $('bedtime-enabled').checked = settings.bedtimeEnabled;
  $('bedtime-time').value = `${pad(settings.bedtimeHour)}:${pad(settings.bedtimeMinute)}`;
  $('bedtime-snooze').value = settings.bedtimeSnoozeMinutes;
  $('bedtime-message').value = settings.bedtimeMessage || '';
  $('enforce-focus').checked = settings.enforceFocus;
  $('show-on-startup').checked = settings.showOnStartup;
  $('open-calendar').checked = settings.openCalendarAfterTasks;
  renderTasks();
}

function readForm() {
  const [h, m] = ($('reset-time').value || '01:00').split(':').map(Number);
  settings.resetHour = Number.isFinite(h) ? h : 1;
  settings.resetMinute = Number.isFinite(m) ? m : 0;
  settings.idleMinutes = Number($('idle').value) || 5;
  settings.stretchIntervalMinutes = Number($('stretch').value) || 60;
  settings.stretchEnabled = $('stretch-enabled').checked;
  settings.notifyMode = $('notify-mode').value;
  const [bh, bm] = ($('bedtime-time').value || '23:00').split(':').map(Number);
  settings.bedtimeEnabled = $('bedtime-enabled').checked;
  settings.bedtimeHour = Number.isFinite(bh) ? bh : 23;
  settings.bedtimeMinute = Number.isFinite(bm) ? bm : 0;
  settings.bedtimeSnoozeMinutes = Number($('bedtime-snooze').value) || 15;
  settings.bedtimeMessage = $('bedtime-message').value.trim();
  settings.enforceFocus = $('enforce-focus').checked;
  settings.showOnStartup = $('show-on-startup').checked;
  settings.openCalendarAfterTasks = $('open-calendar').checked;
  settings.tasks = settings.tasks.filter((t) => t.text.trim());
  return settings;
}

function markDirty() {
  dirty = true;
  $('save-state').textContent = '저장하지 않은 변경 사항';
  $('save-state').className = 'save-state';
}

/* ---------- 저장 ---------- */

async function save() {
  const next = await window.api.settings.save(readForm());
  settings = JSON.parse(JSON.stringify(next));
  saved = JSON.parse(JSON.stringify(next));
  dirty = false;
  fillForm();
  $('save-state').textContent = '저장했습니다';
  $('save-state').className = 'save-state ok';
  setTimeout(() => {
    if (!dirty) $('save-state').textContent = '';
  }, 2200);
}

function revert() {
  settings = JSON.parse(JSON.stringify(saved));
  dirty = false;
  fillForm();
  $('save-state').textContent = '';
}

/* ---------- 내보내기 / 불러오기 ---------- */

function ioMessage(text, kind) {
  const el = $('io-state');
  el.textContent = text;
  el.className = 'io-state' + (kind ? ' ' + kind : '');
}

/** 불러오기 결과를 화면에 반영한다 */
function applyImported(res) {
  if (res.canceled) return ioMessage('');
  if (!res.ok) return ioMessage(res.error || '불러오지 못했습니다.', 'bad');
  settings = JSON.parse(JSON.stringify(res.settings));
  saved = JSON.parse(JSON.stringify(res.settings));
  dirty = false;
  fillForm();
  $('save-state').textContent = '';
  ioMessage(`불러왔습니다. 할 일 ${res.settings.tasks.length}개가 적용되었습니다.`, 'ok');
}

async function exportFile() {
  const res = await window.api.settings.exportFile();
  if (res.canceled) return ioMessage('');
  ioMessage(res.ok ? `저장했습니다: ${res.filePath}` : res.error || '저장하지 못했습니다.', res.ok ? 'ok' : 'bad');
}

async function exportCode() {
  const res = await window.api.settings.exportCode();
  if (!res.ok) return ioMessage(res.error || '코드를 만들지 못했습니다.', 'bad');
  $('io-code').value = res.code;
  $('io-code').select();
  ioMessage('코드를 만들어 클립보드에 복사했습니다. 다른 컴퓨터에 붙여넣으세요.', 'ok');
}

async function importCode() {
  const code = $('io-code').value.trim();
  if (!code) return ioMessage('먼저 설정 코드를 붙여넣으세요.', 'bad');
  applyImported(await window.api.settings.importCode(code));
}

async function testNotify() {
  const res = await window.api.notify.test($('notify-mode').value);
  const label = { balloon: '트레이 풍선', system: '시스템 알림' }[res.method];
  ioMessage(
    res.ok
      ? `${label} 방식으로 보냈습니다. 화면 오른쪽 아래를 확인하세요. 안 보이면 다른 방식으로 바꿔 다시 눌러보세요.`
      : '알림을 보내지 못했습니다. Windows 알림 설정(집중 지원)이 꺼져 있는지 확인해 주세요.',
    res.ok ? 'ok' : 'bad'
  );
}

/* ---------- 초기화 ---------- */

function bindTaskDragTarget() {
  const list = $('items');
  list.addEventListener('dragover', (e) => {
    const dragging = list.querySelector('.dragging');
    if (!dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const after = elementAfterPointer(list, e.clientY);
    if (after == null) list.appendChild(dragging);
    else if (after !== dragging) list.insertBefore(dragging, after);
  });
  list.addEventListener('drop', (e) => e.preventDefault());
}

function bind() {
  $('btn-min').addEventListener('click', () => window.api.window.minimize());
  $('btn-close-win').addEventListener('click', () => window.api.window.close());
  $('btn-save').addEventListener('click', save);
  $('btn-revert').addEventListener('click', revert);
  $('btn-add').addEventListener('click', addTask);
  bindTaskDragTarget();
  $('new-task').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTask();
  });
  for (const id of ['reset-time', 'idle', 'stretch', 'stretch-enabled', 'enforce-focus', 'show-on-startup',
                    'open-calendar', 'notify-mode', 'bedtime-enabled', 'bedtime-time', 'bedtime-snooze']) {
    $(id).addEventListener('change', markDirty);
  }
  $('bedtime-message').addEventListener('input', markDirty);
  $('btn-bedtime-preview').addEventListener('click', async () => {
    await save(); // 방금 고친 문구·시각이 그대로 보이도록 저장한 뒤 띄운다
    await window.api.bedtime.preview();
  });
  $('btn-notify-test').addEventListener('click', testNotify);
  $('btn-export-file').addEventListener('click', exportFile);
  $('btn-import-file').addEventListener('click', async () => applyImported(await window.api.settings.importFile()));
  $('btn-export-code').addEventListener('click', exportCode);
  $('btn-import-code').addEventListener('click', importCode);
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      save();
    }
  });
}

(async function init() {
  const data = await window.api.settings.get();
  settings = JSON.parse(JSON.stringify(data.settings));
  saved = JSON.parse(JSON.stringify(data.settings));
  bind();
  fillForm();
  renderLog(data.emergencyLog);
  const build = data.buildTime ? ` · 빌드 ${data.buildTime}` : '';
  $('path').textContent =
    `버전 ${data.version}${build}\n설정 저장 위치: ${await window.api.settings.dataPath()}`;
})();
