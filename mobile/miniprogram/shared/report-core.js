/**
 * 阅读数据「纯计算」核心 — 小程序端共享模块
 *
 * 来源：从插件 modules/official.js 抽取的纯函数（不改动插件行为）。
 * 定位：只做客观统计与规则化解读，不联网、不依赖 UI、零外部依赖。
 * 口径必须与插件保持一致（分桶时区、书架计数、笔记统计等）。
 */

const { fmtDuration, fmtCompare } = require('./format');

// ---- 常量（与官方插件对齐）----
const MODES = [
  { key: 'weekly', label: '本周' },
  { key: 'monthly', label: '本月' },
  { key: 'annually', label: '本年' },
  { key: 'overall', label: '累计' },
];
const HOUR_START = 6;                    // 官方 preferTime 从 06:00 起算，索引 0 = 06:00
const CST_OFFSET_MS = 8 * 3600 * 1000;   // 官方分桶时间戳是「中国时区零点」的 UTC 秒，展示需 +8h
const SHELF_BOOK_LIMIT = 20;
const CATEGORY_LIMIT = 15;

const TIME_BANDS = [
  { start: 6, end: 9, label: '清晨 06:00–09:00' },
  { start: 9, end: 12, label: '上午 09:00–12:00' },
  { start: 12, end: 14, label: '午间 12:00–14:00' },
  { start: 14, end: 18, label: '下午 14:00–18:00' },
  { start: 18, end: 22, label: '晚间 18:00–22:00' },
  { start: 22, end: 24, label: '深夜 22:00–24:00' },
  { start: 0, end: 6, label: '凌晨 00:00–06:00' },
];

// ---- 基础工具 ----
function pad2(value) {
  return String(value).padStart(2, '0');
}

function maxOf(numbers) {
  return numbers.reduce((acc, value) => Math.max(acc, Number(value) || 0), 0);
}

