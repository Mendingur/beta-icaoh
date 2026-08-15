'use strict';
/* ============================================================
   KHÚC CA HY VỌNG — engine lõi
   Kiến trúc: state machine 5 chương, canvas ambient layer tách
   biệt khỏi DOM UI, mỗi chương là 1 module {mount(root), onExit}.
   ============================================================ */

/* ---------------- global state ---------------- */
const STATE = {
  chapterIndex: -1,
  totalSeconds: 600,      // 10 phút toàn game
  remaining: 600,
  timerRunning: false,
  muted: false,
  audioCtx: null,
  audioUnlocked: false,
  stars: 0,               // thành tích tích lũy (tối đa 15 = 3*5 chương)
  seedGlow: 0,            // 0..1 "ánh sáng" tích lũy xuyên suốt game, ảnh hưởng hiệu ứng nền
};

const CHAPTERS = []; // điền ở cuối file bởi mỗi module chương

/* ---------------- DOM refs ---------------- */
const $ = (id) => document.getElementById(id);
const el = {
  bgcanvas: $('bgcanvas'),
  stageRoot: $('stage-root'),
  stageBanner: $('stageBanner'),
  stageEyebrow: $('stageEyebrow'),
  stageTitle: $('stageTitle'),
  chapterPips: $('chapterPips'),
  timerWrap: $('timerWrap'),
  timerNum: $('timerNum'),
  timerArc: $('timerArc'),
  muteBtn: $('muteBtn'),
  dialogueWrap: $('dialogueWrap'),
  dialogueCard: $('dialogueCard'),
  dSpeakerName: $('dSpeakerName'),
  dText: $('dText'),
  dActions: $('dActions'),
  toast: $('toast'),
  modal: $('modal'),
  modalKicker: $('modalKicker'),
  modalTitle: $('modalTitle'),
  modalText: $('modalText'),
  modalStars: $('modalStars'),
  modalActions: $('modalActions'),
};

/* ============================================================
   AMBIENT CANVAS ENGINE
   Lớp nền dùng chung mọi chương: bầu trời sao + hạt sáng vàng
   trôi nổi + (tuỳ chương) cánh hoa sen / tro tàn / tuyết.
   ============================================================ */
const Ambient = (() => {
  const ctx = el.bgcanvas.getContext('2d', { alpha: false });
  let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);
  let particles = [];
  let mode = 'dusk'; // dusk | temple | war | sea | pole
  let raf = null;
  let t = 0;

  const PALETTES = {
    dusk:   { top:'#141018', bottom:'#050406', glow:'rgba(255,157,77,.10)' },
    temple: { top:'#0f1410', bottom:'#050705', glow:'rgba(232,197,118,.10)' },
    war:    { top:'#160f10', bottom:'#060404', glow:'rgba(255,90,60,.10)' },
    sea:    { top:'#0a1420', bottom:'#04070b', glow:'rgba(79,214,196,.09)' },
    pole:   { top:'#0d0f1c', bottom:'#050510', glow:'rgba(139,107,214,.13)' },
  };

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    el.bgcanvas.width = W * DPR;
    el.bgcanvas.height = H * DPR;
    el.bgcanvas.style.width = W + 'px';
    el.bgcanvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  function seedParticles() {
    const count = window.innerWidth < 640 ? 46 : 84;
    particles = [];
    for (let i = 0; i < count; i++) {
      particles.push(spawnParticle(true));
    }
  }

  function spawnParticle(randomY) {
    const kindRoll = Math.random();
    let kind = 'spark';
    if (mode === 'temple' && kindRoll < 0.35) kind = 'petal';
    if (mode === 'war' && kindRoll < 0.3) kind = 'ash';
    if (mode === 'sea' && kindRoll < 0.25) kind = 'mist';
    if (mode === 'pole' && kindRoll < 0.3) kind = 'snow';
    return {
      kind,
      x: Math.random() * W,
      y: randomY ? Math.random() * H : H + 20,
      r: kind === 'petal' ? 3 + Math.random() * 4 : 0.6 + Math.random() * 1.8,
      vy: -(0.12 + Math.random() * 0.28),
      vx: (Math.random() - 0.5) * 0.18,
      drift: Math.random() * Math.PI * 2,
      driftSpeed: 0.004 + Math.random() * 0.01,
      alpha: 0.25 + Math.random() * 0.55,
      hue: kind === 'ash' ? 20 : kind === 'mist' ? 180 : kind === 'snow' ? 210 : 42,
      spin: Math.random() * Math.PI * 2,
      spinSpeed: (Math.random() - 0.5) * 0.02,
    };
  }

  function setMode(next) {
    mode = next;
  }

  function draw() {
    t += 1;
    const pal = PALETTES[mode] || PALETTES.dusk;

    // sky gradient
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, pal.top);
    g.addColorStop(1, pal.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // soft glow center-top, breathing
    const breathe = 0.85 + Math.sin(t * 0.008) * 0.15;
    const rg = ctx.createRadialGradient(W * 0.5, H * 0.18, 0, W * 0.5, H * 0.18, Math.max(W, H) * 0.6 * breathe);
    rg.addColorStop(0, pal.glow);
    rg.addColorStop(1, 'transparent');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);

    // static stars (only dusk/temple/pole feel starry)
    if (mode !== 'war') {
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      for (let i = 0; i < 40; i++) {
        const sx = (i * 97.3) % W;
        const sy = (i * 53.7) % (H * 0.6);
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.02 + i));
        ctx.globalAlpha = tw * 0.5;
        ctx.fillRect(sx, sy, 1.4, 1.4);
      }
      ctx.globalAlpha = 1;
    }

    // particles
    for (const p of particles) {
      p.y += p.vy;
      p.drift += p.driftSpeed;
      p.x += p.vx + Math.sin(p.drift) * 0.15;
      p.spin += p.spinSpeed;
      if (p.y < -20) { Object.assign(p, spawnParticle(false)); }
      if (p.x < -20) p.x = W + 20;
      if (p.x > W + 20) p.x = -20;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin);
      ctx.globalAlpha = p.alpha * (0.6 + 0.4 * Math.sin(t * 0.01 + p.drift));
      if (p.kind === 'petal') {
        ctx.fillStyle = `hsl(${p.hue},70%,72%)`;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r, p.r * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'ash') {
        ctx.fillStyle = `hsl(${p.hue},30%,40%)`;
        ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r);
      } else if (p.kind === 'snow') {
        ctx.fillStyle = `hsl(${p.hue},60%,90%)`;
        ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = `hsl(${p.hue},85%,70%)`;
        ctx.shadowColor = `hsl(${p.hue},90%,65%)`;
        ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    raf = requestAnimationFrame(draw);
  }

  function start() {
    seedParticles();
    if (!raf) raf = requestAnimationFrame(draw);
  }

  return { start, setMode };
})();

/* ============================================================
   AUDIO
   Nhạc nền loop duy nhất (nếu asset có), + sfx tổng hợp qua
   WebAudio oscillator (không cần file, luôn hoạt động offline).
   ============================================================ */
const Audio_ = (() => {
  // Không phụ thuộc file nhạc ngoài — toàn bộ âm thanh (nhạc nền ambient +
  // hiệu ứng) được tổng hợp trực tiếp qua WebAudio để game chạy độc lập,
  // chỉ cần 1 file HTML/CSS/JS duy nhất, không cần asset đi kèm.
  let padNodes = null;
  let padGain = null;

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
    startPad();
  }

  // Pad ambient: 3 oscillator hoà âm nhẹ (kiểu drone thiền), rất khẽ,
  // tạo không khí nền liên tục mà không cần file nhạc nào.
  function startPad() {
    if (STATE.muted || padNodes) return;
    try {
      const c = ctx();
      padGain = c.createGain();
      padGain.gain.setValueAtTime(0, c.currentTime);
      padGain.gain.linearRampToValueAtTime(0.028, c.currentTime + 2.5);
      padGain.connect(c.destination);
      const freqs = [130.81, 196.0, 164.81]; // C3, G3, E3 — hợp âm trưởng ấm áp
      padNodes = freqs.map((f, i) => {
        const osc = c.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, c.currentTime);
        const lfo = c.createOscillator();
        const lfoGain = c.createGain();
        lfo.frequency.setValueAtTime(0.06 + i * 0.02, c.currentTime);
        lfoGain.gain.setValueAtTime(1.5, c.currentTime);
        lfo.connect(lfoGain).connect(osc.frequency);
        lfo.start();
        osc.connect(padGain);
        osc.start();
        return { osc, lfo };
      });
    } catch (e) {}
  }

  function stopPad() {
    if (!padNodes) return;
    try {
      const c = ctx();
      padGain.gain.linearRampToValueAtTime(0, c.currentTime + 0.6);
      setTimeout(() => {
        padNodes.forEach(n => { try { n.osc.stop(); n.lfo.stop(); } catch (e) {} });
        padNodes = null;
      }, 650);
    } catch (e) {}
  }

  function toggleMute() {
    STATE.muted = !STATE.muted;
    el.muteBtn.textContent = STATE.muted ? '✕' : '♪';
    el.muteBtn.style.color = STATE.muted ? 'var(--paper-dim)' : '';
    if (STATE.muted) stopPad(); else startPad();
  }

  // sfx nhẹ: chime khi đúng, thud khi sai, swell khi hoàn thành chương
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
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch (e) {}
  }

  function sfxCorrect() { tone(660, 0.22, 'sine', 0.06); tone(880, 0.28, 'sine', 0.045, 0.05); }
  function sfxWrong() { tone(160, 0.28, 'sawtooth', 0.05); }
  function sfxClick() { tone(520, 0.08, 'triangle', 0.03); }
  function sfxComplete() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.5, 'sine', 0.05, i * 0.09));
  }
  function sfxTick() { tone(1000, 0.03, 'square', 0.012); }

  return { unlock, toggleMute, sfxCorrect, sfxWrong, sfxClick, sfxComplete, sfxTick };
})();

