/**
 * 书架 · 竖版分享图（H5 canvas 版）
 *
 * 来源：mobile/miniprogram/shared/shelf-share.js（版面 / 配色 / 文案逐项对齐，
 * 仅把 wx Canvas 2D 换成浏览器 DOM canvas、CommonJS 换成 ES Module）。
 * 数据口径与书架页一致 —— 复用 report-core 的 shelfCounts / shelfCategories / finishStats，
 * 只挑关键信息（概览四项 + 分类分布 + 最近在读 + 完读率 + 一句总结）做成一页竖版卡片。
 *
 * renderShelfShare(payload, profile) → { ok, dataUrl, error? }
 *   payload = { shelf, generatedAt }
 */

import { shelfCounts, shelfCategories, finishStats } from './report-core.js';
import {
  W, PAD, MAXW, MAXH,
  INK, INK2, ACCENT, ACCENT_SOFT, MUTED, LINE, FONT, BRAND,
  brandSubOf, roundRect, wrapText, drawMetricCards, drawSoftCard, drawBulletList, renderHiRes,
} from './share-canvas.js';

const RECENT_MAX = 12;   // 最近在读最多展示本数（分享图多列几本，减少留白）

// 在给定的 2d 上下文上按逻辑坐标绘制一遍（scale 为高清倍率），返回内容实际高度（逻辑像素）
function paintShelf(ctx, payload, profile, scale) {
  const shelf = payload.shelf || {};
  const counts = shelfCounts(shelf);
  const cats = shelfCategories(shelf).list;
  const brandSub = brandSubOf(profile);

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
  y = drawMetricCards(ctx, y, [
    { label: '电子书', value: counts.books + ' 本' },
    { label: '有声书 / 专辑', value: counts.albums + ' 个' },
    { label: '已读完', value: counts.finished + ' 本' },
    { label: '私密', value: counts.secret + ' 项' },
  ], { minPad: 12 });

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
    y = drawBulletList(ctx, y, books.map((item) => ({
      title: item.title || '未命名',
      sub: (item.author || '') + (Number(item.finishReading) === 1 ? ' · 已读完' : ''),
    })));
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
    y = drawSoftCard(ctx, y, summaryBits.join('，') + '。', { size: 30, padV: 32, radius: 24 });
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

export function renderShelfShare(payload, profile) {
  const p = payload || {};
  return renderHiRes((ctx, scale) => paintShelf(ctx, p, profile, scale));
}
