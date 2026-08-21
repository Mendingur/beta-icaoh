'use strict';
/* ============================================================
   KHÚC CA HY VỌNG — ENGINE (v2: Event Map)
   Kiến trúc: 1 bản đồ tổng (world map) + N khu vực, mỗi khu vực
   là 1 module {key, name, mapPos, render(container)}. Người chơi
   chọn khu vực tự do (không ép tuyến tính cứng), mỗi khu vực có
   1 thử thách chính (câu đố logic) + các điểm khám phá phụ +
   rương ẩn. Tiến trình lưu trong bộ nhớ phiên (session state).
   ============================================================ */

const REGIONS = []; // mỗi region tự đăng ký vào đây ở cuối file riêng

const STATE = {
  totalStars: 0,          // tổng sao đã đạt (3 sao / khu vực)
  totalDiscoveries: 0,    // tổng điểm khám phá đã tìm
  totalChests: 0,         // tổng rương đã mở
  regionProgress: {},     // { key: { stars, discoveries:Set, chestOpened:bool, mainDone:bool } }
  muted: false,
  audioCtx: null,
  audioUnlocked: false,
};

// Cờ "đã xem màn ăn mừng hoàn thành event" — khai báo sớm (cùng STATE) để
// Persist.load() có thể gán giá trị an toàn bất kể thứ tự gọi trong file.
let eventCelebrated = false;

function getProgress(key) {
  if (!STATE.regionProgress[key]) {
    STATE.regionProgress[key] = { stars: 0, discoveries: new Set(), chestOpened: false, mainDone: false };
  }
  return STATE.regionProgress[key];
}

/* ============================================================
   PERSISTENCE — localStorage chuẩn của trình duyệt (bản deploy
   độc lập lên GitHub Pages, không phải Artifact claude.ai nên
   không có window.storage API). Lưu regionProgress + muted +
   eventCelebrated. Set không tự serialize được qua JSON.stringify
   nên phải chuyển sang Array khi lưu, và ngược lại khi tải.
   ============================================================ */
const Persist = (() => {
  const KEY = 'khucCaHyVong_save_v1';

  function save() {
    try {
      const serialized = {};
      Object.keys(STATE.regionProgress).forEach((k) => {
        const p = STATE.regionProgress[k];
        serialized[k] = { stars: p.stars, discoveries: Array.from(p.discoveries), chestOpened: p.chestOpened, mainDone: p.mainDone };
      });
      const payload = { v: 1, regionProgress: serialized, muted: STATE.muted, eventCelebrated: !!eventCelebrated };
      localStorage.setItem(KEY, JSON.stringify(payload));
    } catch (e) {
      // localStorage có thể bị chặn (chế độ ẩn danh nghiêm ngặt, quota đầy...) —
      // game vẫn chơi được bình thường trong phiên hiện tại, chỉ là không lưu lại.
    }
  }

  function hasSave() {
    try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return false;
      const payload = JSON.parse(raw);
      if (!payload || payload.v !== 1 || !payload.regionProgress) return false;
      Object.keys(payload.regionProgress).forEach((k) => {
        const p = payload.regionProgress[k];
        STATE.regionProgress[k] = {
          stars: p.stars || 0,
          discoveries: new Set(Array.isArray(p.discoveries) ? p.discoveries : []),
          chestOpened: !!p.chestOpened,
          mainDone: !!p.mainDone,
        };
      });
      STATE.muted = !!payload.muted;
      eventCelebrated = !!payload.eventCelebrated;
      return true;
    } catch (e) {
      return false;
    }
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  return { save, load, hasSave, clear };
})();

/* ---------------- DOM refs ---------------- */
const $ = (id) => document.getElementById(id);
const el = {
  screens: $('screens'),
  toast: $('toast'),
  dialogueCard: $('dialogueCard'),
  dSpeakerName: $('dSpeakerName'),
  dText: $('dText'),
  dActions: $('dActions'),
  modal: $('modal'),
  modalKicker: $('modalKicker'),
  modalTitle: $('modalTitle'),
  modalText: $('modalText'),
  modalStars: $('modalStars'),
  modalActions: $('modalActions'),
};

/* ============================================================
   AUDIO — tổng hợp thuần WebAudio, không phụ thuộc file ngoài
   ============================================================ */
const Audio_ = (() => {
  function ctx() {
    if (!STATE.audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      STATE.audioCtx = new AC();
    }
    return STATE.audioCtx;
  }
  function unlock() {
    if (STATE.audioUnlocked) return;
    STATE.audioUnlocked = true;
    try { ctx().resume(); } catch (e) {}
  }
  function tone(freq, dur, type = 'sine', gainPeak = 0.05, delay = 0) {
    if (STATE.muted) return;
    try {
      const c = ctx();
      const t0 = c.currentTime + delay;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(gainPeak, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(c.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.05);
    } catch (e) {}
  }
  function sfxCorrect() { tone(660, 0.22, 'sine', 0.06); tone(880, 0.28, 'sine', 0.045, 0.05); }
  function sfxWrong() { tone(160, 0.28, 'sawtooth', 0.05); }
  function sfxClick() { tone(520, 0.08, 'triangle', 0.03); }
  function sfxChest() { [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, 0.4, 'sine', 0.045, i * 0.07)); }
  function sfxComplete() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.5, 'sine', 0.05, i * 0.09)); }
  function sfxDiscover() { tone(784, 0.18, 'sine', 0.045); tone(988, 0.22, 'sine', 0.035, 0.06); }
  function toggleMute(btn) {
    STATE.muted = !STATE.muted;
    if (btn) { btn.textContent = STATE.muted ? '✕' : '♪'; btn.style.color = STATE.muted ? 'var(--paper-dim)' : ''; }
    Persist.save();
  }
  return { unlock, sfxCorrect, sfxWrong, sfxClick, sfxChest, sfxComplete, sfxDiscover, toggleMute };
})();

/* ============================================================
   UI HELPERS
   ============================================================ */
function toast(msg, kind = '') {
  el.toast.textContent = msg;
  el.toast.className = 'toast show' + (kind ? ' ' + kind : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.toast.classList.remove('show'), 2000);
}

function say(speaker, text, actions = []) {
  return new Promise((resolve) => {
    el.dSpeakerName.textContent = speaker;
    el.dText.textContent = text;
    el.dActions.innerHTML = '';
    el.dialogueCard.classList.add('show');
    const finish = (val) => { el.dialogueCard.classList.remove('show'); resolve(val); };
    if (actions.length === 0) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.textContent = 'Tiếp tục';
      btn.onclick = () => { Audio_.sfxClick(); finish(true); };
      el.dActions.appendChild(btn);
    } else {
      actions.forEach((a) => {
        const btn = document.createElement('button');
        btn.className = 'btn ' + (a.primary ? 'btn-primary' : 'btn-ghost');
        btn.textContent = a.label;
        btn.onclick = () => { Audio_.sfxClick(); finish(a.value); };
        el.dActions.appendChild(btn);
      });
    }
  });
}

function starsSVG(n, total = 3) {
  let s = '';
  for (let i = 0; i < total; i++) {
    const filled = i < n;
    s += `<div class="star-slot"><svg viewBox="0 0 24 24">
      <path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.9L5.7 21l1.7-7L2 9.2l7.1-.6L12 2z"
        fill="${filled ? 'url(#sg)' : 'rgba(255,255,255,.08)'}"
        stroke="${filled ? 'none' : 'rgba(255,255,255,.15)'}" />
      <defs><linearGradient id="sg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f6e2ad"/><stop offset="1" stop-color="#ff9d4d"/></linearGradient></defs>
    </svg></div>`;
  }
  return s;
}

function modal({ kicker = 'KHÚC CA HY VỌNG', title, text, stars = null, actions }) {
  return new Promise((resolve) => {
    el.modalKicker.textContent = kicker;
    el.modalTitle.textContent = title;
    el.modalText.textContent = text;
    if (stars !== null) {
      el.modalStars.style.display = 'flex';
      el.modalStars.innerHTML = starsSVG(0, 3);
      setTimeout(() => { el.modalStars.innerHTML = starsSVG(stars, 3); }, 250);
    } else {
      el.modalStars.style.display = 'none';
      el.modalStars.innerHTML = '';
    }
    el.modalActions.innerHTML = '';
    actions.forEach((a) => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (a.primary ? 'btn-primary' : 'btn-ghost');
      btn.textContent = a.label;
      btn.onclick = () => { Audio_.sfxClick(); el.modal.classList.remove('show'); resolve(a.value); };
      el.modalActions.appendChild(btn);
    });
    el.modal.classList.add('show');
  });
}

/* ============================================================
   SCREEN MANAGER — chuyển đổi giữa map và các khu vực
   ============================================================ */
function showScreen(html, id) {
  // QUAN TRỌNG: dọn sạch mọi screen khác (kể cả nội dung bên trong),
  // không chỉ bỏ class active — nếu không, các phần tử có cùng id
  // (vd. #mainChallengeBtn) từ screen cũ vẫn tồn tại trong DOM và
  // document.getElementById sẽ trả về nhầm phần tử cũ thay vì mới.
  Array.from(el.screens.children).forEach((child) => {
    if (child.id !== id) {
      child.classList.remove('active');
      child.innerHTML = '';
    }
  });
  let node = el.screens.querySelector(`#${id}`);
  if (!node) {
    node = document.createElement('div');
    node.className = 'screen';
    node.id = id;
    el.screens.appendChild(node);
  }
  node.innerHTML = html;
  requestAnimationFrame(() => node.classList.add('active'));
  return node;
}

/* ============================================================
   BOOT
   ============================================================ */
function boot() {
  const unlockOnce = () => { Audio_.unlock(); window.removeEventListener('pointerdown', unlockOnce); };
  window.addEventListener('pointerdown', unlockOnce);

  const hadSave = Persist.hasSave();
  if (hadSave) Persist.load();

  if (hadSave) {
    modal({
      kicker: 'QUYỂN I · THE SOWER\'S CYCLE',
      title: 'Chào mừng trở lại',
      text: 'Hành trình của bạn vẫn còn đó — mọi điểm khám phá, rương đã mở và ngôi sao đã đạt được đều được giữ nguyên.\n\nBạn muốn tiếp tục từ nơi đã dừng lại, hay bắt đầu một hành trình hoàn toàn mới?',
      actions: [
        { label: 'Tiếp tục hành trình', value: 'continue', primary: true },
        { label: 'Bắt đầu lại từ đầu', value: 'reset' },
      ],
    }).then((choice) => {
      if (choice === 'reset') {
        STATE.regionProgress = {};
        STATE.muted = false;
        eventCelebrated = false;
        Persist.clear();
      }
      renderMap();
    });
    return;
  }

  modal({
    kicker: 'QUYỂN I · THE SOWER\'S CYCLE',
    title: 'Khúc Ca Hy Vọng',
    text: 'Năm 2054, thế giới vỡ vụn thành ba mảnh chiến tranh. Giữa tro tàn, một cô gái vẫn tin vào ánh sáng nơi những vì sao.\n\nHãy khám phá năm vùng đất trong hành trình của Mai — mỗi nơi đều giấu những câu chuyện, thử thách và bí mật riêng. Không có đồng hồ đếm ngược nào cả — cứ thong thả mà đi.',
    actions: [{ label: 'Mở bản đồ hành trình', value: true, primary: true }],
  }).then(() => {
    renderMap();
  });
}

document.addEventListener('DOMContentLoaded', boot);

/* ============================================================
   EVENT COMPLETION — không phải "kết thúc ép buộc"; đây là màn
   ăn mừng khi hoàn thành thử thách chính của TẤT CẢ khu vực lần
   đầu, sau đó người chơi vẫn có thể quay lại bản đồ để cày thêm
   sao, khám phá còn thiếu, hoặc mở rương chưa lấy.
   ============================================================ */
