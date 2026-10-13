# 小橘猫缘缘 ☘

小橘猫缘缘 | Desktop Pet

[能力规格 CAPABILITIES.md](CAPABILITIES.md) · [设计哲学 DESIGN.md](DESIGN.md) · [main.js 索引](main_js_index.md) · License: MIT · Electron 33

**一个「有记忆、有性格、会动手」的桌面伴侣，不是套着猫皮的聊天窗口。** 定位的优先级是 **性格 > 记忆 > 能力**：有走位节奏和情绪动作，有四层记忆与用户画像，能执行多步任务——Agent 循环、25 项内置工具、代码执行、文件操作、定时任务、邮件、会议纪要、语音、MCP 外接能力。

模型接入走 OpenAI 兼容接口（`chat/completions`），在 `config.json` 里配置 `llm_api_base` / `llm_model`；简单任务与复杂任务分别路由到轻量模型与主模型。

**Agent 执行** 多步工具循环，带循环上限保护，单步失败不影响整体，执行过程记录为操作日志。25 项内置工具覆盖任务编排、文件系统、知识检索、代码执行、系统控制、时间与通信，另可经 MCP 合并外部工具。

**四层记忆** 工作记忆（20 轮环形）→ 对话摘要压缩 → 情景记忆（`history.db`，原文保留、摘要作索引）→ 用户画像（上限 30 条、敏感信息过滤）。索引与负载分离：同一段对话原文注入约 17242 token，摘要索引注入约 86 token。

**技能系统** 内置技能随包分发，支持从技能商店远程检索安装（`SKILL.md` 格式）。一次 Agent 执行结束后，可将「请求 + 操作日志 + 回复」沉淀为新技能，相似任务中自动激活。

**桌面形态** 猫咪形象的走位与情绪动作，静止为默认状态，避免周期性循环动画。支持置顶可控、全屏自动让路、托盘常驻、开机自启。

**语音与多模态** OpenAI 兼容 TTS/ASR、独立视觉模型识图、会议纪要（录音 → 转写 → 生成纪要，长会议分段录制合并）。

**定时与自动化** 定时任务（脚本模式 + AI 模式，脚本失败转 AI 处理）、循环提醒、待办事项、中文时间解析（「X 分钟后」「下午 3 点」）。

**降级处理** 流式超时保留已生成内容、网页抓取三级降级（Jina → Tavily extract → 直接 fetch）、记忆提取失败时以原话作摘要写入索引、LLM 不可用时走本地回复、异常落盘 `crash.log`。

## 快速安装

Windows（开发运行）：

```powershell
npm install        # 安装依赖
npm start          # 启动应用（npm run dev 带 --dev 参数）
```

打包分发（NSIS 安装包 / 免安装版）：

```powershell
npm run dist           # 同时产出 NSIS + portable
npm run dist:nsis      # 仅安装包
npm run dist:portable  # 仅免安装版（小橘猫缘缘-免安装版-x.y.z.exe）
npm run icon           # 重新生成多尺寸 ICO
```

打包产物在 `dist/`，内置 Python 运行时（`python/`）与 `config.json` 作为 `extraResources` 一并分发。首次使用前请在 `config.json` 中填入自己的模型 / TTS / 视觉 / 搜索 API Key（该文件含密钥，勿提交到公开仓库）。

## 上手

| 操作 | 说明 |
|---|---|
| `npm start` | 启动桌宠窗口，直接对话 |
| `npm run dev` | 开发模式启动 |
| `npm run icon` | 用 Electron `nativeImage` 生成 NSIS 兼容的多尺寸 BMP ICO |
| `npm run dist*` | electron-builder 打包（x64，NSIS / portable） |
| `node check_<name>.js` | 跑对应的回归检查（见「测试」） |

窗口内可直接：拖拽 / 粘贴附件（图片与任意文件）、双击打开历史附件、把 AI 生成的 HTML 存成文件、在设置里换头像 / 模型 / 思考模式 / 保存目录 / MCP 与邮箱配置。

## 项目结构

