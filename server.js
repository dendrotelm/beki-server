const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3001;

// Struktura pokoju: { id, host, players: [{ id, role, name }], inputs: {}, state: {}, limit, timeLimit, is2v2 }
const rooms = new Map();

// Struktura gracza: { id, elo, wins, losses, name }
const players = new Map();

// ==========================================
// WALIDACJA UNIKALNYCH NAZW GRACZY
// ==========================================
function isNameTakenInRoom(roomId, playerName) {
  const room = rooms.get(roomId);
  if (!room) return false;
  return room.players.some(p => p.name.toLowerCase() === playerName.toLowerCase());
}

// ==========================================
// TWORZENIE POKOJU
// ==========================================
io.on('connection', (socket) => {
  console.log(`[${socket.id}] połączono`);

  // Pobierz dane gracza
  socket.on('getPlayerData', () => {
    if (!players.has(socket.id)) {
      players.set(socket.id, { id: socket.id, elo: 1200, wins: 0, losses: 0, name: '' });
    }
    socket.emit('playerData', players.get(socket.id));
  });

  // Pobierz ranking
  socket.on('getLeaderboard', () => {
    const sorted = Array.from(players.values()).sort((a, b) => b.elo - a.elo).slice(0, 20);
    socket.emit('leaderboardData', sorted);
  });

  // ==========================================
  // TWORZENIE POKOJU (HOST)
  // ==========================================
  socket.on('createRoom', ({ limit, timeLimit, is2v2, playerName }) => {
    const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    const name = playerName || `Player_${socket.id.substring(0, 4)}`;
    
    rooms.set(roomId, {
      id: roomId,
      host: socket.id,
      players: [{ id: socket.id, role: 'p1', name }],
      inputs: {},
      state: null,
      limit,
      timeLimit,
      is2v2
    });

    socket.join(roomId);
    socket.emit('roomCreated', { roomId, role: 'p1' });
    console.log(`[${socket.id}] utworzył pokój ${roomId} jako ${name}`);
  });

  // ==========================================
  // DOŁĄCZANIE DO POKOJU (CLIENT)
  // ==========================================
  socket.on('joinRoom', ({ roomId, playerName }) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit('errorMsg', 'Pokój nie istnieje!');

    const name = playerName || `Player_${socket.id.substring(0, 4)}`;

    // ✅ WALIDACJA: Sprawdź czy nazwa jest już zajęta
    if (isNameTakenInRoom(roomId, name)) {
      return socket.emit('errorMsg', `Nazwa "${name}" jest już zajęta w tym pokoju!`);
    }

    const maxPlayers = room.is2v2 ? 4 : 2;
    if (room.players.length >= maxPlayers) {
      return socket.emit('errorMsg', 'Pokój jest pełny!');
    }

    const availableRoles = room.is2v2 ? ['p1', 'p2', 'p3', 'p4'] : ['p1', 'p2'];
    const takenRoles = room.players.map(p => p.role);
    const role = availableRoles.find(r => !takenRoles.includes(r));

    room.players.push({ id: socket.id, role, name });
    socket.join(roomId);
    socket.emit('joinedRoom', { roomId, role });

    // Wyślij aktualizację lobby do wszystkich w pokoju
    io.to(roomId).emit('lobbyUpdate', { joined: room.players.length, max: maxPlayers });
    console.log(`[${socket.id}] dołączył do pokoju ${roomId} jako ${name} (${role})`);

    // Jeśli pokój jest pełny, rozpocznij grę
    if (room.players.length === maxPlayers) {
      io.to(roomId).emit('gameStarted', { limit: room.limit, timeLimit: room.timeLimit, is2v2: room.is2v2 });
      console.log(`[${roomId}] GRA ROZPOCZĘTA!`);
    }
  });

  // ==========================================
  // INPUT OD KLIENTA
  // ==========================================
  socket.on('clientInput', ({ roomId, role, input }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.inputs[role] = input;
    socket.to(roomId).emit('opponentInput', { role, input });
  });

  // ==========================================
  // STAN GRY OD HOSTA
  // ==========================================
  socket.on('hostState', ({ roomId, state }) => {
    const room = rooms.get(roomId);
    if (!room || socket.id !== room.host) return;
    room.state = state;
    socket.to(roomId).emit('gameState', state);
  });

  // ==========================================
  // EVENTY (DŹWIĘK, WSTRZĄSY, REMATCH)
  // ==========================================
  socket.on('gameEvent', ({ roomId, type, power }) => {
    socket.to(roomId).emit('triggerEvent', { type, power });
  });

  // ==========================================
  // CZAT
  // ==========================================
  socket.on('chatMessage', (msgObj) => {
    io.to(msgObj.roomId).emit('chatMessage', msgObj);
  });

  // ==========================================
  // ZAKOŃCZENIE MECZU (ELO)
  // ==========================================
  socket.on('matchComplete', ({ roomId, winnerTeam }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const winnerPlayers = room.players.filter(p => (p.role === 'p1' || p.role === 'p3') ? winnerTeam === 'a' : winnerTeam === 'b');
    const loserPlayers = room.players.filter(p => !winnerPlayers.includes(p));

    winnerPlayers.forEach(wp => {
      const playerData = players.get(wp.id);
      if (playerData) {
        playerData.elo += 25;
        playerData.wins++;
      }
    });

    loserPlayers.forEach(lp => {
      const playerData = players.get(lp.id);
      if (playerData) {
        playerData.elo = Math.max(800, playerData.elo - 20);
        playerData.losses++;
      }
    });

    console.log(`[${roomId}] Mecz zakończony. Wygrana: ${winnerTeam}`);
  });

  // ==========================================
  // ROZŁĄCZENIE
  // ==========================================
  socket.on('disconnect', () => {
    rooms.forEach((room, roomId) => {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
          rooms.delete(roomId);
          console.log(`[${roomId}] Pokój zamknięty (wszyscy wyszli)`);
        } else {
          io.to(roomId).emit('lobbyUpdate', { joined: room.players.length, max: room.is2v2 ? 4 : 2 });
        }
      }
    });
    console.log(`[${socket.id}] rozłączono`);
  });
});

server.listen(PORT, () => console.log(`🚀 Serwer działa na porcie ${PORT}`));