async function checkEventCompletion() {
  const allMainDone = REGIONS.every(r => getProgress(r.key).mainDone);
  if (!allMainDone || eventCelebrated) return;
  eventCelebrated = true;
  const totals = computeTotals();
  const maxStars = totalStarsMax();
  Audio_.sfxComplete();
  await modal({
    kicker: 'HẾT QUYỂN I · KHÚC CA HY VỌNG',
    title: 'Những Hạt Giống Còn Sót Lại',
    text: `Gò Sen hồi sinh. Kaito trở về. Và trong ngăn cuối chiếc hòm gỗ gia truyền, một hạt giống lạ lẫm đang chờ một câu chuyện mới.\n\nBạn đã hoàn thành hành trình chính với ${totals.stars}/${maxStars} sao. Nhưng bản đồ vẫn còn đó — quay lại bất cứ lúc nào để tìm nốt những điểm khám phá, rương ẩn, hoặc thử lại các thử thách để đạt trọn vẹn 3 sao mỗi nơi.`,
    stars: null,
    actions: [{ label: 'Quay lại bản đồ', value: true, primary: true }],
  });
}
'use strict';
/* ============================================================
   WORLD MAP — màn hình trung tâm của event
   Hiển thị 5 khu vực trên 1 "con đường" minh hoạ, cho phép chọn
   tự do (không khoá tuyến tính — chỉ khu vực đầu mở sẵn, các khu
   vực sau mở dần khi khu vực trước đã có ít nhất 1 sao, để vẫn
   giữ mạch truyện nhưng không ép phải hoàn hảo mới đi tiếp).
   ============================================================ */

function regionUnlocked(index) {
  if (index === 0) return true;
  const prev = REGIONS[index - 1];
  return getProgress(prev.key).mainDone;
}

function totalStarsMax() { return REGIONS.length * 3; }
function totalDiscoveriesMax() { return REGIONS.reduce((s, r) => s + r.discoveries.length, 0); }
function totalChestsMax() { return REGIONS.length; }

function computeTotals() {
  let stars = 0, disc = 0, chests = 0;
  REGIONS.forEach(r => {
    const p = getProgress(r.key);
    stars += p.stars;
    disc += p.discoveries.size;
    chests += p.chestOpened ? 1 : 0;
  });
  return { stars, disc, chests };
}

// Bán kính hitbox lớn hơn bán kính hiển thị (30) để đảm bảo vùng chạm thực tế
// đạt tối thiểu 44px trên các viewport hẹp (320-375px) sau khi scale từ viewBox
// 360x640. Xem HANDOFF #2 — hitbox phải tính riêng biệt với phần hiển thị.
const MAP_NODE_DISPLAY_R = 30;
const MAP_NODE_HIT_R = 40;

function mapNodeSVG(region, index, state) {
  // state: 'locked' | 'open' | 'partial' | 'done'
  const colors = {
    locked: { ring: 'rgba(255,255,255,.15)', fill: 'rgba(255,255,255,.04)', icon: 'rgba(255,255,255,.25)' },
    open:   { ring: 'var(--amber)', fill: 'rgba(255,157,77,.14)', icon: 'var(--gold-0)' },
    partial:{ ring: 'var(--gold-1)', fill: 'rgba(232,197,118,.18)', icon: 'var(--gold-0)' },
    done:   { ring: 'var(--ok)', fill: 'rgba(143,227,166,.16)', icon: '#eafff0' },
  };
  const c = colors[state];
  const pulse = state === 'open' ? `<circle cx="0" cy="0" r="34" fill="none" stroke="${c.ring}" stroke-width="1.5" opacity=".6"><animate attributeName="r" values="30;40;30" dur="2.2s" repeatCount="indefinite"/><animate attributeName="opacity" values=".6;0;.6" dur="2.2s" repeatCount="indefinite"/></circle>` : '';
  return `
    <g class="map-node" data-region="${region.key}" data-state="${state}" style="cursor:${state === 'locked' ? 'default' : 'pointer'}">
      <circle cx="0" cy="0" r="${MAP_NODE_HIT_R}" fill="transparent" class="map-node-hit"/>
      ${pulse}
      <circle cx="0" cy="0" r="${MAP_NODE_DISPLAY_R}" fill="${c.fill}" stroke="${c.ring}" stroke-width="2" style="pointer-events:none"/>
      <text x="0" y="7" text-anchor="middle" font-size="22" fill="${c.icon}" style="pointer-events:none">${state === 'locked' ? '🔒' : region.glyph}</text>
    </g>
  `;
}

function renderMap() {
  const totals = computeTotals();
  const maxStars = totalStarsMax();

  // toạ độ 5 điểm dọc theo 1 con đường ngoằn nghèo trong viewBox 360x640 (dọc, mobile-first)
  const positions = [
    { x: 90, y: 560 },
    { x: 260, y: 470 },
    { x: 100, y: 350 },
    { x: 250, y: 220 },
    { x: 150, y: 90 },
  ];

  let pathD = `M ${positions[0].x} ${positions[0].y}`;
  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i - 1], cur = positions[i];
    const midX = (prev.x + cur.x) / 2;
    pathD += ` Q ${midX} ${prev.y}, ${cur.x} ${cur.y}`;
  }

  let nodesHTML = '';
  REGIONS.forEach((region, i) => {
    const unlocked = regionUnlocked(i);
    const p = getProgress(region.key);
    let state = 'locked';
    if (unlocked) state = p.mainDone ? (p.stars >= 3 && p.discoveries.size >= region.discoveries.length && p.chestOpened ? 'done' : 'partial') : 'open';
    nodesHTML += `<g transform="translate(${positions[i].x},${positions[i].y})">${mapNodeSVG(region, i, state)}</g>`;
  });

  const html = `
    <div style="position:relative;width:100%;height:100%;display:flex;flex-direction:column;background:radial-gradient(ellipse 120% 70% at 50% 0%, rgba(139,107,214,.14), transparent 60%), linear-gradient(180deg, #0d0d16 0%, #07070a 60%)">
      <header style="display:flex;align-items:center;justify-content:space-between;padding:calc(var(--safe-top) + 14px) 18px 10px;flex:none">
        <div style="font-family:var(--font-display);font-size:15px;letter-spacing:.1em;color:var(--gold-1);text-transform:uppercase">Khúc Ca Hy Vọng</div>
        <button class="icon-btn" id="mapMuteBtn" style="${STATE.muted ? 'color:var(--paper-dim)' : ''}">${STATE.muted ? '✕' : '♪'}</button>
      </header>

      <div style="flex:none;padding:0 18px 12px;display:flex;gap:10px;justify-content:center">
        <div style="background:rgba(20,20,29,.8);border:1px solid var(--line-strong);border-radius:999px;padding:7px 14px;font-size:12.5px;color:var(--gold-0);display:flex;align-items:center;gap:6px">
          ★ ${totals.stars}/${maxStars}
        </div>
        <div style="background:rgba(20,20,29,.8);border:1px solid var(--line-strong);border-radius:999px;padding:7px 14px;font-size:12.5px;color:var(--teal);display:flex;align-items:center;gap:6px">
          ✦ ${totals.disc}/${totalDiscoveriesMax()}
        </div>
        <div style="background:rgba(20,20,29,.8);border:1px solid var(--line-strong);border-radius:999px;padding:7px 14px;font-size:12.5px;color:var(--amber);display:flex;align-items:center;gap:6px">
          ⛃ ${totals.chests}/${totalChestsMax()}
        </div>
      </div>

      <div style="flex:1;min-height:0;position:relative;overflow:hidden">
        <svg viewBox="0 0 360 640" style="width:100%;height:100%;display:block" preserveAspectRatio="xMidYMax meet">
          <path d="${pathD}" fill="none" stroke="rgba(232,197,118,.28)" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round"/>
          ${nodesHTML}
        </svg>
        <div id="mapLabels" style="position:absolute;inset:0;pointer-events:none"></div>
      </div>

      <div id="mapFooter" style="flex:none;padding:14px 18px calc(var(--safe-bottom) + 16px);text-align:center;min-height:56px">
        <div style="font-size:12.5px;color:var(--paper-dim)">Chạm vào một điểm trên bản đồ để bắt đầu.</div>
      </div>
    </div>
  `;

  const screen = showScreen(html, 'screen-map');

  // Nhãn tên khu vực đặt đè lên SVG (dễ đọc hơn text trong SVG scale theo viewBox)
  const labelsHost = screen.querySelector('#mapLabels');
  const svgEl = screen.querySelector('svg');

  function positionLabels() {
    const rect = svgEl.getBoundingClientRect();
    // Bảo vệ: nếu SVG chưa có kích thước layout thật (rect rỗng vì chưa paint),
    // bỏ qua lần gọi này thay vì vẽ nhãn ở toạ độ 0 — tránh lệch vị trí lúc đầu tải.
    if (rect.width === 0 || rect.height === 0) return;
    const scaleX = rect.width / 360, scaleY = rect.height / 640;
    labelsHost.innerHTML = REGIONS.map((region, i) => {
      const p = getProgress(region.key);
      const unlocked = regionUnlocked(i);
      const px = positions[i].x * scaleX;
      const py = positions[i].y * scaleY;
      const labelY = py + 46;
      return `<div style="position:absolute;left:${px}px;top:${labelY}px;transform:translateX(-50%);text-align:center;width:120px">
        <div style="font-family:var(--font-display);font-size:13px;color:${unlocked ? 'var(--gold-0)' : 'rgba(255,255,255,.3)'}">${region.name}</div>
        ${unlocked ? `<div style="font-size:10px;color:var(--paper-dim);margin-top:2px">★${p.stars}/3</div>` : ''}
      </div>`;
    }).join('');
  }
  // showScreen() dùng requestAnimationFrame để thêm class 'active' (kích hoạt
  // transition + layout thật). positionLabels() cần đợi SAU thời điểm đó, nên
  // dùng double rAF (đảm bảo 1 khung hình đã paint xong) thay vì gọi đồng bộ.
  requestAnimationFrame(() => requestAnimationFrame(positionLabels));
  window.addEventListener('resize', positionLabels);

  screen.querySelectorAll('.map-node').forEach((node) => {
    const key = node.getAttribute('data-region');
    const state = node.getAttribute('data-state');
    if (state === 'locked') {
      node.addEventListener('click', () => {
        Audio_.sfxWrong();
        toast('Hãy hoàn thành khu vực trước đó để mở lối này.', 'err');
      });
      return;
    }
    node.addEventListener('click', () => {
      Audio_.sfxClick();
      const region = REGIONS.find(r => r.key === key);
      enterRegion(region);
    });
  });

  Audio_.unlock();
  screen.querySelector('#mapMuteBtn').addEventListener('click', (e) => Audio_.toggleMute(e.currentTarget));
}

function enterRegion(region) {
  region.render();
}

function returnToMap() {
  renderMap();
}
'use strict';
/* ============================================================
   REGION SCENE TEMPLATE
   Khung dùng chung cho cả 5 khu vực: hiển thị minh hoạ nền +
   các hotspot khám phá (chạm vào vật thể để xem hội thoại/chi
   tiết) + rương ẩn (xuất hiện sau khi khám phá đủ) + cổng vào
   thử thách chính (câu đố logic). Quay lại bản đồ bất cứ lúc nào.
   ============================================================ */

