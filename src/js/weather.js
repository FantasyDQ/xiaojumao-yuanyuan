/* ============================================================
   weather.js - 天气查询与展示（地区可配置）
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
  let savedCity = localStorage.getItem('pet_weather_city') || '南京';

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
        App.weather.show(savedCity, true);
        if (hideTimer) clearTimeout(hideTimer);
      });
      // 地区配置按钮
      const configBtn = cardEl.querySelector('.weather-config');
      if (configBtn) {
        configBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (hideTimer) clearTimeout(hideTimer);
          App.weather.showConfigInput();
        });
      }
      // 鼠标离开天气面板时缩短消失时间
      cardEl.addEventListener('mouseleave', () => {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => App.weather.hide(), 3000);
      });
      cardEl.addEventListener('mouseenter', () => {
        if (hideTimer) clearTimeout(hideTimer);
      });
    },

    showConfigInput() {
      // 阻止天气卡片自动隐藏
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      // 用自定义输入框替代原生 prompt（Electron 默认禁用 prompt）
      let overlay = document.getElementById('weatherConfigOverlay');
      if (overlay) overlay.remove();
      overlay = document.createElement('div');
      overlay.id = 'weatherConfigOverlay';
      overlay.className = 'weather-config-overlay';
      overlay.innerHTML = `
        <div class="weather-config-box">
          <div class="weather-config-title">🌤️ 配置天气城市</div>
          <input type="text" id="weatherConfigInput" class="weather-config-input" placeholder="城市名，如：南京、北京、上海" value="${savedCity}" />
          <div class="weather-config-btns">
            <button class="weather-config-cancel">取消</button>
            <button class="weather-config-ok">保存</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      // 阻止鼠标穿透：overlay 区域强制不穿透
      overlay.addEventListener('mouseenter', () => { if (window.pet) window.pet.setIgnoreMouse(false); });
      overlay.addEventListener('mousemove', (e) => {
        e.stopPropagation();
        if (window.pet) window.pet.setIgnoreMouse(false);
      });
      const input = overlay.querySelector('#weatherConfigInput');
      input.focus();
      input.select();
      const close = () => { overlay.remove(); };
      overlay.querySelector('.weather-config-cancel').addEventListener('click', (e) => { e.stopPropagation(); close(); });
      overlay.querySelector('.weather-config-ok').addEventListener('click', (e) => {
        e.stopPropagation();
        const city = input.value.trim();
        if (city) {
          savedCity = city;
          localStorage.setItem('pet_weather_city', savedCity);
          overlay.remove();
          App.weather.show(savedCity, true);
        }
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') overlay.querySelector('.weather-config-ok').click();
        if (e.key === 'Escape') close();
      });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    },

    getCity() { return savedCity; },

    async show(city, forceRefresh = false) {
      const queryCity = city || savedCity;
      position();
      const emojiEl = cardEl.querySelector('.weather-emoji');
      const textEl = cardEl.querySelector('.weather-text');
      emojiEl.textContent = '⏳';
      textEl.innerHTML = `<span class="weather-city">${forceRefresh ? '刷新中…' : `查询${queryCity}天气…`}</span>`;
      cardEl.classList.remove('hidden');
      if (!shown) {
        App.uiOpen = (App.uiOpen || 0) + 1;
        shown = true;
      }

      const w = await window.pet.getWeather(queryCity, forceRefresh);
      if (w.error) {
        emojiEl.textContent = '😿';
        textEl.innerHTML = `<span class="weather-city">${w.error}</span>`;
        pet.showBubble('喵…天气查不到，网络可能有点问题~', 3500);
      } else {
        // 天气类型 → emoji 映射（长的 key 优先匹配，避免"雷阵雨"被"阵雨"先截获）
        const WEATHER_EMOJI = [
          ['特大暴雨', '⛈️'], ['大暴雨', '⛈️'], ['雷阵雨', '⛈️'], ['暴雨', '⛈️'],
          ['雷暴', '⛈️'], ['大雨', '🌧️'], ['中雨', '🌧️'], ['小雨', '🌧️'],
          ['阵雨', '🌧️'], ['冻雨', '🌧️'], ['雨夹雪', '🌨️'],
          ['暴雪', '❄️'], ['大雪', '❄️'], ['中雪', '🌨️'], ['小雪', '🌨️'], ['阵雪', '🌨️'],
          ['沙尘暴', '🌪️'], ['扬沙', '🌪️'], ['浮尘', '😷'], ['霾', '🌫️'],
          ['雾', '🌫️'], ['多云', '⛅'], ['阴', '☁️'], ['晴', '☀️'],
        ];
        let emoji = '🌤️';
        for (const [key, icon] of WEATHER_EMOJI) {
          if (w.desc.includes(key)) { emoji = icon; break; }
        }
        emojiEl.textContent = emoji;
        const descText = w.desc;
        let fresh = '';
        if (w.cached && w.cachedAt) {
          const min = Math.floor((Date.now() - w.cachedAt) / 60000);
          fresh = w.stale ? '缓存·离线' : (min < 1 ? '缓存·刚刚' : `缓存·${min}分钟前`);
        } else {
          fresh = '实时';
        }
        textEl.innerHTML =
          `<div class="weather-temp">${w.tempC}°C</div>` +
          `<div class="weather-city">${w.city} · ${descText} <span class="weather-fresh">${fresh}</span></div>` +
          `<div class="weather-extra">湿度 ${w.humidity} · ${w.windDir} ${w.windKmph}${w.quality ? ' · ' + w.quality : ''}</div>` +
          `<div class="weather-tomorrow">今 ${w.todayType} ${w.todayMin}~${w.todayMax}°C</div>` +
          `<div class="weather-tomorrow">明 ${w.tomorrowType} ${w.tomorrowMin}~${w.tomorrowMax}°C</div>`;
        pet.showBubble(`喵~${w.city}现在${descText}，${w.tempC}°C，湿度${w.humidity}！`, 5000);
      }

      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => App.weather.hide(), 5000);
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
