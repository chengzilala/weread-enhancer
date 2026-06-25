const WRE_PREFIX = '[Wechat-Reader-Enhancer]';
const WRE_STORAGE_KEYS = {
  state: 'wreState',
  logs: 'wreDebugLogs',
};
const WRE_DEFAULT_STATE = {
  theme: 'light',
  dndMode: false,
  screenRatio: 80,
  screenBasePx: null,
  screenBaseMode: 'container-v1',
};
const WRE_MAX_LOGS = 200;

let WRE_STATE = { ...WRE_DEFAULT_STATE };
let WRE_LOGS = [];
let wreStyleTag = null;
let wreRoot = null;
let persistLogsTimer = null;
let debugViewTimer = null;
let lastReflowAt = 0;
let lastPreviewLogAt = 0;

function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return `[Unserializable: ${String(error)}]`;
  }
}

function serializeElement(el) {
  if (!el) {
    return null;
  }

  const computed = window.getComputedStyle(el);
  return {
    tag: el.tagName,
    id: el.id || '',
    className: el.className || '',
    offsetWidth: el.offsetWidth,
    offsetHeight: el.offsetHeight,
    clientWidth: el.clientWidth,
    clientHeight: el.clientHeight,
    rect: {
      width: Number(el.getBoundingClientRect().width.toFixed(2)),
      height: Number(el.getBoundingClientRect().height.toFixed(2)),
      left: Number(el.getBoundingClientRect().left.toFixed(2)),
      top: Number(el.getBoundingClientRect().top.toFixed(2)),
    },
    style: {
      width: computed.width,
      maxWidth: computed.maxWidth,
      marginLeft: computed.marginLeft,
      marginRight: computed.marginRight,
      display: computed.display,
      position: computed.position,
      boxSizing: computed.boxSizing,
      paddingLeft: computed.paddingLeft,
      paddingRight: computed.paddingRight,
      overflowX: computed.overflowX,
      overflowY: computed.overflowY,
      justifyContent: computed.justifyContent,
      alignItems: computed.alignItems,
      flexDirection: computed.flexDirection,
      flexWrap: computed.flexWrap,
      gap: computed.gap,
      fontSize: computed.fontSize,
      lineHeight: computed.lineHeight,
      columnCount: computed.columnCount,
      columnGap: computed.columnGap,
      transform: computed.transform,
    },
  };
}

function clampNumber(value, min, max) {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function scheduleWereadLayoutReflow(reason) {
  const now = Date.now();
  if (now - lastReflowAt < 120) {
    return;
  }
  lastReflowAt = now;
  window.setTimeout(() => {
    triggerWereadLayoutReflow(reason);
  }, 0);
}

function triggerWereadLayoutReflow(reason) {
  try {
    void document.body?.offsetHeight;
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('orientationchange'));
    log('info', '已触发页面重排', { reason });
  } catch (error) {
    log('warn', '触发页面重排失败', { reason, error: String(error) });
  }
}

function log(level, message, meta) {
  const entry = {
    time: new Date().toISOString(),
    level,
    message,
    meta: meta || null,
    url: window.location.href,
  };

  WRE_LOGS.push(entry);
  if (WRE_LOGS.length > WRE_MAX_LOGS) {
    WRE_LOGS = WRE_LOGS.slice(-WRE_MAX_LOGS);
  }

  const printable = meta ? `${WRE_PREFIX} ${message} ${safeStringify(meta)}` : `${WRE_PREFIX} ${message}`;
  if (level === 'error') {
    console.error(printable);
  } else if (level === 'warn') {
    console.warn(printable);
  } else {
    console.log(printable);
  }

  schedulePersistLogs();
  scheduleDebugViewRefresh();
}

function schedulePersistLogs() {
  if (persistLogsTimer) {
    clearTimeout(persistLogsTimer);
  }
  persistLogsTimer = window.setTimeout(async () => {
    try {
      await chrome.storage.local.set({ [WRE_STORAGE_KEYS.logs]: WRE_LOGS });
    } catch (error) {
      console.warn(`${WRE_PREFIX} 保存日志失败`, error);
    }
  }, 300);
}