/* ============================================================
   UI HELPERS (toast / dialogue / modal)
   ============================================================ */
function toast(msg, kind = '') {
  el.toast.textContent = msg;
  el.toast.className = 'toast show' + (kind ? ' ' + kind : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.toast.classList.remove('show'); }, 1900);
}

function say(speaker, text, actions = []) {
  return new Promise((resolve) => {
    el.dSpeakerName.textContent = speaker;
    el.dText.textContent = text;
    el.dActions.innerHTML = '';
    el.dialogueCard.classList.add('show');
    const finish = (val) => {
      el.dialogueCard.classList.remove('show');
      resolve(val);
    };
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

function hideDialogue() { el.dialogueCard.classList.remove('show'); }

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
      // animate stars filling in
      setTimeout(() => {
        el.modalStars.innerHTML = starsSVG(stars, 3);
      }, 260);
    } else {
      el.modalStars.style.display = 'none';
      el.modalStars.innerHTML = '';
    }
    el.modalActions.innerHTML = '';
    actions.forEach((a) => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (a.primary ? 'btn-primary' : 'btn-ghost');
      btn.textContent = a.label;
      btn.onclick = () => {
        Audio_.sfxClick();
        el.modal.classList.remove('show');
        resolve(a.value);
      };
      el.modalActions.appendChild(btn);
    });
    el.modal.classList.add('show');
  });
}

/* ============================================================
   TIMER (đếm ngược tổng 10 phút, chạy xuyên toàn bộ game)
   ============================================================ */
const Timer = (() => {
  let intervalId = null;
  const CIRC = 97.4; // 2*pi*15.5

  function fmt(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  function render() {
    el.timerNum.textContent = fmt(Math.max(0, STATE.remaining));
    const frac = Math.max(0, STATE.remaining / STATE.totalSeconds);
    el.timerArc.setAttribute('stroke-dashoffset', String(CIRC * (1 - frac)));
    el.timerWrap.classList.toggle('warn', STATE.remaining <= 60 && STATE.remaining > 0);
  }

  function start() {
    if (intervalId) return;
    STATE.timerRunning = true;
    intervalId = setInterval(() => {
      if (!STATE.timerRunning) return;
      STATE.remaining -= 1;
      if (STATE.remaining <= 10 && STATE.remaining > 0) Audio_.sfxTick();
      render();
      if (STATE.remaining <= 0) {
        STATE.remaining = 0;
        render();
        onTimeUp();
      }
    }, 1000);
    render();
  }

  function pause() { STATE.timerRunning = false; }
  function resume() { STATE.timerRunning = true; }

  return { start, pause, resume, render, fmt };
})();

async function onTimeUp() {
  Timer.pause();
  await modal({
    kicker: 'HẾT THỜI GIAN',
    title: 'Ánh sáng lịm dần…',
    text: 'Mười phút đã trôi qua. Nhưng một hạt giống, dù chưa kịp nảy mầm trọn vẹn, vẫn xứng đáng được gieo lại lần nữa.',
    actions: [{ label: 'Bắt đầu lại từ đầu', value: true, primary: true }],
  });
  restartGame();
}

/* ============================================================
   STAGE BANNER + PIPS
   ============================================================ */
function renderPips() {
  el.chapterPips.innerHTML = CHAPTERS.map((c, i) => {
    const cls = i < STATE.chapterIndex ? 'done' : i === STATE.chapterIndex ? 'active' : '';
    return `<div class="pip ${cls}"></div>`;
  }).join('');
}

function showStageBanner(eyebrow, title) {
  el.stageEyebrow.textContent = eyebrow;
  el.stageTitle.textContent = title;
  el.stageBanner.classList.add('show');
  clearTimeout(showStageBanner._t);
  showStageBanner._t = setTimeout(() => {
    el.stageBanner.classList.remove('show');
  }, 2600);
}

/* ============================================================
   SCENE MOUNT HELPER
   ============================================================ */
function mountScene(innerHTML) {
  el.stageRoot.innerHTML = `<div class="scene" id="activeScene">${innerHTML}</div>`;
  const s = $('activeScene');
  requestAnimationFrame(() => requestAnimationFrame(() => s.classList.add('enter')));
  setupScrollHints(s);
  return s;
}

// Tự động phát hiện khi nội dung câu đố (.card-scroll) dài hơn vùng
// hiển thị, để hiện gradient mờ + gợi ý "vuốt lên xem thêm" ở đáy.
// Chạy cho MỌI chương có .card-frame/.card-scroll, không cần khai báo
// riêng lẻ từng nơi — và tự cập nhật lại khi nội dung bên trong đổi
// (chọn biểu tượng, xếp vị trí...) vì kích thước có thể thay đổi.
function setupScrollHints(sceneEl) {
  const frames = sceneEl.querySelectorAll('.card-frame');
  frames.forEach((frame) => {
    const scrollEl = frame.querySelector('.card-scroll');
    if (!scrollEl) return;
    const update = () => {
      const canScroll = scrollEl.scrollHeight - scrollEl.clientHeight > 8;
      const atBottom = scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 8;
      frame.classList.toggle('scrollable', canScroll && !atBottom);
    };
    update();
    scrollEl.addEventListener('scroll', update, { passive: true });
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(update);
      ro.observe(scrollEl);
    } else {
      // fallback cho môi trường không hỗ trợ ResizeObserver
      setInterval(update, 500);
    }
  });
}

/* ============================================================
   CHAPTER FLOW CONTROLLER
   ============================================================ */
async function runChapter(index) {
  STATE.chapterIndex = index;
  renderPips();
  const chapter = CHAPTERS[index];
  Ambient.setMode(chapter.ambient);
  showStageBanner(chapter.eyebrow, chapter.title);

  await chapter.run();

  STATE.stars += chapter.starsEarned || 0;

  if (index + 1 < CHAPTERS.length) {
    await runChapter(index + 1);
  } else {
    await finaleSequence();
  }
}

async function finaleSequence() {
  Timer.pause();
  Audio_.sfxComplete();
  Ambient.setMode('dusk');
  const total = STATE.stars;
  const maxTotal = CHAPTERS.length * 3;
  let verdict = 'Một mầm xanh đã vươn lên giữa tro tàn.';
  if (total >= maxTotal - 1) verdict = 'Ánh sáng của Người Gieo Hạt cháy rực rỡ hơn bao giờ hết.';
  else if (total <= maxTotal / 2) verdict = 'Hạt giống đã nảy mầm — mong manh, nhưng không gì dập tắt được.';

  await modal({
    kicker: 'HẾT QUYỂN I · KHÚC CA HY VỌNG',
    title: 'Những Hạt Giống Còn Sót Lại',
    text: `Gò Sen hồi sinh. Kaito trở về. Và trong ngăn cuối chiếc hòm gỗ gia truyền, một hạt giống lạ lẫm đang chờ một câu chuyện mới.\n\n${verdict}\n\nThành tích: ${total} / ${maxTotal} sao — hoàn thành trong ${Timer.fmt(STATE.totalSeconds - STATE.remaining)}.`,
    stars: null,
    actions: [{ label: 'Chơi lại từ đầu', value: true, primary: true }],
  });
  restartGame();
}

function restartGame() {
  STATE.remaining = STATE.totalSeconds;
  STATE.stars = 0;
  STATE.chapterIndex = -1;
  Timer.render();
  runChapter(0);
}

/* ============================================================
   BOOT
   ============================================================ */
function boot() {
  Ambient.start();
  el.muteBtn.addEventListener('click', () => Audio_.toggleMute());
  const unlockOnce = () => { Audio_.unlock(); window.removeEventListener('pointerdown', unlockOnce); };
  window.addEventListener('pointerdown', unlockOnce);
  renderPips();
  Timer.render();

  // Màn chào đầu game trước khi bắt đầu chương 1
  modal({
    kicker: 'QUYỂN I · THE SOWER\'S CYCLE',
    title: 'Khúc Ca Hy Vọng',
    text: 'Năm 2054, thế giới vỡ vụn thành ba mảnh chiến tranh. Giữa tro tàn của làng Gò Sen, một cô gái vẫn tin vào ánh sáng nơi những vì sao.\n\nBạn có 10 phút để đi cùng Mai — từ ao sen khô cằn đến Cánh Cổng tận cùng Nam Cực — và giữ cho ngọn lửa hy vọng ấy không tắt.',
    actions: [{ label: 'Bắt đầu hành trình', value: true, primary: true }],
  }).then(() => {
    Timer.start();
    runChapter(0);
  });
}

