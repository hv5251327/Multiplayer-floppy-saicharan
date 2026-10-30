// ============================================================
// Multiplayer Flappy Bird - Global Game Server
// Real-time multiplayer via Socket.IO - No Rooms
// All players worldwide share the SAME game world
// ============================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 5000
});

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ─── Game Constants ─────────────────────────────────────────
const CANVAS_WIDTH   = 360;
const CANVAS_HEIGHT  = 640;
const GROUND_Y       = 550;
const PIPE_WIDTH     = 56;
const GAP            = 185;
const SCROLL_SPEED   = 1.65;
const SPAWN_INTERVAL = 140; // frames between pipes
const GRAVITY        = 0.22;
const JUMP_VEL       = -4.6;
const TICK_MS        = 1000 / 60; // 60fps server loop
const MIN_PLAYERS_TO_START = 1;
const COUNTDOWN_SECS = 3;

// ─── Game State ──────────────────────────────────────────────
let gameState = 'lobby';   // 'lobby' | 'countdown' | 'playing' | 'roundover'
let players   = {};        // { socketId: { name, y, vel, alive, score, color, x } }
let pipes     = [];
let frames    = 0;
let gameLoop  = null;
let countdownTimer = null;
let roundOverTimer = null;

// Pastel player colors so multiple birds are distinguishable
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

// ─── Pipe Helpers ─────────────────────────────────────────────
function spawnPipe() {
  const minTop = 70;
  const maxTop = GROUND_Y - GAP - 70;
  const topH = Math.floor(Math.random() * (maxTop - minTop + 1)) + minTop;
  pipes.push({ x: CANVAS_WIDTH, top: topH, id: Date.now() + Math.random() });
}

function updatePipes() {
  // Don't spawn on frame 0 – give players a breathing start
  if (frames > 0 && frames % SPAWN_INTERVAL === 0) spawnPipe();
  pipes.forEach(p => { p.x -= SCROLL_SPEED; });
  pipes = pipes.filter(p => p.x + PIPE_WIDTH > -20);
}

// ─── Player Physics ──────────────────────────────────────────
function updatePlayers() {
  const alive = Object.values(players).filter(p => p.alive);
  alive.forEach(p => {
    p.vel += GRAVITY;
    p.y   += p.vel;

    // Ground collision
    if (p.y + 20 >= GROUND_Y) {
      p.y = GROUND_Y - 20;
      killPlayer(p);
      return;
    }
    // Ceiling
    if (p.y - 20 <= 0) { p.y = 20; p.vel = 0; }

    // Pipe collision (check only pipes in x-range)
    for (const pipe of pipes) {
      if (pipe.x - 20 > p.x + 16) continue; // not reached yet
      if (pipe.x + PIPE_WIDTH < p.x - 16) continue; // already passed

      const inX = (p.x + 14) > pipe.x && (p.x - 14) < (pipe.x + PIPE_WIDTH);
      if (inX && ((p.y - 14) < pipe.top || (p.y + 14) > pipe.top + GAP)) {
        killPlayer(p);
        break;
      }
    }

    // Score: passed a pipe
    pipes.forEach(pipe => {
      if (!pipe['scored_' + p.id] && pipe.x + PIPE_WIDTH < p.x - 14) {
        pipe['scored_' + p.id] = true;
        p.score++;
      }
    });
  });
}

function killPlayer(p) {
  if (!p.alive) return;
  p.alive = false;
  io.emit('playerDied', { id: p.id, score: p.score, name: p.name });
  checkRoundEnd();
}

function checkRoundEnd() {
  const alivePlayers = Object.values(players).filter(p => p.alive);
  if (alivePlayers.length === 0 && gameState === 'playing') {
    endRound();
  }
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

  // Reset for next round after 3.5 seconds
  roundOverTimer = setTimeout(() => {
    resetRound();
  }, 3500);
}

function resetRound() {
  clearInterval(countdownTimer);
  clearTimeout(roundOverTimer);
  pipes = [];
  frames = 0;
  Object.values(players).forEach(p => {
    p.y     = 250;
    p.vel   = 0;
    p.alive = true;
    p.score = 0;
  });
  startCountdown();
}

