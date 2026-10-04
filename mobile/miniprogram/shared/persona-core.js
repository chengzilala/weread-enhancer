/**
 * 阅读人格「纯计算」核心 — 小程序端共享模块
 *
 * 来源：从插件 modules/official.js 抽取的纯函数（不改动插件行为）。
 * 红线：纯本机计算、零外部依赖（不含中文分词库）；判定不含随机、不依赖 AI（可复算）；
 *       对外不构成专业心理测评（页面须固定声明「趣味参考、非心理测评」）。
 */

const { fmtDuration } = require('./format');
const {
  hourlyReadTime,
  reportBuckets,
  shelfCounts,
  shelfCategories,
  notebookStats,
  finishStats,
  buildPersona,
} = require('./report-core');

// ---- 常量（与官方插件对齐）----
const PERSONA_MIN_SECONDS = 10 * 3600;   // 数据门槛（累计）：有效阅读 ≥ 10 小时
const PERSONA_MIN_NOTES = 20;            // 数据门槛（累计）：笔记（划线+想法）≥ 20 条
const PERSONA_WORD_TOP = 10;             // 高频词 TOP N
const PERSONA_CLOUD_TOP = 15;            // 词云词数
const PERSONA_QUOTE_MAX = 3;             // 原文证据最多条数

// D2 内容取向：分类标题 → 求实 / 求意（按关键词包含匹配，未命中记为中性、不参与占比）
const PERSONA_FACT_KEYS = ['职场', '经济', '理财', '金融', '投资', '管理', '商业', '营销', '创业', '科技', '互联网', '计算机', '程序', '软件', '工程', '算法', '效率', '工具', '方法', '教育', '学习', '备考', '考试', '健康', '医学', '养生', '运动', '健身', '成长', '提升', '励志', '成功', '沟通', '谈判', '时间管理', '认知升级'];
const PERSONA_MEANING_KEYS = ['文学', '小说', '散文', '诗歌', '随笔', '历史', '哲学', '思想', '心理', '精神', '社科', '社会', '文化', '艺术', '音乐', '绘画', '电影', '设计', '传记', '人物', '宗教', '信仰', '美学', '生活', '旅行', '自然', '博物', '国学', '古籍'];

// D3 表达方式：逻辑词 / 情感词（本地词表计数）
const PERSONA_LOGIC_WORDS = ['因为', '所以', '因此', '由于', '本质', '逻辑', '系统', '结构', '方法', '步骤', '数据', '结论', '假设', '验证', '机制', '原理', '模型', '规律', '分析', '证明', '推理', '认知', '定义', '概念', '框架', '策略', '效率', '原因', '结果', '条件', '标准', '问题', '答案', '关键', '核心', '路径', '过程', '变量', '概率', '成本', '收益', '边界', '视角', '层面', '维度', '前提', '矛盾', '悖论', '反思', '审视', '拆解', '推导', '归纳', '演绎', '判断', '决策', '选择', '证据', '事实', '真相', '客观', '理性'];
const PERSONA_EMOTION_WORDS = ['喜欢', '感动', '难过', '温暖', '孤独', '美好', '心疼', '遗憾', '幸福', '痛苦', '开心', '快乐', '悲伤', '愤怒', '焦虑', '平静', '希望', '失望', '勇敢', '温柔', '治愈', '想念', '怀念', '珍惜', '放下', '陪伴', '理解', '尊重', '热爱', '真诚', '善良', '感激', '感谢', '害怕', '担心', '不安', '欣慰', '满足', '柔软', '心碎', '心酸', '释然', '宁静', '浪漫', '诗意', '自由'];

// 情绪比例：正向 / 负向词表（中性 = 未命中任何情绪词的句）
const PERSONA_POSITIVE_WORDS = ['喜欢', '感动', '温暖', '美好', '幸福', '开心', '快乐', '平静', '希望', '勇敢', '温柔', '治愈', '珍惜', '陪伴', '理解', '尊重', '热爱', '真诚', '善良', '感激', '感谢', '欣慰', '满足', '释然', '宁静', '浪漫', '诗意', '自由', '幸运', '惊喜'];
const PERSONA_NEGATIVE_WORDS = ['难过', '孤独', '心疼', '遗憾', '痛苦', '悲伤', '愤怒', '焦虑', '失望', '害怕', '担心', '不安', '心碎', '心酸', '恐惧', '绝望', '压抑', '委屈', '疲惫', '厌倦', '悔恨', '麻木'];

