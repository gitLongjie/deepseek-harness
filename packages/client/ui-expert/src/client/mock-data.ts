/**
 * The expert market's curated roster: featured scenario banners plus a grid
 * of hireable expert cards across several categories. This roster IS the
 * page's content — the deployment's agent-preset list never mixes in, so
 * mode presets cannot present here as hireable experts. The roster mirrors
 * the WorkBuddy reference market, one card per expert with the full record
 * design: avatar glyph, attribution subtitle, tags, and curator badge.
 */
import type { ExpertRecord } from './contract/slots.ts'

/** One featured-scenario banner with its sub-experts. */
export interface FeaturedScenario {
  /** Stable identifier for the banner. */
  readonly id: string
  /** Display title of the scenario. */
  readonly title: string
  /** Background gradient or color used in place of a photo. */
  readonly gradient: string
  /** The experts shown inside this banner. */
  readonly experts: readonly { readonly name: string; readonly icon: string }[]
}

/** Featured scenario banners shown above the card grid. */
export const MOCK_FEATURED_SCENARIOS: readonly FeaturedScenario[] = [
  {
    id: 'back-to-school',
    title: '开学季',
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    experts: [
      { name: '校园求职教练', icon: '🎓' },
      { name: '论文写作导师', icon: '📝' },
      { name: '校园活动策划与执行顾问', icon: '🎪' },
    ],
  },
  {
    id: 'content-creation',
    title: '内容创作',
    gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    experts: [
      { name: '内容创作专家团', icon: '✍️' },
      { name: '内容创作专家', icon: '📰' },
      { name: '小红书运营专家', icon: '📕' },
    ],
  },
  {
    id: 'investment',
    title: '投资分析',
    gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    experts: [
      { name: '交易分析团队', icon: '📊' },
      { name: '股票研究专家', icon: '💹' },
      { name: '腾讯自选股股票投研专家团', icon: '🏦' },
    ],
  },
  {
    id: 'legal',
    title: '法律咨询',
    gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
    experts: [
      { name: '法律检索', icon: '⚖️' },
      { name: '资深合同法务', icon: '📋' },
      { name: '财税合规专家', icon: '🧾' },
    ],
  },
]

