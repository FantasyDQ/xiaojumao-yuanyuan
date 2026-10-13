/* ============================================================
   todo.js - 待办事项管理（增删改查 + 定时提醒 + 猫举牌）
   挂载到 window.PetApp.todo
   支持完整的年月日时分截止时间，默认当前时间
   到期猫举牌 + 气泡提醒，未完成则每 5 分钟重复提醒（闭环）
   待办存在 localStorage，重启不丢失
   ============================================================ */
window.PetApp = window.PetApp || {};

(function (App) {
  'use strict';

  const state = App.state;
  let pet;
  let panelEl, listEl, inputEl, timeEl, addBtn;
  let isOpen = false;
  let checkTimer = null;

  const STORE_KEY = 'desktop-pet-todos-v1';
  let todos = [];

  function load() {
    try { todos = JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
    catch (e) { todos = []; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(todos)); } catch (e) {}
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // 当前时间格式化为 datetime-local 需要的格式：YYYY-MM-DDTHH:MM
  function nowLocalStr() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // datetime-local 字符串 -> 时间戳
  function parseDtLocal(s) {
    if (!s) return 0;
    const t = new Date(s);
    return isNaN(t.getTime()) ? 0 : t.getTime();
  }

  // 时间戳 -> 友好显示（MM-DD HH:MM）
  function fmtDeadline(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // 距离到期的剩余时间描述
  function fmtRemaining(ts) {
    if (!ts) return '';
    const diff = ts - Date.now();
    if (diff <= 0) return '已到期';
    const min = Math.round(diff / 60000);
    if (min < 60) return `${min}分钟后`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}小时${m}分后`;
  }

  function render() {
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!todos.length) return;
    // 未完成在前，按截止时间升序
    const sorted = [...todos].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return (a.ts || 0) - (b.ts || 0);
    });
    sorted.forEach((t) => {
      const div = document.createElement('div');
      div.className = 'todo-item' + (t.done ? ' done' : '');

      const check = document.createElement('div');
      check.className = 'todo-check';
      check.textContent = t.done ? '✓' : '';
      check.addEventListener('click', () => toggleDone(t.id));

      const wrap = document.createElement('div');
      wrap.className = 'todo-content';
      const text = document.createElement('div');
      text.className = 'todo-text';
      text.textContent = t.text;
      wrap.appendChild(text);

      if (t.ts) {
        const meta = document.createElement('div');
        meta.className = 'todo-meta';
        const overdue = !t.done && t.ts <= Date.now();
        meta.innerHTML = `<span class="todo-deadline${overdue ? ' overdue' : ''}">⏰ ${fmtDeadline(t.ts)}</span>` +
          `<span class="todo-remain">${t.done ? '已完成' : fmtRemaining(t.ts)}</span>`;
        wrap.appendChild(meta);
      }

      div.appendChild(check);
      div.appendChild(wrap);

      const del = document.createElement('button');
      del.className = 'todo-delete';
      del.textContent = '✕';
      del.title = '删除';
      del.addEventListener('click', () => removeTodo(t.id));
      div.appendChild(del);
      listEl.appendChild(div);
    });
  }

  function fillDefaultTime() {
    if (timeEl) timeEl.value = nowLocalStr();
  }

  function addTodo() {
    const text = inputEl.value.trim();
    if (!text) { inputEl.focus(); return; }
    const dtVal = timeEl.value;
    const ts = parseDtLocal(dtVal);
    const todo = {
      id: uid(), text, time: dtVal, ts,
      done: false, reminded: false,
      createdAt: Date.now(),
    };
    todos.push(todo);
    save();
    render();
    inputEl.value = '';
    fillDefaultTime(); // 重置为当前时间，方便连续添加
    inputEl.focus();
    pet.bounce();
    if (ts) {
      pet.showBubble(`记下啦喵！${fmtDeadline(ts)} 我会提醒你~`, 2800);
    } else {
      pet.showBubble('记下啦喵！', 2000);
    }
  }

  function toggleDone(id) {
    const t = todos.find((x) => x.id === id);
    if (!t) return;
    t.done = !t.done;
    if (t.done) { t.reminded = true; pet.hideSign(); }
    save(); render();
  }

  function removeTodo(id) {
    todos = todos.filter((x) => x.id !== id);
    save(); render();
  }

  // 定时检查提醒（每 10 秒）
  function checkReminders() {
    const now = Date.now();
    let changed = false;
    const due = [];
    todos.forEach((t) => {
      if (!t.done && t.ts && t.ts <= now && !t.reminded) {
        t.reminded = true;
        due.push(t);
        changed = true;
      }
    });
    if (changed) { save(); render(); }
    if (due.length) {
      const msg = due.map((t) => t.text).join('、');
      console.log('[todo] 提醒触发:', msg);
      // 猫举牌
      pet.showSign('⏰ 别忘啦！\n' + due.slice(0, 2).map((t) => t.text).join('\n'), 12000);
      pet.showBubble(`喵！到点啦，该做：${msg}！`, 8000);
      pet.superBounce();
      pet.flashScreen('rgba(100,180,255,0.2)');
      pet.burst(['⏰', '✨', '❗', '⭐'], 10);
      // 5 分钟后若仍未完成，再次提醒（闭环：避免漏提醒）
      setTimeout(() => {
        due.forEach((t) => {
          const todo = todos.find((x) => x.id === t.id);
          if (todo && !todo.done) {
            todo.reminded = false;
            console.log('[todo] 5分钟后重新提醒:', todo.text);
            save();
          }
        });
      }, 5 * 60 * 1000);
    }
  }

  function position() {
    const r = state.runtime;
    let x = r.x - 320;
    let y = r.y - 20;
    if (x < 8) x = r.x + 180;
    if (x + 300 > window.innerWidth - 8) x = Math.max(8, window.innerWidth - 308);
    if (y < 8) y = r.y + 176 + 8;
    if (y + 380 > window.innerHeight - 8) y = Math.max(8, window.innerHeight - 388);
    panelEl.style.left = x + 'px';
    panelEl.style.top = y + 'px';
  }

  App.todo = {
    init() {
      pet = App.pet;
      panelEl = document.getElementById('todopanel');
      listEl = document.getElementById('todoList');
      inputEl = document.getElementById('todoInput');
      timeEl = document.getElementById('todoTime');
      addBtn = document.getElementById('todoAdd');
      const closeBtn = document.querySelector('.todopanel-close');

      load();
      render();
      addBtn.addEventListener('click', addTodo);
      inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTodo(); });
      closeBtn.addEventListener('click', () => App.todo.close());

      // 每 10 秒检查一次提醒
      checkTimer = setInterval(checkReminders, 10000);
      // 启动时立即检查一次（处理关机期间到期的待办）
      setTimeout(checkReminders, 2000);

      // 监听主进程发来的对话创建定时提醒（对话意图路由）
      window.pet.onReminderCreate((data) => {
        const todo = {
          id: uid(), text: data.text, time: data.timeStr || '', ts: data.ts,
          done: false, reminded: false, createdAt: Date.now(),
        };
        todos.push(todo);
        save();
        render();
        const d = new Date(data.ts);
        const pad = (n) => String(n).padStart(2, '0');
        const label = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        console.log(`[todo] 对话创建定时提醒: ${data.text} @ ${label}`);
      });
    },

    open() {
      isOpen = true;
      panelEl.classList.remove('hidden');
      position();
      App.uiOpen = (App.uiOpen || 0) + 1;
      fillDefaultTime();
      render();
      setTimeout(() => inputEl.focus(), 100);
    },

    close() {
      if (!isOpen) return;
      isOpen = false;
      panelEl.classList.add('hidden');
      if (App.uiOpen) App.uiOpen = Math.max(0, App.uiOpen - 1);
      if (!App.uiOpen) window.pet.setIgnoreMouse(true);
    },

    toggle() { isOpen ? App.todo.close() : App.todo.open(); },
    addTodo, removeTodo, toggleDone, render, checkReminders,
  };
})(window.PetApp);
