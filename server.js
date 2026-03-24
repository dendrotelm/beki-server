require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const admin = require('firebase-admin');
const fetch = require('node-fetch'); // npm install node-fetch@2
const jwt = require('jsonwebtoken'); // npm install jsonwebtoken

// ==========================================
// FIREBASE ADMIN INIT
// Na Render dodaj env var: FIREBASE_SERVICE_ACCOUNT = cały JSON jako string
// ==========================================
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (serviceAccount.project_id) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log('✅ Firebase Admin zainicjalizowany');
  } else {
    console.warn('⚠️ Brak FIREBASE_SERVICE_ACCOUNT — Firebase Auth wyłączone');
  }
} catch (e) {
  console.error('❌ Błąd Firebase Admin:', e.message);
}

// ==========================================
// MONGODB
// ==========================================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Połączono z MongoDB'))
  .catch(err => console.error('❌ Błąd MongoDB:', err));

const playerSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  points: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  isGuest: { type: Boolean, default: false },
  secretToken: { type: String },
  crazyGamesId: { type: String },
  firebaseUid: { type: String },
  leaveWarnings: { type: Number, default: 0 }, // licznik opuszczeń w trakcie meczu
});

// Indeksy żeby wyszukiwanie było szybkie
playerSchema.index({ crazyGamesId: 1 }, { sparse: true });
playerSchema.index({ firebaseUid: 1 }, { sparse: true });

const Player = mongoose.model('Player', playerSchema);

// ==========================================
// HELPER: weryfikacja tokenu CrazyGames
// ==========================================
let cgPublicKey = null;
let cgKeyFetchedAt = 0;

async function verifyCrazyGamesToken(token) {
  try {
    // Klucz publiczny cachujemy na 1h
    if (!cgPublicKey || Date.now() - cgKeyFetchedAt > 3600000) {
      const res = await fetch('https://sdk.crazygames.com/publicKey.json');
      const data = await res.json();
      cgPublicKey = data.publicKey;
      cgKeyFetchedAt = Date.now();
    }
    const payload = jwt.verify(token, cgPublicKey, { algorithms: ['RS256'] });
    return payload; // { userId, username, gameId, ... }
  } catch (e) {
    console.error('CrazyGames token invalid:', e.message);
    return null;
  }
}

// ==========================================
// HELPER: weryfikacja Firebase ID Token
// ==========================================
async function verifyFirebaseToken(idToken) {
  try {
    if (!admin.apps.length) return null;
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded; // { uid, email, name, picture, ... }
  } catch (e) {
    console.error('Firebase token invalid:', e.message);
    return null;
  }
}

// ==========================================
// HELPER: znajdź lub utwórz gracza
// ==========================================
async function findOrCreatePlayer({ name, secretToken, crazyGamesId, firebaseUid }) {
  let player = null;

  // Zabezpieczenie: upewnij się że name to string lub null
  const safeName = (name && typeof name === 'string') ? name.trim() : null;

  // 1. Szukaj po crazyGamesId
  if (crazyGamesId) {
    player = await Player.findOne({ crazyGamesId });
    if (player) return { player, error: null };
  }

  // 2. Szukaj po firebaseUid
  if (firebaseUid) {
    player = await Player.findOne({ firebaseUid });
    if (player) return { player, error: null };
  }

  // 3. Szukaj po nazwie (fallback localStorage)
  if (safeName) {
    player = await Player.findOne({ name: safeName });

    if (player) {
      // Nick istnieje — weryfikuj token (tylko dla niegości)
      const isGuest = safeName.startsWith('Player_');
      if (!isGuest && player.secretToken && !crazyGamesId && !firebaseUid) {
        if (player.secretToken !== secretToken) {
          return { player: null, error: 'nameTakenError' };
        }
      }
      // Jeśli zalogowany przez CG/Firebase — linkuj konto
      if (crazyGamesId && !player.crazyGamesId) {
        player.crazyGamesId = crazyGamesId;
        await player.save();
      }
      if (firebaseUid && !player.firebaseUid) {
        player.firebaseUid = firebaseUid;
        await player.save();
      }
      return { player, error: null };
    }
  }

  // 4. Nowy gracz — utwórz
  const finalName = safeName || `Player_${Math.random().toString(36).substr(2, 6)}`;
  const isGuest = finalName.startsWith('Player_') && !crazyGamesId && !firebaseUid;
  const newToken = Math.random().toString(36).substring(2, 15);

  player = new Player({
    name: finalName,
    isGuest,
    secretToken: newToken,
    crazyGamesId: crazyGamesId || undefined,
    firebaseUid: firebaseUid || undefined,
  });

  try {
    await player.save();
    return { player, newToken };
  } catch (e) {
    // Kolizja nazwy — dodaj suffix
    player.name = finalName + '_' + Math.random().toString(36).substr(2, 3);
    await player.save();
    return { player, newToken };
  }
}

