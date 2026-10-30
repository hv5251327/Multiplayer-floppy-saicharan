// ============================================================
// Multiplayer Flappy Bird - Global Game Server (v3 - Relay Architecture)
// Server owns: pipes, game state, scoring validation
// Clients own: their own physics (client-side prediction)
// Server relays player positions at 20Hz (not 60fps)
// ============================================================

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app        = express();
const httpServer = http.createServer(app);
const io         = new Server(httpServer, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout:  5000,
  // Reduce latency: disable polling, go straight to websocket
  transports: ['websocket']
});

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));

// ── Game Constants (also duplicated on client) ──────────────────────────────
const CANVAS_WIDTH   = 360;
const CANVAS_HEIGHT  = 640;
const GROUND_Y       = 550;
const PIPE_WIDTH     = 56;
const GAP            = 185;
const SCROLL_SPEED   = 1.65;
const SPAWN_INTERVAL = 140; // frames between pipes (at 20fps = 7 seconds)
const TICK_HZ        = 20;  // server tick rate for pipe broadcast
const TICK_MS        = 1000 / TICK_HZ;
const MIN_PLAYERS    = 1;
const COUNTDOWN_SECS = 3;

// ── Game State ───────────────────────────────────────────────────────────────
let gameState      = 'lobby';
let players        = {};
let pipes          = [];
let frames         = 0;
let gameLoop       = null;
let countdownTimer = null;
let roundOverTimer = null;

const BIRD_COLORS = [
  '#facc15','#f97316','#ef4444','#ec4899',
  '#a855f7','#3b82f6','#06b6d4','#22c55e'
];
let colorIndex = 0;
function getNextColor() {
  const c = BIRD_COLORS[colorIndex % BIRD_COLORS.length];
  colorIndex++;
  return c;
}

// ── Pipe Helpers ─────────────────────────────────────────────────────────────
function spawnPipe() {
  const minTop = 70;
  const maxTop = GROUND_Y - GAP - 70;
  const topH   = Math.floor(Math.random() * (maxTop - minTop + 1)) + minTop;
  pipes.push({ x: CANVAS_WIDTH, top: topH, id: Date.now() + Math.random() });
}

function updatePipes() {
  if (frames > 0 && frames % SPAWN_INTERVAL === 0) spawnPipe();
  pipes.forEach(p => { p.x -= SCROLL_SPEED; });
  pipes = pipes.filter(p => p.x + PIPE_WIDTH > -20);
}

// ── Server-side scoring (authoritative) ─────────────────────────────────────
function checkScoring(p) {
  pipes.forEach(pipe => {
    if (!pipe['scored_' + p.id] && pipe.x + PIPE_WIDTH < p.x - 14) {
      pipe['scored_' + p.id] = true;
      p.score++;
    }
  });
}

// ── Collision (uses client-reported y, validated against server pipes) ────────
function checkCollision(p) {
  if (!p.alive) return false;
  if (p.y + 20 >= GROUND_Y) return true;
  if (p.y - 20 <= 0) return true;
  for (const pipe of pipes) {
    if (pipe.x - 20 > p.x + 16) continue;
    if (pipe.x + PIPE_WIDTH < p.x - 16) continue;
    const inX = (p.x + 14) > pipe.x && (p.x - 14) < (pipe.x + PIPE_WIDTH);
    if (inX && ((p.y - 14) < pipe.top || (p.y + 14) > pipe.top + GAP)) return true;
  }
  return false;
}

function killPlayer(p) {
  if (!p.alive) return;
  p.alive = false;
  io.emit('playerDied', { id: p.id, score: p.score, name: p.name });
  checkRoundEnd();
}

function checkRoundEnd() {
  const alive = Object.values(players).filter(p => p.alive);
  if (alive.length === 0 && gameState === 'playing') endRound();
}

function endRound() {
  gameState = 'roundover';
  clearInterval(gameLoop);
  clearInterval(countdownTimer);
  clearTimeout(roundOverTimer);
  gameLoop = null;

  const leaderboard = Object.values(players)
    .map(p => ({ id: p.id, name: p.name, score: p.score, color: p.color }))
    .sort((a, b) => b.score - a.score);

  io.emit('roundOver', { leaderboard });
  roundOverTimer = setTimeout(() => resetRound(), 4000);
}

