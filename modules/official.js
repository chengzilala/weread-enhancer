/**
 * 微信悦读 · 官方数据模块（v0.11.0）
 *
 * 定位：独立模块，不改动 content.js 与既有模块逻辑。经 manifest 的 content_scripts
 * 在 content.js 之前加载，与 content.js 共享隔离世界，可复用其全局 log() 与
 * #we-read-enhancer-root 容器。
 *
 * 职责（阶段十三 V1）：
 *   1. 主菜单「☁️ 官方数据」入口
 *   2. 面板：📊 阅读行为报告（时长与天数趋势 / 周期切换 / 环比 / 导出 Markdown）
 *   3. 面板：⚙️ 设置（用户粘贴自己的 wrk- API Key，保存即校验 / 清除）
 *
 * 数据来源：微信读书官方 Agent Skill 网关（经 background.js 转发）。
 * 隐私口径：Key 只存本机 chrome.storage.local；报告在本机生成，数据不上传。
 * 口径红线：官方所有时长字段单位是秒（严禁当分钟/小时）；Unix 时间戳展示转日期；
 *           分桶时间戳按「中国时区」取日期（网关按中国零点分桶但编码成 UTC 秒，
 *           直接按 UTC 或浏览器本地时区换算都会差一天）。
 */
(function () {
  'use strict';

  const CACHE_KEY = 'wreOfficialReportCache';
  const CACHE_TTL_MS = 10 * 60 * 1000;   // 报告缓存有效期：10 分钟
  const CST_OFFSET_MS = 8 * 3600 * 1000; // 官方分桶时间戳是「中国时区零点」的 UTC 秒，展示需 +8h
  const MODES = [
    { key: 'weekly', label: '本周' },
    { key: 'monthly', label: '本月' },
    { key: 'annually', label: '本年' },
    { key: 'overall', label: '累计' },
  ];

  let activeTab = 'report';
  let mode = 'monthly';
  let report = null;        // 当前展示的报告数据
  let reportState = 'idle'; // idle | loading | ok | error
  let reportError = '';
  let reportFromCache = false;
  let reportAt = 0;
  let upgradeInfo = null;
  let keyStatus = { hasKey: false, savedAt: 0, lastVerifiedAt: 0, skillVersion: '' };
  let settingsMessage = '';

  // ---------- 通用小工具 ----------

  function logOfficial(level, message, meta) {
    if (typeof log === 'function') {
      log(level, '[official] ' + message, meta);
    }
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  /** 官方分桶时间戳 → 中国时区的 年/月/日
   *  实测：网关按「中国时区零点」分桶，但编码成 UTC 秒（例如 1790524800 是
   *  2026-09-27 16:00 UTC = 2026-09-28 00:00 中国时间）。因此必须固定 +8h 再取
   *  UTC 年月日，不能直接按 UTC 或按浏览器本地时区换算（否则日期会差一天）。 */
  function bucketParts(seconds) {
    const date = new Date(Number(seconds) * 1000 + CST_OFFSET_MS);
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    };
  }

  function fmtDateTime(timestamp) {
    if (!timestamp) {
      return '—';
    }
    const date = new Date(timestamp);
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) +
      ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
  }

  /** 官方时长字段单位是秒，这里统一转成中文可读文案 */
  function fmtDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    if (total < 60) {
      return total > 0 ? '不足 1 分钟' : '0 分钟';
    }
    const hours = Math.floor(total / 3600);
    const minutes = Math.round((total % 3600) / 60);
    if (hours <= 0) {
      return minutes + ' 分钟';
    }
    return minutes > 0 ? hours + ' 小时 ' + minutes + ' 分钟' : hours + ' 小时';
  }

  /** 分桶 key（秒）→ 展示标签 */
  function fmtBucketLabel(seconds, currentMode) {
    const part = bucketParts(seconds);
    if (currentMode === 'overall') {
      return part.year + ' 年';
    }
    if (currentMode === 'annually') {
      return part.month + ' 月';
    }
    return part.month + ' 月 ' + part.day + ' 日';
  }

  function fmtCompare(value) {
    if (typeof value !== 'number' || !isFinite(value)) {
      return null;
    }
    const percent = value * 100;
    const sign = percent > 0 ? '+' : '';
    return sign + percent.toFixed(1) + '%';
  }

  function escapeHtml(text) {
    return String(text === undefined || text === null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function modeLabel(currentMode) {
    const found = MODES.filter((item) => item.key === currentMode)[0];
    return found ? found.label : currentMode;
  }

  /** 与后台 service worker 通信 */
  function sendBg(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, code: 'channel', error: '扩展后台未响应，请重新加载扩展后再试' });
            return;
          }
          resolve(response || { ok: false, code: 'empty', error: '后台无响应内容' });
        });
      } catch (err) {
        resolve({ ok: false, code: 'channel', error: '扩展后台通信失败：' + (err && err.message ? err.message : '未知错误') });
      }
    });
  }

  // ---------- 数据 ----------

  async function readCache() {
    try {
      const result = await chrome.storage.local.get([CACHE_KEY]);
      return result[CACHE_KEY] || {};
    } catch (err) {
      return {};
    }
  }

  async function writeCache(currentMode, data) {
    try {
      const cache = await readCache();
      cache[currentMode] = { at: Date.now(), data: data };
      await chrome.storage.local.set({ [CACHE_KEY]: cache });
    } catch (err) {
      logOfficial('warn', '报告缓存写入失败（不影响展示）', { message: err && err.message });
    }
  }

  async function refreshKeyStatus() {
    const result = await sendBg({ type: 'wre-official-status' });
    if (result.ok) {
      keyStatus = {
        hasKey: !!result.hasKey,
        savedAt: result.savedAt || 0,
        lastVerifiedAt: result.lastVerifiedAt || 0,
        skillVersion: result.skillVersion || '',
      };
    }
    return keyStatus;
  }

  async function loadReport(force) {
    reportState = 'loading';
    reportError = '';
    upgradeInfo = null;
    render();

    if (!keyStatus.hasKey) {
      reportState = 'error';
      reportError = '尚未配置 API Key';
      render();
      return;
    }

    if (!force) {
      const cache = await readCache();
      const hit = cache[mode];
      if (hit && hit.data && (Date.now() - (hit.at || 0)) < CACHE_TTL_MS) {
        report = hit.data;
        reportAt = hit.at;
        reportFromCache = true;
        reportState = 'ok';
        render();
        return;
      }
    }

    const result = await sendBg({
      type: 'wre-official-call',
      apiName: '/readdata/detail',
      params: { mode: mode, baseTime: 0 },
    });

    if (!result.ok) {
      reportState = 'error';
      reportError = result.error || '读取官方数据失败';
      logOfficial('warn', '报告拉取失败', { mode: mode, code: result.code });
      render();
      return;
    }

    report = result.data;
    reportAt = Date.now();
    reportFromCache = false;
    upgradeInfo = result.upgrade || null;
    reportState = 'ok';
    await writeCache(mode, report);
    logOfficial('info', '报告拉取成功', { mode: mode, readDays: report.readDays });
    render();
  }

  // ---------- 渲染片段 ----------

  function exportButton(format, label) {
    return '<button class="wre-btn wre-btn-small" data-wre-off-export="' + format + '"' +
      (reportState === 'ok' ? '' : ' disabled') + '>' + label + '</button>';
  }

  function buildCards(data) {
    const compare = fmtCompare(data.compare);
    const dayAverage = data.dayAverageReadTime == null ? null : fmtDuration(data.dayAverageReadTime);
    const cards = [
      { label: '总时长', value: fmtDuration(data.totalReadTime) },
      { label: '阅读天数', value: (data.readDays || 0) + ' 天' },
      {
        label: '自然日均',
        value: dayAverage === null ? '—' : dayAverage,
        hint: dayAverage === null ? '官方未提供该周期' : '分母是自然日，非阅读天数',
      },
      {
        label: '较上期',
        value: compare === null ? '—' : compare,
        hint: compare === null ? '官方仅当前周期提供环比' : '官方口径 compare',
      },
    ];
    return cards.map((card) =>
      '<div class="wre-off-card">' +
        '<div class="wre-off-card-label">' + escapeHtml(card.label) + '</div>' +
        '<div class="wre-off-card-value">' + escapeHtml(card.value) + '</div>' +
        (card.hint ? '<div class="wre-off-card-hint">' + escapeHtml(card.hint) + '</div>' : '') +
      '</div>'
    ).join('');
  }

  function buildStatChips(data) {
    if (!Array.isArray(data.readStat) || !data.readStat.length) {
      return '';
    }
    const chips = data.readStat.map((item) =>
      '<span class="wre-off-chip">' + escapeHtml(item.stat) + ' <b>' + escapeHtml(item.counts) + '</b></span>'
    ).join('');
    return '<div class="wre-off-chips">' + chips + '</div>';
  }

  function buildBucketTable(data, currentMode) {
    const buckets = Object.keys(data.readTimes || {}).map((key) => ({
      ts: Number(key),
      seconds: Number((data.readTimes || {})[key]) || 0,
    })).sort((a, b) => a.ts - b.ts);

    if (!buckets.length) {
      return '<div class="wre-off-empty">官方未返回分桶明细</div>';
    }

    const visible = buckets.filter((item) => item.seconds > 0);
    const hiddenCount = buckets.length - visible.length;
    const max = visible.reduce((acc, item) => Math.max(acc, item.seconds), 0) || 1;
    const total = visible.reduce((acc, item) => acc + item.seconds, 0) || 1;

    const rows = visible.map((item) => {
      const width = Math.max(2, Math.round((item.seconds / max) * 100));
      const share = ((item.seconds / total) * 100).toFixed(1);
      return '<tr>' +
        '<td class="wre-off-td-label">' + escapeHtml(fmtBucketLabel(item.ts, currentMode)) + '</td>' +
        '<td class="wre-off-td-bar"><span class="wre-off-bar" style="width:' + width + '%"></span></td>' +
        '<td class="wre-off-td-num">' + escapeHtml(fmtDuration(item.seconds)) + '</td>' +
        '<td class="wre-off-td-share">' + share + '%</td>' +
      '</tr>';
    }).join('');

    return '<table class="wre-off-table">' +
      '<thead><tr><th>周期</th><th>分布</th><th>时长</th><th>占比</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table>' +
      (hiddenCount > 0 ? '<div class="wre-off-note">已隐藏 ' + hiddenCount + ' 个 0 时长周期</div>' : '');
  }

  function buildLongestList(data) {
    const list = Array.isArray(data.readLongest) ? data.readLongest : [];
    if (!list.length) {
      return '<div class="wre-off-empty">该周期内没有达到展示门槛的书（官方过滤低于 5 分钟的内容）</div>';
    }
    const items = list.slice(0, 5).map((item, index) => {
      const book = item.book || {};
      const album = item.albumInfo || {};
      const title = book.title || album.name || '未命名';
      const tags = Array.isArray(item.tags) && item.tags.length
        ? '<span class="wre-off-tag">' + item.tags.map(escapeHtml).join(' · ') + '</span>'
        : '';
      return '<li class="wre-off-list-item">' +
        '<span class="wre-off-rank">' + (index + 1) + '</span>' +
        '<span class="wre-off-list-title">' + escapeHtml(title) + tags + '</span>' +
        '<span class="wre-off-list-value">' + escapeHtml(fmtDuration(item.readTime)) + '</span>' +
      '</li>';
    }).join('');
    return '<ul class="wre-off-list">' + items + '</ul>';
  }

  function buildReportHtml() {
    const privacy = '<div class="wre-off-privacy">🔒 本报告在本机生成，数据不上传</div>';
    const toolbar =
      '<div class="wre-off-toolbar">' +
        '<div class="wre-off-modes">' +
          MODES.map((item) =>
            '<button class="wre-off-mode' + (item.key === mode ? ' is-active' : '') + '" data-wre-off-mode="' + item.key + '">' +
              item.label +
            '</button>'
          ).join('') +
        '</div>' +
        '<div class="wre-off-actions">' +
          '<button class="wre-btn wre-btn-small" data-wre-off-refresh="1">刷新</button>' +
          exportButton('markdown', '导出 Markdown') +
          exportButton('html', '导出 HTML') +
          exportButton('pdf', '导出 PDF') +
        '</div>' +
      '</div>';

    if (!keyStatus.hasKey) {
      return privacy + toolbar +
        '<div class="wre-off-empty">还没有配置 API Key。<br>去「⚙️ 设置」粘贴你自己的 wrk- Key 后即可生成报告。' +
        '<div style="margin-top:12px"><button class="wre-btn" data-wre-off-goto-settings="1">去设置</button></div></div>';
    }

    if (reportState === 'loading') {
      return privacy + toolbar + '<div class="wre-off-empty">正在从官方网关读取数据…</div>';
    }

    if (reportState === 'error') {
      return privacy + toolbar +
        '<div class="wre-off-error">' + escapeHtml(reportError) +
        '<div style="margin-top:12px"><button class="wre-btn" data-wre-off-refresh="1">重试</button></div></div>';
    }

    const data = report || {};
    const upgradeBanner = upgradeInfo
      ? '<div class="wre-off-upgrade">⚠️ 官方提示需要升级 skill：' +
        escapeHtml(upgradeInfo.message || upgradeInfo.skill_version || '请更新到最新版') +
        '<a href="https://cdn.weread.qq.com/skills/weread-skills.zip" target="_blank" rel="noreferrer">下载官方 skill 包</a></div>'
      : '';
    const sourceNote = '<div class="wre-off-note">数据来源：官方 /readdata/detail（mode=' + escapeHtml(mode) +
      '，skill_version ' + escapeHtml(keyStatus.skillVersion || '1.0.4') + '）；' +
      (reportFromCache ? '来自 ' + escapeHtml(fmtDateTime(reportAt)) + ' 的缓存' : '刚刚拉取 ' + escapeHtml(fmtDateTime(reportAt))) +
      '。时长单位已由秒转为可读文案；「自然日均」分母是自然日，不是阅读天数。</div>';

    return privacy + toolbar + upgradeBanner +
      '<div class="wre-off-section-title">一、总览</div>' +
      '<div class="wre-off-cards">' + buildCards(data) + '</div>' +
      buildStatChips(data) +
      '<div class="wre-off-section-title">二、时长分布</div>' +
      buildBucketTable(data, mode) +
      '<div class="wre-off-section-title">三、读得最多</div>' +
      buildLongestList(data) +
      sourceNote;
  }

  function buildSettingsHtml() {
    const statusLines = [
      '状态：' + (keyStatus.hasKey ? '已配置' : '未配置'),
      keyStatus.hasKey ? '保存于 ' + fmtDateTime(keyStatus.savedAt) : '',
      keyStatus.hasKey && keyStatus.lastVerifiedAt ? '最近校验 ' + fmtDateTime(keyStatus.lastVerifiedAt) : '',
      keyStatus.skillVersion ? 'skill_version ' + keyStatus.skillVersion : '',
    ].filter(Boolean).join('　·　');

    return '<div class="wre-off-privacy">🔒 Key 只保存在本机浏览器（chrome.storage.local），不会上传给任何人</div>' +
      '<div class="wre-off-section-title">API Key</div>' +
      '<div class="wre-off-note">获取方式：微信读书 App → 「微信读书 Skill」页面 → 复制 wrk- 开头的 API Key。</div>' +
      '<div class="wre-off-set-row">' +
        '<input type="password" id="wre-off-key-input" class="wre-off-input" placeholder="wrk-xxxxxxxx" autocomplete="off" spellcheck="false">' +
        '<button class="wre-btn wre-btn-small" data-wre-off-toggle-key="1">显示</button>' +
      '</div>' +
      '<div class="wre-off-set-row">' +
        '<button class="wre-btn" data-wre-off-save="1">保存并校验</button>' +
        '<button class="wre-btn" data-wre-off-clear="1">清除 Key</button>' +
        '<button class="wre-btn wre-btn-small" data-wre-off-refresh-status="1">刷新状态</button>' +
      '</div>' +
      '<div class="wre-off-set-status">' + escapeHtml(statusLines) + '</div>' +
      (settingsMessage ? '<div class="wre-off-set-message">' + escapeHtml(settingsMessage) + '</div>' : '') +
      '<div class="wre-off-note">安全提醒：Key 等同你的账号读取权限，请勿粘贴到聊天、截图或提交到代码仓库；怀疑泄露时可在 App 里重置。</div>';
  }

  // ---------- 面板 ----------

  function menuEntryExists(menu) {
    return !!menu.querySelector('[data-wre-official-entry]');
  }

  function injectMenuEntry(root) {
    const menu = root.querySelector('#wre-main-menu');
    if (!menu || menuEntryExists(menu)) {
      return;
    }
    const item = document.createElement('div');
    item.className = 'wre-menu-item';
    item.setAttribute('data-action', 'official');
    item.setAttribute('data-wre-official-entry', '1');
    item.innerHTML = '<span class="wre-menu-icon">☁️</span>官方数据';
    item.addEventListener('click', () => {
      openPanel();
    });
    const anchor = menu.querySelector('[data-wre-notes-entry]') ||
      menu.querySelector('[data-wre-stats-entry]') ||
      menu.querySelector('[data-action="theme-settings"]');
    if (anchor && anchor.nextSibling) {
      menu.insertBefore(item, anchor.nextSibling);
    } else if (anchor) {
      menu.appendChild(item);
    } else {
      menu.appendChild(item);
    }
    logOfficial('info', '已注入「官方数据」菜单入口');
  }

  function buildPanel(root) {
    const existing = root.querySelector('#wre-official-modal');
    if (existing) {
      return existing;
    }
    const overlay = document.createElement('div');
    overlay.className = 'wre-modal-overlay';
    overlay.id = 'wre-official-modal';
    overlay.innerHTML =
      '<div class="wre-modal wre-off-modal">' +
        '<div class="wre-modal-header">' +
          '<span class="wre-modal-title">☁️ 官方数据</span>' +
          '<button class="wre-modal-close" data-wre-off-close>&times;</button>' +
        '</div>' +
        '<div class="wre-off-tabs">' +
          '<button class="wre-off-tab" data-wre-off-tab="report">📊 阅读行为报告</button>' +
          '<button class="wre-off-tab" data-wre-off-tab="settings">⚙️ 设置</button>' +
        '</div>' +
        '<div class="wre-modal-body wre-off-body" id="wre-off-body"></div>' +
      '</div>';

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closePanel();
      }
    });
    const closeBtn = overlay.querySelector('[data-wre-off-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => closePanel());
    }
    overlay.addEventListener('click', handlePanelClick);
    overlay.addEventListener('change', handlePanelChange);
    root.appendChild(overlay);
    return overlay;
  }

  function handlePanelClick(event) {
    const target = event.target;
    if (!target || !target.closest) {
      return;
    }
    const tabBtn = target.closest('[data-wre-off-tab]');
    if (tabBtn) {
      activeTab = tabBtn.getAttribute('data-wre-off-tab');
      settingsMessage = '';
      render();
      return;
    }
    const modeBtn = target.closest('[data-wre-off-mode]');
    if (modeBtn) {
      const next = modeBtn.getAttribute('data-wre-off-mode');
      if (next !== mode) {
        mode = next;
        loadReport(false);
      }
      return;
    }
    if (target.closest('[data-wre-off-refresh]')) {
      loadReport(true);
      return;
    }
    const exportBtn = target.closest('[data-wre-off-export]');
    if (exportBtn) {
      handleExport(exportBtn.getAttribute('data-wre-off-export'));
      return;
    }
    if (target.closest('[data-wre-off-goto-settings]')) {
      activeTab = 'settings';
      render();
      return;
    }
    if (target.closest('[data-wre-off-toggle-key]')) {
      const input = document.getElementById('wre-off-key-input');
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
        target.textContent = input.type === 'password' ? '显示' : '隐藏';
      }
      return;
    }
    if (target.closest('[data-wre-off-save]')) {
      saveKey();
      return;
    }
    if (target.closest('[data-wre-off-clear]')) {
      clearKey();
      return;
    }
    if (target.closest('[data-wre-off-refresh-status]')) {
      refreshKeyStatus().then(() => {
        settingsMessage = '状态已刷新：' + (keyStatus.hasKey ? '已配置' : '未配置');
        render();
      });
    }
  }

  function handlePanelChange() {
    // 预留：后续阶段（可视化 / 书架 / 笔记）的表单控件统一在这里分发
  }

  function saveKey() {
    const input = document.getElementById('wre-off-key-input');
    const value = input ? input.value.trim() : '';
    if (!value) {
      settingsMessage = '请先粘贴 API Key';
      render();
      return;
    }
    settingsMessage = '正在校验 Key…';
    render();
    sendBg({ type: 'wre-official-save', apiKey: value }).then((result) => {
      if (!result.ok) {
        settingsMessage = '保存失败：' + (result.error || '未知原因');
        logOfficial('warn', 'Key 保存失败', { code: result.code });
        render();
        return;
      }
      settingsMessage = '保存成功，Key 已通过校验';
      const box = document.getElementById('wre-off-key-input');
      if (box) {
        box.value = '';
      }
      refreshKeyStatus().then(() => loadReport(true));
    });
  }

  function clearKey() {
    if (!window.confirm('确定清除本机保存的 API Key？清除后将无法读取官方数据。')) {
      return;
    }
    sendBg({ type: 'wre-official-clear' }).then(() => {
      report = null;
      reportState = 'idle';
      settingsMessage = '已清除 Key';
      refreshKeyStatus().then(() => render());
    });
  }

  function openPanel() {
    const root = document.getElementById('we-read-enhancer-root');
    if (!root) {
      return;
    }
    const overlay = buildPanel(root);
    overlay.classList.add('wre-visible');
    refreshKeyStatus().then(() => {
      render();
      if (keyStatus.hasKey && (reportState === 'idle' || reportState === 'error')) {
        loadReport(false);
      }
    });
    logOfficial('info', '打开官方数据面板');
  }

  function closePanel() {
    const overlay = document.getElementById('wre-official-modal');
    if (overlay) {
      overlay.classList.remove('wre-visible');
    }
  }

  function render() {
    const overlay = document.getElementById('wre-official-modal');
    if (!overlay) {
      return;
    }
    const body = overlay.querySelector('#wre-off-body');
    if (!body) {
      return;
    }
    overlay.querySelectorAll('[data-wre-off-tab]').forEach((btn) => {
      if (btn.getAttribute('data-wre-off-tab') === activeTab) {
        btn.classList.add('is-active');
      } else {
        btn.classList.remove('is-active');
      }
    });
    body.innerHTML = activeTab === 'settings' ? buildSettingsHtml() : buildReportHtml();
  }

  // ---------- 导出 ----------

  function buildMarkdown() {
    const data = report || {};
    const lines = [];
    lines.push('# 微信悦读 · 阅读行为报告（' + modeLabel(mode) + '）');
    lines.push('');
    lines.push('- 生成时间：' + fmtDateTime(Date.now()));
    lines.push('- 数据口径：微信读书官方 Agent Skill（skill_version ' + (keyStatus.skillVersion || '1.0.4') + '）');
    lines.push('- 隐私说明：本报告在本机生成，数据不上传');
    lines.push('');
    lines.push('## 一、总览');
    lines.push('');
    lines.push('| 指标 | 数值 |');
    lines.push('| --- | --- |');
    lines.push('| 总时长 | ' + fmtDuration(data.totalReadTime) + ' |');
    lines.push('| 阅读天数 | ' + (data.readDays || 0) + ' 天 |');
    lines.push('| 自然日均 | ' + (data.dayAverageReadTime == null ? '官方未提供' : fmtDuration(data.dayAverageReadTime)) + ' |');
    const compare = fmtCompare(data.compare);
    lines.push('| 较上期 | ' + (compare === null ? '官方未提供（仅当前周期返回）' : compare) + ' |');
    if (Array.isArray(data.readStat) && data.readStat.length) {
      lines.push('| 官方摘要 | ' + data.readStat.map((item) => item.stat + ' ' + item.counts).join('　') + ' |');
    }
    lines.push('');
    lines.push('## 二、时长分布');
    lines.push('');
    const buckets = Object.keys(data.readTimes || {}).map((key) => ({
      ts: Number(key),
      seconds: Number((data.readTimes || {})[key]) || 0,
    })).filter((item) => item.seconds > 0).sort((a, b) => a.ts - b.ts);
    if (!buckets.length) {
      lines.push('（该周期官方未返回分桶明细）');
    } else {
      const total = buckets.reduce((acc, item) => acc + item.seconds, 0) || 1;
      lines.push('| 周期 | 时长 | 占比 |');
      lines.push('| --- | --- | --- |');
      buckets.forEach((item) => {
        lines.push('| ' + fmtBucketLabel(item.ts, mode) + ' | ' + fmtDuration(item.seconds) +
          ' | ' + ((item.seconds / total) * 100).toFixed(1) + '% |');
      });
    }
    lines.push('');
    lines.push('## 三、读得最多');
    lines.push('');
    const longest = Array.isArray(data.readLongest) ? data.readLongest : [];
    if (!longest.length) {
      lines.push('（该周期内没有达到官方展示门槛的书）');
    } else {
      longest.slice(0, 10).forEach((item, index) => {
        const book = item.book || {};
        const album = item.albumInfo || {};
        const title = book.title || album.name || '未命名';
        const tags = Array.isArray(item.tags) && item.tags.length ? '（' + item.tags.join(' · ') + '）' : '';
        lines.push((index + 1) + '. ' + title + tags + ' — ' + fmtDuration(item.readTime));
      });
    }
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('数据来源：官方 `/readdata/detail`（mode=' + mode + '）。时长字段单位已由秒转为可读文案；“自然日均”分母为自然日，非阅读天数。');
    lines.push('');
    return lines.join('\n');
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function stampSuffix() {
    const today = new Date();
    return today.getFullYear() + pad2(today.getMonth() + 1) + pad2(today.getDate());
  }

  function exportMarkdown() {
    if (!report) {
      return;
    }
    const filename = '微信悦读-阅读行为报告-' + mode + '-' + stampSuffix() + '.md';
    downloadFile(filename, buildMarkdown(), 'text/markdown;charset=utf-8');
    logOfficial('info', '已导出报告', { format: 'markdown', mode: mode, filename: filename });
  }

  function exportHtml() {
    if (!report) {
      return;
    }
    const filename = '微信悦读-阅读行为报告-' + mode + '-' + stampSuffix() + '.html';
    downloadFile(filename, buildStandaloneHtml(), 'text/html;charset=utf-8');
    logOfficial('info', '已导出报告', { format: 'html', mode: mode, filename: filename });
  }

  function exportPdf() {
    if (!report) {
      return;
    }
    if (!openReportForPrint(buildStandaloneHtml())) {
      return;
    }
    logOfficial('info', '已打开打印视图（可另存为 PDF）', { mode: mode });
  }

  function handleExport(format) {
    if (reportState !== 'ok' || !report) {
      logOfficial('warn', '报告未就绪，忽略导出请求', { format: format });
      return;
    }
    if (format === 'html') {
      exportHtml();
    } else if (format === 'pdf') {
      exportPdf();
    } else {
      exportMarkdown();
    }
  }

  // ---------- 独立 HTML 报告（可下载 / 可打印成 PDF） ----------

  function reportStyles() {
    return [
      ':root{--accent:#07c160;--accent-soft:#e8f8ef;--ink:#1f2328;--ink-2:#5b6570;--line:#e8ebe9;--bg:#f4f6f5;--warn:#b8860b}',
      '*{box-sizing:border-box}',
      'html,body{margin:0;padding:0}',
      'body{background:var(--bg);color:var(--ink);font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
      '.page{max-width:820px;margin:32px auto;padding:40px 44px;background:#fff;border-radius:18px;box-shadow:0 12px 32px rgba(17,24,28,.08)}',
      '.hero{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding-bottom:22px;border-bottom:2px solid var(--line)}',
      '.hero h1{margin:0;font-size:26px;letter-spacing:.5px}',
      '.hero h1::before{content:"";display:inline-block;width:10px;height:24px;margin-right:10px;border-radius:3px;background:var(--accent);vertical-align:-3px}',
      '.hero .sub{margin:6px 0 0;font-size:12px;color:var(--ink-2)}',
      '.hero .meta{text-align:right;font-size:12px;color:var(--ink-2);white-space:nowrap}',
      '.hero .meta strong{display:block;margin-top:2px;font-size:14px;color:var(--ink)}',
      '.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:26px 0 8px}',
      '.card{padding:16px 18px;border-radius:14px;background:var(--accent-soft);border-left:4px solid var(--accent)}',
      '.card .label{font-size:12px;color:var(--ink-2)}',
      '.card .value{margin-top:8px;font-size:20px;font-weight:700;letter-spacing:.3px}',
      '.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}',
      '.chip{padding:4px 12px;border:1px solid var(--line);border-radius:999px;font-size:12px;color:var(--ink-2)}',
      '.chip b{color:var(--accent)}',
      '.warn{margin-top:16px;padding:12px 14px;border:1px dashed var(--warn);border-radius:12px;font-size:12px;color:var(--ink)}',
      '.warn a{margin-left:6px;color:var(--accent)}',
      '.block{margin-top:32px}',
      '.block h2{margin:0 0 12px;font-size:15px;font-weight:600}',
      '.block h2 span{color:var(--ink-2);font-weight:400;font-size:12px;margin-left:6px}',
      'table{width:100%;border-collapse:collapse;font-size:13px}',
      'th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line)}',
      'th{font-size:12px;font-weight:600;color:var(--ink-2);background:#fafbfa}',
      'tbody tr:nth-child(even){background:#f6f8f7}',
      'td.num,th.num{text-align:right;white-space:nowrap}',
      '.bar{height:8px;border-radius:4px;background:var(--line);overflow:hidden}',
      '.bar i{display:block;height:100%;border-radius:4px;background:var(--accent)}',
      '.rank{margin:0;padding:0;list-style:none}',
      '.rank li{display:flex;align-items:baseline;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;margin-bottom:8px;background:#fafbfa}',
      '.rank .no{flex:none;width:18px;text-align:center;font-weight:700;color:var(--accent)}',
      '.rank .rk-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.rank .tag{margin-left:6px;font-size:11px;color:var(--ink-2)}',
      '.rank .rk-value{flex:none;color:var(--ink-2)}',
      '.empty{padding:18px;font-size:13px;color:var(--ink-2);background:#fafbfa;border:1px dashed var(--line);border-radius:10px}',
      '.foot{margin-top:34px;padding-top:16px;border-top:1px solid var(--line);font-size:12px;line-height:1.8;color:var(--ink-2)}',
      '.print-btn{position:fixed;right:24px;bottom:24px;padding:12px 20px;border:0;border-radius:999px;background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 8px 20px rgba(7,193,96,.35)}',
      '.print-btn:hover{filter:brightness(1.05)}',
      '@media screen{body{padding-bottom:96px}}',
      '@media (max-width:720px){.page{margin:16px;padding:24px}.cards{grid-template-columns:repeat(2,1fr)}.hero{flex-direction:column;align-items:flex-start}.hero .meta{text-align:left}}',
      '@media print{@page{size:A4;margin:14mm}body{background:#fff}.page{max-width:none;margin:0;padding:0;border-radius:0;box-shadow:none}.no-print{display:none!important}.card,.rank li{break-inside:avoid}table{break-inside:auto}tr{break-inside:avoid}}',
    ].join('');
  }

  function buildHtmlCards(data) {
    const compare = fmtCompare(data.compare);
    const dayAverage = data.dayAverageReadTime == null ? '—' : fmtDuration(data.dayAverageReadTime);
    const cards = [
      { label: '总时长', value: fmtDuration(data.totalReadTime) },
      { label: '阅读天数', value: (data.readDays || 0) + ' 天' },
      { label: '自然日均', value: dayAverage },
      { label: '较上期', value: compare === null ? '—' : compare },
    ];
    return '<div class="cards">' + cards.map((card) =>
      '<div class="card"><div class="label">' + escapeHtml(card.label) + '</div>' +
      '<div class="value">' + escapeHtml(card.value) + '</div></div>'
    ).join('') + '</div>';
  }

  function buildHtmlChips(data) {
    if (!Array.isArray(data.readStat) || !data.readStat.length) {
      return '';
    }
    return '<div class="chips">' + data.readStat.map((item) =>
      '<span class="chip">' + escapeHtml(item.stat) + ' <b>' + escapeHtml(item.counts) + '</b></span>'
    ).join('') + '</div>';
  }

  function buildHtmlDistribution(data, currentMode) {
    const buckets = Object.keys(data.readTimes || {}).map((key) => ({
      ts: Number(key),
      seconds: Number((data.readTimes || {})[key]) || 0,
    })).filter((item) => item.seconds > 0).sort((a, b) => a.ts - b.ts);

    if (!buckets.length) {
      return '<div class="empty">官方未返回分桶明细</div>';
    }
    const max = buckets.reduce((acc, item) => Math.max(acc, item.seconds), 0) || 1;
    const total = buckets.reduce((acc, item) => acc + item.seconds, 0) || 1;
    const rows = buckets.map((item) => {
      const width = Math.max(2, Math.round((item.seconds / max) * 100));
      const share = ((item.seconds / total) * 100).toFixed(1);
      return '<tr>' +
        '<td>' + escapeHtml(fmtBucketLabel(item.ts, currentMode)) + '</td>' +
        '<td><div class="bar"><i style="width:' + width + '%"></i></div></td>' +
        '<td class="num">' + escapeHtml(fmtDuration(item.seconds)) + '</td>' +
        '<td class="num">' + share + '%</td>' +
      '</tr>';
    }).join('');
    return '<table><thead><tr><th>周期</th><th>分布</th><th class="num">时长</th><th class="num">占比</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

  function buildHtmlLongest(data) {
    const list = Array.isArray(data.readLongest) ? data.readLongest : [];
    if (!list.length) {
      return '<div class="empty">该周期内没有达到官方展示门槛的书</div>';
    }
    const items = list.slice(0, 10).map((item, index) => {
      const book = item.book || {};
      const album = item.albumInfo || {};
      const title = book.title || album.name || '未命名';
      const tags = Array.isArray(item.tags) && item.tags.length
        ? '<span class="tag">' + item.tags.map(escapeHtml).join(' · ') + '</span>'
        : '';
      return '<li>' +
        '<span class="no">' + (index + 1) + '</span>' +
        '<span class="rk-title">' + escapeHtml(title) + tags + '</span>' +
        '<span class="rk-value">' + escapeHtml(fmtDuration(item.readTime)) + '</span>' +
      '</li>';
    }).join('');
    return '<ol class="rank">' + items + '</ol>';
  }

  function buildStandaloneHtml() {
    const data = report || {};
    const exportedAt = fmtDateTime(Date.now());
    const upgradeBanner = upgradeInfo
      ? '<div class="warn">⚠️ 官方提示需要升级 skill：' +
        escapeHtml(upgradeInfo.message || upgradeInfo.skill_version || '请更新到最新版') +
        '<a href="https://cdn.weread.qq.com/skills/weread-skills.zip" target="_blank" rel="noreferrer">下载官方 skill 包</a></div>'
      : '';
    const source = (reportFromCache ? '数据来自 ' + fmtDateTime(reportAt) + ' 的本地缓存' : '数据于 ' + fmtDateTime(reportAt) + ' 拉取');
    return [
      '<!DOCTYPE html>',
      '<html lang="zh-CN">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<title>微信悦读 · 阅读行为报告（' + escapeHtml(modeLabel(mode)) + '）</title>',
      '<style>' + reportStyles() + '</style>',
      '</head>',
      '<body>',
      '<div class="page">',
      '  <header class="hero">',
      '    <div>',
      '      <h1>阅读行为报告</h1>',
      '      <p class="sub">微信悦读 · weread-enhancer · ' + escapeHtml(modeLabel(mode)) + '</p>',
      '    </div>',
      '    <div class="meta">导出时间<strong>' + escapeHtml(exportedAt) + '</strong></div>',
      '  </header>',
      buildHtmlCards(data),
      buildHtmlChips(data),
      upgradeBanner,
      '  <div class="block"><h2>一、时长分布</h2>',
      buildHtmlDistribution(data, mode),
      '  </div>',
      '  <div class="block"><h2>二、读得最多</h2>',
      buildHtmlLongest(data),
      '  </div>',
      '  <footer class="foot">',
      '    <div>' + escapeHtml(source) + '；数据来源：微信读书官方 Agent Skill（/readdata/detail，mode=' + escapeHtml(mode) + '，skill_version ' + escapeHtml(keyStatus.skillVersion || '1.0.4') + '）。</div>',
      '    <div>口径说明：官方时长字段单位为秒，本报告已转为可读文案；「自然日均」分母是自然日，不是阅读天数；「较上期」仅当前周期由官方提供。</div>',
      '    <div>隐私说明：本报告在浏览器本机生成，数据不上传，API Key 只保存在本机。</div>',
      '  </footer>',
      '</div>',
      '<button class="print-btn no-print" id="wre-off-report-print">打印 / 另存为 PDF</button>',
      '</body>',
      '</html>',
    ].join('\n');
  }

  function openReportForPrint(html) {
    const win = window.open('', '_blank');
    if (!win) {
      logOfficial('warn', 'PDF 导出被拦截：浏览器阻止了新窗口，请允许本站弹出窗口后重试');
      return false;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    const printBtn = win.document.getElementById('wre-off-report-print');
    if (printBtn) {
      printBtn.addEventListener('click', () => win.print());
    }
    // 等浏览器完成首帧渲染再唤起打印对话框
    setTimeout(() => {
      try {
        win.print();
      } catch (error) {
        logOfficial('warn', '唤起打印失败，可手动按 Ctrl/Cmd+P', { error: String(error) });
      }
    }, 400);
    return true;
  }

  // ---------- 启动 ----------

  function attach(root) {
    injectMenuEntry(root);
    refreshKeyStatus().then(() => {
      logOfficial('info', '官方数据模块已启动', { hasKey: keyStatus.hasKey });
    });
  }

  function bootstrap() {
    const existing = document.getElementById('we-read-enhancer-root');
    if (existing) {
      attach(existing);
      return;
    }
    const observer = new MutationObserver(() => {
      const root = document.getElementById('we-read-enhancer-root');
      if (root) {
        observer.disconnect();
        attach(root);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    logOfficial('debug', '等待插件根容器出现后接入官方数据模块');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
