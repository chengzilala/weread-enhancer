// 书架 · 竖版分享图（小程序 Canvas 2D 版）
//
// 复用与 persona-share.js / report-share.js 同一套平台适配：
//   1) 逻辑宽 1080、高度上限 3200；导出时按 2× 高清重绘（保证后备缓冲任一边 ≤4096，
//      iOS Canvas 2D 后备缓冲超过 4096 会报错）；
//   2) 纯本机绘制、零依赖、不联网。
//
// 说明：数据口径与书架页一致 —— 复用 report-core 的 shelfCounts / shelfCategories，
// 只挑关键信息（概览四项 + 分类分布 + 最近在读）做成一页竖版卡片。

const { shelfCounts, shelfCategories } = require('./report-core');

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
const RECENT_MAX = 6;   // 最近在读最多展示本数

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
// payload: { shelf, generatedAt }
function paintShelf(ctx, payload, profile, scale) {
  const shelf = payload.shelf || {};
  const counts = shelfCounts(shelf);
  const cats = shelfCategories(shelf).list;
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

  // 头部：品牌 + 条目数 / 生成时间
  lineDraw('悦读且住 · 我的书架', 30, INK2, '600');
  y += 4;
  lineDraw('共 ' + counts.total + ' 个条目 · 生成于 ' + (payload.generatedAt || ''), 26, MUTED, '400');
  y += 26;

  // 概览四项：一行等宽小卡片
  const cards = [
    { label: '电子书', value: counts.books + ' 本' },
    { label: '有声书 / 专辑', value: counts.albums + ' 个' },
    { label: '已读完', value: counts.finished + ' 本' },
    { label: '私密', value: counts.secret + ' 项' },
  ];
  {
    const gap = 20;
    const boxW = Math.floor((MAXW - gap * (cards.length - 1)) / cards.length);
    const boxH = 148;
    const boxTop = y;
    cards.forEach((card, index) => {
      const bx = PAD + index * (boxW + gap);
      roundRect(ctx, bx, boxTop, boxW, boxH, 20);
      ctx.fillStyle = '#F7F8FA';
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.font = '600 34px ' + FONT;
      const vw = ctx.measureText(card.value).width;
      ctx.fillText(card.value, bx + Math.max(12, (boxW - vw) / 2), boxTop + 64);
      ctx.fillStyle = MUTED;
      ctx.font = '400 24px ' + FONT;
      const lw = ctx.measureText(card.label).width;
      ctx.fillText(card.label, bx + Math.max(12, (boxW - lw) / 2), boxTop + 108);
    });
    y = boxTop + boxH + 40;
  }

  // 分类分布（chips，最多 8 个）
  if (cats.length) {
    lineDraw('分类分布', 36, INK, '700');
    y += 14;
    const chipH = 56;
    const gap = 16;
    let x = PAD;
    cats.slice(0, 8).forEach((item) => {
      const text = item.name + ' · ' + item.count;
      ctx.font = '500 26px ' + FONT;
      const w = ctx.measureText(text).width + 40;
      if (x + w > W - PAD) {
        x = PAD;
        y += chipH + gap;
      }
      roundRect(ctx, x, y, w, chipH, chipH / 2);
      ctx.fillStyle = ACCENT_SOFT;
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.font = '500 26px ' + FONT;
      ctx.fillText(text, x + 20, y + chipH / 2 + 9);
      x += w + gap;
    });
    y += chipH + 40;
  }

  // 最近在读（按最近阅读时间降序，取前 N 本）
  const books = (shelf.books || []).slice()
    .sort((a, b) => (Number(b.readUpdateTime) || 0) - (Number(a.readUpdateTime) || 0))
    .slice(0, RECENT_MAX);
  if (books.length) {
    lineDraw('最近在读', 36, INK, '700');
    y += 10;
    books.forEach((item) => {
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      ctx.arc(PAD + 8, y + 16, 8, 0, Math.PI * 2);
      ctx.fill();
      lineDraw(item.title || '未命名', 30, INK, '500', MAXW - 40, PAD + 36);
      const sub = (item.author || '') + (Number(item.finishReading) === 1 ? ' · 已读完' : '');
      if (sub) {
        lineDraw(sub, 24, MUTED, '400', MAXW - 40, PAD + 36);
      }
      y += 14;
    });
    y += 12;
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
function renderShelfShare(canvas, payload, profile) {
  canvas.width = W;
  canvas.height = MAXH;
  const logicalH = paintShelf(canvas.getContext('2d'), payload, profile, 1);

  const scale = Math.min(2, MAX_SIDE / W, MAX_SIDE / logicalH);
  if (scale <= 1.05) {
    return { width: W, height: Math.round(logicalH) };
  }

  const bw = Math.round(W * scale);
  const bh = Math.min(Math.round(logicalH * scale) + 2, MAX_SIDE);
  canvas.width = bw;
  canvas.height = bh;
  paintShelf(canvas.getContext('2d'), payload, profile, scale);
  return { width: bw, height: bh };
}

module.exports = { renderShelfShare };
