/**
 * 本机运行日志（调试用，零依赖）
 *
 * 目的：真机预览出问题（例如白屏）时，没有控制台可看 —— 这里把关键步骤与错误
 * 留在本机，出错时由 app.js 弹窗直接显示，事后也能整段复制出来。
 *
 * 约定：
 *   - 只留最近 80 条，循环覆盖，不占存储；
 *   - 只记步骤名 / 错误信息 / 状态码，**不记 Key、Token、openid 等敏感值**（调用方自行脱敏）；
 *   - 同步写 console，开发者工具里照常能看到。
 */
const KEY = 'wre_logs';
const MAX = 80;

function stamp() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function brief(extra) {
  if (extra === undefined || extra === null) {
    return '';
  }
  if (typeof extra === 'string') {
    return extra;
  }
  if (extra instanceof Error) {
    return (extra.message || '') + (extra.stack ? ' @' + String(extra.stack).split('\n')[1] : '');
  }
  try {
    return JSON.stringify(extra);
  } catch (err) {
    return String(extra);
  }
}

function push(level, scope, message, extra) {
  const tail = brief(extra);
  const text = (message || '') + (tail ? ' | ' + tail : '');
  const line = { t: stamp(), level: level, scope: scope, msg: text.slice(0, 400) };
  try {
    const all = wx.getStorageSync(KEY) || [];
    all.push(line);
    if (all.length > MAX) {
      all.splice(0, all.length - MAX);
    }
    wx.setStorageSync(KEY, all);
  } catch (err) {
    // 存储写不进去也不影响业务
  }
  const out = '[wre][' + scope + '] ' + text;
  if (level === 'error') {
    console.error(out);
  } else if (level === 'warn') {
    console.warn(out);
  } else {
    console.log(out);
  }
}

function log(scope, message, extra) {
  push('log', scope, message, extra);
}

function warn(scope, message, extra) {
  push('warn', scope, message, extra);
}

function error(scope, message, extra) {
  push('error', scope, message, extra);
}

/** 最近日志（新的在后），供出错弹窗 / 手动复制使用 */
function recent(count) {
  try {
    const all = wx.getStorageSync(KEY) || [];
    return count ? all.slice(-count) : all;
  } catch (err) {
    return [];
  }
}

/** 最近日志拼成一段文本（便于复制发人） */
function dump(count) {
  return recent(count || 30)
    .map((item) => item.t + ' [' + item.level + '][' + item.scope + '] ' + item.msg)
    .join('\n');
}

function clear() {
  try {
    wx.removeStorageSync(KEY);
  } catch (err) {
    // 忽略
  }
}

/** 包一层：同步代码出错就记日志并返回 fallback，避免整页白屏 */
function guard(scope, fn, fallback) {
  try {
    return fn();
  } catch (err) {
    error(scope, '执行失败', err);
    return fallback;
  }
}

module.exports = { log: log, warn: warn, error: error, recent: recent, dump: dump, clear: clear, guard: guard };
