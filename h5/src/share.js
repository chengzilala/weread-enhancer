/**
 * H5 分享（H5）— 竖版分享图（canvas，零依赖）+ 分享动作
 *
 * 与小程序 share 模块同思路，但用 DOM canvas 重写（小程序 WXML/canvas 不可直接用）。
 *   1) makeShareCard(spec) → 画一张竖版 PNG（1080 宽、高按内容自适应），返回 dataURL；
 *   2) shareCard(dataUrl, spec) → 优先 Web Share API 直分享，其次下载 PNG；
 *   3) copyLink(url) → 复制页面链接（兜底）。
 *
 * 红线：分享图不含账号标识 / 隐私字段；不使用真人照片（纯文字排版）。
 */

const CARD_W = 1080;
const PAD = 64;
const BRAND = '#2F6BFF';

export const shareSupported = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

export const shareLinkSupported = typeof navigator !== 'undefined' && typeof navigator.clipboard !== 'undefined';

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  const raw = String(text || '');
  const lines = [];
  raw.split('\n').forEach((paragraph) => {
    if (!paragraph) {
      lines.push('');
      return;
    }
    let line = '';
    for (let i = 0; i < paragraph.length; i += 1) {
      const next = line + paragraph[i];
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = paragraph[i];
      } else {
        line = next;
      }
    }
    if (line) {
      lines.push(line);
    }
  });
  return lines;
}

/**
 * 画分享卡。
 * @param {object} spec {
 *   badge, title, subtitle, code,
 *   stats: [{ label, value }],
 *   quote: { text, from },
 *   lines: [string],
 *   chips: [string],
 *   footer
 * }
 * @returns {Promise<{ok:boolean, dataUrl?:string, error?:string}>}
 */
