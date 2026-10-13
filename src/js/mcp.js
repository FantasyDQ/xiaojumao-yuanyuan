// ============ MCP 工具面板 UI ============
(function () {
  'use strict';
  window.PetApp = window.PetApp || {};
  const App = window.PetApp;
  let panelEl, isOpen = false;

  async function loadConfig() {
    const cfg = await window.pet.mcpGetConfig();
    const listEl = document.getElementById('mcpServersList');
    if (!listEl) return;
    const servers = cfg.servers || [];
    if (!servers.length) {
      listEl.innerHTML = '<div style="font-size:10px;color:#b0a090;margin-top:4px;">还没有配置 MCP Server，点击下方添加</div>';
      loadTools();
      return;
    }
    listEl.innerHTML = servers.map((s, i) => `
      <div class="mcp-server-item">
        <div class="mcp-server-row">
          <input type="text" class="settings-input mcp-name" data-i="${i}" value="${s.name || ''}" placeholder="名称" style="width:90px;flex-shrink:0;" />
          <input type="text" class="settings-input mcp-url" data-i="${i}" value="${s.url || ''}" placeholder="MCP Server URL" style="flex:1;min-width:80px;" />
          <select class="settings-input mcp-transport" data-i="${i}" style="width:72px;flex-shrink:0;font-size:10px;">
            <option value="streamable" ${s.transport !== 'sse' ? 'selected' : ''}>Streamable</option>
            <option value="sse" ${s.transport === 'sse' ? 'selected' : ''}>SSE</option>
          </select>
          <label class="mcp-toggle"><input type="checkbox" class="mcp-enabled" data-i="${i}" ${s.enabled !== false ? 'checked' : ''} />启用</label>
          <span class="mcp-del" data-i="${i}">✕</span>
        </div>
      </div>
    `).join('');
    listEl.querySelectorAll('.mcp-name,.mcp-url,.mcp-transport').forEach(el => {
      // 用 input 事件替代 change，确保每次输入都即时保存（change 只在失焦时触发）
      el.addEventListener('input', async () => {
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
        loadConfig();
      });
    });
    loadTools();
  }

  async function loadTools() {
    const tools = await window.pet.mcpTools();
    const listEl = document.getElementById('mcpToolsList');
    if (!listEl) return;
    if (!tools.length) { listEl.innerHTML = ''; return; }
    listEl.innerHTML = '<div style="font-size:10px;color:#b0a090;margin-top:8px;margin-bottom:2px;">🔧 已发现的 MCP 工具：</div>' +
      tools.map(t => `<div class="mcp-tool-item"><span class="mcp-tool-name">${t.originalName}</span><span class="mcp-tool-server">${t.server}</span><span class="mcp-tool-desc">${(t.description || '').slice(0, 60)}</span></div>`).join('');
  }

  function mcpStatus(msg, type) {
    const el = document.getElementById('mcpStatus');
    if (el) { el.textContent = msg; el.className = 'settings-status ' + (type || ''); }
  }

  App.mcp = {
    init() {
      panelEl = document.getElementById('mcpPanel');
      if (!panelEl) return;

      // 关闭按钮
      const closeBtn = document.getElementById('mcpPanelClose');
      if (closeBtn) closeBtn.addEventListener('click', () => App.mcp.close());

      // 添加 Server
      const addBtn = document.getElementById('mcpAddBtn');
      if (addBtn) {
        addBtn.addEventListener('click', async () => {
          const cfg = await window.pet.mcpGetConfig();
          if (!cfg.servers) cfg.servers = [];
          cfg.servers.push({ name: 'MCP-' + (cfg.servers.length + 1), url: '', transport: 'streamable', enabled: true });
          await window.pet.mcpSaveConfig(cfg);
          loadConfig();
        });
      }

      // 连接全部
      const connectBtn = document.getElementById('mcpConnectBtn');
      if (connectBtn) {
        connectBtn.addEventListener('click', async () => {
          // 连接前先校验所有 URL
          const cfg = await window.pet.mcpGetConfig();
          const badUrls = (cfg.servers || []).filter(s => {
            if (!s.enabled) return false;
            if (!s.url || !s.url.startsWith('http')) return true;
            try { return new URL(s.url).pathname.includes('//'); }
            catch (e) { return true; }
          });
          if (badUrls.length) {
            mcpStatus(`❌ ${badUrls.length} 个 MCP Server URL 格式错误（双斜杠或缺 hash ID），请检查: ${badUrls.map(s => s.name).join(', ')}`, 'error');
            setTimeout(() => mcpStatus('', ''), 8000);
            return;
          }
          mcpStatus('正在连接 MCP Server…', '');
          const res = await window.pet.mcpConnect();
          if (res.tools && res.tools.length) {
            mcpStatus(`✅ 连接成功，发现 ${res.tools.length} 个工具`, 'success');
          } else {
            mcpStatus('连接完成，但未发现工具', 'error');
          }
          loadTools();
          setTimeout(() => mcpStatus('', ''), 5000);
        });
      }

      // 导入 JSON
      const importBtn = document.getElementById('mcpImportBtn');
      const importInput = document.getElementById('mcpImportInput');
      if (importBtn && importInput) {
        importBtn.addEventListener('click', async () => {
          const text = importInput.value.trim();
          if (!text) return;
          mcpStatus('正在导入并连接…', '');
          const res = await window.pet.mcpImportJson(text);
          if (res.success) {
            mcpStatus(`✅ 导入成功，添加了 ${res.added} 个 MCP Server，正在连接…`, 'success');
            importInput.value = '';
            loadConfig();
            // 等一秒后自动连接
            setTimeout(async () => {
              const connRes = await window.pet.mcpConnect();
              if (connRes.tools && connRes.tools.length) {
                mcpStatus(`✅ 连接成功，发现 ${connRes.tools.length} 个工具`, 'success');
              } else {
                mcpStatus('连接完成，但未发现工具', 'error');
              }
              loadTools();
              setTimeout(() => mcpStatus('', ''), 5000);
            }, 1500);
          } else {
            mcpStatus('导入失败：' + (res.message || 'JSON 格式错误'), 'error');
          }
          setTimeout(() => mcpStatus('', ''), 6000);
        });
      }
    },

    open() {
      if (!panelEl) return;
      isOpen = true;
      panelEl.classList.remove('hidden');
      App.uiOpen = (App.uiOpen || 0) + 1;
      loadConfig();
    },

    close() {
      if (!panelEl || !isOpen) return;
      isOpen = false;
      panelEl.classList.add('hidden');
      if (App.uiOpen) App.uiOpen = Math.max(0, App.uiOpen - 1);
      if (!App.uiOpen) window.pet.setIgnoreMouse(true);
    },

    toggle() { isOpen ? App.mcp.close() : App.mcp.open(); },
  };
})();
