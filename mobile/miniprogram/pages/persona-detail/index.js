// 人格依据 · 明细页：把「为什么是 TA」下沉到具体分类 / 具体书名 / 具体划线原文
// 计算全部在本机（shared/persona-core.js），本页只负责排版。
const store = require('../../shared/store');
const theme = require('../../shared/theme');
const data = require('../../shared/data');
const { getReadingPersona, personaFigureEvidenceDetail } = require('../../shared/persona-core');
const { messageOf, isKeyError } = require('../../shared/errors');

Page({
  data: {
    wreFs: 1,
    wreDark: false,
    loading: true,
    error: '',
    needsKey: false,
    detail: null,
  },

  onLoad() {
    this.setData({ wreFs: store.getFontScale(), wreDark: theme.apply() });
    this.load();
  },

  onPullDownRefresh() {
    this.load();
  },

  retry() {
    this.load();
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

  async load() {
    const key = store.getKey();
    if (!key) {
      this.setData({ loading: false, needsKey: true, error: '还没有配置微信读书 Key' });
      wx.stopPullDownRefresh();
      return;
    }
    this.setData({ loading: !this.data.detail, error: '', needsKey: false });

    const results = await Promise.all([
      data.fetchReadData('overall', key),
      data.fetchOverview(key, false),
    ]);
    const readRes = results[0];
    const overviewRes = results[1];
    if (!readRes.ok) {
      this.setData({
        loading: false,
        error: messageOf(readRes, '读取数据失败'),
        needsKey: isKeyError(readRes.code),
      });
      wx.stopPullDownRefresh();
      return;
    }

    const overview = overviewRes && overviewRes.ok ? overviewRes : null;
    let corpus = null;
    if (overview && overview.notebooks) {
      const corpusRes = await data.fetchCorpus(overview.notebooks, key, false);
      if (corpusRes.ok) {
        corpus = corpusRes.corpus;
      }
    }

    const overall = readRes.data || {};
    const shelf = overview ? overview.shelf : null;
    const notebooks = overview ? overview.notebooks : null;
    const persona = getReadingPersona({
      overall: overall,
      shelf: shelf,
      notebooks: notebooks,
      corpus: corpus,
      mode: 'overall',
      hasKey: true,
    });

    this.setData({ loading: false });
    wx.stopPullDownRefresh();

    if (!persona.ok) {
      this.setData({
        detail: null,
        error: persona.reason === 'data'
          ? '数据还差一点点：人格依据需要累计阅读 ≥ 10 小时、笔记 ≥ 20 条。'
          : '暂时算不出人格依据，请稍后重试。',
      });
      return;
    }

    const detail = personaFigureEvidenceDetail({
      overall: overall,
      shelf: shelf,
      notebooks: notebooks,
      corpus: corpus,
      dims: persona.dims || [],
      code: persona.code || '',
      name: persona.name || '',
      figureName: persona.figure ? persona.figure.name : '',
    });
    this.setData({ error: '', detail: this.toView(detail, persona) });
  },

  toView(detail, persona) {
    const sections = (detail.sections || []).map((section) => ({
      key: section.key,
      title: section.title,
      available: section.available,
      pickText: section.available ? (section.pick + ' ' + section.pct + '%') : '数据不足',
      lead: section.lead,
      stats: section.stats || [],
      groups: (section.groups || []).filter((group) => group.books && group.books.length),
      rows: section.rows || [],
      notes: (section.notes || []).map((note) => ({
        text: note.text,
        src: '—— 《' + (note.title || '未命名') + '》' +
          (note.year ? ' · ' + note.year : '') +
          (note.hits ? ' · ' + note.hits : ''),
      })),
    }));
    return {
      code: detail.code,
      name: detail.name,
      figureName: detail.figureName,
      why: persona.figure ? persona.figure.why : '',
      sections: sections,
      quotes: (detail.quotes || []).map((quote) => ({
        text: quote.text,
        src: '—— 《' + (quote.title || '未命名') + '》' + (quote.year ? ' · ' + quote.year : ''),
      })),
      note: detail.note || '',
    };
  },
});