// 主题词：把高频词归并到 5 个主题（取第一个命中的主题）
const PERSONA_THEMES = [
  { name: '自我与成长', words: ['自己', '成长', '改变', '选择', '人生', '意义', '价值', '目标', '习惯', '行动', '时间', '自由', '勇气', '坚持', '努力', '命运', '身份', '边界', '孤独', '存在'] },
  { name: '关系与情感', words: ['关系', '朋友', '喜欢', '家人', '陪伴', '理解', '情绪', '感受', '温柔', '温暖', '爱', '想念', '遗憾', '幸福', '痛苦', '悲伤', '沟通', '信任', '善意', '亲情'] },
  { name: '方法与效率', words: ['方法', '系统', '逻辑', '结构', '效率', '计划', '问题', '答案', '思维', '学习', '知识', '策略', '决策', '模型', '框架', '认知', '习惯', '工具', '实践', '复盘'] },
  { name: '历史与社会', words: ['历史', '社会', '文化', '世界', '时代', '国家', '制度', '经济', '城市', '文明', '政治', '战争', '权力', '秩序', '变革', '群体', '市场', '组织', '规则', '趋势'] },
  { name: '文学与艺术', words: ['文学', '小说', '故事', '诗歌', '艺术', '文字', '语言', '想象', '阅读', '写作', '音乐', '电影', '绘画', '美', '诗', '镜头', '意象', '叙事', '散文', '旋律'] },
];

// 常见停用词 / 功能词（仅用于过滤 n-gram 候选，不参与正向词表匹配）
const PERSONA_STOPWORDS = ['我们', '你们', '他们', '她们', '这个', '那个', '这些', '那些', '一个', '一种', '一样', '一些', '什么', '怎么', '这样', '那样', '如果', '但是', '可是', '然后', '而且', '并且', '或者', '还是', '就是', '只是', '而是', '不是', '没有', '不能', '可以', '能够', '应该', '需要', '进行', '通过', '对于', '关于', '以及', '已经', '正在', '自己', '它', '他们'];

// 16 型命名表（主称号 + 一句定调）
const PERSONA_TYPES = {
  DFLP: ['书房里的匠人', '把一本书当成一门手艺，读完还要动手做一遍'],
  DFLR: ['深夜的修表匠', '喜欢把一个问题拆到零件级，慢慢调准'],
  DFEP: ['养蜂人的田野笔记', '认真生活、认真记录，读完就想用在自己身上'],
  DFER: ['炉边的采药人', '随手翻，翻到了就种草，读一点用一点'],
  DMLP: ['解经的学徒', '系统地读，一心想把道理彻底想通'],
  DMLR: ['深夜的勘探者', '一个人往深处挖，挖到哪算哪'],
  DMEP: ['点灯的诗经学者', '又感性又较真，把喜欢的东西读成自己的'],
  DMER: ['夜航的摘星人', '顺着情绪和好奇心走，深潜，但不设路线'],
  BFLP: ['效率编辑部', '目标明确、口味实用，读书像在开选题会'],
  BFLR: ['逛书店的采购员', '什么都看，好东西先囤起来再说'],
  BFEP: ['生活小百科', '生活里遇到什么就查什么，读完立刻分享'],
  BFER: ['街角读书会', '杂食、热情、什么都想聊两句'],
  BMLP: ['知识地图绘制者', '有计划地铺开，一心想把整张地图画完'],
  BMLR: ['思想的漫游者', '跨着读，读着读着就串成一条线'],
  BMEP: ['讲故事的引路人', '爱读人的故事，也爱把故事讲给别人听'],
  BMER: ['赶集的说书人', '什么热闹读什么，读完就开讲'],
};

// 三个特质绰号：各维极点 → 绰号池
const PERSONA_NICKNAMES = {
  energyD: '深潜者', energyB: '杂食派',
  contentF: '解决问题的人', contentM: '意义收集者',
  styleL: '拆解者', styleE: '共情者',
  rhythmP: '清单执行者', rhythmR: '缘读者',
};

