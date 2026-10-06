const store = require('../../shared/store');
const data = require('../../shared/data');
const sync = require('../../shared/sync');
const { callGateway } = require('../../shared/gateway');
const { buildHomeView } = require('../../shared/home-core');
const { shelfCounts, notebookStats, modeLabel, fmtDateTime } = require('../../shared/report-core');
const { renderHomeShare } = require('../../shared/home-share');
const { ensureTodayCard } = require('../../shared/daily-generate');
const { MATERIAL_MIN, dateKey } = require('../../shared/daily-core');
const wanderStore = require('../../shared/wander-store');
const { messageOf, isKeyError } = require('../../shared/errors');

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_KEY = 'wre_home_cache';
const PERSONA_BADGE_KEY = 'wre_home_persona';
const DAILY_POPUP_KEY = 'wre_daily_popup_date'; // 记录「每日卡片弹窗」最近弹出的日期（YYYY-MM-DD）

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
    // M2 首页增强（A 档：随主请求即时渲染）
    hero: null,
    trend: null,
    metrics: [],
    categories: [],
    timeBands: null,
    longest: [],
    // M2 首页增强（B 档：复用缓存的懒加载）
    overview: null,
    personaBadge: '',
    cacheHint: '',
    shareTitle: '',
    sharing: false,
    shareImg: '',
    showShare: false,
    // 每日卡片：每天首次打开自动弹窗（可关闭，当天只弹一次）
    showDaily: false,
    dailyLoading: false,
    dailyCard: null,
    dailyReason: '',
    dailyCount: 0,
    dailyNeed: MATERIAL_MIN,
    dailyError: '',
    // 灵感漫游：本周有「新一期」且未看过 → 入口挂「新」标
    wanderNew: false,
  },

  onShow() {
    const hasKey = !!store.getKey();
    this.setData({ hasKey, wanderNew: wanderStore.isNew() });
    if (hasKey) {
      this.load(false);
      this.loadOverview(false);
    }
    // 每日卡片为纯本地排版（M15 去 AI），配好 API Key 即可自动弹
    this.maybeDailyPopup(hasKey);
  },

  onPullDownRefresh() {
    if (!this.data.hasKey) {
      wx.stopPullDownRefresh();
      return;
    }
    this.load(true);
    this.loadOverview(true);
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

  goShelf() {
    wx.switchTab({ url: '/pages/shelf/index' });
  },

  goPersona() {
    wx.switchTab({ url: '/pages/persona/index' });
  },

  goReport() {
    wx.switchTab({ url: '/pages/report/index' });
  },

  goNotes() {
    wx.navigateTo({ url: '/pages/notes/index' });
  },

  goDaily() {
    if (this.data.showDaily) {
      this.setData({ showDaily: false });
    }
    wx.navigateTo({ url: '/pages/daily/index' });
  },

  goWander() {
    wx.navigateTo({ url: '/pages/wander/index' });
  },

  // ---- 每日卡片：每天首次打开自动弹窗 ----

  // 当天首次打开才弹：以本机日期为准，弹过即记录，切 Tab / 重进不再弹
  maybeDailyPopup(hasKey) {
    if (this.data.showDaily || !hasKey) {
      return;
    }
    const today = dateKey();
    let shown = '';
    try {
      shown = wx.getStorageSync(DAILY_POPUP_KEY) || '';
    } catch (e) {
      shown = '';
    }
    if (shown === today) {
      return;
    }
    // 先落记录，避免重复触发；当天无论成功与否都只弹这一次
    try {
      wx.setStorageSync(DAILY_POPUP_KEY, today);
    } catch (e) {
      // 本机存储失败不阻断弹窗
    }
    this.openDailyPopup();
  },

  // 打开弹窗并确保今天有一张卡片（本机已有则直接展示）
  async openDailyPopup() {
    this.setData({
      showDaily: true,
      dailyLoading: true,
      dailyCard: null,
      dailyReason: '',
      dailyError: '',
    });
    const res = await ensureTodayCard();
    if (res.ok) {
      this.setData({ dailyLoading: false, dailyCard: res.view, dailyError: '' });
    } else if (res.reason === 'material') {
      this.setData({
        dailyLoading: false,
        dailyReason: 'material',
        dailyCount: res.count || 0,
        dailyNeed: res.need || MATERIAL_MIN,
      });
    } else {
      this.setData({ dailyLoading: false, dailyError: res.error || '今日卡片生成失败，请稍后重试' });
    }
  },

  closeDaily() {
    this.setData({ showDaily: false });
  },

  dailyRetry() {
    this.openDailyPopup();
  },

  toggleDailyRelated(e) {
    const index = e.currentTarget.dataset.index;
    const related = this.data.dailyCard && this.data.dailyCard.related ? this.data.dailyCard.related : [];
    if (!related[index]) {
      return;
    }
    this.setData({ ['dailyCard.related[' + index + '].open']: !related[index].open });
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

  // 生成竖版分享图：本机 canvas 绘制 → 导出临时图片 → 弹层预览
  async generateShare() {
    if (!this.sharePayload || this.data.sharing) {
      return;
    }
    this.setData({ sharing: true });
    try {
      const canvas = await this.getShareCanvas();
      const size = renderHomeShare(canvas, this.sharePayload, store.getProfile());
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
        hero: null,
        trend: null,
        metrics: [],
        categories: [],
        timeBands: null,
        longest: [],
      });
      return;
    }

    this.writeCache(mode, res.data);
    this.render(res.data, false);
  },

  render(raw, fromCache) {
    const view = buildHomeView(raw, this.data.mode);
    const shareTitle = view.emptyRecord
      ? '来「悦读且住」，看看你的阅读数据'
      : '我已经读了 ' + view.hero.value + '，你读了多久？';
    // 分享图所需数据挂在实例上（不经 setData，避免大对象序列化开销）
    this.sharePayload = {
      data: raw,
      mode: this.data.mode,
      modeLabel: modeLabel(this.data.mode),
      generatedAt: fmtDateTime(Date.now()),
    };
    this.setData({
      hero: view.hero,
      trend: view.trend,
      metrics: view.metrics,
      categories: view.categories,
      timeBands: view.timeBands,
      longest: view.longest,
      emptyRecord: view.emptyRecord,
      error: '',
      cacheHint: fromCache ? '来自本地缓存（30 分钟内）' : '',
      shareTitle: shareTitle,
    });
  },

  // ---- B 档：书架 / 笔记概览 + 人格徽章（懒加载，避免进首页即发请求）----
  async loadOverview(force) {
    const key = store.getKey();
    if (!key) {
      return;
    }
    if (force) {
      const res = await data.fetchOverview(key, true);
      if (res && res.ok) {
        this.renderOverview(res.shelf, res.notebooks);
      }
      const cloud = await sync.syncGet();
      if (cloud && cloud.ok && cloud.persona && cloud.persona.name) {
        this.setData({ personaBadge: cloud.persona.name });
        try {
          wx.setStorageSync(PERSONA_BADGE_KEY, { name: cloud.persona.name, at: Date.now() });
        } catch (e) {
          // 本机缓存失败不影响展示
        }
      }
      return;
    }
    // 非刷新：只读本机缓存，绝不发网络请求
    const cache = data.peekOverview();
    if (cache && cache.ok) {
      this.renderOverview(cache.shelf, cache.notebooks);
    }
    const badge = this.readPersonaBadge();
    if (badge) {
      this.setData({ personaBadge: badge.name });
    }
  },

  renderOverview(shelf, notebooks) {
    const counts = shelf ? shelfCounts(shelf) : null;
    const stats = notebookStats(notebooks);
    if (!counts && !stats) {
      this.setData({ overview: null });
      return;
    }
    this.setData({
      overview: {
        shelfText: counts ? counts.total + ' 个条目' : '去看看',
        noteText: stats ? stats.totalNoteCount + ' 条笔记' : '去看看',
      },
    });
  },

  readPersonaBadge() {
    try {
      const value = wx.getStorageSync(PERSONA_BADGE_KEY);
      return value && value.name ? value : null;
    } catch (e) {
      return null;
    }
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
