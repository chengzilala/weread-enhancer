/**
 * 微信悦读 · 笔记同步模块（v0.30.0 · 阶段十五-1 MVP）
 *
 * 定位：独立模块，不改动 notes.js / content.js 既有逻辑。通过 manifest 的 content_scripts
 * 在 content.js 之前加载，与 content.js 共享同一个隔离世界，可直接复用全局 log()。
 *
 * 职责（本期 MVP）：
 *   把「📝 笔记」面板已加载的数据（划线 / 想法），渲染成 **Obsidian 规格 Markdown** 并下载：
 *   frontmatter + 章节 H2 + 划线引用块 + 想法配对 + 稳定 block id（^wr-bk-* / ^wr-rv-*）。
 *
 * 与 notes.js 的边界（解耦）：
 *   notes.js 工具栏只新增一个按钮，点击后派发 document 自定义事件 `wre-notes-sync-export`
 *   （detail.data = 当前已加载且已按搜索过滤的数据）；本模块监听并接管渲染与下载，
 *   不读 notes.js 内部状态、不调用其内部函数。
 *
 * 落地方式：MVP 采用「下载 Markdown」——用户把浏览器下载目录设为 Obsidian vault 子目录，
 * 下载即入库；「Local REST API 直写」为后续阶段（见 plan/RPD_笔记同步_需求文档.md）。
 *
 * 隐私：全程本机生成，不向任何服务器发送数据；日志只记条数与开关，不记正文与 Key。
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'wreSyncNotes';
  const MODAL_ID = 'wre-sync-notes-modal';
  const DEFAULT_SETTINGS = { includeThoughts: true, includeTime: true };

  let settings = Object.assign({}, DEFAULT_SETTINGS);
  let settingsReady = false;
  let pendingData = null;
  let blockSeq = 0; // 无官方 id 时的 block id 兜底序号

  // ---------- 通用小工具 ----------

  function logSync(level, message, meta) {
    if (typeof log === 'function') {
      log(level, '[sync-notes] ' + message, meta);
    }
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function formatDateTime(timestamp) {
    const d = new Date(timestamp);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  // 正文里不适合换行与超长内容：压缩成单行（与现有导出风格一致）
  function oneLine(text) {
    return String(text == null ? '' : text).replace(/\s*\n+\s*/g, ' ').trim();
  }

  function sanitizeFileName(name) {
    return String(name || '').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || '未命名';
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function sourceLabel(data) {
    if (data.source === 'official') {
      return '微信读书官方网关（本机读取）';
    }
    if (data.source === 'api') {
      return '微信读书网页接口（本机读取）';
    }
    if (data.source === 'mixed') {
      return '接口 + 页面抓取（划线不完整）';
    }
    return '页面抓取（可能不完整）';
  }

  // ---------- 设置（chrome.storage.local 单键） ----------

  function loadSettings() {
    return new Promise((resolve) => {
      if (settingsReady) {
        resolve(settings);
        return;
      }
      try {
        chrome.storage.local.get(STORAGE_KEY, (res) => {
          const saved = res && res[STORAGE_KEY];
          settings = Object.assign({}, DEFAULT_SETTINGS, saved || {});
          settingsReady = true;
          resolve(settings);
        });
      } catch (error) {
        settingsReady = true;
        resolve(settings);
      }
    });
  }

  function saveSettings() {
    try {
      const payload = {};
      payload[STORAGE_KEY] = settings;
      chrome.storage.local.set(payload);
    } catch (error) {
      logSync('warn', '同步设置写入失败', { message: error && error.message ? String(error.message) : String(error) });
    }
  }

  // ---------- 数据层：按章节合并划线 / 想法 ----------

  function mergeGroups(data, includeThoughts) {
    const map = new Map();
    function ensure(key, name, order) {
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: name || '未知章节',
          order: (order == null ? Number.MAX_SAFE_INTEGER : order),
          highlights: [],
          thoughts: [],
        });
      }
      const group = map.get(key);
      if ((!group.name || group.name === '未知章节') && name) {
        group.name = name;
      }
      if (order != null && order < group.order) {
        group.order = order;
      }
      return group;
    }
    (data.highlightGroups || []).forEach((group) => {
      const target = ensure(group.key, group.name, group.order);
      target.highlights = target.highlights.concat(group.items || []);
    });
    if (includeThoughts) {
      (data.thoughtGroups || []).forEach((group) => {
        const target = ensure(group.key, group.name, group.order);
        target.thoughts = target.thoughts.concat(group.items || []);
      });
    }
    const groups = Array.from(map.values()).filter((g) => g.highlights.length > 0 || g.thoughts.length > 0);
    groups.sort((a, b) => a.order - b.order);
    // 兜底：数据没有分组信息但确有内容时，全部归到一个章节，避免丢内容
    if (groups.length === 0 && ((data.highlights || []).length > 0 || (includeThoughts && (data.thoughts || []).length > 0))) {
      groups.push({
        key: 'all',
        name: '全部',
        order: 0,
        highlights: data.highlights || [],
        thoughts: includeThoughts ? (data.thoughts || []) : [],
      });
    }
    return groups;
  }

  function blockId(prefix, id) {
    const safe = String(id == null ? '' : id).replace(/[^\w-]/g, '');
    if (safe) {
      return prefix + '-' + safe;
    }
    blockSeq += 1;
    return prefix + '-n' + blockSeq;
  }

  function isPaired(thought, highlight) {
    if (thought.range && highlight.range && String(thought.range) === String(highlight.range)) {
      return true;
    }
    if (thought.abstract && highlight.text && thought.abstract.trim() === highlight.text.trim()) {
      return true;
    }
    return false;
  }

  function renderThought(thought, withAbstract, includeTime) {
    const lines = [];
    if (withAbstract && thought.abstract) {
      lines.push('> ' + oneLine(thought.abstract));
    }
    lines.push('💭 ' + oneLine(thought.text) + ' ^' + blockId('wr-rv', thought.id));
    if (includeTime && thought.createTime) {
      lines.push('');
      lines.push('<small>' + formatDateTime(thought.createTime) + '</small>');
    }
    return lines.join('\n');
  }

  // ---------- Obsidian 规格 Markdown ----------

  function escapeYamlValue(text) {
    return '"' + String(text == null ? '' : text).replace(/"/g, '\\"') + '"';
  }

  function buildObsidianMarkdown(data) {
    const includeThoughts = settings.includeThoughts !== false;
    const includeTime = settings.includeTime !== false;
    blockSeq = 0;

    const groups = mergeGroups(data, includeThoughts);
    const body = [];
    let highlightCount = 0;
    let thoughtCount = 0;

    groups.forEach((group) => {
      body.push('## ' + group.name);
      body.push('');
      const used = new Set();
      group.highlights.forEach((highlight) => {
        highlightCount += 1;
        body.push('> ' + oneLine(highlight.text) + ' ^' + blockId('wr-bk', highlight.id));
        body.push('');
        group.thoughts.forEach((thought) => {
          if (used.has(thought) || !isPaired(thought, highlight)) {
            return;
          }
          used.add(thought);
          thoughtCount += 1;
          body.push(renderThought(thought, false, includeTime));
          body.push('');
        });
      });
      // 本章节里没能配到划线的想法（或仅有想法、无划线的章节）：单列在章节末尾
      group.thoughts.forEach((thought) => {
        if (used.has(thought)) {
          return;
        }
        used.add(thought);
        thoughtCount += 1;
        body.push(renderThought(thought, true, includeTime));
        body.push('');
      });
    });

    const head = [];
    head.push('---');
    head.push('type: weread-highlights');
    head.push('title: ' + escapeYamlValue('《' + (data.title || '未知书籍') + '》'));
    head.push('wereadId: ' + escapeYamlValue(data.bookId || ''));
    head.push('source: ' + escapeYamlValue(sourceLabel(data)));
    head.push('syncedAt: ' + escapeYamlValue(formatDateTime(Date.now())));
    head.push('highlights: ' + highlightCount);
    head.push('thoughts: ' + thoughtCount);
    head.push('tags: [读书笔记/微信读书]');
    head.push('---');
    head.push('');

    const top = [];
    top.push('# 《' + (data.title || '未知书籍') + '》读书笔记');
    top.push('');
    top.push('> 本文件由「微信悦读」生成，重复同步会**整篇覆盖**；请勿直接编辑。');
    top.push('> 需要批注时，请另建文件并用**块引用**指向本文件里的 `^wr-bk-*` / `^wr-rv-*`。');
    top.push('');

    return head.concat(top, body).join('\n');
  }

  function outputFileName(data) {
    return '《' + sanitizeFileName(data.title || '未知书籍') + '》.md';
  }

  // ---------- 同步弹层 ----------

  function renderModal() {
    const data = pendingData;
    const highlightCount = data ? (data.highlights || []).length : 0;
    const thoughtCount = data ? (data.thoughts || []).length : 0;
    return '<div class="wre-sync-overlay" data-wre-sync-overlay>' +
        '<div class="wre-sync-card" role="dialog" aria-label="同步到 Obsidian">' +
          '<div class="wre-sync-head">' +
            '<span>🔗 同步到 Obsidian</span>' +
            '<button class="wre-sync-close" data-wre-sync-close title="关闭">×</button>' +
          '</div>' +
          '<div class="wre-sync-body">' +
            '<div class="wre-sync-book">《' + escapeHtml(data && data.title || '未知书籍') + '》 · 划线 ' +
              highlightCount + ' 条 · 想法 ' + thoughtCount + ' 条</div>' +
            '<div class="wre-sync-source">数据来源：' + escapeHtml(data ? sourceLabel(data) : '') + '</div>' +
            '<label class="wre-sync-opt"><input type="checkbox" data-wre-sync-opt="includeThoughts"' +
              (settings.includeThoughts !== false ? ' checked' : '') + '> 包含想法 / 批注</label>' +
            '<label class="wre-sync-opt"><input type="checkbox" data-wre-sync-opt="includeTime"' +
              (settings.includeTime !== false ? ' checked' : '') + '> 包含时间戳</label>' +
            '<div class="wre-sync-tip">' +
              '将生成 <code>' + escapeHtml(data ? outputFileName(data) : '《书名》.md') + '</code>。<br>' +
              '把浏览器「下载目录」设为你的 Obsidian vault 子目录，下载即入库；也可下载后手动拖进 vault。' +
            '</div>' +
            '<div class="wre-sync-status" data-wre-sync-status></div>' +
          '</div>' +
          '<div class="wre-sync-foot">' +
            '<button class="wre-btn wre-btn-small" data-wre-sync-cancel>取消</button>' +
            '<button class="wre-btn wre-btn-small wre-btn-primary" data-wre-sync-generate>生成 Markdown</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function openModal(data) {
    pendingData = data;
    closeModal();
    const holder = document.createElement('div');
    holder.innerHTML = renderModal();
    const modal = holder.firstElementChild;
    modal.id = MODAL_ID;
    modal.addEventListener('click', onModalClick);
    modal.addEventListener('change', onModalChange);
    document.body.appendChild(modal);
    logSync('info', '打开同步弹层', {
      highlights: (data && data.highlights ? data.highlights.length : 0),
      thoughts: (data && data.thoughts ? data.thoughts.length : 0),
      source: data && data.source,
    });
  }

  function closeModal() {
    const modal = document.getElementById(MODAL_ID);
    if (modal) {
      modal.remove();
    }
  }

  function setStatus(text, isError) {
    const el = document.querySelector('#' + MODAL_ID + ' [data-wre-sync-status]');
    if (!el) {
      return;
    }
    el.textContent = text || '';
    el.classList.toggle('is-error', !!isError);
  }

  function onModalChange(event) {
    const input = event.target.closest('[data-wre-sync-opt]');
    if (!input) {
      return;
    }
    const key = input.getAttribute('data-wre-sync-opt');
    if (key === 'includeThoughts' || key === 'includeTime') {
      settings[key] = !!input.checked;
      saveSettings();
      logSync('info', '同步设置已更新', { key, value: settings[key] });
    }
  }

  function onModalClick(event) {
    if (event.target.closest('[data-wre-sync-overlay]') === event.target) {
      closeModal();
      return;
    }
    if (event.target.closest('[data-wre-sync-close]') || event.target.closest('[data-wre-sync-cancel]')) {
      closeModal();
      return;
    }
    if (event.target.closest('[data-wre-sync-generate]')) {
      handleGenerate();
    }
  }

  function handleGenerate() {
    const data = pendingData;
    if (!data) {
      setStatus('没有可同步的数据，请先刷新笔记。', true);
      return;
    }
    try {
      const markdown = buildObsidianMarkdown(data);
      const filename = outputFileName(data);
      downloadFile(filename, markdown, 'text/markdown;charset=utf-8');
      setStatus('✅ 已生成 ' + filename + '，检查浏览器下载即可。', false);
      logSync('info', '已生成 Obsidian 规格 Markdown', {
        file: filename,
        includeThoughts: settings.includeThoughts !== false,
        includeTime: settings.includeTime !== false,
        source: data.source,
        bytes: markdown.length,
      });
    } catch (error) {
      setStatus('生成失败：' + (error && error.message ? error.message : '未知错误'), true);
      logSync('error', '生成 Markdown 失败', { message: error && error.message ? String(error.message) : String(error) });
    }
  }

  // ---------- 入口：接收 notes.js 派发的解耦事件 ----------

  document.addEventListener('wre-notes-sync-export', (event) => {
    const data = event && event.detail ? event.detail.data : null;
    if (!data) {
      logSync('warn', '同步事件缺少数据，已忽略');
      return;
    }
    loadSettings().then(() => openModal(data));
  });

  // 启动时预热设置，避免首次点击时读存储造成延迟
  loadSettings();
})();