// 16 型人物对照（公共领域文化名人，仅用于文案展示，不使用真人照片）
const PERSONA_FIGURES = {
  DFLP: { name: '牛顿', line: '像牛顿那样，把一本书读成一门手艺' },
  DFLR: { name: '达·芬奇', line: '像达·芬奇那样，把问题拆到零件级' },
  DFEP: { name: '达尔文', line: '像达尔文那样，长期观察、认真记录' },
  DFER: { name: '阿基米德', line: '像阿基米德那样，边玩边试，学了就用' },
  DMLP: { name: '康德', line: '像康德那样，极度规律，系统想通' },
  DMLR: { name: '图灵', line: '像图灵那样，独自往抽象深处挖' },
  DMEP: { name: '苏轼', line: '像苏轼那样，又深情又较真' },
  DMER: { name: '李白', line: '像李白那样，浪漫随性，投入极深' },
  BFLP: { name: '爱迪生', line: '像爱迪生那样，目标明确、成体系地做' },
  BFLR: { name: '马克·吐温', line: '像马克·吐温那样，什么都读，先囤再说' },
  BFEP: { name: '李时珍', line: '像李时珍那样，生活里观察，温暖又细致' },
  BFER: { name: '莫扎特', line: '像莫扎特那样，杂食热情、爱分享' },
  BMLP: { name: '亚里士多德', line: '像亚里士多德那样，有计划地铺开整张地图' },
  BMLR: { name: '蒙田', line: '像蒙田那样，跨着读，串成一条线' },
  BMEP: { name: '安徒生', line: '像安徒生那样，爱读故事，也爱讲给人听' },
  BMER: { name: '莎士比亚', line: '像莎士比亚那样，什么热闹读什么，读完就开讲' },
};

// ---- 基础工具 ----
function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

/** 非重叠出现次数（用于词表计数） */
function personaCountOccurrences(text, word) {
  if (!text || !word) {
    return 0;
  }
  let count = 0;
  let index = 0;
  while (true) {
    const found = text.indexOf(word, index);
    if (found < 0) {
      break;
    }
    count += 1;
    index = found + word.length;
  }
  return count;
}

/** 秒级时间戳（兼容毫秒）→ 年份字符串 */
function personaYear(at) {
  const num = Number(at) || 0;
  if (!num) {
    return '';
  }
  const ms = num > 1e12 ? num : num * 1000;
  return String(new Date(ms).getFullYear());
}

/** 分类标题 → 求实 / 求意 / 中性 */
function personaCategoryPolarity(name) {
  const text = String(name || '');
  if (!text) {
    return 'neutral';
  }
  for (let i = 0; i < PERSONA_MEANING_KEYS.length; i += 1) {
    if (text.indexOf(PERSONA_MEANING_KEYS[i]) >= 0) {
      return 'meaning';
    }
  }
  for (let i = 0; i < PERSONA_FACT_KEYS.length; i += 1) {
    if (text.indexOf(PERSONA_FACT_KEYS[i]) >= 0) {
      return 'fact';
    }
  }
  return 'neutral';
}

// ---- 词语分析（零依赖：正向词表 + 停用词过滤的 n-gram）----
let personaLexicon = null;
function personaGetLexicon() {
  if (personaLexicon) {
    return personaLexicon;
  }
  const set = {};
  const addAll = (arr) => arr.forEach((word) => {
    if (word && word.length >= 2) {
      set[word] = true;
    }
  });
  addAll(PERSONA_LOGIC_WORDS);
  addAll(PERSONA_EMOTION_WORDS);
  addAll(PERSONA_POSITIVE_WORDS);
  addAll(PERSONA_NEGATIVE_WORDS);
  PERSONA_THEMES.forEach((theme) => addAll(theme.words));
  personaLexicon = set;
  return set;
}

const PERSONA_STOP_CHARS = '的了是在和有你他她它们这那就都而及或但并却被把让给对从向到于为以之其所以则又还更最不了没一二三上下中大小多少个之乎者也';

/** 切分为连续中文片段（去掉标点/数字/英文） */
function personaSplitRuns(text) {
  return String(text || '').split(/[^\u4e00-\u9fa5]+/).filter(Boolean);
}

