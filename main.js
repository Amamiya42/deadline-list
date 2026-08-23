'use strict';

const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, screen, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const PANEL_W = 340;
const PANEL_H = 560;
const BANNER_H = 96; // 三行内容(标签+任务名+倒计时)约 70px + .panel 上下 padding 16px + 阴影余量；不足会裁掉底部圆角
const NOTE_W = 250;
const NOTE_H = 190;
const RETENTION_MS = 30 * 24 * 3600 * 1000; // 已完成任务保留 30 天

app.setAppUserModelId('com.yifan.deadlinelist');

// 兼容性：部分 Windows 显卡驱动下 GPU 进程会反复崩溃导致窗口无法渲染，
// 这里强制关闭 GPU 加速（悬浮便签和清单面板用纯 CSS + 软件光栅完全够用）
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('no-sandbox');
// 本机现象：WebAudio 报 running 但系统混音器里从未出现本应用的音频会话（彻底无声）。
// 疑似独立音频服务进程(AudioServiceOutOfProcess)在本机环境异常，禁用它让音频回主进程内渲染。
app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess');

const dataFile = path.join(app.getPath('userData'), 'data.json');
const notifyLog = path.join(app.getPath('userData'), 'notify.log');

function logNotify(msg) {
  try {
    fs.appendFileSync(notifyLog, '[' + new Date().toLocaleString('zh-CN') + '] ' + msg + '\n');
  } catch (e) { /* 日志失败不影响主流程 */ }
}

// ---------- 提示音（自管理） ----------
// Electron 的 Windows Toast 即使 silent:false 也经常不发声；外挂进程播放（SoundPlayer）
// 又受「音量合成器把该应用静音」「默认输出设备不在线」等影响，且难以观测。
// 最终方案：在应用自己的窗口里用 WebAudio 合成双音提示——
// 走 Chromium 音频栈 → 系统当前默认输出设备（插耳机自动跟随），无外部依赖、可写日志。

const BEEP_SCRIPT = `
(async () => {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const st0 = ctx.state;
    if (st0 !== 'running') {
      try { await ctx.resume(); } catch (e) {}
    }
    const st1 = ctx.state;
    if (st1 !== 'running') {
      try { await ctx.close(); } catch (e) {}
      // 挂起状态下调度音符会"成功"但一声不响，必须显式区分
      return 'beep-blocked: initial=' + st0 + ', after-resume=' + st1;
    }
    const t0 = ctx.currentTime + 0.05;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02);
    gain.gain.setValueAtTime(0.4, t0 + 0.36);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.46);
    gain.connect(ctx.destination);
    [[880, 0.00, 0.20], [1174.7, 0.18, 0.28]].forEach(([freq, dt, dur]) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(t0 + dt);
      osc.stop(t0 + dt + dur);
    });
    return 'beep-ok state=' + st1;
  } catch (e) {
    return 'beep-error: ' + (e && e.message);
  }
})()`;

function playNotifySound() {
  const targets = [];
  if (panelWin && !panelWin.isDestroyed()) targets.push(panelWin);
  for (const [, w] of noteWins) if (!w.isDestroyed()) targets.push(w);
  const win = targets[0];
  if (!win) { logNotify('[提示音] 失败：当前没有任何可用窗口'); return; }
  win.webContents.executeJavaScript(BEEP_SCRIPT, true)
    .then(r => logNotify('[提示音] ' + r))
    .catch(e => logNotify('[提示音] 执行异常：' + (e && e.message)));
}

// ---------- 通知快捷方式（关键修复） ----------
// Windows 只为「带 AUMID 的开始菜单快捷方式」展示 Toast。
// 未打包的 Electron 应用裸跑 electron.exe 时没有这个快捷方式，
// 系统会把 Toast 静默丢弃（不报错、不显示、不进通知中心）。
// 这里在启动时自动补建一个带 AUMID 的快捷方式，一次到位。
function ensureNotificationShortcut() {
  try {
    const startMenu = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const lnk = path.join(startMenu, 'deadline清单.lnk');
    // 已存在且指向同一 electron.exe 就不再重写（避免每次启动都刷新）
    let need = true;
    try {
      const cur = shell.readShortcutLink(lnk);
      if (cur && cur.target === process.execPath) need = false;
    } catch (e) { /* 不存在或读取失败 → 需要创建 */ }
    if (need) {
      shell.writeShortcutLink(lnk, 'replace', {
        target: process.execPath,
        args: '"' + __dirname + '"',
        appUserModelId: 'com.yifan.deadlinelist',
        description: 'deadline清单 桌面提醒'
      });
      logNotify('已创建开始菜单快捷方式（AUMID=com.yifan.deadlinelist）→ ' + lnk);
    }
  } catch (e) {
    logNotify('快捷方式创建失败: ' + (e && e.message));
  }
}

