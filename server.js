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

const rooms = new Map();
const players = new Map();

function isNameTakenInRoom(roomId, playerName) {
  const room = rooms.get(roomId);
  if (!room) return false;
  return room.players.some(p => p.name.toLowerCase() === playerName.toLowerCase());
}

io.on('connection', (socket) => {
  console.log(`[${socket.id}] połączono`);
  // Ukryta komenda do resetu rankingu
  socket.on('adminResetLeaderboard', (password) => {
    if (password === 'karpatkA!1339') { // Zmień na własne!
      players.clear(); // Czyści całą mapę graczy
      io.emit('leaderboardData', []); // Wysyła pusty ranking do wszystkich
      console.log('Ranking został zresetowany przez admina!');
    }
  });

  socket.on('registerPlayer', (name) => {
    const pName = name || `Player_${socket.id.substring(0, 4)}`;
    if (!players.has(pName)) {
      players.set(pName, { name: pName, points: 0, wins: 0, losses: 0 }); 
    }
    socket.emit('playerData', players.get(pName));
  });

  socket.on('getLeaderboard', () => {
    const sorted = Array.from(players.values()).sort((a, b) => b.points - a.points).slice(0, 20);
    socket.emit('leaderboardData', sorted);
  });

  // ==========================================
  // LOBBY I DOŁĄCZANIE (HAXBALL STYLE)
  // ==========================================
  socket.on('createRoom', ({ limit, timeLimit, is2v2, playerName }) => {
    const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    const name = playerName || `Player_${socket.id.substring(0, 4)}`;
    
    rooms.set(roomId, { 
        id: roomId, host: socket.id, 
        players: [{ id: socket.id, role: 'p1', name, ready: true }], // Host jest zawsze gotowy
        inputs: {}, state: null, limit, timeLimit, is2v2 
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

    // Klient wchodzi jako NOT READY
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

  socket.on('matchComplete', ({ roomId, winnerTeam }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const winnerPlayers = room.players.filter(p => (p.role === 'p1' || p.role === 'p3') ? winnerTeam === 'a' : winnerTeam === 'b');
    const loserPlayers = room.players.filter(p => !winnerPlayers.includes(p));

    winnerPlayers.forEach(wp => {
      const playerData = players.get(wp.name);
      if (playerData) { playerData.points += 15; playerData.wins++; }
    });

    loserPlayers.forEach(lp => {
      const playerData = players.get(lp.name);
      if (playerData) { playerData.points = Math.max(0, playerData.points - 5); playerData.losses++; }
    });
  });

  socket.on('disconnect', () => {
    rooms.forEach((room, roomId) => {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        const p = room.players[idx];
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
            rooms.delete(roomId);
        } else {
            // Re-assign host if host left
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
