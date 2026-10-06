// 每日卡片回顾 · 竖版分享图（小程序 Canvas 2D 版）
//
// 复用与 persona-share.js 同一套平台适配：
//   1) 逻辑宽 1080、高度上限 3200；导出时按最大倍率高清重绘（在保证后备缓冲任一边 ≤4096
//      的前提下尽可能放大，iOS Canvas 2D 后备缓冲超过 4096 会报错）；
//   2) 纯本机绘制、零依赖、不联网。
//
// 说明：分享图含划线 / 想法原文，仅在用户主动点击「生成分享图」时于本机绘制；
// 页面上会标注来源（书名）与「AI 生成」，不改动任何原始文字。

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
const FONT = 'sans-serif';

const BRAND = '悦读且住';

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
function paintCard(ctx, card, profile, scale) {
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
  lineDraw('悦读且住 · 每日卡片回顾', 30, INK2, '600');
  y += 4;
  lineDraw(card.dateLabel || '今天', 26, '#A8ADB8', '400');
  y += 24;
  lineDraw(card.title, 56, INK, '700', MAXW);
  y += 20;

  // 主题标签（有则展示，减少上半部分留白）
  const themes = Array.isArray(card.themes) ? card.themes : [];
  if (themes.length) {
    const chipH = 52;
    const chipGap = 16;
    let x = PAD;
    themes.forEach((text) => {
      ctx.font = '500 26px ' + FONT;
      const w = ctx.measureText(text).width + 40;
      if (x + w > W - PAD) {
        x = PAD;
        y += chipH + chipGap;
      }
      roundRect(ctx, x, y, w, chipH, chipH / 2);
      ctx.fillStyle = ACCENT_SOFT;
      ctx.fill();
      ctx.fillStyle = ACCENT;
      ctx.font = '500 26px ' + FONT;
      ctx.fillText(text, x + 20, y + chipH / 2 + 9);
      x += w + chipGap;
    });
    y += chipH + 20;
  }

  // 分隔线
  ctx.fillStyle = LINE;
  ctx.fillRect(PAD, y, MAXW, 1);
  y += 52;

  // 引用（划线原文 + 出处）
  const quote = card.quote || {};
  const quoteStartY = y;
  const quoteIndent = 34;
  ctx.fillStyle = ACCENT_SOFT;
  ctx.font = '400 34px ' + FONT;
  const notePadV = 30;
  const notePadH = 32;

  // 先测量引用文本高度以确定左侧竖条长度
  {
    ctx.font = '400 38px ' + FONT;
    const qLines = wrapText(ctx, quote.text, MAXW - quoteIndent * 2);
    const quoteH = qLines.length * Math.round(38 * 1.5);
    ctx.fillStyle = ACCENT;
    ctx.fillRect(PAD, quoteStartY + 4, 8, quoteH + 8);
    lineDraw(quote.text, 38, INK, '400', MAXW - quoteIndent * 2, PAD + quoteIndent, Math.round(38 * 1.5));
    lineDraw('——《' + (quote.title || '未命名') + '》' + (quote.author ? (' · ' + quote.author) : ''), 26, INK2, '400', MAXW - quoteIndent, PAD + quoteIndent);
  }
  y += 40;

  // 说明：仅当卡片带文案时才绘制。M15 关闭 AI 后，本地规则排版卡片没有 note，整块跳过。
  if (card.note) {
    if (card.ai) {
      const badgeText = '内容由 AI 生成';
      ctx.font = '600 26px ' + FONT;
      const badgeW = ctx.measureText(badgeText).width + 40;
      const badgeH = 54;
      roundRect(ctx, PAD, y, badgeW, badgeH, badgeH / 2);
      ctx.fillStyle = ACCENT;
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(badgeText, PAD + 20, y + badgeH / 2 + 9);
      y += badgeH + 26;
    }

    // 说明正文（放在浅底卡片里）
    ctx.font = '400 34px ' + FONT;
    const noteLines = wrapText(ctx, card.note || '', MAXW - notePadH * 2);
    const noteH = noteLines.length * Math.round(34 * 1.55) + notePadV * 2;
    roundRect(ctx, PAD, y, MAXW, noteH, 24);
    ctx.fillStyle = '#F7F8FA';
    ctx.fill();
    {
      let ty = y + notePadV;
      ctx.fillStyle = INK;
      ctx.font = '400 34px ' + FONT;
      noteLines.forEach((ln) => {
        ctx.fillText(ln, PAD + notePadH, ty + Math.round(34 * 0.82));
        ty += Math.round(34 * 1.55);
      });
    }
    y += noteH + 46;
  }

  // 关联的旧划线
  const related = card.related || [];
  if (related.length) {
    lineDraw('关联的旧划线', 34, INK, '700');
    y += 14;
    related.forEach((item) => {
      const indent = 26;
      const itemTop = y;
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      ctx.arc(PAD + 8, itemTop + 16, 8, 0, Math.PI * 2);
      ctx.fill();
      lineDraw(item.text, 30, INK2, '400', MAXW - indent, PAD + indent);
      lineDraw('——《' + (item.title || '未命名') + '》' + (item.author ? (' · ' + item.author) : ''), 24, '#A8ADB8', '400', MAXW - indent, PAD + indent);
      y += 18;
    });
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

// 在传入的 canvas 节点上绘制竖版分享图（两遍绘制：先测高，再按最大倍率高清重绘）。
// 返回 { width, height }（画布缓冲像素 = 导出后图片的像素尺寸）。
function renderDailyShare(canvas, card, profile) {
  canvas.width = W;
  canvas.height = MAXH;
  const logicalH = paintCard(canvas.getContext('2d'), card, profile, 1);

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
  paintCard(canvas.getContext('2d'), card, profile, scale);
  return { width: bw, height: bh };
}

module.exports = { renderDailyShare };
