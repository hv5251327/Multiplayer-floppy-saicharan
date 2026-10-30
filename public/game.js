// ============================================================
// Multiplayer Flappy Bird - Client Engine v2
// Fixed: vel-based rotation, other-player transparency, pipe glitch
// ============================================================

const socket = io();

// ── DOM References ──────────────────────────────────────────
const joinScreen    = document.getElementById('join-screen');
const gameScreen    = document.getElementById('game-screen');
const nameInput     = document.getElementById('name-input');
const joinBtn       = document.getElementById('join-btn');
const onlineCountEl = document.getElementById('online-count');
const hudOnlineEl   = document.getElementById('hud-online');
const myScoreEl     = document.getElementById('my-score');
const playerListEl  = document.getElementById('player-list');
const muteBtn       = document.getElementById('mute-btn');
const canvas        = document.getElementById('game-canvas');
const ctx           = canvas.getContext('2d');
const countdownOvr  = document.getElementById('countdown-overlay');
const countdownNum  = document.getElementById('countdown-number');
const waitingOvr    = document.getElementById('waiting-overlay');
const roundoverOvr  = document.getElementById('roundover-overlay');
const leaderboardEl = document.getElementById('leaderboard');

// ── Audio ───────────────────────────────────────────────────
const bgmAudio  = document.getElementById('audio-bgm');
const goAudio   = document.getElementById('audio-gameover');
let isMuted     = false;
let audioReady  = false;

function unlockAudio() {
  if (audioReady) return;
  audioReady = true;
  bgmAudio.volume = 0.8;
  bgmAudio.play().catch(() => {});
}

function playGameoverSound() {
  if (isMuted) return;
  bgmAudio.pause();
  goAudio.currentTime = 0;
  goAudio.play().catch(() => {});
}

function resumeBGM() {
  if (isMuted || !audioReady) return;
  goAudio.pause();
  bgmAudio.currentTime = 0;
  bgmAudio.play().catch(() => {});
}

muteBtn.addEventListener('click', e => {
  e.stopPropagation();
  isMuted = !isMuted;
  if (isMuted) {
    bgmAudio.pause(); goAudio.pause();
    muteBtn.textContent = '🔇';
    muteBtn.classList.add('muted');
  } else {
    bgmAudio.play().catch(() => {});
    muteBtn.textContent = '🎵';
    muteBtn.classList.remove('muted');
  }
});

// ── Canvas Sizing ───────────────────────────────────────────
const CW = 360;   // fixed logical width
let CH   = 640;   // dynamic logical height
let GY   = 550;   // ground Y

function resizeCanvas() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  CH = Math.max(580, Math.min(820, Math.round(CW * vh / vw)));
  GY = CH - 90;
  canvas.width  = CW;
  canvas.height = CH;
  const s = Math.min(vw / CW, vh / CH);
  canvas.style.width  = Math.round(CW * s) + 'px';
  canvas.style.height = Math.round(CH * s) + 'px';
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ── Assets ──────────────────────────────────────────────────
const faceImg = new Image();
faceImg.src   = 'assets/player.png';
const pipeImg = new Image();
pipeImg.src   = 'assets/nivea.png';

// ── Game State ───────────────────────────────────────────────
let myId      = null;
let myName    = '';
let gameState = 'lobby';

// Server-synced state
let pipes     = [];   // [{x, top}]
let players   = {};   // {id: {id, name, y, vel, alive, score, color}}

let frames    = 0;
let groundX   = 0;
let loopRunning = false;

// Stars (static, generated once)
const stars = Array.from({ length: 48 }, () => ({
  x: Math.random() * CW,
  y: Math.random() * 450,
  r: Math.random() * 1.8 + 0.5,
  a: Math.random() * 0.7 + 0.3,
  speed: Math.random() * 0.03 + 0.01
}));

// ── Socket Events ────────────────────────────────────────────
socket.on('connect', () => { myId = socket.id; });

socket.on('init', ({ gameState: gs, playerCount, existingPlayers }) => {
  gameState = gs;
  updateOnlineCount(playerCount);
  existingPlayers.forEach(p => {
    players[p.id] = { id: p.id, name: p.name, color: p.color, y: 250, vel: 0, alive: true, score: 0 };
  });
  updatePlayerListUI();
});

socket.on('playerJoined', ({ id, name, color, playerCount }) => {
  updateOnlineCount(playerCount);
  if (!players[id]) {
    players[id] = { id, name, color, y: 250, vel: 0, alive: true, score: 0 };
  }
  updatePlayerListUI();
});

socket.on('playerLeft', ({ id, playerCount }) => {
  updateOnlineCount(playerCount);
  delete players[id];
  updatePlayerListUI();
});

socket.on('countdown', ({ count }) => {
  gameState = 'countdown';
  showOvr(countdownOvr);
  hideOvr(waitingOvr);
  hideOvr(roundoverOvr);
  countdownNum.textContent = count;
  // Retrigger animation
  countdownNum.style.animation = 'none';
  void countdownNum.offsetWidth;
  countdownNum.style.animation = 'countPop 1s ease-out';
  resumeBGM();
});