let data = null;
let panelWin = null;
let tray = null;
let trayIcon = null;
let quitting = false;
const noteWins = new Map(); // taskId -> BrowserWindow

// ---------- 数据 ----------

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getTask(id) {
  return data.tasks.find(t => t.id === id) || null;
}

function snapshot() {
  return JSON.parse(JSON.stringify(data));
}

function loadData() {
  let d = null;
  try {
    d = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch (e) {
    d = null;
  }
  if (!d || typeof d !== 'object') d = {};
  if (!Array.isArray(d.tasks)) d.tasks = [];
  d.settings = Object.assign(
    { panelX: null, panelY: null, collapsed: false, autoLaunch: true, demoAdded: false, focusMode: false },
    d.settings || {}
  );
  // 清理超过保留期的已完成任务
  const now = Date.now();
  d.tasks = d.tasks.filter(t => {
    if (!t.done) return true;
    if (!t.completedAt) return true;
    return (now - t.completedAt) < RETENTION_MS;
  });
  // v1.1 子任务：旧数据缺 parentId/expanded，自动补默认值以保持向后兼容
  for (const t of d.tasks) {
    if (t.parentId === undefined) t.parentId = null;
    if (t.expanded === undefined) t.expanded = true;
  }
  return d;
}

function saveData() {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('保存数据失败:', e);
  }
}

