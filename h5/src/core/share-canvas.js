/**
 * 分享图绘制底座（H5 版）
 *
 * 来源：mobile/miniprogram/shared/{home,report,shelf,persona}-share.js 的公共部分
 * （roundRect / wrapText / drawBarRow / 指标卡行 / 浅底卡 / 列表 / 人物线描 / 高清两遍绘制）。
 * 小程序用 wx Canvas 2D；H5 换成浏览器 DOM canvas，画法与坐标完全一致（逻辑宽 1080、PAD 72）。
 *
 * 复刻对齐：逻辑宽 W=1080、内容上限 MAXH=3200、导出时按最大倍率高清重绘
 * （保证后备缓冲任一边 ≤ MAX_SIDE，避免 iOS 类上限问题），配色与小程序一致。
 */

export const W = 1080;         // 逻辑宽
export const PAD = 72;
export const MAXW = W - PAD * 2;
export const MAXH = 3200;      // 高度上限
export const MAX_SIDE = 4096;  // 后备缓冲任一边的上限

export const INK = '#1F2430';
export const INK2 = '#4A5060';
export const ACCENT = '#2F6BFF';       // 品牌主色（蓝）
export const ACCENT_SOFT = '#F0F4FF';
export const ACCENT_LIGHT = '#C9D8FF'; // 次级柱色
export const LINE = '#E8EBF0';
export const MUTED = '#A8ADB8';
export const FONT = 'sans-serif';

export const BRAND = '悦读且住';
export const BRAND_SUB = '基于我的微信读书数据生成';

/** 署名副标题：有昵称时带昵称 */
export function brandSubOf(profile) {
  return profile && profile.nickName
    ? profile.nickName + ' · 基于我的微信读书数据生成'
    : BRAND_SUB;
}

// 圆角矩形路径（不依赖 ctx.roundRect 的平台支持）
export function roundRect(ctx, x, y, w, h, r) {
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
export function wrapText(ctx, text, maxWidth) {
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
export function drawBarRow(ctx, y, name, valueText, barPct) {
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

/** 一行等宽小卡片（指标卡 / 概览四项），返回下一行的 y */
export function drawMetricCards(ctx, y, cards, opts) {
  const o = opts || {};
  const gap = o.gap == null ? 20 : o.gap;
  const boxH = o.boxH == null ? 148 : o.boxH;
  const minPad = o.minPad == null ? 16 : o.minPad;
  const n = cards.length;
  if (!n) {
    return y;
  }
  const boxW = Math.floor((MAXW - gap * (n - 1)) / n);
  cards.forEach((card, index) => {
    const bx = PAD + index * (boxW + gap);
    roundRect(ctx, bx, y, boxW, boxH, 20);
    ctx.fillStyle = '#F7F8FA';
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.font = '600 34px ' + FONT;
    const vw = ctx.measureText(card.value).width;
    ctx.fillText(card.value, bx + Math.max(minPad, (boxW - vw) / 2), y + 64);
    ctx.fillStyle = MUTED;
    ctx.font = '400 24px ' + FONT;
    const lw = ctx.measureText(card.label).width;
    ctx.fillText(card.label, bx + Math.max(minPad, (boxW - lw) / 2), y + 108);
  });
  return y + boxH + 40;
}

/** 浅底强调卡（官方判定 / 亮点 / 一句话总结），返回下一行的 y */
export function drawSoftCard(ctx, y, text, opts) {
  const o = opts || {};
  const size = o.size || 28;
  const padV = o.padV == null ? 30 : o.padV;
  const radius = o.radius == null ? 20 : o.radius;
  ctx.font = (o.weight || '500') + ' ' + size + 'px ' + FONT;
  const lines = wrapText(ctx, text, MAXW - 44);
  const lineH = Math.round(size * 1.5);
  const boxH = padV * 2 + lines.length * lineH;
  roundRect(ctx, PAD, y, MAXW, boxH, radius);
  ctx.fillStyle = ACCENT_SOFT;
  ctx.fill();
  let ty = y + padV;
  ctx.fillStyle = INK;
  lines.forEach((ln) => {
    ctx.fillText(ln, PAD + 22, ty + Math.round(size * 0.82));
    ty += lineH;
  });
  return y + boxH + 40;
}

/** 蓝点列表（读得最多 / 最近在读），返回下一行的 y */
export function drawBulletList(ctx, y, items, opts) {
  const o = opts || {};
  const titleSize = o.titleSize || 30;
  const subSize = o.subSize || 24;
  const indent = 36;
  items.forEach((item) => {
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.arc(PAD + 8, y + 16, 8, 0, Math.PI * 2);
    ctx.fill();
    let ty = y;
    ctx.fillStyle = INK;
    ctx.font = '500 ' + titleSize + 'px ' + FONT;
    wrapText(ctx, item.title, MAXW - 40).forEach((ln) => {
      ctx.fillText(ln, PAD + indent, ty + Math.round(titleSize * 0.82));
      ty += Math.round(titleSize * 1.42);
    });
    if (item.sub) {
      ctx.fillStyle = MUTED;
      ctx.font = '400 ' + subSize + 'px ' + FONT;
      wrapText(ctx, item.sub, MAXW - 40).forEach((ln) => {
        ctx.fillText(ln, PAD + indent, ty + Math.round(subSize * 0.82));
        ty += Math.round(subSize * 1.42);
      });
    }
    y = ty + 14;
  });
  return y;
}

/* ---------- 极简 SVG 子集渲染器：只处理 <circle>/<ellipse>/<path> 与 M/L/C/Q/Z ---------- */

function parseAttrs(str) {
  const out = {};
  const re = /([\w-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(str))) {
    out[m[1]] = m[2];
  }
  return out;
}

// 所有命令均为绝对坐标（persona-figure 的线描数据如此），故只实现大写指令
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

/** 把 240×240 视角的线描 SVG 画到 (x, y) 处、边长 size 的区域 */
export function drawFigureSvg(ctx, svg, x, y, size) {
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
      ctx.ellipse(parseFloat(a.cx), parseFloat(a.cy), parseFloat(a.rx), parseFloat(a.ry), 0, 0, Math.PI * 2);
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

/**
 * 高清两遍绘制：paint(ctx, scale) 需按逻辑坐标绘制并返回内容实际高度（逻辑像素）。
 * 第一遍按逻辑尺寸测高；第二遍按最大倍率（保证任一边 ≤ MAX_SIDE）放大缓冲重绘。
 * @returns {{ok:boolean, dataUrl?:string, width?:number, height?:number, error?:string}}
 */
export function renderHiRes(paint) {
  try {
    const canvas = document.createElement('canvas');
    if (!canvas.getContext('2d')) {
      return { ok: false, error: '当前浏览器不支持 canvas' };
    }
    canvas.width = W;
    canvas.height = MAXH;
    let logicalH = paint(canvas.getContext('2d'), 1);
    logicalH = Math.min(Math.max(1, Math.round(logicalH)), MAXH);

    const scale = Math.min(MAX_SIDE / W, MAX_SIDE / logicalH);
    let bw = W;
    let bh = logicalH;
    if (scale > 1.05) {
      bw = Math.round(W * scale);
      bh = Math.min(Math.round(logicalH * scale) + 2, MAX_SIDE);
      canvas.width = bw;
      canvas.height = bh;
      paint(canvas.getContext('2d'), scale);
    }
    return { ok: true, dataUrl: canvas.toDataURL('image/png'), width: bw, height: bh };
  } catch (err) {
    return { ok: false, error: (err && err.message) || '生成分享图失败' };
  }
}
