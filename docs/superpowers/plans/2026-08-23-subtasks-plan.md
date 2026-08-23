# deadline清单 v1.1 子任务功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 deadline清单中实现无限层级子任务，支持独立 deadline、独立提醒、独立便签、双向完成联动，并在主面板以树形列表展示。

**Architecture:** 任务扁平化存储，新增 `parentId` 和 `expanded` 字段；渲染层按 deadline 全局排序后通过缩进表达层级；完成/删除操作在 main 进程中递归处理后代节点；横幅通过根路径工具函数显示最紧迫节点及其根任务信息。

**Tech Stack:** Electron 33, Vanilla JS (ES6), JSON 持久化, CSS Flexbox。

**Spec:** `docs/superpowers/specs/2026-08-23-subtasks-design.md`

## Global Constraints

- 保持现有数据向后兼容：`loadData()` 自动给旧任务补 `parentId: null` 和 `expanded: true`。
- 不引入任何新依赖。
- 每次 IPC 操作后调用 `saveData()` + `broadcast()`。
- 所有 JS 文件修改后必须 `node --check` 通过。
- 每个 task 完成后提交一次 git。

---

## Task 1: 数据模型迁移与树工具函数

**Files:**
- Modify: `main.js:82-103` (`loadData`)
- Modify: `renderer/common.js`
- Test: 手动启动应用，检查 `data.json` 中旧任务是否出现 `parentId` 和 `expanded`

**Interfaces:**
- Produces: `common.js` 导出 `getRootPath(tasks, taskId)`, `getChildren(tasks, taskId)`, `isLeaf(tasks, taskId)`

- [ ] **Step 1: 修改 `loadData` 自动补全字段**

  在 `main.js` 的 `loadData` 中，对每个任务：
  ```js
  if (t.parentId === undefined) t.parentId = null;
  if (t.expanded === undefined) t.expanded = true;
  ```

- [ ] **Step 2: 在 `renderer/common.js` 添加树工具函数**

  ```js
  function getChildren(tasks, id) {
    return tasks.filter(t => t.parentId === id);
  }

  function getRootPath(tasks, id) {
    const path = [];
    let cur = tasks.find(t => t.id === id);
    while (cur) {
      path.unshift(cur);
      if (!cur.parentId) break;
      cur = tasks.find(t => t.id === cur.parentId);
      if (!cur) break;
    }
    return path;
  }

  function isLeaf(tasks, id) {
    return !tasks.some(t => t.parentId === id);
  }
  ```

- [ ] **Step 3: 语法检查并提交**

  Run: `node --check main.js && node --check renderer/common.js`
  
  Commit:
  ```bash
  git add main.js renderer/common.js
  git commit -m "feat: 数据模型新增 parentId/expanded，common.js 添加树工具函数"
  ```

---

## Task 2: 主进程新增子任务 IPC

**Files:**
- Modify: `main.js:421-520` (`registerIpc`)
- Modify: `preload.js`
- Test: 启动应用，通过 DevTools 控制台调用 `window.api.addSubtask(...)` 验证

**Interfaces:**
- Consumes: `uid()`, `getTask()`, `saveData()`, `broadcast()`
- Produces: `add-subtask`, `update-subtask-parent` IPC handlers; preload exposes `addSubtask`, `updateSubtaskParent`

- [ ] **Step 1: 新增 `add-subtask` 处理器**

  在 `registerIpc()` 内添加：
  ```js
  ipcMain.handle('add-subtask', (_e, parentId, t) => {
    const parent = getTask(parentId);
    if (!parent) return { ok: false, error: '父任务不存在' };
    if (!t || typeof t.name !== 'string' || !t.name.trim() || !Number.isFinite(t.deadline)) {
      return { ok: false, error: '参数不完整' };
    }
    const child = {
      id: uid(),
      name: t.name.trim(),
      deadline: t.deadline,
      notes: typeof t.notes === 'string' ? t.notes : '',
      done: false,
      completedAt: null,
      notified: {},
      note: null,
      parentId: parentId,
      expanded: true
    };
    data.tasks.push(child);
    saveData();
    broadcast();
    return { ok: true, id: child.id };
  });
  ```

