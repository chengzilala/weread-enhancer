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
  autoRead: {
    enabled: false,
    speed: 50,
    direction: 'down',
  },
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

// 自动阅读状态
let autoReadTimer = null;
let autoReadPaused = false;
let autoReadIsInterval = false; // true=setInterval, false=rAF

// 全屏状态追踪
let wreFullscreenPreviousRatio = null; // 进入全屏前的屏占比，退出时恢复
let wreFullscreenPreviousDnd = null;   // 进入全屏前的勿扰状态，退出时恢复

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
      opacity: computed.opacity,
      pointerEvents: computed.pointerEvents,
      visibility: computed.visibility,
      zIndex: computed.zIndex,
      color: computed.color,
      backgroundColor: computed.backgroundColor,
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
    '.readerTopBar',
    '.readerControls',
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
  if (!snapshot.selectors['.readerTopBar'] && !snapshot.selectors['.readerControls']) {
    issues.push('未找到常见工具栏选择器（.readerTopBar / .readerControls）');
  }
  log('info', '诊断摘要', {
    screenRatio: snapshot.state.screenRatio,
    screenBasePx: snapshot.state.screenBasePx,
    screenBaseMode: snapshot.state.screenBaseMode,
    viewport: snapshot.viewport,
    chapterCount,
    readerChapterContentWidthPx: snapshot.selectors['.readerChapterContent']?.rect?.width ?? null,
    toolbarFloatEnabled: document.body.classList.contains('wre-toolbar-floating'),
    toolbarOpacity: snapshot.selectors['.readerTopBar']?.style?.opacity ?? null,
    toolbarTopBar: snapshot.selectors['.readerTopBar']?.rect ?? null,
    toolbarControls: snapshot.selectors['.readerControls']?.rect ?? null,
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
    // #region debug-point init-theme-state-load
    log('info', '初始化读取存储状态', {
      hasState: Boolean(result[WRE_STORAGE_KEYS.state]),
      storedTheme: result[WRE_STORAGE_KEYS.state]?.theme || null,
      storedScreenRatio: result[WRE_STORAGE_KEYS.state]?.screenRatio || null,
    });
    // #endregion
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
    wreStyleTag = existing[existing.length - 1];
    existing.slice(0, -1).forEach((el) => el.remove());
    return;
  }

  wreStyleTag = document.createElement('style');
  wreStyleTag.id = 'we-read-enhancer-style';
  document.head.appendChild(wreStyleTag);
}

const toolbarFloatCSS = `
body.wre-toolbar-floating .readerTopBar,
body.wre-toolbar-floating [class*="readerTopBar"] {
  opacity: 0 !important;
  pointer-events: none !important;
  transition: opacity 0.3s ease !important;
}
body.wre-toolbar-floating.wre-show-topbar .readerTopBar,
body.wre-toolbar-floating.wre-show-topbar [class*="readerTopBar"] {
  opacity: 1 !important;
  pointer-events: auto !important;
}
body.wre-toolbar-floating .readerControls,
body.wre-toolbar-floating [class*="readerControls"] {
  left: auto !important;
  right: 20px !important;
  margin-left: 0 !important;
  opacity: 0 !important;
  pointer-events: none !important;
  transition: opacity 0.3s ease !important;
}
body.wre-toolbar-floating.wre-show-controls .readerControls,
body.wre-toolbar-floating.wre-show-controls [class*="readerControls"] {
  opacity: 1 !important;
  pointer-events: auto !important;
}`;

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
      ${toolbarFloatCSS}
      ${wreThemeCSS[WRE_STATE.theme] || wreThemeCSS.light}
    `;
  } else {
    wreStyleTag.textContent = `
      .readerChapterContent {
        max-width: ${numericRatio}% !important;
        margin-left: auto !important;
        margin-right: auto !important;
        box-sizing: border-box !important;
      }
      ${toolbarFloatCSS}
      ${wreThemeCSS[WRE_STATE.theme] || wreThemeCSS.light}
    `;
  }

  // 强制重排后动态检测工具栏位置
  // eslint-disable-next-line no-unused-expressions
  document.body.offsetHeight;
  let enableToolbarFloat = false;
  const controls = document.querySelector('.readerControls');
  const topBar = document.querySelector('.readerTopBar');
  if (controls && topBar) {
    const cr = controls.getBoundingClientRect();
    const tr = topBar.getBoundingClientRect();
    // 触发条件（二合一）：① 比例 >85%（86% 及以上触发浮动，85% 刚好能放下工具栏保持原生）；
    // ② 实际元素溢出（兜底，处理小屏、缩放等边缘情况）
    const outOfView = numericRatio > 85 || tr.left < -1 || tr.right > window.innerWidth + 1 || cr.right > window.innerWidth;
    enableToolbarFloat = outOfView;
    log('info', '工具栏位置检测', {
      controls: { left: Math.round(cr.left), right: Math.round(cr.right) },
      topBar: { left: Math.round(tr.left), right: Math.round(tr.right) },
      viewportW: window.innerWidth, enableFloat: enableToolbarFloat
    });
  } else if (controls) {
    const cr = controls.getBoundingClientRect();
    enableToolbarFloat = cr.right > window.innerWidth + 1;
  } else if (topBar) {
    const tr = topBar.getBoundingClientRect();
    enableToolbarFloat = tr.left < 0 || tr.right > window.innerWidth;
  }

  if (enableToolbarFloat) {
    document.body.classList.add('wre-toolbar-floating');
    applyToolbarFloating();
  } else {
    document.body.classList.remove('wre-toolbar-floating');
    document.body.classList.remove('wre-show-topbar');
    document.body.classList.remove('wre-show-controls');
    removeToolbarFloating();
  }

  const toolbarEl = document.querySelector('.readerTopBar');
  const cssCheck = toolbarEl ? {
    opacity: window.getComputedStyle(toolbarEl).opacity,
    pointerEvents: window.getComputedStyle(toolbarEl).pointerEvents,
  } : null;

  return {
    ratio: numericRatio,
    screenBasePx: basePx,
    targetMaxWidthPx: targetPx,
    toolbarFloatEnabled: enableToolbarFloat,
    cssCheck,
  };
}

function applyScreenRatio(ratio) {
  return updateStyleTag(ratio);
}

/* ========== 主题设置 ========== */

// 颜色配置（背景走 CSS，文字走 element.style.setProperty）
const wreThemeColors = {
  light:         { bg: '#ffffff', color: '#000000', topbarBg: '#ffffff', filter: 'none' },
  dark:          { bg: '#121212', color: '#ffffff', topbarBg: '#1a1a1a', filter: 'invert(1) hue-rotate(180deg)' },
  'eye-protection': { bg: '#f5e6c8', color: '#1a0a00', topbarBg: '#ede0c8', filter: 'sepia(0.4)' },
};

const wreThemeBackgroundSelector = [
  'div.app',
  'div.app_content',
  'div.app_content_in_reader',
  'div.wr_horizontalReader',
  'div.wr_horizontalReader_app_content',
  'div.readerChapterContent_container',
  'div.readerChapterContent',
  'div.horizontal_reader_back_cover_wrapper',
  'div.reader_flyleaf_container',
  'div.horizontalReaderCoverPage',
  'div[class*="needPay_container"]',
].join(',');

const wreThemeCSS = {
  light: `.renderTargetContainer,.renderTargetContainer>div{background:transparent!important}html > body.wre-theme-light,html > body.wre-theme-light ${wreThemeBackgroundSelector}{background:#ffffff!important}html > body.wre-theme-light div.readerTopBar{background:#ffffff!important}html > body.wre-theme-light .renderTargetContainer,html > body.wre-theme-light .wr_canvasContainer,html > body.wre-theme-light canvas{filter:none!important}`,
  dark: `.renderTargetContainer,.renderTargetContainer>div{background:transparent!important}html > body.wre-theme-dark,html > body.wre-theme-dark ${wreThemeBackgroundSelector}{background:#121212!important}html > body.wre-theme-dark div.readerTopBar{background:#1a1a1a!important}html > body.wre-theme-dark .renderTargetContainer,html > body.wre-theme-dark .wr_canvasContainer,html > body.wre-theme-dark canvas{filter:invert(1) hue-rotate(180deg)!important}`,
  'eye-protection': `.renderTargetContainer,.renderTargetContainer>div{background:transparent!important}html > body.wre-theme-eye-protection,html > body.wre-theme-eye-protection ${wreThemeBackgroundSelector}{background:#f5e6c8!important}html > body.wre-theme-eye-protection div.readerTopBar{background:#ede0c8!important}html > body.wre-theme-eye-protection .renderTargetContainer,html > body.wre-theme-eye-protection .wr_canvasContainer,html > body.wre-theme-eye-protection canvas{filter:sepia(0.4)!important}`,
};

function applyTheme(theme) {
  // 移除旧主题类
  document.body.classList.remove('wre-theme-light', 'wre-theme-dark', 'wre-theme-eye-protection');
  // 添加新主题类
  document.body.classList.add('wre-theme-' + theme);

  // 同步更新插件UI的 data 属性
  const root = document.getElementById('we-read-enhancer-root');
  if (root) {
    root.setAttribute('data-wre-theme', theme);
  }

  // 更新状态并通过 updateStyleTag 重建完整样式（含主题 CSS + 屏占比 CSS）
  WRE_STATE.theme = theme;
  ensureStyleTag();
  updateStyleTag(WRE_STATE.screenRatio);

  // 用 element.style.setProperty('color', ..., 'important') 直接设文字颜色
  // 此方式优先级高于任何样式表 !important，React 无法覆盖
  applyThemeColors(theme);

  log('info', '主题已应用', {
    theme,
    officialThemeHint: '插件不再强制同步微信读书官方主题，仅保证插件主题自身的背景与文字可读性',
    bodyClass: document.body.className,
  });
}

/**
 * 清除插件主题样式，让官方主题完全接管
 * 点击官方主题按钮时调用
 */
