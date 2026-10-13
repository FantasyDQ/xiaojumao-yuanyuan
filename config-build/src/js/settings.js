/* ============================================================
   settings.js - 设置面板（配置版专用）
   配置大模型 / Tavily / Jina 的 API Key
   挂载到 window.PetApp.settings
   ============================================================ */
window.PetApp = window.PetApp || {};

(function (App) {
  'use strict';

  const state = App.state;
  let pet;
  let panelEl, closeBtn, saveBtn, hintEl;
  let baseUrlEl, llmKeyEl, modelEl, tavilyEl, jinaEl, weatherCityEl, bannerEl;
  let isOpen = false;

  function position() {
    const r = state.runtime;
    let x = r.x - 380;
    let y = r.y - 20;
    const bw = panelEl.offsetWidth || 360;
    const bh = panelEl.offsetHeight || 420;
    if (x + bw > window.innerWidth - 8) x = r.x + 180;
    if (x < 8) x = 8;
    if (y < 8) y = r.y + 176 + 8;
    if (y + bh > window.innerHeight - 8) y = Math.max(8, window.innerHeight - bh - 8);
    panelEl.style.left = x + 'px';
    panelEl.style.top = y + 'px';
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    panelEl.classList.remove('hidden');
    App.uiOpen = (App.uiOpen || 0) + 1;
    position();
    loadConfig();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    panelEl.classList.add('hidden');
    if (App.uiOpen) App.uiOpen = Math.max(0, App.uiOpen - 1);
    if (!App.uiOpen) window.pet.setIgnoreMouse(true);
  }

  function toggle() { isOpen ? close() : open(); }

  async function loadConfig() {
    try {
      const cfg = await window.pet.getConfig();
      baseUrlEl.value = (cfg.llm && cfg.llm.baseUrl) || '';
      llmKeyEl.value = (cfg.llm && cfg.llm.apiKey) || '';
      modelEl.value = (cfg.llm && cfg.llm.model) || '';
      tavilyEl.value = (cfg.tavily && cfg.tavily.apiKey) || '';
      jinaEl.value = (cfg.jina && cfg.jina.apiKey) || '';
      weatherCityEl.value = (cfg.weather && cfg.weather.city) || '';
      // 检测大模型 key 是否缺失，显示醒目提示
      const hasKey = cfg.llm && cfg.llm.apiKey;
      if (!hasKey) {
        hintEl.innerHTML = '⚠️ 还没配置大模型 API Key，请填写后保存才能使用聊天功能';
        hintEl.style.color = '#e84040';
        if (bannerEl) bannerEl.classList.add('show');
      } else {
        hintEl.textContent = '✓ 大模型已配置';
        hintEl.style.color = '#5a9c5a';
        if (bannerEl) bannerEl.classList.remove('show');
      }
    } catch (e) {
      hintEl.textContent = '加载配置失败';
    }
  }

  async function save() {
    const cfg = {
      llm: {
        baseUrl: baseUrlEl.value.trim(),
        apiKey: llmKeyEl.value.trim(),
        model: modelEl.value.trim(),
      },
      tavily: { apiKey: tavilyEl.value.trim() },
      jina: { apiKey: jinaEl.value.trim() },
      weather: { city: weatherCityEl.value.trim() || '南京' },
    };
    saveBtn.textContent = '保存中…';
    saveBtn.disabled = true;
    try {
      const res = await window.pet.saveConfig(cfg);
      if (res && res.success) {
        saveBtn.textContent = '💾 保存';
        saveBtn.disabled = false;
        // 刷新 banner 状态
        if (cfg.llm.apiKey) {
          hintEl.textContent = '✓ 已保存，即时生效';
          hintEl.style.color = '#5a9c5a';
          if (bannerEl) bannerEl.classList.remove('show');
        } else {
          hintEl.innerHTML = '⚠️ 大模型 Key 仍为空，请填写后保存';
          hintEl.style.color = '#e84040';
        }
        if (pet) pet.showBubble('配置已保存喵～', 2000);
      } else { saveBtn.textContent = '💾 保存'; saveBtn.disabled = false; hintEl.textContent = '✗ 保存失败'; hintEl.style.color = '#e84040'; }
    } catch (e) {
      saveBtn.textContent = '💾 保存';
      saveBtn.disabled = false;
      hintEl.textContent = '✗ 保存失败';
      hintEl.style.color = '#e84040';
    }
  }

  App.settings = {
    init() {
      pet = App.pet;
      panelEl = document.getElementById('settingsPanel');
      closeBtn = panelEl.querySelector('.reminder-panel-close');
      saveBtn = document.getElementById('cfgSaveBtn');
      hintEl = document.getElementById('cfgHint');
      baseUrlEl = document.getElementById('cfgLlmBaseUrl');
      llmKeyEl = document.getElementById('cfgLlmApiKey');
      modelEl = document.getElementById('cfgLlmModel');
      tavilyEl = document.getElementById('cfgTavilyKey');
      jinaEl = document.getElementById('cfgJinaKey');
      weatherCityEl = document.getElementById('cfgWeatherCity');
      bannerEl = document.getElementById('cfgBanner');
      closeBtn.addEventListener('click', () => App.settings.close());
      saveBtn.addEventListener('click', save);
    },
    open, close, toggle,
    isOpen() { return isOpen; },
  };
})(window.PetApp);
