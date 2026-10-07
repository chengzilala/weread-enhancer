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
    loading: true,
    linked: false,
    deviceMasked: '',
    code: '',
    busy: false,
    statusText: '',
    statusType: '',
  },

  onShow() {
    this.refresh();
  },

  async refresh() {
    this.setData({ loading: true });
    const res = await account.bindInfo();
    const ok = !!(res && res.ok);
    this.setData({
      loading: false,
      linked: ok && !!res.linked,
      deviceMasked: ok && res.deviceId ? maskCode(res.deviceId) : '',
    });
    // 账户侧已有昵称、本机还没有 → 拉到本机
    if (ok && res.linked && res.nickName && !store.getProfile().nickName) {
      store.setProfile({ avatarUrl: store.getProfile().avatarUrl, nickName: res.nickName });
    }
  },

  onInput(e) {
    this.setData({ code: e.detail.value });
  },

  async onSubmit() {
    if (this.data.busy) {
      return;
    }
    const code = extractCode(this.data.code);
    if (!code) {
      this.setStatus('error', '请填写 6 位绑定码，或粘贴完整账户码');
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
