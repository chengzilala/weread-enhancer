/**
 * 微信悦读 · 官方数据模块（v0.14.2）
 *
 * 定位：独立模块，不改动 content.js 与既有模块逻辑。经 manifest 的 content_scripts
 * 在 content.js 之前加载，与 content.js 共享隔离世界，可复用其全局 log() 与
 * #we-read-enhancer-root 容器。
 *
 * 职责（阶段十三 V1 + V2·上半 + v0.14.0 AI + v0.14.2 Key 集中入口）：
 *   1. 主菜单「🪞 阅读洞察」入口
 *   2. 面板：📊 阅读行为报告（时长与天数趋势 / 书架结构 / 知识脉络 / 笔记行为 /
 *      完读率 / 已读完书目 / 周期切换 / 环比 / 导出 Markdown / HTML / PDF）
 *   3. 主菜单「🔑 API Key」独立入口：集中填写微信读书 wrk- Key 与 DeepSeek Key
 *      （保存即校验 / 清除）；并监听 `wre-open-key-settings` 事件，供其它模块（如笔记）一键跳来配 Key
 *
 * 数据来源：微信读书官方 Agent Skill 网关（经 background.js 转发）：
 *   /readdata/detail（按周期）＋ /shelf/sync（书架）＋ /user/notebooks（笔记概览，游标分页）。
 * 隐私口径：Key 只存本机 chrome.storage.local；报告在本机生成，数据不上传。
 * 口径红线：官方所有时长字段单位是秒（严禁当分钟/小时）；Unix 时间戳展示转日期；
 *           分桶时间戳按「中国时区」取日期（网关按中国零点分桶但编码成 UTC 秒，
 *           直接按 UTC 或浏览器本地时区换算都会差一天）。
 */