// ==========================================
// EXPRESS + SOCKET.IO
// ==========================================
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3001;
const rooms = new Map();
let matchmakingQueue = [];

function isNameTakenInRoom(roomId, playerName) {
  const room = rooms.get(roomId);
  if (!room) return false;
  return room.players.some(p => p.name.toLowerCase() === playerName.toLowerCase());
}

// ==========================================
// MATCHMAKING (co 2 sekundy)
// ==========================================
setInterval(() => {
  if (matchmakingQueue.length >= 2) {
    const now = Date.now();
    for (let i = 0; i < matchmakingQueue.length; i++) {
      for (let j = i + 1; j < matchmakingQueue.length; j++) {
        const p1 = matchmakingQueue[i];
        const p2 = matchmakingQueue[j];
        const wait1 = (now - p1.joinTime) / 1000;
        const wait2 = (now - p2.joinTime) / 1000;
        const maxDiff = 50 + Math.max(wait1, wait2) * 15;
        if (Math.abs(p1.points - p2.points) <= maxDiff) {
          matchmakingQueue.splice(j, 1);
          matchmakingQueue.splice(i, 1);
          const roomId = 'RNK_' + Math.random().toString(36).substring(2, 6).toUpperCase();
          rooms.set(roomId, {
            id: roomId, host: p1.socket.id,
            players: [
              { id: p1.socket.id, role: 'p1', name: p1.name, ready: true },
              { id: p2.socket.id, role: 'p2', name: p2.name, ready: true }
            ],
            inputs: {}, state: null, limit: 5, timeLimit: 300, is2v2: false, isFinished: false
          });
          p1.socket.join(roomId);
          p2.socket.join(roomId);
          p1.socket.emit('matchFound', { roomId, role: 'p1', isHost: true });
          p2.socket.emit('matchFound', { roomId, role: 'p2', isHost: false });
          io.to(roomId).emit('gameStarted', { limit: 5, timeLimit: 300, is2v2: false });
          return;
        }
      }
    }
  }
}, 2000);

