'use strict';

const $ = (id) => document.getElementById(id);
const HOLD_MS = 5000;
const MIN_REASON = 20;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let current = null;
let code = '';

/* ---------- 렌더 ---------- */

function koDate(d = new Date()) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}

function render(data) {
  current = data;
  document.body.classList.toggle('blocking', !!data.blocking);
  $('btn-escape').hidden = !data.blocking;

  const total = data.tasks.length;
  const done = data.tasks.filter((t) => t.done).length;

  $('date').textContent = koDate();
  $('progress-count').textContent = `${done} / ${total}`;
  $('progress-fill').style.width = total ? `${(done / total) * 100}%` : '100%';

  if (data.complete) {
    $('headline').textContent = '오늘 할 일을 모두 마쳤어요';
    $('sub').textContent = data.blocking
      ? '아래 버튼을 눌러 화면을 열어주세요.'
      : `내일 ${data.resetLabel}에 다시 시작됩니다.`;
  } else {
    $('headline').textContent = '오늘 할 일을 마치고 시작해요';
    $('sub').textContent = data.blocking
      ? '모든 항목을 체크해야 화면이 열립니다.'
      : '남은 항목을 확인해 보세요.';
  }

  const list = $('tasks');
  list.innerHTML = '';
  if (total === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '할 일이 없습니다. 설정에서 항목을 추가해 주세요.';
    list.appendChild(li);
  }
  for (const t of data.tasks) {
    const li = document.createElement('li');
    li.className = 'task' + (t.done ? ' done' : '');
    li.dataset.id = t.id;

    const box = document.createElement('span');
    box.className = 'box';
    box.textContent = '✓';

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = t.text;

    li.append(box, label);
    li.addEventListener('click', () => toggle(t.id, !t.done));
    list.appendChild(li);
  }

  const finish = $('btn-finish');
  finish.hidden = !data.complete;
  finish.textContent = data.blocking ? '모두 완료 · 화면 열기' : '창 닫기';
  $('foot-hint').textContent = data.complete
    ? ''
    : `남은 항목 ${total - done}개 · 항목을 눌러 체크하세요`;
  $('foot-hint').hidden = data.complete;
}

async function toggle(id, value) {
  render(await window.api.checklist.toggle(id, value));
}

/* ---------- 긴급 해제 ---------- */

function randomCode() {
  let out = '';
  const buf = new Uint32Array(6);
  crypto.getRandomValues(buf);
  for (const n of buf) out += CODE_CHARS[n % CODE_CHARS.length];
  return out;
}

function showStep(n) {
  for (const el of document.querySelectorAll('.step')) {
    el.hidden = Number(el.dataset.step) !== n;
  }
}

function openEscape() {
  code = randomCode();
  $('code-box').textContent = code;
  $('code-input').value = '';
  $('reason-input').value = '';
  validateStep2();
  resetHold();
  showStep(1);
  $('overlay').hidden = false;
}

function closeEscape() {
  $('overlay').hidden = true;
  resetHold();
}

/* 길게 누르기 */
let holdStart = 0;
let holdRaf = 0;

function resetHold() {
  cancelAnimationFrame(holdRaf);
  holdRaf = 0;
  holdStart = 0;
  $('hold-fill').style.width = '0%';
  $('hold-label').textContent = `길게 눌러서 계속 (${HOLD_MS / 1000}초)`;
}

function holdFrame() {
  const elapsed = Date.now() - holdStart;
  const ratio = Math.min(1, elapsed / HOLD_MS);
  $('hold-fill').style.width = `${ratio * 100}%`;
  const left = Math.ceil((HOLD_MS - elapsed) / 1000);
  $('hold-label').textContent = ratio >= 1 ? '확인됨' : `계속 누르세요… ${left}`;
  if (ratio >= 1) {
    resetHold();
    showStep(2);
    $('code-input').focus();
    return;
  }
  holdRaf = requestAnimationFrame(holdFrame);
}

function validateStep2() {
  const reason = $('reason-input').value.trim();
  const typed = $('code-input').value.trim().toUpperCase();
  const codeOk = typed === code;
  const reasonOk = reason.length >= MIN_REASON;

  const rc = $('reason-count');
  rc.textContent = `${reason.length} / ${MIN_REASON}자`;
  rc.className = reasonOk ? 'ok' : '';

  const cs = $('code-state');
  cs.textContent = typed.length === 0 ? '' : codeOk ? '코드 일치' : '코드 불일치';
  cs.className = typed.length === 0 ? '' : codeOk ? 'ok' : 'bad';

  $('btn-step2-next').disabled = !(codeOk && reasonOk);
}

async function doUnlock(minutes) {
  await window.api.checklist.emergency({
    reason: $('reason-input').value.trim(),
    minutes: minutes === '' ? null : Number(minutes),
  });
  closeEscape();
}

/* ---------- 이벤트 ---------- */

function bind() {
  $('btn-settings').addEventListener('click', () => window.api.settings.open());
  $('btn-calendar-top').addEventListener('click', () => window.api.events.openCalendar());
  $('btn-min').addEventListener('click', () => window.api.window.minimize());
  $('btn-close-win').addEventListener('click', () => window.api.window.close());

  $('btn-finish').addEventListener('click', () => window.api.checklist.finish());

  $('btn-escape').addEventListener('click', openEscape);
  for (const id of ['btn-cancel-x', 'btn-cancel-1', 'btn-cancel-2', 'btn-cancel-3']) {
    $(id).addEventListener('click', closeEscape);
  }

  const hold = $('hold-btn');
  hold.addEventListener('pointerdown', (e) => {
    hold.setPointerCapture(e.pointerId);
    holdStart = Date.now();
    holdRaf = requestAnimationFrame(holdFrame);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
    hold.addEventListener(ev, resetHold);
  }

  $('code-input').addEventListener('input', validateStep2);
  $('reason-input').addEventListener('input', validateStep2);
  $('btn-step2-next').addEventListener('click', () => {
    if (!$('btn-step2-next').disabled) showStep(3);
  });
  for (const btn of document.querySelectorAll('.choice')) {
    btn.addEventListener('click', () => doUnlock(btn.dataset.minutes));
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('overlay').hidden) closeEscape();
    // 차단 중에는 새로고침/개발자도구 단축키를 막는다
    if (current && current.blocking) {
      if (e.key === 'F5' || (e.ctrlKey && ['r', 'R'].includes(e.key))) e.preventDefault();
      if (e.key === 'F12') e.preventDefault();
    }
  });

  window.api.checklist.onUpdate(render);
}

(async function init() {
  bind();
  render(await window.api.checklist.get());
})();
