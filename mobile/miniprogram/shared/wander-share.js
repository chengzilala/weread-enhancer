// 灵感漫游（M12）· 竖版分享图（小程序 Canvas 2D 版）
//
// 复用与 persona-share / daily-share 同一套平台适配：
//   1) 逻辑宽 1080、高度上限 3200；导出时按最大倍率高清重绘（在保证后备缓冲任一边 ≤4096 的前提下尽可能放大，iOS 超限会报错）；
//   2) 纯本机绘制、零依赖、不联网。
//
// 说明：分享图含划线 / 想法原文，仅在用户主动点击「生成分享图」时于本机绘制；
// 页面上会标注来源（书名）与「AI 生成」，不改动任何原始文字。

const W = 1080;         // 逻辑宽
const PAD = 72;
const MAXW = W - PAD * 2;
const MAXH = 3200;      // 高度上限（安全低于 4096）
const MAX_SIDE = 4096;

const INK = '#1F2430';
const INK2 = '#4A5060';
const ACCENT = '#7C5CFF';       // 灵感漫游主色（保留紫色，区别于其余分享图的主题蓝）
const ACCENT_SOFT = '#F1EDFF';
const LINE = '#E8EBF0';
const FONT = 'sans-serif';

const BRAND = '悦读且住';

const TIER_COLOR = { copper: '#C08A3E', silver: '#8A93A6', gold: '#C9962B' };

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

function paintIssue(ctx, issue, profile, scale) {
  const brandSub = profile && profile.nickName
    ? profile.nickName + ' · 基于我的微信读书划线生成'
    : '基于我的微信读书划线生成';

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

  // 头部
  lineDraw('悦读且住 · 灵感漫游', 30, INK2, '600');
  y += 4;
  lineDraw((issue.weekLabel || '') + (issue.tierName ? ('　第 ' + issue.tierName + ' 档') : ''), 26, '#A8ADB8', '400');
  y += 30;
  lineDraw(issue.title, 58, INK, '700', MAXW);
  y += 16;

  // 摘要（浅底卡）
  if (issue.summary) {
    const padV = 28;
    const padH = 32;
    ctx.font = '400 32px ' + FONT;
    const sumLines = wrapText(ctx, issue.summary, MAXW - padH * 2);
    const sumH = sumLines.length * Math.round(32 * 1.6) + padV * 2;
    roundRect(ctx, PAD, y, MAXW, sumH, 20);
    ctx.fillStyle = ACCENT_SOFT;
    ctx.fill();
    let ty = y + padV;
    ctx.fillStyle = '#4A3F80';
    sumLines.forEach((ln) => {
      ctx.fillText(ln, PAD + padH, ty + Math.round(32 * 0.82));
      ty += Math.round(32 * 1.6);
    });
    y += sumH + 34;
  }

  // 分隔线
  ctx.fillStyle = LINE;
  ctx.fillRect(PAD, y, MAXW, 1);
  y += 46;

  // 正文（仅 AI 开启时才有；M15 关闭后本地排版无正文，整块跳过）
  if (issue.body) {
    const badgeText = '内容由 AI 生成 · 主题综述';
    ctx.font = '600 26px ' + FONT;
    const badgeW = ctx.measureText(badgeText).width + 40;
    const badgeH = 54;
    roundRect(ctx, PAD, y, badgeW, badgeH, badgeH / 2);
    ctx.fillStyle = ACCENT;
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(badgeText, PAD + 20, y + badgeH / 2 + 9);
    y += badgeH + 30;

    ctx.font = '400 34px ' + FONT;
    const limitLines = 30;
    let bodyLines = String(issue.body || '').split('\n').reduce((acc, para) => acc.concat(wrapText(ctx, para, MAXW)), []);
    if (bodyLines.length > limitLines) {
      bodyLines = bodyLines.slice(0, limitLines);
      bodyLines[limitLines - 1] = bodyLines[limitLines - 1].slice(0, -1) + '…';
    }
    ctx.fillStyle = INK;
    bodyLines.forEach((ln) => {
      ctx.fillText(ln, PAD, y + Math.round(34 * 0.82));
      y += Math.round(34 * 1.62);
    });
    y += 24;
  }

  // 素材来源（本地排版模式下即为分享图主体内容）
  const sources = (issue.sources || []).slice(0, 6);
  if (sources.length) {
    lineDraw('来源', 32, INK, '700');
    y += 12;
    sources.forEach((item) => {
      const indent = 26;
      const itemTop = y;
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      ctx.arc(PAD + 8, itemTop + 15, 8, 0, Math.PI * 2);
      ctx.fill();
      lineDraw(item.text, 28, INK2, '400', MAXW - indent, PAD + indent);
      lineDraw('——《' + (item.title || '未命名') + '》' + (item.author ? (' · ' + item.author) : ''), 24, '#A8ADB8', '400', MAXW - indent, PAD + indent);
      y += 16;
    });
    y += 6;
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
function renderWanderShare(canvas, issue, profile) {
  canvas.width = W;
  canvas.height = MAXH;
  const logicalH = paintIssue(canvas.getContext('2d'), issue, profile, 1);

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
  paintIssue(canvas.getContext('2d'), issue, profile, scale);
  return { width: bw, height: bh };
}

module.exports = { renderWanderShare, TIER_COLOR };
