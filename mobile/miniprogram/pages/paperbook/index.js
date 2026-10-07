/**
 * 我的纸书 — 纸质书归档 + 微信读书关联
 *
 * 四个视图（同一页面内切换，减少跳转）：
 *   list  —— 我的纸书列表（扫码 / 拍照识码入库 / 手动添加 / 搜索 / 筛选 / 导出）
 *   edit  —— 单本详情 / 编辑（状态·标签·位置·我的感想 / 「手动关联电子书」「去微信读书」「微信读书笔记」）
 *   link  —— 手动关联：搜微信读书 → 挑一本 → 绑定（M10）
 *   notes —— 关联电子版的笔记明细：划线 / 想法（M5）
 *
 * 分工：页面只负责交互；存储→paperbook-store，取数→paperbook-data，匹配决策→paperbook-core，导出→paperbook-share。
 * 红线：Key 只从 store 取、只经云函数中转；本页不打印 Key。
 */
const store = require('../../shared/store');
const pbStore = require('../../shared/paperbook-store');
const pbData = require('../../shared/paperbook-data');
const pbCore = require('../../shared/paperbook-core');
const pbShare = require('../../shared/paperbook-share');

const ISBN_RE = /^\d{13}$/;
const SCAN_MAX_BYTES = 2 * 1024 * 1024; // 云调用识别限制：图片须小于 2M

/** 补齐旧数据缺失的字段，避免 WXML 里取 length 报错 */
function normalizeBook(book) {
  const b = Object.assign({}, book);
  if (!Array.isArray(b.tags)) {
    b.tags = [];
  }
  b.status = b.status || '';
  b.feeling = b.feeling || '';
  b.location = b.location || '';
  return b;
}

