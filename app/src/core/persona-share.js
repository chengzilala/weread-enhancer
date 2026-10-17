/**
 * 阅读人格 · 竖版分享图（H5 canvas 版）
 *
 * 来源：mobile/miniprogram/shared/persona-share.js（版面 / 配色 / 文案逐项对齐）。
 * 两处平台适配：
 *   1) 用浏览器 DOM canvas 两遍绘制（先测高、再按最大倍率高清重绘，见 share-canvas）；
 *   2) 人物线描用同一套极小 SVG 子集渲染器直接画到 canvas（零依赖、不联网）。
 * 字段适配：H5 persona-core 的 dims 用 { leftPct, left.label, right.label }，此处换算为
 * 小程序分享图使用的 { pct, leftLabel, rightLabel }，并按同样的规则拼出 codeItems。
 *
 * renderPersonaShare(persona, profile) → { ok, dataUrl, error? }
 */

import { personaFigureSvg } from './persona-figure.js';
import {
  W, PAD, MAXW, MAXH,
  INK, INK2, ACCENT, ACCENT_SOFT, LINE, FONT, BRAND,
  brandSubOf, roundRect, wrapText, drawFigureSvg, renderHiRes,
} from './share-canvas.js';

// H5 dims → 小程序分享图字段；并拼出「四位代码释义」（让看图的人也看得懂字母）
function shareDims(persona) {
  return (persona.dims || []).map((dim) => ({
    title: dim.title,
    available: dim.available,
    pct: dim.leftPct,
    leftLabel: dim.left ? dim.left.label : '',
    rightLabel: dim.right ? dim.right.label : '',
    basis: dim.basis || '',
    letter: dim.available ? (dim.side || '–') : '–',
    label: dim.available
      ? ((dim.left && dim.side === dim.left.letter) ? dim.left.label : (dim.right ? dim.right.label : ''))
      : '待补全',
  }));
}