// ---------- 窗口 ----------

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function createPanel() {
  const wa = screen.getPrimaryDisplay().workArea;
  const h = data.settings.collapsed ? BANNER_H : PANEL_H;
  let x = data.settings.panelX;
  let y = data.settings.panelY;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    x = wa.x + wa.width - PANEL_W - 24;
    y = wa.y + 24;
  }
  x = clamp(x, wa.x, wa.x + wa.width - PANEL_W);
  y = clamp(y, wa.y, wa.y + wa.height - BANNER_H);

  panelWin = new BrowserWindow({
    width: PANEL_W,
    height: h,
    x: x,
    y: y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  panelWin.setAlwaysOnTop(true, 'screen-saver');
  panelWin.loadFile(path.join(__dirname, 'renderer', 'panel.html'));
  // 专注模式下启动时不显示面板
  panelWin.once('ready-to-show', () => {
    if (!data.settings.focusMode) panelWin.show();
  });
  panelWin.on('moved', savePanelPos);
  panelWin.on('close', e => {
    if (!quitting) {
      e.preventDefault();
      panelWin.hide();
    }
  });
  panelWin.on('closed', () => { panelWin = null; });
}

function savePanelPos() {
  if (!panelWin || panelWin.isDestroyed()) return;
  const pos = panelWin.getPosition();
  data.settings.panelX = pos[0];
  data.settings.panelY = pos[1];
  saveData();
}

function createNoteWin(task) {
  if (noteWins.has(task.id)) {
    const w = noteWins.get(task.id);
    if (!w.isDestroyed()) w.focus();
    return;
  }
  const wa = screen.getPrimaryDisplay().workArea;
  let x = task.note && Number.isFinite(task.note.x) ? task.note.x : wa.x + 40 + (noteWins.size % 6) * 36;
  let y = task.note && Number.isFinite(task.note.y) ? task.note.y : wa.y + 60 + (noteWins.size % 6) * 26;
  x = clamp(x, wa.x, wa.x + wa.width - NOTE_W);
  y = clamp(y, wa.y, wa.y + wa.height - NOTE_H);

  const win = new BrowserWindow({
    width: NOTE_W,
    height: NOTE_H,
    x: x,
    y: y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'renderer', 'note.html'), { query: { id: task.id } });
  win.once('ready-to-show', () => {
    if (!data.settings.focusMode) win.show();
  });
  win.on('moved', () => {
    const t = getTask(task.id);
    if (t) {
      const p = win.getPosition();
      t.note = t.note || {};
      t.note.x = p[0];
      t.note.y = p[1];
      saveData();
    }
  });
  win.on('closed', () => {
    noteWins.delete(task.id);
    // Alt+F4 等意外关闭：任务仍标记为已撕下但没有窗口，把它收回主面板
    const t = getTask(task.id);
    if (t && t.note && t.note.detached && !t.done) {
      t.note.detached = false;
      saveData();
      broadcast();
    }
  });
  noteWins.set(task.id, win);
}

function closeNoteWin(id) {
  const w = noteWins.get(id);
  if (w && !w.isDestroyed()) w.destroy();
  noteWins.delete(id);
}

function broadcast() {
  if (!data) return;
  const snap = snapshot();
  if (panelWin && !panelWin.isDestroyed()) {
    panelWin.webContents.send('data-changed', snap);
  }
  for (const [id, win] of noteWins) {
    if (win.isDestroyed()) {
      noteWins.delete(id);
      continue;
    }
    const t = getTask(id);
    if (!t || t.done || !t.note || !t.note.detached) {
      win.destroy();
      noteWins.delete(id);
      continue;
    }
    win.webContents.send('data-changed', snap);
  }
}

// ---------- 提醒 ----------

const NODES = [
  { key: 'd3', lo: 24 * 3600e3, hi: 3 * 86400e3, label: '还剩 3 天' },
  { key: 'h24', lo: 3600e3, hi: 24 * 3600e3, label: '还剩 24 小时' },
  { key: 'h1', lo: 0, hi: 3600e3, label: '还剩 1 小时' },
  { key: 't0', lo: -Infinity, hi: 0, label: '已到截止时间' }
];

function fireNotification(task, node) {
  const title = '⏰ deadline清单：' + node.label;
  const body = task.name;
  showBalloon(title, body);
}

// Windows 通知：Notification API 为主，托盘气泡兜底。
// 前提：必须存在「带 AUMID 的开始菜单快捷方式」（见 ensureNotificationShortcut），
// 否则 Windows 会把 Toast 静默丢弃——这正是 v1.0.2 通知消失的根因。
function showTrayBalloon(title, body) {
  if (!tray || tray.isDestroyed()) return;
  const opts = { title: title, content: body, noSound: true }; // 声音走 playNotifySound()
  if (trayIcon && !trayIcon.isEmpty()) opts.icon = trayIcon;
  tray.displayBalloon(opts);
  tray.once('balloon-click', () => {
    if (panelWin && !panelWin.isDestroyed()) {
      panelWin.show();
      panelWin.focus();
    }
  });
  logNotify('[托盘气泡] 已发送：' + title);
}

function showBalloon(title, body) {
  playNotifySound(); // 声音由我们自己保证，Toast/气泡一律静音，避免双重响或不响
  let toastSent = false;
  if (Notification.isSupported()) {
    try {
      const n = new Notification({
        title: title,
        body: body,
        silent: true, // 声音走 playNotifySound()，这里静音
        timeoutType: 'default'
      });
      n.on('click', () => {
        if (panelWin && !panelWin.isDestroyed()) {
          panelWin.show();
          panelWin.focus();
        }
      });
      // 关键：failed 是异步事件——n.show() 本身不抛错，Toast 被系统静默丢弃时只会走到这里。
      // 之前在这里只记日志就结束，导致 Toast 失败后连托盘气泡兜底都没有（v1.0.2 通知消失的残留根因）。
      n.on('failed', err => {
        logNotify('Notification API 报告 failed，转托盘气泡：' + title + (err ? ' (' + err + ')' : ''));
        showTrayBalloon(title, body);
      });
      n.show();
      toastSent = true;
      logNotify('[Notification API] 已发送：' + title);
    } catch (e) {
      logNotify('Notification API 同步异常，转托盘气泡：' + (e && e.message));
    }
  } else {
    logNotify('Notification API 不可用，转托盘气泡');
  }
  if (!toastSent) showTrayBalloon(title, body);
}

function sendTestNotification() {
  showBalloon('✅ deadline清单：测试通知', '看到这条并听到提示音，说明通知链路正常。');
}

// 诊断用：Explorer 负责渲染的托盘气泡，声音由系统播放（不经过 Chromium 音频栈）。
// 若这条能响而 WebAudio 不响，说明断点确在 Chromium 音频服务一侧。
function sendTestBalloonWithSound() {
  if (!tray || tray.isDestroyed()) return;
  try {
    tray.displayBalloon({ title: '🔔 气泡声音测试', content: '这条应带系统默认提示音。' });
    logNotify('[气泡] 已发送（未禁声）');
  } catch (e) {
    logNotify('[气泡] 发送失败：' + (e && e.message));
  }
}

function checkReminders() {
  if (!data) return;
  const now = Date.now();
  let changed = false;
  for (const t of data.tasks) {
    if (t.done) continue;
    const diff = t.deadline - now;
    t.notified = t.notified || {};
    for (const node of NODES) {
      if (diff <= node.hi && diff > node.lo && !t.notified[node.key]) {
        t.notified[node.key] = true;
        changed = true;
        fireNotification(t, node);
      }
    }
  }
  if (changed) saveData();
}

// ---------- 托盘与自启 ----------

function applyAutoLaunch() {
  try {
    app.setLoginItemSettings({ openAtLogin: !!data.settings.autoLaunch });
  } catch (e) {
    console.error('设置开机自启失败:', e);
  }
}

// ---------- 专注模式（玩游戏/演示时隐藏全部悬浮窗，Ctrl+Alt+H 切换） ----------

function applyFocusMode() {
  const on = !!data.settings.focusMode;
  if (panelWin && !panelWin.isDestroyed()) {
    if (on) panelWin.hide();
    else panelWin.show();
  }
  for (const [id, win] of noteWins) {
    if (win.isDestroyed()) { noteWins.delete(id); continue; }
    if (on) {
      win.hide();
    } else {
      const t = getTask(id);
      if (t && !t.done && t.note && t.note.detached) win.show();
      else { win.destroy(); noteWins.delete(id); }
    }
  }
  if (!on) {
    // 恢复期间补建缺失的便签窗口（位置由 task.note.x/y 记忆）
    for (const t of data.tasks) {
      if (!t.done && t.note && t.note.detached && !noteWins.has(t.id)) createNoteWin(t);
    }
  }
}

function toggleFocusMode() {
  data.settings.focusMode = !data.settings.focusMode;
  saveData();
  applyFocusMode();
  if (tray && !tray.isDestroyed()) buildTrayMenu();
}

function buildTrayMenu() {
  const menu = Menu.buildFromTemplate([
    { label: '显示主面板', click: () => { if (panelWin) { panelWin.show(); panelWin.focus(); } } },
    { label: '发送测试通知', click: () => sendTestNotification() },
    { label: '测试气泡(含系统音)', click: () => sendTestBalloonWithSound() },
    { label: '专注模式：隐藏全部悬浮窗 (Ctrl+Alt+H)', type: 'checkbox', checked: !!data.settings.focusMode, click: item => {
      data.settings.focusMode = item.checked;
      saveData();
      applyFocusMode();
    } },
    { label: '开机自启', type: 'checkbox', checked: !!data.settings.autoLaunch, click: item => {
      data.settings.autoLaunch = item.checked;
      applyAutoLaunch();
      saveData();
    } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let img;
  try {
    img = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch (e) {
    img = nativeImage.createEmpty();
  }
  trayIcon = img;
  tray = new Tray(img);
  tray.setToolTip('deadline清单');
  buildTrayMenu();
  tray.on('click', () => {
    if (panelWin) { panelWin.show(); panelWin.focus(); }
  });
}

// ---------- IPC ----------

function registerIpc() {
  ipcMain.handle('get-data', () => snapshot());

  ipcMain.handle('add-task', (_e, t) => {
    if (!t || typeof t.name !== 'string' || !t.name.trim() || !Number.isFinite(t.deadline)) {
      return { ok: false, error: '参数不完整' };
    }
    data.tasks.push({
      id: uid(),
      name: t.name.trim(),
      deadline: t.deadline,
      notes: typeof t.notes === 'string' ? t.notes : '',
      done: false,
      completedAt: null,
      notified: {},
      note: null
    });
    saveData();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('update-task', (_e, id, patch) => {
    const t = getTask(id);
    if (!t) return { ok: false, error: '任务不存在' };
    if (patch && typeof patch.name === 'string' && patch.name.trim()) t.name = patch.name.trim();
    if (patch && typeof patch.notes === 'string') t.notes = patch.notes;
    if (patch && Number.isFinite(patch.deadline) && patch.deadline !== t.deadline) {
      t.deadline = patch.deadline;
      t.notified = {}; // 截止时间变更后重置提醒节点
    }
    saveData();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('delete-task', (_e, id) => {
    const i = data.tasks.findIndex(t => t.id === id);
    if (i < 0) return { ok: false, error: '任务不存在' };
    data.tasks.splice(i, 1);
    closeNoteWin(id);
    saveData();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('complete-task', (_e, id) => {
    const t = getTask(id);
    if (!t) return { ok: false, error: '任务不存在' };
    t.done = true;
    t.completedAt = Date.now();
    if (t.note) t.note.detached = false;
    closeNoteWin(id);
    saveData();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('uncomplete-task', (_e, id) => {
    const t = getTask(id);
    if (!t) return { ok: false, error: '任务不存在' };
    t.done = false;
    t.completedAt = null;
    saveData();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('toggle-note', (_e, id) => {
    const t = getTask(id);
    if (!t) return { ok: false, error: '任务不存在' };
    t.note = t.note || {};
    t.note.detached = !t.note.detached;
    if (t.note.detached) {
      createNoteWin(t);
    } else {
      closeNoteWin(id);
    }
    saveData();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('set-collapsed', (_e, collapsed) => {
    data.settings.collapsed = !!collapsed;
    if (panelWin && !panelWin.isDestroyed()) {
      const pos = panelWin.getPosition();
      const wa = screen.getPrimaryDisplay().workArea;
      const h = data.settings.collapsed ? BANNER_H : PANEL_H;
      const y = clamp(pos[1], wa.y, wa.y + wa.height - h);
      panelWin.setBounds({ x: pos[0], y: y, width: PANEL_W, height: h });
      panelWin.webContents.send('view-mode', data.settings.collapsed);
    }
    saveData();
    return { ok: true };
  });

  ipcMain.handle('hide-panel', () => {
    if (panelWin) panelWin.hide();
    return { ok: true };
  });

  // 横幅高度自适应：渲染层量完实际内容后请求调整（任务名折行时窗口跟着变高）
  ipcMain.handle('set-banner-height', (_e, h) => {
    logNotify('[横幅高度] 收到请求 h=' + h + ', collapsed=' + data.settings.collapsed +
      ', win=' + (panelWin && !panelWin.isDestroyed() ? 'ok' : 'null'));
    if (!data.settings.collapsed) return { ok: false }; // 展开态不允许改
    if (!panelWin || panelWin.isDestroyed() || !Number.isFinite(h)) return { ok: false };
    const b = panelWin.getBounds();
    const wa = screen.getPrimaryDisplay().workArea;
    const height = Math.max(BANNER_H, Math.min(Math.round(h), wa.height));
    const y = clamp(b.y, wa.y, wa.y + wa.height - height); // 变高后仍保证完整在屏幕内
    panelWin.setBounds({ x: b.x, y: y, width: b.width, height: height });
    logNotify('[横幅高度] 应用 height=' + height + ' (请求=' + Math.round(h) + ', 工作区=' + wa.height + '), y=' + y);
    return { ok: true };
  });
}

// ---------- 生命周期 ----------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (panelWin) {
      panelWin.show();
      panelWin.focus();
    }
  });

  app.whenReady().then(() => {
    data = loadData();

    // 通知链路修复：补建带 AUMID 的开始菜单快捷方式（Windows 显示 Toast 的硬性前提）
    ensureNotificationShortcut();

    // 首次运行加一条演示任务，让紧迫感配色立刻可见
    if (!data.settings.demoAdded && data.tasks.length === 0) {
      data.settings.demoAdded = true;
      data.tasks.push({
        id: uid(),
        name: '双击我编辑，点📌撕成便签，✔完成',
        deadline: Date.now() + 2.5 * 86400e3,
        notes: '这是一条演示任务，可以直接删除',
        done: false,
        completedAt: null,
        notified: {},
        note: null
      });
      saveData();
    }

    applyAutoLaunch();
    createPanel();
    for (const t of data.tasks) {
      if (!t.done && t.note && t.note.detached) createNoteWin(t);
    }
    if (data.settings.focusMode) applyFocusMode();
    createTray();
    registerIpc();

    // 全局快捷键：Ctrl+Alt+H 一键隐藏/恢复全部悬浮窗（游戏时用）
    try {
      globalShortcut.register('Control+Alt+H', () => toggleFocusMode());
    } catch (e) {
      console.error('注册全局快捷键失败:', e);
    }

    setInterval(checkReminders, 30 * 1000);
    setTimeout(checkReminders, 3000);

    // 调试入口：electron . --test-notify 启动 5 秒后自动发一条测试通知
    if (process.argv.includes('--test-notify')) {
      setTimeout(sendTestNotification, 5000);
    }
  });

  app.on('will-quit', () => {
    try { globalShortcut.unregisterAll(); } catch (e) { /* 忽略 */ }
  });

  app.on('before-quit', () => {
    quitting = true;
    savePanelPos();
    saveData();
  });

  app.on('window-all-closed', () => {
    // 托盘常驻，不退出
  });
}
