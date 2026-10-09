const account = require('../../shared/account');
const store = require('../../shared/store');

/** 账户码掩码：前 4 后 4 */
function maskCode(id) {
  const v = String(id || '');
  return v.length > 8 ? v.slice(0, 4) + '····' + v.slice(-4) : v;
}

/** 从输入里提取绑定码（支持推入的纯 6 位数字，或完整账户码） */
function extractCode(raw) {
  const s = String(raw || '').trim();
  if (/^\d{6}$/.test(s)) {
    return s;
  }
  if (/^[0-9a-fA-F]{16,64}$/.test(s)) {
    return s;
  }
  return '';
}

Page({
  data: {
    wreFs: 1,
    loading: true,
    linked: false,
    deviceMasked: '',
    myCode: '',
    myCodeMasked: '',
    showFull: false,
    code: '',
    busy: false,
    statusText: '',
    statusType: '',
  },

  onShow() {
    this.setData({ wreFs: store.getFontScale() });
    this.refresh();
  },

  async refresh() {
    this.setData({ loading: true });
    const res = await account.bindInfo();
    const ok = !!(res && res.ok);
    const linked = ok && !!res.linked;
    const deviceId = linked && res.deviceId ? String(res.deviceId) : '';
    this.setData({
      loading: false,
      linked: linked,
      deviceMasked: deviceId ? maskCode(deviceId) : '',
      myCode: deviceId,
      myCodeMasked: deviceId ? maskCode(deviceId) : '',
    });
    // 账户侧已有昵称、本机还没有 → 拉到本机
    if (linked && res.nickName && !store.getProfile().nickName) {
      store.setProfile({ avatarUrl: store.getProfile().avatarUrl, nickName: res.nickName });
    }
  },

  /** 情况一：小程序先开始用 → 获取本端账户码（供网页端粘贴登录） */
  async onEnsureCode() {
    if (this.data.busy) {
      return;
    }
    this.setData({ busy: true });
    this.setStatus('', '正在生成…');
    const res = await account.accountEnsure();
    this.setData({ busy: false });
    if (!res.ok) {
      this.setStatus('error', res.error || '获取失败，请重试');
      return;
    }
    this.setStatus('ok', res.created ? '账户码已生成' : '已获取账户码');
    this.refresh();
  },

  /** 显示 / 隐藏完整账户码 */
  onToggleCode() {
    this.setData({ showFull: !this.data.showFull });
  },

  /** 复制完整账户码（粘贴到网页端「跨设备登录」） */
  onCopyCode() {
    const code = this.data.myCode;
    if (!code) {
      return;
    }
    wx.setClipboardData({
      data: code,
      success: () => {
        this.setStatus('ok', '账户码已复制，可粘贴到网页端登录');
      },
    });
  },

  onInput(e) {
    this.setData({ code: e.detail.value });
  },

  async onSubmit() {
    const code = extractCode(this.data.code);
    if (!code) {
      this.setStatus('error', '请填写 6 位绑定码，或粘贴完整账户码');
      return;
    }
    this.submitCode(code);
  },

  /** 扫码关联：扫网页端「生成绑定码」后展示的二维码 */
  onScan() {
    if (this.data.busy) {
      return;
    }
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode'],
      success: (res) => {
        const code = extractCode(res && res.result);
        if (!code) {
          this.setStatus('error', '二维码内容无法识别，请在网页端重新生成');
          return;
        }
        this.submitCode(code);
      },
      fail: () => {
        // 用户取消扫码：静默处理
      },
    });
  },

  async submitCode(code) {
    if (this.data.busy) {
      return;
    }
    this.setData({ busy: true });
    this.setStatus('', '正在关联…');
    const res = await account.bindClaim(code);
    this.setData({ busy: false });
    if (!res.ok) {
      this.setStatus('error', res.error || '关联失败，请重试');
      return;
    }
    // 关联成功后：账户侧有昵称则拉到本机；否则把本机昵称推到账户
    const profile = store.getProfile();
    const info = await account.bindInfo();
    if (info.ok && info.linked && info.nickName && !profile.nickName) {
      store.setProfile({ avatarUrl: profile.avatarUrl, nickName: info.nickName });
    } else if (profile.nickName) {
      await account.profilePut(profile.nickName);
    }
    this.setData({ code: '' });
    this.setStatus('ok', '关联成功');
    wx.showToast({ title: '关联成功', icon: 'success' });
    this.refresh();
  },

  onUnbind() {
    wx.showModal({
      title: '解除关联',
      content: '解除后小程序与网页将各自独立，本机数据保留。确定解除吗？',
      success: async (r) => {
        if (!r.confirm) {
          return;
        }
        const res = await account.bindUnbind();
        if (!res.ok) {
          this.setStatus('error', res.error || '解除失败，请重试');
          return;
        }
        this.setStatus('ok', '已解除关联');
        this.refresh();
      },
    });
  },

  setStatus(type, text) {
    this.setData({ statusType: type, statusText: text });
  },
});
