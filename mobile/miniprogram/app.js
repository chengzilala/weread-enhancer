const { CLOUD_ENV } = require('./config');
const ops = require('./shared/ops');
const theme = require('./shared/theme');
const logger = require('./shared/logger');

/** 出错弹窗：同一错误只弹一次，避免渲染循环把屏幕刷满 */
let lastShown = '';

function reportError(scope, err) {
  const text = (err && (err.message || err.errMsg)) || String(err || '未知错误');
  logger.error(scope, text, err);
  if (text === lastShown) {
    return;
  }
  lastShown = text;
  wx.showModal({
    title: '页面出错（已记日志）',
    content: String(text).slice(0, 300),
    showCancel: false,
    confirmText: '知道了',
  });
}

App({
  onError(err) {
    reportError('app', err);
  },

  onUnhandledRejection(res) {
    reportError('promise', (res && res.reason) || res);
  },

  onLaunch() {
    logger.log('app', 'onLaunch', { env: CLOUD_ENV || '(默认)' });
    if (!wx.cloud) {
      logger.error('app', '基础库版本过低，缺少 wx.cloud');
      console.error('[微信悦读] 当前基础库版本过低，请升级微信后再使用');
      return;
    }
    // traceUser: false —— 不在云开发控制台记录调用者身份（openid），与「不记录」红线一致
    wx.cloud.init(CLOUD_ENV ? { env: CLOUD_ENV, traceUser: false } : { traceUser: false });
    // M13：打开小程序时上报一次使用量（云函数按 openid + 天去重；失败静默，不影响使用）
    ops.ping().catch((err) => logger.warn('app', 'ping 失败', err));
    // 外观：仅「跟随系统」时，系统明暗切换后刷新当前页面内容
    // （导航栏 / tabBar 由 app.json 的 theme.json 自动跟随，无需在这里处理）
    theme.watch(() => {
      const pages = getCurrentPages();
      const cur = pages[pages.length - 1];
      if (cur && typeof cur.setData === 'function') {
        cur.setData({ wreDark: theme.isDark() });
      }
    });
  },
});