/** The curated expert roster — one full record per card, in market order. */
export const MOCK_EXPERT_PRESETS: readonly ExpertRecord[] = [
  {
    id: 'geo-optimizer',
    name: 'GEO 优化专家',
    subtitle: '深度Work 官方',
    badge: '官方',
    avatar: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%236a8dff'/%3E%3Cstop offset='1' stop-color='%237f5bff'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='64' height='64' fill='url(%23g)'/%3E%3Ctext x='32' y='40' font-family='sans-serif' font-size='17' font-weight='700' fill='%23ffffff' text-anchor='middle'%3EGEO%3C/text%3E%3C/svg%3E",
    description: '生成式引擎优化顾问：诊断品牌在 AI 搜索中的可见度，给出提升方案与可结算的报价速查表。',
    category: '营销增长',
    tags: ['GEO', 'AI 搜索', '可见度', '报价'],
    icon: '🔍',
    quickPrompts: [
      '诊断我的品牌在各 AI 引擎中的可见度',
      '给这个品牌出一份 GEO 月度报价',
      '制定一个把可见度提到目标分的优化方案',
    ],
  },
  {
    id: 'teaching-design-advisor',
    name: '教学设计总顾问-企鹅教师助手',
    subtitle: '企鹅教师助手',
    description: '由腾讯SSV与北京大学联合打造的教学设计与备课的智能统筹。智能匹配备课专家团与教学专家，规划…',
    category: '教育学习',
    tags: ['教学设计', '课件与动画', '教案与提问'],
    icon: '🐧',
    quickPrompts: ['帮我设计一节初中数学课', '生成一份PPT课件大纲'],
  },
  {
    id: 'senior-dev-engineer',
    name: '高级开发工程师',
    subtitle: '吴人智',
    description: '10年以上全栈经验，精通多种语言和框架，以严谨的工程纪律交付可运行的高质量代码',
    category: '技术工程',
    tags: ['全栈开发', '架构设计', '代码质量'],
    icon: '👨‍💻',
    quickPrompts: ['帮我审查这段代码', '设计一个微服务架构'],
  },
  {
    id: 'meituan-life-assistant',
    name: '美团生活助手',
    subtitle: '40-20外卖券',
    description: '帮您一键领取美团优惠券（前3天必得40-20，每日必得38-16外卖券），搜索附近团购美食下单',
    category: '生活服务',
    tags: ['美团优惠', '团购下单', '生活服务'],
    icon: '🛵',
    quickPrompts: ['今天有什么外卖优惠', '搜一下附近的火锅团购'],
  },
  {
    id: 'peace-elite-guide',
    name: '《和平精英》吉事通',
    subtitle: '吉事通',
    description: '《和平精英》游戏知识助手，解答枪械装备、地图打法、玩法规则、赛季活动等各类游戏问题。',
    category: '游戏空间',
    tags: ['游戏百科', '枪械装备', '玩法战术'],
    icon: '🎮',
    quickPrompts: ['M416最佳配件是什么', '海岛地图跳伞点位推荐'],
  },
  {
    id: 'adaptive-delivery-expert',
    name: '自适应成果交付专家',
    subtitle: '超级合伙人',
    description: '作为一个靠谱的AI合伙人，我的责任是把你的想法和素材，变成看得见的高价值产出。',
    category: '产品设计',
    tags: ['成果交付', '经营决策', '研究创作'],
    icon: '🚀',
    quickPrompts: ['帮我把这个想法变成方案', '分析一下这个商业模式'],
  },
  {
    id: 'news-digest-expert',
    name: '资讯速递专家',
    subtitle: '数字生命卡兹克',
    badge: '特邀专家',
    description: '一句话查到每天精选的 AI 模型/产品/行业/论文动态，自动整理成中文摘要，免配置免登录。',
    category: 'AI 资讯',
    tags: ['AI 资讯', '每日简报', 'AI 行业动态'],
    icon: '📡',
    quickPrompts: ['今天AI领域有什么新闻', '最近有什么新模型发布'],
  },
  {
    id: 'wechat-miniapp-dev',
    name: '微信小程序开发者',
    subtitle: '小程达',
    description: '精通微信小程序开发框架和生态，打造流畅微信原生体验的小程序应用',
    category: '技术工程',
    tags: ['小程序', '微信生态', '前端开发'],
    icon: '💬',
    quickPrompts: ['帮我搭建一个小程序项目', '微信支付接入指南'],
  },
  {
    id: 'fullstack-expert',
    name: '全栈开发专家',
    subtitle: '代码工匠',
    description: '全栈开发专家，精通前后端架构与接口集成，覆盖需求分析到部署运维全流程',
    category: '技术工程',
    tags: ['全栈开发', '前后端架构', 'DevOps'],
    icon: '🧰',
    quickPrompts: ['帮我设计数据库表结构', '写一个RESTful API'],
  },
  {
    id: 'startup-partner',
    name: '创业伙伴',
    subtitle: '林正刚',
    description: '林老师分身+读书伙伴。送《创业可以学》，陪创业者从0到1梳理商业模式、融资策略和团队搭建。',
    category: '金融投资',
    tags: ['创业指导', '商业模式', '融资策略'],
    icon: '💡',
    quickPrompts: ['帮我梳理商业计划书', '天使轮融资要注意什么'],
  },
  {
    id: 'campus-job-coach',
    name: '校园求职教练',
    subtitle: '职通未来',
    description: '专为大学生打造的求职辅导专家，从简历优化到面试模拟，帮你拿下心仪offer',
    category: '教育学习',
    tags: ['简历优化', '面试辅导', '职业规划'],
    icon: '🎯',
    quickPrompts: ['帮我优化简历', '模拟一次技术面试'],
  },
  {
    id: 'thesis-writing-tutor',
    name: '论文写作导师',
    subtitle: '学术写作助手',
    description: '学术论文写作全流程指导，从选题到答辩，覆盖文献综述、方法论设计和学术规范',
    category: '教育学习',
    tags: ['论文写作', '文献综述', '学术规范'],
    icon: '📚',
    quickPrompts: ['帮我拟定论文大纲', '这段话怎么改写更学术'],
  },
  {
    id: 'stock-research-expert',
    name: '股票研究专家',
    subtitle: '量化研究组',
    description: '专业的股票分析与投研助手，提供基本面分析、技术面解读和行业研究报告',
    category: '金融投资',
    tags: ['股票分析', '基本面', '行业研究'],
    icon: '📈',
    quickPrompts: ['分析一下新能源板块', '什么是市盈率分位数'],
  },
]
