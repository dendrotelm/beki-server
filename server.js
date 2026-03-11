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
// Struktura gracza: { name, points, wins, losses }
// Zmieniamy klucz na nazwę gracza, by punkty nie znikały po odświeżeniu strony!
const players = new Map();

// ==========================================
// WALIDACJA UNIKALNYCH NAZW GRACZY
// ==========================================
function isNameTakenInRoom(roomId, playerName) {
  const room = rooms.get(roomId);
  if (!room) return false;
  return room.players.some(p => p.name.toLowerCase() === playerName.toLowerCase());
}

io.on('connection', (socket) => {
  console.log(`[${socket.id}] połączono`);

  // Nowa rejestracja gracza (po Nickname, a nie ID)
  socket.on('registerPlayer', (name) => {
    const pName = name || `Player_${socket.id.substring(0, 4)}`;
    if (!players.has(pName)) {
      players.set(pName, { name: pName, points: 0, wins: 0, losses: 0 }); // Wyzerowany ranking!
    }
    socket.emit('playerData', players.get(pName));
  });

  // Pobierz ranking (sortowanie po punktach)
  socket.on('getLeaderboard', () => {
    const sorted = Array.from(players.values()).sort((a, b) => b.points - a.points).slice(0, 20);
    socket.emit('leaderboardData', sorted);
  });

  // ==========================================
  // TWORZENIE I DOŁĄCZANIE (zostaje tak samo, bez zmian)
  // ==========================================
  socket.on('createRoom', ({ limit, timeLimit, is2v2, playerName }) => {
    const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    const name = playerName || `Player_${socket.id.substring(0, 4)}`;
    rooms.set(roomId, { id: roomId, host: socket.id, players: [{ id: socket.id, role: 'p1', name }], inputs: {}, state: null, limit, timeLimit, is2v2 });
    socket.join(roomId);
    socket.emit('roomCreated', { roomId, role: 'p1' });
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

    room.players.push({ id: socket.id, role, name });
    socket.join(roomId);
    socket.emit('joinedRoom', { roomId, role });
    io.to(roomId).emit('lobbyUpdate', { joined: room.players.length, max: maxPlayers });
    
    if (room.players.length === maxPlayers) {
      io.to(roomId).emit('gameStarted', { limit: room.limit, timeLimit: room.timeLimit, is2v2: room.is2v2 });
    }
  });

  // ==========================================
  // INPUT I STATE - UŻYWAMY VOLATILE DO REDUKCJI LAGÓW
  // ==========================================
  socket.on('clientInput', ({ roomId, role, input }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.inputs[role] = input;
    // Volatile odrzuca opóźnione pakiety zamiast je dławić
    socket.volatile.to(roomId).emit('opponentInput', { role, input }); 
  });

  socket.on('hostState', ({ roomId, state }) => {
    const room = rooms.get(roomId);
    if (!room || socket.id !== room.host) return;
    room.state = state;
    // Volatile do wysyłania 60 razy na sekundę bez zapchania sieci
    socket.volatile.to(roomId).emit('gameState', state); 
  });

  socket.on('gameEvent', ({ roomId, type, power }) => {
    socket.to(roomId).emit('triggerEvent', { type, power });
  });

  socket.on('chatMessage', (msgObj) => {
    io.to(msgObj.roomId).emit('chatMessage', msgObj);
  });

  // ==========================================
  // ZAKOŃCZENIE MECZU (PUNKTACJA)
  // ==========================================
  socket.on('matchComplete', ({ roomId, winnerTeam }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const winnerPlayers = room.players.filter(p => (p.role === 'p1' || p.role === 'p3') ? winnerTeam === 'a' : winnerTeam === 'b');
    const loserPlayers = room.players.filter(p => !winnerPlayers.includes(p));

    // Dodajemy po 15 punktów za wygraną
    winnerPlayers.forEach(wp => {
      const playerData = players.get(wp.name);
      if (playerData) {
        playerData.points += 15;
        playerData.wins++;
      }
    });

    // Odejmujemy 5 punktów za przegraną (nie spadnie poniżej 0)
    loserPlayers.forEach(lp => {
      const playerData = players.get(lp.name);
      if (playerData) {
        playerData.points = Math.max(0, playerData.points - 5);
        playerData.losses++;
      }
    });
  });

  socket.on('disconnect', () => {
    rooms.forEach((room, roomId) => {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        if (room.players.length === 0) rooms.delete(roomId);
        else io.to(roomId).emit('lobbyUpdate', { joined: room.players.length, max: room.is2v2 ? 4 : 2 });
      }
    });
  });
});

server.listen(PORT, () => console.log(`🚀 Serwer działa na porcie ${PORT}`));