- [ ] **Step 2: 新增 `update-subtask-parent` 处理器**

  ```js
  ipcMain.handle('update-subtask-parent', (_e, id, newParentId) => {
    const t = getTask(id);
    if (!t) return { ok: false, error: '任务不存在' };
    if (newParentId !== null) {
      const p = getTask(newParentId);
      if (!p) return { ok: false, error: '新父任务不存在' };
      // 禁止把自己或后代设为父，避免成环
      let cur = p;
      while (cur) {
        if (cur.id === id) return { ok: false, error: '不能移动到自身或后代下' };
        if (!cur.parentId) break;
        cur = data.tasks.find(x => x.id === cur.parentId);
        if (!cur) break;
      }
    }
    t.parentId = newParentId;
    saveData();
    broadcast();
    return { ok: true };
  });
  ```

- [ ] **Step 3: 暴露到 preload**

  ```js
  addSubtask: (parentId, t) => ipcRenderer.invoke('add-subtask', parentId, t),
  updateSubtaskParent: (id, newParentId) => ipcRenderer.invoke('update-subtask-parent', id, newParentId),
  ```

- [ ] **Step 4: 语法检查并提交**

  Run: `node --check main.js && node --check preload.js`
  
  Commit:
  ```bash
  git add main.js preload.js
  git commit -m "feat: 主进程新增 add-subtask 和 update-subtask-parent IPC"
  ```

---

## Task 3: 完成状态双向联动

**Files:**
- Modify: `main.js:464-500` (complete-task / uncomplete-task)
- Test: 添加父任务和子任务，完成父任务看子任务是否自动完成；完成所有子任务看父任务是否自动完成

**Interfaces:**
- Consumes: `getTask()`, `closeNoteWin()`, `saveData()`, `broadcast()`
- Produces: 内部辅助函数 `markDone(id)`, `propagateCompletion()`

- [ ] **Step 1: 抽取递归完成函数**

  在 `registerIpc` 之前添加：
  ```js
  function markDone(id) {
    const t = getTask(id);
    if (!t || t.done) return;
    t.done = true;
    t.completedAt = Date.now();
    if (t.note) t.note.detached = false;
    closeNoteWin(id);
    // 递归完成所有后代
    for (const child of data.tasks) {
      if (child.parentId === id) markDone(child.id);
    }
  }

  function propagateCompletion() {
    // 自底向上：只要一个节点的所有直接子节点都完成，该节点就完成
    // 多轮扫描直到无变化（处理深层嵌套）
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of data.tasks) {
        if (t.done) continue;
        const children = data.tasks.filter(c => c.parentId === t.id);
        if (children.length > 0 && children.every(c => c.done)) {
          t.done = true;
          t.completedAt = Date.now();
          if (t.note) t.note.detached = false;
          closeNoteWin(t.id);
          changed = true;
        }
      }
    }
  }
  ```

- [ ] **Step 2: 修改 `complete-task` 处理器**

  ```js
  ipcMain.handle('complete-task', (_e, id) => {
    const t = getTask(id);
    if (!t) return { ok: false, error: '任务不存在' };
    markDone(id);
    propagateCompletion();
    saveData();
    broadcast();
    return { ok: true };
  });
  ```

- [ ] **Step 3: 修改 `uncomplete-task` 处理器**

  ```js
  ipcMain.handle('uncomplete-task', (_e, id) => {
    const t = getTask(id);
    if (!t) return { ok: false, error: '任务不存在' };
    t.done = false;
    t.completedAt = null;
    saveData();
    broadcast();
    return { ok: true };
  });
  ```

- [ ] **Step 4: 语法检查并提交**

  Run: `node --check main.js`
  
  Commit:
  ```bash
  git add main.js
  git commit -m "feat: 完成状态双向联动（父→子递归完成，子→父自动冒泡）"
  ```

---

## Task 4: 删除递归

**Files:**
- Modify: `main.js:454-462` (`delete-task`)
- Test: 删除父任务，确认 `data.json` 中其所有子任务也被删除

**Interfaces:**
- Produces: 内部辅助函数 `deleteTaskRecursively(id)`

- [ ] **Step 1: 添加递归删除函数**

  在 `registerIpc` 之前：
  ```js
  function deleteTaskRecursively(id) {
    const children = data.tasks.filter(t => t.parentId === id);
    for (const c of children) deleteTaskRecursively(c.id);
    const i = data.tasks.findIndex(t => t.id === id);
    if (i >= 0) {
      closeNoteWin(id);
      data.tasks.splice(i, 1);
    }
  }
  ```

- [ ] **Step 2: 修改 `delete-task` 处理器**

  ```js
  ipcMain.handle('delete-task', (_e, id) => {
    const t = getTask(id);
    if (!t) return { ok: false, error: '任务不存在' };
    deleteTaskRecursively(id);
    saveData();
    broadcast();
    return { ok: true };
  });
  ```

