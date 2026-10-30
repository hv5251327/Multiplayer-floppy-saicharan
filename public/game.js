// ============================================================
// Multiplayer Flappy Bird - Client Engine
// Real-time canvas rendering + Socket.IO comms
// ============================================================

const socket = io();

// ── DOM References ──────────────────────────────────────────
const joinScreen      = document.getElementById('join-screen');
const gameScreen      = document.getElementById('game-screen');
const nameInput       = document.getElementById('name-input');
const joinBtn         = document.getElementById('join-btn');
const onlineCountEl   = document.getElementById('online-count');
const hudOnlineEl     = document.getElementById('hud-online');
const myScoreEl       = document.getElementById('my-score');
const playerListEl    = document.getElementById('player-list');
const muteBtn         = document.getElementById('mute-btn');
const canvas          = document.getElementById('game-canvas');
const ctx             = canvas.getContext('2d');
const countdownOvr    = document.getElementById('countdown-overlay');
const countdownNum    = document.getElementById('countdown-number');
const waitingOvr      = document.getElementById('waiting-overlay');
const roundoverOvr    = document.getElementById('roundover-overlay');
const leaderboardEl   = document.getElementById('leaderboard');

// ── Audio ───────────────────────────────────────────────────
const bgmAudio  = document.getElementById('audio-bgm');
const goAudio   = document.getElementById('audio-gameover');
let isMuted     = false;
let audioUnlocked = false;

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  bgmAudio.volume = 0.8;
  bgmAudio.play().catch(() => {});
}

function playGameover() {
  if (isMuted) return;
  bgmAudio.pause();
  goAudio.currentTime = 0;
  goAudio.play().catch(() => {});
}

function resumeBGM() {
  if (isMuted || !audioUnlocked) return;
  goAudio.pause();
  bgmAudio.currentTime = 0;
  bgmAudio.play().catch(() => {});
}

