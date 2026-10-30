// ============================================================
// Multiplayer Flappy Bird - Client Engine v3
// Client-Side Prediction: my bird runs local physics at 60fps
// Other players: interpolated from server positions (20Hz)
// Name tag moved ABOVE the bird's head
// ============================================================

const socket = io({ transports: ['websocket'] });

// ── DOM References ────────────────────────────────────────────────────────────
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

// ── Audio ─────────────────────────────────────────────────────────────────────
const bgmAudio = document.getElementById('audio-bgm');
const goAudio  = document.getElementById('audio-gameover');
let isMuted    = false;
let audioReady = false;

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
    muteBtn.textContent = '🔊';
    muteBtn.classList.remove('muted');
  }
});

// ── Canvas Sizing ─────────────────────────────────────────────────────────────
const CW = 360;
let CH   = 640;
let GY   = 550;

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

// ── Assets ────────────────────────────────────────────────────────────────────
const faceImg = new Image();
faceImg.src   = 'assets/player.png';
const pipeImg = new Image();
pipeImg.src   = 'assets/nivea.png';

// ── Physics constants (must match server) ─────────────────────────────────────
const GRAVITY   = 0.22;
const JUMP_VEL  = -4.6;
const BIRD_X    = 90;

// ── My bird local state (client-side prediction) ──────────────────────────────
let myY     = 250;
let myVel   = 0;
let myAlive = true;
let myScore = 0;

// ── Game State ────────────────────────────────────────────────────────────────
let myId      = null;
let myName    = '';
let gameState = 'lobby';

let pipes     = [];  // from server (authoritative)
let players   = {};  // other players: { id, name, y, vel, alive, score, color }
                     // y is interpolated between server updates

let frames    = 0;
let groundX   = 0;
let loopRunning = false;

// Position broadcast throttle (send every 3 frames = ~20Hz at 60fps)
let posFrameCount = 0;

// Stars
const stars = Array.from({ length: 48 }, () => ({
  x: Math.random() * CW,
  y: Math.random() * 450,
  r: Math.random() * 1.8 + 0.5,
  a: Math.random() * 0.7 + 0.3,
  speed: Math.random() * 0.03 + 0.01
}));

// ── Socket Events ─────────────────────────────────────────────────────────────
socket.on('connect', () => { myId = socket.id; });

socket.on('init', ({ gameState: gs, playerCount, existingPlayers }) => {
  gameState = gs;
  updateOnlineCount(playerCount);
  existingPlayers.forEach(p => {
    if (p.id !== myId)
      players[p.id] = { id: p.id, name: p.name, color: p.color, y: 250, vel: 0, alive: true, score: 0 };
  });
  updatePlayerListUI();
});