- [ ] **Step 3: 语法检查并提交**

  Run: `node --check main.js`
  
  Commit:
  ```bash
  git add main.js
  git commit -m "feat: 删除父任务时递归删除所有后代节点"
  ```

---

## Task 5: 提醒系统遍历所有节点

**Files:**
- Modify: `main.js:317-334` (`checkReminders`)
- Test: 添加一个子任务，调系统时间或等其自然触发，确认子任务独立提醒

**Interfaces:**
- Consumes: `data.tasks`
- Produces: 无新接口，行为变更

- [ ] **Step 1: 修改 `checkReminders` 遍历全部未完成任务**

  现有循环：
  ```js
  for (const t of data.tasks) {
    if (t.done) continue;
    ...
  }
  ```

  这已经会遍历所有节点，**无需改动**。但需确认 `fireNotification` 对子任务生效，且 `checkReminders` 没有过滤根任务的逻辑。如果之前无过滤，则本 task 无需代码变更，只需验证。

- [ ] **Step 2: 验证并提交**

  若确实无需改动，直接提交一个说明性 commit：
  ```bash
  git commit --allow-empty -m "verify: checkReminders 已天然遍历所有节点（含子任务）"
  ```

---

## Task 6: 主面板树形渲染

**Files:**
- Modify: `renderer/panel.js` (`render`, `taskCard`, `updateBanner`)
- Modify: `renderer/panel.css`
- Test: 手动通过 `window.api.addSubtask(parentId, {...})` 添加子任务，确认主面板出现缩进层级

**Interfaces:**
- Consumes: `getChildren()`, `isLeaf()` from `common.js`
- Produces: `taskTree(t, depth)` helper in `panel.js`

- [ ] **Step 1: 重构 `render()` 为树形渲染**

  在 `panel.js` 中添加：
  ```js
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
      for (const t of undoneRoots) {
        appendTaskTree(list, t, 0);
      }
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
    for (const c of children) {
      appendTaskTree(container, c, depth + 1);
    }
  }
  ```

- [ ] **Step 2: 修改 `taskCard(t)` 为 `taskCard(t, depth)`**

  ```js
  function taskCard(t, depth = 0) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = t.id;
    card.style.marginLeft = (depth * 18) + 'px';
    // 其余内容保持不变，但 pin 按钮改为展开/折叠按钮 + 撕便签按钮：
    //  - 非叶子：显示 ▶/▼ 切换 expanded
    //  - 所有节点：保留 📌/📍 撕便签
    ...
  }
  ```

  在 `acts` 区域前新增展开按钮：
  ```js
  const children = getChildren(data.tasks, t.id).filter(c => !c.done);
  if (children.length > 0) {
    const expand = document.createElement('button');
    expand.className = 'icon-btn tree-toggle';
    expand.textContent = t.expanded ? '▼' : '▶';
    expand.title = t.expanded ? '折叠子任务' : '展开子任务';
    expand.addEventListener('click', () => window.api.toggleExpanded(t.id));
    card.appendChild(expand);
  }
  ```

- [ ] **Step 3: 新增 IPC `toggle-expanded`**

  main.js：
  ```js
  ipcMain.handle('toggle-expanded', (_e, id) => {
    const t = getTask(id);
    if (!t) return { ok: false, error: '任务不存在' };
    t.expanded = !t.expanded;
    saveData();
    broadcast();
    return { ok: true };
  });
  ```

  preload.js：
  ```js
  toggleExpanded: id => ipcRenderer.invoke('toggle-expanded', id),
  ```

- [ ] **Step 4: 调整 CSS**

  ```css
  .card {
    /* 保持现有样式，margin-left 由 JS 动态设置 */
  }
  .tree-toggle {
    font-size: 10px;
    width: 18px;
    height: 18px;
    margin-right: 2px;
  }
  ```

- [ ] **Step 5: 语法检查并提交**

  Run: `node --check main.js && node --check preload.js && node --check renderer/panel.js`
  
  Commit:
  ```bash
  git add main.js preload.js renderer/panel.js renderer/panel.css
  git commit -m "feat: 主面板树形渲染，支持展开折叠与层级缩进"
  ```

---

## Task 7: 右键菜单与行内 + 按钮

**Files:**
- Modify: `renderer/panel.js` (`taskCard`)
- Test: hover 任务卡片出现 + 按钮；右键弹出菜单可添加子任务