// 在给定的 2d 上下文上按逻辑坐标绘制一遍（scale 为高清倍率），返回内容实际高度（逻辑像素）
function paintPersona(ctx, persona, profile, scale) {
  const brandSub = brandSubOf(profile);

  ctx.save();
  ctx.scale(scale, scale);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, MAXH);

  let y = 84;
  const lineDraw = (text, size, color, weight, maxWidth, x0) => {
    const startX = x0 === undefined ? PAD : x0;
    ctx.fillStyle = color;
    ctx.font = (weight || '400') + ' ' + size + 'px ' + FONT;
    const lh = Math.round(size * 1.42);
    const lines = maxWidth ? wrapText(ctx, text, maxWidth) : [String(text)];
    lines.forEach((ln) => {
      ctx.fillText(ln, startX, y + Math.round(size * 0.82));
      y += lh;
    });
  };

  const figure = persona.figure;
  const dims = shareDims(persona);

  // 头部：左侧人格代码 + 称号 + 定调，右侧人物插画
  const headTop = y;
  const D = figure ? 330 : 0;
  const figX = W - PAD - D;
  const leftMaxW = figure ? figX - PAD - 36 : MAXW;
  lineDraw(persona.reader ? ('『' + persona.reader + '』的阅读人格 · 读书人版') : '我的阅读人格 · 读书人版', 30, INK2, '600', leftMaxW);
  y += 10;
  lineDraw(persona.code, 120, ACCENT, '800', leftMaxW);
  y += 6;
  // 人格代码释义：让收到图的人也看得懂四位字母
  if (dims.length) {
    lineDraw(dims.map((item) => item.letter + ' ' + item.label).join(' · '), 30, INK2, '400', leftMaxW);
    y += 4;
  }
  lineDraw(persona.name, 54, INK, '700', leftMaxW);
  y += 8;
  lineDraw(persona.tagline, 30, INK2, '400', leftMaxW);
  const leftBottom = y;

  if (figure) {
    const figTop = headTop;
    ctx.beginPath();
    ctx.arc(figX + D / 2, figTop + D / 2, D * 0.46, 0, Math.PI * 2);
    ctx.fillStyle = ACCENT_SOFT;
    ctx.fill();
    drawFigureSvg(ctx, personaFigureSvg(persona.code, ACCENT), figX, figTop, D);
    ctx.fillStyle = INK;
    ctx.font = '700 40px ' + FONT;
    const nameW = ctx.measureText(figure.name).width;
    ctx.fillText(figure.name, figX + (D - nameW) / 2, figTop + D + 50);
    ctx.fillStyle = INK2;
    ctx.font = '400 24px ' + FONT;
    let figY = figTop + D + 88;
    wrapText(ctx, figure.line, D).forEach((ln) => {
      const lw = ctx.measureText(ln).width;
      ctx.fillText(ln, figX + (D - lw) / 2, figY);
      figY += Math.round(24 * 1.42);
    });
    y = Math.max(leftBottom, figY + 6);
  } else {
    y = leftBottom;
  }
  y += 24;

  // 三个特质绰号
  const nicknames = persona.nicknames || [];
  if (nicknames.length) {
    const size = 32;
    const pillH = size + 26;
    ctx.font = '600 ' + size + 'px ' + FONT;
    let x = PAD;
    let rowY = y;
    nicknames.forEach((text) => {
      const w = ctx.measureText(text).width + 44;
      if (x + w > W - PAD) {
        x = PAD;
        rowY += pillH + 16;
      }
      roundRect(ctx, x, rowY, w, pillH, pillH / 2);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = ACCENT;
      ctx.fillText(text, x + 22, rowY + pillH / 2 + size * 0.36);
      x += w + 16;
    });
    y = rowY + pillH + 30;
  }

  // 四维进度条
  dims.forEach((dim) => {
    ctx.fillStyle = INK;
    ctx.font = '600 30px ' + FONT;
    ctx.fillText(dim.title, PAD, y + 24);
    ctx.fillStyle = INK2;
    ctx.font = '400 30px ' + FONT;
    const valueText = dim.available
      ? (dim.leftLabel + ' ' + dim.pct + '%  ↔  ' + (100 - dim.pct) + '% ' + dim.rightLabel)
      : '数据不足';
    const vw = ctx.measureText(valueText).width;
    ctx.fillText(valueText, W - PAD - vw, y + 24);
    y += 44;
    roundRect(ctx, PAD, y, MAXW, 16, 8);
    ctx.fillStyle = LINE;
    ctx.fill();
    if (dim.available) {
      roundRect(ctx, PAD, y, Math.max(8, Math.round(MAXW * (dim.pct / 100))), 16, 8);
      ctx.fillStyle = ACCENT;
      ctx.fill();
    }
    y += 16 + 12;
    if (dim.basis) {
      lineDraw((dim.available ? '依据：' : '') + dim.basis, 24, INK2, '400', MAXW);
    }
    y += 16;
  });

  // 分隔线
  y += 4;
  ctx.fillStyle = LINE;
  ctx.fillRect(PAD, y, MAXW, 1);
  y += 44;

  // 词语亮点
  const words = persona.words;
  if (words) {
    lineDraw('词语亮点', 36, INK, '700');
    y += 10;
    const topWords = (words.top || []).slice(0, 5);
    if (topWords.length) {
      lineDraw('高频词：' + topWords.map((item) => item.word + ' ×' + item.count).join('　'), 30, INK, '400', MAXW);
      y += 6;
    }
    if (words.catchphrase) {
      lineDraw('你的口头禅', 28, INK2, '600');
      y += 4;
      const quoteIndent = 22;
      const quoteStartY = y;
      lineDraw('“' + words.catchphrase.text + '”', 32, INK, '400', MAXW - quoteIndent, PAD + quoteIndent);
      if (words.catchphrase.title) {
        lineDraw('—— 《' + words.catchphrase.title + '》', 26, INK2, '400', MAXW - quoteIndent, PAD + quoteIndent);
      }
      ctx.fillStyle = ACCENT;
      ctx.fillRect(PAD, quoteStartY + 4, 6, Math.max(24, y - quoteStartY - 12));
    }
    y += 24;
  }

  // 数据证据
  const evidenceData = (persona.evidence && persona.evidence.data) || [];
  if (evidenceData.length) {
    lineDraw('数据证据', 36, INK, '700');
    y += 12;
    const items = evidenceData.slice(0, 6);
    const gap = 20;
    const padV = 22;
    const padH = 20;
    // 4 条以内单行铺满；5~6 条改 3 列两行，避免每格过窄
    const perRow = items.length > 4 ? 3 : items.length;
    const boxW = Math.floor((MAXW - gap * (perRow - 1)) / perRow);
    let rowTop = y;
    for (let i = 0; i < items.length; i += perRow) {
      const rowItems = items.slice(i, i + perRow);
      const heights = [];
      rowItems.forEach((text) => {
        ctx.font = '500 26px ' + FONT;
        const lines = wrapText(ctx, text, boxW - padH * 2);
        heights.push(padV * 2 + lines.length * Math.round(26 * 1.42));
      });
      const boxH = Math.max.apply(null, heights);
      rowItems.forEach((text, index) => {
        const bx = PAD + index * (boxW + gap);
        roundRect(ctx, bx, rowTop, boxW, boxH, 20);
        ctx.fillStyle = ACCENT_SOFT;
        ctx.fill();
        ctx.fillStyle = INK;
        ctx.font = '500 26px ' + FONT;
        const lines = wrapText(ctx, text, boxW - padH * 2);
        let ty = rowTop + padV;
        lines.forEach((ln) => {
          ctx.fillText(ln, bx + padH, ty + Math.round(26 * 0.82));
          ty += Math.round(26 * 1.42);
        });
      });
      rowTop += boxH + gap;
    }
    y = rowTop - gap + 40;
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

export function renderPersonaShare(persona, profile) {
  const p = persona || {};
  return renderHiRes((ctx, scale) => paintPersona(ctx, p, profile, scale));
}
