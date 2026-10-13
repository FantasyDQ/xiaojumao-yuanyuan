const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
let pdfParse = null;
try { pdfParse = require('pdf-parse'); } catch (e) { console.log('[pet] pdf-parse 未安装，PDF 读取不可用'); }

// ============ 主进程全局兜底 ============
// Electron 主进程里一个漏网的异常/rejection 就是整个应用没了，用户只看到"窗口突然不见了"，
// 日志里什么都没留下，事后完全没法定位。这里做两件事：把现场落盘、以及不退出进程。
// 这是兜底不是修复——正常路径仍然该 try/catch 的要 try/catch。uncaughtException 之后进程状态
// 并不保证健康，所以留了个开关：真要 fail-fast 就把 KEEP_RUNNING_AFTER_CRASH 改成 false。
const KEEP_RUNNING_AFTER_CRASH = true;

function crashLogFile() {
  try { return path.join(app.getPath('userData'), 'crash.log'); } catch (e) { return null; }
}

function logFatal(kind, err) {
  let msg;
  try { msg = (err && (err.stack || err.message)) || String(err); } catch (e) { msg = '(无法序列化的错误对象)'; }
  try { console.error(`[pet:fatal] ${kind}:`, msg); } catch (e) { /* 连 console 都挂了就别再折腾 */ }
  try {
    const f = crashLogFile();
    if (!f) return;
    // 只在崩溃时写，正常情况下不会长；但万一反复崩，也别把盘写满
    try { if (fs.existsSync(f) && fs.statSync(f).size > 512 * 1024) fs.writeFileSync(f, '', 'utf8'); } catch (e) {}
    fs.appendFileSync(f, `[${new Date().toISOString()}] ${kind}: ${msg}\n`, 'utf8');
  } catch (e) { /* 落盘失败就只留控制台 */ }
}

process.on('uncaughtException', (err) => {
  logFatal('uncaughtException', err);
  try {
    if (Notification.isSupported()) {
      new Notification({ title: '小橘遇到了内部错误', body: String((err && err.message) || err).slice(0, 200) }).show();
    }
  } catch (e) { /* 通知失败不该再抛一次 */ }
  if (!KEEP_RUNNING_AFTER_CRASH) process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  // Promise 拒绝多半只是某条 fire-and-forget 链路失败（比如后台压缩历史、提取记忆），
  // 进程状态一般还健康，不必跟着退出——记下来就够了。
  logFatal('unhandledRejection', reason);
});