// illustrationSVG: hàm trả về chuỗi SVG nền minh hoạ khu vực (không có hotspot, chỉ là khung cảnh)
// hotspots: [{ id, x, y, icon, label, onActivate: async () => {} }] toạ độ % trên khung cảnh
// chestReveal: điều kiện hiện rương — mặc định: đã khám phá hết hotspots
function buildRegionScreen(region, { illustrationSVG, hotspots, onMainChallenge, onChestOpen }) {
  const p = getProgress(region.key);
  // Lưu tiến trình mỗi lần scene khu vực được (dựng lại) — hàm này chạy lại
  // sau MỌI thay đổi trạng thái (khám phá, mở rương, hoàn thành thử thách),
  // nên đặt save() ở đây đảm bảo không bỏ sót điểm mutate nào.
  Persist.save();

  function renderHotspot(h) {
    const found = p.discoveries.has(h.id);
    return `<button class="hotspot" data-id="${h.id}" style="
      position:absolute;left:${h.x}%;top:${h.y}%;transform:translate(-50%,-50%);
      width:52px;height:52px;border-radius:50%;border:none;cursor:pointer;
      background:${found ? 'rgba(143,227,166,.14)' : 'rgba(255,157,77,.16)'};
      display:grid;place-items:center;font-size:22px;
      box-shadow:0 0 0 2px ${found ? 'rgba(143,227,166,.5)' : 'rgba(255,157,77,.55)'}, 0 8px 20px -6px rgba(0,0,0,.5);
      animation:${found ? 'none' : 'hotspotPulse 2s ease-in-out infinite'};
    ">${found ? '✓' : h.icon}</button>`;
  }

  const chestUnlocked = hotspots.every(h => p.discoveries.has(h.id));
  const chestHTML = chestUnlocked ? `
    <button class="hotspot" id="chestBtn" style="
      position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
      width:60px;height:60px;border-radius:16px;border:none;cursor:pointer;
      background:${p.chestOpened ? 'rgba(143,227,166,.1)' : 'rgba(232,197,118,.2)'};
      display:grid;place-items:center;font-size:28px;
      box-shadow:0 0 0 2px ${p.chestOpened ? 'rgba(143,227,166,.4)' : 'var(--gold-1)'}, 0 10px 26px -6px rgba(0,0,0,.6);
      animation:${p.chestOpened ? 'none' : 'chestGlow 1.8s ease-in-out infinite'};
    ">${p.chestOpened ? '📖' : '⛃'}</button>
  ` : '';

  const html = `
    <div style="position:relative;width:100%;height:100%;display:flex;flex-direction:column;background:${region.bg}">
      <style>
        @keyframes hotspotPulse{0%,100%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-50%,-50%) scale(1.08)}}
        @keyframes chestGlow{0%,100%{box-shadow:0 0 0 2px var(--gold-1), 0 10px 26px -6px rgba(0,0,0,.6)}50%{box-shadow:0 0 0 5px rgba(232,197,118,.35), 0 10px 30px -4px rgba(0,0,0,.6)}}
      </style>
      <header style="flex:none;display:flex;align-items:center;justify-content:space-between;padding:calc(var(--safe-top) + 14px) 16px 10px;position:relative;z-index:5">
        <button class="icon-btn" id="backToMapBtn">←</button>
        <div style="font-family:var(--font-display);font-size:16px;color:var(--gold-0);text-align:center;flex:1">${region.name}</div>
        <div style="width:46px"></div>
      </header>

      <div style="flex:1;min-height:0;position:relative;overflow:hidden">
        <div style="position:absolute;inset:0">${illustrationSVG}</div>
        <div id="hotspotLayer" style="position:absolute;inset:0">
          ${hotspots.map(renderHotspot).join('')}
          ${chestHTML}
        </div>
      </div>

      <div style="flex:none;padding:14px 16px calc(var(--safe-bottom) + 16px);background:linear-gradient(180deg, transparent, rgba(7,7,10,.7) 30%);position:relative;z-index:5">
        <div style="display:flex;justify-content:center;gap:6px;margin-bottom:10px" id="discoveryDots"></div>
        <button class="btn btn-primary" id="mainChallengeBtn" style="width:100%">
          ${p.mainDone ? '✓ ' : ''}${region.challengeLabel}${p.mainDone ? ` — ★${p.stars}/3` : ''}
        </button>
      </div>
    </div>
  `;

  const screen = showScreen(html, 'screen-' + region.key);

  function renderDots() {
    const dotsHost = screen.querySelector('#discoveryDots');
    dotsHost.innerHTML = hotspots.map(h => {
      const found = p.discoveries.has(h.id);
      return `<div style="width:6px;height:6px;border-radius:50%;background:${found ? 'var(--ok)' : 'rgba(255,255,255,.18)'}"></div>`;
    }).join('') + `<div style="width:6px;height:6px;border-radius:50%;background:${p.chestOpened ? 'var(--gold-1)' : 'rgba(255,255,255,.18)'};margin-left:4px"></div>`;
  }
  renderDots();

  screen.querySelector('#backToMapBtn').addEventListener('click', () => {
    Audio_.sfxClick();
    returnToMap();
  });

  hotspots.forEach(h => {
    const btn = screen.querySelector(`[data-id="${h.id}"]`);
    btn.addEventListener('click', async () => {
      Audio_.sfxClick();
      await h.onActivate();
      if (!p.discoveries.has(h.id)) {
        p.discoveries.add(h.id);
        Audio_.sfxDiscover();
        toast(`Đã khám phá: ${h.label}`, 'ok');
      }
      // re-render toàn bộ scene để cập nhật trạng thái hotspot/rương
      buildRegionScreen(region, { illustrationSVG, hotspots, onMainChallenge, onChestOpen });
    });
  });

  const chestBtnEl = screen.querySelector('#chestBtn');
  if (chestBtnEl) {
    chestBtnEl.addEventListener('click', async () => {
      Audio_.sfxClick();
      if (p.chestOpened) {
        toast('Bạn đã mở rương này rồi.');
        return;
      }
      await onChestOpen();
      p.chestOpened = true;
      Audio_.sfxChest();
      buildRegionScreen(region, { illustrationSVG, hotspots, onMainChallenge, onChestOpen });
    });
  }

  screen.querySelector('#mainChallengeBtn').addEventListener('click', async () => {
    Audio_.sfxClick();
    await onMainChallenge();
    // sau khi xong thử thách chính, quay lại chính scene này (không tự động về map)
    buildRegionScreen(region, { illustrationSVG, hotspots, onMainChallenge, onChestOpen });
  });

  return screen;
}
'use strict';
/* ============================================================
   KHU VỰC I — GÒ SEN
   ============================================================ */

const RegionGoSen = (() => {
  const key = 'gosen';

  const illustrationSVG = `
    <svg viewBox="0 0 400 700" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%;display:block">
      <defs>
        <linearGradient id="skyGS" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#1a1526"/><stop offset="55%" stop-color="#241c2e"/><stop offset="100%" stop-color="#3a2a24"/>
        </linearGradient>
        <radialGradient id="moonGS"><stop offset="0%" stop-color="#fff7e0"/><stop offset="100%" stop-color="#e8c576"/></radialGradient>
      </defs>
      <rect width="400" height="700" fill="url(#skyGS)"/>
      ${Array.from({length:40},(_,i)=>{const x=(i*53)%400, y=(i*97)%320; const op=0.3+((i*13)%7)/10; return `<circle cx="${x}" cy="${y}" r="1.3" fill="#fff" opacity="${op}"/>`}).join('')}
      <circle cx="320" cy="90" r="34" fill="url(#moonGS)" opacity=".92"/>
      <ellipse cx="200" cy="560" rx="230" ry="140" fill="#1c2420"/>
      <ellipse cx="200" cy="540" rx="180" ry="90" fill="#141c17" opacity=".8"/>
      ${Array.from({length:8},(_,i)=>{const x=60+i*38, y=520+((i*17)%40); return `<ellipse cx="${x}" cy="${y}" rx="14" ry="5" fill="#2a3a2d" opacity=".7"/>`}).join('')}
      <g transform="translate(90,430)">
        <polygon points="0,60 50,0 100,60" fill="#3a2c22"/>
        <rect x="15" y="60" width="70" height="70" fill="#4a3a2c"/>
        <rect x="42" y="95" width="20" height="35" fill="#241a12"/>
        <rect x="24" y="72" width="14" height="14" fill="#e8c57644"/>
      </g>
      <ellipse cx="200" cy="690" rx="220" ry="30" fill="#0a0e0a"/>
    </svg>
  `;

  const hotspots = [
    {
      id: 'hom_hat_giong', x: 30, y: 62, icon: '🌾', label: 'Chiếc hòm hạt giống',
      onActivate: async () => {
        await say('Mai', 'Chiếc hòm gỗ nhỏ nằm im dưới góc giường — di vật duy nhất mẹ để lại trước khi bà ngoại nhận nuôi con. Bên trong là những hạt giống không rõ tên, được gói cẩn thận trong vải thô.');
        await say('Mai', 'Bà ngoại từng nói: "Hạt giống này đợi đúng người, đúng lúc mới nảy mầm." Con chưa từng hiểu hết câu nói đó — cho đến đêm nay.');
      },
    },
    {
      id: 'ao_sen_kho', x: 68, y: 55, icon: '🪷', label: 'Ao sen khô cạn',
      onActivate: async () => {
        await say('Mai', 'Ba mùa mưa rồi ao sen đầu làng vẫn trơ đáy bùn nứt nẻ. Người già trong làng bảo ngày xưa sen ở đây nở kín mặt nước, hồng rực cả một góc trời.');
        await say('Bà Lành', '(giọng vọng lại từ ký ức) "Sen tàn không phải vì hết mùa, con ạ. Nó tàn vì nước nguồn đã bị chặn từ một nơi rất xa."');
      },
    },
    {
      id: 'ban_tho', x: 50, y: 78, icon: '🕯️', label: 'Bàn thờ nhỏ',
      onActivate: async () => {
        await say('Mai', 'Một bát nhang, một tấm ảnh cũ đã ố vàng. Bà ngoại mất năm ngoái, giữa lúc chiến sự căng thẳng nhất. Con không kịp nói lời tạm biệt cho tử tế.');
        await say('Mai', 'Nhưng con vẫn thắp nhang mỗi tối, kể cho bà nghe những vì sao con nhìn thấy — như thể bà vẫn đang ngồi cạnh, gật gù nghe con nói.');
      },
    },
  ];

  async function onChestOpen() {
    await say('Mai', 'Dưới đáy hòm, lẫn trong lớp vải lót, có một mảnh giấy gấp nhỏ — nét chữ run run của bà ngoại.');
    await say('Bà Lành (di bút)', '"Nếu một ngày ánh sáng trong con đủ mạnh để nối liền những vì sao, hãy tìm đến ngôi chùa sau ngọn núi phía tây. Ở đó có người đang đợi con, dù chính người ấy cũng chưa biết điều đó."', [{ label: 'Cất mảnh giấy vào ngực áo', value: true, primary: true }]);
  }

  // ---- Thử thách chính: giữ nguyên câu đố chuỗi số đã verify từ bản trước ----
  const ROUNDS = [
    { seq: [1, 1, 2, 3, 5, null, 13], answer: 8, choices: [8, 9, 7, 10], rule: 'Mỗi vì sao cộng dồn ánh sáng của hai vì sao liền trước.' },
    { seq: [1, 2, 4, 7, 11, null], answer: 16, choices: [16, 15, 14, 18], rule: 'Khoảng cách giữa hai vì sao liền kề tăng dần: +1, +2, +3, +4, +5…' },
    { seq: [2, 12, 4, 10, 6, null, 8], answer: 8, choices: [8, 6, 9, 7], rule: 'Có hai dòng ánh sáng xen kẽ nhau: một dòng lớn dần, một dòng nhỏ dần.' },
  ];

  function starPositions(count) {
    const pts = []; const w = 300, h = 110;
    for (let i = 0; i < count; i++) {
      const frac = i / (count - 1);
      const x = 20 + frac * (w - 40);
      const y = 55 + Math.sin(frac * Math.PI) * -32 + (i % 2 === 0 ? 5 : -5);
      pts.push({ x, y });
    }
    return pts;
  }
  function brightnessToRadius(v) { return 4 + (v / 18) * 8; }
  function brightnessToOpacity(v) { return 0.35 + (v / 18) * 0.65; }

  function renderConstellation(round, revealedGuess) {
    const pts = starPositions(round.seq.length);
    const missingIdx = round.seq.indexOf(null);
    let svg = `<svg viewBox="0 0 300 120" style="width:100%;max-width:320px;height:auto">`;
    svg += `<polyline points="${pts.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="rgba(232,197,118,.22)" stroke-width="1.5" stroke-dasharray="3 5"/>`;
    pts.forEach((p, i) => {
      const isMissing = i === missingIdx;
      const val = isMissing ? (revealedGuess ?? null) : round.seq[i];
      const r = val !== null ? brightnessToRadius(val) : 8;
      const op = val !== null ? brightnessToOpacity(val) : 0.9;
      if (isMissing && val === null) {
        svg += `<circle cx="${p.x}" cy="${p.y}" r="8" fill="none" stroke="var(--amber)" stroke-width="1.6" stroke-dasharray="2 4" opacity=".85"><animate attributeName="r" values="7;10;7" dur="1.8s" repeatCount="indefinite"/></circle>`;
        svg += `<text x="${p.x}" y="${p.y + 3}" text-anchor="middle" font-size="9" fill="var(--amber)" font-weight="700">?</text>`;
      } else {
        svg += `<circle cx="${p.x}" cy="${p.y}" r="${r * 2}" fill="rgba(246,226,173,${op * 0.14})"/>`;
        svg += `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="url(#starGradGS)" opacity="${op}"/>`;
        if (isMissing) svg += `<circle cx="${p.x}" cy="${p.y}" r="${r + 3}" fill="none" stroke="var(--ok)" stroke-width="1.5" opacity=".8"/>`;
      }
    });
    svg += `<defs><radialGradient id="starGradGS"><stop offset="0%" stop-color="#fff7e0"/><stop offset="60%" stop-color="#f6e2ad"/><stop offset="100%" stop-color="#c9973f"/></radialGradient></defs></svg>`;
    return svg;
  }

  async function playRound(roundIndex, resultState) {
    const round = ROUNDS[roundIndex];
    let localMistakes = 0;

    const html = `
      <div style="max-width:420px;margin:0 auto;text-align:center">
        <div style="font-family:var(--font-display);font-size:18px;color:var(--gold-1)">Vòng ${roundIndex + 1} / 3 — Sợi Chỉ Của Những Vì Sao</div>
        <div style="font-size:13px;color:var(--paper-dim);margin-top:8px;line-height:1.5">Quan sát độ sáng các vì sao đã hiện, chọn ngôi sao đúng để lấp chỗ trống.</div>
        <div id="constellationHost" style="display:flex;justify-content:center;margin:20px 0 12px"></div>
        <div id="choiceRow" style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:8px"></div>
        <div class="hint-row" id="ruleHintGS" style="margin-top:16px;font-size:12.5px;color:var(--paper-dim);min-height:34px"></div>
      </div>
    `;
    const container = document.createElement('div');
    container.style.cssText = 'padding:20px 20px 100px;max-height:100%;overflow-y:auto;-webkit-overflow-scrolling:touch';
    container.innerHTML = html;
    resultState.host.innerHTML = '';
    resultState.host.appendChild(container);

    const constHost = container.querySelector('#constellationHost');
    const choiceRow = container.querySelector('#choiceRow');
    const ruleHint = container.querySelector('#ruleHintGS');

    function draw(guess) { constHost.innerHTML = renderConstellation(round, guess); }
    draw(null);

    const shuffled = [...round.choices].sort(() => Math.random() - 0.5);
    let resolveFn;
    const donePromise = new Promise(r => resolveFn = r);
    let solved = false;

    shuffled.forEach((val) => {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.style.cssText = 'min-width:64px;font-size:17px;font-family:var(--font-display);min-height:52px';
      btn.textContent = val;
      btn.onclick = () => {
        if (solved) return;
        if (val === round.answer) {
          solved = true;
          Audio_.sfxCorrect();
          draw(val);
          btn.style.borderColor = 'var(--ok)'; btn.style.background = 'rgba(143,227,166,.12)';
          toast('Đúng rồi — ánh sáng đã nối liền.', 'ok');
          Array.from(choiceRow.children).forEach(b => b.disabled = true);
          setTimeout(() => resolveFn(localMistakes), 650);
        } else {
          localMistakes++;
          Audio_.sfxWrong();
          btn.style.borderColor = 'var(--danger)'; btn.style.background = 'rgba(255,92,92,.1)';
          setTimeout(() => { btn.style.borderColor = ''; btn.style.background = ''; }, 400);
          ruleHint.innerHTML = `<span style="border:1px solid var(--line-strong);border-radius:6px;padding:1px 7px;color:var(--gold-1);font-size:11px">gợi ý</span> ${round.rule}`;
          toast('Chưa khớp quy luật.', 'err');
        }
      };
      choiceRow.appendChild(btn);
    });

    return donePromise;
  }

  async function onMainChallenge() {
    const p = getProgress(key);
    await say('Mai', 'Ao sen đầu làng đã cạn khô ba mùa mưa rồi. Nhưng đêm nay trời quang, không còi báo động — con lại ra sân nhìn sao như bà vẫn hay kể.');
    await say('Bà Lành', '"Những dải sáng ấy là sợi chỉ dệt từ hy vọng, con ạ." Bà từng nói vậy. Mai chưa từng kể với ai, nhưng cô tin điều đó.');

    // dùng modal làm khung chứa mini-game (đơn giản, không cần layout phức tạp)
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:250;background:rgba(5,5,8,.94);display:flex;flex-direction:column';
    document.body.appendChild(overlay);
    const closeBar = document.createElement('div');
    closeBar.style.cssText = 'flex:none;padding:calc(var(--safe-top) + 12px) 16px 8px;display:flex;justify-content:flex-end';
    closeBar.innerHTML = `<button class="icon-btn" id="closeMiniGS">✕</button>`;
    overlay.appendChild(closeBar);
    const host = document.createElement('div');
    host.style.cssText = 'flex:1;min-height:0;overflow:hidden';
    overlay.appendChild(host);

    let totalMistakes = 0;
    let cancelled = false;
    closeBar.querySelector('#closeMiniGS').addEventListener('click', () => { cancelled = true; overlay.remove(); });

    for (let i = 0; i < ROUNDS.length && !cancelled; i++) {
      const mistakes = await playRound(i, { host });
      if (cancelled) break;
      totalMistakes += mistakes;
    }
    overlay.remove();
    if (cancelled) return;

    let stars = 3;
    if (totalMistakes >= 2) stars = 2;
    if (totalMistakes >= 4) stars = 1;
    p.stars = Math.max(p.stars, stars);
    p.mainDone = true;

    Audio_.sfxComplete();
    await say('Mai', 'Con đã nối được sợi chỉ ấy. Trong lồng ngực nhỏ bé của mình, một thứ ánh sáng bắt đầu cháy lên — âm thầm, nhưng không thể dập tắt.', [{ label: 'Tiếp tục', value: true, primary: true }]);
    await modal({
      kicker: 'GÒ SEN',
      title: totalMistakes === 0 ? 'Sợi Chỉ Hoàn Hảo' : 'Ánh Sáng Đã Nối Liền',
      text: totalMistakes === 0
        ? 'Mai đọc đúng quy luật ánh sáng ngay từ lần đầu tiên.'
        : `Sau ${totalMistakes} lần dò thử, Mai cũng tìm ra sợi chỉ nối những vì sao.`,
      stars,
      actions: [{ label: 'Tiếp tục khám phá Gò Sen', value: true, primary: true }],
    });
  }

  function render() {
    buildRegionScreen(
      { key, name: 'Gò Sen', bg: 'linear-gradient(180deg,#161320,#0a0810)', discoveries: hotspots, challengeLabel: 'Nối Sợi Chỉ Những Vì Sao' },
      { illustrationSVG, hotspots, onMainChallenge, onChestOpen }
    );
  }

  REGIONS.push({ key, name: 'Gò Sen', glyph: '🪷', discoveries: hotspots, render });
  return { render };
})();
'use strict';
/* ============================================================
   KHU VỰC II — VÔ ƯU CỔ TỰ
   ============================================================ */

