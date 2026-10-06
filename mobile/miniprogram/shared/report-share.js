// 阅读报告 · 竖版分享图（小程序 Canvas 2D 版）
//
// 复用与 persona-share.js / daily-share.js 同一套平台适配：
//   1) 逻辑宽 1080、高度上限 3200；导出时按 2× 高清重绘（且保证后备缓冲任一边 ≤4096，
//      iOS Canvas 2D 后备缓冲超过 4096 会报错）；
//   2) 纯本机绘制、零依赖、不联网。
//
// 说明：分享图只挑报告里的关键信息（核心指标 + 一个亮点 + 读得最多 Top3 + 笔记概览）
// 做成一页竖版卡片，不搬运整份报告；数据口径与报告页一致（复用 report-core 纯函数）。

const { metricCards, reportBuckets, fmtBucketLabel, notebookStats } = require('./report-core');
const { fmtDuration } = require('./format');

const W = 1080;         // 逻辑宽
const PAD = 72;
const MAXW = W - PAD * 2;
const MAXH = 3200;      // 高度上限（缓冲高度 = MAXH，安全低于 4096）
const MAX_SIDE = 4096;  // Canvas 2D 后备缓冲任一边的上限

const INK = '#1F2430';
const INK2 = '#4A5060';
const ACCENT = '#07C160';       // 微信绿，与网页/插件版分享图保持一致
const ACCENT_SOFT = '#E8F8EF';
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

  // 读得最多 Top3
  const longest = Array.isArray(d.readLongest) ? d.readLongest.slice(0, 3) : [];
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

  // 笔记概览（有笔记才展示）
  const notes = notebookStats(payload.overview ? payload.overview.notebooks : null);
  if (notes && (notes.totalNoteCount > 0 || notes.totalBookCount > 0)) {
    lineDraw('笔记', 36, INK, '700');
    y += 10;
    lineDraw('共 ' + notes.totalNoteCount + ' 条，来自 ' + notes.totalBookCount + ' 本书', 28, INK2, '400', MAXW);
    y += 8;
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

// 在传入的 canvas 节点上绘制竖版分享图（两遍绘制：先测高，再按 2× 高清重绘）。
// 返回 { width, height }（画布缓冲像素 = 导出后图片的像素尺寸）。
function renderReportShare(canvas, payload, profile) {
  canvas.width = W;
  canvas.height = MAXH;
  const logicalH = paintReport(canvas.getContext('2d'), payload, profile, 1);

  const scale = Math.min(2, MAX_SIDE / W, MAX_SIDE / logicalH);
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
