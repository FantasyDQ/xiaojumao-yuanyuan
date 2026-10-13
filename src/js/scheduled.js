/* ============================================================
   scheduled.js - 定时任务管理面板
   展示/创建/暂停/删除/立即执行定时任务
   ============================================================ */
window.PetApp = window.PetApp || {};

(function (App) {
  'use strict';

  const state = App.state;
  let panelEl, listEl, closeBtn;
  let createBtn, createAIBtn;
  let nameInput, promptInput, codeInput, langSelect;
  let typeTabs;
  let timeInput, intervalInput, intervalUnit, weeklyTime, weeklyChecks;
  let currentType = 'daily';
  let isOpen = false;

  function position() {
    if (!panelEl) return;
    const r = state.runtime;
    const prevAnim = panelEl.style.animation;
    panelEl.style.animation = 'none';
    void panelEl.offsetHeight;
    const bw = panelEl.offsetWidth || 520;
    const bh = panelEl.offsetHeight || 500;
    let x = r.x - bw - 20;
    let y = r.y - 40;
    if (x < 8) x = r.x + 180;
    if (x + bw > window.innerWidth - 8) x = Math.max(8, window.innerWidth - bw - 8);
    if (y < 8) y = 8;
    if (y + bh > window.innerHeight - 8) y = Math.max(8, window.innerHeight - bh - 8);
    panelEl.style.left = x + 'px';
    panelEl.style.top = y + 'px';
    panelEl.style.animation = prevAnim;
  }

  function fmtTime(isoStr) {
    if (!isoStr) return '—';
    try {
      const d = new Date(isoStr);
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch (e) { return '—'; }
  }

  function statusLabel(status, active) {
    if (active === false) return { text: '已暂停', cls: 'paused' };
    if (status === 'success') return { text: '✓ 成功', cls: 'success' };
    if (status === 'failed') return { text: '✗ 失败', cls: 'failed' };
    return { text: '待执行', cls: 'idle' };
  }

  function esc(s) {
    return App.markdown && App.markdown.escapeHtml ? App.markdown.escapeHtml(s || '') : (s || '').replace(/</g, '&lt;');
  }

  async function render() {
    let tasks = [];
    try { tasks = await window.pet.listScheduledTasks(); } catch (e) { console.error('[sched] 获取失败', e); }
    if (!tasks || !tasks.length) {
      listEl.innerHTML = '<div class="scheduled-empty">还没有定时任务～<br>可以在上方创建，或跟小橘说"创建一个定时任务，每天8点…"</div>';
      return;
    }
    listEl.innerHTML = '';
    tasks.forEach((t) => {
      const item = document.createElement('div');
      item.className = 'scheduled-item';
      const st = statusLabel(t.lastStatus, t.active);
      // 执行历史折叠
      let historyHtml = '';
      if (t.history && t.history.length) {
        const recent = t.history.slice(0, 5);
        historyHtml = `<details class="sched-history"><summary>📜 执行历史（${t.history.length}）</summary><div class="sched-history-list">${
          recent.map(h => `<div class="sched-history-item"><span class="sched-history-time">${fmtTime(h.time)}</span><span class="sched-history-status ${h.success ? 'success' : 'failed'}">${h.success ? '✓' : '✗'}</span><span class="sched-history-result">${esc(h.result.slice(0, 100))}</span></div>`).join('')
        }</div></details>`;
      }
      item.innerHTML = `
        <div class="scheduled-item-head">
          <span class="scheduled-item-name">${esc(t.name)}</span>
          <span class="scheduled-item-status ${st.cls}">${st.text}</span>
        </div>
        <div class="scheduled-item-schedule">⏰ ${esc(t.scheduleDesc)}</div>
        <div class="scheduled-item-prompt">${esc(t.prompt)}</div>
        <div class="scheduled-item-meta">最后执行：${fmtTime(t.lastRun)} · ${t.mode === 'agent' ? `🤖 AI模式 · 技能：${esc(t.skillName || '—')}` : `📝 脚本模式 · ${t.scriptLanguage || 'python'}`}</div>
        ${historyHtml}
        <div class="scheduled-item-actions">
          <button class="scheduled-item-btn run" data-action="run" data-name="${esc(t.name)}">▶ 立即执行</button>
          <button class="scheduled-item-btn toggle" data-action="toggle" data-name="${esc(t.name)}">${t.active === false ? '▶ 启用' : '⏸ 暂停'}</button>
          <button class="scheduled-item-btn delete" data-action="delete" data-name="${esc(t.name)}">🗑 删除</button>
        </div>
      `;
      listEl.appendChild(item);
    });
    listEl.querySelectorAll('.scheduled-item-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const name = btn.dataset.name;
        const origText = btn.textContent;
        btn.textContent = '处理中…';
        btn.disabled = true;
        try {
          if (action === 'run') {
            const res = await window.pet.runScheduledTaskNow(name);
            await render();
            requestAnimationFrame(() => position());
            if (App.chat && App.chat.showBubble) App.chat.showBubble(res.lastStatus === 'success' ? `✅ 任务"${name}"执行成功` : `❌ 任务"${name}"执行失败`, 3000);
          } else if (action === 'toggle') {
            await window.pet.toggleScheduledTask(name);
            await render();
          } else if (action === 'delete') {
            await window.pet.deleteScheduledTask(name);
            await render();
            requestAnimationFrame(() => position());
          }
        } catch (err) {
          console.error('[sched] 操作失败', err);
          btn.textContent = origText;
          btn.disabled = false;
        }
      });
    });
  }

  // 构建调度规则字符串
  function buildScheduleStr() {
    if (currentType === 'daily') {
      return `daily ${timeInput.value || '08:00'}`;
    } else if (currentType === 'interval') {
      const num = parseInt(intervalInput.value) || 30;
      const unit = intervalUnit.value;
      return `interval ${num}${unit}`;
    } else if (currentType === 'weekly') {
      const days = Array.from(weeklyChecks).filter(c => c.checked).map(c => parseInt(c.value));
      if (!days.length) return null;
      return `weekly ${days.join(',')} ${weeklyTime.value || '09:00'}`;
    }
    return null;
  }

  // 手动创建任务
  async function createTask() {
    const name = nameInput.value.trim();
    const prompt = promptInput.value.trim();
    const code = codeInput.value.trim();
    const lang = langSelect.value;
    const schedStr = buildScheduleStr();
    if (!name) { nameInput.focus(); return; }
    if (!prompt) { promptInput.focus(); return; }
    if (!schedStr) {
      if (App.chat && App.chat.showBubble) App.chat.showBubble('请选择调度规则喵～', 2000);
      return;
    }
    if (!code) {
      // 没有代码 → 走 AI 生成
      createTaskViaAI(name, prompt, schedStr, lang);
      return;
    }
    // 有代码 → 直接创建
    createBtn.textContent = '创建中…';
    createBtn.disabled = true;
    try {
      const result = await window.pet.createScheduledTaskDirect({
        name, schedule: schedStr, script_language: lang, script_code: code, prompt,
      });
      if (result && result.success) {
        if (App.chat && App.chat.showBubble) App.chat.showBubble(`✅ 定时任务"${name}"已创建喵～`, 2500);
        nameInput.value = ''; promptInput.value = ''; codeInput.value = '';
        await render();
        requestAnimationFrame(() => position());
      } else {
        if (App.chat && App.chat.showBubble) App.chat.showBubble(`创建失败：${result?.message || '未知错误'}`, 3000);
      }
    } catch (err) {
      console.error('[sched] 创建失败', err);
      if (App.chat && App.chat.showBubble) App.chat.showBubble('创建失败喵…', 2000);
    }
    createBtn.textContent = '➕ 创建任务';
    createBtn.disabled = false;
  }

  // 通过 AI 生成代码并创建任务
  async function createTaskViaAI(name, prompt, schedStr, lang) {
    createAIBtn.textContent = '🤖 小橘正在写代码…';
    createAIBtn.disabled = true;
    if (App.chat && App.chat.toggle && !App.chat.isOpen?.()) {
      // 不强制打开聊天框
    }
    // 构造消息发给 AI，让 AI 调 run_code + schedule_task
    const msg = `请帮我创建一个定时任务：\n- 任务名称：${name}\n- 调度规则：${schedStr}\n- 任务描述：${prompt}\n- 脚本语言：${lang}\n\n请先用 run_code 写代码并调通，然后用 schedule_task 创建定时任务。`;
    try {
      if (window.pet && window.pet.sendChatMessage) {
        window.pet.sendChatMessage(msg);
      }
      close();
    } catch (err) {
      console.error('[sched] AI创建失败', err);
    }
    createAIBtn.textContent = '🤖 让小橘帮你生成';
    createAIBtn.disabled = false;
  }

  function switchType(type) {
    currentType = type;
    typeTabs.forEach(t => t.classList.toggle('active', t.dataset.type === type));
    document.querySelector('.sched-mode-daily').style.display = type === 'daily' ? 'block' : 'none';
    document.querySelector('.sched-mode-interval').style.display = type === 'interval' ? 'block' : 'none';
    document.querySelector('.sched-mode-weekly').style.display = type === 'weekly' ? 'block' : 'none';
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    panelEl.classList.remove('hidden');
    App.uiOpen = (App.uiOpen || 0) + 1;
    position();
    render().then(() => { requestAnimationFrame(() => position()); });
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    panelEl.classList.add('hidden');
    if (App.uiOpen) App.uiOpen = Math.max(0, App.uiOpen - 1);
    if (!App.uiOpen) window.pet.setIgnoreMouse(true);
  }

  function toggle() { isOpen ? close() : open(); }

  App.scheduled = {
    init() {
      panelEl = document.getElementById('scheduledPanel');
      listEl = document.getElementById('scheduledList');
      closeBtn = document.querySelector('.scheduled-panel-close');
      createBtn = document.getElementById('schedCreateBtn');
      createAIBtn = document.getElementById('schedCreateAIBtn');
      nameInput = document.getElementById('schedName');
      promptInput = document.getElementById('schedPrompt');
      codeInput = document.getElementById('schedCode');
      langSelect = document.getElementById('schedLang');
      timeInput = document.getElementById('schedTime');
      intervalInput = document.getElementById('schedInterval');
      intervalUnit = document.getElementById('schedIntervalUnit');
      weeklyTime = document.getElementById('schedWeeklyTime');
      weeklyChecks = document.querySelectorAll('.sched-weekdays input[type="checkbox"]');
      typeTabs = document.querySelectorAll('.sched-tab');

      if (closeBtn) closeBtn.addEventListener('click', () => close());
      if (createBtn) createBtn.addEventListener('click', () => createTask());
      if (createAIBtn) createAIBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        const prompt = promptInput.value.trim();
        const schedStr = buildScheduleStr();
        if (!name) { nameInput.focus(); return; }
        if (!prompt) { promptInput.focus(); return; }
        if (!schedStr) {
          if (App.chat && App.chat.showBubble) App.chat.showBubble('请选择调度规则喵～', 2000);
          return;
        }
        createTaskViaAI(name, prompt, schedStr, langSelect.value);
      });
      typeTabs.forEach(tab => tab.addEventListener('click', () => switchType(tab.dataset.type)));

      // 展开/折叠创建表单时重新定位面板
      const createDetails = document.getElementById('scheduledCreate');
      if (createDetails) {
        createDetails.addEventListener('toggle', () => {
          if (isOpen) requestAnimationFrame(() => position());
        });
      }

      window.addEventListener('resize', () => { if (isOpen) position(); });
    },
    open, close, toggle,
    isOpen() { return isOpen; },
  };
})(window.PetApp);