const RegionCoTu = (() => {
  const key = 'voutucotu';

  const illustrationSVG = `
    <svg viewBox="0 0 400 700" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%;display:block">
      <defs>
        <linearGradient id="skyCT" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0f1610"/><stop offset="60%" stop-color="#182018"/><stop offset="100%" stop-color="#2a2418"/>
        </linearGradient>
      </defs>
      <rect width="400" height="700" fill="url(#skyCT)"/>
      ${Array.from({length:30},(_,i)=>{const x=(i*61)%400, y=(i*83)%260; return `<circle cx="${x}" cy="${y}" r="1.2" fill="#e8c576" opacity="${0.2+((i*7)%5)/10}"/>`}).join('')}
      <polygon points="0,700 60,380 130,700" fill="#0d130e"/>
      <polygon points="270,700 340,340 400,700" fill="#0a0f0b"/>
      <g transform="translate(120,420)">
        <polygon points="0,90 80,10 160,90" fill="#3a2c1c"/>
        <polygon points="20,88 80,30 140,88" fill="#4a3722"/>
        <rect x="10" y="90" width="140" height="110" fill="#5a4530"/>
        <rect x="60" y="150" width="40" height="50" fill="#241a10"/>
        <rect x="24" y="105" width="18" height="24" fill="#e8c57633"/>
        <rect x="118" y="105" width="18" height="24" fill="#e8c57633"/>
        <circle cx="80" cy="10" r="4" fill="#e8c576"/>
      </g>
      <g transform="translate(70,600)" opacity=".8">
        <polygon points="0,0 40,-70 80,0" fill="none" stroke="#e8c57655" stroke-width="1.5"/>
      </g>
      <ellipse cx="200" cy="680" rx="200" ry="24" fill="#050805"/>
    </svg>
  `;

  const hotspots = [
    {
      id: 'thu_vien_kinh', x: 32, y: 58, icon: '📜', label: 'Thư viện kinh cổ',
      onActivate: async () => {
        await say('Mai', 'Hàng trăm cuộn kinh xếp ngay ngắn trên giá gỗ mun. Bụi thời gian phủ dày, nhưng chữ viết bên trong vẫn còn rõ nét lạ thường.');
        await say('Sư thầy Tịnh Không', 'Bốn mươi ba năm ta ở đây, chỉ để chờ ngày phiến đá bát giác lên tiếng. Con biết không, mỗi vị sư trụ trì đều tin rằng đời mình sẽ không kịp chứng kiến điều đó.');
      },
    },
    {
      id: 'noi_tim_thay_kaito', x: 70, y: 72, icon: '🩹', label: 'Vách đá nơi tìm thấy Kaito',
      onActivate: async () => {
        await say('Mai', 'Ngay dưới chân vách đá này, mười một ngày trước, con đã tìm thấy anh ấy — bất tỉnh, đầy thương tích, không một giấy tờ tuỳ thân nào ngoài một tấm ảnh nhoè nước.');
        await say('Mai', 'Con không biết vì sao mình dừng lại cứu một người lạ giữa thời buổi loạn lạc này. Có lẽ vì ánh sáng trong con mách bảo đó không phải một sự tình cờ.');
      },
    },
    {
      id: 'chuong_dong', x: 50, y: 40, icon: '🔔', label: 'Chuông đồng cổ',
      onActivate: async () => {
        await say('Sư thầy Tịnh Không', 'Chiếc chuông này đúc từ thời trước cả khi ngôi chùa được dựng lên. Mỗi lần thỉnh chuông, âm thanh vọng xa hơn bình thường một cách kỳ lạ — như thể nó đang gọi ai đó từ rất xa trở về.');
      },
    },
  ];

  async function onChestOpen() {
    await say('Mai', 'Trong hộp gỗ trầm hương đặt cạnh phiến đá bát giác, con tìm thấy một chuỗi hạt bồ đề đã sờn màu thời gian.');
    await say('Sư thầy Tịnh Không', 'Chuỗi hạt của sư phụ ta để lại. Người dặn: "Khi nào ánh sáng thật sự xuất hiện, hãy trao nó cho người ấy — để họ nhớ rằng hành trình phía trước, dù đơn độc đến đâu, vẫn có người đã đi qua trước."', [{ label: 'Nhận lấy chuỗi hạt', value: true, primary: true }]);
  }

  // ---- Thử thách chính: bát giác suy luận (đã verify nghiệm duy nhất) ----
  const SYMBOLS = [
    { id: 'sang',  glyph: '☉', name: 'Ánh Sáng' },
    { id: 'hat',   glyph: '❋', name: 'Hạt Giống' },
    { id: 'sen',   glyph: '✿', name: 'Hoa Sen' },
    { id: 'gio',   glyph: '↻', name: 'Gió' },
    { id: 'bong',  glyph: '☾', name: 'Bóng Tối' },
    { id: 'nuoc',  glyph: '≈', name: 'Nước' },
    { id: 'da',    glyph: '▲', name: 'Đá' },
    { id: 'lua',   glyph: '△', name: 'Lửa' },
  ];
  const MOVABLE = SYMBOLS.filter(s => s.id !== 'sang').map(s => s.id);
  function opposite(i) { return (i + 4) % 8; }
  function neighbors(i) { return [(i + 7) % 8, (i + 1) % 8]; }
  function cwNeighbor(i) { return (i + 1) % 8; }
  const CLUES = [
    { text: 'Ánh Sáng luôn đối diện Bóng Tối qua tâm phiến đá.', need: ['sang', 'bong'], check: (pos) => opposite(pos.sang) === pos.bong },
    { text: 'Hạt Giống được khắc kề liền cả Ánh Sáng lẫn Hoa Sen.', need: ['hat', 'sang', 'sen'], check: (pos) => { const n = neighbors(pos.hat); return n.includes(pos.sang) && n.includes(pos.sen); } },
    { text: 'Lửa và Gió đối diện nhau.', need: ['lua', 'gio'], check: (pos) => opposite(pos.lua) === pos.gio },
    { text: 'Đá được đặt giữa Nước và Lửa, kề liền cả hai phía.', need: ['da', 'nuoc', 'lua'], check: (pos) => { const n = neighbors(pos.da); return n.includes(pos.nuoc) && n.includes(pos.lua); } },
    { text: 'Hạt Giống nằm ngay sau Ánh Sáng, theo chiều kim đồng hồ.', need: ['sang', 'hat'], check: (pos) => cwNeighbor(pos.sang) === pos.hat },
  ];
  function checkAll(placementFull) {
    const pos = {};
    placementFull.forEach((id, i) => { if (id) pos[id] = i; });
    return CLUES.map((c, idx) => { const ready = c.need.every(id => pos[id] !== undefined); return { ok: ready ? c.check(pos) : null, idx }; });
  }
  function octagonPoint(i, cx, cy, R) { const a = (Math.PI * 2 * i) / 8 - Math.PI / 2; return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) }; }
  function renderOctagonSVG(placement) {
    const cx = 150, cy = 150, R = 108;
    let svg = `<svg viewBox="0 0 300 300" style="width:100%;max-width:280px;height:auto">`;
    const pts8 = []; for (let i = 0; i < 8; i++) pts8.push(octagonPoint(i, cx, cy, R));
    svg += `<polygon points="${pts8.map(p => `${p.x},${p.y}`).join(' ')}" fill="rgba(232,197,118,.04)" stroke="rgba(232,197,118,.28)" stroke-width="1.5"/>`;
    svg += `<circle cx="${cx}" cy="${cy}" r="${R*0.3}" fill="none" stroke="rgba(232,197,118,.16)" stroke-width="1"/>`;
    for (let i = 0; i < 8; i++) {
      const p = octagonPoint(i, cx, cy, R);
      const filled = placement[i]; const isAnchor = i === 0;
      svg += `<g class="octSlot" data-slot="${i}" style="cursor:${isAnchor?'default':'pointer'}">`;
      svg += `<circle cx="${p.x}" cy="${p.y}" r="36" fill="transparent" style="pointer-events:${isAnchor?'none':'all'}"/>`;
      svg += `<circle cx="${p.x}" cy="${p.y}" r="24" fill="${filled?'rgba(232,197,118,.16)':'rgba(255,255,255,.03)'}" stroke="${isAnchor?'var(--amber)':`rgba(232,197,118,${filled?'.5':'.22'})`}" stroke-width="${isAnchor?'2':'1.5'}" style="pointer-events:none"/>`;
      if (filled) { const sym = SYMBOLS.find(s => s.id === filled); svg += `<text x="${p.x}" y="${p.y+7}" text-anchor="middle" font-size="21" fill="var(--gold-0)" style="pointer-events:none">${sym.glyph}</text>`; }
      svg += `</g>`;
    }
    svg += `</svg>`;
    return svg;
  }

  async function onMainChallenge() {
    const p = getProgress(key);
    await say('Mai', 'Mười một ngày ở Vô Ưu Cổ Tự, đôi chân cô đã lành. Người lạ cô tìm thấy dưới vách đá — Kaito — cũng dần hồi tỉnh.');
    await say('Sư thầy Tịnh Không', 'Ánh Sáng đã khắc sẵn ở đỉnh cao nhất — không ai được phép dịch chuyển. Bảy biểu tượng còn lại, con phải tự tìm ra vị trí dựa vào năm lời sấm.');

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:250;background:rgba(5,5,8,.95);display:flex;flex-direction:column';
    document.body.appendChild(overlay);
    overlay.innerHTML = `
      <div style="flex:none;padding:calc(var(--safe-top) + 12px) 16px 8px;display:flex;justify-content:flex-end">
        <button class="icon-btn" id="closeMiniCT">✕</button>
      </div>
      <div style="flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 20px 24px">
        <div style="max-width:440px;margin:0 auto;text-align:center">
          <div style="font-family:var(--font-display);font-size:18px;color:var(--gold-1)">Sấm Truyền Liên Hoa</div>
          <div style="font-size:12.5px;color:var(--paper-dim);margin-top:6px">Xếp 7 biểu tượng vào bát giác theo 5 lời sấm.</div>
          <div id="octHost" style="display:flex;justify-content:center;margin:16px 0"></div>
          <ol id="clueListCT" style="text-align:left;max-width:380px;margin:0 auto 14px;padding-left:18px;font-size:12.5px;line-height:1.6;color:var(--paper-dim)"></ol>
          <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--gold-2);margin-bottom:8px">Biểu tượng — chạm để chọn</div>
          <div id="symbolTrayCT" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center"></div>
          <div id="ch2hintMobile" style="margin-top:12px;font-size:12px;color:var(--paper-dim);min-height:18px"></div>
        </div>
      </div>
      <div style="flex:none;padding:14px 20px calc(var(--safe-bottom) + 16px);background:rgba(10,9,13,.8)">
        <button class="btn btn-primary" id="checkBtnCT" style="width:100%;max-width:440px;margin:0 auto;display:block">Kiểm chứng lời sấm</button>
      </div>
    `;

    let cancelled = false;
    overlay.querySelector('#closeMiniCT').addEventListener('click', () => { cancelled = true; overlay.remove(); });
    overlay.querySelector('#clueListCT').innerHTML = CLUES.map(c => `<li style="margin-bottom:6px">${c.text}</li>`).join('');

    let placement = new Array(8).fill(null);
    placement[0] = 'sang';
    let selected = null;
    let wrongChecks = 0;

    const octHost = overlay.querySelector('#octHost');
    const tray = overlay.querySelector('#symbolTrayCT');

    function renderTray() {
      const used = new Set(placement.filter(Boolean));
      tray.innerHTML = '';
      MOVABLE.forEach(id => {
        const sym = SYMBOLS.find(s => s.id === id);
        const used_ = used.has(id);
        const chip = document.createElement('button');
        chip.className = 'btn';
        chip.style.cssText = `padding:12px 14px;font-size:13px;min-height:46px;opacity:${used_?'.32':'1'}`;
        chip.disabled = used_;
        chip.innerHTML = `<span style="font-size:16px;margin-right:5px">${sym.glyph}</span>${sym.name}`;
        chip.onclick = () => {
          selected = id;
          Array.from(tray.children).forEach(c => c.style.outline = '');
          chip.style.outline = '2px solid var(--amber)';
        };
        tray.appendChild(chip);
      });
    }
    function renderOct() {
      octHost.innerHTML = renderOctagonSVG(placement);
      octHost.querySelectorAll('.octSlot').forEach(g => {
        const slot = parseInt(g.getAttribute('data-slot'), 10);
        if (slot === 0) return;
        g.addEventListener('click', () => {
          if (placement[slot]) { placement[slot] = null; Audio_.sfxClick(); renderOct(); renderTray(); return; }
          if (!selected) { toast('Hãy chọn một biểu tượng trước.', 'err'); return; }
          placement[slot] = selected; selected = null; Audio_.sfxClick(); renderOct(); renderTray();
        });
      });
    }
    renderOct(); renderTray();

    let resolveFn;
    const donePromise = new Promise(r => resolveFn = r);
    overlay.querySelector('#checkBtnCT').addEventListener('click', () => {
      if (placement.some(x => !x)) { toast('Phiến đá vẫn còn vị trí trống.', 'err'); return; }
      const results = checkAll(placement);
      const allOk = results.every(r => r.ok === true);
      const hintEl = overlay.querySelector('#ch2hintMobile');
      if (allOk) {
        Audio_.sfxComplete();
        toast('Phiến đá rung lên — ánh sáng vàng lan toả.', 'ok');
        overlay.querySelector('#checkBtnCT').disabled = true;
        setTimeout(() => resolveFn(wrongChecks), 800);
      } else {
        wrongChecks++;
        Audio_.sfxWrong();
        const failedIdx = results.filter(r => r.ok === false).map(r => r.idx + 1);
        hintEl.textContent = failedIdx.length ? `Sai: lời sấm số ${failedIdx.join(', ')} chưa khớp.` : 'Hãy hoàn thiện phiến đá.';
        toast('Chưa khớp với lời sấm.', 'err');
      }
    });

    const mistakes = await donePromise;
    overlay.remove();
    if (cancelled) return;

    let stars = 3;
    if (mistakes >= 2) stars = 2;
    if (mistakes >= 4) stars = 1;
    p.stars = Math.max(p.stars, stars);
    p.mainDone = true;

    await say('Sư thầy Tịnh Không', 'Con đã mở được cánh cửa, Mai à. Nhưng hãy nhớ: một khi đã bước qua, con sẽ không thể quay lại là chính mình như trước nữa.', [{ label: 'Bước qua', value: true, primary: true }]);
    await say('Kaito', '(giọng còn yếu) …Tôi thấy ánh sáng vàng đó. Từ trong cơn mê man, tôi đã thấy nó dẫn đường cho tôi tới đây.');
    await modal({
      kicker: 'VÔ ƯU CỔ TỰ',
      title: mistakes === 0 ? 'Sấm Truyền Trọn Vẹn' : 'Cánh Cửa Đã Mở',
      text: mistakes === 0 ? 'Mai giải trọn vẹn Sấm Truyền Liên Hoa chỉ bằng suy luận thuần tuý.' : `Sau ${mistakes} lần thử sai, Mai cũng ráp đúng bảy biểu tượng còn lại.`,
      stars,
      actions: [{ label: 'Tiếp tục khám phá', value: true, primary: true }],
    });
  }

  function render() {
    buildRegionScreen(
      { key, name: 'Vô Ưu Cổ Tự', bg: 'linear-gradient(180deg,#121810,#080a06)', discoveries: hotspots, challengeLabel: 'Giải Sấm Truyền Liên Hoa' },
      { illustrationSVG, hotspots, onMainChallenge, onChestOpen }
    );
  }

  REGIONS.push({ key, name: 'Vô Ưu Cổ Tự', glyph: '⛩️', discoveries: hotspots, render });
  return { render };
})();
'use strict';
/* ============================================================
   KHU VỰC III — CHIẾN HÀO BỎ HOANG
   ============================================================ */

