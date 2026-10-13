# main.js — Complete Definition Index

File: `D:\dsh_coding\project2\main.js` (7201 lines total)

> NOTE: The `grep`/`glob` tools failed with "ripgrep provider failure" in this session, so all six searches were performed by reading the entire file in chunks and matching each pattern by hand. Line numbers and content are taken verbatim from the file. Long lines are shown in full where practical; a few extremely long lines (system prompts) are abbreviated with `[…]`.

---

## 1. Function definitions — pattern `^(async )?function [A-Za-z]`

Lines that begin (column 0) with `function ` or `async function `. Nested/indented functions (`buildContextMenu`, `rebuildMenu`, `scheduleNext`, `scheduleNextDaily`, `scheduleNextWeekly`, `deepClean`) are indented and therefore do NOT match the `^`-anchored pattern.

| Line | Content |
|---:|---|
| 10 | `function runPowerShell(psScript, timeout = 10000) {` |
| 17 | `function runPowerShellAsync(psScript, timeout = 15000) {` |
| 35 | `function loadEnv() {` |
| 89 | `function needsSearch(message) {` |
| 101 | `function buildSearchQuery(message) {` |
| 132 | `async function fetchWithRetry(url, options, retries = 5, sender = null) {` |
| 160 | `async function isOnline() {` |
| 174 | `async function searchWeb(query, options = {}) {` |
| 244 | `function isAntiScrapeUrl(url) {` |
| 254 | `async function fetchWebPage(url) {` |
| 364 | `function getPetSystemPrompt() {` |
| 376 | `function validateDeliverable(reply) {` |
| 415 | `function loadConversationSummary() {` |
| 426 | `function saveConversationSummary(text) {` |
| 433 | `async function compactHistory(messagesToCompress) {` |
| 476 | `async function maybeCompactHistory() {` |
| 496 | `function loadMemory() {` |
| 512 | `function loadEmailContacts() {` |
| 516 | `function saveEmailContacts() {` |
| 520 | `function extractAndSaveContact(text) {` |
| 546 | `function findContactEmail(name) {` |
| 557 | `function saveMemory() {` |
| 565 | `function mightContainPersonalInfo(message) {` |
| 578 | `function isSensitiveInfo(text) {` |
| 594 | `async function extractMemory(userMessage, reply) {` |
| 924 | `function getPythonExe() {` |
| 941 | `function riskCheck(code) {` |
| 967 | `function extractMissingModule(stderr) {` |
| 979 | `async function autoInstallPip(pyExe, moduleName) {` |
| 1031 | `function getCodeTimeout(code) {` |
| 1043 | `async function runPythonCode(pyExe, code, workDir, timeoutMs) {` |
| 1090 | `async function runPowershellCode(code, workDir, timeoutMs) {` |
| 1129 | `async function executeTool(toolName, args, sender) {` |
| 1514 | `async function detectIntentByLLM(message, fileContentMode = false) {` |
| 1697 | `async function llmGenerateContent(userMessage, skillPrompt) {` |
| 1729 | `function describeToolAction(toolName, args) {` |
| 1787 | `function describeToolDone(toolName, result) {` |
| 1814 | `async function agentStreamLLM(messages, sender, withTools, toolsOverride) {` |
| 1892 | `async function agentChatStream(userMessage, sender, intentContext, isolatedContext = null) {` |
| 2067 | `async function llmChatStream(userMessage, sender, intentContext) {` |
| 2285 | `function createWindow() {` |
| 2394 | `function createTray() {` |
| 2483 | `function getStartupLnk() { return path.join(STARTUP_DIR, LNK_NAME); }` |
| 2485 | `function getAutoLaunch() {` |
| 2489 | `function setAutoLaunch(on) {` |
| 2562 | `function findAppInRegistry(name) {` |
| 2589 | `function findAppInShortcuts(name) {` |
| 2614 | `function walkDir(dir, ext, depth = 0) {` |
| 2632 | `function resolveShortcut(lnkPath) {` |
| 2641 | `function findApp(name) {` |
| 2660 | `function detectOpenIntent(message) {` |
| 2691 | `function resolvePath(name) {` |
| 2723 | `function searchFiles(dir, keyword, depth = 0, maxResults = 20) {` |
| 2747 | `function detectFileOpIntent(message) {` |
| 2776 | `function cleanFileKeyword(keyword) {` |
| 2794 | `function detectFileSearchIntent(message) {` |
| 2829 | `function searchFilesEverywhere(keyword) {` |
| 2875 | `async function readFileContent(filePath) {` |
| 2994 | `function parseChineseTime(text) {` |
| 3051 | `function parseInterval(desc) {` |
| 3070 | `function detectReminderIntent(message) {` |
| 3091 | `function detectRecurringIntent(message) {` |
| 3124 | `function addRecurringReminder(event, intervalMs, intervalText) {` |
| 3142 | `function addWeeklyReminder(event, weekdays, timeStr) {` |
| 3175 | `function cancelAllRecurring() {` |
| 3220 | `function saveScheduledTasks() {` |
| 3222 | `function getDummySender() {` |
| 3226 | `function sender_safe_send(channel, data) {` |
| 3233 | `function loadScheduledTasks() {` |
| 3252 | `async function executeScheduledTask(task) {` |
| 3331 | `function scheduleTaskTimer(task) {` |
| 3366 | `function parseSchedule(scheduleStr) {` |
| 3390 | `function detectSystemOpIntent(message) {` |
| 3443 | `function executeSystemOp(op) {` |
| 3612 | `function getSaveDir() {` |
| 3625 | `function getMeetingDir() {` |
| 3907 | `function captureScreenBase64() {` |
| 3946 | `async function captureFullScreenObject() {` |
| 3959 | `async function startRegionCapture() {` |
| 4062 | `function closeScreenshotWin() {` |
| 4070 | `async function cropBase64Image(dataUrl, x, y, w, h) {` |
| 4441 | `function ensureSkillsDir() {` |
| 4728 | `function ensureBuiltinSkills() {` |
| 4750 | `function loadSkillStoreUrl() {` |
| 4759 | `async function fetchSkillStoreIndex() {` |
| 4774 | `async function searchRemoteSkills(userMessage) {` |
| 4807 | `async function downloadAndInstallSkill(skill) {` |
| 4827 | `function parseSkillMd(content) {` |
| 4849 | `function loadAllSkills() {` |
| 4869 | `function getSkillsSummary() {` |
| 4902 | `function loadMcpConfig() {` |
| 4906 | `function saveMcpConfig() {` |
| 4914 | `function importClaudeMcpJson(jsonText) {` |
| 4946 | `function nextMcpId() { return ++mcpRequestId; }` |
| 4952 | `async function mcpStreamableCall(serverUrl, method, params = {}, isNotification = false) {` |
| 4992 | `async function ensureSseSession(serverUrl) {` |
| 5071 | `function cleanupSseSession(serverUrl) {` |
| 5084 | `async function mcpSseCall(serverUrl, method, params = {}) {` |
| 5139 | `function parseSseResponse(text) {` |
| 5155 | `async function tryStreamableConnect(url) {` |
| 5178 | `async function mcpStreamableCallWithRetry(serverUrl, method, params = {}, maxRetries = 3) {` |
| 5197 | `async function trySseConnect(url) {` |
| 5256 | `function sanitizeToolName(serverName, toolName) {` |
| 5262 | `async function connectMcpServer(server) {` |
| 5330 | `async function connectAllMcpServers() {` |
| 5351 | `async function callMcpTool(tool, args) {` |
| 5405 | `function sanitizeToolSchema(schema) {` |
| 5426 | `function getMcpToolDefinitions() {` |
| 5740 | `function loadImaConfig() {` |
| 5744 | `function saveImaConfig(cfg) {` |
| 5751 | `function loadEmailConfig() {` |
| 5755 | `function saveEmailConfig(cfg) {` |
| 5774 | `function getEmailPreset(email) {` |
| 5781 | `async function sendEmail(to, subject, body, isHtml = false) {` |
| 5837 | `async function readInbox(maxCount = 5) {` |
| 5958 | `async function imaApi(apiPath, body) {` |
| 6064 | `async function findOrCreateMeetingFolder() {` |
| 6125 | `async function findMeetingFolderWithDebug() {` |
| 6143 | `async function imaUploadMarkdown(title, content) {` |
| 6451 | `async function fetchWeatherData(city) {` |
| 7144 | `function localChatReply(message) {` |

