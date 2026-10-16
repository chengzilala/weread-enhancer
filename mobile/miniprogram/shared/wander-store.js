/**
 * 灵感漫游（M12）· 本机存储 + 每周频率限制
 *
 * 本机为唯一数据源；同时静默备份到云端（集合 `wre_udata` 的 wander 分区，按身份隔离），
 * 换机 / 清缓存 / 退出登录后可拉回。
 * 存储键沿用 `wre_` 前缀：
 *   - wre_wander_issues：往期归档（每周一期，最多保留 HISTORY_MAX 期，可回看 / 收藏 / 随机漫游）
 *   - wre_wander_used  ：已用素材集合（{hashKey: ts}，用于跨期不重复）
 *   - wre_wander_quota ：本周已生成次数（用于「每周篇数」限流）
 */
const { hashKey, weekKey } = require('./wander-core');
const udata = require('./udata');

const ISSUES_KEY = 'wre_wander_issues';
const USED_KEY = 'wre_wander_used';
const QUOTA_KEY = 'wre_wander_quota';
const SEEN_KEY = 'wre_wander_seen';   // 最近一次「看过」的期 id，用于入口「新」标

const HISTORY_MAX = 52;   // 本机最多保留期数（约一年）

// ---- 本机读写 ----
function readJson(key, fallback) {
  try {
    const value = wx.getStorageSync(key);
    return value === '' || value == null ? fallback : value;
  } catch (err) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (err) {
    // 本机存储失败不影响主流程
  }
}

// ---- 已用素材（跨期不重复）----
function getUsed() {
  const value = readJson(USED_KEY, {});
  return value && typeof value === 'object' ? value : {};
}

/** 记一批素材为「已用」；接受 [{text}] 或 ['文本'] */
function markUsed(list) {
  const used = getUsed();
  const now = Date.now();
  (Array.isArray(list) ? list : []).forEach((item) => {
    const text = item && typeof item === 'object' ? item.text : item;
    if (text) {
      used[hashKey(text)] = now;
    }
  });
  writeJson(USED_KEY, used);
  backupSilent();
}

function resetUsed() {
  writeJson(USED_KEY, {});
  backupSilent();
}

// ---- 每周「生成」限流（周键为周一日期）----
function getQuota() {
  const week = weekKey();
  const quota = readJson(QUOTA_KEY, null);
  if (!quota || quota.week !== week) {
    return { week: week, used: 0 };
  }
  return { week: week, used: Number(quota.used) || 0 };
}

/** 本周还可生成几次（tier.weekly 为本周上限：铜 1 / 银 2 / 金 3） */
function weekLeft(tier) {
  const limit = (tier && tier.weekly) || 1;
  return Math.max(0, limit - getQuota().used);
}

/** 记一次生成，返回剩余次数 */
function bumpWeek() {
  const quota = getQuota();
  quota.used += 1;
  writeJson(QUOTA_KEY, quota);
  backupSilent();
  return quota.used;
}

function usedInWeek() {
  return getQuota().used;
}

// ---- 往期归档（回看 / 收藏 / 随机漫游）----
function listIssues() {
  const value = readJson(ISSUES_KEY, { issues: [] });
  return value && Array.isArray(value.issues) ? value.issues : [];
}

/** 保存一期：同一周只保留最新一期，历史最多 HISTORY_MAX 期 */
function saveIssue(issue) {
  const issues = listIssues().filter((item) => item && item.week !== issue.week);
  issues.unshift(issue);
  writeJson(ISSUES_KEY, { issues: issues.slice(0, HISTORY_MAX) });
  backupSilent();
}

function getWeekIssue() {
  const week = weekKey();
  const issues = listIssues();
  for (let i = 0; i < issues.length; i += 1) {
    if (issues[i] && issues[i].week === week) {
      return issues[i];
    }
  }
  return null;
}

/** 最近一期的主题（用于「避免连续两期同主题」） */
function lastTheme() {
  const issues = listIssues();
  return issues.length && issues[0] ? (issues[0].theme || '') : '';
}

function getIssueById(id) {
  const issues = listIssues();
  for (let i = 0; i < issues.length; i += 1) {
    if (issues[i] && issues[i].id === id) {
      return issues[i];
    }
  }
  return null;
}

function randomIssue() {
  const issues = listIssues();
  if (!issues.length) {
    return null;
  }
  return issues[Math.floor(Math.random() * issues.length)];
}

/** 收藏 / 取消收藏，返回最新状态 */
function starIssue(id) {
  const issues = listIssues();
  let starred = false;
  issues.forEach((issue) => {
    if (issue && issue.id === id) {
      issue.starred = !issue.starred;
      starred = issue.starred;
    }
  });
  writeJson(ISSUES_KEY, { issues: issues });
  backupSilent();
  return starred;
}

// ---- 「新一期」标（入口角标）：本周有本期且尚未看过 ----
function isNew() {
  const current = getWeekIssue();
  if (!current) {
    return false;
  }
  return readJson(SEEN_KEY, '') !== current.id;
}

function markSeen() {
  const current = getWeekIssue();
  if (current) {
    writeJson(SEEN_KEY, current.id);
  }
}

// ---- 云端备份 / 恢复（换机 / 清缓存 / 退出登录后拉回；失败静默）----

/** 备份快照：一次性打包三类本机数据 */
function cloudSnapshot() {
  return { issues: listIssues(), used: getUsed(), quota: getQuota(), seen: readJson(SEEN_KEY, '') };
}

/** 静默备份（不 await；失败不打扰用户） */
function backupSilent() {
  udata.backupSilent(udata.KIND.WANDER, cloudSnapshot());
}

/** 从云端恢复（仅本机无归档时写入，避免覆盖本机较新数据）→ { ok, restored, count } */
function restoreFromCloud() {
  return udata.get(udata.KIND.WANDER).then((res) => {
    if (!res.ok || !res.value) {
      return { ok: false, code: (res && res.code) || 'empty' };
    }
    const v = res.value;
    if (!v || !Array.isArray(v.issues) || !v.issues.length) {
      return { ok: false, code: 'empty' };
    }
    if (listIssues().length) {
      return { ok: true, restored: false, count: 0 };
    }
    writeJson(ISSUES_KEY, { issues: v.issues.slice(0, HISTORY_MAX) });
    if (v.used && typeof v.used === 'object') {
      writeJson(USED_KEY, v.used);
    }
    if (v.quota && v.quota.week) {
      writeJson(QUOTA_KEY, v.quota);
    }
    if (v.seen) {
      writeJson(SEEN_KEY, v.seen);
    }
    return { ok: true, restored: true, count: v.issues.length };
  });
}

module.exports = {
  HISTORY_MAX,
  getUsed,
  markUsed,
  resetUsed,
  weekLeft,
  bumpWeek,
  usedInWeek,
  listIssues,
  saveIssue,
  getWeekIssue,
  lastTheme,
  getIssueById,
  randomIssue,
  starIssue,
  isNew,
  markSeen,
  backupSilent,
  restoreFromCloud,
};
