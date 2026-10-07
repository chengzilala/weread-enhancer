/**
 * 我的纸书 — 纸质书归档 + 微信读书关联
 *
 * 四个视图（同一页面内切换，减少跳转）：
 *   list  —— 我的纸书列表（扫码入库 / 手动添加 / 搜索）
 *   edit  —— 单本详情 / 编辑（含「手动关联电子书」「去微信读书」「微信读书笔记」）
 *   link  —— 手动关联：搜微信读书 → 挑一本 → 绑定（M10）
 *   notes —— 关联电子版的笔记明细：划线 / 想法（M5）
 *
 * 分工：页面只负责交互；存储→paperbook-store，取数→paperbook-data，匹配决策→paperbook-core。
 * 红线：Key 只从 store 取、只经云函数中转；本页不打印 Key。
 */
const store = require('../../shared/store');
const pbStore = require('../../shared/paperbook-store');
const pbData = require('../../shared/paperbook-data');
const pbCore = require('../../shared/paperbook-core');

const ISBN_RE = /^\d{13}$/;
const SCAN_MAX_BYTES = 2 * 1024 * 1024; // 云调用识别限制：图片须小于 2M

Page({
  data: {
    hasKey: false,
    books: [],
    filtered: [],
    keyword: '',
    linkedCount: 0,

    view: 'list', // list | edit | link | notes

    editing: null,
    isNew: false,

    linkKeyword: '',
    linkResults: [],
    linkLoading: false,
    linkError: '',

    // M5：关联电子版的笔记
    noteLoading: false,
    noteCounts: null, // { ok, found, bookmarkCount, noteCount, reviewCount, total }
    noteItems: { marks: [], reviews: [] },
    noteItemsLoading: false,
    noteItemsError: '',
  },

  onShow() {
    this.setData({ hasKey: !!store.getKey() });
    this.reload();
  },

  reload() {
    const books = pbStore.listLocal();
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
    if (pbStore.findByIsbn(code)) {
      wx.showToast({ title: '这本已在你的书库', icon: 'none' });
      return;
    }
    const item = pbStore.addBook({ isbn: code, title: '' });
    pbStore.backupSilent();
    wx.showToast({ title: '已加入', icon: 'none', duration: 700 });
    this.reload();
    this.autoFill(item.id, code, '');
  },

  // ---- M2 拍照识码（旧书 / 条码磨损时，拍书背条码照片识别）----

  onPhotoScan() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) {
          return;
        }
        this.prepareAndScan(file.tempFilePath, file.size);
      },
      fail: (err) => {
        const msg = String((err && err.errMsg) || '');
        if (msg.indexOf('cancel') >= 0) {
          return;
        }
        wx.showToast({ title: '没有选择图片', icon: 'none' });
      },
    });
  },

  /** 超过 2M 先压缩，再交给云函数识别 */
  prepareAndScan(filePath, size) {
    const doScan = (path) => {
      wx.showLoading({ title: '识别中…', mask: true });
      pbData.scanImageCode(path).then((res) => {
        wx.hideLoading();
        if (!res.ok) {
          wx.showToast({ title: res.error || '没识别到条码', icon: 'none' });
          return;
        }
        const code = res.isbn || (res.codes || []).map((c) => c.data).filter((d) => ISBN_RE.test(d))[0] || '';
        if (!code) {
          wx.showModal({
            title: '没识别到图书条码',
            content: '把取景框对准书背的条形码再拍一张，或改用「手动添加」。',
            showCancel: false,
          });
          return;
        }
        this.handleScannedCode(code);
      });
    };

    if (size && size > SCAN_MAX_BYTES) {
      wx.compressImage({
        src: filePath,
        quality: 60,
        success: (r) => doScan(r.tempFilePath),
        fail: () => doScan(filePath),
      });
      return;
    }
    doScan(filePath);
  },

  /** M3 自动匹配：先 ISBN 后书名；命中只作「建议」，用户可改 */
  autoFill(id, isbn, title) {
    if (!this.data.hasKey) {
      return;
    }
    const key = store.getKey();
    pbCore.autoMatch(key, isbn, title).then((res) => {
      if (!res || !res.ok || !res.hit) {
        return;
      }
      const hit = res.hit;
      pbStore.updateBook(id, {
        title: hit.title || title || '',
        author: hit.author || '',
        cover: hit.cover || '',
        bookId: hit.bookId || '',
        deepLink: hit.deepLink || '',
        linkTitle: hit.title || '',
        linkManual: false,
      });
      pbStore.backupSilent();
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
      noteCounts: null,
      noteLoading: false,
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
    this.setData({
      view: 'edit',
      isNew: false,
      editing: Object.assign({}, book),
      noteCounts: null,
      noteLoading: false,
      noteItems: { marks: [], reviews: [] },
      noteItemsError: '',
    });
    if (book.bookId) {
      this.loadNoteCounts(book.bookId);
    }
  },

  onFieldInput(e) {
    const field = e.currentTarget.dataset.field;
    const editing = Object.assign({}, this.data.editing);
    editing[field] = e.detail.value;
    this.setData({ editing: editing });
  },

  onBackToList() {
    this.setData({ view: 'list', editing: null, noteCounts: null, noteItems: { marks: [], reviews: [] } });
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
      if (isbn && pbStore.findByIsbn(isbn)) {
        wx.showToast({ title: '该 ISBN 已在书库', icon: 'none' });
        return;
      }
      const item = pbStore.addBook({ isbn: isbn, title: title, author: author, cover: e.cover || '' });
      pbStore.backupSilent();
      wx.showToast({ title: '已加入书库', icon: 'success' });
      this.setData({ view: 'list', isNew: false, editing: null });
      this.reload();
      this.autoFill(item.id, isbn, title);
      return;
    }

    pbStore.updateBook(e.id, { isbn: isbn, title: title, author: author, cover: e.cover || '' });
    pbStore.backupSilent();
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
        pbStore.removeBook(e.id);
        pbStore.backupSilent();
        this.setData({ view: 'list', editing: null, noteCounts: null });
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
      editing = pbStore.addBook({
        isbn: String(editing.isbn || '').trim(),
        title: String(editing.title || '').trim(),
        author: String(editing.author || '').trim(),
        cover: editing.cover || '',
      });
      pbStore.backupSilent();
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
    pbData.searchStore(kw, store.getKey()).then((res) => {
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
    const updated = pbStore.updateBook(id, {
      bookId: hit.bookId || '',
      deepLink: hit.deepLink || '',
      linkTitle: hit.title || '',
      linkManual: true,
      cover: editing.cover || hit.cover || '',
      author: editing.author || hit.author || '',
      title: editing.title || hit.title || '',
    });
    pbStore.backupSilent();
    wx.showToast({ title: '已关联', icon: 'success' });
    this.setData({ view: 'edit', editing: updated || editing, noteCounts: null, noteItems: { marks: [], reviews: [] } });
    this.reload();
    if (updated && updated.bookId) {
      this.loadNoteCounts(updated.bookId);
    }
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
        const updated = pbStore.updateBook(editing.id, { bookId: '', deepLink: '', linkTitle: '', linkManual: false });
        pbStore.backupSilent();
        this.setData({ editing: updated || editing, noteCounts: null, noteItems: { marks: [], reviews: [] } });
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

  // ---- M5 微信读书笔记 ----

  /** 读该书在微信读书的笔记计数（含 30 分钟缓存，不额外发请求） */
  loadNoteCounts(bookId) {
    if (!this.data.hasKey || !bookId) {
      return;
    }
    const key = store.getKey();
    this.setData({ noteLoading: true, noteCounts: null });
    pbData.fetchBookNoteCounts(bookId, key).then((res) => {
      // 防串页：仅当仍停留在同一本书时才写入
      if (this.data.view !== 'edit' || !this.data.editing || this.data.editing.bookId !== bookId) {
        return;
      }
      this.setData({ noteLoading: false, noteCounts: res });
    });
  },

  /** 进入笔记明细视图 */
  onOpenNotes() {
    const editing = this.data.editing;
    if (!editing || !editing.bookId) {
      return;
    }
    if (!this.data.hasKey) {
      wx.showToast({ title: '请先配置 API Key', icon: 'none' });
      return;
    }
    this.setData({
      view: 'notes',
      noteItems: { marks: [], reviews: [] },
      noteItemsLoading: true,
      noteItemsError: '',
    });
    pbData.fetchBookNoteItems(editing.bookId, store.getKey()).then((res) => {
      if (this.data.view !== 'notes') {
        return;
      }
      if (!res || !res.ok) {
        this.setData({ noteItemsLoading: false, noteItemsError: (res && res.error) || '读取笔记失败' });
        return;
      }
      this.setData({ noteItemsLoading: false, noteItems: { marks: res.marks, reviews: res.reviews } });
    });
  },

  onNotesBack() {
    this.setData({ view: 'edit' });
  },

  // ---- 云端恢复 ----

  onRestore() {
    wx.showLoading({ title: '读取云端…' });
    pbStore.restoreFromCloud().then((res) => {
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
          pbStore.saveAll(res.books);
          this.reload();
          wx.showToast({ title: '已恢复', icon: 'success' });
        },
      });
    });
  },
});
