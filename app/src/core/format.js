/**
 * 展示格式化（H5 版）
 *
 * 来源：mobile/miniprogram/shared/format.js（逐字拷贝，仅把 CommonJS 改为 ES Module）。
 * ⚠️ 算法单一来源：改这里请同步小程序端，避免两端口径漂移。
 */

/** 秒 → 「x 小时 y 分钟」 */
export function fmtDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total < 60) {
    return total > 0 ? '不足 1 分钟' : '0 分钟';
  }
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (hours <= 0) {
    return minutes + ' 分钟';
  }
  return minutes > 0 ? hours + ' 小时 ' + minutes + ' 分钟' : hours + ' 小时';
}

/** 环比小数 → 「+12.3%」；非法值返回 null */
export function fmtCompare(value) {
  if (typeof value !== 'number' || !isFinite(value)) {
    return null;
  }
  const percent = value * 100;
  const sign = percent > 0 ? '+' : '';
  return sign + percent.toFixed(1) + '%';
}

/** 时间戳 → 本地时间 HH:mm */
export function fmtTime(ts) {
  const d = new Date(ts);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}