document.addEventListener('DOMContentLoaded', boot);
'use strict';
/* ============================================================
   CHƯƠNG I — GÒ SEN
   Thiết lập Mai, bà Lành, chiếc hòm hạt giống, ao sen khô cạn.
   Câu đố: "Sợi Chỉ Của Những Vì Sao" — một dãy 7 ngôi sao sáng
   lên theo độ sáng tăng dần theo QUY LUẬT ẩn (không phải random):
   mỗi ngôi sao có độ sáng = tổng 2 ngôi liền trước (kiểu Fibonacci
   thị giác), người chơi phải suy ra ngôi sao còn thiếu bằng cách
   đọc quy luật từ các ngôi đã có, rồi chọn đúng cường độ sáng
   trong 4 lựa chọn. 3 vòng, độ khó tăng dần thật sự (không lặp
   lại cùng 1 dạng bài).
   ============================================================ */

const Chapter1 = (() => {
  let starsEarned = 3;
  let mistakes = 0;

  // Mỗi round là một dãy số (độ sáng, thang 1..13) theo 1 quy luật.
  // Người chơi thấy dãy có 1 ô trống (dấu ?) và 4 đáp án.
  const ROUNDS = [
    {
      // Fibonacci-like: mỗi số = tổng 2 số trước
      seq: [1, 1, 2, 3, 5, null, 13],
      answer: 8,
      choices: [8, 9, 7, 10],
      rule: 'Mỗi vì sao cộng dồn ánh sáng của hai vì sao liền trước.',
    },
    {
      // Cấp số cộng bậc 2 (hiệu số tăng dần: +1,+2,+3,+4,+5)
      seq: [1, 2, 4, 7, 11, null],
      answer: 16,
      choices: [16, 15, 14, 18],
      rule: 'Khoảng cách giữa hai vì sao liền kề tăng dần: +1, +2, +3, +4, +5…',
    },
    {
      // Xen kẽ hai dãy: vị trí lẻ tăng dần đều, vị trí chẵn giảm dần đều
      seq: [2, 12, 4, 10, 6, null, 8],
      answer: 8,
      choices: [8, 6, 9, 7],
      rule: 'Có hai dòng ánh sáng xen kẽ nhau: một dòng lớn dần, một dòng nhỏ dần.',
    },
  ];

  function starPositions(count) {
    // toạ độ vòng cung nhẹ, giống chòm sao
    const pts = [];
    const w = 560, h = 150;
    for (let i = 0; i < count; i++) {
      const frac = i / (count - 1);
      const x = 30 + frac * (w - 60);
      const y = 70 + Math.sin(frac * Math.PI) * -46 + (i % 2 === 0 ? 6 : -6);
      pts.push({ x, y });
    }
    return pts;
  }

  function brightnessToRadius(v) {
    return 5 + (v / 18) * 10;
  }
  function brightnessToOpacity(v) {
    return 0.35 + (v / 18) * 0.65;
  }

  function renderConstellation(round, revealedGuess) {
    const pts = starPositions(round.seq.length);
    const missingIdx = round.seq.indexOf(null);
    let svg = `<svg viewBox="0 0 560 170" style="width:100%;max-width:560px;height:auto;overflow:visible">`;
    // connecting line
    svg += `<polyline points="${pts.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="rgba(232,197,118,.22)" stroke-width="1.5" stroke-dasharray="3 5"/>`;
    pts.forEach((p, i) => {
      const isMissing = i === missingIdx;
      const val = isMissing ? (revealedGuess ?? null) : round.seq[i];
      const r = val !== null ? brightnessToRadius(val) : 9;
      const op = val !== null ? brightnessToOpacity(val) : 0.9;
      if (isMissing && val === null) {
        svg += `<circle cx="${p.x}" cy="${p.y}" r="10" fill="none" stroke="var(--amber)" stroke-width="1.6" stroke-dasharray="2 4" opacity=".85">
          <animate attributeName="r" values="9;12;9" dur="1.8s" repeatCount="indefinite"/>
        </circle>`;
        svg += `<text x="${p.x}" y="${p.y + 4}" text-anchor="middle" font-size="11" fill="var(--amber)" font-family="Inter, sans-serif" font-weight="700">?</text>`;
      } else {
        const glowId = `sg${i}`;
        svg += `<circle cx="${p.x}" cy="${p.y}" r="${r * 2.1}" fill="rgba(246,226,173,${op * 0.14})"/>`;
        svg += `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="url(#starGrad)" opacity="${op}"/>`;
        if (isMissing) {
          svg += `<circle cx="${p.x}" cy="${p.y}" r="${r + 4}" fill="none" stroke="var(--ok)" stroke-width="1.5" opacity=".8"/>`;
        }
      }
    });
    svg += `<defs><radialGradient id="starGrad"><stop offset="0%" stop-color="#fff7e0"/><stop offset="60%" stop-color="#f6e2ad"/><stop offset="100%" stop-color="#c9973f"/></radialGradient></defs>`;
    svg += `</svg>`;
    return svg;
  }

  async function playRound(roundIndex) {
    const round = ROUNDS[roundIndex];
    let solved = false;
    let localMistakes = 0;

    const scene = mountScene(`
      <div class="card-frame">
        <div class="card-scroll">
          <div style="text-align:center;margin-bottom:6px">
            <div style="font-family:var(--font-display);font-size:19px;color:var(--gold-1);letter-spacing:.02em">
              Vòng ${roundIndex + 1} / 3 — Sợi Chỉ Của Những Vì Sao
            </div>
            <div style="font-size:13px;color:var(--paper-dim);margin-top:6px;line-height:1.5">
              Mai đang tìm quy luật ánh sáng còn thiếu giữa các vì sao. Hãy quan sát độ sáng của những ngôi đã hiện, rồi chọn ngôi sao đúng để lấp vào chỗ trống.
            </div>
          </div>
          <div id="constellationHost" style="display:flex;justify-content:center;margin:18px 0 10px"></div>
          <div id="ruleHint" style="text-align:center;font-size:12.5px;color:var(--paper-dim);min-height:18px;opacity:0;transition:opacity .4s"></div>
          <div id="choiceRow" style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:16px"></div>
          <div class="hint-row" id="attemptHint" style="margin-top:14px"></div>
        </div>
      </div>
    `);

    const host = $('constellationHost');
    const choiceRow = $('choiceRow');
    const ruleHint = $('ruleHint');
    const attemptHint = $('attemptHint');

    function draw(guess) {
      host.innerHTML = renderConstellation(round, guess);
    }
    draw(null);

    const shuffled = [...round.choices].sort(() => Math.random() - 0.5);
    shuffled.forEach((val) => {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.style.minWidth = '64px';
      btn.style.fontSize = '16px';
      btn.style.fontFamily = 'var(--font-display)';
      btn.textContent = val;
      btn.onclick = () => {
        if (solved) return;
        if (val === round.answer) {
          solved = true;
          Audio_.sfxCorrect();
          draw(val);
          btn.style.borderColor = 'var(--ok)';
          btn.style.background = 'rgba(143,227,166,.12)';
          toast('Đúng rồi — ánh sáng đã nối liền.', 'ok');
          Array.from(choiceRow.children).forEach(b => b.disabled = true);
          setTimeout(() => resolveFn(true), 700);
        } else {
          localMistakes++;
          mistakes++;
          Audio_.sfxWrong();
          btn.style.borderColor = 'var(--danger)';
          btn.style.background = 'rgba(255,92,92,.1)';
          setTimeout(() => { btn.style.borderColor = ''; btn.style.background = ''; }, 400);
          attemptHint.innerHTML = `<span class="k">gợi ý</span> ${round.rule}`;
          ruleHint.style.opacity = '1';
          toast('Chưa khớp quy luật — thử nhìn lại khoảng cách giữa các ngôi sao.', 'err');
        }
      };
      choiceRow.appendChild(btn);
    });

    let resolveFn;
    await new Promise((resolve) => { resolveFn = resolve; });
    if (localMistakes >= 2) starsEarned = Math.min(starsEarned, 2);
    if (localMistakes >= 4) starsEarned = Math.min(starsEarned, 1);
  }

  async function run() {
    await say('Mai', 'Ao sen đầu làng đã cạn khô ba mùa mưa rồi. Nhưng đêm nay trời quang, không còi báo động — con lại ra sân nhìn sao như bà vẫn hay kể.');
    await say('Bà Lành', '"Những dải sáng ấy là sợi chỉ dệt từ hy vọng, con ạ." Bà từng nói vậy. Mai chưa từng kể với ai, nhưng cô tin điều đó — không mù quáng, mà chắc chắn đến kỳ lạ.');
    await say('Mai', 'Càng nhìn lâu, con càng thấy các vì sao không sáng lên tuỳ tiện. Có một quy luật nào đó ẩn giữa chúng — như thể ai đó đã gieo chúng xuống bầu trời, từng hạt một, có tính toán.');

    for (let i = 0; i < ROUNDS.length; i++) {
      await playRound(i);
    }

    Audio_.sfxComplete();
    await say('Mai', 'Con đã nối được sợi chỉ ấy. Trong lồng ngực nhỏ bé của mình, một thứ ánh sáng bắt đầu cháy lên — âm thầm, nhưng không thể dập tắt.', [{ label: 'Tiếp tục', value: true, primary: true }]);

    await modal({
      kicker: 'PHẦN I · TRO TÀN CỦA THẾ GIỚI CŨ',
      title: 'Gò Sen — Hoàn Thành',
      text: mistakes === 0
        ? 'Mai đọc đúng quy luật ánh sáng ngay từ lần đầu tiên. Bà ngoại sẽ tự hào lắm.'
        : `Sau ${mistakes} lần dò thử, Mai cũng tìm ra sợi chỉ nối những vì sao. Con đường phía trước còn dài — nhưng đốm lửa đầu tiên đã cháy lên.`,
      stars: starsEarned,
      actions: [{ label: 'Rời làng Gò Sen', value: true, primary: true }],
    });
  }

  return { run: run, get starsEarned() { return starsEarned; } };
})();

