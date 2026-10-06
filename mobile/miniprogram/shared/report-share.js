// 阅读报告 · 竖版分享图（小程序 Canvas 2D 版）
//
// 复用与 persona-share.js / daily-share.js 同一套平台适配：
//   1) 逻辑宽 1080、高度上限 3200；导出时按最大倍率高清重绘（在保证后备缓冲任一边 ≤4096
//      的前提下尽可能放大，iOS Canvas 2D 后备缓冲超过 4096 会报错）；
//   2) 纯本机绘制、零依赖、不联网。
//
// 说明：分享图挑报告里的关键信息（核心指标 + 一个亮点 + 偏好分类 Top5 + 时段分布 +
// 读得最多 Top5 + 笔记概览 + 完读率 + 一句总结）做成一页竖版卡片，不搬运整份报告；
// 数据口径与报告页一致（复用 report-core 纯函数）。

const { metricCards, reportBuckets, fmtBucketLabel, notebookStats, timeBands, finishStats, barPercents } = require('./report-core');
const { fmtDuration } = require('./format');

const W = 1080;         // 逻辑宽
const PAD = 72;
const MAXW = W - PAD * 2;
const MAXH = 3200;      // 高度上限（缓冲高度 = MAXH，安全低于 4096）
const MAX_SIDE = 4096;  // Canvas 2D 后备缓冲任一边的上限

const INK = '#1F2430';
const INK2 = '#4A5060';
const ACCENT = '#2F6BFF';       // 小程序主色（蓝），与页面 / 导航保持一致
const ACCENT_SOFT = '#F0F4FF';
const LINE = '#E8EBF0';
const MUTED = '#A8ADB8';
const FONT = 'sans-serif';

const BRAND = '悦读且住';
const BRAND_SUB = '基于我的微信读书数据生成';

// 圆角矩形路径（不依赖 ctx.roundRect 的平台支持）
function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, h / 2, w / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