/** 词频统计：正向词表最大匹配（高权重）+ n-gram 兜底（过滤停用词） */
function personaCountWords(text) {
  const lexicon = personaGetLexicon();
  const stopSet = {};
  PERSONA_STOPWORDS.forEach((word) => { stopSet[word] = true; });
  const lexCounts = {};
  const gramCounts = {};
  personaSplitRuns(text).forEach((run) => {
    let i = 0;
    while (i < run.length) {
      let matched = '';
      for (let len = 4; len >= 2; len -= 1) {
        if (i + len > run.length) {
          continue;
        }
        const cand = run.slice(i, i + len);
        if (lexicon[cand]) {
          matched = cand;
          break;
        }
      }
      if (matched) {
        lexCounts[matched] = (lexCounts[matched] || 0) + 1;
        i += matched.length;
      } else {
        i += 1;
      }
    }
    for (let len = 2; len <= 4; len += 1) {
      for (let start = 0; start + len <= run.length; start += 1) {
        const gram = run.slice(start, start + len);
        if (stopSet[gram]) {
          continue;
        }
        if (PERSONA_STOP_CHARS.indexOf(gram.charAt(0)) >= 0 || PERSONA_STOP_CHARS.indexOf(gram.charAt(gram.length - 1)) >= 0) {
          continue;
        }
        gramCounts[gram] = (gramCounts[gram] || 0) + 1;
      }
    }
  });

  const list = [];
  Object.keys(lexCounts).forEach((word) => {
    list.push({ word: word, count: lexCounts[word], lex: true, score: lexCounts[word] * 2.2 + word.length });
  });
  Object.keys(gramCounts).forEach((word) => {
    if (gramCounts[word] >= 3) {
      list.push({ word: word, count: gramCounts[word], lex: false, score: gramCounts[word] });
    }
  });
  list.sort((a, b) => b.score - a.score);

  const accepted = [];
  list.forEach((item) => {
    if (item.word.length > 12) {
      return;
    }
    let contained = false;
    for (let i = 0; i < accepted.length; i += 1) {
      if (accepted[i].word.length > item.word.length && accepted[i].word.indexOf(item.word) >= 0) {
        contained = true;
        break;
      }
    }
    if (contained) {
      return;
    }
    for (let i = accepted.length - 1; i >= 0; i -= 1) {
      if (item.word.length > accepted[i].word.length && item.word.indexOf(accepted[i].word) >= 0) {
        accepted.splice(i, 1);
      }
    }
    accepted.push(item);
  });
  return accepted;
}

/** 情绪比例（按句：命中正向/负向词的句，其余为中性） */
function personaEmotionRatio(text) {
  const sentences = String(text || '').split(/[。！？!?；;\n]+/).map((s) => s.trim()).filter((s) => s.length >= 2);
  let pos = 0;
  let neg = 0;
  let neu = 0;
  sentences.forEach((sentence) => {
    let hitPos = false;
    let hitNeg = false;
    for (let i = 0; i < PERSONA_POSITIVE_WORDS.length; i += 1) {
      if (sentence.indexOf(PERSONA_POSITIVE_WORDS[i]) >= 0) {
        hitPos = true;
        break;
      }
    }
    for (let i = 0; i < PERSONA_NEGATIVE_WORDS.length; i += 1) {
      if (sentence.indexOf(PERSONA_NEGATIVE_WORDS[i]) >= 0) {
        hitNeg = true;
        break;
      }
    }
    if (hitPos && !hitNeg) {
      pos += 1;
    } else if (hitNeg && !hitPos) {
      neg += 1;
    } else {
      neu += 1;
    }
  });
  const total = sentences.length || 1;
  return {
    pos: pos, neg: neg, neu: neu, total: sentences.length,
    posPct: Math.round((pos / total) * 100),
    negPct: Math.round((neg / total) * 100),
    neuPct: Math.round((neu / total) * 100),
  };
}

/** 主题词归并（高频词 → 5 个主题） */
function personaThemes(words) {
  const counts = PERSONA_THEMES.map((theme) => ({ name: theme.name, count: 0 }));
  words.forEach((item) => {
    for (let i = 0; i < PERSONA_THEMES.length; i += 1) {
      if (PERSONA_THEMES[i].words.indexOf(item.word) >= 0) {
        counts[i].count += item.count;
        break;
      }
    }
  });
  return counts.filter((item) => item.count > 0).sort((a, b) => b.count - a.count).slice(0, 5);
}

/** 语料 → 划线 / 想法数组（带书名与时间戳） */
function personaSegments(corpus) {
  const marks = [];
  const reviews = [];
  const books = corpus && Array.isArray(corpus.books) ? corpus.books : [];
  books.forEach((book) => {
    (book.marks || []).forEach((item) => {
      if (item && item.text) {
        marks.push({ text: item.text, at: item.at || 0, title: book.title || '' });
      }
    });
    (book.reviews || []).forEach((item) => {
      if (item && item.text) {
        reviews.push({ text: item.text, at: item.at || 0, title: book.title || '' });
      }
    });
  });
  return { marks: marks, reviews: reviews };
}

/** 口头禅：跨书重复出现最多的一句（无重复则取最有代表性的一句） */
function personaCatchphrase(segments) {
  const map = {};
  (segments.marks || []).forEach((item) => {
    const key = String(item.text).replace(/\s+/g, '').replace(/[。！？!?，,、；;：:""''「」『』（）()\[\]【】…—~-]/g, '');
    if (key.length < 4 || key.length > 40) {
      return;
    }
    if (!map[key]) {
      map[key] = { text: item.text, title: item.title || '', at: item.at || 0, count: 0 };
    }
    map[key].count += 1;
    if (item.at && item.at > (map[key].at || 0)) {
      map[key].at = item.at;
    }
  });
  const list = Object.keys(map).map((key) => map[key]);
  if (!list.length) {
    return null;
  }
  list.sort((a, b) => (b.count - a.count) || (b.text.length - a.text.length));
  return list[0];
}