function clearPluginTheme() {
  // 0. 设标记位，阻止所有延迟兜底重新覆盖
  wrePluginThemeDisabled = true;

  // 1. 移除 body 上的插件主题 class
  document.body.classList.remove('wre-theme-light', 'wre-theme-dark', 'wre-theme-eye-protection');

  // 2. 重建 wreStyleTag：保留屏占比 CSS，清除主题 CSS
  const styleTag = document.getElementById('wreThemeStyleTag') || document.getElementById('we-read-enhancer-style');
  if (styleTag) {
    const ratio = WRE_STATE.screenRatio;
    const basePx = Number.isFinite(WRE_STATE.screenBasePx) && WRE_STATE.screenBasePx > 0 ? WRE_STATE.screenBasePx : null;
    const targetPx = basePx ? Math.round((basePx * ratio) / 100) : null;
    if (targetPx) {
      styleTag.textContent = `
        .readerChapterContent {
          width: ${targetPx}px !important;
          max-width: ${targetPx}px !important;
          margin-left: auto !important;
          margin-right: auto !important;
          box-sizing: border-box !important;
        }
        ${toolbarFloatCSS}
      `;
    } else {
      styleTag.textContent = `
        .readerChapterContent {
          max-width: ${ratio}% !important;
          margin-left: auto !important;
          margin-right: auto !important;
          box-sizing: border-box !important;
        }
        ${toolbarFloatCSS}
      `;
    }
  }

  // 3. 暴力清理所有 inline 样式（filter、background、color 全部清掉）
  for (const c of document.querySelectorAll('canvas')) {
    const parent = c.parentElement;
    if (parent) {
      parent.style.removeProperty('filter');
      parent.style.removeProperty('background-color');
    }
    c.style.removeProperty('filter');
  }
  const all = document.querySelectorAll('[style]');
  for (const el of all) {
    const s = el.style;
    if (s.filter && (s.filter.includes('invert') || s.filter.includes('sepia') || s.filter.includes('hue-rotate'))) {
      s.removeProperty('filter');
    }
    if (s.backgroundColor === 'rgb(18, 18, 18)' || s.backgroundColor === 'rgb(245, 230, 200)' ||
        s.backgroundColor === 'rgb(26, 26, 26)' || s.backgroundColor === 'rgb(237, 224, 200)' ||
        s.backgroundColor === 'rgb(255, 255, 255)') {
      s.removeProperty('background-color');
    }
    if (s.color === 'rgb(0, 0, 0)' || s.color === 'rgb(255, 255, 255)' || s.color === 'rgb(26, 10, 0)') {
      s.removeProperty('color');
      s.removeProperty('-webkit-text-fill-color');
    }
  }

  // 4. 清理顶栏
  const topBar = document.querySelector('.readerTopBar');
  if (topBar) {
    topBar.style.removeProperty('color');
    topBar.style.removeProperty('-webkit-text-fill-color');
    topBar.style.removeProperty('background-color');
  }

  // 5. 清理所有 recorded elements
  clearLastPaintedThemeStyles();

  // 6. 重置状态
  WRE_STATE.theme = 'light';

  // 7. 更新 UI
  const root = document.getElementById('we-read-enhancer-root');
  if (root) {
    root.setAttribute('data-wre-theme', 'light');
  }
  // 显式设置主题按钮高亮：移除所有，仅高亮「明亮」
  const themeOptions = document.getElementById('wre-theme-options');
  if (themeOptions) {
    themeOptions.querySelectorAll('[data-theme]').forEach((btn) => {
      btn.classList.toggle('wre-theme-active', btn.getAttribute('data-theme') === 'light');
    });
  }

  log('info', '插件主题已清除，官方主题接管（所有插件样式已移除）');
}

/**
 * 直接设置 .readerChapterContent 内所有元素的 color，
 * 使用 style.setProperty('color', ..., 'important')，
 * 优先级高于一切样式表，保证文字始终清晰可见。
 */
let wreColorObserver = null;
let wreColorLastSet = 0;
let wreLastPaintedElements = new Set();
let wrePluginThemeDisabled = false; // 标记是否已清除插件主题，防止延迟兜底重新覆盖
let wreCanvasFirstVisibleHits = new Map();
let wreThemeTokenStartTimes = new Map();
let wreCanvasDebugIds = new WeakMap();
let wreCanvasNextDebugId = 1;
let wreCanvasDrawStats = new Map();
let wreCanvasLifecycle = new Map();
let wreCanvasHooksInstalled = false;

function getCanvasDebugId(canvas) {
  if (!wreCanvasDebugIds.has(canvas)) {
    wreCanvasDebugIds.set(canvas, wreCanvasNextDebugId++);
  }
  return wreCanvasDebugIds.get(canvas);
}

function recordCanvasDrawCall(ctx, method, args) {
  const canvas = ctx && ctx.canvas;
  if (!(canvas instanceof HTMLCanvasElement)) {
    return;
  }
  const canvasId = getCanvasDebugId(canvas);
  const now = Date.now();
  const stats = wreCanvasDrawStats.get(canvasId) || {
    totalCalls: 0,
    callsByMethod: {},
    firstCallAt: null,
    lastCallAt: null,
    recentCalls: [],
  };
  stats.totalCalls += 1;
  stats.callsByMethod[method] = (stats.callsByMethod[method] || 0) + 1;
  if (!stats.firstCallAt) {
    stats.firstCallAt = now;
  }
  stats.lastCallAt = now;
  let argHint = null;
  if (method === 'drawImage' && args[0]) {
    const source = args[0];
    argHint = source && source.tagName
      ? source.tagName
      : Object.prototype.toString.call(source).replace(/^\[object |\]$/g, '');
  } else if (/Rect$/.test(method) && args.length >= 4) {
    argHint = `${Math.round(args[2] || 0)}x${Math.round(args[3] || 0)}`;
  } else if ((method === 'fillText' || method === 'strokeText') && args[0]) {
    argHint = String(args[0]).replace(/\s+/g, ' ').slice(0, 24);
  }
  stats.recentCalls.push({
    method,
    at: now,
    argHint,
  });
  if (stats.recentCalls.length > 6) {
    stats.recentCalls.shift();
  }
  wreCanvasDrawStats.set(canvasId, stats);
}

function installCanvasDebugHooks() {
  if (wreCanvasHooksInstalled || typeof CanvasRenderingContext2D === 'undefined') {
    return;
  }
  const proto = CanvasRenderingContext2D.prototype;
  const methods = ['drawImage', 'fillText', 'strokeText', 'putImageData', 'fillRect', 'strokeRect', 'fill', 'stroke', 'clearRect'];
  for (const method of methods) {
    const original = proto[method];
    if (typeof original !== 'function') {
      continue;
    }
    proto[method] = function wreCanvasDebugWrapper(...args) {
      recordCanvasDrawCall(this, method, args);
      return original.apply(this, args);
    };
  }
  wreCanvasHooksInstalled = true;
}