/** 官方分桶时间戳（中国时区零点的 UTC 秒）→ 年/月/日 */
function bucketParts(seconds) {
  const date = new Date(Number(seconds) * 1000 + CST_OFFSET_MS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

/** 分桶 key（秒）→ 展示标签 */
function fmtBucketLabel(seconds, currentMode) {
  const part = bucketParts(seconds);
  if (currentMode === 'overall') {
    return part.year + ' 年';
  }
  if (currentMode === 'annually') {
    return part.month + ' 月';
  }
  return part.month + ' 月 ' + part.day + ' 日';
}

function modeLabel(currentMode) {
  const found = MODES.filter((item) => item.key === currentMode)[0];
  return found ? found.label : currentMode;
}

// ---- /readdata/detail ----
/** 分桶明细（升序，含 0 时长桶） */
function reportBuckets(data) {
  const source = (data && data.readTimes) || {};
  return Object.keys(source).map((key) => ({
    ts: Number(key),
    seconds: Number(source[key]) || 0,
  })).sort((a, b) => a.ts - b.ts);
}

function bucketSectionLabel(currentMode) {
  if (currentMode === 'overall') {
    return '年度阅读时长';
  }
  if (currentMode === 'annually') {
    return '月度阅读时长';
  }
  return '每日阅读时长';
}

function metricCards(data) {
  const compare = fmtCompare(data.compare);
  return [
    { label: '总时长', value: fmtDuration(data.totalReadTime) },
    { label: '阅读天数', value: (data.readDays || 0) + ' 天' },
    { label: '自然日均', value: data.dayAverageReadTime == null ? '—' : fmtDuration(data.dayAverageReadTime) },
    { label: '较上期', value: compare === null ? '—' : compare },
  ];
}

function officialSummary(data) {
  if (!Array.isArray(data.readStat)) {
    return [];
  }
  return data.readStat.map((item) => ({ label: item.stat, value: item.counts }));
}

/** preferTime（索引 0 = 06:00）→ 按 24 小时还原 */
function hourlyReadTime(data) {
  const list = Array.isArray(data && data.preferTime) ? data.preferTime : [];
  if (list.length !== 24) {
    return [];
  }
  return list.map((seconds, index) => ({
    hour: (HOUR_START + index) % 24,
    seconds: Number(seconds) || 0,
  }));
}

function timeBands(data) {
  const hourly = hourlyReadTime(data);
  if (!hourly.length) {
    return [];
  }
  const byHour = {};
  hourly.forEach((item) => { byHour[item.hour] = item.seconds; });
  return TIME_BANDS.map((band) => {
    let seconds = 0;
    for (let hour = band.start; hour < band.end; hour += 1) {
      seconds += byHour[hour] || 0;
    }
    return { label: band.label, seconds: seconds };
  });
}

/** 客观解读：只陈述数据本身，不做性格/价值观推断 */
function buildInsights(data, currentMode, buckets) {
  const items = [];
  const positive = buckets.filter((item) => item.seconds > 0);
  const total = positive.reduce((acc, item) => acc + item.seconds, 0) || 1;

  let head = (currentMode === 'overall' ? '累计阅读总时长 ' : '本周期阅读总时长 ') +
    fmtDuration(data.totalReadTime) + '，覆盖 ' + (data.readDays || 0) + ' 天';
  if (data.dayAverageReadTime != null) {
    head += '，自然日均 ' + fmtDuration(data.dayAverageReadTime);
  }
  items.push(head + '。');

  const compare = fmtCompare(data.compare);
  if (compare !== null) {
    items.push('较上一周期' + (data.compare >= 0 ? '增长' : '下降') + ' ' +
      Math.abs(data.compare * 100).toFixed(1) + '%（官方 compare 口径，仅当前周期提供）。');
  } else {
    items.push(currentMode === 'overall' ? '累计口径官方未提供环比数据。' : '该周期官方未提供环比数据。');
  }

  if (positive.length) {
    const peak = positive.reduce((acc, item) => (item.seconds > acc.seconds ? item : acc));
    items.push('阅读最集中的周期是 ' + fmtBucketLabel(peak.ts, currentMode) + '，' + fmtDuration(peak.seconds) +
      '（占 ' + ((peak.seconds / total) * 100).toFixed(1) + '%）。');
    items.push('共 ' + buckets.length + ' 个统计单元，其中 ' + positive.length + ' 个有阅读记录。');
    items.push('单元均值 ' + fmtDuration(total / positive.length) + '。');
  }

  if (data.preferCategoryWord) {
    items.push('官方偏好判定：' + data.preferCategoryWord + '。');
  }
  if (data.preferTimeWord) {
    items.push('官方时段判定：' + data.preferTimeWord + '。');
  }
  if (Array.isArray(data.preferAuthor) && data.preferAuthor.length) {
    items.push('读得最多的作者是 ' + data.preferAuthor[0].name + '（' + data.preferAuthor[0].count + ' 本）。');
  }
  return items;
}

// ---- 书架 / 笔记 ----
/** 书架计数（严格按官方口径：总数含专辑与文章收藏入口） */
function shelfCounts(shelf) {
  const books = Array.isArray(shelf && shelf.books) ? shelf.books : [];
  const albums = Array.isArray(shelf && shelf.albums) ? shelf.albums : [];
  const bookSecret = books.filter((item) => Number(item.secret) === 1).length;
  const albumSecret = albums.filter((item) => Number(item.secret) === 1).length;
  const hasMp = !!(shelf && shelf.hasMp);
  const secret = bookSecret + albumSecret + (hasMp ? 1 : 0);
  const publicCount = (books.length - bookSecret) + (albums.length - albumSecret);
  const top = books.filter((item) => Number(item.isTop) === 1).length +
    albums.filter((item) => Number(item.isTop) === 1).length;
  return {
    books: books.length,
    albums: albums.length,
    hasMp: hasMp,
    total: books.length + albums.length + (hasMp ? 1 : 0),
    secret: secret,
    publicCount: publicCount,
    top: top,
    finished: books.filter((item) => Number(item.finishReading) === 1).length,
  };
}

/** 书架电子书按「分类」聚合（降序，取前 CATEGORY_LIMIT 个） */
function shelfCategories(shelf) {
  const books = Array.isArray(shelf && shelf.books) ? shelf.books : [];
  const map = {};
  books.forEach((item) => {
    const raw = item.category;
    const name = (typeof raw === 'string' ? raw : (raw && (raw.title || raw.name)) || '').trim() || '未分类';
    map[name] = (map[name] || 0) + 1;
  });
  const sorted = Object.keys(map).map((name) => ({ name: name, count: map[name] }))
    .sort((a, b) => b.count - a.count);
  return { list: sorted.slice(0, CATEGORY_LIMIT), more: Math.max(0, sorted.length - CATEGORY_LIMIT) };
}

/** 笔记概览统计（总条数优先用官方 totalNoteCount，分项用已拉取明细求和） */
function notebookStats(notebooks) {
  if (!notebooks || !notebooks.ok) {
    return null;
  }
  const books = Array.isArray(notebooks.books) ? notebooks.books : [];
  const sum = (field) => books.reduce((acc, item) => acc + (Number(item[field]) || 0), 0);
  const reviewTotal = sum('reviewCount');
  const noteTotal = sum('noteCount');
  const bookmarkTotal = sum('bookmarkCount');
  const totalNoteCount = (typeof notebooks.totalNoteCount === 'number' && notebooks.totalNoteCount >= 0)
    ? notebooks.totalNoteCount
    : reviewTotal + noteTotal + bookmarkTotal;
  const sorted = books.slice().sort((a, b) =>
    (b.reviewCount + b.noteCount + b.bookmarkCount) - (a.reviewCount + a.noteCount + a.bookmarkCount));
  return {
    totalBookCount: notebooks.totalBookCount || books.length,
    totalNoteCount: totalNoteCount,
    reviewTotal: reviewTotal,
    noteTotal: noteTotal,
    bookmarkTotal: bookmarkTotal,
    topBooks: sorted.slice(0, 10),
    truncated: !!notebooks.truncated,
  };
}

function finishStats(shelf) {
  const counts = shelfCounts(shelf);
  return {
    ebooks: counts.books,
    finished: counts.finished,
    reading: Math.max(0, counts.books - counts.finished),
    rate: counts.books ? counts.finished / counts.books : 0,
  };
}

/** 已读完的电子书（按最近阅读时间降序，取前 SHELF_BOOK_LIMIT 本） */
function finishedBooks(shelf) {
  const books = Array.isArray(shelf && shelf.books) ? shelf.books : [];
  const done = books.filter((item) => Number(item.finishReading) === 1)
    .sort((a, b) => (Number(b.readUpdateTime) || 0) - (Number(a.readUpdateTime) || 0));
  return { list: done.slice(0, SHELF_BOOK_LIMIT), total: done.length, more: Math.max(0, done.length - SHELF_BOOK_LIMIT) };
}

/**
 * 阅读人格画像（客观规则化类型归类）。
 * 只用客观统计指标按固定阈值归类，输出「维度 / 类型画像 / 判定依据」三元组。
 */
function buildPersona(data, currentMode, shelf, notebooks) {
  const tags = [];
  const counts = shelf ? shelfCounts(shelf) : null;
  const fin = shelf ? finishStats(shelf) : null;
  const notes = notebookStats(notebooks);
  const cats = shelf ? shelfCategories(shelf) : null;

  if (fin && fin.ebooks > 0) {
    const pct = (fin.rate * 100).toFixed(0) + '%';
    const basis = '电子书完读率 ' + pct + '（读完 ' + fin.finished + ' / ' + fin.ebooks + ' 本）';
    if (fin.rate >= 0.6) {
      tags.push(['完读倾向', '善始善终型', basis]);
    } else if (fin.rate >= 0.3) {
      tags.push(['完读倾向', '随性而为型', basis]);
    } else {
      tags.push(['完读倾向', '广泛涉猎型', basis]);
    }
  }

  if (notes && notes.totalBookCount > 0) {
    const avg = notes.totalNoteCount / notes.totalBookCount;
    const basis = '有笔记的书平均每本约 ' + avg.toFixed(1) + ' 条笔记';
    if (avg >= 5) {
      tags.push(['笔记投入', '深度精读型', basis]);
    } else if (avg >= 1) {
      tags.push(['笔记投入', '适度批注型', basis]);
    } else {
      tags.push(['笔记投入', '少记浏览型', basis]);
    }
  }

  if (cats && cats.list.length && counts && counts.books > 0) {
    const top = cats.list[0];
    const share = top.count / counts.books;
    const basis = '「' + top.name + '」占电子书 ' + (share * 100).toFixed(0) + '%';
    if (share >= 0.5) {
      tags.push(['主题聚焦', '主题聚焦型', basis]);
    } else if (share < 0.3 && (cats.list.length + cats.more) >= 5) {
      tags.push(['主题聚焦', '兴趣广博型', basis + '，分类较分散']);
    } else {
      tags.push(['主题聚焦', '多元均衡型', basis]);
    }
  }

  if (counts && counts.albums > 0 && counts.total > 0) {
    const basis = '书架含 ' + counts.albums + ' 个有声书/专辑';
    if (counts.albums / counts.total >= 0.3) {
      tags.push(['内容形态', '听读兼修型', basis]);
    } else {
      tags.push(['内容形态', '以读为主型', basis]);
    }
  }

  const hourly = hourlyReadTime(data);
  if (hourly.length) {
    const peak = hourly.reduce((acc, item) => (item.seconds > acc.seconds ? item : acc));
    const h = peak.hour;
    let label;
    if (h >= 21 || h < 6) {
      label = '夜读型';
    } else if (h >= 6 && h < 9) {
      label = '晨读型';
    } else if (h >= 11 && h < 14) {
      label = '午间型';
    } else {
      label = '日间型';
    }
    tags.push(['阅读时段', label, '全天峰值出现在 ' + pad2(h) + ':00 前后']);
  }

  return tags;
}

/**
 * 阅读规律与建议（规则模板）。
 * 只用报告里已有指标生成「事实句 + 温和建议」，数据不足的条目自动跳过。
 */
function buildAdvice(data, currentMode, shelf, notebooks) {
  const items = [];
  const scopePrefix = currentMode === 'overall' ? '累计' : modeLabel(currentMode);

  if (Number(data.totalReadTime) > 0) {
    let fact = scopePrefix + '共阅读 ' + fmtDuration(data.totalReadTime) +
      '，覆盖 ' + (data.readDays || 0) + ' 天';
    if (data.dayAverageReadTime != null) {
      fact += '（自然日均 ' + fmtDuration(data.dayAverageReadTime) + '）';
    }
    const compare = fmtCompare(data.compare);
    if (compare !== null) {
      fact += '，较上一周期' + (data.compare >= 0 ? '增加' : '减少') + ' ' + Math.abs(data.compare * 100).toFixed(1) + '%';
    }
    const advice = (data.readDays || 0) > 0
      ? '保持当前节奏即可；若想再多读一点，优先固定一个每天都能空出来的小时间段，比临时找时间更稳。'
      : '先从一个每天 10 分钟的小目标开始，比一上来就追求长时间更容易坚持。';
    items.push(fact + '。建议：' + advice);
  }

  const hourly = hourlyReadTime(data);
  if (hourly.length) {
    const peak = hourly.reduce((acc, item) => (item.seconds > acc.seconds ? item : acc));
    if (peak.seconds > 0) {
      items.push('你的阅读集中在 ' + pad2(peak.hour) + ':00 前后（' + fmtDuration(peak.seconds) +
        '）。建议：把这个时段固定为「读书时间」，到点就打开，省去临时找时间的犹豫。');
    }
  }

  if (data.preferCategoryWord) {
    items.push('官方判定你的偏好为「' + data.preferCategoryWord +
      '」。建议：在喜欢的分类里挑一本篇幅短一点的书读完，容易形成正反馈。');
  }

  if (shelf) {
    const fin = finishStats(shelf);
    if (fin.ebooks > 0) {
      items.push('电子书完读率 ' + (fin.rate * 100).toFixed(0) + '%（读完 ' + fin.finished + ' / ' + fin.ebooks +
        ' 本）。建议：从「在读」里选一本最想看完的，先把它读完，完读率会自然上升。');
    }
  }

  const notes = notebookStats(notebooks);
  if (notes && notes.totalBookCount > 0 && notes.totalNoteCount > 0) {
    const avg = notes.totalNoteCount / notes.totalBookCount;
    const advice = avg >= 1
      ? '保持「划线后随手写一句想法」的习惯，回看时比单纯的划线更有用。'
      : '读完一章后试着写一句自己的想法，比只划线更容易记住。';
    items.push('有笔记的书平均每本约 ' + avg.toFixed(1) + ' 条笔记（共 ' + notes.totalBookCount +
      ' 本）。建议：' + advice);
  }

  if (shelf) {
    const counts = shelfCounts(shelf);
    if (counts.books > 0) {
      items.push('书架现有电子书 ' + counts.books + ' 本，其中读完 ' + counts.finished +
        ' 本。建议：新书不必急着加，先把手边这本读完，书架更清爽，选书也更省力。');
    }
  }

  return items;
}

/** 时间戳 → 「YYYY-MM-DD HH:mm」 */
function fmtDateTime(timestamp) {
  if (!timestamp) {
    return '—';
  }
  const date = new Date(timestamp);
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) +
    ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

/** 百分比条：把数值数组换算成 0~100 的宽度百分比（相对最大值） */
function barPercents(values) {
  const max = maxOf(values);
  return values.map((value) => (max > 0 ? Math.round(((Number(value) || 0) / max) * 100) : 0));
}

/**
 * 构建阅读行为报告的「区块模型」（小程序端渲染用）。
 * 结构与插件 buildReportModel 对齐，但去掉 AI / 人格卡 / 图表等小程序首版不做的部分。
 * 返回 block 数组；block.type ∈ heading/kv/cards/table/chips/note/paragraph/list/empty。
 */
function buildReportBlocks(data, currentMode, overview, options) {
  const opts = options || {};
  const d = data || {};
  const blocks = [];
  const buckets = reportBuckets(d);
  const shelf = overview && overview.shelf ? overview.shelf : null;
  const notebooks = overview && overview.notebooks ? overview.notebooks : null;

  // 一、执行摘要（优先累计口径）
  const summaryData = opts.overall || d;
  const summaryMode = opts.overall ? 'overall' : currentMode;
  const insights = buildInsights(summaryData, summaryMode, reportBuckets(summaryData));
  blocks.push({ type: 'heading', level: 2, text: '一、执行摘要' });
  blocks.push({
    type: 'note',
    text: opts.overall
      ? '本节基于累计（总体）数据，不随上方周期切换变化；正文各章节仍按所选周期统计。'
      : '本次未取到累计（总体）数据，执行摘要暂按所选周期（' + modeLabel(currentMode) + '）展示。',
  });
  if (insights.length) {
    blocks.push({ type: 'paragraph', text: insights[0] });
    if (insights.length > 1) {
      blocks.push({ type: 'list', ordered: true, items: insights.slice(1) });
    }
  }

  // 二、数据全景
  blocks.push({ type: 'heading', level: 2, text: '二、数据全景' });
  blocks.push({ type: 'heading', level: 3, text: '2.1 核心指标' });
  blocks.push({ type: 'cards', items: metricCards(d) });
  if (shelf) {
    const counts = shelfCounts(shelf);
    blocks.push({ type: 'heading', level: 3, text: '2.2 书架结构' });
    blocks.push({ type: 'kv', rows: [
      ['书架条目总数', counts.total + ' 个'],
      ['电子书', counts.books + ' 本'],
      ['专辑 / 有声书', counts.albums + ' 个'],
      ['公开 / 私密', counts.publicCount + ' / ' + counts.secret],
      ['置顶', counts.top + ' 个'],
    ] });
    blocks.push({ type: 'note', text: '官方口径：书架总数 = 电子书 + 专辑/有声书 +（有文章收藏入口时 +1）；文章收藏入口固定计入私密阅读。' });
  }
  const summary = officialSummary(d);
  if (summary.length) {
    blocks.push({ type: 'heading', level: 3, text: '2.3 官方概要' });
    blocks.push({ type: 'chips', items: summary });
  }
  const categories = Array.isArray(d.preferCategory) ? d.preferCategory : [];
  if (categories.length) {
    const categoryTotal = categories.reduce((acc, item) => acc + (item.readingTime || 0), 0) || 1;
    blocks.push({ type: 'heading', level: 3, text: '2.4 偏好分类（按阅读时长）' });
    blocks.push({
      type: 'table',
      head: ['分类', '读过', '时长', '占比'],
      rows: categories.map((item) => [
        item.parentCategoryTitle || item.categoryTitle || '未分类',
        (item.readingCount || 0) + ' 本',
        fmtDuration(item.readingTime),
        (((item.readingTime || 0) / categoryTotal) * 100).toFixed(1) + '%',
      ]),
      bars: barPercents(categories.map((item) => item.readingTime || 0)),
    });
    if (d.preferCategoryWord) {
      blocks.push({ type: 'note', text: '官方判定：' + d.preferCategoryWord });
    }
  }

  // 三、阅读轨迹与时间线
  blocks.push({ type: 'heading', level: 2, text: '三、阅读轨迹与时间线' });
  blocks.push({ type: 'heading', level: 3, text: '3.1 ' + bucketSectionLabel(currentMode) });
  const positive = buckets.filter((item) => item.seconds > 0);
  if (!positive.length) {
    blocks.push({ type: 'empty', text: '该周期官方未返回分桶明细' });
  } else {
    const bucketTotal = positive.reduce((acc, item) => acc + item.seconds, 0) || 1;
    blocks.push({
      type: 'table',
      head: ['周期', '时长', '占比'],
      rows: positive.map((item) => [
        fmtBucketLabel(item.ts, currentMode),
        fmtDuration(item.seconds),
        (((item.seconds) / bucketTotal) * 100).toFixed(1) + '%',
      ]),
      bars: barPercents(positive.map((item) => item.seconds)),
    });
    const hidden = buckets.length - positive.length;
    if (hidden > 0) {
      blocks.push({ type: 'note', text: '已隐藏 ' + hidden + ' 个 0 时长周期。' });
    }
  }

  // 四、阅读时段分布（官方仅在「累计」周期提供 preferTime）
  const bands = timeBands(d);
  if (bands.length) {
    const bandTotal = bands.reduce((acc, item) => acc + item.seconds, 0) || 1;
    blocks.push({ type: 'heading', level: 2, text: '四、阅读时段分布' });
    blocks.push({
      type: 'table',
      head: ['时段', '时长', '占比'],
      rows: bands.map((item) => [item.label, fmtDuration(item.seconds), ((item.seconds / bandTotal) * 100).toFixed(1) + '%']),
      bars: barPercents(bands.map((item) => item.seconds)),
    });
    const hourly = hourlyReadTime(d);
    if (hourly.length) {
      const peakHour = hourly.reduce((acc, item) => (item.seconds > acc.seconds ? item : acc));
      if (peakHour.seconds > 0) {
        blocks.push({ type: 'note', text: '全天峰值出现在 ' + pad2(peakHour.hour) + ':00 前后，' + fmtDuration(peakHour.seconds) +
          '（占 ' + ((peakHour.seconds / bandTotal) * 100).toFixed(1) + '%）。' });
      }
    }
  }

  // 五、偏好画像
  const authors = Array.isArray(d.preferAuthor) ? d.preferAuthor : [];
  const publishers = Array.isArray(d.preferPublisher) ? d.preferPublisher : [];
  if (authors.length || publishers.length) {
    blocks.push({ type: 'heading', level: 2, text: '五、偏好画像' });
    if (authors.length) {
      blocks.push({ type: 'heading', level: 3, text: '5.1 偏好作者' });
      blocks.push({
        type: 'table',
        head: ['作者', '本数', '时长'],
        rows: authors.slice(0, 10).map((item) => [
          item.name || '未知',
          (item.count != null ? item.count : item.authorCount || 0) + ' 本',
          item.readTime != null ? fmtDuration(item.readTime) : '—',
        ]),
      });
    }
    if (publishers.length) {
      blocks.push({ type: 'heading', level: 3, text: '5.2 偏好出版社' });
      blocks.push({
        type: 'table',
        head: ['出版社', '本数'],
        rows: publishers.slice(0, 10).map((item) => [item.name || '未知', (item.count || 0) + ' 本']),
      });
    }
  }

  // 六、读得最多
  const longest = Array.isArray(d.readLongest) ? d.readLongest : [];
  blocks.push({ type: 'heading', level: 2, text: '六、读得最多' });
  if (!longest.length) {
    blocks.push({ type: 'empty', text: '该周期内没有达到官方展示门槛的书（官方会过滤约 5 分钟以下的内容）' });
  } else {
    blocks.push({
      type: 'table',
      head: ['排名', '书名', '作者', '时长'],
      rows: longest.slice(0, 10).map((item, index) => {
        const book = item.book || {};
        const album = item.albumInfo || {};
        return [
          String(index + 1),
          book.title || album.name || '未命名',
          book.author || album.author || '—',
          fmtDuration(item.readTime),
        ];
      }),
    });
  }

  // 九、知识脉络（书架分类分布）
  if (shelf) {
    const catRows = shelfCategories(shelf);
    if (catRows.list.length) {
      const catTotal = catRows.list.reduce((acc, item) => acc + item.count, 0) || 1;
      blocks.push({ type: 'heading', level: 2, text: '九、知识脉络' });
      blocks.push({
        type: 'table',
        head: ['分类', '本数', '占比'],
        rows: catRows.list.map((item) => [item.name, item.count + ' 本', ((item.count / catTotal) * 100).toFixed(1) + '%']),
        bars: barPercents(catRows.list.map((item) => item.count)),
      });
      if (catRows.more > 0) {
        blocks.push({ type: 'note', text: '另有 ' + catRows.more + ' 个分类未列出（按本数降序取前 ' + CATEGORY_LIMIT + ' 个）。' });
      }
      blocks.push({ type: 'note', text: '口径：按书架电子书的「分类」字段聚合，反映书架构成，不等同于实际阅读量。' });
    }
  }

  // 十、笔记行为
  const notes = notebookStats(notebooks);
  if (notes) {
    blocks.push({ type: 'heading', level: 2, text: '十、笔记行为' });
    blocks.push({ type: 'heading', level: 3, text: '10.1 概览' });
    blocks.push({ type: 'kv', rows: [
      ['有笔记的书', notes.totalBookCount + ' 本'],
      ['笔记总条数', notes.totalNoteCount + ' 条'],
      ['其中 · 想法 / 点评', notes.reviewTotal + ' 条'],
      ['其中 · 划线', notes.noteTotal + ' 条'],
      ['其中 · 书签', notes.bookmarkTotal + ' 条'],
    ] });
    if (notes.totalBookCount > 0 && notes.totalNoteCount > 0) {
      const avg = notes.totalNoteCount / notes.totalBookCount;
      blocks.push({ type: 'heading', level: 3, text: '10.2 笔记密度（衍生指标）' });
      blocks.push({ type: 'kv', rows: [
        ['平均每本笔记数', avg.toFixed(1) + ' 条 / 本'],
        ['想法 / 点评占比', ((notes.reviewTotal / notes.totalNoteCount) * 100).toFixed(0) + '%'],
        ['划线占比', ((notes.noteTotal / notes.totalNoteCount) * 100).toFixed(0) + '%'],
      ] });
    }
    blocks.push({ type: 'heading', level: 3, text: '10.3 笔记最多的书' });
    if (notes.topBooks.length) {
      blocks.push({
        type: 'table',
        head: ['书名', '想法·点评', '划线', '书签', '合计'],
        rows: notes.topBooks.map((item) => [
          item.title || '未命名',
          String(item.reviewCount),
          String(item.noteCount),
          String(item.bookmarkCount),
          String(item.reviewCount + item.noteCount + item.bookmarkCount),
        ]),
      });
    } else {
      blocks.push({ type: 'empty', text: '暂无带笔记的书。' });
    }
  }

  // 十一、完读率
  if (shelf) {
    const fin = finishStats(shelf);
    if (fin.ebooks > 0) {
      blocks.push({ type: 'heading', level: 2, text: '十一、完读率' });
      blocks.push({ type: 'cards', items: [
        { label: '读完', value: fin.finished + ' 本' },
        { label: '在读', value: fin.reading + ' 本' },
        { label: '完读率', value: (fin.rate * 100).toFixed(1) + '%' },
        { label: '电子书总数', value: fin.ebooks + ' 本' },
      ] });
      blocks.push({ type: 'note', text: '口径：完读率 = 电子书中 finishReading=1 的本数 ÷ 电子书总数；不含专辑/有声书。' });
    }
  }

  // 十二、已读完书目
  if (shelf) {
    const finished = finishedBooks(shelf);
    if (finished.list.length) {
      blocks.push({ type: 'heading', level: 2, text: '十二、已读完书目' });
      blocks.push({
        type: 'table',
        head: ['书名', '作者', '分类'],
        rows: finished.list.map((item) => [
          item.title || '未命名',
          item.author || '—',
          item.category || '—',
        ]),
      });
      if (finished.more > 0) {
        blocks.push({ type: 'note', text: '另有 ' + finished.more + ' 本已读完的书未列出（按最近阅读时间降序取前 ' + SHELF_BOOK_LIMIT + ' 本）。' });
      }
    }
  }

  // 附录：阅读建议（规则化）
  const advice = buildAdvice(d, currentMode, shelf, notebooks);
  if (advice.length) {
    blocks.push({ type: 'heading', level: 2, text: '附录 · 阅读建议（规则化）' });
    blocks.push({ type: 'list', ordered: false, items: advice });
  }

  blocks.push({ type: 'note', text: '本报告由「悦读且住」小程序在本机按固定规则计算生成，仅供参考。' });
  return blocks;
}

module.exports = {
  MODES,
  HOUR_START,
  CST_OFFSET_MS,
  SHELF_BOOK_LIMIT,
  CATEGORY_LIMIT,
  TIME_BANDS,
  pad2,
  maxOf,
  bucketParts,
  fmtBucketLabel,
  modeLabel,
  reportBuckets,
  bucketSectionLabel,
  metricCards,
  officialSummary,
  hourlyReadTime,
  timeBands,
  buildInsights,
  shelfCounts,
  shelfCategories,
  notebookStats,
  finishStats,
  finishedBooks,
  buildPersona,
  buildAdvice,
  fmtDateTime,
  barPercents,
  buildReportBlocks,
};
