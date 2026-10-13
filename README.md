# 🐱 小橘猫缘缘 — AI 桌面宠物

> 一只住在主人电脑里的 AI 橘猫，贪吃爱撒娇！

[能力规格 CAPABILITIES.md](CAPABILITIES.md) · [设计哲学 DESIGN.md](DESIGN.md) · [main.js 索引](main_js_index.md) · License: MIT · Electron 33

---

## ✨ 核心功能

| 功能 | 说明 |
|---|---|
| 💬 **智能对话** | 基于 AI 大脑，能聊天、答疑、写文案、做分析。支持联网搜索，跨对话记住你聊过什么。执行过程透明可见——每一步工具调用都实时展示在对话里。 |
| 🔌 **MCP 外部工具** | 支持接入 MCP 服务——查火车票（12306）、查地图天气（百度地图）、思维导图、旅游攻略……只需从魔搭复制配置粘贴进来就能用。AI 自动判断该用哪个工具。 |
| ♻️ **自主写代码** | 遇到复杂数据任务（Excel 批量处理、PDF 解析、爬虫抓取、图表生成），AI 自己写 Python 代码并执行！自带 Python 环境，缺包自动安装，代码报错自动修复重试。 |
| 📋 **任务规划 & 主动提问** | 复杂任务 AI 先制定计划让你确认再执行；信息不全时 AI 主动提问，不会瞎猜。 |
| 🔄 **定时任务** | 说「每天 8 点抓取数据」「固化为定时任务」，自动创建定时任务。脚本失败时 AI 自动修复代码重跑。支持每天定时、间隔循环、每周定时三种模式。 |
| 🧠 **四层记忆** | 工作记忆 → 对话摘要 → 情景记忆（`history.db`）→ 用户画像，层层沉淀。同样问题不必再说第二遍。 |
| 🎙️ **语音 & 会议纪要** | 回复自动朗读（9 种音色可选）、语音输入；开会时录音，一键转写并生成会议纪要。 |
| 📎 **文件 & 文档** | 拖拽 / 粘贴图片和任意文件，AI 直接读懂；生成的 HTML、文档可一键保存成文件。 |
| 💌 **邮件 & 提醒** | 收发邮件、循环提醒、待办事项，听得懂「X 分钟后」「下午 3 点」这样的中文时间。 |
| 🐈 **活的桌宠形态** | 有走位节奏和情绪动作，会撒娇会乱跑；置顶可控、全屏自动让路、托盘常驻、开机自启。 |
| 🛟 **皮实耐造** | 流式超时保留已生成内容、网页抓取三级降级、AI 不可用时走本地回复、异常自动落盘 `crash.log`。 |

---

## 🚀 快速安装

**Windows 开发运行：**

```powershell
npm install        # 安装依赖
npm start          # 启动应用（npm run dev 带 --dev 参数）
```

**打包分发（NSIS 安装包 / 免安装版）：**

```powershell
npm run dist           # 同时产出 NSIS + portable
npm run dist:nsis      # 仅安装包
npm run dist:portable  # 仅免安装版（小橘猫缘缘-免安装版-x.y.z.exe）
npm run icon           # 重新生成多尺寸 ICO
```

**首次使用：** 复制 `config.example.json` 为 `config.json`，填入自己的模型 / TTS / 视觉 / 搜索 API Key 即可（该文件含密钥，请勿提交到公开仓库）。

---

## 🎮 上手

| 操作 | 说明 |
|---|---|
| `npm start` | 启动桌宠窗口，直接对话 |
| `npm run dev` | 开发模式启动 |
| `npm run icon` | 生成 NSIS 兼容的多尺寸 ICO |
| `npm run dist*` | electron-builder 打包（x64，NSIS / portable） |

窗口内可直接：**拖拽 / 粘贴附件**（图片与任意文件）、**双击打开历史附件**、**把 AI 生成的 HTML 存成文件**、在设置里换头像 / 模型 / 思考模式 / 保存目录 / MCP 与邮箱配置。

---

## 📁 项目结构

