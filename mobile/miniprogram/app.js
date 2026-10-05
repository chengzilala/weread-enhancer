const { CLOUD_ENV } = require('./config');

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('[微信悦读] 当前基础库版本过低，请升级微信后再使用');
      return;
    }
    // traceUser: false —— 不在云开发控制台记录调用者身份（openid），与「不记录」红线一致
    wx.cloud.init(CLOUD_ENV ? { env: CLOUD_ENV, traceUser: false } : { traceUser: false });
  },
});
