'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getData: () => ipcRenderer.invoke('get-data'),
  addTask: t => ipcRenderer.invoke('add-task', t),
  updateTask: (id, patch) => ipcRenderer.invoke('update-task', id, patch),
  deleteTask: id => ipcRenderer.invoke('delete-task', id),
  completeTask: id => ipcRenderer.invoke('complete-task', id),
  uncompleteTask: id => ipcRenderer.invoke('uncomplete-task', id),
  toggleNote: id => ipcRenderer.invoke('toggle-note', id),
  setCollapsed: v => ipcRenderer.invoke('set-collapsed', v),
  setBannerHeight: h => ipcRenderer.invoke('set-banner-height', h),
  addSubtask: (parentId, t) => ipcRenderer.invoke('add-subtask', parentId, t),
  updateSubtaskParent: (id, newParentId) => ipcRenderer.invoke('update-subtask-parent', id, newParentId),
  toggleExpanded: id => ipcRenderer.invoke('toggle-expanded', id),
  hidePanel: () => ipcRenderer.invoke('hide-panel'),
  getTaskId: () => new URLSearchParams(window.location.search).get('id'),
  onDataChanged: cb => ipcRenderer.on('data-changed', (_e, d) => cb(d)),
  onViewMode: cb => ipcRenderer.on('view-mode', (_e, collapsed) => cb(collapsed))
});