CHAPTERS.push({
  key: 'gosen',
  eyebrow: 'PHẦN I',
  title: 'Gò Sen',
  ambient: 'dusk',
  run: Chapter1.run,
  get starsEarned() { return Chapter1.starsEarned; },
});
'use strict';
/* ============================================================
   CHƯƠNG II — VÔ ƯU CỔ TỰ
   Mai tìm thấy Kaito, gặp sư thầy Tịnh Không, giải Sấm Truyền
   Liên Hoa khắc trên phiến đá bát giác.

   CÂU ĐỐ: "Tám Cạnh Bát Giác" — suy luận loại trừ kiểu Zebra
   Puzzle thu nhỏ. "Ánh Sáng" đã khắc sẵn ở đỉnh cao nhất (neo
   cố định, không thể di chuyển — đúng với việc phiến đá là vật
   cổ đã có sẵn một phần). Người chơi xếp 7 biểu tượng còn lại
   vào 7 vị trí trống dựa trên 5 mệnh đề. Đã verify bằng
   brute-force: nghiệm DUY NHẤT, mỗi mệnh đề thu hẹp không gian
   nghiệm một cách có ý nghĩa (40320 → 5040 → 720 → 48 → 8 → 1).
   ============================================================ */

const Chapter2 = (() => {
  let starsEarned = 3;
  let wrongChecks = 0;

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

  // Nghiệm DUY NHẤT đã xác minh bằng brute-force (xem ghi chú thiết kế):
  // ['sang','hat','sen','gio','bong','nuoc','da','lua']  ứng với vị trí 0..7
  function opposite(i) { return (i + 4) % 8; }
  function neighbors(i) { return [(i + 7) % 8, (i + 1) % 8]; }
  function cwNeighbor(i) { return (i + 1) % 8; }

  const CLUES = [
    { text: 'Ánh Sáng luôn đối diện Bóng Tối qua tâm phiến đá.', need: ['sang', 'bong'], check: (pos) => opposite(pos.sang) === pos.bong },
    { text: 'Hạt Giống được khắc kề liền cả Ánh Sáng lẫn Hoa Sen.', need: ['hat', 'sang', 'sen'], check: (pos) => {
        const n = neighbors(pos.hat); return n.includes(pos.sang) && n.includes(pos.sen);
      } },
    { text: 'Lửa và Gió đối diện nhau — ngọn lửa không bao giờ thấy được cơn gió đã thổi bùng nó.', need: ['lua', 'gio'], check: (pos) => opposite(pos.lua) === pos.gio },
    { text: 'Đá được đặt giữa Nước và Lửa, kề liền cả hai phía.', need: ['da', 'nuoc', 'lua'], check: (pos) => {
        const n = neighbors(pos.da); return n.includes(pos.nuoc) && n.includes(pos.lua);
      } },
    { text: 'Hạt Giống nằm ngay sau Ánh Sáng, theo chiều kim đồng hồ.', need: ['sang', 'hat'], check: (pos) => cwNeighbor(pos.sang) === pos.hat },
  ];

  function checkAll(placementFull) {
    const pos = {};
    placementFull.forEach((id, i) => { if (id) pos[id] = i; });
    return CLUES.map((c, idx) => {
      const ready = c.need.every(id => pos[id] !== undefined);
      return { ok: ready ? c.check(pos) : null, idx };
    });
  }

  function octagonPoint(i, cx, cy, R) {
    const angle = (Math.PI * 2 * i) / 8 - Math.PI / 2;
    return { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) };
  }

  function render(placement) {
    const cx = 170, cy = 170, R = 118;
    let svg = `<svg viewBox="0 0 340 340" style="width:100%;max-width:300px;min-width:240px;height:auto;touch-action:manipulation">`;
    const pts8 = [];
    for (let i = 0; i < 8; i++) pts8.push(octagonPoint(i, cx, cy, R));
    svg += `<polygon points="${pts8.map(p => `${p.x},${p.y}`).join(' ')}" fill="rgba(232,197,118,.04)" stroke="rgba(232,197,118,.28)" stroke-width="1.5"/>`;
    svg += `<circle cx="${cx}" cy="${cy}" r="${R * 0.3}" fill="none" stroke="rgba(232,197,118,.16)" stroke-width="1"/>`;
    svg += `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="10" letter-spacing="2" fill="rgba(232,197,118,.4)" font-family="Inter">LIÊN HOA</text>`;
    for (let i = 0; i < 8; i++) {
      const p = octagonPoint(i, cx, cy, R);
      const filled = placement[i];
      const isAnchor = i === 0;
      svg += `<g class="slot-target" data-slot="${i}" style="cursor:${isAnchor ? 'default' : 'pointer'}">`;
      // Hitbox 40 đơn vị viewBox — đã tính toán để không chồng lấn giữa các slot liền kề
      // (khoảng cách tâm-tâm ~90 đơn vị) và vẫn đạt tối thiểu 44px thực ở min-width 240px.
      svg += `<circle cx="${p.x}" cy="${p.y}" r="40" fill="transparent" style="pointer-events:${isAnchor ? 'none' : 'all'}"/>`;
      svg += `<circle cx="${p.x}" cy="${p.y}" r="27" fill="${filled ? 'rgba(232,197,118,.16)' : 'rgba(255,255,255,.03)'}" stroke="${isAnchor ? 'var(--amber)' : `rgba(232,197,118,${filled ? '.5' : '.22'})`}" stroke-width="${isAnchor ? '2' : '1.5'}" style="pointer-events:none"/>`;
      if (filled) {
        const sym = SYMBOLS.find(s => s.id === filled);
        svg += `<text x="${p.x}" y="${p.y + 8}" text-anchor="middle" font-size="24" fill="var(--gold-0)" style="pointer-events:none">${sym.glyph}</text>`;
      }
      svg += `</g>`;
    }
    svg += `</svg>`;
    return svg;
  }

  async function run() {
    await say('Mai', 'Mười một ngày ở Vô Ưu Cổ Tự, đôi chân cô đã lành. Người lạ cô tìm thấy dưới vách đá — Kaito — cũng dần hồi tỉnh.');
    await say('Sư thầy Tịnh Không', 'Bốn mươi ba năm bần tăng nghiên cứu phiến đá này. Ánh Sáng đã khắc sẵn ở đỉnh cao nhất, hướng về nơi mặt trời mọc — không ai được phép dịch chuyển nó. Bảy biểu tượng còn lại, con phải tự tìm ra vị trí.');
    await say('Mai', 'Con không thể đoán bừa. Nhưng nếu lắng nghe từng lời sấm được truyền lại — từng mối liên hệ giữa các biểu tượng — thứ tự đúng sẽ tự hiện ra.');

    const scene = mountScene(`
      <div class="card-frame" id="ch2card">
        <div class="card-scroll">
          <div style="text-align:center;margin-bottom:14px">
            <div style="font-family:var(--font-display);font-size:19px;color:var(--gold-1)">Sấm Truyền Liên Hoa</div>
            <div style="font-size:13px;color:var(--paper-dim);margin-top:6px">Ánh Sáng đã cố định ở đỉnh. Xếp 7 biểu tượng còn lại dựa trên 5 lời sấm.</div>
          </div>
          <div style="display:flex;justify-content:center;margin-bottom:16px">
            <div id="octagonHost"></div>
          </div>
          <div style="max-width:420px;margin:0 auto">
            <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold-2);margin-bottom:8px;text-align:center">Lời Sấm</div>
            <ol id="clueList" style="margin:0 0 16px;padding-left:18px;font-size:13px;line-height:1.65;color:var(--paper-dim)"></ol>
          </div>
          <div style="width:100%">
            <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold-2);margin:0 0 10px;text-align:center">Biểu Tượng Còn Lại — chạm để chọn</div>
            <div id="symbolTray" style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center"></div>
          </div>
        </div>
        <div class="card-actions">
          <div class="scroll-hint"><svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Vuốt lên để xem thêm</div>
          <button class="btn btn-primary" id="checkBtn">Kiểm chứng lời sấm</button>
          <div class="hint-row" id="ch2hint" style="margin-top:10px;min-height:18px"></div>
        </div>
      </div>
    `);

    $('clueList').innerHTML = CLUES.map(c => `<li style="margin-bottom:7px">${c.text}</li>`).join('');

    let placement = new Array(8).fill(null);
    placement[0] = 'sang'; // neo cố định
    let selectedSymbol = null;

    const tray = $('symbolTray');
    function renderTray() {
      const used = new Set(placement.filter(Boolean));
      tray.innerHTML = '';
      MOVABLE.forEach(id => {
        const sym = SYMBOLS.find(s => s.id === id);
        const used_ = used.has(id);
        const chip = document.createElement('button');
        chip.className = 'btn';
        chip.style.padding = '12px 14px';
        chip.style.fontSize = '14px';
        chip.style.minHeight = '46px';
        chip.style.opacity = used_ ? '.32' : '1';
        chip.disabled = used_;
        chip.innerHTML = `<span style="font-size:16px;margin-right:6px">${sym.glyph}</span>${sym.name}`;
        chip.onclick = () => {
          selectedSymbol = id;
          Array.from(tray.children).forEach(c => c.style.outline = '');
          chip.style.outline = '2px solid var(--amber)';
          toast(`Đã chọn "${sym.name}" — chạm vào một vị trí trống trên bát giác.`);
        };
        tray.appendChild(chip);
      });
    }

    const host = $('octagonHost');
    function renderOctagon() {
      host.innerHTML = render(placement);
      host.querySelectorAll('.slot-target').forEach(g => {
        const slot = parseInt(g.getAttribute('data-slot'), 10);
        if (slot === 0) return; // neo cố định, không tương tác
        g.addEventListener('click', () => {
          if (placement[slot]) {
            placement[slot] = null;
            Audio_.sfxClick();
            renderOctagon();
            renderTray();
            return;
          }
          if (!selectedSymbol) {
            toast('Hãy chọn một biểu tượng trước.', 'err');
            return;
          }
          placement[slot] = selectedSymbol;
          selectedSymbol = null;
          Audio_.sfxClick();
          renderOctagon();
          renderTray();
        });
      });
    }

    renderOctagon();
    renderTray();

    let resolveFn;
    const donePromise = new Promise(r => resolveFn = r);

    $('checkBtn').addEventListener('click', () => {
      if (placement.some(p => !p)) {
        toast('Phiến đá vẫn còn vị trí trống.', 'err');
        return;
      }
      const results = checkAll(placement);
      const allOk = results.every(r => r.ok === true);
      const hintEl = $('ch2hint');
      if (allOk) {
        Audio_.sfxComplete();
        toast('Phiến đá rung lên — ánh sáng vàng lan toả khắp căn hầm.', 'ok');
        host.querySelectorAll('.slot-target circle').forEach(c => c.setAttribute('stroke', 'var(--ok)'));
        $('checkBtn').disabled = true;
        setTimeout(() => resolveFn(true), 900);
      } else {
        wrongChecks++;
        Audio_.sfxWrong();
        const failedIdx = results.filter(r => r.ok === false).map(r => r.idx + 1);
        hintEl.innerHTML = failedIdx.length
          ? `<span class="k">sai</span> Lời sấm số ${failedIdx.join(', ')} chưa khớp — hãy sắp xếp lại.`
          : `<span class="k">gần đúng</span> Hãy hoàn thiện phiến đá để kiểm chứng đầy đủ.`;
        toast('Chưa khớp với lời sấm — thử lại cách sắp xếp.', 'err');
      }
    });

    await donePromise;

    if (wrongChecks >= 4) starsEarned = 1;
    else if (wrongChecks >= 2) starsEarned = 2;

    await say('Sư thầy Tịnh Không', 'Con đã mở được cánh cửa, Mai à. Nhưng hãy nhớ: một khi đã bước qua, con sẽ không thể quay lại là chính mình như trước nữa.', [{ label: 'Bước qua', value: true, primary: true }]);
    await say('Kaito', '(giọng còn yếu) …Tôi thấy ánh sáng vàng đó. Từ trong cơn mê man, tôi đã thấy nó dẫn đường cho tôi tới đây.');

    await modal({
      kicker: 'PHẦN II · LỬA THỬ VÀNG',
      title: 'Vô Ưu Cổ Tự — Hoàn Thành',
      text: wrongChecks === 0
        ? 'Mai giải trọn vẹn Sấm Truyền Liên Hoa chỉ bằng suy luận thuần tuý — không một lần đoán sai.'
        : `Sau ${wrongChecks} lần thử sai, Mai cũng ráp đúng bảy biểu tượng còn lại. Cánh cửa đã hé mở.`,
      stars: starsEarned,
      actions: [{ label: 'Tiếp tục hành trình', value: true, primary: true }],
    });
  }

  return { run, get starsEarned() { return starsEarned; } };
})();

