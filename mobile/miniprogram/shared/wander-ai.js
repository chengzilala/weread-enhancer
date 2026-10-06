/**
 * 灵感漫游（M12）· 六段式 AI 成文（DeepSeek Key 为使用前置）
 *
 * 复用云函数 action:'ai' 通道（见 ai.js 的 callAI），把一组「划线 / 想法」编织成一篇主题综述：
 *   标题 / 摘要 / 正文 / 来源可见（来源由页面直接展示，不交给 AI）/ 外部火花 / 创作种子。
 * 策略：灵感漫游以 AI 综述为核心 —— **未配 DeepSeek Key 由页面层拦截、不生成内容**；
 * AI 调用失败也不再退回本地模板（页面提示错误 + 重试）。本地兜底文案只作为解析失败时的占位，
 * 不对外展示。本函数永不 reject。
 *
 * 红线：
 *   1) 外部火花只做「概念呼应 / 案例联想 / 边界挑战」；可带出处（优先读者自己的书，其次公开经典），
 *      但**绝不编造书名 / 作者**——拿不准就留空 source；UI 侧统一标注「AI 联想 · 未核实」。
 *   2) 严格基于用户自己的划线 / 想法原文，禁止编造原文、禁止杜撰用户没读过的书或没做过的事；
 *      正文里逐字引用读者原文的句子用 [[ ]] 标出，供前端加下划线定位。
 * Key 由用户自填、只存本机；素材原文随本次请求经云函数转发 DeepSeek，不落库、日志仅掩码。
 */
const { callAI } = require('./ai');

function basePrompt(tier) {
  const words = (tier && tier.words) || 400;
  const sparks = (tier && tier.sparks) || 2;
  const seeds = (tier && tier.seeds) || 2;
  return '你是「灵感漫游」的主笔，一位克制、博学、诚实的读书编者。' +
    '读者会给你一组「他自己在微信读书里划下的原句」以及「他自己写下的想法」，并给出它们共同的主题。' +
    '请把这些素材编织成一篇「主题综述」，只输出一个 JSON 对象，形如：' +
    '{"title":"…","summary":"…","body":"…","sparks":[{"text":"…","source":"…"}],"seeds":[{"angle":"切入","line":"…"}]}。字段要求：' +
    '1) title：一句立论，不超过 20 个字，点出这组素材真正在谈什么；' +
    '2) summary：核心主张，2 句、不超过 80 字；' +
    '3) body：正文，把多条素材编织成一篇连贯的短文（目标约 ' + words + ' 字，上下浮动不超过 20%），' +
    '用第二人称「你」；要清楚交代各自来自哪本书，让读者看得出话是谁说的；' +
    '⚠️ 凡是逐字引用读者的划线 / 想法原文，必须用 [[ 和 ]] 把这句原文前后包起来（例：[[我们被引导着走向结果]]）；' +
    '转述、串联、以及你自己的解读，一律不要加这对标记；' +
    '4) sparks：外部火花，' + sparks + ' 个对象，形如 {"text":"一句概念呼应，不超过 60 字","source":"出处"}，只做「概念呼应 / 案例联想 / 边界挑战」；' +
    'source 取值：优先引用「读者书架里已有的书」（见文末书单，写成「《书名》 · 作者」）；' +
    '其次可呼应公开经典 / 公版著作，同样写成「《书名》 · 作者」；' +
    '⚠️ 绝不编造书名或作者——拿不准出处、或只是纯概念联想时，source 一律留空字符串 ""；' +
    '5) seeds：创作种子，' + seeds + ' 个，每个为 {"angle":"切入|逆向|转译","line":"一句可直接下笔的开头"}。' +
    '总要求：严格基于给出的素材，不得编造原文，不得杜撰读者没读过的书、没做过的事；' +
    '只描述、不评判，不使用任何负向词；不要输出 Markdown、不要序号符号；除 JSON 外不要输出任何文字。';
}

