const store = require('../../shared/store');
const theme = require('../../shared/theme');
const { verifyKey } = require('../../shared/gateway');
const ops = require('../../shared/ops');
const account = require('../../shared/account');
const { CLOUD_ENV, PROXY_FUNCTION, LINKS } = require('../../config');

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

    // 「如何获取 Key」图文说明（默认收起；图片走官网 CDN，不占小程序包体）
    showKeyGuide: false,
    keyGuideSteps: [
      { no: 1, text: '打开微信读书 App → 底部「我」→ 右上角「设置」，找到并进入「微信读书 Skill」。', img: LINKS.site + '/app/assets/img/skill-step1.png' },
      { no: 2, text: '进来后往下拉，看「快速配置」区，第 ② 步就是「获取 API Key」。', img: LINKS.site + '/app/assets/img/skill-step2.png' },
      { no: 3, text: '点「复制 Key」，就得到一段 wrk- 开头的 Key（默认打码，点右侧「👁」可看明文）。', img: LINKS.site + '/app/assets/img/skill-step3.png' },
    ],

    // 「加到手机桌面 / 我的小程序」图文说明（置顶常显，分平台分步）
    desktopGuideGroups: [
      {
        title: '安卓手机（华为 / 小米 / OPPO / vivo 等）',
        steps: [
          '在微信里打开本小程序，点右上角「···」。',
          '在弹出的菜单里选「添加到桌面」。',
          '若弹出权限提示，点「允许」。',
          '回到手机桌面，就会出现「悦读且住」图标，以后点它即可直接打开。',
        ],
      },
      {
        title: 'iPhone / iPad',
        steps: [
          'iPhone 不能把小程序加到桌面，请改用「添加到我的小程序」。',
          '在微信里打开本小程序，点右上角「···」。',
          '在弹出的菜单里选「添加到我的小程序」。',
          '以后在微信首页往下拉，就能在顶部「我的小程序」里一键打开。',
        ],
      },
    ],

    // 本机资料（头像 / 昵称）
    avatarUrl: '',
    nickName: '',
    hasProfile: false,

    // 管理员看板入口（M13）：由云函数判定，仅你的账号显示
    isAdmin: false,
    // 自己的 openid（M13）：用于自助配置云函数环境变量 ADMIN_OPENIDS，仅自己可见
    myOpenid: '',
    // 是否已关联网页账户（跨端打通）
    linked: false,

    // 文字大小（全局缩放，四档）
    wreFs: 1,
    fontTiers: store.FONT_TIERS,

    // 外观（明暗主题；三档，与 H5「我的 → 外观」一致）
    wreDark: false,
    themePref: 'auto',
    themeTiers: theme.THEME_TIERS,
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
      showKeyGuide: false,
      wreFs: store.getFontScale(),
      wreDark: theme.apply(),
      themePref: theme.getTheme(),
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
    // 关联状态：失败静默
    account
      .bindInfo()
      .then((r) => {
        this.setData({ linked: !!(r && r.ok && r.linked) });
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

  // 「如何获取 Key」图文说明：默认收起，点一下展开 / 收起
  toggleKeyGuide() {
    this.setData({ showKeyGuide: !this.data.showKeyGuide });
  },

  // ---- 文字大小（四档切换；本机保存，其他页面在 onShow 时套用）----
  onFontScale(e) {
    const value = store.setFontScale(Number(e.currentTarget.dataset.value));
    this.setData({ wreFs: value });
  },

  // ---- 外观（三档切换：跟随系统 / 浅色 / 深色；本机保存）----
  onTheme(e) {
    const pref = theme.setTheme(e.currentTarget.dataset.value);
    this.setData({ themePref: pref, wreDark: theme.apply() });
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
    // 已关联网页账户：昵称随之同步（未关联时云函数返回 nolink，静默忽略）
    if (this.data.linked && nickName) {
      account.profilePut(nickName).catch(() => {});
    }
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

  goLink() {
    wx.navigateTo({ url: '/pages/link/index' });
  },

  // ---- DeepSeek Key 相关处理器（M15 合规下线：UI 已移除，保留不删以便转企业主体后恢复）----

  goNotes() {
    wx.navigateTo({ url: '/pages/notes/index' });
  },

  goDaily() {
    // 直达「往期回顾」列表（不生成今天的卡片）
    wx.navigateTo({ url: '/pages/daily/index?view=archive' });
  },

  goWander() {
    wx.navigateTo({ url: '/pages/wander/index' });
  },

  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/index' });
  },

  // ---- 相关入口：小程序内不能直接打开网页，故「复制链接 + 弹窗提示」----
  copySite() {
    this.copyLink(LINKS.site, '官网');
  },

  copyH5() {
    this.copyLink(LINKS.h5, 'H5 网页版');
  },

  copyPersonal() {
    this.copyLink(LINKS.personal, '我的个人网站');
  },

  copyLink(url, name) {
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.hideToast(); // 去掉系统自带的「内容已复制」提示，改用自己的弹窗说明
        wx.showModal({
          title: '链接已复制',
          content: name + '的网址已复制。小程序里不能直接打开网页，请打开手机浏览器，把网址粘贴到地址栏访问即可。',
          showCancel: false,
          confirmText: '知道了',
        });
      },
      fail: () => {
        wx.showModal({
          title: '复制失败',
          content: '请打开手机浏览器，手动输入：' + url,
          showCancel: false,
        });
      },
    });
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
