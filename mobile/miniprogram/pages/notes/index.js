const store = require('../../shared/store');
const data = require('../../shared/data');
const { notebookStats } = require('../../shared/report-core');
const { messageOf, isKeyError } = require('../../shared/errors');

Page({
  data: {
    hasKey: false,
    loading: false,
    error: '',
    needsKey: false,
    cacheHint: '',
    cards: [],
    books: [],
    bookmarkTotal: 0,
    truncated: false,
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

  async load(force) {
    const key = store.getKey();
    if (!key) {
      this.setData({ hasKey: false, loading: false });
      return;
    }
    this.setData({ loading: true, error: '', needsKey: false });

    const res = await data.fetchOverview(key, force);
    this.setData({ loading: false });
    wx.stopPullDownRefresh();

    if (!res.ok) {
      this.setData({
        error: messageOf(res, '读取笔记失败'),
        needsKey: isKeyError(res.code),
        cards: [],
        books: [],
      });
      return;
    }
    if (!res.notebooks) {
      this.setData({ error: '笔记数据暂时取不到，请稍后重试', needsKey: false, cards: [], books: [] });
      return;
    }
    this.render(res.notebooks, res.fromCache);
  },

  render(notebooks, fromCache) {
    const stats = notebookStats(notebooks);
    if (!stats) {
      this.setData({ error: '笔记数据暂时取不到，请稍后重试', cards: [], books: [] });
      return;
    }
    const cards = [
      { label: '笔记总数', value: stats.totalNoteCount + ' 条' },
      { label: '有笔记的书', value: stats.totalBookCount + ' 本' },
      { label: '划线', value: stats.noteTotal + ' 条' },
      { label: '想法', value: stats.reviewTotal + ' 条' },
    ];
    const books = stats.topBooks.map((item) => ({
      bookId: item.bookId,
      title: item.title || '未命名',
      author: item.author || '',
      noteCount: item.noteCount || 0,
      reviewCount: item.reviewCount || 0,
      bookmarkCount: item.bookmarkCount || 0,
    }));

    this.setData({
      cards,
      books,
      bookmarkTotal: stats.bookmarkTotal || 0,
      truncated: !!stats.truncated,
      error: '',
      cacheHint: fromCache ? '来自本地缓存（30 分钟内）' : '',
    });
  },
});
