const store = require('../../shared/store');
const { AI_ENABLED } = require('../../config');
const core = require('../../shared/daily-core');
const db = require('../../shared/daily-store');
const dailyData = require('../../shared/daily-data');
const { generateDailyText } = require('../../shared/daily-ai');
const { renderDailyShare } = require('../../shared/daily-share');
const { messageOf, isKeyError } = require('../../shared/errors');

Page({
  data: {
    wreFs: 1,
    hasKey: false,
    loading: false,
    generating: false,
    error: '',
    needsKey: false,
    reason: '',
    count: 0,
    need: core.MATERIAL_MIN,
    card: null,
    viewingArchive: false,
    history: [],
    regenLeft: 0,
    aiError: '',
    sharing: false,
    shareImg: '',
    showShare: false,
  },

  onShow() {
    this.setData({ wreFs: store.getFontScale() });
    const hasKey = !!store.getKey();
    this.setData({ hasKey, regenLeft: db.regenLeft() });
    if (!hasKey) {
      return;
    }
    this.ensureCard();
  },

  onPullDownRefresh() {
    if (!this.data.hasKey) {
      wx.stopPullDownRefresh();
      return;
    }
    // 看往期时下拉 = 回到今天；否则下拉刷新 = 重新生成（会消耗当日次数，与「重新生成」同一口径）
    if (this.data.viewingArchive) {
      this.backToToday();
      wx.stopPullDownRefresh();
      return;
    }
    this.generate(!!this.data.card);
  },

  // 进入页面时的懒生成：今天有卡片就直接展示，没有才生成（不消耗当日次数）
  ensureCard() {
    if (this.data.card || this.data.generating) {
      return;
    }
    const today = db.getTodayCard();
    if (today) {
      this.setData({ card: core.toView(today), viewingArchive: false, loading: false, error: '', reason: '' });
      this.loadHistory();
      return;
    }
    this.generate(false);
  },

  // 组卡：拉素材池 → 抽签选材 → 排版（M15 关闭 AI 时走纯本地规则排版）
  async generate(isRegen) {
    const key = store.getKey();
    if (!key) {
      this.setData({ hasKey: false, loading: false, generating: false });
      return;
    }
    if (this.data.generating) {
      return;
    }
    if (AI_ENABLED && !store.getDeepSeekKey()) {
      // 仅 AI 开启时才需要 DeepSeek Key；M15 关闭后不受此限制
      this.setData({ generating: false, loading: false });
      wx.stopPullDownRefresh();
      return;
    }
    if (isRegen && db.regenLeft() <= 0) {
      wx.showToast({ title: '今日重新生成次数已用完', icon: 'none' });
      wx.stopPullDownRefresh();
      return;
    }

    this.setData({
      generating: true,
      loading: !this.data.card,
      error: '',
      needsKey: false,
      reason: '',
      aiError: '',
    });

    const poolRes = await dailyData.fetchPool(key, isRegen);
    if (!poolRes.ok) {
      if (poolRes.code === 'nocorpus') {
        this.setData({ generating: false, loading: false, reason: 'material', count: 0, need: core.MATERIAL_MIN, error: '' });
      } else {
        this.setData({
          generating: false,
          loading: false,
          error: messageOf(poolRes, '读取数据失败'),
          needsKey: isKeyError(poolRes.code),
        });
      }
      wx.stopPullDownRefresh();
      return;
    }

    const material = core.prepareMaterial(poolRes.pool, db.getUsed());
    if (!material.ok) {
      this.setData({
        generating: false,
        loading: false,
        reason: 'material',
        count: material.count || 0,
        need: material.need || core.MATERIAL_MIN,
        error: '',
      });
      wx.stopPullDownRefresh();
      return;
    }
    if (material.resetUsed) {
      // 已用素材覆盖整个池子 → 重置覆盖周期，保证还能取到素材
      db.resetUsed();
    }

    // 文案：AI 开启时走 AI 成文；M15 关闭时走纯本地规则排版（无 note、无解读）
    let text;
    if (AI_ENABLED) {
      text = await generateDailyText(material);
      if (!text.ai) {
        const code = text.code || '';
        const msg = messageOf(text, '生成失败，请重试');
        if (this.data.card) {
          this.setData({ generating: false, loading: false, aiError: msg });
        } else {
          this.setData({
            generating: false,
            loading: false,
            reason: '',
            aiError: '',
            error: msg,
            needsKey: code === 'nokey' || code === 'ai_auth',
          });
        }
        wx.stopPullDownRefresh();
        return;
      }
    } else {
      text = { ai: false, title: core.localTitle(material), note: '' };
    }

    const card = core.makeCard(material, text);
    db.saveCard(card);
    db.markUsed(material.main.text);
    const left = isRegen ? db.bumpRegen() : db.regenLeft();

    this.setData({
      generating: false,
      loading: false,
      error: '',
      reason: '',
      aiError: '',
      card: core.toView(card),
      viewingArchive: false,
      regenLeft: left,
    });
    this.loadHistory();
    wx.stopPullDownRefresh();
  },

  loadHistory() {
    const today = core.dateKey();
    const history = db.listCards()
      .filter((item) => item && item.date !== today)
      .map((item) => ({
        id: item.id,
        dateLabel: core.dayLabel(item.createdAt),
        title: item.title,
        quote: (item.quote && item.quote.text) || '',
        ai: !!item.ai,
        starred: !!item.starred,
      }));
    this.setData({ history: history });
  },

  regenerate() {
    this.generate(true);
  },

  retry() {
    this.generate(false);
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

  toggleRelated(e) {
    const index = e.currentTarget.dataset.index;
    const key = 'card.related[' + index + '].open';
    const related = this.data.card && this.data.card.related ? this.data.card.related : [];
    if (!related[index]) {
      return;
    }
    this.setData({ [key]: !related[index].open });
  },

  toggleStar() {
    const card = this.data.card;
    if (!card) {
      return;
    }
    const starred = db.starCard(card.id);
    this.setData({ 'card.starred': starred });
    this.loadHistory();
  },

  // ---- 往期回顾：点开某张往期卡片，看整张（引用 + 解读 + 关联旧划线）----
  viewCard(e) {
    const id = e.currentTarget.dataset.id;
    const past = db.getCardById(id);
    if (!past) {
      return;
    }
    this.setData({ card: core.toView(past), viewingArchive: true, aiError: '' });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  backToToday() {
    const today = db.getTodayCard();
    if (today) {
      this.setData({ card: core.toView(today), viewingArchive: false, aiError: '' });
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
      return;
    }
    this.setData({ card: null, viewingArchive: false, aiError: '' }, () => {
      this.ensureCard();
    });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  onShareAppMessage() {
    const card = this.data.card;
    return {
      title: card && card.title ? card.title : '我的今日卡片 · 悦读且住',
      path: '/pages/daily/index',
    };
  },

  // ---- 分享图（本机 canvas 绘制 → 导出临时图片 → 弹层预览）----

  async generateShare() {
    const card = this.data.card;
    if (!card || this.data.sharing) {
      return;
    }
    this.setData({ sharing: true });
    try {
      const canvas = await this.getShareCanvas();
      const size = renderDailyShare(canvas, card, store.getProfile());
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
        fileType: 'png',
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

  shareImage() {
    const filePath = this.data.shareImg;
    if (!filePath) {
      return;
    }
    if (typeof wx.showShareImageMenu !== 'function') {
      wx.showToast({ title: '当前微信版本不支持，请长按图片转发', icon: 'none' });
      return;
    }
    wx.showShareImageMenu({
      path: filePath,
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('cancel') < 0) {
          wx.showToast({ title: '转发失败，请长按图片转发', icon: 'none' });
        }
      },
    });
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
});
