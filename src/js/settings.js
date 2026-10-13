// 设置模块（合并头像设置 + 文件路径 + 记忆管理）
(function () {
  const App = window.PetApp || (window.PetApp = {});
  let panelEl = null;
  let avatarCollapsed = true; // 默认折叠
  let pathCollapsed = true;
  let memoryCollapsed = true;
  let aboutCollapsed = true;
  let emailCollapsed = true;
  let ttsCollapsed = true;
  let thinkingCollapsed = true;

  App.settings = {
    init() {
      panelEl = document.getElementById('settingsPanel');
      if (!panelEl) return;
      panelEl.querySelector('.settings-panel-close').addEventListener('click', () => App.settings.close());

      // 折叠区：头像
      const avatarHeader = document.getElementById('avatarCollapseHeader');
      const avatarCollapse = avatarHeader ? avatarHeader.parentElement : null;
      if (avatarHeader) {
        avatarHeader.addEventListener('click', () => {
          avatarCollapsed = !avatarCollapsed;
          if (avatarCollapse) avatarCollapse.classList.toggle('expanded', !avatarCollapsed);
        });
      }

      // 折叠区：文件路径
      const pathHeader = document.getElementById('pathCollapseHeader');
      const pathCollapse = pathHeader ? pathHeader.parentElement : null;
      if (pathHeader) {
        pathHeader.addEventListener('click', () => {
          pathCollapsed = !pathCollapsed;
          if (pathCollapse) pathCollapse.classList.toggle('expanded', !pathCollapsed);
        });
      }

      // 折叠区：记忆
      const memoryHeader = document.getElementById('memoryCollapseHeader');
      const memoryCollapse = memoryHeader ? memoryHeader.parentElement : null;
      if (memoryHeader) {
        memoryHeader.addEventListener('click', () => {
          memoryCollapsed = !memoryCollapsed;
          if (memoryCollapse) memoryCollapse.classList.toggle('expanded', !memoryCollapsed);
          if (!memoryCollapsed) App.settings.loadMemory();
        });
      }

      // 折叠区：关于小橘
      const aboutHeader = document.getElementById('aboutCollapseHeader');
      const aboutCollapse = aboutHeader ? aboutHeader.parentElement : null;
      if (aboutHeader) {
        aboutHeader.addEventListener('click', () => {
          aboutCollapsed = !aboutCollapsed;
          if (aboutCollapse) aboutCollapse.classList.toggle('expanded', !aboutCollapsed);
          if (!aboutCollapsed) App.settings.loadAbout();
        });
      }

      // 折叠区：邮箱集成
      const emailHeader = document.getElementById('emailCollapseHeader');
      const emailCollapse = emailHeader ? emailHeader.parentElement : null;
      if (emailHeader) {
        emailHeader.addEventListener('click', () => {
          emailCollapsed = !emailCollapsed;
          if (emailCollapse) emailCollapse.classList.toggle('expanded', !emailCollapsed);
          if (!emailCollapsed) App.settings.loadEmailConfig();
        });
      }

      // 折叠区：语音朗读（TTS）
      const ttsHeader = document.getElementById('ttsCollapseHeader');
      const ttsCollapse = ttsHeader ? ttsHeader.parentElement : null;
      if (ttsHeader) {
        ttsHeader.addEventListener('click', () => {
          ttsCollapsed = !ttsCollapsed;
          if (ttsCollapse) ttsCollapse.classList.toggle('expanded', !ttsCollapsed);
          if (!ttsCollapsed) App.settings.loadTtsConfig();
        });
      }

      // 折叠区：思考模式
      const thinkingHeader = document.getElementById('thinkingCollapseHeader');
      const thinkingCollapse = thinkingHeader ? thinkingHeader.parentElement : null;
      if (thinkingHeader) {
        thinkingHeader.addEventListener('click', () => {
          thinkingCollapsed = !thinkingCollapsed;
          if (thinkingCollapse) thinkingCollapse.classList.toggle('expanded', !thinkingCollapsed);
          if (!thinkingCollapsed) App.settings.loadThinkingConfig();
        });
      }
      const thinkingSaveBtn = document.getElementById('thinkingSaveBtn');
      if (thinkingSaveBtn) {
        thinkingSaveBtn.addEventListener('click', async () => {
          const modeSel = document.getElementById('thinkingModeSelect');
          const effortSel = document.getElementById('thinkingEffortSelect');
          const statusEl = document.getElementById('thinkingStatus');
          if (!window.pet || !window.pet.setThinkingConfig) {
            if (statusEl) statusEl.textContent = '当前版本不支持该配置';
            return;
          }
          const res = await window.pet.setThinkingConfig({
            mode: modeSel ? modeSel.value : 'off',
            effort: effortSel ? effortSel.value : 'low',
          });
          if (statusEl) {
            statusEl.textContent = (res && res.success) ? '✅ 已保存，之后的对话即生效' : ('保存失败：' + ((res && res.error) || ''));
            setTimeout(() => { statusEl.textContent = ''; }, 3000);
          }
        });
      }

      // 邮箱：输入地址时自动匹配预设
      const emailAddrInput = document.getElementById('emailAddr');
      if (emailAddrInput) {
        emailAddrInput.addEventListener('blur', async () => {
          const addr = emailAddrInput.value.trim();
          const badge = document.getElementById('emailPresetBadge');
          const hint = document.getElementById('emailServerHint');
          if (!addr) { badge.classList.remove('show'); hint.textContent = ''; return; }
          const preset = await window.pet.emailGetPreset(addr);
          if (preset) {
            badge.textContent = preset.name;
            badge.classList.add('show');
            hint.textContent = `SMTP: ${preset.smtpServer}:${preset.smtpPort} · IMAP: ${preset.imapServer}:${preset.imapPort}（已自动配置）`;
          } else {
            badge.classList.remove('show');
            hint.textContent = '⚠️ 未识别的邮箱类型，保存后请在对话中告诉小橘SMTP/IMAP服务器地址';
          }
        });
      }

      // 邮箱：保存
      const emailSaveBtn = document.getElementById('emailSaveBtn');
      if (emailSaveBtn) {
        emailSaveBtn.addEventListener('click', async () => {
          const addr = document.getElementById('emailAddr').value.trim();
          const pwd = document.getElementById('emailPwd').value.trim();
          // 自动获取预设配置
          const preset = await window.pet.emailGetPreset(addr);
          let cfg;
          if (preset) {
            cfg = { email: addr, password: pwd, smtpServer: preset.smtpServer, smtpPort: preset.smtpPort, imapServer: preset.imapServer, imapPort: preset.imapPort };
          } else {
            // 非预设邮箱，检查是否已有保存的配置
            const existing = await window.pet.emailGetConfig();
            cfg = { email: addr, password: pwd, smtpServer: existing.smtpServer || '', smtpPort: existing.smtpPort || 465, imapServer: existing.imapServer || '', imapPort: existing.imapPort || 993 };
          }
          const res = await window.pet.emailSaveConfig(cfg);
          if (res.success) {
            App.settings.emailStatus('✅ 邮箱配置已保存', 'success');
          } else {
            App.settings.emailStatus('保存失败', 'error');
          }
          setTimeout(() => App.settings.emailStatus('', ''), 3000);
        });
      }

      // 邮箱：测试发信
      const emailTestBtn = document.getElementById('emailTestBtn');
      if (emailTestBtn) {
        emailTestBtn.addEventListener('click', async () => {
          App.settings.emailStatus('正在发送测试邮件…', '');
          const cfg = await window.pet.emailGetConfig();
          if (!cfg.configured) { App.settings.emailStatus('请先保存邮箱配置', 'error'); return; }
          const res = await window.pet.emailSend(cfg.email, '小橘测试邮件', '喵~这是一封来自小橘猫缘缘的测试邮件，邮箱配置成功啦！🐱');
          if (res.success) {
            App.settings.emailStatus('✅ 测试邮件已发送到 ' + cfg.email, 'success');
          } else {
            App.settings.emailStatus('发送失败：' + (res.message || '').slice(0, 100), 'error');
          }
          setTimeout(() => App.settings.emailStatus('', ''), 5000);
        });
      }

      // 语音朗读：音色选择/试听/保存
      const ttsSaveBtn = document.getElementById('ttsSaveBtn');
      if (ttsSaveBtn) {
        ttsSaveBtn.addEventListener('click', async () => {
          const sel = document.getElementById('ttsVoiceSelect');
          const res = await window.pet.ttsSetVoice(sel ? sel.value : '');
          if (res.success) {
            App.settings.ttsStatus('✅ 音色已保存：' + res.voice, 'success');
          } else {
            App.settings.ttsStatus('保存失败：' + (res.error || ''), 'error');
          }
          setTimeout(() => App.settings.ttsStatus('', ''), 3000);
        });
      }
      const ttsPreviewBtn = document.getElementById('ttsPreviewBtn');
      if (ttsPreviewBtn) {
        ttsPreviewBtn.addEventListener('click', async () => {
          // 正在试听 → 停止
          if (App.tts && App.tts.isActive && App.tts.isActive()) {
            App.tts.stop();
            ttsPreviewBtn.innerHTML = '▶️ 试听';
            App.settings.ttsStatus('', '');
            return;
          }
          const sel = document.getElementById('ttsVoiceSelect');
          const voice = sel ? sel.value : '';
          ttsPreviewBtn.innerHTML = '⏹ 停止';
          App.settings.ttsStatus('🎙 正在合成语音…', '');
          try {
            const res = App.tts
              ? await App.tts.play('你好呀，我是小橘！这是当前音色的试听效果，喜欢的话就选我吧！', voice)
              : { success: false, error: '语音模块未就绪' };
            if (!res.success) {
              App.settings.ttsStatus('试听失败：' + (res.error || ''), 'error');
            } else {
              App.settings.ttsStatus('', '');
            }
          } catch (e) {
            App.settings.ttsStatus('试听失败：' + (e.message || ''), 'error');
          }
          ttsPreviewBtn.innerHTML = '▶️ 试听';
        });
      }
      // 语音朗读：自动播报回复开关
      const ttsAutoRead = document.getElementById('ttsAutoRead');
      if (ttsAutoRead) {
        ttsAutoRead.addEventListener('change', async () => {
          const checked = ttsAutoRead.checked;
          const res = await window.pet.ttsSetAutoRead(checked);
          if (res.success) {
            App.settings.updateTtsAutoReadUI(res.autoRead);
            App.settings.ttsStatus(res.autoRead ? '✅ 已开启自动播报，小橘回复会自动朗读' : '✅ 已关闭自动播报', 'success');
          } else {
            App.settings.ttsStatus('保存失败：' + (res.error || ''), 'error');
            App.settings.updateTtsAutoReadUI(!checked); // 保存失败回滚
          }
          setTimeout(() => App.settings.ttsStatus('', ''), 3000);
        });
      }

      // 选择保存路径按钮
      const chooseBtn = document.getElementById('settingsChooseDirBtn');
      if (chooseBtn) {
        chooseBtn.addEventListener('click', async () => {
          const res = await window.pet.chooseSaveDir();
          if (res.success) {
            document.getElementById('settingsSaveDir').value = res.dir;
            App.settings.showStatus('✅ 路径已保存', 'success');
            setTimeout(() => App.settings.showStatus('', ''), 2000);
          }
        });
      }

      // 记忆：添加
      const memoryAddBtn = document.getElementById('memoryAddBtn');
      const memoryAddInput = document.getElementById('memoryAddInput');
      if (memoryAddBtn) {
        memoryAddBtn.addEventListener('click', async () => {
          const text = memoryAddInput.value.trim();
          if (!text) return;
          await window.pet.addMemory(text);
          memoryAddInput.value = '';
          App.settings.loadMemory();
        });
      }
      if (memoryAddInput) {
        memoryAddInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && memoryAddBtn) memoryAddBtn.click();
        });
      }

      // 记忆：清空
      const memoryClearBtn = document.getElementById('memoryClearBtn');
      if (memoryClearBtn) {
        memoryClearBtn.addEventListener('click', async () => {
          await window.pet.clearMemory();
          App.settings.loadMemory();
        });
      }
    },

    async loadMemory() {
      const listEl = document.getElementById('memoryList');
      if (!listEl) return;
      let mem;
      try { mem = await window.pet.getMemory(); } catch (e) { console.error('[memory] 获取失败', e); return; }
      const facts = (mem && mem.facts) || [];
      if (!facts.length) {
        listEl.innerHTML = '<div class="memory-empty">还没有记忆～小橘会在聊天中自动记住关于你的信息</div>';
        return;
      }
      listEl.innerHTML = '';
      facts.forEach((f, i) => {
        const item = document.createElement('div');
        item.className = 'memory-item';
        item.innerHTML = `
          <span class="memory-item-text" data-index="${i}">${App.markdown.escapeHtml(f.text)}</span>
          <div class="memory-item-actions">
            <button class="memory-item-btn edit" data-action="edit" data-index="${i}">✏️</button>
            <button class="memory-item-btn del" data-action="del" data-index="${i}">🗑</button>
          </div>
        `;
        listEl.appendChild(item);
      });
      // 绑定编辑/删除
      listEl.querySelectorAll('.memory-item-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const action = btn.dataset.action;
          const idx = parseInt(btn.dataset.index);
          if (action === 'del') {
            await window.pet.deleteMemory(idx);
            App.settings.loadMemory();
          } else if (action === 'edit') {
            const textEl = listEl.querySelector(`.memory-item-text[data-index="${idx}"]`);
            if (!textEl) return;
            if (btn.dataset.editing === 'true') {
              // 保存
              const newText = textEl.textContent.trim();
              if (newText) {
                await window.pet.updateMemory(idx, newText);
              }
              btn.dataset.editing = 'false';
              btn.textContent = '✏️';
              btn.className = 'memory-item-btn edit';
              textEl.classList.remove('editing');
              textEl.contentEditable = 'false';
              App.settings.loadMemory();
            } else {
              // 进入编辑
              btn.dataset.editing = 'true';
              btn.textContent = '💾';
              btn.className = 'memory-item-btn save';
              textEl.classList.add('editing');
              textEl.contentEditable = 'true';
              textEl.focus();
              // 选中所有文字
              const range = document.createRange();
              range.selectNodeContents(textEl);
              const sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
            }
          }
        });
      });
    },

    async loadMcpConfig() {
      const cfg = await window.pet.mcpGetConfig();
      const listEl = document.getElementById('mcpServersList');
      if (!listEl) return;
      const servers = cfg.servers || [];
      if (!servers.length) {
        listEl.innerHTML = '<div style="font-size:10px;color:#b0a090;margin-top:4px;">还没有配置 MCP Server，点击下方添加</div>';
        App.settings.loadMcpTools();
        return;
      }
      listEl.innerHTML = servers.map((s, i) => `
        <div class="mcp-server-item">
          <div class="mcp-server-row">
            <input type="text" class="settings-input mcp-name" data-i="${i}" value="${s.name || ''}" placeholder="名称" style="width:80px;" />
            <input type="text" class="settings-input mcp-url" data-i="${i}" value="${s.url || ''}" placeholder="MCP Server URL" style="flex:1;" />
            <select class="settings-input mcp-transport" data-i="${i}" style="width:90px;">
              <option value="streamable" ${s.transport !== 'sse' ? 'selected' : ''}>Streamable</option>
              <option value="sse" ${s.transport === 'sse' ? 'selected' : ''}>SSE</option>
            </select>
            <label class="mcp-toggle"><input type="checkbox" class="mcp-enabled" data-i="${i}" ${s.enabled !== false ? 'checked' : ''} />启用</label>
            <span class="mcp-del" data-i="${i}">✕</span>
          </div>
        </div>
      `).join('');
      // 绑定事件
      listEl.querySelectorAll('.mcp-name,.mcp-url,.mcp-transport').forEach(el => {
        el.addEventListener('change', async () => {
          const cfg = await window.pet.mcpGetConfig();
          const i = parseInt(el.dataset.i);
          if (el.classList.contains('mcp-name')) cfg.servers[i].name = el.value;
          if (el.classList.contains('mcp-url')) cfg.servers[i].url = el.value;
          if (el.classList.contains('mcp-transport')) cfg.servers[i].transport = el.value;
          await window.pet.mcpSaveConfig(cfg);
        });
      });
      listEl.querySelectorAll('.mcp-enabled').forEach(el => {
        el.addEventListener('change', async () => {
          const cfg = await window.pet.mcpGetConfig();
          const i = parseInt(el.dataset.i);
          cfg.servers[i].enabled = el.checked;
          await window.pet.mcpSaveConfig(cfg);
        });
      });
      listEl.querySelectorAll('.mcp-del').forEach(el => {
        el.addEventListener('click', async () => {
          const cfg = await window.pet.mcpGetConfig();
          const i = parseInt(el.dataset.i);
          cfg.servers.splice(i, 1);
          await window.pet.mcpSaveConfig(cfg);
          App.settings.loadMcpConfig();
        });
      });
      App.settings.loadMcpTools();
    },

    async loadMcpTools() {
      const tools = await window.pet.mcpTools();
      const listEl = document.getElementById('mcpToolsList');
      if (!listEl) return;
      if (!tools.length) { listEl.innerHTML = ''; return; }
      listEl.innerHTML = '<div style="font-size:10px;color:#b0a090;margin-top:8px;margin-bottom:2px;">🔧 已发现的 MCP 工具：</div>' +
        tools.map(t => `<div class="mcp-tool-item"><span class="mcp-tool-name">${t.originalName}</span><span class="mcp-tool-server">${t.server}</span><span class="mcp-tool-desc">${t.description.slice(0, 60)}</span></div>`).join('');
    },

    mcpStatus(msg, type) {
      const el = document.getElementById('mcpStatus');
      if (el) { el.textContent = msg; el.className = 'settings-status ' + (type || ''); }
    },

    async loadEmailConfig() {
      const cfg = await window.pet.emailGetConfig();
      document.getElementById('emailAddr').value = cfg.email || '';
      document.getElementById('emailPwd').value = cfg.password || '';
      // 如果有已保存的邮箱，触发 blur 显示预设标签
      if (cfg.email) {
        document.getElementById('emailAddr').dispatchEvent(new Event('blur'));
      }
      // 加载联系人列表
      App.settings.loadEmailContacts();
    },

    async loadEmailContacts() {
      const listEl = document.getElementById('emailContactsList');
      if (!listEl) return;
      const contacts = await window.pet.emailGetContacts();
      const keys = Object.keys(contacts || {});
      if (!keys.length) {
        listEl.innerHTML = '<div style="font-size:10px;color:#b0a090;margin-top:4px;">还没有记住的联系人～在对话中说"张三的邮箱是xxx@yy.com"即可自动记住</div>';
        return;
      }
      listEl.innerHTML = '<div style="font-size:10px;color:#b0a090;margin-top:8px;margin-bottom:2px;">📬 已记住的联系人：</div>' +
        keys.map(k => `<div class="email-contact-item"><span class="email-contact-name">${k}</span><span class="email-contact-addr">${contacts[k]}</span><span class="email-contact-del" data-name="${k}">✕</span></div>`).join('');
      // 绑定删除
      listEl.querySelectorAll('.email-contact-del').forEach(btn => {
        btn.addEventListener('click', async () => {
          await window.pet.emailDeleteContact(btn.dataset.name);
          App.settings.loadEmailContacts();
        });
      });
    },

    emailStatus(msg, type) {
      const el = document.getElementById('emailStatus');
      if (el) { el.textContent = msg; el.className = 'settings-status ' + (type || ''); }
    },

    // 加载思考模式配置（展开思考模式区时调用）
    async loadThinkingConfig() {
      const modeSel = document.getElementById('thinkingModeSelect');
      const effortSel = document.getElementById('thinkingEffortSelect');
      if (!modeSel || !window.pet || !window.pet.getThinkingConfig) return;
      try {
        const cfg = await window.pet.getThinkingConfig();
        if (cfg) {
          if (cfg.mode) modeSel.value = cfg.mode;
          if (effortSel && cfg.effort) effortSel.value = cfg.effort;
        }
      } catch (e) { /* 忽略 */ }
    },

    // 加载 TTS 音色配置（展开语音朗读区时调用）
    async loadTtsConfig() {
      const sel = document.getElementById('ttsVoiceSelect');
      if (!sel || !window.pet.ttsGetConfig) return;
      const cfg = await window.pet.ttsGetConfig();
      const voices = (cfg.voices || []).slice();
      // 当前音色不在预设列表时（config.json 手动填的）也要显示出来
      if (cfg.voice && !voices.includes(cfg.voice)) voices.unshift(cfg.voice);
      sel.innerHTML = voices.map(v => `<option value="${v}">${v}</option>`).join('');
      if (cfg.voice) sel.value = cfg.voice;
      App.settings.updateTtsAutoReadUI(cfg.autoRead);
      if (!cfg.configured) {
        App.settings.ttsStatus('⚠️ 未配置 TTS 模型（config.json 的 tts_model）', 'error');
      }
    },

    // 更新自动播报开关的 UI 状态（滑块 + 已开启/已关闭 文字）
    updateTtsAutoReadUI(checked) {
      const el = document.getElementById('ttsAutoRead');
      const txt = document.getElementById('ttsAutoReadText');
      if (el) el.checked = !!checked;
      if (txt) {
        txt.textContent = checked ? '已开启' : '已关闭';
        txt.className = 'toggle-state-text' + (checked ? ' on' : '');
      }
    },

    ttsStatus(msg, type) {
      const el = document.getElementById('ttsStatus');
      if (el) { el.textContent = msg; el.className = 'settings-status ' + (type || ''); }
    },

    loadAbout() {
      const el = document.getElementById('aboutContent');
      if (!el) return;
      const esc = (s) => App.markdown && App.markdown.escapeHtml ? App.markdown.escapeHtml(s) : (s || '').replace(/</g, '&lt;');
      let html = '';
      html += '<div class="about-intro">🐾 小橘猫缘缘 · AI 桌面宠物</div>';
      html += '<p style="text-align:center;color:#8a6a4a;margin:4px 0 12px;">— 你的桌面全能小助手 —</p>';

      html += '<h3>🐱 缘缘是谁</h3>';
      html += '<p>一只住在主人电脑里的 AI 橘猫，贪吃爱撒娇，但干活绝不含糊。双击聊天，右键开菜单，拖文件进来帮你读。</p>';

      html += '<h3>💬 智能对话</h3>';
      html += '<p>基于 AI 大脑，能聊天、答疑、写文案、做分析。支持联网搜索（新闻/学术/金融分类检索），跨对话也记得主人聊过什么。</p>';

      html += '<h3>🐍 自主写代码</h3>';
      html += '<p>遇到复杂数据任务（Excel 批量处理、PDF 解析、爬虫抓取、图表生成），自己写 Python 代码并执行。自带 Python 环境，缺包自动安装，报错自动修复重试，生成的文件自动保存到配置目录。</p>';

      html += '<h3>🔄 定时任务</h3>';
      html += '<p>说"每天 8 点抓取数据""固化为定时任务"，自动创建定时任务。支持每天定时、间隔循环、每周定时三种模式。日常执行脚本，脚本失败时 AI 自动重新推理修复。</p>';

      html += '<h3>💻 操作电脑</h3>';
      html += '<p>打开应用、搜索文件、读取分析文件、调节音量、锁屏——说一句就帮你操作。</p>';

      html += '<h3>📄 文档生成</h3>';
      html += '<p>一键生成 Word / Excel / PPT / HTML，内置排版美化技能，输出即成品。</p>';

      html += '<h3>🧩 技能库</h3>';
      html += '<p>已安装的技能自动激活——做数据分析自动用 Excel 技能，写文档自动用排版技能。也可手动管理。</p>';

      html += '<h3>📚 知识库 & 🎙️ 会议</h3>';
      html += '<p>IMA 知识库回答专业问题；会议纪要实时录音→自动转写→生成结构化纪要，也支持上传音频文件。</p>';

      html += '<h3>📋 效率工具</h3>';
      html += '<p>待办事项统一管理，循环提醒到点弹窗（喝水、久坐），天气查询还提醒加减衣服。</p>';

      html += '<h3>🐾 桌宠互动</h3>';
      html += '<p>右键喂猫罐头🥫、陪我玩耍，我有饱腹度和心情值，还能自定义咱俩的聊天头像。</p>';

      html += '<div class="about-author">';
      html += '<div class="author-label">CREATED BY</div>';
      html += '<div class="author-name">duansihang</div>';
      html += '</div>';

      el.innerHTML = html;
    },

    async open() {
      panelEl.classList.remove('hidden');
      App.uiOpen = (App.uiOpen || 0) + 1;
      if (window.pet) window.pet.setIgnoreMouse(false);
      // 加载当前保存路径
      const dir = await window.pet.getSaveDir();
      const dirInput = document.getElementById('settingsSaveDir');
      if (dirInput) dirInput.value = dir;
      // 加载头像（同步到预览）
      if (App.avatar) await App.avatar.load();
    },

    close() {
      panelEl.classList.add('hidden');
      if (App.uiOpen) App.uiOpen = Math.max(0, App.uiOpen - 1);
      if (!App.uiOpen && window.pet) window.pet.setIgnoreMouse(true);
    },

    showStatus(msg, type) {
      const el = document.getElementById('settingsStatus');
      if (el) { el.textContent = msg; el.className = 'settings-status ' + (type || ''); }
    }
  };
})();
