/**
 * 只读分享页 — 转发卡片 / 短链指向的落地页
 *
 * 好友点开分享链接时进入本页：无需配置 Key，凭短码从云函数取回分享内容，只读展示。
 * 页面底部提供「打开悦读且住」入口（回到首页）。
 *
 * 红线：只展示分享者主动上传的展示字段；不读任何本机数据、不请求官方接口、不带 Key。
 */
const shareLink = require('../../shared/share-link');
const store = require('../../shared/store');
const theme = require('../../shared/theme');

Page({
  data: {
    wreFs: 1,
    wreDark: false,
    loading: true,
    error: '',
    code: '',
    payload: null,
  },

  onLoad(query) {
    this.setData({ wreFs: store.getFontScale(), wreDark: theme.apply() });
    const code = (query && query.code) || '';
    this.setData({ code: code });
    this.load(code);
  },

  async load(code) {
    if (!code) {
      this.setData({ loading: false, error: '分享链接无效', payload: null });
      return;
    }
    this.setData({ loading: true, error: '' });
    const res = await shareLink.getShare(code);
    if (!res || !res.ok || !res.payload) {
      const msg = (res && res.code === 'expired')
        ? '这条分享已过期（分享链接保留 90 天）'
        : '分享不存在或已失效';
      this.setData({ loading: false, error: msg, payload: null });
      return;
    }
    this.setData({ loading: false, error: '', payload: res.payload });
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/index' });
  },

  onStateAction(e) {
    if (e.detail && e.detail.type === 'home') {
      this.goHome();
    } else {
      this.load(this.data.code);
    }
  },

  onShareAppMessage() {
    const p = this.data.payload || {};
    return {
      title: p.title || '来看看这张分享卡片',
      path: '/pages/share/index?code=' + (this.data.code || ''),
    };
  },
});
