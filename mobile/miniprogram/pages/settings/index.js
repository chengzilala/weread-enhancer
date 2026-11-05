const store = require('../../shared/store');
const theme = require('../../shared/theme');
const { verifyKey } = require('../../shared/gateway');
const keyvault = require('../../shared/keyvault');
const ops = require('../../shared/ops');
const account = require('../../shared/account');
const psauth = require('../../shared/psauth');
const logger = require('../../shared/logger');
const { CLOUD_ENV, PROXY_FUNCTION, LINKS } = require('../../config');

/** 从档位表里取当前标签（用于「更多 → 设置」右侧显示当前值） */
function tierLabel(tiers, field, value) {
  const hit = (tiers || []).find((t) => t[field] === value);
  return hit ? hit.label : '';
}

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

    // 折叠区（同一时间只展开一个）：'' | cloud | keyguide | prefs | desktop | links | donate | about | params
    openSec: '',
    params: [],

    // Key 更换输入区（已配置时默认收起）
    showKeyForm: false,

    // 「如何获取 Key」图文说明（图片走官网 CDN，不占小程序包体）
    keyGuideSteps: [
      { no: 1, text: '打开微信读书 App → 底部「我」→ 右上角「设置」，找到并进入「微信读书 Skill」。', img: LINKS.site + '/app/assets/img/skill-step1.png' },
      { no: 2, text: '进来后往下拉，看「快速配置」区，第 ② 步就是「获取 API Key」。', img: LINKS.site + '/app/assets/img/skill-step2.png' },
      { no: 3, text: '点「复制 Key」，就得到一段 wrk- 开头的 Key（默认打码，点右侧「👁」可看明文）。', img: LINKS.site + '/app/assets/img/skill-step3.png' },
    ],

    // 「加到手机桌面 / 我的小程序」分平台分步说明
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

    // 打赏支持：两条收款码（走官网 CDN，不占小程序包体）
    donateWechat: LINKS.site + '/app/assets/img/donate/wechat.png',
    donateAlipay: LINKS.site + '/app/assets/img/donate/alipay.png',

    // 管理员看板入口（M13）：由云函数判定，仅你的账号显示
    isAdmin: false,
    // 自己的 openid（M13）：用于自助配置云函数环境变量 ADMIN_OPENIDS，仅自己可见
    myOpenid: '',
    // 是否已关联网页账户（跨端打通）
    linked: false,

    // 统一账户（account-center）：与本机 Key / 账户码并存，互不影响
    psUser: null,     // { uid, nickname, avatar, emailMasked }
    psInitial: '',    // 没头像时显示昵称首字
    psBusy: false,    // 登录 / 退出进行中

    // 文字大小（全局缩放，四档）
    wreFs: 1,
    fsLabel: '标准',
    fontTiers: store.FONT_TIERS,

    // 外观（明暗主题；三档，与 H5「我的 → 外观」一致）
    wreDark: false,
    themePref: 'auto',
    themeLabel: '跟随系统',
    themeTiers: theme.THEME_TIERS,
  },

  onShow() {
    logger.log('settings', 'onShow 进入');
    const key = store.getKey();
    const wreFs = store.getFontScale();
    const themePref = theme.getTheme();
    this.setData({
      hasKey: !!key,
      masked: key ? store.maskKey(key) : store.getKeyMask(),
      input: '',
      statusText: '',
      statusType: '',
      openSec: '',
      showKeyForm: false,
      showCode: false,
      wreFs: wreFs,
      fsLabel: tierLabel(store.FONT_TIERS, 'value', wreFs),
      wreDark: theme.apply(),
      themePref: themePref,
      themeLabel: tierLabel(theme.THEME_TIERS, 'key', themePref),
      params: this.buildParams(key),
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
    // 统一账户：先用本机缓存上屏，再静默刷新（失败不影响页面）
    logger.guard('settings', () => this.refreshPs(), null);
    logger.log('settings', 'onShow 完成');
  },

  /** 统一账户登录态：本机缓存即时上屏，随后后台刷新昵称 / 头像 */
  refreshPs() {
    const cached = psauth.currentUser();
    logger.log('psauth', cached ? '本机已有统一账户缓存' : '本机无统一账户缓存');
    this.paintPs(cached);
    psauth
      .refresh()
      .then((user) => {
        logger.log('psauth', user ? '远端资料已刷新' : '远端无登录态');
        this.paintPs(user);
      })
      .catch((err) => logger.warn('psauth', '刷新失败', err));
  },

  paintPs(user) {
    const nick = (user && user.nickname) || '';
    this.setData({
      psUser: user || null,
      psInitial: nick ? Array.from(nick)[0] : '微',
    });
  },

  /** 微信一键登录统一账户：openid 由云函数代持，前端只拿 token + uid */
  onPsLogin() {
    if (this.data.psBusy) {
      return;
    }
    this.setData({ psBusy: true });
    logger.log('psauth', '点了一键登录');
    psauth
      .login()
      .then((res) => {
        this.setData({ psBusy: false });
        if (!res.ok) {
          logger.error('psauth', '登录失败', { code: res.code, error: res.error });
          wx.showModal({
            title: '登录失败' + (res.code ? '（' + res.code + '）' : ''),
            content: res.error || '请稍后再试',
            showCancel: false,
          });
          return;
        }
        logger.log('psauth', '登录成功', { isNew: res.isNew });
        this.paintPs(res.user);
        wx.showToast({ title: res.isNew ? '账户已创建' : '已登录', icon: 'success' });
      })
      .catch((err) => {
        logger.error('psauth', '登录异常', err);
        this.setData({ psBusy: false });
        wx.showModal({ title: '登录异常', content: String((err && err.message) || err).slice(0, 200), showCancel: false });
      });
  },

  /**
   * 绑定已有账户（网页端生成 6 位登录码 → 这里输入）
   * 成功后退回同一个 uid，以后「微信一键登录」直接进老账户。
   */
  onPsBind() {
    if (this.data.psBusy) {
      return;
    }
    wx.showModal({
      title: '绑定已有账户',
      content: '在浏览器打开 account.chesterlee.cn 登录你的账户 → 点「生成登录码」，把 6 位数字填在下面。',
      editable: true,
      placeholderText: '6 位登录码',
      confirmText: '绑定',
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        const code = String(res.content || '').replace(/\D/g, '');
        if (code.length !== 6) {
          wx.showToast({ title: '请输入 6 位数字', icon: 'none' });
          return;
        }
        this.setData({ psBusy: true });
        logger.log('psauth', '尝试绑定已有账户');
        psauth
          .bind(code)
          .then((r) => {
            this.setData({ psBusy: false });
            if (!r.ok) {
              logger.error('psauth', '绑定失败', { code: r.code, error: r.error });
              wx.showModal({
                title: '绑定失败' + (r.code ? '（' + r.code + '）' : ''),
                content: r.error || '请稍后再试',
                showCancel: false,
              });
              return;
            }
            logger.log('psauth', '绑定成功');
            this.paintPs(r.user);
            wx.showToast({ title: '已绑定', icon: 'success' });
          })
          .catch((err) => {
            logger.error('psauth', '绑定异常', err);
            this.setData({ psBusy: false });
          });
      },
    });
  },

  onPsLogout() {
    if (this.data.psBusy) {
      return;
    }
    wx.showModal({
      title: '退出统一账户？',
      content: '只退出统一账户登录态；本机 Key、账户码与云端数据都不受影响。',
      confirmText: '退出',
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        this.setData({ psBusy: true });
        psauth
          .logout()
          .then(() => {
            this.setData({ psBusy: false });
            this.paintPs(null);
            wx.showToast({ title: '已退出', icon: 'none' });
          })
          .catch(() => {
            this.setData({ psBusy: false });
          });
      },
    });
  },

  copyAccount() {
    this.copyLink(LINKS.account, '统一账户中心');
  },

  /** 调试：把最近日志复制出来（真机排查用，不涉及任何 Key / Token） */
  copyLogs() {
    const text = logger.dump(30) || '（暂无日志）';
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showModal({
          title: '最近日志已复制',
          content: text.slice(-260),
          showCancel: false,
        });
      },
    });
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
  buildParams(key) {
    return [
      { label: '微信读书 Key', value: key ? store.maskKey(key) : (store.getKeyMask() || '未配置') },
      { label: '云开发环境', value: CLOUD_ENV || '（默认环境）' },
      { label: '云函数', value: PROXY_FUNCTION },
      { label: '网关地址', value: 'i.weread.qq.com（经云函数中转）' },
    ];
  },

  /** 折叠区：同一时间只展开一个（再点一次收起） */
  onToggleSec(e) {
    const sec = e.currentTarget.dataset.sec;
    this.setData({ openSec: this.data.openSec === sec ? '' : sec });
  },

  /** 已配置 Key 时，点「更换」展开输入区 */
  onToggleKeyForm() {
    this.setData({ showKeyForm: !this.data.showKeyForm, input: '' });
  },

  // ---- 文字大小（四档切换；本机保存，其他页面在 onShow 时套用）----
  onFontScale(e) {
    const value = store.setFontScale(Number(e.currentTarget.dataset.value));
    this.setData({ wreFs: value, fsLabel: tierLabel(store.FONT_TIERS, 'value', value) });
  },

  // ---- 外观（三档切换：跟随系统 / 浅色 / 深色；本机保存）----
  onTheme(e) {
    const pref = theme.setTheme(e.currentTarget.dataset.value);
    this.setData({
      themePref: pref,
      themeLabel: tierLabel(theme.THEME_TIERS, 'key', pref),
      wreDark: theme.apply(),
    });
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
    this.setData({ hasKey: true, masked: store.maskKey(key), input: '', showKeyForm: false });
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
    this.setData({ hasKey: false, masked: '', input: '', hosted: false, showKeyForm: false });
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

    // 1. 清空本机所有 wre_ 前缀数据；保留「外观 / 文字大小」两个设备偏好
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
