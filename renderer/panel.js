'use strict';

let data = null;
let editId = null;
let undoTimer = null;
let collapsed = false;
const BANNER_MIN_H = 96; // 与 main.js 的 BANNER_H 保持一致（横幅最小窗口高度）

const $ = id => document.getElementById(id);

// ---------- 初始化 ----------

async function init() {
  data = await window.api.getData();
  collapsed = !!(data.settings && data.settings.collapsed);
  applyViewMode();

  bindEvents();
  render();
  setInterval(tick, 1000);
  setInterval(render, 60000); // 定期全量重排，纠正跨档位后的顺序

  window.api.onDataChanged(d => {
    data = d;
    if (editId && !data.tasks.find(t => t.id === editId)) resetForm();
    else if (editId) renderSubtasks(editId);
    render();
  });
  window.api.onViewMode(c => {
    collapsed = !!c;
    applyViewMode();
  });
}

function applyViewMode() {
  document.body.classList.toggle('collapsed', collapsed);
  if (collapsed) updateBanner();
}

function bindEvents() {
  $('btnCollapse').addEventListener('click', () => window.api.setCollapsed(true));
  $('btnHide').addEventListener('click', () => window.api.hidePanel());
  // 注意：横幅本体是拖动区域（-webkit-app-region: drag），拖动区域收不到 click 事件，
  // 所以展开必须走这个独立按钮（no-drag）
  $('bannerExpand').addEventListener('click', () => window.api.setCollapsed(false));
  $('banner').addEventListener('click', e => {
    if (e.target.closest('.banner-hide')) return;
    window.api.setCollapsed(false);
  });
  $('bannerHide').addEventListener('click', () => window.api.hidePanel());

  $('btnSubmit').addEventListener('click', submitTask);
  $('btnCancel').addEventListener('click', resetForm);
  $('inpName').addEventListener('keydown', e => { if (e.key === 'Enter') submitTask(); });
  $('inpName').addEventListener('input', updateNameCounter);

  $('doneToggle').addEventListener('click', () => {
    const sec = $('doneSection');
    const open = sec.classList.toggle('open');
    $('doneList').style.display = open ? '' : 'none';
  });

  $('btnUndo').addEventListener('click', async () => {
    if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; }
    const id = $('btnUndo').dataset.id;
    $('undoBar').style.display = 'none';
    if (id) await window.api.uncompleteTask(id);
  });

  // 全局点击关闭右键菜单；点击遮罩关闭子任务弹窗
  document.addEventListener('click', e => {
    $('ctxMenu').style.display = 'none';
    if (e.target.id === 'subtaskModal') closeSubtaskModal();
  });
  $('ctxMenu').addEventListener('click', e => {
    e.stopPropagation();
    const action = e.target.dataset.action;
    const t = $('ctxMenu').dataset.targetId;
    if (!t) return;
    handleCtxAction(action, t);
    $('ctxMenu').style.display = 'none';
  });

  // 子任务弹窗
  $('btnSubtaskOk').addEventListener('click', confirmSubtaskModal);
  $('btnSubtaskCancel').addEventListener('click', closeSubtaskModal);
  $('subtaskName').addEventListener('keydown', e => { if (e.key === 'Enter') confirmSubtaskModal(); });

  // 默认截止时间：明天此时
  const d = new Date(Date.now() + 86400000);
  const p = n => String(n).padStart(2, '0');
  $('inpDeadline').value = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// ---------- 添加 / 编辑 ----------

function resetForm() {
  editId = null;
  $('inpName').value = '';
  $('inpNotes').value = '';
  $('btnSubmit').textContent = '添加任务';
  $('btnCancel').style.display = 'none';
  updateNameCounter();
}

function updateNameCounter() {
  const len = $('inpName').value.length;
  const remaining = 500 - len;
  $('nameCounter').textContent = '剩余 ' + remaining + ' 字';
  $('nameCounter').classList.toggle('limit', remaining <= 0);
}

