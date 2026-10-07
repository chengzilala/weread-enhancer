const store = require('../../shared/store');
const { verifyKey } = require('../../shared/gateway');
const ops = require('../../shared/ops');
const { CLOUD_ENV, PROXY_FUNCTION } = require('../../config');

Page({
  data: {
    // 微信读书 API Key
    input: '',
    masked: '',
    hasKey: false,
    saving: false,
    statusText: '',
    statusType: '', // ok | error

    // 参数详情（默认收起，点「参数详情」展开）
    showParams: false,
    params: [],

    // 本机资料（头像 / 昵称）
    avatarUrl: '',
    nickName: '',
    hasProfile: false,

    // 管理员看板入口（M13）：由云函数判定，仅你的账号显示
    isAdmin: false,
    // 自己的 openid（M13）：用于自助配置云函数环境变量 ADMIN_OPENIDS，仅自己可见
    myOpenid: '',
  },

  onShow() {
    const key = store.getKey();
    const profile = store.getProfile();
    this.setData({
      hasKey: !!key,
      masked: key ? store.maskKey(key) : '',
      input: '',
      statusText: '',
      statusType: '',
      avatarUrl: profile.avatarUrl,
      nickName: profile.nickName,
      hasProfile: !!(profile.avatarUrl || profile.nickName),
      showParams: false,
      params: this.buildParams(key, profile),
    });
    // 管理员判断：失败静默（非管理员 / 云函数未部署时都不显示入口），同时取回自己的 openid
    ops
      .whoami()
      .then((r) => {
        const info = r || {};
        this.setData({ isAdmin: !!info.admin, myOpenid: info.openid || '' });
      })
      .catch(() => {});
  },

  // 参数详情：只列本机可见的配置项，绝不显示 Key 明文（只给掩码）
  buildParams(key, profile) {
    const nick = profile.nickName || (profile.avatarUrl ? '已设置头像' : '');
    return [
      { label: '微信读书 Key', value: key ? store.maskKey(key) : '未配置' },
      { label: '头像昵称', value: nick || '未设置' },
      { label: '云开发环境', value: CLOUD_ENV || '（默认环境）' },
      { label: '云函数', value: PROXY_FUNCTION },
      { label: '网关地址', value: 'i.weread.qq.com（经云函数中转）' },
    ];
  },

  toggleParams() {
    this.setData({ showParams: !this.data.showParams });
  },

  // ---- 本机资料 ----

  onChooseAvatar(e) {
    const temp = (e.detail && e.detail.avatarUrl) || '';
    if (!temp) {
      return;
    }
    const fs = wx.getFileSystemManager();
    const old = this.data.avatarUrl;
    // chooseAvatar 给的是临时文件，重启后失效；保存到本地用户目录才能长期使用
    fs.saveFile({
      tempFilePath: temp,
      success: (res) => {
        if (old && old.indexOf('wxfile://') === 0 && old !== res.savedFilePath) {
          fs.unlink({ filePath: old, fail() {} });
        }
        store.setProfile({ avatarUrl: res.savedFilePath, nickName: this.data.nickName });
        this.setData({ avatarUrl: res.savedFilePath, hasProfile: true });
      },
      fail: () => {
        // 退化为临时路径：本次会话可用，重启后需重新选择
        store.setProfile({ avatarUrl: temp, nickName: this.data.nickName });
        this.setData({ avatarUrl: temp, hasProfile: true });
      },
    });
  },

  onNickChange(e) {
    const nickName = String((e.detail && e.detail.value) || '').trim().slice(0, 24);
    store.setProfile({ avatarUrl: this.data.avatarUrl, nickName: nickName });
    this.setData({ nickName: nickName, hasProfile: !!(this.data.avatarUrl || nickName) });
  },

  onClearProfile() {
    store.clearProfile();
    this.setData({ avatarUrl: '', nickName: '', hasProfile: false });
  },

  // ---- 微信读书 API Key ----

  onInput(e) {
    this.setData({ input: e.detail.value });
  },

  async onSave() {
    if (this.data.saving) {
      return;
    }
    const key = (this.data.input || '').trim();
    if (!key) {
      this.setStatus('error', '请先粘贴你的 API Key');
      return;
    }
    if (key.indexOf('wrk-') !== 0) {
      this.setStatus('error', 'Key 格式不对：应以 wrk- 开头');
      return;
    }

    this.setData({ saving: true });
    this.setStatus('', '正在校验…');
    const res = await verifyKey(key);
    this.setData({ saving: false });

    if (!res.ok) {
      this.setStatus('error', res.error || '校验失败，请重试');
      return;
    }

    store.setKey(key);
    this.setData({ hasKey: true, masked: store.maskKey(key), input: '' });
    this.setStatus('ok', '已保存并校验通过，回到首页即可查看数据');
    wx.showToast({ title: '保存成功', icon: 'success' });
  },

  onClear() {
    store.clearKey();
    this.setData({ hasKey: false, masked: '', input: '' });
    this.setStatus('', '已清除 Key');
  },

  // ---- 页面跳转 ----

  goPaperbook() {
    wx.navigateTo({ url: '/pages/paperbook/index' });
  },

  // ---- DeepSeek Key 相关处理器（M15 合规下线：UI 已移除，保留不删以便转企业主体后恢复）----

  goNotes() {
    wx.navigateTo({ url: '/pages/notes/index' });
  },

  goDaily() {
    wx.navigateTo({ url: '/pages/daily/index' });
  },

  goWander() {
    wx.navigateTo({ url: '/pages/wander/index' });
  },

  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/index' });
  },

  // 复制自己的 openid：用于把本账号加入云函数环境变量 ADMIN_OPENIDS，开启运营看板
  copyOpenid() {
    const openid = this.data.myOpenid;
    if (!openid) {
      return;
    }
    wx.setClipboardData({ data: openid });
  },

  setStatus(type, text) {
    this.setData({ statusType: type, statusText: text });
  },
});