socket.on('playerJoined', ({ id, name, color, playerCount }) => {
  updateOnlineCount(playerCount);
  if (id !== myId && !players[id]) {
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
  countdownNum.style.animation = 'none';
  void countdownNum.offsetWidth;
  countdownNum.style.animation = 'countPop 1s ease-out';
  resumeBGM();
});

socket.on('gameState', ({ state, pipes: sp, players: sp2 }) => {
  gameState = state;
  if (state === 'playing') {
    // Reset my local physics
    myY = 250; myVel = 0; myAlive = true; myScore = 0;
    if (sp)  pipes = sp;
    if (sp2) sp2.forEach(p => {
      if (p.id === myId) return;
      players[p.id] = { ...p };
    });
    hideOvr(countdownOvr);
    hideOvr(waitingOvr);
    hideOvr(roundoverOvr);
  } else if (state === 'lobby') {
    hideOvr(countdownOvr);
    showOvr(waitingOvr);
  }
});

socket.on('tick', ({ pipes: sp, players: sp2 }) => {
  pipes = sp;

  sp2.forEach(p => {
    if (p.id === myId) {
      // Update my score from server (authoritative)
      myScore = p.score;
      myScoreEl.textContent = myScore;
      // Correct my alive state if server says I'm dead
      if (!p.alive && myAlive) {
        myAlive = false;
        onMyDeath();
      }
      return;
    }
    // Other players: store server snapshot for interpolation
    if (!players[p.id]) {
      players[p.id] = { ...p };
    } else {
      const cur = players[p.id];
      // Store previous y for interpolation
      cur.prevY  = cur.y;
      cur.targetY = p.y;
      cur.interpT = 0;  // reset interpolation progress
      cur.vel   = p.vel !== undefined ? p.vel : cur.vel;
      cur.alive = p.alive;
      cur.score = p.score;
      cur.color = p.color;
    }
  });

  updatePlayerListUI();
});

socket.on('playerDied', ({ id, score }) => {
  if (id === myId) {
    if (myAlive) { myAlive = false; onMyDeath(); }
  } else if (players[id]) {
    players[id].alive = false;
  }
  updatePlayerListUI();
});

function onMyDeath() {
  playGameoverSound();
  showOvr(waitingOvr);
}

socket.on('joinedMidGame', ({ pipes: sp, players: sp2 }) => {
  pipes = sp;
  sp2.forEach(p => {
    if (p.id !== myId) players[p.id] = { ...p };
  });
  myAlive = false;
  showOvr(waitingOvr);
});

socket.on('roundOver', ({ leaderboard }) => {
  gameState = 'roundover';
  hideOvr(countdownOvr);
  hideOvr(waitingOvr);
  showOvr(roundoverOvr);
  renderLeaderboard(leaderboard);
  if (!myAlive) playGameoverSound();
});

// ── UI Helpers ────────────────────────────────────────────────────────────────
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
  const all = { ...players };
  if (myId) {
    all[myId] = { id: myId, name: myName, alive: myAlive, score: myScore, color: '#facc15' };
  }
  playerListEl.innerHTML = Object.values(all).map(p => `
    <div class="player-row ${p.alive ? '' : 'dead'} ${p.id === myId ? 'me' : ''}">
      <div class="player-dot" style="background:${p.color}"></div>
      <div class="player-name-label">${escHtml(p.name)}</div>
      <div class="player-score-badge">${p.score}</div>
    </div>`).join('');
}

// ── Join Game ─────────────────────────────────────────────────────────────────
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

// ── Flap Input ────────────────────────────────────────────────────────────────
function doFlap() {
  unlockAudio();
  if (gameState === 'playing' && myAlive) {
    myVel = JUMP_VEL;  // instant local response (client-side prediction)
    socket.emit('flap'); // also tell server
  }
}

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

// ── Render Helpers ────────────────────────────────────────────────────────────
const PIPE_W   = 56;
const GAP      = 185;
const BOTTLE_H = 135;
const FACE_W   = 40;
const FACE_H   = 54;

function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, GY);
  sky.addColorStop(0,    '#030712');
  sky.addColorStop(0.45, '#090d16');
  sky.addColorStop(0.78, '#0f172a');
  sky.addColorStop(1,    '#1e1b4b');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CW, GY);

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

  ctx.fillStyle = 'rgba(15,23,42,0.6)';
  [[15,58,34],[60,88,44],[115,70,38],[165,106,50],[225,80,40],[275,116,54],[338,66,34]]
    .forEach(([x, h, w]) => ctx.fillRect(x, GY - h, w, h));

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, GY, CW, CH - GY);
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(0, GY, CW, 4);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, GY + 4, CW, 14);

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

    // Top bottle (inverted — roller ball faces DOWN)
    ctx.save();
    const topBH = Math.min(p.top, BOTTLE_H);
    if (p.top > BOTTLE_H) {
      ctx.fillStyle = '#090d16';
      ctx.fillRect(p.x + 10, 0, PIPE_W - 20, p.top - BOTTLE_H);
    }
    ctx.translate(p.x + PIPE_W, p.top);
    ctx.scale(-1, -1);
    if (pipeImg.complete && pipeImg.naturalWidth > 0) {
      ctx.drawImage(pipeImg, 0, 0, PIPE_W, topBH);
    } else {
      ctx.fillStyle = '#1e3a8a'; ctx.fillRect(0, 0, PIPE_W, topBH);
    }
    ctx.restore();

    // Bottom bottle (upright — roller ball faces UP)
    ctx.save();
    const botBH = Math.min(bottomH, BOTTLE_H);
    if (pipeImg.complete && pipeImg.naturalWidth > 0) {
      ctx.drawImage(pipeImg, p.x, bottomY, PIPE_W, botBH);
    } else {
      ctx.fillStyle = '#1e3a8a'; ctx.fillRect(p.x, bottomY, PIPE_W, bottomH);
    }
    if (bottomH > BOTTLE_H) {
      ctx.fillStyle = '#090d16';
      ctx.fillRect(p.x + 10, bottomY + BOTTLE_H, PIPE_W - 20, bottomH - BOTTLE_H);
    }
    ctx.restore();
  });
}

