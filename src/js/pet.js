/* ============================================================
   pet.js - 渲染表现层（把状态映射到 DOM）
   支持部件级动画：头/身体/尾巴/耳朵/腿可单独驱动
   + 鼠标追踪（猫会转头看你）+ 悬停反应 + 丰富 idle 微动作
   挂载到 window.PetApp.pet
   ============================================================ */
window.PetApp = window.PetApp || {};

(function (App) {
  'use strict';

  const state = App.state;

  const els = {
    container: document.getElementById('pet-container'),
    pet: document.getElementById('pet'),
    bubble: document.getElementById('bubble'),
    bubbleText: document.querySelector('#bubble .bubble-text'),
    bed: document.getElementById('bed'),
    sign: document.getElementById('sign'),
    signText: document.querySelector('#sign .sign-text'),
  };

  const parts = {
    container: els.container,
    head: document.querySelector('.cat-head'),
    body: document.querySelector('.cat-body'),
    tail: document.querySelector('.cat-tail'),
    leftEar: document.querySelector('.ear.left-ear'),
    rightEar: document.querySelector('.ear.right-ear'),
    leftLeg: document.querySelector('.leg-left'),
    rightLeg: document.querySelector('.leg-right'),
    shadow: document.querySelector('.shadow'),
  };

  function getTarget(name) { return parts[name] || els.container; }

  let bubbleTimer = null;

  // 弹性缓动常量（带过冲，让动作更Q弹有力）
  const EASE_BOUNCE = 'cubic-bezier(.68,-0.35,.27,1.55)';
  const EASE_OUT_BACK = 'cubic-bezier(.34,1.56,.64,1)';
  const EASE_SNAP = 'cubic-bezier(.5,0,.3,1)';

  // 容器级动画互斥。bounce/superBounce/superShake/squish 都动 #pet-container 的
  // transform，双击会连着触发两次 squish()：两个动画同时跑、启动错开约 100ms，
  // 关键帧进度不同、每帧互相抢 transform → 肉眼可见的抖动/掉帧。
  let containerAnim = null;
  function animateContainer(keyframes, options) {
    if (containerAnim) { try { containerAnim.cancel(); } catch (e) {} }
    containerAnim = els.container.animate(keyframes, options);
    return containerAnim;
  }

  // 跳起时影子要跟着缩、跟着淡，落地再弹回来 —— 少了这一步就"飘"，
  // 这是桌面宠物重量感的关键。影子平时静止（不跟呼吸联动），只有离地时才变。
  function airShadow(dur, peak = 0.6) {
    try {
      parts.shadow.animate(
        [
          { transform: 'scale(1)', opacity: 0.32 },
          { transform: `scale(${peak})`, opacity: 0.12 },
          { transform: 'scale(1.07)', opacity: 0.38 },
          { transform: 'scale(1)', opacity: 0.32 },
        ],
        { duration: dur, easing: 'ease-out', fill: 'none' }
      );
    } catch (e) { /* 影子没了不影响主动作 */ }
  }

  // ============ 鼠标追踪：猫转头看鼠标 ============
  let lookAnim = null;
  let lastMouse = { x: 0, y: 0 };
  let hoverFrame = null;

  function lookAt(mx, my) {
    if (pet.isBusy || state.runtime.isDragging) return;
    const r = state.runtime;
    // 猫眼大致位置（容器内偏移）
    const eyeX = r.x + 80;
    const eyeY = r.y + 84;
    const dx = mx - eyeX;
    const dy = my - eyeY;
    // 朝向修正：facing-left 时水平翻转
    const facing = state.runtime.facing === 'left' ? -1 : 1;
    const headRot = Math.max(-14, Math.min(14, (dx / 120) * 12 * facing));
    const headTiltY = Math.max(-4, Math.min(4, (dy / 200) * 4));
    // 直接写 transform。之前这里每帧 head.animate()+cancel() 新建一个 WAAPI 动画，
    // 而且首尾关键帧完全相同、根本没插值 —— 纯粹的每帧分配开销，鼠标一动就掉帧。
    const target = `rotate(${headRot}deg) translateY(${headTiltY}px)`;
    if (parts.head.style.transform !== target) parts.head.style.transform = target;
  }

  // 悬停反应：尾巴加速 + 眼睛微放大（通过 body scale 暗示兴奋）
  let hoverTailBoost = false;
  function setHover(on) {
    if (hoverTailBoost === on) return;
    hoverTailBoost = on;
    if (on) {
      parts.tail.style.animationDuration = '1s';
      parts.tail.style.animationTimingFunction = 'cubic-bezier(.68,-0.3,.32,1.3)';
    } else {
      parts.tail.style.animationDuration = '';
      parts.tail.style.animationTimingFunction = '';
    }
  }

  // 重置头部朝向（才艺/idle 结束后）
  function resetLook() {
    if (lookAnim) try { lookAnim.cancel(); } catch (e) {}
    lookAnim = null;
    if (parts.head) parts.head.style.transform = '';
  }

  const pet = {
    els,
    parts,
    EASE_BOUNCE, EASE_OUT_BACK, EASE_SNAP,

    setMood(mood) { els.pet.setAttribute('data-mood', mood); },

    setFacing(dir) {
      if (dir === 'left') els.pet.classList.add('facing-left');
      else els.pet.classList.remove('facing-left');
    },

    // 走路状态：开/关腿摆与身体起伏（CSS 挂在 #pet-container.walking 上）。
    // 之前 isMoving 只写不读，走路动画也一直没有——猫是整只平移滑过去的。
    setWalking(on) {
      els.container.classList.toggle('walking', !!on);
    },

    setPosition(x, y) {
      els.container.style.left = x + 'px';
      els.container.style.top = y + 'px';
    },

    getPosition() {
      return { x: els.container.offsetLeft, y: els.container.offsetTop };
    },

    showBubble(text, duration = 3500) {
      els.bubbleText.textContent = text;
      els.bubble.classList.remove('hidden');
      requestAnimationFrame(() => {
        const r = state.runtime;
        const bw = els.bubble.offsetWidth;
        const bh = els.bubble.offsetHeight;
        let bx = r.x + 36;
        let by = r.y - bh - 6;
        if (bx + bw > window.innerWidth - 8) bx = r.x + 124 - bw;
        if (bx < 8) bx = 8;
        if (by < 8) by = r.y + 176 + 6;
        els.bubble.style.left = bx + 'px';
        els.bubble.style.top = by + 'px';
      });
      if (bubbleTimer) clearTimeout(bubbleTimer);
      if (duration > 0) bubbleTimer = setTimeout(() => pet.hideBubble(), duration);
    },

    hideBubble() {
      els.bubble.classList.add('hidden');
      if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
    },

    bounce() {
      animateContainer(
        [
          { transform: 'translateY(0) scale(1,1)' },
          { transform: 'translateY(-30px) scale(0.88,1.12)' },
          { transform: 'translateY(-10px) scale(1.05,0.96)' },
          { transform: 'translateY(0) scale(1,1)' },
        ],
        { duration: 520, easing: EASE_OUT_BACK }
      );
      airShadow(520);
    },

    // 超级弹跳 + 粒子爆发（摸头/开心时用）
    superBounce() {
      animateContainer(
        [
          { transform: 'translateY(0) scale(1,1)' },
          { transform: 'translateY(8px) scale(1.2,0.8)' },  // 蓄力压扁
          { transform: 'translateY(-50px) scale(0.82,1.18)' }, // 弹起拉伸
          { transform: 'translateY(-60px) scale(1.02,0.98)' }, // 最高点
          { transform: 'translateY(-15px) scale(1.1,0.9)' },  // 落下压扁
          { transform: 'translateY(0) scale(1,1)' },
        ],
        { duration: 700, easing: 'cubic-bezier(.5,0,.5,1)' }
      );
      airShadow(700, 0.42);
      // 粒子爆发
      pet.spawnEmojis(['✨', '💫', '⭐', '💕'], 8, 'burst');
    },

    // 夸张摇晃（提醒/惊讶时用）
    superShake() {
      animateContainer(
        [
          { transform: 'translateX(0) rotate(0deg)' },
          { transform: 'translateX(-12px) rotate(-5deg)' },
          { transform: 'translateX(12px) rotate(5deg)' },
          { transform: 'translateX(-9px) rotate(-3deg)' },
          { transform: 'translateX(9px) rotate(3deg)' },
          { transform: 'translateX(-5px) rotate(-2deg)' },
          { transform: 'translateX(0) rotate(0deg)' },
        ],
        { duration: 600, easing: 'ease-out' }
      );
    },

    // 被抓起时的挤压（拖拽中持续微动）
    squish() {
      animateContainer(
        [
          { transform: 'scale(1,1)' },
          { transform: 'scale(0.92,1.08)' },
          { transform: 'scale(1.02,0.98)' },
          { transform: 'scale(1,1)' },
        ],
        { duration: 350, easing: EASE_BOUNCE }
      );
    },

    // 闪屏特效（提醒/重要事件用）
    flashScreen(color = 'rgba(255,200,100,0.3)') {
      let flash = document.getElementById('flash-overlay');
      if (!flash) {
        flash = document.createElement('div');
        flash.id = 'flash-overlay';
        flash.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:9999;opacity:0;';
        document.body.appendChild(flash);
      }
      flash.style.background = color;
      flash.animate(
        [{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }],
        { duration: 400, easing: 'ease-out' }
      );
    },

    // 爆炸粒子（大事件用）
    burst(emojis = ['🎉', '✨', '⭐', '💫', '💕'], count = 12) {
      pet.spawnEmojis(emojis, count, 'burst');
    },

    // 显示床（睡觉时）
    showBed() {
      els.bed.classList.remove('hidden');
      requestAnimationFrame(() => els.bed.classList.add('show'));
    },
    hideBed() {
      els.bed.classList.remove('show');
      setTimeout(() => { if (!state.runtime.isSleeping) els.bed.classList.add('hidden'); }, 500);
    },

    // 显示/隐藏吉他（唱歌时）
    showGuitar() {
      const g = document.getElementById('guitar');
      if (g) { g.classList.remove('hidden'); requestAnimationFrame(() => g.classList.add('show')); }
    },
    hideGuitar() {
      const g = document.getElementById('guitar');
      if (g) { g.classList.remove('show'); setTimeout(() => g.classList.add('hidden'), 300); }
    },

    // 显示/隐藏墨镜（唱歌时戴）
    showSunglasses() { els.pet.classList.add('wearing-sunglasses'); },
    hideSunglasses() { els.pet.classList.remove('wearing-sunglasses'); },

    // 举牌提醒
    showSign(text, duration = 6000) {
      els.signText.textContent = text;
      els.sign.classList.remove('hidden');
      requestAnimationFrame(() => {
        const r = state.runtime;
        const sw = els.sign.offsetWidth;
        const sh = els.sign.offsetHeight;
        // 默认放猫的左上方
        let sx = r.x + 80 - sw / 2;
        let sy = r.y - sh - 24;
        if (sx < 8) sx = 8;
        if (sx + sw > window.innerWidth - 8) sx = window.innerWidth - sw - 8;
        if (sy < 8) sy = r.y + 176 + 14; // 上方放不下放下方
        els.sign.style.left = sx + 'px';
        els.sign.style.top = sy + 'px';
      });
      if (pet._signTimer) clearTimeout(pet._signTimer);
      if (duration > 0) pet._signTimer = setTimeout(() => pet.hideSign(), duration);
    },
    hideSign() {
      els.sign.classList.add('hidden');
      if (pet._signTimer) { clearTimeout(pet._signTimer); pet._signTimer = null; }
    },

    isBusy: false,

    // 多阶段动画引擎
    // stage = { duration, mood?, particles?, easing?, anims?:[{target,keyframes,easing?}] }
    async performTrick(stages) {
      if (pet.isBusy) return false;
      pet.isBusy = true;
      stopIdle();
      resetLook();
      setHover(false);
      try {
        for (const stage of stages) {
          if (stage.mood) pet.setMood(stage.mood);
          if (stage.particles) {
            pet.spawnEmojis(stage.particles.emojis, stage.particles.count, stage.particles.mode);
          }
          const anims = stage.anims || (stage.keyframes ? [{ target: 'container', keyframes: stage.keyframes }] : []);
          if (anims.length) {
            const ps = anims.map((a) => {
              const el = getTarget(a.target);
              return el.animate(a.keyframes, {
                duration: stage.duration,
                easing: a.easing || stage.easing || 'ease-in-out',
                fill: 'none',
              }).finished;
            });
            await Promise.all(ps);
          } else {
            await new Promise((r) => setTimeout(r, stage.duration));
          }
        }
      } finally {
        pet.isBusy = false;
        resetLook();
        startIdle();
      }
      return true;
    },

    lookAt,
    setHover,

    spawnEmojis(emojis, count = 5, mode = 'rise') {
      let layer = document.getElementById('fx-layer');
      if (!layer) {
        layer = document.createElement('div');
        layer.id = 'fx-layer';
        layer.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:15;overflow:visible;';
        document.body.appendChild(layer);
      }
      const r = state.runtime;
      const baseX = r.x + 80;
      const baseY = r.y + 30;
      for (let i = 0; i < count; i++) {
        const span = document.createElement('span');
        span.className = 'fx-emoji';
        span.textContent = emojis[Math.floor(Math.random() * emojis.length)];
        let dx, dy, rot, dur;
        if (mode === 'burst') {
          const ang = Math.random() * Math.PI * 2;
          const dist = 70 + Math.random() * 80;
          dx = Math.cos(ang) * dist; dy = Math.sin(ang) * dist - 20;
          rot = (Math.random() - 0.5) * 160;
          dur = 1300 + Math.random() * 500;
        } else if (mode === 'spiral') {
          const ang = (i / count) * Math.PI * 2;
          const dist = 90 + Math.random() * 30;
          dx = Math.cos(ang) * dist; dy = Math.sin(ang) * dist - 50;
          rot = (ang * 180) / Math.PI;
          dur = 1300 + i * 70;
        } else if (mode === 'trail') {
          dx = (Math.random() - 0.5) * 50;
          dy = -120 - Math.random() * 60;
          rot = (Math.random() - 0.5) * 60;
          dur = 1000 + Math.random() * 500;
        } else {
          dx = (Math.random() - 0.5) * 90;
          dy = -80 - Math.random() * 90;
          rot = (Math.random() - 0.5) * 80;
          dur = 1200 + Math.random() * 800;
        }
        span.style.left = baseX + 'px';
        span.style.top = baseY + 'px';
        span.style.setProperty('--dx', dx + 'px');
        span.style.setProperty('--dy', dy + 'px');
        span.style.setProperty('--rot', rot + 'deg');
        span.style.animationDuration = dur + 'ms';
        layer.appendChild(span);
        setTimeout(() => span.remove(), dur + 50);
      }
    },

    startIdle, stopIdle,
  };

  // ============ 原地动态（idle）============
  // 机械感来自三件事，这里逐一避开：
  //   ① 完美周期 —— 所有动作都是一次性 WAAPI，下次什么时候来由随机决定
  //   ② 永远在动 —— 大概率什么都不做。真猫绝大部分时间是静止的，持续微动=提线木偶
  //   ③ 均匀分布 —— 间隔用指数分布（多短偶长）。均匀分布看着就像定时器
  // 另外两条：
  //   · 动作互斥，别让两个动画叠在同一个部件上互相抢 transform
  //   · 走路时整个跳过。脚本动画优先级高于 CSS 动画，idle 在走路途中触发会盖掉
  //     .walking 上的 walk-* —— 表现是走着走着突然伸懒腰、或者头被抢去转
  let idleTimer = null;
  let actingUntil = 0;

  // 偶尔换掉呼吸/尾巴的周期。固定正弦是最容易被看出"是段循环"的地方，
  // 周期一变就再也对不上拍子了。
  function jitterBreath() {
    parts.body.style.setProperty('--breathe-dur', (3600 + Math.random() * 2800) + 'ms');
    parts.tail.style.setProperty('--tail-dur', (3800 + Math.random() * 3400) + 'ms');
  }

  function idleStep() {
    if (pet.isBusy || state.runtime.isDragging || state.runtime.isSleeping
        || els.container.classList.contains('walking')) {
      idleTimer = setTimeout(idleStep, 1200);
      return;
    }
    if (Date.now() < actingUntil) {          // 上一个动作还没完，别叠上去
      idleTimer = setTimeout(idleStep, 260);
      return;
    }

    const roll = Math.random();
    if (roll < 0.22) {
      // 什么都不做 —— 这一项比任何动作都重要
    } else if (roll < 0.40) {
      // 单耳抽动
      const ear = Math.random() < 0.5 ? parts.leftEar : parts.rightEar;
      try { ear.animate(
        [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-22deg)' }, { transform: 'rotate(0deg)' }],
        { duration: 300, easing: EASE_OUT_BACK, fill: 'none' }
      ); } catch (e) {}
      actingUntil = Date.now() + 320;
    } else if (roll < 0.50) {
      // 双耳先后抽（警觉）
      try {
        parts.leftEar.animate(
          [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-22deg)' }, { transform: 'rotate(0deg)' }],
          { duration: 260, easing: EASE_OUT_BACK, fill: 'none' });
        setTimeout(() => { try { parts.rightEar.animate(
          [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-22deg)' }, { transform: 'rotate(0deg)' }],
          { duration: 260, easing: EASE_OUT_BACK, fill: 'none' }); } catch (e) {} }, 150);
      } catch (e) {}
      actingUntil = Date.now() + 480;
    } else if (roll < 0.64) {
      // 甩尾：一下甩完就收，跟底座的慢摆区分开
      try { parts.tail.animate(
        [
          { transform: 'rotate(0deg)' },
          { transform: 'rotate(26deg)' },
          { transform: 'rotate(-11deg)' },
          { transform: 'rotate(0deg)' },
        ],
        { duration: 460, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'none' });
      } catch (e) {}
      actingUntil = Date.now() + 480;
    } else if (roll < 0.75) {
      // 换重心：抬一只前爪再放下
      const leg = Math.random() < 0.5 ? parts.leftLeg : parts.rightLeg;
      try { leg.animate(
        [
          { transform: 'translateY(0) rotate(0deg)' },
          { transform: 'translateY(-7px) rotate(13deg)' },
          { transform: 'translateY(-7px) rotate(13deg)' },
          { transform: 'translateY(0) rotate(0deg)' },
        ],
        { duration: 720, easing: 'ease-in-out', fill: 'none' });
      } catch (e) {}
      actingUntil = Date.now() + 740;
    } else if (roll < 0.85) {
      // 瞥一眼（小角度，不是 18 度那种大转头）
      const dir = Math.random() < 0.5 ? 1 : -1;
      try { parts.head.animate(
        [{ transform: 'rotate(0deg)' }, { transform: `rotate(${dir * 11}deg)` }, { transform: `rotate(${dir * 11}deg)` }, { transform: 'rotate(0deg)' }],
        { duration: 1150, easing: 'ease-in-out', fill: 'none' });
      } catch (e) {}
      actingUntil = Date.now() + 1180;
    } else if (roll < 0.91) {
      // 抖毛（像刚被摸过/甩水）
      try { parts.body.animate(
        [
          { transform: 'translateX(0) rotate(0deg)' },
          { transform: 'translateX(-3px) rotate(-2deg)' },
          { transform: 'translateX(3px) rotate(2deg)' },
          { transform: 'translateX(-2px) rotate(-1deg)' },
          { transform: 'translateX(0) rotate(0deg)' },
        ],
        { duration: 320, easing: 'ease-out', fill: 'none' });
      } catch (e) {}
      actingUntil = Date.now() + 340;
    } else if (roll < 0.96) {
      // 伸懒腰（身体拉长 + 前腿前伸）
      try {
        parts.body.animate(
          [{ transform: 'scale(1,1)' }, { transform: 'scale(1.18,0.9)' }, { transform: 'scale(1,1)' }],
          { duration: 900, easing: EASE_OUT_BACK, fill: 'none' });
        parts.leftLeg.animate(
          [{ transform: 'translateY(0)' }, { transform: 'translateY(4px)' }, { transform: 'translateY(0)' }],
          { duration: 900, easing: 'ease-out', fill: 'none' });
        parts.rightLeg.animate(
          [{ transform: 'translateY(0)' }, { transform: 'translateY(4px)' }, { transform: 'translateY(0)' }],
          { duration: 900, easing: 'ease-out', fill: 'none' });
      } catch (e) {}
      actingUntil = Date.now() + 950;
    } else {
      // 舔爪（低头 + 抬爪）。稀有，所以才显得是"活的"而不是在循环
      const leg = Math.random() < 0.5 ? parts.leftLeg : parts.rightLeg;
      try {
        parts.head.animate(
          [{ transform: 'rotate(0deg)' }, { transform: 'rotate(12deg) translateY(3px)' }, { transform: 'rotate(12deg) translateY(3px)' }, { transform: 'rotate(0deg)' }],
          { duration: 1250, easing: 'ease-in-out', fill: 'none' });
        leg.animate(
          [{ transform: 'translateY(0) rotate(0deg)' }, { transform: 'translateY(-11px) rotate(19deg)' }, { transform: 'translateY(-11px) rotate(19deg)' }, { transform: 'translateY(0) rotate(0deg)' }],
          { duration: 1250, easing: 'ease-in-out', fill: 'none' });
      } catch (e) {}
      actingUntil = Date.now() + 1300;
    }

    // 口水：偶尔滴一次就没了。原来是 `drool 1.6s infinite` —— 饿着的时候
    // 每 1.6 秒滴一滴滴到天荒地老，那就是"一直流汗"。
    if (els.pet.getAttribute('data-mood') === 'hungry' && Math.random() < 0.35) {
      const d = els.pet.querySelector('.drool');
      if (d) try { d.animate(
        [
          { transform: 'scaleY(0.3)', opacity: 0 },
          { transform: 'scaleY(1.3)', opacity: 0.8, offset: 0.42 },
          { transform: 'scaleY(1.3) translateY(8px)', opacity: 0 },
        ],
        { duration: 1150, easing: 'ease-in', fill: 'none' });
      } catch (e) {}
    }

    jitterBreath();
    idleTimer = setTimeout(idleStep, state.expo(4200, 1100, 15000));
  }

  // ============ 眨眼：随机间隔，偶尔连眨 ============
  // 原来是 CSS `blink 5s infinite` —— 精确 5 秒一次，看两轮就知道是段动画了。
  let blinkTimer = null;
  function blinkOnce() {
    document.querySelectorAll('.eye-normal .eye-shape').forEach((el) => {
      try { el.animate(
        [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0.08)' }, { transform: 'scaleY(1)' }],
        { duration: 150, easing: 'ease-in-out', fill: 'none' });
      } catch (e) {}
    });
  }
  function scheduleBlink() {
    if (blinkTimer) clearTimeout(blinkTimer);
    blinkTimer = setTimeout(() => {
      blinkOnce();
      if (Math.random() < 0.22) setTimeout(blinkOnce, 190);   // 两成概率连眨两下
      scheduleBlink();
    }, state.expo(3400, 1600, 11000));
  }
  function startIdle() {
    jitterBreath();
    if (!idleTimer) idleTimer = setTimeout(idleStep, state.expo(2600, 900, 7000));
    if (!blinkTimer) scheduleBlink();
  }
  function stopIdle() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (blinkTimer) { clearTimeout(blinkTimer); blinkTimer = null; }
  }

  App.pet = pet;
  startIdle();
})(window.PetApp);
