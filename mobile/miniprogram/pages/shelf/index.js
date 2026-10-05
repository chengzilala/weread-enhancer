const store = require('../../shared/store');
const data = require('../../shared/data');
const { shelfCounts, shelfCategories } = require('../../shared/report-core');
const { messageOf, isKeyError } = require('../../shared/errors');

const SHELF_MAX = 100; // 单次最多渲染的条目数，防超长列表卡顿

function sortTopThenTime(list, timeField) {
  return list.slice().sort((a, b) => {
    const top = (Number(b.isTop) || 0) - (Number(a.isTop) || 0);
    if (top !== 0) {
      return top;
    }
    return (Number(b[timeField]) || 0) - (Number(a[timeField]) || 0);
  });
}

Page({
  data: {
    hasKey: false,
    loading: false,
    error: '',
    needsKey: false,
    cacheHint: '',
    cards: [],
    categories: [],
    books: [],
    albums: [],
    hasMp: false,
    bookMore: 0,
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

  // 小程序无法打开第三方网页，点击复制「书名 · 作者」便于到微信读书 App 里搜索
  copyTitle(e) {
    const title = e.currentTarget.dataset.title || '';
    const author = e.currentTarget.dataset.author || '';
    const text = author ? (title + ' · ' + author) : title;
    if (!text) {
      return;
    }
    wx.setClipboardData({ data: text });
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
        error: messageOf(res, '读取书架失败'),
        needsKey: isKeyError(res.code),
        cards: [],
        books: [],
        albums: [],
        categories: [],
      });
      return;
    }
    if (!res.shelf) {
      this.setData({ error: '书架数据暂时取不到，请稍后重试', needsKey: false, cards: [], books: [], albums: [], categories: [] });
      return;
    }
    this.render(res.shelf, res.fromCache);
  },

  render(shelf, fromCache) {
    const counts = shelfCounts(shelf);
    const cards = [
      { label: '电子书', value: counts.books + ' 本' },
      { label: '有声书 / 专辑', value: counts.albums + ' 个' },
      { label: '已读完', value: counts.finished + ' 本' },
      { label: '私密', value: counts.secret + ' 项' },
    ];
    const cats = shelfCategories(shelf).list;

    const sortedBooks = sortTopThenTime(shelf.books || [], 'readUpdateTime');
    const sortedAlbums = sortTopThenTime(shelf.albums || [], 'readUpdateTime');
    const books = sortedBooks.slice(0, SHELF_MAX).map((item) => ({
      id: item.bookId,
      title: item.title || '未命名',
      author: item.author || '',
      category: item.category || '',
      cover: item.cover || '',
      finished: Number(item.finishReading) === 1,
      secret: Number(item.secret) === 1,
      top: Number(item.isTop) === 1,
    }));
    const albums = sortedAlbums.slice(0, SHELF_MAX).map((item) => ({
      id: item.albumId,
      title: item.name || '未命名',
      author: item.authorName || '',
      category: '',
      cover: item.cover || '',
      finished: Number(item.finish) === 1,
      secret: Number(item.secret) === 1,
      top: Number(item.isTop) === 1,
    }));

    this.setData({
      cards,
      categories: cats,
      books,
      albums,
      hasMp: !!shelf.hasMp,
      bookMore: Math.max(0, sortedBooks.length - SHELF_MAX),
      error: '',
      cacheHint: fromCache ? '来自本地缓存（30 分钟内）' : '',
    });
  },
});
