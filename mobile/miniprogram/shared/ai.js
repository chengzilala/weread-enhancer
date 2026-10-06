/**
 * DeepSeek AI 通道（底层 callAI）— B3 人格画像 / M11 每日卡片共用
 *
 * 只做「润色 / 串联」，不改变本机已算好的事实。
 * Key 由用户自填，只存本机；经云函数 wereadProxy（action:'ai'）转发，不落库、日志仅掩码。
 * 未配置 Key 时返回 { ok:false, code:'nokey' }，由调用方（页面）引导填写。
 *
 * 人格画像提示词与浏览器插件 modules/official.js 的 AI_READING_PERSONA_PROMPT 保持一致。
 * 每日卡片的提示词 / 解析 / 降级见 daily-ai.js。
 */
const { PROXY_FUNCTION, AI_ENABLED } = require('../config');
const store = require('./store');

const SYSTEM_PROMPT = '你是一位克制、有洞察的阅读分析师。' +
  '用户已经在本机用固定规则算出了一套「阅读人格」四维判定（这不是心理测评），请你只做「润色」：' +
  '把这些冷冰冰的判定，写成一段有温度、有代入感的人格化画像。' +
  '要求：1) 用中文、第二人称「你」，真诚、克制，像懂他的朋友在说话，不浮夸、不堆形容词；' +
  '2) 严格基于所给的代码、主称号、四维判定值与证据，不得虚构任何数字，也不得杜撰用户没做过的事；' +
  '3) 结构为两段：第一段用一个生活化的比喻点出这个人格的整体气质（呼应主称号）；第二段结合四维与证据，写出这种气质在真实阅读里的样子；' +
  '4) 只描述、不评判，不使用任何负向词（如懒惰/浅薄/拖延）；' +
  '5) 不要输出标题、序号或任何 Markdown 符号，直接输出两段正文，段与段之间空一行。';

/** 用「视图人格」拼出给 AI 的用户消息（纯客观数据，不含任何隐私原文之外的推断） */
function buildPrompt(persona) {
  const dimLines = (persona.dims || []).map((dim) => (dim.available
    ? ('- ' + dim.title + '：' + dim.leftLabel + ' ' + dim.pct + '% ↔ ' + (100 - dim.pct) + '% ' + dim.rightLabel + (dim.basis ? '（依据：' + dim.basis + '）' : ''))
    : ('- ' + dim.title + '：数据不足')));
  const evidence = (persona.evidence && persona.evidence.data) || [];
  const quotes = (persona.evidence && persona.evidence.quotes) || [];

  let prompt = '阅读人格代码：' + persona.code +
    '\n主称号：' + persona.name +
    '\n一句定调：' + persona.tagline;
  if (persona.nicknames && persona.nicknames.length) {
    prompt += '\n三个特质绰号：' + persona.nicknames.join('、');
  }
  prompt += '\n四维判定：\n' + dimLines.join('\n');
  if (evidence.length) {
    prompt += '\n数据证据：' + evidence.join('、');
  }
  if (quotes.length) {
    prompt += '\n原文证据：\n' + quotes.map((q) => '「' + q.text + '」——《' + (q.title || '未命名') + '》').join('\n');
  }
  return prompt;
}

/** 底层：把对话交给云函数转发 DeepSeek（Key 由用户自填、只存本机）。永不 reject。 */
function callAI(messages) {
  return new Promise((resolve) => {
    // M15 合规开关：关闭时小程序内不产生任何 AI 生成内容（此分支只作兜底，页面已不再调用）
    if (!AI_ENABLED) {
      resolve({ ok: false, code: 'disabled', error: '当前版本不提供该能力' });
      return;
    }
    const key = store.getDeepSeekKey();
    if (!key) {
      resolve({ ok: false, code: 'nokey', error: '尚未配置 DeepSeek API Key' });
      return;
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      resolve({ ok: false, code: 'cloud', error: '当前环境不支持云开发' });
      return;
    }
    wx.cloud
      .callFunction({ name: PROXY_FUNCTION, data: { action: 'ai', apiKey: key, messages: messages } })
      .then((res) => {
        const result = res && res.result;
        if (!result || typeof result.ok !== 'boolean') {
          resolve({ ok: false, code: 'empty', error: '云函数未返回有效结果' });
          return;
        }
        resolve(result);
      })
      .catch((err) => {
        resolve({ ok: false, code: 'cloud', error: (err && err.errMsg) || '云函数调用失败' });
      });
  });
}

/** 生成 AI 人格画像：主入口，永不 reject */
async function generatePersonaPortrait(persona) {
  if (!persona || !persona.code) {
    return { ok: false, code: 'param', error: '缺少人格结果' };
  }
  return await callAI([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildPrompt(persona) },
  ]);
}

module.exports = { generatePersonaPortrait, callAI };
