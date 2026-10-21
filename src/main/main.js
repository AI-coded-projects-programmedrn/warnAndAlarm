'use strict';
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen,
  powerMonitor, Notification, nativeImage, dialog, clipboard,
} = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const store = require('./store');

const APP_ID = 'com.gurn.warnandalarm';
const ROOT = path.join(__dirname, '..', '..');
const asset = (f) => path.join(ROOT, 'src', 'assets', f);
const page = (...p) => path.join(ROOT, 'src', 'renderer', ...p);

let tray = null;
let checklistWin = null;      // 체크리스트 창 (차단 모드 / 일반 모드 겸용)
let coverWins = [];           // 보조 모니터를 덮는 창들
let settingsWin = null;
let calendarWin = null;
let bedtimeWin = null;
let bedtimeSnoozeTimer = null;
let bedtimeSnoozeStartedAt = null;   // '조금 뒤에 다시'를 누른 시각

let blocking = false;
let focusTimer = null;
let tickTimer = null;
let stretchTimer = null;
let nextStretchAt = null;
let isAway = false;
let quitting = false;

/* ------------------------------------------------------------------ */
/* 창                                                                  */
/* ------------------------------------------------------------------ */

function createChecklistWindow(blockingMode) {
  const primary = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    ...(blockingMode
      ? {
          x: primary.bounds.x,
          y: primary.bounds.y,
          width: primary.bounds.width,
          height: primary.bounds.height,
          frame: false,
          fullscreen: true,
          kiosk: true,
          closable: false,
          minimizable: false,
          maximizable: false,
          skipTaskbar: true,
          alwaysOnTop: true,
        }
      : {
          width: 720,
          height: 780,
          minWidth: 520,
          minHeight: 560,
          frame: false,
          transparent: false,
        }),
    show: false,
    backgroundColor: '#12151c',
    resizable: !blockingMode,
    icon: asset('icon.ico'),
    title: 'Warn & Alarm',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.loadFile(page('checklist', 'index.html'));
  win.once('ready-to-show', () => {
    win.show();
    if (blockingMode) {
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.focus();
    }
  });
  win.on('close', (e) => {
    if (blocking && !quitting) e.preventDefault();
  });
  win.on('closed', () => {
    checklistWin = null;
  });
  win.setMenu(null);
  return win;
}

