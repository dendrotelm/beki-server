require('dotenv').config(); // Wczytuje zmienne z pliku .env (lokalnie)

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

// ==========================================
// BAZA DANYCH (Zmienne środowiskowe)
// ==========================================
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Połączono z bazą MongoDB'))
  .catch(err => console.error('❌ Błąd bazy:', err));

const playerSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  points: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  isGuest: { type: Boolean, default: false } // Flaga dla niezalogowanych
});
const Player = mongoose.model('Player', playerSchema);

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3001;
const rooms = new Map();
let matchmakingQueue = []; // Kolejka graczy szukających meczu 1v1

function isNameTakenInRoom(roomId, playerName) {
  const room = rooms.get(roomId);
  if (!room) return false;
  return room.players.some(p => p.name.toLowerCase() === playerName.toLowerCase());
}

// ==========================================
// Pętla Matchmakingu (co 2 sekundy)
// ==========================================
setInterval(() => {
  if (matchmakingQueue.length >= 2) {
    const now = Date.now();
    for (let i = 0; i < matchmakingQueue.length; i++) {
      for (let j = i + 1; j < matchmakingQueue.length; j++) {
        const p1 = matchmakingQueue[i];
        const p2 = matchmakingQueue[j];
        
        // Zwiększamy tolerancję punktową o 15 pkt za każdą sekundę czekania
        const wait1 = (now - p1.joinTime) / 1000;
        const wait2 = (now - p2.joinTime) / 1000;
        const maxDiff = 50 + Math.max(wait1, wait2) * 15;

        if (Math.abs(p1.points - p2.points) <= maxDiff) {
          // ZNALEZIONO MECZ! Usuwamy ich z kolejki
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

          // P1 staje się Hostem (liczy fizykę), P2 staje się Klientem
          p1.socket.emit('matchFound', { roomId, role: 'p1', isHost: true });
          p2.socket.emit('matchFound', { roomId, role: 'p2', isHost: false });

          // Pomijamy lobby i od razu rzucamy ich do gry
          io.to(roomId).emit('gameStarted', { limit: 5, timeLimit: 300, is2v2: false });
          return; // Przerwij i zacznij od nowa w kolejnym cyklu
        }
      }
    }
  }
}, 2000);

