/* ============================================================
   movement.js - 桌面走动
   ------------------------------------------------------------
   桌面宠物的三条底线，都直接决定"像不像活物"：
     1. 走路要像走路 —— 腿在摆、身体在起伏，不是整只猫平移滑过去
     2. 不悬空       —— 只在地面上走。停在半空是最出戏的
     3. 不挡工作区   —— 只在各显示器工作区右侧约 28% 的"活动区"活动
   坐标系：窗口局部坐标。窗口是按「所有显示器的并集」创建的（origin 可能为负），
   所以每个显示器的工作区都要先换算到窗口局部，见 main.js 的 get-screen-bounds。
   挂载到 window.PetApp.movement
   ============================================================ */
window.PetApp = window.PetApp || {};

(function (App) {
  'use strict';

  const state = App.state;
  let pet;
  const PET_W = 160, PET_H = 176;
  const BOTTOM_MARGIN = 8;
  const STEP_PX = 120;        // 单次走动的步幅
  const ZONE_RATIO = 0.72;    // 活动区左边界：工作区宽度的 72% 处
  const WALK_CYCLE_MS = 450;  // 单腿摆动周期，约 2.2Hz —— 真猫的步频
  const WALK_SPEED = 6.6;     // ms/px ≈ 150px/s，散步的速度（再快就成了滑行）
  let areas = [];             // 各显示器工作区（窗口局部坐标），主屏排第一
  let desk = { x1: 0, y1: 0, x2: 0, y2: 0 };
  let walkTimer = null;

  // 找 (x, y) 落在哪个显示器的工作区；不在任何区里就退回到主屏
  function areaFor(x, y) {
    for (const a of areas) {
      if (x >= a.x && x < a.x + a.width && y >= a.y && y < a.y + a.height) return a;
    }
    return areas[0] || { x: desk.x1, y: desk.y1, width: desk.x2 - desk.x1, height: desk.y2 - desk.y1 };
  }
  function groundYFor(a) { return a.y + a.height - PET_H - BOTTOM_MARGIN; }
  function zoneLeftFor(a) { return a.x + Math.floor(a.width * ZONE_RATIO); }
  function zoneRightFor(a) { return a.x + a.width - PET_W - 8; }
  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  // 只在活动区里横着走；垂直方向永远贴地（不悬空）
  function pickTarget() {
    const r = state.runtime;
    const a = areaFor(r.x + PET_W / 2, r.y + PET_H / 2);
    const want = Math.max(zoneLeftFor(a), Math.min(zoneRightFor(a), r.x + rand(-STEP_PX, STEP_PX)));
    // 用户可能把猫拖到了活动区外（拖拽是有意为之，见 applyGravity）。回来时
    // 也是一小步一小步挪，不瞬移——一次跨半个屏幕比走过去更出戏。
    const x = Math.max(r.x - STEP_PX, Math.min(r.x + STEP_PX, want));
    return { x, y: groundYFor(a) };
  }

  function scheduleNext() {
    if (walkTimer) clearTimeout(walkTimer);
    // 走动间隔用指数分布（多短偶长）。原来是 8~18 秒均匀 + 50% 概率原地不动，
    // 算下来平均 26 秒才挪一次 —— 太安静了。现在平均约 6 秒动一次。
    walkTimer = setTimeout(randomMove, state.expo(4800, 2000, 12000));
  }

  function randomMove() {
    pet = pet || App.pet;
    // 拖拽中/睡觉中或 UI 打开时不动
    if (state.runtime.isDragging || state.runtime.isSleeping || App.uiOpen) { scheduleNext(); return; }

    // 原地休息的概率。原来 50%，配上长间隔几乎不怎么动。
    if (Math.random() < 0.2) {
      pet.setMood(state.computeMood());
      scheduleNext();
      return;
    }

    const r = state.runtime;
    const target = pickTarget();
    const dx = target.x - r.x, dy = target.y - r.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) { scheduleNext(); return; }

    const dir = dx > 6 ? 'right' : (dx < -6 ? 'left' : r.facing);
    state.setFacing(dir);
    pet.setFacing(dir);

    // 步频是常数：真猫不会因为路远就跑，只会迈大步。所以腿的摆动周期固定，
    // 只有位移时长随距离变。原来写成 dur/3 —— 走 120px 时腿摆到 8Hz，那是在抽搐。
    const dur = Math.max(WALK_CYCLE_MS, Math.min(2400, Math.round(dist * WALK_SPEED)));
    const c = pet.els.container;
    c.style.setProperty('--walk-dur', WALK_CYCLE_MS + 'ms');
    c.style.setProperty('--walk-tail', Math.round(WALK_CYCLE_MS * 1.55) + 'ms');
    c.style.transition = `left ${dur}ms linear, top ${dur}ms linear`;

    pet.setWalking(true);
    pet.setPosition(target.x, target.y);
    state.setPosition(target.x, target.y);

    setTimeout(() => {
      c.style.transition = '';
      pet.setWalking(false);
      // 被抓走了就别再自作主张
      if (!state.runtime.isDragging) {
        pet.setMood(state.computeMood());
        // 偶尔落地弹一下，收尾有点生气
        if (Math.random() < 0.18) pet.bounce();
      }
      scheduleNext();
    }, dur + 30);
  }

  App.movement = {
    init(bounds) {
      areas = (bounds && Array.isArray(bounds.areas) && bounds.areas.length)
        ? bounds.areas
        : [{ x: 0, y: 0, width: bounds.width, height: bounds.height }];
      // 全部工作区的并集，用来保证拖拽后不越出可见桌面
      desk = {
        x1: Math.min(...areas.map((a) => a.x)),
        y1: Math.min(...areas.map((a) => a.y)),
        x2: Math.max(...areas.map((a) => a.x + a.width)),
        y2: Math.max(...areas.map((a) => a.y + a.height)),
      };
      pet = App.pet;
    },

    start() { scheduleNext(); },
    stop() {
      if (walkTimer) clearTimeout(walkTimer);
      walkTimer = null;
      if (pet) pet.setWalking(false);
    },

    // 初始化时把宠物放到主屏活动区地面
    placeInZone() {
      pet = pet || App.pet;
      const a = areas[0];
      const x = zoneLeftFor(a) + Math.floor((zoneRightFor(a) - zoneLeftFor(a)) / 2);
      const y = groundYFor(a);
      pet.setPosition(x, y);
      state.setPosition(x, y);
    },

    // 拖拽松手后落回地面。x 保留用户拖到的位置（拖拽是有意为之），
    // 只保证不越出可见桌面；下一次自主走动会慢慢挪回活动区。
    applyGravity() {
      pet = pet || App.pet;
      const r = state.runtime;
      const gx = Math.max(desk.x1, Math.min(desk.x2 - PET_W, r.x));
      const gy = groundYFor(areaFor(gx + PET_W / 2, r.y + PET_H / 2));
      if (r.y >= gy - 1 && r.x === gx) { scheduleNext(); return; }

      const c = pet.els.container;
      c.style.transition = 'top 0.55s cubic-bezier(.55,0,.9,.5), left 0.45s linear';
      pet.setMood('surprised');
      pet.setWalking(false);
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
