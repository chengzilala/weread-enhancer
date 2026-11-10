/**
 * 灵感漫游（M12）· 取数
 *
 * 两个用途：
 *   1) fetchCounts —— 只用「书架 + 笔记概览」（30 分钟缓存）估算累计划线 / 想法条数，用于判定门槛与分级；
 *   2) fetchPool   —— 复用 M11 的素材池（笔记最多的前 N 本书的划线 / 想法原文，10 分钟缓存）。
 * 只做取数与整形，不做门槛判定（判定见 wander-core.tierProgress）。
 * 红线：API Key 由调用方传入，本模块只转发、不落库、不写日志。
 */
const data = require('./data');
const { notebookStats } = require('./report-core');
const dailyData = require('./daily-data');

/**
 * 估算累计「划线 / 想法」条数（来自 /user/notebooks 各书 noteCount / reviewCount 之和）。
 * @returns {object} { ok:true, marks, thoughts, hasNotebooks } 或 { ok:false, code, error }
 */
async function fetchCounts(apiKey, force) {
  // M17：先用「笔记列表」缓存（24 小时，通常 0 次调用）估门槛；没有再取一次
  let notesRes = force ? { ok: false } : data.peekNotebooksBrief();
  if (!notesRes.ok) {
    notesRes = await data.fetchNotebooksBrief(apiKey, !!force);
  }
  if (notesRes.ok && notesRes.notebooks) {
    const briefStats = notebookStats(notesRes.notebooks);
    return {
      ok: true,
      marks: briefStats ? briefStats.noteTotal : 0,
      thoughts: briefStats ? briefStats.reviewTotal : 0,
      hasNotebooks: !!(notesRes.notebooks.books && notesRes.notebooks.books.length),
    };
  }

  // 兜底：旧的「书架 + 笔记概览」链路（30 分钟缓存，多花 1 次书架调用）
  const overviewRes = await data.fetchOverview(apiKey, force);
  if (!overviewRes.ok) {
    return { ok: false, code: overviewRes.code || 'overview', error: overviewRes.error || '读取笔记数据失败' };
  }
  const stats = notebookStats(overviewRes.notebooks);
  return {
    ok: true,
    marks: stats ? stats.noteTotal : 0,
    thoughts: stats ? stats.reviewTotal : 0,
    hasNotebooks: !!overviewRes.notebooks,
  };
}

/** 素材池（与每日卡片共用本机素材库；漫游模式一次取 3 本，保证跨书） */
function fetchPool(apiKey, force) {
  return dailyData.fetchPool(apiKey, force, 'wander');
}

module.exports = { fetchCounts, fetchPool };