**Total: 109 function definitions at column 0.**

---

## 2. Top-level constants — pattern `^(const|let) [A-Z_]+ =`

Only declarations whose variable name is all-uppercase (letters/underscores) match. camelCase names (`isDev`, `mainWindow`, `pdfParse`, `mcpConfig`, `skillsDir`, etc.) do NOT match.

| Line | Content |
|---:|---|
| 55 | `const ENV = loadEnv();` |
| 57 | `const ARK_API_BASE = ENV.ARK_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3';` |
| 58 | `const ARK_API_KEY = ENV.ARK_API_KEY || 'YOUR_ARK_API_KEY';` |
| 59 | `const ARK_MODEL = ENV.ARK_MODEL || 'glm-5-2-260617';` |
| 61 | `const TAVILY_API_KEY = ENV.TAVILY_API_KEY || 'YOUR_TAVILY_API_KEY';` |
| 64 | `const JINA_API_KEY = ENV.JINA_API_KEY || 'YOUR_JINA_API_KEY';` |
| 67 | `const VISION_API_BASE = ENV.VISION_API_BASE || 'https://api.siliconflow.cn/v1';` |
| 68 | `const VISION_API_KEY = ENV.VISION_API_KEY || 'YOUR_VISION_API_KEY';` |
| 69 | `const VISION_MODEL = ENV.VISION_MODEL || 'zai-org/GLM-4.5V';` |
| 73 | `const SEARCH_KEYWORDS = [` |
| 129 | `const SEARCH_CACHE_TTL = 5 * 60 * 1000; // 5分钟` |
| 230 | `const ANTI_SCRAPE_DOMAINS = [` |
| 322 | `const PET_SYSTEM_PROMPT_BASE = \`你是一只名叫"小橘"的桌面宠物橘猫 […]` (long multi-line template literal) |
| 373 | `const MAX_HISTORY = 20;` |
| 406 | `const COMPACT_THRESHOLD = 16;` |
| 407 | `const KEEP_RECENT = 6;` |
| 412 | `const SUMMARY_FILE = path.join(app.getPath('userData'), 'conversation-summary.json');` |
| 493 | `const MEMORY_FILE = path.join(app.getPath('userData'), 'pet-memory.json');` |
| 509 | `const CONTACTS_FILE = path.join(app.getPath('userData'), 'email-contacts.json');` |
| 656 | `const TOOL_DEFINITIONS = [` |
| 1726 | `const MAX_TOOL_ROUNDS = 15; // 异常兜底上限（防死循环），正常由模型自判完成` |
| 2481 | `const STARTUP_DIR = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');` |
| 2482 | `const LNK_NAME = '小橘猫缘缘.lnk';` |
| 2518 | `const APP_ALIASES = {` |
| 2544 | `const SYSTEM_APPS = {` |
| 3184 | `const SCHEDULED_TASKS_FILE = path.join(app.getPath('userData'), 'scheduled-tasks.json');` |
| 3185 | `const SCHEDULED_SCRIPTS_DIR = path.join(getSaveDir(), 'python_output', 'scheduled');` |
| 3418 | `const SITE_URLS = {` |
| 3843 | `const AVATAR_DIR = path.join(app.getPath('userData'), 'avatars');` |
| 4446 | `const BUILTIN_DOC_SKILLS = {` |
| 4747 | `const SKILL_STORE_DEFAULT_URL = 'https://raw.githubusercontent.com/duansihang/xiaoju-skills/main/index.json';` |
| 4898 | `const MCP_CONFIG_FILE = path.join(app.getPath('userData'), 'mcp-config.json');` |
| 5761 | `const EMAIL_PRESETS = {` |
| 6384 | `const WEATHER_CODE_MAP = {` |
| 6400 | `const WIND_DIR_MAP = {` |
| 6408 | `const WEATHER_CACHE_TTL = 20 * 60 * 1000; // 20 分钟` |
| 6412 | `const CITY_CODES = {` |