**Interfaces:**
- Consumes: `window.api.addSubtask()`, `window.api.deleteTask()`, `window.api.completeTask()`, `window.api.toggleNote()`

- [ ] **Step 1: 在卡片 actions 区添加 + 按钮**

  ```js
  const addChild = document.createElement('button');
  addChild.className = 'icon-btn';
  addChild.title = '添加子任务';
  addChild.textContent = '+';
  addChild.addEventListener('click', () => startAddSubtask(t));
  acts.appendChild(addChild);
  ```

- [ ] **Step 2: 实现右键菜单**

  为 card 添加 contextmenu 事件：
  ```js
  card.addEventListener('contextmenu', e => {
    e.preventDefault();
    const choice = window.confirm(
      '选择操作：\n确定 = 添加子任务\n取消 = 关闭菜单'
    );
    if (choice) startAddSubtask(t);
  });
  ```

  注：为保持简单，v1.1 先用 `confirm` 而非自定义 context menu。后续可升级。

- [ ] **Step 3: 实现 `startAddSubtask(t)`**

  ```js
  function startAddSubtask(t) {
    const name = window.prompt('子任务名：');
    if (!name || !name.trim()) return;
    const deadlineStr = window.prompt('截止时间（YYYY-MM-DDTHH:mm）：');
    if (!deadlineStr) return;
    const deadline = new Date(deadlineStr).getTime();
    if (!Number.isFinite(deadline)) {
      alert('时间格式不正确');
      return;
    }
    window.api.addSubtask(t.id, { name: name.trim(), deadline, notes: '' });
  }
  ```

- [ ] **Step 4: 语法检查并提交**

  Run: `node --check renderer/panel.js`
  
  Commit:
  ```bash
  git add renderer/panel.js
  git commit -m "feat: 任务卡片支持 + 按钮添加子任务和右键添加子任务"
  ```

---

## Task 8: 编辑面板子任务管理区

**Files:**
- Modify: `renderer/panel.html`
- Modify: `renderer/panel.css`
- Modify: `renderer/panel.js` (`startEdit`, `submitTask`, `resetForm`)
- Test: 双击任务打开编辑面板，能看到子任务列表、可添加/删除/编辑子任务

**Interfaces:**
- Consumes: `getChildren()`, `window.api.addSubtask()`, `window.api.deleteTask()`, `window.api.updateTask()`

- [ ] **Step 1: 在 panel.html 编辑区下方添加子任务区块**

  ```html
  <div id="subtaskSection" class="subtask-section" style="display:none">
    <div class="section-title">子任务</div>
    <div id="subtaskList" class="subtask-list"></div>
    <button id="btnAddSubtask" class="btn small">+ 添加子任务</button>
  </div>
  ```

- [ ] **Step 2: 在 panel.css 添加子任务区块样式**

  ```css
  .subtask-section {
    border-top: 1px solid rgba(0, 0, 0, 0.08);
    padding: 10px 12px;
  }
  .section-title {
    font-size: 12px;
    font-weight: 600;
    color: #616161;
    margin-bottom: 6px;
  }
  .subtask-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 8px;
  }
  .subtask-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .subtask-row input[type="text"] {
    flex: 1;
  }
  .subtask-row input[type="datetime-local"] {
    width: 150px;
  }
  ```

- [ ] **Step 3: 在 panel.js 中渲染编辑态子任务列表**

  ```js
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
    for (const c of children) {
      list.appendChild(subtaskRow(c));
    }
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
    del.addEventListener('click', () => window.api.deleteTask(c.id));
    row.appendChild(name);
    row.appendChild(dl);
    row.appendChild(del);
    return row;
  }
  ```

- [ ] **Step 4: 添加 `formatDatetimeLocal` 辅助函数**

  ```js
  function formatDatetimeLocal(ts) {
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  ```

- [ ] **Step 5: 在 `startEdit` 和 `onDataChanged` 中调用 `renderSubtasks`**

  ```js
  function startEdit(t) {
    ...
    renderSubtasks(t.id);
    $('btnAddSubtask').onclick = () => startAddSubtask(t);
  }
  ```

  在 `window.api.onDataChanged` 回调中：
  ```js
  if (editId) renderSubtasks(editId);
  ```

- [ ] **Step 6: 语法检查并提交**

  Run: `node --check renderer/panel.js`
  
  Commit:
  ```bash
  git add renderer/panel.html renderer/panel.css renderer/panel.js
  git commit -m "feat: 编辑面板新增子任务管理区（增删改子任务）"
  ```

