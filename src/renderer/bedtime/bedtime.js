'use strict';

const $ = (id) => document.getElementById(id);

async function paint() {
  const info = await window.api.bedtime.get();
  $('time').textContent = `오늘 ${info.timeLabel}`;
  $('message').textContent = info.message;
  $('btn-snooze').textContent = `${info.snoozeMinutes}분 뒤에 다시 알려주기`;
}

async function init() {
  await paint();
  window.api.bedtime.onRefresh(paint);

  $('btn-ok').addEventListener('click', () => window.api.bedtime.dismiss());
  $('btn-close-win').addEventListener('click', () => window.api.bedtime.dismiss());
  $('btn-snooze').addEventListener('click', () => window.api.bedtime.snooze());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.api.bedtime.dismiss();
  });
}

init();