socket.on('gameState', ({ state }) => {
  gameState = state;
  if (state === 'playing') {
    hideOvr(countdownOvr);
    hideOvr(waitingOvr);
    hideOvr(roundoverOvr);
  } else if (state === 'lobby') {
    hideOvr(countdownOvr);
    showOvr(waitingOvr);
  }
});

socket.on('tick', ({ pipes: sp, players: sp2 }) => {
  pipes = sp;  // [{x, top}]

  sp2.forEach(p => {
    if (!players[p.id]) {
      players[p.id] = { ...p };
    } else {
      // Smoothly merge server update (lerp y, direct vel)
      const cur = players[p.id];
      cur.y     = p.y;   // trust server position
      cur.vel   = p.vel !== undefined ? p.vel : cur.vel;
      cur.alive = p.alive;
      cur.score = p.score;
      cur.color = p.color;
    }
  });

  const me = players[myId];
  if (me) myScoreEl.textContent = me.score;

  updatePlayerListUI();
});

socket.on('playerDied', ({ id }) => {
  if (players[id]) players[id].alive = false;
  if (id === myId) {
    playGameoverSound();
    showOvr(waitingOvr);
  }
  updatePlayerListUI();
});

socket.on('joinedMidGame', ({ pipes: sp, players: sp2 }) => {
  pipes = sp;
  sp2.forEach(p => { players[p.id] = p; });
  if (players[myId]) players[myId].alive = false;
  showOvr(waitingOvr);
});

socket.on('roundOver', ({ leaderboard }) => {
  gameState = 'roundover';
  hideOvr(countdownOvr);
  hideOvr(waitingOvr);
  showOvr(roundoverOvr);
  renderLeaderboard(leaderboard);
  const me = players[myId];
  if (!me || !me.alive) playGameoverSound();
});

// ── UI Helpers ────────────────────────────────────────────────
function showOvr(el) { el.classList.remove('hidden'); }
function hideOvr(el) { el.classList.add('hidden');    }
function updateOnlineCount(n) {
  onlineCountEl.textContent = n;
  hudOnlineEl.textContent   = n;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderLeaderboard(lb) {
  const medals = ['🥇','🥈','🥉'];
  leaderboardEl.innerHTML = lb.slice(0, 6).map((p, i) => `
    <div class="lb-row">
      <div class="lb-rank">${medals[i] || (i + 1)}</div>
      <div class="lb-dot" style="background:${p.color}"></div>
      <div class="lb-name">${escHtml(p.name)}${p.id === myId ? ' <span style="color:#facc15;font-size:10px;">(You)</span>' : ''}</div>
      <div class="lb-score">${p.score}</div>
    </div>`).join('');
}

function updatePlayerListUI() {
  playerListEl.innerHTML = Object.values(players).map(p => `
    <div class="player-row ${p.alive ? '' : 'dead'} ${p.id === myId ? 'me' : ''}">
      <div class="player-dot" style="background:${p.color}"></div>
      <div class="player-name-label">${escHtml(p.name)}</div>
      <div class="player-score-badge">${p.score}</div>
    </div>`).join('');
}

// ── Join Game ────────────────────────────────────────────────
function joinGame() {
  const name = nameInput.value.trim() || 'Player';
  myName = name;
  unlockAudio();
  joinScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  resizeCanvas();
  socket.emit('join', { name });
  if (!loopRunning) {
    loopRunning = true;
    requestAnimationFrame(renderLoop);
  }
}

joinBtn.addEventListener('click', joinGame);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinGame(); });

// ── Flap Input ──────────────────────────────────────────────
function doFlap() {
  unlockAudio();
  if (gameState === 'playing') {
    const me = players[myId];
    if (me && me.alive) {
      me.vel = -4.6; // Instant optimistic local response
    }
    socket.emit('flap');
  }
}

// Tap anywhere on game screen or canvas
gameScreen.addEventListener('pointerdown', e => {
  if (e.target.closest('#mute-btn')) return;
  e.preventDefault();
  doFlap();
});
canvas.addEventListener('touchstart', e => {
  if (e.cancelable) e.preventDefault();
  doFlap();
}, { passive: false });
window.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); doFlap(); }
});

// ── Render Helpers ───────────────────────────────────────────
const PIPE_W       = 56;
const GAP          = 185;
const BOTTLE_H     = 135; // natural Nivea bottle height in pixels

function drawBackground() {
  // Night sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, GY);
  sky.addColorStop(0,    '#030712');
  sky.addColorStop(0.45, '#090d16');
  sky.addColorStop(0.78, '#0f172a');
  sky.addColorStop(1,    '#1e1b4b');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CW, GY);

  // Twinkling stars
  stars.forEach(s => {
    s.a = Math.max(0.15, Math.min(1, s.a + Math.sin(frames * s.speed) * 0.015));
    ctx.save();
    ctx.globalAlpha = s.a;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // City skyline silhouettes
  ctx.fillStyle = 'rgba(15,23,42,0.6)';
  [[15,58,34],[60,88,44],[115,70,38],[165,106,50],[225,80,40],[275,116,54],[338,66,34]]
    .forEach(([x, h, w]) => ctx.fillRect(x, GY - h, w, h));

  // Ground
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, GY, CW, CH - GY);
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(0, GY, CW, 4);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, GY + 4, CW, 14);

  // Diagonal ground stripes
  ctx.strokeStyle = '#172033';
  ctx.lineWidth = 3;
  for (let x = groundX - 30; x < CW + 30; x += 20) {
    ctx.beginPath();
    ctx.moveTo(x, GY + 18);
    ctx.lineTo(x - 12, CH);
    ctx.stroke();
  }
}

