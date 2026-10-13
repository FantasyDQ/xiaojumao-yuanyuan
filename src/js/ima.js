// IMA 知识库模块
(function () {
  const App = window.PetApp || (window.PetApp = {});
  let panelEl = null;

  App.ima = {
    init() {
      panelEl = document.getElementById('imaPanel');
      if (!panelEl) return;

      // 关闭按钮
      panelEl.querySelector('.ima-panel-close').addEventListener('click', () => App.ima.close());

      // Tab 切换
      panelEl.querySelectorAll('.ima-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          panelEl.querySelectorAll('.ima-tab').forEach(t => t.classList.remove('active'));
          panelEl.querySelectorAll('.ima-tab-content').forEach(c => c.classList.remove('active'));
          tab.classList.add('active');
          panelEl.querySelector(`.ima-tab-${tab.dataset.tab}`).classList.add('active');
        });
      });

      // 保存配置
      document.getElementById('imaSaveBtn').addEventListener('click', async () => {
        const clientId = document.getElementById('imaClientId').value.trim();
        const apiKey = document.getElementById('imaApiKey').value.trim();
        const kbId = document.getElementById('imaKbId').value.trim();
        if (!clientId || !apiKey) {
          App.ima.showStatus('⚠️ 请填写 Client ID 和 API Key', 'error');
          return;
        }
        const res = await window.pet.imaSaveConfig({ clientId, apiKey, kbId });
        if (res.success) {
          App.ima.showStatus('✅ 配置已保存', 'success');
          document.getElementById('imaApiKey').value = ''; // 清空密码框
        } else {
          App.ima.showStatus('❌ 保存失败', 'error');
        }
      });

      // 测试连接
      document.getElementById('imaTestBtn').addEventListener('click', async () => {
        App.ima.showStatus('⏳ 正在连接…', 'info');
        // 先保存当前输入的配置（不持久化密码，但用于测试）
        const clientId = document.getElementById('imaClientId').value.trim();
        const apiKey = document.getElementById('imaApiKey').value.trim();
        if (clientId && apiKey) {
          await window.pet.imaSaveConfig({ clientId, apiKey });
        }
        const res = await window.pet.imaTestConnection();
        if (res.success) {
          App.ima.showStatus(`✅ ${res.msg}（找到 ${res.kbCount} 个知识库）`, 'success');
          // 自动加载知识库列表
          App.ima.loadKbList();
        } else {
          App.ima.showStatus(`❌ ${res.msg} (code: ${res.code || 'N/A'})`, 'error');
        }
      });

      // 搜索
      const searchInput = document.getElementById('imaSearchInput');
      const searchBtn = document.getElementById('imaSearchBtn');
      searchBtn.addEventListener('click', () => App.ima.search());
      searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') App.ima.search(); });

      // 加载已保存的配置
      App.ima.loadConfig();
    },

    showStatus(msg, type) {
      const el = document.getElementById('imaStatus');
      el.textContent = msg;
      el.className = 'ima-status ' + (type || '');
    },

    async loadConfig() {
      const cfg = await window.pet.imaLoadConfig();
      document.getElementById('imaClientId').value = cfg.clientId || '';
      document.getElementById('imaKbId').value = cfg.kbId || '';
      // 如果已有配置，自动加载知识库列表
      if (cfg.clientId && cfg.hasApiKey) {
        App.ima.loadKbList();
      }
    },

    async loadKbList() {
      const res = await window.pet.imaSearchKb('');
      const selectEl = document.getElementById('imaKbSelect');
      if (!res.success || !res.list.length) {
        selectEl.innerHTML = '<div class="ima-empty">未找到知识库</div>';
        return;
      }
      const savedKbId = (await window.pet.imaLoadConfig()).kbId;
      selectEl.innerHTML = '<div class="ima-kb-label">选择知识库：</div>' + res.list.map(kb => {
        const id = kb.kb_id || kb.id;
        const checked = id === savedKbId ? 'checked' : '';
        return `<label class="ima-kb-item"><input type="radio" name="imaKb" value="${id}" ${checked}> ${kb.kb_name || kb.name}</label>`;
      }).join('');
      // 选中知识库时保存
      selectEl.querySelectorAll('input[name="imaKb"]').forEach(radio => {
        radio.addEventListener('change', async () => {
          if (radio.checked) {
            await window.pet.imaSaveConfig({ kbId: radio.value });
            App.ima.showStatus('✅ 已选择知识库', 'success');
            setTimeout(() => App.ima.showStatus('', ''), 2000);
          }
        });
      });
    },

    async search() {
      const query = document.getElementById('imaSearchInput').value.trim();
      if (!query) return;
      const resultsEl = document.getElementById('imaResults');
      resultsEl.innerHTML = '<div class="ima-empty">🔍 搜索中…</div>';

      // 获取选中的知识库
      const selected = document.querySelector('input[name="imaKb"]:checked');
      const cfg = await window.pet.imaLoadConfig();
      const kbId = selected ? selected.value : cfg.kbId;
      if (!kbId) {
        resultsEl.innerHTML = '<div class="ima-empty">请先选择知识库</div>';
        return;
      }
      // 确保保存选中的 kbId
      if (selected && selected.value !== cfg.kbId) {
        await window.pet.imaSaveConfig({ kbId: selected.value });
      }

      const res = await window.pet.imaSearchKnowledge(kbId, query);
      if (!res.success) {
        resultsEl.innerHTML = `<div class="ima-empty">❌ ${res.msg}</div>`;
        return;
      }
      if (!res.list.length) {
        resultsEl.innerHTML = '<div class="ima-empty">未找到相关内容</div>';
        return;
      }
      resultsEl.innerHTML = res.list.map(item => `
        <div class="ima-result-item">
          <div class="ima-result-title">📄 ${item.title || '无标题'}</div>
          ${item.highlight_content ? `<div class="ima-result-content">${item.highlight_content}</div>` : ''}
        </div>
      `).join('');
    },

    open() {
      panelEl.classList.remove('hidden');
      App.uiOpen = (App.uiOpen || 0) + 1;
      if (window.pet) window.pet.setIgnoreMouse(false);
    },

    close() {
      panelEl.classList.add('hidden');
      if (App.uiOpen) App.uiOpen = Math.max(0, App.uiOpen - 1);
      if (!App.uiOpen && window.pet) window.pet.setIgnoreMouse(true);
    }
  };
})();