/** 原文证据：从语料里挑若干条真实引用（每本最多 2 条） */
function personaQuotes(corpus) {
  const quotes = [];
  const books = corpus && Array.isArray(corpus.books) ? corpus.books : [];
  const seen = {};
  for (let i = 0; i < books.length && quotes.length < PERSONA_QUOTE_MAX; i += 1) {
    const marks = (books[i].marks || [])
      .filter((item) => item && item.text && item.text.replace(/\s/g, '').length >= 10)
      .sort((a, b) => b.text.length - a.text.length);
    let perBook = 0;
    for (let j = 0; j < marks.length && perBook < 2 && quotes.length < PERSONA_QUOTE_MAX; j += 1) {
      const key = marks[j].text.replace(/\s/g, '');
      if (seen[key]) {
        continue;
      }
      seen[key] = true;
      quotes.push({ text: marks[j].text, title: books[i].title || '', at: marks[j].at || 0 });
      perBook += 1;
    }
  }
  return quotes;
}

// ---- 四个维度判定 ----
function personaFinalizeDim(config) {
  if (config.leftPct == null || !isFinite(config.leftPct)) {
    return {
      key: config.key, title: config.title,
      left: config.left, right: config.right,
      available: false, side: '', centered: false, leftPct: null,
      confidence: 'none', basis: config.basis || '该维度数据还不够',
    };
  }
  const pct = Math.max(0, Math.min(100, config.leftPct));
  const band = config.band || 5;
  let side;
  let centered = false;
  if (pct >= 50 + band) {
    side = config.left.letter;
  } else if (pct <= 50 - band) {
    side = config.right.letter;
  } else {
    centered = true;
    side = pct >= 50 ? config.left.letter : config.right.letter;
  }
  return {
    key: config.key, title: config.title,
    left: config.left, right: config.right,
    available: true, side: side, centered: centered,
    leftPct: Math.round(pct),
    confidence: config.confidence || 'mid',
    basis: config.basis || '',
  };
}

// D1 阅读能量：深潜 D ↔ 广撒 B
function personaDimensionEnergy(data, shelf, notebooks) {
  const comps = [];
  const books = shelf && Array.isArray(shelf.books) ? shelf.books : [];
  const overallSec = Number(data && data.totalReadTime) || 0;
  const readBooks = books.filter((item) => Number(item.readUpdateTime) > 0).length || books.length;
  if (overallSec > 0 && readBooks > 0) {
    const avg = overallSec / readBooks;
    comps.push({
      weight: 0.35,
      score: clamp01((avg - 1.5 * 3600) / (6 * 3600 - 1.5 * 3600)),
      text: '单本均摊约 ' + fmtDuration(avg),
    });
  }
  const cats = shelf ? shelfCategories(shelf) : null;
  if (cats && cats.list.length && books.length) {
    const top3 = cats.list.slice(0, 3).reduce((acc, item) => acc + item.count, 0);
    const share = top3 / books.length;
    comps.push({ weight: 0.25, score: clamp01(share / 0.7), text: '前 3 类占书架 ' + Math.round(share * 100) + '%' });
  }
  const fin = shelf ? finishStats(shelf) : null;
  if (fin && fin.ebooks > 0) {
    comps.push({ weight: 0.2, score: fin.rate, text: '电子书完读率 ' + Math.round(fin.rate * 100) + '%' });
  }
  const stats = notebookStats(notebooks);
  if (stats && stats.totalBookCount > 0) {
    const parallel = clamp01((stats.totalBookCount - 2) / (8 - 2));
    comps.push({ weight: 0.2, score: 1 - parallel, text: '有笔记的书 ' + stats.totalBookCount + ' 本（并行度）' });
  }
  if (comps.length < 2) {
    return personaFinalizeDim({
      key: 'energy', title: '阅读能量', left: { letter: 'D', label: '深潜' }, right: { letter: 'B', label: '广撒' },
      leftPct: null, basis: '需要书架与累计时长的组合数据',
    });
  }
  let sum = 0;
  let weightSum = 0;
  comps.forEach((item) => { sum += item.score * item.weight; weightSum += item.weight; });
  const leftPct = (sum / weightSum) * 100;
  return personaFinalizeDim({
    key: 'energy', title: '阅读能量',
    left: { letter: 'D', label: '深潜' }, right: { letter: 'B', label: '广撒' },
    leftPct: leftPct, band: 5,
    confidence: comps.length >= 3 ? 'high' : 'mid',
    basis: comps.map((item) => item.text).join('；'),
  });
}