const RegionChienHao = (() => {
  const key = 'chienhao';

  const illustrationSVG = `
    <svg viewBox="0 0 400 700" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%;display:block">
      <defs><linearGradient id="skyCH" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1e1210"/><stop offset="55%" stop-color="#241614"/><stop offset="100%" stop-color="#150c0a"/>
      </linearGradient></defs>
      <rect width="400" height="700" fill="url(#skyCH)"/>
      <ellipse cx="140" cy="120" rx="90" ry="30" fill="#3a281f" opacity=".5"/>
      <ellipse cx="300" cy="180" rx="70" ry="22" fill="#3a281f" opacity=".4"/>
      <path d="M0,420 Q100,380 200,420 T400,420 L400,700 L0,700 Z" fill="#241a14"/>
      <path d="M0,460 Q100,430 200,460 T400,460 L400,700 L0,700 Z" fill="#1a120d"/>
      ${Array.from({length:6},(_,i)=>{const x=40+i*65; return `<rect x="${x}" y="440" width="8" height="90" fill="#2a1e14" transform="rotate(${(i%2?4:-4)} ${x} 480)"/>`}).join('')}
      <g opacity=".6">${Array.from({length:5},(_,i)=>{const x=60+i*75; return `<circle cx="${x}" cy="500" r="3" fill="#ff9d4d" opacity="${0.3+((i*11)%4)/10}"/>`}).join('')}</g>
      <ellipse cx="200" cy="680" rx="220" ry="26" fill="#0a0604"/>
    </svg>
  `;

  const hotspots = [
    {
      id: 'dong_lua_trai', x: 50, y: 62, icon: '🔥', label: 'Đống lửa trại',
      onActivate: async () => {
        await say('Mai', 'Bốn tháng trước, chính nơi đây, cả nhóm đã ngồi quanh đống lửa này và thề với nhau: dù chuyện gì xảy ra, sẽ không ai bỏ rơi ai.');
        await say('Kaito', 'Tôi vẫn nhớ ánh mắt của mọi người đêm đó — không phải sợ hãi, mà là một thứ quyết tâm kỳ lạ. Như thể chúng ta đã biết trước con đường này sẽ còn dài.');
      },
    },
    {
      id: 'ham_tru_an', x: 25, y: 45, icon: '🕳️', label: 'Hầm trú ẩn',
      onActivate: async () => {
        await say('Sarah', 'Tôi giấu ở đây vài tấm ảnh gia đình — cha mẹ tôi đã mất trong đợt oanh tạc đầu tiên. Đôi khi tôi lẻn xuống đây chỉ để nhìn họ một lúc, không nói gì cả.');
        await say('Sarah', 'Chiến tranh lấy đi rất nhiều thứ. Nhưng nó không lấy được ký ức — ít nhất là chưa.');
      },
    },
    {
      id: 'radio_hong', x: 72, y: 38, icon: '📻', label: 'Máy radio hỏng',
      onActivate: async () => {
        await say('Alex', 'Chiếc máy này từng là niềm tự hào của tôi — tự tay sửa lại từ đống phế liệu. Giờ nó hỏng hẳn rồi, nhưng tôi chưa nỡ vứt đi.');
        await say('Alex', 'Camille từng nói tôi "yêu mấy cái máy móc này hơn cả yêu cô ấy". Cô ấy đùa thôi. Ít nhất tôi mong là cô ấy đùa.');
      },
    },
  ];

  async function onChestOpen() {
    await say('Mai', 'Trong một hốc đất được nguỵ trang kỹ lưỡng, con tìm thấy một lá thư chưa kịp gửi đi, nét chữ vội vàng nhưng đầy tình cảm.');
    await say('Hùng (thư)', '"Diễm à, nếu chị đọc được lá thư này, nghĩa là anh vẫn còn tìm cách gửi tin cho chị. Anh vẫn đang tìm chị, dù chiến tuyến có chia cắt chúng ta bao xa. Đợi anh."', [{ label: 'Giữ lá thư cẩn thận', value: true, primary: true }]);
  }

  // ---- Thử thách chính: xếp đội hình (đã verify nghiệm duy nhất) ----
  const PEOPLE = [
    { id: 'mai', name: 'Mai', glyph: '✿' },
    { id: 'kaito', name: 'Kaito', glyph: '⚔' },
    { id: 'sarah', name: 'Sarah', glyph: '✚' },
    { id: 'alex', name: 'Alex', glyph: '☗' },
  ];
  const POST_LABELS = ['Cổng Làng', 'Ụ Chắn Trước', 'Trạm Sơ Cứu', 'Đài Canh Xa'];
  const CLUES = [
    { text: 'Alex luôn đứng ở Đài Canh Xa.', need: ['alex'], check: (pos) => pos.alex === 3 },
    { text: 'Sarah luôn đứng ngay cạnh Kaito.', need: ['sarah', 'kaito'], check: (pos) => Math.abs(pos.sarah - pos.kaito) === 1 },
    { text: 'Mai đứng gần cổng làng hơn Kaito.', need: ['mai', 'kaito'], check: (pos) => pos.mai < pos.kaito },
    { text: 'Kaito đứng gần cổng làng hơn Sarah.', need: ['kaito', 'sarah'], check: (pos) => pos.kaito < pos.sarah },
  ];
  function checkAll(placement) {
    const pos = {}; placement.forEach((id, i) => { if (id) pos[id] = i; });
    return CLUES.map((c, idx) => { const ready = c.need.every(id => pos[id] !== undefined); return { ok: ready ? c.check(pos) : null, idx }; });
  }

  async function onMainChallenge() {
    const p = getProgress(key);
    await say('Mai', 'Bốn tháng sau đêm lời thề bên đống lửa tàn, thung lũng không còn yên bình. Nhóm kháng chiến báo tin: một cuộc tập kích sắp ập đến làng.');
    await say('Kaito', 'Chúng ta chỉ có bốn người và một đêm để chuẩn bị. Mỗi người phải đứng đúng vị trí — sai một bước, cả phòng tuyến sụp đổ.');

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:250;background:rgba(5,5,8,.95);display:flex;flex-direction:column';
    document.body.appendChild(overlay);
    overlay.innerHTML = `
      <div style="flex:none;padding:calc(var(--safe-top) + 12px) 16px 8px;display:flex;justify-content:flex-end">
        <button class="icon-btn" id="closeMiniCH">✕</button>
      </div>
      <div style="flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 18px 24px">
        <div style="max-width:480px;margin:0 auto;text-align:center">
          <div style="font-family:var(--font-display);font-size:18px;color:var(--gold-1)">Đội Hình Chiến Hào</div>
          <ol id="ch3clues" style="text-align:left;max-width:400px;margin:12px auto;padding-left:18px;font-size:12.5px;line-height:1.6;color:var(--paper-dim)"></ol>
          <div id="postHost" style="margin:16px 0"></div>
          <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--gold-2);margin:14px 0 8px">Đồng đội — chạm để chọn</div>
          <div id="peopleTray" style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"></div>
          <div id="ch3hintMobile" style="margin-top:12px;font-size:12px;color:var(--paper-dim);min-height:18px"></div>
        </div>
      </div>
      <div style="flex:none;padding:14px 18px calc(var(--safe-bottom) + 16px);background:rgba(10,9,13,.8)">
        <button class="btn btn-primary" id="ch3check" style="width:100%;max-width:480px;margin:0 auto;display:block">Triển khai đội hình</button>
      </div>
    `;
    let cancelled = false;
    overlay.querySelector('#closeMiniCH').addEventListener('click', () => { cancelled = true; overlay.remove(); });
    overlay.querySelector('#ch3clues').innerHTML = CLUES.map(c => `<li style="margin-bottom:6px">${c.text}</li>`).join('');

    let placement = new Array(4).fill(null);
    let selected = null;
    let wrongChecks = 0;

    const postHost = overlay.querySelector('#postHost');
    const tray = overlay.querySelector('#peopleTray');

    function renderPosts() {
      const vw = Math.min(window.innerWidth, 480);
      const gap = vw < 420 ? 6 : 10;
      const available = vw - 56;
      const slotW = Math.max(66, Math.min(110, Math.floor((available - gap * 3) / 4)));
      const compact = slotW < 90;
      let html = `<div style="display:flex;gap:${gap}px;justify-content:center;flex-wrap:nowrap">`;
      for (let i = 0; i < 4; i++) {
        const occ = placement[i];
        const person = occ ? PEOPLE.find(x => x.id === occ) : null;
        html += `<div class="postSlot" data-post="${i}" style="
          width:${slotW}px;min-height:${compact?106:126}px;border-radius:14px;cursor:pointer;
          display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${compact?4:7}px;
          background:${person?'rgba(232,197,118,.1)':'rgba(255,255,255,.03)'};
          border:1.5px dashed ${person?'rgba(232,197,118,.4)':'rgba(232,197,118,.2)'};
          padding:${compact?'8px 4px':'10px 6px'};text-align:center;">
          <div style="font-size:${compact?7:9}px;letter-spacing:.06em;text-transform:uppercase;color:var(--gold-2)">${i===0?'← gần làng':i===3?'xa nhất →':'vị trí '+(i+1)}</div>
          <div style="font-size:${compact?8:10}px;color:var(--paper-dim);line-height:1.2">${POST_LABELS[i]}</div>
          ${person ? `<div style="font-size:${compact?20:26}px">${person.glyph}</div><div style="font-family:var(--font-display);font-size:${compact?12:14}px;color:var(--gold-0)">${person.name}</div>` : `<div style="font-size:${compact?16:20}px;color:rgba(232,197,118,.3)">+</div>`}
        </div>`;
      }
      html += `</div>`;
      postHost.innerHTML = html;
      postHost.querySelectorAll('.postSlot').forEach(slotEl => {
        slotEl.addEventListener('click', () => {
          const i = parseInt(slotEl.getAttribute('data-post'), 10);
          if (placement[i]) { placement[i] = null; Audio_.sfxClick(); renderPosts(); renderTray(); return; }
          if (!selected) { toast('Hãy chọn một đồng đội trước.', 'err'); return; }
          placement[i] = selected; selected = null; Audio_.sfxClick(); renderPosts(); renderTray();
        });
      });
    }
    function renderTray() {
      const used = new Set(placement.filter(Boolean));
      tray.innerHTML = '';
      PEOPLE.forEach(pp => {
        const used_ = used.has(pp.id);
        const chip = document.createElement('button');
        chip.className = 'btn';
        chip.style.cssText = `padding:13px 16px;min-height:46px;font-size:13px;opacity:${used_?'.32':'1'}`;
        chip.disabled = used_;
        chip.innerHTML = `<span style="font-size:16px;margin-right:5px">${pp.glyph}</span>${pp.name}`;
        chip.onclick = () => { selected = pp.id; Array.from(tray.children).forEach(c => c.style.outline = ''); chip.style.outline = '2px solid var(--amber)'; };
        tray.appendChild(chip);
      });
    }
    renderPosts(); renderTray();

    let resolveFn;
    const donePromise = new Promise(r => resolveFn = r);
    overlay.querySelector('#ch3check').addEventListener('click', () => {
      if (placement.some(x => !x)) { toast('Vẫn còn vị trí chưa có người trấn giữ.', 'err'); return; }
      const results = checkAll(placement);
      const allOk = results.every(r => r.ok === true);
      const hintEl = overlay.querySelector('#ch3hintMobile');
      if (allOk) {
        Audio_.sfxComplete();
        toast('Đội hình hoàn hảo.', 'ok');
        overlay.querySelector('#ch3check').disabled = true;
        setTimeout(() => resolveFn(wrongChecks), 700);
      } else {
        wrongChecks++;
        Audio_.sfxWrong();
        const failedIdx = results.filter(r => r.ok === false).map(r => r.idx + 1);
        hintEl.textContent = failedIdx.length ? `Sai: mệnh lệnh số ${failedIdx.join(', ')} chưa được tuân thủ.` : 'Hãy hoàn thiện đội hình.';
        toast('Đội hình còn sơ hở.', 'err');
      }
    });

    const mistakes = await donePromise;
    overlay.remove();
    if (cancelled) return;

    let stars = 3; if (mistakes >= 2) stars = 2; if (mistakes >= 4) stars = 1;
    p.stars = Math.max(p.stars, stars); p.mainDone = true;

    await say('Alex', 'Radio đã sẵn sàng. Nếu có động tĩnh, tôi sẽ là người đầu tiên biết.', [{ label: 'Giữ vững vị trí', value: true, primary: true }]);
    await say('Mai', 'Đêm ấy, trận đánh đến rồi đi trong khói lửa. Nhưng đội hình đứng vững — không một ai rời vị trí. Chúng tôi giữ được làng.');
    await modal({
      kicker: 'CHIẾN HÀO BỎ HOANG',
      title: mistakes === 0 ? 'Phòng Tuyến Vững Vàng' : 'Ngôi Làng Được Giữ Lại',
      text: mistakes === 0 ? 'Đội hình được triển khai hoàn hảo ngay từ lần đầu.' : `Sau ${mistakes} lần điều chỉnh, đội hình cuối cùng cũng vững vàng.`,
      stars,
      actions: [{ label: 'Tiếp tục khám phá', value: true, primary: true }],
    });
  }

  function render() {
    buildRegionScreen(
      { key, name: 'Chiến Hào Bỏ Hoang', bg: 'linear-gradient(180deg,#1a120f,#0a0605)', discoveries: hotspots, challengeLabel: 'Triển Khai Đội Hình' },
      { illustrationSVG, hotspots, onMainChallenge, onChestOpen }
    );
  }

  REGIONS.push({ key, name: 'Chiến Hào', glyph: '⚔️', discoveries: hotspots, render });
  return { render };
})();
'use strict';
/* ============================================================
   KHU VỰC IV — BẦU TRỜI PHẢN BỘI (BIỂN NAM)
   ============================================================ */

