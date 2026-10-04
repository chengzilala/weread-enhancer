const store = require('../../shared/store');
const { verifyKey } = require('../../shared/gateway');

Page({
  data: {
    input: '',
    masked: '',
    hasKey: false,
    saving: false,
    statusText: '',
    statusType: '', // ok | error
  },

  onShow() {
    const key = store.getKey();
    this.setData({
      hasKey: !!key,
      masked: key ? store.maskKey(key) : '',
      input: '',
      statusText: '',
      statusType: '',
    });
  },

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

  setStatus(type, text) {
    this.setData({ statusType: type, statusText: text });
  },
});