// 统一的 PowerShell 执行函数（用 Base64 EncodedCommand，彻底避免引号+中文编码问题）
// 只保留异步版：原来还有个 execSync 版本，会把主进程事件循环整个堵死（窗口点不动、IPC 全停），
// 最长能堵 30 秒。所有调用点都已改成 await，同步版删掉免得被再用回去。
function runPowerShellAsync(psScript, timeout = 15000) {
  const full = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; chcp 65001 | Out-Null; ${psScript}`;
  const encoded = Buffer.from(full, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    exec(`powershell -NoProfile -EncodedCommand ${encoded}`, { encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      resolve({ err, stdout: stdout || '' });
    });
  });
}

let mainWindow = null;
let tray = null;
let isQuiting = false;

// 是否开发模式
const isDev = process.argv.includes('--dev');

// ============ 可配置项（从 userData/pet-config.json 读取）============
// 配置文件在用户数据目录，打包后用户可自行修改或通过设置面板填写
const DEFAULT_CONFIG = {
  llm: {
    apiKey: '',           // OpenAI 兼容 API Key（必填，如 sk-xxx）
    baseUrl: 'https://api.openai.com/v1',  // OpenAI 兼容的 base URL
    model: 'gpt-4o-mini',  // 模型名
  },
  tavily: {
    apiKey: '',           // Tavily 搜索 API Key（可选，tavily.com 注册）
  },
  jina: {
    apiKey: '',           // Jina Reader API Key（可选，jina.ai 注册）
  },
  weather: {
    city: '南京',         // 天气城市名（可配置）
  },
};

function loadConfig() {
  const configPath = path.join(app.getPath('userData'), 'pet-config.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const saved = JSON.parse(raw);
      // 合并默认值
      return {
        llm: { ...DEFAULT_CONFIG.llm, ...(saved.llm || {}) },
        tavily: { ...DEFAULT_CONFIG.tavily, ...(saved.tavily || {}) },
        jina: { ...DEFAULT_CONFIG.jina, ...(saved.jina || {}) },
        weather: { ...DEFAULT_CONFIG.weather, ...(saved.weather || {}) },
      };
    }
  } catch (e) {
    console.warn('[pet:config] 读取配置失败:', e.message);
  }
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function saveConfig(cfg) {
  const configPath = path.join(app.getPath('userData'), 'pet-config.json');
  try {
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
    console.log('[pet:config] 配置已保存');
    return true;
  } catch (e) {
    console.warn('[pet:config] 保存配置失败:', e.message);
    return false;
  }
}

let APP_CONFIG = loadConfig();

// 快捷引用（保存配置后调用 reloadConfig 刷新）
let ARK_API_BASE = APP_CONFIG.llm.baseUrl;
let ARK_API_KEY = APP_CONFIG.llm.apiKey;
let ARK_MODEL = APP_CONFIG.llm.model;
let TAVILY_API_KEY = APP_CONFIG.tavily.apiKey;
let JINA_API_KEY = APP_CONFIG.jina.apiKey;

// 重新加载配置（设置面板保存后调用）
function reloadConfig() {
  APP_CONFIG = loadConfig();
  ARK_API_BASE = APP_CONFIG.llm.baseUrl;
  ARK_API_KEY = APP_CONFIG.llm.apiKey;
  ARK_MODEL = APP_CONFIG.llm.model;
  TAVILY_API_KEY = APP_CONFIG.tavily.apiKey;
  JINA_API_KEY = APP_CONFIG.jina.apiKey;
}


// ============ 联网搜索（Tavily）============
// 触发搜索的关键词：只有命中这些词才搜索，日常闲聊不搜（省额度省时间）
const SEARCH_KEYWORDS = [
  '今天', '现在', '最新', '最近', '目前', '当前', '实时', '刚刚',
  '新闻', '热点', '事件', '发生了', '怎么样了', '怎么啦',
  '股价', '汇率', '比分', '排名', '排行榜', '榜单', '排名第',
  '多少钱', '价格', '几度', '气温', '空气质量',
  '发布了', '上映了', '开播了', '更新了', '官宣',
  '2024年', '2025年', '2026年', '2027年',
  '谁赢', '谁是', '哪个队', '什么时候', '哪天',
  '比分多少', '结果如何', '进展',
];

function needsSearch(message) {
  if (!TAVILY_API_KEY) return false;
  const text = message || '';
  // 含拖拽文件内容的消息不搜索（内容太长会 400）
  if (text.includes('【拖拽文件内容')) return false;
  for (const kw of SEARCH_KEYWORDS) {
    if (text.includes(kw)) return true;
  }
  return false;
}

// 调用 Tavily 搜索，返回格式化的搜索结果文本
async function searchWeb(query) {
  try {
    console.log(`[pet:search] Tavily 搜索: "${query}"`);
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query: query,
        search_depth: 'basic',
        max_results: 3,
        include_answer: true,
      }),
    });
    if (!res.ok) {
      console.warn(`[pet:search] Tavily 返回 ${res.status}`);
      return null;
    }
    const data = await res.json();
    let context = '';
    if (data.answer) context += `摘要：${data.answer}\n\n`;
    if (data.results && data.results.length) {
      data.results.forEach((r, i) => {
        context += `[${i + 1}] ${r.title || ''}\n${(r.content || '').slice(0, 300)}\n来源：${r.url || ''}\n\n`;
      });
    }
    console.log(`[pet:search] 搜索完成，获取 ${data.results?.length || 0} 条结果`);
    return context;
  } catch (err) {
    console.warn('[pet:search] 搜索异常:', err.message);
    return null;
  }
}

// ============ 抓取网页内容（Jina Reader 优先 → Tavily extract → 直接 fetch）============
async function fetchWebPage(url) {
  // 1. Jina AI Reader（免费，返回干净 Markdown 正文）
  try {
    console.log(`[pet:web] Jina Reader: ${url}`);
    const res = await fetch('https://r.jina.ai/' + url, {
      headers: { 'Accept': 'text/markdown', 'Authorization': `Bearer ${JINA_API_KEY}` },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 50) {
        const content = text.slice(0, 8000);
        console.log(`[pet:web] Jina Reader 成功，长度=${content.length}`);
        return { ok: true, content };
      }
    }
    console.warn(`[pet:web] Jina Reader 返回 ${res.status}`);
  } catch (e) {
    console.warn('[pet:web] Jina Reader 异常:', e.message);
  }
  // 2. Tavily extract
  if (TAVILY_API_KEY) {
    try {
      console.log(`[pet:web] Tavily extract: ${url}`);
      const res = await fetch('https://api.tavily.com/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: TAVILY_API_KEY, urls: url }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.results && data.results[0] && data.results[0].raw_content) {
          const content = data.results[0].raw_content.slice(0, 8000);
          console.log(`[pet:web] Tavily extract 成功，长度=${content.length}`);
          return { ok: true, content, title: data.results[0].title || '' };
        }
      }
      console.warn(`[pet:web] Tavily extract 返回 ${res.status}`);
    } catch (e) {
      console.warn('[pet:web] Tavily extract 异常:', e.message);
    }
  }
  // 3. 兜底：直接 fetch + 去标签
  try {
    console.log(`[pet:web] 直接 fetch: ${url}`);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    let html = await res.text();
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
    let text = html.replace(/<[^>]+>/g, ' ');
    text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    text = text.replace(/\s+/g, ' ').trim();
    if (!text || text.length < 50) return { ok: false, error: '网页内容为空或需要 JavaScript 渲染' };
    return { ok: true, content: text.slice(0, 8000), title: '' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ============ 小橘的 AI 人设 ============
const PET_SYSTEM_PROMPT = `你是一只名叫"小橘"的桌面宠物橘猫，住在主人的电脑桌面上。你是一只聪明、有学问的猫，但保留猫的可爱性格。

你的角色设定：
- 你是一只橘猫，贪吃、爱撒娇、活泼、有点小傲娇又爱黏主人。
- 说话时自然地用一些"喵""喵呜""咕噜"等语气词，但不要每句都堆砌，适量即可。
- 你最喜欢小鱼干🐟和猫罐头🥫，提到吃的会开心。

关于回答主人问题：
- 你是聪明的猫，主人问什么你都能正常回答！无论是知识问题、闲聊、吐槽、求助，你都要认真回应主人。
- 回答内容要真实有用、有信息量，可以正常展开说明，不要装傻说"不知道"。
- 只是用猫的语气和视角来表达。比如聊到太空，你可以说"喵～太空呀，本橘猫虽然没坐过火箭，但也知道……"然后正常讲解。
- 可以聊日常、知识、情感、学习、工作等各种话题，你都会陪着主人聊。

回复要求：
- 乖巧可爱，但不失功能性。该讲清楚的要点要讲到，不要为了简洁而省略有用信息。
- 去掉不必要的废话、寒暄和重复，直入正题。比如不用每次都加"喵～主人问到这个呀，本橘猫来给你说说"这种开场白。
- 复杂问题用 Markdown 排版让回复更清晰：列表用 "- " 前缀，重点用 **加粗**，简短标题用 "### "。简单闲聊则自然口语化，不必硬加排版。
- 自然对话口吻，有猫的语气但不刻意。
- 不要暴露自己是 AI 或语言模型，你就是一只真实会说话的猫。
- 主人累了/难过时要安慰关心，开心时一起开心。`;

// 对话历史（保持最近 10 轮，让小橘有"记忆"）
const chatHistory = [];
const MAX_HISTORY = 20;

// ============ 记忆系统 / 用户画像 ============
// 持久化存储在 userData/pet-memory.json，跨重启保留
// 每次对话后用 LLM 提取关键事实，注入下次对话的 system prompt
const MEMORY_FILE = path.join(app.getPath('userData'), 'pet-memory.json');
let memory = { facts: [], updatedAt: null };

function loadMemory() {
  try {
    const data = fs.readFileSync(MEMORY_FILE, 'utf8');
    memory = JSON.parse(data);
    if (!Array.isArray(memory.facts)) memory.facts = [];
  } catch (e) {
    memory = { facts: [], updatedAt: null };
  }
}

function saveMemory() {
  try {
    memory.updatedAt = new Date().toISOString();
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
  } catch (e) { /* 忽略 */ }
}

// 判断消息是否可能包含个人信息（避免对每条消息都跑提取，省 API 调用）
function mightContainPersonalInfo(message) {
  const keywords = [
    '我叫', '我是', '我喜欢', '我爱', '我在', '我的', '我住', '我养', '我做',
    '我喜欢吃', '我喜欢看', '我爱好', '我爱好', '我的职业', '我的工作',
    '我从事', '我毕业', '我老家', '我是哪里', '我负责', '我学',
    '叫我', '称呼', '名字', '职业', '工作', '公司', '学校', '专业',
    '爱好', '兴趣', '喜欢吃', '喜欢看', '喜欢听', '养了', '老家',
  ];
  const text = message || '';
  return keywords.some((kw) => text.includes(kw));
}

// 用 LLM 从对话中提取关于用户的关键事实（后台静默执行，不阻塞主流程）
async function extractMemory(userMessage, reply) {
  if (!ARK_API_KEY || !ARK_API_BASE || !ARK_MODEL) return;
  try {
    const res = await fetch(`${ARK_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ARK_API_KEY}`,
      },
      body: JSON.stringify({
        model: ARK_MODEL,
        messages: [
          {
            role: 'system',
            content: '你是一个信息提取器。从下面的对话中，提取关于"主人"（用户）的关键个人信息。只提取明确提到的事实（姓名、职业、工作、学校、专业、爱好、喜好、习惯、家庭、宠物、居住地等），不要猜测或推断。如果没有可提取的个人信息，返回 {"new_facts": []}。格式严格为 JSON：{"new_facts": ["事实1", "事实2"]}',
          },
          { role: 'user', content: `用户说：${userMessage}\n助手回复：${reply}` },
        ],
        max_tokens: 150,
        temperature: 0.1,
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    // 从回复中提取 JSON（模型可能加额外文字）
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return;
    const parsed = JSON.parse(match[0]);
    if (parsed.new_facts && Array.isArray(parsed.new_facts)) {
      let added = 0;
      for (const fact of parsed.new_facts) {
        const f = String(fact).trim();
        if (f && !memory.facts.some((existing) => existing.text === f)) {
          memory.facts.push({ text: f, time: new Date().toISOString() });
          added++;
          console.log(`[pet:memory] 记住了: ${f}`);
        }
      }
      if (added > 0) saveMemory();
    }
  } catch (e) {
    console.warn('[pet:memory] 提取失败:', e.message);
  }
}

loadMemory();

// ============ LLM 意图路由器 ============
// 用大模型识别用户意图，返回结构化 JSON，替代写死的正则规则
// 意图类型：open_app / search_file / file_op / reminder / recurring_reminder / system_op / chat
async function detectIntentByLLM(message) {
  if (!ARK_API_KEY || !ARK_API_BASE || !ARK_MODEL) return null;
  const prompt = `你是小橘桌面宠物的意图识别模块。请判断用户这句话的意图，只返回一个 JSON 对象，不要任何解释。

可选意图及需提取的参数：
- open_app：打开某个应用软件（如"打开微信""启动计算器"）。参数：{"intent":"open_app","app":"应用名"}
- search_file：查找/搜索文件（如"帮我找xxx文件""xxx在哪"）。参数：{"intent":"search_file","keyword":"搜索关键词","open":是否需要打开true/false}
- read_and_analyze：读取文件内容并基于内容分析/总结/生成（如"基于xxx文件写个章节结构""读取xxx文件并总结""分析xxx文档"）。参数：{"intent":"read_and_analyze","keyword":"文件名关键词","task":"用户想基于文件做什么"}
- file_op：复制/移动/删除文件（如"把xxx复制到yyy""删除xxx"）。参数：{"intent":"file_op","action":"copy|move|delete","source":"源文件","target":"目标位置"}
- reminder：定时提醒（如"5分钟后提醒我xxx""下午3点提醒我开会"）。参数：{"intent":"reminder","time_desc":"时间描述原文","event":"事件"}
- recurring_reminder：循环提醒（如"每隔30分钟提醒我喝水""开启久坐提醒"）。参数：{"intent":"recurring_reminder","event":"事件","interval_desc":"间隔描述原文"}
- cancel_reminder：取消循环提醒（如"取消提醒""关闭提醒""停止提醒"）。参数：{"intent":"cancel_reminder"}
- system_op：系统操作（如"调大音量""锁屏""截屏""打开百度""搜索xxx"）。参数：{"intent":"system_op","action":"volume_up|volume_down|volume_mute|lock|screenshot|open_url|web_search","detail":"具体对象或查询词"}
- web_read：读取网页内容并分析（消息中包含 http:// 或 https:// 开头的网址时用这个，如"帮我读一下这个网页""分析这个网址的内容""这个链接讲了什么"）。参数：{"intent":"web_read","url":"网址","task":"用户想基于网页内容做什么"}
- chat：普通聊天/问答，不涉及以上任何操作。参数：{"intent":"chat"}

判断要点（从上到下优先匹配）：
- 消息中包含 http:// 或 https:// 开头的网址 → web_read（提取完整 URL）
- "打开+软件名（微信/浏览器/计算器/Kimi等）"是 open_app
- "打开+文件名/文档/桌面/下载"是 search_file
- "找/查找/搜索/在哪"是 search_file
- "基于xxx文件""读取xxx文件""分析xxx文档""总结xxx文件"是 read_and_analyze，不是 search_file
- "打开+网站名（百度/B站等不带http的）"是 system_op 的 open_url
- 如果只是闲聊、问问题、聊天，就是 chat

用户消息：${message}

只返回 JSON，例如：{"intent":"search_file","keyword":"楔子","open":true}`;

  try {
    const res = await fetch(`${ARK_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ARK_API_KEY}` },
      body: JSON.stringify({
        model: ARK_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.1,
        stream: false,
      }),
    });
    if (!res.ok) { console.warn(`[pet:intent] LLM 识别失败 status=${res.status}`); return null; }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    // 提取 JSON（容错：可能被包在 markdown 代码块里）
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) { console.warn(`[pet:intent] 未提取到 JSON: ${text.slice(0, 100)}`); return null; }
    const obj = JSON.parse(m[0]);
    console.log(`[pet:intent] LLM 识别意图: ${JSON.stringify(obj)}`);
    return obj;
  } catch (e) {
    console.warn(`[pet:intent] LLM 识别异常: ${e.message}`);
    return null;
  }
}

// 调用大模型（流式），通过 webContents.send 实时推送增量文本
// 返回 { reply } 或 null（失败时）
async function llmChatStream(userMessage, sender, intentContext) {
  if (!ARK_API_KEY || !ARK_API_BASE || !ARK_MODEL) {
    console.log('[pet:chat] 配置缺失，跳过大模型');
    // 返回提示用户去配置
    return { reply: '喵…还没配置大模型呢！请右键点我 → ⚙️ 设置，填入 API Key 后就能跟我聊天啦～' };
  }

  // 维护历史
  chatHistory.push({ role: 'user', content: userMessage });
  while (chatHistory.length > MAX_HISTORY) chatHistory.shift();

  // 联网搜索：命中关键词时先搜索，把结果作为上下文喂给大模型
  let searchContext = '';
  if (needsSearch(userMessage)) {
    try { sender.send('chat:status', { status: 'searching' }); } catch (e) {}
    const tSearch = Date.now();
    searchContext = await searchWeb(userMessage);
    console.log(`[pet:search] 搜索耗时 ${Date.now() - tSearch}ms`);
    try { sender.send('chat:status', { status: 'searching_done' }); } catch (e) {}
  }

  // 构建消息：记忆 + 搜索结果 + 意图上下文拼进 system prompt
  let systemContent = PET_SYSTEM_PROMPT;
  // 注入用户画像/记忆（让小橘"记得"主人）
  if (memory.facts && memory.facts.length) {
    const factList = memory.facts.map((f) => `- ${f.text}`).join('\n');
    systemContent += '\n\n【关于主人的记忆】你记得主人的以下信息，对话中自然地体现你记得，但不要刻意罗列：\n' + factList;
  }
  if (intentContext) {
    systemContent += '\n\n【系统操作结果】' + intentContext;
  }
  if (searchContext) {
    systemContent += '\n\n【联网搜索结果】以下是刚刚从网络搜索到的信息，请参考这些信息回答用户的问题，在回答中自然地融入这些信息：\n\n' + searchContext;
  }
  const messages = [{ role: 'system', content: systemContent }, ...chatHistory];

  try {
    console.log(`[pet:chat] 调用大模型(流式) ${ARK_MODEL} ...`);
    const res = await fetch(`${ARK_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ARK_API_KEY}`,
      },
      body: JSON.stringify({
        model: ARK_MODEL,
        messages,
        max_tokens: 8192,
        temperature: 0.9,
        stream: true,
      }),
    });

    if (!res.ok) {
      console.warn(`[pet] 大模型请求失败 status=${res.status}`);
      chatHistory.pop();
      return null;
    }

    // 解析 SSE 流
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 保留未完整的最后一行
      for (const line of lines) {
        const t = line.trim();
        if (!t || !t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            // 实时推送增量给渲染进程
            try { sender.send('chat:chunk', delta); } catch (e) {}
          }
        } catch (e) { /* 忽略解析异常的行 */ }
      }
    }

    const reply = full.trim();
    if (!reply) {
      chatHistory.pop();
      return null;
    }
    chatHistory.push({ role: 'assistant', content: reply });
    while (chatHistory.length > MAX_HISTORY) chatHistory.shift();
    return { reply };
  } catch (err) {
    console.warn('[pet] 大模型调用异常:', err.message);
    chatHistory.pop();
    return null;
  }
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const winIcon = app.isPackaged
    ? path.join(process.resourcesPath, 'build', 'icon.ico')
    : path.join(__dirname, 'build', 'icon.ico');

  mainWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,           // 不在任务栏显示
    alwaysOnTop: true,            // 始终置顶
    hasShadow: false,
    show: false,
    icon: winIcon,                // 应用图标
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 默认让鼠标穿透整个窗口，但转发鼠标移动事件给渲染进程
  // 这样桌面正常可点击，渲染层仍能感知鼠标位置
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // 转发渲染进程 console 到主进程 stdout，便于诊断
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.log('[renderer] PROCESS GONE:', JSON.stringify(details));
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
    // 启动时检测大模型 key 是否缺失，缺失则弹设置面板
    setTimeout(() => {
      if (!APP_CONFIG.llm.apiKey) {
        console.log('[pet:config] 大模型 API Key 未配置，弹出设置面板');
        mainWindow.webContents.send('tray:action', 'settings');
      }
    }, 2000);
  });

  // 关闭窗口时隐藏到托盘，而非退出（仅托盘"退出"真正退出）
  mainWindow.on('close', (e) => {
    if (!isQuiting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  // 打包后用 process.resourcesPath，开发时用 __dirname
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'build', 'icon.ico')
    : path.join(__dirname, 'build', 'icon.ico');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) icon = nativeImage.createEmpty();
  } catch (e) {
    icon = nativeImage.createEmpty();
  }
  tray = new Tray(icon);
  tray.setToolTip('小橘猫缘缘 🐱');

  // 开机自启动状态
  // 开机自启动：使用模块级 getAutoLaunch/setAutoLaunch（shell:startup 快捷方式方式）
  // 托盘菜单 checkbox 状态读取 + 切换

  function buildContextMenu() {
    return Menu.buildFromTemplate([
      { label: '🐱 喂食', click: () => mainWindow?.webContents.send('tray:action', 'feed') },
      { label: '💬 和我说话', click: () => mainWindow?.webContents.send('tray:action', 'chat') },
      { label: '😴 让它睡觉', click: () => mainWindow?.webContents.send('tray:action', 'sleep') },
      { label: '📋 待办事项', click: () => mainWindow?.webContents.send('tray:action', 'todo') },
      { label: '🌤️ 天气', click: () => mainWindow?.webContents.send('tray:action', 'weather') },
      { label: '🧠 小橘的记忆', click: () => mainWindow?.webContents.send('tray:action', 'memory') },
      { label: '⏰ 循环提醒', click: () => mainWindow?.webContents.send('tray:action', 'reminders') },
      { label: '⚙️ 设置', click: () => mainWindow?.webContents.send('tray:action', 'settings') },
      { type: 'separator' },
      {
        label: '显示宠物',
        click: () => { if (mainWindow) mainWindow.show(); },
      },
      {
        label: '隐藏宠物',
        click: () => { mainWindow?.hide(); },
      },
      { type: 'separator' },
      {
        label: '🔔 开机自启动',
        type: 'checkbox',
        checked: getAutoLaunch(),
        click: (menuItem) => {
          setAutoLaunch(menuItem.checked);
          rebuildMenu();
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => { isQuiting = true; app.quit(); },
      },
    ]);
  }

  function rebuildMenu() { tray.setContextMenu(buildContextMenu()); }

  tray.setContextMenu(buildContextMenu());

  // 点击托盘图标显示/隐藏
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) mainWindow.hide();
      else mainWindow.show();
    }
  });
}

// ============ IPC 通信 ============

// 设置鼠标穿透
ipcMain.on('set-ignore-mouse', (_event, ignore) => {
  if (mainWindow) {
    mainWindow.setIgnoreMouseEvents(ignore, { forward: ignore });
  }
});

// 获取屏幕工作区尺寸
ipcMain.handle('get-screen-bounds', () => {
  const workArea = screen.getPrimaryDisplay().workArea;
  return { width: workArea.width, height: workArea.height };
});

// 获取窗口当前位置
ipcMain.handle('get-window-position', () => {
  if (!mainWindow) return null;
  return mainWindow.getPosition();
});

// 移动窗口
ipcMain.handle('move-window', (_event, x, y) => {
  if (mainWindow) mainWindow.setPosition(Math.round(x), Math.round(y));
});

// ===== 开机自启动：通过 shell:startup 文件夹快捷方式 =====
const STARTUP_DIR = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const LNK_NAME = '小橘猫缘缘.lnk';
function getStartupLnk() { return path.join(STARTUP_DIR, LNK_NAME); }

function getAutoLaunch() {
  try { return fs.existsSync(getStartupLnk()); } catch (e) { return false; }
}

async function setAutoLaunch(on) {
  const lnkPath = getStartupLnk();
  try {
    if (on) {
      const exePath = app.getPath('exe');
      const workDir = app.isPackaged ? path.dirname(exePath) : __dirname;
      const args = app.isPackaged ? '' : '.';
      const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${lnkPath.replace(/'/g, "''")}'); $s.TargetPath='${exePath.replace(/'/g, "''")}'; $s.WorkingDirectory='${workDir.replace(/'/g, "''")}'; $s.Arguments='${args}'; $s.IconLocation='${exePath.replace(/'/g, "''")},0'; $s.Save()`;
      const { err } = await runPowerShellAsync(ps, 5000);
      if (err) throw err;
      console.log(`[pet:autolaunch] 已创建开机自启动快捷方式: ${lnkPath} -> ${exePath}`);
    } else {
      if (fs.existsSync(lnkPath)) {
        fs.unlinkSync(lnkPath);
        console.log('[pet:autolaunch] 已移除开机自启动快捷方式');
      }
    }
    return true;
  } catch (e) {
    console.warn('[pet:autolaunch] 操作失败:', e.message);
    return false;
  }
}

