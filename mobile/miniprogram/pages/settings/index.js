const store = require('../../shared/store');
const theme = require('../../shared/theme');
const { verifyKey } = require('../../shared/gateway');
const keyvault = require('../../shared/keyvault');
const ops = require('../../shared/ops');
const account = require('../../shared/account');
const { CLOUD_ENV, PROXY_FUNCTION, LINKS } = require('../../config');

/** 账户码掩码：前 4 后 4 */
function maskCode(id) {
  const v = String(id || '');
  return v.length > 8 ? v.slice(0, 4) + '····' + v.slice(-4) : v;
}

Page({
  data: {
    // 微信读书 API Key
    input: '',
    masked: '',
    hasKey: false,
    saving: false,
    statusText: '',
    statusType: '', // ok | error
    signingOut: false,

    // 用户凭证（账户码 + 云端托管 Key）
    hosted: false,        // 云端是否已加密托管 Key（本机没 Key 时可「恢复账号」）
    myCode: '',           // 账户码（明文，仅本机内存；用于保存凭证 / 复制）
    myCodeMasked: '',
    showCode: false,
    codeBusy: false,
    restoring: false,

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

    // 「加到手机桌面 / 我的小程序」图文说明（默认收起，点标题展开，分平台分步）
    showDesktopGuide: false,
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

    // 打赏支持：两条收款码（走官网 CDN，不占小程序包体）
    donateWechat: LINKS.site + '/app/assets/img/donate/wechat.png',
    donateAlipay: LINKS.site + '/app/assets/img/donate/alipay.png',

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
      masked: key ? store.maskKey(key) : store.getKeyMask(),
      input: '',
      statusText: '',
      statusType: '',
      avatarUrl: profile.avatarUrl,
      nickName: profile.nickName,
      hasProfile: !!(profile.avatarUrl || profile.nickName),
      showParams: false,
      showKeyGuide: false,
      showDesktopGuide: false,
      showCode: false,
      wreFs: store.getFontScale(),
      wreDark: theme.apply(),
      themePref: theme.getTheme(),
      params: this.buildParams(key, profile),
    });
    // 云端托管状态：本机没 Key 时用云端掩码展示，并决定是否显示「恢复账号」
    keyvault
      .info()
      .then((r) => {
        if (!r || !r.ok) {
          return;
        }
        const hosted = !!r.hasKey;
        store.setCredentialMeta({ masked: r.masked || '', hosted: hosted });
        this.setData({ hosted: hosted, masked: key ? store.maskKey(key) : (r.masked || '') });
      })
      .catch(() => {});
    // 管理员判断：失败静默（非管理员 / 云函数未部署时都不显示入口），同时取回自己的 openid
    ops
      .whoami()
      .then((r) => {
        const info = r || {};
        this.setData({ isAdmin: !!info.admin, myOpenid: info.openid || '' });
      })
      .catch(() => {});
    // 关联状态 + 账户码（凭证）：失败静默
    this.refreshCode();
  },

  /** 取回关联状态与账户码（凭证） */
  refreshCode() {
    account
      .bindInfo()
      .then((r) => {
        const linked = !!(r && r.ok && r.linked);
        const deviceId = linked && r.deviceId ? String(r.deviceId) : '';
        this.setData({ linked: linked, myCode: deviceId, myCodeMasked: deviceId ? maskCode(deviceId) : '' });
      })
      .catch(() => {});
  },

  // 参数详情：只列本机可见的配置项，绝不显示 Key 明文（只给掩码）
  buildParams(key, profile) {
    const nick = profile.nickName || (profile.avatarUrl ? '已设置头像' : '');
    return [
      { label: '微信读书 Key', value: key ? store.maskKey(key) : (store.getKeyMask() || '未配置') },
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

  // 「加到手机桌面 / 我的小程序」分步说明：默认收起，点一下展开 / 收起
  toggleDesktopGuide() {
    this.setData({ showDesktopGuide: !this.data.showDesktopGuide });
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
    // 云端加密托管（用户凭证）：失败不阻断本机使用，仅提示
    keyvault
      .save(key)
      .then((r) => {
        if (r && r.ok) {
          store.setCredentialMeta({ masked: r.masked || store.maskKey(key), hosted: true });
          this.setData({ hosted: true });
        }
      })
      .catch(() => {});
  },

  onClear() {
    store.clearKey();
    store.clearCredentialMeta();
    this.setData({ hasKey: false, masked: '', input: '', hosted: false });
    this.setStatus('', '已清除 Key（含云端托管）');
    keyvault.clear().catch(() => {});
  },

  // ---- 用户凭证：账户码 + 云端托管 Key（换机 / 重装 / 退出后凭它恢复账号）----

  /** 显示 / 隐藏完整账户码 */
  onToggleCode() {
    this.setData({ showCode: !this.data.showCode });
  },

  /** 复制账户码（凭证）：建议用户存到备忘录等安全处 */
  onCopyCode() {
    const code = this.data.myCode;
    if (!code) {
      return;
    }
    wx.setClipboardData({
      data: code,
      success: () => wx.showToast({ title: '凭证已复制，请妥善保存', icon: 'success' }),
    });
  },

  /** 生成 / 获取本端账户码 */
  async onEnsureCode() {
    if (this.data.codeBusy) {
      return;
    }
    this.setData({ codeBusy: true });
    const res = await account.accountEnsure();
    this.setData({ codeBusy: false });
    if (!res || !res.ok) {
      this.setStatus('error', (res && res.error) || '获取失败，请重试');
      return;
    }
    this.refreshCode();
    wx.showToast({ title: '账户码已生成', icon: 'success' });
  },

  /** 一键恢复账号：从云端拉回托管的 Key（换机 / 重装微信 / 退出登录后） */
  async onRestoreAccount() {
    if (this.data.restoring) {
      return;
    }
    this.setData({ restoring: true });
    const res = await keyvault.pull();
    this.setData({ restoring: false });
    if (!res || !res.ok || !res.apiKey) {
      this.setStatus('error', (res && res.error) || '云端没有可恢复的 Key');
      return;
    }
    store.setKey(res.apiKey);
    store.setCredentialMeta({ masked: res.masked || store.maskKey(res.apiKey), hosted: true });
    this.setData({ hasKey: true, masked: store.maskKey(res.apiKey), hosted: true });
    this.setStatus('ok', '已从云端恢复账号，正在回到首页…');
    wx.showToast({ title: '已恢复', icon: 'success' });
    setTimeout(() => {
      wx.switchTab({ url: '/pages/home/index' });
    }, 700);
  },

  // ---- 退出登录：清空本机数据，云端账号与数据保留（下次可「恢复账号」）----

  onSignOut() {
    wx.showModal({
      title: '确认退出登录？',
      content: '将清除本机保存的 API Key、头像昵称，以及本机缓存（每日卡片 / 灵感漫游 / 纸书归档等）。云端账号与数据会保留，下次可用「我的凭证」一键恢复。此操作不可撤销；「外观」与「文字大小」会保留。',
      confirmText: '退出登录',
      confirmColor: '#E54545',
      success: (r) => {
        if (r.confirm) {
          this.doSignOut();
        }
      },
    });
  },

  async doSignOut() {
    if (this.data.signingOut) {
      return;
    }
    this.setData({ signingOut: true });

    // 只清本机：云端账号、托管 Key、用户数据都不动（下次可「恢复账号」）

    // 1. 删除本机头像文件（若有）
    const avatar = this.data.avatarUrl;
    if (avatar && avatar.indexOf('wxfile://') === 0) {
      wx.getFileSystemManager().unlink({ filePath: avatar, fail() {} });
    }

    // 2. 清空本机所有 wre_ 前缀数据；保留「外观 / 文字大小」两个设备偏好
    const KEEP = ['wre_theme', 'wre_font_scale'];
    try {
      const info = wx.getStorageInfoSync();
      (info.keys || []).forEach((k) => {
        if (k.indexOf('wre_') === 0 && KEEP.indexOf(k) < 0) {
          wx.removeStorageSync(k);
        }
      });
    } catch (e) {
      // 取不到键列表时退化为逐个清除关键项
      store.clearKey();
      store.clearProfile();
      store.clearCredentialMeta();
    }

    this.setData({
      signingOut: false,
      hasKey: false,
      masked: '',
      input: '',
      avatarUrl: '',
      nickName: '',
      hasProfile: false,
      statusText: '',
      statusType: '',
    });
    // 云端托管状态仍在 → 重新拉一次，好让「恢复账号」入口显示出来
    keyvault
      .info()
      .then((r) => {
        if (r && r.ok) {
          store.setCredentialMeta({ masked: r.masked || '', hosted: !!r.hasKey });
          this.setData({ hosted: !!r.hasKey, masked: r.masked || '' });
        }
      })
      .catch(() => {});
    this.refreshCode();

    wx.showToast({ title: '已退出登录', icon: 'success' });
    setTimeout(() => {
      wx.switchTab({ url: '/pages/home/index' });
    }, 600);
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
    // 直达「往期归档」列表（不生成本期）
    wx.navigateTo({ url: '/pages/wander/index?view=archive' });
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

  copyDonate() {
    this.copyLink(LINKS.donate, '打赏名单');
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
