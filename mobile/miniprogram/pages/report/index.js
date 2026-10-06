const store = require('../../shared/store');
const data = require('../../shared/data');
const { buildReportBlocks, fmtDateTime } = require('../../shared/report-core');
const { fmtDuration } = require('../../shared/format');
const { renderReportShare } = require('../../shared/report-share');
const { messageOf, isKeyError } = require('../../shared/errors');

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
    shareTitle: '',
    sharing: false,
    shareImg: '',
    showShare: false,
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
      title: this.data.shareTitle || '我的阅读报告，点开看看',
      path: '/pages/report/index',
    };
  },

  // 生成竖版分享图：本机 canvas 绘制 → 导出临时图片 → 弹层预览
  async generateShare() {
    if (!this.sharePayload || this.data.sharing) {
      return;
    }
    this.setData({ sharing: true });
    try {
      const canvas = await this.getShareCanvas();
      const size = renderReportShare(canvas, this.sharePayload, store.getProfile());
      const tempFilePath = await this.canvasToTemp(canvas, size);
      this.setData({ sharing: false, shareImg: tempFilePath, showShare: true });
    } catch (err) {
      this.setData({ sharing: false });
      wx.showToast({ title: (err && err.message) || '生成失败，请重试', icon: 'none' });
    }
  },

  getShareCanvas() {
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery().in(this).select('#shareCanvas').fields({ node: true, size: true }).exec((res) => {
        const node = res && res[0] && res[0].node;
        if (node) {
          resolve(node);
        } else {
          reject(new Error('画布未就绪，请重试'));
        }
      });
    });
  },

  // 把画布按「整块缓冲」导出：size.width/height 已是高清绘制后的缓冲像素
  canvasToTemp(canvas, size) {
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas: canvas,
        x: 0,
        y: 0,
        fileType: 'png',
        destWidth: size.width,
        destHeight: size.height,
        success: (res) => resolve(res.tempFilePath),
        fail: () => reject(new Error('图片导出失败，请重试')),
      }, this);
    });
  },

  closeShare() {
    this.setData({ showShare: false });
  },

  // 一键转发分享图给微信好友（无需先保存到相册）
  shareImage() {
    const filePath = this.data.shareImg;
    if (!filePath) {
      return;
    }
    if (typeof wx.showShareImageMenu !== 'function') {
      wx.showToast({ title: '当前微信版本不支持，请长按图片转发', icon: 'none' });
      return;
    }
    wx.showShareImageMenu({
      path: filePath,
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('cancel') < 0) {
          wx.showToast({ title: '转发失败，请长按图片转发', icon: 'none' });
        }
      },
    });
  },

  saveShare() {
    const filePath = this.data.shareImg;
    if (!filePath) {
      return;
    }
    wx.saveImageToPhotosAlbum({
      filePath: filePath,
      success: () => {
        wx.showToast({ title: '已保存到相册', icon: 'success' });
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('auth deny') >= 0 || msg.indexOf('authorize') >= 0 || msg.indexOf('auth denied') >= 0) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中允许「保存到相册」后重试',
            confirmText: '去设置',
            success: (r) => {
              if (r.confirm) {
                wx.openSetting();
              }
            },
          });
        } else if (msg.indexOf('cancel') < 0) {
          wx.showToast({ title: '保存失败，请重试', icon: 'none' });
        }
      },
    });
  },

  noop() {},

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
      this.setData({
        error: messageOf(mainRes, '读取数据失败'),
        needsKey: isKeyError(mainRes.code),
        blocks: [],
        meta: [],
      });
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
    const modeText = this.modeLabel(this.data.mode);
    const shareTitle = Number(d.totalReadTime) > 0
      ? '我的' + modeText + '阅读报告：' + fmtDuration(d.totalReadTime) + '，点开看看'
      : '我的' + modeText + '阅读报告，点开看看';
    // 分享图所需数据挂在实例上（不经 setData，避免大对象序列化开销）
    this.sharePayload = {
      data: d,
      overview: overview || null,
      mode: this.data.mode,
      modeLabel: modeText,
      generatedAt: fmtDateTime(Date.now()),
    };
    this.setData({
      blocks,
      meta,
      emptyRecord,
      error: '',
      fromCache: fromCache,
      shareTitle,
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