**Total: 37 top-level ALL-CAPS constants.**

---

## 3. IPC handlers — pattern `ipcMain\.handle\(`

These are `ipcMain.handle(...)` registrations (request/response). Note: `ipcMain.on(...)` registrations exist too (L2457 `set-ignore-mouse`, L4030 `screenshot:region`, L4053 `screenshot:cancel`, L5659 `choice:result`) but do NOT match this pattern.

| Line | Content |
|---:|---|
| 2464 | `ipcMain.handle('get-screen-bounds', () => {` |
| 2470 | `ipcMain.handle('get-window-position', () => {` |
| 2476 | `ipcMain.handle('move-window', (_event, x, y) => {` |
| 2513 | `ipcMain.handle('autolaunch:get', () => getAutoLaunch());` |
| 2514 | `ipcMain.handle('autolaunch:set', (_event, on) => setAutoLaunch(!!on));` |
| 2674 | `ipcMain.handle('app:open', async (_event, name) => {` |
| 3485 | `ipcMain.handle('file:search', async (_event, sourceName, searchDir) => {` |
| 3513 | `ipcMain.handle('file:exec', async (_event, action, srcPath, targetDir) => {` |
| 3538 | `ipcMain.handle('memory:get', () => {` |
| 3543 | `ipcMain.handle('memory:clear', () => {` |
| 3551 | `ipcMain.handle('memory:add', (_event, text) => {` |
| 3563 | `ipcMain.handle('memory:delete', (_event, index) => {` |
| 3574 | `ipcMain.handle('memory:update', (_event, index, newText) => {` |
| 3586 | `ipcMain.handle('file:read', async (_event, filePath) => {` |
| 3592 | `ipcMain.handle('file:save', async (_event, content, suggestedName) => {` |
| 3635 | `ipcMain.handle('meeting:saveAudio', async (_event, arrayBuffer, filename) => {` |
| 3650 | `ipcMain.handle('meeting:transcribe', async (_event, audioPath) => {` |
| 3708 | `ipcMain.handle('meeting:summary', async (event, transcriptText) => {` |
| 3784 | `ipcMain.handle('meeting:saveSummary', async (_event, content, audioPath) => {` |
| 3812 | `ipcMain.handle('file:getSaveDir', () => getSaveDir());` |
| 3813 | `ipcMain.handle('file:setSaveDir', (_event, dir) => {` |
| 3821 | `ipcMain.handle('file:chooseDir', async () => {` |
| 3833 | `ipcMain.handle('file:open', (_event, filePath) => {` |
| 3838 | `ipcMain.handle('file:showInFolder', (_event, filePath) => {` |
| 3845 | `ipcMain.handle('avatar:save', (_event, type, base64) => {` |
| 3869 | `ipcMain.handle('avatar:load', () => {` |
| 3890 | `ipcMain.handle('avatar:delete', (_event, type) => {` |
| 3930 | `ipcMain.handle('screenshot:capture', () => {` |
| 4099 | `ipcMain.handle('screenshot:region', async () => {` |
| 4109 | `ipcMain.handle('chat:vision', async (event, images, question) => {` |
| 4876 | `ipcMain.handle('skills:list', () => {` |
| 4881 | `ipcMain.handle('skillstore:getUrl', () => skillStoreUrl);` |
| 4882 | `ipcMain.handle('skillstore:setUrl', (_event, url) => {` |
| 4887 | `ipcMain.handle('skillstore:search', async (_event, query) => {` |
| 4890 | `ipcMain.handle('skillstore:install', async (_event, skill) => {` |
| 4893 | `ipcMain.handle('skillstore:list', async () => {` |
| 5438 | `ipcMain.handle('mcp:getConfig', () => mcpConfig);` |
| 5439 | `ipcMain.handle('mcp:saveConfig', (_event, cfg) => {` |
| 5446 | `ipcMain.handle('mcp:connect', async () => {` |
| 5450 | `ipcMain.handle('mcp:tools', () => {` |
| 5454 | `ipcMain.handle('mcp:importJson', (_event, jsonText) => {` |
| 5464 | `ipcMain.handle('skills:add', (_event, content) => {` |
| 5476 | `ipcMain.handle('skills:delete', (_event, skillName) => {` |
| 5483 | `ipcMain.handle('skills:importZip', async (_event, filePath) => {` |
| 5515 | `ipcMain.handle('skills:fetchHub', async (_event, slug) => {` |
| 5559 | `ipcMain.handle('skills:browseHub', async () => {` |
| 5580 | `ipcMain.handle('skills:searchHub', async (_event, keyword) => {` |
| 5603 | `ipcMain.handle('chat:loadHistory', () => {` |
| 5609 | `ipcMain.handle('chat:saveHistory', (_event, history) => {` |
| 5615 | `ipcMain.handle('chat:stop', () => {` |
| 5630 | `ipcMain.handle('chat:deleteRecord', (_event, index) => {` |
| 5646 | `ipcMain.handle('chat:injectTurn', (_event, userText, petText) => {` |
| 5683 | `ipcMain.handle('chat:deleteByContent', (_event, role, text) => {` |
| 5724 | `ipcMain.handle('chat:clearHistory', () => {` |
| 5927 | `ipcMain.handle('email:getConfig', () => {` |
| 5932 | `ipcMain.handle('email:saveConfig', (_event, cfg) => {` |
| 5940 | `ipcMain.handle('email:getPreset', (_event, emailAddr) => {` |
| 5943 | `ipcMain.handle('email:send', async (_event, to, subject, body, isHtml) => {` |
| 5946 | `ipcMain.handle('email:readInbox', async (_event, maxCount) => {` |
| 5949 | `ipcMain.handle('email:getContacts', () => {` |
| 5952 | `ipcMain.handle('email:deleteContact', (_event, name) => {` |
| 5980 | `ipcMain.handle('ima:saveConfig', (_event, config) => {` |
| 5991 | `ipcMain.handle('ima:loadConfig', () => {` |
| 5998 | `ipcMain.handle('ima:testConnection', async () => {` |
| 6245 | `ipcMain.handle('ima:uploadMarkdown', async (_event, title, content) => {` |
| 6251 | `ipcMain.handle('reminder:list', () => {` |
| 6255 | `ipcMain.handle('reminder:cancel', () => {` |
| 6260 | `ipcMain.handle('reminder:delete', (_event, id) => {` |
| 6271 | `ipcMain.handle('reminder:add', (_event, text, intervalMs, intervalText) => {` |
| 6276 | `ipcMain.handle('reminder:addWeekly', (_event, text, weekdays, timeStr) => {` |
| 6282 | `ipcMain.handle('scheduled:list', () => {` |
| 6291 | `ipcMain.handle('scheduled:delete', (_event, name) => {` |
| 6300 | `ipcMain.handle('scheduled:toggle', (_event, name) => {` |
| 6310 | `ipcMain.handle('scheduled:runNow', async (_event, name) => {` |
| 6316 | `ipcMain.handle('scheduled:update', (_event, name, updates) => {` |
| 6337 | `ipcMain.handle('scheduled:createDirect', async (_event, data) => {` |
| 6373 | `ipcMain.handle('chat:send', async (_event, msg) => {` |
| 6509 | `ipcMain.handle('weather:get', async (_event, city = '南京', forceRefresh = false) => {` |
| 6514 | `ipcMain.handle('chat:request', async (event, message) => {` |