// D2 内容取向：求实 F ↔ 求意 M
function personaDimensionContent(data, shelf) {
  let factW = 0;
  let meaningW = 0;
  let sourceLabel = '';
  const classify = (name, weight) => {
    const w = Number(weight) || 0;
    const polarity = personaCategoryPolarity(name);
    if (polarity === 'fact') {
      factW += w;
    } else if (polarity === 'meaning') {
      meaningW += w;
    }
  };
  const cats = data && Array.isArray(data.preferCategory) ? data.preferCategory : [];
  if (cats.length) {
    sourceLabel = '官方偏好分类（按阅读时长）';
    cats.forEach((item) => {
      const name = item.parentCategoryTitle || item.categoryTitle || '';
      const weight = Number(item.readingTime) || Number(item.readingCount) || 0;
      if (weight > 0) {
        classify(name, weight);
      }
    });
  } else if (shelf) {
    const sc = shelfCategories(shelf);
    if (sc.list.length) {
      sourceLabel = '书架分类（按本数）';
      sc.list.forEach((item) => classify(item.name, item.count));
    }
  }
  const denom = factW + meaningW;
  if (!denom) {
    return personaFinalizeDim({
      key: 'content', title: '内容取向', left: { letter: 'F', label: '求实' }, right: { letter: 'M', label: '求意' },
      leftPct: null, basis: '暂无可归类的分类数据',
    });
  }
  const factShare = factW / denom;
  return personaFinalizeDim({
    key: 'content', title: '内容取向',
    left: { letter: 'F', label: '求实' }, right: { letter: 'M', label: '求意' },
    leftPct: factShare * 100, band: 10,
    confidence: cats.length ? 'high' : 'mid',
    basis: sourceLabel + '：求实 ' + Math.round(factShare * 100) + '% / 求意 ' + Math.round((1 - factShare) * 100) + '%',
  });
}

// D3 表达方式：理性 L ↔ 感性 E
function personaDimensionStyle(corpus) {
  const segments = personaSegments(corpus);
  const text = segments.marks.concat(segments.reviews).map((item) => item.text).join('\n');
  if (!text) {
    return personaFinalizeDim({
      key: 'style', title: '表达方式', left: { letter: 'L', label: '理性' }, right: { letter: 'E', label: '感性' },
      leftPct: null, basis: '还没有可用的划线/想法语料',
    });
  }
  let logic = 0;
  let emotion = 0;
  PERSONA_LOGIC_WORDS.forEach((word) => { logic += personaCountOccurrences(text, word); });
  PERSONA_EMOTION_WORDS.forEach((word) => { emotion += personaCountOccurrences(text, word); });
  const excl = (text.match(/[！!]/g) || []).length;
  const quest = (text.match(/[？?]/g) || []).length;
  const base = logic + emotion;
  if (!base && !excl && !quest) {
    return personaFinalizeDim({
      key: 'style', title: '表达方式', left: { letter: 'L', label: '理性' }, right: { letter: 'E', label: '感性' },
      leftPct: null, basis: '划线与想法里暂无可判定的词',
    });
  }
  const logicShare = base ? logic / base : 0.5;
  const adjust = Math.max(-6, Math.min(6, (quest - excl) * 0.6));
  const leftPct = Math.max(0, Math.min(100, logicShare * 100 + adjust));
  const confidence = (segments.marks.length + segments.reviews.length) >= 30 ? 'high' : 'mid';
  return personaFinalizeDim({
    key: 'style', title: '表达方式',
    left: { letter: 'L', label: '理性' }, right: { letter: 'E', label: '感性' },
    leftPct: leftPct, band: 5, confidence: confidence,
    basis: '逻辑词 ' + logic + ' 次 / 情感词 ' + emotion + ' 次（问号 ' + quest + '、感叹号 ' + excl + '）',
  });
}