```text
project2/
├── main.js                # 主进程能力层（~8600 行）：Agent 循环、工具执行器、
│                          #   意图路由、记忆系统、技能/MCP/邮件/天气/TTS/ASR、
│                          #   窗口与托盘、全部 IPC handler
├── preload.js             # contextBridge 安全暴露 window.pet API（IPC 受控通道）
├── history-db.js          # 情景记忆：sql.js(WASM SQLite) 摘要索引表 + 原文表
├── config.json            # 运行配置：模型路由 / 思考模式 / TTS / ASR / 视觉 / 搜索 Key
├── src/                   # 渲染进程展示层
│   ├── index.html         # 窗口结构（~800 行）
│   ├── css/main.css       # 橘猫主题样式（~2400 行）
│   └── js/
│       ├── renderer.js    # 入口：装配各模块
│       ├── state.js       # 共享状态
│       ├── chat.js        # 对话 UI、流式渲染、附件、沉淀按钮（核心，~2500 行）
│       ├── markdown.js    # Markdown 渲染 + 代码块/文档块复制
│       ├── pet.js         # 宠物形象与情绪动作
│       ├── movement.js    # 走位（静止是默认态）
│       ├── interaction.js # 交互（点击、拖拽、对话气泡）
│       ├── care.js        # 照护状态
│       ├── avatar.js      # 自定义头像
│       ├── settings.js    # 设置面板
│       ├── skills.js      # 技能浏览 / 安装
│       ├── mcp.js         # MCP Server 管理
│       ├── todo.js        # 待办
│       ├── reminders.js   # 循环提醒
│       ├── scheduled.js   # 定时任务
│       ├── meeting.js     # 会议纪要
│       ├── weather.js / city-codes.js  # 天气与城市名映射
│       ├── fileops.js     # 文件操作（复制/移动/删除/定位）
│       ├── ima.js         # IMA 知识库
│       └── whoami.js      # 用户画像展示
├── python/                # 内置 Python 3.11 运行时（run_code 用，随包分发）
├── build/                 # icon.ico / icon.png 应用图标
├── dist/                  # electron-builder 输出（NSIS + portable + win-unpacked）
├── config-build/          # 配置打包相关的历史构建副本
├── node_modules/          # 依赖：adm-zip / pdf-parse / sql.js（运行时），electron 系（开发）
├── .claude/               # 本地工具配置
│
├── CAPABILITIES.md        # 能力规格：所有功能与实现机制（可逐条回溯到源码）
├── DESIGN.md              # 设计哲学：三条原则、记忆分层、生命感、工程纪律
├── main_js_index.md       # main.js 完整定义索引（函数 / 常量 / IPC / 工具清单）
│
├── check_*.js             # 回归检查：接线一致性、崩溃兜底、历史库、记忆丢失、
│                          #   流式收尾、TDZ、技能沉淀、技能路由、配色对比度、打包校验
├── test_*.js / verify-*.js# 专项验证：工具调用拦截器、thinking API、IMA 检索
├── make-icon.js           # 生成 NSIS 兼容 ICO 的构建脚本
└── .env / .gitignore      # 环境变量覆盖 / 忽略规则
```

**分层约定**：`main.js` 是能力层（LLM、工具、记忆、系统操作全在这里），`src/` 是纯展示层，两者只经 `preload.js` 暴露的 `window.pet` IPC 通道通信。改能力去 `main.js`，改表现去 `src/`，不要在渲染进程里复制主进程逻辑（防漂移：一份逻辑不要写两遍）。

## 测试

测试都跑**真实实现**（用 `vm` 从 `main.js` / `markdown.js` 抽出原函数执行），不复刻逻辑：

| 命令 | 覆盖 |
|---|---|
| `node check_attach.js` | `getElementById` 的 id 与 `index.html`、IPC channel 与 `ipcMain.handle` 接线一致 |
| `node check_history.js` | 历史库 + 摘要索引 + 检索工具 |
| `node check_memory.js` | 记忆不丢（含退出落盘路径） |
| `node check_precipitate.js` | 「沉淀技能」9 环链路完整性 |
| `node check_skill_route.js` | 技能路由优先级 |
| `node check_stream_flush.js` | 流式节流渲染收尾冲刷 |
| `node check_tdz.js` | `send()` 暂时性死区自动扫描 |
| `node check_markdown_copy.js` | 代码块/文档块复制按钮 |
| `node check_crash.js` | 崩溃兜底（落盘 + 通知 + 不退进程） |
| `node check_build.js` | 本次改动确实进了 `app.asar` |

## 文档

| 文档 | 覆盖内容 |
|---|---|
| [CAPABILITIES.md](CAPABILITIES.md) | 系统概览、对话与推理、Agent 执行、记忆与检索、代码执行、文件与文档、外部集成、语音多模态、定时自动化、可靠性与安全、已知约束 |
| [DESIGN.md](DESIGN.md) | 三条贯穿一切的原则、记忆四层的取舍、生命感与走位、人格、人机边界、降级矩阵、工程纪律 |
| [main_js_index.md](main_js_index.md) | `main.js` 全部函数 / 常量 / IPC channel / 工具定义的行号索引 |

## License

MIT。
