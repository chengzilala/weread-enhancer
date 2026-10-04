const { CLOUD_ENV } = require('./config');

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('[微信悦读] 当前基础库版本过低，请升级微信后再使用');
      return;
    }
    wx.cloud.init(CLOUD_ENV ? { env: CLOUD_ENV, traceUser: true } : { traceUser: true });
  },
});
