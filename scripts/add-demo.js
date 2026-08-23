'use strict';
// 演示数据生成器：为每个紧迫度档位各生成一条任务
// 用法：先完全退出 deadline清单，然后 node scripts/add-demo.js
// 注意：必须在应用未运行时执行，否则退出时内存数据会覆盖本文件写入的内容

const fs = require('fs');
const path = require('path');
const os = require('os');

const file = path.join(os.homedir(), 'AppData', 'Roaming', 'deadline清单', 'data.json');

const D = 86400e3;
const H = 3600e3;
const now = Date.now();

// 保留现有 settings（面板位置等），只替换任务列表
let settings = {};
try {
  settings = (JSON.parse(fs.readFileSync(file, 'utf8')) || {}).settings || {};
} catch (e) { /* 首次运行 */ }
settings = Object.assign({ panelX: null, panelY: null, collapsed: false, autoLaunch: true, demoAdded: true, focusMode: false }, settings);

function task(name, deadline, notes, notified, note) {
  return {
    id: 'demo' + Math.random().toString(36).slice(2, 10),
    name: name,
    deadline: deadline,
    notes: notes,
    done: false,
    completedAt: null,
    notified: notified,
    note: note
  };
}

const tasks = [
  task('演示① 淡黄档（>7天）', now + 8 * D,
    '底色淡黄，倒计时正常字号', {}, null),
  task('演示② 橙黄档（5~7天）', now + 6 * D,
    '底色橙黄，倒计时略放大', {}, null),
  task('演示③ 橙红档（3~5天）', now + 4 * D,
    '底色橙红，倒计时明显放大', {}, null),
  task('演示④ 正红档（1~3天）', now + 2 * D,
    '正红 + 闪烁边框 + 轻微脉冲。启动后会弹一条「还剩3天」通知', {}, null),
  task('演示⑤ 深红档（<24小时）', now + 12 * H,
    '深红 + 闪烁边框 + 强脉冲。已预埋 d3 节点，启动后只弹「还剩24小时」通知。这条已撕成便签',
    { d3: true }, { detached: true, x: 80, y: 260 }),
  task('演示⑥ 黑色档（已过期）', now - 3 * H,
    '黑色 + 闪烁边框、无脉冲，钉在清单最顶。已预埋 d3/h24/h1，启动后只弹「已到截止时间」通知。这条也已撕成便签',
    { d3: true, h24: true, h1: true }, { detached: true, x: 370, y: 260 })
];

fs.writeFileSync(file, JSON.stringify({ tasks: tasks, settings: settings }, null, 2));
console.log('演示数据已写入: ' + file);
console.log('任务数: ' + tasks.length + '，其中 2 条已撕成桌面便签');