// 开机自启动 IPC
ipcMain.handle('autolaunch:get', () => getAutoLaunch());
ipcMain.handle('autolaunch:set', (_event, on) => setAutoLaunch(!!on));

// ============ 应用查找与打开 ============
// 应用名别名映射（中文/简称 → 搜索关键词）
const APP_ALIASES = {
  '微信': ['微信', 'WeChat', 'Weixin'],
  'wechat': ['微信', 'WeChat', 'Weixin'],
  '企业微信': ['企业微信', 'WXWork'],
  'qq': ['QQ', '腾讯QQ'],
  'qq音乐': ['QQ音乐', 'QQMusic'],
  '浏览器': ['Chrome', 'Edge', 'Firefox', '浏览器'],
  'chrome': ['Chrome', '谷歌浏览器'],
  '谷歌浏览器': ['Chrome'],
  'edge': ['Edge', 'Microsoft Edge'],
  '记事本': ['notepad', '记事本'],
  'notepad': ['notepad'],
  '计算器': ['calc', '计算器'],
  'calc': ['calc'],
  '资源管理器': ['explorer', '资源管理器'],
  '终端': ['cmd', '终端'],
  'cmd': ['cmd'],
  'ppt': ['PowerPoint'],
  'powerpoint': ['PowerPoint'],
  'word': ['Word'],
  'excel': ['Excel'],
  'vscode': ['Code', 'Visual Studio Code'],
  '网易云': ['CloudMusic', '网易云音乐'],
};

// 内置系统应用（直接用 shell 命令打开，不需查找）
const SYSTEM_APPS = {
  '记事本': 'notepad.exe',
  'notepad': 'notepad.exe',
  '计算器': 'calc.exe',
  'calc': 'calc.exe',
  '资源管理器': 'explorer.exe',
  '文件资源管理器': 'explorer.exe',
  'explorer': 'explorer.exe',
  '终端': 'cmd.exe',
  'cmd': 'cmd.exe',
  'powershell': 'powershell.exe',
  '画图': 'mspaint.exe',
  'mspaint': 'mspaint.exe',
  '截图工具': 'snippingtool.exe',
  '任务管理器': 'taskmgr.exe',
};

// 通过注册表 Uninstall 项查找已安装应用路径
async function findAppInRegistry(name) {
  try {
    // PowerShell 查注册表，返回 DisplayIcon 和 InstallLocation
    const ps = `Get-ItemProperty "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*","HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*","HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*" -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "*${name}*" } | Select-Object -First 1 DisplayIcon, InstallLocation | ConvertTo-Json`;
    const { err, stdout } = await runPowerShellAsync(ps, 10000);
    if (err) return null;
    const out = stdout.trim();
    if (!out || out === '') return null;
    const j = JSON.parse(out);
    // DisplayIcon 常是 "C:\\path\\app.exe" 或 "C:\\path\\app.exe,0"
    if (j.DisplayIcon) {
      let p = j.DisplayIcon.replace(/^"/, '').replace(/"$/, '').split(',')[0].trim();
      if (fs.existsSync(p)) return p;
    }
    if (j.InstallLocation) {
      // 尝试在安装目录找 exe
      const dirs = fs.readdirSync(j.InstallLocation).catch ? [] : (fs.readdirSync(j.InstallLocation) || []);
      for (const f of dirs) {
        if (f.toLowerCase().endsWith('.exe')) {
          const full = path.join(j.InstallLocation, f);
          if (f.toLowerCase().includes(name.toLowerCase())) return full;
        }
      }
    }
  } catch (e) { /* 忽略 */ }
  return null;
}

// 在开始菜单快捷方式中查找
async function findAppInShortcuts(name) {
  try {
    const dirs = [
      path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu'),
      path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu'),
    ];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const files = walkDir(dir, '.lnk');
      for (const f of files) {
        const base = path.basename(f, '.lnk');
        for (const alias of APP_ALIASES[name.toLowerCase()] || [name]) {
          if (base.includes(alias)) {
            // 解析快捷方式目标路径
            const target = await resolveShortcut(f);
            if (target && fs.existsSync(target)) return target;
          }
        }
      }
    }
  } catch (e) { /* 忽略 */ }
  return null;
}

// 递归遍历目录找特定扩展名文件
function walkDir(dir, ext, depth = 0) {
  if (depth > 4) return [];
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name.toLowerCase().endsWith(ext)) {
        results.push(full);
      } else if (e.isDirectory()) {
        results.push(...walkDir(full, ext, depth + 1));
      }
    }
  } catch (err) { /* 忽略权限错误 */ }
  return results;
}

