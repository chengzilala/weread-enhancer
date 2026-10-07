/**
 * 微信悦读 · 数据备份与恢复（v0.25.0）
 *
 * 定位：插件有多个功能各自往 chrome.storage.local 存数据，其中「标签 / 阅读统计」
 *   是本机唯一副本——卸载扩展 / 清浏览器数据 / 换电脑即永久丢失。
 *   本模块提供一个「🗄️ 数据备份」统一入口，把 A 类用户数据汇总到一处，
 *   一键导出为本地 JSON，并可再导入恢复（合并 / 覆盖）。
 *
 * 红线：
 *   - 纯本机 chrome.storage.local 读写，**不联网、不新增权限**；
 *   - 导出文件**绝不含任何 Key / 匿名身份标识**（B 类缓存与 C 类密钥一律不纳入）；
 *   - 下载沿用 finder.js 同款 `Blob + URL.createObjectURL + <a download>`，不引入 downloads 权限。
 *
 * 复用 content.js 的全局 log() 与 #we-read-enhancer-root 容器；
 * 旧代码不动：本模块只新增文件，content.js 仅多一处 case 'backup' 分流。
 */
(function () {
  'use strict';

  const APP_ID = 'weread-enhancer';
  const SCHEMA_VERSION = 1;
  const BACKUP_FILE_PREFIX = '微信悦读-数据备份-';

  /**
   * A 类用户数据登记表（汇总口径的唯一事实来源）。
   * 未来新模块只需在此登记一个键，即自动纳入一览 / 导出 / 恢复。
   * 详见 RPD 第 15 章「数据清单与分类」。
   */
  const ITEMS = [
    { key: 'wreBookTags',          label: '找书标签',     kind: 'tags' },
    { key: 'wreReadingStats',      label: '阅读统计',     kind: 'stats' },
    { key: 'wreState',             label: '插件设置',     kind: 'state' },
    { key: 'wreOnboardingVersion', label: '新手引导版本', kind: 'onboarding' },
  ];

  // ---------- 状态 ----------

  let root = null;
  let message = '';          // 面板内一次性提示
  let needReload = false;    // 导入设置 / 统计后，提示刷新页面以加载最新数据
  let itemsInfo = [];        // 当前「本机数据一览」的展示项

  // ---------- 通用小工具 ----------

  function logBackup(level, msg, meta) {
    if (typeof log === 'function') {
      log(level, '[backup] ' + msg, meta);
    }
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function appVersion() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
        return chrome.runtime.getManifest().version || '';
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  function formatDateTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function formatHours(ms) {
    const hours = (ms || 0) / 3600000;
    if (hours >= 100) return Math.round(hours) + ' 小时';
    if (hours >= 1) return (Math.round(hours * 10) / 10) + ' 小时';
    return Math.round((ms || 0) / 60000) + ' 分钟';
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------- 存储读写 ----------

  async function readAll() {
    const keys = ITEMS.map((it) => it.key);
    try {
      const result = await chrome.storage.local.get(keys);
      return result || {};
    } catch (e) {
      logBackup('error', '读取本机数据失败', { error: String((e && e.message) || e) });
      return {};
    }
  }

  async function writeAll(data) {
    const payload = {};
    ITEMS.forEach((it) => {
      if (data && data[it.key] !== undefined && data[it.key] !== null) {
        payload[it.key] = data[it.key];
      }
    });
    await chrome.storage.local.set(payload);
  }

  async function clearAll() {
    await chrome.storage.local.remove(ITEMS.map((it) => it.key));
  }

  // ---------- 数据一览 ----------

  function describe(raw) {
    return ITEMS.map((it) => {
      const value = raw ? raw[it.key] : undefined;
      const info = { key: it.key, label: it.label, exist: value !== undefined && value !== null, summary: '' };
      if (!info.exist) {
        info.summary = '暂无';
        return info;
      }
      if (it.kind === 'tags') {
        const wrap = value && typeof value === 'object' ? value : {};
        const map = wrap.map && typeof wrap.map === 'object' ? wrap.map : {};
        const books = Object.keys(map);
        let latest = wrap.updatedAt || 0;
        books.forEach((k) => {
          const entry = map[k] || {};
          if ((entry.updatedAt || 0) > latest) latest = entry.updatedAt || 0;
        });
        info.summary = books.length
          ? (books.length + ' 本' + (latest ? ' · 更新于 ' + formatDateTime(latest) : ''))
          : '暂无';
        info.exist = books.length > 0;
      } else if (it.kind === 'stats') {
        const s = value && typeof value === 'object' ? value : {};
        const books = s.books && typeof s.books === 'object' ? s.books : {};
        let totalMs = 0;
        const daySet = {};
        Object.keys(books).forEach((k) => {
          const b = books[k] || {};
          totalMs += b.totalMs || 0;
          Object.keys(b.days || {}).forEach((d) => { daySet[d] = true; });
        });
        const dayCount = Object.keys(daySet).length;
        info.summary = totalMs > 0
          ? ('累计 ' + formatHours(totalMs) + ' · 明细 ' + dayCount + ' 天')
          : '暂无';
        info.exist = totalMs > 0;
      } else if (it.kind === 'state') {
        info.summary = '已保存';
      } else if (it.kind === 'onboarding') {
        info.summary = String(value);
      }
      return info;
    });
  }

  // ---------- 导出 ----------

  function buildExportObject(raw) {
    const data = {};
    ITEMS.forEach((it) => {
      if (raw && raw[it.key] !== undefined && raw[it.key] !== null) {
        data[it.key] = raw[it.key];
      }
    });
    return {
      app: APP_ID,
      schemaVersion: SCHEMA_VERSION,
      appVersion: appVersion(),
      exportedAt: new Date().toISOString(),
      data: data,
    };
  }

  async function exportBackup() {
    try {
      const raw = await readAll();
      const payload = buildExportObject(raw);
      const present = describe(raw).filter((it) => it.exist).length;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date();
      a.href = url;
      a.download = BACKUP_FILE_PREFIX +
        stamp.getFullYear() + pad2(stamp.getMonth() + 1) + pad2(stamp.getDate()) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const missing = ITEMS.length - present;
      message = present
        ? ('已导出数据备份（含 ' + present + ' 项数据）')
        : ('已导出空备份：暂无可备份的数据项（' + missing + ' 项均为空）');
      logBackup('info', '导出数据备份', { present, total: ITEMS.length });
    } catch (e) {
      message = '导出失败：' + ((e && e.message) || '未知错误');
      logBackup('warn', '导出数据备份失败', { error: String((e && e.message) || e) });
    }
    await refresh();
  }

  // ---------- 合并逻辑 ----------

  // 语义化版本比较：a>b 返回 1，a<b 返回 -1，相等返回 0（引导版本为字符串 "0.25.0"）
  function compareVersion(a, b) {
    const pa = String(a == null ? '' : a).split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b == null ? '' : b).split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i += 1) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  }

  function maxVersion(a, b) {
    if (a == null && b == null) return undefined;
    if (a == null) return b;
    if (b == null) return a;
    return compareVersion(a, b) >= 0 ? a : b;
  }

  function mergeTags(local, incoming) {
    const localWrap = local && typeof local === 'object' ? local : {};
    const incWrap = incoming && typeof incoming === 'object' ? incoming : {};
    const localMap = localWrap.map && typeof localWrap.map === 'object' ? localWrap.map : {};
    const incMap = incWrap.map && typeof incWrap.map === 'object' ? incWrap.map : {};
    const nextMap = Object.assign({}, localMap);
    Object.keys(incMap).forEach((key) => {
      const raw = incMap[key] || {};
      const tags = Array.isArray(raw.tags) ? raw.tags.filter(Boolean) : [];
      const existing = nextMap[key] || { title: '', author: '', tags: [], updatedAt: 0 };
      tags.forEach((t) => {
        if (existing.tags.indexOf(t) < 0) existing.tags.push(t);
      });
      existing.title = raw.title || existing.title || '';
      existing.author = raw.author || existing.author || '';
      existing.updatedAt = Date.now();
      if (existing.tags.length) {
        nextMap[key] = existing;
      }
    });
    return {
      schemaVersion: localWrap.schemaVersion || incWrap.schemaVersion || 1,
      updatedAt: Date.now(),
      map: nextMap,
    };
  }

  function pickProgress(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    const pa = a.percent != null ? a.percent : -1;
    const pb = b.percent != null ? b.percent : -1;
    if (pb > pa) return b;
    if (pa > pb) return a;
    return (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
  }

  function mergeStats(local, incoming) {
    const base = local && typeof local === 'object' ? local : {};
    const inc = incoming && typeof incoming === 'object' ? incoming : {};
    const next = {
      version: Math.max(base.version || 0, inc.version || 0) || 2,
      books: Object.assign({}, base.books && typeof base.books === 'object' ? base.books : {}),
      updatedAt: Date.now(),
    };
    Object.keys(inc.books || {}).forEach((key) => {
      const inBook = inc.books[key] || {};
      const existing = next.books[key] || { title: '', bookId: '', totalMs: 0, lastReadAt: 0, days: {} };
      const days = existing.days && typeof existing.days === 'object' ? existing.days : {};
      Object.keys(inBook.days || {}).forEach((d) => {
        days[d] = (days[d] || 0) + (inBook.days[d] || 0);
      });
      existing.days = days;
      existing.totalMs = (existing.totalMs || 0) + (inBook.totalMs || 0);
      existing.lastReadAt = Math.max(existing.lastReadAt || 0, inBook.lastReadAt || 0);
      existing.title = existing.title || inBook.title || key;
      existing.bookId = existing.bookId || inBook.bookId || '';
      existing.progress = pickProgress(existing.progress, inBook.progress);
      next.books[key] = existing;
    });
    return next;
  }

  function mergeState(local, incoming) {
    const next = Object.assign({}, local && typeof local === 'object' ? local : {});
    Object.keys(incoming || {}).forEach((key) => {
      const value = incoming[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        next[key] = Object.assign({}, local && local[key] ? local[key] : {}, value);
      } else {
        next[key] = value;
      }
    });
    return next;
  }

  function mergeAll(local, incoming) {
    return {
      wreBookTags: mergeTags(local.wreBookTags, incoming.wreBookTags),
      wreReadingStats: mergeStats(local.wreReadingStats, incoming.wreReadingStats),
      wreState: mergeState(local.wreState, incoming.wreState),
      wreOnboardingVersion: maxVersion(local.wreOnboardingVersion, incoming.wreOnboardingVersion),
    };
  }

  // ---------- 导入 ----------

  async function importFromFile(file, mode) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || parsed.app !== APP_ID) {
        message = '导入失败：这不是本插件导出的备份文件（文件头缺少 app 标识）。';
        render();
        return;
      }
      if (parsed.schemaVersion == null) {
        message = '导入失败：备份文件缺少 schemaVersion，无法确认格式。';
        render();
        return;
      }
      const incoming = parsed.data && typeof parsed.data === 'object' ? parsed.data : {};
      if (mode === 'overwrite') {
        await clearAll();
        await writeAll(incoming);
      } else {
        const local = await readAll();
        await writeAll(mergeAll(local, incoming));
      }
      const present = describe(incoming).filter((it) => it.exist).length;
      message = (mode === 'overwrite' ? '已覆盖恢复：' : '已合并恢复：') + present + ' 项数据' +
        '（来源 v' + (parsed.appVersion || '?') + '）';
      needReload = true;
      logBackup('info', '导入数据备份', { mode, present });
    } catch (e) {
      message = '导入失败：' + ((e && e.message) || '文件无法解析') + '。请确认是本插件导出的 JSON 文件。';
      logBackup('warn', '导入数据备份失败', { error: String((e && e.message) || e) });
    }
    await refresh();
  }

  function triggerImport(mode) {
    const input = root ? root.querySelector('#wre-backup-import-input') : null;
    if (!input) return;
    input.setAttribute('data-mode', mode);
    input.value = '';
    input.click();
  }

  // ---------- 清空 ----------

  async function clearUserData() {
    try {
      await clearAll();
      message = '已清空本机用户数据（标签 / 阅读统计 / 设置 / 引导版本）。此操作不可撤销。';
      needReload = true;
      logBackup('warn', '清空本机用户数据');
    } catch (e) {
      message = '清空失败：' + ((e && e.message) || '未知错误');
      logBackup('warn', '清空本机用户数据失败', { error: String((e && e.message) || e) });
    }
    await refresh();
  }

  // ---------- 面板 ----------

  function buildItemRows() {
    return itemsInfo.map((it) => {
      const cls = it.exist ? 'wre-backup-item' : 'wre-backup-item is-empty';
      return '<div class="' + cls + '">' +
        '<span class="wre-backup-item-label">' + escapeHtml(it.label) + '</span>' +
        '<span class="wre-backup-item-value">' + escapeHtml(it.summary) + '</span>' +
        '</div>';
    }).join('');
  }

  function buildBodyHtml() {
    return '<div class="wre-backup-tip">' +
        '这些数据只存本机。换电脑 / 清浏览器缓存前，记得先备份，否则会永久丢失。' +
      '</div>' +
      '<div class="wre-backup-section-title">本机数据一览</div>' +
      '<div class="wre-backup-list">' + buildItemRows() + '</div>' +
      (message ? '<div class="wre-backup-message">' + escapeHtml(message) + '</div>' : '') +
      (needReload
        ? '<div class="wre-backup-reload"><button type="button" class="wre-btn wre-btn-small" data-wre-backup-reload="1">🔄 刷新页面以加载最新数据</button></div>'
        : '') +
      '<div class="wre-backup-actions">' +
        '<button type="button" class="wre-btn wre-btn-small" data-wre-backup-export="1">⬇️ 导出备份</button>' +
        '<button type="button" class="wre-btn wre-btn-small" data-wre-backup-import-merge="1">⬆️ 导入（合并）</button>' +
        '<button type="button" class="wre-btn wre-btn-small" data-wre-backup-import-replace="1">⬆️ 导入（覆盖）</button>' +
      '</div>' +
      '<div class="wre-backup-clear">' +
        '<button type="button" class="wre-btn wre-btn-small wre-btn-danger" data-wre-backup-clear="1">🗑️ 清空本机用户数据</button>' +
        '<span class="wre-backup-clear-tip">（等同重置插件数据，需二次确认）</span>' +
      '</div>' +
      '<div class="wre-backup-foot">' +
        '🔐 出于安全，备份文件<b>不含</b>任何 API Key，换设备请重新粘贴一次。' +
      '</div>' +
      '<input type="file" id="wre-backup-import-input" accept="application/json,.json" style="display:none">';
  }

  function render() {
    if (!root) return;
    const body = root.querySelector('#wre-backup-body');
    if (body) body.innerHTML = buildBodyHtml();
  }

  async function refresh() {
    const raw = await readAll();
    itemsInfo = describe(raw);
    render();
  }

  function buildPanel() {
    const existing = root.querySelector('#wre-backup-modal');
    if (existing) return existing;
    const overlay = document.createElement('div');
    overlay.className = 'wre-modal-overlay';
    overlay.id = 'wre-backup-modal';
    overlay.innerHTML =
      '<div class="wre-modal wre-backup-modal">' +
        '<div class="wre-modal-header">' +
          '<span class="wre-modal-title">🗄️ 数据备份</span>' +
          '<button class="wre-modal-close" data-wre-backup-close>&times;</button>' +
        '</div>' +
        '<div class="wre-modal-body" id="wre-backup-body"></div>' +
      '</div>';

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closePanel();
    });
    const closeBtn = overlay.querySelector('[data-wre-backup-close]');
    if (closeBtn) closeBtn.addEventListener('click', () => closePanel());

    overlay.addEventListener('click', (event) => {
      const target = event.target;
      if (target.closest('[data-wre-backup-export]')) {
        exportBackup();
      } else if (target.closest('[data-wre-backup-import-merge]')) {
        triggerImport('merge');
      } else if (target.closest('[data-wre-backup-import-replace]')) {
        triggerImport('overwrite');
      } else if (target.closest('[data-wre-backup-reload]')) {
        window.location.reload();
      } else if (target.closest('[data-wre-backup-clear]')) {
        const ok = window.confirm('确定要清空本机的标签、阅读统计、设置与引导版本吗？此操作不可撤销，建议先导出备份。');
        if (ok) clearUserData();
      }
    });

    overlay.addEventListener('change', (event) => {
      const input = event.target;
      if (input && input.id === 'wre-backup-import-input' && input.files && input.files[0]) {
        const mode = input.getAttribute('data-mode') || 'merge';
        importFromFile(input.files[0], mode);
      }
    });

    root.appendChild(overlay);
    return overlay;
  }

  function openPanel() {
    root = document.getElementById('we-read-enhancer-root');
    if (!root) return;
    const overlay = buildPanel();
    message = '';
    needReload = false;
    overlay.classList.add('wre-visible');
    refresh();
    logBackup('info', '打开数据备份面板');
  }

  function closePanel() {
    const overlay = root ? root.querySelector('#wre-backup-modal') : document.getElementById('wre-backup-modal');
    if (overlay) overlay.classList.remove('wre-visible');
  }

  // ---------- 菜单入口 ----------

  function injectMenuEntry(rootEl) {
    const menu = rootEl.querySelector('#wre-main-menu');
    if (!menu || menu.querySelector('[data-wre-backup-entry]')) {
      return;
    }
    const item = document.createElement('div');
    item.className = 'wre-menu-item';
    item.setAttribute('data-action', 'backup');
    item.setAttribute('data-wre-backup-entry', '1');
    item.title = '把本机数据汇总导出到本地，可再导入恢复';
    item.innerHTML = '<span class="wre-menu-icon">🗄️</span>数据备份';
    item.addEventListener('click', () => openPanel());
    // 置于「设置」分组，紧邻「阅读设置 / 调试日志」，放在「恢复默认设置」之前
    const anchor = menu.querySelector('[data-action="debug-logs"]');
    if (anchor && anchor.nextSibling) {
      menu.insertBefore(item, anchor.nextSibling);
    } else if (anchor) {
      menu.appendChild(item);
    } else {
      menu.appendChild(item);
    }
    logBackup('info', '已注入「数据备份」菜单入口');
  }

  // ---------- 启动 ----------

  function bootstrap() {
    const existing = document.getElementById('we-read-enhancer-root');
    if (existing) {
      injectMenuEntry(existing);
      return;
    }
    const observer = new MutationObserver(() => {
      const rootEl = document.getElementById('we-read-enhancer-root');
      if (rootEl) {
        observer.disconnect();
        injectMenuEntry(rootEl);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    logBackup('debug', '等待插件根容器出现后接入数据备份模块');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