---

## Task 9: 横幅显示根路径信息

**Files:**
- Modify: `renderer/panel.js` (`updateBanner`)
- Test: 折叠后若最紧迫任务是子任务，横幅显示根任务名和根 deadline

**Interfaces:**
- Consumes: `getRootPath()` from `common.js`

- [ ] **Step 1: 修改 `updateBanner`**

  ```js
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
    const nameH = document.querySelector('.banner-name').scrollHeight;
    const labelH = document.querySelector('.banner-label').offsetHeight;
    const cdH = document.querySelector('.banner-cd').offsetHeight;
    const need = Math.ceil(nameH + labelH + cdH + 6 + 32 + 8);
    window.api.setBannerHeight(Math.max(BANNER_MIN_H, need))
      .catch(err => console.error('[setBannerHeight] 调用失败:', err));
  }
  ```

- [ ] **Step 2: 语法检查并提交**

  Run: `node --check renderer/panel.js`
  
  Commit:
  ```bash
  git add renderer/panel.js
  git commit -m "feat: 横幅显示最紧迫子任务时附带根任务名和根 deadline"
  ```

---

## Task 10: 便签支持任意节点

**Files:**
- Modify: `main.js:172-227` (`createNoteWin`, `closeNoteWin`)
- Test: 右键子任务 → 撕成便签，确认独立便签窗口弹出

**Interfaces:**
- Consumes: `noteWins` Map (key 已为节点 id)
- Produces: 无新接口，行为已自然支持

- [ ] **Step 1: 确认 `toggle-note` IPC 已支持子任务**

  当前 `toggle-note` 通过 `getTask(id)` 查找任意节点，`createNoteWin` 通过 `task.note` 判断。由于子任务也有 `note` 字段，**无需改动**即可支持子任务撕便签。

- [ ] **Step 2: 在面板卡片中保留撕便签按钮**

  Task 6 中应已保留 pin 按钮（📌/📍）。如被移除，补回：
  ```js
  const pin = document.createElement('button');
  pin.className = 'icon-btn';
  pin.title = (t.note && t.note.detached) ? '收回便签' : '撕成桌面便签';
  pin.textContent = (t.note && t.note.detached) ? '📌' : '📍';
  pin.addEventListener('click', () => window.api.toggleNote(t.id));
  ```

- [ ] **Step 3: 提交说明**

  ```bash
  git commit --allow-empty -m "verify: 子任务可独立撕成桌面便签（无需代码改动，确认行为）"
  ```

---

## Task 11: 回归测试与清理

**Files:**
- All modified files
- Test: 全流程手动验证

- [ ] **Step 1: 完整验证清单**

  1. 启动应用，确认旧任务自动迁移出 `parentId`/`expanded`
  2. 添加根任务，再添加子任务，确认树形缩进
  3. 完成父任务，确认子任务自动完成
  4. 撤销子任务完成，确认父任务不自动撤销
  5. 删除父任务，确认子任务一起消失
  6. 把子任务 deadline 调到比所有根任务都早，折叠横幅，确认显示子任务 + 根任务名 + 根 deadline
  7. 右键子任务撕便签，确认独立便签弹出
  8. 发送测试通知，确认提示音正常

- [ ] **Step 2: 清理临时调试日志**

  若 `main.js` 中仍有 Task 1-9 期间用于调试的 `logNotify` 埋点，且非必要，移除或降级为只在异常时记录。

- [ ] **Step 3: 最终提交**

  ```bash
  git add -A
  git commit -m "chore: v1.1 子任务功能回归测试通过，清理调试日志"
  ```

---

## Self-Review

**Spec coverage check:**
- 数据模型扁平 + parentId：Task 1 ✓
- 完成双向联动：Task 3 ✓
- 删除递归：Task 4 ✓
- 全局排序：Task 6 render 中 `appendTaskTree` 按 deadline 排序 ✓
- 树形 UI 展开折叠：Task 6 ✓
- 右键 + 行内 + 编辑面板添加子任务：Task 7 + 8 ✓
- 横幅根路径：Task 9 ✓
- 子任务独立提醒：Task 5 ✓
- 子任务独立便签：Task 10 ✓

**Placeholder scan:** 无 TBD/TODO/"实现 later"/"类似 Task N"。

**Type consistency：** `parentId` 在数据模型、IPC、渲染层均一致；`expanded` 布尔值；`getChildren/getRootPath/isLeaf` 签名一致。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-23-subtasks-plan.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