function drawOneBird(x, y, vel, isMe, name, score, color) {
  const rot = vel < 0
    ? Math.max(-0.35, vel * 0.06)
    : Math.min(Math.PI / 2.8, (vel - 2) * 0.08);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.globalAlpha = isMe ? 1.0 : 0.82;

  // Glow halo
  ctx.shadowColor = color || '#facc15';
  ctx.shadowBlur  = isMe ? 18 : 12;

  if (faceImg.complete && faceImg.naturalWidth > 0) {
    ctx.drawImage(faceImg, -FACE_W / 2, -FACE_H / 2, FACE_W, FACE_H);
  } else {
    ctx.fillStyle = color || '#facc15';
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  // ── Score bubble (ABOVE head) ──────────────────────────────────────────────
  const bubbleR = isMe ? 13 : 10;
  const bubbleY = -FACE_H / 2 - 14;
  ctx.globalAlpha = isMe ? 1.0 : 0.85;
  ctx.fillStyle = color || '#facc15';
  ctx.beginPath();
  ctx.arc(0, bubbleY, bubbleR, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = isMe ? '800 10px Outfit, sans-serif' : '700 9px Outfit, sans-serif';
  ctx.fillStyle = '#000';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(score, 0, bubbleY);

  // ── Name tag (ABOVE head, above score bubble) ──────────────────────────────
  ctx.globalAlpha = isMe ? 1.0 : 0.90;
  const label = isMe ? `⭐ ${name}` : name;
  ctx.font = '700 10px Outfit, sans-serif';
  const tw = ctx.measureText(label).width + 14;
  // Place name tag above score bubble
  const ty = -FACE_H / 2 - 14 - bubbleR - 19;  // above score bubble

  ctx.fillStyle = isMe ? '#2563eb' : '#1e293b';
  roundRect(ctx, -tw / 2, ty, tw, 17, 5);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, ty + 8.5);

  ctx.restore();
}

function drawPlayers() {
  // Draw others first (me on top)
  Object.values(players).forEach(p => {
    if (!p.alive) return;
    // Smooth interpolation between previous and target server y
    if (p.prevY !== undefined && p.targetY !== undefined) {
      p.interpT = Math.min(1, (p.interpT || 0) + 0.15);
      p.y = p.prevY + (p.targetY - p.prevY) * p.interpT;
    }
    drawOneBird(BIRD_X, p.y, p.vel || 0, false, p.name, p.score, p.color);
  });

  // Draw my bird using local physics state
  if (myAlive) {
    drawOneBird(BIRD_X, myY, myVel, true, myName, myScore, '#facc15');
  }
}

// Utility: rounded rectangle path
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

// ── Main Render Loop (requestAnimationFrame = 60fps) ─────────────────────────
function renderLoop() {
  // ── My local physics (client-side prediction) ────────────────────────────
  if (gameState === 'playing' && myAlive) {
    myVel += GRAVITY;
    myY   += myVel;

    // Ground
    if (myY + 20 >= GY) { myY = GY - 20; }
    // Ceiling
    if (myY - 20 <= 0) { myY = 20; myVel = 0; }

    // Broadcast my position to server every 3 frames (~20Hz)
    posFrameCount++;
    if (posFrameCount >= 3) {
      posFrameCount = 0;
      socket.emit('position', { y: myY, vel: myVel });
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
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
