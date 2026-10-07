/**
 * 我的纸书 — 纸质书归档 + 微信读书关联
 *
 * 三个视图（同一页面内切换，减少跳转）：
 *   list —— 我的纸书列表（扫码入库 / 手动添加 / 搜索）
 *   edit —— 单本详情 / 编辑（含「手动关联电子书」「去微信读书」）
 *   link —— 手动关联：搜微信读书 → 挑一本 → 绑定（M10）
 *
 * 红线：Key 只从 store 取、只经云函数中转；本页不打印 Key。
 */
const store = require('../../shared/store');
const paperbook = require('../../shared/paperbook');

const ISBN_RE = /^\d{13}$/;

Page({
  data: {
    hasKey: false,
    books: [],
    filtered: [],
    keyword: '',
    linkedCount: 0,

    view: 'list', // list | edit | link

    editing: null,
    isNew: false,

    linkKeyword: '',
    linkResults: [],
    linkLoading: false,
    linkError: '',
  },

  onShow() {
    this.setData({ hasKey: !!store.getKey() });
    this.reload();
  },

  reload() {
    const books = paperbook.listLocal();
    const linkedCount = books.filter((b) => !!b.bookId).length;
    this.setData({ books: books, linkedCount: linkedCount });
    this.applyFilter();
  },

  applyFilter() {
    const kw = String(this.data.keyword || '').trim().toLowerCase();
    const all = this.data.books;
    const filtered = kw
      ? all.filter(
          (b) =>
            String(b.title || '').toLowerCase().indexOf(kw) >= 0 ||
            String(b.author || '').toLowerCase().indexOf(kw) >= 0 ||
            String(b.isbn || '').indexOf(kw) >= 0
        )
      : all;
    this.setData({ filtered: filtered });
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
    this.applyFilter();
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/index' });
  },

  // ---- 扫码入库（连续扫：一直扫到用户点返回为止）----

  onScan() {
    this.scanNext();
  },

  scanNext() {
    wx.scanCode({
      scanType: ['barCode'],
      onlyFromCamera: true,
      success: (res) => {
        this.handleScannedCode(String((res && res.result) || '').trim());
        this.scanNext(); // 连续录入，直到用户返回
      },
      fail: (err) => {
        const msg = String((err && err.errMsg) || '');
        if (msg.indexOf('auth') >= 0 || msg.indexOf('deny') >= 0 || msg.indexOf('permission') >= 0) {
          wx.showModal({
            title: '需要相机权限',
            content: '扫码需要相机权限，请在右上角「…」→ 设置里打开，或到手机系统设置里允许微信使用相机。',
            showCancel: false,
          });
        }
        this.reload();
      },
    });
  },

  handleScannedCode(code) {
    if (!code) {
      return;
    }
    if (!ISBN_RE.test(code)) {
      wx.showToast({ title: '这不是图书条码（应为 13 位 ISBN）', icon: 'none' });
      return;
    }
    if (paperbook.findByIsbn(code)) {
      wx.showToast({ title: '这本已在你的书库', icon: 'none' });
      return;
    }
    const item = paperbook.addBook({ isbn: code, title: '' });
    paperbook.backupSilent();
    wx.showToast({ title: '已加入', icon: 'none', duration: 700 });
    this.reload();
    this.autoFill(item.id, code, '');
  },

  /** M3 自动匹配：先 ISBN 后书名；命中只作「建议」，用户可改 */
  autoFill(id, isbn, title) {
    if (!this.data.hasKey) {
      return;
    }
    const key = store.getKey();
    paperbook.autoMatch(key, isbn, title).then((res) => {
      if (!res || !res.ok || !res.hit) {
        return;
      }
      const hit = res.hit;
      paperbook.updateBook(id, {
        title: hit.title || title || '',
        author: hit.author || '',
        cover: hit.cover || '',
        bookId: hit.bookId || '',
        deepLink: hit.deepLink || '',
        linkTitle: hit.title || '',
        linkManual: false,
      });
      paperbook.backupSilent();
      this.reload();
      if (this.data.view === 'edit' && this.data.editing && this.data.editing.id === id) {
        this.openEdit({ currentTarget: { dataset: { id: id } } });
      }
    });
  },

  // ---- 手动添加 ----

  onAddManual() {
    this.setData({
      view: 'edit',
      isNew: true,
      editing: { id: '', isbn: '', title: '', author: '', cover: '', bookId: '', deepLink: '', linkTitle: '', linkManual: false },
    });
  },

  // ---- 详情 / 编辑 ----

  onOpen(e) {
    this.openEdit(e);
  },

  openEdit(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    const book = this.data.books.filter((b) => b.id === id)[0];
    if (!book) {
      return;
    }
    this.setData({ view: 'edit', isNew: false, editing: Object.assign({}, book) });
  },

  onFieldInput(e) {
    const field = e.currentTarget.dataset.field;
    const editing = Object.assign({}, this.data.editing);
    editing[field] = e.detail.value;
    this.setData({ editing: editing });
  },

  onBackToList() {
    this.setData({ view: 'list', editing: null });
    this.reload();
  },

  onSave() {
    const e = this.data.editing;
    if (!e) {
      return;
    }
    const isbn = String(e.isbn || '').trim();
    const title = String(e.title || '').trim();
    const author = String(e.author || '').trim();
    if (!isbn && !title) {
      wx.showToast({ title: '请至少填书名或 ISBN', icon: 'none' });
      return;
    }
    if (isbn && !ISBN_RE.test(isbn)) {
      wx.showToast({ title: 'ISBN 应为 13 位数字', icon: 'none' });
      return;
    }

    if (this.data.isNew) {
      if (isbn && paperbook.findByIsbn(isbn)) {
        wx.showToast({ title: '该 ISBN 已在书库', icon: 'none' });
        return;
      }
      const item = paperbook.addBook({ isbn: isbn, title: title, author: author, cover: e.cover || '' });
      paperbook.backupSilent();
      wx.showToast({ title: '已加入书库', icon: 'success' });
      this.setData({ view: 'list', isNew: false, editing: null });
      this.reload();
      this.autoFill(item.id, isbn, title);
      return;
    }

    paperbook.updateBook(e.id, { isbn: isbn, title: title, author: author, cover: e.cover || '' });
    paperbook.backupSilent();
    wx.showToast({ title: '已保存', icon: 'success' });
    this.setData({ view: 'list', editing: null });
    this.reload();
  },

  onDelete() {
    const e = this.data.editing;
    if (!e) {
      return;
    }
    wx.showModal({
      title: '删除这本纸书？',
      content: '仅从你的纸质书库移除，不影响微信读书里的任何数据。',
      confirmText: '删除',
      confirmColor: '#E5484D',
      success: (r) => {
        if (!r.confirm) {
          return;
        }
        paperbook.removeBook(e.id);
        paperbook.backupSilent();
        this.setData({ view: 'list', editing: null });
        this.reload();
      },
    });
  },

  // ---- M10 手动关联电子书 ----

  onLinkStart() {
    if (!this.data.hasKey) {
      wx.showToast({ title: '请先在「我的」页配置 API Key', icon: 'none' });
      return;
    }
    let editing = this.data.editing;
    if (this.data.isNew) {
      if (!editing.title && !editing.isbn) {
        wx.showToast({ title: '先填书名或 ISBN 再搜', icon: 'none' });
        return;
      }
      editing = paperbook.addBook({
        isbn: String(editing.isbn || '').trim(),
        title: String(editing.title || '').trim(),
        author: String(editing.author || '').trim(),
        cover: editing.cover || '',
      });
      paperbook.backupSilent();
      this.setData({ editing: editing, isNew: false });
    }
    const kw = editing.title || editing.isbn || '';
    this.setData({ view: 'link', linkKeyword: kw, linkResults: [], linkError: '', linkLoading: false });
    if (kw) {
      this.onLinkSearch();
    }
  },

  onLinkKeyword(e) {
    this.setData({ linkKeyword: e.detail.value });
  },

  onLinkSearch() {
    const kw = String(this.data.linkKeyword || '').trim();
    if (!kw) {
      wx.showToast({ title: '请输入书名或作者', icon: 'none' });
      return;
    }
    this.setData({ linkLoading: true, linkError: '' });
    paperbook.searchStore(kw, store.getKey()).then((res) => {
      if (!res.ok) {
        this.setData({ linkLoading: false, linkResults: [], linkError: res.error || '搜索失败，请重试' });
        return;
      }
      this.setData({ linkLoading: false, linkResults: res.items, linkError: '' });
    });
  },

  onLinkPick(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const hit = this.data.linkResults[idx];
    const editing = this.data.editing;
    if (!hit || !editing) {
      return;
    }
    const id = editing.id;
    const updated = paperbook.updateBook(id, {
      bookId: hit.bookId || '',
      deepLink: hit.deepLink || '',
      linkTitle: hit.title || '',
      linkManual: true,
      cover: editing.cover || hit.cover || '',
      author: editing.author || hit.author || '',
      title: editing.title || hit.title || '',
    });
    paperbook.backupSilent();
    wx.showToast({ title: '已关联', icon: 'success' });
    this.setData({ view: 'edit', editing: updated || editing });
    this.reload();
  },

  onLinkCancel() {
    this.setData({ view: 'edit' });
  },

  onUnlink() {
    const editing = this.data.editing;
    if (!editing) {
      return;
    }
    wx.showModal({
      title: '解除关联？',
      content: '只解除与微信读书电子版的关联，纸书档案和书名仍在。',
      success: (r) => {
        if (!r.confirm) {
          return;
        }
        const updated = paperbook.updateBook(editing.id, { bookId: '', deepLink: '', linkTitle: '', linkManual: false });
        paperbook.backupSilent();
        this.setData({ editing: updated || editing });
        this.reload();
      },
    });
  },

  /** 小程序打不开 weread:// scheme，只能复制书名让用户在 App 里搜 */
  onGoWeread() {
    const editing = this.data.editing;
    if (!editing) {
      return;
    }
    const text = String(editing.linkTitle || editing.title || editing.isbn || '');
    if (!text) {
      wx.showToast({ title: '这本还没有书名', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showModal({
          title: '已复制书名',
          content: '打开微信读书 App，搜索「' + text + '」即可继续阅读。（小程序无法直接唤起微信读书）',
          showCancel: false,
        });
      },
    });
  },

  // ---- 云端恢复 ----

  onRestore() {
    wx.showLoading({ title: '读取云端…' });
    paperbook.restoreFromCloud().then((res) => {
      wx.hideLoading();
      if (!res.ok) {
        wx.showToast({ title: res.error || '云端恢复失败', icon: 'none' });
        return;
      }
      if (!res.books.length) {
        wx.showToast({ title: '云端还没有备份', icon: 'none' });
        return;
      }
      wx.showModal({
        title: '用云端备份覆盖本机？',
        content: '云端共 ' + res.books.length + ' 本，本机现有 ' + this.data.books.length + ' 本，覆盖后本机将以云端为准。',
        confirmText: '恢复',
        success: (r) => {
          if (!r.confirm) {
            return;
          }
          paperbook.saveAll(res.books);
          this.reload();
          wx.showToast({ title: '已恢复', icon: 'success' });
        },
      });
    });
  },
});
