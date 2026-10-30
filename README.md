# 🐦 Multiplayer Flappy Saicharan

Real-time **global multiplayer** Flappy Bird. No rooms — all players worldwide share one game world. Enter your name and play!

## Features
- 🌍 Global single-world multiplayer (no rooms needed)
- 👤 Enter your name to join
- 🎭 Face avatar with coloured halos for each player
- 🏆 Live leaderboard after each round
- 📌 Pinned face photo on scoreboard
- 🎵 Background music + game-over sound
- 📱 Mobile-first fullscreen vertical layout

## Deploy on Render (Web Service)

1. Push to GitHub
2. Go to [dashboard.render.com](https://dashboard.render.com) → **New +** → **Web Service**
3. Connect the repo `hv5251327/Multiplayer-floppy-saicharan`
4. Settings:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
5. Click **Create Web Service**

> ⚠️ Use **Web Service** (NOT Static Site) because the server needs Socket.IO WebSockets.