CHAPTERS.push({
  key: 'voutucotu',
  eyebrow: 'PHẦN II',
  title: 'Vô Ưu Cổ Tự',
  ambient: 'temple',
  run: Chapter2.run,
  get starsEarned() { return Chapter2.starsEarned; },
});
'use strict';
/* ============================================================
   CHƯƠNG III — LỜI THỀ NƠI CHIẾN HÀO BỎ HOANG
   Bốn người trẻ (Mai, Kaito, Sarah, Alex) phải bố trí đội hình
   phòng thủ dọc chiến hào để bảo vệ làng.

   CÂU ĐỐ: "Đội Hình Chiến Hào" — bài toán sắp xếp 4 người vào
   4 vị trí theo thứ tự tuyến tính (0 = gần cổng làng nhất,
   3 = xa nhất/đài canh), dựa trên 4 mệnh đề về khoảng cách và
   thứ tự. Đã verify bằng brute-force: 24 hoán vị → nghiệm DUY
   NHẤT sau 4 mệnh đề, mỗi mệnh đề thu hẹp có ý nghĩa
   (24 → 6 → 4 → 2 → 1). Khác cơ chế chương 2 (không phải vòng
   tròn mà là ràng buộc thứ tự + khoảng cách tuyệt đối).
   ============================================================ */