async function submitTask() {
  const name = $('inpName').value.trim();
  const deadlineStr = $('inpDeadline').value;
  const notes = $('inpNotes').value.trim();
  if (!name) { alert('请填写任务名'); return; }
  if (!deadlineStr) { alert('请选择截止时间'); return; }
  const deadline = new Date(deadlineStr).getTime();
  if (!Number.isFinite(deadline)) { alert('截止时间格式不正确'); return; }

  if (editId) {
    await window.api.updateTask(editId, { name: name, deadline: deadline, notes: notes });
    resetForm();
  } else {
    const r = await window.api.addTask({ name: name, deadline: deadline, notes: notes });
    if (r && r.ok) {
      $('inpName').value = '';
      $('inpNotes').value = '';
    }
  }
}

function startEdit(t) {
  editId = t.id;
  $('inpName').value = t.name;
  $('inpNotes').value = t.notes || '';
  updateNameCounter();
  const d = new Date(t.deadline);
  const p = n => String(n).padStart(2, '0');
  $('inpDeadline').value = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  $('btnSubmit').textContent = '保存修改';
  $('btnCancel').style.display = '';
  renderSubtasks(t.id);
  $('btnAddSubtask').onclick = () => startAddSubtask(t);
  $('inpName').focus();
}

// ---------- 渲染 ----------

function render() {
  const undoneRoots = data.tasks.filter(t => !t.done && t.parentId === null).sort((a, b) => a.deadline - b.deadline);
  const done = data.tasks.filter(t => t.done).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  const list = $('taskList');
  list.innerHTML = '';
  if (undoneRoots.length === 0 && data.tasks.filter(t => !t.done).length === 0) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = '🎉 没有待办任务\n点上方添加一个吧';
    div.style.whiteSpace = 'pre-line';
    list.appendChild(div);
  } else {
    for (const t of undoneRoots) appendTaskTree(list, t, 0);
  }

  const sec = $('doneSection');
  sec.style.display = done.length ? '' : 'none';
  $('doneCount').textContent = done.length;
  const doneList = $('doneList');
  doneList.innerHTML = '';
  for (const t of done) doneList.appendChild(doneCard(t));

  tick();
}

function appendTaskTree(container, t, depth) {
  container.appendChild(taskCard(t, depth));
  if (!t.expanded) return;
  const children = getChildren(data.tasks, t.id).filter(c => !c.done).sort((a, b) => a.deadline - b.deadline);
  for (const c of children) appendTaskTree(container, c, depth + 1);
}

function taskCard(t, depth = 0) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.id = t.id;
  card.style.marginLeft = (depth * 18) + 'px';

  // 展开/折叠按钮（仅非叶子节点）
  const children = getChildren(data.tasks, t.id).filter(c => !c.done);
  if (children.length > 0) {
    const expand = document.createElement('button');
    expand.className = 'icon-btn tree-toggle';
    expand.textContent = t.expanded ? '▼' : '▶';
    expand.title = t.expanded ? '折叠子任务' : '展开子任务';
    expand.addEventListener('click', () => window.api.toggleExpanded(t.id));
    card.appendChild(expand);
  }

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'card-check';
  check.title = '标记完成';
  check.addEventListener('change', async () => {
    if (check.checked) {
      await window.api.completeTask(t.id);
      showUndo(t);
    }
  });

  const main = document.createElement('div');
  main.className = 'card-main';
  main.title = t.notes || t.name;
  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = t.name;
  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const cd = document.createElement('span');
  cd.className = 'card-cd';
  cd.textContent = fmtRemaining(t.deadline - Date.now()) + exclamations(t.deadline - Date.now());
  const due = document.createElement('span');
  due.className = 'card-due';
  due.textContent = '截止 ' + fmtDeadline(t.deadline);
  meta.appendChild(cd);
  meta.appendChild(due);
  main.appendChild(name);
  main.appendChild(meta);
  main.addEventListener('dblclick', () => startEdit(t));

  const acts = document.createElement('div');
  acts.className = 'card-acts';

  const pin = document.createElement('button');
  pin.className = 'icon-btn';
  pin.title = (t.note && t.note.detached) ? '收回便签' : '撕成桌面便签';
  pin.textContent = (t.note && t.note.detached) ? '📌' : '📍';
  pin.addEventListener('click', () => window.api.toggleNote(t.id));

  const addChild = document.createElement('button');
  addChild.className = 'icon-btn';
  addChild.title = '添加子任务';
  addChild.textContent = '+';
  addChild.addEventListener('click', () => startAddSubtask(t));

  const del = document.createElement('button');
  del.className = 'icon-btn';
  del.title = '删除任务';
  del.textContent = '🗑';
  del.addEventListener('click', async () => {
    if (confirm('删除任务「' + t.name + '」？\n此操作不可恢复。')) {
      await window.api.deleteTask(t.id);
    }
  });

  acts.appendChild(pin);
  acts.appendChild(addChild);
  acts.appendChild(del);

  card.appendChild(check);
  card.appendChild(main);
  card.appendChild(acts);

  // 右键菜单
  card.addEventListener('contextmenu', e => {
    e.preventDefault();
    const menu = $('ctxMenu');
    menu.dataset.targetId = t.id;
    menu.style.display = 'flex';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
  });

  return card;
}