export async function makeShareCard(spec) {
  const s = spec || {};
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { ok: false, error: '当前浏览器不支持 canvas' };
    }

    // 先用 1 倍测量、估算高度
    const bodyW = CARD_W - PAD * 2;
    const blocks = [];

    const fBadge = '600 34px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
    const fCode = '800 120px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
    const fTitle = '700 56px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
    const fSubtitle = '400 34px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
    const fBody = '400 34px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
    const fQuote = '400 36px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
    const fLabel = '400 28px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
    const fValue = '700 44px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';

    if (s.code) {
      blocks.push({ type: 'code', text: String(s.code), font: fCode, lineH: 132, gap: 12 });
    }
    if (s.title) {
      blocks.push({ type: 'title', text: String(s.title), font: fTitle, lineH: 70, gap: 16 });
    }
    if (s.subtitle) {
      blocks.push({ type: 'subtitle', text: String(s.subtitle), font: fSubtitle, lineH: 46, gap: 20 });
    }
    if (Array.isArray(s.stats) && s.stats.length) {
      blocks.push({ type: 'stats', items: s.stats.slice(0, 4) });
    }
    if (Array.isArray(s.lines) && s.lines.length) {
      s.lines.forEach((line) => {
        blocks.push({ type: 'body', text: String(line), font: fBody, lineH: 48, gap: 18 });
      });
    }
    if (s.quote && s.quote.text) {
      blocks.push({ type: 'quote', quote: s.quote, font: fQuote, lineH: 52 });
    }
    if (Array.isArray(s.chips) && s.chips.length) {
      blocks.push({ type: 'chips', items: s.chips.slice(0, 12) });
    }

    // --- 测量总高 ---
    let y = PAD;               // 顶部留白
    y += 44;                   // 品牌行
    y += 36;                   // 品牌行下间距
    blocks.forEach((b) => {
      if (b.type === 'code') {
        ctx.font = b.font;
        const lines = wrapText(ctx, b.text, bodyW);
        y += lines.length * b.lineH + b.gap + 8;
      } else if (b.type === 'title' || b.type === 'subtitle' || b.type === 'body') {
        ctx.font = b.font;
        const lines = wrapText(ctx, b.text, bodyW);
        y += lines.length * b.lineH + b.gap;
      } else if (b.type === 'stats') {
        y += 132 + 28;
      } else if (b.type === 'quote') {
        ctx.font = b.font;
        const lines = wrapText(ctx, b.quote.text, bodyW - 48);
        y += lines.length * b.lineH + 40 + 36;
      } else if (b.type === 'chips') {
        y += 72 + 24;
      }
    });
    y += 12;                   // footer 上间距
    y += 40;                   // footer 行高
    y += PAD;                  // 底部留白

    const cardH = Math.max(1200, Math.round(y));
    const scale = 2;           // 2 倍导出，保证清晰
    canvas.width = CARD_W * scale;
    canvas.height = cardH * scale;
    ctx.scale(scale, scale);

    // --- 背景 ---
    ctx.fillStyle = '#F5F6F8';
    ctx.fillRect(0, 0, CARD_W, cardH);
    // 顶部品牌色带
    ctx.fillStyle = BRAND;
    ctx.fillRect(0, 0, CARD_W, 12);

    let cy = PAD;

    // 品牌行
    ctx.fillStyle = '#1F2430';
    ctx.font = '700 34px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText('微信悦读', PAD, cy);
    if (s.badge) {
      ctx.font = fBadge;
      const bw = ctx.measureText(String(s.badge)).width + 36;
      ctx.fillStyle = '#E7EEFF';
      roundRect(ctx, CARD_W - PAD - bw, cy - 4, bw, 44, 22);
      ctx.fill();
      ctx.fillStyle = BRAND;
      ctx.fillText(String(s.badge), CARD_W - PAD - bw + 18, cy + 4);
    }
    cy += 80;

    // 内容块
    blocks.forEach((b) => {
      if (b.type === 'code') {
        ctx.font = b.font;
        ctx.fillStyle = BRAND;
        const lines = wrapText(ctx, b.text, bodyW);
        lines.forEach((line) => {
          ctx.fillText(line, PAD, cy);
          cy += b.lineH;
        });
        cy += b.gap + 8;
      } else if (b.type === 'title') {
        ctx.font = b.font;
        ctx.fillStyle = '#1F2430';
        const lines = wrapText(ctx, b.text, bodyW);
        lines.forEach((line) => {
          ctx.fillText(line, PAD, cy);
          cy += b.lineH;
        });
        cy += b.gap;
      } else if (b.type === 'subtitle' || b.type === 'body') {
        ctx.font = b.font;
        ctx.fillStyle = b.type === 'subtitle' ? '#5B6270' : '#3B414F';
        const lines = wrapText(ctx, b.text, bodyW);
        lines.forEach((line) => {
          ctx.fillText(line, PAD, cy);
          cy += b.lineH;
        });
        cy += b.gap;
      } else if (b.type === 'stats') {
        const gap = 20;
        const cols = b.items.length;
        const cellW = (bodyW - gap * (cols - 1)) / cols;
        b.items.forEach((item, i) => {
          const x = PAD + i * (cellW + gap);
          ctx.fillStyle = '#FFFFFF';
          roundRect(ctx, x, cy, cellW, 132, 20);
          ctx.fill();
          ctx.fillStyle = BRAND;
          ctx.font = fValue;
          ctx.fillText(String(item.value), x + 24, cy + 30);
          ctx.fillStyle = '#8A8F99';
          ctx.font = fLabel;
          ctx.fillText(String(item.label), x + 24, cy + 84);
        });
        cy += 160;
      } else if (b.type === 'quote') {
        ctx.font = b.font;
        const lines = wrapText(ctx, b.quote.text, bodyW - 64);
        const blockH = lines.length * b.lineH + 48;
        ctx.fillStyle = '#FFFFFF';
        roundRect(ctx, PAD, cy, bodyW, blockH, 20);
        ctx.fill();
        // 左侧强调条
        ctx.fillStyle = BRAND;
        roundRect(ctx, PAD + 20, cy + 20, 6, blockH - 40, 3);
        ctx.fill();
        ctx.fillStyle = '#3B414F';
        let qy = cy + 24;
        lines.forEach((line) => {
          ctx.fillText(line, PAD + 48, qy);
          qy += b.lineH;
        });
        cy += blockH + 16;
        if (b.quote.from) {
          ctx.fillStyle = '#8A8F99';
          ctx.font = fLabel;
          ctx.fillText('—— ' + String(b.quote.from), PAD + 48, cy);
          cy += 40;
        }
      } else if (b.type === 'chips') {
        let cx = PAD;
        const chipH = 56;
        ctx.font = fLabel;
        b.items.forEach((label) => {
          const tw = ctx.measureText(String(label)).width + 40;
          if (cx + tw > CARD_W - PAD) {
            cx = PAD;
            cy += chipH + 16;
          }
          ctx.fillStyle = '#E7EEFF';
          roundRect(ctx, cx, cy, tw, chipH, chipH / 2);
          ctx.fill();
          ctx.fillStyle = BRAND;
          ctx.fillText(String(label), cx + 20, cy + 12);
          cx += tw + 16;
        });
        cy += chipH + 24;
      }
    });

    // footer
    ctx.fillStyle = '#8A8F99';
    ctx.font = fLabel;
    ctx.fillText(String(s.footer || '微信悦读 · 阅读数据与人格，本机计算'), PAD, cardH - PAD - 40);

    return { ok: true, dataUrl: canvas.toDataURL('image/png') };
  } catch (err) {
    return { ok: false, error: (err && err.message) || '生成分享图失败' };
  }
}

/** 下载 PNG */
export function downloadImage(dataUrl, filename) {
  try {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename || ('wechat-reader-' + Date.now() + '.png');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err && err.message) || '下载失败' };
  }
}

/**
 * 分享：优先 Web Share（文件），不支持则下载。
 * @returns {object} { ok, method:'share'|'download', error? }
 */
export async function shareCard(dataUrl, spec, filename) {
  const s = spec || {};
  if (shareSupported && dataUrl) {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], filename || 'wechat-reader.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: s.title || '微信悦读', text: s.text || '' });
        return { ok: true, method: 'share' };
      }
    } catch (err) {
      if (err && err.name === 'AbortError') {
        return { ok: false, method: 'share', error: '已取消分享' };
      }
      // 落到下载兜底
    }
  }
  return downloadImage(dataUrl, filename);
}

/** 复制页面链接 */
export async function copyLink(url) {
  const link = url || (typeof location !== 'undefined' ? location.href : '');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(link);
      return { ok: true };
    }
  } catch (e) {
    // 继续降级
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = link;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return { ok: ok };
  } catch (e) {
    return { ok: false };
  }
}
