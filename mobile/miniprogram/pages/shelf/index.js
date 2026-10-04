const store = require('../../shared/store');

Page({
  data: {
    hasKey: false,
    pageTitle: '书架',
    devNote: '阶段 2 实现：/shelf/sync，按电子书 / 专辑 / 公众号分区展示封面、作者、进度。',
  },

  onShow() {
    this.setData({ hasKey: !!store.getKey() });
  },

  goSettings() {
    wx.switchTab({ url: '/pages/settings/index' });
  },
});