function createCoverWindows() {
  destroyCoverWindows();
  const primaryId = screen.getPrimaryDisplay().id;
  for (const d of screen.getAllDisplays()) {
    if (d.id === primaryId) continue;
    const win = new BrowserWindow({
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: d.bounds.height,
      frame: false,
      fullscreen: true,
      kiosk: true,
      closable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#12151c',
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    win.loadFile(page('cover', 'index.html'));
    win.once('ready-to-show', () => {
      win.show();
      win.setAlwaysOnTop(true, 'screen-saver');
    });
    win.on('close', (e) => {
      if (blocking && !quitting) e.preventDefault();
    });
    win.setMenu(null);
    coverWins.push(win);
  }
}

function destroyCoverWindows() {
  for (const w of coverWins) {
    if (!w.isDestroyed()) w.destroy();
  }
  coverWins = [];
}

/** 차단 화면 켜기 */
function startBlocking() {
  if (blocking) {
    focusBlocker();
    return;
  }
  blocking = true;
  stopStretchTimer();
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
  closeCalendarWindow();
  closeBedtimeWindow();
  if (checklistWin && !checklistWin.isDestroyed()) checklistWin.destroy();
  checklistWin = createChecklistWindow(true);
  createCoverWindows();
  startFocusGuard();
  updateTray();
}

/** 차단 해제 (완료 또는 긴급 해제) */
function stopBlocking() {
  blocking = false;
  stopFocusGuard();
  if (!isAway) startStretchTimer(); // 화면이 열린 시점부터 스트레칭 주기를 센다
  destroyCoverWindows();
  if (checklistWin && !checklistWin.isDestroyed()) {
    checklistWin.setKiosk(false);
    checklistWin.setAlwaysOnTop(false);
    checklistWin.destroy();
  }
  checklistWin = null;
  updateTray();
}

/** 트레이에서 여는 일반(비차단) 체크리스트 창 */
function openChecklistWindow() {
  if (blocking) {
    focusBlocker();
    return;
  }
  if (checklistWin && !checklistWin.isDestroyed()) {
    checklistWin.show();
    checklistWin.focus();
    return;
  }
  checklistWin = createChecklistWindow(false);
}

function focusBlocker() {
  if (checklistWin && !checklistWin.isDestroyed()) {
    if (checklistWin.isMinimized()) checklistWin.restore();
    checklistWin.show();
    checklistWin.setAlwaysOnTop(true, 'screen-saver');
    checklistWin.focus();
  }
}

function startFocusGuard() {
  stopFocusGuard();
  focusTimer = setInterval(() => {
    if (!blocking || !store.settings().enforceFocus) return;
    if (!checklistWin || checklistWin.isDestroyed()) return;
    if (!checklistWin.isVisible() || checklistWin.isMinimized() || !checklistWin.isFocused()) {
      focusBlocker();
    }
    for (const w of coverWins) {
      if (!w.isDestroyed() && !w.isVisible()) w.show();
    }
  }, 900);
}

function stopFocusGuard() {
  if (focusTimer) clearInterval(focusTimer);
  focusTimer = null;
}

/* ------------------------------------------------------------------ */
/* 취침 준비 알림                                                       */
/* ------------------------------------------------------------------ */

function openBedtimeWindow() {
  if (bedtimeWin && !bedtimeWin.isDestroyed()) {
    // 이미 떠 있으면 그 사이 바뀐 문구·시각을 다시 읽게 한다
    bedtimeWin.webContents.send('bedtime:refresh');
    bedtimeWin.show();
    bedtimeWin.focus();
    return;
  }
  bedtimeWin = new BrowserWindow({
    width: 400,
    height: 520,
    resizable: false,
    frame: false,
    show: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: '#171a2e',
    icon: asset('icon.ico'),
    title: '취침 준비',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  bedtimeWin.loadFile(page('bedtime', 'index.html'));
  bedtimeWin.once('ready-to-show', () => {
    bedtimeWin.show();
    // 전체 화면 영상 위에서도 보이도록 차단 화면과 같은 레벨을 쓴다
    // (floating 레벨은 창 관리자가 곧 해제해 버리는 경우가 있다)
    bedtimeWin.setAlwaysOnTop(true, 'screen-saver');
    bedtimeWin.focus();
  });
  // 창 관리자가 '항상 위' 표시를 떨어뜨리는 경우가 있어, 포커스를 잃을 때 다시 지정한다
  bedtimeWin.on('blur', () => {
    if (bedtimeWin && !bedtimeWin.isDestroyed()) bedtimeWin.setAlwaysOnTop(true, 'screen-saver');
  });
  bedtimeWin.on('closed', () => { bedtimeWin = null; });
  bedtimeWin.setMenu(null);
}

function closeBedtimeWindow() {
  if (bedtimeWin && !bedtimeWin.isDestroyed()) bedtimeWin.destroy();
  bedtimeWin = null;
}

function clearBedtimeSnooze() {
  if (bedtimeSnoozeTimer) clearTimeout(bedtimeSnoozeTimer);
  bedtimeSnoozeTimer = null;
  bedtimeSnoozeStartedAt = null;
}

/**
 * 미루기를 예약한다. 기다리는 시간은 '미루기를 누른 시각'부터 센다.
 * 그래서 미룬 뒤에 간격을 줄이면, 줄인 기준으로 다시 계산된다.
 * 이미 그 시간이 지났으면 곧바로 띄운다.
 */
function scheduleBedtimeSnooze(minutes, startedAt = Date.now()) {
  if (bedtimeSnoozeTimer) clearTimeout(bedtimeSnoozeTimer);
  bedtimeSnoozeStartedAt = startedAt;
  const delay = Math.max(0, startedAt + minutes * 60 * 1000 - Date.now());
  bedtimeSnoozeTimer = setTimeout(showBedtime, delay);
  return delay;
}

/** 취침 준비 알림을 띄운다 (창 + 알림) */
function showBedtime() {
  clearBedtimeSnooze();
  openBedtimeWindow();
  notify('취침 준비 시간이에요', store.settings().bedtimeMessage);
}

function openSettings() {
  if (blocking) return;
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 780,
    height: 820,
    minWidth: 560,
    minHeight: 560,
    frame: false,
    show: false,
    backgroundColor: '#12151c',
    icon: asset('icon.ico'),
    title: '설정',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  settingsWin.loadFile(page('settings', 'index.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => { settingsWin = null; });
  settingsWin.setMenu(null);
}

/* ------------------------------------------------------------------ */
/* 일정 달력                                                            */
/* ------------------------------------------------------------------ */

function openCalendar() {
  if (blocking) return;
  if (calendarWin && !calendarWin.isDestroyed()) {
    calendarWin.show();
    calendarWin.focus();
    return;
  }
  calendarWin = new BrowserWindow({
    width: 760,
    height: 784,
    minWidth: 620,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: '#12151c',
    icon: asset('icon.ico'),
    title: '일정',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  calendarWin.loadFile(page('calendar', 'index.html'));
  calendarWin.once('ready-to-show', () => calendarWin.show());
  calendarWin.on('closed', () => { calendarWin = null; });
  calendarWin.setMenu(null);
}

function closeCalendarWindow() {
  if (calendarWin && !calendarWin.isDestroyed()) calendarWin.close();
  calendarWin = null;
}

/* ------------------------------------------------------------------ */
/* 트레이                                                              */
/* ------------------------------------------------------------------ */

function trayImage() {
  const img = nativeImage.createFromPath(asset('tray.png'));
  return img.isEmpty() ? nativeImage.createFromPath(asset('icon.png')) : img;
}

function statusLabel() {
  const s = store.get();
  const total = s.settings.tasks.length;
  const done = s.settings.tasks.filter((t) => s.state.checked[t.id]).length;
  if (blocking) return `차단 중 · ${done}/${total} 완료`;
  if (store.isComplete()) return `오늘 완료 · ${done}/${total}`;
  if (s.state.unlockedUntil && new Date(s.state.unlockedUntil) > new Date()) {
    const t = new Date(s.state.unlockedUntil);
    return `긴급 해제됨 (${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}까지)`;
  }
  return `미완료 · ${done}/${total}`;
}

function awayLabel() {
  if (isAway) return '자리 비움';
  if (nextStretchAt && !blocking) {
    const t = nextStretchAt;
    return `활동 중 · 다음 스트레칭 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  }
  return '활동 중';
}

let lastTrayLabel = '';

function updateTray() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: `Warn & Alarm — ${statusLabel()}`, enabled: false },
    { label: `상태: ${awayLabel()}`, enabled: false },
    { type: 'separator' },
    { label: blocking ? '체크리스트로 돌아가기' : '체크리스트 열기', click: () => (blocking ? focusBlocker() : openChecklistWindow()) },
    {
      label: blocking ? '일정 달력 (차단 중에는 열 수 없음)' : '일정 달력',
      enabled: !blocking,
      click: openCalendar,
    },
    {
      label: blocking ? '설정 (차단 중에는 열 수 없음)' : '설정',
      enabled: !blocking,
      click: openSettings,
    },
    { type: 'separator' },
    {
      label: blocking ? '종료 (차단 중에는 불가)' : '종료',
      enabled: !blocking,
      click: () => { quitting = true; app.quit(); },
    },
  ]);
  tray.setToolTip(`Warn & Alarm — ${statusLabel()}`);
  tray.setContextMenu(menu);
  lastTrayLabel = statusLabel() + awayLabel();
}

/** 표시할 내용이 바뀐 경우에만 트레이 메뉴를 다시 만든다 */
function refreshTrayIfChanged() {
  if (!tray) return;
  if (statusLabel() + awayLabel() !== lastTrayLabel) updateTray();
}

function createTray() {
  tray = new Tray(trayImage());
  tray.on('click', () => (blocking ? focusBlocker() : openChecklistWindow()));
  updateTray();
}

/* ------------------------------------------------------------------ */
/* 알림                                                                */
/* ------------------------------------------------------------------ */

/**
 * 알림을 띄운다.
 * Windows 에서 앱이 설치되지 않은 상태(포터블 등)로 실행되면 시스템 토스트가 조용히 무시되는 경우가 있다.
 * 그래서 Windows 기본값은 트레이 풍선이고, 설정에서 방식을 바꿀 수 있다.
 * @returns {string} 실제로 사용한 방식 ('balloon' | 'system' | 'none')
 */
function notify(title, body, modeOverride) {
  const mode = modeOverride || store.settings().notifyMode;
  const preferBalloon = mode === 'balloon' || (mode === 'auto' && process.platform === 'win32');

  const balloon = () => {
    if (!tray || tray.isDestroyed()) return false;
    try {
      tray.displayBalloon({ title, content: body, iconType: 'custom', icon: nativeImage.createFromPath(asset('icon.png')) });
      return true;
    } catch (err) {
      console.error('[notify] 트레이 풍선 실패:', err.message);
      return false;
    }
  };
  const system = () => {
    if (!Notification.isSupported()) return false;
    try {
      const n = new Notification({ title, body, icon: asset('icon.png'), silent: false });
      n.on('click', () => { if (!blocking) openChecklistWindow(); });
      n.show();
      return true;
    } catch (err) {
      console.error('[notify] 시스템 알림 실패:', err.message);
      return false;
    }
  };

  const order = preferBalloon ? [balloon, system] : [system, balloon];
  for (const fn of order) {
    if (fn()) return fn === balloon ? 'balloon' : 'system';
  }
  return 'none';
}

function startStretchTimer() {
  stopStretchTimer();
  const s = store.settings();
  if (!s.stretchEnabled) return;
  const ms = s.stretchIntervalMinutes * 60 * 1000;
  nextStretchAt = new Date(Date.now() + ms);
  stretchTimer = setInterval(() => {
    nextStretchAt = new Date(Date.now() + ms);
    if (blocking || isAway) return;
    notify('스트레칭 시간이에요', `${s.stretchIntervalMinutes}분 동안 앉아 있었어요. 목·어깨·허리를 한 번 풀어주세요.`);
    updateTray();
  }, ms);
}

function stopStretchTimer() {
  if (stretchTimer) clearInterval(stretchTimer);
  stretchTimer = null;
  nextStretchAt = null;
}

/* ------------------------------------------------------------------ */
/* 주기 작업: 날짜 리셋 + 자리 비움 감지                                */
/* ------------------------------------------------------------------ */

function tick() {
  const now = new Date();

  // 1) 리셋 시각이 지나면 오늘 상태를 초기화한다.
  //    쓰고 있는 도중에 갑자기 화면을 가로채지 않고, 알림만 보낸다.
  //    차단 화면은 앱을 시작할 때(보통 부팅할 때)만 뜬다.
  if (store.rolloverIfNeeded(now)) {
    broadcastChecklist();
    broadcastEvents();   // 날이 바뀌면 지난 일정이 목록에서 빠지도록
    updateTray();
    if (store.shouldBlock(now)) {
      notify('오늘 체크리스트가 새로 시작됐어요', '트레이 아이콘을 눌러 오늘 할 일을 확인하세요.');
    }
  }

  // 2) 긴급 해제 만료 확인
  const st = store.state();
  if (!blocking && st.unlockedUntil && new Date(st.unlockedUntil) <= now) {
    st.unlockedUntil = null;
    store.save();
    if (store.shouldBlock(now)) startBlocking();
    updateTray();
  }

  // 3) 취침 준비 시간 (차단 중이면 미뤘다가 화면이 열린 뒤에 띄운다)
  if (!blocking && store.bedtimeDue(now)) {
    store.markBedtimeShown();
    showBedtime();
  }

  // 4) 자리 비움 / 복귀
  const idleSec = powerMonitor.getSystemIdleTime();
  const threshold = store.settings().idleMinutes * 60;
  if (!isAway && idleSec >= threshold) {
    isAway = true;
    stopStretchTimer();
    updateTray();
  } else if (isAway && idleSec < threshold) {
    isAway = false;
    if (!blocking) startStretchTimer();
    updateTray();
  }
  refreshTrayIfChanged();
}

/* ------------------------------------------------------------------ */
/* 설정 내보내기 / 불러오기                                             */
/* ------------------------------------------------------------------ */

const CODE_PREFIX = 'WA1-';

function encodeSettingsCode() {
  const json = JSON.stringify(store.exportSettings());
  return CODE_PREFIX + zlib.deflateRawSync(Buffer.from(json, 'utf8'), { level: 9 }).toString('base64url');
}

function decodeSettingsCode(code) {
  const trimmed = String(code || '').trim().replace(/\s+/g, '');
  if (!trimmed.startsWith(CODE_PREFIX)) throw new Error('설정 코드 형식이 아닙니다. (WA1- 로 시작해야 합니다)');
  const raw = zlib.inflateRawSync(Buffer.from(trimmed.slice(CODE_PREFIX.length), 'base64url'));
  return JSON.parse(raw.toString('utf8'));
}

/** 불러오기 성공 후 화면과 트레이를 새로 맞춘다 */
function applyImported(result) {
  if (!result.ok) return result;
  updateTray();
  broadcastChecklist();
  if (!blocking && !isAway) startStretchTimer();
  return result;
}

/** 지금 돌고 있는 것이 어느 빌드인지 확인할 수 있게 한다 */
function buildTimeLabel() {
  try {
    const target = app.isPackaged ? path.join(process.resourcesPath, 'app.asar') : __filename;
    const t = fs.statSync(target).mtime;
    const p = (n) => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
  } catch (_) {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function checklistPayload() {
  const s = store.get();
  return {
    tasks: s.settings.tasks.map((t) => ({ ...t, done: !!s.state.checked[t.id] })),
    complete: store.isComplete(),
    blocking,
    dayKey: s.state.dayKey,
    resetLabel: `${String(s.settings.resetHour).padStart(2, '0')}:${String(s.settings.resetMinute).padStart(2, '0')}`,
    events: store.upcomingEvents(),   // 아직 지나지 않은 일정, 가까운 날짜순
  };
}

function broadcastChecklist() {
  const payload = checklistPayload();
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('checklist:update', payload);
  }
}

function eventsPayload() {
  return { events: store.listEvents(), todayKey: store.dayKeyFor(new Date(), store.settings()) };
}

/** 달력 창에 전체 일정을 다시 보낸다 */
function broadcastEvents() {
  const payload = eventsPayload();
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('events:changed', payload);
  }
}

function registerIpc() {
  ipcMain.handle('checklist:get', () => checklistPayload());

  ipcMain.handle('checklist:toggle', (_e, id, value) => {
    store.setChecked(id, !!value);
    updateTray();
    broadcastChecklist();
    return checklistPayload();
  });

  ipcMain.handle('checklist:finish', () => {
    if (!store.isComplete()) return { ok: false };
    const wasBlocking = blocking;
    if (blocking) stopBlocking();
    else if (checklistWin && !checklistWin.isDestroyed()) checklistWin.close();
    updateTray();
    if (wasBlocking) {
      notify('오늘 체크리스트 완료', '좋아요. 트레이에서 언제든 다시 열 수 있어요.');
      // 매일 할 일을 마치면 달력 창을 띄워 이후 일정을 보여준다
      if (store.settings().openCalendarAfterTasks) openCalendar();
    }
    return { ok: true };
  });

  ipcMain.handle('checklist:emergency', (_e, payload) => {
    const until = store.emergencyUnlock({
      reason: payload && payload.reason,
      minutes: payload && payload.minutes,
    });
    stopBlocking();
    updateTray();
    return { ok: true, until: until.toISOString() };
  });

  ipcMain.handle('window:minimize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && !blocking) w.minimize();
  });

  ipcMain.handle('window:close', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && !blocking) w.close();
  });

  ipcMain.handle('settings:open', () => {
    if (blocking) return { ok: false, reason: 'blocking' };
    openSettings();
    return { ok: true };
  });

  ipcMain.handle('settings:get', () => {
    const s = store.get();
    return {
      settings: s.settings,
      emergencyLog: s.state.emergencyLog,
      away: isAway,
      version: app.getVersion(),
      buildTime: buildTimeLabel(),
    };
  });

  ipcMain.handle('settings:save', (_e, patch) => {
    const prev = { ...store.settings() };
    const next = store.updateSettings(patch || {});

    // 취침 알림을 새로 설정하면, 미뤄 둔 예약은 새 설정을 따른다.
    // (15분 뒤로 미뤄 둔 상태에서 7분으로 바꾸면 7분 기준으로 다시 잡힌다)
    const timeChanged = prev.bedtimeHour !== next.bedtimeHour || prev.bedtimeMinute !== next.bedtimeMinute;
    if (!next.bedtimeEnabled) {
      clearBedtimeSnooze();
    } else if (timeChanged) {
      // 시각 자체를 바꿨으면 미뤘던 기록은 없애고 새 시각만 따른다
      clearBedtimeSnooze();
      store.clearBedtimeShown();
    } else if (bedtimeSnoozeTimer && prev.bedtimeSnoozeMinutes !== next.bedtimeSnoozeMinutes) {
      scheduleBedtimeSnooze(next.bedtimeSnoozeMinutes, bedtimeSnoozeStartedAt);
    }
    // 설정을 저장했다고 해서 곧바로 화면을 가리지는 않는다.
    // (새 할 일은 다음 리셋 시각이나 다음 실행부터 적용된다)
    if (!blocking && !isAway && stretchTimer) startStretchTimer();
    if (!next.stretchEnabled) stopStretchTimer();
    updateTray();
    broadcastChecklist();
    return next;
  });

  ipcMain.handle('bedtime:get', () => {
    const s = store.settings();
    return {
      message: s.bedtimeMessage,
      timeLabel: `${String(s.bedtimeHour).padStart(2, '0')}:${String(s.bedtimeMinute).padStart(2, '0')}`,
      snoozeMinutes: s.bedtimeSnoozeMinutes,
    };
  });

  ipcMain.handle('bedtime:dismiss', () => {
    clearBedtimeSnooze();
    closeBedtimeWindow();
    // 예정 시각이 이미 지난 뒤에 닫았다면 오늘 몫은 끝난 것으로 본다
    // (미리보기로 열어본 경우에는 아직 시각 전이므로 표시하지 않는다)
    const now = new Date();
    if (now >= store.bedtimeAt(now)) store.markBedtimeShown(now);
    return { ok: true };
  });

  ipcMain.handle('bedtime:snooze', () => {
    const minutes = store.settings().bedtimeSnoozeMinutes;
    closeBedtimeWindow();
    scheduleBedtimeSnooze(minutes);
    return { ok: true, minutes };
  });

  ipcMain.handle('bedtime:preview', () => {
    showBedtime();
    return { ok: true };
  });

  ipcMain.handle('notify:test', (_e, mode) => {
    // 아직 저장하지 않고 고른 방식으로도 바로 시험해 볼 수 있게 한다
    const valid = ['auto', 'system', 'balloon'].includes(mode) ? mode : undefined;
    const method = notify('스트레칭 시간이에요', '이렇게 표시됩니다. (알림 테스트)', valid);
    return { ok: method !== 'none', method };
  });

  ipcMain.handle('settings:exportFile', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const stamp = new Date().toISOString().slice(0, 10);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: '설정 내보내기',
      defaultPath: `warn-and-alarm-설정-${stamp}.json`,
      filters: [{ name: 'Warn & Alarm 설정', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(filePath, JSON.stringify(store.exportSettings(), null, 2), 'utf8');
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('settings:importFile', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '설정 불러오기',
      properties: ['openFile'],
      filters: [{ name: 'Warn & Alarm 설정', extensions: ['json'] }],
    });
    if (canceled || filePaths.length === 0) return { ok: false, canceled: true };
    try {
      const payload = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
      return applyImported(store.importSettings(payload));
    } catch (err) {
      return { ok: false, error: `파일을 읽지 못했습니다: ${err.message}` };
    }
  });

  ipcMain.handle('settings:exportCode', () => {
    try {
      const code = encodeSettingsCode();
      clipboard.writeText(code);
      return { ok: true, code };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('settings:importCode', (_e, code) => {
    try {
      return applyImported(store.importSettings(decodeSettingsCode(code)));
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('settings:reveal', () => {
    return path.join(app.getPath('userData'), 'warn-and-alarm.json');
  });

  /* ---------------- 일정 ---------------- */

  ipcMain.handle('events:list', () => eventsPayload());

  ipcMain.handle('events:add', (_e, payload) => {
    const r = store.addEvent(payload || {});
    if (r.ok) { broadcastChecklist(); broadcastEvents(); }
    return { ...r, ...eventsPayload() };
  });

  ipcMain.handle('events:update', (_e, id, patch) => {
    const r = store.updateEvent(id, patch || {});
    if (r.ok) { broadcastChecklist(); broadcastEvents(); }
    return { ...r, ...eventsPayload() };
  });

  ipcMain.handle('events:delete', (_e, id) => {
    store.deleteEvent(id);
    broadcastChecklist();
    broadcastEvents();
    return { ok: true, ...eventsPayload() };
  });

  ipcMain.handle('events:openCalendar', () => {
    if (blocking) return { ok: false, reason: 'blocking' };
    openCalendar();
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* 앱 부트스트랩                                                        */
/* ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // 이미 켜져 있는데 또 실행하면, 트레이 아이콘을 누른 것처럼 오늘 할 일 목록을 띄운다
  app.on('second-instance', () => {
    if (blocking) focusBlocker();
    else openChecklistWindow();
  });

  app.setAppUserModelId(APP_ID);
  app.whenReady().then(() => {
    store.load();
    store.rolloverIfNeeded(new Date());
    registerIpc();
    createTray();

    if (store.settings().showOnStartup && store.shouldBlock()) {
      startBlocking();
    } else {
      startStretchTimer(); // 가릴 게 없으면 실행 시점부터 스트레칭 주기를 센다
    }

    tickTimer = setInterval(tick, 5000);
    tick();

    powerMonitor.on('resume', () => {
      isAway = true; // 절전 복귀는 자리 비움 후 복귀로 취급
      tick();
    });
    powerMonitor.on('unlock-screen', () => tick());

    screen.on('display-added', () => { if (blocking) createCoverWindows(); });
    screen.on('display-removed', () => { if (blocking) createCoverWindows(); });
  });

  app.on('window-all-closed', () => {
    // 트레이 상주 앱이므로 종료하지 않는다
  });

  app.on('before-quit', () => {
    quitting = true;
    stopFocusGuard();
    stopStretchTimer();
    clearBedtimeSnooze();
    if (tickTimer) clearInterval(tickTimer);
  });
}
