/* ============================================================
   movement.js - 桌面走动（限定在屏幕右侧"活动区"上下跑，不挡工作区）
   挂载到 window.PetApp.movement
   ============================================================ */
window.PetApp = window.PetApp || {};

(function (App) {
  'use strict';

  const state = App.state;
  let pet;
  const PET_W = 160, PET_H = 176;
  const BOTTOM_MARGIN = 8;
  let screenW = 0, screenH = 0;
  let walkTimer = null;

  // 右侧活动区：占屏幕右侧约 26% 宽度，避免挡住主工作区
  function zoneLeft() { return Math.floor(screenW * 0.72); }
  function zoneRight() { return screenW - PET_W - 8; }
  function groundY() { return screenH - PET_H - BOTTOM_MARGIN; }
  function topY() { return Math.floor(screenH * 0.12); } // 可爬到的最高点
  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  // 在活动区内随机选一个目标点（x 在区内，y 在顶部~地面间）
  function pickTarget() {
    const x = rand(zoneLeft(), zoneRight());
    // 60% 概率回地面，40% 概率爬高一点
    const y = Math.random() < 0.6 ? groundY() : rand(topY(), groundY() - 60);
    return { x, y };
  }

  function scheduleNext() {
    if (walkTimer) clearTimeout(walkTimer);
    walkTimer = setTimeout(randomMove, rand(5000, 11000));
  }

  function randomMove() {
    pet = pet || App.pet;
    // 拖拽中/睡觉中或 UI 打开时不动
    if (state.runtime.isDragging || state.runtime.isSleeping || App.uiOpen) { scheduleNext(); return; }

    // 30% 概率原地休息
    if (Math.random() < 0.3) {
      pet.setMood(state.computeMood());
      scheduleNext();
      return;
    }

    const r = state.runtime;
    const target = pickTarget();
    const dir = target.x > r.x + 6 ? 'right' : (target.x < r.x - 6 ? 'left' : r.facing);
    state.setFacing(dir);
    pet.setFacing(dir);

    // 是否主要垂直移动（上下跑）
    const verticalMove = Math.abs(target.y - r.y) > 50;

    state.setRuntime({ isMoving: true });
    // 垂直爬升/下落用更柔和的曲线，水平平移保持默认
    const c = pet.els.container;
    if (verticalMove) {
      c.style.transition = 'top 0.9s cubic-bezier(.4,.7,.5,1), left 0.7s linear';
      pet.setMood(target.y < r.y ? 'happy' : 'normal'); // 爬上去开心
    } else {
      c.style.transition = '';
    }
    pet.setPosition(target.x, target.y);
    state.setPosition(target.x, target.y);

    const dur = verticalMove ? 950 : 500;
    setTimeout(() => {
      c.style.transition = '';
      if (!state.runtime.isDragging) {
        state.setRuntime({ isMoving: false });
        pet.setMood(state.computeMood());
      }
      scheduleNext();
    }, dur);
  }

  App.movement = {
    init(bounds) {
      screenW = bounds.width;
      screenH = bounds.height;
      pet = App.pet;
    },

    start() { scheduleNext(); },
    stop() { if (walkTimer) clearTimeout(walkTimer); walkTimer = null; },

    getGroundY: () => groundY(),
    getZone: () => ({ left: zoneLeft(), right: zoneRight(), groundY: groundY(), topY: topY() }),

    // 初始化时把宠物放到右侧活动区地面
    placeInZone() {
      pet = pet || App.pet;
      const x = Math.floor((zoneLeft() + zoneRight()) / 2);
      const y = groundY();
      pet.setPosition(x, y);
      state.setPosition(x, y);
    },

    // 拖拽松手后自由落体到地面（仍限制在右侧活动区内）
    applyGravity() {
      pet = pet || App.pet;
      const r = state.runtime;
      // 若被拖出活动区，拉回区内
      const gx = Math.max(zoneLeft(), Math.min(zoneRight(), r.x));
      const gy = groundY();
      if (r.y >= gy - 1 && r.x === gx) { scheduleNext(); return; }

      const c = pet.els.container;
      c.style.transition = 'top 0.55s cubic-bezier(.55,0,.9,.5), left 0.45s linear';
      pet.setMood('surprised');
      pet.setPosition(gx, gy);
      state.setPosition(gx, gy);

      setTimeout(() => {
        c.style.transition = '';
        pet.bounce();
        pet.setMood(state.computeMood());
        scheduleNext();
      }, 580);
    },
  };
})(window.PetApp);