**Total: 76 `ipcMain.handle(...)` registrations.**
(Plus 4 `ipcMain.on(...)` listeners at L2457, L4030, L4053, L5659 — these do NOT match the pattern.)

---

## 4. `TOOL_DEFINITIONS` — pattern `TOOL_DEFINITIONS`

| Line | Content |
|---:|---|
| 656 | `const TOOL_DEFINITIONS = [` *(definition — array spans L656–L918)* |
| 1824 | `    body.tools = toolsOverride || [...TOOL_DEFINITIONS, ...getMcpToolDefinitions()];` *(usage in `agentStreamLLM`)* |

**2 occurrences; 1 definition (L656), 1 usage (L1824).**

---

## 5. `BUILTIN_DOC_SKILLS` — pattern `BUILTIN_DOC_SKILLS`

| Line | Content |
|---:|---|
| 4169 | `        const contentSkills = skills.filter(s => !BUILTIN_DOC_SKILLS[s.name]);` *(usage, in `chat:vision`)* |
| 4191 | `          if (!BUILTIN_DOC_SKILLS[s.name]) { formatSkill = s; break; }` *(usage)* |
| 4446 | `const BUILTIN_DOC_SKILLS = {` *(definition — object spans L4446–L4725; keys: Word排版助手, Excel美化工具, PPT美化技能, Python编程高手)* |
| 4730 | `  for (const [skillName, content] of Object.entries(BUILTIN_DOC_SKILLS)) {` *(usage, in `ensureBuiltinSkills`)* |
| 6903 | `        if (BUILTIN_DOC_SKILLS[s.name]) return false;` *(usage, in `chat:request` generate_doc branch)* |
| 6951 | `          if (!BUILTIN_DOC_SKILLS[s.name]) { formatSkill = s; break; }` *(usage)* |
| 6983 | `          if (!BUILTIN_DOC_SKILLS[s.name]) { formatSkill = s; break; }` *(usage)* |

