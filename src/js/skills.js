// ============ Skills 技能系统 UI ============
(function () {
  'use strict';
  window.PetApp = window.PetApp || {};
  const App = window.PetApp;
  let panelEl, listEl, hubListEl, isOpen = false;

  async function refreshList() {
    if (!listEl) return;
    const skills = await window.pet.skillsList();
    if (!skills.length) {
      listEl.innerHTML = '<div class="skills-empty">还没有安装任何技能喵～去"添加"或"技能商店"看看吧</div>';
      return;
    }
    listEl.innerHTML = skills.map(s => `
      <div class="skill-card">
        <div class="skill-card-header">
          <span class="skill-card-name">🧩 ${s.name}</span>
          <button class="skill-card-del" data-name="${s.name}" title="删除">🗑️</button>
        </div>
        <div class="skill-card-desc">${s.description || '无描述'}</div>
        ${s.tags && s.tags.length ? `<div class="skill-card-tags">${s.tags.map(t => `<span class="skill-tag">${t}</span>`).join('')}</div>` : ''}
      </div>
    `).join('');
    // 绑定删除
    listEl.querySelectorAll('.skill-card-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const name = btn.dataset.name;
        const res = await window.pet.skillsDelete(name);
        if (res.success) refreshList();
      });
    });
  }

  async function renderHubSkills(hubSkills) {
    if (!hubSkills.length) {
      hubListEl.innerHTML = '<div class="skills-empty">没有找到相关技能喵～换个关键词试试？</div>';
      return;
    }
    hubListEl.innerHTML = hubSkills.map(s => {
      const dl = s.downloads > 10000 ? Math.floor(s.downloads / 1000) + 'k' : (s.downloads || 0);
      return `
      <div class="skill-card skill-card-hub">
        <div class="skill-card-header">
          <span class="skill-card-name">🧩 ${s.name}</span>
          <button class="skill-card-install" data-slug="${s.slug || s.name}">安装</button>
        </div>
        <div class="skill-card-desc">${s.description}</div>
        ${s.downloads ? `<div class="skill-card-meta">⬇️ ${dl} 下载</div>` : ''}
      </div>`;
    }).join('');
    hubListEl.querySelectorAll('.skill-card-install').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const slug = btn.dataset.slug;
        btn.textContent = '安装中…';
        btn.disabled = true;
        const res = await window.pet.skillsFetchHub(slug);
        if (res.success) {
          btn.textContent = '✓ 已安装';
          setTimeout(() => { btn.textContent = '安装'; btn.disabled = false; }, 2000);
          refreshList();
        } else {
          btn.textContent = '✗ 失败';
          setTimeout(() => { btn.textContent = '安装'; btn.disabled = false; }, 2000);
          console.warn('安装失败:', res.error);
        }
      });
    });
  }

  async function refreshHub() {
    if (!hubListEl) return;
    hubListEl.innerHTML = '<div class="skills-empty">加载中…</div>';
    const hubSkills = await window.pet.skillsBrowseHub();
    renderHubSkills(hubSkills);
  }

  async function searchHub(keyword) {
    if (!hubListEl) return;
    if (!keyword.trim()) { refreshHub(); return; }
    hubListEl.innerHTML = '<div class="skills-empty">🔍 搜索中…</div>';
    const results = await window.pet.skillsSearchHub(keyword.trim());
    renderHubSkills(results);
  }

  App.skills = {
    init() {
      panelEl = document.getElementById('skillsPanel');
      listEl = document.getElementById('skillsList');
      hubListEl = document.getElementById('skillsHubList');
      if (!panelEl) return;

      // 关闭按钮
      panelEl.querySelector('.skills-panel-close').addEventListener('click', () => App.skills.close());

      // 搜索框
      const searchInput = document.getElementById('skillsHubSearch');
      const searchBtn = document.getElementById('skillsHubSearchBtn');
      let searchTimer = null;
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { searchHub(searchInput.value); }
      });
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => searchHub(searchInput.value), 600);
      });
      searchBtn.addEventListener('click', () => searchHub(searchInput.value));

      // Tab 切换
      panelEl.querySelectorAll('.skills-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          panelEl.querySelectorAll('.skills-tab').forEach(t => t.classList.remove('active'));
          panelEl.querySelectorAll('.skills-tab-content').forEach(c => c.classList.remove('active'));
          tab.classList.add('active');
          const tabName = tab.dataset.tab;
          panelEl.querySelector(`.skills-tab-${tabName}`).classList.add('active');
          if (tabName === 'installed') refreshList();
          if (tabName === 'hub') refreshHub();
        });
      });

      // 导入 ZIP
      const zipBtn = document.getElementById('skillsImportZipBtn');
      const zipInput = document.getElementById('skillsZipInput');
      zipBtn.addEventListener('click', () => zipInput.click());
      zipInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        let filePath = window.pet.getPathForFile ? window.pet.getPathForFile(file) : '';
        if (!filePath) return;
        zipBtn.textContent = '导入中…';
        const res = await window.pet.skillsImportZip(filePath);
        if (res.success) {
          zipBtn.textContent = '✓ 已导入：' + res.name;
          setTimeout(() => { zipBtn.textContent = '选择 ZIP 文件…'; }, 2500);
          refreshList();
        } else {
          zipBtn.textContent = '✗ ' + (res.error || '失败');
          setTimeout(() => { zipBtn.textContent = '选择 ZIP 文件…'; }, 2500);
        }
        zipInput.value = '';
      });

      // 手动添加
      const manualBtn = document.getElementById('skillsManualAddBtn');
      const manualInput = document.getElementById('skillsManualInput');
      manualBtn.addEventListener('click', async () => {
        const content = manualInput.value.trim();
        if (!content) return;
        manualBtn.textContent = '添加中…';
        const res = await window.pet.skillsAdd(content);
        if (res.success) {
          manualBtn.textContent = '✓ 已添加：' + res.name;
          setTimeout(() => { manualBtn.textContent = '添加技能'; }, 2000);
          manualInput.value = '';
          refreshList();
        } else {
          manualBtn.textContent = '✗ ' + (res.error || '格式错误');
          setTimeout(() => { manualBtn.textContent = '添加技能'; }, 2500);
        }
      });
    },

    open() {
      if (!panelEl) return;
      isOpen = true;
      panelEl.classList.remove('hidden');
      App.uiOpen = (App.uiOpen || 0) + 1;
      refreshList();
    },

    close() {
      if (!panelEl || !isOpen) return;
      isOpen = false;
      panelEl.classList.add('hidden');
      if (App.uiOpen) App.uiOpen = Math.max(0, App.uiOpen - 1);
      if (!App.uiOpen) window.pet.setIgnoreMouse(true);
    },
  };
})();