function resetRound() {
  clearInterval(countdownTimer);
  clearTimeout(roundOverTimer);
  pipes = []; frames = 0;
  Object.values(players).forEach(p => {
    p.y = 250; p.vel = 0; p.alive = true; p.score = 0;
  });
  startCountdown();
}

function startCountdown() {
  clearInterval(countdownTimer);
  clearTimeout(roundOverTimer);
  if (Object.keys(players).length < MIN_PLAYERS) {
    gameState = 'lobby';
    io.emit('gameState', { state: 'lobby' });
    return;
  }
  gameState = 'countdown';
  let count = COUNTDOWN_SECS;
  io.emit('countdown', { count });
  countdownTimer = setInterval(() => {
    count--;
    if (count <= 0) { clearInterval(countdownTimer); startPlaying(); }
    else io.emit('countdown', { count });
  }, 1000);
}

function startPlaying() {
  clearInterval(gameLoop);
  gameState = 'playing';
  pipes = []; frames = 0;
  Object.values(players).forEach(p => {
    p.y = 250; p.vel = 0; p.alive = true; p.score = 0;
  });
  io.emit('gameState', { state: 'playing', pipes: [], players: buildPlayerList() });

  gameLoop = setInterval(() => {
    updatePipes();
    frames++;

    Object.values(players).forEach(p => {
      if (!p.alive) return;
      checkScoring(p);
      if (checkCollision(p)) killPlayer(p);
    });

    io.emit('tick', {
      pipes:   pipes.map(p => ({ x: p.x, top: p.top })),
      players: buildPlayerList()
    });
  }, TICK_MS);
}

function buildPlayerList() {
  return Object.values(players).map(p => ({
    id: p.id, name: p.name, y: p.y, vel: p.vel,
    alive: p.alive, score: p.score, color: p.color, x: p.x || 90
  }));
}

// ── Socket.IO Events ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id}`);

  socket.emit('init', {
    gameState,
    playerCount:     Object.keys(players).length,
    existingPlayers: Object.values(players).map(p => ({ id: p.id, name: p.name, color: p.color }))
  });

  socket.on('join', ({ name }) => {
    const safeName = (name || 'Player').toString().slice(0, 16).trim() || 'Player';
    const color    = getNextColor();
    players[socket.id] = {
      id: socket.id, name: safeName,
      y: 250, vel: 0, alive: true, score: 0,
      color, x: 90
    };
    console.log(`[JOIN] ${safeName}`);
    io.emit('playerJoined', {
      id: socket.id, name: safeName, color,
      playerCount: Object.keys(players).length
    });
    if (gameState === 'lobby') startCountdown();
    else if (gameState === 'playing') {
      players[socket.id].alive = false;
      socket.emit('joinedMidGame', {
        pipes:   pipes.map(p => ({ x: p.x, top: p.top })),
        players: buildPlayerList()
      });
    } else if (gameState === 'countdown') {
      socket.emit('countdown', { count: COUNTDOWN_SECS });
    }
  });

  // Client reports its own position (client-side prediction result)
  socket.on('position', ({ y, vel }) => {
    const p = players[socket.id];
    if (!p || !p.alive || gameState !== 'playing') return;
    if (typeof y   === 'number') p.y   = y;
    if (typeof vel === 'number') p.vel = vel;
  });

  // Flap: client already applied locally; server keeps vel in sync
  socket.on('flap', () => {
    const p = players[socket.id];
    if (p && p.alive && gameState === 'playing') p.vel = -4.6;
  });

  socket.on('disconnect', () => {
    const p = players[socket.id];
    if (p) {
      console.log(`[-] ${p.name}`);
      delete players[socket.id];
      io.emit('playerLeft', {
        id: socket.id, name: p.name,
        playerCount: Object.keys(players).length
      });
      if (Object.keys(players).length === 0) {
        clearInterval(gameLoop); clearInterval(countdownTimer);
        clearTimeout(roundOverTimer);
        gameLoop = null; gameState = 'lobby'; pipes = []; frames = 0;
      } else if (gameState === 'playing') checkRoundEnd();
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Multiplayer Flappy Bird on http://localhost:${PORT}`);
});
