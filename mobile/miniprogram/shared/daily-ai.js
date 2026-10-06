/**
 * 每日卡片回顾（M11）· AI 成文（DeepSeek Key 为使用前置）
 *
 * 复用云函数 action:'ai' 通道（见 ai.js 的 callAI），把「主划线 + 同主题旧划线」写成一篇小回顾
 * （引用由页面直接展示，这里只产出 标题 + 说明；说明在页面上标注「AI 生成」）。
 * 策略：每日卡片以 AI 解读为核心 —— **未配 DeepSeek Key 由页面层拦截、不生成卡片**；
 * AI 调用失败也不再退回本地模板（页面提示错误 + 重试）。本地兜底文案只作为解析失败时的占位标题，
 * 不对外展示。本函数永不 reject。
 * Key 由用户自填、只存本机；素材原文随本次请求经云函数转发 DeepSeek，不落库、日志仅掩码。
 */
const { callAI } = require('./ai');

const DAILY_SYSTEM_PROMPT = '你是一位克制、爱读书的回顾写作者。' +
  '用户会给你一条「主划线」——他本人在微信读书里划下的一句话（也可能是他自己写下的想法），' +
  '可能还有几条「他自己过去划下或写下的旧句」。' +
  '请写一段小小的回顾，必须把下面三件事说清楚：' +
  '1) 读懂这段文字本身：它到底在说什么，把作者的想法用你自己的话讲明白（可以结合书名与作者做一点背景解释，但不得编造原文里没有的事实）；' +
  '2) 猜测「他当时为什么会划下（或写下）这段话」：具体是哪个词、哪句说法击中了他，为什么这种说法会让人想留一笔；只做合理推测，用「你也许是」「大概是」「或许」这类推测语气，不要断言，不要写成心理诊断；' +
  '3) 如果同时给了旧句，就一条条说清它和主划线的关系：是同一个念头、一组对照，还是一次延伸；要说出它们共同的关键词或意象，不要用「互相呼应 / 互相照亮 / 彼此映照」这类空话；如果确实找不到直接关联，就老实说没找到，只谈主划线，不要硬扯。' +
  '要求：1) 用中文、第二人称「你」，真诚、克制，像懂他的朋友在说话，不喊口号、不堆形容词；' +
  '2) 严格基于给出的原文，不得编造原文，不得杜撰用户没读过的书、没做过的事；' +
  '3) 只描述、不评判，不使用任何负向词；' +
  '4) 只输出一个 JSON 对象，形如 {"title":"…","note":"…"}：title 不超过 18 个字，点出这段文字真正的主题；' +
  'note 为 3 到 5 句、合计不超过 240 字，按上面三件事的顺序讲，用中文标点自然断句。' +
  '不要输出 JSON 以外的任何文字，不要 Markdown。';

/** 用素材拼出给 AI 的用户消息（只含用户自己的划线 / 想法原文与出处） */
function buildPrompt(material) {
  const main = material.main || {};
  const kindLabel = main.kind === 'review' ? '想法（用户自己写下的）' : '划线';
  let prompt = '主' + kindLabel + '（来自用户本人的微信读书）：\n「' + main.text + '」——《' + (main.title || '未命名') + '》'
    + (main.author ? (' · ' + main.author) : '');
  const related = material.related || [];
  if (related.length) {
    prompt += '\n\n用户过去划下 / 写下的旧句（与主划线同主题，可用来做关联）：\n';
    prompt += related.map((item, index) => {
      const tag = item.kind === 'review' ? '（他的想法）' : '';
      return (index + 1) + '. 「' + item.text + '」' + tag + '——《' + (item.title || '未命名') + '》';
    }).join('\n');
  } else {
    prompt += '\n\n这次没有找到可关联的旧句，请只围绕这条主划线解读，不要硬扯关联。';
  }
  prompt += '\n\n请按要求写出 title 与 note。';
  return prompt;
}

/** 从 AI 文本里解析出 { title, note }：JSON 优先，失败则首行做标题、其余做说明 */
function parseText(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let obj = null;
  try {
    obj = JSON.parse(raw);
  } catch (err) {
    const matched = raw.match(/\{[\s\S]*\}/);
    if (matched) {
      try {
        obj = JSON.parse(matched[0]);
      } catch (err2) {
        obj = null;
      }
    }
  }
  if (obj && (obj.title || obj.note)) {
    return { title: String(obj.title || '').trim(), note: String(obj.note || '').trim() };
  }
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    return { title: '', note: '' };
  }
  return { title: lines[0].slice(0, 40), note: lines.slice(1).join('\n') || raw };
}

/**
 * 占位标题 / 说明：解析失败时兜底，不再用于「无 Key 降级」展示（页面已拦截未配 Key）。
 * 只摆清素材事实，不写「互相照亮」这类空话，也不假装解读。
 */
function localText(material) {
  const main = (material && material.main) || {};
  const theme = (material && material.themes && material.themes[0]) || '';
  const isNote = main.kind === 'review';
  const from = main.title ? ('《' + main.title + '》') : '你读过的书';
  const title = theme
    ? ('重读一段关于「' + theme + '」的' + (isNote ? '想法' : '划线'))
    : ('今天，重读一段' + (isNote ? '想法' : '划线'));
  const head = isNote
    ? ('这是你写在' + from + '里的想法。')
    : ('这是你在' + from + '里划下的一段话。');
  const related = (material && material.related) || [];
  const tail = related.length
    ? ('下面还有 ' + related.length + ' 条你自己划过的旧句，它们和这句共享同一个主题；点开对照着看，或许能想起当时为什么留意它们。')
    : '先把这句读两遍：它出现在书里的哪一段、当时你正想着什么，答案只能由你自己补上。';
  return { title: title, note: head + tail };
}

/**
 * 生成卡片文案：主入口，永不 reject。
 * @returns {object} { ai, title, note, code?, error? }（ai=false 表示调用 / 解析失败，由页面提示错误与重试）
 */
async function generateDailyText(material) {
  const fallback = localText(material);
  if (!material || !material.main || !material.main.text) {
    return { ai: false, title: fallback.title, note: fallback.note };
  }
  const res = await callAI([
    { role: 'system', content: DAILY_SYSTEM_PROMPT },
    { role: 'user', content: buildPrompt(material) },
  ]);
  if (res && res.ok) {
    const parsed = parseText(res.text);
    if (parsed.note) {
      return { ai: true, title: parsed.title || fallback.title, note: parsed.note };
    }
    return { ai: false, title: fallback.title, note: fallback.note, code: 'parse', error: 'AI 返回内容无法解析' };
  }
  return {
    ai: false,
    title: fallback.title,
    note: fallback.note,
    code: (res && res.code) || 'cloud',
    error: (res && res.error) || 'AI 调用失败',
  };
}

module.exports = { generateDailyText, localText };
