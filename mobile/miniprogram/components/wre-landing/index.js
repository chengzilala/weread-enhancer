/**
 * 引导页（landing）：未配置 Key 时展示的介绍内容
 *
 * 与 H5 端 h5/src/views/welcome.js 一一对应（导航条 / Hero / 界面示意 / 能做什么 /
 * 三步开始 / 怎么拿到 Key / 隐私说明 / CTA）。H5 在未配 Key 时整屏渲染引导页，
 * 小程序把同一份内容封装成组件，放进各页的「无 Key」分支，保证两端口径与视觉一致。
 *
 * 纯静态展示，不发任何请求；「开始使用」只对外抛 action 事件，由页面决定去哪配置 Key。
 */
const { SITE_NAME, LINKS } = require('../../config');

Component({
  // 允许 app.wxss 的全局样式（--wre-* 变量、.wre-btn 等）作用到组件内部
  options: { styleIsolation: 'apply-shared' },

  data: {
    brandName: SITE_NAME,
    brandSub: '阅读数据 · 人格 · 报告',

    // 界面示意：四个指标格
    previewCells: [
      { value: '28.5', unit: '小时', label: '本月阅读时长' },
      { value: '3', unit: '本', label: '本月读完' },
      { value: '12', unit: '天', label: '连续阅读' },
      { value: '沉思型', unit: '', label: '阅读人格' },
    ],
    // 近 7 天阅读时长示意（≥100 的柱子高亮）
    bars: [42, 68, 55, 80, 62, 100, 74],

    features: [
      { icon: '📊', name: '阅读数据总览', desc: '读了多久、多少本、连续多少天，一屏看清这段时间的阅读状态。' },
      { icon: '🧬', name: '阅读人格画像', desc: '从你的阅读偏好里提炼出一个「人格」，用一个词概括你是个怎样的读者。' },
      { icon: '🪞', name: '阅读行为报告', desc: '阅读时段、偏好主题、阅读集中度，自动整理成一份报告。' },
      { icon: '📅', name: '每日卡片', desc: '每天一张卡片，配一句和你阅读有关的话。' },
      { icon: '🧭', name: '灵感漫游', desc: '把你的笔记与划线发散成一张主题网，偶尔给你一点新灵感。' },
      { icon: '📚', name: '书架与笔记', desc: '在手机上直接看你的书架、搜书评、翻自己的划线与想法。' },
    ],

    steps: [
      { no: 1, name: '拿到微信读书 Key', desc: '在微信读书 App 里复制一段 wrk- 开头的 Key，下面有图文教程。' },
      { no: 2, name: '粘贴到「我的」', desc: '在「我的 → API Key」里粘贴 Key，点「保存并校验」，通过后就能用。' },
      { no: 3, name: '开始看你的数据', desc: '首页、人格、报告、书架随点随看，数据都在你手机里算。' },
    ],

    privacy: [
      { icon: '🔒', name: '只读不写', desc: '只用你给的 Key 读取你自己的阅读数据，不会修改你的账号。' },
      { icon: '📱', name: 'Key 只存本机', desc: 'Key 只保存在你手机里，调用时经微信云函数中转，不存储、不记录。' },
      { icon: '🧹', name: '随时可清', desc: '在「我的」里一键清除 Key，想撤就撤。' },
      { icon: '🧮', name: '本机计算', desc: '数据与人格都在你的手机里算，不上传到别处。' },
    ],

    // 「怎么拿到 Key」图文（默认收起，点开才加载图片）
    showKeyGuide: false,
    keyGuideSteps: [
      { no: 1, text: '打开微信读书 App → 底部「我」→ 右上角「设置」，找到并进入「微信读书 Skill」。', img: LINKS.site + '/app/assets/img/skill-step1.png' },
      { no: 2, text: '进来后往下拉，看「快速配置」区，第 ② 步就是「获取 API Key」。', img: LINKS.site + '/app/assets/img/skill-step2.png' },
      { no: 3, text: '点「复制 Key」，就得到一段 wrk- 开头的 Key（默认打码，点右侧「👁」可看明文）。', img: LINKS.site + '/app/assets/img/skill-step3.png' },
    ],
  },

  methods: {
    // 「开始使用」/「三步开始使用」/ 底部 CTA：交给页面去打开 Key 配置处
    onStart() {
      this.triggerEvent('action', { type: 'settings' });
    },

    // 「先看看能做什么」：平滑滚到「能做什么」区块
    onFeatures() {
      const q = this.createSelectorQuery();
      q.select('#wreLandingFeatures').boundingClientRect();
      q.selectViewport().scrollOffset();
      q.exec((res) => {
        const rect = res && res[0];
        const scroll = res && res[1];
        if (!rect || !scroll) {
          return;
        }
        wx.pageScrollTo({ scrollTop: scroll.scrollTop + rect.top - 12, duration: 260 });
      });
    },

    toggleKeyGuide() {
      this.setData({ showKeyGuide: !this.data.showKeyGuide });
    },
  },
});
