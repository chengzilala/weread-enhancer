const store = require('../../shared/store');
const data = require('../../shared/data');
const { buildReportBlocks, fmtDateTime } = require('../../shared/report-core');

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_KEY = 'wre_report_cache';

const MODES = [
  { key: 'weekly', label: '本周' },
  { key: 'monthly', label: '本月' },
  { key: 'annually', label: '本年' },
  { key: 'overall', label: '累计' },
];

Page({
  data: {
    hasKey: false,
    modes: MODES,
    mode: 'overall',
    loading: false,
    error: '',
    needsKey: false,
    fromCache: false,
    blocks: [],
    meta: [],
    emptyRecord: false,
  },

  onShow() {
    const hasKey = !!store.getKey();
    this.setData({ hasKey });
    if (hasKey) {
      this.load(false);
    }
  },

  onPullDownRefresh() {
    if (!this.data.hasKey) {
      wx.stopPullDownRefresh();
      return;
    }
    this.load(true);
  },

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.mode) {
      return;
    }
    this.setData({ mode });
    this.load(false);
  },

  retry() {
    this.load(true);
  },

  goSettings() {
    wx.switchTab({ url: '/pages/settings/index' });
  },

  async load(force) {
    const mode = this.data.mode;
    const key = store.getKey();
    if (!key) {
      this.setData({ hasKey: false, loading: false });
      return;
    }

    if (!force) {
      const cached = this.readCache(mode);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        this.render(cached.data, cached.overall, cached.overview, true);
        wx.stopPullDownRefresh();
        return;
      }
    }

    this.setData({ loading: true, error: '', needsKey: false });

    // 三路并行：当前周期数据 + 累计数据（执行摘要用）+ 书架/笔记概览
    const results = await Promise.all([
      data.fetchReadData(mode, key),
      mode === 'overall' ? Promise.resolve(null) : data.fetchReadData('overall', key),
      data.fetchOverview(key, force),
    ]);

    if (this.data.mode !== mode) {
      wx.stopPullDownRefresh();
      return;
    }

    const mainRes = results[0];
    const overallRes = results[1];
    const overviewRes = results[2];
    this.setData({ loading: false });
    wx.stopPullDownRefresh();

    if (!mainRes.ok) {
      const needKey = mainRes.code === 'auth' || mainRes.code === 'nokey';
      this.setData({ error: mainRes.error || '读取数据失败', needsKey: needKey, blocks: [], meta: [] });
      return;
    }

    const overall = mode === 'overall' ? mainRes.data : (overallRes && overallRes.ok ? overallRes.data : null);
    const overview = overviewRes && overviewRes.ok ? overviewRes : null;

    this.writeCache(mode, mainRes.data, overall, overview);
    this.render(mainRes.data, overall, overview, false);
  },

  render(currentData, overall, overview, fromCache) {
    const d = currentData || {};
    const blocks = buildReportBlocks(d, this.data.mode, overview, { overall: overall });
    const meta = [
      ['统计周期', this.modeLabel(this.data.mode)],
      ['生成时间', fmtDateTime(Date.now())],
      ['数据来源', '微信读书官方 Agent 网关'],
      ['分析方法', '客观数据本机规则计算（纯本地执行）'],
    ];
    const emptyRecord = !(Number(d.totalReadTime) > 0 || Number(d.readDays) > 0) &&
      !(overview && overview.shelf) && !(overview && overview.notebooks);
    this.setData({
      blocks,
      meta,
      emptyRecord,
      error: '',
      fromCache: fromCache,
    });
  },

  modeLabel(key) {
    const found = MODES.filter((item) => item.key === key)[0];
    return found ? found.label : key;
  },

  readCache(mode) {
    try {
      const cache = wx.getStorageSync(CACHE_KEY) || {};
      return cache[mode] || null;
    } catch (e) {
      return null;
    }
  },

  writeCache(mode, currentData, overall, overview) {
    try {
      const cache = wx.getStorageSync(CACHE_KEY) || {};
      cache[mode] = { at: Date.now(), data: currentData, overall: overall || null, overview: overview || null };
      wx.setStorageSync(CACHE_KEY, cache);
    } catch (e) {
      // 存储失败不影响展示
    }
  },
});
