// 首页 · 竖版分享图（小程序 Canvas 2D 版）
//
// 复用与 persona-share.js / report-share.js 同一套平台适配：
//   1) 逻辑宽 1080、高度上限 3200；导出时按 2× 高清重绘（保证后备缓冲任一边 ≤4096，
//      iOS Canvas 2D 后备缓冲超过 4096 会报错）；
//   2) 纯本机绘制、零依赖、不联网。
//
// 说明：数据口径与首页一致 —— 直接复用 home-core 的纯函数（hero / metrics /
// categories / timeBands / longest），不另写一套统计。

const { buildHero, buildMetrics, buildCategories, buildTimeBands, buildLongest } = require('./home-core');

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

// 一行「名称 + 右侧数值 + 进度条」，返回下一行的 y
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

// 在给定的 2d 上下文上按逻辑坐标绘制一遍（scale 为高清倍率），返回内容实际高度（逻辑像素）
// payload: { data, mode, modeLabel, generatedAt }
function paintHome(ctx, payload, profile, scale) {
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

  // 头部：品牌 + 周期 / 生成时间
  lineDraw('悦读且住 · 阅读数据总览', 30, INK2, '600');
  y += 4;
  const headMeta = (payload.modeLabel ? payload.modeLabel + ' · ' : '') + '生成于 ' + (payload.generatedAt || '');
  lineDraw(headMeta, 26, MUTED, '400');
  y += 26;

  // 核心指标：总时长做「主数字」
  const cards = buildMetrics(d);
  const hero = buildHero(d, payload.mode);
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

  // 官方判定语（有则展示，浅底卡片）
  if (hero.word) {
    const text = '官方判定：' + hero.word;
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

  // 偏好分类 Top3
  const cats = buildCategories(d);
  if (cats.length) {
    lineDraw('偏好分类 Top3', 36, INK, '700');
    y += 8;
    cats.forEach((item) => {
      y = drawBarRow(ctx, y, item.name, item.time + ' · ' + item.pct, item.bar);
    });
    y += 12;
  }

  // 阅读时段分布（官方仅「累计」周期返回）
  const bands = buildTimeBands(d);
  if (bands) {
    lineDraw('阅读时段分布', 36, INK, '700');
    y += 8;
    bands.rows.slice(0, 4).forEach((item) => {
      y = drawBarRow(ctx, y, item.label, item.time + ' · ' + item.pct, item.bar);
    });
    if (bands.peak) {
      lineDraw('峰值时段：' + bands.peak, 24, MUTED, '400', MAXW);
      y += 8;
    }
    y += 12;
  }

  // 读得最多 Top3
  const longest = buildLongest(d);
  if (longest.length) {
    lineDraw('读得最多', 36, INK, '700');
    y += 10;
    longest.forEach((item) => {
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      ctx.arc(PAD + 8, y + 16, 8, 0, Math.PI * 2);
      ctx.fill();
      lineDraw(item.title, 30, INK, '500', MAXW - 40, PAD + 36);
      lineDraw((item.author ? item.author + ' · ' : '') + item.time, 24, MUTED, '400', MAXW - 40, PAD + 36);
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
function renderHomeShare(canvas, payload, profile) {
  canvas.width = W;
  canvas.height = MAXH;
  const logicalH = paintHome(canvas.getContext('2d'), payload, profile, 1);

  const scale = Math.min(2, MAX_SIDE / W, MAX_SIDE / logicalH);
  if (scale <= 1.05) {
    return { width: W, height: Math.round(logicalH) };
  }

  const bw = Math.round(W * scale);
  const bh = Math.min(Math.round(logicalH * scale) + 2, MAX_SIDE);
  canvas.width = bw;
  canvas.height = bh;
  paintHome(canvas.getContext('2d'), payload, profile, scale);
  return { width: bw, height: bh };
}

module.exports = { renderHomeShare };
