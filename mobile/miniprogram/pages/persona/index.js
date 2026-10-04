const store = require('../../shared/store');
const data = require('../../shared/data');
const { getReadingPersona } = require('../../shared/persona-core');

Page({
  data: {
    hasKey: false,
    loading: false,
    error: '',
    needsKey: false,
    reason: '',
    progress: null,
    persona: null,
  },

  onShow() {
    const hasKey = !!store.getKey();
    this.setData({ hasKey });
    if (hasKey) {
      this.load(false);
    }
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

  async load(force) {
    const key = store.getKey();
    if (!key) {
      this.setData({ hasKey: false, loading: false });
      return;
    }
    this.setData({ loading: true, error: '', needsKey: false, reason: '' });

    // 累计数据（能量 / 内容取向 / 节奏）+ 书架/笔记概览
    const results = await Promise.all([
      data.fetchReadData('overall', key),
      data.fetchOverview(key, force),
    ]);
    const readRes = results[0];
    const overviewRes = results[1];

    if (!readRes.ok) {
      const needKey = readRes.code === 'auth' || readRes.code === 'nokey';
      this.setData({ loading: false, error: readRes.error || '读取数据失败', needsKey: needKey, persona: null });
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

    this.renderResult(persona);
  },

  renderResult(persona) {
    if (!persona.ok) {
      this.setData({ reason: persona.reason, progress: persona.progress || null, persona: null, error: '' });
      return;
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
    this.setData({
      reason: '',
      progress: null,
      error: '',
      persona: {
        name: persona.name,
        tagline: persona.tagline,
        code: persona.code,
        full: persona.full,
        figure: persona.figure,
        nicknames: persona.nicknames,
        oneLiner: persona.oneLiner,
        dims: dimsView,
        evidence: persona.evidence,
        words: wordsView,
        corpusState: persona.corpusState,
        corpusError: persona.corpusError,
      },
    });
  },
});