function doneCard(t) {
  const card = document.createElement('div');
  card.className = 'done-card';
  const name = document.createElement('span');
  name.className = 'done-name';
  name.textContent = t.name;
  const when = document.createElement('span');
  when.className = 'done-when';
  when.textContent = fmtDeadline(t.completedAt || Date.now()) + ' 完成';
  const restore = document.createElement('button');
  restore.className = 'btn small';
  restore.textContent = '恢复';
  restore.title = '恢复为未完成';
  restore.addEventListener('click', () => window.api.uncompleteTask(t.id));
  card.appendChild(name);
  card.appendChild(when);
  card.appendChild(restore);
  return card;
}

let pendingSubtaskParent = null;

function openSubtaskModal(parentTask) {
  pendingSubtaskParent = parentTask;
  const d = new Date(Date.now() + 86400000);
  const p = n => String(n).padStart(2, '0');
  $('subtaskDeadline').value = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  $('subtaskName').value = '';
  $('subtaskModal').style.display = 'flex';
  $('subtaskName').focus();
}

function closeSubtaskModal() {
  $('subtaskModal').style.display = 'none';
  pendingSubtaskParent = null;
}

function confirmSubtaskModal() {
  if (!pendingSubtaskParent) return;
  const name = $('subtaskName').value.trim();
  const deadlineStr = $('subtaskDeadline').value;
  if (!name) { alert('请填写子任务名'); return; }
  const deadline = new Date(deadlineStr).getTime();
  if (!Number.isFinite(deadline)) { alert('截止时间格式不正确'); return; }
  window.api.addSubtask(pendingSubtaskParent.id, { name, deadline, notes: '' });
  closeSubtaskModal();
}

function startAddSubtask(t) {
  openSubtaskModal(t);
}