// #region debug-point fast-switch-dark-text
function collectFastSwitchSnapshot(theme, stage, token) {
  const areas = Array.from(document.querySelectorAll('.readerChapterContent'));
  const samples = areas.slice(0, 1).map((area, index) => {
    const areaStyle = window.getComputedStyle(area);
    const hasPluginClassToken = (className) => (
      className.split(/\s+/).some((token) => /^wre-/.test(token))
    );
    const isNoiseClassName = (className) => (
      /preRenderContainer|reader_float_|readerControls|wr_tooltip_container|readerTopBar|renderTarget_pager|renderTargetPageInfo_header|readerCatalog|readerNotePanel|readerAIChatPanel|reader-font-control-panel-wrapper|wr_dialog|wr_mask/.test(className) ||
      hasPluginClassToken(className)
    );
    const isNoiseElement = (el) => {
      if (!el) {
        return true;
      }
      const className = typeof el.className === 'string' ? el.className : '';
      if (isNoiseClassName(className)) {
        return true;
      }
      if (
        (typeof el.id === 'string' && /^wre-/.test(el.id)) ||
        el.closest('#we-read-enhancer-root, [id^="wre-"], .wre-modal-overlay, .wre-modal, .wre-setting-item, .wre-setting-control, .wre-debug-output, .wre-theme-options, .wre-btn, .wre-slider, .readerControls, .wr_tooltip_container, .readerTopBar, [class*="reader_float_"], .readerCatalog, .readerNotePanel, .readerAIChatPanel, .wr_dialog')
      ) {
        return true;
      }
      return false;
    };
    const summarizeNode = (node, depth) => {
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      const rect = typeof node.getBoundingClientRect === 'function'
        ? node.getBoundingClientRect()
        : { width: 0, height: 0 };
      const children = depth > 0
        ? Array.from(node.children || []).slice(0, 4).map((child) => summarizeNode(child, depth - 1))
        : [];
      return {
        tag: node.tagName || '(unknown)',
        className: typeof node.className === 'string' ? node.className : '',
        childCount: node.children ? node.children.length : 0,
        textLength: text.length,
        sampleText: text.slice(0, 40),
        rect: {
          width: Number((rect.width || 0).toFixed(2)),
          height: Number((rect.height || 0).toFixed(2)),
        },
        children,
      };
    };
    const collectSizedDescendants = (root) => {
      const results = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      while (walker.nextNode() && results.length < 8) {
        const el = walker.currentNode;
        if (!(el instanceof Element) || el === root || isNoiseElement(el)) {
          continue;
        }
        const rect = typeof el.getBoundingClientRect === 'function'
          ? el.getBoundingClientRect()
          : { width: 0, height: 0, left: 0, top: 0 };
        if (rect.width <= 0 || rect.height <= 0) {
          continue;
        }
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        results.push({
          tag: el.tagName,
          className: typeof el.className === 'string' ? el.className : '',
          text: text.slice(0, 40),
          rect: {
            width: Number((rect.width || 0).toFixed(2)),
            height: Number((rect.height || 0).toFixed(2)),
            left: Number((rect.left || 0).toFixed(2)),
            top: Number((rect.top || 0).toFixed(2)),
          },
        });
      }
      return results;
    };
    const collectDirectChildLayers = (root) => (
      Array.from(root.children || [])
        .slice(0, 12)
        .map((child) => {
          const rect = typeof child.getBoundingClientRect === 'function'
            ? child.getBoundingClientRect()
            : { width: 0, height: 0, left: 0, top: 0 };
          const style = window.getComputedStyle(child);
          const className = typeof child.className === 'string' ? child.className : '';
          const text = (child.textContent || '').replace(/\s+/g, ' ').trim();
          return {
            tag: child.tagName,
            className,
            childCount: child.children ? child.children.length : 0,
            text: text.slice(0, 40),
            rect: {
              width: Number((rect.width || 0).toFixed(2)),
              height: Number((rect.height || 0).toFixed(2)),
              left: Number((rect.left || 0).toFixed(2)),
              top: Number((rect.top || 0).toFixed(2)),
            },
            display: style.display,
            position: style.position,
            opacity: style.opacity,
            visibility: style.visibility,
            overflow: style.overflow,
            transform: style.transform,
            zIndex: style.zIndex,
            currentPageHint: /(current|active|show|visible|focus|selected|pageCurrent)/i.test(className),
          };
        })
    );
    const classifyRenderBranch = (root, directChildLayers, textCandidates, visibleNodes, canvasDiagnostics) => {
      const childClassNames = directChildLayers.map((child) => child.className).filter(Boolean);
      const textClassNames = textCandidates.map((candidate) => candidate.className).filter(Boolean);
      const combinedClasses = [...childClassNames, ...textClassNames].join(' ');
      const hasCanvas = canvasDiagnostics.length > 0;
      const hasCanvasPixels = canvasDiagnostics.some((canvas) => canvas.hasNonTransparentPixels);
      const hasBackCover = /horizontal_reader_back_cover_wrapper/.test(combinedClasses);
      const hasFlyleaf = /reader_flyleaf_container|horizontalReaderCoverPage/.test(combinedClasses);
      const hasNeedPay = /needPay_container/.test(combinedClasses);
      const hasEnding = /readerFooter_ending_|back_lang_/.test(combinedClasses);
      const hasLoading = root.querySelector('.readerChapterContentLoading') !== null;
      const likelyBranch = visibleNodes.length > 0
        ? 'readable-text-visible'
        : hasCanvasPixels
          ? 'canvas-visible'
          : hasNeedPay
            ? 'need-pay-or-preview-branch'
            : hasBackCover || hasFlyleaf || hasEnding
              ? 'cover-or-ending-branch'
              : hasCanvas
                ? 'canvas-present-but-transparent'
                : hasLoading
                  ? 'loading-branch'
                  : 'unknown';
      return {
        likelyBranch,
        hasCanvas,
        hasCanvasPixels,
        hasLoading,
        hasBackCover,
        hasFlyleaf,
        hasNeedPay,
        hasEnding,
        childClassNames: childClassNames.slice(0, 6),
        textClassNames: textClassNames.slice(0, 6),
      };
    };
    const collectCanvasDiagnostics = (root) => (
      Array.from(root.querySelectorAll('canvas'))
        .slice(0, 4)
        .map((canvas, index) => {
          const buildAncestorSnapshot = (el) => {
            if (!(el instanceof Element)) {
              return null;
            }
            const ancestorRect = typeof el.getBoundingClientRect === 'function'
              ? el.getBoundingClientRect()
              : { width: 0, height: 0, left: 0, top: 0 };
            const ancestorStyle = window.getComputedStyle(el);
            return {
              tag: el.tagName,
              className: typeof el.className === 'string' ? el.className : '',
              rect: {
                width: Number((ancestorRect.width || 0).toFixed(2)),
                height: Number((ancestorRect.height || 0).toFixed(2)),
                left: Number((ancestorRect.left || 0).toFixed(2)),
                top: Number((ancestorRect.top || 0).toFixed(2)),
              },
              display: ancestorStyle.display,
              position: ancestorStyle.position,
              opacity: ancestorStyle.opacity,
              visibility: ancestorStyle.visibility,
              overflow: ancestorStyle.overflow,
              transform: ancestorStyle.transform,
              zIndex: ancestorStyle.zIndex,
            };
          };
          const rect = typeof canvas.getBoundingClientRect === 'function'
            ? canvas.getBoundingClientRect()
            : { width: 0, height: 0, left: 0, top: 0 };
          const style = window.getComputedStyle(canvas);
          const canvasId = getCanvasDebugId(canvas);
          const pixelSamples = [];
          const nonTransparentSamples = [];
          let contextReadable = false;
          let pixelReadError = null;
          try {
            const ctx = canvas.getContext('2d', { willReadFrequently: true }) || canvas.getContext('2d');
            contextReadable = Boolean(ctx);
            if (ctx && canvas.width > 0 && canvas.height > 0) {
              const samplePoints = [
                { label: 'center', x: 0.5, y: 0.5 },
                { label: 'left-center', x: 0.25, y: 0.5 },
                { label: 'right-center', x: 0.75, y: 0.5 },
              ];
              for (const point of samplePoints) {
                const x = Math.max(0, Math.min(canvas.width - 1, Math.round(canvas.width * point.x)));
                const y = Math.max(0, Math.min(canvas.height - 1, Math.round(canvas.height * point.y)));
                const data = ctx.getImageData(x, y, 1, 1).data;
                pixelSamples.push({
                  label: point.label,
                  x,
                  y,
                  rgba: Array.from(data),
                });
                if (data[3] > 0 || data[0] > 0 || data[1] > 0 || data[2] > 0) {
                  nonTransparentSamples.push({
                    label: point.label,
                    x,
                    y,
                    rgba: Array.from(data),
                  });
                }
              }
            }
          } catch (error) {
            pixelReadError = error instanceof Error ? error.message : String(error);
          }
          const canvasKey = `${token}:${index}`;
          const tokenStartedAt = wreThemeTokenStartTimes.get(token) || null;
          const hasNonTransparentPixels = nonTransparentSamples.length > 0;
          if (hasNonTransparentPixels && !wreCanvasFirstVisibleHits.has(canvasKey)) {
            wreCanvasFirstVisibleHits.set(canvasKey, {
              stage,
              elapsedMs: tokenStartedAt ? Date.now() - tokenStartedAt : null,
              sampleLabels: nonTransparentSamples.map((sample) => sample.label),
            });
          }
          const firstNonTransparentHit = wreCanvasFirstVisibleHits.get(canvasKey) || null;
          const parentChain = [];
          let ancestor = canvas.parentElement;
          let depth = 0;
          while (ancestor && depth < 5) {
            parentChain.push({
              depth: depth + 1,
              ...buildAncestorSnapshot(ancestor),
            });
            if (ancestor === root || ancestor.classList?.contains('readerChapterContent')) {
              break;
            }
            ancestor = ancestor.parentElement;
            depth += 1;
          }
          const lifecycleRectSignature = [
            Math.round(rect.width || 0),
            Math.round(rect.height || 0),
            Math.round(rect.left || 0),
            Math.round(rect.top || 0),
          ].join(':');
          const lifecycleParentSignature = parentChain
            .slice(0, 3)
            .map((item) => `${item.className}|${item.display}|${item.visibility}|${item.opacity}`)
            .join('>');
          const lifecycle = wreCanvasLifecycle.get(canvasId) || {
            firstSeenStage: stage,
            firstSeenAt: Date.now(),
            observationCount: 0,
            sizeChangeCount: 0,
            rectChangeCount: 0,
            parentChangeCount: 0,
            lastWidth: canvas.width,
            lastHeight: canvas.height,
            lastRectSignature: lifecycleRectSignature,
            lastParentSignature: lifecycleParentSignature,
          };
          lifecycle.observationCount += 1;
          if (lifecycle.lastWidth !== canvas.width || lifecycle.lastHeight !== canvas.height) {
            lifecycle.sizeChangeCount += 1;
          }
          if (lifecycle.lastRectSignature !== lifecycleRectSignature) {
            lifecycle.rectChangeCount += 1;
          }
          if (lifecycle.lastParentSignature !== lifecycleParentSignature) {
            lifecycle.parentChangeCount += 1;
          }
          lifecycle.lastWidth = canvas.width;
          lifecycle.lastHeight = canvas.height;
          lifecycle.lastRectSignature = lifecycleRectSignature;
          lifecycle.lastParentSignature = lifecycleParentSignature;
          lifecycle.lastSeenStage = stage;
          lifecycle.lastSeenAt = Date.now();
          wreCanvasLifecycle.set(canvasId, lifecycle);
          const drawStats = wreCanvasDrawStats.get(canvasId) || null;
          const overlayHitStack = rect.width > 0 && rect.height > 0
            ? document.elementsFromPoint(
              Math.max(0, Math.min(window.innerWidth - 1, Math.round(rect.left + rect.width / 2))),
              Math.max(0, Math.min(window.innerHeight - 1, Math.round(rect.top + rect.height / 2))),
            )
              .filter((el) => el instanceof Element)
              .slice(0, 5)
              .map((el, hitIndex) => ({
                index: hitIndex,
                tag: el.tagName,
                className: typeof el.className === 'string' ? el.className : '',
                isCanvasSelf: el === canvas,
                isNoise: isNoiseElement(el),
              }))
            : [];
          return {
            index,
            canvasId,
            className: typeof canvas.className === 'string' ? canvas.className : '',
            width: canvas.width,
            height: canvas.height,
            rect: {
              width: Number((rect.width || 0).toFixed(2)),
              height: Number((rect.height || 0).toFixed(2)),
              left: Number((rect.left || 0).toFixed(2)),
              top: Number((rect.top || 0).toFixed(2)),
            },
            display: style.display,
            opacity: style.opacity,
            visibility: style.visibility,
            position: style.position,
            zIndex: style.zIndex,
            contextReadable,
            pixelReadError,
            hasNonTransparentPixels,
            pixelSamples,
            nonTransparentSamples,
            firstNonTransparentHit,
            lifecycle: {
              firstSeenStage: lifecycle.firstSeenStage,
              firstSeenElapsedMs: tokenStartedAt ? lifecycle.firstSeenAt - tokenStartedAt : null,
              lastSeenStage: lifecycle.lastSeenStage,
              lastSeenElapsedMs: tokenStartedAt ? lifecycle.lastSeenAt - tokenStartedAt : null,
              observationCount: lifecycle.observationCount,
              sizeChangeCount: lifecycle.sizeChangeCount,
              rectChangeCount: lifecycle.rectChangeCount,
              parentChangeCount: lifecycle.parentChangeCount,
            },
            drawStats: drawStats
              ? {
                totalCalls: drawStats.totalCalls,
                callsByMethod: drawStats.callsByMethod,
                firstCallElapsedMs: tokenStartedAt ? drawStats.firstCallAt - tokenStartedAt : null,
                lastCallElapsedMs: tokenStartedAt ? drawStats.lastCallAt - tokenStartedAt : null,
                recentCalls: drawStats.recentCalls.map((call) => ({
                  method: call.method,
                  elapsedMs: tokenStartedAt ? call.at - tokenStartedAt : null,
                  argHint: call.argHint,
                })),
              }
              : null,
            parentChain,
            overlayHitStack,
          };
        })
    );
    const buildElementSnapshot = (el, label, point) => {
      const style = window.getComputedStyle(el);
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const rect = typeof el.getBoundingClientRect === 'function'
        ? el.getBoundingClientRect()
        : { width: 0, height: 0, left: 0, top: 0 };
      return {
        label,
        point,
        tag: el.tagName,
        className: typeof el.className === 'string' ? el.className : '',
        text: text.slice(0, 40),
        color: style.color,
        backgroundColor: style.backgroundColor,
        webkitTextFillColor: style.webkitTextFillColor,
        inlineColor: el.style.getPropertyValue('color') || null,
        inlineTextFillColor: el.style.getPropertyValue('-webkit-text-fill-color') || null,
        opacity: style.opacity,
        visibility: style.visibility,
        pointerEvents: style.pointerEvents,
        zIndex: style.zIndex,
        position: style.position,
        overflow: style.overflow,
        transform: style.transform,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        fontWeight: style.fontWeight,
        textShadow: style.textShadow,
        webkitTextStrokeColor: style.webkitTextStrokeColor,
        webkitTextStrokeWidth: style.webkitTextStrokeWidth,
        filter: style.filter,
        mixBlendMode: style.mixBlendMode,
        backgroundImage: style.backgroundImage,
        backgroundBlendMode: style.backgroundBlendMode,
        maskImage: style.maskImage,
        webkitMaskImage: style.webkitMaskImage,
        rect: {
          width: Number((rect.width || 0).toFixed(2)),
          height: Number((rect.height || 0).toFixed(2)),
          left: Number((rect.left || 0).toFixed(2)),
          top: Number((rect.top || 0).toFixed(2)),
        },
      };
    };
    const buildPseudoSnapshot = (el, pseudo) => {
      if (!(el instanceof Element)) {
        return null;
      }
      const style = window.getComputedStyle(el, pseudo);
      const content = (style.content || '').replace(/^["']|["']$/g, '');
      const hasMeaningfulContent = content && content !== 'none' && content !== 'normal';
      const hasVisualPaint = style.backgroundImage !== 'none'
        || style.maskImage !== 'none'
        || style.webkitMaskImage !== 'none'
        || style.textShadow !== 'none';
      if (!hasMeaningfulContent && !hasVisualPaint) {
        return null;
      }
      return {
        pseudo,
        content: hasMeaningfulContent ? content.slice(0, 80) : null,
        color: style.color,
        backgroundColor: style.backgroundColor,
        webkitTextFillColor: style.webkitTextFillColor,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        display: style.display,
        position: style.position,
        opacity: style.opacity,
        visibility: style.visibility,
        textShadow: style.textShadow,
        backgroundImage: style.backgroundImage,
        maskImage: style.maskImage,
        webkitMaskImage: style.webkitMaskImage,
      };
    };
    const buildTextLikeElementProbe = (el, label, point, extra = {}) => {
      if (!(el instanceof Element) || !area.contains(el)) {
        return null;
      }
      if (isNoiseElement(el) && !el.closest('svg')) {
        return null;
      }
      const snapshot = buildElementSnapshot(el, label, point);
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const pseudoBefore = buildPseudoSnapshot(el, '::before');
      const pseudoAfter = buildPseudoSnapshot(el, '::after');
      const hasSvgContext = Boolean(el.closest('svg'));
      const hasTextLikePayload = text.length >= 6
        || pseudoBefore
        || pseudoAfter
        || /^(TEXT|TSPAN|FOREIGNOBJECT|SVG|G)$/i.test(el.tagName);
      if (!hasTextLikePayload) {
        return null;
      }
      return {
        ...snapshot,
        textLength: text.length,
        insideSvg: hasSvgContext,
        pseudoBefore,
        pseudoAfter,
        ...extra,
      };
    };
    const buildTextNodeProbe = (textNode, label, point, extra = {}) => {
      if (!(textNode instanceof Node) || textNode.nodeType !== Node.TEXT_NODE) {
        return null;
      }
      const el = textNode.parentElement;
      if (!el || !area.contains(el) || isNoiseElement(el)) {
        return null;
      }
      if (el.closest('button, input, textarea, select, svg')) {
        return null;
      }
      const text = (textNode.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length < 6) {
        return null;
      }
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rect = range.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        label,
        point,
        tag: el.tagName,
        className: typeof el.className === 'string' ? el.className : '',
        text: text.slice(0, 80),
        textLength: text.length,
        color: style.color,
        backgroundColor: style.backgroundColor,
        webkitTextFillColor: style.webkitTextFillColor,
        inlineColor: el.style.getPropertyValue('color') || null,
        inlineTextFillColor: el.style.getPropertyValue('-webkit-text-fill-color') || null,
        opacity: style.opacity,
        visibility: style.visibility,
        display: style.display,
        position: style.position,
        rect: {
          width: Number((rect.width || 0).toFixed(2)),
          height: Number((rect.height || 0).toFixed(2)),
          left: Number((rect.left || 0).toFixed(2)),
          top: Number((rect.top || 0).toFixed(2)),
        },
        ...extra,
      };
    };
    const getTextNodeProbeAtPoint = (x, y, label) => {
      let textNode = null;
      let source = null;
      if (typeof document.caretRangeFromPoint === 'function') {
        const range = document.caretRangeFromPoint(x, y);
        if (range?.startContainer?.nodeType === Node.TEXT_NODE) {
          textNode = range.startContainer;
          source = 'caretRangeFromPoint';
        }
      }
      if (!textNode && typeof document.caretPositionFromPoint === 'function') {
        const caret = document.caretPositionFromPoint(x, y);
        if (caret?.offsetNode?.nodeType === Node.TEXT_NODE) {
          textNode = caret.offsetNode;
          source = 'caretPositionFromPoint';
        }
      }
      return buildTextNodeProbe(textNode, label, { x, y }, {
        source,
      });
    };
    const collectAncestorElementSnapshots = (el, label, point, maxDepth = 4) => {
      const ancestors = [];
      let current = el;
      let depth = 0;
      while (current instanceof Element && depth < maxDepth) {
        const probe = buildTextLikeElementProbe(current, label, point, {
          depth,
          pseudoBefore: buildPseudoSnapshot(current, '::before'),
          pseudoAfter: buildPseudoSnapshot(current, '::after'),
        }) || {
          depth,
          ...buildElementSnapshot(current, label, point),
          insideSvg: Boolean(current.closest('svg')),
          pseudoBefore: buildPseudoSnapshot(current, '::before'),
          pseudoAfter: buildPseudoSnapshot(current, '::after'),
        };
        ancestors.push(probe);
        if (current === area || current === probeRoot) {
          break;
        }
        current = current.parentElement;
        depth += 1;
      }
      return ancestors;
    };
    const getStrongLayerProbeAtPoint = (x, y, label) => {
      const hitList = document.elementsFromPoint(x, y).filter((el) => el instanceof Element);
      const layerCandidates = [];
      const seen = new Set();
      for (const el of hitList.slice(0, 8)) {
        if (!area.contains(el)) {
          continue;
        }
        let current = el;
        let depth = 0;
        while (current instanceof Element && depth < 5) {
          const key = `${current.tagName}:${typeof current.className === 'string' ? current.className : ''}:${depth}`;
          if (!seen.has(key)) {
            seen.add(key);
            const probe = buildTextLikeElementProbe(current, label, { x, y }, {
              depthFromHit: depth,
            });
            if (probe) {
              layerCandidates.push(probe);
            }
          }
          if (current === area || current === probeRoot) {
            break;
          }
          current = current.parentElement;
          depth += 1;
        }
      }
      return {
        layerCandidates: layerCandidates.slice(0, 6),
        firstCandidate: layerCandidates[0] || null,
        topAncestorChain: hitList.length ? collectAncestorElementSnapshots(hitList[0], label, { x, y }, 5) : [],
      };
    };
    const collectNearestReadableCandidates = (points) => {
      const candidates = [];
      const candidateMap = new Map();
      const walker = document.createTreeWalker(probeRoot, NodeFilter.SHOW_TEXT);
      while (walker.nextNode() && candidates.length < 10) {
        const textNode = walker.currentNode;
        const probe = buildTextNodeProbe(textNode, 'nearest-readable-candidate', null);
        if (!probe) {
          continue;
        }
        if (probe.rect.width <= 0 || probe.rect.height <= 0 || probe.textLength < 12) {
          continue;
        }
        let nearestPoint = null;
        let nearestDistance = Number.POSITIVE_INFINITY;
        const rectCenterX = probe.rect.left + probe.rect.width / 2;
        const rectCenterY = probe.rect.top + probe.rect.height / 2;
        for (const point of points) {
          const dx = rectCenterX - point.x;
          const dy = rectCenterY - point.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestPoint = point;
          }
        }
        if (!nearestPoint || nearestDistance > Math.max(areaRect.width, areaRect.height)) {
          continue;
        }
        const key = `${probe.className}|${probe.text}`;
        if (candidateMap.has(key)) {
          continue;
        }
        const enrichedProbe = {
          ...probe,
          nearestPointLabel: nearestPoint.label,
          nearestDistance: Number(nearestDistance.toFixed(2)),
        };
        candidateMap.set(key, enrichedProbe);
        candidates.push(enrichedProbe);
      }
      return candidates
        .sort((a, b) => a.nearestDistance - b.nearestDistance)
        .slice(0, 6);
    };
    const collectNearestTextLikeElementCandidates = (points) => {
      const candidates = [];
      const seen = new Set();
      const walker = document.createTreeWalker(probeRoot, NodeFilter.SHOW_ELEMENT);
      while (walker.nextNode() && candidates.length < 16) {
        const el = walker.currentNode;
        if (!(el instanceof Element) || el === probeRoot || el === area) {
          continue;
        }
        const probe = buildTextLikeElementProbe(el, 'nearest-text-like-candidate', null);
        if (!probe) {
          continue;
        }
        if (probe.rect.width <= 0 || probe.rect.height <= 0) {
          continue;
        }
        let nearestPoint = null;
        let nearestDistance = Number.POSITIVE_INFINITY;
        const rectCenterX = probe.rect.left + probe.rect.width / 2;
        const rectCenterY = probe.rect.top + probe.rect.height / 2;
        for (const point of points) {
          const dx = rectCenterX - point.x;
          const dy = rectCenterY - point.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestPoint = point;
          }
        }
        if (!nearestPoint || nearestDistance > Math.max(areaRect.width * 1.2, areaRect.height * 1.2)) {
          continue;
        }
        const key = `${probe.tag}|${probe.className}|${probe.text}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        candidates.push({
          ...probe,
          nearestPointLabel: nearestPoint.label,
          nearestDistance: Number(nearestDistance.toFixed(2)),
        });
      }
      return candidates
        .sort((a, b) => a.nearestDistance - b.nearestDistance)
        .slice(0, 8);
    };
    const probeRoot = area.querySelector('.renderTargetContainer') || area;
    const probeRootClassName = typeof probeRoot.className === 'string' ? probeRoot.className : '';
    const textWalker = document.createTreeWalker(probeRoot, NodeFilter.SHOW_TEXT);
    const visibleNodes = [];
    const textCandidates = [];
    const seenElements = new Set();
    const mismatchCandidates = [];
    const isLightTheme = theme === 'light' || theme === 'eye-protection';
    const isDarkTheme = theme === 'dark';

    while (textWalker.nextNode() && (visibleNodes.length < 4 || textCandidates.length < 8)) {
      const textNode = textWalker.currentNode;
      const text = (textNode.textContent || '').trim();
      if (!text || text.length < 2) {
        continue;
      }
      if (/^(全\s*书\s*完|上一页|下一页|上一页下一页)$/.test(text)) {
        continue;
      }

      const el = textNode.parentElement;
      if (!el || seenElements.has(el)) {
        continue;
      }

      if (isNoiseElement(el)) {
        continue;
      }
      if (el.closest('button, input, textarea, select, svg')) {
        continue;
      }

      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rect = range.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (textCandidates.length < 8) {
        textCandidates.push({
          tag: el.tagName,
          className: el.className || '',
          text: text.slice(0, 40),
          rect: {
            width: Number((rect.width || 0).toFixed(2)),
            height: Number((rect.height || 0).toFixed(2)),
            left: Number((rect.left || 0).toFixed(2)),
            top: Number((rect.top || 0).toFixed(2)),
          },
          color: style.color,
          backgroundColor: style.backgroundColor,
          webkitTextFillColor: style.webkitTextFillColor,
          opacity: style.opacity,
          visibility: style.visibility,
          display: style.display,
          position: style.position,
          transform: style.transform,
        });
      }
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }

      seenElements.add(el);
      visibleNodes.push({
        tag: el.tagName,
        className: el.className || '',
        text: text.slice(0, 24),
        color: style.color,
        backgroundColor: style.backgroundColor,
        webkitTextFillColor: style.webkitTextFillColor,
        inlineColor: el.style.getPropertyValue('color') || null,
        inlineTextFillColor: el.style.getPropertyValue('-webkit-text-fill-color') || null,
      });
    }

    const mismatchWalker = document.createTreeWalker(probeRoot, NodeFilter.SHOW_TEXT);
    while (mismatchWalker.nextNode() && mismatchCandidates.length < 6) {
      const textNode = mismatchWalker.currentNode;
      const text = (textNode.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length < 2) {
        continue;
      }
      if (/^(全\s*书\s*完|上一页|下一页|上一页下一页)$/.test(text)) {
        continue;
      }
      const el = textNode.parentElement;
      if (!el || isNoiseElement(el) || el.closest('button, input, textarea, select, svg')) {
        continue;
      }
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rect = range.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }
      if (mismatchCandidates.length >= 6) {
        break;
      }
      const className = typeof el.className === 'string' ? el.className : '';
      const style = window.getComputedStyle(el);
      const color = style.color;
      const fill = style.webkitTextFillColor;
      const inlineColor = el.style.getPropertyValue('color') || null;
      const inlineFill = el.style.getPropertyValue('-webkit-text-fill-color') || null;
      const looksWhite = /rgb\(\s*255,\s*255,\s*255\s*\)/.test(color) || /rgb\(\s*255,\s*255,\s*255\s*\)/.test(fill);
      const looksDark = /rgb\(\s*(0|13|26),\s*(0|10|20),\s*(0|30)\s*\)/.test(color) || /rgb\(\s*(0|13|26),\s*(0|10|20),\s*(0|30)\s*\)/.test(fill);
      if ((isLightTheme && !looksWhite) || (isDarkTheme && !looksDark)) {
        continue;
      }
      mismatchCandidates.push({
        tag: el.tagName,
        className,
        text: text.slice(0, 40),
        color,
        backgroundColor: style.backgroundColor,
        webkitTextFillColor: fill,
        inlineColor,
        inlineTextFillColor: inlineFill,
      });
    }

    const subtreeSummary = visibleNodes.length === 0
      ? Array.from(probeRoot.children || [])
        .slice(0, 4)
        .map((child) => summarizeNode(child, 0))
      : [];
    const directChildLayers = visibleNodes.length === 0
      ? collectDirectChildLayers(probeRoot)
      : [];
    const canvasDiagnostics = visibleNodes.length === 0
      ? collectCanvasDiagnostics(probeRoot)
      : [];
    const renderBranchSummary = classifyRenderBranch(
      probeRoot,
      directChildLayers,
      textCandidates,
      visibleNodes,
      canvasDiagnostics,
    );
    const sizedDescendants = visibleNodes.length === 0
      ? collectSizedDescendants(probeRoot)
      : [];
    const viewportSamples = [];
    const areaRect = area.getBoundingClientRect();
    const samplePoints = [
      { label: 'center', x: areaRect.left + areaRect.width / 2, y: areaRect.top + areaRect.height / 2 },
      { label: 'left-center', x: areaRect.left + Math.min(areaRect.width * 0.25, 120), y: areaRect.top + areaRect.height / 2 },
      { label: 'right-center', x: areaRect.right - Math.min(areaRect.width * 0.25, 120), y: areaRect.top + areaRect.height / 2 },
    ];
    for (const point of samplePoints) {
      const x = Math.max(0, Math.min(window.innerWidth - 1, Math.round(point.x)));
      const y = Math.max(0, Math.min(window.innerHeight - 1, Math.round(point.y)));
      const hitList = document.elementsFromPoint(x, y);
      const hitStack = hitList
        .filter((el) => el instanceof Element)
        .slice(0, 6)
        .map((el, index) => ({
          index,
          insideArea: area.contains(el),
          isNoise: isNoiseElement(el),
          ...buildElementSnapshot(el, point.label, { x, y }),
        }));
      const target = hitList.find((el) => {
        if (!(el instanceof Element)) {
          return false;
        }
        if (!area.contains(el) || isNoiseElement(el)) {
          return false;
        }
        if (el.closest('button, input, textarea, select, svg')) {
          return false;
        }
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return text.length >= 2;
      });
      if (!target) {
        viewportSamples.push({
          label: point.label,
          point: { x, y },
          hitFound: false,
          textProbe: getTextNodeProbeAtPoint(x, y, point.label),
          strongLayerProbe: getStrongLayerProbeAtPoint(x, y, point.label),
          hitStack,
        });
        continue;
      }
      viewportSamples.push({
        hitFound: true,
        hitStack,
        textProbe: getTextNodeProbeAtPoint(x, y, point.label),
        strongLayerProbe: getStrongLayerProbeAtPoint(x, y, point.label),
        ...buildElementSnapshot(target, point.label, { x, y }),
      });
    }
    const nearestReadableCandidates = collectNearestReadableCandidates(samplePoints);
    const nearestTextLikeElementCandidates = collectNearestTextLikeElementCandidates(samplePoints);

    return {
      index,
      className: area.className || '',
      areaColor: areaStyle.color,
      areaBackgroundColor: areaStyle.backgroundColor,
      areaInlineColor: area.style.getPropertyValue('color') || null,
      areaInlineTextFillColor: area.style.getPropertyValue('-webkit-text-fill-color') || null,
      probeRootTag: probeRoot.tagName || '(unknown)',
      probeRootClassName,
      subtreeSummary,
      sampledNodeCount: visibleNodes.length,
      visibleNodes,
      textCandidateCount: textCandidates.length,
      textCandidates,
      directChildLayerCount: directChildLayers.length,
      directChildLayers,
      renderBranchSummary,
      canvasDiagnosticCount: canvasDiagnostics.length,
      canvasDiagnostics,
      sizedDescendantCount: sizedDescendants.length,
      sizedDescendants,
      viewportSampleCount: viewportSamples.length,
      viewportSamples,
      nearestReadableCandidateCount: nearestReadableCandidates.length,
      nearestReadableCandidates,
      nearestTextLikeElementCandidateCount: nearestTextLikeElementCandidates.length,
      nearestTextLikeElementCandidates,
      mismatchCandidateCount: mismatchCandidates.length,
      mismatchCandidates,
    };
  });

  log('info', 'fast-switch snapshot', {
    theme,
    stage,
    token,
    activeToken: wreColorLastSet,
    bodyClass: document.body.className,
    areaCount: areas.length,
    samples,
  });
}

function scheduleCanvasTimelineSnapshots(theme, token) {
  const checkpoints = [16, 80, 200, 500, 1000, 1800];
  checkpoints.forEach((ms) => {
    window.setTimeout(() => {
      if (wreColorLastSet !== token) {
        log('info', 'canvas timeline snapshot 跳过 token 不匹配', {
          theme,
          token,
          activeToken: wreColorLastSet,
          ms,
        });
        return;
      }
      collectFastSwitchSnapshot(theme, `canvas-timeline-${ms}ms`, token);
    }, ms);
  });
}
// #endregion

function clearLastPaintedThemeStyles() {
  let clearedCount = 0;
  for (const el of wreLastPaintedElements) {
    if (!el || !el.style) {
      continue;
    }
    el.style.removeProperty('color');
    el.style.removeProperty('-webkit-text-fill-color');
    el.style.removeProperty('background-color');
    el.style.removeProperty('filter');
    clearedCount++;
  }
  wreLastPaintedElements = new Set();
  return clearedCount;
}

function hasVisibleReadableText(root) {
  if (!root) {
    return false;
  }
  const nonReadableOverlaySelector = [
    '.readerChapterContentLoading',
    '.horizontal_reader_back_cover_wrapper',
    '.reader_flyleaf_container',
    '.horizontalReaderCoverPage',
    '[class*="needPay_container"]',
    '[class*="reader_float_"]',
    '.readerCatalog',
    '.readerNotePanel',
    '.readerAIChatPanel',
    '.readerControls',
    '.wr_tooltip_container',
    '.renderTarget_pager',
    '.wr_dialog',
    '.wr_mask',
  ].join(', ');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const textNode = walker.currentNode;
    const text = (textNode.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length < 2) {
      continue;
    }
    if (/^(全\s*书\s*完|上一页|下一页|上一页下一页)$/.test(text)) {
      continue;
    }
    const el = textNode.parentElement;
    if (!el) {
      continue;
    }
    if (el.closest(nonReadableOverlaySelector)) {
      continue;
    }
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rect = range.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return true;
    }
  }
  return false;
}

function releaseStuckLoadingOverlays(area, theme, token, touched) {
  const loadingOverlays = Array.from(area.querySelectorAll('.readerChapterContentLoading'));
  let releasedCount = 0;
  for (const loading of loadingOverlays) {
    const rect = typeof loading.getBoundingClientRect === 'function'
      ? loading.getBoundingClientRect()
      : { width: 0, height: 0 };
    const text = (loading.textContent || '').replace(/\s+/g, ' ').trim();
    if (rect.width < 120 || rect.height < 120) {
      continue;
    }
    if (text) {
      continue;
    }
    loading.style.setProperty('opacity', '0', 'important');
    loading.style.setProperty('visibility', 'hidden', 'important');
    loading.style.setProperty('pointer-events', 'none', 'important');
    loading.style.setProperty('transition', 'none', 'important');
    touched.add(loading);
    releasedCount += 1;
  }
  if (releasedCount > 0) {
    scheduleWereadLayoutReflow('loading-overlay-timeout-release');
    log('info', '已超时释放卡住的 loading 覆盖层', {
      theme,
      token,
      releasedCount,
    });
  }
  return releasedCount;
}

function triggerWereadBranchRecovery(reason) {
  triggerWereadLayoutReflow(reason);
  window.setTimeout(() => {
    triggerWereadLayoutReflow(`${reason}-followup`);
  }, 80);
}

function hasSuspiciousReaderBranchMarkers(root) {
  if (!(root instanceof Element)) {
    return false;
  }
  return Boolean(root.querySelector(
    '.horizontal_reader_back_cover_wrapper, ' +
    '.reader_flyleaf_container, ' +
    '.horizontalReaderCoverPage, ' +
    '[class*="needPay_container"], ' +
    '.renderTarget_pager'
  ));
}

function hasEndingBranchMarkers(root) {
  if (!(root instanceof Element)) {
    return false;
  }
  return Boolean(root.querySelector(
    '.horizontal_reader_back_cover_wrapper, ' +
    '.reader_flyleaf_container, ' +
    '.horizontalReaderCoverPage, ' +
    '[class*="readerFooter_ending_"], ' +
    '[class*="back_lang_"], ' +
    '[class*="wr_flyleaf_module_rating"]'
  ));
}

function hasEndingBranchTextSignals(root) {
  if (!(root instanceof Element)) {
    return false;
  }
  const endingTextPattern = /(全\s*书\s*完|已阅读\s*\d+\s*小\s*时|读完的第|微信读书推荐值|\d+\s*万人点评)/;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let checkedCount = 0;
  while (walker.nextNode() && checkedCount < 40) {
    const textNode = walker.currentNode;
    const text = (textNode.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) {
      continue;
    }
    checkedCount += 1;
    if (!endingTextPattern.test(text)) {
      continue;
    }
    const el = textNode.parentElement;
    if (!el) {
      continue;
    }
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rect = range.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return true;
    }
  }
  return false;
}

function releaseEndingBranchOverlays(area, probeRoot, theme, token, touched) {
  if (!(area instanceof Element) || !(probeRoot instanceof Element)) {
    return 0;
  }
  const endingSelectors = [
    '.horizontal_reader_back_cover_wrapper',
    '.reader_flyleaf_container',
    '.horizontalReaderCoverPage',
    '[class*="readerFooter_ending_"]',
    '[class*="back_lang_"]',
    '[class*="wr_flyleaf_module_rating"]',
  ];
  const releasedNodes = [];
  for (const node of area.querySelectorAll(endingSelectors.join(', '))) {
    if (!(node instanceof Element)) {
      continue;
    }
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      continue;
    }
    const rect = typeof node.getBoundingClientRect === 'function'
      ? node.getBoundingClientRect()
      : { width: 0, height: 0 };
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (rect.width <= 0 || rect.height <= 0) {
      continue;
    }
    node.style.setProperty('display', 'none', 'important');
    node.style.setProperty('opacity', '0', 'important');
    node.style.setProperty('visibility', 'hidden', 'important');
    node.style.setProperty('pointer-events', 'none', 'important');
    touched.add(node);
    releasedNodes.push({
      className: typeof node.className === 'string' ? node.className : '',
      width: Number((rect.width || 0).toFixed(2)),
      height: Number((rect.height || 0).toFixed(2)),
      text: text.slice(0, 40),
    });
  }
  if (releasedNodes.length > 0) {
    triggerWereadBranchRecovery('ending-branch-release');
    log('info', '已临时隐藏阻塞正文的结束页分支节点', {
      theme,
      token,
      releasedCount: releasedNodes.length,
      releasedNodes,
    });
  }
  return releasedNodes.length;
}

function releaseBlockingReaderFloatOverlays(area, probeRoot, theme, token, touched) {
  if (!(area instanceof Element) || !(probeRoot instanceof Element)) {
    return 0;
  }
  const areaRect = typeof area.getBoundingClientRect === 'function'
    ? area.getBoundingClientRect()
    : { width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 };
  const floatPanels = Array.from(area.querySelectorAll('[class*="reader_float_"]'));
  const releasedPanels = [];
  for (const panel of floatPanels) {
    if (!(panel instanceof Element)) {
      continue;
    }
    const style = window.getComputedStyle(panel);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      continue;
    }
    const rect = typeof panel.getBoundingClientRect === 'function'
      ? panel.getBoundingClientRect()
      : { width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 };
    const overlapsArea = rect.width > 0
      && rect.height > 0
      && rect.right > areaRect.left
      && rect.left < areaRect.right
      && rect.bottom > areaRect.top
      && rect.top < areaRect.bottom;
    const looksBlocking = rect.width >= Math.max(240, areaRect.width * 0.6)
      && rect.height >= Math.max(180, areaRect.height * 0.6);
    if (!overlapsArea || !looksBlocking) {
      continue;
    }
    panel.style.setProperty('display', 'none', 'important');
    panel.style.setProperty('opacity', '0', 'important');
    panel.style.setProperty('visibility', 'hidden', 'important');
    panel.style.setProperty('pointer-events', 'none', 'important');
    touched.add(panel);
    releasedPanels.push({
      className: typeof panel.className === 'string' ? panel.className : '',
      width: Number((rect.width || 0).toFixed(2)),
      height: Number((rect.height || 0).toFixed(2)),
      zIndex: style.zIndex,
    });
  }
  if (releasedPanels.length > 0) {
    triggerWereadBranchRecovery('reader-float-overlay-release');
    log('info', '已临时隐藏阻塞正文的 reader_float 浮层', {
      theme,
      token,
      releasedCount: releasedPanels.length,
      releasedPanels,
    });
  }
  return releasedPanels.length;
}

function revealHiddenRenderTargetContainer(probeRoot, theme, token, touched) {
  if (!(probeRoot instanceof Element) || !probeRoot.classList?.contains('renderTargetContainer')) {
    return false;
  }
  const style = window.getComputedStyle(probeRoot);
  if (style.display !== 'none') {
    return false;
  }
  const canvasCount = probeRoot.querySelectorAll('canvas').length;
  probeRoot.style.setProperty('display', 'block', 'important');
  probeRoot.style.setProperty('visibility', 'visible', 'important');
  probeRoot.style.setProperty('opacity', '1', 'important');
  probeRoot.style.setProperty('pointer-events', 'auto', 'important');
  touched.add(probeRoot);
  const parent = probeRoot.parentElement;
  if (parent) {
    parent.style.setProperty('display', 'block', 'important');
    parent.style.setProperty('visibility', 'visible', 'important');
    parent.style.setProperty('opacity', '1', 'important');
    touched.add(parent);
  }
  scheduleWereadLayoutReflow('render-target-force-visible');
  log('info', '已强制恢复隐藏的 renderTargetContainer', {
    theme,
    token,
    canvasCount,
    parentClassName: parent && typeof parent.className === 'string' ? parent.className : '',
  });
  return true;
}

function applyThemeColors(theme) {
  const cfg = wreThemeColors[theme];
  if (!cfg) return;

  // 1. 清理上一主题的 inline 样式
  const cleared = clearLastPaintedThemeStyles();

  // 2. CSS 背景 + filter 已通过 body class 自动生效，这里再补 JS 级兜底
  const touched = new Set();

  // 3. 顶栏文字色
  const topBar = document.querySelector('.readerTopBar');
  if (topBar) {
    topBar.style.setProperty('color', cfg.color, 'important');
    topBar.style.setProperty('-webkit-text-fill-color', cfg.color, 'important');
    touched.add(topBar);
  }

  wrePluginThemeDisabled = false;

  // 4. 往 canvas 的父容器上挂 filter。用标记位防止 clearPluginTheme 后被延迟兜底覆盖
  const applyParentFilter = () => {
    if (wrePluginThemeDisabled) return 0;
    let applied = 0;
    for (const c of document.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect();
      if (r.width < 20 || r.height < 20) continue;
      const parent = c.parentElement;
      if (!parent) continue;
      if (parent.style.filter === cfg.filter) continue;
      parent.style.setProperty('filter', cfg.filter, 'important');
      touched.add(parent);
      applied++;
    }
    return applied;
  };
  applyParentFilter();
  [100, 400, 1000, 2000].forEach(ms => setTimeout(applyParentFilter, ms));

  wreLastPaintedElements = touched;
  log('info', '主题滤镜已应用', { theme, filter: cfg.filter, cleared });
}

function highlightActiveTheme() {
  const options = document.getElementById('wre-theme-options');
  if (!options) return;
  options.querySelectorAll('[data-theme]').forEach((btn) => {
    const theme = btn.getAttribute('data-theme');
    btn.classList.toggle('wre-theme-active', theme === WRE_STATE.theme);
  });
}

function inspectAppliedLayout() {
  const elements = Array.from(document.querySelectorAll('.readerChapterContent')).slice(0, 10);
  log('info', '布局应用后检查', {
    count: document.querySelectorAll('.readerChapterContent').length,
    elements: elements.map((el) => serializeElement(el)),
  });
}

let wreToolbarTrigger = null;
let wreToolbarHideTimer = null;
let wreToolbarRightTimer = null;

function pinTopBar() {
  // CSS 已通过 toolbarFloatCSS 处理定位与动画，无需额外 inline style
  return true;
}

function pinControls() {
  const controls = document.querySelector('.readerControls');
  if (!controls) return false;
  // inline style 最高优先级，确保覆盖微信读书原生样式
  controls.style.setProperty('left', 'auto', 'important');
  controls.style.setProperty('right', '20px', 'important');
  controls.style.setProperty('margin-left', '0', 'important');
  controls.style.setProperty('z-index', '999999', 'important');
  log('info', '已钉住 readerControls', {
    left: controls.style.left,
    right: controls.style.right,
    marginLeft: controls.style.marginLeft,
  });
  return true;
}

function applyToolbarFloating() {
  const topOk = pinTopBar();
  const ctrlOk = pinControls();
  log('info', '已钉住工具栏', { topBar: topOk, readerControls: ctrlOk });
  ensureToolbarTrigger();
}

function removeToolbarFloating() {
  if (wreToolbarHideTimer) { clearTimeout(wreToolbarHideTimer); wreToolbarHideTimer = null; }
  if (wreToolbarRightTimer) { clearTimeout(wreToolbarRightTimer); wreToolbarRightTimer = null; }

  const topBar = document.querySelector('.readerTopBar');
  const controls = document.querySelector('.readerControls');

  if (topBar) {
    topBar.style.cssText = '';
  }
  if (controls) {
    controls.style.cssText = '';
  }

  if (wreToolbarTrigger && document.contains(wreToolbarTrigger)) {
    wreToolbarTrigger.remove();
  }
  wreToolbarTrigger = null;

  const rightTrigger = document.getElementById('wre-toolbar-trigger-right');
  if (rightTrigger) { rightTrigger.remove(); }

  document.body.classList.remove('wre-show-topbar');
  document.body.classList.remove('wre-show-controls');
  log('info', '已移除工具栏浮动');
}

/**
 * 扫描页面上所有可能和主题切换相关的按钮/元素，把详细信息写入日志，
 * 用于定位官方白天/夜间切换按钮的确切选择器。
 */
function scanOfficialThemeButtons() {
  const searchAreas = [
    '.readerControls',
    '.readerTopBar',
    '.reader_footer',
  ];

  const results = {};

  for (const areaSel of searchAreas) {
    const area = document.querySelector(areaSel);
    if (!area) {
      results[areaSel] = 'NOT_FOUND';
      continue;
    }

    // 获取所有可能可交互的子元素（不限深度）
    const allChildren = Array.from(area.querySelectorAll('div, span, button, a, i, svg, img, [role="button"], [onclick], [class*="btn"], [class*="icon"], [class*="tooltip"]'));

    const items = allChildren.slice(0, 40).map((el) => ({
      tag: el.tagName,
      className: el.className || '',
      text: (el.textContent || '').trim().slice(0, 50) || '(empty)',
      id: el.id || '(none)',
      rect: {
        w: Math.round(el.getBoundingClientRect().width),
        h: Math.round(el.getBoundingClientRect().height),
        x: Math.round(el.getBoundingClientRect().left),
        y: Math.round(el.getBoundingClientRect().top),
      },
      onclick: el.onclick ? 'has onclick' : 'none',
      role: el.getAttribute('role') || 'none',
      cursor: window.getComputedStyle(el).cursor,
    }));

    results[areaSel] = {
      total: allChildren.length,
      sample: items,
    };
  }

  // 额外扫描：直接搜索是否包含"白天"/"夜间"/"深色"/"浅色"文字的元素（不限区域）
  const allPageElements = Array.from(document.querySelectorAll('div, span, button'));
  const themeTextMatches = [];
  for (const el of allPageElements) {
    const text = (el.textContent || '').trim();
    if (text === '白天' || text === '夜间' || text === '深色' || text === '浅色' || text === '日间' || text === '夜晚') {
      themeTextMatches.push({
        tag: el.tagName,
        className: el.className || '',
        text,
        rect: {
          w: Math.round(el.getBoundingClientRect().width),
          h: Math.round(el.getBoundingClientRect().height),
          x: Math.round(el.getBoundingClientRect().left),
          y: Math.round(el.getBoundingClientRect().top),
        },
        parentTag: el.parentElement?.tagName || 'none',
        parentClass: el.parentElement?.className || 'none',
      });
    }
  }
  results['_themeTextMatches_all'] = themeTextMatches;

  log('info', '官方主题按钮扫描结果', results);
}

function ensureToolbarTrigger() {
  if (wreToolbarTrigger && document.contains(wreToolbarTrigger)
      && document.getElementById('wre-toolbar-trigger-right')) {
    return;
  }

  const existing = document.getElementById('wre-toolbar-trigger');
  if (existing) { existing.remove(); }
  const existingRight = document.getElementById('wre-toolbar-trigger-right');
  if (existingRight) { existingRight.remove(); }

  const showTop = () => {
    if (wreToolbarHideTimer) { clearTimeout(wreToolbarHideTimer); wreToolbarHideTimer = null; }
    pinTopBar();
    document.body.classList.add('wre-show-topbar');
  };
  const hideTop = () => {
    if (wreToolbarHideTimer) { clearTimeout(wreToolbarHideTimer); }
    wreToolbarHideTimer = setTimeout(() => {
      document.body.classList.remove('wre-show-topbar');
    }, 400);
  };

  const showRight = () => {
    if (wreToolbarRightTimer) { clearTimeout(wreToolbarRightTimer); wreToolbarRightTimer = null; }
    pinControls();
    document.body.classList.add('wre-show-controls');
    // 同步绑定到 controls 本身，防止鼠标移到按钮上时感应区误判离开
    const ctrl = document.querySelector('.readerControls');
    if (ctrl) {
      ctrl.addEventListener('mouseenter', showRight, { once: false });
      ctrl.addEventListener('mouseleave', hideRight, { once: false });
    }
  };
  const hideRight = () => {
    if (wreToolbarRightTimer) { clearTimeout(wreToolbarRightTimer); }
    wreToolbarRightTimer = setTimeout(() => {
      document.body.classList.remove('wre-show-controls');
    }, 400);
  };

  // 顶部感应区
  const trigger = document.createElement('div');
  trigger.id = 'wre-toolbar-trigger';
  trigger.style.cssText = 'position:fixed;top:0;left:0;right:0;height:56px;z-index:999997;cursor:default;';
  trigger.addEventListener('mouseenter', showTop);
  trigger.addEventListener('mouseleave', hideTop);
  document.body.appendChild(trigger);

  // 右侧感应区
  const rightTrigger = document.createElement('div');
  rightTrigger.id = 'wre-toolbar-trigger-right';
  rightTrigger.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:30px;z-index:1;cursor:default;';
  rightTrigger.addEventListener('mouseenter', showRight);
  rightTrigger.addEventListener('mouseleave', hideRight);
  document.body.appendChild(rightTrigger);

  wreToolbarTrigger = trigger;

  log('info', '已创建工具栏悬停触发器（顶部56px + 右侧30px感应区）');
}

function removeToolbarTrigger() {
  // kept for backward compat, now delegates to removeToolbarFloating
  removeToolbarFloating();
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
      <div class="wre-menu-item" data-action="theme-settings"><span class="wre-menu-icon">🎨</span>主题设置</div>
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

          <div class="wre-setting-item">
            <label class="wre-setting-label">📜 自动阅读</label>
            <div class="wre-autoread-controls">
              <button class="wre-btn wre-autoread-btn" id="wre-autoread-toggle">
                <span id="wre-autoread-toggle-text">▶ 开始自动阅读</span>
              </button>
              <div class="wre-direction-toggle">
                <button class="wre-btn wre-btn-small wre-dir-btn" data-dir="down" id="wre-dir-down">↓ 向下</button>
                <button class="wre-btn wre-btn-small wre-dir-btn" data-dir="up" id="wre-dir-up">↑ 向上</button>
              </div>
            </div>
            <div class="wre-setting-control" style="margin-top: 12px;">
              <span style="font-size: 12px; color: var(--wre-text); min-width: 36px;">速度</span>
              <input type="range" class="wre-slider" id="wre-autoread-speed" min="10" max="100" value="${WRE_STATE.autoRead.speed}">
              <span class="wre-slider-value" id="wre-autoread-speed-value">${WRE_STATE.autoRead.speed}</span>
            </div>
            <div class="wre-quick-actions" id="wre-autoread-speed-quick" style="margin-top: 8px;">
              <button class="wre-btn wre-btn-small" data-speed="20">🐢 20</button>
              <button class="wre-btn wre-btn-small" data-speed="40">🐇 40</button>
              <button class="wre-btn wre-btn-small" data-speed="60">🚀 60</button>
              <button class="wre-btn wre-btn-small" data-speed="80">⚡ 80</button>
            </div>
            <div class="wre-setting-tip">快捷键：空格 开始/暂停 | 按 ? 查看全部快捷键</div>
          </div>
        </div>
      </div>
    </div>

    <div class="wre-modal-overlay" id="wre-theme-settings-modal">
      <div class="wre-modal">
        <div class="wre-modal-header">
          <span class="wre-modal-title">🎨 主题设置</span>
          <button class="wre-modal-close" data-close="#wre-theme-settings-modal">&times;</button>
        </div>
        <div class="wre-modal-body">
          <div class="wre-setting-item">
            <label class="wre-setting-label">预设主题</label>
            <div class="wre-theme-options" id="wre-theme-options">
              <button class="wre-btn wre-theme-btn" data-theme="light">☀️ 明亮</button>
              <button class="wre-btn wre-theme-btn" data-theme="dark">🌙 暗黑</button>
              <button class="wre-btn wre-theme-btn" data-theme="eye-protection">👁️ 护眼</button>
            </div>
            <p class="wre-theme-hint">插件主题与官方主题独立运行。如需恢复官方原生外观，点击下方按钮清除所有插件样式</p>
            <button class="wre-btn" id="wre-clear-plugin-theme-btn" style="margin-top:8px;width:100%;background:#f0f0f0;color:#333;border:1px solid #ddd;">↩️ 使用官方主题（清除插件样式）</button>
          </div>
        </div>
      </div>
    </div>

    <div class="wre-modal-overlay" id="wre-shortcuts-modal">
      <div class="wre-modal">
        <div class="wre-modal-header">
          <span class="wre-modal-title">⌨️ 快捷键说明</span>
          <button class="wre-modal-close" data-close="#wre-shortcuts-modal">&times;</button>
        </div>
        <div class="wre-modal-body">
          <table class="wre-shortcuts-table">
            <thead>
              <tr><th>快捷键</th><th>功能</th><th>状态</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><span class="wre-shortcut-key">←</span><span class="wre-shortcut-sep">/</span><span class="wre-shortcut-key">→</span></td>
                <td>上一页 / 下一页</td>
                <td>启用</td>
              </tr>
              <tr>
                <td><span class="wre-shortcut-key">Space</span></td>
                <td>播放 / 暂停自动阅读</td>
                <td id="wre-shortcut-autoread-status">启用</td>
              </tr>
              <tr>
                <td><span class="wre-shortcut-key">D</span></td>
                <td>开启 / 关闭勿扰模式</td>
                <td id="wre-shortcut-dnd-status">启用</td>
              </tr>
              <tr>
                <td><span class="wre-shortcut-key">F</span></td>
                <td>进入 / 退出全屏（全屏时屏比自动设为 100%）</td>
                <td>启用</td>
              </tr>
              <tr>
                <td><span class="wre-shortcut-key">?</span></td>
                <td>显示 / 隐藏此帮助面板</td>
                <td>启用</td>
              </tr>
            </tbody>
          </table>
          <div class="wre-shortcuts-footer">提示：快捷键仅在微信读书网页内生效，输入框中不触发</div>
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

/* ========== 自动阅读 ========== */

function findScrollTarget() {
  const docEl = document.documentElement;

  // 探测 window：滚 1px 看位置是否变化
  const prevWinBehavior = docEl.style.scrollBehavior;
  docEl.style.scrollBehavior = 'auto';
  const winBefore = window.scrollY;
  window.scrollBy(0, 1);
  if (window.scrollY !== winBefore) {
    window.scrollBy(0, -1);
    docEl.style.scrollBehavior = prevWinBehavior;
    return 'window';
  }
  docEl.style.scrollBehavior = prevWinBehavior;

  // 探测常见阅读容器
  const containers = document.querySelectorAll(
    '.app_content, .readerChapterContent_container, .readerContent, [class*="reader-scroll"]'
  );
  for (const el of containers) {
    const prevBehavior = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';
    const before = el.scrollTop;
    el.scrollTop += 1;
    if (el.scrollTop !== before) {
      el.scrollTop -= 1;
      el.style.scrollBehavior = prevBehavior;
      return el;
    }
    el.style.scrollBehavior = prevBehavior;
  }

  // 无可滚动容器 → Canvas 模式
  return 'canvas';
}

function scrollTargetBy(target, dy) {
  if (target === 'window') {
    const docEl = document.documentElement;
    const prevBehavior = docEl.style.scrollBehavior;
    docEl.style.scrollBehavior = 'auto';
    const before = window.scrollY;
    window.scrollBy(0, dy);
    docEl.style.scrollBehavior = prevBehavior;
    return { top: window.scrollY, stuck: window.scrollY === before };
  }
  if (target === 'canvas') {
    const key = dy > 0 ? 'ArrowDown' : 'ArrowUp';
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key, code: key,
      keyCode: dy > 0 ? 40 : 38,
      which: dy > 0 ? 40 : 38,
      bubbles: true, cancelable: true,
    }));
    return { top: 0, stuck: false };
  }
  if (target instanceof Element) {
    const prevBehavior = target.style.scrollBehavior;
    target.style.scrollBehavior = 'auto';
    const before = target.scrollTop;
    target.scrollTop += dy;
    target.style.scrollBehavior = prevBehavior;
    return { top: target.scrollTop, stuck: target.scrollTop === before };
  }
  // fallback
  const before = window.scrollY;
  window.scrollBy(0, dy);
  return { top: window.scrollY, stuck: window.scrollY === before };
}

function startAutoRead() {
  if (autoReadTimer) return;

  const scrollTarget = findScrollTarget();
  const speedPxPerSec = WRE_STATE.autoRead.speed;
  const direction = WRE_STATE.autoRead.direction === 'up' ? -1 : 1;

  // Canvas 模式：用定时器限频派发键盘事件（速度 10→3s/次，100→0.3s/次）
  if (scrollTarget === 'canvas') {
    const intervalMs = Math.max(200, Math.round(3000 - (speedPxPerSec - 10) * (2800 / 90)));
    const key = direction === 1 ? 'ArrowDown' : 'ArrowUp';
    const keyCode = direction === 1 ? 40 : 38;

    function tick() {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key, code: key, keyCode, which: keyCode,
        bubbles: true, cancelable: true,
      }));
    }

    tick(); // 立即执行一次
    autoReadTimer = window.setInterval(tick, intervalMs);
    autoReadIsInterval = true;
    WRE_STATE.autoRead.enabled = true;
    autoReadPaused = false;
    updateAutoReadUI();
    log('info', '自动阅读已启动 (Canvas 模式)', {
      speed: speedPxPerSec, direction: WRE_STATE.autoRead.direction, intervalMs,
    });
    return;
  }

  // 滚动模式：rAF + 像素累积
  let lastTime = performance.now();
  let accumulatedPx = 0;
  let stuckCount = 0;

  function step(now) {
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    accumulatedPx += speedPxPerSec * dt;

    const pixels = Math.floor(accumulatedPx);
    if (pixels > 0) {
      accumulatedPx -= pixels;
      const result = scrollTargetBy(scrollTarget, pixels * direction);

      if (result.stuck) {
        stuckCount++;
        if (stuckCount >= 3) {
          stopAutoRead();
          updateAutoReadUI();
          return;
        }
      } else {
        stuckCount = 0;
      }
    }

    autoReadTimer = requestAnimationFrame(step);
  }

  autoReadTimer = requestAnimationFrame(step);
  WRE_STATE.autoRead.enabled = true;
  autoReadPaused = false;
  updateAutoReadUI();
  log('info', '自动阅读已启动 (滚动模式)', {
    speed: speedPxPerSec,
    direction: WRE_STATE.autoRead.direction,
    scrollTarget: scrollTarget === 'window' ? 'window' : (scrollTarget.className || scrollTarget.tagName),
  });
}

function clearAutoReadTimer() {
  if (autoReadTimer == null) return;
  if (autoReadIsInterval) {
    clearInterval(autoReadTimer);
  } else {
    cancelAnimationFrame(autoReadTimer);
  }
  autoReadTimer = null;
  autoReadIsInterval = false;
}

function stopAutoRead() {
  clearAutoReadTimer();
  WRE_STATE.autoRead.enabled = false;
  autoReadPaused = false;
  updateAutoReadUI();
  log('info', '自动阅读已停止');
}

function toggleAutoRead() {
  if (autoReadTimer) {
    stopAutoRead();
  } else {
    startAutoRead();
  }
  saveState();
}

function setAutoReadSpeed(speed) {
  WRE_STATE.autoRead.speed = speed;
  updateAutoReadUI();
  // 滚动中需要重启以应用新速度/间隔
  if (autoReadTimer) {
    clearAutoReadTimer();
    startAutoRead();
  }
  log('info', '自动阅读速度已调整', { speed });
}

function setAutoReadDirection(dir) {
  WRE_STATE.autoRead.direction = dir;
  if (autoReadTimer) {
    clearAutoReadTimer();
    startAutoRead();
  }
  updateAutoReadUI();
  log('info', '自动阅读方向已切换', { direction: dir });
}

function updateAutoReadUI() {
  if (!wreRoot) return;

  try {
    const toggleText = wreRoot.querySelector('#wre-autoread-toggle-text');
    const toggleBtn = wreRoot.querySelector('#wre-autoread-toggle');
    const speedSlider = wreRoot.querySelector('#wre-autoread-speed');
    const speedValue = wreRoot.querySelector('#wre-autoread-speed-value');
    const dirDown = wreRoot.querySelector('#wre-dir-down');
    const dirUp = wreRoot.querySelector('#wre-dir-up');

    if (toggleText) {
      toggleText.textContent = WRE_STATE.autoRead.enabled ? '⏸ 暂停自动阅读' : '▶ 开始自动阅读';
    }
    if (toggleBtn) {
      toggleBtn.classList.toggle('wre-autoread-active', WRE_STATE.autoRead.enabled);
    }
    if (speedSlider) {
      speedSlider.value = String(WRE_STATE.autoRead.speed);
    }
    if (speedValue) {
      speedValue.textContent = String(WRE_STATE.autoRead.speed);
    }
    if (dirDown) {
      dirDown.classList.toggle('wre-dir-active', WRE_STATE.autoRead.direction === 'down');
    }
    if (dirUp) {
      dirUp.classList.toggle('wre-dir-active', WRE_STATE.autoRead.direction === 'up');
    }
  } catch (err) {
    log('error', 'updateAutoReadUI 失败', { error: String(err) });
  }
}

/* ========== 快捷键系统（阶段四） ========== */

function toggleDndMode() {
  WRE_STATE.dndMode = !WRE_STATE.dndMode;
  if (wreRoot) {
    wreRoot.classList.toggle('wre-dnd', WRE_STATE.dndMode);
  }
  saveState();
  log('info', '勿扰模式已切换', { dndMode: WRE_STATE.dndMode });
}

function toggleShortcutsHelp() {
  const modal = wreRoot?.querySelector('#wre-shortcuts-modal');
  if (!modal) return;
  const isVisible = modal.classList.contains('wre-visible');
  if (isVisible) {
    modal.classList.remove('wre-visible');
  } else {
    modal.classList.add('wre-visible');
  }
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    // 进入全屏：保存当前状态，屏比设为 100%，开启勿扰隐藏图标
    wreFullscreenPreviousRatio = WRE_STATE.screenRatio;
    wreFullscreenPreviousDnd = WRE_STATE.dndMode;
    WRE_STATE.screenRatio = 100;
    applyScreenRatio(100);
    scheduleWereadLayoutReflow('fullscreen-enter');
    updateScreenRatioUI();
    if (!WRE_STATE.dndMode) {
      WRE_STATE.dndMode = true;
      if (wreRoot) wreRoot.classList.add('wre-dnd');
    }
    document.documentElement.requestFullscreen().catch((err) => {
      log('warn', '进入全屏失败', { error: String(err) });
    });
    saveState();
    log('info', '进入全屏模式', { previousRatio: wreFullscreenPreviousRatio });
  } else {
    // 退出全屏
    document.exitFullscreen().then(() => {
      // 恢复在 fullscreenchange 事件中处理
    }).catch((err) => {
      log('warn', '退出全屏失败', { error: String(err) });
    });
  }
}

function handleFullscreenChange() {
  if (!document.fullscreenElement && wreFullscreenPreviousRatio !== null) {
    // 恢复屏占比
    const restoreRatio = wreFullscreenPreviousRatio;
    wreFullscreenPreviousRatio = null;
    WRE_STATE.screenRatio = restoreRatio;
    applyScreenRatio(restoreRatio);
    scheduleWereadLayoutReflow('fullscreen-exit');
    updateScreenRatioUI();

    // 恢复勿扰状态：仅当初 DND 关闭时才退出勿扰
    if (wreFullscreenPreviousDnd === false) {
      WRE_STATE.dndMode = false;
      if (wreRoot) wreRoot.classList.remove('wre-dnd');
    }
    wreFullscreenPreviousDnd = null;

    saveState();
    log('info', '退出全屏模式，已恢复屏占比和勿扰状态', { restoredRatio: restoreRatio });
  }
}

function updateScreenRatioUI() {
  if (!wreRoot) return;
  const slider = wreRoot.querySelector('#wre-screen-ratio');
  const value = wreRoot.querySelector('#wre-screen-ratio-value');
  if (slider) slider.value = String(WRE_STATE.screenRatio);
  if (value) value.textContent = `${WRE_STATE.screenRatio}%`;
}

function handleAllKeyboard(event) {
  // 只响应真实键盘事件，忽略程序派发的事件
  if (!event.isTrusted) return;

  // 不在输入框内响应快捷键
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || document.activeElement?.isContentEditable) {
    return;
  }

  switch (event.key) {
    case ' ':
      event.preventDefault();
      toggleAutoRead();
      break;
    case 'd':
    case 'D':
      event.preventDefault();
      toggleDndMode();
      break;
    case 'f':
    case 'F':
      event.preventDefault();
      toggleFullscreen();
      break;
    case '?':
      event.preventDefault();
      toggleShortcutsHelp();
      break;
  }
}

/* ========== UI 事件绑定 ========== */

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

  // 主题按钮事件
  const themeOptions = root.querySelector('#wre-theme-options');
  if (themeOptions) {
    themeOptions.addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-theme]');
      if (!btn) return;
      const theme = btn.getAttribute('data-theme');
      if (theme === WRE_STATE.theme) return;
      WRE_STATE.theme = theme;
      applyTheme(theme);
      highlightActiveTheme();
      await saveState();
      log('info', '主题已切换', { theme });
    });
  }

  // 使用官方主题按钮事件
  const clearPluginThemeBtn = root.querySelector('#wre-clear-plugin-theme-btn');
  if (clearPluginThemeBtn) {
    clearPluginThemeBtn.addEventListener('click', async () => {
      clearPluginTheme();
      await saveState();
      log('info', '已清除插件主题，官方主题接管');
    });
  }

  fab.addEventListener('click', (event) => {
    event.stopPropagation();
    // 勿扰模式下点击图标 → 先退出勿扰再打开菜单
    if (WRE_STATE.dndMode) {
      WRE_STATE.dndMode = false;
      wreRoot.classList.remove('wre-dnd');
      saveState();
      log('info', '点击图标退出勿扰模式');
    }
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

  // 自动阅读：开始/暂停
  const autoReadToggle = root.querySelector('#wre-autoread-toggle');
  if (autoReadToggle) {
    autoReadToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      try {
        toggleAutoRead();
      } catch (err) {
        log('error', '自动阅读切换失败', { error: String(err) });
      }
    });
  }

  // 自动阅读：速度滑块
  const autoReadSpeed = root.querySelector('#wre-autoread-speed');
  if (autoReadSpeed) {
    let autoReadSpeedChangeTimer = null;
    autoReadSpeed.addEventListener('input', () => {
      const speed = Number.parseInt(autoReadSpeed.value, 10);
      const speedValue = root.querySelector('#wre-autoread-speed-value');
      if (speedValue) speedValue.textContent = String(speed);
      if (autoReadSpeedChangeTimer) clearTimeout(autoReadSpeedChangeTimer);
      autoReadSpeedChangeTimer = setTimeout(async () => {
        setAutoReadSpeed(speed);
        await saveState();
      }, 300);
    });
    autoReadSpeed.addEventListener('change', async () => {
      const speed = Number.parseInt(autoReadSpeed.value, 10);
      setAutoReadSpeed(speed);
      await saveState();
    });
  }

  // 自动阅读：方向切换
  const dirButtons = root.querySelectorAll('.wre-dir-btn');
  dirButtons.forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const dir = btn.getAttribute('data-dir');
      if (dir !== WRE_STATE.autoRead.direction) {
        setAutoReadDirection(dir);
        await saveState();
      }
    });
  });

  // 自动阅读：速度快捷按钮
  const speedQuick = root.querySelector('#wre-autoread-speed-quick');
  if (speedQuick) {
    speedQuick.addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-speed]');
      if (!btn) return;
      event.stopPropagation();
      const speed = Number.parseInt(btn.getAttribute('data-speed'), 10);
      setAutoReadSpeed(speed);
      await saveState();
    });
  }
}

function handleMenuClick(action) {
  log('info', '用户触发菜单操作', { action });

  switch (action) {
    case 'read-settings':
      openModal('#wre-read-settings-modal');
      break;
    case 'theme-settings':
      openModal('#wre-theme-settings-modal');
      highlightActiveTheme();
      scanOfficialThemeButtons();
      break;
    case 'debug-logs':
      openModal('#wre-debug-modal');
      collectLayoutSnapshot();
      break;
    case 'restore-default':
      stopAutoRead();
      WRE_STATE = { ...WRE_DEFAULT_STATE };
      applyTheme(WRE_STATE.theme);
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
        updateAutoReadUI();
      }
      log('warn', '已恢复默认设置', applied);
      break;
    case 'shortcuts':
      openModal('#wre-shortcuts-modal');
      break;
    case 'clear-plugin-theme':
      const mainMenu = document.querySelector('#wre-main-menu');
      if (mainMenu) mainMenu.classList.remove('wre-visible');
      clearPluginTheme();
      saveState();
      log('info', '已清除插件主题，官方主题接管');
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
  // #region debug-point init-theme-before-apply
  log('info', '初始化准备应用主题', {
    theme: WRE_STATE.theme,
    screenRatio: WRE_STATE.screenRatio,
    bodyClassBefore: document.body?.className || '',
  });
  // #endregion
  registerRuntimeErrorHooks();
  createUI();

  ensureStyleTag();
  wreStyleTag.textContent = '';
  await primeScreenBasePx(true);
  await applySavedScreenRatioOnInit();
  // 应用保存的主题
  applyTheme(WRE_STATE.theme);
  // #region debug-point init-theme-after-apply
  log('info', '初始化已调用 applyTheme', {
    theme: WRE_STATE.theme,
    bodyClassAfter: document.body?.className || '',
  });
  // #endregion

  // 监听 <head> 中 <style> 标签注入，确保我们的样式始终在最后（优先级最高）
  let headMoveTimer = null;
  const headObserver = new MutationObserver((mutations) => {
    // 只关心新增的 <style> 标签
    const hasNewStyle = mutations.some((m) =>
      Array.from(m.addedNodes).some((n) => n.nodeName === 'STYLE' && n.id !== 'we-read-enhancer-style')
    );
    if (!hasNewStyle) return;

    if (headMoveTimer) clearTimeout(headMoveTimer);
    headMoveTimer = setTimeout(() => {
      const ourStyle = document.getElementById('we-read-enhancer-style');
      if (ourStyle && ourStyle !== document.head.lastElementChild) {
        document.head.appendChild(ourStyle);
        log('info', '已将插件样式移至 <head> 末尾');
      }
      headMoveTimer = null;
    }, 30);
  });
  headObserver.observe(document.head, { childList: true });

  // 注册键盘快捷键
  document.addEventListener('keydown', handleAllKeyboard);

  // 监听全屏变化（Esc 键或浏览器按钮退出全屏时恢复屏占比）
  document.addEventListener('fullscreenchange', handleFullscreenChange);
}

if (document.body) {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init);
}
