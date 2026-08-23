'use strict';
// 重置所有未完成任务的提醒标记，让各时间节点重新触发通知（测试用）
const fs = require('fs');
const path = require('path');
const dataFile = path.join(process.env.APPDATA, 'deadline清单', 'data.json');
const d = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
let n = 0;
for (const t of d.tasks) {
  if (!t.done) { t.notified = {}; n++; }
}
fs.writeFileSync(dataFile, JSON.stringify(d, null, 2));
console.log('reset notified flags for ' + n + ' tasks');
