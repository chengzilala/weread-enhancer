const WRE_PREFIX = '[Wechat-Reader-Enhancer]';
const WRE_STORAGE_KEYS = {
  state: 'wreState',
  logs: 'wreDebugLogs',
  onboardingVersion: 'wreOnboardingVersion',
};
const WRE_DEFAULT_STATE = {
  dndMode: false,
  screenRatio: 80,
  screenBasePx: null,
  screenBaseMode: 'container-v1',
  autoRead: {
    enabled: false,
    speed: 50,
    direction: 'down',
  },
  // M13：匿名使用统计（默认开启，可一键关闭；见 modules/telemetry.js）
  telemetryEnabled: true,
};
const WRE_MAX_LOGS = 200;

let WRE_STATE = { ...WRE_DEFAULT_STATE };
let wreLoadedOnboardingVersion = null; // 从 storage 读取的引导版本号，避免二次读取
let WRE_LOGS = [];
let wreStyleTag = null;
let wreRoot = null;
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
      textAlign: computed.textAlign,
      cssFloat: computed.float,
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
  // 日志仅存内存，不再写入 storage 以优化性能
  // 需要导出时点击调试面板的「下载日志」按钮
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
  while (current && depth < 8) {
    snapshot.parentChain.push({
      depth,
      selectorHint: `${current.tagName.toLowerCase()}${current.id ? `#${current.id}` : ''}${current.className ? `.${String(current.className).trim().replace(/\s+/g, '.')}` : ''}`,
      element: serializeElement(current),
    });
    current = current.parentElement;
    depth += 1;
  }

  // 页面结构摘要，仅记录关键指标，不序列化整个 DOM
  const chapterCount = allChapterContents.length;
  const issues = [];
  if (chapterCount === 0) {
    issues.push('未找到 .readerChapterContent');
  }
  if (!document.querySelector('.readerContent')) {
    issues.push('不存在 .readerContent');
  }
  if (chapterCount > 1) {
    issues.push(`当前存在多个 .readerChapterContent（${chapterCount} 个）`);
  }
  log('info', '页面结构摘要', {
    viewport: snapshot.viewport,
    chapterCount,
    readerChapterContentRect: snapshot.selectors['.readerChapterContent']?.rect ?? null,
    toolbarFloatEnabled: document.body.classList.contains('wre-toolbar-floating'),
    issues,
  });

  // 阅读模式判定 + 水平滚动检测（用于诊断滚动模式下屏占比不适配）
  const docEl = document.documentElement;
  const readingModeGuess = {
    hasHorizontalReader: !!document.querySelector('.wr_horizontalReader, [class*="wr_horizontalReader"]'),
    hasChapterContainer: !!document.querySelector('.readerChapterContent_container'),
    hasReaderContent: !!document.querySelector('.readerContent'),
    hasCanvas: !!document.querySelector('.wr_canvasContainer, canvas'),
  };
  const docScroll = {
    scrollWidth: docEl.scrollWidth,
    clientWidth: docEl.clientWidth,
    innerWidth: window.innerWidth,
    hasHorizontalScroll: docEl.scrollWidth > window.innerWidth + 1,
  };
  // 完整快照（父级链 + 各选择器详情）写入日志，供下载排查滚动模式布局
  log('info', '页面结构快照(完整)', {
    state: snapshot.state,
    viewport: snapshot.viewport,
    readingModeGuess,
    docScroll,
    selectors: snapshot.selectors,
    chapterContents: snapshot.selectorsAll,
    parentChain: snapshot.parentChain,
  });

  // 滚动容器探测：定位真正带竖直滚动条的元素，用于精准美化滚动条
  const scrollables = [];
  const scrollingEl = document.scrollingElement;
  if (scrollingEl) {
    scrollables.push({
      which: 'scrollingElement',
      selectorHint: `${scrollingEl.tagName.toLowerCase()}${scrollingEl.id ? '#' + scrollingEl.id : ''}`,
      scrollHeight: scrollingEl.scrollHeight,
      clientHeight: scrollingEl.clientHeight,
      canScrollY: scrollingEl.scrollHeight > scrollingEl.clientHeight + 4,
    });
  }
  let scanned = 0;
  for (const el of document.querySelectorAll('body *')) {
    if (scanned > 5000) break;
    scanned += 1;
    if (el.id === 'we-read-enhancer-root' || el.closest('#we-read-enhancer-root')) continue;
    if (el.clientHeight > 200 && el.scrollHeight > el.clientHeight + 20) {
      const cs = window.getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY)) {
        const cls = typeof el.className === 'string' ? el.className.trim().replace(/\s+/g, '.') : '';
        scrollables.push({
          selectorHint: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls ? '.' + cls : ''}`.slice(0, 140),
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          overflowY: cs.overflowY,
        });
      }
    }
  }
  log('info', '滚动容器探测', {
    windowScrollY: window.scrollY,
    scrollingElScrollTop: scrollingEl?.scrollTop,
    count: scrollables.length,
    scrollables,
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
    const result = await chrome.storage.local.get([WRE_STORAGE_KEYS.state, WRE_STORAGE_KEYS.onboardingVersion]);
    log('info', '初始化读取存储状态', {
      hasState: Boolean(result[WRE_STORAGE_KEYS.state]),
      storedScreenRatio: result[WRE_STORAGE_KEYS.state]?.screenRatio || null,
    });
    // 缓存 onboarding 版本，供 init() 使用，避免二次 storage 读取
    wreLoadedOnboardingVersion = result[WRE_STORAGE_KEYS.onboardingVersion] || null;
    if (result[WRE_STORAGE_KEYS.state]) {
      WRE_STATE = { ...WRE_DEFAULT_STATE, ...result[WRE_STORAGE_KEYS.state] };
    }
    if (WRE_STATE.screenBaseMode !== WRE_DEFAULT_STATE.screenBaseMode) {
      WRE_STATE.screenBaseMode = WRE_DEFAULT_STATE.screenBaseMode;
      WRE_STATE.screenBasePx = null;
      await chrome.storage.local.set({ [WRE_STORAGE_KEYS.state]: WRE_STATE });
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

// 判定阅读方式：翻页模式有 .readerChapterContent_container 作为宽度基准；
// 滚动模式没有该容器，正文由固定宽居中的 .app_content 承载。
function detectScrollMode() {
  return !document.querySelector('.readerChapterContent_container')
    && !!document.querySelector('.app_content');
}

// 生成屏占比宽度 CSS（按阅读方式分流），供 updateStyleTag 使用
function buildRatioCSS(ratio) {
  const numericRatio = clampNumber(Number(ratio), 50, 100);

  if (detectScrollMode()) {
    // 滚动模式：作用于原生正文容器 .app_content，用相对视口的百分比 max-width 居中，
    // 不沿用翻页模式的固定 px 基准（否则会超出原生容器宽度导致溢出 + 不居中 + 水平滚动条）。
    return `
      .app_content {
        width: ${numericRatio}% !important;
        max-width: ${numericRatio}% !important;
        margin-left: auto !important;
        margin-right: auto !important;
        box-sizing: border-box !important;
      }
      .readerChapterContent {
        width: 100% !important;
        max-width: 100% !important;
        margin-left: auto !important;
        margin-right: auto !important;
        box-sizing: border-box !important;
      }
    `;
  }

  // 翻页模式：沿用固定 px 基准（.readerChapterContent_container 宽度 × 比例）
  const basePx = Number.isFinite(WRE_STATE.screenBasePx) && WRE_STATE.screenBasePx > 0 ? WRE_STATE.screenBasePx : null;
  const targetPx = basePx ? Math.round((basePx * numericRatio) / 100) : null;
  if (targetPx) {
    return `
      .readerChapterContent {
        width: ${targetPx}px !important;
        max-width: ${targetPx}px !important;
        margin-left: auto !important;
        margin-right: auto !important;
        box-sizing: border-box !important;
      }
    `;
  }
  return `
    .readerChapterContent {
      max-width: ${numericRatio}% !important;
      margin-left: auto !important;
      margin-right: auto !important;
      box-sizing: border-box !important;
    }
  `;
}

function updateStyleTag(ratio) {
  ensureStyleTag();
  const numericRatio = clampNumber(Number(ratio), 50, 100);
  const scrollMode = detectScrollMode();
  const basePx = Number.isFinite(WRE_STATE.screenBasePx) && WRE_STATE.screenBasePx > 0 ? WRE_STATE.screenBasePx : null;
  const targetPx = (!scrollMode && basePx) ? Math.round((basePx * numericRatio) / 100) : null;

  wreStyleTag.textContent = `
    ${buildRatioCSS(numericRatio)}
    ${toolbarFloatCSS}
  `;

  // 仅滚动模式启用视口滚动条美化的作用域标记（翻页模式/书架页不受影响）
  document.documentElement.classList.toggle('wre-scrollmode', scrollMode);
  if (scrollMode) {
    ensureCustomScrollbar();
    updateCustomScrollbar();
  } else {
    document.documentElement.classList.remove('wre-show-scrollbar');
    if (wreCustomScrollbar) { wreCustomScrollbar.style.display = 'none'; }
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
    if (scrollMode) {
      // 滚动模式：工具栏不会被推出视口，改用「正文盖住工具栏区域」判定。
      // 顶栏宽度/位置不随浮动改变（pinTopBar 只加 z-index），且正文与顶栏同中心，
      // 用正文宽度是否超过顶栏原生宽度作参照：正文更宽即左右超出顶栏并顶到右侧 controls。
      // 用稳定参照避免浮动移动 controls 后判定值来回变化导致的抖动。
      const content = document.querySelector('.app_content') || document.querySelector('.readerChapterContent');
      const contentRect = content ? content.getBoundingClientRect() : null;
      enableToolbarFloat = !!contentRect && contentRect.width > tr.width + 4;
    } else {
      // 翻页模式：① 比例 >85%（86% 及以上触发，85% 刚好放下工具栏）；② 元素实际溢出视口（兜底）
      enableToolbarFloat = numericRatio > 85 || tr.left < -1 || tr.right > window.innerWidth + 1 || cr.right > window.innerWidth;
    }
    log('info', '工具栏位置检测', {
      mode: scrollMode ? 'scroll' : 'page',
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

function inspectAppliedLayout() {
  const elements = Array.from(document.querySelectorAll('.readerChapterContent')).slice(0, 10);
  log('info', '布局应用后检查', {
    count: document.querySelectorAll('.readerChapterContent').length,
    elements: elements.map((el) => serializeElement(el)),
  });
}

let wreToolbarMoveHandler = null; // 鼠标位置监听（替代透明感应层，避免遮挡点击）
let wreToolbarHideTimer = null;
let wreToolbarRightTimer = null;

// 顶部 / 右侧感应阈值（px）
const WRE_TOPBAR_ZONE_PX = 100;
const WRE_CONTROLS_ZONE_PX = 120;

// 自绘悬浮滚动条（滚动模式，隐藏原生滚动条后替代）
let wreCustomScrollbar = null;
let wreCustomScrollbarThumb = null;
let wreScrollbarDragging = false;

function pinTopBar() {
  const topBar = document.querySelector('.readerTopBar');
  if (!topBar) return false;
  // 顶栏浮现时层级高于正文，保证按钮可点击（感应已改为鼠标位置判断，无覆盖层）
  topBar.style.setProperty('z-index', '999998', 'important');
  // 浮现时水平居中于视口，视觉更协调（原生仅相对内容区居中，浮在满宽正文上会略偏）
  const width = topBar.offsetWidth;
  if (width > 0) {
    const left = Math.max(0, Math.round((window.innerWidth - width) / 2));
    topBar.style.setProperty('left', left + 'px', 'important');
    topBar.style.setProperty('right', 'auto', 'important');
    topBar.style.setProperty('transform', 'none', 'important');
  }
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

  if (wreToolbarMoveHandler) {
    document.removeEventListener('mousemove', wreToolbarMoveHandler, true);
    wreToolbarMoveHandler = null;
  }

  document.body.classList.remove('wre-show-topbar');
  document.body.classList.remove('wre-show-controls');
  log('info', '已移除工具栏浮动');
}

function ensureToolbarTrigger() {
  if (wreToolbarMoveHandler) return;

  const showTop = () => {
    if (wreToolbarHideTimer) { clearTimeout(wreToolbarHideTimer); wreToolbarHideTimer = null; }
    pinTopBar();
    document.body.classList.add('wre-show-topbar');
  };
  const hideTop = () => {
    if (wreToolbarHideTimer) return; // 已在淡出倒计时中，不重复计时
    wreToolbarHideTimer = setTimeout(() => {
      document.body.classList.remove('wre-show-topbar');
      wreToolbarHideTimer = null;
    }, 400);
  };

  const showRight = () => {
    if (wreToolbarRightTimer) { clearTimeout(wreToolbarRightTimer); wreToolbarRightTimer = null; }
    pinControls();
    document.body.classList.add('wre-show-controls');
  };
  const hideRight = () => {
    if (wreToolbarRightTimer) return;
    wreToolbarRightTimer = setTimeout(() => {
      document.body.classList.remove('wre-show-controls');
      wreToolbarRightTimer = null;
    }, 400);
  };

  // 用鼠标位置判断代替透明感应层：感应层即使完全透明也会吃掉点击，压住官方「下一页」点击区
  wreToolbarMoveHandler = (event) => {
    if (event.clientY <= WRE_TOPBAR_ZONE_PX) showTop(); else hideTop();
    if (window.innerWidth - event.clientX <= WRE_CONTROLS_ZONE_PX) showRight(); else hideRight();
  };
  document.addEventListener('mousemove', wreToolbarMoveHandler, true);

  log('info', '已启用工具栏悬停触发器（鼠标位置判断：顶部 100px / 右侧 120px，无遮挡层）');
}

// 获取视口滚动元素
function getViewportScroller() {
  return document.scrollingElement || document.documentElement;
}

// 更新自绘滚动条 thumb 的高度与位置（按当前滚动状态）
function updateCustomScrollbar() {
  if (!wreCustomScrollbar || !wreCustomScrollbarThumb) return;
  if (!document.documentElement.classList.contains('wre-scrollmode')) return;
  const se = getViewportScroller();
  const sh = se.scrollHeight;
  const ch = se.clientHeight;
  if (sh <= ch + 4) {
    wreCustomScrollbar.style.display = 'none';
    return;
  }
  wreCustomScrollbar.style.display = 'block';
  const trackH = wreCustomScrollbar.clientHeight || window.innerHeight;
  const thumbH = Math.max(40, Math.round((trackH * ch) / sh));
  const maxScroll = sh - ch;
  const maxThumbTop = trackH - thumbH;
  const thumbTop = maxScroll > 0 ? Math.round(maxThumbTop * (se.scrollTop / maxScroll)) : 0;
  wreCustomScrollbarThumb.style.height = `${thumbH}px`;
  wreCustomScrollbarThumb.style.top = `${thumbTop}px`;
}

// 创建自绘悬浮滚动条（幂等）
function ensureCustomScrollbar() {
  if (wreCustomScrollbar && document.body.contains(wreCustomScrollbar)) return;
  const bar = document.createElement('div');
  bar.id = 'wre-custom-scrollbar';
  const thumb = document.createElement('div');
  thumb.id = 'wre-custom-scrollbar-thumb';
  bar.appendChild(thumb);
  document.body.appendChild(bar);
  wreCustomScrollbar = bar;
  wreCustomScrollbarThumb = thumb;

  // 拖动 thumb 跳转
  let dragStartY = 0;
  let dragStartScroll = 0;
  thumb.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    wreScrollbarDragging = true;
    dragStartY = e.clientY;
    dragStartScroll = getViewportScroller().scrollTop;
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', (e) => {
    if (!wreScrollbarDragging) return;
    const se = getViewportScroller();
    const sh = se.scrollHeight;
    const ch = se.clientHeight;
    const trackH = bar.clientHeight || window.innerHeight;
    const thumbH = thumb.offsetHeight;
    const maxThumbTop = trackH - thumbH;
    const maxScroll = sh - ch;
    if (maxThumbTop <= 0) return;
    const deltaY = e.clientY - dragStartY;
    se.scrollTop = dragStartScroll + (deltaY / maxThumbTop) * maxScroll;
  });
  document.addEventListener('mouseup', () => {
    if (wreScrollbarDragging) {
      wreScrollbarDragging = false;
      document.body.style.userSelect = '';
    }
  });

  // 点击 track 空白处跳转到对应位置
  bar.addEventListener('mousedown', (e) => {
    if (e.target !== bar) return;
    const se = getViewportScroller();
    const rect = bar.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    se.scrollTop = ratio * (se.scrollHeight - se.clientHeight);
    updateCustomScrollbar();
  });

  log('info', '已创建自绘悬浮滚动条');
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
  if (WRE_STATE.dndMode) {
    root.classList.add('wre-dnd');
  }

  root.innerHTML = `
    <div class="wre-fab" id="wre-fab"><svg class="wre-fab-logo" viewBox="0 0 32 32" aria-hidden="true"><path d="M7 9 L12 23 L16 14 L20 23 L25 9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>

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

          <div class="wre-setting-item">
            <label class="wre-setting-label">📊 匿名使用统计</label>
            <div class="wre-setting-control" style="justify-content: space-between; align-items: center;">
              <span style="font-size: 12px; color: var(--wre-text); flex: 1; margin-right: 12px;">仅上报「随机匿名标识 + 版本号 + 日期 + 事件名」，不含阅读数据 / 账号 / Key。</span>
              <button class="wre-btn wre-btn-small" id="wre-telemetry-toggle">${WRE_STATE.telemetryEnabled === false ? '已关闭' : '已开启'}</button>
            </div>
            <div class="wre-setting-tip">默认开启，可随时关闭；关闭后立即停止上报。数据保留 90 天，到期只留聚合计数。</div>
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

    <div class="wre-modal-overlay" id="wre-welcome-modal">
      <div class="wre-modal">
        <div class="wre-modal-header">
          <span class="wre-modal-title">欢迎使用微信读书增强插件</span>
          <button class="wre-modal-close" data-close="#wre-welcome-modal">&times;</button>
        </div>
        <div class="wre-modal-body">
          <p style="font-size:14px;color:var(--wre-text);margin:0 0 16px;line-height:1.6;">
            插件已就绪，阅读页面左下角 <span style="font-weight:600;">悬浮图标</span> 点击即可调出全部功能。
          </p>
          <table class="wre-shortcuts-table">
            <thead>
              <tr><th>快捷键</th><th>功能</th></tr>
            </thead>
            <tbody>
              <tr><td><span class="wre-shortcut-key">Space</span></td><td>播放 / 暂停自动阅读</td></tr>
              <tr><td><span class="wre-shortcut-key">D</span></td><td>开启 / 关闭勿扰模式</td></tr>
              <tr><td><span class="wre-shortcut-key">F</span></td><td>进入 / 退出全屏模式</td></tr>
              <tr><td><span class="wre-shortcut-key">?</span></td><td>显示全部快捷键</td></tr>
            </tbody>
          </table>
          <p style="font-size:12px;color:var(--wre-text);margin:12px 0 0;line-height:1.6;">
            本插件默认开启<b>匿名使用统计</b>：仅上报「随机匿名标识 + 版本号 + 日期 + 事件名」，不含阅读数据 / 账号 / Key，可在「阅读设置」内一键关闭。
          </p>
          <div class="wre-shortcuts-footer">更多功能请点击左下角悬浮图标 → 查看菜单</div>
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

/** M13：同步「匿名使用统计」开关按钮文案 */
function updateTelemetryUI() {
  if (!wreRoot) return;
  const btn = wreRoot.querySelector('#wre-telemetry-toggle');
  if (btn) {
    btn.textContent = WRE_STATE.telemetryEnabled === false ? '已关闭' : '已开启';
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

  // 组合键不触发：Ctrl / Alt / Meta 按下时跳过，避免与浏览器原生快捷键冲突
  if (event.ctrlKey || event.altKey || event.metaKey) return;

  // 输入法组词中不响应，避免打断拼音输入
  if (event.isComposing) return;

  // 问号键：兼容中文输入法全角「？」与不同键盘布局，用物理键 Slash + Shift 兜底识别
  if (event.key === '?' || event.key === '？' || (event.code === 'Slash' && event.shiftKey)) {
    event.preventDefault();
    toggleShortcutsHelp();
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

  // 悬浮球：鼠标悬停即展开菜单（无需点击），移开后延迟收起
  let menuCloseTimer = null;
  const openMenu = () => {
    if (menuCloseTimer) { clearTimeout(menuCloseTimer); menuCloseTimer = null; }
    menu.classList.add('wre-visible');
  };
  const scheduleCloseMenu = () => {
    if (menuCloseTimer) clearTimeout(menuCloseTimer);
    menuCloseTimer = setTimeout(() => {
      menu.classList.remove('wre-visible');
      menuCloseTimer = null;
    }, 250);
  };
  fab.addEventListener('mouseenter', openMenu);
  fab.addEventListener('mouseleave', scheduleCloseMenu);
  menu.addEventListener('mouseenter', openMenu);
  menu.addEventListener('mouseleave', scheduleCloseMenu);

  fab.addEventListener('click', (event) => {
    event.stopPropagation();
    // 勿扰模式下点击图标 → 先退出勿扰再打开菜单
    if (WRE_STATE.dndMode) {
      WRE_STATE.dndMode = false;
      wreRoot.classList.remove('wre-dnd');
      saveState();
      log('info', '点击图标退出勿扰模式');
    }
    // 悬停已展开菜单，点击时保持展开（不再切换，避免"点一下反而收起"）
    openMenu();
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

  // M13：匿名使用统计开关（默认开启；关闭后不再上报）
  const telemetryToggle = root.querySelector('#wre-telemetry-toggle');
  if (telemetryToggle) {
    telemetryToggle.addEventListener('click', async (event) => {
      event.stopPropagation();
      WRE_STATE.telemetryEnabled = WRE_STATE.telemetryEnabled === false;
      updateTelemetryUI();
      await saveState();
      log('info', '匿名使用统计开关已切换', { enabled: WRE_STATE.telemetryEnabled });
    });
  }
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
      stopAutoRead();
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
        updateAutoReadUI();
        updateTelemetryUI();
      }
      log('warn', '已恢复默认设置', applied);
      break;
    case 'shortcuts':
      openModal('#wre-shortcuts-modal');
      break;
    case 'stats':
      // 阅读统计面板由 modules/stats.js 自行接管（它已绑定自己的 click），
      // 这里只做分流，避免落到 default 打出「尚未实现」的误导日志。
      break;
    case 'notes':
      // 笔记面板由 modules/notes.js 自行接管（它已绑定自己的 click），同上。
      break;
    case 'official':
      // 阅读洞察面板由 modules/official.js 自行接管（它已绑定自己的 click），同上。
      break;
    case 'finder':
      // 找书面板由 modules/finder.js 自行接管（它已绑定自己的 click），同上。
      break;
    case 'api-key':
      // API Key 设置面板由 modules/official.js 自行接管（它已绑定自己的 click），同上。
      break;
    case 'support-center':
      // 支持与反馈中心由 modules/support-center.js 自行接管（它已绑定自己的 click），同上。
      break;
    case 'help':
      // 帮助中心由 modules/help.js 自行接管（它已绑定自己的 click），同上。
      break;
    default:
      log('warn', '该菜单功能尚未实现', { action });
      break;
  }
}

async function applySavedScreenRatioOnInit() {
  const ratio = WRE_STATE.screenRatio;
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i += 1) {
    const container = getReaderContainerElement();
    const content = getPrimaryContentElement();
    const containerWidth = container?.getBoundingClientRect?.().width;
    const contentWidth = content?.getBoundingClientRect?.().width;
    const containerReady = Number.isFinite(containerWidth) && containerWidth > 0;
    const contentReady = Number.isFinite(contentWidth) && contentWidth > 0;

    // 翻页模式：基准容器 .readerChapterContent_container 是正文祖先，正文就绪即视为就绪；
    // 滚动模式：没有该基准容器，只要正文 .readerChapterContent + .app_content 就绪即可，
    // 不能再强等 container（否则滚动模式永远等不到，刷新后屏占比丢失）。
    const ready = containerReady
      ? contentReady
      : (detectScrollMode() && contentReady);

    if (ready) {
      const applied = applyScreenRatio(ratio);
      scheduleWereadLayoutReflow('init-apply');
      inspectAppliedLayout();
      collectLayoutSnapshot();
      log('info', '已在刷新后自动应用已保存的屏占比', applied);
      // 兜底：稍后再应用一次，防止早期模式判定/渲染时机偏差（如 app_content 晚于正文出现）
      setTimeout(() => {
        applyScreenRatio(WRE_STATE.screenRatio);
        log('info', '屏占比二次兜底应用', { ratio: WRE_STATE.screenRatio, scrollMode: detectScrollMode() });
      }, 800);
      return true;
    }

    await waitNextFrame();
  }

  log('warn', '刷新后自动应用屏占比失败（页面元素未就绪）', { ratio });
  return false;
}

async function init() {
  const t0 = performance.now();
  await loadState();
  const t1 = performance.now();
  log('info', '初始化准备应用屏占比', {
    screenRatio: WRE_STATE.screenRatio,
    bodyClassBefore: document.body?.className || '',
  });
  registerRuntimeErrorHooks();
  createUI();
  const t2 = performance.now();

  // M13：匿名使用统计（默认开启，可关闭；延迟上报，不抢加载）
  if (window.WRETelemetry && typeof window.WRETelemetry.schedule === 'function') {
    window.WRETelemetry.schedule(WRE_STATE);
  }

  // 新手引导：首次安装或版本更新时弹出欢迎面板（版本号已随 loadState 读取）
  const currentVersion = chrome.runtime.getManifest().version;
  const storedVersion = wreLoadedOnboardingVersion;
  const shouldShow = !storedVersion || storedVersion !== currentVersion;
  if (shouldShow) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        openModal('#wre-welcome-modal');
      });
    });
    // fire-and-forget，不阻塞后续 CSS 和屏占比应用
    chrome.storage.local.set({ [WRE_STORAGE_KEYS.onboardingVersion]: currentVersion });
    log('info', '新手引导已弹出', { version: currentVersion, prevStored: storedVersion || '无' });
  }

  ensureStyleTag();
  wreStyleTag.textContent = '';
  const t3 = performance.now();
  await primeScreenBasePx(true);
  const t4 = performance.now();
  await applySavedScreenRatioOnInit();
  const t5 = performance.now();
  log('info', '[perf] init 各阶段耗时', {
    loadState: Math.round(t1 - t0),
    createUI: Math.round(t2 - t1),
    storageGet: Math.round(t3 - t2),
    primeScreen: Math.round(t4 - t3),
    applyRatio: Math.round(t5 - t4),
    total: Math.round(t5 - t0),
  });

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

  // 滚动模式：鼠标靠近视口最右侧时淡入自绘滚动条，移开延迟淡出（拖动时不隐藏）
  let wreScrollbarHideTimer = null;
  const wreHideScrollbar = () => {
    if (wreScrollbarDragging) return;
    if (wreScrollbarHideTimer) { clearTimeout(wreScrollbarHideTimer); wreScrollbarHideTimer = null; }
    document.documentElement.classList.remove('wre-show-scrollbar');
  };
  document.addEventListener('mousemove', (e) => {
    if (!document.documentElement.classList.contains('wre-scrollmode')) return;
    const nearRight = e.clientX >= window.innerWidth - 24;
    if (nearRight) {
      if (wreScrollbarHideTimer) { clearTimeout(wreScrollbarHideTimer); wreScrollbarHideTimer = null; }
      document.documentElement.classList.add('wre-show-scrollbar');
      updateCustomScrollbar();
    } else if (!wreScrollbarDragging
        && document.documentElement.classList.contains('wre-show-scrollbar')
        && !wreScrollbarHideTimer) {
      wreScrollbarHideTimer = setTimeout(() => {
        document.documentElement.classList.remove('wre-show-scrollbar');
        wreScrollbarHideTimer = null;
      }, 400);
    }
  }, { passive: true });
  // 鼠标离开页面（移出窗口）时立即隐藏，避免最后一次 mousemove 停在右侧导致滚动条残留
  document.addEventListener('mouseleave', wreHideScrollbar);
  // 滚动 / 尺寸变化时更新自绘滚动条的位置与高度
  window.addEventListener('scroll', updateCustomScrollbar, { passive: true });
  window.addEventListener('resize', updateCustomScrollbar);

  // 监听全屏变化（Esc 键或浏览器按钮退出全屏时恢复屏占比）
  document.addEventListener('fullscreenchange', handleFullscreenChange);
}

if (document.body) {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init);
}