// 按宽度折行（中英文逐字符测量）
function wrapText(ctx, text, maxWidth) {
  const chars = String(text || '').split('');
  const lines = [];
  let line = '';
  chars.forEach((ch) => {
    if (ch === '\n') {
      lines.push(line);
      line = '';
      return;
    }
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line = test;
    }
  });
  if (line) {
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

// 一行「名称 + 右侧数值 + 进度条」，返回下一行的 y（与首页分享图同一套画法）
function drawBarRow(ctx, y, name, valueText, barPct) {
  ctx.fillStyle = INK;
  ctx.font = '500 30px ' + FONT;
  ctx.fillText(name, PAD, y + 24);
  ctx.fillStyle = MUTED;
  ctx.font = '400 24px ' + FONT;
  const vw = ctx.measureText(valueText).width;
  ctx.fillText(valueText, W - PAD - vw, y + 24);
  y += 44;
  roundRect(ctx, PAD, y, MAXW, 16, 8);
  ctx.fillStyle = LINE;
  ctx.fill();
  if (barPct > 0) {
    roundRect(ctx, PAD, y, Math.max(8, Math.round(MAXW * (barPct / 100))), 16, 8);
    ctx.fillStyle = ACCENT;
    ctx.fill();
  }
  y += 16 + 24;
  return y;
}

/** 偏好分类 TopN（口径同报告页 2.4：按阅读时长降序） */
function reportCategories(data, limit) {
  const cats = Array.isArray(data && data.preferCategory) ? data.preferCategory : [];
  if (!cats.length) {
    return [];
  }
  const total = cats.reduce((acc, item) => acc + (Number(item.readingTime) || 0), 0) || 1;
  const sorted = cats.slice()
    .sort((a, b) => (Number(b.readingTime) || 0) - (Number(a.readingTime) || 0))
    .slice(0, limit || 5);
  const percents = barPercents(sorted.map((item) => item.readingTime));
  return sorted.map((item, index) => ({
    name: item.parentCategoryTitle || item.categoryTitle || '未分类',
    time: fmtDuration(item.readingTime),
    pct: Math.round(((Number(item.readingTime) || 0) / total) * 100) + '%',
    bar: percents[index],
  }));
}

// 在给定的 2d 上下文上按逻辑坐标绘制一遍（scale 为高清倍率），返回内容实际高度（逻辑像素）
// payload: { data, overview, mode, modeLabel, generatedAt }
function paintReport(ctx, payload, profile, scale) {
  const d = payload.data || {};
  const brandSub = profile && profile.nickName
    ? profile.nickName + ' · 基于我的微信读书数据生成'
    : BRAND_SUB;

  ctx.save();
  ctx.scale(scale, scale);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, MAXH);

  let y = 84;
  const lineDraw = (text, size, color, weight, maxWidth, x0, lineHeight) => {
    const startX = x0 === undefined ? PAD : x0;
    ctx.fillStyle = color;
    ctx.font = (weight || '400') + ' ' + size + 'px ' + FONT;
    const lh = lineHeight || Math.round(size * 1.42);
    const lines = maxWidth ? wrapText(ctx, text, maxWidth) : [String(text)];
    lines.forEach((ln) => {
      ctx.fillText(ln, startX, y + Math.round(size * 0.82));
      y += lh;
    });
  };

  // 头部：品牌 + 周期/生成时间
  lineDraw('悦读且住 · 阅读行为报告', 30, INK2, '600');
  y += 4;
  const headMeta = (payload.modeLabel ? payload.modeLabel + ' · ' : '') + '生成于 ' + (payload.generatedAt || '');
  lineDraw(headMeta, 26, MUTED, '400');
  y += 26;

  // 核心指标：总时长做「主数字」
  const cards = metricCards(d);
  const hero = cards[0] || { label: '总时长', value: '—' };
  lineDraw(hero.value, 88, ACCENT, '800', MAXW, PAD, 104);
  lineDraw(hero.label, 26, INK2, '400');
  y += 18;

  // 其余核心指标：一行等宽小卡片
  const rest = cards.slice(1);
  if (rest.length) {
    const gap = 20;
    const boxW = Math.floor((MAXW - gap * (rest.length - 1)) / rest.length);
    const boxH = 148;
    const boxTop = y;
    rest.forEach((card, index) => {
      const bx = PAD + index * (boxW + gap);
      roundRect(ctx, bx, boxTop, boxW, boxH, 20);
      ctx.fillStyle = '#F7F8FA';
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.font = '600 34px ' + FONT;
      const vw = ctx.measureText(card.value).width;
      ctx.fillText(card.value, bx + Math.max(16, (boxW - vw) / 2), boxTop + 64);
      ctx.fillStyle = MUTED;
      ctx.font = '400 24px ' + FONT;
      const lw = ctx.measureText(card.label).width;
      ctx.fillText(card.label, bx + Math.max(16, (boxW - lw) / 2), boxTop + 108);
    });
    y = boxTop + boxH + 40;
  }

  // 亮点：阅读最集中的周期（浅底卡片）
  const positive = reportBuckets(d).filter((item) => item.seconds > 0);
  if (positive.length) {
    const total = positive.reduce((acc, item) => acc + item.seconds, 0) || 1;
    const peak = positive.reduce((acc, item) => (item.seconds > acc.seconds ? item : acc));
    const text = '阅读最集中的是 ' + fmtBucketLabel(peak.ts, payload.mode) + '：' + fmtDuration(peak.seconds) +
      '（占 ' + ((peak.seconds / total) * 100).toFixed(1) + '%）';
    ctx.font = '500 28px ' + FONT;
    const lines = wrapText(ctx, text, MAXW - 44);
    const boxH = 30 * 2 + lines.length * Math.round(28 * 1.5);
    roundRect(ctx, PAD, y, MAXW, boxH, 20);
    ctx.fillStyle = ACCENT_SOFT;
    ctx.fill();
    let ty = y + 30;
    ctx.fillStyle = INK;
    lines.forEach((ln) => {
      ctx.fillText(ln, PAD + 22, ty + Math.round(28 * 0.82));
      ty += Math.round(28 * 1.5);
    });
    y += boxH + 40;
  }

  // 读得最多 Top5
  const longest = Array.isArray(d.readLongest) ? d.readLongest.slice(0, 5) : [];
  if (longest.length) {
    lineDraw('读得最多', 36, INK, '700');
    y += 10;
    longest.forEach((item) => {
      const book = item.book || {};
      const album = item.albumInfo || {};
      const title = book.title || album.name || '未命名';
      const author = book.author || album.author || '';
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      ctx.arc(PAD + 8, y + 16, 8, 0, Math.PI * 2);
      ctx.fill();
      lineDraw(title, 30, INK, '500', MAXW - 40, PAD + 36);
      lineDraw((author ? author + ' · ' : '') + fmtDuration(item.readTime), 24, MUTED, '400', MAXW - 40, PAD + 36);
      y += 14;
    });
    y += 12;
  }

  // 偏好分类 Top5（分享图多展示几条，减少留白）
  const cats = reportCategories(d, 5);
  if (cats.length) {
    lineDraw('偏好分类 Top' + cats.length, 36, INK, '700');
    y += 8;
    cats.forEach((item) => {
      y = drawBarRow(ctx, y, item.name, item.time + ' · ' + item.pct, item.bar);
    });
    y += 12;
  }

  // 阅读时段分布（官方仅「累计」周期返回 preferTime）
  const bands = timeBands(d);
  const bandPositive = bands.filter((item) => item.seconds > 0);
  if (bandPositive.length) {
    const bandTotal = bandPositive.reduce((acc, item) => acc + item.seconds, 0) || 1;
    const percents = barPercents(bandPositive.map((item) => item.seconds));
    lineDraw('阅读时段分布', 36, INK, '700');
    y += 8;
    bandPositive.slice(0, 6).forEach((item, index) => {
      const pct = Math.round((item.seconds / bandTotal) * 100) + '%';
      y = drawBarRow(ctx, y, item.label, fmtDuration(item.seconds) + ' · ' + pct, percents[index]);
    });
    y += 12;
  }

  // 笔记概览（有笔记才展示）
  const notes = notebookStats(payload.overview ? payload.overview.notebooks : null);
  if (notes && (notes.totalNoteCount > 0 || notes.totalBookCount > 0)) {
    lineDraw('笔记', 36, INK, '700');
    y += 10;
    lineDraw('共 ' + notes.totalNoteCount + ' 条，来自 ' + notes.totalBookCount + ' 本书', 28, INK2, '400', MAXW);
    lineDraw('想法/点评 ' + notes.reviewTotal + ' · 划线 ' + notes.noteTotal + ' · 书签 ' + notes.bookmarkTotal, 26, MUTED, '400', MAXW);
    y += 8;
  }

  // 完读率（有书架数据才展示）
  const shelf = payload.overview ? payload.overview.shelf : null;
  if (shelf) {
    const fin = finishStats(shelf);
    if (fin.ebooks > 0) {
      lineDraw('完读率', 36, INK, '700');
      y += 10;
      lineDraw((fin.rate * 100).toFixed(0) + '%（读完 ' + fin.finished + ' / ' + fin.ebooks + ' 本，在读 ' + fin.reading + ' 本）', 28, INK2, '400', MAXW);
      y += 16;
    }
  }

  // 一句话总结（按数据规则拼写，不联网、不用 AI）
  const summaryBits = [];
  if (hero.value) {
    summaryBits.push('本周期共阅读 ' + hero.value);
  }
  if (cats.length) {
    summaryBits.push('最偏爱「' + cats[0].name + '」');
  }
  if (longest.length) {
    const top = longest[0];
    const topBook = top.book || {};
    const topAlbum = top.albumInfo || {};
    summaryBits.push('读得最多的是《' + (topBook.title || topAlbum.name || '未命名') + '》');
  }
  if (notes && notes.totalNoteCount > 0) {
    summaryBits.push('留下 ' + notes.totalNoteCount + ' 条笔记');
  }
  if (summaryBits.length) {
    const text = summaryBits.join('，') + '。';
    ctx.font = '500 30px ' + FONT;
    const lines = wrapText(ctx, text, MAXW - 44);
    const boxH = 32 * 2 + lines.length * Math.round(30 * 1.5);
    roundRect(ctx, PAD, y, MAXW, boxH, 24);
    ctx.fillStyle = ACCENT_SOFT;
    ctx.fill();
    let ty = y + 32;
    ctx.fillStyle = INK;
    lines.forEach((ln) => {
      ctx.fillText(ln, PAD + 22, ty + Math.round(30 * 0.82));
      ty += Math.round(30 * 1.5);
    });
    y += boxH + 40;
  }

  // 品牌署名
  ctx.fillStyle = LINE;
  ctx.fillRect(PAD, y, MAXW, 1);
  y += 44;
  lineDraw(BRAND, 28, ACCENT, '700');
  y += 6;
  lineDraw(brandSub, 24, INK2, '400');

  const finalH = Math.min(y + PAD - 20, MAXH);
  ctx.restore();
  return finalH;
}

// 在传入的 canvas 节点上绘制竖版分享图（两遍绘制：先测高，再按最大倍率高清重绘）。
// 返回 { width, height }（画布缓冲像素 = 导出后图片的像素尺寸）。
function renderReportShare(canvas, payload, profile) {
  canvas.width = W;
  canvas.height = MAXH;
  const logicalH = paintReport(canvas.getContext('2d'), payload, profile, 1);

  // 高清倍率：在「任一边 ≤ MAX_SIDE（iOS 4096）」前提下取最大倍率
  // （原先额外压了 2× 上限，是清晰度不足的主因）
  const scale = Math.min(MAX_SIDE / W, MAX_SIDE / logicalH);
  if (scale <= 1.05) {
    return { width: W, height: Math.round(logicalH) };
  }

  const bw = Math.round(W * scale);
  const bh = Math.min(Math.round(logicalH * scale) + 2, MAX_SIDE);
  canvas.width = bw;
  canvas.height = bh;
  paintReport(canvas.getContext('2d'), payload, profile, scale);
  return { width: bw, height: bh };
}

module.exports = { renderReportShare };
