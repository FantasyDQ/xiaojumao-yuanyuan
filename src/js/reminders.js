/* ============================================================
   reminders.js - 循环提醒管理面板
   查看/添加/删除循环提醒，编辑间隔和内容
   挂载到 window.PetApp.reminders
   ============================================================ */
window.PetApp = window.PetApp || {};

(function (App) {
  'use strict';

  const state = App.state;
  let pet;
  let panelEl, listEl, inputEl, intervalEl, unitEl, addBtn, closeBtn;
  let addWeeklyBtn, timeEl, weekdayChecks, tabs;
  let currentMode = 'interval';
  let isOpen = false;

  function position() {
    const r = state.runtime;
    // 临时禁用动画，确保 offsetHeight 返回真实尺寸而非动画中间值
    const prevAnim = panelEl.style.animation;
    panelEl.style.animation = 'none';
    void panelEl.offsetHeight; // 强制 reflow
    let x = r.x - 380;
    let y = r.y - 20;
    const bw = panelEl.offsetWidth || 340;
    const bh = panelEl.offsetHeight || 400;
    if (x + bw > window.innerWidth - 8) x = r.x + 180;
    if (x < 8) x = 8;
    if (y < 8) y = r.y + 176 + 8;
    if (y + bh > window.innerHeight - 8) y = Math.max(8, window.innerHeight - bh - 8);
    panelEl.style.left = x + 'px';
    panelEl.style.top = y + 'px';
    // 恢复动画
    panelEl.style.animation = prevAnim;
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    panelEl.classList.remove('hidden');
    App.uiOpen = (App.uiOpen || 0) + 1;
    position();
    render().then(() => {
      requestAnimationFrame(() => position());
    });
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    panelEl.classList.add('hidden');
    if (App.uiOpen) App.uiOpen = Math.max(0, App.uiOpen - 1);
    if (!App.uiOpen) window.pet.setIgnoreMouse(true);
  }

  function toggle() { isOpen ? close() : open(); }

  // 格式化间隔文字
  function fmtInterval(ms) {
    if (ms % 3600000 === 0) return `每${ms / 3600000}小时`;
    if (ms % 60000 === 0) return `每${ms / 60000}分钟`;
    if (ms % 1000 === 0) return `每${ms / 1000}秒`;
    return `每${ms}毫秒`;
  }

  async function render() {
    let list = [];
    try { list = await window.pet.listReminders(); } catch (e) {}
    if (!list || !list.length) {
      listEl.innerHTML = '<div class="reminder-empty">还没有循环提醒～在上面添加，或跟小橘说"每隔30分钟提醒我喝水"</div>';
      return;
    }
    listEl.innerHTML = '';
    list.forEach((r) => {
      const item = document.createElement('div');
      item.className = 'reminder-item';
      const typeLabel = (r.type === 'weekly') ? '🕐 定时' : '🔁 间隔';
      item.innerHTML = `
        <div class="reminder-item-info">
          <span class="reminder-item-text">${escapeHtml(r.text)}</span>
          <span class="reminder-item-interval">${typeLabel} ${escapeHtml(r.intervalText)}</span>
        </div>
        <button class="reminder-item-del" data-id="${r.id}" title="删除">✕</button>
      `;
      item.querySelector('.reminder-item-del').addEventListener('click', (e) => {
        e.stopPropagation();
        delReminder(r.id);
      });
      listEl.appendChild(item);
    });
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function addReminder() {
    const text = inputEl.value.trim();
    if (!text) { inputEl.focus(); return; }
    if (currentMode === 'weekly') { addWeeklyReminder(); return; }
    const num = parseInt(intervalEl.value) || 30;
    const unit = unitEl.value;
    const intervalMs = unit === 'hours' ? num * 3600000 : num * 60000;
    const intervalText = unit === 'hours' ? `每${num}小时` : `每${num}分钟`;
    try {
      await window.pet.addReminderDirect(text, intervalMs, intervalText);
      inputEl.value = '';
      await render();
      position(); // 添加后重新定位，防止底部跑出屏幕
      if (pet) pet.showBubble(`好喵！${intervalText}提醒你${text}～`, 2800);
    } catch (e) {
      console.error('[reminders] 添加失败', e);
    }
  }

  async function addWeeklyReminder() {
    const text = inputEl.value.trim();
    if (!text) { inputEl.focus(); return; }
    const timeStr = timeEl.value || '09:00';
    const weekdays = weekdayChecks
      .filter(cb => cb.checked)
      .map(cb => parseInt(cb.value));
    if (weekdays.length === 0) {
      if (pet) pet.showBubble('请至少选一个星期喵～', 2000);
      return;
    }
    try {
      await window.pet.addWeeklyReminder(text, weekdays, timeStr);
      inputEl.value = '';
      await render();
      position(); // 添加后重新定位，防止底部跑出屏幕
      const dayNames = ['日','一','二','三','四','五','六'];
      const dayStr = weekdays.slice().sort().map(d => '周' + dayNames[d]).join('、');
      if (pet) pet.showBubble(`好喵！${dayStr} ${timeStr} 提醒你${text}～`, 3000);
    } catch (e) {
      console.error('[reminders] 添加定时提醒失败', e);
    }
  }

  async function delReminder(id) {
    try {
      await window.pet.deleteReminder(id);
      await render();
      position(); // 删除后也重新定位
      if (pet) pet.showBubble('已删除该提醒喵', 1800);
    } catch (e) {}
  }

  App.reminders = {
    init() {
      pet = App.pet;
      panelEl = document.getElementById('reminderPanel');
      listEl = document.getElementById('reminderList');
      inputEl = document.getElementById('reminderInput');
      intervalEl = document.getElementById('reminderInterval');
      unitEl = document.getElementById('reminderUnit');
      addBtn = document.getElementById('reminderAdd');
      addWeeklyBtn = document.getElementById('reminderAddWeekly');
      timeEl = document.getElementById('reminderTime');
      weekdayChecks = Array.from(document.querySelectorAll('.weekday-toggle input[type="checkbox"]'));
      tabs = Array.from(document.querySelectorAll('.reminder-tab'));
      closeBtn = document.querySelector('.reminder-panel-close');

      addBtn.addEventListener('click', addReminder);
      if (addWeeklyBtn) addWeeklyBtn.addEventListener('click', addWeeklyReminder);
      inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') addReminder(); });
      closeBtn.addEventListener('click', () => App.reminders.close());

      // tab 切换
      tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          tabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          currentMode = tab.dataset.type;
          document.querySelector('.reminder-mode-interval').style.display = currentMode === 'interval' ? 'flex' : 'none';
          document.querySelector('.reminder-mode-weekly').style.display = currentMode === 'weekly' ? 'flex' : 'none';
        });
      });
    },
    open, close, toggle,
    isOpen() { return isOpen; },
  };
})(window.PetApp);