function drawPipes() {
  pipes.forEach(p => {
    const bottomY = p.top + GAP;
    const bottomH = GY - bottomY;

    // ── Top bottle (inverted – roller ball faces DOWN into gap) ──
    ctx.save();
    const topBH = Math.min(p.top, BOTTLE_H);
    // Dark rod for ceiling gap above bottle
    if (p.top > BOTTLE_H) {
      ctx.fillStyle = '#090d16';
      ctx.fillRect(p.x + 10, 0, PIPE_W - 20, p.top - BOTTLE_H);
    }
    // Draw bottle inverted: translate to bottom-right corner of bottle, flip
    ctx.translate(p.x + PIPE_W, p.top);
    ctx.scale(-1, -1);
    if (pipeImg.complete && pipeImg.naturalWidth > 0) {
      ctx.drawImage(pipeImg, 0, 0, PIPE_W, topBH);
    } else {
      ctx.fillStyle = '#1e3a8a';
      ctx.fillRect(0, 0, PIPE_W, topBH);
    }
    ctx.restore();

    // ── Bottom bottle (upright – roller ball faces UP into gap) ──
    ctx.save();
    const botBH = Math.min(bottomH, BOTTLE_H);
    if (pipeImg.complete && pipeImg.naturalWidth > 0) {
      ctx.drawImage(pipeImg, p.x, bottomY, PIPE_W, botBH);
    } else {
      ctx.fillStyle = '#1e3a8a';
      ctx.fillRect(p.x, bottomY, PIPE_W, bottomH);
    }
    // Dark rod below bottle if it doesn't reach ground
    if (bottomH > BOTTLE_H) {
      ctx.fillStyle = '#090d16';
      ctx.fillRect(p.x + 10, bottomY + BOTTLE_H, PIPE_W - 20, bottomH - BOTTLE_H);
    }
    ctx.restore();
  });
}

const FACE_W = 40;
const FACE_H = 54;
const BIRD_X = 90; // All birds share same X (server authoritative)

function drawPlayers() {
  const all = Object.values(players);

  // Sort so your own bird is rendered last (on top of others)
  all.sort((a, b) => (a.id === myId ? 1 : 0) - (b.id === myId ? 1 : 0));

  all.forEach(p => {
    if (!p.alive) return;

    const isMe = p.id === myId;

    // Velocity-based tilt rotation (uses server-sent vel)
    const vel = p.vel || 0;
    let rot = vel < 0
      ? Math.max(-0.35, vel * 0.06)
      : Math.min(Math.PI / 2.8, (vel - 2) * 0.08);

    ctx.save();
    ctx.translate(BIRD_X, p.y);
    ctx.rotate(rot);

    // ── Other players: 82% opacity so they are clearly visible (less transparent) ──
    ctx.globalAlpha = isMe ? 1.0 : 0.82;

    // Coloured glow halo
    ctx.shadowColor = p.color;
    ctx.shadowBlur  = isMe ? 18 : 12;

    if (faceImg.complete && faceImg.naturalWidth > 0) {
      ctx.drawImage(faceImg, -FACE_W / 2, -FACE_H / 2, FACE_W, FACE_H);
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur  = 0;

    // ── Name tag below bird ──
    ctx.globalAlpha = isMe ? 1.0 : 0.90;
    const label = isMe ? `👤 ${p.name}` : p.name;
    ctx.font = `700 10px Outfit, sans-serif`;
    const tw  = ctx.measureText(label).width + 14;
    const ty  = FACE_H / 2 + 4;

    ctx.fillStyle = isMe ? '#2563eb' : '#1e293b';
    roundRect(ctx, -tw / 2, ty, tw, 17, 5);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, ty + 8.5);

    // ── Score bubble above bird ──
    const bubbleR = isMe ? 13 : 10;
    const bubbleY = -FACE_H / 2 - 13;
    ctx.globalAlpha = isMe ? 1.0 : 0.85;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(0, bubbleY, bubbleR, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = isMe ? '800 10px Outfit, sans-serif' : '700 9px Outfit, sans-serif';
    ctx.fillStyle = '#000';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.score, 0, bubbleY);

    ctx.restore();
  });
}

// Utility: draw rounded rectangle
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

// ── Main Render Loop ─────────────────────────────────────────
function renderLoop() {
  ctx.clearRect(0, 0, CW, CH);

  if (gameState !== 'lobby') {
    groundX = (groundX - 1.65) % 24;
  }

  drawBackground();

  if (gameState === 'playing' || gameState === 'roundover') {
    drawPipes();
  }

  drawPlayers();

  frames++;
  requestAnimationFrame(renderLoop);
}