const Chapter3 = (() => {
  let starsEarned = 3;
  let wrongChecks = 0;

  const PEOPLE = [
    { id: 'mai',   name: 'Mai',   glyph: '✿', desc: 'Người Gieo Hạt' },
    { id: 'kaito', name: 'Kaito', glyph: '⚔', desc: 'Chiến binh phương xa' },
    { id: 'sarah', name: 'Sarah', glyph: '✚', desc: 'Y tá dã chiến' },
    { id: 'alex',  name: 'Alex',  glyph: '☗', desc: 'Kỹ sư radio' },
  ];

  const POST_LABELS = ['Cổng Làng', 'Ụ Chắn Trước', 'Trạm Sơ Cứu', 'Đài Canh Xa'];

  const CLUES = [
    { text: 'Alex luôn đứng ở Đài Canh Xa — anh cần khoảng cách để dò sóng radio.', need: ['alex'], check: (pos) => pos.alex === 3 },
    { text: 'Sarah luôn đứng ngay cạnh Kaito, để có thể sơ cứu anh tức khắc nếu trúng đạn.', need: ['sarah', 'kaito'], check: (pos) => Math.abs(pos.sarah - pos.kaito) === 1 },
    { text: 'Mai đứng gần cổng làng hơn Kaito — cô không cầm vũ khí, anh luôn chắn phía trước cô.', need: ['mai', 'kaito'], check: (pos) => pos.mai < pos.kaito },
    { text: 'Kaito đứng gần cổng làng hơn Sarah — anh xông lên trước, cô lùi lại phía sau để băng bó.', need: ['kaito', 'sarah'], check: (pos) => pos.kaito < pos.sarah },
  ];

  function checkAll(placement) {
    // placement: array length 4, placement[i] = person id ở vị trí i (0..3), hoặc null
    const pos = {};
    placement.forEach((id, i) => { if (id) pos[id] = i; });
    return CLUES.map((c, idx) => {
      const ready = c.need.every(id => pos[id] !== undefined);
      return { ok: ready ? c.check(pos) : null, idx };
    });
  }

  function render(placement, selected) {
    // Tính width động: 4 slot phải luôn nằm 1 hàng để giữ đúng ý nghĩa
    // "thứ tự tuyến tính dọc chiến hào" — wrap 2x2 sẽ làm mất trực quan
    // về khoảng cách/thứ tự vốn là cốt lõi của câu đố này.
    const vw = Math.min(window.innerWidth, 760);
    const gap = vw < 420 ? 6 : 10;
    const available = vw - 64; // trừ padding container ước lượng
    const slotW = Math.max(64, Math.min(120, Math.floor((available - gap * 3) / 4)));
    const minH = slotW < 90 ? 108 : 130;
    const compact = slotW < 90;

    let html = `<div style="display:flex;gap:${gap}px;justify-content:center;flex-wrap:nowrap;margin:6px 0 4px">`;
    for (let i = 0; i < 4; i++) {
      const occ = placement[i];
      const person = occ ? PEOPLE.find(p => p.id === occ) : null;
      html += `<div class="post-slot" data-post="${i}" style="
        width:${slotW}px;min-height:${minH}px;border-radius:14px;cursor:pointer;
        display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${compact ? 4 : 8}px;
        background:${person ? 'rgba(232,197,118,.1)' : 'rgba(255,255,255,.03)'};
        border:1.5px dashed ${person ? 'rgba(232,197,118,.4)' : 'rgba(232,197,118,.2)'};
        transition:all .2s;padding:${compact ? '8px 4px' : '12px 8px'};text-align:center;touch-action:manipulation;">
        <div style="font-size:${compact ? 8 : 10}px;letter-spacing:.08em;text-transform:uppercase;color:var(--gold-2)">${i === 0 ? '← gần làng' : i === 3 ? 'xa nhất →' : 'vị trí ' + (i+1)}</div>
        <div style="font-size:${compact ? 9 : 11}px;color:var(--paper-dim);margin-bottom:2px;line-height:1.2">${POST_LABELS[i]}</div>
        ${person
          ? `<div style="font-size:${compact ? 22 : 28}px">${person.glyph}</div><div style="font-family:var(--font-display);font-size:${compact ? 13 : 15}px;color:var(--gold-0)">${person.name}</div>`
          : `<div style="font-size:${compact ? 18 : 22}px;color:rgba(232,197,118,.3)">+</div>`
        }
      </div>`;
    }
    html += `</div>`;
    return html;
  }

  async function run() {
    await say('Mai', 'Bốn tháng sau đêm lời thề bên đống lửa tàn, thung lũng không còn yên bình. Nhóm kháng chiến báo tin: một cuộc tập kích sắp ập đến làng.');
    await say('Kaito', 'Chúng ta chỉ có bốn người và một đêm để chuẩn bị. Mỗi người phải đứng đúng vị trí — sai một bước, cả phòng tuyến sụp đổ.');
    await say('Sarah', 'Hãy nghĩ kỹ trước khi quyết định. Không phải ai cũng có thể đứng ở đâu tùy ý — vị trí của người này ràng buộc vị trí người kia.');

    const scene = mountScene(`
      <div class="card-frame">
        <div class="card-scroll">
          <div style="text-align:center;margin-bottom:10px">
            <div style="font-family:var(--font-display);font-size:19px;color:var(--gold-1)">Đội Hình Chiến Hào</div>
            <div style="font-size:13px;color:var(--paper-dim);margin-top:6px">Đặt 4 người vào 4 vị trí dọc chiến hào, thoả mãn toàn bộ mệnh lệnh bên dưới.</div>
          </div>
          <ol id="ch3clues" style="max-width:520px;margin:14px auto;padding-left:20px;font-size:13px;line-height:1.65;color:var(--paper-dim)"></ol>
          <div id="postHost"></div>
          <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold-2);margin:18px 0 8px;text-align:center">Đồng Đội</div>
          <div id="peopleTray" style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"></div>
        </div>
        <div class="card-actions">
          <div class="scroll-hint"><svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Vuốt lên để xem thêm</div>
          <button class="btn btn-primary" id="ch3check">Triển khai đội hình</button>
          <div class="hint-row" id="ch3hint" style="margin-top:10px;min-height:18px"></div>
        </div>
      </div>
    `);

    $('ch3clues').innerHTML = CLUES.map(c => `<li style="margin-bottom:7px">${c.text}</li>`).join('');

    let placement = new Array(4).fill(null);
    let selected = null;

    const postHost = $('postHost');
    const tray = $('peopleTray');

    function renderTray() {
      const used = new Set(placement.filter(Boolean));
      tray.innerHTML = '';
      PEOPLE.forEach(p => {
        const used_ = used.has(p.id);
        const chip = document.createElement('button');
        chip.className = 'btn';
        chip.style.padding = '13px 18px';
        chip.style.minHeight = '46px';
        chip.style.fontSize = '14px';
        chip.style.opacity = used_ ? '.32' : '1';
        chip.disabled = used_;
        chip.innerHTML = `<span style="font-size:16px;margin-right:6px">${p.glyph}</span>${p.name}`;
        chip.onclick = () => {
          selected = p.id;
          Array.from(tray.children).forEach(c => c.style.outline = '');
          chip.style.outline = '2px solid var(--amber)';
          toast(`Đã chọn "${p.name}" — chạm vào một vị trí trên chiến hào.`);
        };
        tray.appendChild(chip);
      });
    }

    function renderPosts() {
      postHost.innerHTML = render(placement);
      postHost.querySelectorAll('.post-slot').forEach(slotEl => {
        slotEl.addEventListener('click', () => {
          const i = parseInt(slotEl.getAttribute('data-post'), 10);
          if (placement[i]) {
            placement[i] = null;
            Audio_.sfxClick();
            renderPosts(); renderTray();
            return;
          }
          if (!selected) { toast('Hãy chọn một đồng đội trước.', 'err'); return; }
          placement[i] = selected;
          selected = null;
          Audio_.sfxClick();
          renderPosts(); renderTray();
        });
      });
    }

    renderPosts();
    renderTray();

    let resolveFn;
    const donePromise = new Promise(r => resolveFn = r);

    $('ch3check').addEventListener('click', () => {
      if (placement.some(p => !p)) { toast('Vẫn còn vị trí chưa có người trấn giữ.', 'err'); return; }
      const results = checkAll(placement);
      const allOk = results.every(r => r.ok === true);
      const hintEl = $('ch3hint');
      if (allOk) {
        Audio_.sfxComplete();
        toast('Đội hình hoàn hảo — phòng tuyến vững vàng.', 'ok');
        postHost.querySelectorAll('.post-slot').forEach(s => s.style.borderColor = 'var(--ok)');
        $('ch3check').disabled = true;
        setTimeout(() => resolveFn(true), 800);
      } else {
        wrongChecks++;
        Audio_.sfxWrong();
        const failedIdx = results.filter(r => r.ok === false).map(r => r.idx + 1);
        hintEl.innerHTML = failedIdx.length
          ? `<span class="k">sai</span> Mệnh lệnh số ${failedIdx.join(', ')} chưa được tuân thủ.`
          : `<span class="k">gần đúng</span> Hãy hoàn thiện đội hình để kiểm tra đầy đủ.`;
        toast('Đội hình còn sơ hở — thử sắp xếp lại.', 'err');
      }
    });

    await donePromise;

    if (wrongChecks >= 4) starsEarned = 1;
    else if (wrongChecks >= 2) starsEarned = 2;

    await say('Alex', 'Radio đã sẵn sàng. Nếu có động tĩnh, tôi sẽ là người đầu tiên biết.', [{ label: 'Giữ vững vị trí', value: true, primary: true }]);
    await say('Mai', 'Đêm ấy, trận đánh đến rồi đi trong khói lửa. Nhưng đội hình đứng vững — không một ai rời vị trí. Chúng tôi giữ được làng.');

    await modal({
      kicker: 'PHẦN III · TRO TÀN THỨ HAI',
      title: 'Chiến Hào Bỏ Hoang — Hoàn Thành',
      text: wrongChecks === 0
        ? 'Đội hình được triển khai hoàn hảo ngay từ lần đầu — không một sơ hở.'
        : `Sau ${wrongChecks} lần điều chỉnh, đội hình cuối cùng cũng vững vàng. Ngôi làng được giữ lại.`,
      stars: starsEarned,
      actions: [{ label: 'Tiếp tục hành trình', value: true, primary: true }],
    });
  }

  return { run, get starsEarned() { return starsEarned; } };
})();

CHAPTERS.push({
  key: 'chienhao',
  eyebrow: 'PHẦN III',
  title: 'Chiến Hào Bỏ Hoang',
  ambient: 'war',
  run: Chapter3.run,
  get starsEarned() { return Chapter3.starsEarned; },
});
'use strict';
/* ============================================================
   CHƯƠNG IV — BẦU TRỜI PHẢN BỘI (BIỂN NAM)
   Con tàu "Ánh Bình Minh" tiến vào vùng biển băng phía nam.
   La bàn quay vô nghĩa, tín hiệu nhiễu. Rồi Kaito biến mất.

   CÂU ĐỐ: "Định Vị Giữa Nhiễu Sóng" — lưới toạ độ 5×5 (cột A-E,
   hàng 1-5). Ba mốc neo đã biết trên hải đồ; ba mệnh đề khoảng
   cách/hướng dẫn đến đúng 1 ô duy nhất — nơi tín hiệu thật sự
   phát ra giữa hàng loạt nhiễu sóng giả. Đã verify bằng
   brute-force: 25 ô → nghiệm DUY NHẤT sau 3 mệnh đề
   (25 → 5 → 2 → 1), mỗi mệnh đề thu hẹp có ý nghĩa.
   ============================================================ */