```text
xiaojumao-yuanyuan/
├── main.js                # 主进程能力层（~9300 行）：Agent 循环、工具执行器、
│                          #   意图路由、记忆系统、技能/MCP/邮件/天气/TTS/ASR、
│                          #   窗口与托盘、全部 IPC handler
├── preload.js             # contextBridge 安全暴露 window.pet API（IPC 受控通道）
├── history-db.js          # 情景记忆：sql.js(WASM SQLite) 摘要索引表 + 原文表
├── config.example.json    # 配置模板：复制为 config.json 后填入自己的 Key
├── src/                   # 渲染进程展示层
│   ├── index.html         # 窗口结构（~800 行）
│   ├── css/main.css       # 橘猫主题样式（~2400 行）
│   └── js/
│       ├── renderer.js    # 入口：装配各模块
│       ├── state.js       # 共享状态
│       ├── chat.js        # 对话 UI、流式渲染、附件、沉淀按钮（核心）
│       ├── markdown.js    # Markdown 渲染 + 代码块/文档块复制
│       ├── pet.js         # 宠物形象与情绪动作
│       ├── movement.js    # 走位（静止是默认态）
│       ├── interaction.js # 交互（点击、拖拽、对话气泡）
│       ├── care.js        # 照护状态
│       ├── avatar.js      # 自定义头像
│       ├── settings.js    # 设置面板
│       ├── skills.js      # 技能浏览 / 安装
│       ├── mcp.js         # MCP Server 管理
│       ├── todo.js / reminders.js / scheduled.js   # 待办 / 提醒 / 定时任务
│       ├── meeting.js     # 会议纪要
│       ├── weather.js / city-codes.js  # 天气与城市名映射
│       ├── fileops.js     # 文件操作（复制/移动/删除/定位）
│       ├── ima.js         # IMA 知识库
│       └── whoami.js      # 用户画像展示
├── python/                # 内置 Python 3.11 运行时（run_code 用，随包分发）
├── build/                 # icon.ico / icon.png 应用图标
├── config-build/          # 配置打包工具（独立小应用）
├── CAPABILITIES.md        # 能力规格：所有功能与实现机制（可逐条回溯到源码）
├── DESIGN.md              # 设计哲学：三条原则、记忆分层、生命感、工程纪律
└── main_js_index.md       # main.js 完整定义索引（函数 / 常量 / IPC / 工具清单）
```

**分层约定**：`main.js` 是能力层（LLM、工具、记忆、系统操作全在这里），`src/` 是纯展示层，两者只经 `preload.js` 暴露的 `window.pet` IPC 通道通信。改能力去 `main.js`，改表现去 `src/`，一份逻辑不要写两遍。

---

## 🧪 测试

测试都跑**真实实现**（用 `vm` 从 `main.js` / `markdown.js` 抽出原函数执行），不复刻逻辑。回归脚本（`check_*.js` / `test_*.js`）随开发环境维护，不随仓库分发：

| 覆盖面 | 说明 |
|---|---|
| 🔌 接线一致性 | `getElementById` 的 id 与 `index.html`、IPC channel 与 `ipcMain.handle` 一一对应 |
| 🧠 记忆 & 历史库 | 历史库 + 摘要索引 + 检索工具、记忆不丢（含退出落盘路径） |
| ⚙️ 技能链路 | 「沉淀技能」9 环链路完整性、技能路由优先级 |
| 🌊 流式渲染 | 节流渲染收尾冲刷、`send()` 暂时性死区自动扫描 |
| 🛟 稳定性 | 崩溃兜底（落盘 + 通知 + 不退进程）、打包产物校验 |

---

## 📚 文档

| 文档 | 覆盖内容 |
|---|---|
| [CAPABILITIES.md](CAPABILITIES.md) | 系统概览、对话与推理、Agent 执行、记忆与检索、代码执行、文件与文档、外部集成、语音多模态、定时自动化、可靠性与安全、已知约束 |
| [DESIGN.md](DESIGN.md) | 三条贯穿一切的原则、记忆四层的取舍、生命感与走位、人格、人机边界、降级矩阵、工程纪律 |
| [main_js_index.md](main_js_index.md) | `main.js` 全部函数 / 常量 / IPC channel / 工具定义的行号索引 |

---

## 📄 License

MIT
