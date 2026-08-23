'use strict';

const taskId = window.api.getTaskId();
let data = null;
let task = null;
let dead = false;

function findTask() {
  if (!data) return null;
  return data.tasks.find(t => t.id === taskId) || null;
}

function die() {
  if (dead) return;
  dead = true;
  window.close();
}

function render() {
  if (!task) return;
  document.getElementById('nName').textContent = task.name;
  document.getElementById('nNotes').textContent = task.notes || '';
  tick();
}

function tick() {
  if (!task) return;
  const rem = task.deadline - Date.now();
  const cd = document.getElementById('nCd');
  cd.textContent = fmtRemaining(rem) + exclamations(rem);
  const u = urgency(rem);
  cd.style.fontSize = u.fontPx + 'px';
  applyUrgency(document.getElementById('noteCard'), u);
}

async function init() {
  data = await window.api.getData();
  task = findTask();
  if (!task || task.done || !task.note || !task.note.detached) {
    die();
    return;
  }
  render();
  setInterval(tick, 1000);

  window.api.onDataChanged(d => {
    if (dead) return;
    data = d;
    task = findTask();
    if (!task || task.done || !task.note || !task.note.detached) {
      die();
      return;
    }
    render();
  });

  document.getElementById('nDone').addEventListener('change', async e => {
    if (e.target.checked) {
      await window.api.completeTask(taskId);
      die();
    }
  });

  document.getElementById('nClose').addEventListener('click', () => {
    window.api.toggleNote(taskId); // 收回主面板，主进程会关闭本窗口
  });
}

document.addEventListener('DOMContentLoaded', init);