function scheduleDebugViewRefresh() {
  if (debugViewTimer) {
    clearTimeout(debugViewTimer);
  }
  debugViewTimer = window.setTimeout(() => {
    renderDebugOutput();
  }, 80);
}

function formatLogsForExport() {
  const payload = {
    exportedAt: new Date().toISOString(),
    page: {
      href: window.location.href,
      title: document.title,
      userAgent: navigator.userAgent,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    },
    state: WRE_STATE,
    logs: WRE_LOGS,
  };

  return safeStringify(payload);
}

async function copyLogsToClipboard() {
  const text = formatLogsForExport();
  try {
    await navigator.clipboard.writeText(text);
    log('info', '已复制调试日志到剪贴板', { length: text.length });
  } catch (error) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    log('warn', '使用兼容方式复制调试日志', { reason: String(error) });
  }
}

function downloadLogs() {
  const text = formatLogsForExport();
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `weread-debug-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  log('info', '已下载调试日志文件', { size: text.length });
}

async function clearLogs() {
  WRE_LOGS = [];
  await chrome.storage.local.set({ [WRE_STORAGE_KEYS.logs]: WRE_LOGS });
  renderDebugOutput();
  log('info', '已清空历史调试日志');
}

function collectLayoutSnapshot() {
  const selectors = [
    'body',
    '#app',
    '.app_content',
    '.readerContent',
    '.readerChapterContent_container',
    '.readerChapterContent',
  ];

  const snapshot = {
    title: document.title,
    href: window.location.href,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    state: {
      screenRatio: WRE_STATE.screenRatio,
      screenBasePx: WRE_STATE.screenBasePx,
      screenBaseMode: WRE_STATE.screenBaseMode,
    },
    selectors: {},
    parentChain: [],
  };

  selectors.forEach((selector) => {
    snapshot.selectors[selector] = serializeElement(document.querySelector(selector));
  });

  const allChapterContents = Array.from(document.querySelectorAll('.readerChapterContent')).slice(0, 10);
  snapshot.selectorsAll = {
    '.readerChapterContent(count)': document.querySelectorAll('.readerChapterContent').length,
    '.readerChapterContent(list)': allChapterContents.map((el) => serializeElement(el)),
  };

  let current = document.querySelector('.readerChapterContent');
  let depth = 0;
  while (current && depth < 5) {
    snapshot.parentChain.push({
      depth,
      selectorHint: `${current.tagName.toLowerCase()}${current.id ? `#${current.id}` : ''}${current.className ? `.${String(current.className).trim().replace(/\s+/g, '.')}` : ''}`,
      element: serializeElement(current),
    });
    current = current.parentElement;
    depth += 1;
  }

  log('info', '已采集页面结构诊断', snapshot);
  const chapterCount = snapshot.selectorsAll?.['.readerChapterContent(count)'] ?? 0;
  const issues = [];
  if (!snapshot.selectors['.readerChapterContent']) {
    issues.push('未找到 .readerChapterContent');
  }
  if (snapshot.selectors['.readerContent'] === null) {
    issues.push('不存在 .readerContent（使用它会无效）');
  }
  const appContent = snapshot.selectors['.app_content'];
  if (appContent && appContent.offsetWidth === 0 && appContent.rect.width === 0) {
    issues.push('.app_content 的 offsetWidth/rect.width 为 0（不适合作为布局锚点）');
  }
  if (chapterCount > 1) {
    issues.push(`当前存在多个 .readerChapterContent（${chapterCount} 个），需要确认是否双页/横向模式`);
  }
  log('info', '诊断摘要', {
    screenRatio: snapshot.state.screenRatio,
    screenBasePx: snapshot.state.screenBasePx,
    screenBaseMode: snapshot.state.screenBaseMode,
    viewport: snapshot.viewport,
    chapterCount,
    readerChapterContentWidthPx: snapshot.selectors['.readerChapterContent']?.rect?.width ?? null,
    issues,
  });
  return snapshot;
}

function renderDebugOutput() {
  if (!wreRoot) {
    return;
  }

  const output = wreRoot.querySelector('#wre-debug-output');
  const summary = wreRoot.querySelector('#wre-debug-summary');
  if (!output || !summary) {
    return;
  }

  const latestLogs = WRE_LOGS.slice(-30);
  summary.textContent = `日志 ${WRE_LOGS.length} 条，展示最近 ${latestLogs.length} 条`;
  output.textContent = latestLogs
    .map((entry) => {
      const meta = entry.meta ? `\n${safeStringify(entry.meta)}` : '';
      return `[${entry.time}] [${entry.level}] ${entry.message}${meta}`;
    })
    .join('\n\n');
}

function registerRuntimeErrorHooks() {
  window.addEventListener('error', (event) => {
    log('error', '捕获到运行时错误', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    log('error', '捕获到未处理 Promise 异常', {
      reason: String(event.reason),
    });
  });
}

async function loadState() {
  try {
    const result = await chrome.storage.local.get([WRE_STORAGE_KEYS.state, WRE_STORAGE_KEYS.logs]);
    if (result[WRE_STORAGE_KEYS.state]) {
      WRE_STATE = { ...WRE_DEFAULT_STATE, ...result[WRE_STORAGE_KEYS.state] };
    }
    if (WRE_STATE.screenBaseMode !== WRE_DEFAULT_STATE.screenBaseMode) {
      WRE_STATE.screenBaseMode = WRE_DEFAULT_STATE.screenBaseMode;
      WRE_STATE.screenBasePx = null;
      await chrome.storage.local.set({ [WRE_STORAGE_KEYS.state]: WRE_STATE });
    }
    if (Array.isArray(result[WRE_STORAGE_KEYS.logs])) {
      WRE_LOGS = result[WRE_STORAGE_KEYS.logs];
    }
  } catch (error) {
    console.warn(`${WRE_PREFIX} 加载状态失败`, error);
  }
}

async function saveState() {
  try {
    await chrome.storage.local.set({ [WRE_STORAGE_KEYS.state]: WRE_STATE });
    log('info', '已保存插件状态', { screenRatio: WRE_STATE.screenRatio });
  } catch (error) {
    log('error', '保存插件状态失败', { error: String(error) });
  }
}

function getPrimaryContentElement() {
  return document.querySelector('.readerChapterContent');
}

function getReaderContainerElement() {
  return document.querySelector('.readerChapterContent_container');
}

function measurePrimaryContentWidthPx() {
  const el = getPrimaryContentElement();
  if (!el) {
    return null;
  }
  const width = el.getBoundingClientRect().width;
  if (!Number.isFinite(width) || width <= 0) {
    return null;
  }
  return Number(width.toFixed(2));
}

function waitNextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function measureDefaultBaseWidthPx() {
  ensureStyleTag();
  const previous = wreStyleTag.textContent;
  wreStyleTag.textContent = '';
  await waitNextFrame();
  const container = getReaderContainerElement();
  const width = container ? Number(container.getBoundingClientRect().width.toFixed(2)) : null;
  wreStyleTag.textContent = previous;
  await waitNextFrame();
  return width;
}

async function primeScreenBasePx(force) {
  if (!force && Number.isFinite(WRE_STATE.screenBasePx) && WRE_STATE.screenBasePx > 0) {
    return;
  }
  const width = await measureDefaultBaseWidthPx();
  if (!width) {
    log('warn', '未能初始化 screenBasePx（未找到阅读内容元素）');
    return;
  }
  WRE_STATE.screenBasePx = width;
  WRE_STATE.screenBaseMode = WRE_DEFAULT_STATE.screenBaseMode;
  await saveState();
  log('info', '已初始化 screenBasePx', { screenBasePx: WRE_STATE.screenBasePx });
}

async function resetScreenBasePx() {
  const width = await measureDefaultBaseWidthPx();
  if (!width) {
    log('warn', '重置 screenBasePx 失败（未找到阅读内容元素）');
    return;
  }
  WRE_STATE.screenBasePx = width;
  WRE_STATE.screenBaseMode = WRE_DEFAULT_STATE.screenBaseMode;
  await saveState();
  log('info', '已重置 screenBasePx', { screenBasePx: WRE_STATE.screenBasePx });
  const applied = applyScreenRatio(WRE_STATE.screenRatio);
  scheduleWereadLayoutReflow('reset-base');
  inspectAppliedLayout();
  collectLayoutSnapshot();
  log('info', '已重置基准并重新应用屏占比', applied);
}

function ensureStyleTag() {
  if (wreStyleTag && document.contains(wreStyleTag)) {
    return;
  }

  const existing = Array.from(document.querySelectorAll('#we-read-enhancer-style'));
  if (existing.length > 0) {
    wreStyleTag = existing[0];
    existing.slice(1).forEach((el) => el.remove());
    return;
  }

  wreStyleTag = document.createElement('style');
  wreStyleTag.id = 'we-read-enhancer-style';
  document.head.appendChild(wreStyleTag);
}

function updateStyleTag(ratio) {
  ensureStyleTag();
  const numericRatio = clampNumber(Number(ratio), 50, 100);
  const basePx = Number.isFinite(WRE_STATE.screenBasePx) && WRE_STATE.screenBasePx > 0 ? WRE_STATE.screenBasePx : null;
  const targetPx = basePx ? Math.round((basePx * numericRatio) / 100) : null;

  if (targetPx) {
    wreStyleTag.textContent = `
      .readerChapterContent {
        width: ${targetPx}px !important;
        max-width: ${targetPx}px !important;
        margin-left: auto !important;
        margin-right: auto !important;
        box-sizing: border-box !important;
      }
    `;
  } else {
    wreStyleTag.textContent = `
      .readerChapterContent {
        max-width: ${numericRatio}% !important;
        margin-left: auto !important;
        margin-right: auto !important;
        box-sizing: border-box !important;
      }
    `;
  }
  return {
    ratio: numericRatio,
    screenBasePx: basePx,
    targetMaxWidthPx: targetPx,
  };
}

function applyScreenRatio(ratio) {
  return updateStyleTag(ratio);
}

function inspectAppliedLayout() {
  const elements = Array.from(document.querySelectorAll('.readerChapterContent')).slice(0, 10);
  log('info', '布局应用后检查', {
    count: document.querySelectorAll('.readerChapterContent').length,
    elements: elements.map((el) => serializeElement(el)),
  });
}

function openModal(selector) {
  const modal = wreRoot?.querySelector(selector);
  if (modal) {
    modal.classList.add('wre-visible');
  }
}

function closeModal(selector) {
  const modal = wreRoot?.querySelector(selector);
  if (modal) {
    modal.classList.remove('wre-visible');
  }
}

function createUI() {
  const existingRoot = document.getElementById('we-read-enhancer-root');
  if (existingRoot) {
    existingRoot.remove();
  }

  const root = document.createElement('div');
  root.id = 'we-read-enhancer-root';
  root.setAttribute('data-wre-theme', WRE_STATE.theme);
  if (WRE_STATE.dndMode) {
    root.classList.add('wre-dnd');
  }

  root.innerHTML = `
    <div class="wre-fab" id="wre-fab">🤖</div>

    <div class="wre-panel-container" id="wre-main-menu">
      <div class="wre-menu-group">设置</div>
      <div class="wre-menu-item" data-action="read-settings"><span class="wre-menu-icon">📖</span>阅读设置</div>
      <div class="wre-menu-item" data-action="debug-logs"><span class="wre-menu-icon">🧪</span>调试日志</div>
      <div class="wre-menu-item" data-action="restore-default"><span class="wre-menu-icon">🔄</span>恢复默认设置</div>

      <div class="wre-menu-group">关于</div>
      <div class="wre-menu-item" data-action="shortcuts"><span class="wre-menu-icon">⌨️</span>快捷键说明</div>
    </div>

    <div class="wre-modal-overlay" id="wre-read-settings-modal">
      <div class="wre-modal">
        <div class="wre-modal-header">
          <span class="wre-modal-title">📖 阅读设置</span>
          <button class="wre-modal-close" data-close="#wre-read-settings-modal">&times;</button>
        </div>
        <div class="wre-modal-body">
          <div class="wre-setting-item">
            <label class="wre-setting-label">屏占比调节</label>
            <div class="wre-setting-control">
              <input type="range" class="wre-slider" id="wre-screen-ratio" min="50" max="100" value="${WRE_STATE.screenRatio}">
              <span class="wre-slider-value" id="wre-screen-ratio-value">${WRE_STATE.screenRatio}%</span>
            </div>
            <div class="wre-setting-tip">比例含义：相对于阅读区域容器宽度（100% = 当前屏幕可用宽度）。</div>
            <div class="wre-quick-actions" id="wre-screen-ratio-quick">
              <button class="wre-btn wre-btn-small" data-ratio="100">100%</button>
              <button class="wre-btn wre-btn-small" data-ratio="90">90%</button>
              <button class="wre-btn wre-btn-small" data-ratio="80">80%</button>
              <button class="wre-btn wre-btn-small" data-ratio="70">70%</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="wre-modal-overlay" id="wre-debug-modal">
      <div class="wre-modal wre-debug-modal">
        <div class="wre-modal-header">
          <span class="wre-modal-title">🧪 调试日志</span>
          <button class="wre-modal-close" data-close="#wre-debug-modal">&times;</button>
        </div>
        <div class="wre-modal-body">
          <div class="wre-debug-actions">
            <button class="wre-btn" id="wre-debug-collect">采集页面结构</button>
            <button class="wre-btn" id="wre-debug-rebase">重置基准宽度</button>
            <button class="wre-btn" id="wre-debug-copy">复制日志</button>
            <button class="wre-btn" id="wre-debug-download">下载日志</button>
            <button class="wre-btn wre-btn-danger" id="wre-debug-clear">清空日志</button>
          </div>
          <div class="wre-debug-summary" id="wre-debug-summary"></div>
          <pre class="wre-debug-output" id="wre-debug-output"></pre>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(root);
  wreRoot = root;
  bindEvents(root);
  renderDebugOutput();
  log('info', '插件 UI 已加载', {
    screenRatio: WRE_STATE.screenRatio,
    screenBasePx: WRE_STATE.screenBasePx,
    href: window.location.href,
  });
}

