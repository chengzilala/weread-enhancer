/**
 * 阅读报告 · 竖版分享图（H5 canvas 版）
 *
 * 来源：mobile/miniprogram/shared/report-share.js（版面 / 配色 / 文案逐项对齐，
 * 仅把 wx Canvas 2D 换成浏览器 DOM canvas、CommonJS 换成 ES Module）。
 * 分享图挑报告里的关键信息（核心指标 + 一个亮点 + 偏好分类 Top5 + 时段分布 +
 * 读得最多 Top5 + 笔记概览 + 完读率 + 一句总结）做成一页竖版卡片，不搬运整份报告；
 * 数据口径与报告页一致（复用 report-core 纯函数）。
 *
 * renderReportShare(payload, profile) → { ok, dataUrl, error? }
 *   payload = { data, overview, mode, modeLabel, generatedAt }
 */

import {
  metricCards, reportBuckets, fmtBucketLabel, notebookStats, timeBands, finishStats, barPercents,
} from './report-core.js';
import { fmtDuration } from './format.js';
import {
  W, PAD, MAXW, MAXH,
  INK, INK2, ACCENT, MUTED, LINE, FONT, BRAND,
  brandSubOf, wrapText, drawBarRow, drawMetricCards, drawSoftCard,
  drawBulletList, renderHiRes,
} from './share-canvas.js';

/** 偏好分类 TopN（口径同报告页 2.4：按阅读时长降序） */
function reportCategories(data, limit) {
  const cats = Array.isArray(data && data.preferCategory) ? data.preferCategory : [];
  if (!cats.length) {
    return [];
  }
  const total = cats.reduce((acc, item) => acc + (Number(item.readingTime) || 0), 0) || 1;
  const sorted = cats.slice()
    .sort((a, b) => (Number(b.readingTime) || 0) - (Number(a.readingTime) || 0))
    .slice(0, limit || 5);
  const percents = barPercents(sorted.map((item) => item.readingTime));
  return sorted.map((item, index) => ({
    name: item.parentCategoryTitle || item.categoryTitle || '未分类',
    time: fmtDuration(item.readingTime),
    pct: Math.round(((Number(item.readingTime) || 0) / total) * 100) + '%',
    bar: percents[index],
  }));
}

