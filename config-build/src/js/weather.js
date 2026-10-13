/* ============================================================
   weather.js - 天气查询与展示（南京天气）
   挂载到 window.PetApp.weather
   ============================================================ */
window.PetApp = window.PetApp || {};

(function (App) {
  'use strict';

  const state = App.state;
  let pet;
  let cardEl;
  let hideTimer = null;
  let shown = false; // 是否已展示（避免重复计数 uiOpen）

  function position() {
    const r = state.runtime;
    let x = r.x - 280;
    let y = r.y - 30;
    if (x < 8) x = r.x + 180;
    if (x + 260 > window.innerWidth - 8) x = window.innerWidth - 268;
    if (y < 8) y = r.y + 176 + 8;
    cardEl.style.left = x + 'px';
    cardEl.style.top = y + 'px';
  }

  App.weather = {
    init() {
      pet = App.pet;
      cardEl = document.getElementById('weather');
      const refreshBtn = cardEl.querySelector('.weather-refresh');
      refreshBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        App.weather.show('南京', true);
        if (hideTimer) clearTimeout(hideTimer);
      });
    },

    async show(city = '南京', forceRefresh = false) {
      position();
      const emojiEl = cardEl.querySelector('.weather-emoji');
      const textEl = cardEl.querySelector('.weather-text');
      emojiEl.textContent = '⏳';
      textEl.textContent = forceRefresh ? '刷新中…' : '正在查询南京天气…';
      cardEl.classList.remove('hidden');
      if (!shown) {
        App.uiOpen = (App.uiOpen || 0) + 1;
        shown = true;
      }

      const w = await window.pet.getWeather(city, forceRefresh);
      if (w.error) {
        emojiEl.textContent = '😿';
        textEl.textContent = w.error;
        pet.showBubble('喵…天气查不到，网络可能有点问题~', 3500);
      } else {
        emojiEl.textContent = w.desc.split(' ')[0] || '🌤️';
        // 数据新鲜度
        let fresh = '';
        if (w.cached && w.cachedAt) {
          const min = Math.floor((Date.now() - w.cachedAt) / 60000);
          fresh = w.stale ? '（缓存·离线）' : (min < 1 ? '（缓存·刚刚）' : `（缓存·${min}分钟前）`);
        } else {
          fresh = '（实时）';
        }
        textEl.innerHTML = `<b>${w.city}</b> ${w.desc} <span class="weather-fresh">${fresh}</span><br>` +
          `${w.tempC}°C（体感 ${w.feelsC}°C）· 湿度 ${w.humidity}%<br>` +
          `${w.windDir}风 ${w.windKmph}km/h · 今 ${w.todayMin}~${w.todayMax}°C 明 ${w.tomorrowMin}~${w.tomorrowMax}°C`;
        pet.showBubble(`喵~${w.city}现在${w.desc.replace(/^[^\s]+\s/, '')}，${w.tempC}°C，湿度${w.humidity}%！`, 5000);
      }

      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => App.weather.hide(), 8000);
    },

    hide() {
      if (cardEl.classList.contains('hidden')) return;
      cardEl.classList.add('hidden');
      shown = false;
      if (App.uiOpen) App.uiOpen = Math.max(0, App.uiOpen - 1);
      if (!App.uiOpen) window.pet.setIgnoreMouse(true);
    },
  };
})(window.PetApp);