muteBtn.addEventListener('click', (e) => {
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
const CANVAS_WIDTH  = 360;
let CANVAS_HEIGHT   = 640;
let GROUND_Y        = 550;
let scale           = 1;

function resizeCanvas() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  CANVAS_HEIGHT = Math.round(CANVAS_WIDTH * (vh / vw));
  CANVAS_HEIGHT = Math.max(580, Math.min(820, CANVAS_HEIGHT));
  GROUND_Y = CANVAS_HEIGHT - 90;
  canvas.width  = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  scale = Math.min(vw / CANVAS_WIDTH, vh / CANVAS_HEIGHT);
  canvas.style.width  = Math.round(CANVAS_WIDTH  * scale) + 'px';
  canvas.style.height = Math.round(CANVAS_HEIGHT * scale) + 'px';
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ── Assets ──────────────────────────────────────────────────
const faceImg = new Image(); faceImg.src = 'assets/player.png';
const pipeImg = new Image(); pipeImg.src = 'assets/nivea.png';

// ── Game State ───────────────────────────────────────────────
let myId        = socket.id;
let myName      = '';
let gameState   = 'lobby';
let serverPipes = [];
let serverPlayers = {};  // id -> { id, name, y, alive, score, color }
let myAlive     = true;
let stars       = [];
let frames      = 0;
let groundX     = 0;

// Generate stars once
for (let i = 0; i < 48; i++) {
  stars.push({
    x: Math.random() * 360,
    y: Math.random() * 450,
    r: Math.random() * 1.8 + 0.5,
    a: Math.random() * 0.7 + 0.3,
    s: Math.random() * 0.03 + 0.01
  });
}

// ── Socket Events ────────────────────────────────────────────
socket.on('connect', () => {
  myId = socket.id;
});

socket.on('init', ({ gameState: gs, playerCount }) => {
  gameState = gs;
  onlineCountEl.textContent = playerCount;
  hudOnlineEl.textContent = playerCount;
});

socket.on('playerJoined', ({ id, name, color, playerCount }) => {
  onlineCountEl.textContent = playerCount;
  hudOnlineEl.textContent = playerCount;
  if (!serverPlayers[id]) {
    serverPlayers[id] = { id, name, color, y: 250, alive: true, score: 0 };
  }
  updatePlayerListUI();
});

socket.on('playerLeft', ({ id, playerCount }) => {
  onlineCountEl.textContent = playerCount;
  hudOnlineEl.textContent = playerCount;
  delete serverPlayers[id];
  updatePlayerListUI();
});

socket.on('countdown', ({ count }) => {
  gameState = 'countdown';
  showOverlay(countdownOvr);
  hideOverlay(waitingOvr);
  hideOverlay(roundoverOvr);
  countdownNum.textContent = count;
  countdownNum.style.animation = 'none';
  void countdownNum.offsetWidth;
  countdownNum.style.animation = 'countPop 1s ease-out';
  resumeBGM();
});

socket.on('gameState', ({ state }) => {
  gameState = state;
  if (state === 'playing') {
    hideOverlay(countdownOvr);
    hideOverlay(waitingOvr);
    hideOverlay(roundoverOvr);
    myAlive = serverPlayers[myId]?.alive ?? true;
  } else if (state === 'lobby') {
    hideOverlay(countdownOvr);
    showOverlay(waitingOvr);
  }
});

socket.on('tick', ({ pipes, players }) => {
  serverPipes = pipes;
  players.forEach(p => {
    serverPlayers[p.id] = { ...serverPlayers[p.id], ...p };
  });
  myAlive = serverPlayers[myId]?.alive ?? false;
  const me = serverPlayers[myId];
  if (me) myScoreEl.textContent = me.score;
  updatePlayerListUI();
});

socket.on('playerDied', ({ id, score, name }) => {
  if (serverPlayers[id]) serverPlayers[id].alive = false;
  if (id === myId) {
    myAlive = false;
    playGameover();
    showOverlay(waitingOvr);
  }
  updatePlayerListUI();
});

socket.on('joinedMidGame', ({ pipes, players }) => {
  serverPipes = pipes;
  players.forEach(p => { serverPlayers[p.id] = p; });
  myAlive = false;
  showOverlay(waitingOvr);
});

socket.on('roundOver', ({ leaderboard }) => {
  gameState = 'roundover';
  hideOverlay(countdownOvr);
  hideOverlay(waitingOvr);
  showOverlay(roundoverOvr);
  renderLeaderboard(leaderboard);
  if (!myAlive) playGameover();
});

// ── Overlay Helpers ──────────────────────────────────────────
function showOverlay(el) { el.classList.remove('hidden'); }
function hideOverlay(el) { el.classList.add('hidden'); }

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

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function updatePlayerListUI() {
  const all = Object.values(serverPlayers);
  playerListEl.innerHTML = all.map(p => `
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
  startGameLoop();
}

joinBtn.addEventListener('click', joinGame);
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinGame();
});

// ── Flap Input ──────────────────────────────────────────────
function doFlap() {
  unlockAudio();
  if (gameState === 'playing' && myAlive) {
    socket.emit('flap');
  }
}

canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); doFlap(); });
canvas.addEventListener('touchstart', (e) => { if (e.cancelable) e.preventDefault(); doFlap(); }, { passive: false });
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); doFlap(); }
});

// ── Background Drawing ──────────────────────────────────────
function drawBackground() {
  // Dark night sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, '#030712');
  sky.addColorStop(0.45, '#090d16');
  sky.addColorStop(0.78, '#0f172a');
  sky.addColorStop(1, '#1e1b4b');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CANVAS_WIDTH, GROUND_Y);

  // Stars
  stars.forEach(s => {
    s.a += Math.sin(frames * s.s) * 0.015;
    s.a = Math.max(0.15, Math.min(1, s.a));
    ctx.save();
    ctx.globalAlpha = s.a;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // City silhouettes
  ctx.fillStyle = 'rgba(15,23,42,0.6)';
  [[15,60,35],[60,90,45],[115,72,38],[165,108,50],[225,82,40],[275,118,54],[338,68,34]].forEach(([x,h,w]) => {
    ctx.fillRect(x, GROUND_Y - h, w, h);
  });

  // Ground
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, GROUND_Y, CANVAS_WIDTH, CANVAS_HEIGHT - GROUND_Y);
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(0, GROUND_Y, CANVAS_WIDTH, 4);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, GROUND_Y + 4, CANVAS_WIDTH, 14);

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 3;
  for (let x = groundX - 30; x < CANVAS_WIDTH + 30; x += 20) {
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y + 18);
    ctx.lineTo(x - 12, CANVAS_HEIGHT);
    ctx.stroke();
  }
}

// ── Pipe Drawing ─────────────────────────────────────────────
const PIPE_W = 56;
const NATURAL_BOTTLE_H = 135;

function drawPipes() {
  serverPipes.forEach(p => {
    const bottomY = p.top + 185;
    const bottomH = GROUND_Y - bottomY;

    // TOP: inverted bottle with roller ball pointing into gap
    ctx.save();
    const topBottleH = Math.min(p.top, NATURAL_BOTTLE_H);
    if (p.top > NATURAL_BOTTLE_H) {
      ctx.fillStyle = '#0a0f1e';
      ctx.fillRect(p.x + 10, 0, PIPE_W - 20, p.top - NATURAL_BOTTLE_H);
    }
    ctx.translate(p.x + PIPE_W, p.top);
    ctx.scale(-1, -1);
    if (pipeImg.complete) ctx.drawImage(pipeImg, 0, 0, PIPE_W, topBottleH);
    else { ctx.scale(-1,-1); ctx.fillStyle = '#1e3a8a'; ctx.fillRect(-PIPE_W, -p.top, PIPE_W, p.top); }
    ctx.restore();

    // BOTTOM: upright bottle with roller ball pointing up into gap
    ctx.save();
    const botBottleH = Math.min(bottomH, NATURAL_BOTTLE_H);
    if (pipeImg.complete) ctx.drawImage(pipeImg, p.x, bottomY, PIPE_W, botBottleH);
    else { ctx.fillStyle = '#1e3a8a'; ctx.fillRect(p.x, bottomY, PIPE_W, bottomH); }
    if (bottomH > NATURAL_BOTTLE_H) {
      ctx.fillStyle = '#0a0f1e';
      ctx.fillRect(p.x + 10, bottomY + NATURAL_BOTTLE_H, PIPE_W - 20, bottomH - NATURAL_BOTTLE_H);
    }
    ctx.restore();
  });
}

// ── Player Drawing ───────────────────────────────────────────
const PLAYER_FIXED_X = 90;
const FACE_W = 40;
const FACE_H = 54;

function drawPlayers() {
  Object.values(serverPlayers).forEach(p => {
    if (!p.alive) return;

    const vel = p.vel || 0;
    let rot = 0;
    if (vel < 0) rot = Math.max(-0.35, vel * 0.06);
    else rot = Math.min(Math.PI / 2.8, (vel - 2) * 0.08);

    ctx.save();
    ctx.translate(PLAYER_FIXED_X, p.y);
    ctx.rotate(rot);

    // Colored tinted halo for this player
    ctx.save();
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 14;

    if (faceImg.complete && faceImg.naturalWidth > 0) {
      ctx.drawImage(faceImg, -FACE_W / 2, -FACE_H / 2, FACE_W, FACE_H);
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Player name tag below head
    ctx.shadowBlur = 0;
    const tag = p.id === myId ? `👤 ${p.name}` : p.name;
    const tagW = ctx.measureText(tag).width + 16;
    ctx.fillStyle = p.id === myId ? '#3b82f6' : '#1e293b';
    ctx.beginPath();
    ctx.roundRect(-tagW / 2, FACE_H / 2 + 4, tagW, 18, 5);
    ctx.fill();
    ctx.font = '600 10px Outfit, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tag, 0, FACE_H / 2 + 13);

    // Score bubble above head
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(0, -FACE_H / 2 - 12, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '800 10px Outfit, sans-serif';
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.score, 0, -FACE_H / 2 - 12);

    ctx.restore();
  });
}

// Polyfill for roundRect
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    if (w < 2*r) r = w/2;
    if (h < 2*r) r = h/2;
    this.beginPath();
    this.moveTo(x+r, y);
    this.arcTo(x+w, y, x+w, y+h, r);
    this.arcTo(x+w, y+h, x, y+h, r);
    this.arcTo(x, y+h, x, y, r);
    this.arcTo(x, y, x+w, y, r);
    this.closePath();
    return this;
  };
}

// ── Game Loop ────────────────────────────────────────────────
function startGameLoop() {
  function loop() {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (gameState !== 'lobby') groundX = (groundX - 1.65) % 24;

    drawBackground();
    if (gameState === 'playing' || gameState === 'roundover') {
      drawPipes();
    }
    drawPlayers();

    frames++;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