// ==========================================
// POŁĄCZENIA SOCKET.IO
// ==========================================
io.on('connection', (socket) => {
  console.log(`[${socket.id}] połączono`);

  // Zabezpieczony reset rankingu (działa na bazie)
  socket.on('adminResetLeaderboard', async (password) => {
    // Sprawdzamy hasło z process.env
    if (password === process.env.ADMIN_PASSWORD) {
      await Player.updateMany({}, { points: 0, wins: 0, losses: 0 });
      const sorted = await Player.find({ isGuest: false }).sort({ points: -1 }).limit(20);
      io.emit('leaderboardData', sorted);
      console.log('Ranking wyzerowany przez admina!');
    } else {
      console.log('Ktoś próbował zresetować ranking błędnym hasłem!');
    }
  });

  socket.on('registerPlayer', async (name) => {
    const pName = name || `Player_${socket.id.substring(0, 4)}`;
    const isGuest = pName.startsWith('Player_');

    try {
      let player = await Player.findOne({ name: pName });
      if (!player) {
        player = new Player({ name: pName, points: 0, wins: 0, losses: 0, isGuest });
        await player.save();
      }
      socket.emit('playerData', player);
    } catch (err) { console.error('Błąd rejestracji:', err); }
  });

  socket.on('getLeaderboard', async () => {
    try {
      // Pobieramy tylko tych, co podali nick
      const sorted = await Player.find({ isGuest: false }).sort({ points: -1 }).limit(20);
      socket.emit('leaderboardData', sorted);
    } catch (err) { console.error('Błąd rankingu:', err); }
  });

  // ==========================================
  // MATCHMAKING 1v1
  // ==========================================
  socket.on('findMatch1v1', async ({ playerName }) => {
    const pName = playerName || `Player_${socket.id.substring(0, 4)}`;
    try {
      const player = await Player.findOne({ name: pName });
      const pts = player ? player.points : 0;
      
      // Dodajemy gracza do kolejki, jeśli go tam nie ma
      if (!matchmakingQueue.find(q => q.socket.id === socket.id)) {
        matchmakingQueue.push({ socket, name: pName, points: pts, joinTime: Date.now() });
      }
    } catch (err) { console.error('Błąd dodawania do kolejki:', err); }
  });

  socket.on('cancelMatchmaking', () => {
    matchmakingQueue = matchmakingQueue.filter(q => q.socket.id !== socket.id);
  });

  // ==========================================
  // LOBBY I DOŁĄCZANIE (HAXBALL STYLE)
  // ==========================================
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
    if (isNameTakenInRoom(roomId, name)) return socket.emit('errorMsg', `Nazwa "${name}" jest już zajęta w tym pokoju!`);
    const maxPlayers = room.is2v2 ? 4 : 2;
    if (room.players.length >= maxPlayers) return socket.emit('errorMsg', 'Pokój jest pełny!');

    const availableRoles = room.is2v2 ? ['p1', 'p2', 'p3', 'p4'] : ['p1', 'p2'];
    const takenRoles = room.players.map(p => p.role);
    const role = availableRoles.find(r => !takenRoles.includes(r));

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
    const allReady = room.players.every(p => p.ready);
    const maxPlayers = room.is2v2 ? 4 : 2;
    if (allReady && room.players.length === maxPlayers) {
        io.to(roomId).emit('gameStarted', { limit: room.limit, timeLimit: room.timeLimit, is2v2: room.is2v2 });
    }
  });

  // ==========================================
  // IN-GAME
  // ==========================================
  socket.on('clientInput', ({ roomId, role, input }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.inputs[role] = input;
    socket.volatile.to(roomId).emit('opponentInput', { role, input }); 
  });

  socket.on('hostState', ({ roomId, state }) => {
    const room = rooms.get(roomId);
    if (!room || socket.id !== room.host) return;
    room.state = state;
    socket.volatile.to(roomId).emit('gameState', state); 
  });

  socket.on('gameEvent', ({ roomId, type, power }) => {
    socket.to(roomId).emit('triggerEvent', { type, power });
  });

  socket.on('chatMessage', (msgObj) => {
    io.to(msgObj.roomId).emit('chatMessage', msgObj);
  });

  socket.on('matchComplete', async ({ roomId, winnerTeam }) => {
    const room = rooms.get(roomId);
    // ZABEZPIECZENIE: Ucinamy jeśli już policzyliśmy wynik
    if (!room || room.isFinished) return;
    room.isFinished = true;

    const winnerPlayers = room.players.filter(p => (p.role === 'p1' || p.role === 'p3') ? winnerTeam === 'a' : winnerTeam === 'b');
    const loserPlayers = room.players.filter(p => !winnerPlayers.includes(p));

    const updatePlayer = async (name, isWinner) => {
      let p = await Player.findOne({ name });
      if (p) {
        if (isWinner) { p.points += 15; p.wins++; } 
        else { p.points = Math.max(0, p.points - 5); p.losses++; }
        await p.save();
        return p;
      }
    };

    try {
      await Promise.all(winnerPlayers.map(p => updatePlayer(p.name, true)));
      await Promise.all(loserPlayers.map(p => updatePlayer(p.name, false)));

      // Aktualizujemy dane u graczy na żywo
      winnerPlayers.concat(loserPlayers).forEach(async (p) => {
         const pd = await Player.findOne({ name: p.name });
         if (pd) io.to(p.id).emit('playerData', pd);
      });

      // Odświeżamy ranking globalny
      const newLeaderboard = await Player.find({ isGuest: false }).sort({ points: -1 }).limit(20);
      io.emit('leaderboardData', newLeaderboard);
    } catch (err) { console.error('Błąd zapisu meczu:', err); }
  });

  socket.on('disconnect', () => {
    // Usunięcie z matchmakingu
    matchmakingQueue = matchmakingQueue.filter(q => q.socket.id !== socket.id);

    rooms.forEach((room, roomId) => {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        const p = room.players[idx];
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
            rooms.delete(roomId);
        } else {
            if (room.host === socket.id) {
                room.host = room.players[0].id;
                room.players[0].ready = true; 
            }
            io.to(roomId).emit('lobbyUpdate', { joined: room.players.length, max: room.is2v2 ? 4 : 2, players: room.players, host: room.host });
            io.to(roomId).emit('playerLeft', { role: p.role });
        }
      }
    });
  });
});

server.listen(PORT, () => console.log(`🚀 Serwer działa na porcie ${PORT}`)); 