const RegionBienNam = (() => {
  const key = 'biennnam';

  const illustrationSVG = `
    <svg viewBox="0 0 400 700" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%;display:block">
      <defs>
        <linearGradient id="skyBN" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0a1420"/><stop offset="60%" stop-color="#0d1c28"/><stop offset="100%" stop-color="#142a30"/>
        </linearGradient>
        <linearGradient id="seaBN" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0f2432"/><stop offset="100%" stop-color="#040a10"/>
        </linearGradient>
      </defs>
      <rect width="400" height="440" fill="url(#skyBN)"/>
      <rect y="440" width="400" height="260" fill="url(#seaBN)"/>
      ${Array.from({length:25},(_,i)=>{const x=(i*71)%400, y=(i*59)%380; return `<circle cx="${x}" cy="${y}" r="1.1" fill="#dff" opacity="${0.2+((i*9)%5)/10}"/>`}).join('')}
      <ellipse cx="130" cy="80" rx="42" ry="42" fill="#e8e0d0" opacity=".85"/>
      ${Array.from({length:6},(_,i)=>{const y=460+i*38; return `<path d="M0,${y} Q100,${y-10} 200,${y} T400,${y}" fill="none" stroke="#4fd6c455" stroke-width="1.5"/>`}).join('')}
      <g transform="translate(200,500)">
        <polygon points="-70,20 70,20 50,-10 -50,-10" fill="#2a3038"/>
        <rect x="-8" y="-70" width="6" height="65" fill="#3a4048"/>
        <polygon points="-2,-70 -2,-30 40,-40" fill="#4fd6c433"/>
      </g>
      <ellipse cx="200" cy="700" rx="220" ry="20" fill="#020608"/>
    </svg>
  `;

  const hotspots = [
    {
      id: 'cabin_thuyen_truong', x: 40, y: 55, icon: '🧭', label: 'Cabin thuyền trưởng',
      onActivate: async () => {
        await say('Sáu Đen', 'Nhật ký hải trình ghi lại từng ngày kể từ khi rời cảng. Ba ngày gần đây, la bàn liên tục lệch hướng vô cớ — tôi chưa từng thấy hiện tượng nào như vậy trong ba mươi năm đi biển.');
        await say('Mai', 'Có lẽ đây không phải trục trặc kỹ thuật. Con cảm nhận được thứ gì đó rất lớn đang chờ đợi phía trước, ở nơi bản đồ không còn vẽ tới.');
      },
    },
    {
      id: 'dai_radio_alex', x: 68, y: 42, icon: '📡', label: 'Đài radio của Alex',
      onActivate: async () => {
        await say('Alex', 'Tín hiệu nhiễu này... nó không giống bất cứ thứ gì tôi từng bắt được. Có một tần số ổn định lạ thường ẩn giữa hàng loạt nhiễu sóng ngẫu nhiên.');
        await say('Alex', 'Nếu tôi định vị được nguồn phát thật, có lẽ chúng ta sẽ hiểu vì sao con tàu này đang bị kéo về một hướng không có trên hải đồ.');
      },
    },
    {
      id: 'boong_tau_dem', x: 25, y: 30, icon: '⭐', label: 'Boong tàu lúc nửa đêm',
      onActivate: async () => {
        await say('Kaito', 'Đứng đây lúc nửa đêm, nhìn bầu trời phương nam, tôi có cảm giác mình đang tiến gần đến một điều gì đó đã chờ đợi rất lâu — dù không thể diễn tả rõ đó là gì.');
      },
    },
  ];

  async function onChestOpen() {
    await say('Mai', 'Trong ngăn kéo khoá kín của cabin, con tìm thấy một chiếc la bàn cũ kỹ, mặt kính đã rạn — khắc tên "K." ở mặt sau.');
    await say('Kaito', 'La bàn này... của tôi. Tôi đã đánh mất nó từ rất lâu, trước cả khi tỉnh dậy dưới chân vách đá ở Vô Ưu Cổ Tự. Sao nó lại ở đây được?', [{ label: 'Giữ lại như một manh mối', value: true, primary: true }]);
  }

  // ---- Thử thách chính: lưới toạ độ (đã verify nghiệm duy nhất) ----
  const COLS = ['A', 'B', 'C', 'D', 'E'];
  const TARGET = { col: 3, row: 1 };
  const ANCHORS = { iceberg: { col: 0, row: 0, label: 'Băng Trôi Bắc', glyph: '❄' }, wreck: { col: 4, row: 4, label: 'Xác Tàu Cũ', glyph: '⚓' } };
  function manhattan(a, b) { return Math.abs(a.col - b.col) + Math.abs(a.row - b.row); }
  function chebyshev(a, b) { return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row)); }
  const d1 = manhattan(TARGET, ANCHORS.iceberg);
  const d2 = chebyshev(TARGET, ANCHORS.wreck);
  const CLUES = [
    { text: `Tín hiệu cách "Băng Trôi Bắc" đúng ${d1} ô theo đường thẳng ngang-dọc.`, check: (p) => manhattan(p, ANCHORS.iceberg) === d1 },
    { text: `Tín hiệu nằm trong vòng vuông bán kính ${d2} ô quanh "Xác Tàu Cũ".`, check: (p) => chebyshev(p, ANCHORS.wreck) === d2 },
    { text: `Tín hiệu lệch về phía Đông nhiều hơn phía Bắc — cột lớn hơn hàng.`, check: (p) => p.col > p.row },
  ];

  function gridHTML(selected, revealResult) {
    const vw = window.innerWidth, vh = window.innerHeight;
    // Cell size phải tôn trọng cả chiều rộng lẫn chiều cao khả dụng — trên
    // landscape thấp (vd. 667x375), innerWidth lớn nhưng chiều cao rất hẹp,
    // nên nếu chỉ tính theo width sẽ vẽ lưới quá to so với không gian thật.
    const cellByWidth = vw < 380 ? 46 : vw < 640 ? 50 : 54;
    // Ngân sách chiều cao cho lưới: trừ đi phần tiêu đề/clue/chú thích/nút đáy
    // (~260px ước lượng), chia cho 6 hàng (5 ô + 1 hàng label cột) cộng gap.
    const heightBudget = Math.max(vh - 260, 180);
    const cellByHeight = Math.floor((heightBudget - 5 * 6) / 6);
    const cell = Math.max(30, Math.min(cellByWidth, cellByHeight));
    const labelCol = Math.round(cell * 0.5);
    const gap = cell < 40 ? 4 : vw < 380 ? 5 : 6;
    let html = `<div style="display:inline-grid;grid-template-columns:${labelCol}px repeat(5,${cell}px);grid-auto-rows:${cell}px;gap:${gap}px;margin:0 auto">`;
    html += `<div></div>`;
    COLS.forEach(c => { html += `<div style="display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--gold-2)">${c}</div>`; });
    for (let r = 0; r < 5; r++) {
      html += `<div style="display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--gold-2)">${r+1}</div>`;
      for (let c = 0; c < 5; c++) {
        const isIce = ANCHORS.iceberg.col===c && ANCHORS.iceberg.row===r;
        const isWreck = ANCHORS.wreck.col===c && ANCHORS.wreck.row===r;
        const isSel = selected && selected.col===c && selected.row===r;
        let bg='rgba(255,255,255,.03)', border='rgba(232,197,118,.16)', content='';
        if (isIce) { content=ANCHORS.iceberg.glyph; bg='rgba(79,214,196,.1)'; border='rgba(79,214,196,.4)'; }
        if (isWreck) { content=ANCHORS.wreck.glyph; bg='rgba(255,157,77,.1)'; border='rgba(255,157,77,.4)'; }
        if (isSel) { border='var(--amber)'; bg='rgba(255,157,77,.18)'; }
        if (revealResult && isSel) { bg = revealResult==='ok'?'rgba(143,227,166,.22)':'rgba(255,92,92,.18)'; border = revealResult==='ok'?'var(--ok)':'var(--danger)'; }
        html += `<div class="gridCellBN" data-col="${c}" data-row="${r}" style="width:${cell}px;height:${cell}px;border-radius:8px;border:1.5px solid ${border};background:${bg};display:flex;align-items:center;justify-content:center;font-size:${cell>48?16:14}px;cursor:pointer;">${content}</div>`;
      }
    }
    html += `</div>`;
    return html;
  }

  async function onMainChallenge() {
    const p = getProgress(key);
    await say('Alex', '"Ánh Bình Minh" cắt qua sóng lặng lẽ. Nhưng ba ngày nay, la bàn cứ quay tròn vô nghĩa rồi mới chịu ổn định.');
    await say('Sáu Đen', 'Hệ thống liên lạc bắt được tín hiệu nhiễu kỳ lạ. Có một nguồn phát thật giữa hàng loạt nhiễu sóng giả — phải định vị chính xác.');

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:250;background:rgba(5,5,8,.95);display:flex;flex-direction:column';
    document.body.appendChild(overlay);
    overlay.innerHTML = `
      <div style="flex:none;padding:calc(var(--safe-top) + 12px) 16px 8px;display:flex;justify-content:flex-end">
        <button class="icon-btn" id="closeMiniBN">✕</button>
      </div>
      <div style="flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 18px 24px">
        <div style="max-width:440px;margin:0 auto;text-align:center">
          <div style="font-family:var(--font-display);font-size:18px;color:var(--gold-1)">Định Vị Giữa Nhiễu Sóng</div>
          <ol id="ch4clues" style="text-align:left;max-width:380px;margin:12px auto;padding-left:18px;font-size:12.5px;line-height:1.6;color:var(--paper-dim)"></ol>
          <div id="gridHostBN" style="display:flex;justify-content:center;margin:16px 0"></div>
          <div style="display:flex;justify-content:center;gap:16px;font-size:11px;color:var(--paper-dim);margin-bottom:6px">
            <span>❄ Băng Trôi Bắc</span><span>⚓ Xác Tàu Cũ</span>
          </div>
          <div id="ch4hintMobile" style="margin-top:8px;font-size:12px;color:var(--paper-dim);min-height:18px"></div>
        </div>
      </div>
      <div style="flex:none;padding:14px 18px calc(var(--safe-bottom) + 16px);background:rgba(10,9,13,.8)">
        <button class="btn btn-primary" id="ch4check" disabled style="width:100%;max-width:440px;margin:0 auto;display:block">Xác nhận toạ độ</button>
      </div>
    `;
    let cancelled = false;
    overlay.querySelector('#closeMiniBN').addEventListener('click', () => { cancelled = true; overlay.remove(); });
    overlay.querySelector('#ch4clues').innerHTML = CLUES.map(c => `<li style="margin-bottom:6px">${c.text}</li>`).join('');

    let selected = null;
    let wrongChecks = 0;
    const gridHost = overlay.querySelector('#gridHostBN');
    function renderGrid(reveal) {
      gridHost.innerHTML = gridHTML(selected, reveal);
      if (!reveal) {
        gridHost.querySelectorAll('.gridCellBN').forEach(cell => {
          cell.addEventListener('click', () => {
            const c = parseInt(cell.getAttribute('data-col'),10), r = parseInt(cell.getAttribute('data-row'),10);
            if ((c===ANCHORS.iceberg.col && r===ANCHORS.iceberg.row) || (c===ANCHORS.wreck.col && r===ANCHORS.wreck.row)) return;
            selected = { col:c, row:r }; Audio_.sfxClick();
            overlay.querySelector('#ch4check').disabled = false;
            renderGrid();
          });
        });
      }
    }
    renderGrid();

    let resolveFn;
    const donePromise = new Promise(r => resolveFn = r);
    overlay.querySelector('#ch4check').addEventListener('click', () => {
      if (!selected) return;
      const results = CLUES.map(c => c.check(selected));
      const allOk = results.every(Boolean);
      const hintEl = overlay.querySelector('#ch4hintMobile');
      if (allOk) {
        Audio_.sfxComplete(); renderGrid('ok');
        toast('Toạ độ chính xác.', 'ok');
        overlay.querySelector('#ch4check').disabled = true;
        setTimeout(() => resolveFn(wrongChecks), 700);
      } else {
        wrongChecks++; Audio_.sfxWrong(); renderGrid('err');
        const failedIdx = results.map((ok,i)=>ok?null:i+1).filter(Boolean);
        hintEl.textContent = `Sai: manh mối số ${failedIdx.join(', ')} chưa khớp.`;
        toast('Sai toạ độ.', 'err');
        setTimeout(() => { selected = null; overlay.querySelector('#ch4check').disabled = true; renderGrid(); }, 800);
      }
    });

    const mistakes = await donePromise;
    overlay.remove();
    if (cancelled) return;

    let stars = 3; if (mistakes >= 2) stars = 2; if (mistakes >= 4) stars = 1;
    p.stars = Math.max(p.stars, stars); p.mainDone = true;

    await say('Sáu Đen', 'Định vị chính xác! Nhưng... sóng đang mạnh dần lên bất thường.', [{ label: 'Tiếp tục', value: true, primary: true }]);
    await say('Mai', 'Đêm đó, bầu trời phía nam bùng lên thứ ánh sáng tím chưa từng thấy. Khi bão tan, boong tàu trống trải — không một dấu vết. "Kaito... anh đâu rồi?"');
    await modal({
      kicker: 'BẦU TRỜI PHẢN BỘI',
      title: mistakes === 0 ? 'Định Vị Chính Xác' : 'Toạ Độ Đã Lộ Diện',
      text: mistakes === 0 ? 'Mai định vị chính xác nguồn tín hiệu ngay từ lần đầu. Nhưng không gì chuẩn bị được cho điều sắp xảy ra.' : `Sau ${mistakes} lần dò sai, toạ độ cuối cùng cũng lộ diện — quá muộn để ngăn điều tồi tệ nhất.`,
      stars,
      actions: [{ label: 'Tiếp tục khám phá', value: true, primary: true }],
    });
  }

  function render() {
    buildRegionScreen(
      { key, name: 'Bầu Trời Phản Bội', bg: 'linear-gradient(180deg,#0d1a24,#050a10)', discoveries: hotspots, challengeLabel: 'Định Vị Giữa Nhiễu Sóng' },
      { illustrationSVG, hotspots, onMainChallenge, onChestOpen }
    );
  }

  REGIONS.push({ key, name: 'Biển Nam', glyph: '⛵', discoveries: hotspots, render });
  return { render };
})();
'use strict';
/* ============================================================
   KHU VỰC V — CÁNH CỔNG NAM CỰC (màn cuối)
   ============================================================ */

