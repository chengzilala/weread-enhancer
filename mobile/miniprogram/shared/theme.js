/**
 * 外观（明暗主题）
 *
 * 档位与 H5 端 h5/src/store.js 完全一致：auto（跟随系统）/ light / dark。
 * H5 用 <html data-theme> + CSS 变量；小程序用页面根节点 .wre-dark + app.wxss 变量。
 * 导航栏 / tabBar 交给 app.json 的 theme.json（原生跟随系统）；手动指定时再由这里
 * setNavigationBarColor / setTabBarStyle 覆盖一次。
 *
 * 全部只存本机（wx storage），不上传。
 */
const THEME_KEY = 'wre_theme';

/** 三档：跟随系统 / 浅色 / 深色（与 H5 文案一致） */
const THEME_TIERS = [
  { key: 'auto', label: '跟随系统' },
  { key: 'light', label: '浅色' },
  { key: 'dark', label: '深色' },
];

/** tabBar 页面（只有这些页可调用 setTabBarStyle） */
const TAB_ROUTES = [
  'pages/home/index',
  'pages/persona/index',
  'pages/report/index',
  'pages/shelf/index',
  'pages/settings/index',
];

function normalizeTheme(value) {
  return value === 'light' || value === 'dark' ? value : 'auto';
}

/** 系统当前主题：light | dark（需 app.json 配 darkmode:true 才有值，否则按 light） */
function systemTheme() {
  try {
    const info = wx.getSystemInfoSync();
    return info && info.theme === 'dark' ? 'dark' : 'light';
  } catch (e) {
    return 'light';
  }
}

function getTheme() {
  let v = '';
  try {
    v = wx.getStorageSync(THEME_KEY);
  } catch (e) {
    v = '';
  }
  return normalizeTheme(v);
}

/** 保存偏好；返回实际生效的档位 */
function setTheme(value) {
  const v = normalizeTheme(value);
  try {
    wx.setStorageSync(THEME_KEY, v);
  } catch (e) {
    // 存储失败也按本次生效处理
  }
  return v;
}

/** 当前实际生效的明暗：偏好为 auto 时按系统主题解析 */
function isDark(pref) {
  const p = pref === undefined ? getTheme() : normalizeTheme(pref);
  if (p === 'auto') {
    return systemTheme() === 'dark';
  }
  return p === 'dark';
}

function isTabPage() {
  try {
    const pages = getCurrentPages();
    const cur = pages[pages.length - 1];
    return !!cur && TAB_ROUTES.indexOf(cur.route) >= 0;
  } catch (e) {
    return false;
  }
}

/**
 * 把当前主题套到页面：同步导航栏 / tabBar 颜色，返回是否暗色。
 * 页面在 onShow 时调用，并把返回值写入 data.wreDark，驱动根节点加 .wre-dark。
 */
function apply() {
  const dark = isDark();
  try {
    wx.setNavigationBarColor({
      frontColor: '#ffffff',
      backgroundColor: '#2F6BFF',
      fail() {},
    });
  } catch (e) {
    // 低版本不支持时忽略
  }
  if (isTabPage()) {
    try {
      wx.setTabBarStyle({
        color: dark ? '#9AA0AA' : '#8A8F99',
        selectedColor: dark ? '#4E86FF' : '#2F6BFF',
        backgroundColor: dark ? '#22242A' : '#FFFFFF',
        borderStyle: dark ? 'white' : 'black',
        fail() {},
      });
    } catch (e) {
      // 低版本不支持时忽略
    }
  }
  return dark;
}

/** 监听系统主题切换：仅「跟随系统」时回调（用于页面内容即时刷新） */
function watch(cb) {
  try {
    if (typeof wx.onThemeChange !== 'function') {
      return;
    }
    wx.onThemeChange(function () {
      if (getTheme() === 'auto' && typeof cb === 'function') {
        cb();
      }
    });
  } catch (e) {
    // 低版本不支持时忽略
  }
}

module.exports = {
  THEME_TIERS,
  getTheme,
  setTheme,
  isDark,
  apply,
  watch,
};