// 在给定的 2d 上下文上按逻辑坐标绘制一遍（scale 为高清倍率），返回内容实际高度（逻辑像素）
function paintReport(ctx, payload, profile, scale) {
  const d = payload.data || {};
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

  // 头部：品牌 + 周期/生成时间
  lineDraw('悦读且住 · 阅读行为报告', 30, INK2, '600');
  y += 4;
  const headMeta = (payload.modeLabel ? payload.modeLabel + ' · ' : '') + '生成于 ' + (payload.generatedAt || '');
  lineDraw(headMeta, 26, MUTED, '400');
  y += 26;

  // 核心指标：总时长做「主数字」
  const cards = metricCards(d);
  const hero = cards[0] || { label: '总时长', value: '—' };
  lineDraw(hero.value, 88, ACCENT, '800', MAXW, PAD, 104);
  lineDraw(hero.label, 26, INK2, '400');
  y += 18;

  // 其余核心指标：一行等宽小卡片
  const rest = cards.slice(1);
  if (rest.length) {
    y = drawMetricCards(ctx, y, rest);
  }

  // 亮点：阅读最集中的周期（浅底卡片）
  const positive = reportBuckets(d).filter((item) => item.seconds > 0);
  if (positive.length) {
    const total = positive.reduce((acc, item) => acc + item.seconds, 0) || 1;
    const peak = positive.reduce((acc, item) => (item.seconds > acc.seconds ? item : acc));
    const text = '阅读最集中的是 ' + fmtBucketLabel(peak.ts, payload.mode) + '：' + fmtDuration(peak.seconds) +
      '（占 ' + ((peak.seconds / total) * 100).toFixed(1) + '%）';
    y = drawSoftCard(ctx, y, text);
  }

  // 读得最多 Top5
  const longest = Array.isArray(d.readLongest) ? d.readLongest.slice(0, 5) : [];
  if (longest.length) {
    lineDraw('读得最多', 36, INK, '700');
    y += 10;
    y = drawBulletList(ctx, y, longest.map((item) => {
      const book = item.book || {};
      const album = item.albumInfo || {};
      const title = book.title || album.name || '未命名';
      const author = book.author || album.author || '';
      return { title: title, sub: (author ? author + ' · ' : '') + fmtDuration(item.readTime) };
    }));
    y += 12;
  }

  // 偏好分类 Top5（分享图多展示几条，减少留白）
  const cats = reportCategories(d, 5);
  if (cats.length) {
    lineDraw('偏好分类 Top' + cats.length, 36, INK, '700');
    y += 8;
    cats.forEach((item) => {
      y = drawBarRow(ctx, y, item.name, item.time + ' · ' + item.pct, item.bar);
    });
    y += 12;
  }

  // 阅读时段分布（官方仅「累计」周期返回 preferTime）
  const bands = timeBands(d);
  const bandPositive = bands.filter((item) => item.seconds > 0);
  if (bandPositive.length) {
    const bandTotal = bandPositive.reduce((acc, item) => acc + item.seconds, 0) || 1;
    const percents = barPercents(bandPositive.map((item) => item.seconds));
    lineDraw('阅读时段分布', 36, INK, '700');
    y += 8;
    bandPositive.slice(0, 6).forEach((item, index) => {
      const pct = Math.round((item.seconds / bandTotal) * 100) + '%';
      y = drawBarRow(ctx, y, item.label, fmtDuration(item.seconds) + ' · ' + pct, percents[index]);
    });
    y += 12;
  }

  // 笔记概览（有笔记才展示）
  const notes = notebookStats(payload.overview ? payload.overview.notebooks : null);
  if (notes && (notes.totalNoteCount > 0 || notes.totalBookCount > 0)) {
    lineDraw('笔记', 36, INK, '700');
    y += 10;
    lineDraw('共 ' + notes.totalNoteCount + ' 条，来自 ' + notes.totalBookCount + ' 本书', 28, INK2, '400', MAXW);
    lineDraw('想法/点评 ' + notes.reviewTotal + ' · 划线 ' + notes.noteTotal + ' · 书签 ' + notes.bookmarkTotal, 26, MUTED, '400', MAXW);
    y += 8;
  }

  // 完读率（有书架数据才展示）
  const shelf = payload.overview ? payload.overview.shelf : null;
  if (shelf) {
    const fin = finishStats(shelf);
    if (fin.ebooks > 0) {
      lineDraw('完读率', 36, INK, '700');
      y += 10;
      lineDraw((fin.rate * 100).toFixed(0) + '%（读完 ' + fin.finished + ' / ' + fin.ebooks + ' 本，在读 ' + fin.reading + ' 本）', 28, INK2, '400', MAXW);
      y += 16;
    }
  }

  // 一句话总结（按数据规则拼写，不联网、不用 AI）
  const summaryBits = [];
  if (hero.value) {
    summaryBits.push('本周期共阅读 ' + hero.value);
  }
  if (cats.length) {
    summaryBits.push('最偏爱「' + cats[0].name + '」');
  }
  if (longest.length) {
    const top = longest[0];
    const topBook = top.book || {};
    const topAlbum = top.albumInfo || {};
    summaryBits.push('读得最多的是《' + (topBook.title || topAlbum.name || '未命名') + '》');
  }
  if (notes && notes.totalNoteCount > 0) {
    summaryBits.push('留下 ' + notes.totalNoteCount + ' 条笔记');
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

export function renderReportShare(payload, profile) {
  const p = payload || {};
  return renderHiRes((ctx, scale) => paintReport(ctx, p, profile, scale));
}