**7 occurrences; 1 definition (L4446), 6 usages.**

---

## 6. Key constants — pattern `MAX_TOOL_ROUNDS|MAX_HISTORY|COMPACT_THRESHOLD`

### `MAX_TOOL_ROUNDS`
| Line | Content |
|---:|---|
| 1726 | `const MAX_TOOL_ROUNDS = 15; // 异常兜底上限（防死循环），正常由模型自判完成` *(definition)* |
| 1959 | `    while (round < MAX_TOOL_ROUNDS) {` |
| 2007 | `      if (round === MAX_TOOL_ROUNDS - 3) {` |
| 2008 | `        console.log(\`[pet:agent] 接近轮数上限(\${round}/\${MAX_TOOL_ROUNDS})，提醒模型自判完成\`);` |
| 2014 | `    console.log(\`[pet:agent] 达到兜底上限 \${MAX_TOOL_ROUNDS} 轮，请模型总结收尾\`);` |

### `MAX_HISTORY`
| Line | Content |
|---:|---|
| 373 | `const MAX_HISTORY = 20;` *(definition)* |
| 2037 | `        while (history.length > MAX_HISTORY) history.shift();` |
| 2049 | `        while (history.length > MAX_HISTORY) history.shift();` |
| 2076 | `  while (chatHistory.length > MAX_HISTORY) chatHistory.shift();` |
| 2240 | `    while (chatHistory.length > MAX_HISTORY) chatHistory.shift();` |
| 2254 | `        while (chatHistory.length > MAX_HISTORY) chatHistory.shift();` |
| 2273 | `        while (chatHistory.length > MAX_HISTORY) chatHistory.shift();` |
| 4265 | `              while (chatHistory.length > MAX_HISTORY) chatHistory.shift();` |
| 4334 | `              while (chatHistory.length > MAX_HISTORY) chatHistory.shift();` |
| 4386 | `        while (chatHistory.length > MAX_HISTORY) chatHistory.shift();` |
| 4416 | `    while (chatHistory.length > MAX_HISTORY) chatHistory.shift();` |
| 4428 | `        while (chatHistory.length > MAX_HISTORY) chatHistory.shift();` |
| 5650 | `    while (chatHistory.length > MAX_HISTORY) chatHistory.shift();` |

### `COMPACT_THRESHOLD`
| Line | Content |
|---:|---|
| 406 | `const COMPACT_THRESHOLD = 16;` *(definition)* |
| 477 | `  if (chatHistory.length <= COMPACT_THRESHOLD) return;` |

**Totals: MAX_TOOL_ROUNDS 5 (1 def + 4 uses); MAX_HISTORY 13 (1 def + 12 uses); COMPACT_THRESHOLD 2 (1 def + 1 use).**

---

## Summary

| Pattern | Matches | Definition line(s) |
|---|---|---|
| 1. function definitions | 109 | — |
| 2. top-level ALL-CAPS const/let | 37 | — |
| 3. `ipcMain.handle(` | 76 | — |
| 4. `TOOL_DEFINITIONS` | 2 | 656 |
| 5. `BUILTIN_DOC_SKILLS` | 7 | 4446 |
| 6. `MAX_TOOL_ROUNDS`/`MAX_HISTORY`/`COMPACT_THRESHOLD` | 20 | 1726 / 373 / 406 |
