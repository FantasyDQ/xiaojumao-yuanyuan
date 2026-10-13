/* ============================================================
   state.js - 宠物状态管理（属性值 + 运行时状态 + 持久化）
   挂载到 window.PetApp.state
   ============================================================ */
window.PetApp = window.PetApp || {};

(function (App) {
  'use strict';

  const STORE_KEY = 'desktop-pet-state-v1';
  let store;
  try { store = window.localStorage; } catch (e) { store = null; }

  function loadSaved() {
    if (!store) return null;
    try { return JSON.parse(store.getItem(STORE_KEY)); } catch (e) { return null; }
  }
  function saveStats() {
    if (!store) return;
    try {
      store.setItem(STORE_KEY, JSON.stringify({
        hunger: stats.hunger,
        happiness: stats.happiness,
        energy: stats.energy,
        cleanliness: stats.cleanness,
        bornAt: stats.bornAt,
      }));
    } catch (e) { /* 忽略 */ }
  }

  const saved = loadSaved() || {};

  // ===== 属性统计（0-100）=====
  const stats = {
    hunger: clamp(saved.hunger ?? 75),       // 饱腹度 100=最饱
    happiness: clamp(saved.happiness ?? 80), // 心情 100=最开心
    energy: clamp(saved.energy ?? 90),       // 精力 100=最精神
    cleanliness: clamp(saved.cleanliness ?? 100),
    bornAt: saved.bornAt ?? Date.now(),
  };

  function clamp(v) { return Math.max(0, Math.min(100, v)); }

  // ===== 运行时状态 =====
  const runtime = {
    mood: 'normal',    // normal/happy/sleepy/hungry/eating/surprised/sad
    facing: 'right',   // left/right
    x: 200,
    y: 0,
    isDragging: false,
    isMoving: false,
    isSleeping: false,
  };

  const listeners = [];
  function emit() {
    listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  }

  // 根据属性推断“自然表情”（临时表情由交互覆盖）
  function computeMood() {
    if (runtime.isSleeping) return 'sleepy';
    if (stats.energy < 18) return 'sleepy';
    if (stats.hunger < 25) return 'hungry';
    if (stats.happiness < 25) return 'sad';
    if (stats.happiness > 72 && stats.hunger > 45 && stats.energy > 40) return 'happy';
    return 'normal';
  }

  App.state = {
    get stats() { return stats; },
    get runtime() { return runtime; },

    get: (key) => (key in stats ? stats[key] : runtime[key]),
    set: (key, val) => {
      if (key in stats) { stats[key] = clamp(val); saveStats(); }
      else runtime[key] = val;
      emit();
    },

    // 调整属性（增量，自动 clamp）
    adjust: (patch) => {
      let changed = false;
      for (const k of Object.keys(patch)) {
        if (k in stats) {
          stats[k] = clamp(stats[k] + patch[k]);
          changed = true;
        }
      }
      if (changed) saveStats();
      emit();
      return stats;
    },

    // 更新运行时状态
    setRuntime: (patch) => {
      Object.assign(runtime, patch);
      emit();
    },

    setMood: (mood) => { runtime.mood = mood; emit(); },
    setFacing: (dir) => { runtime.facing = dir; emit(); },
    setPosition: (x, y) => { runtime.x = x; runtime.y = y; emit(); },

    computeMood,

    onChange: (fn) => { listeners.push(fn); return () => {
      const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1);
    }; },

    // 重置（调试用）
    reset: () => {
      stats.hunger = 75; stats.happiness = 80; stats.energy = 90; stats.cleanliness = 100;
      saveStats(); emit();
    },
  };
})(window.PetApp);
