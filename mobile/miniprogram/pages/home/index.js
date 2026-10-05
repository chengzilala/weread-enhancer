const store = require('../../shared/store');
const { callGateway } = require('../../shared/gateway');
const { fmtDuration, fmtCompare } = require('../../shared/format');
const { messageOf, isKeyError } = require('../../shared/errors');

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_KEY = 'wre_home_cache';

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
    mode: 'weekly',
    loading: false,
    error: '',
    needsKey: false,
    emptyRecord: false,
    metrics: [],
    cacheHint: '',
    shareTitle: '',
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

  // 通用状态块的动作：settings=去配置 Key，retry=重试
  onStateAction(e) {
    if (e.detail.type === 'settings') {
      this.goSettings();
    } else {
      this.retry();
    }
  },

  onShareAppMessage() {
    return {
      title: this.data.shareTitle || '来「悦读且住」，看看你的阅读数据',
      path: '/pages/home/index',
    };
  },

  async load(force) {
    const mode = this.data.mode;
    const key = store.getKey();
    if (!key) {
      this.setData({ hasKey: false, loading: false });
      return;
    }

    if (!force) {
      const cache = this.readCache();
      const hit = cache[mode];
      if (hit && hit.data && Date.now() - hit.at < CACHE_TTL_MS) {
        this.render(hit.data, true);
        wx.stopPullDownRefresh();
        return;
      }
    }

    this.setData({ loading: true, error: '', needsKey: false });
    const res = await callGateway('/readdata/detail', { mode: mode, baseTime: 0 }, key);

    // 周期可能已切换，丢弃过期结果
    if (this.data.mode !== mode) {
      wx.stopPullDownRefresh();
      return;
    }

    this.setData({ loading: false });
    wx.stopPullDownRefresh();

    if (!res.ok) {
      this.setData({
        error: messageOf(res, '读取数据失败'),
        needsKey: isKeyError(res.code),
        metrics: [],
      });
      return;
    }

    this.writeCache(mode, res.data);
    this.render(res.data, false);
  },

  render(data, fromCache) {
    const d = data || {};
    const compare = fmtCompare(d.compare);
    const dayAverage = d.dayAverageReadTime == null ? null : fmtDuration(d.dayAverageReadTime);
    const metrics = [
      { label: '总时长', value: fmtDuration(d.totalReadTime), hint: '' },
      { label: '阅读天数', value: (d.readDays || 0) + ' 天', hint: '' },
      {
        label: '自然日均',
        value: dayAverage === null ? '—' : dayAverage,
        hint: dayAverage === null ? '官方未提供该周期' : '分母是自然日',
      },
      {
        label: '较上期',
        value: compare === null ? '—' : compare,
        hint: compare === null ? '官方仅当前周期提供' : '',
      },
    ];
    const emptyRecord = !(Number(d.totalReadTime) > 0 || Number(d.readDays) > 0);
    const shareTitle = emptyRecord
      ? '来「悦读且住」，看看你的阅读数据'
      : '我已经读了 ' + metrics[0].value + '，你今年读了多久？';
    this.setData({
      metrics,
      emptyRecord,
      error: '',
      cacheHint: fromCache ? '来自本地缓存（30 分钟内）' : '',
      shareTitle,
    });
  },

  readCache() {
    try {
      return wx.getStorageSync(CACHE_KEY) || {};
    } catch (e) {
      return {};
    }
  },

  writeCache(mode, data) {
    const cache = this.readCache();
    cache[mode] = { at: Date.now(), data: data };
    try {
      wx.setStorageSync(CACHE_KEY, cache);
    } catch (e) {
      // 存储失败不影响展示
    }
  },
});
