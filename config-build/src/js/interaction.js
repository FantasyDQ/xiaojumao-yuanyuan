/* ============================================================
   interaction.js - 鼠标交互（穿透切换 / 拖拽 / 点击摸头 / 右键菜单）
   挂载到 window.PetApp.interaction
   ============================================================ */
window.PetApp = window.PetApp || {};

(function (App) {
  'use strict';

  const state = App.state;
  let pet;

  let ignoreMouse = true;
  let isDragging = false;
  const dragOffset = { x: 0, y: 0 };
  let mouseDownPos = null;
  let mouseDownTime = 0;
  let hoverFrame = null;
  let lastMouse = { x: 0, y: 0 };
  let lastOnPet = null;

  // 摸头 / 点击语料
  const petWords = [
    '喵~好舒服，再摸摸我！',
    '咕噜咕噜…（舒服得打呼噜）',
    '喵嘿嘿，最喜欢被摸头了~',
    '喵呜~你好温柔呀！',
    '蹭蹭你~喵！',
  ];
  const clickWords = [
    '喵？戳我干嘛~',
    '喵！吓我一跳！',
    '嘿嘿，我在这呢~',
    '喵呜~想和我玩吗？',
  ];

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function setIgnore(ignore) {
    if (ignore === ignoreMouse) return;
    ignoreMouse = ignore;
    window.pet.setIgnoreMouse(ignore);
  }

  function isPointOnPet(x, y) {
    const rect = pet.els.container.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  // 需要精确命中检测的交互面板（打开时仍只在其范围内不穿透）
  const UI_PANELS = ['#chatbox', '#todopanel', '#weather', '#menu', '#filepanel', '#reminderPanel', '#settingsPanel'];

  // 判断鼠标是否在猫或任何已打开的面板上
  function isPointOnInteractive(x, y) {
    if (isPointOnPet(x, y)) return true;
    for (const sel of UI_PANELS) {
      const el = document.querySelector(sel);
      if (el && !el.classList.contains('hidden')) {
        const r = el.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
      }
    }
    return false;
  }

  function onMouseMove(e) {
    lastMouse = { x: e.clientX, y: e.clientY };
    // 只有鼠标在猫或打开的面板上时才不穿透，其余区域始终穿透
    const onInteractive = isPointOnInteractive(e.clientX, e.clientY);
    if (onInteractive !== lastOnPet) {
      console.log(`[ix] onInteractive=${onInteractive} ignore->${!onInteractive} mouse=${e.clientX},${e.clientY}`);
      lastOnPet = onInteractive;
    }
    setIgnore(!onInteractive);
    pet.setHover(isPointOnPet(e.clientX, e.clientY));

    // 鼠标追踪：猫转头看鼠标（节流到 rAF）
    if (!hoverFrame) {
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = null;
        pet.lookAt(lastMouse.x, lastMouse.y);
      });
    }

    if (isDragging) {
      const nx = e.clientX - dragOffset.x;
      const ny = e.clientY - dragOffset.y;
      pet.setPosition(nx, ny);
      state.setPosition(nx, ny);
    }
  }

  function onMouseDown(e) {
    console.log(`[ix] mousedown button=${e.button} onPet=${isPointOnPet(e.clientX, e.clientY)}`);
    if (e.button !== 0 || !isPointOnPet(e.clientX, e.clientY)) return;
    // 拖拽时唤醒（如果在睡觉）
    wakeUp();
    isDragging = true;
    const rect = pet.els.container.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    mouseDownPos = { x: e.clientX, y: e.clientY };
    mouseDownTime = Date.now();
    state.setRuntime({ isDragging: true, isMoving: false });
    pet.els.container.classList.add('dragging');
    pet.setMood('surprised');
    pet.squish(); // 被抓起的挤压感
    e.preventDefault();
  }

  function onMouseUp(e) {
    if (!isDragging) return;
    isDragging = false;
    pet.els.container.classList.remove('dragging');
    state.setRuntime({ isDragging: false });

    const dt = Date.now() - mouseDownTime;
    const moved = mouseDownPos && Math.hypot(e.clientX - mouseDownPos.x, e.clientY - mouseDownPos.y) > 5;

    // 松手后受重力影响下落
    if (App.movement && moved) App.movement.applyGravity();
    else if (!moved && dt < 350) onPetClick();

    setTimeout(() => { if (!state.runtime.isDragging) pet.setMood(state.computeMood()); }, 500);
  }

  // 唤醒：如果猫在睡觉，立即醒来站起来
  function wakeUp() {
    if (state.runtime.isSleeping) {
      state.setRuntime({ isSleeping: false });
      pet.els.container.classList.remove('sleeping');
      pet.hideBed();
      if (App.movement) App.movement.start();
      console.log('[ix] 猫被唤醒');
      return true;
    }
    return false;
  }

  function onPetClick() {
    if (pet.isBusy) return; // 才艺/进食进行中，不打断
    // 睡觉时点击 → 唤醒，不触发摸头动画
    if (wakeUp()) {
      pet.setMood('surprised');
      pet.showBubble('喵！…被吵醒了…', 2500);
      setTimeout(() => { if (!state.runtime.isSleeping) pet.setMood(state.computeMood()); }, 1500);
      return;
    }
    pet.setMood('happy');
    // 随机选择不同的摸头反应动画
    const reactions = [
      // 0: 超级弹跳 + 粒子爆发
      () => { pet.superBounce(); pet.spawnEmojis(['💕','✨','⭐'], 6, 'burst'); },
      // 1: 夸张摇晃 + 闪粉
      () => { pet.superShake(); pet.spawnEmojis(['✨','💫',' sparkle'], 5, 'rise'); },
      // 2: 挤压回弹 + 爱心上升
      () => { pet.squish(); pet.spawnEmojis(['💕','💗','💖'], 5, 'rise'); },
      // 3: 弹跳转圈 + 星星
      () => {
        pet.bounce();
        pet.els.container.animate(
          [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
          { duration: 600, easing: 'cubic-bezier(.34,1.56,.64,1)' }
        );
        pet.spawnEmojis(['⭐','💫','✨'], 6, 'spiral');
      },
      // 4: 前扑 + 亲亲
      () => {
        parts_head_forward();
        pet.spawnEmojis(['💋','💕','😘'], 5, 'rise');
      },
    ];
    reactions[Math.floor(Math.random() * reactions.length)]();
    pet.showBubble(pick(petWords));
    state.adjust({ happiness: 3 });
  }

  // 头前扑动画（摸头时猫往手的方向蹭）
  function parts_head_forward() {
    try {
      pet.parts.head.animate(
        [
          { transform: 'translateY(0) rotate(0deg) scale(1)' },
          { transform: 'translateY(8px) rotate(5deg) scale(1.08)' },
          { transform: 'translateY(0) rotate(0deg) scale(1)' },
        ],
        { duration: 400, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'none' }
      );
      pet.parts.body.animate(
        [
          { transform: 'scale(1,1)' },
          { transform: 'scale(1.05,0.95)' },
          { transform: 'scale(1,1)' },
        ],
        { duration: 400, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'none' }
      );
    } catch (e) {}
  }

  function onContextMenu(e) {
    console.log(`[ix] contextmenu onPet=${isPointOnPet(e.clientX, e.clientY)}`);
    if (!isPointOnPet(e.clientX, e.clientY)) return;
    e.preventDefault();
    if (App.care) App.care.openMenu(e.clientX, e.clientY);
  }

  function onDoubleClick(e) {
    console.log(`[ix] dblclick onPet=${isPointOnPet(e.clientX, e.clientY)}`);
    if (!isPointOnPet(e.clientX, e.clientY)) return;
    wakeUp(); // 双击也唤醒
    // 双击切换 AI 对话
    if (App.chat) App.chat.toggle();
  }

  App.interaction = {
    init() {
      pet = App.pet;
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('contextmenu', onContextMenu);
      window.addEventListener('dblclick', onDoubleClick);
    },
  };
})(window.PetApp);