// D4 阅读节奏：计划 P ↔ 随兴 R
function personaDimensionRhythm(data) {
  const buckets = reportBuckets(data || {});
  const positive = buckets.filter((item) => item.seconds > 0);
  if (positive.length < 3) {
    return personaFinalizeDim({
      key: 'rhythm', title: '阅读节奏', left: { letter: 'P', label: '计划' }, right: { letter: 'R', label: '随兴' },
      leftPct: null, basis: '有阅读的统计单元只有 ' + positive.length + ' 个，暂时判不准节奏',
    });
  }
  const coverage = positive.length / (buckets.length || positive.length);
  const mean = positive.reduce((acc, item) => acc + item.seconds, 0) / positive.length;
  const variance = positive.reduce((acc, item) => acc + Math.pow(item.seconds - mean, 2), 0) / positive.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const smooth = clamp01(1 - cv / 1.6);
  const leftPct = (0.5 * clamp01(coverage) + 0.5 * smooth) * 100;
  return personaFinalizeDim({
    key: 'rhythm', title: '阅读节奏',
    left: { letter: 'P', label: '计划' }, right: { letter: 'R', label: '随兴' },
    leftPct: leftPct, band: 5,
    confidence: positive.length >= 6 ? 'high' : 'mid',
    basis: '有阅读的统计单元 ' + positive.length + '/' + buckets.length + '（' + Math.round(coverage * 100) + '%），波动系数 ' + cv.toFixed(2),
  });
}

/** 时段绰号 */
function personaTimeNickname(data) {
  const hourly = hourlyReadTime(data || {});
  if (!hourly.length) {
    return '';
  }
  const peak = hourly.reduce((acc, item) => (item.seconds > acc.seconds ? item : acc));
  if (peak.seconds <= 0) {
    return '';
  }
  const hour = peak.hour;
  if (hour >= 21 || hour < 6) {
    return '夜读者';
  }
  if (hour >= 6 && hour < 9) {
    return '晨读者';
  }
  if (hour >= 11 && hour < 14) {
    return '午间读者';
  }
  return '日间读者';
}

/** 三个特质绰号：优先现有客观画像标签 + 时段，其次四维绰号 */
function personaNicknames(data, currentMode, shelf, notebooks, dims) {
  const pool = [];
  const tags = buildPersona(data, currentMode, shelf, notebooks);
  tags.forEach((tag) => pool.push(tag[1]));
  const timeNick = personaTimeNickname(data);
  if (timeNick) {
    pool.push(timeNick);
  }
  dims.forEach((dim) => {
    if (!dim.available) {
      return;
    }
    const key = dim.key + dim.side;
    if (PERSONA_NICKNAMES[key]) {
      pool.push(PERSONA_NICKNAMES[key]);
    }
  });
  const unique = [];
  pool.forEach((name) => {
    if (name && unique.indexOf(name) < 0 && unique.length < 3) {
      unique.push(name);
    }
  });
  return unique;
}

/** 一句话画像：由已算出的判定生成，不许自由发挥 */
function personaOneLiner(dims, tagline) {
  const phraseMap = {
    energyD: '把一本书读进骨子里',
    energyB: '同时开着好几条阅读线',
    contentF: '更想要能立刻用上的东西',
    contentM: '更想把一件事彻底想明白',
    styleL: '习惯把看到的东西拆开看',
    styleE: '容易被文字里的情绪打动',
    rhythmP: '读书有自己的节拍',
    rhythmR: '顺着当下的兴趣走',
  };
  const decisive = dims.filter((dim) => dim.available)
    .slice()
    .sort((a, b) => Math.abs(b.leftPct - 50) - Math.abs(a.leftPct - 50))
    .slice(0, 2)
    .map((dim) => phraseMap[dim.key + dim.side])
    .filter(Boolean);
  if (!decisive.length) {
    return tagline ? '你是那种' + tagline + '的人。' : '';
  }
  return '你是那种' + decisive.join('、') + '的人。';
}

/**
 * 汇总：算出「阅读人格」（四维判定 + 16 型 + 人格化的人 + 词语分析）。
 * 纯函数版：所有输入显式传入，便于小程序端从缓存/云函数组装。
 *
 * @param {Object} input
 * @param {Object} input.overall    累计（总体）readdata 数据
 * @param {Object} input.report     当前周期 readdata 数据（可选）
 * @param {Object} input.shelf      /shelf/sync 数据（可选）
 * @param {Object} input.notebooks  /user/notebooks 数据（可选）
 * @param {Object} input.corpus     人格语料 { books:[{title,author,marks,reviews}] }（可选）
 * @param {string} input.mode       当前周期 key（用于标注 basedOn）
 * @param {boolean} input.hasKey    是否已配置 API Key
 * @param {string} input.readerName 读者昵称（可选）
 * @param {string} input.corpusState 语料状态：''/loading/ok/error
 * @param {string} input.corpusError 语料错误文案
 * @param {string} input.aiText      AI 润色文本（可选，首版本机不调用则为空）
 */