(function () {
  'use strict';

  const CACHE_KEY = 'wreOfficialReportCache';
  const CACHE_TTL_MS = 10 * 60 * 1000;   // 报告缓存有效期：10 分钟
  const OVERVIEW_CACHE_KEY = 'wreOfficialOverviewCache';
  const OVERVIEW_TTL_MS = 30 * 60 * 1000; // 书架 + 笔记概览缓存：30 分钟（与周期无关，变动慢）
  const NOTEBOOKS_PAGE_SIZE = 100;        // /user/notebooks 每页条数
  const NOTEBOOKS_MAX_PAGES = 5;          // 最多翻 5 页（500 本），避免异常账号无限翻页
  const SHELF_BOOK_LIMIT = 20;            // 「已读完书目」最多列出条数
  const CATEGORY_LIMIT = 15;              // 「知识脉络」分类最多列出条数
  const CST_OFFSET_MS = 8 * 3600 * 1000; // 官方分桶时间戳是「中国时区零点」的 UTC 秒，展示需 +8h

  // ---- AI 增强（DeepSeek，可选）：数字本地算、人格化文字交给 AI 生成 ----
  const AI_TOP_BOOKS = 5;      // 取「笔记最多」的前 N 本书拉原文
  const AI_MARK_SAMPLE = 6;    // 每本书最多取 N 条划线样本
  const AI_REVIEW_SAMPLE = 6;  // 每本书最多取 N 条想法样本
  const AI_ANNUAL_YEARS = 4;   // 年度趋势：查最近 N 年（含当年）
  const AI_SYSTEM_PROMPT = '你是一位克制、客观的阅读分析师。请根据用户提供的微信读书真实统计值与少量划线/想法原文样本，为这位读者写一段「人格化执行摘要」。' +
    '要求：1) 用中文，真诚、有洞察，但不浮夸、不编造、不堆形容词；2) 严格基于所给数据，不得虚构任何数字，也不得杜撰用户没做过的事；3) 结构分三段——' +
    '① 一句话定性＋总体投入（书架数、累计时长、划线数、想法数）；② 2~3 个最突出的阅读特征（每个必须引用具体数据或原文佐证）；③ 时间轨迹信号（如年度时长变化）；' +
    '4) 直接输出正文自然段，不要加任何标题、序号或 Markdown 符号。';
  const AI_PERSONA_PROMPT = '你是一位克制、客观的阅读分析师。请根据用户提供的微信读书真实统计值、分类偏好、笔记最多的几本书及划线/想法原文样本、年度时长变化，为这位读者写一段有深度、有洞察的「人性化人格分析」。' +
    '要求：1) 用中文，真诚、有洞察，像朋友的口吻，但不浮夸、不编造、不堆形容词；2) 严格基于所给数据与原文，不得虚构任何数字，也不得杜撰用户没做过的事；' +
    '3) 分 4~6 个要点输出，每个要点揭示一个最鲜明的阅读/思维特质，做深挖而非概述，每个论断都要落到具体证据上（须点出具体书名、划线/想法条数、引用原文或年度数字）；' +
    '4) 输出格式必须严格如下——每个要点两行起步：第一行是「第N、小标题」（小标题 2~6 个字，如「第一性原理」「系统进阶」「深夜思考者」），下一行开始为该要点的论述正文；要点之间空一行。示例：\n' +
    '第一、第一性原理\n他不接受给定的知识，而是追问概念的起源……（正文）\n\n' +
    '第二、系统进阶\n他每进入一个新领域都沿一条路径系统性地读多本书……（正文）\n' +
    '5) 不要输出总标题，不要用 Markdown 符号，直接按上述格式输出。';
  const AI_READING_PERSONA_PROMPT = '你是一位克制、有洞察的阅读分析师。用户已经在本机用固定规则算出了一套「阅读人格」四维判定（这不是心理测评），请你只做「润色」：把这些冷冰冰的判定，写成一段有温度、有代入感的人格化画像。' +
    '要求：1) 用中文、第二人称「你」，真诚、克制，像懂他的朋友在说话，不浮夸、不堆形容词；2) 严格基于所给的代码、主称号、四维判定值与证据，不得虚构任何数字，也不得杜撰用户没做过的事；' +
    '3) 结构为两段：第一段用一个生活化的比喻点出这个人格的整体气质（呼应主称号）；第二段结合四维与证据，写出这种气质在真实阅读里的样子；4) 只描述、不评判，不使用任何负向词（如懒惰/浅薄/拖延）；' +
    '5) 不要输出标题、序号或任何 Markdown 符号，直接输出两段正文，段与段之间空一行。';
  const MODES = [
    { key: 'weekly', label: '本周' },
    { key: 'monthly', label: '本月' },
    { key: 'annually', label: '本年' },
    { key: 'overall', label: '累计' },
  ];

  // ==================== 阅读人格（阶段十四 · 读书人版）====================
  // 定位：基于官方阅读数据，在本机推出一套 16 型「读书人」人格 + 词语分析。
  // 红线：纯本机计算、不引入任何外部依赖（含中文分词库）；判定不含随机、不依赖 AI（可复算）；
  //       对外不使用 MBTI® 商标名，页面固定声明「趣味参考、非心理测评」。
  const PERSONA_CACHE_KEY = 'wrePersonaCorpusCache';
  const PERSONA_CACHE_TTL_MS = 10 * 60 * 1000; // 语料缓存：10 分钟（与报告缓存一致）
  const PERSONA_TOP_BOOKS = 5;                 // 语料：取「笔记最多」的前 N 本书
  const PERSONA_MARK_MAX = 400;                // 语料：单本书最多取 N 条划线
  const PERSONA_CORPUS_MAX = 2000;             // 语料：总条数上限（防极端账号卡顿）
  const PERSONA_MIN_SECONDS = 10 * 3600;       // 数据门槛（累计）：有效阅读 ≥ 10 小时
  const PERSONA_MIN_NOTES = 20;                // 数据门槛（累计）：笔记（划线+想法）≥ 20 条
  const PERSONA_WORD_TOP = 10;                 // 高频词 TOP N
  const PERSONA_CLOUD_TOP = 15;                // 词云词数
  const PERSONA_QUOTE_MAX = 3;                 // 原文证据最多条数

  // D2 内容取向：分类标题 → 求实 / 求意（按关键词包含匹配，未命中记为中性、不参与占比）
  const PERSONA_FACT_KEYS = ['职场', '经济', '理财', '金融', '投资', '管理', '商业', '营销', '创业', '科技', '互联网', '计算机', '程序', '软件', '工程', '算法', '效率', '工具', '方法', '教育', '学习', '备考', '考试', '健康', '医学', '养生', '运动', '健身', '成长', '提升', '励志', '成功', '沟通', '谈判', '时间管理', '认知升级'];
  const PERSONA_MEANING_KEYS = ['文学', '小说', '散文', '诗歌', '随笔', '历史', '哲学', '思想', '心理', '精神', '社科', '社会', '文化', '艺术', '音乐', '绘画', '电影', '设计', '传记', '人物', '宗教', '信仰', '美学', '生活', '旅行', '自然', '博物', '国学', '古籍'];

  // D3 表达方式：逻辑词 / 情感词（本地词表计数；同时用于「口头禅 / 高频词」的优先命中）
  const PERSONA_LOGIC_WORDS = ['因为', '所以', '因此', '由于', '本质', '逻辑', '系统', '结构', '方法', '步骤', '数据', '结论', '假设', '验证', '机制', '原理', '模型', '规律', '分析', '证明', '推理', '认知', '定义', '概念', '框架', '策略', '效率', '原因', '结果', '条件', '标准', '问题', '答案', '关键', '核心', '路径', '过程', '变量', '概率', '成本', '收益', '边界', '视角', '层面', '维度', '前提', '矛盾', '悖论', '反思', '审视', '拆解', '推导', '归纳', '演绎', '判断', '决策', '选择', '证据', '事实', '真相', '客观', '理性'];
  const PERSONA_EMOTION_WORDS = ['喜欢', '感动', '难过', '温暖', '孤独', '美好', '心疼', '遗憾', '幸福', '痛苦', '开心', '快乐', '悲伤', '愤怒', '焦虑', '平静', '希望', '失望', '勇敢', '温柔', '治愈', '想念', '怀念', '珍惜', '放下', '陪伴', '理解', '尊重', '热爱', '真诚', '善良', '感激', '感谢', '害怕', '担心', '不安', '欣慰', '满足', '柔软', '心碎', '心酸', '释然', '宁静', '浪漫', '诗意', '自由'];

  // 情绪比例：正向 / 负向词表（中性 = 未命中任何情绪词的句）
  const PERSONA_POSITIVE_WORDS = ['喜欢', '感动', '温暖', '美好', '幸福', '开心', '快乐', '平静', '希望', '勇敢', '温柔', '治愈', '珍惜', '陪伴', '理解', '尊重', '热爱', '真诚', '善良', '感激', '感谢', '欣慰', '满足', '释然', '宁静', '浪漫', '诗意', '自由', '幸运', '惊喜'];
  const PERSONA_NEGATIVE_WORDS = ['难过', '孤独', '心疼', '遗憾', '痛苦', '悲伤', '愤怒', '焦虑', '失望', '害怕', '担心', '不安', '心碎', '心酸', '恐惧', '绝望', '压抑', '委屈', '疲惫', '厌倦', '悔恨', '麻木'];

  // 主题词：把高频词归并到 5 个主题（取第一个命中的主题）
  const PERSONA_THEMES = [
    { name: '自我与成长', words: ['自己', '成长', '改变', '选择', '人生', '意义', '价值', '目标', '习惯', '行动', '时间', '自由', '勇气', '坚持', '努力', '命运', '身份', '边界', '孤独', '存在'] },
    { name: '关系与情感', words: ['关系', '朋友', '喜欢', '家人', '陪伴', '理解', '情绪', '感受', '温柔', '温暖', '爱', '想念', '遗憾', '幸福', '痛苦', '悲伤', '沟通', '信任', '善意', '亲情'] },
    { name: '方法与效率', words: ['方法', '系统', '逻辑', '结构', '效率', '计划', '问题', '答案', '思维', '学习', '知识', '策略', '决策', '模型', '框架', '认知', '习惯', '工具', '实践', '复盘'] },
    { name: '历史与社会', words: ['历史', '社会', '文化', '世界', '时代', '国家', '制度', '经济', '城市', '文明', '政治', '战争', '权力', '秩序', '变革', '群体', '市场', '组织', '规则', '趋势'] },
    { name: '文学与艺术', words: ['文学', '小说', '故事', '诗歌', '艺术', '文字', '语言', '想象', '阅读', '写作', '音乐', '电影', '绘画', '美', '诗', '镜头', '意象', '叙事', '散文', '旋律'] },
  ];

  // 常见停用词 / 功能词（仅用于过滤 n-gram 候选，不参与正向词表匹配）
  const PERSONA_STOPWORDS = ['我们', '你们', '他们', '她们', '这个', '那个', '这些', '那些', '一个', '一种', '一样', '一些', '什么', '怎么', '这样', '那样', '如果', '但是', '可是', '然后', '而且', '并且', '或者', '还是', '就是', '只是', '而是', '不是', '没有', '不能', '可以', '能够', '应该', '需要', '进行', '通过', '对于', '关于', '以及', '已经', '正在', '自己', '它', '他们'];

  // 16 型命名表（主称号 + 一句定调）
  const PERSONA_TYPES = {
    DFLP: ['书房里的匠人', '把一本书当成一门手艺，读完还要动手做一遍'],
    DFLR: ['深夜的修表匠', '喜欢把一个问题拆到零件级，慢慢调准'],
    DFEP: ['养蜂人的田野笔记', '认真生活、认真记录，读完就想用在自己身上'],
    DFER: ['炉边的采药人', '随手翻，翻到了就种草，读一点用一点'],
    DMLP: ['解经的学徒', '系统地读，一心想把道理彻底想通'],
    DMLR: ['深夜的勘探者', '一个人往深处挖，挖到哪算哪'],
    DMEP: ['点灯的诗经学者', '又感性又较真，把喜欢的东西读成自己的'],
    DMER: ['夜航的摘星人', '顺着情绪和好奇心走，深潜，但不设路线'],
    BFLP: ['效率编辑部', '目标明确、口味实用，读书像在开选题会'],
    BFLR: ['逛书店的采购员', '什么都看，好东西先囤起来再说'],
    BFEP: ['生活小百科', '生活里遇到什么就查什么，读完立刻分享'],
    BFER: ['街角读书会', '杂食、热情、什么都想聊两句'],
    BMLP: ['知识地图绘制者', '有计划地铺开，一心想把整张地图画完'],
    BMLR: ['思想的漫游者', '跨着读，读着读着就串成一条线'],
    BMEP: ['讲故事的引路人', '爱读人的故事，也爱把故事讲给别人听'],
    BMER: ['赶集的说书人', '什么热闹读什么，读完就开讲'],
  };

  // 三个特质绰号：各维极点 → 绰号池
  const PERSONA_NICKNAMES = {
    energyD: '深潜者', energyB: '杂食派',
    contentF: '解决问题的人', contentM: '意义收集者',
    styleL: '拆解者', styleE: '共情者',
    rhythmP: '清单执行者', rhythmR: '缘读者',
  };

  // 16 型人物对照（2026-10-04 新增）：每型一位公共领域世界级文化名人。
  // 红线：非宗教、非政治、已进入公有领域；只用线描自绘，不使用真人照片、运行时不联网。
  const PERSONA_FIGURES = {
    DFLP: { name: '牛顿', line: '像牛顿那样，把一本书读成一门手艺' },
    DFLR: { name: '达·芬奇', line: '像达·芬奇那样，把问题拆到零件级' },
    DFEP: { name: '达尔文', line: '像达尔文那样，长期观察、认真记录' },
    DFER: { name: '阿基米德', line: '像阿基米德那样，边玩边试，学了就用' },
    DMLP: { name: '康德', line: '像康德那样，极度规律，系统想通' },
    DMLR: { name: '图灵', line: '像图灵那样，独自往抽象深处挖' },
    DMEP: { name: '苏轼', line: '像苏轼那样，又深情又较真' },
    DMER: { name: '李白', line: '像李白那样，浪漫随性，投入极深' },
    BFLP: { name: '爱迪生', line: '像爱迪生那样，目标明确、成体系地做' },
    BFLR: { name: '马克·吐温', line: '像马克·吐温那样，什么都读，先囤再说' },
    BFEP: { name: '李时珍', line: '像李时珍那样，生活里观察，温暖又细致' },
    BFER: { name: '莫扎特', line: '像莫扎特那样，杂食热情、爱分享' },
    BMLP: { name: '亚里士多德', line: '像亚里士多德那样，有计划地铺开整张地图' },
    BMLR: { name: '蒙田', line: '像蒙田那样，跨着读，串成一条线' },
    BMEP: { name: '安徒生', line: '像安徒生那样，爱读故事，也爱讲给人听' },
    BMER: { name: '莎士比亚', line: '像莎士比亚那样，什么热闹读什么，读完就开讲' },
  };

  // 线描插画底稿：圆框 + 肩颈 + 头 + 五官（线条颜色用占位符，按用途替换）
  const PERSONA_FIGURE_FRAME =
    '<circle cx="120" cy="120" r="110" stroke="__INK__" stroke-width="3" opacity="0.28"/>' +
    '<path d="M58 234 C60 200 84 180 106 172 L134 172 C156 180 180 200 182 234" stroke="__INK__" stroke-width="5"/>' +
    '<path d="M106 142 L106 172 M134 142 L134 172" stroke="__INK__" stroke-width="5"/>';
  const PERSONA_FIGURE_HEAD =
    '<ellipse cx="120" cy="102" rx="39" ry="45" stroke="__INK__" stroke-width="5"/>' +
    '<path d="M81 98 C75 96 74 105 77 111 C79 115 82 116 84 115" stroke="__INK__" stroke-width="4"/>' +
    '<path d="M159 98 C165 96 166 105 163 111 C161 115 158 116 156 115" stroke="__INK__" stroke-width="4"/>' +
    '<circle cx="107" cy="102" r="3" fill="__INK__"/>' +
    '<circle cx="133" cy="102" r="3" fill="__INK__"/>' +
    '<path d="M120 104 C117 114 117 118 122 119" stroke="__INK__" stroke-width="3.5"/>' +
    '<path d="M112 130 C117 134 123 134 128 130" stroke="__INK__" stroke-width="3.5"/>';

  // 各型专属特征（back：画在头后，如长发/头巾；front：画在头前，如帽/须/领）
  const PERSONA_FIGURE_PARTS = {
    DFLP: {
      back: '<path d="M76 108 C58 70 88 42 120 42 C152 42 182 70 164 108 C172 130 168 152 156 164 L84 164 C72 152 68 130 76 108 Z" stroke="__INK__" stroke-width="5"/>',
      front: '<circle cx="78" cy="112" r="11" stroke="__INK__" stroke-width="4"/><circle cx="76" cy="132" r="11" stroke="__INK__" stroke-width="4"/><circle cx="80" cy="152" r="11" stroke="__INK__" stroke-width="4"/>' +
        '<circle cx="162" cy="112" r="11" stroke="__INK__" stroke-width="4"/><circle cx="164" cy="132" r="11" stroke="__INK__" stroke-width="4"/><circle cx="160" cy="152" r="11" stroke="__INK__" stroke-width="4"/>' +
        '<path d="M104 170 L120 192 L136 170" stroke="__ACCENT__" stroke-width="5"/><path d="M106 190 C112 202 128 202 134 190" stroke="__INK__" stroke-width="4"/>',
    },
    DFLR: {
      back: '<path d="M74 108 C62 66 90 42 120 42 C150 42 178 66 166 108 C172 134 170 154 164 166 L76 166 C70 154 68 134 74 108 Z" stroke="__INK__" stroke-width="5"/>',
      front: '<path d="M86 112 C84 152 100 182 120 184 C140 182 156 152 154 112" stroke="__INK__" stroke-width="5"/>' +
        '<path d="M104 126 C112 120 128 120 136 126" stroke="__INK__" stroke-width="4"/>' +
        '<path d="M84 60 C92 42 148 42 156 60 C159 68 150 72 144 66 C128 54 112 54 96 66 C90 72 81 68 84 60 Z" stroke="__INK__" stroke-width="5"/>',
    },
    DFEP: {
      back: '<path d="M82 96 C76 80 80 68 90 60" stroke="__INK__" stroke-width="5"/><path d="M158 96 C164 80 160 68 150 60" stroke="__INK__" stroke-width="5"/>',
      front: '<path d="M100 93 C106 89 114 89 118 93" stroke="__INK__" stroke-width="4"/><path d="M122 93 C126 89 134 89 140 93" stroke="__INK__" stroke-width="4"/>' +
        '<path d="M86 116 C86 156 102 182 120 182 C138 182 154 156 154 116 C150 132 138 140 120 140 C102 140 90 132 86 116 Z" stroke="__INK__" stroke-width="5"/>' +
        '<path d="M104 130 C112 126 128 126 136 130" stroke="__INK__" stroke-width="4"/>',
    },
    DFER: {
      back: '<circle cx="90" cy="70" r="10" stroke="__INK__" stroke-width="4"/><circle cx="108" cy="60" r="11" stroke="__INK__" stroke-width="4"/><circle cx="132" cy="60" r="11" stroke="__INK__" stroke-width="4"/><circle cx="150" cy="70" r="10" stroke="__INK__" stroke-width="4"/><circle cx="80" cy="90" r="9" stroke="__INK__" stroke-width="4"/><circle cx="160" cy="90" r="9" stroke="__INK__" stroke-width="4"/>',
      front: '<path d="M88 114 C88 156 104 182 120 182 C136 182 152 156 152 114" stroke="__INK__" stroke-width="5"/>' +
        '<path d="M104 128 C112 124 128 124 136 128" stroke="__INK__" stroke-width="4"/>' +
        '<path d="M83 86 C100 78 140 78 157 86" stroke="__ACCENT__" stroke-width="5"/>',
    },
    DMLP: {
      back: '',
      front: '<path d="M82 92 C82 60 100 46 120 46 C140 46 158 60 158 92" stroke="__INK__" stroke-width="5"/>' +
        '<circle cx="80" cy="108" r="13" stroke="__INK__" stroke-width="5"/><circle cx="160" cy="108" r="13" stroke="__INK__" stroke-width="5"/>' +
        '<path d="M104 170 L120 190 L136 170" stroke="__ACCENT__" stroke-width="5"/><path d="M106 188 C112 200 128 200 134 188" stroke="__INK__" stroke-width="4"/>',
    },
    DMLR: {
      back: '',
      front: '<path d="M83 92 C83 60 102 48 122 48 C142 48 157 62 157 88 C150 76 136 68 118 70 C104 72 91 80 83 92 Z" stroke="__INK__" stroke-width="5"/>' +
        '<path d="M106 172 L120 188 L134 172" stroke="__INK__" stroke-width="4"/><path d="M120 178 L113 190 L120 214 L127 190 Z" stroke="__ACCENT__" stroke-width="4"/>',
    },
    DMEP: {
      back: '',
      front: '<path d="M92 62 L92 34 L148 34 L148 62 Z" stroke="__INK__" stroke-width="5"/><path d="M82 62 C100 54 140 54 158 62" stroke="__INK__" stroke-width="5"/>' +
        '<path d="M98 128 C98 154 108 168 120 168 C132 168 142 154 142 128" stroke="__INK__" stroke-width="5"/><path d="M108 130 C114 126 126 126 132 130" stroke="__INK__" stroke-width="4"/>' +
        '<path d="M106 172 L120 194 L134 172" stroke="__INK__" stroke-width="5"/><path d="M120 194 L120 210" stroke="__INK__" stroke-width="5"/><path d="M112 176 L120 190 M128 176 L120 190" stroke="__INK__" stroke-width="3.5"/>',
    },
    DMER: {
      back: '',
      front: '<path d="M86 60 C94 44 146 44 154 60 C148 68 92 68 86 60 Z" stroke="__INK__" stroke-width="5"/><path d="M84 64 L156 64" stroke="__ACCENT__" stroke-width="5"/><path d="M154 60 C166 56 172 64 166 72" stroke="__INK__" stroke-width="4"/>' +
        '<path d="M104 130 C104 158 112 172 120 172 C128 172 136 158 136 130" stroke="__INK__" stroke-width="4"/>',
    },
    BFLP: {
      back: '',
      front: '<path d="M80 86 C72 66 86 52 100 56 C104 44 126 42 134 54 C148 46 162 58 158 76 C166 84 163 96 154 98 C150 84 140 74 120 74 C100 74 88 82 80 86 Z" stroke="__INK__" stroke-width="5"/>' +
        '<path d="M108 172 L120 200 L132 172" stroke="__INK__" stroke-width="4"/><path d="M120 200 L120 214" stroke="__ACCENT__" stroke-width="4"/>',
    },
    BFLR: {
      back: '<circle cx="78" cy="86" r="14" stroke="__INK__" stroke-width="4"/><circle cx="94" cy="64" r="15" stroke="__INK__" stroke-width="4"/><circle cx="120" cy="54" r="17" stroke="__INK__" stroke-width="4"/><circle cx="146" cy="64" r="15" stroke="__INK__" stroke-width="4"/><circle cx="162" cy="86" r="14" stroke="__INK__" stroke-width="4"/><circle cx="70" cy="112" r="13" stroke="__INK__" stroke-width="4"/><circle cx="170" cy="112" r="13" stroke="__INK__" stroke-width="4"/>',
      front: '<path d="M98 126 C110 116 130 116 142 126 C130 134 110 134 98 126 Z" stroke="__INK__" stroke-width="4"/>' +
        '<path d="M120 178 L104 170 L104 188 Z" stroke="__ACCENT__" stroke-width="4"/><path d="M120 178 L136 170 L136 188 Z" stroke="__ACCENT__" stroke-width="4"/>',
    },
    BFEP: {
      back: '<path d="M134 170 C134 156 146 148 160 150 L166 182 C152 190 134 188 134 170 Z" stroke="__INK__" stroke-width="4"/>' +
        '<path d="M146 152 L140 134 M158 150 L158 132 M168 154 L176 138" stroke="__ACCENT__" stroke-width="3.5"/>',
      front: '<path d="M86 72 C86 44 100 32 120 32 C140 32 154 44 154 72 Z" stroke="__INK__" stroke-width="5"/>' +
        '<circle cx="120" cy="28" r="4.5" stroke="__INK__" stroke-width="3.5"/>' +
        '<path d="M84 72 L156 72" stroke="__ACCENT__" stroke-width="4"/>' +
        '<path d="M110 136 C106 154 114 166 120 166 C126 166 134 154 130 136" stroke="__INK__" stroke-width="4"/>',
    },
    BFER: {
      back: '<path d="M76 104 C64 70 90 46 120 46 C150 46 176 70 164 104" stroke="__INK__" stroke-width="5"/><path d="M164 96 C176 100 182 116 174 130" stroke="__INK__" stroke-width="4"/>',
      front: '<circle cx="78" cy="104" r="11" stroke="__INK__" stroke-width="4"/><circle cx="78" cy="124" r="11" stroke="__INK__" stroke-width="4"/><circle cx="78" cy="144" r="11" stroke="__INK__" stroke-width="4"/>' +
        '<circle cx="162" cy="104" r="11" stroke="__INK__" stroke-width="4"/><circle cx="162" cy="124" r="11" stroke="__INK__" stroke-width="4"/><circle cx="162" cy="144" r="11" stroke="__INK__" stroke-width="4"/>' +
        '<path d="M172 128 C176 136 174 142 168 144" stroke="__ACCENT__" stroke-width="4"/>',
    },
    BMLP: {
      back: '<circle cx="90" cy="70" r="10" stroke="__INK__" stroke-width="4"/><circle cx="110" cy="60" r="11" stroke="__INK__" stroke-width="4"/><circle cx="132" cy="60" r="11" stroke="__INK__" stroke-width="4"/><circle cx="150" cy="70" r="10" stroke="__INK__" stroke-width="4"/><circle cx="80" cy="88" r="9" stroke="__INK__" stroke-width="4"/><circle cx="160" cy="88" r="9" stroke="__INK__" stroke-width="4"/>',
      front: '<path d="M88 118 C88 156 104 178 120 178 C136 178 152 156 152 118" stroke="__INK__" stroke-width="5"/><path d="M104 130 C112 126 128 126 136 130" stroke="__INK__" stroke-width="4"/>' +
        '<path d="M92 200 L108 176 M148 200 L132 176" stroke="__INK__" stroke-width="4"/>',
    },
    BMLR: {
      back: '',
      front: '<path d="M86 58 C94 42 146 42 154 58 C152 66 88 66 86 58 Z" stroke="__INK__" stroke-width="5"/>' +
        '<path d="M100 132 C104 148 112 156 120 156 C128 156 136 148 140 132" stroke="__INK__" stroke-width="4"/><path d="M108 128 C114 124 126 124 132 128" stroke="__INK__" stroke-width="4"/>' +
        '<path d="M94 170 C100 184 112 184 118 174 C122 184 136 184 144 170 C150 180 142 192 120 192 C98 192 88 180 94 170 Z" stroke="__INK__" stroke-width="4"/>',
    },
    BMEP: {
      back: '<path d="M84 104 C80 86 86 72 96 64" stroke="__INK__" stroke-width="5"/><path d="M156 104 C160 86 154 72 144 64" stroke="__INK__" stroke-width="5"/>',
      front: '<path d="M108 172 L104 190 L120 196 L136 190 L132 172" stroke="__INK__" stroke-width="4"/><path d="M120 196 L120 210" stroke="__ACCENT__" stroke-width="4"/>',
    },
    BMER: {
      back: '<path d="M84 106 C80 88 88 74 98 66" stroke="__INK__" stroke-width="5"/><path d="M156 106 C160 88 152 74 142 66" stroke="__INK__" stroke-width="5"/>',
      front: '<path d="M108 128 C114 124 126 124 132 128" stroke="__INK__" stroke-width="4"/><path d="M113 134 C116 146 124 146 127 134" stroke="__INK__" stroke-width="4"/>' +
        '<circle cx="158" cy="116" r="4" stroke="__ACCENT__" stroke-width="3"/>' +
        '<path d="M94 170 C100 184 112 184 118 174 C122 184 136 184 144 170 C150 180 142 192 120 192 C98 192 88 180 94 170 Z" stroke="__INK__" stroke-width="4"/>',
    },
  };

  // 生成某型的线描插画 SVG；mode 为 'canvas' 时用固定墨色，否则用 currentColor 以适配主题
  function personaFigureSvg(code, mode) {
    const part = PERSONA_FIGURE_PARTS[code];
    if (!part) {
      return '';
    }
    const ink = (mode === 'canvas') ? '#1f2328' : 'currentColor';
    const accent = '#07c160';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
      PERSONA_FIGURE_FRAME + (part.back || '') + PERSONA_FIGURE_HEAD + (part.front || '') +
      '</svg>';
    return svg.replace(/__INK__/g, ink).replace(/__ACCENT__/g, accent);
  }

  // ---- 附带能力（阶段十三-5）：书架概览 + 搜书 / 书评 / 推荐 ----
  // 搜书 scope 必须显式传（官方默认不找书）：找书 10 / 泛搜 0 / 网文 16 / 听书 14 /
  // 作者 6 / 全文 12 / 书单 13 / 公众号 2 / 文章 4。
  const SEARCH_SCOPES = [
    { key: 10, label: '找书' },
    { key: 0, label: '泛搜' },
    { key: 16, label: '网文' },
    { key: 14, label: '听书' },
    { key: 6, label: '作者' },
    { key: 12, label: '全文' },
    { key: 13, label: '书单' },
    { key: 2, label: '公众号' },
    { key: 4, label: '文章' },
  ];
  const SEARCH_PAGE_SIZE = 10;
  // 公开书评类型：0 全部 / 1 推荐 / 2 不行 / 3 最新 / 4 一般
  const REVIEW_TYPES = [
    { key: 0, label: '全部' },
    { key: 1, label: '推荐' },
    { key: 2, label: '不行' },
    { key: 3, label: '最新' },
    { key: 4, label: '一般' },
  ];
  const REVIEW_PAGE_SIZE = 10;
  const RECOMMEND_PAGE_SIZE = 10;
  const SHELF_PAGE_STEP = 30;    // 书架列表「显示更多」步长

  let mode = 'monthly';
  let report = null;        // 当前展示的报告数据（/readdata/detail，按周期）
  let reportState = 'idle'; // idle | loading | ok | error
  let reportError = '';
  let reportFromCache = false;
  let reportAt = 0;
  let overallReport = null; // 累计（总体）数据：执行摘要 / 人格分析固定基于它，与周期选择无关
  let upgradeInfo = null;
  let overview = null;        // 与周期无关的书架 + 笔记概览：{ at, shelf, notebooks }
  let overviewState = 'idle'; // idle | loading | ok | partial | error
  let overviewError = '';
  let keyStatus = { hasKey: false, apiKey: '', savedAt: 0, lastVerifiedAt: 0, skillVersion: '' };
  let settingsMessage = '';
  let aiSettingsMessage = '';   // DeepSeek Key 区的提示（独立于微信读书 Key 区）
  let draftWrkKey = '';   // 输入框草稿：保存/重渲染后仍保留用户粘贴的微信读书 Key
  let draftAiKey = '';    // 输入框草稿：保留用户粘贴的 DeepSeek Key
  let aiKeyStatus = { hasKey: false, apiKey: '', savedAt: 0 };  // DeepSeek Key 状态（可选）
  let aiSummary = null;   // AI 生成的人格化执行摘要（字符串数组，每项一段）
  let aiPersona = null;   // AI 生成的人性化人格分析（[{ title, body }] 分点数组）
  let aiState = 'idle';   // idle | loading | ok | error | skipped
  let aiError = '';
  let aiPersonaError = '';   // 人格分析失败原因（成功后清空）
  let aiReadingPersona = null;      // 「阅读人格（读书人版）」的 AI 润色正文（字符串，可选）
  let aiReadingPersonaError = '';   // 阅读人格 AI 润色失败原因（成功后清空）

  // ---- 阅读人格（阶段十四 · 读书人版）状态 ----
  let personaCorpus = null;        // 语料：{ at, books:[{title,author,marks:[{text,at}],reviews:[{text,at}]}] }
  let personaCorpusState = 'idle'; // idle | loading | ok | error
  let personaCorpusError = '';

  // ---- 附带能力状态：视图页签 + 书架 + 发现（搜书 / 书评 / 推荐） ----
  let view = 'report';          // report | shelf | discover
  let shelfShown = SHELF_PAGE_STEP;
  let shelfFetching = false;    // 书架视图是否正在拉取（避免重复请求）
  const discover = {
    tab: 'search',              // search | recommend
    keyword: '',
    scope: 10,
    searchState: 'idle',        // idle | loading | ok | error
    searchError: '',
    searchItems: [],
    searchMaxIdx: 0,
    searchHasMore: false,
    recommendState: 'idle',
    recommendError: '',
    recommendItems: [],
    recommendMaxIdx: 0,
    recommendHasMore: false,
    openBookId: '',             // 当前展开「详情 / 书评 / 相似书」的条目
    openBookTitle: '',
    detailKind: '',             // '' | detail | review | similar
    infoState: 'idle',          // 详情（/book/info + /book/chapterinfo）
    infoError: '',
    infoData: null,
    chapters: [],
    reviewType: 0,
    reviewState: 'idle',
    reviewError: '',
    reviewItems: [],
    reviewMaxIdx: 0,
    reviewHasMore: false,
    similarState: 'idle',
    similarError: '',
    similarItems: [],
    similarSessionId: '',
    similarMaxIdx: 0,
    similarHasMore: false,
  };

  // ---------- 通用小工具 ----------

  function logOfficial(level, message, meta) {
    if (typeof log === 'function') {
      log(level, '[official] ' + message, meta);
    }
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  /** 官方分桶时间戳 → 中国时区的 年/月/日
   *  实测：网关按「中国时区零点」分桶，但编码成 UTC 秒（例如 1790524800 是
   *  2026-09-27 16:00 UTC = 2026-09-28 00:00 中国时间）。因此必须固定 +8h 再取
   *  UTC 年月日，不能直接按 UTC 或按浏览器本地时区换算（否则日期会差一天）。 */
  function bucketParts(seconds) {
    const date = new Date(Number(seconds) * 1000 + CST_OFFSET_MS);
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    };
  }

  function fmtDateTime(timestamp) {
    if (!timestamp) {
      return '—';
    }
    const date = new Date(timestamp);
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) +
      ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
  }

  /** 官方时长字段单位是秒，这里统一转成中文可读文案 */
  function fmtDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    if (total < 60) {
      return total > 0 ? '不足 1 分钟' : '0 分钟';
    }
    const hours = Math.floor(total / 3600);
    const minutes = Math.round((total % 3600) / 60);
    if (hours <= 0) {
      return minutes + ' 分钟';
    }
    return minutes > 0 ? hours + ' 小时 ' + minutes + ' 分钟' : hours + ' 小时';
  }

  /** 分桶 key（秒）→ 展示标签 */
  function fmtBucketLabel(seconds, currentMode) {
    const part = bucketParts(seconds);
    if (currentMode === 'overall') {
      return part.year + ' 年';
    }
    if (currentMode === 'annually') {
      return part.month + ' 月';
    }
    return part.month + ' 月 ' + part.day + ' 日';
  }

  function fmtCompare(value) {
    if (typeof value !== 'number' || !isFinite(value)) {
      return null;
    }
    const percent = value * 100;
    const sign = percent > 0 ? '+' : '';
    return sign + percent.toFixed(1) + '%';
  }

  function escapeHtml(text) {
    return String(text === undefined || text === null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function modeLabel(currentMode) {
    const found = MODES.filter((item) => item.key === currentMode)[0];
    return found ? found.label : currentMode;
  }

  /** 与后台 service worker 通信 */
  function sendBg(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, code: 'channel', error: '扩展后台未响应，请重新加载扩展后再试' });
            return;
          }
          resolve(response || { ok: false, code: 'empty', error: '后台无响应内容' });
        });
      } catch (err) {
        resolve({ ok: false, code: 'channel', error: '扩展后台通信失败：' + (err && err.message ? err.message : '未知错误') });
      }
    });
  }

  // ---------- 数据 ----------

  async function readCache() {
    try {
      const result = await chrome.storage.local.get([CACHE_KEY]);
      return result[CACHE_KEY] || {};
    } catch (err) {
      return {};
    }
  }

  async function writeCache(currentMode, data) {
    try {
      const cache = await readCache();
      cache[currentMode] = { at: Date.now(), data: data };
      await chrome.storage.local.set({ [CACHE_KEY]: cache });
    } catch (err) {
      logOfficial('warn', '报告缓存写入失败（不影响展示）', { message: err && err.message });
    }
  }

  async function readOverviewCache() {
    try {
      const result = await chrome.storage.local.get([OVERVIEW_CACHE_KEY]);
      return result[OVERVIEW_CACHE_KEY] || null;
    } catch (err) {
      return null;
    }
  }

  async function writeOverviewCache(payload) {
    try {
      await chrome.storage.local.set({ [OVERVIEW_CACHE_KEY]: payload });
    } catch (err) {
      logOfficial('warn', '书架/笔记缓存写入失败（不影响展示）', { message: err && err.message });
    }
  }

  // 阅读人格语料缓存（Top 5 书的划线/想法全文；10 分钟，与报告缓存一致）
  async function readPersonaCache() {
    try {
      const result = await chrome.storage.local.get([PERSONA_CACHE_KEY]);
      return result[PERSONA_CACHE_KEY] || null;
    } catch (err) {
      return null;
    }
  }

  async function writePersonaCache(payload) {
    try {
      await chrome.storage.local.set({ [PERSONA_CACHE_KEY]: payload });
    } catch (err) {
      logOfficial('warn', '阅读人格语料缓存写入失败（不影响展示）', { message: err && err.message });
    }
  }

  async function refreshKeyStatus() {
    const result = await sendBg({ type: 'wre-official-status' });
    if (result.ok) {
      keyStatus = {
        hasKey: !!result.hasKey,
        apiKey: result.apiKey || '',
        savedAt: result.savedAt || 0,
        lastVerifiedAt: result.lastVerifiedAt || 0,
        skillVersion: result.skillVersion || '',
      };
    }
    return keyStatus;
  }

  async function loadReport(force) {
    reportState = 'loading';
    reportError = '';
    upgradeInfo = null;
    // 执行摘要 / 人格分析固定基于「累计（总体）」数据，与周期选择无关：
    // 已成功生成过就保留，切换周期不重复调用 DeepSeek（省 token）。
    if (aiState !== 'ok') {
      aiSummary = null;
      aiPersona = null;
      aiError = '';
      aiPersonaError = '';
      aiState = aiKeyStatus.hasKey ? 'idle' : 'skipped';
    }
    render();

    if (!keyStatus.hasKey) {
      reportState = 'error';
      reportError = '尚未配置 API Key';
      render();
      return;
    }

    // 报告（按周期）、概览（书架 + 笔记）、累计数据并行拉取，互不阻塞
    await Promise.all([loadDetail(force), loadOverview(force), loadOverallData(force)]);
    render();

    // 阅读人格语料与 AI 解读均改为「手动触发」：打开报告不自动请求官方接口、不消耗 DeepSeek token。
    // 阅读人格 → 点「启用分析」触发 ensurePersonaCorpus；AI 解读 → 点「生成 AI 解读」触发 runAIEnhance。
  }

  /** 拉取「累计（总体）」数据（命中缓存则跳过网络）；失败不影响报告主体 */
  async function loadOverallData(force) {
    if (!force) {
      const cache = await readCache();
      const hit = cache.overall;
      if (hit && hit.data && (Date.now() - (hit.at || 0)) < CACHE_TTL_MS) {
        overallReport = hit.data;
        logOfficial('info', '命中累计数据缓存');
        return;
      }
    }

    const result = await sendBg({
      type: 'wre-official-call',
      apiName: '/readdata/detail',
      params: { mode: 'overall', baseTime: 0 },
    });
    if (!result.ok) {
      logOfficial('warn', '累计数据拉取失败（不影响报告主体）', { code: result.code });
      return;
    }
    overallReport = result.data;
    await writeCache('overall', result.data);
    logOfficial('info', '累计数据拉取成功', { readDays: result.data && result.data.readDays });
  }

  /** 按周期拉取 /readdata/detail（命中缓存则跳过网络） */
  async function loadDetail(force) {
    if (!force) {
      const cache = await readCache();
      const hit = cache[mode];
      if (hit && hit.data && (Date.now() - (hit.at || 0)) < CACHE_TTL_MS) {
        report = hit.data;
        reportAt = hit.at;
        reportFromCache = true;
        reportState = 'ok';
        logOfficial('info', '命中报告缓存', { mode: mode });
        return;
      }
    }

    const result = await sendBg({
      type: 'wre-official-call',
      apiName: '/readdata/detail',
      params: { mode: mode, baseTime: 0 },
    });

    if (!result.ok) {
      reportState = 'error';
      reportError = result.error || '读取官方数据失败';
      logOfficial('warn', '报告拉取失败', { mode: mode, code: result.code });
      return;
    }

    report = result.data;
    reportAt = Date.now();
    reportFromCache = false;
    upgradeInfo = result.upgrade || null;
    reportState = 'ok';
    await writeCache(mode, report);
    logOfficial('info', '报告拉取成功', { mode: mode, readDays: report.readDays });
  }

  /** 拉取书架 + 笔记概览（与周期无关；失败只影响对应章节，不影响报告主体） */
  async function loadOverview(force) {
    if (!force) {
      const cache = await readOverviewCache();
      if (cache && cache.shelf && cache.notebooks && (Date.now() - (cache.at || 0)) < OVERVIEW_TTL_MS) {
        overview = cache;
        overviewState = 'ok';
        overviewError = '';
        logOfficial('info', '命中书架/笔记缓存');
        return;
      }
    }

    overviewState = 'loading';
    const shelfRes = await sendBg({ type: 'wre-official-call', apiName: '/shelf/sync', params: {} });
    const notesRes = await fetchNotebooks();
    const shelf = shelfRes.ok ? slimShelf(shelfRes.data) : null;
    const notebooks = notesRes.ok ? notesRes : null;

    if (!upgradeInfo && shelfRes.upgrade) {
      upgradeInfo = shelfRes.upgrade;
    }

    if (shelf && notebooks) {
      overviewState = 'ok';
      overviewError = '';
    } else if (shelf || notebooks) {
      overviewState = 'partial';
      overviewError = (!shelf ? '书架数据' : '笔记数据') + '本次未取到：' +
        ((!shelf ? shelfRes.error : notesRes.error) || '未知原因');
    } else {
      overviewState = 'error';
      overviewError = '书架与笔记数据均未取到：' + (shelfRes.error || notesRes.error || '未知原因');
    }

    overview = { at: Date.now(), shelf: shelf, notebooks: notebooks };
    // 只在两路都成功时写入缓存，避免把失败结果缓存住
    if (overviewState === 'ok') {
      await writeOverviewCache(overview);
    }
    logOfficial(overviewState === 'ok' ? 'info' : 'warn', '书架/笔记概览拉取完成', {
      state: overviewState,
      books: shelf ? shelf.books.length : 0,
      notebooks: notebooks ? notebooks.books.length : 0,
    });
  }

  /** 逐页拉取 /user/notebooks（游标分页：count + lastSort） */
  async function fetchNotebooks() {
    const collected = [];
    let lastSort = 0;
    let totalBookCount = 0;
    let totalNoteCount = null;
    let truncated = false;

    for (let page = 0; page < NOTEBOOKS_MAX_PAGES; page += 1) {
      const params = { count: NOTEBOOKS_PAGE_SIZE };
      if (lastSort) {
        params.lastSort = lastSort;
      }
      const res = await sendBg({ type: 'wre-official-call', apiName: '/user/notebooks', params: params });
      if (!res.ok) {
        if (page === 0) {
          return { ok: false, code: res.code, error: res.error };
        }
        // 已经拿到部分数据：降级为「部分成功」
        truncated = true;
        break;
      }
      const data = res.data || {};
      if (typeof data.totalBookCount === 'number') {
        totalBookCount = data.totalBookCount;
      }
      if (typeof data.totalNoteCount === 'number') {
        totalNoteCount = data.totalNoteCount;
      }
      const books = Array.isArray(data.books) ? data.books : [];
      books.forEach((item) => collected.push(slimNotebook(item)));
      if (!data.hasMore || !books.length) {
        break;
      }
      lastSort = books[books.length - 1].sort;
      if (page === NOTEBOOKS_MAX_PAGES - 1) {
        truncated = true;
      }
    }

    return {
      ok: true,
      totalBookCount: totalBookCount || collected.length,
      totalNoteCount: totalNoteCount,
      books: collected,
      truncated: truncated,
    };
  }

  /** 只保留报告需要的字段，减小缓存体积（保留 cover / deepLink 供书架概览页跳转） */
  function slimShelf(data) {
    if (!data || typeof data !== 'object') {
      return null;
    }
    const books = (Array.isArray(data.books) ? data.books : []).map((item) => ({
      bookId: item.bookId || '',
      title: item.title || '',
      author: item.author || '',
      category: item.category || '',
      cover: item.cover || '',
      deepLink: item.deepLink || '',
      readUpdateTime: item.readUpdateTime || 0,
      finishReading: Number(item.finishReading) === 1 ? 1 : 0,
      isTop: Number(item.isTop) === 1 ? 1 : 0,
      secret: Number(item.secret) === 1 ? 1 : 0,
    }));
    const albums = (Array.isArray(data.albums) ? data.albums : []).map((item) => {
      const info = item.albumInfo || {};
      const extra = item.albumInfoExtra || {};
      return {
        albumId: info.albumId || '',
        name: info.name || '',
        authorName: info.authorName || '',
        cover: info.cover || '',
        deepLink: item.deepLink || info.deepLink || '',
        finish: Number(info.finish) === 1 ? 1 : 0,
        secret: Number(extra.secret) === 1 ? 1 : 0,
        isTop: Number(extra.isTop) === 1 ? 1 : 0,
        readUpdateTime: extra.lectureReadUpdateTime || 0,
      };
    });
    return {
      books: books,
      albums: albums,
      hasMp: !!data.mp,
      bookCount: typeof data.bookCount === 'number' ? data.bookCount : books.length,
    };
  }

  function slimNotebook(item) {
    const book = item.book || {};
    return {
      bookId: item.bookId || '',
      title: book.title || '',
      author: book.author || '',
      reviewCount: Number(item.reviewCount) || 0,
      noteCount: Number(item.noteCount) || 0,
      bookmarkCount: Number(item.bookmarkCount) || 0,
      readingProgress: Number(item.readingProgress) || 0,
      markedStatus: Number(item.markedStatus) || 0,
      sort: Number(item.sort) || 0,
    };
  }

  // ---------- AI 增强（DeepSeek，可选）----------

  function splitParagraphs(text) {
    if (!text || typeof text !== 'string') {
      return [];
    }
    return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  }

  // 解析 DeepSeek 人格分析的结构化分点文本为 [{ title, body }]
  // 约定格式：每点首行「第N、小标题」，其后为论述正文；点与点之间空行分隔。
  function splitPersonaPoints(text) {
    if (!text || typeof text !== 'string') {
      return [];
    }
    const points = [];
    const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    blocks.forEach((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) {
        return;
      }
      let title = lines[0];
      // 保留「第N、小标题」完整编号（如「第一、第一性原理」），仅归一化编号与标题间的空白
      const m = title.match(/^(第\s*[一二三四五六七八九十百]+\s*[、，.:：])\s*(.+)$/);
      if (m) {
        title = m[1] + m[2].trim();
      }
      const body = lines.slice(1).join('\n');
      if (body) {
        points.push({ title: title, body: body });
      } else {
        // 首行后无正文，整块作为无标题段落兜底
        points.push({ title: '', body: block });
      }
    });
    return points;
  }

  // 年度趋势：对最近 N 年（含当年）逐次查 /readdata/detail annually
  async function fetchAnnualTrend() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const rows = [];
    for (let i = 0; i < AI_ANNUAL_YEARS; i += 1) {
      const year = currentYear - i;
      // baseTime 取该年 6 月 30 日 12:00（秒），避开年初/年末边界与时区歧义
      const baseTime = Math.floor(new Date(year, 5, 30, 12, 0, 0).getTime() / 1000);
      const res = await sendBg({ type: 'wre-official-call', apiName: '/readdata/detail', params: { mode: 'annually', baseTime: baseTime } });
      if (res && res.ok && res.data) {
        rows.push({ year: year, totalReadTime: Number(res.data.totalReadTime) || 0, readDays: Number(res.data.readDays) || 0 });
      }
    }
    return rows;
  }

  // 单本书的个人想法（/review/list/mine，游标分页，参数小写 bookid）
  async function fetchBookReviews(bookId) {
    const items = [];
    let synckey = 0;
    let more = true;
    for (let page = 0; page < 5 && more; page += 1) {
      const res = await sendBg({
        type: 'wre-official-call',
        apiName: '/review/list/mine',
        params: { bookid: bookId, synckey: synckey, count: 50 },
      });
      if (!res || !res.ok || !res.data) {
        break;
      }
      const reviews = Array.isArray(res.data.reviews) ? res.data.reviews : [];
      reviews.forEach((item) => {
        const r = item && item.review;
        if (r && typeof r.content === 'string' && r.content.trim()) {
          items.push(r.content.trim());
        }
      });
      synckey = res.data.synckey != null ? res.data.synckey : synckey;
      more = Number(res.data.hasMore) === 1;
    }
    return items;
  }

  // 对「笔记最多」的前 N 本书拉取划线/想法原文样本
  async function fetchBookContents(topBooks) {
    const contents = [];
    for (const book of topBooks) {
      const bookId = book && book.bookId;
      if (!bookId) {
        continue;
      }
      const title = (book && book.title) || '未命名';
      const author = (book && book.author) || '';
      const [markRes, reviews] = await Promise.all([
        sendBg({ type: 'wre-official-call', apiName: '/book/bookmarklist', params: { bookId: bookId } }),
        fetchBookReviews(bookId),
      ]);
      const marks = [];
      if (markRes && markRes.ok && markRes.data) {
        const updated = Array.isArray(markRes.data.updated) ? markRes.data.updated : [];
        updated.slice(0, AI_MARK_SAMPLE).forEach((m) => {
          const t = m && m.markText;
          if (typeof t === 'string' && t.trim()) {
            marks.push(t.trim());
          }
        });
      }
      contents.push({
        title: title,
        author: author,
        noteCount: (book && book.noteCount) || 0,
        reviewCount: (book && book.reviewCount) || 0,
        bookmarkCount: (book && book.bookmarkCount) || 0,
        markSamples: marks,
        reviewSamples: reviews.slice(0, AI_REVIEW_SAMPLE),
      });
    }
    return contents;
  }

  // 把客观数据 + 原文样本拼成给 AI 的 user 内容
  function buildAIPrompt(overallData, shelf, notes, annual, contents) {
    const lines = [];
    const counts = shelf ? shelfCounts(shelf) : null;
    const fin = shelf ? finishStats(shelf) : null;
    const stats = notes ? notebookStats(notes) : null;

    if (counts) {
      lines.push('【书架】共 ' + counts.total + ' 个条目（电子书 ' + counts.books + '、有声书/专辑 ' + counts.albums + (counts.hasMp ? '、文章收藏 1' : '') + '）。');
    }
    if (overallData) {
      lines.push('【累计阅读】' + fmtDuration(overallData.totalReadTime) + '，覆盖 ' + (overallData.readDays || 0) + ' 天。');
    }
    if (stats) {
      lines.push('【笔记】划线 ' + stats.noteTotal + ' 条、想法/点评 ' + stats.reviewTotal + ' 条、书签 ' + stats.bookmarkTotal + ' 条（合计 ' + stats.totalNoteCount + ' 条）。');
    }
    if (fin) {
      lines.push('【完读】电子书读完 ' + fin.finished + '/' + fin.ebooks + ' 本（完读率 ' + (fin.rate * 100).toFixed(0) + '%）。');
    }

    const cats = shelf ? shelfCategories(shelf) : null;
    if (cats && cats.list.length) {
      lines.push('【分类偏好】' + cats.list.slice(0, 5).map((c) => c.name + '(' + c.count + '本)').join('、') + '。');
    }

    if (contents.length) {
      lines.push('【笔记最多的书及原文样本】');
      contents.forEach((c) => {
        lines.push('《' + c.title + '》' + (c.author ? '（' + c.author + '）' : '') + '—— 划线 ' + c.noteCount + ' 条、想法 ' + c.reviewCount + ' 条');
        if (c.markSamples.length) {
          lines.push('  划线样本：' + c.markSamples.join(' | '));
        }
        if (c.reviewSamples.length) {
          lines.push('  想法样本：' + c.reviewSamples.join(' | '));
        }
      });
    }

    if (annual.length) {
      lines.push('【年度趋势】' + annual.map((r) => r.year + '年 ' + fmtDuration(r.totalReadTime)).join('，') + '。');
    }

    return lines.join('\n');
  }

  // 串联：年度趋势 + 原文 → prompt → DeepSeek → aiSummary
  async function runAIEnhance() {
    aiState = 'loading';
    aiError = '';
    aiSummary = null;
    aiPersona = null;
    aiPersonaError = '';
    aiReadingPersona = null;
    aiReadingPersonaError = '';
    render();
    try {
      const shelf = overview && overview.shelf ? overview.shelf : null;
      const notes = overview && overview.notebooks ? overview.notebooks : null;
      const topBooks = [];
      if (notes) {
        const stats = notebookStats(notes);
        if (stats && Array.isArray(stats.topBooks)) {
          topBooks.push.apply(topBooks, stats.topBooks.slice(0, AI_TOP_BOOKS));
        }
      }
      const [annual, contents, overallRes] = await Promise.all([
        fetchAnnualTrend(),
        topBooks.length ? fetchBookContents(topBooks) : Promise.resolve([]),
        // 复用报告页已拉取的累计数据，避免重复请求（未取到时再补一次）
        overallReport ? Promise.resolve({ ok: true, data: overallReport }) :
          sendBg({ type: 'wre-official-call', apiName: '/readdata/detail', params: { mode: 'overall', baseTime: 0 } }),
      ]);
      const overallData = (overallRes && overallRes.ok && overallRes.data) ? overallRes.data : null;
      const prompt = buildAIPrompt(overallData, shelf, notes, annual, contents);

      // 先执行摘要（失败退回规则化摘要）
      const summaryRes = await sendBg({
        type: 'wre-ai-chat',
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      });
      if (!summaryRes || !summaryRes.ok) {
        aiState = 'error';
        aiError = (summaryRes && summaryRes.error) ? summaryRes.error : 'AI 生成失败';
      } else {
        aiSummary = splitParagraphs(summaryRes.text);
        aiState = aiSummary.length ? 'ok' : 'error';
        if (!aiSummary.length) {
          aiError = 'AI 返回内容为空';
        }
      }

      // 再生成人格分析（串行，避免与摘要并发触发限流；失败只影响人格分析，不影响报告主体）
      try {
        const personaRes = await sendBg({
          type: 'wre-ai-chat',
          messages: [
            { role: 'system', content: AI_PERSONA_PROMPT },
            { role: 'user', content: prompt },
          ],
        });
        if (personaRes && personaRes.ok) {
          const persona = splitPersonaPoints(personaRes.text);
          aiPersona = persona.length ? persona : null;
          if (!persona.length) {
            aiPersonaError = 'AI 返回内容为空';
          }
        } else {
          aiPersona = null;
          aiPersonaError = (personaRes && personaRes.error) ? personaRes.error : 'AI 生成失败';
        }
      } catch (err) {
        aiPersona = null;
        aiPersonaError = '生成异常';
      }
      if (aiPersonaError) {
        logOfficial('warn', '人格分析未生成', { error: aiPersonaError });
      }

      // 最后生成「阅读人格」润色（复用本机已算好的判定；串行，失败只影响这一小节）
      try {
        const rp = getReadingPersona();
        if (rp.ok) {
          const dimLines = rp.dims.map((dim) => dim.available
            ? ('- ' + dim.title + '：' + dim.left.label + ' ' + dim.leftPct + '% ↔ ' + (100 - dim.leftPct) + '% ' + dim.right.label + '（依据：' + (dim.basis || '') + '）')
            : ('- ' + dim.title + '：数据不足'));
          const personaPrompt = '阅读人格代码：' + rp.code + '\n主称号：' + rp.name + '\n一句定调：' + rp.tagline +
            (rp.nicknames.length ? '\n三个特质绰号：' + rp.nicknames.join('、') : '') +
            '\n四维判定：\n' + dimLines.join('\n') +
            (rp.evidence.data.length ? '\n数据证据：' + rp.evidence.data.join('、') : '') +
            (rp.evidence.quotes.length ? '\n原文证据：\n' + rp.evidence.quotes.map((q) => '「' + q.text + '」——《' + (q.title || '未命名') + '》').join('\n') : '');
          const readingRes = await sendBg({
            type: 'wre-ai-chat',
            messages: [
              { role: 'system', content: AI_READING_PERSONA_PROMPT },
              { role: 'user', content: personaPrompt },
            ],
          });
          if (readingRes && readingRes.ok && readingRes.text) {
            aiReadingPersona = splitParagraphs(readingRes.text).join('\n\n');
          } else {
            aiReadingPersona = null;
            aiReadingPersonaError = (readingRes && readingRes.error) ? readingRes.error : 'AI 生成失败';
          }
        }
      } catch (err) {
        aiReadingPersona = null;
        aiReadingPersonaError = '生成异常';
      }
      if (aiReadingPersonaError) {
        logOfficial('warn', '阅读人格润色未生成', { error: aiReadingPersonaError });
      }
    } catch (err) {
      aiState = 'error';
      aiError = 'AI 生成异常';
      logOfficial('error', 'AI 增强失败', { message: err && err.message });
    }
    // 生成结束后面板刷新一次，把「生成中」状态更新为最终结果（ok / error）
    render();
  }

  // ---------- 渲染片段 ----------

  function exportButton(format, label) {
    return '<button class="wre-btn wre-btn-small" data-wre-off-export="' + format + '"' +
      (reportState === 'ok' ? '' : ' disabled') + '>' + label + '</button>';
  }

  function buildCards(data) {
    const compare = fmtCompare(data.compare);
    const dayAverage = data.dayAverageReadTime == null ? null : fmtDuration(data.dayAverageReadTime);
    const cards = [
      { label: '总时长', value: fmtDuration(data.totalReadTime) },
      { label: '阅读天数', value: (data.readDays || 0) + ' 天' },
      {
        label: '自然日均',
        value: dayAverage === null ? '—' : dayAverage,
        hint: dayAverage === null ? '官方未提供该周期' : '分母是自然日，非阅读天数',
      },
      {
        label: '较上期',
        value: compare === null ? '—' : compare,
        hint: compare === null ? '官方仅当前周期提供环比' : '官方口径 compare',
      },
    ];
    return cards.map((card) =>
      '<div class="wre-off-card">' +
        '<div class="wre-off-card-label">' + escapeHtml(card.label) + '</div>' +
        '<div class="wre-off-card-value">' + escapeHtml(card.value) + '</div>' +
        (card.hint ? '<div class="wre-off-card-hint">' + escapeHtml(card.hint) + '</div>' : '') +
      '</div>'
    ).join('');
  }

  function buildStatChips(data) {
    if (!Array.isArray(data.readStat) || !data.readStat.length) {
      return '';
    }
    const chips = data.readStat.map((item) =>
      '<span class="wre-off-chip">' + escapeHtml(item.stat) + ' <b>' + escapeHtml(item.counts) + '</b></span>'
    ).join('');
    return '<div class="wre-off-chips">' + chips + '</div>';
  }

  function buildBucketTable(data, currentMode) {
    const buckets = Object.keys(data.readTimes || {}).map((key) => ({
      ts: Number(key),
      seconds: Number((data.readTimes || {})[key]) || 0,
    })).sort((a, b) => a.ts - b.ts);

    if (!buckets.length) {
      return '<div class="wre-off-empty">官方未返回分桶明细</div>';
    }

    const visible = buckets.filter((item) => item.seconds > 0);
    const hiddenCount = buckets.length - visible.length;
    const max = visible.reduce((acc, item) => Math.max(acc, item.seconds), 0) || 1;
    const total = visible.reduce((acc, item) => acc + item.seconds, 0) || 1;

    const rows = visible.map((item) => {
      const width = Math.max(2, Math.round((item.seconds / max) * 100));
      const share = ((item.seconds / total) * 100).toFixed(1);
      return '<tr>' +
        '<td class="wre-off-td-label">' + escapeHtml(fmtBucketLabel(item.ts, currentMode)) + '</td>' +
        '<td class="wre-off-td-bar"><span class="wre-off-bar" style="width:' + width + '%"></span></td>' +
        '<td class="wre-off-td-num">' + escapeHtml(fmtDuration(item.seconds)) + '</td>' +
        '<td class="wre-off-td-share">' + share + '%</td>' +
      '</tr>';
    }).join('');

    return '<table class="wre-off-table">' +
      '<thead><tr><th>周期</th><th>分布</th><th>时长</th><th>占比</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table>' +
      (hiddenCount > 0 ? '<div class="wre-off-note">已隐藏 ' + hiddenCount + ' 个 0 时长周期</div>' : '');
  }

  function buildTrendChart(data, currentMode) {
    const buckets = Object.keys(data.readTimes || {}).map((key) => ({
      ts: Number(key),
      seconds: Number((data.readTimes || {})[key]) || 0,
    })).sort((a, b) => a.ts - b.ts);
    const positive = buckets.filter((item) => item.seconds > 0);
    if (!positive.length) {
      return '';
    }
    return '<div class="wre-chart" data-kind="line" data-payload="' +
      escapeHtml(JSON.stringify({
        labels: positive.map((item) => fmtBucketLabel(item.ts, currentMode)),
        values: positive.map((item) => item.seconds),
      })) + '"></div>';
  }

  function buildLongestList(data) {
    const list = Array.isArray(data.readLongest) ? data.readLongest : [];
    if (!list.length) {
      return '<div class="wre-off-empty">该周期内没有达到展示门槛的书（官方过滤低于 5 分钟的内容）</div>';
    }
    const items = list.slice(0, 5).map((item, index) => {
      const book = item.book || {};
      const album = item.albumInfo || {};
      const title = book.title || album.name || '未命名';
      const tags = Array.isArray(item.tags) && item.tags.length
        ? '<span class="wre-off-tag">' + item.tags.map(escapeHtml).join(' · ') + '</span>'
        : '';
      return '<li class="wre-off-list-item">' +
        '<span class="wre-off-rank">' + (index + 1) + '</span>' +
        '<span class="wre-off-list-title">' + escapeHtml(title) + tags + '</span>' +
        '<span class="wre-off-list-value">' + escapeHtml(fmtDuration(item.readTime)) + '</span>' +
      '</li>';
    }).join('');
    return '<ul class="wre-off-list">' + items + '</ul>';
  }

  // ---- 阅读人格（面板）：首屏人格卡 + 词语分析 ----

  function buildPersonaDimHtml(dim) {
    if (!dim.available) {
      return '<div class="wre-off-dim is-na">' +
        '<div class="wre-off-dim-top"><span>' + escapeHtml(dim.left.label) + '</span>' +
          '<span class="wre-off-dim-pct">—</span>' +
          '<span>' + escapeHtml(dim.right.label) + '</span></div>' +
        '<div class="wre-off-dim-track is-na"><i style="width:0%"></i></div>' +
        '<div class="wre-off-dim-basis">' + escapeHtml(dim.basis || '数据还不够') + '</div>' +
      '</div>';
    }
    const leftPct = dim.leftPct;
    const leftPick = !dim.centered && dim.side === dim.left.letter;
    const rightPick = !dim.centered && dim.side === dim.right.letter;
    return '<div class="wre-off-dim' + (dim.centered ? ' is-center' : '') + '">' +
      '<div class="wre-off-dim-top">' +
        '<span class="' + (leftPick ? 'is-pick' : '') + '">' + escapeHtml(dim.left.label) + ' ' + leftPct + '%</span>' +
        '<span class="' + (rightPick ? 'is-pick' : '') + '">' + (100 - leftPct) + '% ' + escapeHtml(dim.right.label) + '</span>' +
      '</div>' +
      '<div class="wre-off-dim-track"><i style="width:' + leftPct + '%"></i></div>' +
      '<div class="wre-off-dim-basis">依据：' + escapeHtml(dim.basis || '') + (dim.centered ? '（居中）' : '') + '</div>' +
    '</div>';
  }

  function buildPersonaWordsHtml(words) {
    if (!words || !words.top || !words.top.length) {
      return '';
    }
    const max = words.top.reduce((acc, item) => Math.max(acc, item.count), 0) || 1;
    const topRows = words.top.map((item, index) =>
      '<li class="wre-off-word-row">' +
        '<span class="wre-off-word-rank">' + (index + 1) + '</span>' +
        '<span class="wre-off-word">' + escapeHtml(item.word) + '</span>' +
        '<span class="wre-off-word-bar"><i style="width:' + Math.max(4, Math.round((item.count / max) * 100)) + '%"></i></span>' +
        '<span class="wre-off-word-count">' + item.count + '</span>' +
      '</li>').join('');
    const emo = words.emotion || { posPct: 0, neuPct: 0, negPct: 0 };
    const themes = (words.themes || []).map((item) =>
      '<span class="wre-off-chip">' + escapeHtml(item.name) + ' <b>' + item.count + '</b></span>').join('');
    const cloudList = words.cloud || [];
    const cloudMax = cloudList.reduce((acc, item) => Math.max(acc, item.count), 0) || 1;
    const cloudMin = cloudList.reduce((acc, item) => Math.min(acc, item.count), cloudMax);
    const cloud = cloudList.map((item) => {
      const size = 12 + Math.round(((item.count - cloudMin) / ((cloudMax - cloudMin) || 1)) * 14);
      return '<span class="wre-off-cloud-word" style="font-size:' + size + 'px">' + escapeHtml(item.word) + '</span>';
    }).join('');
    const catchHtml = words.catchphrase
      ? '<div class="wre-off-words-catch">你的口头禅：<em>' + escapeHtml(words.catchphrase.text) + '</em>' +
        (words.catchphrase.title ? '<span class="wre-off-quote-src">—— 《' + escapeHtml(words.catchphrase.title) + '》</span>' : '') + '</div>'
      : '';
    return '<div class="wre-off-words">' +
      '<div class="wre-off-persona-subtitle">词语分析</div>' +
      '<div class="wre-off-words-label">高频词 TOP' + words.top.length + '</div>' +
      '<ul class="wre-off-word-list">' + topRows + '</ul>' +
      '<div class="wre-off-words-label">情绪比例</div>' +
      '<div class="wre-off-emotion-bar">' +
        '<i class="is-pos" style="width:' + emo.posPct + '%"></i>' +
        '<i class="is-neu" style="width:' + emo.neuPct + '%"></i>' +
        '<i class="is-neg" style="width:' + emo.negPct + '%"></i>' +
      '</div>' +
      '<div class="wre-off-emotion-legend">正向 ' + emo.posPct + '% · 中性 ' + emo.neuPct + '% · 负向 ' + emo.negPct + '%</div>' +
      (themes ? '<div class="wre-off-words-label">主题词</div><div class="wre-off-chips">' + themes + '</div>' : '') +
      (cloud ? '<div class="wre-off-words-label">词云</div><div class="wre-off-cloud">' + cloud + '</div>' : '') +
      catchHtml +
    '</div>';
  }

  function buildPersonaSectionHtml() {
    const persona = getReadingPersona();
    if (!persona.ok) {
      if (persona.reason === 'nokey') {
        return '';
      }
      const progress = persona.progress || {};
      return '<div class="wre-off-section-title">🧬 我的阅读人格</div>' +
        '<div class="wre-off-empty">还差一点数据：你目前约 ' + escapeHtml(String(progress.hours)) + ' 小时、' + escapeHtml(String(progress.notes)) +
        ' 条笔记。<br>累计达到 ' + progress.needHours + ' 小时且 ' + progress.needNotes + ' 条笔记，就能生成「读书人版」人格卡与词语分析。</div>';
    }
    // 未启用分析：不自动拉语料，只给手动入口（点击后才读取 Top 5 书的划线/想法）
    if (personaCorpusState === 'idle') {
      return '<div class="wre-off-section-title">🧬 我的阅读人格</div>' +
        '<div class="wre-off-persona-gate">' +
          '<div class="wre-off-persona-gate-text">数据已就绪。点击「启用分析」后，才会读取你读得最多几本书的划线 / 想法（最多 5 本，仅本机、可复算），生成「读书人版」阅读人格卡与词语分析。<br>不点则不联网、不消耗任何请求。</div>' +
          '<button class="wre-btn" data-wre-off-enable-persona="1">📊 启用分析</button>' +
        '</div>';
    }
    const family = (persona.dims[0].available ? persona.dims[0].side : 'D') + (persona.dims[1].available ? persona.dims[1].side : 'F');
    const nicks = persona.nicknames.map((name) =>
      '<span class="wre-off-persona-nick">' + escapeHtml(name) + '</span>').join('');
    const dims = persona.dims.map(buildPersonaDimHtml).join('');
    const dataChips = persona.evidence.data.map((item) =>
      '<span class="wre-off-chip">' + escapeHtml(item) + '</span>').join('');
    const quotes = persona.evidence.quotes.map((quote) =>
      '<blockquote class="wre-off-quote">' + escapeHtml(quote.text) +
      '<div class="wre-off-quote-src">—— 《' + escapeHtml(quote.title || '未命名') + '》' + (quote.at ? (' · ' + personaYear(quote.at)) : '') + '</div></blockquote>').join('');
    const corpusNote = persona.corpusState === 'loading'
      ? '<div class="wre-off-note">🧬 正在读取你的划线/想法语料，「表达方式」与「词语分析」稍后补全…</div>'
      : (persona.corpusState === 'error' && persona.corpusError ? '<div class="wre-off-note">⚠️ ' + escapeHtml(persona.corpusError) + '（不影响其余维度）</div>' : '');
    const aiBlock = persona.aiText ? '<div class="wre-off-persona-ai">' + escapeHtml(persona.aiText) + '</div>' : '';
    const figure = PERSONA_FIGURES[persona.code];
    const figureHtml = (figure && personaFigureSvg(persona.code))
      ? '<div class="wre-off-persona-figurewrap" title="代表人物 · ' + escapeHtml(figure.name) + '">' +
          '<div class="wre-off-persona-figure">' + personaFigureSvg(persona.code) + '</div>' +
          '<div class="wre-off-persona-figurename">' + escapeHtml(figure.name) + '</div>' +
        '</div>'
      : '';
    return '<div class="wre-off-section-title">🧬 我的阅读人格</div>' +
      '<div class="wre-off-persona" data-family="' + escapeHtml(family) + '">' +
        '<div class="wre-off-persona-head">' +
          '<div class="wre-off-persona-code">' + escapeHtml(persona.code) + '</div>' +
          '<div class="wre-off-persona-titlewrap">' +
            '<div class="wre-off-persona-name">' + escapeHtml(persona.name) + '</div>' +
            '<div class="wre-off-persona-tagline">' + escapeHtml(persona.tagline) + '</div>' +
          '</div>' +
          figureHtml +
        '</div>' +
        buildPersonaShareActionsHtml() +
        (nicks ? '<div class="wre-off-persona-nicks">' + nicks + '</div>' : '') +
        (persona.oneLiner ? '<div class="wre-off-persona-oneliner">' + escapeHtml(persona.oneLiner) + '</div>' : '') +
        aiBlock +
        '<div class="wre-off-persona-dims">' + dims + '</div>' +
        (dataChips ? '<div class="wre-off-persona-evidence"><div class="wre-off-persona-subtitle">数据证据</div><div class="wre-off-chips">' + dataChips + '</div></div>' : '') +
        (quotes ? '<div class="wre-off-persona-evidence"><div class="wre-off-persona-subtitle">原文证据</div>' + quotes + '</div>' : '') +
        corpusNote +
        buildPersonaWordsHtml(persona.words) +
        '<div class="wre-off-persona-boundary">基于你的阅读行为数据生成的趣味性参考画像，参考了 MBTI 的四维结构，不是心理测评，也不构成专业性格鉴定。</div>' +
      '</div>';
  }

  // ---- 手机版分享图（Canvas 2D 离屏绘制，零依赖；固定浅色底，不跟随主题）----

  function buildPersonaShareActionsHtml() {
    return '<div class="wre-off-persona-share">' +
      '<button class="wre-btn wre-btn-small" data-wre-off-persona-share="copy">📋 复制图片</button>' +
      '<button class="wre-btn wre-btn-small" data-wre-off-persona-share="download">⬇️ 下载图片</button>' +
      '<span class="wre-off-persona-share-hint" id="wre-off-persona-share-note">复制后到手机微信里粘贴即可发朋友圈</span>' +
    '</div>';
  }

  function setPersonaShareNote(text) {
    const el = document.getElementById('wre-off-persona-share-note');
    if (el) {
      el.textContent = text;
    }
  }

  function personaShareRoundRect(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, h / 2, w / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function personaShareWrap(ctx, text, maxWidth) {
    const chars = String(text || '').split('');
    const lines = [];
    let line = '';
    chars.forEach((ch) => {
      if (ch === '\n') {
        lines.push(line);
        line = '';
        return;
      }
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    });
    if (line) {
      lines.push(line);
    }
    return lines.length ? lines : [''];
  }

  // 把内置 SVG 转成可画到 Canvas 的 Image（本地 data URI，不联网抓图）
  function loadPersonaFigureImage(svgString) {
    return new Promise((resolve) => {
      if (!svgString) {
        resolve(null);
        return;
      }
      try {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
      } catch (e) {
        resolve(null);
      }
    });
  }

  // 生成竖版分享图（逻辑宽 1080、2× 超采样导出、高按内容自适应；纯本机、可复算、不含随机）
  async function buildPersonaShareCanvas(persona) {
    const S = 2;        // 超采样倍数：按 1080 逻辑宽排版、导出 2× 像素，手机端更清晰
    const W = 1080;     // 逻辑宽度（px）
    const PAD = 72;
    const FONT = '-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
    const INK = '#1f2328';
    const INK2 = '#5b6570';
    const ACCENT = '#07c160';
    const ACCENT_SOFT = '#e8f8ef';
    const LINE = '#e8ebe9';
    const MAXW = W - PAD * 2;

    const scratch = document.createElement('canvas');
    scratch.width = W * S;
    scratch.height = 3400 * S;
    const ctx = scratch.getContext('2d');
    ctx.scale(S, S);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, 3400);

    let y = 84;
    const lineDraw = (text, size, color, weight, maxWidth, x0) => {
      const startX = (x0 === undefined) ? PAD : x0;
      ctx.fillStyle = color;
      ctx.font = (weight || '400') + ' ' + size + 'px ' + FONT;
      const lh = Math.round(size * 1.42);
      const lines = maxWidth ? personaShareWrap(ctx, text, maxWidth) : [text];
      lines.forEach((ln) => {
        ctx.fillText(ln, startX, y + Math.round(size * 0.82));
        y += lh;
      });
    };

    // 头部：左侧人格代码 + 称号 + 定调，右侧人物插画（与报告卡片一致，人物靠右、不孤立在顶部）
    const figure = PERSONA_FIGURES[persona.code];
    const headTop = y;
    const D = figure ? 330 : 0;
    const figX = W - PAD - D;
    const leftMaxW = figure ? (figX - PAD - 36) : MAXW;
    lineDraw(persona.reader ? ('『' + persona.reader + '』的阅读人格 · 读书人版') : '我的阅读人格 · 读书人版', 30, INK2, '600', leftMaxW);
    y += 10;
    lineDraw(persona.code, 120, ACCENT, '800', leftMaxW);
    y += 6;
    lineDraw(persona.name, 54, INK, '700', leftMaxW);
    y += 8;
    lineDraw(persona.tagline, 30, INK2, '400', leftMaxW);
    const leftBottom = y;

    if (figure) {
      const icon = await loadPersonaFigureImage(personaFigureSvg(persona.code, 'canvas'));
      const figTop = headTop;
      ctx.beginPath();
      ctx.arc(figX + D / 2, figTop + D / 2, D * 0.46, 0, Math.PI * 2);
      ctx.fillStyle = ACCENT_SOFT;
      ctx.fill();
      if (icon) {
        ctx.drawImage(icon, figX, figTop, D, D);
      }
      ctx.fillStyle = INK;
      ctx.font = '700 40px ' + FONT;
      const nameW = ctx.measureText(figure.name).width;
      ctx.fillText(figure.name, figX + (D - nameW) / 2, figTop + D + 50);
      ctx.fillStyle = INK2;
      ctx.font = '400 24px ' + FONT;
      let figY = figTop + D + 88;
      personaShareWrap(ctx, figure.line, D).forEach((ln) => {
        const lw = ctx.measureText(ln).width;
        ctx.fillText(ln, figX + (D - lw) / 2, figY);
        figY += Math.round(24 * 1.42);
      });
      y = Math.max(leftBottom, figY + 6);
    } else {
      y = leftBottom;
    }
    y += 24;

    // 三个特质绰号
    if (persona.nicknames.length) {
      const size = 32;
      const pillH = size + 26;
      ctx.font = '600 ' + size + 'px ' + FONT;
      let x = PAD;
      let rowY = y;
      persona.nicknames.forEach((text) => {
        const w = ctx.measureText(text).width + 44;
        if (x + w > W - PAD) {
          x = PAD;
          rowY += pillH + 16;
        }
        personaShareRoundRect(ctx, x, rowY, w, pillH, pillH / 2);
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = ACCENT;
        ctx.fillText(text, x + 22, rowY + pillH / 2 + size * 0.36);
        x += w + 16;
      });
      y = rowY + pillH + 30;
    }

    // 四维进度条
    persona.dims.forEach((dim) => {
      ctx.fillStyle = INK;
      ctx.font = '600 30px ' + FONT;
      ctx.fillText(dim.title, PAD, y + 24);
      ctx.fillStyle = INK2;
      ctx.font = '400 30px ' + FONT;
      const valueText = dim.available
        ? (dim.left.label + ' ' + dim.leftPct + '%  ↔  ' + (100 - dim.leftPct) + '% ' + dim.right.label)
        : '数据不足';
      const vw = ctx.measureText(valueText).width;
      ctx.fillText(valueText, W - PAD - vw, y + 24);
      y += 44;
      // 轨道
      personaShareRoundRect(ctx, PAD, y, MAXW, 16, 8);
      ctx.fillStyle = LINE;
      ctx.fill();
      if (dim.available) {
        personaShareRoundRect(ctx, PAD, y, Math.max(8, Math.round(MAXW * (dim.leftPct / 100))), 16, 8);
        ctx.fillStyle = ACCENT;
        ctx.fill();
      }
      y += 16 + 12;
      if (dim.basis) {
        lineDraw((dim.available ? '依据：' : '') + dim.basis, 24, INK2, '400', MAXW);
      }
      y += 16;
    });

    // 分隔线
    y += 4;
    ctx.fillStyle = LINE;
    ctx.fillRect(PAD, y, MAXW, 1);
    y += 44;

    // 词语亮点
    if (persona.words) {
      lineDraw('词语亮点', 36, INK, '700');
      y += 10;
      const top3 = (persona.words.top || []).slice(0, 3);
      if (top3.length) {
        lineDraw('高频词：' + top3.map((item) => item.word + ' ×' + item.count).join('　'), 30, INK, '400', MAXW);
        y += 6;
      }
      if (persona.words.catchphrase) {
        lineDraw('你的口头禅', 28, INK2, '600');
        y += 4;
        // 左侧强调条 + 引用（引文左缩进，避免强调条压住文字）
        const quoteIndent = 22;
        const quoteStartY = y;
        lineDraw('“' + persona.words.catchphrase.text + '”', 32, INK, '400', MAXW - quoteIndent, PAD + quoteIndent);
        if (persona.words.catchphrase.title) {
          lineDraw('—— 《' + persona.words.catchphrase.title + '》', 26, INK2, '400', MAXW - quoteIndent, PAD + quoteIndent);
        }
        ctx.fillStyle = ACCENT;
        ctx.fillRect(PAD, quoteStartY + 4, 6, Math.max(24, y - quoteStartY - 12));
      }
      y += 24;
    }

    // 数据证据
    if (persona.evidence.data.length) {
      lineDraw('数据证据', 36, INK, '700');
      y += 12;
      const items = persona.evidence.data.slice(0, 4);
      const gap = 20;
      const boxW = Math.floor((MAXW - gap * (items.length - 1)) / items.length);
      const boxTop = y;
      let boxH = 0;
      const padV = 22;
      const padH = 20;
      const heights = [];
      items.forEach((text) => {
        ctx.font = '500 26px ' + FONT;
        const lines = personaShareWrap(ctx, text, boxW - padH * 2);
        heights.push(padV * 2 + lines.length * Math.round(26 * 1.42));
      });
      boxH = Math.max.apply(null, heights);
      items.forEach((text, index) => {
        const bx = PAD + index * (boxW + gap);
        personaShareRoundRect(ctx, bx, boxTop, boxW, boxH, 20);
        ctx.fillStyle = ACCENT_SOFT;
        ctx.fill();
        ctx.fillStyle = INK;
        ctx.font = '500 26px ' + FONT;
        const lines = personaShareWrap(ctx, text, boxW - padH * 2);
        let ty = boxTop + padV;
        lines.forEach((ln) => {
          ctx.fillText(ln, bx + padH, ty + Math.round(26 * 0.82));
          ty += Math.round(26 * 1.42);
        });
      });
      y = boxTop + boxH + 40;
    }

    // 品牌署名
    ctx.fillStyle = LINE;
    ctx.fillRect(PAD, y, MAXW, 1);
    y += 44;
    lineDraw('微信悦读 · wereadapp-32km31c.maozi.io', 28, ACCENT, '700');
    y += 6;
    lineDraw('基于我的微信读书数据生成', 24, INK2, '400');

    const finalH = y + PAD - 20;
    const out = document.createElement('canvas');
    out.width = W * S;
    out.height = finalH * S;
    const octx = out.getContext('2d');
    octx.drawImage(scratch, 0, 0, W * S, finalH * S, 0, 0, W * S, finalH * S);
    return out;
  }

  function personaShareToBlob(canvas) {
    return new Promise((resolve) => {
      if (canvas.toBlob) {
        canvas.toBlob((blob) => resolve(blob), 'image/png');
      } else {
        resolve(null);
      }
    });
  }

  async function downloadPersonaShareImage(persona) {
    const target = persona || getReadingPersona();
    if (!target.ok) {
      return;
    }
    const canvas = await buildPersonaShareCanvas(target);
    const blob = await personaShareToBlob(canvas);
    if (!blob) {
      setPersonaShareNote('图片生成失败，请重试');
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '阅读人格-' + target.code + '.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setPersonaShareNote('已下载图片：阅读人格-' + target.code + '.png');
    logOfficial('info', '已生成阅读人格分享图', { format: 'png', code: target.code });
  }

  // 复制到剪贴板；环境不支持「图片写剪贴板」时自动降级为下载
  async function copyPersonaShareImage() {
    const persona = getReadingPersona();
    if (!persona.ok) {
      return;
    }
    const canvas = await buildPersonaShareCanvas(persona);
    const blob = await personaShareToBlob(canvas);
    if (!blob) {
      setPersonaShareNote('图片生成失败，请重试');
      return;
    }
    try {
      if (navigator.clipboard && typeof window.ClipboardItem === 'function') {
        await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
        setPersonaShareNote('已复制图片，去手机微信粘贴即可发朋友圈');
        logOfficial('info', '已复制阅读人格分享图到剪贴板', { code: persona.code });
        return;
      }
    } catch (err) {
      logOfficial('warn', '图片写剪贴板失败，自动降级为下载', { message: err && err.message });
    }
    downloadPersonaShareImage(persona);
  }

  function buildReportHtml() {
    const privacy = '<div class="wre-off-privacy">🔒 ' +
      (aiKeyStatus.hasKey
        ? '数字在本机计算；启用 AI 后，划线/想法原文样本会发送给 DeepSeek 生成解读'
        : '本报告在本机生成，数据不上传') +
      '</div>';
    const toolbar =
      '<div class="wre-off-toolbar">' +
        '<div class="wre-off-modes">' +
          MODES.map((item) =>
            '<button class="wre-off-mode' + (item.key === mode ? ' is-active' : '') + '" data-wre-off-mode="' + item.key + '">' +
              item.label +
            '</button>'
          ).join('') +
        '</div>' +
        '<div class="wre-off-actions">' +
          '<button class="wre-btn wre-btn-small" data-wre-off-refresh="1">刷新</button>' +
          exportButton('markdown', '导出 Markdown') +
          exportButton('html', '导出 HTML') +
          exportButton('pdf', '导出 PDF') +
        '</div>' +
      '</div>';

    if (!keyStatus.hasKey) {
      return privacy + toolbar +
        '<div class="wre-off-empty">还没有配置 API Key。<br>去「🔑 API Key」粘贴你自己的 wrk- Key 后即可生成报告。' +
        '<div style="margin-top:12px"><button class="wre-btn" data-wre-off-goto-settings="1">去配置 API Key</button></div></div>';
    }

    if (reportState === 'loading') {
      return privacy + toolbar + '<div class="wre-off-empty">正在从官方网关读取数据…</div>';
    }

    if (reportState === 'error') {
      return privacy + toolbar +
        '<div class="wre-off-error">' + escapeHtml(reportError) +
        '<div style="margin-top:12px"><button class="wre-btn" data-wre-off-refresh="1">重试</button></div></div>';
    }

    const data = report || {};
    const upgradeBanner = upgradeInfo
      ? '<div class="wre-off-upgrade">⚠️ 官方提示需要升级 skill：' +
        escapeHtml(upgradeInfo.message || upgradeInfo.skill_version || '请更新到最新版') +
        '<a href="https://cdn.weread.qq.com/skills/weread-skills.zip" target="_blank" rel="noreferrer">下载官方 skill 包</a></div>'
      : '';
    const sourceNote = '<div class="wre-off-note">数据来源：官方 /readdata/detail（mode=' + escapeHtml(mode) +
      '，skill_version ' + escapeHtml(keyStatus.skillVersion || '1.0.4') + '）；' +
      (reportFromCache ? '来自 ' + escapeHtml(fmtDateTime(reportAt)) + ' 的缓存' : '刚刚拉取 ' + escapeHtml(fmtDateTime(reportAt))) +
      '。时长单位已由秒转为可读文案；「自然日均」分母是自然日，不是阅读天数。</div>';

    const exportParts = [];
    if (overview && (overview.shelf || overview.notebooks)) {
      exportParts.push('书架结构、知识脉络、笔记行为、完读率、已读完书目等章节');
    }
    if (aiState === 'ok') {
      exportParts.push('DeepSeek AI 生成的人格化执行摘要');
    }
    if (aiPersona && aiPersona.length) {
      exportParts.push('人性化人格分析');
    }
    const exportHint = exportParts.length
      ? '<div class="wre-off-note">导出的报告还包含：' + exportParts.join('、') + '。</div>'
      : '';

    const aiHint = aiState === 'loading'
      ? '<div class="wre-off-note">🤖 正在用 DeepSeek 生成人格化执行摘要、人性化人格分析与阅读人格润色…</div>'
      : (aiState === 'error'
        ? '<div class="wre-off-note">🤖 AI 解读生成失败（' + escapeHtml(aiError) + '），改用规则化摘要。</div>'
        : (aiState === 'ok'
          ? '<div class="wre-off-note">🤖 已用 DeepSeek 生成人格化执行摘要' + (aiPersona && aiPersona.length ? '与人性化人格分析' : '') + (aiReadingPersona && aiReadingPersona.length ? '与阅读人格润色' : '') + '（导出报告可见）。</div>'
            + (aiPersonaError ? '<div class="wre-off-note">⚠️ 人性化人格分析未生成：' + escapeHtml(aiPersonaError) + '（不影响报告主体，可在「🔑 API Key」确认 DeepSeek Key 有效后重试）。</div>' : '')
            + (aiReadingPersonaError ? '<div class="wre-off-note">⚠️ 阅读人格润色未生成：' + escapeHtml(aiReadingPersonaError) + '（不影响判定与词语分析，仍显示规则版文本）。</div>' : '')
          : (aiKeyStatus.hasKey
            ? '<div class="wre-off-note">🤖 已配置 DeepSeek：点击「生成 AI 解读」才会调用（生成人格化执行摘要、人性化人格分析与阅读人格润色），打开报告不消耗 token。' +
              '<div class="wre-off-ai-run"><button class="wre-btn wre-btn-small" data-wre-off-run-ai="1">🤖 生成 AI 解读</button></div></div>'
            : '')));

    return privacy + toolbar + upgradeBanner + aiHint +
      buildPersonaSectionHtml() +
      '<div class="wre-off-section-title">一、总览</div>' +
      '<div class="wre-off-cards">' + buildCards(data) + '</div>' +
      buildStatChips(data) +
      '<div class="wre-off-section-title">二、时长分布</div>' +
      buildBucketTable(data, mode) +
      buildTrendChart(data, mode) +
      '<div class="wre-off-section-title">三、读得最多</div>' +
      buildLongestList(data) +
      exportHint +
      sourceNote;
  }

  function buildSettingsHtml() {
    const wrkKeyValue = draftWrkKey || keyStatus.apiKey;
    const aiKeyValue = draftAiKey || aiKeyStatus.apiKey;
    const statusLines = [
      '状态：' + (keyStatus.hasKey ? '已配置' : '未配置'),
      keyStatus.hasKey ? '保存于 ' + fmtDateTime(keyStatus.savedAt) : '',
      keyStatus.hasKey && keyStatus.lastVerifiedAt ? '最近校验 ' + fmtDateTime(keyStatus.lastVerifiedAt) : '',
      keyStatus.skillVersion ? 'skill_version ' + keyStatus.skillVersion : '',
    ].filter(Boolean).join('　·　');

    return '<div class="wre-off-privacy">🔒 Key 只保存在本机浏览器（chrome.storage.local），不会上传给任何人</div>' +
      '<div class="wre-off-section-title">API Key</div>' +
      '<div class="wre-off-note">获取方式：微信读书 App → 「微信读书 Skill」页面 → 复制 wrk- 开头的 API Key。</div>' +
      '<div class="wre-off-set-row">' +
        '<input type="password" id="wre-off-key-input" class="wre-off-input" placeholder="wrk-xxxxxxxx" autocomplete="off" spellcheck="false" value="' + escapeHtml(wrkKeyValue) + '">' +
        '<button type="button" class="wre-btn wre-btn-small" data-wre-off-toggle-key="1">显示</button>' +
      '</div>' +
      '<div class="wre-off-set-row">' +
        '<button class="wre-btn" data-wre-off-save="1">保存并校验</button>' +
        '<button class="wre-btn" data-wre-off-clear="1">清除 Key</button>' +
        '<button class="wre-btn wre-btn-small" data-wre-off-refresh-status="1">刷新状态</button>' +
      '</div>' +
      '<div class="wre-off-set-status">' + escapeHtml(statusLines) + '</div>' +
      (settingsMessage ? '<div class="wre-off-set-message">' + escapeHtml(settingsMessage) + '</div>' : '') +
      '<div class="wre-off-note">安全提醒：Key 等同你的账号读取权限，请勿粘贴到聊天、截图或提交到代码仓库；怀疑泄露时可在 App 里重置。</div>' +
      '<div class="wre-off-section-title">AI 增强（DeepSeek，可选）</div>' +
      '<div class="wre-off-note">可选：接入 DeepSeek 后，可在报告页点「生成 AI 解读」按钮，把「执行摘要」等由 AI 生成人格化文案（数字仍由本机规则计算，不交给 AI 算）。不配置则用默认的规则化摘要。</div>' +
      '<div class="wre-off-set-row">' +
        '<input type="password" id="wre-off-ai-key-input" class="wre-off-input" placeholder="sk-xxxxxxxx（可选）" autocomplete="off" spellcheck="false" value="' + escapeHtml(aiKeyValue) + '">' +
        '<button type="button" class="wre-btn wre-btn-small" data-wre-off-toggle-aikey="1">显示</button>' +
      '</div>' +
      '<div class="wre-off-set-row">' +
        '<button class="wre-btn" data-wre-off-save-ai="1">保存并校验</button>' +
        '<button class="wre-btn" data-wre-off-clear-ai="1">清除 AI Key</button>' +
      '</div>' +
      (aiSettingsMessage ? '<div class="wre-off-set-message">' + escapeHtml(aiSettingsMessage) + '</div>' : '') +
      '<div class="wre-off-set-status">AI 状态：' + (aiKeyStatus.hasKey ? '已配置（保存于 ' + fmtDateTime(aiKeyStatus.savedAt) + '）' : '未配置') + '</div>' +
      '<div class="wre-off-note">隐私提醒：点「生成 AI 解读」时，会把「笔记最多几本书」的划线/想法原文样本发送给 DeepSeek（api.deepseek.com）用于生成文字，请知悉。</div>';
  }

  // ---------- 面板 ----------

  function menuEntryExists(menu) {
    return !!menu.querySelector('[data-wre-official-entry]');
  }

  function injectMenuEntry(root) {
    const menu = root.querySelector('#wre-main-menu');
    if (!menu) {
      return;
    }
    if (!menuEntryExists(menu)) {
      const item = document.createElement('div');
      item.className = 'wre-menu-item';
      item.setAttribute('data-action', 'official');
      item.setAttribute('data-wre-official-entry', '1');
      item.innerHTML = '<span class="wre-menu-icon">🪞</span>阅读洞察';
      item.addEventListener('click', () => {
        openPanel();
      });
      const anchor = menu.querySelector('[data-wre-notes-entry]') ||
        menu.querySelector('[data-wre-stats-entry]') ||
        menu.querySelector('[data-action="read-settings"]');
      if (anchor && anchor.nextSibling) {
        menu.insertBefore(item, anchor.nextSibling);
      } else if (anchor) {
        menu.appendChild(item);
      } else {
        menu.appendChild(item);
      }
      logOfficial('info', '已注入「阅读洞察」菜单入口');
    }

    if (!menu.querySelector('[data-wre-api-key-entry]')) {
      const keyItem = document.createElement('div');
      keyItem.className = 'wre-menu-item';
      keyItem.setAttribute('data-action', 'api-key');
      keyItem.setAttribute('data-wre-api-key-entry', '1');
      keyItem.innerHTML = '<span class="wre-menu-icon">🔑</span>API Key';
      keyItem.addEventListener('click', () => {
        openKeyPanel();
      });
      const keyAnchor = menu.querySelector('[data-action="restore-default"]');
      if (keyAnchor && keyAnchor.nextSibling) {
        menu.insertBefore(keyItem, keyAnchor.nextSibling);
      } else {
        menu.appendChild(keyItem);
      }
      logOfficial('info', '已注入「API Key」菜单入口');
    }
  }

  function buildPanel(root) {
    const existing = root.querySelector('#wre-official-modal');
    if (existing) {
      return existing;
    }
    const overlay = document.createElement('div');
    overlay.className = 'wre-modal-overlay wre-off-overlay';
    overlay.id = 'wre-official-modal';
    overlay.innerHTML =
      '<div class="wre-modal wre-off-modal">' +
        '<div class="wre-modal-header">' +
          '<span class="wre-modal-title">🪞 阅读洞察</span>' +
          '<button class="wre-modal-close" data-wre-off-close>&times;</button>' +
        '</div>' +
        '<div class="wre-modal-body wre-off-body" id="wre-off-body"></div>' +
      '</div>';

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closePanel();
      }
    });
    const closeBtn = overlay.querySelector('[data-wre-off-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => closePanel());
    }
    overlay.addEventListener('click', handlePanelClick);
    overlay.addEventListener('change', handlePanelChange);
    root.appendChild(overlay);
    return overlay;
  }

  function buildKeyPanel(root) {
    const existing = root.querySelector('#wre-api-key-modal');
    if (existing) {
      return existing;
    }
    const overlay = document.createElement('div');
    overlay.className = 'wre-modal-overlay wre-off-overlay';
    overlay.id = 'wre-api-key-modal';
    overlay.innerHTML =
      '<div class="wre-modal wre-off-modal">' +
        '<div class="wre-modal-header">' +
          '<span class="wre-modal-title">🔑 API Key</span>' +
          '<button class="wre-modal-close" data-wre-key-close>&times;</button>' +
        '</div>' +
        '<div class="wre-modal-body wre-off-body" id="wre-key-body"></div>' +
      '</div>';

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closeKeyPanel();
      }
    });
    const closeBtn = overlay.querySelector('[data-wre-key-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => closeKeyPanel());
    }
    overlay.addEventListener('click', handlePanelClick);
    overlay.addEventListener('change', handlePanelChange);
    root.appendChild(overlay);
    return overlay;
  }

  function handlePanelClick(event) {
    const target = event.target;
    if (!target || !target.closest) {
      return;
    }
    const viewBtn = target.closest('[data-wre-off-view]');
    if (viewBtn) {
      const next = viewBtn.getAttribute('data-wre-off-view');
      if (next && next !== view) {
        view = next;
        logOfficial('info', '切换阅读洞察页签', { view: view });
        if (view === 'shelf' && !(overview && overview.shelf)) {
          overviewState = 'loading';
          overviewError = '';
        }
        render();
        if (view === 'shelf') {
          ensureShelf();
        }
      }
      return;
    }
    const discoverTab = target.closest('[data-wre-off-discover-tab]');
    if (discoverTab) {
      const next = discoverTab.getAttribute('data-wre-off-discover-tab');
      if (next && next !== discover.tab) {
        discover.tab = next;
        render();
      }
      return;
    }
    if (target.closest('[data-wre-off-search]')) {
      const input = document.getElementById('wre-off-search-input');
      discover.keyword = input ? input.value.trim() : discover.keyword;
      discover.openBookId = '';
      discover.detailKind = '';
      runSearch(true);
      return;
    }
    if (target.closest('[data-wre-off-search-more]')) {
      runSearch(false);
      return;
    }
    if (target.closest('[data-wre-off-recommend]')) {
      runRecommend(true);
      return;
    }
    if (target.closest('[data-wre-off-recommend-more]')) {
      runRecommend(false);
      return;
    }
    const detailBtn = target.closest('[data-wre-off-detail]');
    if (detailBtn) {
      const bookId = detailBtn.getAttribute('data-wre-off-detail');
      const same = discover.openBookId === bookId && discover.detailKind === 'detail';
      discover.openBookId = same ? '' : bookId;
      discover.openBookTitle = detailBtn.getAttribute('data-wre-off-book-title') || '';
      discover.detailKind = same ? '' : 'detail';
      discover.infoState = 'idle';
      discover.infoData = null;
      discover.chapters = [];
      render();
      if (!same) {
        runDetail();
      }
      return;
    }
    const reviewBtn = target.closest('[data-wre-off-review]');
    if (reviewBtn) {
      const bookId = reviewBtn.getAttribute('data-wre-off-review');
      const same = discover.openBookId === bookId && discover.detailKind === 'review';
      discover.openBookId = same ? '' : bookId;
      discover.openBookTitle = reviewBtn.getAttribute('data-wre-off-book-title') || '';
      discover.detailKind = same ? '' : 'review';
      discover.reviewItems = [];
      discover.reviewMaxIdx = 0;
      discover.reviewHasMore = false;
      render();
      if (!same) {
        runReviews(true);
      }
      return;
    }
    const similarBtn = target.closest('[data-wre-off-similar]');
    if (similarBtn) {
      const bookId = similarBtn.getAttribute('data-wre-off-similar');
      const same = discover.openBookId === bookId && discover.detailKind === 'similar';
      discover.openBookId = same ? '' : bookId;
      discover.openBookTitle = similarBtn.getAttribute('data-wre-off-book-title') || '';
      discover.detailKind = same ? '' : 'similar';
      discover.similarItems = [];
      discover.similarMaxIdx = 0;
      discover.similarHasMore = false;
      discover.similarSessionId = '';
      render();
      if (!same) {
        runSimilar(true);
      }
      return;
    }
    if (target.closest('[data-wre-off-review-more]')) {
      runReviews(false);
      return;
    }
    if (target.closest('[data-wre-off-similar-more]')) {
      runSimilar(false);
      return;
    }
    if (target.closest('[data-wre-off-refresh-shelf]')) {
      overviewState = 'loading';
      overviewError = '';
      shelfFetching = true;
      render();
      loadOverview(true).then(() => {
        shelfFetching = false;
        render();
      });
      return;
    }
    if (target.closest('[data-wre-off-shelf-more]')) {
      shelfShown += SHELF_PAGE_STEP;
      render();
      return;
    }
    const linkEl = target.closest('[data-wre-off-deeplink]');
    if (linkEl) {
      openBookLink(linkEl.getAttribute('data-wre-off-title'), linkEl.getAttribute('data-wre-off-deeplink'));
      return;
    }
    const modeBtn = target.closest('[data-wre-off-mode]');
    if (modeBtn) {
      const next = modeBtn.getAttribute('data-wre-off-mode');
      if (next !== mode) {
        mode = next;
        loadReport(false);
      }
      return;
    }
    if (target.closest('[data-wre-off-refresh]')) {
      loadReport(true);
      return;
    }
    const exportBtn = target.closest('[data-wre-off-export]');
    if (exportBtn) {
      handleExport(exportBtn.getAttribute('data-wre-off-export'));
      return;
    }
    const shareBtn = target.closest('[data-wre-off-persona-share]');
    if (shareBtn) {
      const kind = shareBtn.getAttribute('data-wre-off-persona-share');
      if (kind === 'copy') {
        copyPersonaShareImage();
      } else {
        downloadPersonaShareImage();
      }
      return;
    }
    if (target.closest('[data-wre-off-enable-persona]')) {
      logOfficial('info', '用户点击「启用分析」，开始拉取阅读人格语料');
      ensurePersonaCorpus(false);
      return;
    }
    if (target.closest('[data-wre-off-run-ai]')) {
      if (aiState !== 'loading') {
        logOfficial('info', '用户点击「生成 AI 解读」，开始调用 DeepSeek');
        runAIEnhance();
      }
      return;
    }
    if (target.closest('[data-wre-off-goto-settings]')) {
      openKeyPanel();
      return;
    }
    if (target.closest('[data-wre-off-toggle-key]')) {
      const btn = target.closest('[data-wre-off-toggle-key]');
      const input = document.getElementById('wre-off-key-input');
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
        btn.textContent = input.type === 'password' ? '显示' : '隐藏';
        logOfficial('info', '切换 API Key 输入框为 ' + (input.type === 'password' ? '掩码' : '明文'));
      } else {
        logOfficial('warn', '切换失败：未找到 #wre-off-key-input');
      }
      return;
    }
    if (target.closest('[data-wre-off-toggle-aikey]')) {
      const btn = target.closest('[data-wre-off-toggle-aikey]');
      const input = document.getElementById('wre-off-ai-key-input');
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
        btn.textContent = input.type === 'password' ? '显示' : '隐藏';
        logOfficial('info', '切换 DeepSeek Key 输入框为 ' + (input.type === 'password' ? '掩码' : '明文'));
      } else {
        logOfficial('warn', '切换失败：未找到 #wre-off-ai-key-input');
      }
      return;
    }
    if (target.closest('[data-wre-off-save]')) {
      saveKey();
      return;
    }
    if (target.closest('[data-wre-off-clear]')) {
      clearKey();
      return;
    }
    if (target.closest('[data-wre-off-save-ai]')) {
      saveAiKey();
      return;
    }
    if (target.closest('[data-wre-off-clear-ai]')) {
      clearAiKey();
      return;
    }
    if (target.closest('[data-wre-off-refresh-status]')) {
      refreshKeyStatus().then(() => {
        settingsMessage = '状态已刷新：' + (keyStatus.hasKey ? '已配置' : '未配置');
        renderSettings();
      });
    }
  }

  function handlePanelChange(event) {
    const target = event.target;
    if (!target || !target.id) {
      return;
    }
    if (target.id === 'wre-off-search-scope') {
      discover.scope = Number(target.value) || 10;
      return;
    }
    if (target.id === 'wre-off-review-type') {
      discover.reviewType = Number(target.value) || 0;
      if (discover.openBookId && discover.detailKind === 'review') {
        runReviews(true);
      }
    }
  }

  function saveKey() {
    const input = document.getElementById('wre-off-key-input');
    const value = input ? input.value.trim() : '';
    if (!value) {
      settingsMessage = '请先粘贴 API Key';
      renderSettings();
      return;
    }
    draftWrkKey = value;
    settingsMessage = '正在校验 Key…';
    renderSettings();
    sendBg({ type: 'wre-official-save', apiKey: value }).then((result) => {
      if (!result.ok) {
        settingsMessage = '保存失败：' + (result.error || '未知原因');
        logOfficial('warn', 'Key 保存失败', { code: result.code });
        renderSettings();
        return;
      }
      settingsMessage = '保存成功，Key 已通过校验';
      renderSettings();
      refreshKeyStatus().then(() => loadReport(true));
    });
  }

  function clearKey() {
    if (!window.confirm('确定清除本机保存的 API Key？清除后将无法读取官方数据。')) {
      return;
    }
    sendBg({ type: 'wre-official-clear' }).then(() => {
      report = null;
      reportState = 'idle';
      draftWrkKey = '';
      settingsMessage = '已清除 Key';
      refreshKeyStatus().then(() => renderSettings());
    });
  }

  async function refreshAiKeyStatus() {
    const result = await sendBg({ type: 'wre-ai-status' });
    if (result && result.ok) {
      aiKeyStatus = { hasKey: result.hasKey, apiKey: result.apiKey || '', savedAt: result.savedAt || 0 };
    }
    return aiKeyStatus;
  }

  function saveAiKey() {
    const input = document.getElementById('wre-off-ai-key-input');
    const value = input ? input.value.trim() : '';
    if (!value) {
      aiSettingsMessage = '请先粘贴 DeepSeek Key';
      renderSettings();
      return;
    }
    draftAiKey = value;
    aiSettingsMessage = '正在校验 DeepSeek Key…';
    renderSettings();
    sendBg({ type: 'wre-ai-save', apiKey: value }).then((result) => {
      if (!result.ok) {
        aiSettingsMessage = '保存失败：' + (result.error || '未知原因');
        logOfficial('warn', 'AI Key 保存失败', { code: result.code });
        renderSettings();
        return;
      }
      aiSettingsMessage = '保存成功，Key 已通过校验';
      aiSummary = null;
      aiPersona = null;
      aiState = 'idle';
      refreshAiKeyStatus().then(() => renderSettings());
    });
  }

  function clearAiKey() {
    if (!window.confirm('确定清除本机保存的 DeepSeek Key？清除后报告将退回规则化摘要。')) {
      return;
    }
    sendBg({ type: 'wre-ai-clear' }).then(() => {
      aiSummary = null;
      aiPersona = null;
      aiState = 'idle';
      draftAiKey = '';
      aiSettingsMessage = '已清除 AI Key';
      refreshAiKeyStatus().then(() => renderSettings());
    });
  }

  function openPanel() {
    const root = document.getElementById('we-read-enhancer-root');
    if (!root) {
      return;
    }
    closeKeyPanel();
    const overlay = buildPanel(root);
    overlay.classList.add('wre-visible');
    refreshKeyStatus().then(() => refreshAiKeyStatus()).then(() => {
      render();
      if (!keyStatus.hasKey) {
        return;
      }
      if (view === 'shelf') {
        if (!(overview && overview.shelf)) {
          overviewState = 'loading';
          overviewError = '';
          render();
        }
        ensureShelf();
        return;
      }
      if (view === 'discover') {
        return;
      }
      if (reportState === 'idle' || reportState === 'error') {
        loadReport(false);
      }
    });
    logOfficial('info', '打开阅读洞察面板');
  }

  function closePanel() {
    const overlay = document.getElementById('wre-official-modal');
    if (overlay) {
      overlay.classList.remove('wre-visible');
    }
  }

  function buildTabsHtml() {
    const tabs = [
      { key: 'report', label: '📊 阅读行为报告' },
      { key: 'shelf', label: '📚 书架' },
      { key: 'discover', label: '🔍 发现' },
    ];
    return '<div class="wre-off-tabs">' + tabs.map((item) =>
      '<button class="wre-off-tab' + (item.key === view ? ' is-active' : '') + '" data-wre-off-view="' + item.key + '">' +
        item.label + '</button>').join('') + '</div>';
  }

  function buildViewHtml() {
    if (view === 'shelf') {
      return buildShelfHtml();
    }
    if (view === 'discover') {
      return buildDiscoverHtml();
    }
    return buildReportHtml();
  }

  function render() {
    const overlay = document.getElementById('wre-official-modal');
    if (!overlay) {
      return;
    }
    const body = overlay.querySelector('#wre-off-body');
    if (!body) {
      return;
    }
    body.innerHTML = buildTabsHtml() + buildViewHtml();
    if (view === 'report') {
      drawCharts(body);
    }
  }

  function renderSettings() {
    const overlay = document.getElementById('wre-api-key-modal');
    if (!overlay) {
      return;
    }
    const body = overlay.querySelector('#wre-key-body');
    if (!body) {
      return;
    }
    body.innerHTML = buildSettingsHtml();
  }

  function openKeyPanel() {
    const root = document.getElementById('we-read-enhancer-root');
    if (!root) {
      return;
    }
    closePanel();
    const overlay = buildKeyPanel(root);
    overlay.classList.add('wre-visible');
    renderSettings();
    refreshKeyStatus().then(() => refreshAiKeyStatus()).then(() => {
      renderSettings();
    });
    logOfficial('info', '打开 API Key 设置面板');
  }

  function closeKeyPanel() {
    const overlay = document.getElementById('wre-api-key-modal');
    if (overlay) {
      overlay.classList.remove('wre-visible');
    }
  }

  // ---------- 附带能力（阶段十三-5）：书架概览页 + 搜书 / 书评 / 推荐 ----------

  function pickString(obj, keys) {
    if (!obj || typeof obj !== 'object') {
      return '';
    }
    for (let i = 0; i < keys.length; i += 1) {
      const value = obj[keys[i]];
      if (typeof value === 'string' && value) {
        return value;
      }
      if (typeof value === 'number' && value) {
        return String(value);
      }
    }
    return '';
  }

  function pickNumber(obj, keys) {
    if (!obj || typeof obj !== 'object') {
      return null;
    }
    for (let i = 0; i < keys.length; i += 1) {
      const value = obj[keys[i]];
      if (typeof value === 'number' && !isNaN(value)) {
        return value;
      }
    }
    return null;
  }

  /** 在常见嵌套里找官方 deepLink（禁止自行拼 weread:// 链接） */
  function pickDeepLink(entry) {
    if (!entry || typeof entry !== 'object') {
      return '';
    }
    const candidates = [entry, entry.bookInfo, entry.book, entry.review, entry.bookInfoExtra];
    for (let i = 0; i < candidates.length; i += 1) {
      const node = candidates[i];
      if (node && typeof node.deepLink === 'string' && node.deepLink) {
        return node.deepLink;
      }
    }
    return '';
  }

  /** 评分 → 1~5 星：书评评分为 20/40/60/80/100；书籍评分为 0~100 或 0~10 */
  function ratingToStars(value) {
    const n = Number(value);
    if (!n || isNaN(n) || n <= 0) {
      return 0;
    }
    if (n <= 5) {
      return Math.round(n);
    }
    if (n <= 10) {
      return Math.round(n / 2);
    }
    return Math.max(1, Math.min(5, Math.round(n / 20)));
  }

  function starsText(stars) {
    if (!stars) {
      return '';
    }
    return '★★★★★'.slice(0, stars) + '☆☆☆☆☆'.slice(0, 5 - stars);
  }

  function fmtCount(value) {
    const n = Number(value);
    if (!n || isNaN(n)) {
      return '';
    }
    if (n >= 10000) {
      return (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万';
    }
    return String(n);
  }

  function stripTags(text) {
    return String(text == null ? '' : text).replace(/<[^>]*>/g, '').trim();
  }

  /** 是否为可直接在电脑打开的 http(s) 链接 */
  function isHttpUrl(s) {
    return /^https?:\/\//i.test(String(s || '').trim());
  }

  /**
   * 网页版书籍哈希形态校验：形如 `71832e007260a75e718c6fb`（约 20+ 位字母数字）。
   * 官方 App 侧 deepLink 里的加密 id（很长的一串）不是网页版哈希，
   * 直接拼进 `/web/bookDetail/` 会 500，必须挡掉、改用书名到同源搜索解析。
   */
  function isWebBookId(id) {
    return /^[0-9a-zA-Z]{16,48}$/.test(String(id || '').trim());
  }

  /** 网页版书籍详情页 URL（电脑可打开）；参数为网页版哈希 id */
  function bookWebUrl(hashId) {
    const id = String(hashId || '').trim();
    return isWebBookId(id) ? ('https://weread.qq.com/web/bookDetail/' + encodeURIComponent(id)) : '';
  }

  /**
   * 官方 deepLink 多为手机落地页（`…/book-detail?type=1&v=<哈希>`，电脑上只引导去 App）
   * → 取出哈希换成本机网页版详情页。已是网页版详情页则原样返回；取不到哈希返回 ''。
   */
  function webUrlFromDeepLink(link) {
    const s = String(link || '').trim();
    if (!s) {
      return '';
    }
    const existing = s.match(/\/web\/bookDetail\/([^/?#]+)/i);
    if (existing && existing[1]) {
      return bookWebUrl(decodeURIComponent(existing[1]));
    }
    const v = s.match(/[?&]v=([^&]+)/i);
    return (v && v[1]) ? bookWebUrl(decodeURIComponent(v[1])) : '';
  }

  /**
   * 官方 deepLink 多是手机端地址（电脑打不开），用书名到网页版搜索接口
   * 换一个电脑可打开的详情页链接（`/web/bookDetail/{哈希}`）。
   * 同源请求（当前就在 weread.qq.com），沿用 notes.js 的 credentials: include 口径。
   */
  async function resolveWebBookUrl(title) {
    const kw = String(title || '').trim();
    if (!kw) {
      return '';
    }
    try {
      const res = await fetch('/web/search/global?keyword=' + encodeURIComponent(kw), {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        logOfficial('warn', '书名解析失败', { status: res.status });
        return '';
      }
      const data = await res.json();
      const books = Array.isArray(data && data.books) ? data.books : [];
      let fallback = '';
      for (let i = 0; i < books.length; i += 1) {
        const info = (books[i] && books[i].bookInfo) || {};
        const link = webUrlFromDeepLink(info.deepLink);
        if (!link) {
          continue;
        }
        if (!fallback) {
          fallback = link;
        }
        if (String(info.title || '').trim() === kw) {
          return link;
        }
      }
      return fallback;
    } catch (e) {
      logOfficial('warn', '书名解析异常', { error: String((e && e.message) || e) });
      return '';
    }
  }

  /** 打开书籍：优先把官方链接换成电脑可打开的网页版详情页；否则按书名解析 */
  async function openBookLink(title, rawLink) {
    const raw = String(rawLink || '').trim();
    let link = '';
    if (isHttpUrl(raw)) {
      // 官方 https 多为手机落地页（book-detail?type=1）：只接受「像网页版哈希」的 id
      link = webUrlFromDeepLink(raw);
    }
    if (!link) {
      link = await resolveWebBookUrl(title);    // 同源搜索解析出电脑可打开的网页版详情页
    }
    if (!link) {
      link = raw;                               // 兜底：仍尝试官方原链接
    }
    if (!link) {
      logOfficial('warn', '书籍跳转：无可打开的链接', { title: String(title || '') });
      return;
    }
    logOfficial('info', '书籍跳转', {
      via: isHttpUrl(link) ? 'https' : 'scheme',
      hasRaw: !!raw,
      isDetail: link.indexOf('/web/bookDetail/') >= 0,
    });
    window.open(link, '_blank', 'noopener');
  }

  /** 兼容多种回包结构的书籍列表解析：data.results[].books[] / data.books[] / data.list[] */
  function parseBookList(data) {
    const out = [];
    const seen = {};
    const pushEntry = (entry) => {
      if (!entry || typeof entry !== 'object') {
        return;
      }
      const info = entry.bookInfo || entry.book || entry;
      const bookId = pickString(info, ['bookId']) || pickString(entry, ['bookId']);
      const title = pickString(info, ['title', 'name']);
      if (!title) {
        return;
      }
      const dedupeKey = bookId || title;
      if (seen[dedupeKey]) {
        return;
      }
      seen[dedupeKey] = true;
      const entryIdx = pickNumber(entry, ['searchIdx']);
      const infoIdx = pickNumber(info, ['searchIdx']);
      out.push({
        bookId: bookId,
        title: title,
        author: pickString(info, ['author', 'authorName']) || pickString(entry, ['authorName', 'author']),
        category: pickString(info, ['category', 'categories', 'categoryName']),
        rating: pickNumber(info, ['newRating', 'rating', 'score']),
        readingCount: pickNumber(info, ['readingCount', 'readerCount', 'readCount']),
        deepLink: pickDeepLink(entry) || pickDeepLink(info),
        reason: pickString(entry, ['reason', 'recommendReason', 'recReason']) || pickString(info, ['reason']),
        searchIdx: entryIdx != null ? entryIdx : (infoIdx || 0),
        idx: pickNumber(entry, ['idx']) || 0,
      });
    };

    const groups = Array.isArray(data && data.results) ? data.results : [];
    groups.forEach((group) => {
      const arr = group && (group.books || group.list);
      if (Array.isArray(arr)) {
        arr.forEach(pushEntry);
      }
    });
    ['books', 'list', 'items', 'results'].forEach((key) => {
      const arr = data && data[key];
      if (Array.isArray(arr)) {
        arr.forEach(pushEntry);
      }
    });
    return out;
  }

  function parseReviews(data) {
    const raw = (data && (data.reviews || data.reviewList)) || [];
    return (Array.isArray(raw) ? raw : []).map((item) => {
      const review = item.review || item;
      const author = review.author || item.author || {};
      return {
        content: stripTags(review.content || review.htmlContent || item.content),
        rating: pickNumber(review, ['rating', 'star', 'score']),
        author: pickString(author, ['name', 'nickname']) || pickString(review, ['authorName']),
        createTime: pickNumber(review, ['createTime', 'time']) || 0,
        idx: pickNumber(item, ['idx']) || pickNumber(review, ['idx']) || 0,
      };
    }).filter((item) => item.content);
  }

  function parseChapters(data) {
    const raw = (data && (data.chapters || data.chapterList)) || [];
    return (Array.isArray(raw) ? raw : []).map((item) => ({
      title: pickString(item, ['title', 'chapterName', 'name']),
      level: pickNumber(item, ['level']) || 0,
    })).filter((chapter) => chapter.title);
  }

  function shelfCounts(shelf) {
    const books = (shelf && shelf.books) || [];
    const albums = (shelf && shelf.albums) || [];
    let secret = 0;
    let top = 0;
    books.forEach((book) => {
      if (book.secret) { secret += 1; }
      if (book.isTop) { top += 1; }
    });
    albums.forEach((album) => {
      if (album.secret) { secret += 1; }
      if (album.isTop) { top += 1; }
    });
    if (shelf && shelf.hasMp) {
      secret += 1;
    }
    return {
      total: books.length + albums.length + (shelf && shelf.hasMp ? 1 : 0),
      books: books.length,
      albums: albums.length,
      hasMp: !!(shelf && shelf.hasMp),
      secret: secret,
      top: top,
      finished: books.filter((book) => book.finishReading).length,
    };
  }

  function shelfCard(label, value) {
    return '<div class="wre-off-card">' +
      '<div class="wre-off-card-label">' + escapeHtml(label) + '</div>' +
      '<div class="wre-off-card-value">' + escapeHtml(String(value)) + '</div>' +
    '</div>';
  }

  function shelfItem(item, index, kind) {
    const isAlbum = kind === 'album';
    const tags = [];
    if (item.isTop) { tags.push('置顶'); }
    if (isAlbum ? item.finish : item.finishReading) { tags.push(isAlbum ? '已听完' : '读完'); }
    if (item.secret) { tags.push('私密'); }
    const meta = [
      isAlbum ? item.authorName : item.author,
      isAlbum ? '专辑 / 有声书' : item.category,
      item.readUpdateTime ? fmtDateTime(item.readUpdateTime) : '',
    ].filter(Boolean).join(' · ');
    const tagHtml = tags.length ? '<span class="wre-off-tag">' + tags.map(escapeHtml).join(' · ') + '</span>' : '';
    const canOpen = !!(item.deepLink || item.bookId);
    const title = item.title || item.name || '未命名';
    const titleInner = escapeHtml(title) + tagHtml +
      (meta ? '<span class="wre-off-sub">' + escapeHtml(meta) + '</span>' : '') +
      (canOpen ? '<span class="wre-off-open">打开 ↗</span>' : '');
    const titleHtml = canOpen
      ? '<span class="wre-off-list-title wre-off-clickable" data-wre-off-deeplink="' + escapeHtml(item.deepLink || '') + '" data-wre-off-title="' + escapeHtml(title) + '">' + titleInner + '</span>'
      : '<span class="wre-off-list-title">' + titleInner + '</span>';
    return '<li class="wre-off-list-item">' +
      '<span class="wre-off-rank">' + (index + 1) + '</span>' +
      titleHtml +
    '</li>';
  }

  function buildShelfHtml() {
    const privacy = '<div class="wre-off-privacy">🔒 书架数据来自官方 /shelf/sync，只在本机展示与跳转，不上传</div>';
    const toolbar = '<div class="wre-off-toolbar">' +
      '<div class="wre-off-note" style="margin:0">数量口径＝电子书 ＋ 专辑/有声书 ＋（有文章收藏入口时 +1）</div>' +
      '<div class="wre-off-actions"><button class="wre-btn wre-btn-small" data-wre-off-refresh-shelf="1">刷新</button></div>' +
    '</div>';

    if (!keyStatus.hasKey) {
      return privacy + toolbar +
        '<div class="wre-off-empty">还没有配置 API Key。<br>去「🔑 API Key」粘贴你自己的 wrk- Key 后即可查看书架。' +
        '<div style="margin-top:12px"><button class="wre-btn" data-wre-off-goto-settings="1">去配置 API Key</button></div></div>';
    }

    const shelf = overview && overview.shelf;
    if (!shelf && overviewState === 'loading') {
      return privacy + toolbar + '<div class="wre-off-empty">正在读取书架…</div>';
    }
    if (!shelf) {
      return privacy + toolbar + '<div class="wre-off-error">' + escapeHtml(overviewError || '书架数据未取到') +
        '<div style="margin-top:12px"><button class="wre-btn" data-wre-off-refresh-shelf="1">重试</button></div></div>';
    }

    const counts = shelfCounts(shelf);
    const cards = '<div class="wre-off-cards">' +
      shelfCard('书架条目总数', counts.total) +
      shelfCard('电子书', counts.books) +
      shelfCard('专辑 / 有声书', counts.albums) +
      shelfCard('已读完（电子书）', counts.finished) +
      shelfCard('置顶', counts.top) +
      shelfCard('私密', counts.secret) +
    '</div>';

    const books = shelf.books || [];
    const albums = shelf.albums || [];
    const shown = books.slice(0, shelfShown);
    const booksHtml = books.length
      ? '<div class="wre-off-section-title">电子书（' + books.length + '）</div>' +
        '<ul class="wre-off-list">' + shown.map((book, index) => shelfItem(book, index, 'book')).join('') + '</ul>' +
        (books.length > shelfShown
          ? '<div class="wre-off-more"><button class="wre-btn wre-btn-small" data-wre-off-shelf-more="1">显示更多（还有 ' + (books.length - shelfShown) + ' 本）</button></div>'
          : '')
      : '<div class="wre-off-note">书架里暂无电子书。</div>';

    const albumsHtml = albums.length
      ? '<div class="wre-off-section-title">专辑 / 有声书（' + albums.length + '）</div>' +
        '<ul class="wre-off-list">' + albums.map((album, index) => shelfItem(album, index, 'album')).join('') + '</ul>'
      : '';

    const mpNote = counts.hasMp
      ? '<div class="wre-off-note">书架另含「文章收藏」入口（不计入上方电子书 / 专辑数量）。</div>'
      : '';

    return privacy + toolbar + cards + mpNote + booksHtml + albumsHtml +
      '<div class="wre-off-note">条目「打开 ↗」在新标签打开网页版书籍详情页（电脑可直接打开）；私密条目同样只在本机展示。</div>';
  }

  function bookListItemHtml(book, index) {
    const stars = ratingToStars(book.rating);
    const meta = [
      book.author,
      book.category,
      stars ? starsText(stars) : '',
      book.readingCount ? fmtCount(book.readingCount) + ' 人在读' : '',
    ].filter(Boolean).join(' · ');
    const canOpen = !!(book.deepLink || book.bookId);
    const titleInner = escapeHtml(book.title) + (canOpen ? '<span class="wre-off-open">打开 ↗</span>' : '');
    const titleHtml = canOpen
      ? '<span class="wre-off-list-title wre-off-clickable" data-wre-off-deeplink="' + escapeHtml(book.deepLink || '') + '" data-wre-off-title="' + escapeHtml(book.title) + '">' + titleInner + '</span>'
      : '<span class="wre-off-list-title">' + titleInner + '</span>';
    const actions = book.bookId
      ? '<span class="wre-off-book-actions">' +
          '<button class="wre-btn wre-btn-mini" data-wre-off-detail="' + escapeHtml(book.bookId) + '" data-wre-off-book-title="' + escapeHtml(book.title) + '">详情 / 目录</button>' +
          '<button class="wre-btn wre-btn-mini" data-wre-off-review="' + escapeHtml(book.bookId) + '" data-wre-off-book-title="' + escapeHtml(book.title) + '">书评</button>' +
          '<button class="wre-btn wre-btn-mini" data-wre-off-similar="' + escapeHtml(book.bookId) + '" data-wre-off-book-title="' + escapeHtml(book.title) + '">相似书</button>' +
        '</span>'
      : '';
    const detail = (book.bookId && discover.openBookId === book.bookId) ? buildBookDetailHtml() : '';
    return '<li class="wre-off-list-item wre-off-list-item-wrap">' +
      '<span class="wre-off-rank">' + (index + 1) + '</span>' +
      '<div class="wre-off-book-main">' +
        titleHtml +
        (meta ? '<div class="wre-off-sub">' + escapeHtml(meta) + '</div>' : '') +
        (book.reason ? '<div class="wre-off-sub">' + escapeHtml(book.reason) + '</div>' : '') +
        actions +
      '</div>' +
      detail +
    '</li>';
  }

  function buildBookListHtml(items) {
    return '<ul class="wre-off-list">' +
      items.map((book, index) => bookListItemHtml(book, index)).join('') +
    '</ul>';
  }

  function buildDetailBlockHtml() {
    let inner;
    if (discover.infoState === 'loading') {
      inner = '<div class="wre-off-empty">正在读取书籍详情与目录…</div>';
    } else if (discover.infoState === 'error') {
      inner = '<div class="wre-off-error">' + escapeHtml(discover.infoError) + '</div>';
    } else {
      const raw = discover.infoData || {};
      const info = raw.bookInfo || raw;
      const stars = ratingToStars(info.newRating || info.rating);
      const rows = [
        ['作者', pickString(info, ['author'])],
        ['出版社', pickString(info, ['publisher'])],
        ['分类', pickString(info, ['category', 'categories'])],
        ['评分', stars ? starsText(stars) : ''],
      ].filter((row) => row[1]);
      const intro = pickString(info, ['intro', 'description', 'abstract']);
      const kv = rows.map((row) =>
        '<div class="wre-off-sub"><b>' + escapeHtml(row[0]) + '：</b>' + escapeHtml(row[1]) + '</div>').join('');
      const introHtml = intro
        ? '<div class="wre-off-review-body">' + escapeHtml(intro) + '</div>'
        : '';
      const chapters = discover.chapters || [];
      const chapterHtml = chapters.length
        ? '<div class="wre-off-section-title">目录（' + chapters.length + ' 章）</div>' +
          '<div class="wre-off-chapters">' + chapters.slice(0, 200).map((chapter) =>
            '<div class="wre-off-chapter' + (chapter.level > 1 ? ' wre-off-chapter-child' : '') + '">' +
              escapeHtml(chapter.title) + '</div>').join('') + '</div>' +
          (chapters.length > 200 ? '<div class="wre-off-note">目录较长，此处只列前 200 章。</div>' : '')
        : '<div class="wre-off-note">没有读取到目录。</div>';
      inner = '<div class="wre-off-book-main">' + kv + introHtml + '</div>' + chapterHtml;
    }
    return '<div class="wre-off-detail">' +
      '<div class="wre-off-search">' +
        '<span class="wre-off-detail-title">书籍详情 · ' + escapeHtml(discover.openBookTitle || '') + '</span>' +
      '</div>' + inner +
    '</div>';
  }

  function buildReviewBlockHtml() {
    const typeOptions = REVIEW_TYPES.map((type) =>
      '<option value="' + type.key + '"' + (Number(discover.reviewType) === type.key ? ' selected' : '') + '>' +
        type.label + '</option>').join('');
    let inner;
    if (discover.reviewState === 'loading') {
      inner = '<div class="wre-off-empty">正在读取书评…</div>';
    } else if (discover.reviewState === 'error') {
      inner = '<div class="wre-off-error">' + escapeHtml(discover.reviewError) + '</div>';
    } else if (!discover.reviewItems.length) {
      inner = '<div class="wre-off-empty">这本书暂无公开书评。</div>';
    } else {
      inner = '<ul class="wre-off-list">' + discover.reviewItems.map((review) => {
        const stars = ratingToStars(review.rating);
        const meta = [
          review.author,
          review.createTime ? fmtDateTime(review.createTime) : '',
          stars ? starsText(stars) : '',
        ].filter(Boolean).join(' · ');
        return '<li class="wre-off-list-item wre-off-list-item-wrap">' +
          '<div class="wre-off-book-main">' +
            (meta ? '<div class="wre-off-sub">' + escapeHtml(meta) + '</div>' : '') +
            '<div class="wre-off-review-body">' + escapeHtml(review.content) + '</div>' +
          '</div></li>';
      }).join('') + '</ul>';
    }
    return '<div class="wre-off-detail">' +
      '<div class="wre-off-search">' +
        '<span class="wre-off-detail-title">公开书评 · ' + escapeHtml(discover.openBookTitle || '') + '</span>' +
        '<select id="wre-off-review-type" class="wre-off-select">' + typeOptions + '</select>' +
      '</div>' + inner +
      (discover.reviewHasMore
        ? '<div class="wre-off-more"><button class="wre-btn wre-btn-small" data-wre-off-review-more="1">加载更多书评</button></div>'
        : '') +
    '</div>';
  }

  function buildSimilarBlockHtml() {
    let inner;
    if (discover.similarState === 'loading') {
      inner = '<div class="wre-off-empty">正在读取相似书…</div>';
    } else if (discover.similarState === 'error') {
      inner = '<div class="wre-off-error">' + escapeHtml(discover.similarError) + '</div>';
    } else if (!discover.similarItems.length) {
      inner = '<div class="wre-off-empty">没有找到相似书。</div>';
    } else {
      inner = buildBookListHtml(discover.similarItems);
    }
    return '<div class="wre-off-detail">' +
      '<div class="wre-off-search">' +
        '<span class="wre-off-detail-title">相似书 · ' + escapeHtml(discover.openBookTitle || '') + '</span>' +
      '</div>' + inner +
      (discover.similarHasMore
        ? '<div class="wre-off-more"><button class="wre-btn wre-btn-small" data-wre-off-similar-more="1">加载更多</button></div>'
        : '') +
    '</div>';
  }

  function buildBookDetailHtml() {
    if (discover.detailKind === 'detail') {
      return buildDetailBlockHtml();
    }
    if (discover.detailKind === 'review') {
      return buildReviewBlockHtml();
    }
    if (discover.detailKind === 'similar') {
      return buildSimilarBlockHtml();
    }
    return '';
  }

  function buildSearchHtml() {
    const scopeOptions = SEARCH_SCOPES.map((scope) =>
      '<option value="' + scope.key + '"' + (Number(discover.scope) === scope.key ? ' selected' : '') + '>' +
        scope.label + '</option>').join('');
    const bar = '<div class="wre-off-search">' +
      '<input id="wre-off-search-input" class="wre-off-input" type="text" placeholder="书名 / 作者 / 关键词" autocomplete="off" value="' + escapeHtml(discover.keyword) + '">' +
      '<select id="wre-off-search-scope" class="wre-off-select">' + scopeOptions + '</select>' +
      '<button class="wre-btn" data-wre-off-search="1">搜索</button>' +
    '</div>';

    if (discover.searchState === 'loading') {
      return bar + '<div class="wre-off-empty">正在搜索…</div>';
    }
    if (discover.searchState === 'error') {
      return bar + '<div class="wre-off-error">' + escapeHtml(discover.searchError) + '</div>';
    }
    if (discover.searchState === 'idle') {
      return bar + '<div class="wre-off-note">输入关键词后点「搜索」。结果为官方分页片段，需要更多可点「加载更多」继续。</div>';
    }
    if (!discover.searchItems.length) {
      return bar + '<div class="wre-off-empty">没有搜到结果，换个关键词或调整「范围」再试。</div>';
    }
    return bar +
      '<div class="wre-off-section-title">搜索结果</div>' +
      buildBookListHtml(discover.searchItems) +
      (discover.searchHasMore
        ? '<div class="wre-off-more"><button class="wre-btn wre-btn-small" data-wre-off-search-more="1">加载更多</button></div>'
        : '') +
      '<div class="wre-off-note">点书名在新标签打开网页版书籍详情页；点「书评 / 相似书」在下方展开，不离开本面板。</div>';
  }

  function buildRecommendHtml() {
    const bar = '<div class="wre-off-search">' +
      '<button class="wre-btn" data-wre-off-recommend="1">获取推荐</button>' +
      '<span class="wre-off-note" style="margin:0">基于你的阅读数据生成的个性化推荐</span>' +
    '</div>';
    if (discover.recommendState === 'loading') {
      return bar + '<div class="wre-off-empty">正在读取推荐…</div>';
    }
    if (discover.recommendState === 'error') {
      return bar + '<div class="wre-off-error">' + escapeHtml(discover.recommendError) + '</div>';
    }
    if (discover.recommendState === 'idle') {
      return bar + '<div class="wre-off-note">点「获取推荐」按官方口径拉取个性化推荐。</div>';
    }
    if (!discover.recommendItems.length) {
      return bar + '<div class="wre-off-empty">暂时没有推荐结果。</div>';
    }
    return bar +
      '<div class="wre-off-section-title">为你推荐</div>' +
      buildBookListHtml(discover.recommendItems) +
      (discover.recommendHasMore
        ? '<div class="wre-off-more"><button class="wre-btn wre-btn-small" data-wre-off-recommend-more="1">加载更多</button></div>'
        : '');
  }

  function buildDiscoverHtml() {
    const privacy = '<div class="wre-off-privacy">🔒 搜索 / 书评 / 推荐均来自官方网关，仅在本机展示；跳转在新标签打开网页版书籍详情页</div>';
    const tabs = '<div class="wre-off-modes" style="margin-top:12px">' +
      [['search', '🔍 搜书'], ['recommend', '✨ 推荐']].map((pair) =>
        '<button class="wre-off-mode' + (discover.tab === pair[0] ? ' is-active' : '') +
          '" data-wre-off-discover-tab="' + pair[0] + '">' + pair[1] + '</button>').join('') +
    '</div>';
    if (!keyStatus.hasKey) {
      return privacy + tabs +
        '<div class="wre-off-empty">还没有配置 API Key。<br>去「🔑 API Key」粘贴你自己的 wrk- Key 后即可搜书 / 看书评 / 取推荐。' +
        '<div style="margin-top:12px"><button class="wre-btn" data-wre-off-goto-settings="1">去配置 API Key</button></div></div>';
    }
    return privacy + tabs + (discover.tab === 'recommend' ? buildRecommendHtml() : buildSearchHtml());
  }

  function ensureShelf() {
    if (overview && overview.shelf) {
      return;
    }
    if (shelfFetching) {
      return;
    }
    shelfFetching = true;
    Promise.resolve(loadOverview(false)).then(() => {
      shelfFetching = false;
      render();
    });
  }

  async function runSearch(reset) {
    const keyword = String(discover.keyword || '').trim();
    if (!keyword) {
      discover.searchState = 'idle';
      discover.searchError = '';
      render();
      return;
    }
    if (reset) {
      discover.searchItems = [];
      discover.searchMaxIdx = 0;
      discover.searchHasMore = false;
    }
    discover.searchState = 'loading';
    discover.searchError = '';
    render();
    const params = { keyword: keyword, scope: Number(discover.scope) || 10, count: SEARCH_PAGE_SIZE };
    if (discover.searchMaxIdx) {
      params.maxIdx = discover.searchMaxIdx;
    }
    const res = await sendBg({ type: 'wre-official-call', apiName: '/store/search', params: params });
    if (!res.ok) {
      discover.searchState = 'error';
      discover.searchError = res.error || '搜索失败';
      logOfficial('warn', '搜书失败', { code: res.code });
      render();
      return;
    }
    const items = parseBookList(res.data);
    discover.searchItems = reset ? items : discover.searchItems.concat(items);
    const lastIdx = items.length ? items[items.length - 1].searchIdx : 0;
    discover.searchMaxIdx = lastIdx || discover.searchMaxIdx;
    discover.searchHasMore = items.length >= SEARCH_PAGE_SIZE && !!lastIdx;
    discover.searchState = 'ok';
    logOfficial('info', '搜书成功', { scope: discover.scope, count: items.length, hasMore: discover.searchHasMore });
    render();
  }

  async function runRecommend(reset) {
    if (reset) {
      discover.recommendItems = [];
      discover.recommendMaxIdx = 0;
      discover.recommendHasMore = false;
    }
    discover.recommendState = 'loading';
    discover.recommendError = '';
    render();
    const params = { count: RECOMMEND_PAGE_SIZE };
    if (discover.recommendMaxIdx) {
      params.maxIdx = discover.recommendMaxIdx;
    }
    const res = await sendBg({ type: 'wre-official-call', apiName: '/book/recommend', params: params });
    if (!res.ok) {
      discover.recommendState = 'error';
      discover.recommendError = res.error || '推荐读取失败';
      logOfficial('warn', '推荐读取失败', { code: res.code });
      render();
      return;
    }
    const items = parseBookList(res.data);
    discover.recommendItems = reset ? items : discover.recommendItems.concat(items);
    const lastItem = items.length ? items[items.length - 1] : null;
    const lastIdx = lastItem ? (lastItem.searchIdx || lastItem.idx) : 0;
    discover.recommendMaxIdx = lastIdx || discover.recommendMaxIdx;
    discover.recommendHasMore = items.length >= RECOMMEND_PAGE_SIZE && !!lastIdx;
    discover.recommendState = 'ok';
    logOfficial('info', '推荐读取成功', { count: items.length, hasMore: discover.recommendHasMore });
    render();
  }

  async function runDetail() {
    if (!discover.openBookId) {
      return;
    }
    discover.infoState = 'loading';
    discover.infoError = '';
    discover.infoData = null;
    discover.chapters = [];
    render();
    const [infoRes, chapterRes] = await Promise.all([
      sendBg({ type: 'wre-official-call', apiName: '/book/info', params: { bookId: discover.openBookId } }),
      sendBg({ type: 'wre-official-call', apiName: '/book/chapterinfo', params: { bookId: discover.openBookId } }),
    ]);
    if (!infoRes.ok && !chapterRes.ok) {
      discover.infoState = 'error';
      discover.infoError = infoRes.error || chapterRes.error || '书籍详情读取失败';
      logOfficial('warn', '书籍详情读取失败', { info: infoRes.code || '', chapter: chapterRes.code || '' });
      render();
      return;
    }
    discover.infoData = infoRes.ok ? (infoRes.data || {}) : null;
    discover.chapters = chapterRes.ok ? parseChapters(chapterRes.data) : [];
    discover.infoState = 'ok';
    logOfficial('info', '书籍详情读取成功', { chapters: discover.chapters.length });
    render();
  }

  async function runReviews(reset) {
    if (!discover.openBookId) {
      return;
    }
    if (reset) {
      discover.reviewItems = [];
      discover.reviewMaxIdx = 0;
      discover.reviewHasMore = false;
    }
    discover.reviewState = 'loading';
    discover.reviewError = '';
    render();
    const params = {
      bookId: discover.openBookId,
      reviewListType: Number(discover.reviewType) || 0,
      count: REVIEW_PAGE_SIZE,
    };
    if (discover.reviewMaxIdx) {
      params.maxIdx = discover.reviewMaxIdx;
    }
    const res = await sendBg({ type: 'wre-official-call', apiName: '/review/list', params: params });
    if (!res.ok) {
      discover.reviewState = 'error';
      discover.reviewError = res.error || '书评读取失败';
      logOfficial('warn', '书评读取失败', { code: res.code });
      render();
      return;
    }
    const items = parseReviews(res.data);
    discover.reviewItems = reset ? items : discover.reviewItems.concat(items);
    const lastIdx = items.length ? items[items.length - 1].idx : 0;
    discover.reviewMaxIdx = lastIdx || discover.reviewMaxIdx;
    discover.reviewHasMore = items.length >= REVIEW_PAGE_SIZE && !!lastIdx;
    discover.reviewState = 'ok';
    logOfficial('info', '书评读取成功', { count: items.length, hasMore: discover.reviewHasMore });
    render();
  }

  async function runSimilar(reset) {
    if (!discover.openBookId) {
      return;
    }
    if (reset) {
      discover.similarItems = [];
      discover.similarMaxIdx = 0;
      discover.similarHasMore = false;
      discover.similarSessionId = '';
    }
    discover.similarState = 'loading';
    discover.similarError = '';
    render();
    // 官方要求 /book/similar 必须显式传 count 与 maxIdx；翻页带 sessionId
    const params = { bookId: discover.openBookId, count: SEARCH_PAGE_SIZE, maxIdx: discover.similarMaxIdx || 0 };
    if (discover.similarSessionId) {
      params.sessionId = discover.similarSessionId;
    }
    const res = await sendBg({ type: 'wre-official-call', apiName: '/book/similar', params: params });
    if (!res.ok) {
      discover.similarState = 'error';
      discover.similarError = res.error || '相似书读取失败';
      logOfficial('warn', '相似书读取失败', { code: res.code });
      render();
      return;
    }
    if (res.data && typeof res.data.sessionId === 'string' && res.data.sessionId) {
      discover.similarSessionId = res.data.sessionId;
    }
    const items = parseBookList(res.data);
    discover.similarItems = reset ? items : discover.similarItems.concat(items);
    const lastItem = items.length ? items[items.length - 1] : null;
    const lastIdx = lastItem ? (lastItem.searchIdx || lastItem.idx) : 0;
    discover.similarMaxIdx = lastIdx || discover.similarMaxIdx;
    discover.similarHasMore = items.length >= SEARCH_PAGE_SIZE && !!lastIdx;
    discover.similarState = 'ok';
    logOfficial('info', '相似书读取成功', { count: items.length, hasMore: discover.similarHasMore });
    render();
  }

  // ---------- 导出 ----------

  // ---------- 报告模型（Markdown 与 HTML 共用同一份内容，避免两套渲染漂移） ----------
  //
  // 章节骨架参考「深度阅读画像」类报告：封面元信息 → 执行摘要 → 数据全景 →
  // 阅读轨迹与时间线 → 时段分布 → 偏好画像 → 读得最多 → 书的印象 → 成就勋章 → 附录。
  // 仅用官方 /readdata/detail 单接口可得的字段；需要书架/笔记数据的章节留待下一阶段。

  const HOUR_START = 6;   // 官方 preferTime 从 06:00 起算，索引 0 = 06:00
  const MEDAL_LIMIT = 24; // 勋章表最多列出条数

  const TIME_BANDS = [
    { start: 6, end: 9, label: '清晨 06:00–09:00' },
    { start: 9, end: 12, label: '上午 09:00–12:00' },
    { start: 12, end: 14, label: '午间 12:00–14:00' },
    { start: 14, end: 18, label: '下午 14:00–18:00' },
    { start: 18, end: 22, label: '晚间 18:00–22:00' },
    { start: 22, end: 24, label: '深夜 22:00–24:00' },
    { start: 0, end: 6, label: '凌晨 00:00–06:00' },
  ];

  function mdCell(value) {
    return String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  }

  function maxOf(numbers) {
    return numbers.reduce((acc, value) => Math.max(acc, Number(value) || 0), 0);
  }

  /** 分桶明细（升序，含 0 时长桶） */
  function reportBuckets(data) {
    const source = data.readTimes || {};
    return Object.keys(source).map((key) => ({
      ts: Number(key),
      seconds: Number(source[key]) || 0,
    })).sort((a, b) => a.ts - b.ts);
  }

  function bucketSectionLabel(currentMode) {
    if (currentMode === 'overall') {
      return '年度阅读时长';
    }
    if (currentMode === 'annually') {
      return '月度阅读时长';
    }
    return '每日阅读时长';
  }

  function metricCards(data) {
    const compare = fmtCompare(data.compare);
    return [
      { label: '总时长', value: fmtDuration(data.totalReadTime) },
      { label: '阅读天数', value: (data.readDays || 0) + ' 天' },
      { label: '自然日均', value: data.dayAverageReadTime == null ? '—' : fmtDuration(data.dayAverageReadTime) },
      { label: '较上期', value: compare === null ? '—' : compare },
    ];
  }

  function officialSummary(data) {
    if (!Array.isArray(data.readStat)) {
      return [];
    }
    return data.readStat.map((item) => ({ label: item.stat, value: item.counts }));
  }

  /** preferTime（索引 0 = 06:00）→ 按 24 小时还原 */
  function hourlyReadTime(data) {
    const list = Array.isArray(data.preferTime) ? data.preferTime : [];
    if (list.length !== 24) {
      return [];
    }
    return list.map((seconds, index) => ({
      hour: (HOUR_START + index) % 24,
      seconds: Number(seconds) || 0,
    }));
  }

  function timeBands(data) {
    const hourly = hourlyReadTime(data);
    if (!hourly.length) {
      return [];
    }
    const byHour = {};
    hourly.forEach((item) => { byHour[item.hour] = item.seconds; });
    return TIME_BANDS.map((band) => {
      let seconds = 0;
      for (let hour = band.start; hour < band.end; hour += 1) {
        seconds += byHour[hour] || 0;
      }
      return { label: band.label, seconds: seconds };
    });
  }

  /** 客观解读：只陈述数据本身，不做性格/价值观推断 */
  function buildInsights(data, currentMode, buckets) {
    const items = [];
    const positive = buckets.filter((item) => item.seconds > 0);
    const total = positive.reduce((acc, item) => acc + item.seconds, 0) || 1;

    let head = (currentMode === 'overall' ? '累计阅读总时长 ' : '本周期阅读总时长 ') +
      fmtDuration(data.totalReadTime) + '，覆盖 ' + (data.readDays || 0) + ' 天';
    if (data.dayAverageReadTime != null) {
      head += '，自然日均 ' + fmtDuration(data.dayAverageReadTime);
    }
    items.push(head + '。');

    const compare = fmtCompare(data.compare);
    if (compare !== null) {
      items.push('较上一周期' + (data.compare >= 0 ? '增长' : '下降') + ' ' +
        Math.abs(data.compare * 100).toFixed(1) + '%（官方 compare 口径，仅当前周期提供）。');
    } else {
      items.push(currentMode === 'overall' ? '累计口径官方未提供环比数据。' : '该周期官方未提供环比数据。');
    }

    if (positive.length) {
      const peak = positive.reduce((acc, item) => (item.seconds > acc.seconds ? item : acc));
      items.push('阅读最集中的周期是 ' + fmtBucketLabel(peak.ts, currentMode) + '，' + fmtDuration(peak.seconds) +
        '（占 ' + ((peak.seconds / total) * 100).toFixed(1) + '%）。');
      items.push('共 ' + buckets.length + ' 个统计单元，其中 ' + positive.length + ' 个有阅读记录。');
      items.push('单元均值 ' + fmtDuration(total / positive.length) + '。');
    }

    if (data.preferCategoryWord) {
      items.push('官方偏好判定：' + data.preferCategoryWord + '。');
    }
    if (data.preferTimeWord) {
      items.push('官方时段判定：' + data.preferTimeWord + '。');
    }
    if (Array.isArray(data.preferAuthor) && data.preferAuthor.length) {
      items.push('读得最多的作者是 ' + data.preferAuthor[0].name + '（' + data.preferAuthor[0].count + ' 本）。');
    }
    return items;
  }

  // ---- 书架 / 笔记（第二步接入：/shelf/sync、/user/notebooks）----

  /** 书架计数（严格按官方口径：总数含专辑与文章收藏入口） */
  function shelfCounts(shelf) {
    const books = Array.isArray(shelf.books) ? shelf.books : [];
    const albums = Array.isArray(shelf.albums) ? shelf.albums : [];
    const bookSecret = books.filter((item) => Number(item.secret) === 1).length;
    const albumSecret = albums.filter((item) => Number(item.secret) === 1).length;
    const secret = bookSecret + albumSecret + (shelf.hasMp ? 1 : 0);
    const publicCount = (books.length - bookSecret) + (albums.length - albumSecret);
    const top = books.filter((item) => Number(item.isTop) === 1).length +
      albums.filter((item) => Number(item.isTop) === 1).length;
    return {
      books: books.length,
      albums: albums.length,
      hasMp: !!shelf.hasMp,
      total: books.length + albums.length + (shelf.hasMp ? 1 : 0),
      secret: secret,
      publicCount: publicCount,
      top: top,
      finished: books.filter((item) => Number(item.finishReading) === 1).length,
    };
  }

  /** 书架电子书按「分类」聚合（降序，取前 CATEGORY_LIMIT 个） */
  function shelfCategories(shelf) {
    const books = Array.isArray(shelf.books) ? shelf.books : [];
    const map = {};
    books.forEach((item) => {
      const raw = item.category;
      const name = (typeof raw === 'string' ? raw : (raw && (raw.title || raw.name)) || '').trim() || '未分类';
      map[name] = (map[name] || 0) + 1;
    });
    const sorted = Object.keys(map).map((name) => ({ name: name, count: map[name] }))
      .sort((a, b) => b.count - a.count);
    return { list: sorted.slice(0, CATEGORY_LIMIT), more: Math.max(0, sorted.length - CATEGORY_LIMIT) };
  }

  /** 笔记概览统计（总条数优先用官方 totalNoteCount，分项用已拉取明细求和） */
  function notebookStats(notebooks) {
    if (!notebooks || !notebooks.ok) {
      return null;
    }
    const books = Array.isArray(notebooks.books) ? notebooks.books : [];
    const sum = (field) => books.reduce((acc, item) => acc + (Number(item[field]) || 0), 0);
    const reviewTotal = sum('reviewCount');
    const noteTotal = sum('noteCount');
    const bookmarkTotal = sum('bookmarkCount');
    const totalNoteCount = (typeof notebooks.totalNoteCount === 'number' && notebooks.totalNoteCount >= 0)
      ? notebooks.totalNoteCount
      : reviewTotal + noteTotal + bookmarkTotal;
    const sorted = books.slice().sort((a, b) =>
      (b.reviewCount + b.noteCount + b.bookmarkCount) - (a.reviewCount + a.noteCount + a.bookmarkCount));
    return {
      totalBookCount: notebooks.totalBookCount || books.length,
      totalNoteCount: totalNoteCount,
      reviewTotal: reviewTotal,
      noteTotal: noteTotal,
      bookmarkTotal: bookmarkTotal,
      topBooks: sorted.slice(0, 10),
      truncated: !!notebooks.truncated,
    };
  }

  function finishStats(shelf) {
    const counts = shelfCounts(shelf);
    return {
      ebooks: counts.books,
      finished: counts.finished,
      reading: Math.max(0, counts.books - counts.finished),
      rate: counts.books ? counts.finished / counts.books : 0,
    };
  }

  /** 已读完的电子书（按最近阅读时间降序，取前 SHELF_BOOK_LIMIT 本） */
  function finishedBooks(shelf) {
    const books = Array.isArray(shelf.books) ? shelf.books : [];
    const done = books.filter((item) => Number(item.finishReading) === 1)
      .sort((a, b) => (Number(b.readUpdateTime) || 0) - (Number(a.readUpdateTime) || 0));
    return { list: done.slice(0, SHELF_BOOK_LIMIT), total: done.length, more: Math.max(0, done.length - SHELF_BOOK_LIMIT) };
  }

  /**
   * 阅读人格画像（客观规则化类型归类）。
   * 只用客观统计指标按固定阈值归类，输出「维度 / 类型画像 / 判定依据」三元组；
   * 不做性格、价值观等主观推断（红线）。数据不足的维度自动跳过。
   */
  function buildPersona(data, currentMode, shelf, notebooks) {
    const tags = [];
    const counts = shelf ? shelfCounts(shelf) : null;
    const fin = shelf ? finishStats(shelf) : null;
    const notes = notebookStats(notebooks);
    const cats = shelf ? shelfCategories(shelf) : null;

    // A 完读倾向（电子书 finishReading）
    if (fin && fin.ebooks > 0) {
      const pct = (fin.rate * 100).toFixed(0) + '%';
      const basis = '电子书完读率 ' + pct + '（读完 ' + fin.finished + ' / ' + fin.ebooks + ' 本）';
      if (fin.rate >= 0.6) {
        tags.push(['完读倾向', '善始善终型', basis]);
      } else if (fin.rate >= 0.3) {
        tags.push(['完读倾向', '随性而为型', basis]);
      } else {
        tags.push(['完读倾向', '广泛涉猎型', basis]);
      }
    }

    // B 笔记投入（有笔记的书平均每本笔记条数）
    if (notes && notes.totalBookCount > 0) {
      const avg = notes.totalNoteCount / notes.totalBookCount;
      const basis = '有笔记的书平均每本约 ' + avg.toFixed(1) + ' 条笔记';
      if (avg >= 5) {
        tags.push(['笔记投入', '深度精读型', basis]);
      } else if (avg >= 1) {
        tags.push(['笔记投入', '适度批注型', basis]);
      } else {
        tags.push(['笔记投入', '少记浏览型', basis]);
      }
    }

    // C 主题聚焦（书架分类集中度）
    if (cats && cats.list.length && counts && counts.books > 0) {
      const top = cats.list[0];
      const share = top.count / counts.books;
      const basis = '「' + top.name + '」占电子书 ' + (share * 100).toFixed(0) + '%';
      if (share >= 0.5) {
        tags.push(['主题聚焦', '主题聚焦型', basis]);
      } else if (share < 0.3 && (cats.list.length + cats.more) >= 5) {
        tags.push(['主题聚焦', '兴趣广博型', basis + '，分类较分散']);
      } else {
        tags.push(['主题聚焦', '多元均衡型', basis]);
      }
    }

    // D 内容形态（电子书 vs 有声书/专辑）
    if (counts && counts.albums > 0 && counts.total > 0) {
      const basis = '书架含 ' + counts.albums + ' 个有声书/专辑';
      if (counts.albums / counts.total >= 0.3) {
        tags.push(['内容形态', '听读兼修型', basis]);
      } else {
        tags.push(['内容形态', '以读为主型', basis]);
      }
    }

    // E 阅读时段（官方仅在「累计」周期返回 preferTime）
    const hourly = hourlyReadTime(data);
    if (hourly.length) {
      const peak = hourly.reduce((acc, item) => (item.seconds > acc.seconds ? item : acc));
      const h = peak.hour;
      let label;
      if (h >= 21 || h < 6) {
        label = '夜读型';
      } else if (h >= 6 && h < 9) {
        label = '晨读型';
      } else if (h >= 11 && h < 14) {
        label = '午间型';
      } else {
        label = '日间型';
      }
      tags.push(['阅读时段', label, '全天峰值出现在 ' + pad2(h) + ':00 前后']);
    }

    return tags;
  }

  /**
   * 阅读规律与建议（规则模板，不引入额外 AI Key）。
   * 只用报告里已有指标生成「事实句 + 温和建议」，数据不足的条目自动跳过。
   * 红线：不编造数据、不下绝对化结论、不给健康/医疗类建议。
   */
  function buildAdvice(data, currentMode, shelf, notebooks) {
    const items = [];
    const scopePrefix = currentMode === 'overall' ? '累计' : modeLabel(currentMode);

    // 1. 时长与节奏
    if (Number(data.totalReadTime) > 0) {
      let fact = scopePrefix + '共阅读 ' + fmtDuration(data.totalReadTime) +
        '，覆盖 ' + (data.readDays || 0) + ' 天';
      if (data.dayAverageReadTime != null) {
        fact += '（自然日均 ' + fmtDuration(data.dayAverageReadTime) + '）';
      }
      const compare = fmtCompare(data.compare);
      if (compare !== null) {
        fact += '，较上一周期' + (data.compare >= 0 ? '增加' : '减少') + ' ' + Math.abs(data.compare * 100).toFixed(1) + '%';
      }
      const advice = (data.readDays || 0) > 0
        ? '保持当前节奏即可；若想再多读一点，优先固定一个每天都能空出来的小时间段，比临时找时间更稳。'
        : '先从一个每天 10 分钟的小目标开始，比一上来就追求长时间更容易坚持。';
      items.push(fact + '。建议：' + advice);
    }

    // 2. 阅读时段（官方仅在「累计」周期返回 preferTime）
    const hourly = hourlyReadTime(data);
    if (hourly.length) {
      const peak = hourly.reduce((acc, item) => (item.seconds > acc.seconds ? item : acc));
      if (peak.seconds > 0) {
        items.push('你的阅读集中在 ' + pad2(peak.hour) + ':00 前后（' + fmtDuration(peak.seconds) +
          '）。建议：把这个时段固定为「读书时间」，到点就打开，省去临时找时间的犹豫。');
      }
    }

    // 3. 偏好分类
    if (data.preferCategoryWord) {
      items.push('官方判定你的偏好为「' + data.preferCategoryWord +
        '」。建议：在喜欢的分类里挑一本篇幅短一点的书读完，容易形成正反馈。');
    }

    // 4. 完读率（需书架数据）
    if (shelf) {
      const fin = finishStats(shelf);
      if (fin.ebooks > 0) {
        items.push('电子书完读率 ' + (fin.rate * 100).toFixed(0) + '%（读完 ' + fin.finished + ' / ' + fin.ebooks +
          ' 本）。建议：从「在读」里选一本最想看完的，先把它读完，完读率会自然上升。');
      }
    }

    // 5. 笔记投入（需笔记数据）
    const notes = notebookStats(notebooks);
    if (notes && notes.totalBookCount > 0 && notes.totalNoteCount > 0) {
      const avg = notes.totalNoteCount / notes.totalBookCount;
      const advice = avg >= 1
        ? '保持「划线后随手写一句想法」的习惯，回看时比单纯的划线更有用。'
        : '读完一章后试着写一句自己的想法，比只划线更容易记住。';
      items.push('有笔记的书平均每本约 ' + avg.toFixed(1) + ' 条笔记（共 ' + notes.totalBookCount +
        ' 本）。建议：' + advice);
    }

    // 6. 书架规模与读完（需书架数据）
    if (shelf) {
      const counts = shelfCounts(shelf);
      if (counts.books > 0) {
        items.push('书架现有电子书 ' + counts.books + ' 本，其中读完 ' + counts.finished +
          ' 本。建议：新书不必急着加，先把手边这本读完，书架更清爽，选书也更省力。');
      }
    }

    return items;
  }

  // ==================== 阅读人格（阶段十四 · 读书人版）：计算 ====================
  // 全部本机计算，零外部依赖；同一份数据必得同一结果（判定不含随机、不依赖 AI）。

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  /** 非重叠出现次数（用于词表计数） */
  function personaCountOccurrences(text, word) {
    if (!text || !word) {
      return 0;
    }
    let count = 0;
    let index = 0;
    while (true) {
      const found = text.indexOf(word, index);
      if (found < 0) {
        break;
      }
      count += 1;
      index = found + word.length;
    }
    return count;
  }

  /** 秒级时间戳（兼容毫秒）→ 年份字符串 */
  function personaYear(at) {
    const num = Number(at) || 0;
    if (!num) {
      return '';
    }
    const ms = num > 1e12 ? num : num * 1000;
    return String(new Date(ms).getFullYear());
  }

  /** 分类标题 → 求实 / 求意 / 中性 */
  function personaCategoryPolarity(name) {
    const text = String(name || '');
    if (!text) {
      return 'neutral';
    }
    for (let i = 0; i < PERSONA_MEANING_KEYS.length; i += 1) {
      if (text.indexOf(PERSONA_MEANING_KEYS[i]) >= 0) {
        return 'meaning';
      }
    }
    for (let i = 0; i < PERSONA_FACT_KEYS.length; i += 1) {
      if (text.indexOf(PERSONA_FACT_KEYS[i]) >= 0) {
        return 'fact';
      }
    }
    return 'neutral';
  }

  // ---- 语料抓取：Top N 书的划线 / 想法全文 ----

  // 单本书划线原文（含时间戳）
  async function fetchBookMarks(bookId) {
    const marks = [];
    const res = await sendBg({ type: 'wre-official-call', apiName: '/book/bookmarklist', params: { bookId: bookId } });
    if (res && res.ok && res.data) {
      const updated = Array.isArray(res.data.updated) ? res.data.updated : [];
      updated.forEach((item) => {
        const text = item && item.markText;
        if (typeof text === 'string' && text.trim()) {
          marks.push({ text: text.trim(), at: item.createTime || item.markTime || 0 });
        }
      });
    }
    return marks.slice(0, PERSONA_MARK_MAX);
  }

  // 单本书想法/点评原文（游标分页，含时间戳）
  async function fetchBookReviewItems(bookId) {
    const items = [];
    let synckey = 0;
    let more = true;
    for (let page = 0; page < 5 && more; page += 1) {
      const res = await sendBg({
        type: 'wre-official-call',
        apiName: '/review/list/mine',
        params: { bookid: bookId, synckey: synckey, count: 50 },
      });
      if (!res || !res.ok || !res.data) {
        break;
      }
      const reviews = Array.isArray(res.data.reviews) ? res.data.reviews : [];
      reviews.forEach((item) => {
        const r = item && item.review;
        if (r && typeof r.content === 'string' && r.content.trim()) {
          items.push({ text: r.content.trim(), at: r.createTime || 0 });
        }
      });
      synckey = res.data.synckey != null ? res.data.synckey : synckey;
      more = Number(res.data.hasMore) === 1;
    }
    return items;
  }

  // 拉取「笔记最多」的前 N 本书的全部划线/想法（命中缓存则跳过网络）
  async function ensurePersonaCorpus(force) {
    if (personaCorpusState === 'loading') {
      return;
    }
    if (!force) {
      if (personaCorpus && (Date.now() - (personaCorpus.at || 0)) < PERSONA_CACHE_TTL_MS) {
        return;
      }
      const cached = await readPersonaCache();
      if (cached && Array.isArray(cached.books) && (Date.now() - (cached.at || 0)) < PERSONA_CACHE_TTL_MS) {
        personaCorpus = cached;
        personaCorpusState = 'ok';
        personaCorpusError = '';
        logOfficial('info', '阅读人格：命中语料缓存', { books: cached.books.length });
        render();
        return;
      }
    }

    personaCorpusState = 'loading';
    personaCorpusError = '';
    render();

    const notes = overview && overview.notebooks ? overview.notebooks : null;
    const stats = notebookStats(notes);
    const topBooks = stats && Array.isArray(stats.topBooks) ? stats.topBooks.slice(0, PERSONA_TOP_BOOKS) : [];
    if (!topBooks.length) {
      personaCorpusState = 'error';
      personaCorpusError = '暂无带笔记的书，暂时做不了词语分析';
      logOfficial('warn', '阅读人格：无语料（没有带笔记的书）');
      render();
      return;
    }

    try {
      const books = [];
      let total = 0;
      for (let i = 0; i < topBooks.length; i += 1) {
        if (total >= PERSONA_CORPUS_MAX) {
          break;
        }
        const book = topBooks[i];
        const bookId = book && book.bookId;
        if (!bookId) {
          continue;
        }
        const pair = await Promise.all([fetchBookMarks(bookId), fetchBookReviewItems(bookId)]);
        const marks = pair[0];
        const reviews = pair[1];
        books.push({
          title: (book && book.title) || '未命名',
          author: (book && book.author) || '',
          marks: marks,
          reviews: reviews,
        });
        total += marks.length + reviews.length;
      }
      personaCorpus = { at: Date.now(), books: books };
      personaCorpusState = 'ok';
      personaCorpusError = '';
      await writePersonaCache(personaCorpus);
      logOfficial('info', '阅读人格：语料拉取完成', { books: books.length, items: total });
    } catch (err) {
      personaCorpusState = 'error';
      personaCorpusError = '语料拉取失败';
      logOfficial('warn', '阅读人格：语料拉取失败', { message: err && err.message });
    }
    render();
  }

  // ---- 词语分析（零依赖：正向词表 + 停用词过滤的 n-gram）----

  let personaLexicon = null;
  function personaGetLexicon() {
    if (personaLexicon) {
      return personaLexicon;
    }
    const set = {};
    const addAll = (arr) => arr.forEach((word) => {
      if (word && word.length >= 2) {
        set[word] = true;
      }
    });
    addAll(PERSONA_LOGIC_WORDS);
    addAll(PERSONA_EMOTION_WORDS);
    addAll(PERSONA_POSITIVE_WORDS);
    addAll(PERSONA_NEGATIVE_WORDS);
    PERSONA_THEMES.forEach((theme) => addAll(theme.words));
    personaLexicon = set;
    return set;
  }

  const PERSONA_STOP_CHARS = '的了是在和有你他她它们这那就都而及或但并却被把让给对从向到于为以之其所以则又还更最不了没一二三上下中大小多少个之乎者也';

  /** 切分为连续中文片段（去掉标点/数字/英文） */
  function personaSplitRuns(text) {
    return String(text || '').split(/[^\u4e00-\u9fa5]+/).filter(Boolean);
  }

  /** 词频统计：正向词表最大匹配（高权重）+ n-gram 兜底（过滤停用词） */
  function personaCountWords(text) {
    const lexicon = personaGetLexicon();
    const stopSet = {};
    PERSONA_STOPWORDS.forEach((word) => { stopSet[word] = true; });
    const lexCounts = {};
    const gramCounts = {};
    personaSplitRuns(text).forEach((run) => {
      // 正向最大匹配（2~4 字）
      let i = 0;
      while (i < run.length) {
        let matched = '';
        for (let len = 4; len >= 2; len -= 1) {
          if (i + len > run.length) {
            continue;
          }
          const cand = run.slice(i, i + len);
          if (lexicon[cand]) {
            matched = cand;
            break;
          }
        }
        if (matched) {
          lexCounts[matched] = (lexCounts[matched] || 0) + 1;
          i += matched.length;
        } else {
          i += 1;
        }
      }
      // n-gram（2~4）
      for (let len = 2; len <= 4; len += 1) {
        for (let start = 0; start + len <= run.length; start += 1) {
          const gram = run.slice(start, start + len);
          if (stopSet[gram]) {
            continue;
          }
          if (PERSONA_STOP_CHARS.indexOf(gram.charAt(0)) >= 0 || PERSONA_STOP_CHARS.indexOf(gram.charAt(gram.length - 1)) >= 0) {
            continue;
          }
          gramCounts[gram] = (gramCounts[gram] || 0) + 1;
        }
      }
    });

    const list = [];
    Object.keys(lexCounts).forEach((word) => {
      list.push({ word: word, count: lexCounts[word], lex: true, score: lexCounts[word] * 2.2 + word.length });
    });
    Object.keys(gramCounts).forEach((word) => {
      if (gramCounts[word] >= 3) {
        list.push({ word: word, count: gramCounts[word], lex: false, score: gramCounts[word] });
      }
    });
    list.sort((a, b) => b.score - a.score);

    // 去重：优先保留更长、更高分的词，剔除被包含的短词
    const accepted = [];
    list.forEach((item) => {
      if (item.word.length > 12) {
        return;
      }
      let contained = false;
      for (let i = 0; i < accepted.length; i += 1) {
        if (accepted[i].word.length > item.word.length && accepted[i].word.indexOf(item.word) >= 0) {
          contained = true;
          break;
        }
      }
      if (contained) {
        return;
      }
      for (let i = accepted.length - 1; i >= 0; i -= 1) {
        if (item.word.length > accepted[i].word.length && item.word.indexOf(accepted[i].word) >= 0) {
          accepted.splice(i, 1);
        }
      }
      accepted.push(item);
    });
    return accepted;
  }

  /** 情绪比例（按句：命中正向/负向词的句，其余为中性） */
  function personaEmotionRatio(text) {
    const sentences = String(text || '').split(/[。！？!?；;\n]+/).map((s) => s.trim()).filter((s) => s.length >= 2);
    let pos = 0;
    let neg = 0;
    let neu = 0;
    sentences.forEach((sentence) => {
      let hitPos = false;
      let hitNeg = false;
      for (let i = 0; i < PERSONA_POSITIVE_WORDS.length; i += 1) {
        if (sentence.indexOf(PERSONA_POSITIVE_WORDS[i]) >= 0) {
          hitPos = true;
          break;
        }
      }
      for (let i = 0; i < PERSONA_NEGATIVE_WORDS.length; i += 1) {
        if (sentence.indexOf(PERSONA_NEGATIVE_WORDS[i]) >= 0) {
          hitNeg = true;
          break;
        }
      }
      if (hitPos && !hitNeg) {
        pos += 1;
      } else if (hitNeg && !hitPos) {
        neg += 1;
      } else {
        neu += 1;
      }
    });
    const total = sentences.length || 1;
    return {
      pos: pos, neg: neg, neu: neu, total: sentences.length,
      posPct: Math.round((pos / total) * 100),
      negPct: Math.round((neg / total) * 100),
      neuPct: Math.round((neu / total) * 100),
    };
  }

  /** 主题词归并（高频词 → 5 个主题） */
  function personaThemes(words) {
    const counts = PERSONA_THEMES.map((theme) => ({ name: theme.name, count: 0 }));
    words.forEach((item) => {
      for (let i = 0; i < PERSONA_THEMES.length; i += 1) {
        if (PERSONA_THEMES[i].words.indexOf(item.word) >= 0) {
          counts[i].count += item.count;
          break;
        }
      }
    });
    return counts.filter((item) => item.count > 0).sort((a, b) => b.count - a.count).slice(0, 5);
  }

  /** 语料 → 划线 / 想法数组（带书名与时间戳） */
  function personaSegments(corpus) {
    const marks = [];
    const reviews = [];
    const books = corpus && Array.isArray(corpus.books) ? corpus.books : [];
    books.forEach((book) => {
      (book.marks || []).forEach((item) => {
        if (item && item.text) {
          marks.push({ text: item.text, at: item.at || 0, title: book.title || '' });
        }
      });
      (book.reviews || []).forEach((item) => {
        if (item && item.text) {
          reviews.push({ text: item.text, at: item.at || 0, title: book.title || '' });
        }
      });
    });
    return { marks: marks, reviews: reviews };
  }

  /** 口头禅：跨书重复出现最多的一句（无重复则取最有代表性的一句） */
  function personaCatchphrase(segments) {
    const map = {};
    (segments.marks || []).forEach((item) => {
      const key = String(item.text).replace(/\s+/g, '').replace(/[。！？!?，,、；;：:""''「」『』（）()\[\]【】…—~-]/g, '');
      if (key.length < 4 || key.length > 40) {
        return;
      }
      if (!map[key]) {
        map[key] = { text: item.text, title: item.title || '', at: item.at || 0, count: 0 };
      }
      map[key].count += 1;
      if (item.at && item.at > (map[key].at || 0)) {
        map[key].at = item.at;
      }
    });
    const list = Object.keys(map).map((key) => map[key]);
    if (!list.length) {
      return null;
    }
    list.sort((a, b) => (b.count - a.count) || (b.text.length - a.text.length));
    return list[0];
  }

  /** 原文证据：从语料里挑若干条真实引用（每本最多 2 条） */
  function personaQuotes(corpus) {
    const quotes = [];
    const books = corpus && Array.isArray(corpus.books) ? corpus.books : [];
    const seen = {};
    for (let i = 0; i < books.length && quotes.length < PERSONA_QUOTE_MAX; i += 1) {
      const marks = (books[i].marks || [])
        .filter((item) => item && item.text && item.text.replace(/\s/g, '').length >= 10)
        .sort((a, b) => b.text.length - a.text.length);
      let perBook = 0;
      for (let j = 0; j < marks.length && perBook < 2 && quotes.length < PERSONA_QUOTE_MAX; j += 1) {
        const key = marks[j].text.replace(/\s/g, '');
        if (seen[key]) {
          continue;
        }
        seen[key] = true;
        quotes.push({ text: marks[j].text, title: books[i].title || '', at: marks[j].at || 0 });
        perBook += 1;
      }
    }
    return quotes;
  }

  // ---- 四个维度判定 ----

  function personaFinalizeDim(config) {
    // config: { key, title, left, right, leftPct, band, available, confidence, basis }
    if (config.leftPct == null || !isFinite(config.leftPct)) {
      return {
        key: config.key, title: config.title,
        left: config.left, right: config.right,
        available: false, side: '', centered: false, leftPct: null,
        confidence: 'none', basis: config.basis || '该维度数据还不够',
      };
    }
    const pct = Math.max(0, Math.min(100, config.leftPct));
    const band = config.band || 5;
    let side;
    let centered = false;
    if (pct >= 50 + band) {
      side = config.left.letter;
    } else if (pct <= 50 - band) {
      side = config.right.letter;
    } else {
      centered = true;
      side = pct >= 50 ? config.left.letter : config.right.letter;
    }
    return {
      key: config.key, title: config.title,
      left: config.left, right: config.right,
      available: true, side: side, centered: centered,
      leftPct: Math.round(pct),
      confidence: config.confidence || 'mid',
      basis: config.basis || '',
    };
  }

  // D1 阅读能量：深潜 D ↔ 广撒 B
  function personaDimensionEnergy(data, shelf, notebooks) {
    const comps = [];
    const books = shelf && Array.isArray(shelf.books) ? shelf.books : [];
    const overallSec = Number(data && data.totalReadTime) || 0;
    const readBooks = books.filter((item) => Number(item.readUpdateTime) > 0).length || books.length;
    if (overallSec > 0 && readBooks > 0) {
      const avg = overallSec / readBooks;
      comps.push({
        weight: 0.35,
        score: clamp01((avg - 1.5 * 3600) / (6 * 3600 - 1.5 * 3600)),
        text: '单本均摊约 ' + fmtDuration(avg),
      });
    }
    const cats = shelf ? shelfCategories(shelf) : null;
    if (cats && cats.list.length && books.length) {
      const top3 = cats.list.slice(0, 3).reduce((acc, item) => acc + item.count, 0);
      const share = top3 / books.length;
      comps.push({ weight: 0.25, score: clamp01(share / 0.7), text: '前 3 类占书架 ' + Math.round(share * 100) + '%' });
    }
    const fin = shelf ? finishStats(shelf) : null;
    if (fin && fin.ebooks > 0) {
      comps.push({ weight: 0.2, score: fin.rate, text: '电子书完读率 ' + Math.round(fin.rate * 100) + '%' });
    }
    const stats = notebookStats(notebooks);
    if (stats && stats.totalBookCount > 0) {
      const parallel = clamp01((stats.totalBookCount - 2) / (8 - 2));
      comps.push({ weight: 0.2, score: 1 - parallel, text: '有笔记的书 ' + stats.totalBookCount + ' 本（并行度）' });
    }
    if (comps.length < 2) {
      return personaFinalizeDim({
        key: 'energy', title: '阅读能量', left: { letter: 'D', label: '深潜' }, right: { letter: 'B', label: '广撒' },
        leftPct: null, basis: '需要书架与累计时长的组合数据',
      });
    }
    let sum = 0;
    let weightSum = 0;
    comps.forEach((item) => { sum += item.score * item.weight; weightSum += item.weight; });
    const leftPct = (sum / weightSum) * 100;
    return personaFinalizeDim({
      key: 'energy', title: '阅读能量',
      left: { letter: 'D', label: '深潜' }, right: { letter: 'B', label: '广撒' },
      leftPct: leftPct, band: 5,
      confidence: comps.length >= 3 ? 'high' : 'mid',
      basis: comps.map((item) => item.text).join('；'),
    });
  }

  // D2 内容取向：求实 F ↔ 求意 M
  function personaDimensionContent(data, shelf) {
    let factW = 0;
    let meaningW = 0;
    let sourceLabel = '';
    const classify = (name, weight) => {
      const w = Number(weight) || 0;
      const polarity = personaCategoryPolarity(name);
      if (polarity === 'fact') {
        factW += w;
      } else if (polarity === 'meaning') {
        meaningW += w;
      }
    };
    const cats = data && Array.isArray(data.preferCategory) ? data.preferCategory : [];
    if (cats.length) {
      sourceLabel = '官方偏好分类（按阅读时长）';
      cats.forEach((item) => {
        const name = item.parentCategoryTitle || item.categoryTitle || '';
        const weight = Number(item.readingTime) || Number(item.readingCount) || 0;
        if (weight > 0) {
          classify(name, weight);
        }
      });
    } else if (shelf) {
      const sc = shelfCategories(shelf);
      if (sc.list.length) {
        sourceLabel = '书架分类（按本数）';
        sc.list.forEach((item) => classify(item.name, item.count));
      }
    }
    const denom = factW + meaningW;
    if (!denom) {
      return personaFinalizeDim({
        key: 'content', title: '内容取向', left: { letter: 'F', label: '求实' }, right: { letter: 'M', label: '求意' },
        leftPct: null, basis: '暂无可归类的分类数据',
      });
    }
    const factShare = factW / denom;
    return personaFinalizeDim({
      key: 'content', title: '内容取向',
      left: { letter: 'F', label: '求实' }, right: { letter: 'M', label: '求意' },
      leftPct: factShare * 100, band: 10,
      confidence: cats.length ? 'high' : 'mid',
      basis: sourceLabel + '：求实 ' + Math.round(factShare * 100) + '% / 求意 ' + Math.round((1 - factShare) * 100) + '%',
    });
  }

  // D3 表达方式：理性 L ↔ 感性 E
  function personaDimensionStyle(corpus) {
    const segments = personaSegments(corpus);
    const text = segments.marks.concat(segments.reviews).map((item) => item.text).join('\n');
    if (!text) {
      return personaFinalizeDim({
        key: 'style', title: '表达方式', left: { letter: 'L', label: '理性' }, right: { letter: 'E', label: '感性' },
        leftPct: null, basis: '还没有可用的划线/想法语料',
      });
    }
    let logic = 0;
    let emotion = 0;
    PERSONA_LOGIC_WORDS.forEach((word) => { logic += personaCountOccurrences(text, word); });
    PERSONA_EMOTION_WORDS.forEach((word) => { emotion += personaCountOccurrences(text, word); });
    const excl = (text.match(/[！!]/g) || []).length;
    const quest = (text.match(/[？?]/g) || []).length;
    const base = logic + emotion;
    if (!base && !excl && !quest) {
      return personaFinalizeDim({
        key: 'style', title: '表达方式', left: { letter: 'L', label: '理性' }, right: { letter: 'E', label: '感性' },
        leftPct: null, basis: '划线与想法里暂无可判定的词',
      });
    }
    const logicShare = base ? logic / base : 0.5;
    const adjust = Math.max(-6, Math.min(6, (quest - excl) * 0.6));
    const leftPct = Math.max(0, Math.min(100, logicShare * 100 + adjust));
    const confidence = (segments.marks.length + segments.reviews.length) >= 30 ? 'high' : 'mid';
    return personaFinalizeDim({
      key: 'style', title: '表达方式',
      left: { letter: 'L', label: '理性' }, right: { letter: 'E', label: '感性' },
      leftPct: leftPct, band: 5, confidence: confidence,
      basis: '逻辑词 ' + logic + ' 次 / 情感词 ' + emotion + ' 次（问号 ' + quest + '、感叹号 ' + excl + '）',
    });
  }

  // D4 阅读节奏：计划 P ↔ 随兴 R
  function personaDimensionRhythm(data) {
    const buckets = reportBuckets(data || {});
    const positive = buckets.filter((item) => item.seconds > 0);
    if (positive.length < 3) {
      return personaFinalizeDim({
        key: 'rhythm', title: '阅读节奏', left: { letter: 'P', label: '计划' }, right: { letter: 'R', label: '随兴' },
        leftPct: null, basis: '有阅读的统计单元只有 ' + positive.length + ' 个，暂时判不准节奏',
      });
    }
    const coverage = positive.length / (buckets.length || positive.length);
    const mean = positive.reduce((acc, item) => acc + item.seconds, 0) / positive.length;
    const variance = positive.reduce((acc, item) => acc + Math.pow(item.seconds - mean, 2), 0) / positive.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
    const smooth = clamp01(1 - cv / 1.6);
    const leftPct = (0.5 * clamp01(coverage) + 0.5 * smooth) * 100;
    return personaFinalizeDim({
      key: 'rhythm', title: '阅读节奏',
      left: { letter: 'P', label: '计划' }, right: { letter: 'R', label: '随兴' },
      leftPct: leftPct, band: 5,
      confidence: positive.length >= 6 ? 'high' : 'mid',
      basis: '有阅读的统计单元 ' + positive.length + '/' + buckets.length + '（' + Math.round(coverage * 100) + '%），波动系数 ' + cv.toFixed(2),
    });
  }

  /** 时段绰号（复用现有时间段判定口径） */
  function personaTimeNickname(data) {
    const hourly = hourlyReadTime(data || {});
    if (!hourly.length) {
      return '';
    }
    const peak = hourly.reduce((acc, item) => (item.seconds > acc.seconds ? item : acc));
    if (peak.seconds <= 0) {
      return '';
    }
    const hour = peak.hour;
    if (hour >= 21 || hour < 6) {
      return '夜读者';
    }
    if (hour >= 6 && hour < 9) {
      return '晨读者';
    }
    if (hour >= 11 && hour < 14) {
      return '午间读者';
    }
    return '日间读者';
  }

  /** 三个特质绰号：优先现有客观画像标签 + 时段，其次四维绰号 */
  function personaNicknames(data, shelf, notebooks, dims) {
    const pool = [];
    const tags = buildPersona(data, mode, shelf, notebooks);
    tags.forEach((tag) => pool.push(tag[1]));
    const timeNick = personaTimeNickname(data);
    if (timeNick) {
      pool.push(timeNick);
    }
    dims.forEach((dim) => {
      if (!dim.available) {
        return;
      }
      const key = dim.key + dim.side;
      if (PERSONA_NICKNAMES[key]) {
        pool.push(PERSONA_NICKNAMES[key]);
      }
    });
    const unique = [];
    pool.forEach((name) => {
      if (name && unique.indexOf(name) < 0 && unique.length < 3) {
        unique.push(name);
      }
    });
    return unique;
  }

  /** 一句话画像：由已算出的判定生成，不许自由发挥 */
  function personaOneLiner(dims, tagline) {
    const phraseMap = {
      energyD: '把一本书读进骨子里',
      energyB: '同时开着好几条阅读线',
      contentF: '更想要能立刻用上的东西',
      contentM: '更想把一件事彻底想明白',
      styleL: '习惯把看到的东西拆开看',
      styleE: '容易被文字里的情绪打动',
      rhythmP: '读书有自己的节拍',
      rhythmR: '顺着当下的兴趣走',
    };
    const decisive = dims.filter((dim) => dim.available)
      .slice()
      .sort((a, b) => Math.abs(b.leftPct - 50) - Math.abs(a.leftPct - 50))
      .slice(0, 2)
      .map((dim) => phraseMap[dim.key + dim.side])
      .filter(Boolean);
    if (!decisive.length) {
      return tagline ? '你是那种' + tagline + '的人。' : '';
    }
    return '你是那种' + decisive.join('、') + '的人。';
  }

  /**
   * 汇总：算出「阅读人格」（四维判定 + 16 型 + 人格化的人 + 词语分析）。
   * 返回 ok=false 时给出数据不足的进度，供降级引导态使用。
   */
  function getReadingPersona() {
    const overall = overallReport || report || {};
    const shelf = overview && overview.shelf ? overview.shelf : null;
    const notebooks = overview && overview.notebooks ? overview.notebooks : null;
    const stats = notebookStats(notebooks);
    const totalSec = Number(overall.totalReadTime) || 0;
    const noteCount = stats ? (stats.noteTotal + stats.reviewTotal) : 0;
    const hasKey = !!keyStatus.hasKey;

    // 数据门槛：时长与笔记都要够，才硬出结论
    if (!hasKey) {
      return { ok: false, reason: 'nokey' };
    }
    if (totalSec < PERSONA_MIN_SECONDS || noteCount < PERSONA_MIN_NOTES) {
      return {
        ok: false,
        reason: 'data',
        progress: {
          hours: (totalSec / 3600).toFixed(1),
          notes: noteCount,
          needHours: Math.round(PERSONA_MIN_SECONDS / 3600),
          needNotes: PERSONA_MIN_NOTES,
          hasKey: true,
        },
      };
    }

    // 节奏维度优先用「统计单元更多」的数据（累计通常是按年，单元少）
    const rhythmData = (reportBuckets(overall).filter((b) => b.seconds > 0).length >= 3) ? overall : (report || overall);

    const dims = [
      personaDimensionEnergy(overall, shelf, notebooks),
      personaDimensionContent(overall, shelf),
      personaDimensionStyle(personaCorpus),
      personaDimensionRhythm(rhythmData),
    ];

    const available = dims.filter((dim) => dim.available);
    const code = dims.map((dim) => (dim.available ? dim.side : '–')).join('');
    const full = available.length === dims.length;
    const type = full ? PERSONA_TYPES[code] : null;

    logOfficial('info', '阅读人格判定完成', {
      code: code,
      dims: dims.map((dim) => ({ key: dim.key, side: dim.side, pct: dim.leftPct, conf: dim.confidence })),
      corpusState: personaCorpusState,
    });

    // 词语分析
    const segments = personaSegments(personaCorpus);
    const corpusText = segments.marks.concat(segments.reviews).map((item) => item.text).join('\n');
    const words = personaCountWords(corpusText).slice(0, PERSONA_WORD_TOP);
    const hasWords = words.length >= 3;
    const topWords = hasWords ? words : [];
    const cloud = topWords.slice(0, PERSONA_CLOUD_TOP);
    const analysis = hasWords ? {
      top: topWords,
      emotion: personaEmotionRatio(corpusText),
      catchphrase: personaCatchphrase(segments),
      themes: personaThemes(topWords),
      cloud: cloud,
    } : null;

    // 人格化的人：数据证据
    const evidenceData = [];
    if (totalSec > 0) {
      evidenceData.push('累计阅读 ' + fmtDuration(totalSec));
    }
    if (stats) {
      evidenceData.push('划了 ' + stats.noteTotal + ' 条线');
      evidenceData.push('写了 ' + stats.reviewTotal + ' 条想法');
    }
    if (shelf) {
      const counts = shelfCounts(shelf);
      evidenceData.push('书架 ' + counts.books + ' 本');
    }

    return {
      ok: true,
      basedOn: overallReport ? 'overall' : mode,
      reader: getReaderNickname(),
      code: code,
      name: type ? type[0] : '待补全的阅读人格',
      tagline: type ? type[1] : '还有一两个维度数据不够，补齐后会更准',
      full: full,
      nicknames: personaNicknames(overall, shelf, notebooks, dims),
      dims: dims,
      oneLiner: full ? personaOneLiner(dims, type ? type[1] : '') : '',
      evidence: { data: evidenceData, quotes: personaQuotes(personaCorpus) },
      catchphrase: analysis ? analysis.catchphrase : null,
      words: analysis,
      corpusState: personaCorpusState,
      corpusError: personaCorpusError,
      aiText: aiReadingPersona || '',
    };
  }

  // 读取当前微信读书网页版登录昵称（本机账号）。
  // 优先从 cookie 的 wr_name（微信读书 web 登录态，昵称做了 URL 编码）读取；
  // 再尝试 localStorage 常见字段；均拿不到返回空串，由调用方回退默认文案。
  function getReaderNickname() {
    const readName = (raw) => {
      if (!raw) {
        return '';
      }
      let val = String(raw).trim();
      if (!val) {
        return '';
      }
      try {
        val = decodeURIComponent(val);
      } catch (e) {
        // 不是 URL 编码，直接用原文
      }
      val = String(val).trim();
      // 昵称一般很短；过长多半是误读，直接放弃
      return (val && val.length <= 40) ? val : '';
    };

    // 1) cookie：wr_name（URL 编码昵称）
    try {
      const m = document.cookie.match(/(?:^|;\s*)wr_name=([^;]*)/);
      const name = readName(m && m[1]);
      if (name) {
        logOfficial('info', '已取到读者昵称（来源 cookie.wr_name）', { len: name.length });
        return name;
      }
    } catch (e) {
      logOfficial('warn', '读取 cookie 昵称异常', { err: String(e && e.message) });
    }

    // 2) localStorage 常见字段
    try {
      const keys = ['wr_name', 'userName', 'nickname', 'userInfo', 'wr_userInfo', 'wr_user'];
      for (const key of keys) {
        let raw = null;
        try {
          raw = localStorage.getItem(key);
        } catch (e) {
          continue;
        }
        if (!raw) {
          continue;
        }
        // userInfo / user 可能是 JSON，先尝试解析出 name/nickname
        if (/info|user/i.test(key)) {
          try {
            const obj = JSON.parse(raw);
            const n = readName(obj && (obj.name || obj.nickname || obj.nickName));
            if (n) {
              logOfficial('info', '已取到读者昵称（来源 localStorage.' + key + '）', { len: n.length });
              return n;
            }
          } catch (e) {
            // 非 JSON，走下面的明文分支
          }
        }
        const n = readName(raw);
        if (n) {
          logOfficial('info', '已取到读者昵称（来源 localStorage.' + key + '）', { len: n.length });
          return n;
        }
      }
    } catch (e) {
      logOfficial('warn', '读取 localStorage 昵称异常', { err: String(e && e.message) });
    }

    logOfficial('info', '未取到读者昵称，回退默认文案');
    return '';
  }

  function buildReportModel(data, currentMode, overviewData, options) {
    const blocks = [];
    const opts = options || {};
    const buckets = reportBuckets(data);
    const shelf = overviewData && overviewData.shelf ? overviewData.shelf : null;
    const notebooks = overviewData && overviewData.notebooks ? overviewData.notebooks : null;
    const sources = ['/readdata/detail'];
    if (shelf) {
      sources.push('/shelf/sync');
    }
    if (notebooks) {
      sources.push('/user/notebooks');
    }

    blocks.push({ type: 'kv', rows: [
      ['报告对象', getReaderNickname() || '微信读书用户（本机账号）'],
      ['数据来源', '微信读书官方 Agent Skill · ' + sources.join(' · ')],
      ['统计周期', modeLabel(currentMode)],
      ['生成时间', fmtDateTime(Date.now())],
      ['skill 版本', keyStatus.skillVersion || '1.0.4'],
      ['分析方法', aiState === 'ok'
        ? '客观数据本机规则计算，执行摘要由 DeepSeek AI 生成'
        : '基于官方统计与偏好字段的规则化解读（纯本地执行）'],
    ]});

    if (overviewState === 'error' || overviewState === 'partial') {
      blocks.push({ type: 'note', text: '提示：' + overviewError + '，相关章节已省略（不影响其余章节）。' });
    }

    // 首屏人格卡（仅 HTML 导出置顶，便于截图；Markdown 走末尾「十五」章节）
    if (opts.personaTop) {
      const topPersona = getReadingPersona();
      if (topPersona.ok) {
        blocks.push({ type: 'personaCard', persona: topPersona });
      }
    }

    // 一、执行摘要（优先用 DeepSeek AI 生成的人格化解读，否则退回规则化摘要）
    // 两者都固定基于「累计（总体）」数据，与上方周期选择无关。
    blocks.push({ type: 'heading', level: 2, text: '一、执行摘要' });
    blocks.push({ type: 'note', text: overallReport
      ? '本节执行摘要与下方「人性化人格分析」均基于累计（总体）数据，不随上方周期切换变化；正文各章节仍按所选周期统计。'
      : '本次未取到累计（总体）数据，执行摘要暂按所选周期（' + modeLabel(currentMode) + '）展示。' });
    if (aiState === 'ok' && aiSummary && aiSummary.length) {
      aiSummary.forEach((para) => {
        blocks.push({ type: 'paragraph', text: para });
      });
      blocks.push({ type: 'note', text: '本执行摘要由 DeepSeek AI 基于本机计算的客观数据与划线/想法原文样本生成；具体数字以正文各章节的规则化统计为准。' });
    } else {
      const summaryData = overallReport || data;
      const summaryInsights = buildInsights(summaryData, overallReport ? 'overall' : currentMode, reportBuckets(summaryData));
      blocks.push({ type: 'paragraph', text: summaryInsights[0] });
      if (summaryInsights.length > 1) {
        blocks.push({ type: 'list', ordered: true, items: summaryInsights.slice(1) });
      }
      if (aiState === 'error') {
        blocks.push({ type: 'note', text: 'AI 解读生成失败（' + aiError + '），已退回规则化摘要。' });
      } else if (aiState === 'skipped') {
        blocks.push({ type: 'note', text: '未配置 DeepSeek Key，当前为规则化摘要。在「🔑 API Key」里配置 DeepSeek 后，可在报告页点「生成 AI 解读」，再导出即可带上人格化执行摘要与人性化人格分析。' });
      }
    }

    // 人性化人格分析（DeepSeek，可选）：紧跟在执行摘要之后，放在文档最上方
    if (aiPersona && aiPersona.length) {
      blocks.push({ type: 'heading', level: 3, text: '人性化人格分析' });
      aiPersona.forEach((point) => {
        if (point && point.title) {
          blocks.push({ type: 'heading', level: 4, text: point.title });
        }
        if (point && point.body) {
          blocks.push({ type: 'paragraph', text: point.body });
        }
      });
      blocks.push({ type: 'note', text: '本段人格分析由 DeepSeek AI 基于本机计算的客观数据与划线/想法原文样本生成，属参考性解读，不构成专业心理或性格鉴定。' });
    }

    // 二、数据全景
    blocks.push({ type: 'heading', level: 2, text: '二、数据全景' });
    blocks.push({ type: 'heading', level: 3, text: '2.1 核心指标' });
    blocks.push({ type: 'cards', items: metricCards(data) });
    if (shelf) {
      const counts = shelfCounts(shelf);
      blocks.push({ type: 'heading', level: 3, text: '2.2 书架结构' });
      blocks.push({ type: 'kv', rows: [
        ['书架条目总数', counts.total + ' 个'],
        ['电子书', counts.books + ' 本'],
        ['专辑 / 有声书', counts.albums + ' 个'],
        ['文章收藏入口', counts.hasMp ? '有' : '无'],
        ['公开 / 私密', counts.publicCount + ' / ' + counts.secret],
        ['置顶', counts.top + ' 个'],
      ]});
      blocks.push({ type: 'note', text: '官方口径：书架总数 = 电子书 + 专辑/有声书 +（有文章收藏入口时 +1）；文章收藏入口固定计入私密阅读。' });
    }
    const summary = officialSummary(data);
    if (summary.length) {
      blocks.push({ type: 'heading', level: 3, text: '2.3 官方概要' });
      blocks.push({ type: 'chips', items: summary });
    }
    const categories = Array.isArray(data.preferCategory) ? data.preferCategory : [];
    if (categories.length) {
      const categoryTotal = categories.reduce((acc, item) => acc + (item.readingTime || 0), 0) || 1;
      blocks.push({ type: 'heading', level: 3, text: '2.4 偏好分类（按阅读时长）' });
      blocks.push({
        type: 'table',
        head: ['分类', '读过', '时长', '占比'],
        num: [1, 2, 3],
        bar: { after: 0, max: maxOf(categories.map((item) => item.readingTime)), values: categories.map((item) => item.readingTime || 0) },
        rows: categories.map((item) => [
          item.parentCategoryTitle || item.categoryTitle || '未分类',
          (item.readingCount || 0) + ' 本',
          fmtDuration(item.readingTime),
          (((item.readingTime || 0) / categoryTotal) * 100).toFixed(1) + '%',
        ]),
      });
      blocks.push({
        type: 'chart',
        kind: 'hbar',
        payload: {
          labels: categories.map((item) => item.parentCategoryTitle || item.categoryTitle || '未分类'),
          values: categories.map((item) => item.readingTime || 0),
        },
      });
      if (data.preferCategoryWord) {
        blocks.push({ type: 'callout', text: '官方判定：' + data.preferCategoryWord });
      }
    }

    // 三、阅读轨迹与时间线
    blocks.push({ type: 'heading', level: 2, text: '三、阅读轨迹与时间线' });
    blocks.push({ type: 'heading', level: 3, text: '3.1 ' + bucketSectionLabel(currentMode) });
    const positive = buckets.filter((item) => item.seconds > 0);
    if (!positive.length) {
      blocks.push({ type: 'empty', text: '该周期官方未返回分桶明细' });
    } else {
      const bucketTotal = positive.reduce((acc, item) => acc + item.seconds, 0) || 1;
      blocks.push({
        type: 'table',
        head: ['周期', '时长', '占比'],
        num: [1, 2],
        bar: { after: 0, max: maxOf(positive.map((item) => item.seconds)), values: positive.map((item) => item.seconds) },
        rows: positive.map((item) => [
          fmtBucketLabel(item.ts, currentMode),
          fmtDuration(item.seconds),
          (((item.seconds) / bucketTotal) * 100).toFixed(1) + '%',
        ]),
      });
      blocks.push({
        type: 'chart',
        kind: 'line',
        payload: {
          labels: positive.map((item) => fmtBucketLabel(item.ts, currentMode)),
          values: positive.map((item) => item.seconds),
        },
      });
      const hidden = buckets.length - positive.length;
      if (hidden > 0) {
        blocks.push({ type: 'note', text: '已隐藏 ' + hidden + ' 个 0 时长周期。' });
      }
    }

    // 四、阅读时段分布（官方仅在「累计」周期提供 preferTime）
    const bands = timeBands(data);
    if (bands.length) {
      const bandTotal = bands.reduce((acc, item) => acc + item.seconds, 0) || 1;
      blocks.push({ type: 'heading', level: 2, text: '四、阅读时段分布' });
      blocks.push({
        type: 'table',
        head: ['时段', '时长', '占比'],
        num: [1, 2],
        bar: { after: 0, max: maxOf(bands.map((item) => item.seconds)), values: bands.map((item) => item.seconds) },
        rows: bands.map((item) => [item.label, fmtDuration(item.seconds), ((item.seconds / bandTotal) * 100).toFixed(1) + '%']),
      });
      const hourly = hourlyReadTime(data);
      if (hourly.length) {
        blocks.push({
          type: 'chart',
          kind: 'heatmap',
          payload: {
            hours: hourly.map((item) => item.hour),
            values: hourly.map((item) => item.seconds),
          },
        });
      }
      const peakHour = hourly.reduce((acc, item) => (item.seconds > acc.seconds ? item : acc));
      blocks.push({ type: 'note', text: '全天峰值出现在 ' + pad2(peakHour.hour) + ':00 前后，' + fmtDuration(peakHour.seconds) +
        '（占 ' + ((peakHour.seconds / bandTotal) * 100).toFixed(1) + '%）。' });
    }

    // 五、偏好画像
    const authors = Array.isArray(data.preferAuthor) ? data.preferAuthor : [];
    const publishers = Array.isArray(data.preferPublisher) ? data.preferPublisher : [];
    const partners = Array.isArray(data.preferCp) ? data.preferCp : [];
    if (authors.length || publishers.length || partners.length) {
      blocks.push({ type: 'heading', level: 2, text: '五、偏好画像' });
      if (authors.length) {
        blocks.push({ type: 'heading', level: 3, text: '5.1 偏好作者' });
        blocks.push({
          type: 'table',
          head: ['作者', '本数', '时长'],
          num: [1, 2],
          rows: authors.slice(0, 10).map((item) => [
            item.name || '未知',
            (item.count != null ? item.count : item.authorCount || 0) + ' 本',
            item.readTime != null ? fmtDuration(item.readTime) : '—',
          ]),
        });
      }
      if (publishers.length) {
        blocks.push({ type: 'heading', level: 3, text: '5.2 偏好出版社' });
        blocks.push({
          type: 'table',
          head: ['出版社', '本数'],
          num: [1],
          rows: publishers.slice(0, 10).map((item) => [item.name || '未知', (item.count || 0) + ' 本']),
        });
      }
      if (partners.length) {
        blocks.push({ type: 'heading', level: 3, text: '5.3 偏好版权方' });
        blocks.push({
          type: 'table',
          head: ['版权方', '本数'],
          num: [1],
          rows: partners.slice(0, 10).map((item) => [
            (item.copyrightInfo && item.copyrightInfo.name) || '未知',
            (item.count || 0) + ' 本',
          ]),
        });
      }
    }

    // 六、读得最多
    const longest = Array.isArray(data.readLongest) ? data.readLongest : [];
    blocks.push({ type: 'heading', level: 2, text: '六、读得最多' });
    if (!longest.length) {
      blocks.push({ type: 'empty', text: '该周期内没有达到官方展示门槛的书（官方会过滤约 5 分钟以下的内容）' });
    } else {
      blocks.push({
        type: 'table',
        head: ['排名', '书名', '作者', '时长', '标签'],
        num: [0, 3],
        rows: longest.slice(0, 10).map((item, index) => {
          const book = item.book || {};
          const album = item.albumInfo || {};
          return [
            String(index + 1),
            book.title || album.name || '未命名',
            book.author || album.author || '—',
            fmtDuration(item.readTime),
            Array.isArray(item.tags) && item.tags.length ? item.tags.join(' · ') : '—',
          ];
        }),
      });
    }

    // 七、书的印象（官方按书架语义给每个分类挑出的代表书）
    const impressions = Array.isArray(data.preferBooks) ? data.preferBooks : [];
    const impressionRows = impressions.map((item) => {
      const info = item.bookInfo || item.albumInfo || {};
      return [item.title || '—', info.title || info.name || '—', info.author || '—'];
    }).filter((row) => row[1] !== '—');
    if (impressionRows.length) {
      blocks.push({ type: 'heading', level: 2, text: '七、书的印象' });
      blocks.push({
        type: 'table',
        head: ['官方标签', '书名', '作者'],
        rows: impressionRows,
      });
    }

    // 八、成就勋章（官方仅在「累计」周期提供）
    const medals = Array.isArray(data.medals) ? data.medals : [];
    if (medals.length) {
      blocks.push({ type: 'heading', level: 2, text: '八、成就勋章' });
      blocks.push({
        type: 'table',
        head: ['勋章', '获取条件', '获得时间'],
        rows: medals.slice(0, MEDAL_LIMIT).map((item) => [
          item.name || item.title || '—',
          item.availableCond || item.hint || '—',
          item.atime ? fmtDateTime(item.atime * 1000) : '—',
        ]),
      });
      if (medals.length > MEDAL_LIMIT) {
        blocks.push({ type: 'note', text: '共 ' + medals.length + ' 枚勋章，此处列出前 ' + MEDAL_LIMIT + ' 枚。' });
      }
    }

    // 九、知识脉络（书架分类分布）—— 只做客观聚合，不做「认知/价值观」推断
    if (shelf) {
      const catRows = shelfCategories(shelf);
      if (catRows.list.length) {
        const catTotal = catRows.list.reduce((acc, item) => acc + item.count, 0) || 1;
        blocks.push({ type: 'heading', level: 2, text: '九、知识脉络' });
        blocks.push({ type: 'heading', level: 3, text: '9.1 书架分类分布' });
        blocks.push({
          type: 'table',
          head: ['分类', '本数', '占比'],
          num: [1, 2],
          bar: { after: 0, max: maxOf(catRows.list.map((item) => item.count)), values: catRows.list.map((item) => item.count) },
          rows: catRows.list.map((item) => [item.name, item.count + ' 本', ((item.count / catTotal) * 100).toFixed(1) + '%']),
        });
        if (catRows.more > 0) {
          blocks.push({ type: 'note', text: '另有 ' + catRows.more + ' 个分类未列出（按本数降序取前 ' + CATEGORY_LIMIT + ' 个）。' });
        }
        blocks.push({ type: 'note', text: '口径：按书架电子书的「分类」字段聚合，反映书架构成，不等同于实际阅读量。' });
      }
    }

    // 十、笔记行为
    const notes = notebookStats(notebooks);
    if (notes) {
      blocks.push({ type: 'heading', level: 2, text: '十、笔记行为' });
      blocks.push({ type: 'heading', level: 3, text: '10.1 概览' });
      blocks.push({ type: 'kv', rows: [
        ['有笔记的书', notes.totalBookCount + ' 本'],
        ['笔记总条数', notes.totalNoteCount + ' 条'],
        ['其中 · 想法 / 点评', notes.reviewTotal + ' 条'],
        ['其中 · 划线', notes.noteTotal + ' 条'],
        ['其中 · 书签', notes.bookmarkTotal + ' 条'],
      ]});
      if (notes.totalBookCount > 0 && notes.totalNoteCount > 0) {
        const avg = notes.totalNoteCount / notes.totalBookCount;
        const reviewShare = (notes.reviewTotal / notes.totalNoteCount) * 100;
        const noteShare = (notes.noteTotal / notes.totalNoteCount) * 100;
        blocks.push({ type: 'heading', level: 3, text: '10.2 笔记密度（衍生指标）' });
        blocks.push({ type: 'kv', rows: [
          ['平均每本笔记数', avg.toFixed(1) + ' 条 / 本'],
          ['想法 / 点评占比', reviewShare.toFixed(0) + '%'],
          ['划线占比', noteShare.toFixed(0) + '%'],
        ]});
        blocks.push({ type: 'note', text: '密度口径：平均每本 = 笔记总条数 ÷ 有笔记的书数（仅统计有笔记的书）；占比分母为笔记总条数。' });
      }
      blocks.push({ type: 'heading', level: 3, text: '10.3 笔记最多的书' });
      if (notes.topBooks.length) {
        blocks.push({
          type: 'table',
          head: ['书名', '想法·点评', '划线', '书签', '合计'],
          num: [1, 2, 3, 4],
          rows: notes.topBooks.map((item) => [
            item.title || '未命名',
            String(item.reviewCount),
            String(item.noteCount),
            String(item.bookmarkCount),
            String(item.reviewCount + item.noteCount + item.bookmarkCount),
          ]),
        });
      } else {
        blocks.push({ type: 'empty', text: '暂无带笔记的书。' });
      }
      if (notes.truncated) {
        blocks.push({ type: 'note', text: '已在 ' + NOTEBOOKS_MAX_PAGES + ' 页处截断（每页 ' + NOTEBOOKS_PAGE_SIZE + ' 本），「笔记最多的书」可能未覆盖全部。' });
      }
      blocks.push({ type: 'note', text: '口径：笔记数 = 想法/点评 + 划线 + 书签；书签只统计数量，不含内容。' });
    }

    // 十一、完读率
    if (shelf) {
      const fin = finishStats(shelf);
      if (fin.ebooks > 0) {
        blocks.push({ type: 'heading', level: 2, text: '十一、完读率' });
        blocks.push({ type: 'cards', items: [
          { label: '读完', value: fin.finished + ' 本' },
          { label: '在读', value: fin.reading + ' 本' },
          { label: '完读率', value: (fin.rate * 100).toFixed(1) + '%' },
          { label: '电子书总数', value: fin.ebooks + ' 本' },
        ]});
        blocks.push({
          type: 'chart',
          kind: 'donut',
          payload: { finished: fin.finished, reading: fin.reading },
        });
        blocks.push({ type: 'note', text: '口径：完读率 = 电子书中 finishReading=1 的本数 ÷ 电子书总数；不含专辑/有声书。' });
      }
    }

    // 十二、已读完书目
    if (shelf) {
      const finished = finishedBooks(shelf);
      if (finished.list.length) {
        blocks.push({ type: 'heading', level: 2, text: '十二、已读完书目' });
        blocks.push({
          type: 'table',
          head: ['书名', '作者', '分类', '最近阅读'],
          rows: finished.list.map((item) => [
            item.title || '未命名',
            item.author || '—',
            item.category || '—',
            item.readUpdateTime ? fmtDateTime(item.readUpdateTime * 1000) : '—',
          ]),
        });
        blocks.push({
          type: 'note',
          text: finished.more > 0
            ? '累计读完 ' + finished.total + ' 本，此处按最近阅读时间列出前 ' + SHELF_BOOK_LIMIT + ' 本。'
            : '累计读完 ' + finished.total + ' 本，已全部列出。',
        });
      }
    }

    // 十三、阅读人格画像（客观规则化类型归类；人性化解读见文档开头「人性化人格分析」）
    const persona = buildPersona(data, currentMode, shelf, notebooks);
    if (persona.length) {
      blocks.push({ type: 'heading', level: 2, text: '十三、阅读人格画像' });
      blocks.push({
        type: 'table',
        head: ['维度', '类型画像', '判定依据'],
        rows: persona,
      });
      blocks.push({ type: 'note', text: '口径：以上类型标签由客观统计指标按固定阈值归类（完读率 / 笔记密度 / 分类集中度 / 有声书占比 / 时段峰值），属客观画像，不构成性格、价值观等主观判断；数据不足的维度自动省略。' + (aiPersona && aiPersona.length ? '更深层的人性化解读见文档开头的「人性化人格分析」。' : '') + '结构化 16 型解读见「十五、阅读人格（读书人版）」。' });
    }

    // 十四、阅读规律与建议（规则模板，只用报告已有指标）
    const advice = buildAdvice(data, currentMode, shelf, notebooks);
    if (advice.length) {
      blocks.push({ type: 'heading', level: 2, text: '十四、阅读规律与建议' });
      blocks.push({ type: 'list', ordered: true, items: advice });
      blocks.push({ type: 'note', text: '以上由本报告已有指标按固定规则生成，仅作参考，不构成专业指导；数据不足的条目已自动省略（未接入 AI 时同样生成）。' });
    }

    // 十五、阅读人格（读书人版 · 16 型）：复用首屏同一判定入口，保证口径一致
    const readingPersona = getReadingPersona();
    if (readingPersona.ok) {
      blocks.push({ type: 'heading', level: 2, text: '十五、阅读人格（读书人版）' });
      blocks.push({ type: 'note', text: '口径：代码为 4 位「阅读人格」代码（' + readingPersona.code + '），与 MBTI 码不是一回事；四维判定全部在本机按固定规则计算，可复算、不依赖 AI；某一维数据不足时该位显示「–」。' });
      const personaFigure = PERSONA_FIGURES[readingPersona.code];
      const personaKv = [
        ['人格代码', readingPersona.code],
        ['主称号', readingPersona.name],
        ['一句定调', readingPersona.tagline],
      ];
      if (personaFigure) {
        personaKv.push(['代表人物', personaFigure.name + '（' + personaFigure.line + '）']);
      }
      blocks.push({ type: 'kv', rows: personaKv });
      if (readingPersona.nicknames.length) {
        blocks.push({ type: 'chips', items: readingPersona.nicknames.map((name) => ({ label: name, value: '' })) });
      }
      if (readingPersona.oneLiner) {
        blocks.push({ type: 'paragraph', text: readingPersona.oneLiner });
      }
      if (readingPersona.aiText) {
        blocks.push({ type: 'paragraph', text: readingPersona.aiText });
      }
      blocks.push({ type: 'heading', level: 3, text: '四维判定' });
      blocks.push({ type: 'table', head: ['维度', '判定值', '依据'], rows: readingPersona.dims.map((dim) => {
        if (!dim.available) {
          return [dim.title, '—', dim.basis || '数据还不够'];
        }
        const leftPct = dim.leftPct;
        return [dim.title, dim.left.label + ' ' + leftPct + '% ↔ ' + (100 - leftPct) + '% ' + dim.right.label + (dim.centered ? '（居中）' : ''), dim.basis || ''];
      })});
      if (readingPersona.evidence.data.length) {
        blocks.push({ type: 'heading', level: 3, text: '数据证据' });
        blocks.push({ type: 'chips', items: readingPersona.evidence.data.map((name) => ({ label: name, value: '' })) });
      }
      if (readingPersona.evidence.quotes.length) {
        blocks.push({ type: 'heading', level: 3, text: '原文证据' });
        readingPersona.evidence.quotes.forEach((quote) => {
          blocks.push({ type: 'quote', text: quote.text, src: '—— 《' + (quote.title || '未命名') + '》' + (quote.at ? (' · ' + personaYear(quote.at)) : '') });
        });
      }
      if (readingPersona.words) {
        const words = readingPersona.words;
        blocks.push({ type: 'heading', level: 3, text: '词语分析' });
        blocks.push({ type: 'heading', level: 4, text: '高频词 TOP' + words.top.length });
        blocks.push({ type: 'table', head: ['排名', '词语', '频次'], num: [0, 2], rows: words.top.map((item, index) => [(index + 1) + '', item.word, item.count + ' 次']) });
        blocks.push({ type: 'chips', items: [
          { label: '正向', value: words.emotion.posPct + '%' },
          { label: '中性', value: words.emotion.neuPct + '%' },
          { label: '负向', value: words.emotion.negPct + '%' },
        ]});
        if (words.catchphrase) {
          blocks.push({ type: 'quote', text: words.catchphrase.text, src: '你的口头禅' + (words.catchphrase.title ? ' —— 《' + words.catchphrase.title + '》' : '') });
        }
        if (words.themes.length) {
          blocks.push({ type: 'chips', items: words.themes.map((item) => ({ label: item.name, value: item.count + '' })) });
        }
      }
      blocks.push({ type: 'note', text: '声明：以上为基于你的阅读行为数据生成的趣味性参考画像，参考了 MBTI 的四维结构，不是心理测评，也不构成专业性格鉴定。' });
    } else if (readingPersona.reason === 'data') {
      const progress = readingPersona.progress || {};
      blocks.push({ type: 'heading', level: 2, text: '十五、阅读人格（读书人版）' });
      blocks.push({ type: 'empty', text: '还差一点数据：你目前约 ' + progress.hours + ' 小时、' + progress.notes + ' 条笔记；累计达到 ' + progress.needHours + ' 小时且 ' + progress.needNotes + ' 条笔记，就能生成「读书人版」人格卡与词语分析。' });
    }

    // 附录：数据说明
    blocks.push({ type: 'heading', level: 2, text: '附录：数据说明' });
    blocks.push({ type: 'list', items: [
      '数据采集：微信读书官方 Agent Skill —— /readdata/detail（mode=' + currentMode + '，按时段统计）' +
        (shelf ? '、/shelf/sync（书架）' : '') +
        (notebooks ? '、/user/notebooks（笔记概览）' : '') +
        '；skill_version ' + (keyStatus.skillVersion || '1.0.4') + '。',
      '时长口径：官方所有时长字段单位为秒，本报告已转为可读文案。',
      '分桶口径：官方按「中国时区零点」划分统计单元并编码为 UTC 秒，本报告已按中国时区展示日期。',
      '自然日均：「分母」是自然日，非阅读天数，故数值偏小属正常。',
      '环比：官方仅对当前周期返回 compare，其它周期显示「—」。',
      '书架口径：书架条目 = 电子书 + 专辑/有声书 +（有文章收藏入口时 +1）；文章收藏入口固定计入私密阅读；分类分布按电子书「分类」字段聚合。',
      '笔记口径：笔记数 = 想法/点评(reviewCount) + 划线(noteCount) + 书签(bookmarkCount)；书签只统计数量、不含内容；「笔记密度」的平均每本分母为「有笔记的书数」（非书架全部书）。',
      '偏好字段：preferCategory / preferAuthor / preferPublisher / preferCp / preferTime 由官方按各周期可得性返回，缺失即不展示对应小节。',
      '建议口径：「十四、阅读规律与建议」为固定规则模板（事实句 + 温和建议），只用本报告已有指标，不编造数据、不下绝对化结论、不含健康/医疗类建议；未配置 AI 时同样生成。',
      '分析边界：本报告为基于官方统计与偏好字段的规则化解读；「阅读人格画像」的客观标签为按固定阈值的类型归类，「人性化人格分析」为 DeepSeek AI 参考性解读，均不构成性格、价值观等主观判断或专业鉴定。',
      '分析口径：「一、执行摘要」与「人性化人格分析」固定基于累计（总体）数据（mode=overall），不随上方周期切换变化；正文各章节按所选周期统计。',
      '隐私：报告在浏览器本机生成，数据不上传；API Key 仅保存在本机。',
    ]});
    blocks.push({ type: 'heading', level: 3, text: '尚未覆盖的章节' });
    blocks.push({ type: 'list', items: [
      '想法与划线深度解读（需接入 /review/list/mine、/book/bestbookmarks 的原文内容）',
      '价值取向与精神底色（主观语义层面，已由「十三、阅读人格画像」中的 AI 人性化人格分析提供参考性解读）',
    ]});
    return blocks;
  }

  // ---------- 渲染器 ----------

  // ---------- Canvas 图表（原生 Canvas，零依赖；面板与导出 HTML 共用） ----------
  // 自包含：不依赖任何闭包变量 / 外部函数，可被 toString() 序列化进导出 HTML。
  function drawCharts(container) {
    if (!container || !container.querySelectorAll) {
      return;
    }
    const COLORS = { accent: '#07c160', soft: '#e8f8ef', line: '#e8ebe9', ink: '#1f2328', ink2: '#5b6570' };
    const nodes = container.querySelectorAll('.wre-chart');
    if (!nodes.length) {
      return;
    }

    function setup(canvas, w, h) {
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      canvas.style.display = 'block';
      const ctx = canvas.getContext('2d');
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      return ctx;
    }

    function shortDur(sec) {
      sec = Number(sec) || 0;
      if (sec >= 3600) {
        return (sec / 3600).toFixed(sec >= 36000 ? 0 : 1) + 'h';
      }
      if (sec >= 60) {
        return Math.round(sec / 60) + 'm';
      }
      return sec + 's';
    }

    function maxOf(values) {
      let m = 0;
      (values || []).forEach((v) => { m = Math.max(m, Number(v) || 0); });
      return m;
    }

    function font(size, weight) {
      return (weight || '') + ' ' + size + 'px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif';
    }

    function drawLine(canvas, data, w) {
      const h = 180;
      const padL = 46, padR = 14, padT = 16, padB = 26;
      const iw = Math.max(1, w - padL - padR);
      const ih = h - padT - padB;
      const values = (data.values || []).map((v) => Number(v) || 0);
      const labels = data.labels || [];
      const max = Math.max(1, maxOf(values));
      const ctx = setup(canvas, w, h);
      ctx.strokeStyle = COLORS.line;
      ctx.fillStyle = COLORS.ink2;
      ctx.font = font(10);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      for (let i = 0; i <= 2; i++) {
        const y = padT + ih - (ih * i / 2);
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(w - padR, y);
        ctx.stroke();
        ctx.fillText(shortDur(max * i / 2), padL - 6, y);
      }
      const step = values.length > 1 ? iw / (values.length - 1) : iw;
      const points = values.map((v, idx) => ({ x: padL + step * idx, y: padT + ih - (ih * v / max) }));
      if (points.length) {
        ctx.beginPath();
        ctx.moveTo(padL, padT + ih);
        points.forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.lineTo(points[points.length - 1].x, padT + ih);
        ctx.closePath();
        ctx.fillStyle = 'rgba(7,193,96,.10)';
        ctx.fill();
        ctx.beginPath();
        points.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.strokeStyle = COLORS.accent;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();
        points.forEach((p) => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.strokeStyle = COLORS.accent;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        });
      }
      ctx.fillStyle = COLORS.ink2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const labelStep = Math.max(1, Math.ceil(labels.length / 6));
      labels.forEach((lb, idx) => {
        if (idx % labelStep === 0) {
          ctx.fillText(lb, padL + step * idx, padT + ih + 7);
        }
      });
    }

    function drawHbar(canvas, data, w) {
      const labels = data.labels || [];
      const values = (data.values || []).map((v) => Number(v) || 0);
      const rowH = 30;
      const padL = 92, padR = 48, padT = 8, padB = 8;
      const h = padT + padB + rowH * labels.length;
      const ctx = setup(canvas, w, h);
      const max = Math.max(1, maxOf(values));
      const barW = Math.max(1, w - padL - padR);
      ctx.font = font(12);
      labels.forEach((lb, idx) => {
        const y = padT + rowH * idx;
        const v = values[idx] || 0;
        const label = String(lb || '').length > 6 ? String(lb).slice(0, 6) + '…' : String(lb || '');
        ctx.fillStyle = COLORS.ink;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 0, y + rowH / 2);
        ctx.fillStyle = COLORS.line;
        ctx.fillRect(padL, y + 8, barW, 12);
        const bw = barW * (v / max);
        if (bw > 0) {
          ctx.fillStyle = COLORS.accent;
          ctx.fillRect(padL, y + 8, bw, 12);
        }
        ctx.fillStyle = COLORS.ink2;
        ctx.textAlign = 'left';
        ctx.fillText(shortDur(v), padL + barW + 8, y + rowH / 2);
      });
    }

    function drawHeatmap(canvas, data, w) {
      const hours = data.hours || [];
      const values = (data.values || []).map((v) => Number(v) || 0);
      const cols = 6;
      const rows = Math.max(1, Math.ceil(hours.length / cols));
      const cellH = 32;
      const blockH = 16;
      const gap = 3;
      const h = 4 + cellH * rows;
      const ctx = setup(canvas, w, h);
      const max = Math.max(1, maxOf(values));
      const cellW = (w - gap * (cols - 1)) / cols;
      ctx.font = font(10);
      hours.forEach((hour, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const x = col * (cellW + gap);
        const y = 4 + row * cellH;
        const v = values[idx] || 0;
        const alpha = v > 0 ? 0.15 + 0.85 * (v / max) : 0.06;
        ctx.fillStyle = 'rgba(7,193,96,' + alpha.toFixed(3) + ')';
        ctx.fillRect(x, y, cellW, blockH);
        ctx.fillStyle = v > 0 ? '#0a5c30' : COLORS.ink2;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((hour < 10 ? '0' : '') + hour, x + cellW / 2, y + blockH + 10);
      });
    }

    function drawDonut(canvas, data) {
      const size = 150;
      const ctx = setup(canvas, size, size);
      const cx = size / 2;
      const cy = size / 2;
      const r = 56;
      const finished = Number(data.finished) || 0;
      const reading = Number(data.reading) || 0;
      const total = finished + reading;
      ctx.clearRect(0, 0, size, size);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.soft;
      ctx.lineWidth = 18;
      ctx.stroke();
      if (total > 0) {
        const ang = (finished / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + ang);
        ctx.strokeStyle = COLORS.accent;
        ctx.lineWidth = 18;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      ctx.fillStyle = COLORS.ink;
      ctx.font = font(22, '700');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(total ? Math.round((finished / total) * 100) + '%' : '0%', cx, cy - 6);
      ctx.fillStyle = COLORS.ink2;
      ctx.font = font(11);
      ctx.fillText('完读率', cx, cy + 20);
    }

    nodes.forEach((node) => {
      const kind = node.getAttribute('data-kind');
      const w = node.clientWidth || 560;
      let payload = {};
      try {
        payload = JSON.parse(node.getAttribute('data-payload') || '{}');
      } catch (err) {
        payload = {};
      }
      const canvas = document.createElement('canvas');
      canvas.className = 'wre-chart-canvas';
      node.appendChild(canvas);
      if (kind === 'line') {
        drawLine(canvas, payload, w);
      } else if (kind === 'hbar') {
        drawHbar(canvas, payload, w);
      } else if (kind === 'heatmap') {
        drawHeatmap(canvas, payload, w);
      } else if (kind === 'donut') {
        drawDonut(canvas, payload);
      }
    });
  }

  // 导出 HTML 置顶人格卡（自包含；样式见 reportStyles）
  function buildPersonaExportCardHtml(persona) {
    const family = (persona.dims[0].available ? persona.dims[0].side : 'D') + (persona.dims[1].available ? persona.dims[1].side : 'F');
    const nicks = persona.nicknames.map((name) => '<span class="chip">' + escapeHtml(name) + '</span>').join('');
    const dims = persona.dims.map((dim) => {
      if (!dim.available) {
        return '<div class="pdim is-na"><div class="pdim-top"><span>' + escapeHtml(dim.left.label) +
          '</span><span class="pdim-pct">—</span><span>' + escapeHtml(dim.right.label) + '</span></div>' +
          '<div class="pdim-track is-na"></div><div class="pdim-basis">' + escapeHtml(dim.basis || '数据还不够') + '</div></div>';
      }
      const leftPct = dim.leftPct;
      return '<div class="pdim' + (dim.centered ? ' is-center' : '') + '">' +
        '<div class="pdim-top"><span>' + escapeHtml(dim.left.label) + ' ' + leftPct + '%</span><span>' +
          (100 - leftPct) + '% ' + escapeHtml(dim.right.label) + '</span></div>' +
        '<div class="pdim-track"><i style="width:' + leftPct + '%"></i></div>' +
        '<div class="pdim-basis">依据：' + escapeHtml(dim.basis || '') + (dim.centered ? '（居中）' : '') + '</div></div>';
    }).join('');
    const oneLiner = persona.oneLiner ? '<p class="persona-oneliner">' + escapeHtml(persona.oneLiner) + '</p>' : '';
    const ai = persona.aiText ? '<p class="p">' + escapeHtml(persona.aiText) + '</p>' : '';
    const figure = PERSONA_FIGURES[persona.code];
    const figureHtml = (figure && personaFigureSvg(persona.code))
      ? '<div class="persona-figure" title="代表人物 · ' + escapeHtml(figure.name) + '">' +
          personaFigureSvg(persona.code) +
          '<div class="persona-figure-name">' + escapeHtml(figure.name) + '</div>' +
        '</div>'
      : '';
    return '<section class="persona-card" data-family="' + escapeHtml(family) + '">' +
      '<div class="persona-head">' +
        '<div class="persona-code">' + escapeHtml(persona.code) + '</div>' +
        '<div><div class="persona-name">' + escapeHtml(persona.name) + '</div>' +
        '<div class="persona-tagline">' + escapeHtml(persona.tagline) + '</div></div>' +
        figureHtml +
      '</div>' +
      (nicks ? '<div class="chips">' + nicks + '</div>' : '') +
      oneLiner + ai +
      '<div class="persona-dims">' + dims + '</div>' +
      '<div class="note">声明：基于你的阅读行为数据生成的趣味性参考画像，参考了 MBTI 的四维结构，不是心理测评，也不构成专业性格鉴定。</div>' +
    '</section>';
  }

  function renderMarkdownModel(model) {
    const lines = [];
    model.forEach((block) => {
      if (block.type === 'heading') {
        lines.push('#'.repeat(block.level) + ' ' + mdCell(block.text), '');
      } else if (block.type === 'paragraph') {
        lines.push(mdCell(block.text), '');
      } else if (block.type === 'callout' || block.type === 'note') {
        lines.push('> ' + mdCell(block.text), '');
      } else if (block.type === 'empty') {
        lines.push('（' + mdCell(block.text) + '）', '');
      } else if (block.type === 'cards') {
        lines.push('| 指标 | 数值 |', '| --- | --- |');
        block.items.forEach((item) => lines.push('| ' + mdCell(item.label) + ' | ' + mdCell(item.value) + ' |'));
        lines.push('');
      } else if (block.type === 'chips') {
        lines.push(block.items.map((item) => '**' + mdCell(item.label) + '** ' + mdCell(item.value)).join(' ｜ '), '');
      } else if (block.type === 'list') {
        block.items.forEach((item, index) => {
          lines.push((block.ordered ? (index + 1) + '. ' : '- ') + mdCell(item));
        });
        lines.push('');
      } else if (block.type === 'kv') {
        lines.push('| 项目 | 内容 |', '| --- | --- |');
        block.rows.forEach((row) => lines.push('| ' + mdCell(row[0]) + ' | ' + mdCell(row[1]) + ' |'));
        lines.push('');
      } else if (block.type === 'table') {
        lines.push('| ' + block.head.map(mdCell).join(' | ') + ' |');
        lines.push('| ' + block.head.map(() => '---').join(' | ') + ' |');
        block.rows.forEach((row) => lines.push('| ' + row.map(mdCell).join(' | ') + ' |'));
        lines.push('');
      } else if (block.type === 'quote') {
        lines.push('> ' + mdCell(block.text));
        if (block.src) {
          lines.push('> ' + mdCell(block.src));
        }
        lines.push('');
      }
    });
    return lines.join('\n');
  }

  function renderHtmlBlock(block) {
    if (block.type === 'personaCard') {
      return buildPersonaExportCardHtml(block.persona);
    }
    if (block.type === 'heading') {
      let tag = 'h2';
      let cls = 'sec';
      if (block.level === 3) {
        tag = 'h3';
        cls = 'sub';
      } else if (block.level >= 4) {
        tag = 'h4';
        cls = 'sub2';
      }
      let text = escapeHtml(block.text);
      // 分点编号高亮：「第一、」「第二、」等序号用强调色突出
      if (block.level >= 4) {
        const m = text.match(/^(第[一二三四五六七八九十百]+[、，.:：])/);
        if (m) {
          text = '<span class="idx">' + m[1] + '</span>' + text.slice(m[1].length);
        }
      }
      return '<' + tag + ' class="' + cls + '">' + text + '</' + tag + '>';
    }
    if (block.type === 'paragraph') {
      return '<p class="p">' + escapeHtml(block.text) + '</p>';
    }
    if (block.type === 'callout') {
      return '<div class="callout">' + escapeHtml(block.text) + '</div>';
    }
    if (block.type === 'note') {
      return '<div class="note">' + escapeHtml(block.text) + '</div>';
    }
    if (block.type === 'empty') {
      return '<div class="empty">' + escapeHtml(block.text) + '</div>';
    }
    if (block.type === 'cards') {
      return '<div class="cards">' + block.items.map((item) =>
        '<div class="card"><div class="label">' + escapeHtml(item.label) + '</div>' +
        '<div class="value">' + escapeHtml(item.value) + '</div></div>'
      ).join('') + '</div>';
    }
    if (block.type === 'chips') {
      return '<div class="chips">' + block.items.map((item) =>
        '<span class="chip">' + escapeHtml(item.label) + ' <b>' + escapeHtml(item.value) + '</b></span>'
      ).join('') + '</div>';
    }
    if (block.type === 'list') {
      const tag = block.ordered ? 'ol' : 'ul';
      return '<' + tag + ' class="list">' + block.items.map((item) =>
        '<li>' + escapeHtml(item) + '</li>'
      ).join('') + '</' + tag + '>';
    }
    if (block.type === 'kv') {
      return '<table class="kv"><tbody>' + block.rows.map((row) =>
        '<tr><th>' + escapeHtml(row[0]) + '</th><td>' + escapeHtml(row[1]) + '</td></tr>'
      ).join('') + '</tbody></table>';
    }
    if (block.type === 'table') {
      const bar = block.bar || null;
      const isNum = (index) => Array.isArray(block.num) && block.num.indexOf(index) >= 0;
      const head = block.head.map((cell, index) => {
        const extra = (bar && index === bar.after) ? '<th class="bar-th"></th>' : '';
        return '<th' + (isNum(index) ? ' class="num"' : '') + '>' + escapeHtml(cell) + '</th>' + extra;
      }).join('');
      const body = block.rows.map((row, rowIndex) => {
        const cells = row.map((cell, index) => {
          const extra = (bar && index === bar.after)
            ? '<td class="bar-td"><div class="bar"><i style="width:' +
              Math.max(2, Math.round(((Number(bar.values[rowIndex]) || 0) / (bar.max || 1)) * 100)) + '%"></i></div></td>'
            : '';
          return '<td' + (isNum(index) ? ' class="num"' : '') + '>' + escapeHtml(cell) + '</td>' + extra;
        }).join('');
        return '<tr>' + cells + '</tr>';
      }).join('');
      return '<table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
    }
    if (block.type === 'quote') {
      return '<blockquote class="quote">' + escapeHtml(block.text) +
        (block.src ? '<div class="quote-src">' + escapeHtml(block.src) + '</div>' : '') + '</blockquote>';
    }
    if (block.type === 'chart') {
      return '<div class="wre-chart" data-kind="' + escapeHtml(block.kind) + '" data-payload="' +
        escapeHtml(JSON.stringify(block.payload || {})) + '"></div>';
    }
    return '';
  }

  function buildStandaloneHtml() {
    const model = buildReportModel(report || {}, mode, overview, { personaTop: true });
    const exportedAt = fmtDateTime(Date.now());
    const source = reportFromCache
      ? '数据来自 ' + fmtDateTime(reportAt) + ' 的本地缓存'
      : '数据于 ' + fmtDateTime(reportAt) + ' 拉取';
    const upgradeBanner = upgradeInfo
      ? '<div class="warn">⚠️ 官方提示需要升级 skill：' +
        escapeHtml(upgradeInfo.message || upgradeInfo.skill_version || '请更新到最新版') +
        '<a href="https://cdn.weread.qq.com/skills/weread-skills.zip" target="_blank" rel="noreferrer">下载官方 skill 包</a></div>'
      : '';
    return [
      '<!DOCTYPE html>',
      '<html lang="zh-CN">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<title>微信悦读 · 阅读行为报告（' + escapeHtml(modeLabel(mode)) + '）</title>',
      '<style>' + reportStyles() + '</style>',
      '</head>',
      '<body>',
      '<div class="page">',
      '  <header class="hero">',
      '    <div>',
      '      <h1>阅读行为报告</h1>',
      '      <p class="sub">微信悦读 · weread-enhancer · ' + escapeHtml(modeLabel(mode)) + '</p>',
      '    </div>',
      '    <div class="meta">导出时间<strong>' + escapeHtml(exportedAt) + '</strong></div>',
      '  </header>',
      upgradeBanner,
      model.map(renderHtmlBlock).join('\n'),
      '  <footer class="foot">',
      '    <div>' + escapeHtml(source) + '。</div>',
      '    <div>本报告基于微信读书官方数据在本机生成，分析为规则化解读，仅供参考。</div>',
      '  </footer>',
      '</div>',
      '<button class="print-btn no-print" id="wre-off-report-print">打印 / 另存为 PDF</button>',
      '<script>(' + drawCharts.toString() + ')(document.body);</script>',
      '</body>',
      '</html>',
    ].join('\n');
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function stampSuffix() {
    const today = new Date();
    return today.getFullYear() + pad2(today.getMonth() + 1) + pad2(today.getDate());
  }

  function exportMarkdown() {
    if (!report) {
      return;
    }
    const filename = '微信悦读-阅读行为报告-' + mode + '-' + stampSuffix() + '.md';
    downloadFile(filename, renderMarkdownModel(buildReportModel(report, mode, overview)), 'text/markdown;charset=utf-8');
    logOfficial('info', '已导出报告', { format: 'markdown', mode: mode, filename: filename });
  }

  function exportHtml() {
    if (!report) {
      return;
    }
    const filename = '微信悦读-阅读行为报告-' + mode + '-' + stampSuffix() + '.html';
    downloadFile(filename, buildStandaloneHtml(), 'text/html;charset=utf-8');
    logOfficial('info', '已导出报告', { format: 'html', mode: mode, filename: filename });
  }

  function exportPdf() {
    if (!report) {
      return;
    }
    if (!openReportForPrint(buildStandaloneHtml())) {
      return;
    }
    logOfficial('info', '已打开打印视图（可另存为 PDF）', { mode: mode });
  }

  async function handleExport(format) {
    if (reportState !== 'ok' || !report) {
      logOfficial('warn', '报告未就绪，忽略导出请求', { format: format });
      return;
    }
    // AI 解读改为手动触发（点「生成 AI 解读」按钮），导出时不再自动消耗 DeepSeek token。
    if (format === 'html') {
      exportHtml();
    } else if (format === 'pdf') {
      exportPdf();
    } else {
      exportMarkdown();
    }
  }

  // ---------- HTML 报告样式（自包含，可下载 / 可打印成 PDF） ----------

  function reportStyles() {
    return [
      ':root{--accent:#07c160;--accent-soft:#e8f8ef;--ink:#1f2328;--ink-2:#5b6570;--line:#e8ebe9;--bg:#f4f6f5;--warn:#b8860b}',
      '*{box-sizing:border-box}',
      'html,body{margin:0;padding:0}',
      'body{background:var(--bg);color:var(--ink);font:14px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
      '.page{max-width:840px;margin:32px auto;padding:40px 44px;background:#fff;border-radius:18px;box-shadow:0 12px 32px rgba(17,24,28,.08)}',
      '.hero{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding-bottom:22px;border-bottom:2px solid var(--line)}',
      '.hero h1{margin:0;font-size:26px;letter-spacing:.5px}',
      '.hero h1::before{content:"";display:inline-block;width:10px;height:24px;margin-right:10px;border-radius:3px;background:var(--accent);vertical-align:-3px}',
      '.hero .sub{margin:6px 0 0;font-size:12px;color:var(--ink-2)}',
      '.hero .meta{text-align:right;font-size:12px;color:var(--ink-2);white-space:nowrap}',
      '.hero .meta strong{display:block;margin-top:2px;font-size:14px;color:var(--ink)}',
      'h2.sec{margin:34px 0 14px;font-size:16px;font-weight:700;letter-spacing:.3px;padding-left:12px;border-left:4px solid var(--accent)}',
      'h3.sub{margin:22px 0 10px;font-size:14px;font-weight:600}',
      'h4.sub2{margin:16px 0 6px;padding-left:10px;border-left:3px solid var(--accent);font-size:14px;font-weight:700;color:var(--ink)}',
      'h4.sub2 .idx{color:var(--accent)}',
      '.p{margin:0 0 12px;text-indent:2em}',
      '.callout{margin:12px 0;padding:10px 14px;border-left:3px solid var(--accent);background:var(--accent-soft);border-radius:0 10px 10px 0;font-size:13px}',
      '.note{margin:10px 0;font-size:12px;color:var(--ink-2)}',
      '.list{margin:0 0 12px;padding-left:2em}',
      '.list li{margin-bottom:6px;break-inside:avoid}',
      '.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:14px 0}',
      '.card{padding:16px 18px;border-radius:14px;background:var(--accent-soft);border-left:4px solid var(--accent)}',
      '.card .label{font-size:12px;color:var(--ink-2)}',
      '.card .value{margin-top:8px;font-size:20px;font-weight:700;letter-spacing:.3px}',
      '.chips{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}',
      '.chip{padding:4px 12px;border:1px solid var(--line);border-radius:999px;font-size:12px;color:var(--ink-2)}',
      '.chip b{color:var(--accent)}',
      '.warn{margin:16px 0;padding:12px 14px;border:1px dashed var(--warn);border-radius:12px;font-size:12px}',
      '.warn a{margin-left:6px;color:var(--accent)}',
      'table{width:100%;border-collapse:collapse;font-size:13px;margin:0 0 14px}',
      'th,td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:middle}',
      'th{font-size:12px;font-weight:600;color:var(--ink-2);background:#fafbfa}',
      'tbody tr:nth-child(even){background:#f6f8f7}',
      'td.num,th.num{text-align:right;white-space:nowrap}',
      'table.kv{margin-bottom:22px}',
      'table.kv th{width:110px;font-weight:600;background:transparent;color:var(--ink-2);white-space:nowrap}',
      'th.bar-th,td.bar-td{width:34%}',
      '.bar{height:8px;border-radius:4px;background:var(--line);overflow:hidden}',
      '.bar i{display:block;height:100%;border-radius:4px;background:var(--accent)}',
      '.empty{padding:18px;font-size:13px;color:var(--ink-2);background:#fafbfa;border:1px dashed var(--line);border-radius:10px}',
      '.quote{margin:12px 0;padding:10px 16px;border-left:3px solid var(--accent);background:#fafbfa;border-radius:0 10px 10px 0;font-size:13px;break-inside:avoid}',
      '.quote-src{margin-top:6px;font-size:12px;color:var(--ink-2)}',
      '.persona-card{margin:20px 0 26px;padding:22px 24px;border:1px solid var(--line);border-radius:16px;background:var(--accent-soft);break-inside:avoid}',
      '.persona-head{display:flex;align-items:center;gap:16px}',
      '.persona-figure{flex:0 0 auto;width:88px;margin-left:auto;text-align:center;color:var(--ink)}',
      '.persona-figure svg{display:block;width:88px;height:88px}',
      '.persona-figure-name{margin-top:2px;font-size:12px;line-height:1.2;color:var(--ink-2)}',
      '.persona-code{padding:10px 14px;border-radius:12px;background:var(--accent);color:#fff;font-size:26px;font-weight:700;letter-spacing:2px}',
      '.persona-name{font-size:18px;font-weight:700}',
      '.persona-tagline{margin-top:2px;font-size:12px;color:var(--ink-2)}',
      '.persona-oneliner{margin:14px 0 0;padding:10px 14px;border-left:3px solid var(--accent);background:#fff;border-radius:0 10px 10px 0;font-size:13px}',
      '.persona-dims{margin-top:14px}',
      '.pdim{margin-top:10px}',
      '.pdim-top{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--ink)}',
      '.pdim-pct{color:var(--ink-2)}',
      '.pdim-track{height:8px;margin-top:4px;border-radius:999px;background:var(--line);overflow:hidden}',
      '.pdim.is-center .pdim-track{opacity:.45}',
      '.pdim-track i{display:block;height:100%;border-radius:999px;background:var(--accent)}',
      '.pdim-basis{margin-top:3px;font-size:11px;color:var(--ink-2)}',
      '.wre-chart{margin:14px 0;width:100%;break-inside:avoid}',
      '.wre-chart-canvas{display:block;max-width:100%}',
      '.foot{margin-top:34px;padding-top:16px;border-top:1px solid var(--line);font-size:12px;line-height:1.8;color:var(--ink-2)}',
      '.print-btn{position:fixed;right:24px;bottom:24px;padding:12px 20px;border:0;border-radius:999px;background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 8px 20px rgba(7,193,96,.35)}',
      '.print-btn:hover{filter:brightness(1.05)}',
      '@media screen{body{padding-bottom:96px}}',
      '@media (max-width:720px){.page{margin:16px;padding:24px}.cards{grid-template-columns:repeat(2,1fr)}.hero{flex-direction:column;align-items:flex-start}.hero .meta{text-align:left}}',
      '@media print{@page{size:A4;margin:14mm}body{background:#fff}.page{max-width:none;margin:0;padding:0;border-radius:0;box-shadow:none}.no-print{display:none!important}h2.sec,h3.sub,h4.sub2{break-after:avoid}.card,.list li,tr{break-inside:avoid}}',
    ].join('');
  }

  function openReportForPrint(html) {
    const win = window.open('', '_blank');
    if (!win) {
      logOfficial('warn', 'PDF 导出被拦截：浏览器阻止了新窗口，请允许本站弹出窗口后重试');
      return false;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    const printBtn = win.document.getElementById('wre-off-report-print');
    if (printBtn) {
      printBtn.addEventListener('click', () => win.print());
    }
    // 等浏览器完成首帧渲染再唤起打印对话框
    setTimeout(() => {
      try {
        win.print();
      } catch (error) {
        logOfficial('warn', '唤起打印失败，可手动按 Ctrl/Cmd+P', { error: String(error) });
      }
    }, 400);
    return true;
  }

  // ---------- 启动 ----------

  function attach(root) {
    injectMenuEntry(root);
    refreshKeyStatus().then(() => {
      logOfficial('info', '阅读洞察模块已启动', { hasKey: keyStatus.hasKey });
    });
  }

  function bootstrap() {
    // 跨模块跳转：笔记模块遇到「未配置 / Key 失效」时会派发此事件，引导用户到设置页配 Key
    document.addEventListener('wre-open-key-settings', () => {
      settingsMessage = '';
      openKeyPanel();
      logOfficial('info', '收到跨模块跳转请求：打开 API Key 设置面板');
    });

    const existing = document.getElementById('we-read-enhancer-root');
    if (existing) {
      attach(existing);
      return;
    }
    const observer = new MutationObserver(() => {
      const root = document.getElementById('we-read-enhancer-root');
      if (root) {
        observer.disconnect();
        attach(root);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    logOfficial('debug', '等待插件根容器出现后接入阅读洞察模块');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