function bindEvents(root) {
  const fab = root.querySelector('#wre-fab');
  const menu = root.querySelector('#wre-main-menu');
  const screenRatioSlider = root.querySelector('#wre-screen-ratio');
  const screenRatioValue = root.querySelector('#wre-screen-ratio-value');
  const screenRatioQuick = root.querySelector('#wre-screen-ratio-quick');
  const debugCollect = root.querySelector('#wre-debug-collect');
  const debugRebase = root.querySelector('#wre-debug-rebase');
  const debugCopy = root.querySelector('#wre-debug-copy');
  const debugDownload = root.querySelector('#wre-debug-download');
  const debugClear = root.querySelector('#wre-debug-clear');

  fab.addEventListener('click', (event) => {
    event.stopPropagation();
    menu.classList.toggle('wre-visible');
  });

  document.addEventListener('click', () => {
    menu.classList.remove('wre-visible');
  });

  menu.addEventListener('click', (event) => {
    event.stopPropagation();
    const item = event.target.closest('.wre-menu-item');
    if (!item) {
      return;
    }
    handleMenuClick(item.getAttribute('data-action'));
    menu.classList.remove('wre-visible');
  });

  root.querySelectorAll('.wre-modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        overlay.classList.remove('wre-visible');
      }
    });
  });

  root.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => {
      closeModal(button.getAttribute('data-close'));
    });
  });

  screenRatioSlider.addEventListener('input', (event) => {
    const value = Number.parseInt(event.target.value, 10);
    screenRatioValue.textContent = `${value}%`;
    WRE_STATE.screenRatio = value;
    const applied = applyScreenRatio(value);
    scheduleWereadLayoutReflow('slider-input');
    const now = Date.now();
    if (now - lastPreviewLogAt > 250) {
      lastPreviewLogAt = now;
      log('info', '预览屏占比', applied);
    }
  });

  screenRatioSlider.addEventListener('change', async (event) => {
    const value = Number.parseInt(event.target.value, 10);
    WRE_STATE.screenRatio = value;
    const applied = applyScreenRatio(value);
    scheduleWereadLayoutReflow('slider-change');
    await saveState();
    inspectAppliedLayout();
    collectLayoutSnapshot();
    log('info', '用户完成屏占比调整', applied);
  });

  if (screenRatioQuick) {
    screenRatioQuick.addEventListener('click', async (event) => {
      const btn = event.target.closest('button[data-ratio]');
      if (!btn) {
        return;
      }
      const value = Number.parseInt(btn.getAttribute('data-ratio'), 10);
      if (Number.isNaN(value)) {
        return;
      }
      screenRatioSlider.value = String(value);
      screenRatioValue.textContent = `${value}%`;
      WRE_STATE.screenRatio = value;
      const applied = applyScreenRatio(value);
      scheduleWereadLayoutReflow('quick-ratio');
      await saveState();
      inspectAppliedLayout();
      collectLayoutSnapshot();
      log('info', '快捷设置屏占比', applied);
    });
  }

  debugCollect.addEventListener('click', () => {
    collectLayoutSnapshot();
  });

  debugRebase.addEventListener('click', async () => {
    await resetScreenBasePx();
  });

  debugCopy.addEventListener('click', async () => {
    await copyLogsToClipboard();
  });

  debugDownload.addEventListener('click', () => {
    downloadLogs();
  });

  debugClear.addEventListener('click', async () => {
    await clearLogs();
  });
}

