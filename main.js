'use strict';

const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const PANEL_W = 340;
const PANEL_H = 560;
const BANNER_H = 64;
const NOTE_W = 250;
const NOTE_H = 175;
const RETENTION_MS = 30 * 24 * 3600 * 1000; // 已完成任务保留 30 天

app.setAppUserModelId('com.yifan.deadlinelist');

// 兼容性：部分 Windows 显卡驱动下 GPU 进程会反复崩溃导致窗口无法渲染，
// 这里强制关闭 GPU 加速（悬浮便签和清单面板用纯 CSS + 软件光栅完全够用）
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('no-sandbox');

const dataFile = path.join(app.getPath('userData'), 'data.json');

let data = null;
let panelWin = null;
let tray = null;
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
    { panelX: null, panelY: null, collapsed: false, autoLaunch: true, demoAdded: false },
    d.settings || {}
  );
  // 清理超过保留期的已完成任务
  const now = Date.now();
  d.tasks = d.tasks.filter(t => {
    if (!t.done) return true;
    if (!t.completedAt) return true;
    return (now - t.completedAt) < RETENTION_MS;
  });
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
  panelWin.once('ready-to-show', () => panelWin.show());
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
  win.once('ready-to-show', () => win.show());
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
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: '⏰ deadline清单：' + node.label,
    body: task.name,
    silent: false
  });
  n.on('click', () => {
    if (panelWin && !panelWin.isDestroyed()) {
      panelWin.show();
      panelWin.focus();
    }
  });
  n.show();
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

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let img;
  try {
    img = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch (e) {
    img = nativeImage.createEmpty();
  }
  tray = new Tray(img);
  tray.setToolTip('deadline清单');
  const menu = Menu.buildFromTemplate([
    { label: '显示主面板', click: () => { if (panelWin) { panelWin.show(); panelWin.focus(); } } },
    { label: '开机自启', type: 'checkbox', checked: !!data.settings.autoLaunch, click: item => {
      data.settings.autoLaunch = item.checked;
      applyAutoLaunch();
      saveData();
    } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
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
    createTray();
    registerIpc();
    setInterval(checkReminders, 30 * 1000);
    setTimeout(checkReminders, 3000);
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