const Chapter4 = (() => {
  let starsEarned = 3;
  let wrongChecks = 0;
  const COLS = ['A', 'B', 'C', 'D', 'E'];
  const TARGET = { col: 3, row: 1 }; // D2 — đã verify nghiệm duy nhất

  const ANCHORS = {
    iceberg: { col: 0, row: 0, label: 'Băng Trôi Bắc', glyph: '❄' },
    wreck:   { col: 4, row: 4, label: 'Xác Tàu Cũ', glyph: '⚓' },
  };

  function manhattan(a, b) { return Math.abs(a.col - b.col) + Math.abs(a.row - b.row); }
  function chebyshev(a, b) { return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row)); }

  const d1 = manhattan(TARGET, ANCHORS.iceberg); // 4
  const d2 = chebyshev(TARGET, ANCHORS.wreck);   // 3

  const CLUES = [
    { text: `Tín hiệu cách "Băng Trôi Bắc" đúng ${d1} ô theo đường thẳng ngang-dọc (không đi chéo).`, check: (p) => manhattan(p, ANCHORS.iceberg) === d1 },
    { text: `Tín hiệu nằm trong vòng vuông bán kính ${d2} ô quanh "Xác Tàu Cũ" (tính cả đường chéo).`, check: (p) => chebyshev(p, ANCHORS.wreck) === d2 },
    { text: `Tín hiệu lệch về phía Đông nhiều hơn phía Bắc — toạ độ cột lớn hơn toạ độ hàng.`, check: (p) => p.col > p.row },
  ];

  function gridHTML(selected, revealResult) {
    // Kích thước ô responsive: tính theo viewport thực tại thời điểm render,
    // đảm bảo luôn đạt tối thiểu 44px (chuẩn touch target), co giãn hợp lý
    // trên màn hình lớn hơn thay vì cố định 52px gây khó bấm trên máy nhỏ.
    const vw = window.innerWidth;
    const cell = vw < 380 ? 46 : vw < 640 ? 50 : 56;
    const labelCol = Math.round(cell * 0.5);
    const gap = vw < 380 ? 5 : 6;

    let html = `<div style="display:inline-grid;grid-template-columns:${labelCol}px repeat(5,${cell}px);grid-auto-rows:${cell}px;gap:${gap}px;margin:0 auto;touch-action:manipulation">`;
    html += `<div></div>`;
    COLS.forEach(c => { html += `<div style="display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--gold-2);letter-spacing:.06em">${c}</div>`; });
    for (let r = 0; r < 5; r++) {
      html += `<div style="display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--gold-2)">${r + 1}</div>`;
      for (let c = 0; c < 5; c++) {
        const isIceberg = ANCHORS.iceberg.col === c && ANCHORS.iceberg.row === r;
        const isWreck = ANCHORS.wreck.col === c && ANCHORS.wreck.row === r;
        const isSel = selected && selected.col === c && selected.row === r;
        let bg = 'rgba(255,255,255,.03)';
        let border = 'rgba(232,197,118,.16)';
        let content = '';
        if (isIceberg) { content = ANCHORS.iceberg.glyph; bg = 'rgba(79,214,196,.1)'; border = 'rgba(79,214,196,.4)'; }
        if (isWreck) { content = ANCHORS.wreck.glyph; bg = 'rgba(255,157,77,.1)'; border = 'rgba(255,157,77,.4)'; }
        if (isSel) { border = 'var(--amber)'; bg = 'rgba(255,157,77,.18)'; }
        if (revealResult && isSel) {
          bg = revealResult === 'ok' ? 'rgba(143,227,166,.22)' : 'rgba(255,92,92,.18)';
          border = revealResult === 'ok' ? 'var(--ok)' : 'var(--danger)';
        }
        html += `<div class="grid-cell" data-col="${c}" data-row="${r}" style="
          width:${cell}px;height:${cell}px;
          border-radius:8px;border:1.5px solid ${border};background:${bg};
          display:flex;align-items:center;justify-content:center;font-size:${cell > 48 ? 17 : 15}px;cursor:pointer;
          transition:all .15s;touch-action:manipulation;">${content}</div>`;
      }
    }
    html += `</div>`;
    return html;
  }

  async function run() {
    await say('Alex', '"Ánh Bình Minh" cắt qua sóng lặng lẽ. Nhưng ba ngày nay, la bàn cứ quay tròn vô nghĩa rồi mới chịu ổn định.');
    await say('Sáu Đen', 'Hệ thống liên lạc bắt được tín hiệu nhiễu kỳ lạ. Có một nguồn phát thật giữa hàng loạt nhiễu sóng giả — nhưng phải định vị chính xác.');
    await say('Mai', 'Nếu không tìm đúng toạ độ, con tàu sẽ lạc hướng giữa vùng biển băng này. Con phải đọc được ba manh mối trên hải đồ.');

    const scene = mountScene(`
      <div class="card-frame">
        <div class="card-scroll">
          <div style="text-align:center;margin-bottom:10px">
            <div style="font-family:var(--font-display);font-size:19px;color:var(--gold-1)">Định Vị Giữa Nhiễu Sóng</div>
            <div style="font-size:13px;color:var(--paper-dim);margin-top:6px">Chọn đúng 1 ô trên hải đồ khớp với cả ba manh mối bên dưới.</div>
          </div>
          <ol id="ch4clues" style="max-width:520px;margin:14px auto;padding-left:20px;font-size:13px;line-height:1.65;color:var(--paper-dim)"></ol>
          <div id="gridHost" style="display:flex;justify-content:center;margin:16px 0"></div>
          <div style="display:flex;justify-content:center;gap:18px;font-size:12px;color:var(--paper-dim);margin-bottom:6px">
            <span>❄ Băng Trôi Bắc</span><span>⚓ Xác Tàu Cũ</span>
          </div>
        </div>
        <div class="card-actions">
          <div class="scroll-hint"><svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Vuốt lên để xem thêm</div>
          <button class="btn btn-primary" id="ch4check" disabled>Xác nhận toạ độ</button>
          <div class="hint-row" id="ch4hint" style="margin-top:10px;min-height:18px"></div>
        </div>
      </div>
    `);

    $('ch4clues').innerHTML = CLUES.map(c => `<li style="margin-bottom:7px">${c.text}</li>`).join('');

    let selected = null;
    const gridHost = $('gridHost');
    function renderGrid(reveal) {
      gridHost.innerHTML = gridHTML(selected, reveal);
      if (!reveal) {
        gridHost.querySelectorAll('.grid-cell').forEach(cell => {
          cell.addEventListener('click', () => {
            const c = parseInt(cell.getAttribute('data-col'), 10);
            const r = parseInt(cell.getAttribute('data-row'), 10);
            if ((c === ANCHORS.iceberg.col && r === ANCHORS.iceberg.row) || (c === ANCHORS.wreck.col && r === ANCHORS.wreck.row)) return;
            selected = { col: c, row: r };
            Audio_.sfxClick();
            $('ch4check').disabled = false;
            renderGrid();
          });
        });
      }
    }
    renderGrid();

    let resolveFn;
    const donePromise = new Promise(r => resolveFn = r);

    $('ch4check').addEventListener('click', () => {
      if (!selected) return;
      const results = CLUES.map(c => c.check(selected));
      const allOk = results.every(Boolean);
      const hintEl = $('ch4hint');
      if (allOk) {
        Audio_.sfxComplete();
        renderGrid('ok');
        toast('Toạ độ chính xác — nguồn tín hiệu đã lộ diện.', 'ok');
        $('ch4check').disabled = true;
        setTimeout(() => resolveFn(true), 800);
      } else {
        wrongChecks++;
        Audio_.sfxWrong();
        renderGrid('err');
        const failedIdx = results.map((ok, i) => ok ? null : i + 1).filter(Boolean);
        hintEl.innerHTML = `<span class="k">sai</span> Manh mối số ${failedIdx.join(', ')} chưa khớp với ô đã chọn.`;
        toast('Sai toạ độ — sóng nhiễu vẫn còn dày đặc.', 'err');
        setTimeout(() => { selected = null; $('ch4check').disabled = true; renderGrid(); }, 900);
      }
    });

    await donePromise;

    if (wrongChecks >= 4) starsEarned = 1;
    else if (wrongChecks >= 2) starsEarned = 2;

    await say('Sáu Đen', 'Định vị chính xác! Nhưng... sóng đang mạnh dần lên bất thường.', [{ label: 'Tiếp tục', value: true, primary: true }]);
    await say('Mai', 'Đêm đó, bầu trời phía nam bùng lên thứ ánh sáng tím chưa từng thấy. Khi bão tan, boong tàu trống trải — không một dấu vết. "Kaito... anh đâu rồi?"');

    await modal({
      kicker: 'PHẦN IV · NHỮNG VẾT NỨT',
      title: 'Bầu Trời Phản Bội — Hoàn Thành',
      text: wrongChecks === 0
        ? 'Mai định vị chính xác nguồn tín hiệu ngay từ lần đầu. Nhưng không gì có thể chuẩn bị cho cô trước điều sắp xảy ra.'
        : `Sau ${wrongChecks} lần dò sai giữa nhiễu sóng, toạ độ cuối cùng cũng lộ diện — quá muộn để ngăn điều tồi tệ nhất.`,
      stars: starsEarned,
      actions: [{ label: 'Đến Cánh Cổng Nam Cực', value: true, primary: true }],
    });
  }

  return { run, get starsEarned() { return starsEarned; } };
})();

