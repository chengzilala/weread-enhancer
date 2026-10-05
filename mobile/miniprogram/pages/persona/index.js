const store = require('../../shared/store');
const data = require('../../shared/data');
const sync = require('../../shared/sync');
const { generatePersonaPortrait } = require('../../shared/ai');
const { getReadingPersona } = require('../../shared/persona-core');
const { personaFigureDataUri } = require('../../shared/persona-figure');
const { renderPersonaShare } = require('../../shared/persona-share');
const { messageOf, isKeyError } = require('../../shared/errors');

Page({
  data: {
    hasKey: false,
    hasDsKey: false,
    loading: false,
    error: '',
    needsKey: false,
    reason: '',
    progress: null,
    persona: null,
    sharing: false,
    shareImg: '',
    showShare: false,
    aiLoading: false,
    aiError: '',
  },

  async onShow() {
    const hasKey = !!store.getKey();
    this.setData({ hasKey, hasDsKey: !!store.getDeepSeekKey() });
    if (!hasKey) {
      return;
    }
    // 先在云端读上次算好的人格「秒显」，再静默重算刷新（云同步失败不影响）
    if (!this.data.persona) {
      await this.restoreFromCloud();
    }
    this.load(false);
  },

  onPullDownRefresh() {
    if (!this.data.hasKey) {
      wx.stopPullDownRefresh();
      return;
    }
    this.load(true);
  },

  retry() {
    this.load(true);
  },

  goSettings() {
    wx.switchTab({ url: '/pages/settings/index' });
  },

  // 通用状态块的动作：settings=去配置 Key，retry=重试
  onStateAction(e) {
    if (e.detail.type === 'settings') {
      this.goSettings();
    } else {
      this.retry();
    }
  },

  onShareAppMessage() {
    const p = this.data.persona;
    const title = p && p.name
      ? '我的阅读人格是「' + p.name + '」，来测测你的'
      : '来「悦读且住」测测你的阅读人格';
    return {
      title: title,
      path: '/pages/persona/index',
    };
  },

  // 生成竖版分享图：本机 canvas 绘制 → 导出临时图片 → 弹层预览
  async generateShare() {
    const persona = this.data.persona;
    if (!persona || this.data.sharing) {
      return;
    }
    this.setData({ sharing: true });
    try {
      const canvas = await this.getShareCanvas();
      const size = renderPersonaShare(canvas, persona, store.getProfile());
      const tempFilePath = await this.canvasToTemp(canvas, size);
      this.setData({ sharing: false, shareImg: tempFilePath, showShare: true });
    } catch (err) {
      this.setData({ sharing: false });
      wx.showToast({ title: (err && err.message) || '生成失败，请重试', icon: 'none' });
    }
  },

  getShareCanvas() {
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery().in(this).select('#shareCanvas').fields({ node: true, size: true }).exec((res) => {
        const node = res && res[0] && res[0].node;
        if (node) {
          resolve(node);
        } else {
          reject(new Error('画布未就绪，请重试'));
        }
      });
    });
  },

  canvasToTemp(canvas, size) {
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas: canvas,
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
        destWidth: size.width,
        destHeight: size.height,
        success: (res) => resolve(res.tempFilePath),
        fail: () => reject(new Error('图片导出失败，请重试')),
      }, this);
    });
  },

  closeShare() {
    this.setData({ showShare: false });
  },

  saveShare() {
    const filePath = this.data.shareImg;
    if (!filePath) {
      return;
    }
    wx.saveImageToPhotosAlbum({
      filePath: filePath,
      success: () => {
        wx.showToast({ title: '已保存到相册', icon: 'success' });
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('auth deny') >= 0 || msg.indexOf('authorize') >= 0 || msg.indexOf('auth denied') >= 0) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中允许「保存到相册」后重试',
            confirmText: '去设置',
            success: (r) => {
              if (r.confirm) {
                wx.openSetting();
              }
            },
          });
        } else if (msg.indexOf('cancel') < 0) {
          wx.showToast({ title: '保存失败，请重试', icon: 'none' });
        }
      },
    });
  },

  noop() {},

  async load(force) {
    const key = store.getKey();
    if (!key) {
      this.setData({ hasKey: false, loading: false });
      return;
    }
    // 已有云端人格在展示时不再铺骨架屏，让新结果静默替换（秒显体验）
    this.setData({ loading: !this.data.persona, error: '', needsKey: false, reason: '' });

    // 累计数据（能量 / 内容取向 / 节奏）+ 书架/笔记概览
    const results = await Promise.all([
      data.fetchReadData('overall', key),
      data.fetchOverview(key, force),
    ]);
    const readRes = results[0];
    const overviewRes = results[1];

    if (!readRes.ok) {
      if (this.data.persona) {
        // 已有云端缓存：刷新失败时静默保留，不打断阅读
        this.setData({ loading: false });
        wx.showToast({ title: messageOf(readRes, '更新失败'), icon: 'none' });
      } else {
        this.setData({
          loading: false,
          error: messageOf(readRes, '读取数据失败'),
          needsKey: isKeyError(readRes.code),
          persona: null,
        });
      }
      wx.stopPullDownRefresh();
      return;
    }

    const overview = overviewRes && overviewRes.ok ? overviewRes : null;

    // 语料：笔记最多的前 N 本书的划线/想法（失败不阻断主体判定）
    let corpus = null;
    let corpusState = '';
    let corpusError = '';
    if (overview && overview.notebooks) {
      corpusState = 'loading';
      const corpusRes = await data.fetchCorpus(overview.notebooks, key, force);
      if (corpusRes.ok) {
        corpus = corpusRes.corpus;
        corpusState = 'ok';
      } else {
        corpusState = 'error';
        corpusError = corpusRes.error || '';
      }
    }

    this.setData({ loading: false });
    wx.stopPullDownRefresh();

    const persona = getReadingPersona({
      overall: readRes.data,
      report: null,
      shelf: overview ? overview.shelf : null,
      notebooks: overview ? overview.notebooks : null,
      corpus: corpus,
      mode: 'overall',
      hasKey: true,
      readerName: '',
      corpusState: corpusState,
      corpusError: corpusError,
    });

    const view = this.renderResult(persona);
    if (view) {
      this.syncToCloud(view);
    }
  },

  // 从云端读取上次算好的人格（秒显）；失败/无数据都静默跳过
  async restoreFromCloud() {
    const res = await sync.syncGet();
    if (res.ok && res.persona && !this.data.persona) {
      this.setData({ persona: res.persona, error: '', needsKey: false, reason: '' });
    }
  },

  // 静默上传人格结果：云同步是增强项，失败不提示、不阻断
  syncToCloud(persona) {
    sync.syncPut(persona).catch(() => {});
  },

  // 生成 AI 人格画像（DeepSeek）：需先在「我的」页配置 Key
  async generateAi() {
    const persona = this.data.persona;
    if (!persona || this.data.aiLoading) {
      return;
    }
    if (!store.getDeepSeekKey()) {
      wx.showModal({
        title: '需要 DeepSeek Key',
        content: '生成 AI 画像需要先在「我的」页填写你的 DeepSeek API Key（仅保存在本机）。',
        confirmText: '去填写',
        success: (r) => {
          if (r.confirm) {
            wx.switchTab({ url: '/pages/settings/index' });
          }
        },
      });
      return;
    }
    this.setData({ aiLoading: true, aiError: '' });
    const res = await generatePersonaPortrait(persona);
    if (res.ok && res.text) {
      const updated = Object.assign({}, this.data.persona, { aiText: res.text });
      this.setData({ aiLoading: false, aiError: '', persona: updated });
      this.syncToCloud(updated);
    } else {
      this.setData({ aiLoading: false, aiError: messageOf(res, '生成失败，请稍后重试') });
    }
  },

  renderResult(persona) {
    if (!persona.ok) {
      this.setData({ reason: persona.reason, progress: persona.progress || null, persona: null, error: '' });
      return null;
    }
    const dimsView = persona.dims.map((dim) => ({
      title: dim.title,
      available: dim.available,
      leftLabel: dim.left.label,
      rightLabel: dim.right.label,
      side: dim.side,
      pct: dim.leftPct,
      basis: dim.basis,
    }));
    const words = persona.words;
    const wordsView = words ? {
      top: words.top,
      cloud: words.cloud,
      themes: words.themes,
      emotion: words.emotion,
      catchphrase: words.catchphrase,
    } : null;
    // 重算时保留同一人格代码的 AI 画像（避免刷新后丢失）
    const prev = this.data.persona;
    const aiText = prev && prev.code === persona.code ? (prev.aiText || '') : '';
    const view = {
      name: persona.name,
      tagline: persona.tagline,
      code: persona.code,
      full: persona.full,
      figure: persona.figure,
      figureUri: personaFigureDataUri(persona.code),
      nicknames: persona.nicknames,
      oneLiner: persona.oneLiner,
      dims: dimsView,
      evidence: persona.evidence,
      words: wordsView,
      corpusState: persona.corpusState,
      corpusError: persona.corpusError,
      aiText: aiText,
    };
    this.setData({ reason: '', progress: null, error: '', persona: view });
    return view;
  },
});