function formatDatetimeLocal(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function renderSubtasks(parentId) {
  const sec = $('subtaskSection');
  const list = $('subtaskList');
  const children = getChildren(data.tasks, parentId).filter(c => !c.done);
  if (children.length === 0 && !editId) {
    sec.style.display = 'none';
    return;
  }
  sec.style.display = '';
  list.innerHTML = '';
  for (const c of children) list.appendChild(subtaskRow(c));
}

function subtaskRow(c) {
  const row = document.createElement('div');
  row.className = 'subtask-row';
  const name = document.createElement('input');
  name.type = 'text';
  name.value = c.name;
  name.addEventListener('change', () => window.api.updateTask(c.id, { name: name.value }));
  const dl = document.createElement('input');
  dl.type = 'datetime-local';
  dl.step = '60';
  dl.value = formatDatetimeLocal(c.deadline);
  dl.addEventListener('change', () => {
    const ts = new Date(dl.value).getTime();
    if (Number.isFinite(ts)) window.api.updateTask(c.id, { deadline: ts });
  });
  const del = document.createElement('button');
  del.className = 'icon-btn';
  del.textContent = '🗑';
  del.title = '删除子任务';
  del.addEventListener('click', () => window.api.deleteTask(c.id));
  row.appendChild(name);
  row.appendChild(dl);
  row.appendChild(del);
  return row;
}

function handleCtxAction(action, id) {
  const t = data.tasks.find(x => x.id === id);
  if (!t) return;
  switch (action) {
    case 'add-sub': startAddSubtask(t); break;
    case 'edit': startEdit(t); break;
    case 'toggle-note': window.api.toggleNote(id); break;
    case 'complete': window.api.completeTask(id); break;
    case 'delete':
      if (confirm('删除任务「' + t.name + '」？\n此操作不可恢复。')) {
        window.api.deleteTask(id);
      }
      break;
  }
}

// ---------- 每秒刷新 ----------

function tick() {
  const now = Date.now();
  document.querySelectorAll('#taskList .card').forEach(card => {
    const t = data.tasks.find(x => x.id === card.dataset.id);
    if (!t || t.done) return;
    const rem = t.deadline - now;
    const cdEl = card.querySelector('.card-cd');
    if (cdEl) cdEl.textContent = fmtRemaining(rem) + exclamations(rem);
    applyUrgency(card, urgency(rem));
  });
  if (collapsed) updateBanner();
}

function updateBanner() {
  const undone = data.tasks.filter(t => !t.done).sort((a, b) => a.deadline - b.deadline);
  if (undone.length === 0) {
    $('bannerLabel').style.display = 'none';
    $('bannerName').textContent = '没有待办任务 🎉';
    $('bannerCd').textContent = '点 ⤢ 展开添加';
  } else {
    $('bannerLabel').style.display = '';
    const t = undone[0];
    const rem = t.deadline - Date.now();
    const path = getRootPath(data.tasks, t.id);
    if (path.length > 1) {
      const root = path[0];
      $('bannerName').textContent = root.name + ' > ' + t.name;
      $('bannerCd').textContent = fmtRemaining(rem) + exclamations(rem) +
        ' · 子截止 ' + fmtDeadline(t.deadline) +
        ' · 根截止 ' + fmtDeadline(root.deadline);
    } else {
      $('bannerName').textContent = t.name;
      $('bannerCd').textContent = fmtRemaining(rem) + exclamations(rem) + ' · ' + fmtDeadline(t.deadline);
    }
  }
  // 高度自适应：任务名可能折行多行。
  // 注意：不能用 .banner-text 的 getBoundingClientRect()，它会被当前窗口的 overflow 裁剪，
  // 形成“窗口越矮→测得越矮→窗口越矮”的死循环；scrollHeight 才反映真实内容高度。
  const nameH = document.querySelector('.banner-name').scrollHeight;
  const labelH = document.querySelector('.banner-label').offsetHeight;
  const cdH = document.querySelector('.banner-cd').offsetHeight;
  // .banner 上下 padding 8+8，.panel 上下 padding 8+8，行间隙 6，再留 8px 安全余量
  const need = Math.ceil(nameH + labelH + cdH + 6 + 32 + 8);
  window.api.setBannerHeight(Math.max(BANNER_MIN_H, need))
    .catch(err => console.error('[setBannerHeight] 调用失败:', err));
}

// ---------- 撤销 ----------

function showUndo(t) {
  $('undoText').textContent = '已完成「' + t.name + '」';
  $('btnUndo').dataset.id = t.id;
  $('undoBar').style.display = 'flex';
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    $('undoBar').style.display = 'none';
    undoTimer = null;
  }, 5000);
}

document.addEventListener('DOMContentLoaded', init);
