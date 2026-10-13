/* ============================================================
   care.js - 喂食养成 + 才艺展示系统（大幅优质版）
   幅度加大 ×1.6 + 预备帧/余动帧 + 弹性缓动 + 多部件并行
   挂载到 window.PetApp.care
   ============================================================ */
window.PetApp = window.PetApp || {};

(function (App) {
  'use strict';

  const state = App.state;
  let pet;
  let menuEl;

  const EB = 'cubic-bezier(.68,-0.35,.27,1.55)'; // 弹性过冲
  const EOB = 'cubic-bezier(.34,1.56,.64,1)';     // 回弹
  const ESNAP = 'cubic-bezier(.5,0,.3,1)';        // 快速

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function totalDur(stages) { return stages.reduce((s, st) => s + (st.duration || 0), 0); }

  const items = [
    // ============ 互动 ============
    { id: 'chat', emoji: '💬', name: '聊天', effect: {}, word: '' },
    { id: 'todo', emoji: '📋', name: '待办事项', effect: {}, word: '' },
    { id: 'reminders', emoji: '⏰', name: '循环提醒', effect: {}, word: '' },
    { id: 'scheduled', emoji: '🔄', name: '定时任务', effect: {}, word: '' },
    { id: 'skills', emoji: '🧩', name: '技能', effect: {}, word: '' },
    { id: 'mcp', emoji: '🔌', name: 'MCP 工具', effect: {}, word: '' },
    { id: 'ima', emoji: '📚', name: '知识库', effect: {}, word: '' },
    { id: 'meeting', emoji: '🎙️', name: '会议纪要', effect: {}, word: '' },
    { id: 'weather', emoji: '🌤️', name: '天气', effect: {}, word: '' },
    { id: 'settings', emoji: '⚙️', name: '设置', effect: {}, word: '' },
    { id: 'whoami', emoji: '🐱', name: '自我介绍', effect: {}, word: '' },
    // 窗口出口：以前想让开只能去托盘右键，但 skipTaskbar 让人根本不知道有托盘
    { id: 'hidepet', emoji: '🫥', name: '隐藏小橘', effect: {}, word: '我先躲起来，点托盘图标叫我~' },
    { id: 'quit', emoji: '🚪', name: '退出小橘', effect: {}, word: '' },
    { id: 'sleep', emoji: '😴', name: '睡觉', effect: {}, word: '呼…我先睡会儿~', group: 'interactive' },
    { id: 'canned', emoji: '🥫', name: '猫罐头',
      effect: { hunger: 34, happiness: 3 },
      word: '咕噜咕噜…吃饱啦嗝~',
      group: 'interactive',
      // 大幅低头猛吃（头压低+身体压扁弹）→ 抬头放大打嗝（耳后仰+身体回弹）
      stages: [
        { duration: 1600, mood: 'eating', particles: { emojis: ['💕'], count: 4, mode: 'rise' }, anims: [
          { target: 'head', keyframes: [
            { transform: 'translateY(0) scaleY(1) rotate(0deg)' },
            { transform: 'translateY(12px) scaleY(0.9) rotate(-6deg)' },
            { transform: 'translateY(3px) scaleY(0.97) rotate(2deg)' },
            { transform: 'translateY(12px) scaleY(0.9) rotate(-6deg)' },
            { transform: 'translateY(3px) scaleY(0.97) rotate(2deg)' },
            { transform: 'translateY(12px) scaleY(0.9) rotate(-6deg)' },
            { transform: 'translateY(0) scaleY(1) rotate(0deg)' },
          ]},
          { target: 'body', keyframes: [
            { transform: 'scale(1,1)' },
            { transform: 'scale(1.08,0.9)' },
            { transform: 'scale(1,1)' },
            { transform: 'scale(1.08,0.9)' },
            { transform: 'scale(1,1)' },
            { transform: 'scale(1.08,0.9)' },
            { transform: 'scale(1,1)' },
          ]},
        ]},
        { duration: 720, mood: 'happy', easing: EOB, particles: { emojis: ['💕', '✨'], count: 6, mode: 'burst' }, anims: [
          { target: 'head', keyframes: [
            { transform: 'translateY(0) scale(1)' },
            { transform: 'translateY(-20px) scale(1.16)' },
            { transform: 'translateY(0) scale(1)' },
          ]},
          { target: 'leftEar', keyframes: [
            { transform: 'rotate(0deg)' }, { transform: 'rotate(-30deg)' }, { transform: 'rotate(-8deg)' },
          ]},
          { target: 'rightEar', keyframes: [
            { transform: 'rotate(0deg)' }, { transform: 'rotate(-30deg)' }, { transform: 'rotate(-8deg)' },
          ]},
          { target: 'body', keyframes: [
            { transform: 'scale(1,1)' }, { transform: 'scale(0.94,1.06)' }, { transform: 'scale(1,1)' },
          ]},
        ]},
      ]},

    { id: 'water', emoji: '💧', name: '喝水',
      effect: { hunger: 5, cleanliness: 12 },
      word: '咕嘟咕嘟~解渴喵~',
      group: 'interactive',
      // 大幅俯身舔水（头低+前倾）反复 → 舔嘴抬头
      stages: [
        { duration: 1600, mood: 'happy', particles: { emojis: ['💧'], count: 5, mode: 'rise' }, anims: [
          { target: 'head', keyframes: [
            { transform: 'translateY(0) rotate(0deg)' },
            { transform: 'translateY(15px) rotate(16deg)' },
            { transform: 'translateY(10px) rotate(-6deg)' },
            { transform: 'translateY(15px) rotate(16deg)' },
            { transform: 'translateY(10px) rotate(-6deg)' },
            { transform: 'translateY(15px) rotate(16deg)' },
            { transform: 'translateY(0) rotate(0deg)' },
          ]},
          { target: 'body', keyframes: [
            { transform: 'scale(1,1)' },
            { transform: 'scale(1.03,0.96)' },
            { transform: 'scale(1,1)' },
            { transform: 'scale(1.03,0.96)' },
            { transform: 'scale(1,1)' },
            { transform: 'scale(1.03,0.96)' },
            { transform: 'scale(1,1)' },
          ]},
        ]},
        { duration: 560, mood: 'happy', easing: EOB, particles: { emojis: ['✨'], count: 3, mode: 'rise' }, anims: [
          { target: 'head', keyframes: [
            { transform: 'translateY(0)' }, { transform: 'translateY(-8px)' }, { transform: 'translateY(0)' },
          ]},
        ]},
      ]},

    // ============ 才艺 ============
    { id: 'jump', emoji: '🤸', name: '跳高高',
      effect: { happiness: 11, energy: -6 },
      word: '蓄力…起飞！看我翻个跟头喵！',
      group: 'interactive',
      // 大幅蓄力（深蹲）→ 腾空翻跟头（腿大收+尾大甩）→ 落地重压扬尘
      stages: [
        { duration: 340, mood: 'normal', easing: ESNAP, anims: [
          { target: 'container', keyframes: [
            { transform: 'scale(1,1)' }, { transform: 'scale(1.2,0.72)' }, { transform: 'scale(0.95,1.05)' },
          ]},
        ]},
        { duration: 780, mood: 'happy', easing: 'cubic-bezier(.25,0,.6,1)',
          particles: { emojis: ['⭐', '💨'], count: 8, mode: 'trail' }, anims: [
          { target: 'container', keyframes: [
            { transform: 'translateY(0) rotate(0deg) scale(1)' },
            { transform: 'translateY(-180px) rotate(180deg) scale(1.06)', offset: 0.5 },
            { transform: 'translateY(0) rotate(360deg) scale(1)' },
          ]},
          { target: 'tail', keyframes: [
            { transform: 'rotate(0deg)' }, { transform: 'rotate(50deg)' }, { transform: 'rotate(0deg)' },
          ]},
          { target: 'leftLeg', keyframes: [
            { transform: 'rotate(0deg)' }, { transform: 'rotate(-28deg)' }, { transform: 'rotate(0deg)' },
          ]},
          { target: 'rightLeg', keyframes: [
            { transform: 'rotate(0deg)' }, { transform: 'rotate(28deg)' }, { transform: 'rotate(0deg)' },
          ]},
        ]},
        { duration: 420, mood: 'surprised', easing: EOB,
          particles: { emojis: ['💨'], count: 6, mode: 'burst' }, anims: [
          { target: 'container', keyframes: [
            { transform: 'scale(1,1)' }, { transform: 'scaleY(0.72) scaleX(1.2)' }, { transform: 'scale(1,1)' },
          ]},
        ]},
      ]},

    { id: 'cute', emoji: '🥺', name: '卖萌',
      effect: { happiness: 7, energy: -1 },
      word: '喵~人家这么可爱，多摸摸嘛~',
      group: 'interactive',
      // 大幅放大歪头 → 爱心大爆发 → 耳朵大抽+头大摆
      stages: [
        { duration: 680, mood: 'happy', easing: EOB, anims: [
          { target: 'head', keyframes: [
            { transform: 'scale(1) rotate(0deg)' },
            { transform: 'scale(1.35) rotate(-12deg)' },
            { transform: 'scale(1) rotate(0deg)' },
          ]},
        ]},
        { duration: 480, mood: 'happy',
          particles: { emojis: ['❤️', '💕', '💖'], count: 12, mode: 'burst' }, anims: [
          { target: 'head', keyframes: [
            { transform: 'scale(1)' }, { transform: 'scale(1.16)' }, { transform: 'scale(1)' },
          ]},
        ]},
        { duration: 520, mood: 'happy', easing: 'ease-in-out', anims: [
          { target: 'head', keyframes: [
            { transform: 'rotate(0deg)' }, { transform: 'rotate(-10deg)' },
            { transform: 'rotate(10deg)' }, { transform: 'rotate(-6deg)' },
            { transform: 'rotate(0deg)' },
          ]},
          { target: 'leftEar', keyframes: [
            { transform: 'rotate(0deg)' }, { transform: 'rotate(-32deg)' }, { transform: 'rotate(0deg)' },
          ]},
          { target: 'rightEar', keyframes: [
            { transform: 'rotate(0deg)' }, { transform: 'rotate(-32deg)' }, { transform: 'rotate(0deg)' },
          ]},
        ]},
      ]},

    { id: 'sing', emoji: '🎵', name: '唱歌',
      effect: { happiness: 9, energy: -3 },
      word: '喵~咪~嗦~给本橘猫来点掌声喵！',
      group: 'interactive',
      // 弹吉他版：先掏出吉他 → 4 拍弹唱 → 收起吉他谢幕
      stages: [
        // 第0拍：掏出吉他，蓄力
        { duration: 400, mood: 'happy', easing: ESNAP, anims: [
          { target: 'container', keyframes: [
            { transform: 'scale(1,1)' }, { transform: 'scale(1.1,0.9)' }, { transform: 'scale(1,1)' },
          ]},
        ]},
      ].concat([0,1,2,3].map((beat) => ({
        duration: beat < 3 ? 560 : 720,
        mood: 'happy',
        particles: { emojis: ['🎵', '🎶', '🎸', '✨', '🎤'], count: beat < 3 ? 3 : 6, mode: 'rise' },
        easing: EOB,
        anims: [
          // 头大幅点动（像跟着节拍）
          { target: 'head', keyframes: [
            { transform: 'translateY(0) rotate(-5deg)' },
            { transform: `translateY(${beat<3?-14:-20}px) rotate(8deg)` },
            { transform: 'translateY(0) rotate(-5deg)' },
          ]},
          // 身体随节拍前后晃
          { target: 'body', keyframes: [
            { transform: 'translateX(0) rotate(0deg)' },
            { transform: `translateX(${beat % 2 ? 4 : -4}px) rotate(${beat % 2 ? 2 : -2}deg)` },
            { transform: 'translateX(0) rotate(0deg)' },
          ]},
          // 尾巴大摆
          { target: 'tail', keyframes: [
            { transform: 'rotate(0deg)' },
            { transform: `rotate(${beat % 2 ? -25 : 25}deg)` },
            { transform: 'rotate(0deg)' },
          ]},
        ],
      }))).concat([
        // 谢幕：鞠躬 + 粒子爆发
        { duration: 600, mood: 'happy',
          particles: { emojis: ['🎉', '👏', '✨', '🎸'], count: 8, mode: 'burst' },
          easing: EOB, anims: [
          { target: 'container', keyframes: [
            { transform: 'scale(1,1)' },
            { transform: 'scale(1.05,0.95)' },
            { transform: 'scale(1,1)' },
          ]},
          { target: 'head', keyframes: [
            { transform: 'translateY(0) rotate(0deg)' },
            { transform: 'translateY(8px) rotate(12deg)' },
            { transform: 'translateY(0) rotate(0deg)' },
          ]},
        ]},
      ]) },
  ];

  function buildMenu() {
    menuEl.innerHTML = '';

    const topItems = items.filter(i => !i.group);
    const interactiveItems = items.filter(i => i.group === 'interactive');

    // 渲染顶层菜单项
    topItems.forEach((item) => {
      menuEl.appendChild(createMenuItem(item));
    });

    // 互动折叠区
    if (interactiveItems.length) {
      const header = document.createElement('div');
      header.className = 'menu-collapse-header';
      header.innerHTML = '<span>🎭 互动</span><span class="menu-collapse-arrow">▼</span>';
      const body = document.createElement('div');
      body.className = 'menu-collapse-body collapsed';
      interactiveItems.forEach((item) => {
        body.appendChild(createMenuItem(item));
      });
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        header.classList.toggle('open');
        body.classList.toggle('collapsed');
      });
      menuEl.appendChild(header);
      menuEl.appendChild(body);
    }
  }

  function createMenuItem(item) {
    const div = document.createElement('div');
    div.className = 'menu-item';
    let effectText = '';
    if (item.effect) {
      const parts = [];
      if (item.effect.hunger) parts.push((item.effect.hunger > 0 ? '+' : '') + item.effect.hunger + '饱');
      if (item.effect.happiness) parts.push((item.effect.happiness > 0 ? '+' : '') + item.effect.happiness + '心');
      if (item.effect.energy) parts.push((item.effect.energy > 0 ? '+' : '') + item.effect.energy + '力');
      if (item.effect.cleanliness) parts.push((item.effect.cleanliness > 0 ? '+' : '') + item.effect.cleanliness + '净');
      effectText = parts.join(' ');
    }
    div.innerHTML = `<span class="menu-emoji">${item.emoji}</span><span>${item.name}</span>` +
      (effectText ? `<span class="menu-effect">${effectText}</span>` : '');
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      handleItem(item);
      App.care.closeMenu();
      if (App.uiOpen > 0) window.pet.setIgnoreMouse(false);
    });
    return div;
  }

  async function handleItem(item) {
    if (item.id === 'hidepet') { if (window.pet.hidePet) window.pet.hidePet(); return; }
    if (item.id === 'quit') {
      // 退出是不可逆的，必须二次确认
      if (window.confirm && !window.confirm('确定要退出小橘吗？')) return;
      if (window.pet.quitApp) window.pet.quitApp();
      return;
    }
    if (item.id === 'chat') { if (App.chat) App.chat.toggle(); return; }
    if (item.id === 'todo') { if (App.todo) App.todo.toggle(); return; }
    if (item.id === 'reminders') { if (App.reminders) App.reminders.toggle(); return; }
    if (item.id === 'scheduled') { if (App.scheduled) App.scheduled.toggle(); return; }
    if (item.id === 'skills') { if (App.skills) App.skills.open(); return; }
    if (item.id === 'mcp') { if (App.mcp) App.mcp.open(); return; }
    if (item.id === 'ima') { if (App.ima) App.ima.open(); return; }
    if (item.id === 'meeting') { if (App.meeting) App.meeting.toggle(); return; }
    if (item.id === 'settings') { if (App.settings) App.settings.open(); return; }
    if (item.id === 'whoami') { if (App.whoami) App.whoami.show(); return; }
    if (item.id === 'weather') { if (App.weather) App.weather.show(); return; }
    if (item.id === 'sleep') {
      state.setRuntime({ isSleeping: true });
      pet.setMood('sleepy');
      if (App.movement) App.movement.stop();
      pet.els.container.classList.add('sleeping');
      pet.showBed();
      if (item.word) pet.showBubble(item.word, 2800);
      return;
    }
    if (pet.isBusy) return;

    if (item.effect) state.adjust(item.effect);
    state.setRuntime({ isSleeping: false });
    if (App.movement) App.movement.stop();

    const total = item.stages ? totalDur(item.stages) : 1200;
    if (item.word) pet.showBubble(item.word, total + 1000);

    // 唱歌前掏出吉他 + 戴墨镜
    if (item.id === 'sing') { pet.showGuitar(); pet.showSunglasses(); }

    if (item.stages) await pet.performTrick(item.stages);

    // 唱歌后收起吉他 + 摘墨镜
    if (item.id === 'sing') { pet.hideGuitar(); pet.hideSunglasses(); }

    pet.setMood(state.computeMood());
    if (App.movement) App.movement.start();
  }

  function tick() {
    if (state.runtime.isDragging) return;
    const adj = { hunger: -1.4, happiness: -0.9 };
    if (state.runtime.isSleeping) {
      adj.energy = 2.4; adj.hunger = -0.7; adj.happiness = 0.2;
    } else {
      adj.energy = -0.6;
    }
    state.adjust(adj);
    if (state.stats.energy < 15 && !state.runtime.isSleeping) {
      state.setRuntime({ isSleeping: true });
      pet.setMood('sleepy');
      if (App.movement) App.movement.stop();
      pet.els.container.classList.add('sleeping');
      pet.showBed();
      pet.showBubble('呼…我困了，先睡会儿~', 3000);
    } else if (state.runtime.isSleeping && state.stats.energy > 85) {
      state.setRuntime({ isSleeping: false });
      pet.els.container.classList.remove('sleeping');
      pet.hideBed();
      pet.setMood('happy');
      pet.showBubble('喵~睡饱啦！精神满满！', 3000);
      if (App.movement) App.movement.start();
    }
    maybeComplain();
    if (!state.runtime.isSleeping && !state.runtime.isDragging && !App.uiOpen && !pet.isBusy) {
      pet.setMood(state.computeMood());
    }
  }

  function maybeComplain() {
    if (state.runtime.isSleeping || pet.isBusy) return;
    if (Math.random() > 0.35) return;
    const s = state.stats;
    if (s.hunger < 22) {
      pet.showBubble('喵呜…好饿好饿，快给我吃的嘛！', 3500);
      pet.setMood('hungry');
    } else if (s.happiness < 22) {
      pet.showBubble('呜…好无聊，让我表演个才艺逗逗你呀？', 3500);
      pet.setMood('sad');
    } else if (s.energy < 18) {
      pet.showBubble('哈欠…好困哦…', 3000);
      pet.setMood('sleepy');
    }
  }

  App.care = {
    init() {
      pet = App.pet;
      menuEl = document.getElementById('menu');
      buildMenu();
      window.addEventListener('mousedown', (e) => {
        if (menuEl.classList.contains('hidden')) return;
        if (!menuEl.contains(e.target) && !pet.els.container.contains(e.target)) {
          App.care.closeMenu();
        }
      }, true);
      setInterval(tick, 8000);
    },
    openMenu(x, y) {
      menuEl.classList.remove('hidden');
      const mx = clamp(x, 8, window.innerWidth - menuEl.offsetWidth - 8);
      const my = clamp(y, 8, window.innerHeight - menuEl.offsetHeight - 8);
      menuEl.style.left = mx + 'px';
      menuEl.style.top = my + 'px';
      App.uiOpen = (App.uiOpen || 0) + 1;
      // 菜单打开时强制不穿透，这样点击空白处才能触发 mousedown 关闭菜单
      window.pet.setIgnoreMouse(false);
    },
    closeMenu() {
      if (menuEl.classList.contains('hidden')) return;
      menuEl.classList.add('hidden');
      if (App.uiOpen) App.uiOpen = Math.max(0, App.uiOpen - 1);
      // 只有当没有任何 UI 面板打开时才恢复鼠标穿透
      if (!App.uiOpen) window.pet.setIgnoreMouse(true);
    },
    feed: (item) => handleItem(item),
  };
})(window.PetApp);
