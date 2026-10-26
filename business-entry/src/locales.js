/**
 * `business` namespace dictionaries: the sidebar's business-entry group (the
 * group label, its disclosure control, every entry row, its launch status,
 * and the instruction each row sends into the session it starts).
 *
 * Every `prompt.*` value is a complete instruction, not a form: a row sends
 * it as the first user message with nothing else attached, so each one opens
 * by asking for the inputs it needs before it produces the deliverable.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'section.business': '业务入口',
  'section.expand': '展开业务入口',
  'section.collapse': '收起业务入口',
  'item.dailyReport': '今日数据日报',
  'item.topics': '今日选题',
  'item.sentiment': '舆情速览',
  'item.videoScript': '视频脚本',
  'item.report': '报告与汇报',
  'item.multiFormat': '一稿多形态',
  'item.rumor': '谣言识别与辟谣',
  'item.hint': '点击打开该入口的会话；Ctrl/⌘/Alt+点击新开一个',
  'item.history': '历史会话（{count}）',
  'history.new': '＋ 新开一个会话',
  'history.running': '进行中',
  'launch.failed': '业务入口启动失败，点击关闭',
  'launch.dismiss': '点击关闭提示',
  'prompt.dailyReport': '请生成今天的《今日数据日报》。开始前先向我确认三件事：统计日期区间、要覆盖的平台或账号、数据来源（我粘贴数据、上传文件，还是由你按已接入的系统查询）。数据明确后按以下结构产出：一、核心指标概览；二、环比与同比变化；三、分项明细表；四、异常波动及可能原因；五、不超过 3 条下一步行动建议。结论先行；所有数字必须来自我给的数据，缺失项标注「暂缺」，不要估算或编造。',
  'prompt.topics': '请产出今天的选题清单。开始前先向我确认：关注领域、账号定位与目标平台。确认后联网检索过去 24 小时的相关新闻与热点，给出 10 个候选选题，每条包含：拟用标题、一句话切入点、目标读者、热度判断、风险提示；最后推荐 3 个优先选题并说明理由。',
  'prompt.sentiment': '请产出一份舆情速览。开始前先向我确认：监测对象（品牌、人物或事件）与时间范围。确认后联网检索相关信息，输出：一、今日概览（热度走势与整体情感倾向）；二、主要传播渠道与关键节点（引爆点、高互动内容）；三、正面、中性、负面代表性声音各若干条并附来源；四、风险分级与建议应对口径。无法核实的信息标注「待证实」，不要推测。',
  'prompt.videoScript': '请撰写一份视频脚本。开始前先向我确认：主题、时长、发布平台、风格基调，以及可用素材（无、图片或实拍）。确认后输出完整分镜表（镜号、时长、画面描述、口播文案、字幕、备注），开头 3 秒给出钩子，结尾给互动引导；另附 3 个封面标题候选与视频简介文案。',
  'prompt.report': '请撰写一份报告。开始前先向我确认：报告类型（周报、月报、专项汇报或项目总结）、汇报对象、可用素材与篇幅。确认后按「结论先行」的结构产出：一、核心结论；二、关键数据与进展；三、问题与风险；四、下一步计划（含时间点，未知处标「待补充」）。语气专业简洁。',
  'prompt.multiFormat': '请把同一份素材改写为一稿多形态。开始前先向我确认：原始稿件内容与目标平台。确认后保持核心信息一致，产出五种形态：微信公众号长文（标题、导语、小标题结构）；微博短帖（140 字内，带 2–3 个话题标签）；小红书笔记（口语化、短句分段、适量表情）；60 秒短视频口播稿；100 字内新闻快讯。每种形态单独成段并标注适用场景。',
  'prompt.rumor': '请核查以下信息并给出辟谣要点。开始前先向我确认待核查的内容（原文、链接或截图描述）。确认后联网检索权威信源（官方发布、主流媒体、专业机构）逐条核查，输出：一、核查结论（属实、部分属实、不实或证据不足）；二、关键事实比对表（原说法对照权威来源，附来源）；三、溯源与传播情况简述；四、一段可直接发布的辟谣文案（通俗、克制、注明来源）。',
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'section.business': 'Business',
  'section.expand': 'Expand business entries',
  'section.collapse': 'Collapse business entries',
  'item.dailyReport': 'Daily Data Report',
  'item.topics': 'Today’s Topics',
  'item.sentiment': 'Public Sentiment Briefing',
  'item.videoScript': 'Video Script',
  'item.report': 'Reports and Briefings',
  'item.multiFormat': 'One Draft, Many Formats',
  'item.rumor': 'Rumor Detection and Debunking',
  'item.hint': 'Open this entry’s conversation; Ctrl/⌘/Alt+click starts a new one',
  'item.history': 'Past conversations ({count})',
  'history.new': '+ Start a new conversation',
  'history.running': 'Running',
  'launch.failed': 'This business entry could not start — click to dismiss',
  'launch.dismiss': 'Click to dismiss',
  'prompt.dailyReport': 'Generate today’s daily data report. First confirm three things with me: the reporting period, the platforms or accounts to cover, and the data source (I paste data, upload files, or you query the systems already connected). Once the data is settled, produce: 1) key metrics overview; 2) day-over-day and year-over-year changes; 3) a per-metric detail table; 4) anomalies with likely causes; 5) at most 3 next-step recommendations. Lead with conclusions; every number must come from the data I gave you — mark missing values “unavailable” rather than estimating or inventing them.',
  'prompt.topics': 'Produce today’s story topics. First confirm with me: the beat, the outlet’s positioning, and the target platform. Then search the past 24 hours of news and trends and propose 10 candidate topics, each with a working headline, one-line angle, target audience, heat assessment, and risk note; finish by recommending 3 priorities with reasons.',
  'prompt.sentiment': 'Produce a public-sentiment briefing. First confirm with me: the subject (brand, person, or event) and the time window. Then search the web and report: 1) today’s overview (heat trajectory and overall tone); 2) main channels and key nodes (flashpoints, high-engagement posts); 3) representative positive, neutral, and negative voices with sources; 4) a risk level and recommended response lines. Mark anything unverifiable “unconfirmed” rather than speculating.',
  'prompt.videoScript': 'Write a video script. First confirm with me: topic, duration, platform, tone, and available footage (none, images, or live shots). Then deliver a full shot list (shot number, duration, visuals, voice-over, on-screen text, notes) with a hook in the first 3 seconds and a closing call to action, plus 3 candidate thumbnail titles and the video description.',
  'prompt.report': 'Write a report. First confirm with me: the kind (weekly, monthly, special briefing, or project recap), the audience, the available material, and the length. Then lead with the conclusion and cover: 1) key conclusion; 2) key data and progress; 3) problems and risks; 4) next steps with dates (leave unknown dates “TBD”). Keep the tone professional and concise.',
  'prompt.multiFormat': 'Rewrite one source into many formats. First confirm with me: the source text and the target platforms. Then keep the core facts identical and produce five versions: a WeChat official-account long read (title, standfirst, subheads); a Weibo short post (under 140 characters, 2–3 hashtags); a Xiaohongshu note (conversational, short paragraphs, sparing emoji); a 60-second short-video voice-over; and a news flash under 100 characters. Keep each version in its own section and label where it fits.',
  'prompt.rumor': 'Fact-check the following claim and draft debunking points. First confirm with me what to check (the text, a link, or a description of the screenshot). Then search authoritative sources (official releases, major outlets, specialist bodies) and verify point by point, delivering: 1) a verdict (true, partly true, false, or insufficient evidence); 2) a fact-comparison table (claim versus authoritative account, with sources); 3) a brief note on origin and spread; 4) a publishable debunking paragraph (plain, restrained, with sources).',
}
