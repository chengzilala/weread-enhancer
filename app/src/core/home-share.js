/**
 * 首页 · 竖版分享图（H5 canvas 版）
 *
 * 来源：mobile/miniprogram/shared/home-share.js（版面 / 配色 / 文案逐项对齐，
 * 仅把 wx Canvas 2D 换成浏览器 DOM canvas、CommonJS 换成 ES Module）。
 * 数据口径与首页一致 —— 直接复用 home-core 的纯函数（hero / metrics / trend /
 * categories / timeBands / longest），不另写一套统计。分享图比页面多列几条
 * （分类 / 时段 / 读得最多各取前 5）并补一句规则总结，让版面更饱满。
 *
 * renderHomeShare(payload, profile) → { ok, dataUrl, error? }
 *   payload = { data, mode, modeLabel, generatedAt }
 */

import {
  buildHero,
  buildMetrics,
  buildTrend,
  buildCategories,
  buildTimeBands,
  buildLongest,
} from './home-core.js';
import {
  W, PAD, MAXW, MAXH,
  INK, INK2, ACCENT, ACCENT_LIGHT, MUTED, LINE, FONT, BRAND,
  brandSubOf, roundRect, wrapText, drawBarRow, drawMetricCards, drawSoftCard,
  drawBulletList, renderHiRes,
} from './share-canvas.js';

// 在给定的 2d 上下文上按逻辑坐标绘制一遍（scale 为高清倍率），返回内容实际高度（逻辑像素）
function paintHome(ctx, payload, profile, scale) {
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
    y = drawMetricCards(ctx, y, rest);
  }

  // 官方判定语（有则展示，浅底卡片）
  if (hero.word) {
    y = drawSoftCard(ctx, y, '官方判定：' + hero.word);
  }

  // 趋势（迷你柱状图，与首页一致）
  const trend = buildTrend(d, payload.mode);
  if (trend && trend.bars.length) {
    lineDraw(trend.title, 36, INK, '700');
    y += 16;
    const chartH = 180;
    const chartTop = y;
    const n = trend.bars.length;
    const gap = n > 20 ? 4 : 8;
    const bw = Math.max(4, Math.floor((MAXW - gap * (n - 1)) / n));
    trend.bars.forEach((bar, index) => {
      const bh = Math.max(6, Math.round(chartH * (bar.h / 100)));
      roundRect(ctx, PAD + index * (bw + gap), chartTop + chartH - bh, bw, bh, Math.min(6, Math.floor(bw / 2)));
      ctx.fillStyle = bar.active ? ACCENT : ACCENT_LIGHT;
      ctx.fill();
    });
    y = chartTop + chartH + 28;
    if (trend.peak) {
      const hiddenNote = trend.hidden > 0 ? '（仅展示最近 ' + n + ' 期）' : '';
      lineDraw('峰值：' + trend.peak.label + ' · ' + trend.peak.time + hiddenNote, 24, MUTED, '400', MAXW);
    }
    y += 26;
  }

  // 偏好分类 Top5（分享图多展示几条，减少留白）
  const cats = buildCategories(d, 5);
  if (cats.length) {
    lineDraw('偏好分类 Top' + cats.length, 36, INK, '700');
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
    bands.rows.slice(0, 6).forEach((item) => {
      y = drawBarRow(ctx, y, item.label, item.time + ' · ' + item.pct, item.bar);
    });
    if (bands.peak) {
      lineDraw('峰值时段：' + bands.peak, 24, MUTED, '400', MAXW);
      y += 8;
    }
    y += 12;
  }

  // 读得最多 Top5
  const longest = buildLongest(d, 5);
  if (longest.length) {
    lineDraw('读得最多', 36, INK, '700');
    y += 10;
    y = drawBulletList(ctx, y, longest.map((item) => ({
      title: item.title,
      sub: (item.author ? item.author + ' · ' : '') + item.time,
    })));
    y += 12;
  }

  // 一句话总结（按数据规则拼写，不联网、不用 AI）
  const summaryBits = [];
  if (hero.value) {
    summaryBits.push('这个周期你一共阅读 ' + hero.value);
  }
  if (cats.length) {
    summaryBits.push('最常读的是「' + cats[0].name + '」');
  }
  if (bands && bands.peak) {
    summaryBits.push('阅读高峰在 ' + bands.peak);
  }
  if (longest.length) {
    summaryBits.push('花时间最多的是《' + longest[0].title + '》');
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

export function renderHomeShare(payload, profile) {
  const p = payload || {};
  return renderHiRes((ctx, scale) => paintHome(ctx, p, profile, scale));
}
