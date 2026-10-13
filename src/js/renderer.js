/* ============================================================
   renderer.js - 入口：初始化所有模块、设置初始位置、托盘回调
   挂载到 window.PetApp.init
   ============================================================ */
window.PetApp = window.PetApp || {};
window.PetApp.uiOpen = 0; // UI 打开计数（菜单/对话框），>0 时整窗不穿透

(async function (App) {
  'use strict';

  const state = App.state;
  const pet = App.pet;

  // 获取屏幕工作区尺寸
  const bounds = await window.pet.getScreenBounds();

  // 初始化各模块
  App.movement.init(bounds);

  // 初始位置：主屏活动区地面（坐标是窗口局部的，bounds.areas 已换算好）
  App.movement.placeInZone();
  pet.setFacing('right');
  pet.setMood(state.computeMood());

  App.interaction.init();
  App.care.init();
  App.chat.init();
  App.todo.init();
  App.weather.init();
  App.fileops.init();
  App.reminders.init();
  if (App.skills) App.skills.init();
  if (App.mcp) App.mcp.init();
  if (App.ima) App.ima.init();
  if (App.settings) App.settings.init();
  if (App.avatar) App.avatar.init();
  if (App.meeting) App.meeting.init();
  if (App.scheduled) App.scheduled.init();

  // 启动自由走动（只在各自显示器工作区右侧的活动区里，贴地走）
  App.movement.start();

  // 托盘菜单动作
  window.pet.onTrayAction((action) => {
    switch (action) {
      case 'feed':
        App.care.openMenu(state.runtime.x + 80, Math.max(8, state.runtime.y - 10));
        break;
      case 'chat':
        App.chat.toggle();
        break;
      case 'todo':
        App.todo.toggle();
        break;
      case 'weather':
        App.weather.show('南京');
        break;
      case 'memory':
        App.chat.showMemory();
        break;
      case 'reminders':
        if (App.reminders) App.reminders.toggle();
        break;
      case 'scheduled':
        if (App.scheduled) App.scheduled.toggle();
        break;
      case 'sleep':
        state.setRuntime({ isSleeping: true });
        pet.setMood('sleepy');
        if (App.movement) App.movement.stop();
        pet.showBed();
        pet.showBubble('呼…我先睡会儿~', 2800);
        break;
    }
  });

  // 监听循环提醒到点：猫举牌 + 弹气泡 + 浮夸动画
  window.pet.onRecurringRemind((data) => {
    pet.showSign('⏰ ' + data.text, 12000);
    pet.showBubble('喵！' + data.text, 8000);
    pet.superShake();
    pet.flashScreen('rgba(255,180,60,0.25)');
    pet.burst(['⏰', '✨', '❗', '💫'], 10);
  });

  // 欢迎语
  setTimeout(() => {
    pet.showBubble('喵~我是小橘！双击聊天，右键喂食/才艺/待办/天气！', 5500);
  }, 900);

  console.log('[小橘猫缘缘] 初始化完成 ~');
})(window.PetApp);
