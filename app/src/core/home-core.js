/**
 * 首页「数据总览」视图模型（H5 版）
 *
 * 来源：mobile/miniprogram/shared/home-core.js（逐字拷贝，仅把 CommonJS 改为 ES Module）。
 * ⚠️ 算法单一来源：改这里请同步小程序端，避免两端口径漂移。
 * 纯计算、不联网、零外部依赖；分桶/时段/百分比口径复用 report-core。
 */

import {
  reportBuckets,
  fmtBucketLabel,
  bucketSectionLabel,
  barPercents,
  timeBands,
  hourlyReadTime,
  modeLabel,
  pad2,
} from './report-core.js';
import { fmtDuration, fmtCompare } from './format.js';

const TREND_MAX_BARS = 31;   // 迷你趋势图最多展示的柱数（本月约 30；超长周期取最近 N 个）

/** Hero 主卡：大字总时长 + 环比 + 官方判定语 */
export function buildHero(data, currentMode) {
  const d = data || {};
  const compare = d.compare;
  const hasCompare = typeof compare === 'number' && isFinite(compare);
  return {
    label: modeLabel(currentMode) + '阅读时长',
    value: fmtDuration(d.totalReadTime),
    hasCompare: hasCompare,
    dir: hasCompare ? (compare >= 0 ? 'up' : 'down') : '',
    compareAbs: hasCompare ? Math.abs(compare * 100).toFixed(1) + '%' : '',
    word: d.preferCategoryWord || d.preferTimeWord || '',
  };
}

/** 迷你趋势图：readTimes 分桶 → 柱状（按最大值归一，标注峰值柱） */
export function buildTrend(data, currentMode) {
  const buckets = reportBuckets(data);
  if (!buckets.length) {
    return null;
  }
  const shown = buckets.slice(-TREND_MAX_BARS);
  const percents = barPercents(shown.map((item) => item.seconds));
  let peakIdx = -1;
  let peakVal = 0;
  shown.forEach((item, index) => {
    if (item.seconds > peakVal) {
      peakVal = item.seconds;
      peakIdx = index;
    }
  });
  const bars = shown.map((item, index) => ({
    h: percents[index],
    active: index === peakIdx && peakVal > 0,
  }));
  const peak = (peakIdx >= 0 && peakVal > 0)
    ? { label: fmtBucketLabel(shown[peakIdx].ts, currentMode), time: fmtDuration(peakVal) }
    : null;
  return {
    title: bucketSectionLabel(currentMode) + '趋势',
    bars: bars,
    peak: peak,
    hidden: buckets.length - shown.length,
  };
}

/** 指标卡（总时长 / 阅读天数 / 自然日均 / 较上期；官方未提供数据的项直接不展示） */
export function buildMetrics(data) {
  const d = data || {};
  const compare = fmtCompare(d.compare);
  const dayAverage = d.dayAverageReadTime == null ? null : fmtDuration(d.dayAverageReadTime);
  const list = [
    { label: '总时长', value: fmtDuration(d.totalReadTime), hint: '' },
    { label: '阅读天数', value: (d.readDays || 0) + ' 天', hint: '' },
    {
      label: '自然日均',
      value: dayAverage === null ? '' : dayAverage,
      hint: dayAverage === null ? '' : '分母是自然日',
    },
    {
      label: '较上期',
      value: compare === null ? '' : compare,
      hint: '',
    },
  ];
  return list.filter((item) => !!item.value);
}

/** 偏好分类 TopN（preferCategory，按阅读时长降序；limit 默认 3） */
export function buildCategories(data, limit) {
  const cats = Array.isArray(data && data.preferCategory) ? data.preferCategory : [];
  if (!cats.length) {
    return [];
  }
  const total = cats.reduce((acc, item) => acc + (Number(item.readingTime) || 0), 0) || 1;
  const sorted = cats.slice().sort((a, b) => (Number(b.readingTime) || 0) - (Number(a.readingTime) || 0));
  const top = sorted.slice(0, limit || 3);
  const percents = barPercents(top.map((item) => item.readingTime));
  return top.map((item, index) => ({
    name: item.parentCategoryTitle || item.categoryTitle || '未分类',
    time: fmtDuration(item.readingTime),
    pct: Math.round(((Number(item.readingTime) || 0) / total) * 100) + '%',
    bar: percents[index],
  }));
}

/** 阅读时段分布（官方仅「累计」周期返回 preferTime） */
export function buildTimeBands(data) {
  const bands = timeBands(data);
  const positive = bands.filter((item) => item.seconds > 0);
  if (!positive.length) {
    return null;
  }
  const total = bands.reduce((acc, item) => acc + item.seconds, 0) || 1;
  const percents = barPercents(bands.map((item) => item.seconds));
  const rows = [];
  bands.forEach((item, index) => {
    if (item.seconds > 0) {
      rows.push({
        label: item.label,
        time: fmtDuration(item.seconds),
        pct: Math.round((item.seconds / total) * 100) + '%',
        bar: percents[index],
      });
    }
  });
  const hourly = hourlyReadTime(data);
  let peak = '';
  if (hourly.length) {
    const top = hourly.reduce((acc, item) => (item.seconds > acc.seconds ? item : acc));
    if (top.seconds > 0) {
      peak = pad2(top.hour) + ':00 前后（' + fmtDuration(top.seconds) + '）';
    }
  }
  return { rows: rows, peak: peak };
}

/** 读得最多 TopN（readLongest；limit 默认 3） */
export function buildLongest(data, limit) {
  const list = Array.isArray(data && data.readLongest) ? data.readLongest : [];
  return list.slice(0, limit || 3).map((item, index) => {
    const book = item.book || {};
    const album = item.albumInfo || {};
    return {
      rank: index + 1,
      title: book.title || album.name || '未命名',
      author: book.author || album.author || '',
      time: fmtDuration(item.readTime),
    };
  });
}

/** 汇总首页 view-model（A 档，随主请求即时渲染） */
export function buildHomeView(data, currentMode) {
  const d = data || {};
  return {
    hero: buildHero(d, currentMode),
    trend: buildTrend(d, currentMode),
    metrics: buildMetrics(d),
    categories: buildCategories(d),
    timeBands: buildTimeBands(d),
    longest: buildLongest(d),
    emptyRecord: !(Number(d.totalReadTime) > 0 || Number(d.readDays) > 0),
  };
}