function getReadingPersona(input) {
  const opts = input || {};
  const overall = opts.overall || opts.report || {};
  const shelf = opts.shelf || null;
  const notebooks = opts.notebooks || null;
  const corpus = opts.corpus || null;
  const mode = opts.mode || 'overall';
  const stats = notebookStats(notebooks);
  const totalSec = Number(overall.totalReadTime) || 0;
  const noteCount = stats ? (stats.noteTotal + stats.reviewTotal) : 0;

  if (!opts.hasKey) {
    return { ok: false, reason: 'nokey' };
  }
  if (totalSec < PERSONA_MIN_SECONDS || noteCount < PERSONA_MIN_NOTES) {
    return {
      ok: false,
      reason: 'data',
      progress: {
        hours: (totalSec / 3600).toFixed(1),
        notes: noteCount,
        needHours: Math.round(PERSONA_MIN_SECONDS / 3600),
        needNotes: PERSONA_MIN_NOTES,
        hasKey: true,
      },
    };
  }

  // 节奏维度优先用「统计单元更多」的数据（累计通常是按年，单元少）
  const rhythmData = (reportBuckets(overall).filter((b) => b.seconds > 0).length >= 3)
    ? overall
    : (opts.report || overall);

  const dims = [
    personaDimensionEnergy(overall, shelf, notebooks),
    personaDimensionContent(overall, shelf),
    personaDimensionStyle(corpus),
    personaDimensionRhythm(rhythmData),
  ];

  const available = dims.filter((dim) => dim.available);
  const code = dims.map((dim) => (dim.available ? dim.side : '–')).join('');
  const full = available.length === dims.length;
  const type = full ? PERSONA_TYPES[code] : null;

  // 词语分析
  const segments = personaSegments(corpus);
  const corpusText = segments.marks.concat(segments.reviews).map((item) => item.text).join('\n');
  const words = personaCountWords(corpusText).slice(0, PERSONA_WORD_TOP);
  const hasWords = words.length >= 3;
  const topWords = hasWords ? words : [];
  const cloud = topWords.slice(0, PERSONA_CLOUD_TOP);
  const analysis = hasWords ? {
    top: topWords,
    emotion: personaEmotionRatio(corpusText),
    catchphrase: personaCatchphrase(segments),
    themes: personaThemes(topWords),
    cloud: cloud,
  } : null;

  // 人格化的人：数据证据
  const evidenceData = [];
  if (totalSec > 0) {
    evidenceData.push('累计阅读 ' + fmtDuration(totalSec));
  }
  if (stats) {
    evidenceData.push('划了 ' + stats.noteTotal + ' 条线');
    evidenceData.push('写了 ' + stats.reviewTotal + ' 条想法');
  }
  if (shelf) {
    const counts = shelfCounts(shelf);
    evidenceData.push('书架 ' + counts.books + ' 本');
  }

  return {
    ok: true,
    basedOn: opts.overall ? 'overall' : mode,
    reader: opts.readerName || '',
    code: code,
    name: type ? type[0] : '待补全的阅读人格',
    tagline: type ? type[1] : '还有一两个维度数据不够，补齐后会更准',
    figure: type && PERSONA_FIGURES[code] ? PERSONA_FIGURES[code] : null,
    full: full,
    nicknames: personaNicknames(overall, mode, shelf, notebooks, dims),
    dims: dims,
    oneLiner: full ? personaOneLiner(dims, type ? type[1] : '') : '',
    evidence: { data: evidenceData, quotes: personaQuotes(corpus) },
    catchphrase: analysis ? analysis.catchphrase : null,
    words: analysis,
    corpusState: opts.corpusState || '',
    corpusError: opts.corpusError || '',
    aiText: opts.aiText || '',
  };
}

module.exports = {
  PERSONA_MIN_SECONDS,
  PERSONA_MIN_NOTES,
  PERSONA_TYPES,
  PERSONA_NICKNAMES,
  PERSONA_FIGURES,
  clamp01,
  personaCountOccurrences,
  personaYear,
  personaCategoryPolarity,
  personaCountWords,
  personaEmotionRatio,
  personaThemes,
  personaSegments,
  personaCatchphrase,
  personaQuotes,
  personaFinalizeDim,
  personaDimensionEnergy,
  personaDimensionContent,
  personaDimensionStyle,
  personaDimensionRhythm,
  personaTimeNickname,
  personaNicknames,
  personaOneLiner,
  getReadingPersona,
};