// ==========================================
// SOCKET.IO HANDLERS
// ==========================================
io.on('connection', (socket) => {
  console.log(`[${socket.id}] połączono`);
  const broadcastOnlineCount = () => io.emit('onlineCount', io.engine.clientsCount);
  broadcastOnlineCount(); // broadcast przy każdym nowym połączeniu

  socket.on('adminResetLeaderboard', async (password) => {
    if (password === process.env.ADMIN_PASSWORD) {
      await Player.updateMany({}, { points: 0, wins: 0, losses: 0 });
      const sorted = await Player.find({ isGuest: false }).sort({ points: -1 }).limit(20);
      io.emit('leaderboardData', sorted);
    }
  });

  // ==========================================
  // REJESTRACJA — obsługuje 3 platformy
  // Dane: { name, secretToken, platform, cgToken, firebaseToken }
  // ==========================================
  socket.on('registerPlayer', async (data) => {
    // Zabezpieczenie: data może być null/undefined ze starego klienta
    if (!data) data = {};
    if (typeof data === 'string') data = { name: data };

    const { name, secretToken, platform, cgToken, firebaseToken } = data;

    let crazyGamesId = null;
    let firebaseUid = null;
    let displayName = name;

    // --- CrazyGames ---
    if (platform === 'crazygames' && cgToken) {
      const cgPayload = await verifyCrazyGamesToken(cgToken);
      if (cgPayload) {
        crazyGamesId = cgPayload.userId;
        // Użyj nicku z CrazyGames jeśli gracz nie ma własnego
        if (!displayName) displayName = cgPayload.username;
      }
    }

    // --- Firebase (Android + Google Sign-In) ---
    if (platform === 'firebase' && firebaseToken) {
      const fbPayload = await verifyFirebaseToken(firebaseToken);
      if (fbPayload) {
        firebaseUid = fbPayload.uid;
        if (!displayName) displayName = fbPayload.name || fbPayload.email?.split('@')[0];
      }
    }

    try {
      const result = await findOrCreatePlayer({
        name: displayName,
        secretToken,
        crazyGamesId,
        firebaseUid,
      });

      if (result.error === 'nameTakenError') {
        socket.emit('nameTakenError');
        socket.emit('playerData', { points: 0, wins: 0, losses: 0 });
        return;
      }

      if (result.newToken) {
        socket.emit('tokenIssued', { name: result.player.name, token: result.newToken });
      }

      socket.emit('playerData', {
        name: result.player.name,
        points: result.player.points,
        wins: result.player.wins,
        losses: result.player.losses,
        isGuest: result.player.isGuest,
      });

    } catch (err) {
      console.error('Błąd rejestracji:', err);
    }
  });

  socket.on('getLeaderboard', async () => {
    try {
      const sorted = await Player.find({ isGuest: false }).sort({ points: -1 }).limit(20);
      socket.emit('leaderboardData', sorted);
    } catch (err) { console.error(err); }
  });

  socket.on('findMatch1v1', async ({ playerName }) => {
    const pName = playerName || `Player_${socket.id.substring(0, 4)}`;
    try {
      const player = await Player.findOne({ name: pName });
      const pts = player ? player.points : 0;
      if (!matchmakingQueue.find(q => q.socket.id === socket.id)) {
        matchmakingQueue.push({ socket, name: pName, points: pts, joinTime: Date.now() });
      }
    } catch (err) { console.error(err); }
  });

  socket.on('cancelMatchmaking', () => {
    matchmakingQueue = matchmakingQueue.filter(q => q.socket.id !== socket.id);
  });

  socket.on('createRoom', ({ limit, timeLimit, is2v2, playerName }) => {
    const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    const name = playerName || `Player_${socket.id.substring(0, 4)}`;
    rooms.set(roomId, {
      id: roomId, host: socket.id,
      players: [{ id: socket.id, role: 'p1', name, ready: true }],
      inputs: {}, state: null, limit, timeLimit, is2v2, isFinished: false
    });
    socket.join(roomId);
    socket.emit('roomCreated', { roomId, role: 'p1' });
    io.to(roomId).emit('lobbyUpdate', { joined: 1, max: is2v2 ? 4 : 2, players: rooms.get(roomId).players, host: socket.id });
  });

  socket.on('joinRoom', ({ roomId, playerName }) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit('errorMsg', 'Pokój nie istnieje!');
    const name = playerName || `Player_${socket.id.substring(0, 4)}`;
    if (isNameTakenInRoom(roomId, name)) return socket.emit('errorMsg', `Nazwa "${name}" jest już zajęta!`);
    const maxPlayers = room.is2v2 ? 4 : 2;
    if (room.players.length >= maxPlayers) return socket.emit('errorMsg', 'Pokój pełny!');
    const availableRoles = room.is2v2 ? ['p1','p2','p3','p4'] : ['p1','p2'];
    const role = availableRoles.find(r => !room.players.map(p=>p.role).includes(r));
    room.players.push({ id: socket.id, role, name, ready: false });
    socket.join(roomId);
    socket.emit('joinedRoom', { roomId, role });
    io.to(roomId).emit('lobbyUpdate', { joined: room.players.length, max: maxPlayers, players: room.players, host: room.host });
  });

  socket.on('toggleReady', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const p = room.players.find(x => x.id === socket.id);
    if (p && room.host !== socket.id) {
      p.ready = !p.ready;
      io.to(roomId).emit('lobbyUpdate', { joined: room.players.length, max: room.is2v2 ? 4 : 2, players: room.players, host: room.host });
    }
  });

  socket.on('startMatch', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.host !== socket.id) return;
    if (room.players.every(p => p.ready) && room.players.length === (room.is2v2 ? 4 : 2)) {
      io.to(roomId).emit('gameStarted', { limit: room.limit, timeLimit: room.timeLimit, is2v2: room.is2v2 });
    }
  });

  socket.on('clientInput', ({ roomId, role, input }) => {
    const room = rooms.get(roomId);
    if (room) { room.inputs[role] = input; socket.volatile.to(roomId).emit('opponentInput', { role, input }); }
  });

  socket.on('hostState', ({ roomId, state }) => {
    const room = rooms.get(roomId);
    if (room && socket.id === room.host) { room.state = state; socket.volatile.to(roomId).emit('gameState', state); }
  });

  socket.on('gameEvent', ({ roomId, type, power }) => socket.to(roomId).emit('triggerEvent', { type, power }));
  socket.on('chatMessage', (msgObj) => io.to(msgObj.roomId).emit('chatMessage', msgObj));

  socket.on('matchComplete', async ({ roomId, winnerTeam }) => {
    const room = rooms.get(roomId);
    if (!room || room.isFinished) return;
    room.isFinished = true;
    const winnerPlayers = room.players.filter(p => (p.role==='p1'||p.role==='p3') ? winnerTeam==='a' : winnerTeam==='b');
    const loserPlayers = room.players.filter(p => !winnerPlayers.includes(p));
    const updatePlayer = async (name, isWinner) => {
      const p = await Player.findOne({ name });
      if (p) {
        if (isWinner) { p.points += 15; p.wins++; }
        else { p.points = Math.max(0, p.points - 5); p.losses++; }
        await p.save(); return p;
      }
    };
    try {
      await Promise.all(winnerPlayers.map(p => updatePlayer(p.name, true)));
      await Promise.all(loserPlayers.map(p => updatePlayer(p.name, false)));
      winnerPlayers.concat(loserPlayers).forEach(async (p) => {
        const pd = await Player.findOne({ name: p.name });
        if (pd) io.to(p.id).emit('playerData', pd);
      });
      const lb = await Player.find({ isGuest: false }).sort({ points: -1 }).limit(20);
      io.emit('leaderboardData', lb);
    } catch (err) { console.error(err); }
  });

  socket.on('disconnect', () => {
    setTimeout(broadcastOnlineCount, 100); // lekkie opóźnienie — socket.io aktualizuje licznik asynchronicznie
    matchmakingQueue = matchmakingQueue.filter(q => q.socket.id !== socket.id);
    rooms.forEach(async (room, roomId) => {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        const p = room.players[idx];
        if (roomId.startsWith('RNK_') && !room.isFinished) {
          room.isFinished = true;
          const remaining = room.players.find(rp => rp.id !== socket.id);
          if (remaining) {
            try {
              const leaver = await Player.findOne({ name: p.name });
              if (leaver && !leaver.isGuest) {
                leaver.leaveWarnings = (leaver.leaveWarnings || 0) + 1;
                const warns = leaver.leaveWarnings;

                // System kar:
                // 1. ostrzeżenie — 0 punktów
                // co 3 wyjścia: -5 pkt
                // pozostałe: -2 pkt
                let pointPenalty = 0;
                if (warns === 1) {
                  pointPenalty = 0; // tylko ostrzeżenie
                } else if (warns % 3 === 0) {
                  pointPenalty = 5; // co 3. wyjście surowa kara
                } else {
                  pointPenalty = 2; // każde inne wyjście
                }

                leaver.points = Math.max(0, leaver.points - pointPenalty);
                leaver.losses++;
                await leaver.save();

                // Informuj leavera o jego karze (może jeszcze być połączony przez chwilę)
                socket.emit('leavepenalty', {
                  warnings: warns,
                  pointPenalty,
                });
              }

              const winner = await Player.findOne({ name: remaining.name });
              if (winner) {
                winner.points += 15; winner.wins++; await winner.save();
                io.to(remaining.id).emit('playerData', winner);
              }
              const lb = await Player.find({ isGuest: false }).sort({ points: -1 }).limit(20);
              io.emit('leaderboardData', lb);
            } catch(e) { console.log(e); }
          }
        }
        room.players.splice(idx, 1);
        if (room.players.length === 0) { rooms.delete(roomId); }
        else {
          if (room.host === socket.id) { room.host = room.players[0].id; room.players[0].ready = true; }
          io.to(roomId).emit('lobbyUpdate', { joined: room.players.length, max: room.is2v2 ? 4 : 2, players: room.players, host: room.host });
          io.to(roomId).emit('playerLeft', { role: p.role });
        }
      }
    });
  });
});

server.listen(PORT, () => console.log(`🚀 Serwer na porcie ${PORT}`)); 
