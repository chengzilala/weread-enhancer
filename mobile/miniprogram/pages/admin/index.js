/**
 * 运营看板（M13 · 仅管理员可见）
 *
 * 数据分三块：
 *   A. 小程序使用量 —— 云函数 opsAdmin（按 openid + 天去重）
 *   B. 插件使用量   —— 云函数 opsAdmin（插件匿名上报，随机匿名标识去重）
 *   C. 我的阅读数据 —— 复用本机已有的取数逻辑（不新增接口、不额外上传）
 *
 * 非白名单用户：云函数直接返回 code=forbidden，页面显示「无权限」，前端拿不到任何数字。
 */
const store = require('../../shared/store');
const theme = require('../../shared/theme');
const data = require('../../shared/data');
const ops = require('../../shared/ops');
const { notebookStats } = require('../../shared/report-core');
const { fmtDuration, fmtTime } = require('../../shared/format');

Page({
  data: {
    wreFs: 1,
    wreDark: false,
    loading: true,
    error: '',
    forbidden: false,
    generatedText: '',
    mp: null,
    plugin: null,
    mine: null,
    mineError: '',
  },

  onShow() {
    this.setData({ wreFs: store.getFontScale(), wreDark: theme.apply() });
    this.load();
  },

  onPullDownRefresh() {
    this.load();
  },

  load() {
    this.setData({ loading: true, error: '', forbidden: false });
    ops
      .fetchAdmin()
      .then((res) => {
        wx.stopPullDownRefresh();
        if (!res || !res.ok) {
          if (res && res.code === 'forbidden') {
            this.setData({ loading: false, forbidden: true });
            return;
          }
          this.setData({ loading: false, error: (res && res.error) || '看板数据获取失败，请重试' });
          return;
        }
        this.setData({
          loading: false,
          mp: res.mp || null,
          plugin: res.plugin
            ? {
                todayActive: res.plugin.todayUsers,
                totalActive: res.plugin.totalUsers,
                versions: (res.plugin.versions || []).slice(0, 12),
                truncated: !!res.plugin.truncated,
              }
            : null,
          generatedText: res.generatedAt ? fmtTime(res.generatedAt) : '',
        });
        this.loadMine();
      })
      .catch(() => {
        wx.stopPullDownRefresh();
        this.setData({ loading: false, error: '看板数据获取失败，请重试' });
      });
  },

  // C 块：复用本机已有的取数逻辑（累计时长 / 阅读天数 / 书架书数 / 笔记总数）
  async loadMine() {
    const key = store.getKey();
    if (!key) {
      this.setData({ mine: null, mineError: '未配置 API Key，暂无法读取你的阅读数据' });
      return;
    }
    const [readRes, overview] = await Promise.all([data.fetchReadData('overall', key), data.fetchOverview(key)]);
    const read = (readRes && readRes.data) || {};
    const notebook = overview && overview.ok ? notebookStats(overview.notebooks) : null;
    const shelf = overview && overview.ok ? overview.shelf : null;
    const shelfCount = shelf ? (shelf.books || []).length + (shelf.albums || []).length : null;
    if (!(readRes && readRes.ok) && !shelf && !notebook) {
      this.setData({ mine: null, mineError: (readRes && readRes.error) || '阅读数据获取失败' });
      return;
    }
    this.setData({
      mine: {
        totalTime: readRes && readRes.ok ? fmtDuration(read.totalReadTime) : '—',
        readDays: readRes && readRes.ok ? (read.readDays || 0) + ' 天' : '—',
        shelfCount: shelfCount == null ? '—' : shelfCount + ' 本',
        noteTotal: notebook ? notebook.totalNoteCount + ' 条' : '—',
      },
      mineError: '',
    });
  },

  onStateAction(e) {
    const type = e && e.detail && e.detail.type;
    if (type === 'settings') {
      wx.switchTab({ url: '/pages/settings/index' });
      return;
    }
    this.load();
  },
});
