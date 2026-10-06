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

/** 素材池（复用 M11 口径：笔记最多的前 N 本书的划线 / 想法原文） */
function fetchPool(apiKey, force) {
  return dailyData.fetchPool(apiKey, force);
}

module.exports = { fetchCounts, fetchPool };