const RegionCanhCong = (() => {
  const key = 'canhcong';

  const illustrationSVG = `
    <svg viewBox="0 0 400 700" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%;display:block">
      <defs>
        <linearGradient id="skyCC" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0d0f1c"/><stop offset="60%" stop-color="#161230"/><stop offset="100%" stop-color="#1e1440"/>
        </linearGradient>
        <radialGradient id="gateGlow"><stop offset="0%" stop-color="#c9a6ff" stop-opacity=".8"/><stop offset="100%" stop-color="#8b6bd6" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="400" height="700" fill="url(#skyCC)"/>
      ${Array.from({length:35},(_,i)=>{const x=(i*67)%400, y=(i*89)%320; return `<circle cx="${x}" cy="${y}" r="1.2" fill="#dcd0ff" opacity="${0.25+((i*7)%5)/10}"/>`}).join('')}
      <ellipse cx="200" cy="500" rx="260" ry="60" fill="#0a0b16"/>
      ${Array.from({length:5},(_,i)=>{const x=40+i*80; const h=30+((i*23)%40); return `<polygon points="${x-20},700 ${x},${700-h} ${x+20},700" fill="#141628" opacity=".7"/>`}).join('')}
      <g transform="translate(200,380)">
        <circle cx="0" cy="0" r="90" fill="url(#gateGlow)"/>
        <ellipse cx="0" cy="0" rx="55" ry="85" fill="none" stroke="#c9a6ff" stroke-width="3" opacity=".8"/>
        <ellipse cx="0" cy="0" rx="40" ry="65" fill="#1a1030" opacity=".9"/>
        <ellipse cx="0" cy="0" rx="30" ry="50" fill="#2a1850"/>
      </g>
      <ellipse cx="200" cy="680" rx="220" ry="22" fill="#04050a"/>
    </svg>
  `;

  const hotspots = [
    {
      id: 'bia_da_co', x: 25, y: 55, icon: '🗿', label: 'Bia đá cổ',
      onActivate: async () => {
        await say('Hùng', 'Những ký tự khắc trên bia đá này cổ hơn bất kỳ nền văn minh nào từng được ghi chép. Nghị Hội Tro Tàn đã canh giữ nơi này suốt nhiều thập kỷ, chỉ để chờ ngày Cánh Cổng thức tỉnh.');
        await say('Sarah', 'Nếu bia đá nói đúng, Cánh Cổng không phải một cánh cửa bình thường — nó là một vết nứt giữa các tầng hiện thực. Và điều gì đó đã lọt qua vết nứt ấy, đang chờ được đưa trở lại.');
      },
    },
    {
      id: 'tan_tich_nghi_hoi', x: 68, y: 68, icon: '⚱️', label: 'Tàn tích Nghị Hội Tro Tàn',
      onActivate: async () => {
        await say('Mai', 'Doanh trại bỏ hoang, tro tàn phủ kín mọi ngóc ngách. Tư lệnh Voss và đội quân của ông ta từng đóng ở đây, canh giữ Cánh Cổng bằng mọi giá — kể cả mạng sống của chính mình.');
      },
    },
    {
      id: 'vung_nguong', x: 45, y: 32, icon: '✨', label: 'Rìa Vùng Ngưỡng',
      onActivate: async () => {
        await say('Mai', 'Đứng gần rìa Cánh Cổng, con cảm nhận rõ nhịp tim quen thuộc vọng ra từ phía bên kia. Kaito. Anh vẫn còn đó, đang chờ đợi, đang hy vọng.');
        await say('Mai', 'Con sẽ không để tần số sai lệch dù chỉ một bậc. Con đã đi quá xa để có thể quay đầu bây giờ.');
      },
    },
  ];

  async function onChestOpen() {
    await say('Sarah', 'Gần chân Cánh Cổng, có một mảnh vỡ phát sáng nhẹ — như một mảnh ký ức bị mắc kẹt giữa hai thế giới.');
    await say('Mai', 'Khi chạm vào, con thấy thoáng qua hình ảnh Kaito đang một mình giữa vùng sáng trắng vô tận, gọi tên con. Đó không phải ảo giác — đó là một lời hứa rằng anh vẫn đang chờ.', [{ label: 'Nắm chặt mảnh ký ức', value: true, primary: true }]);
  }

  // ---- Thử thách chính: hệ 3 phương trình (đã verify nghiệm duy nhất) ----
  const ANSWER = [1, 4, 7];
  const LABELS = ['Trụ Trái', 'Trụ Giữa', 'Trụ Phải'];
  const CLUES = [
    'Tổng ánh sáng của ba trụ phải đúng bằng 12.',
    'Trụ Giữa phải sáng hơn Trụ Trái đúng 3 bậc.',
    'Trụ Phải bằng hai lần Trụ Giữa, trừ đi Trụ Trái.',
  ];
  function pillarSVG(idx, value) {
    const pct = value / 9; const h = 110; const fillH = h * pct;
    return `<svg viewBox="0 0 50 140" style="width:50px;height:140px">
      <rect x="14" y="8" width="22" height="${h}" rx="9" fill="rgba(255,255,255,.04)" stroke="rgba(232,197,118,.25)" stroke-width="1.5"/>
      <rect x="14" y="${8+h-fillH}" width="22" height="${fillH}" rx="9" fill="url(#pg${idx})"/>
      <circle cx="25" cy="${8+h-fillH}" r="4" fill="#fff7e0" opacity=".9"/>
      <text x="25" y="126" text-anchor="middle" font-size="13" fill="var(--gold-0)" font-family="Cormorant Garamond, serif" font-weight="600">${value}</text>
      <defs><linearGradient id="pg${idx}" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="#c9973f"/><stop offset="100%" stop-color="#fff7e0"/></linearGradient></defs>
    </svg>`;
  }

  async function onMainChallenge() {
    const p = getProgress(key);
    await say('Hùng', 'Bốn giờ sáng, lạnh cắt da. Đây rồi — Cánh Cổng nguyên thủy. Ba trụ nạp năng lượng bao quanh nó, im lìm chờ đợi.');
    await say('Mai', 'Con cảm nhận được nó — một nhịp tim quen thuộc vọng ra từ phía sau cánh cổng. Kaito.');

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:250;background:rgba(5,5,8,.95);display:flex;flex-direction:column';
    document.body.appendChild(overlay);
    overlay.innerHTML = `
      <div style="flex:none;padding:calc(var(--safe-top) + 12px) 16px 8px;display:flex;justify-content:flex-end">
        <button class="icon-btn" id="closeMiniCC">✕</button>
      </div>
      <div style="flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 18px 24px">
        <div style="max-width:420px;margin:0 auto;text-align:center">
          <div style="font-family:var(--font-display);font-size:18px;color:var(--gold-1)">Ba Trụ Nạp</div>
          <ol id="ch5clues" style="text-align:left;max-width:360px;margin:12px auto;padding-left:18px;font-size:12.5px;line-height:1.6;color:var(--paper-dim)"></ol>
          <div style="display:flex;justify-content:center;gap:16px;margin:20px 0 10px;flex-wrap:wrap">
            ${[0,1,2].map(i => `
              <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
                <button class="pillarBtnCC" data-i="${i}" data-dir="1" style="width:44px;height:44px;border-radius:10px;border:1px solid var(--line-strong);background:rgba(232,197,118,.08);color:var(--gold-1);font-size:19px;font-weight:700;cursor:pointer">+</button>
                <div id="pillarHostCC${i}"></div>
                <button class="pillarBtnCC" data-i="${i}" data-dir="-1" style="width:44px;height:44px;border-radius:10px;border:1px solid var(--line-strong);background:rgba(232,197,118,.08);color:var(--gold-1);font-size:19px;font-weight:700;cursor:pointer">−</button>
                <div style="font-size:10px;color:var(--paper-dim)">${LABELS[i]}</div>
              </div>
            `).join('')}
          </div>
          <div style="font-size:12.5px;color:var(--paper-dim)">Tổng hiện tại: <b id="sumDisplayCC" style="color:var(--gold-1)">15</b> / cần <b>12</b></div>
          <div id="ch5hintMobile" style="margin-top:10px;font-size:12px;color:var(--paper-dim);min-height:18px"></div>
        </div>
      </div>
      <div style="flex:none;padding:14px 18px calc(var(--safe-bottom) + 16px);background:rgba(10,9,13,.8)">
        <button class="btn btn-primary" id="ch5check" style="width:100%;max-width:420px;margin:0 auto;display:block">Đồng bộ trụ nạp</button>
      </div>
    `;
    let cancelled = false;
    overlay.querySelector('#closeMiniCC').addEventListener('click', () => { cancelled = true; overlay.remove(); });
    overlay.querySelector('#ch5clues').innerHTML = CLUES.map(c => `<li style="margin-bottom:6px">${c}</li>`).join('');

    let values = [5, 5, 5];
    function renderPillars() {
      for (let i = 0; i < 3; i++) overlay.querySelector(`#pillarHostCC${i}`).innerHTML = pillarSVG(i, values[i]);
      overlay.querySelector('#sumDisplayCC').textContent = values.reduce((a,b)=>a+b,0);
    }
    renderPillars();
    overlay.querySelectorAll('.pillarBtnCC').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.getAttribute('data-i'),10), dir = parseInt(btn.getAttribute('data-dir'),10);
        values[i] = Math.max(1, Math.min(9, values[i]+dir));
        renderPillars(); Audio_.sfxClick();
      });
    });

    let wrongChecks = 0;
    let resolveFn;
    const donePromise = new Promise(r => resolveFn = r);
    overlay.querySelector('#ch5check').addEventListener('click', () => {
      const sum = values[0]+values[1]+values[2];
      const c1 = sum === 12, c2 = (values[1]-values[0])===3, c3 = values[2]===(2*values[1]-values[0]);
      const allOk = c1 && c2 && c3;
      const hintEl = overlay.querySelector('#ch5hintMobile');
      if (allOk) {
        Audio_.sfxComplete();
        toast('Ba trụ đồng bộ hoàn hảo — Cánh Cổng rung chuyển!', 'ok');
        overlay.querySelector('#ch5check').disabled = true;
        setTimeout(() => resolveFn(wrongChecks), 800);
      } else {
        wrongChecks++; Audio_.sfxWrong();
        const fails = []; if(!c1) fails.push(1); if(!c2) fails.push(2); if(!c3) fails.push(3);
        hintEl.textContent = `Sai: lời sấm số ${fails.join(', ')} chưa khớp.`;
        toast('Tần số chưa khớp.', 'err');
      }
    });

    const mistakes = await donePromise;
    overlay.remove();
    if (cancelled) return;

    let stars = 3; if (mistakes >= 2) stars = 2; if (mistakes >= 4) stars = 1;
    p.stars = Math.max(p.stars, stars); p.mainDone = true;

    await say('Mai', 'Ánh sáng tím bùng lên từ tâm Cánh Cổng — mạnh mẽ hơn bất cứ điều gì cô từng thấy. Một tiếng gọi yếu ớt nhưng chắc chắn vọng đến. "Mai..."', [{ label: 'KAITO!', value: true, primary: true }]);
    await say('Mai', 'Không chút do dự, cô lao thẳng về phía ánh sáng — biến mất khỏi tầm mắt kinh hoàng của tất cả.');
    await say('Kaito', 'Trong khoảnh khắc chuyển tiếp không thể mô tả, Mai tìm thấy anh — run rẩy nhưng còn sống. Cô nắm lấy tay anh, và cả hai cùng bước ngược về ánh sáng.');
    await modal({
      kicker: 'CÁNH CỔNG NAM CỰC',
      title: mistakes === 0 ? 'Nhịp Tim Không Lỗi' : 'Kaito Đã Trở Về',
      text: mistakes === 0 ? 'Mai tính đúng tần số ba trụ chỉ trong một lần thử.' : `Sau ${mistakes} lần đồng bộ thất bại, ba trụ cuối cùng cũng cộng hưởng đúng nhịp.`,
      stars,
      actions: [{ label: 'Tiếp tục khám phá', value: true, primary: true }],
    });

    // Kiểm tra nếu đây là khu vực cuối cùng hoàn thành toàn bộ → mở màn tổng kết
    checkEventCompletion();
  }

  function render() {
    buildRegionScreen(
      { key, name: 'Cánh Cổng Nam Cực', bg: 'linear-gradient(180deg,#141030,#08060f)', discoveries: hotspots, challengeLabel: 'Đồng Bộ Ba Trụ Nạp' },
      { illustrationSVG, hotspots, onMainChallenge, onChestOpen }
    );
  }

  REGIONS.push({ key, name: 'Cánh Cổng', glyph: '🌀', discoveries: hotspots, render });
  return { render };
})();
