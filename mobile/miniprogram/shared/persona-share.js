// 阅读人格 · 竖版分享图（小程序 Canvas 2D 版）
// 移植自插件 modules/official.js 的 buildPersonaShareCanvas，做了两处平台适配：
//   1) 画布尺寸：Canvas 2D 后备缓冲（canvas.width / canvas.height）在 iOS 上超过 4096 会报错。
//      故逻辑宽 1080、高度上限 3200；导出时按最大倍率（在保证缓冲任一边 ≤4096 的前提下尽可能
//      放大）高清重绘，得到尽可能高分辨率的清晰图（见 renderPersonaShare 的两遍绘制）。
//   2) 人物线描：小程序 canvas 对 SVG 的支持不可靠，这里用一个极小的 SVG 子集渲染器，
//      把 persona-figure.js 的线描矢量直接画到 canvas 上（零依赖、不联网）。
// 说明：纯本机计算、可复算、不含随机。

const { personaFigureSvg } = require('./persona-figure');

const W = 1080;         // 逻辑宽（与插件同一套坐标）
const PAD = 72;
const MAXW = W - PAD * 2;
const MAXH = 3200;      // 高度上限（缓冲高度 = MAXH，安全低于 4096）
const MAX_SIDE = 4096;  // Canvas 2D 后备缓冲任一边的上限（iOS 超过会报错）

const INK = '#1F2430';
const INK2 = '#4A5060';
const ACCENT = '#2F6BFF';       // 小程序主色（蓝），与页面 / 导航保持一致
const ACCENT_SOFT = '#F0F4FF';
const LINE = '#E8EBF0';
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

// ---------- 极简 SVG 子集渲染器：只处理 <circle>/<ellipse>/<path> 与 M/L/C/Q/Z ----------

function parseAttrs(str) {
  const out = {};
  const re = /([\w-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(str))) {
    out[m[1]] = m[2];
  }
  return out;
}

// 所有命令均为绝对坐标（persona-figure.js 的线描数据如此），故只实现大写指令
function tracePath(ctx, d) {
  const tokens = String(d || '').match(/[MLCQZmlcqz]|-?\d*\.?\d+/g) || [];
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) {
      cmd = tokens[i];
      i += 1;
    }
    if (i >= tokens.length) {
      break;
    }
    if (cmd === 'M') {
      x = +tokens[i]; y = +tokens[i + 1]; i += 2;
      ctx.moveTo(x, y); sx = x; sy = y; cmd = 'L';
    } else if (cmd === 'L') {
      x = +tokens[i]; y = +tokens[i + 1]; i += 2;
      ctx.lineTo(x, y);
    } else if (cmd === 'C') {
      const c1x = +tokens[i], c1y = +tokens[i + 1];
      const c2x = +tokens[i + 2], c2y = +tokens[i + 3];
      x = +tokens[i + 4]; y = +tokens[i + 5]; i += 6;
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x, y);
    } else if (cmd === 'Q') {
      const qx = +tokens[i], qy = +tokens[i + 1];
      x = +tokens[i + 2]; y = +tokens[i + 3]; i += 4;
      ctx.quadraticCurveTo(qx, qy, x, y);
    } else if (cmd === 'Z' || cmd === 'z') {
      ctx.closePath(); x = sx; y = sy; cmd = '';
    } else {
      i += 1;
    }
  }
}

// 把 240×240 视角的线描 SVG 画到 (x, y) 处、边长 size 的区域
function drawFigureSvg(ctx, svg, x, y, size) {
  if (!svg) {
    return;
  }
  const inner = svg.replace(/^[\s\S]*?>/, '').replace(/<\/svg>\s*$/, '');
  const re = /<(circle|ellipse|path)\b([^>]*?)\/?>/g;
  const k = size / 240;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let m;
  while ((m = re.exec(inner))) {
    const tag = m[1];
    const a = parseAttrs(m[2]);
    const stroke = a.stroke || 'none';
    const fill = a.fill || 'none';
    ctx.globalAlpha = a.opacity != null ? parseFloat(a.opacity) : 1;
    ctx.strokeStyle = stroke;
    ctx.fillStyle = fill;
    ctx.lineWidth = a['stroke-width'] != null ? parseFloat(a['stroke-width']) : 1;
    ctx.beginPath();
    if (tag === 'circle') {
      ctx.arc(parseFloat(a.cx), parseFloat(a.cy), parseFloat(a.r), 0, Math.PI * 2);
    } else if (tag === 'ellipse') {
      const cx = parseFloat(a.cx);
      const cy = parseFloat(a.cy);
      const rx = parseFloat(a.rx);
      const ry = parseFloat(a.ry);
      if (typeof ctx.ellipse === 'function') {
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      } else {
        // 极端兜底：个别环境下不支持 ellipse，用圆近似（仅头像轮廓使用椭圆）
        ctx.arc(cx, cy, Math.max(rx, ry), 0, Math.PI * 2);
      }
    } else {
      tracePath(ctx, a.d);
    }
    if (fill !== 'none') {
      ctx.fill();
    }
    if (stroke !== 'none') {
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ---------- 主入口 ----------

// 在给定的 2d 上下文上按逻辑坐标绘制一遍（scale 为高清倍率），返回内容实际高度（逻辑像素）
// profile 可选（本机资料 { nickName }）：有昵称时署名改为「昵称 · 基于微信读书数据生成」
function paintShare(ctx, persona, profile, scale) {
  const brandSub = profile && profile.nickName
    ? profile.nickName + ' · 基于微信读书数据生成'
    : BRAND_SUB;

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
    const lines = maxWidth ? wrapText(ctx, text, maxWidth) : [text];
    lines.forEach((ln) => {
      ctx.fillText(ln, startX, y + Math.round(size * 0.82));
      y += lh;
    });
  };

  const figure = persona.figure;

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
  const codeItems = persona.codeItems || [];
  if (codeItems.length) {
    lineDraw(codeItems.map((item) => item.letter + ' ' + item.label).join(' · '), 30, INK2, '400', leftMaxW);
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
  (persona.dims || []).forEach((dim) => {
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

// 在传入的 canvas 节点上绘制竖版分享图。
// 两遍绘制：第一遍按逻辑尺寸（1080 宽）画一遍测出内容实际高度；
// 第二遍按最大高清倍率（保证后备缓冲任一边 ≤ 4096）放大缓冲后重绘，
// 从而在 iOS 上限内得到最高分辨率的清晰图。
// 返回 { width, height }（画布缓冲像素 = 导出后图片的像素尺寸）。
function renderPersonaShare(canvas, persona, profile) {
  // 第一遍：逻辑尺寸，测内容高度
  canvas.width = W;
  canvas.height = MAXH;
  const logicalH = paintShare(canvas.getContext('2d'), persona, profile, 1);

  // 高清倍率：在「任一边 ≤ MAX_SIDE（iOS 4096）」前提下取最大倍率
  // （原先额外压了 2× 上限，是清晰度不足的主因）
  const scale = Math.min(MAX_SIDE / W, MAX_SIDE / logicalH);
  if (scale <= 1.05) {
    return { width: W, height: Math.round(logicalH) };
  }

  // 第二遍：放大后备缓冲后重绘（末尾多留 2px，防止最后一行被裁）
  const bw = Math.round(W * scale);
  const bh = Math.min(Math.round(logicalH * scale) + 2, MAX_SIDE);
  canvas.width = bw;
  canvas.height = bh;
  paintShare(canvas.getContext('2d'), persona, profile, scale);
  return { width: bw, height: bh };
}

module.exports = { renderPersonaShare };
