/**
 * 每日卡片 · 「确保今天有一张」的复用入口
 *
 * 供首页「每天首次打开自动弹窗」复用与每日卡片页同一套生成口径：
 * 本机已有今日卡片则直接返回，否则按「拉素材池 → 抽签选材 → 排版」生成并落盘。
 *
 * M15 去 AI 后：卡片改为**纯本地规则排版**——只排布读者自己的划线原文 + 出处，
 * 以及规则召回的同主题旧划线，不做任何生成 / 解读文案；因此**不再需要 DeepSeek Key**。
 * （AI 成文代码保留在 daily-ai.js，仅由 config.AI_ENABLED 开关控制是否启用。）
 * 与每日卡片页同口径：不消耗「重新生成」次数；只读 / 写本机存储，不落库、不上云。
 */
const { AI_ENABLED } = require('../config');
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
  if (AI_ENABLED && !store.getDeepSeekKey()) {
    return { ok: false, code: 'nokey_ds', error: '每日卡片需要 DeepSeek Key，请在「我的 → 设置」里填写' };
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

  // AI 开启时走 AI 成文；M15 关闭时走纯本地规则排版（无 note、无解读）
  let text;
  if (AI_ENABLED) {
    text = await generateDailyText(material);
    if (!text.ai) {
      return { ok: false, code: text.code || 'ai', error: messageOf(text, '生成失败，请重试') };
    }
  } else {
    text = { ai: false, title: core.localTitle(material), note: '' };
  }

  const card = core.makeCard(material, text);
  db.saveCard(card);
  db.markUsed(material.main.text);
  return { ok: true, fromCache: false, card: card, view: core.toView(card) };
}

module.exports = { ensureTodayCard };