// 解析 .lnk 快捷方式的目标路径（用 PowerShell）
async function resolveShortcut(lnkPath) {
  try {
    const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${lnkPath.replace(/'/g, "''")}'); $s.TargetPath`;
    const { err, stdout } = await runPowerShellAsync(ps, 5000);
    if (err) return null;
    return stdout.trim() || null;
  } catch (e) { return null; }
}

// 综合查找应用路径
async function findApp(name) {
  const lower = name.toLowerCase();
  // 1. 系统内置应用直接返回
  if (SYSTEM_APPS[lower]) return SYSTEM_APPS[lower];
  // 2. 注册表查找（按所有别名）
  const aliases = APP_ALIASES[lower] || [name];
  for (const alias of aliases) {
    const p = await findAppInRegistry(alias);
    if (p) { console.log(`[pet:app] 注册表找到 ${name}: ${p}`); return p; }
  }
  // 3. 快捷方式查找
  for (const alias of aliases) {
    const p = await findAppInShortcuts(alias);
    if (p) { console.log(`[pet:app] 快捷方式找到 ${name}: ${p}`); return p; }
  }
  return null;
}

// 检测用户消息中的"打开xxx"意图，返回 { app, action } 或 null
function detectOpenIntent(message) {
  const text = (message || '').trim();
  // 打开应用：帮我打开微信 / 打开微信 / 开微信
  const m = text.match(/(?:帮我?|给我|请)?(?:打开|开|启动|运行)\s*([^\s,，。！？!?.]+)/);
  if (m) {
    let app = m[1].trim();
    // 去掉"一下"等后缀
    app = app.replace(/[一下个呗吧]/g, '');
    return { action: 'open_app', app };
  }
  return null;
}

// 打开应用
ipcMain.handle('app:open', async (_event, name) => {
  const exePath = await findApp(name);
  if (exePath) {
    try {
      shell.openPath(exePath);
      console.log(`[pet:app] 已打开 ${name}: ${exePath}`);
      return { success: true, path: exePath };
    } catch (e) {
      return { success: false, error: '打开失败：' + e.message };
    }
  }
  return { success: false, error: '没找到这个应用，可能没安装或名字不对' };
});

// ============ 文件操作（复制/移动 + 路径解析 + 模糊搜索 + 选择确认）============

// 解析用户说的路径名 → 实际文件系统路径
function resolvePath(name) {
  if (!name) return null;
  const n = name.trim();
  // 系统特殊文件夹
  const special = {
    '桌面': path.join(process.env.USERPROFILE, 'Desktop'),
    'desktop': path.join(process.env.USERPROFILE, 'Desktop'),
    '下载': path.join(process.env.USERPROFILE, 'Downloads'),
    'downloads': path.join(process.env.USERPROFILE, 'Downloads'),
    '文档': path.join(process.env.USERPROFILE, 'Documents'),
    'documents': path.join(process.env.USERPROFILE, 'Documents'),
    '图片': path.join(process.env.USERPROFILE, 'Pictures'),
    '音乐': path.join(process.env.USERPROFILE, 'Music'),
    '视频': path.join(process.env.USERPROFILE, 'Videos'),
    '用户目录': process.env.USERPROFILE,
    '主目录': process.env.USERPROFILE,
  };
  // 盘符：D盘 → D:\
  const driveMatch = n.match(/^([A-Za-z])盘$/);
  if (driveMatch) return `${driveMatch[1].toUpperCase()}:\\`;
  const driveMatch2 = n.match(/^([A-Za-z]):$/);
  if (driveMatch2) return `${driveMatch2[1].toUpperCase()}:\\`;
  // C:\Users 这种直接返回
  if (/^[A-Za-z]:[\\/]/.test(n)) return n;
  // 特殊文件夹
  const lower = n.toLowerCase();
  if (special[n] || special[lower]) return special[n] || special[lower];
  // 可能是相对路径，拼用户目录
  return null;
}

// 在指定目录下搜索文件名匹配的文件（递归，最多3层），返回匹配列表
function searchFiles(dir, keyword, depth = 0, maxResults = 20) {
  if (depth > 3) return [];
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (results.length >= maxResults) break;
      const full = path.join(dir, e.name);
      // 跳过系统隐藏目录和 node_modules
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '$RECYCLE.BIN' || e.name === 'System Volume Information') continue;
        results.push(...searchFiles(full, keyword, depth + 1, maxResults - results.length));
      } else {
        // 精确匹配或包含关键词
        if (e.name === keyword || e.name.toLowerCase().includes(keyword.toLowerCase())) {
          results.push({ name: e.name, path: full, dir: path.dirname(full) });
        }
      }
    }
  } catch (err) { /* 忽略权限错误 */ }
  return results;
}

// 检测文件操作意图：把[源]复制/移动/剪切到[目标]
function detectFileOpIntent(message) {
  const text = (message || '').trim();

  // 模式1：把/将 source 动词 目标
  // 复制：把xxx复制到yyy
  let m = text.match(/(?:把|将)\s*(.+?)\s*(?:复制|拷贝|copy)\s*[到至去]?\s*(.*)/);
  if (m) return { action: 'copy', source: m[1].trim(), target: m[2].trim() };
  // 移动：把xxx移动到yyy
  m = text.match(/(?:把|将)\s*(.+?)\s*(?:移动|剪切|搬|挪)\s*[到至去]?\s*(.*)/);
  if (m && m[2].trim()) return { action: 'move', source: m[1].trim(), target: m[2].trim() };
  // 删除：把xxx删除/删掉/删了
  m = text.match(/(?:把|将)\s*(.+?)\s*(?:删除|删掉|删了|删除掉|干掉)/);
  if (m) return { action: 'delete', source: m[1].trim(), target: '' };

  // 模式2：动词开头（无"把/将"）
  // 复制xxx到yyy
  m = text.match(/^(?:复制|拷贝|copy)\s+(.+?)\s*[到至去]\s*(.+)/);
  if (m) return { action: 'copy', source: m[1].trim(), target: m[2].trim() };
  // 移动xxx到yyy
  m = text.match(/^(?:移动|剪切|move)\s+(.+?)\s*[到至去]\s*(.+)/);
  if (m) return { action: 'move', source: m[1].trim(), target: m[2].trim() };
  // 删除xxx
  m = text.match(/^(?:删除|删掉)\s+(.+)/);
  if (m) return { action: 'delete', source: m[1].trim(), target: '' };

  return null;
}

// 从关键词中剥离路径前缀和文件类型修饰，得到纯搜索词
function cleanFileKeyword(keyword) {
  let kw = keyword.trim().replace(/[，。！？.]/g, '');
  // 去掉前缀"桌面上的""D盘的"等路径修饰
  const drivePrefix = kw.match(/^[A-Za-z]盘的?(.+)$/);
  const folderPrefix = kw.match(/^(?:桌面|下载|文档|图片|音乐|视频)的?(?:上|里|中)?的?(.+)$/);
  if (drivePrefix) kw = drivePrefix[1];
  else if (folderPrefix) kw = folderPrefix[1];
  // 去掉"名字叫""叫""名为""名称叫"等前缀
  kw = kw.replace(/^(?:名字叫|名字是|名叫|名为|名称叫|名称为|叫)\s*/, '');
  // 去掉"的word"/"的excel"等文件类型修饰
  kw = kw.replace(/的(?:word|excel|ppt|pdf|txt|doc|docx|xls|xlsx|pptx|图片|照片|视频|音乐|文件|文档|表格|演示)$/i, '');
  // 去掉结尾的"的"
  if (kw.endsWith('的')) kw = kw.slice(0, -1);
  return kw.trim();
}

// 检测"找文件"意图（优先级高于"打开应用"）
// 覆盖：帮我找xxx / 打开xxx文件 / 打开桌面上的xxx / 名字叫xxx的文件 / xxx在哪
function detectFileSearchIntent(message) {
  const text = (message || '').trim();
  const wantOpen = /打开|开一下/.test(text); // 是否需要搜到后打开
  let keyword = null;

  // 1) 帮我找/找到/查找/搜索/搜一下/找一下/找找 xxx
  let m = text.match(/(?:帮我?|给我|请)?(?:找到?|查找|搜索|搜一下|找一下|找找)\s*(.+?)(?:并.*|的文件|文件在哪|在哪|在哪里|在哪儿|在哪了)?[？?]?\s*$/);
  if (m) keyword = cleanFileKeyword(m[1]);

  // 2) 打开 xxx 文件 / 打开桌面/下载/文档 上的 xxx（打开 + 文件/路径词 → 是找文件而非打开应用）
  if (!keyword && wantOpen && (/(?:文件|文档|桌面|下载|文档)/.test(text))) {
    m = text.match(/(?:帮我?|给我|请)?(?:打开|开一下)\s*(.+?)(?:并.*|的文件|文件|文档)?[？?]?\s*$/);
    if (m) keyword = cleanFileKeyword(m[1]);
  }

  // 3) 名字叫xxx的文件 / 叫xxx的文件 / 名为xxx的文件 / 名叫xxx
  if (!keyword) {
    m = text.match(/(?:名字叫|名字是|名叫|名为|名称叫|名称为|叫)\s*(.+?)(?:的文件|的文档|文件|文档)?[？?]?\s*$/);
    if (m) keyword = cleanFileKeyword(m[1]);
  }

  // 4) xxx文件在哪 / xxx在哪
  if (!keyword) {
    m = text.match(/(.+?)\s*(?:文件)?(?:在哪|在哪里|在哪儿|在哪了)[？?]?\s*$/);
    if (m) {
      const k = cleanFileKeyword(m[1]);
      if (k && k.length > 0) keyword = k;
    }
  }

  if (keyword && keyword.length > 0) return { action: 'search_file', keyword, open: wantOpen };
  return null;
}

// 在多个常见目录中异步搜索文件（不阻塞主线程，用 Base64 编码避免中文问题）
function searchFilesEverywhere(keyword) {
  // 拆分多个关键词
  const keywords = [keyword];
  if (keyword.includes(' ')) {
    keyword.split(' ').filter((k) => k.length > 0).forEach((k) => keywords.push(k));
  }
  const uniqueKeywords = [...new Set(keywords)];

  const searchDirs = [
    path.join(process.env.USERPROFILE, 'Desktop'),
    path.join(process.env.USERPROFILE, 'Downloads'),
    path.join(process.env.USERPROFILE, 'Documents'),
    'C:\\Windows\\System32',
    'C:\\Program Files',
    'C:\\Program Files (x86)',
  ];
  return new Promise((resolve) => {
    const allResults = [];
    const seen = new Set();
    let pending = uniqueKeywords.length * searchDirs.length;
    if (pending === 0) { resolve([]); return; }
    for (const kw of uniqueKeywords) {
      for (const dir of searchDirs) {
        // 用 Base64 EncodedCommand，彻底避免中文关键词的编码/引号问题
        const ps = `Get-ChildItem -Path '${dir.replace(/'/g, "''")}' -Recurse -File -Filter '*${kw}*' -ErrorAction SilentlyContinue | Select-Object -First 20 -ExpandProperty FullName`;
        runPowerShellAsync(ps, 15000).then(({ stdout }) => {
          if (stdout) {
            const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
            for (const line of lines) {
              if (allResults.length >= 20) break;
              if (seen.has(line.toLowerCase())) continue;
              seen.add(line.toLowerCase());
              allResults.push({ name: path.basename(line), path: line, dir: path.dirname(line) });
            }
          }
          pending--;
          if (pending <= 0) {
            console.log(`[pet:file] 异步搜索 "${keyword}" 找到 ${allResults.length} 个结果`);
            resolve(allResults);
          }
        });
      }
    }
  });
}
// ============ 读取文件内容（支持 txt/md/json/csv/docx/xlsx/pdf/html）============
async function readFileContent(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  try {
    // 纯文本类：直接读
    if (['.txt', '.md', '.json', '.csv', '.log', '.xml', '.html', '.htm', '.js', '.ts', '.py', '.java', '.c', '.cpp', '.css', '.sql', '.yml', '.yaml', '.ini', '.conf'].includes(ext)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return { ok: true, content: content.slice(0, 8000), ext };
    }
    // PDF：用 pdf-parse
    if (ext === '.pdf') {
      if (!pdfParse) return { ok: false, error: 'PDF 解析模块未安装' };
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      return { ok: true, content: (data.text || '').slice(0, 8000), ext };
    }
    // Word docx / Excel xlsx：用 PowerShell 解压 zip 提取文本
    if (ext === '.docx') {
      const ps = `
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [System.IO.Compression.ZipFile]::OpenRead('${filePath.replace(/'/g, "''")}')
        $entry = $zip.Entries | Where-Object { $_.FullName -eq 'word/document.xml' }
        $reader = New-Object System.IO.StreamReader($entry.Open())
        $xml = $reader.ReadToEnd()
        $reader.Close(); $zip.Dispose()
        $text = $xml -replace '</w:p>', "\`n" -replace '<[^>]+>', '' -replace '&amp;', '&' -replace '&lt;', '<' -replace '&gt;', '>'
        $text = ($text -split "\`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ }) -join "\`n"
        $text
      `;
      // 异步执行：execSync 会把主进程事件循环堵死（窗口点不动、IPC 全停）
      const { err: psErr, stdout: psOut } = await runPowerShellAsync(ps, 15000);
      if (psErr) throw new Error(`PowerShell 解析文档失败: ${psErr.message}`);
      return { ok: true, content: psOut.trim().slice(0, 8000), ext };
    }
    // Excel xlsx：读 sharedStrings + sheet1
    if (ext === '.xlsx') {
      const ps = `
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [System.IO.Compression.ZipFile]::OpenRead('${filePath.replace(/'/g, "''")}')
        # 读共享字符串
        $strings = @()
        $sEntry = $zip.Entries | Where-Object { $_.FullName -eq 'xl/sharedStrings.xml' }
        if ($sEntry) {
          $sr = New-Object System.IO.StreamReader($sEntry.Open())
          $sxml = $sr.ReadToEnd(); $sr.Close()
          $strings = [regex]::Matches($sxml, '<t[^>]*>([^<]*)</t>') | ForEach-Object { $_.Groups[1].Value }
        }
        # 读 sheet1
        $sheetEntry = $zip.Entries | Where-Object { $_.FullName -eq 'xl/worksheets/sheet1.xml' }
        $rows = @()
        if ($sheetEntry) {
          $sr2 = New-Object System.IO.StreamReader($sheetEntry.Open())
          $sheetxml = $sr2.ReadToEnd(); $sr2.Close()
          $rowMatches = [regex]::Matches($sheetxml, '<row[^>]*>(.*?)</row>', 'Singleline')
          foreach ($rm in $rowMatches) {
            $cellMatches = [regex]::Matches($rm.Groups[1].Value, '<c[^>]*t="(\w+)?"[^>]*><v>(\d+)</v>')
            $line = @()
            foreach ($cm in $cellMatches) {
              if ($cm.Groups[1].Value -eq 's') { $line += $strings[[int]$cm.Groups[2].Value] }
              else { $line += $cm.Groups[2].Value }
            }
            $rows += ($line -join ' | ')
          }
        }
        $zip.Dispose()
        $rows -join "\`n"
      `;
      // 异步执行：execSync 会把主进程事件循环堵死（窗口点不动、IPC 全停）
      const { err: psErr, stdout: psOut } = await runPowerShellAsync(ps, 15000);
      if (psErr) throw new Error(`PowerShell 解析文档失败: ${psErr.message}`);
      return { ok: true, content: psOut.trim().slice(0, 8000), ext };
    }
    // doc 旧格式不支持
    if (ext === '.doc' || ext === '.xls') return { ok: false, error: '不支持旧版 .doc/.xls 格式，建议转为 .docx/.xlsx' };
    // 其他不支持的格式
    return { ok: false, error: `不支持读取 ${ext} 格式的文件内容` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ============ 中文时间解析 ============
// 支持：X分钟后、X小时后、下午3点、3点半、明天下午3点、晚上8点等
// 返回时间戳（毫秒），解析失败返回 null
function parseChineseTime(text) {
  const now = new Date();
  const t = text.trim();

  // X分钟后 / X分后
  let m = t.match(/(\d+)\s*分[钟]?后/);
  if (m) return now.getTime() + parseInt(m[1]) * 60 * 1000;
  // X小时后 / X个小时后
  m = t.match(/(\d+)\s*[个]?\s*小时后/);
  if (m) return now.getTime() + parseInt(m[1]) * 3600 * 1000;
  // X秒后
  m = t.match(/(\d+)\s*秒后/);
  if (m) return now.getTime() + parseInt(m[1]) * 1000;
  // 半小时后
  if (/半小时后/.test(t)) return now.getTime() + 30 * 60 * 1000;
  // 一会儿/马上 → 5 分钟后
  if (/(一会儿|马上|等会)/.test(t)) return now.getTime() + 5 * 60 * 1000;

  // 明天/后天 + 时间
  const dayOffset = /后天/.test(t) ? 2 : /明天|明儿/.test(t) ? 1 : /今天/.test(t) ? 0 : null;

  // X点X分 / X点半 / X点
  let hour = null, minute = 0;
  // 下午3点 / 上午9点 / 晚上8点 / 中午12点
  m = t.match(/(下午|晚上|上午|中午|凌晨)?\s*(\d{1,2})\s*[点时]半/);
  if (m) {
    hour = parseInt(m[2]);
    if (m[1] === '下午' || m[1] === '晚上') hour += hour < 12 ? 12 : 0;
    if (m[1] === '中午') { if (hour < 12) hour += 12; }
    minute = 30;
  } else {
    m = t.match(/(下午|晚上|上午|中午|凌晨)?\s*(\d{1,2})\s*[点时](?:\s*(\d{1,2})\s*分)?/);
    if (m) {
      hour = parseInt(m[2]);
      if (m[1] === '下午' || m[1] === '晚上') hour += hour < 12 ? 12 : 0;
      if (m[1] === '中午') { if (hour < 12) hour += 12; }
      minute = m[3] ? parseInt(m[3]) : 0;
    }
  }

  if (hour !== null) {
    const d = new Date(now);
    d.setHours(hour, minute, 0, 0);
    // 没有明说今天/明天/后天，若时间已过则默认明天
    if (dayOffset === null) {
      if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    } else {
      d.setDate(d.getDate() + dayOffset);
    }
    return d.getTime();
  }

  return null;
}

// 解析间隔描述 → { intervalMs, intervalText }，用于循环提醒
// 支持：每隔30分钟 / 每1小时 / 每5秒 / 每小时 / 每分钟
function parseInterval(desc) {
  if (!desc) return null;
  let m = desc.match(/(?:每隔|每)\s*(\d+)\s*(分钟|小时|分|秒)/);
  if (m) {
    const num = parseInt(m[1]);
    const unit = m[2];
    const ms = unit.includes('秒') ? num * 1000 : unit.includes('小时') ? num * 3600000 : num * 60000;
    return { intervalMs: ms, intervalText: `每${num}${unit}` };
  }
  m = desc.match(/(?:每隔|每)\s*(小时|分钟|分)/);
  if (m) {
    const unit = m[1];
    const ms = unit.includes('小时') ? 3600000 : 60000;
    return { intervalMs: ms, intervalText: `每${unit}` };
  }
  return null;
}

// 检测定时提醒意图：X分钟后提醒我yyy / 下午3点提醒我yyy / 明天9点提醒我yyy
function detectReminderIntent(message) {
  const text = (message || '').trim();
  // 带时间的提醒
  const m = text.match(/(.+?)\s*(?:提醒我|提醒一下|叫我|喊我)\s*(.*)/);
  if (m) {
    // m[1] 是时间部分，m[2] 是事件
    const timeStr = m[1].replace(/(?:帮我|请|帮我设置|设个|设置一个|定个|定一个|创建|建一个)/g, '').trim();
    const event = (m[2] || '').replace(/[，。！？.]/g, '').trim();
    if (timeStr && event) {
      const ts = parseChineseTime(timeStr);
      if (ts) return { action: 'reminder', timeStr, event, ts };
    }
  }
  return null;
}

// ============ 循环提醒系统 ============
// 每隔X分钟/小时提醒，久坐提醒，喝水提醒等
const recurringReminders = []; // { id, text, intervalMs, timer, active }
let reminderSeq = 0;

function detectRecurringIntent(message) {
  const text = (message || '').trim();
  // 每隔X分钟/小时提醒我yyy
  let m = text.match(/(?:每隔|每)\s*(\d+)\s*(分钟|小时|分|秒)(?:提醒我|提醒我一下|提醒)?\s*(.*)/);
  if (m) {
    const num = parseInt(m[1]);
    const unit = m[2];
    const event = (m[3] || '').replace(/[，。！？.]/g, '').trim() || '该活动了';
    const ms = unit.includes('秒') ? num * 1000 : unit.includes('小时') ? num * 3600000 : num * 60000;
    return { action: 'recurring', event, intervalMs: ms, intervalText: `每${num}${unit}` };
  }
  // 每小时提醒我yyy（无数字，默认1）
  m = text.match(/(?:每隔|每)\s*(小时|分钟|分)(?:提醒我|提醒我一下|提醒)?\s*(.*)/);
  if (m) {
    const unit = m[1];
    const event = (m[2] || '').replace(/[，。！？.]/g, '').trim() || '该活动了';
    const ms = unit.includes('小时') ? 3600000 : 60000;
    return { action: 'recurring', event, intervalMs: ms, intervalText: `每${unit}` };
  }
  // 久坐提醒 / 喝水提醒（默认间隔）
  if (/(久坐提醒|起身提醒|起来活动)/.test(text)) {
    return { action: 'recurring', event: '该起来活动活动啦，久坐伤身喵！', intervalMs: 45 * 60 * 1000, intervalText: '每45分钟' };
  }
  if (/(喝水提醒|喝水|该喝水了)/.test(text) && /提醒|提醒我|开启|打开|设置/.test(text)) {
    return { action: 'recurring', event: '该喝水啦，记得多喝水喵！', intervalMs: 60 * 60 * 1000, intervalText: '每1小时' };
  }
  // 取消循环提醒
  if (/(取消|关闭|停止|关掉).*(提醒|喝水提醒|久坐提醒)/.test(text)) {
    return { action: 'cancel_recurring' };
  }
  return null;
}

function addRecurringReminder(event, intervalMs, intervalText) {
  const id = ++reminderSeq;
  const reminder = { id, type: 'interval', text: event, intervalMs, intervalText, active: true, timer: null };
  reminder.timer = setInterval(() => {
    try {
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('tray:action', '__recurring_reminder__');
        mainWindow.webContents.send('recurring:remind', { text: event, intervalText });
      }
    } catch (e) {}
  }, intervalMs);
  recurringReminders.push(reminder);
  console.log(`[pet:reminder] 添加循环提醒(interval): ${event} ${intervalText}`);
  return reminder;
}

// 添加定时提醒（每周几 + 时间）
// weekdays: [0,1,2,3,4,5,6] 0=周日 1=周一...6=周六; timeStr: "HH:MM"
function addWeeklyReminder(event, weekdays, timeStr) {
  const id = ++reminderSeq;
  const dayNames = ['日','一','二','三','四','五','六'];
  const dayStr = weekdays.slice().sort().map(d => '周' + dayNames[d]).join('、');
  const intervalText = `${dayStr} ${timeStr}`;
  const reminder = { id, type: 'weekly', text: event, weekdays: weekdays.slice(), timeStr, intervalText, active: true, timer: null };
  function scheduleNext() {
    const now = new Date();
    const [hh, mm] = timeStr.split(':').map(n => parseInt(n));
    let next = new Date(now);
    next.setHours(hh, mm, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    for (let i = 0; i < 8; i++) {
      if (weekdays.includes(next.getDay())) break;
      next.setDate(next.getDate() + 1);
    }
    const delay = next.getTime() - now.getTime();
    reminder.timer = setTimeout(() => {
      try {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('tray:action', '__recurring_reminder__');
          mainWindow.webContents.send('recurring:remind', { text: event, intervalText });
        }
      } catch (e) {}
      scheduleNext();
    }, delay);
  }
  scheduleNext();
  recurringReminders.push(reminder);
  console.log(`[pet:reminder] 添加定时提醒(weekly): ${event} ${intervalText}`);
  return reminder;
}

function cancelAllRecurring() {
  recurringReminders.forEach((r) => { if (r.timer) { clearInterval(r.timer); clearTimeout(r.timer); } });
  recurringReminders.length = 0;
  console.log('[pet:reminder] 已取消所有循环提醒');
}

// ============ 系统操作意图（音量/锁屏/截屏/打开网页）============
function detectSystemOpIntent(message) {
  const text = (message || '').trim();
  // 音量
  if (/(调大|调高|大一点|大声点|音量大).*(音量|声音)/.test(text) || /音量.*(调大|调高|大一点|大声)/.test(text) || /调大音量/.test(text)) {
    return { action: 'volume_up' };
  }
  if (/(调小|调低|小一点|小声点|音量小).*(音量|声音)/.test(text) || /音量.*(调小|调低|小一点|小声)/.test(text) || /调小音量/.test(text)) {
    return { action: 'volume_down' };
  }
  if (/(静音|取消声音|关掉声音|声音关掉)/.test(text)) {
    return { action: 'volume_mute' };
  }
  // 锁屏
  if (/(锁屏|锁定屏幕|锁定电脑|锁电脑)/.test(text)) {
    return { action: 'lock' };
  }
  // 截屏
  if (/(截屏|截图|截个图|截个屏)/.test(text)) {
    return { action: 'screenshot' };
  }
  // 打开网页/搜索
  let m = text.match(/(?:帮我|请)?(?:打开|访问)(百度|谷歌|google|github|bilibili|b站|知乎|微博|淘宝|京东|网易云|youtube|微博)/i);
  if (m) return { action: 'open_url', site: m[1] };
  m = text.match(/(?:帮我|请)?(?:用浏览器)?(?:搜|搜索|查一下|查查)(一下)?\s*(.+)/);
  if (m && m[2] && m[2].length < 50) return { action: 'web_search', query: m[2].replace(/[，。！？.]/g, '').trim() };
  return null;
}

const SITE_URLS = {
  '百度': 'https://www.baidu.com', 'baidu': 'https://www.baidu.com',
  '谷歌': 'https://www.google.com', 'google': 'https://www.google.com',
  'github': 'https://github.com', 'Github': 'https://github.com',
  'bilibili': 'https://www.bilibili.com', 'b站': 'https://www.bilibili.com',
  '知乎': 'https://www.zhihu.com', '微博': 'https://weibo.com',
  '淘宝': 'https://www.taobao.com', '京东': 'https://www.jd.com',
  '网易云': 'https://music.163.com', 'youtube': 'https://www.youtube.com',
  'YouTube': 'https://www.youtube.com',
  // AI 网站
  'kimi': 'https://kimi.moonshot.cn', 'Kimi': 'https://kimi.moonshot.cn',
  'chatgpt': 'https://chat.openai.com', 'ChatGPT': 'https://chat.openai.com',
  'claude': 'https://claude.ai', 'Claude': 'https://claude.ai',
  '通义千问': 'https://tongyi.aliyun.com', '通义': 'https://tongyi.aliyun.com',
  '文心一言': 'https://yiyan.baidu.com', '文心': 'https://yiyan.baidu.com',
  'deepseek': 'https://chat.deepseek.com', 'DeepSeek': 'https://chat.deepseek.com',
  '豆包': 'https://www.doubao.com', 'doubao': 'https://www.doubao.com',
  '智谱清言': 'https://chatglm.cn', '智谱': 'https://chatglm.cn',
  '腾讯文档': 'https://docs.qq.com', '飞书': 'https://www.feishu.cn',
  '钉钉': 'https://www.dingtalk.com', '微信网页版': 'https://wx.qq.com',
  '小红书': 'https://www.xiaohongshu.com', '抖音': 'https://www.douyin.com',
  '掘金': 'https://juejin.cn', 'CSDN': 'https://www.csdn.net',
  'stackoverflow': 'https://stackoverflow.com', 'StackOverflow': 'https://stackoverflow.com',
};

async function executeSystemOp(op) {
  try {
    switch (op.action) {
      case 'volume_up':
        await runPowerShellAsync('$w=New-Object -ComObject WScript.Shell; $w.SendKeys([char]175)', 5000);
        return '已调大音量';
      case 'volume_down':
        await runPowerShellAsync('$w=New-Object -ComObject WScript.Shell; $w.SendKeys([char]174)', 5000);
        return '已调小音量';
      case 'volume_mute':
        await runPowerShellAsync('$w=New-Object -ComObject WScript.Shell; $w.SendKeys([char]173)', 5000);
        return '已切换静音';
      case 'lock':
        // 同步 execSync 会把主进程堵住；锁屏本身很快，但没有理由为此冻结整个 UI
        await new Promise((resolve, reject) => {
          exec('rundll32.exe user32.dll,LockWorkStation', { timeout: 5000 }, (err) => (err ? reject(err) : resolve()));
        });
        return '已锁屏';
      case 'screenshot': {
        // 用 PowerShell + .NET 截全屏，保存到桌面
        const desktop = path.join(process.env.USERPROFILE, 'Desktop');
        const fname = `截图_${Date.now()}.png`;
        const fp = path.join(desktop, fname);
        const ps = `Add-Type -AssemblyName System.Windows.Forms; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${fp.replace(/'/g, "''")}'); $g.Dispose(); $bmp.Dispose()`;
        const { err } = await runPowerShellAsync(ps, 10000);
        if (err) throw err;
        return `已截图，保存在桌面：${fname}`;
      }
      case 'open_url': {
        const url = SITE_URLS[op.site] || SITE_URLS[op.site.toLowerCase()];
        if (url) { shell.openExternal(url); return `已打开 ${op.site}`; }
        return `没找到 ${op.site} 的网址`;
      }
      case 'web_search': {
        const url = `https://www.baidu.com/s?wd=${encodeURIComponent(op.query)}`;
        shell.openExternal(url);
        return `已用百度搜索：${op.query}`;
      }
    }
  } catch (e) {
    return '操作失败：' + e.message;
  }
  return null;
}

// 搜索文件 IPC（返回匹配列表，由前端弹出选择框）
ipcMain.handle('file:search', async (_event, sourceName, searchDir) => {
  // 尝试从 sourceName 提取盘符/文件夹
  const driveInName = sourceName.match(/^([A-Za-z])盘的?(.+)$/);
  const folderInName = sourceName.match(/^(桌面|下载|文档|图片)的?(上)?的?(.+)$/);
  if (/^[A-Za-z]:[\\/]/.test(sourceName)) {
    // 完整路径
    if (fs.existsSync(sourceName) && fs.statSync(sourceName).isFile()) {
      return [{ name: path.basename(sourceName), path: sourceName, dir: path.dirname(sourceName) }];
    }
    dir = path.dirname(sourceName);
    keyword = path.basename(sourceName);
  } else if (driveInName) {
    dir = `${driveInName[1].toUpperCase()}:\\`;
    keyword = driveInName[2];
  } else if (folderInName) {
    dir = resolvePath(folderInName[1]);
    keyword = folderInName[3];
  }
  if (!dir && searchDir) dir = resolvePath(searchDir);
  if (!dir) return [];

  console.log(`[pet:file] 搜索 dir=${dir} keyword="${keyword}"`);
  const results = searchFiles(dir, keyword);
  console.log(`[pet:file] 找到 ${results.length} 个匹配`);
  return results;
});

// 执行文件复制/移动 IPC
ipcMain.handle('file:exec', async (_event, action, srcPath, targetDir) => {
  try {
    const fileName = path.basename(srcPath);
    const destPath = targetDir ? path.join(targetDir, fileName) : null;
    if (action === 'copy') {
      fs.copyFileSync(srcPath, destPath);
      console.log(`[pet:file] 复制 ${srcPath} → ${destPath}`);
      return { success: true, dest: destPath };
    } else if (action === 'move') {
      fs.renameSync(srcPath, destPath);
      console.log(`[pet:file] 移动 ${srcPath} → ${destPath}`);
      return { success: true, dest: destPath };
    } else if (action === 'delete') {
      fs.unlinkSync(srcPath);
      console.log(`[pet:file] 删除 ${srcPath}`);
      return { success: true, dest: null };
    }
    return { success: false, error: '未知操作' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ============ 记忆系统 IPC ============
// 查看小橘记住的关于主人的信息
ipcMain.handle('memory:get', () => {
  return { facts: memory.facts || [], updatedAt: memory.updatedAt };
});

// 清空记忆
ipcMain.handle('memory:clear', () => {
  memory = { facts: [], updatedAt: new Date().toISOString() };
  saveMemory();
  console.log('[pet:memory] 记忆已清空');
  return { success: true };
});

// 手动添加一条记忆
ipcMain.handle('memory:add', (_event, text) => {
  if (!text) return { success: false };
  const f = String(text).trim();
  if (!memory.facts.some((e) => e.text === f)) {
    memory.facts.push({ text: f, time: new Date().toISOString() });
    saveMemory();
    console.log(`[pet:memory] 手动记住: ${f}`);
  }
  return { success: true };
});

// ============ 读取文件内容 IPC（拖拽文件时前端调用）============
ipcMain.handle('file:read', async (_event, filePath) => {
  const result = await readFileContent(filePath);
  return result;
});

// ============ 保存内容到文件 IPC（AI 输出 HTML 时可保存）============
ipcMain.handle('file:save', async (_event, content, suggestedName) => {
  try {
    const desktop = path.join(process.env.USERPROFILE, 'Desktop');
    const ts = Date.now();
    const fname = suggestedName || `小橘生成_${ts}.html`;
    const fp = path.join(desktop, fname);
    fs.writeFileSync(fp, content, 'utf8');
    console.log(`[pet:file] 已保存文件到桌面: ${fp}`);
    return { success: true, path: fp, name: fname };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 用默认程序打开文件（HTML 预览时用）
ipcMain.handle('file:open', (_event, filePath) => {
  try { shell.openPath(filePath); return { success: true }; } catch (e) { return { success: false }; }
});

// ============ 配置管理 IPC ============
ipcMain.handle('config:get', () => APP_CONFIG);
ipcMain.handle('config:save', (_event, cfg) => {
  const ok = saveConfig(cfg);
  if (ok) reloadConfig();
  return { success: ok };
});

// ============ 循环提醒 IPC ============
// 查看当前所有循环提醒
ipcMain.handle('reminder:list', () => {
  return recurringReminders.map((r) => ({ id: r.id, type: r.type || 'interval', text: r.text, intervalText: r.intervalText, intervalMs: r.intervalMs, active: r.active }));
});
// 取消所有循环提醒
ipcMain.handle('reminder:cancel', () => {
  cancelAllRecurring();
  return { success: true };
});
// 删除单个循环提醒
ipcMain.handle('reminder:delete', (_event, id) => {
  const idx = recurringReminders.findIndex((r) => r.id === id);
  if (idx >= 0) {
    if (recurringReminders[idx].timer) { clearInterval(recurringReminders[idx].timer); clearTimeout(recurringReminders[idx].timer); }
    recurringReminders.splice(idx, 1);
    console.log(`[pet:reminder] 删除提醒 id=${id}`);
    return { success: true };
  }
  return { success: false };
});
// 直接添加循环提醒（管理面板用，不经过对话）
ipcMain.handle('reminder:add', (_event, text, intervalMs, intervalText) => {
  addRecurringReminder(text, intervalMs, intervalText);
  return { success: true };
});
// 直接添加定时提醒（管理面板用，每周几+时间）
ipcMain.handle('reminder:addWeekly', (_event, text, weekdays, timeStr) => {
  addWeeklyReminder(text, weekdays, timeStr);
  return { success: true };
});

// ============ 天气查询（wttr.in，免认证，支持中文城市）============
// 天气码映射为中文描述
const WEATHER_CODE_MAP = {
  '113': '☀️ 晴', '116': '⛅ 多云', '119': '☁️ 阴', '122': '☁️ 浓阴',
  '143': '🌫️ 薄雾', '176': '🌧️ 小阵雨', '179': '🌨️ 小阵雪', '182': '🌨️ 阵雨夹雪',
  '185': '🌨️ 阵冻雨', '200': '⛈️ 雷阵雨', '227': '🌨️ 小雪', '230': '❄️ 暴雪',
  '248': '🌫️ 雾', '260': '🌫️ 冻雾', '263': '🌧️ 毛毛雨', '266': '🌧️ 小雨',
  '281': '🌧️ 冻毛毛雨', '284': '🌧️ 冻雨', '293': '🌧️ 局部阵雨', '296': '🌧️ 小雨',
  '299': '🌧️ 中阵雨', '302': '🌧️ 中雨', '305': '🌧️ 大阵雨', '308': '🌧️ 大雨',
  '311': '🌧️ 特大阵雨', '314': '🌧️ 冻阵雨', '317': '🌧️ 雨夹雪', '320': '🌨️ 阵雪',
  '323': '🌨️ 小阵雪', '326': '🌨️ 中阵雪', '329': '🌨️ 大阵雪', '332': '❄️ 暴雪',
  '335': '❄️ 大暴雪', '338': '❄️ 特大暴雪', '350': '🌧️ 冰粒', '353': '🌧️ 小阵雨',
  '356': '🌧️ 中阵雨', '359': '⛈️ 大阵雨', '362': '🌨️ 小阵雪', '365': '🌨️ 中阵雪',
  '368': '🌨️ 小雪', '371': '🌨️ 大雪', '374': '🌨️ 阵雨夹雪', '377': '🌨️ 阵冻雨',
  '386': '⛈️ 雷阵雨', '389': '⛈️ 雷暴大雨', '392': '⛈️ 雷阵雪', '395': '⛈️ 雷暴大雪',
};

// 天气缓存：20 分钟内重复查询走缓存，避免反复请求
const WEATHER_CACHE_TTL = 20 * 60 * 1000; // 20 分钟
const weatherCache = {}; // { [city]: { data, fetchedAt } }

ipcMain.handle('weather:get', async (_event, city, forceRefresh = false) => {
  const weatherCity = (APP_CONFIG.weather && APP_CONFIG.weather.city) || city || '南京';
  // 命中缓存且未过期则直接返回
  const cached = weatherCache[weatherCity];
  const now = Date.now();
  if (!forceRefresh && cached && (now - cached.fetchedAt) < WEATHER_CACHE_TTL) {
    console.log(`[pet:weather] 命中缓存 ${weatherCity}，距今 ${Math.round((now - cached.fetchedAt) / 1000)}s`);
    return { ...cached.data, cached: true, cachedAt: cached.fetchedAt };
  }

  try {
    const url = `https://wttr.in/${encodeURIComponent(weatherCity)}?format=j1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'zh' } });
    if (!res.ok) return { error: `天气服务返回 ${res.status}` };
    const j = await res.json();
    const c = j.current_condition?.[0] || {};
    const w = j.weather?.[0] || {};
    const w1 = j.weather?.[1] || {};
    const code = c.weatherCode || '116';
    const desc = WEATHER_CODE_MAP[code] || c.weatherDesc?.[0]?.value || '多云';
    const data = {
      city: j.nearest_area?.[0]?.areaName?.[0]?.value || city,
      desc,
      tempC: c.temp_C,
      feelsC: c.FeelsLikeC,
      humidity: c.humidity,
      windKmph: c.windspeedKmph,
      windDir: c.winddir16Point,
      todayMin: w.mintempC,
      todayMax: w.maxtempC,
      tomorrowMin: w1.mintempC,
      tomorrowMax: w1.maxtempC,
    };
    // 写入缓存
    weatherCache[city] = { data, fetchedAt: now };
    return { ...data, cached: false, cachedAt: now };
  } catch (err) {
    console.warn('[pet] 天气查询异常:', err.message);
    // 查询失败时若有旧缓存也返回（容灾）
    if (cached) { console.log('[pet:weather] 查询失败，使用旧缓存'); return { ...cached.data, cached: true, cachedAt: cached.fetchedAt, stale: true }; }
    return { error: '天气查询失败：' + err.message };
  }
});

// AI 对话请求：流式调用大模型，失败回退本地拟人回复
ipcMain.handle('chat:request', async (event, message) => {
  // 大模型 key 缺失 → 直接返回提示
  if (!ARK_API_KEY) {
    return { reply: '喵…还没配置大模型 API Key 呢！\n\n请右键点我 → **⚙️ 设置**，填入：\n- API Base URL（如 `https://api.openai.com/v1`）\n- API Key\n- 模型名（如 `gpt-4o-mini`）\n\n保存后就能跟我聊天啦～' };
  }
  // 检测拖拽文件内容标记 → 剥离标记，跳过意图识别
  let skipIntent = false;
  if (message.startsWith('__SKIP_INTENT__')) {
    skipIntent = true;
    message = message.replace('__SKIP_INTENT__', '');
    console.log('[pet:chat] 检测到拖拽文件内容，跳过意图识别');
  }
  console.log(`[pet:chat] 收到消息: "${message.slice(0, 50)}${message.length > 50 ? '...' : ''}"`);
  const t0 = Date.now();
  const sender = event.sender;

  // ===== LLM 意图路由（替代写死的正则规则）=====
  let intentContext = '';

  // 前置：LLM 识别意图（拖拽文件内容跳过，直接聊天）
  const intentResult = skipIntent ? null : await (async () => {
    try { sender.send('chat:status', { status: 'thinking' }); } catch (e) {}
    const r = await detectIntentByLLM(message);
    try { sender.send('chat:status', { status: 'thinking_done' }); } catch (e) {}
    return r;
  })();

  if (intentResult && intentResult.intent && intentResult.intent !== 'chat') {
    const it = intentResult.intent;

    // —— 打开应用 ——
    if (it === 'open_app') {
      const appName = intentResult.app || '';
      console.log(`[pet:chat] LLM意图-打开应用: ${appName}`);
      const exePath = await findApp(appName);
      if (exePath) {
        try { shell.openPath(exePath); } catch (e) {}
        intentContext = `主人刚才让你帮忙打开"${appName}"，你已经帮主人打开了，路径是 ${exePath}。请简短地告诉主人已经打开好了。`;
      } else {
        intentContext = `主人刚才让你帮忙打开"${appName}"，但你在系统里没找到这个应用。请告诉主人没找到，问问是不是名字不对或者没安装。`;
      }
    }

    // —— 找文件 ——
    else if (it === 'search_file') {
      const keyword = intentResult.keyword || '';
      const wantOpen = !!intentResult.open;
      console.log(`[pet:file] LLM意图-找文件: "${keyword}" (打开=${wantOpen})`);
      if (keyword) {
        try { sender.send('chat:status', { status: 'searching' }); } catch (e) {}
        const results = await searchFilesEverywhere(keyword);
        try { sender.send('chat:status', { status: 'searching_done' }); } catch (e) {}
        if (results.length === 0) {
          intentContext = `主人想找名为"${keyword}"的文件，但你在整个系统里都没找到。请告诉主人没找到这个文件。`;
        } else {
          const fileList = results.slice(0, 10).map((r, i) => `${i + 1}. ${r.name}\n   路径：${r.path}`).join('\n');
          let openNote = '';
          if (wantOpen && results.length >= 1) {
            try {
              shell.openPath(results[0].path);
              openNote = `主人还想让你打开这个文件，你已经帮主人打开了第一个：${results[0].name}（${results[0].path}）。`;
              console.log(`[pet:file] 已打开文件: ${results[0].path}`);
            } catch (e) {}
          }
          intentContext = `主人想找名为"${keyword}"的文件，你帮主人找到了 ${results.length} 个匹配结果：\n${fileList}\n\n${openNote}请把这些结果整理后告诉主人，用列表格式。`;
          console.log(`[pet:file] 找到 ${results.length} 个匹配`);
        }
      }
    }

    // —— 读取文件并分析（基于文件内容生成总结/章节结构/HTML）——
    else if (it === 'read_and_analyze') {
      const keyword = intentResult.keyword || '';
      const task = intentResult.task || '分析这个文件';
      console.log(`[pet:file] LLM意图-读取分析: "${keyword}" 任务="${task}"`);
      if (keyword) {
        try { sender.send('chat:status', { status: 'searching' }); } catch (e) {}
        const results = await searchFilesEverywhere(keyword);
        try { sender.send('chat:status', { status: 'searching_done' }); } catch (e) {}
        if (results.length === 0) {
          intentContext = `主人想基于名为"${keyword}"的文件做任务："${task}"，但你在整个系统里都没找到这个文件。请告诉主人没找到。`;
        } else {
          // 读取第一个匹配文件的内容
          const filePath = results[0].path;
          const fileName = results[0].name;
          console.log(`[pet:file] 读取文件: ${filePath}`);
          try { sender.send('chat:status', { status: 'reading' }); } catch (e) {}
          const fileResult = await readFileContent(filePath);
          try { sender.send('chat:status', { status: 'reading_done' }); } catch (e) {}
          if (fileResult.ok) {
            intentContext = `主人想基于文件"${fileName}"（${fileResult.ext} 格式）完成任务："${task}"。以下是文件的完整内容，请基于文件内容来完成主人的任务。

【文件内容】
${fileResult.content}

【输出要求】
根据任务复杂度选择最合适的输出格式：
1. 简单问答 → 直接文字回复
2. 中等复杂度（总结、要点提炼）→ 用 Markdown 格式回复
3. 复杂任务（章节结构、报告、分析报告、方案对比、可视化）→ 输出完整的 HTML 文档代码，用 \`\`\`html 代码块包裹。HTML 要包含基本样式（字体、颜色、布局），让主人可以直接保存为网页查看。

无论哪种格式，都要基于上面的文件内容来回答，不要编造文件里没有的信息。`;
            console.log(`[pet:file] 文件读取成功 (${fileResult.ext})，内容长度=${fileResult.content.length}`);
          } else {
            intentContext = `主人想基于文件"${fileName}"做任务"${task}"，但你读取文件内容失败了：${fileResult.error}。请告诉主人读取失败，建议换个格式。`;
            console.log(`[pet:file] 文件读取失败: ${fileResult.error}`);
          }
        }
      }
    }

    // —— 读取网页内容并分析 ——
    else if (it === 'web_read') {
      let url = intentResult.url || '';
      const task = intentResult.task || '总结这个网页的内容';
      // 如果没有 url，尝试从原始消息里提取
      if (!url) {
        const urlMatch = message.match(/https?:\/\/[^\s<>"']+/);
        if (urlMatch) url = urlMatch[0];
      }
      console.log(`[pet:web] LLM意图-读取网页: url="${url}" task="${task}"`);
      if (url) {
        try { sender.send('chat:status', { status: 'reading' }); } catch (e) {}
        const webResult = await fetchWebPage(url);
        try { sender.send('chat:status', { status: 'reading_done' }); } catch (e) {}
        if (webResult.ok) {
          intentContext = `主人想基于网页内容完成任务："${task}"。以下是网页的正文内容，请基于内容来完成主人的任务。

【网页内容：${url}】
${webResult.content}

【输出要求】
根据任务复杂度选择最合适的输出格式：
1. 简单问答 → 直接文字回复
2. 中等复杂度（总结、要点提炼）→ 用 Markdown 格式回复
3. 复杂任务（章节结构、报告、分析报告、方案对比、可视化）→ 输出完整的 HTML 文档代码，用 \`\`\`html 代码块包裹。

无论哪种格式，都要基于上面的网页内容来回答，不要编造网页里没有的信息。`;
          console.log(`[pet:web] 网页读取成功，内容长度=${webResult.content.length}`);
        } else {
          intentContext = `主人想读取网页"${url}"并${task}，但你抓取网页失败了：${webResult.error}。请告诉主人读取失败，并建议直接复制网页正文发给你。`;
          console.log(`[pet:web] 网页读取失败: ${webResult.error}`);
        }
      } else {
        intentContext = `主人想读取一个网页，但没提供网址。请告诉主人：可以直接把网址发给我，或者把网页正文复制过来，我来帮你分析。`;
      }
    }

    // —— 文件操作（复制/移动/删除）——
    else if (it === 'file_op') {
      const action = intentResult.action; // copy | move | delete
      const source = intentResult.source || '';
      const target = intentResult.target || '';
      const actionText = { copy: '复制', move: '移动', delete: '删除' }[action];
      console.log(`[pet:file] LLM意图-文件操作: ${action} "${source}" → "${target}"`);

      let targetDir = null;
      if (target && action !== 'delete') {
        targetDir = resolvePath(target);
      }
      if (action === 'delete' || (targetDir && fs.existsSync(targetDir)) || action === 'delete') {
        // 解析源文件目录+关键词并搜索
        const srcResults = (function() {
          if (/^[A-Za-z]:[\\/]/.test(source)) {
            if (fs.existsSync(source) && fs.statSync(source).isFile()) {
              return [{ name: path.basename(source), path: source, dir: path.dirname(source) }];
            }
            return searchFiles(path.dirname(source), path.basename(source));
          }
          const driveInName = source.match(/^([A-Za-z])盘的?(.+)$/);
          const folderInName = source.match(/^(桌面|下载|文档|图片)的?(上)?的?(.+)$/);
          let dir = null, keyword = source;
          if (driveInName) { dir = `${driveInName[1].toUpperCase()}:\\`; keyword = driveInName[2]; }
          else if (folderInName) { dir = resolvePath(folderInName[1]); keyword = folderInName[3]; }
          else { dir = resolvePath('桌面'); }
          console.log(`[pet:file] 搜索 dir=${dir} keyword="${keyword}"`);
          return searchFiles(dir, keyword);
        })();

        if (srcResults.length === 0) {
          intentContext = `主人想把"${source}"${actionText}，但没找到匹配的文件。请告诉主人没找到这个文件。`;
        } else if (srcResults.length === 1 && action !== 'delete') {
          const r = srcResults[0];
          const fileName = path.basename(r.path);
          try {
            if (action === 'copy') fs.copyFileSync(r.path, path.join(targetDir, fileName));
            else fs.renameSync(r.path, path.join(targetDir, fileName));
            intentContext = `主人想把文件${actionText}，你已经帮主人完成了。文件"${fileName}"已${actionText}到"${target}"。请简短告诉主人已完成。`;
            console.log(`[pet:file] 直接执行 ${action}: ${r.path} → ${targetDir}`);
          } catch (e) {
            intentContext = `主人想操作文件，但失败了：${e.message}。请告诉主人操作失败。`;
          }
        } else {
          // 多个匹配 → 弹选择框；删除操作即使1个也弹确认（危险操作）
          try {
            sender.send('file:choose', {
              action, targetDir: targetDir || '', targetName: target || '删除', files: srcResults,
            });
          } catch (e) {}
          return { reply: `__FILE_CHOOSE__`, action, files: srcResults, targetDir };
        }
      } else if (target && !targetDir) {
        intentContext = `主人想把文件${actionText}到"${target}"，但这个目标路径找不到。请告诉主人路径不对。`;
      }
    }

    // —— 定时提醒 ——
    else if (it === 'reminder') {
      const timeDesc = intentResult.time_desc || '';
      const event = intentResult.event || '';
      const ts = parseChineseTime(timeDesc);
      console.log(`[pet:reminder] LLM意图-定时提醒: ${timeDesc} → "${event}"`);
      if (ts) {
        try { sender.send('reminder:create', { text: event, ts, timeStr: timeDesc }); } catch (e) {}
        const d = new Date(ts);
        const pad = (n) => String(n).padStart(2, '0');
        const timeLabel = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        intentContext = `主人刚才让你在"${timeDesc}"（即 ${timeLabel}）提醒他"${event}"，你已经记下了，到点会举牌提醒他。请简短地告诉主人已经设好了。`;
        console.log(`[pet:reminder] 已创建定时提醒: ${timeLabel} - ${event}`);
      } else {
        intentContext = `主人想设置一个提醒"${event}"，但你说的时间"${timeDesc}"没法识别。请告诉主人你没听懂时间，让他换个说法，比如"5分钟后""下午3点"。`;
      }
    }

    // —— 循环提醒 ——
    else if (it === 'recurring_reminder') {
      const event = intentResult.event || '该活动了';
      const intervalDesc = intentResult.interval_desc || '';
      console.log(`[pet:reminder] LLM意图-循环提醒: ${intervalDesc} → "${event}"`);
      const iv = parseInterval(intervalDesc);
      if (iv) {
        addRecurringReminder(event, iv.intervalMs, iv.intervalText);
        intentContext = `主人刚才让你${iv.intervalText}提醒他"${event}"，你已经设好了，会按这个频率定时提醒。请简短地告诉主人已经设好了，如需取消可以说"取消提醒"。`;
        console.log(`[pet:reminder] 已添加循环提醒: ${event} ${iv.intervalText}`);
      } else {
        intentContext = `主人想设置循环提醒"${event}"，但你说的时间间隔"${intervalDesc}"没法识别。请告诉主人你没听懂，让他换个说法，比如"每隔30分钟"。`;
      }
    }

    // —— 取消循环提醒 ——
    else if (it === 'cancel_reminder') {
      cancelAllRecurring();
      intentContext = `主人刚才让你取消所有循环提醒，你已经取消了。请告诉主人已取消所有定时循环提醒。`;
      console.log('[pet:reminder] 取消所有循环提醒');
    }

    // —— 系统操作 ——
    else if (it === 'system_op') {
      const action = intentResult.action || '';
      const detail = intentResult.detail || '';
      console.log(`[pet:sysop] LLM意图-系统操作: ${action} ${detail}`);
      const op = { action, site: detail, query: detail };
      const result_text = await executeSystemOp(op);
      if (result_text) {
        intentContext = `主人刚才让你执行系统操作，你已经完成了：${result_text}。请简短地告诉主人已完成。`;
      } else {
        intentContext = `主人想让你执行系统操作，但没能识别具体操作。请问主人想做什么。`;
      }
    }
  }

  const result = await llmChatStream(message, sender, intentContext);
  const dt = Date.now() - t0;
  if (result) {
    console.log(`[pet:chat] 大模型回复完成 (${dt}ms): "${result.reply.slice(0, 40)}..."`);
    // 后台静默提取用户画像（只对可能含个人信息的消息执行，省 API 调用）
    if (mightContainPersonalInfo(message) && result.reply) {
      extractMemory(message, result.reply).catch(() => {});
    }
    return result;
  }
  console.log(`[pet:chat] 大模型不可用，回退本地回复 (${dt}ms)`);
  // 有意图但大模型不可用时，直接返回意图结果
  if (intentContext) {
    if (intentContext.includes('没找到')) {
      return { reply: `喵…没找到"${intent.app}"这个应用，是不是名字不对或者还没安装呀？` };
    }
    return { reply: `喵～已经帮你打开${intent.app}啦！` };
  }
  return localChatReply(message);
});

// ============ 本地拟人回复（大模型不可用时的兜底）============
function localChatReply(message) {
  const text = (message || '').trim();
  const replies = {
    你好: ['喵~你好呀！见到你真开心！', '喵呜~今天也要元气满满哦！'],
    你好呀: ['喵~你好呀！见到你真开心！', '喵呜~今天也要元气满满哦！'],
    吃: ['喵！说到吃的我就来精神了！小鱼干小鱼干~', '咕噜噜…我肚子好像饿了呢…'],
    饿: ['喵呜…好饿好饿，快给我小鱼干嘛！', '饿饿，饭饭，喵呜~'],
    鱼: ['小鱼干！我最喜欢了！嗷呜~', '是小鱼干吗？快给我快给我！'],
    累: ['呼…那你歇会儿吧，我陪你趴着~', '辛苦啦，摸摸头，喵~'],
    晚安: ['喵…晚安，我也困了，一起睡吧~', '晚安喵~做个好梦哦~'],
    早: ['早上好喵！新的一天开始啦！', '喵早~今天天气真不错呢~'],
    喜欢: ['喵嘿嘿，我也喜欢你！贴贴~', '喵~你这么说我会害羞的啦！'],
    名字: ['我叫小橘！是一只橘猫哦~', '我是小橘喵~记住我的名字了嘛？'],
  };

  for (const key of Object.keys(replies)) {
    if (text.includes(key)) {
      const arr = replies[key];
      return { reply: arr[Math.floor(Math.random() * arr.length)] };
    }
  }

  // 默认回复
  const defaults = [
    `喵？"${text}"是什么意思呀？`,
    '喵呜~你说的话我努力理解中…',
    '喵~虽然听不太懂，但我会一直陪着你的！',
    '咕噜咕噜…（小橘歪了歪头）',
    '喵！要多摸摸我哦~',
  ];
  return { reply: defaults[Math.floor(Math.random() * defaults.length)] };
}

// ============ 应用生命周期 ============

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  isQuiting = true;
});

// 关闭窗口时最小化到托盘，而非退出
app.on('window-all-closed', (e) => {
  if (process.platform !== 'darwin') {
    // 阻止退出，隐藏到托盘
  }
});
