/**
 * 每日卡片 · 「确保今天有一张」的复用入口
 *
 * 供首页「每天首次打开自动弹窗」复用与每日卡片页同一套生成口径：
 * 本机已有今日卡片则直接返回，否则按「拉素材池 → 抽签选材 → AI 成文（未配 Key 走本地模板）」生成并落盘。
 * 与每日卡片页的进入懒生成同口径：不消耗「重新生成」次数；只读 / 写本机存储，不落库、不上云。
 */
const store = require('./store');
const core = require('./daily-core');
const db = require('./daily-store');
const dailyData = require('./daily-data');
const { generateDailyText } = require('./daily-ai');
const { messageOf } = require('./errors');

/**
 * 确保「今天」有一张卡片。
 * @returns {object}
 *   { ok:true, fromCache, card, view }
 *   或 { ok:false, code, error }（通用失败）
 *   或 { ok:false, code:'material', reason:'material', count, need }（素材不足，走引导）
 */
async function ensureTodayCard() {
  const existing = db.getTodayCard();
  if (existing) {
    return { ok: true, fromCache: true, card: existing, view: core.toView(existing) };
  }

  const key = store.getKey();
  if (!key) {
    return { ok: false, code: 'nokey', error: '还没有配置微信读书 API Key' };
  }

  const poolRes = await dailyData.fetchPool(key, false);
  if (!poolRes.ok) {
    if (poolRes.code === 'nocorpus') {
      return { ok: false, code: 'material', reason: 'material', count: 0, need: core.MATERIAL_MIN };
    }
    return { ok: false, code: poolRes.code, error: messageOf(poolRes, '读取数据失败') };
  }

  const material = core.prepareMaterial(poolRes.pool, db.getUsed());
  if (!material.ok) {
    return {
      ok: false,
      code: 'material',
      reason: 'material',
      count: material.count || 0,
      need: material.need || core.MATERIAL_MIN,
    };
  }
  if (material.resetUsed) {
    db.resetUsed();
  }

  const text = await generateDailyText(material);
  const card = core.makeCard(material, text);
  db.saveCard(card);
  db.markUsed(material.main.text);
  return { ok: true, fromCache: false, card: card, view: core.toView(card) };
}

module.exports = { ensureTodayCard };
