const store = require('../../shared/store');
const { AI_ENABLED } = require('../../config');
const core = require('../../shared/wander-core');
const db = require('../../shared/wander-store');
const wanderData = require('../../shared/wander-data');
const { generateWanderText } = require('../../shared/wander-ai');
const { renderWanderShare } = require('../../shared/wander-share');
const { messageOf, isKeyError } = require('../../shared/errors');

Page({
  data: {
    hasKey: false,
    loading: false,
    loadingText: '',
    generating: false,
    error: '',
    needsKey: false,
    // 门槛 / 分级
    unlocked: false,
    marks: 0,
    thoughts: 0,
    needMarks: core.UNLOCK.marks,
    needThoughts: core.UNLOCK.thoughts,
    gapMarks: core.UNLOCK.marks,
    gapThoughts: core.UNLOCK.thoughts,
    tierName: '',
    weekly: 1,
    // 素材不足
    reason: '',
    count: 0,
    need: core.MATERIAL_MIN,
    materialMax: core.MATERIAL_MAX,
    // 本期
    issue: null,
    viewingArchive: false,
    history: [],
    canRoam: false,
    weekLeft: 0,
    aiError: '',
    sharing: false,
    shareImg: '',
    showShare: false,
    // 漫游规则说明弹层
    showRules: false,
    tiers: [],
    unlock: { marks: core.UNLOCK.marks, thoughts: core.UNLOCK.thoughts },
    myTier: '',
  },

  onLoad() {
    // 规则弹层要展示三档门槛表，档位定义为静态常量，进页面取一次即可
    this.setData({ tiers: core.TIERS });
  },

  onShow() {
    const hasKey = !!store.getKey();
    this.setData({ hasKey });
    if (!hasKey) {
      return;
    }
    if (this.data.viewingArchive) {
      this.refreshWeekLeft();
      return;
    }
    this.ensureIssue();
  },

  onPullDownRefresh() {
    if (!this.data.hasKey) {
      wx.stopPullDownRefresh();
      return;
    }
    // 下拉刷新 = 重新生成（消耗本周次数，与「重新生成」同一口径）
    this.generate(!!this.data.issue);
  },

  // 进入页面时：本周有直接展示；没有才生成（不额外消耗次数——本周第一次生成即计入每周篇数）
  ensureIssue() {
    if (this.data.generating) {
      return;
    }
    const current = db.getWeekIssue();
    if (current) {
      this.tier = core.tierByKey(current.tier);
      db.markSeen();
      this.setData({
        issue: core.toView(current),
        viewingArchive: false,
        loading: false,
        error: '',
        reason: '',
        aiError: '',
        myTier: current.tier || '',
      });
      this.loadHistory();
      this.refreshWeekLeft();
      return;
    }
    this.generate(false);
  },

  // 组刊：计数判门槛 → 分级 → 拉素材池 → 抽签选材 → 排版（M15 关闭 AI 时走纯本地规则排版）
  async generate(isRegen) {
    const key = store.getKey();
    if (!key) {
      this.setData({ hasKey: false, generating: false, loading: false });
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

    this.setData({
      generating: true,
      loading: !this.data.issue,
      error: '',
      needsKey: false,
      reason: '',
      aiError: '',
      loadingText: '正在读取你的笔记概览…',
    });

    // 看门狗（空闲超时）：每次有进展（进入下一阶段）就重新计时；若某一步长时间无响应，
    // 也要在超时后放掉骨架屏，绝不无限「响应中」。用「空闲」而非「总时长」计时，
    // 避免首次拉取 30 次划线 + 长文 AI 生成这类正常耗时被误判为卡死。
    const token = (this._genToken || 0) + 1;
    this._genToken = token;
    let watchdog = null;
    const arm = () => {
      if (watchdog) {
        clearTimeout(watchdog);
      }
      watchdog = setTimeout(() => {
        if (this._genToken !== token) {
          return;
        }
        this.setData({
          generating: false,
          loading: false,
          needsKey: false,
          error: '加载超时：网络或云函数较慢，请稍后重试',
        });
        wx.stopPullDownRefresh();
      }, 60000);
    };
    arm();

    // 全流程兜底：任一步意外抛出（云调用同步报错等）都要清掉 loading，避免页面一直「响应中」
    try {
      // 1) 计数 → 门槛与分级
      const countsRes = await wanderData.fetchCounts(key, isRegen);
      if (this._genToken !== token) {
        return;
      }
      if (!countsRes.ok) {
        this.setData({
          generating: false,
          loading: false,
          error: messageOf(countsRes, '读取数据失败'),
          needsKey: isKeyError(countsRes.code),
        });
        return;
      }
      const progress = core.tierProgress(countsRes.marks, countsRes.thoughts);
      this.tier = progress.tier;
      this.setData({
        marks: progress.marks,
        thoughts: progress.thoughts,
        unlocked: progress.unlocked,
        needMarks: progress.needMarks,
        needThoughts: progress.needThoughts,
        gapMarks: progress.gapMarks,
        gapThoughts: progress.gapThoughts,
        tierName: progress.tier ? progress.tier.name : '',
        weekly: progress.tier ? progress.tier.weekly : 1,
        myTier: progress.tier ? progress.tier.key : '',
      });
      if (!progress.unlocked) {
        this.setData({ generating: false, loading: false, locked: true });
        return;
      }

      // 2) 本周生成次数
      if (isRegen && db.weekLeft(progress.tier) <= 0) {
        this.setData({ generating: false, loading: false });
        wx.showToast({ title: '本周生成次数已用完', icon: 'none' });
        return;
      }

      // 3) 素材池（首次拉取划线原文较慢，给阶段提示）
      this.setData({ loadingText: '正在挑选同主题的划线 / 想法…' });
      arm();
      const poolRes = await wanderData.fetchPool(key, isRegen);
      if (this._genToken !== token) {
        return;
      }
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
        return;
      }

      // 4) 选材（尽量避开上一期的主题）
      const material = core.prepareWander(poolRes.pool, db.getUsed(), { avoidTheme: db.lastTheme() });
      if (!material.ok) {
        this.setData({
          generating: false,
          loading: false,
          reason: 'material',
          count: material.count || 0,
          need: material.need || core.MATERIAL_MIN,
          error: '',
        });
        return;
      }
      if (material.resetUsed) {
        db.resetUsed();
      }

      // 5) 组刊：AI 开启时走 AI 综述；M15 关闭时走纯本地规则排版（只按主题平铺素材）
      let issue;
      if (AI_ENABLED) {
        this.setData({ loadingText: '正在编织这一期主题综述…' });
        arm();
        // 读者的书单：供 AI 写「外部火花」出处时优先呼应他自己的书（保证书名真实存在）
        const bookMap = {};
        (poolRes.pool || []).forEach((item) => {
          const title = item && item.title;
          if (title && !bookMap[title]) {
            bookMap[title] = { title: title, author: item.author || '' };
          }
        });
        const text = await generateWanderText(material, progress.tier, {
          bookTitles: Object.keys(bookMap).map((title) => bookMap[title]),
        });
        if (this._genToken !== token) {
          return;
        }
        if (!text.ai) {
          const code = text.code || '';
          const msg = messageOf(text, '生成失败，请重试');
          if (this.data.issue) {
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
          return;
        }
        issue = core.makeIssue(material, text, progress.tier);
      } else {
        issue = core.makeLocalIssue(material, progress.tier);
      }
      db.saveIssue(issue);
      db.markUsed(material.materials);
      db.bumpWeek();
      db.markSeen();

      this.setData({
        generating: false,
        loading: false,
        error: '',
        reason: '',
        aiError: '',
        issue: core.toView(issue),
        viewingArchive: false,
        weekLeft: db.weekLeft(progress.tier),
      });
      this.loadHistory();
    } catch (err) {
      this.setData({
        generating: false,
        loading: false,
        needsKey: false,
        aiError: '',
        error: (err && err.message) || '生成失败，请重试',
      });
    } finally {
      clearTimeout(watchdog);
      wx.stopPullDownRefresh();
    }
  },

  loadHistory() {
    const currentWeek = core.weekKey();
    const history = db.listIssues()
      .filter((item) => item && item.week !== currentWeek)
      .map((item) => ({
        id: item.id,
        weekLabel: item.weekLabel || '',
        title: item.title || '',
        theme: item.theme || '',
        tierName: item.tierName || '',
        starred: !!item.starred,
      }));
    this.setData({ history: history, canRoam: history.length >= 1 });
  },

  refreshWeekLeft() {
    const tier = this.tier || core.tierByKey(this.data.issue && this.data.issue.tier);
    this.setData({ weekLeft: db.weekLeft(tier) });
  },

  regenerate() {
    this.generate(true);
  },

  retry() {
    this.generate(false);
  },

  backToCurrent() {
    this.setData({ viewingArchive: false, issue: null });
    this.ensureIssue();
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  viewArchive(e) {
    const id = e.currentTarget.dataset.id;
    const issue = db.getIssueById(id);
    if (!issue) {
      return;
    }
    this.setData({ issue: core.toView(issue), viewingArchive: true, aiError: '' });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  roam() {
    const issue = db.randomIssue();
    if (!issue) {
      return;
    }
    this.setData({ issue: core.toView(issue), viewingArchive: true, aiError: '' });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  toggleSource(e) {
    const index = e.currentTarget.dataset.index;
    const sources = this.data.issue && this.data.issue.sources ? this.data.issue.sources : [];
    if (!sources[index]) {
      return;
    }
    this.setData({ ['issue.sources[' + index + '].open']: !sources[index].open });
  },

  toggleStar() {
    const issue = this.data.issue;
    if (!issue) {
      return;
    }
    const starred = db.starIssue(issue.id);
    this.setData({ 'issue.starred': starred });
    this.loadHistory();
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
    const issue = this.data.issue;
    return {
      title: issue && issue.title ? issue.title : '我的灵感漫游 · 悦读且住',
      path: '/pages/wander/index',
    };
  },

  // ---- 分享图（本机 canvas 绘制 → 导出临时图片 → 弹层预览）----

  async generateShare() {
    const issue = this.data.issue;
    if (!issue || this.data.sharing) {
      return;
    }
    this.setData({ sharing: true });
    try {
      const canvas = await this.getShareCanvas();
      const size = renderWanderShare(canvas, issue, store.getProfile());
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

  // ---- 漫游规则说明（让用户看懂每周生成 / 档位门槛）----

  openRules() {
    this.setData({ showRules: true });
  },

  closeRules() {
    this.setData({ showRules: false });
  },

  noop() {},
});