function handleMenuClick(action) {
  log('info', '用户触发菜单操作', { action });

  switch (action) {
    case 'read-settings':
      openModal('#wre-read-settings-modal');
      break;
    case 'debug-logs':
      openModal('#wre-debug-modal');
      collectLayoutSnapshot();
      break;
    case 'restore-default':
      WRE_STATE = { ...WRE_DEFAULT_STATE };
      const applied = applyScreenRatio(WRE_STATE.screenRatio);
      scheduleWereadLayoutReflow('restore-default');
      saveState();
      inspectAppliedLayout();
      collectLayoutSnapshot();
      if (wreRoot) {
        const slider = wreRoot.querySelector('#wre-screen-ratio');
        const value = wreRoot.querySelector('#wre-screen-ratio-value');
        if (slider) {
          slider.value = String(WRE_STATE.screenRatio);
        }
        if (value) {
          value.textContent = `${WRE_STATE.screenRatio}%`;
        }
      }
      log('warn', '已恢复默认设置', applied);
      break;
    default:
      log('warn', '该菜单功能尚未实现', { action });
      break;
  }
}

async function applySavedScreenRatioOnInit() {
  const ratio = WRE_STATE.screenRatio;
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i += 1) {
    const container = getReaderContainerElement();
    const content = getPrimaryContentElement();
    const containerWidth = container?.getBoundingClientRect?.().width;
    const contentWidth = content?.getBoundingClientRect?.().width;

    if (Number.isFinite(containerWidth) && containerWidth > 0 && Number.isFinite(contentWidth) && contentWidth > 0) {
      const applied = applyScreenRatio(ratio);
      scheduleWereadLayoutReflow('init-apply');
      inspectAppliedLayout();
      collectLayoutSnapshot();
      log('info', '已在刷新后自动应用已保存的屏占比', applied);
      return true;
    }

    await waitNextFrame();
  }

  log('warn', '刷新后自动应用屏占比失败（页面元素未就绪）', { ratio });
  return false;
}

async function init() {
  await loadState();
  registerRuntimeErrorHooks();
  createUI();
  ensureStyleTag();
  wreStyleTag.textContent = '';
  await primeScreenBasePx(true);
  await applySavedScreenRatioOnInit();
}

if (document.body) {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init);
}
