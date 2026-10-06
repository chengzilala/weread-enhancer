// 书架 · 竖版分享图（小程序 Canvas 2D 版）
//
// 复用与 persona-share.js / report-share.js 同一套平台适配：
//   1) 逻辑宽 1080、高度上限 3200；导出时按最大倍率高清重绘（在保证后备缓冲任一边 ≤4096
//      的前提下尽可能放大，iOS Canvas 2D 后备缓冲超过 4096 会报错）；
//   2) 纯本机绘制、零依赖、不联网。
//
// 说明：数据口径与书架页一致 —— 复用 report-core 的 shelfCounts / shelfCategories / finishStats，
// 只挑关键信息（概览四项 + 分类分布 + 最近在读 + 完读率 + 一句总结）做成一页竖版卡片。

const { shelfCounts, shelfCategories, finishStats } = require('./report-core');

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
const RECENT_MAX = 12;   // 最近在读最多展示本数（分享图多列几本，减少留白）

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

  // 分类分布（chips，最多 15 个 / 与报告页分类上限一致）
  if (cats.length) {
    lineDraw('分类分布', 36, INK, '700');
    y += 14;
    const chipH = 56;
    const gap = 16;
    let x = PAD;
    cats.forEach((item) => {
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

  // 完读率（有电子书才展示）
  const fin = finishStats(shelf);
  if (fin.ebooks > 0) {
    lineDraw('完读率', 36, INK, '700');
    y += 10;
    lineDraw((fin.rate * 100).toFixed(0) + '%（读完 ' + fin.finished + ' / ' + fin.ebooks + ' 本，在读 ' + fin.reading + ' 本）', 28, INK2, '400', MAXW);
    y += 16;
  }

  // 一句话总结（按数据规则拼写，不联网、不用 AI）
  const summaryBits = [];
  if (counts.books > 0) {
    summaryBits.push('书架共 ' + counts.books + ' 本电子书');
  }
  if (fin.ebooks > 0) {
    summaryBits.push('已读完 ' + fin.finished + ' 本');
  }
  if (cats.length) {
    summaryBits.push('最多的是「' + cats[0].name + '」共 ' + cats[0].count + ' 本');
  }
  if (books.length) {
    summaryBits.push('最近在读《' + (books[0].title || '未命名') + '》');
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
function renderShelfShare(canvas, payload, profile) {
  canvas.width = W;
  canvas.height = MAXH;
  const logicalH = paintShelf(canvas.getContext('2d'), payload, profile, 1);

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
  paintShelf(canvas.getContext('2d'), payload, profile, scale);
  return { width: bw, height: bh };
}

module.exports = { renderShelfShare };