CHAPTERS.push({
  key: 'biennnam',
  eyebrow: 'PHẦN IV',
  title: 'Bầu Trời Phản Bội',
  ambient: 'sea',
  run: Chapter4.run,
  get starsEarned() { return Chapter4.starsEarned; },
});
'use strict';
/* ============================================================
   CHƯƠNG V — CÁNH CỔNG NAM CỰC
   Mai, Sarah, Alex cùng Hùng tiếp cận Cánh Cổng nguyên thủy để
   giải cứu Kaito khỏi Vùng Ngưỡng.

   CÂU ĐỐ: "Ba Trụ Nạp" — hệ 3 phương trình tuyến tính trên miền
   nguyên 1..9, giải bằng suy luận đại số thuần tuý (không phải
   dò). Đã verify: 729 tổ hợp → nghiệm DUY NHẤT sau 3 mệnh đề
   (729 → 52 → 4 → 1). Giao diện dùng slider thời gian thực với
   phản hồi trực quan (cột ánh sáng dâng theo giá trị), tạo cảm
   giác "đồng bộ tần số" kiểu cơ chế event Genshin, nhưng lời
   giải vẫn đòi hỏi suy luận toán học rõ ràng, không phải dò mù.
   ============================================================ */

const Chapter5 = (() => {
  let starsEarned = 3;
  let wrongChecks = 0;
  const ANSWER = [1, 4, 7]; // đã verify duy nhất
  const LABELS = ['Trụ Trái', 'Trụ Giữa', 'Trụ Phải'];

  const CLUES = [
    'Tổng ánh sáng của ba trụ phải đúng bằng 12 — con số của những tháng đã chờ đợi.',
    'Trụ Giữa phải sáng hơn Trụ Trái đúng 3 bậc.',
    'Trụ Phải bằng hai lần Trụ Giữa, trừ đi Trụ Trái.',
  ];

  function pillarSVG(idx, value) {
    const pct = value / 9;
    const h = 140;
    const fillH = h * pct;
    return `<svg viewBox="0 0 60 170" style="width:60px;height:170px">
      <rect x="18" y="10" width="24" height="${h}" rx="10" fill="rgba(255,255,255,.04)" stroke="rgba(232,197,118,.25)" stroke-width="1.5"/>
      <rect x="18" y="${10 + h - fillH}" width="24" height="${fillH}" rx="10" fill="url(#pillarGrad${idx})"/>
      <circle cx="30" cy="${10 + h - fillH}" r="5" fill="#fff7e0" opacity=".9">
        <animate attributeName="r" values="4;6;4" dur="1.4s" repeatCount="indefinite"/>
      </circle>
      <text x="30" y="150" text-anchor="middle" font-size="15" fill="var(--gold-0)" font-family="Cormorant Garamond, serif" font-weight="600">${value}</text>
      <defs><linearGradient id="pillarGrad${idx}" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="#c9973f"/><stop offset="100%" stop-color="#fff7e0"/>
      </linearGradient></defs>
    </svg>`;
  }

  async function run() {
    await say('Hùng', 'Bốn giờ sáng, lạnh cắt da. Đây rồi — Cánh Cổng nguyên thủy. Ba trụ nạp năng lượng bao quanh nó, im lìm chờ đợi.');
    await say('Sarah', 'Nếu chỉnh sai tần số, cả hệ thống sẽ sập — và cánh cổng sẽ đóng lại vĩnh viễn. Mai, con phải tính chính xác.');
    await say('Mai', 'Con cảm nhận được nó — một nhịp tim quen thuộc vọng ra từ phía sau cánh cổng. Kaito. Con sẽ không để tần số sai lệch dù chỉ một bậc.');

    const scene = mountScene(`
      <div class="card-frame">
        <div class="card-scroll">
          <div style="text-align:center;margin-bottom:10px">
            <div style="font-family:var(--font-display);font-size:19px;color:var(--gold-1)">Ba Trụ Nạp</div>
            <div style="font-size:13px;color:var(--paper-dim);margin-top:6px">Chỉnh tần số ba trụ (1–9) để thoả cả ba lời sấm bên dưới.</div>
          </div>
          <ol id="ch5clues" style="max-width:480px;margin:14px auto;padding-left:20px;font-size:13px;line-height:1.65;color:var(--paper-dim)"></ol>
          <div style="display:flex;justify-content:center;gap:18px;margin:22px 0 12px;flex-wrap:wrap">
            ${[0, 1, 2].map(i => `
              <div style="display:flex;flex-direction:column;align-items:center;gap:10px">
                <button class="pillar-btn" data-i="${i}" data-dir="1" aria-label="Tăng ${LABELS[i]}" style="
                  width:44px;height:44px;border-radius:10px;border:1px solid var(--line-strong);
                  background:rgba(232,197,118,.08);color:var(--gold-1);font-size:20px;font-weight:700;
                  cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;">+</button>
                <div id="pillarHost${i}"></div>
                <button class="pillar-btn" data-i="${i}" data-dir="-1" aria-label="Giảm ${LABELS[i]}" style="
                  width:44px;height:44px;border-radius:10px;border:1px solid var(--line-strong);
                  background:rgba(232,197,118,.08);color:var(--gold-1);font-size:20px;font-weight:700;
                  cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;">−</button>
                <div style="font-size:11px;color:var(--paper-dim);letter-spacing:.04em;text-align:center">${LABELS[i]}</div>
              </div>
            `).join('')}
          </div>
          <div style="text-align:center;font-size:13px;color:var(--paper-dim);margin-top:4px">
            Tổng hiện tại: <b id="sumDisplay" style="color:var(--gold-1)">15</b> / cần <b>12</b>
          </div>
        </div>
        <div class="card-actions">
          <div class="scroll-hint"><svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Vuốt lên để xem thêm</div>
          <button class="btn btn-primary" id="ch5check">Đồng bộ trụ nạp</button>
          <div class="hint-row" id="ch5hint" style="margin-top:10px;min-height:18px"></div>
        </div>
      </div>
    `);

    $('ch5clues').innerHTML = CLUES.map(c => `<li style="margin-bottom:7px">${c}</li>`).join('');

    let values = [5, 5, 5];
    function renderPillars() {
      for (let i = 0; i < 3; i++) {
        $(`pillarHost${i}`).innerHTML = pillarSVG(i, values[i]);
      }
      $('sumDisplay').textContent = values.reduce((a, b) => a + b, 0);
    }
    renderPillars();

    scene.querySelectorAll('.pillar-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.getAttribute('data-i'), 10);
        const dir = parseInt(btn.getAttribute('data-dir'), 10);
        values[i] = Math.max(1, Math.min(9, values[i] + dir));
        renderPillars();
        Audio_.sfxTick();
      });
    });

    let resolveFn;
    const donePromise = new Promise(r => resolveFn = r);

    $('ch5check').addEventListener('click', () => {
      const sum = values[0] + values[1] + values[2];
      const c1 = sum === 12;
      const c2 = (values[1] - values[0]) === 3;
      const c3 = values[2] === (2 * values[1] - values[0]);
      const allOk = c1 && c2 && c3;
      const hintEl = $('ch5hint');
      if (allOk) {
        Audio_.sfxComplete();
        toast('Ba trụ đồng bộ hoàn hảo — Cánh Cổng rung chuyển!', 'ok');
        $('ch5check').disabled = true;
        setTimeout(() => resolveFn(true), 900);
      } else {
        wrongChecks++;
        Audio_.sfxWrong();
        const fails = [];
        if (!c1) fails.push(1);
        if (!c2) fails.push(2);
        if (!c3) fails.push(3);
        hintEl.innerHTML = `<span class="k">sai</span> Lời sấm số ${fails.join(', ')} chưa khớp — thử tính lại.`;
        toast('Tần số chưa khớp — Cánh Cổng vẫn im lìm.', 'err');
      }
    });

    await donePromise;

    if (wrongChecks >= 4) starsEarned = 1;
    else if (wrongChecks >= 2) starsEarned = 2;

    Ambient.setMode('pole');
    await say('Mai', 'Ánh sáng tím bùng lên từ tâm Cánh Cổng — mạnh mẽ hơn bất cứ điều gì cô từng thấy. Một tiếng gọi yếu ớt nhưng chắc chắn vọng đến. "Mai..."', [{ label: 'KAITO!', value: true, primary: true }]);
    await say('Mai', 'Không chút do dự, cô lao thẳng về phía ánh sáng — biến mất khỏi tầm mắt kinh hoàng của tất cả.');
    await say('Kaito', 'Trong khoảnh khắc chuyển tiếp không thể mô tả, Mai tìm thấy anh — run rẩy nhưng còn sống — giữa Vùng Ngưỡng. Cô nắm lấy tay anh, và cả hai cùng bước ngược về ánh sáng.');

    await modal({
      kicker: 'PHẦN V · TRỞ VỀ',
      title: 'Cánh Cổng Nam Cực — Hoàn Thành',
      text: wrongChecks === 0
        ? 'Mai tính đúng tần số ba trụ chỉ trong một lần thử — như thể chính trái tim cô đã biết trước đáp án.'
        : `Sau ${wrongChecks} lần đồng bộ thất bại, ba trụ cuối cùng cũng cộng hưởng đúng nhịp. Kaito đã trở về.`,
      stars: starsEarned,
      actions: [{ label: 'Trở về Gò Sen', value: true, primary: true }],
    });
  }

  return { run, get starsEarned() { return starsEarned; } };
})();

CHAPTERS.push({
  key: 'canhcong',
  eyebrow: 'PHẦN V',
  title: 'Cánh Cổng Nam Cực',
  ambient: 'pole',
  run: Chapter5.run,
  get starsEarned() { return Chapter5.starsEarned; },
});