function startCountdown() {
  clearInterval(countdownTimer);
  clearTimeout(roundOverTimer);

  if (Object.keys(players).length < MIN_PLAYERS_TO_START) {
    gameState = 'lobby';
    io.emit('gameState', { state: 'lobby' });
    return;
  }
  gameState = 'countdown';
  let count = COUNTDOWN_SECS;
  io.emit('countdown', { count });
  countdownTimer = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(countdownTimer);
      startPlaying();
    } else {
      io.emit('countdown', { count });
    }
  }, 1000);
}

function startPlaying() {
  clearInterval(gameLoop);
  gameState = 'playing';
  pipes = [];
  frames = 0;
  Object.values(players).forEach(p => {
    p.y = 250; p.vel = 0; p.alive = true; p.score = 0;
  });
  io.emit('gameState', { state: 'playing' });

  gameLoop = setInterval(() => {
    updatePipes();
    updatePlayers();
    frames++;

    // Broadcast full state every tick — include vel for smooth rotation on client
    io.emit('tick', {
      pipes: pipes.map(p => ({ x: p.x, top: p.top })),
      players: Object.values(players).map(p => ({
        id: p.id, name: p.name, y: p.y, vel: p.vel,
        alive: p.alive, score: p.score, color: p.color
      }))
    });
  }, 1000 / 60); // 60fps
}

// ─── Socket.IO Events ────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // Send current game state to newly connected client
  socket.emit('init', {
    gameState,
    playerCount: Object.keys(players).length,
    existingPlayers: Object.values(players).map(p => ({
      id: p.id, name: p.name, color: p.color
    }))
  });

  // Player joins with a name
  socket.on('join', ({ name }) => {
    const safeName = (name || 'Player').toString().slice(0, 16).trim() || 'Player';
    const color = getNextColor();

    players[socket.id] = {
      id: socket.id,
      name: safeName,
      y: 250,
      vel: 0,
      alive: true,
      score: 0,
      color,
      x: 90   // fixed x position for all birds
    };

    console.log(`[JOIN] ${safeName} (${socket.id})`);

    // Notify everyone about the new player
    io.emit('playerJoined', {
      id: socket.id,
      name: safeName,
      color,
      playerCount: Object.keys(players).length
    });

    // Auto-start or tell player what's happening
    if (gameState === 'lobby') {
      startCountdown();
    } else if (gameState === 'playing') {
      // Join mid-game as a spectator (already dead)
      players[socket.id].alive = false;
      socket.emit('joinedMidGame', {
        pipes: pipes.map(p => ({ x: p.x, top: p.top })),
        players: Object.values(players).map(p => ({
          id: p.id, name: p.name, y: p.y, alive: p.alive,
          score: p.score, color: p.color
        }))
      });
    } else if (gameState === 'countdown') {
      socket.emit('countdown', { count: COUNTDOWN_SECS });
    }
  });

  // Player flaps
  socket.on('flap', () => {
    const p = players[socket.id];
    if (p && p.alive && gameState === 'playing') {
      p.vel = JUMP_VEL;
    }
  });

  // Player disconnects
  socket.on('disconnect', () => {
    const p = players[socket.id];
    if (p) {
      console.log(`[-] Disconnected: ${p.name} (${socket.id})`);
      delete players[socket.id];
      io.emit('playerLeft', {
        id: socket.id,
        name: p.name,
        playerCount: Object.keys(players).length
      });

      // If no players left, stop the game
      if (Object.keys(players).length === 0) {
        clearInterval(gameLoop);
        clearInterval(countdownTimer);
        clearTimeout(roundOverTimer);
        gameLoop = null;
        gameState = 'lobby';
        pipes = [];
        frames = 0;
      } else if (gameState === 'playing') {
        checkRoundEnd();
      }
    }
  });
});

// ─── Start HTTP Server ────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`Multiplayer Flappy Bird running on http://localhost:${PORT}`);
});