Page({
  data: {
    hasKey: false,
    books: [],
    filtered: [],
    keyword: '',
    filter: 'all', // all | linked | paper | read | reading | want
    linkedCount: 0,

    view: 'list', // list | edit | link | notes

    editing: null,
    isNew: false,
    tagInput: '',

    linkKeyword: '',
    linkResults: [],
    linkLoading: false,
    linkError: '',
    linkSearched: false,

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
    const f = this.data.filter;
    let list = this.data.books;
    if (kw) {
      list = list.filter(
        (b) =>
          String(b.title || '').toLowerCase().indexOf(kw) >= 0 ||
          String(b.author || '').toLowerCase().indexOf(kw) >= 0 ||
          String(b.isbn || '').indexOf(kw) >= 0 ||
          (b.tags || []).join(' ').toLowerCase().indexOf(kw) >= 0
      );
    }
    if (f === 'linked') {
      list = list.filter((b) => !!b.bookId);
    } else if (f === 'paper') {
      list = list.filter((b) => !b.bookId);
    } else if (f === 'read' || f === 'reading' || f === 'want') {
      list = list.filter((b) => b.status === f);
    }
    this.setData({ filtered: list });
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
    this.applyFilter();
  },

  onFilter(e) {
    const value = e.currentTarget.dataset.value || 'all';
    this.setData({ filter: value });
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
        this.handleScannedCode(String((res && res.result) || '').trim()).then((r) => {
          const status = r.status;
          if (status === 'added' || status === 'duplicate' || status === 'empty') {
            // 只有「真的入库了」才自动续扫；留点时间让提示能看清
            setTimeout(() => this.scanNext(), status === 'added' ? 500 : 900);
            return;
          }
          if (status === 'nomatch') {
            // 入库了、但微信读书按 ISBN 没匹配上 → 停下连续扫，直接打开「挑一本」
            this.openLinkPicker(r.id);
            return;
          }
          // 扫到的不是图书 ISBN（或没扫清）→ 停下来让用户决定，避免摄像头反复开关
          wx.showModal({
            title: status === 'notisbn' ? '这不是图书条码' : '条码没扫清',
            content:
              status === 'notisbn'
                ? '这是书上的其它条码。请对准封底/书背带 978 或 979 的那条 ISBN 条码；也可改用「手动添加」。'
                : '再对准一点、让条码占满取景框，重扫一次；也可改用「手动添加」。',
            confirmText: '再扫一次',
            cancelText: '手动添加',
            success: (r) => {
              if (r.confirm) {
                this.scanNext();
              } else {
                this.onAddManual();
              }
            },
          });
        });
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

  /**
   * 处理扫到/识别到的码：校验 → 入库 → 尝试自动匹配。
   * → Promise<{ status, id? }>
   *   status：'empty' | 'notisbn' | 'unclear' | 'duplicate'
   *         | 'added'（已入库且匹配上，或未配 Key 无从匹配）
   *         | 'nomatch'（已入库但微信读书没匹配上）
   */
  handleScannedCode(code) {
    const value = String(code || '').trim();
    if (!value) {
      return Promise.resolve({ status: 'empty' });
    }
    if (!pbCore.isIsbnBarcode(value)) {
      return Promise.resolve({ status: /^97[89]\d{10}$/.test(value) ? 'unclear' : 'notisbn' });
    }
    // A 记忆式：这个 ISBN 之前关联过 → 直接复用，零操作
    const memory = pbStore.getIsbnMemory(value);
    const existing = pbStore.findByIsbn(value);
    if (existing) {
      if (!existing.bookId && memory) {
        this.applyRememberedLink(existing.id, memory);
        wx.showToast({ title: '已按记忆关联《' + (memory.title || '') + '》', icon: 'none', duration: 900 });
        return Promise.resolve({ status: 'added', id: existing.id });
      }
      wx.showToast({ title: '这本已在你的书库', icon: 'none' });
      return Promise.resolve({ status: 'duplicate' });
    }
    const item = pbStore.addBook({ isbn: value, title: memory ? memory.title || '' : '' });
    pbStore.backupSilent();
    if (memory) {
      this.applyRememberedLink(item.id, memory);
      wx.showToast({ title: '已按记忆关联《' + (memory.title || '') + '》', icon: 'none', duration: 900 });
      return Promise.resolve({ status: 'added', id: item.id });
    }
    wx.showToast({ title: '已加入', icon: 'success', duration: 700 });
    this.reload();
    if (!this.data.hasKey) {
      // 未配 Key：先入库，配置后可手动关联
      return Promise.resolve({ status: 'added', id: item.id });
    }
    return this.autoFill(item.id, value, '').then((matched) => ({
      status: matched ? 'added' : 'nomatch',
      id: item.id,
    }));
  },

  /** 按「记忆」回填并关联（不再走搜索） */
  applyRememberedLink(id, memory) {
    pbStore.updateBook(id, {
      title: memory.title || '',
      author: memory.author || '',
      cover: memory.cover || '',
      bookId: memory.bookId || '',
      deepLink: memory.deepLink || '',
      linkTitle: memory.title || '',
      linkManual: false,
    });
    pbStore.backupSilent();
    this.reload();
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
        const code = res.isbn || (res.codes || []).map((c) => c.data).filter((d) => pbCore.isIsbnBarcode(d))[0] || '';
        if (!code) {
          wx.showModal({
            title: '没识别到图书条码',
            content: '把取景框对准书背的条形码再拍一张，或改用「手动添加」。',
            showCancel: false,
          });
          return;
        }
        this.handleScannedCode(code).then((r) => {
          if (r.status === 'nomatch') {
            this.openLinkPicker(r.id);
          }
        });
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

  /** M3 自动匹配：只在 ISBN 完全一致（或书名对得上）时回填；→ Promise<boolean> 是否命中 */
  autoFill(id, isbn, title) {
    if (!this.data.hasKey) {
      return Promise.resolve(false);
    }
    const key = store.getKey();
    return pbCore.autoMatch(key, isbn, title).then((res) => {
      if (!res || !res.ok || !res.hit) {
        return false;
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
      pbStore.rememberIsbn(isbn, hit); // A：记住这次关联，同 ISBN 再扫零操作
      pbStore.backupSilent();
      this.reload();
      if (this.data.view === 'edit' && this.data.editing && this.data.editing.id === id) {
        this.openEdit({ currentTarget: { dataset: { id: id } } });
      }
      return true;
    });
  },

  /** 扫到但没匹配上 → 直接打开「挑一本」，让用户输书名搜（微信读书不认 ISBN，故不预填 ISBN） */
  openLinkPicker(id) {
    const book = pbStore.listLocal().filter((b) => b.id === id)[0];
    if (!book) {
      return;
    }
    this.setData({
      view: 'link',
      isNew: false,
      editing: normalizeBook(book),
      tagInput: '',
      noteCounts: null,
      noteLoading: false,
      noteItems: { marks: [], reviews: [] },
      noteItemsError: '',
      linkKeyword: '',
      linkResults: [],
      linkError: '',
      linkLoading: false,
      linkSearched: false,
    });
  },

  // ---- 手动添加 ----

  onAddManual() {
    this.setData({
      view: 'edit',
      isNew: true,
      editing: {
        id: '',
        isbn: '',
        title: '',
        author: '',
        cover: '',
        bookId: '',
        deepLink: '',
        linkTitle: '',
        linkManual: false,
        status: '',
        tags: [],
        feeling: '',
        location: '',
      },
      tagInput: '',
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
      editing: normalizeBook(book),
      tagInput: '',
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
    const basic = {
      isbn: isbn,
      title: title,
      author: author,
      cover: e.cover || '',
      status: e.status || '',
      tags: Array.isArray(e.tags) ? e.tags : [],
      feeling: String(e.feeling || ''),
      location: String(e.location || '').trim(),
    };

    if (this.data.isNew) {
      if (isbn && pbStore.findByIsbn(isbn)) {
        wx.showToast({ title: '该 ISBN 已在书库', icon: 'none' });
        return;
      }
      const item = pbStore.addBook(basic);
      pbStore.backupSilent();
      wx.showToast({ title: '已加入书库', icon: 'success' });
      this.setData({ view: 'list', isNew: false, editing: null });
      this.reload();
      this.autoFill(item.id, isbn, title);
      return;
    }

    pbStore.updateBook(e.id, basic);
    pbStore.backupSilent();
    wx.showToast({ title: '已保存', icon: 'success' });
    this.setData({ view: 'list', editing: null });
    this.reload();
  },

  // ---- M7 阅读状态 / 标签 ----

  onStatusPick(e) {
    const status = e.currentTarget.dataset.value || '';
    const editing = Object.assign({}, this.data.editing);
    editing.status = editing.status === status ? '' : status; // 再点一次取消
    this.setData({ editing: editing });
  },

  onTagInput(e) {
    this.setData({ tagInput: e.detail.value });
  },

  onTagAdd() {
    const text = String(this.data.tagInput || '').trim();
    if (!text) {
      return;
    }
    const editing = Object.assign({}, this.data.editing);
    const tags = Array.isArray(editing.tags) ? editing.tags.slice() : [];
    if (tags.indexOf(text) >= 0) {
      this.setData({ tagInput: '' });
      return;
    }
    if (tags.length >= 10) {
      wx.showToast({ title: '标签最多 10 个', icon: 'none' });
      return;
    }
    tags.push(text);
    editing.tags = tags;
    this.setData({ editing: editing, tagInput: '' });
  },

  onTagRemove(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const editing = Object.assign({}, this.data.editing);
    const tags = Array.isArray(editing.tags) ? editing.tags.slice() : [];
    tags.splice(idx, 1);
    editing.tags = tags;
    this.setData({ editing: editing });
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
    // 微信读书只认书名/作者、不认 ISBN：拿 ISBN 去搜只会搜出无关书，故不预填 ISBN、不按 ISBN 搜
    const kw = editing.title || '';
    this.setData({ view: 'link', linkKeyword: kw, linkResults: [], linkError: '', linkLoading: false, linkSearched: false });
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
    this.setData({ linkLoading: true, linkError: '', linkSearched: true, linkResults: [] });
    const key = store.getKey();
    // B：先查「我的书架」（失败不阻塞，退回纯全站搜索）
    Promise.all([
      pbData.fetchShelfBooks(key).catch(() => ({ ok: false, books: [] })),
      pbData.searchStore(kw, key),
    ]).then((results) => {
      const shelfRes = (results && results[0]) || {};
      const searchRes = (results && results[1]) || {};
      const shelfHits = pbCore.matchInShelf(kw, shelfRes.ok ? shelfRes.books : []);
      if (!searchRes.ok && !shelfHits.length) {
        this.setData({ linkLoading: false, linkResults: [], linkError: searchRes.error || '搜索失败，请重试' });
        return;
      }
      // 书架命中置顶（标「在我的书架」），全站结果补充、按 bookId 去重
      const seen = {};
      const merged = [];
      shelfHits.forEach((it) => {
        const k = it.bookId || it.title;
        if (k && !seen[k]) {
          seen[k] = true;
          merged.push(it);
        }
      });
      (searchRes.items || []).forEach((it) => {
        const k = it.bookId || it.title;
        if (k && seen[k]) {
          return;
        }
        if (k) {
          seen[k] = true;
        }
        merged.push(it);
      });
      this.setData({ linkLoading: false, linkResults: merged, linkError: '' });
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
    // A：记住这次「ISBN → 电子版」关联，同 ISBN 再扫零操作
    pbStore.rememberIsbn(editing.isbn, hit);
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

  // ---- M8 导出备份 ----

  onExport() {
    if (!this.data.books.length) {
      wx.showToast({ title: '书库还是空的', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '生成中…', mask: true });
    pbShare.exportMarkdown(this.data.books).then((res) => {
      wx.hideLoading();
      if (!res.ok) {
        wx.showToast({ title: res.error || '导出失败', icon: 'none' });
      }
    });
  },

  onExportCopy() {
    if (!this.data.books.length) {
      wx.showToast({ title: '书库还是空的', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: pbShare.toMarkdown(this.data.books),
      fail: () => wx.showToast({ title: '复制失败', icon: 'none' }),
    });
  },
});