/** 用素材拼出给 AI 的用户消息（只含用户自己的划线 / 想法原文与出处） */
function buildPrompt(material, tier, context) {
  const theme = (material && material.theme) || '综合';
  const list = (material && material.materials) || [];
  let prompt = '主题：' + theme + '\n素材（全部来自读者本人的微信读书，共 ' + list.length + ' 条）：\n';
  prompt += list.map((item, index) => {
    const tag = item.kind === 'review' ? '【我的想法】' : '【划线】';
    return (index + 1) + '. ' + tag + '「' + item.text + '」——《' + (item.title || '未命名') + '》'
      + (item.author ? (' · ' + item.author) : '');
  }).join('\n');
  const books = (context && context.bookTitles) || [];
  if (books.length) {
    prompt += '\n\n读者书架里已有的书（外部火花想呼应「他自己的书」时，只能从这份书单里选）：\n';
    prompt += books.slice(0, 40).map((book) => '《' + book.title + '》' + (book.author ? (' · ' + book.author) : '')).join('、');
  }
  prompt += '\n\n请按要求输出 JSON（title / summary / body / sparks / seeds）。';
  return prompt;
}

/** 把 AI 文本解析成六段式对象：JSON 优先，失败则尽力从文本里兜底 */
function parseIssue(text) {
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
  if (!obj || typeof obj !== 'object') {
    return { title: '', summary: '', body: raw, sparks: [], seeds: [] };
  }
  const sparks = (Array.isArray(obj.sparks) ? obj.sparks : [])
    .map((item) => {
      if (typeof item === 'string') {
        return { text: String(item).trim(), source: '' };
      }
      return {
        text: String((item && item.text) || '').trim(),
        source: String((item && item.source) || '').trim(),
      };
    })
    .filter((item) => item.text);
  const seeds = (Array.isArray(obj.seeds) ? obj.seeds : [])
    .map((item) => {
      if (typeof item === 'string') {
        return { angle: '切入', line: item.trim() };
      }
      return { angle: String((item && item.angle) || '切入').trim(), line: String((item && item.line) || '').trim() };
    })
    .filter((item) => item.line);
  return {
    title: String(obj.title || '').trim(),
    summary: String(obj.summary || '').trim(),
    body: String(obj.body || '').trim(),
    sparks: sparks,
    seeds: seeds,
  };
}

/**
 * 占位文案：解析失败时兜底，不再用于「无 Key 降级」展示（页面已拦截未配 Key）。
 * 只说明「这是素材合辑」，把连接与解读留给读者自己。
 */
function localIssue(material, tier) {
  const theme = (material && material.theme) || '';
  const list = (material && material.materials) || [];
  const title = theme ? ('关于「' + theme + '」的一组笔记') : '这一周，重读几段划线';
  const scope = theme ? ('围绕「' + theme + '」的') : '';
  const summary = '本期从你的划线 / 想法里挑出 ' + list.length + ' 条' + scope + '片段，编排在一起。';
  const body = '未配置 DeepSeek Key，本期不做 AI 综述——只把你自己的素材按顺序排在这里，'
    + '供你自己串读、自己连接。在「我的 → 设置」里填好 DeepSeek Key 后，再点「重新生成」，'
    + '这里会换成由这些素材编织成的主题综述。';
  return {
    ai: false,
    title: title,
    summary: summary,
    body: body,
    sparks: [],
    seeds: [],
  };
}

/**
 * 生成一期文案：主入口，永不 reject。
 * @returns {object} { ai, title, summary, body, sparks[], seeds[], code?, error? }（ai=false 表示调用 / 解析失败，由页面提示错误与重试）
 */
async function generateWanderText(material, tier, context) {
  const fallback = localIssue(material, tier);
  const list = (material && material.materials) || [];
  if (!list.length) {
    return fallback;
  }
  const res = await callAI([
    { role: 'system', content: basePrompt(tier) },
    { role: 'user', content: buildPrompt(material, tier, context) },
  ]);
  if (res && res.ok) {
    const parsed = parseIssue(res.text);
    if (parsed.body) {
      return {
        ai: true,
        title: parsed.title || fallback.title,
        summary: parsed.summary || fallback.summary,
        body: parsed.body,
        sparks: parsed.sparks.slice(0, (tier && tier.sparks) || 3),
        seeds: parsed.seeds.slice(0, (tier && tier.seeds) || 3),
      };
    }
    return {
      ai: false,
      title: fallback.title,
      summary: fallback.summary,
      body: fallback.body,
      sparks: [],
      seeds: [],
      code: 'parse',
      error: 'AI 返回内容无法解析',
    };
  }
  return {
    ai: false,
    title: fallback.title,
    summary: fallback.summary,
    body: fallback.body,
    sparks: [],
    seeds: [],
    code: (res && res.code) || 'cloud',
    error: (res && res.error) || 'AI 调用失败',
  };
}

module.exports = { generateWanderText, localIssue };
