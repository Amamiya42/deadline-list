'use strict';

// 共享工具：时间格式化 + 紧迫度计算（主面板与便签共用同一套规则）

function fmtDur(ms) {
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d > 0) return d + '天' + h + '小时';
  if (h > 0) return h + '小时' + mm + '分';
  return mm + '分';
}

function fmtRemaining(remainingMs) {
  if (remainingMs <= 0) return '已超时 ' + fmtDur(-remainingMs);
  return '还剩 ' + fmtDur(remainingMs);
}

function fmtDeadline(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// 感叹号强调：5~7天 → ！；3~5天 → ！！；1~3天与<24h → ！！！；>7天和已过期 → 无
function exclamations(remainingMs) {
  const DAY = 86400000;
  if (remainingMs <= 0) return '';
  if (remainingMs > 7 * DAY) return '';
  if (remainingMs > 5 * DAY) return '！';
  if (remainingMs > 3 * DAY) return '！！';
  return '！！！';
}

// 紧迫度：颜色连续渐变 淡黄(>7天)→橙黄(5~7天)→橙红(3~5天)→正红(1~3天)→深红(<24h)→黑(过期)
function urgency(remainingMs) {
  const DAY = 86400000;
  if (remainingMs <= 0) {
    return { rgb: [17, 17, 17], fontPx: 26, pulse: 'none', flash: true, dark: true };
  }
  const t = Math.min(remainingMs, 7 * DAY);
  const stops = [
    [7 * DAY, [255, 249, 196]], // 淡黄
    [5 * DAY, [255, 213, 79]],  // 橙黄
    [3 * DAY, [255, 112, 67]],  // 橙红
    [1 * DAY, [244, 67, 54]],   // 正红
    [0, [183, 28, 28]]          // 深红
  ];
  let rgb = [255, 249, 196];
  if (remainingMs < 7 * DAY) {
    for (let i = 0; i < stops.length - 1; i++) {
      const t1 = stops[i][0], c1 = stops[i][1];
      const t2 = stops[i + 1][0], c2 = stops[i + 1][1];
      if (t <= t1 && t >= t2) {
        const r = (t1 - t) / ((t1 - t2) || 1);
        rgb = [0, 1, 2].map(k => Math.round(c1[k] + (c2[k] - c1[k]) * r));
        break;
      }
    }
  }
  const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  const dark = lum < 140;
  // 字号：正常(15px) → 最大(26px)，随剩余时间非线性放大
  const ratio = Math.pow(Math.max(0, Math.min(1, (7 * DAY - t) / (7 * DAY))), 0.6);
  const fontPx = Math.round(15 + 11 * ratio);
  let pulse = 'none';
  if (remainingMs < DAY) pulse = 'strong';
  else if (remainingMs < 3 * DAY) pulse = 'soft';
  const flash = remainingMs < 3 * DAY;
  return { rgb: rgb, fontPx: fontPx, pulse: pulse, flash: flash, dark: dark };
}

function applyUrgency(el, u) {
  el.style.backgroundColor = 'rgb(' + u.rgb.join(',') + ')';
  el.style.color = u.dark ? '#ffffff' : '#1a1a1a';
  el.classList.toggle('flash', !!u.flash);
  el.classList.toggle('pulse-soft', u.pulse === 'soft');
  el.classList.toggle('pulse-strong', u.pulse === 'strong');
}
