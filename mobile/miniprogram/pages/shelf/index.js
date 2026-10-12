const store = require('../../shared/store');
const theme = require('../../shared/theme');
const data = require('../../shared/data');
const { shelfCounts, shelfCategories, fmtDateTime } = require('../../shared/report-core');
const { renderShelfShare } = require('../../shared/shelf-share');
const { messageOf, isKeyError } = require('../../shared/errors');
const shareEntry = require('../../shared/share-entry');

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

// 按官方分组：只取「组名 + 数量」（archive 原顺序），末尾追加「未分组」；不展示组内书目
function buildGroups(shelf) {
  const groups = Array.isArray(shelf.groups) ? shelf.groups : [];
  if (!groups.length) {
    return { groups: [], ungrouped: null };
  }
  const out = [];
  groups.forEach((g) => {
    const count = Number(g.count) || 0;
    if (count > 0) {
      out.push({ name: g.name, count: count });
    }
  });
  const countOf = (list) => (Array.isArray(list) ? list : []).filter((it) => !(Array.isArray(it.groups) && it.groups.length)).length;
  const rest = countOf(shelf.books) + countOf(shelf.albums);
  return { groups: out, ungrouped: rest ? { count: rest } : null };
}

Page({
  data: {
    wreFs: 1,
    wreDark: false,
    hasKey: false,
    loading: false,
    error: '',
    needsKey: false,
    cacheHint: '',
    cards: [],
    categories: [],
    books: [],
    albums: [],
    groups: [],
    ungrouped: null,
    hasMp: false,
    bookMore: 0,
    sharing: false,
    shareImg: '',
    showShare: false,
  },

  onShow() {
    this.setData({ wreFs: store.getFontScale(), wreDark: theme.apply() });
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

  onShareAppMessage() {
    const counts = shelfCounts(this.shareShelf);
    const title = counts && counts.books > 0
      ? '我的微信读书书架有 ' + counts.books + ' 本书，来比比'
      : '来「悦读且住」，看看你的书架';
    return {
      title: title,
      path: shareEntry.forwardPath(this, '/pages/shelf/index'),
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
      const size = renderShelfShare(canvas, this.sharePayload, store.getProfile());
      const tempFilePath = await this.canvasToTemp(canvas, size);
      this.setData({ sharing: false, shareImg: tempFilePath, showShare: true });
      shareEntry.prepareCode(this);
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

  // 通用分享卡（只读分享页 / 复制链接用）
  buildShareSpec() {
    const p = this.sharePayload;
    if (!p || !p.shelf) {
      return null;
    }
    const counts = shelfCounts(p.shelf) || {};
    const books = sortTopThenTime(p.shelf.books || [], 'readUpdateTime');
    const profile = store.getProfile();
    return {
      kind: 'shelf',
      badge: '书架',
      title: '我的书架',
      subtitle: '生成于 ' + p.generatedAt,
      stats: [
        { label: '条目总数', value: (counts.total || 0) + ' 个' },
        { label: '电子书', value: (counts.books || 0) + ' 本' },
        { label: '专辑/有声书', value: (counts.albums || 0) + ' 个' },
        { label: '已读完', value: (counts.finished || 0) + ' 本' },
      ],
      lines: books.slice(0, 3).map((b) => '《' + (b.title || '未命名') + '》' + (b.author ? ' · ' + b.author : '')),
      footer: (profile.nickName ? profile.nickName + ' · ' : '') + '悦读且住 · 本机计算',
    };
  },

  copyLink() {
    shareEntry.copyLink(this);
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
        groups: [],
        ungrouped: null,
      });
      return;
    }
    if (!res.shelf) {
      this.setData({ error: '书架数据暂时取不到，请稍后重试', needsKey: false, cards: [], books: [], albums: [], categories: [], groups: [], ungrouped: null });
      return;
    }
    this.render(res.shelf, res.fromCache);
  },

  render(shelf, fromCache) {
    const counts = shelfCounts(shelf);
    const grouped = buildGroups(shelf);   // 官方分组分区（只读，来自 archive）
    // 分享图所需数据挂在实例上（不经 setData，避免大对象序列化开销）
    this.shareShelf = shelf;
    this.sharePayload = { shelf: shelf, generatedAt: fmtDateTime(Date.now()) };
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
      groups: grouped.groups,
      ungrouped: grouped.ungrouped,
      hasMp: !!shelf.hasMp,
      bookMore: Math.max(0, sortedBooks.length - SHELF_MAX),
      error: '',
      cacheHint: fromCache ? '来自本地缓存（30 分钟内）' : '',
    });
  },
});
