const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const rooms = {};
// Baza graczy w pamięci RAM (dla ELO i Leaderboardu)
const playersDb = {}; 

function generateRoomId() { return Math.random().toString(36).substring(2, 6).toUpperCase(); }
function generateGuestName() { return 'Gracz_' + Math.floor(Math.random() * 10000); }

// Standardowy system obliczania ELO
function updateElo(winnerElo, loserElo) {
    const k = 32; // Współczynnik zmiany
    const expectedWin = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
    const newWinnerElo = Math.round(winnerElo + k * (1 - expectedWin));
    const newLoserElo = Math.round(loserElo + k * (0 - (1 - expectedWin)));
    return { newWinnerElo, newLoserElo: Math.max(0, newLoserElo) };
}

// Emiter odświeżonej listy najlepszych graczy
function broadcastLeaderboard() {
    const topPlayers = Object.values(playersDb)
        .sort((a, b) => b.elo - a.elo)
        .slice(0, 10); // Pobierz top 10
    io.emit('leaderboardData', topPlayers);
}

io.on('connection', (socket) => {
  // Przy połączeniu "tworzymy" gracza w naszej tymczasowej bazie
  if (!playersDb[socket.id]) {
      playersDb[socket.id] = { id: socket.id, name: generateGuestName(), elo: 1200 };
  }

  // Frontend prosi o własne dane
  socket.on('getPlayerData', () => {
    socket.emit('playerData', playersDb[socket.id]);
  });

  // Frontend prosi o tablicę wyników
  socket.on('getLeaderboard', () => {
    broadcastLeaderboard();
  });

  socket.on('createRoom', ({ limit, is2v2 }) => {
    const roomId = generateRoomId();
    rooms[roomId] = { id: roomId, host: socket.id, clients: [], is2v2, limit, matchOver: false };
    socket.join(roomId);
    socket.emit('roomCreated', { roomId, role: 'p1' });
  });

  socket.on('joinRoom', ({ roomId }) => {
    const id = roomId ? roomId.toUpperCase() : '';
    const room = rooms[id];
    
    if (room) {
      const maxClients = room.is2v2 ? 3 : 1;
      if (room.clients.length < maxClients) {
        const role = room.is2v2 ? ['p2', 'p3', 'p4'][room.clients.length] : 'p2';
        room.clients.push({ id: socket.id, role });
        socket.join(id);
        socket.emit('joinedRoom', { roomId: id, role });
        
        io.to(id).emit('lobbyUpdate', { joined: room.clients.length + 1, max: maxClients + 1 });

        if (room.clients.length === maxClients) {
          io.to(id).emit('gameStarted', { limit: room.limit, is2v2: room.is2v2 });
        }
      } else {
        socket.emit('errorMsg', 'Pokój pełny!');
      }
    } else {
      socket.emit('errorMsg', 'Pokój nie istnieje!');
    }
  });

  socket.on('hostState', ({ roomId, state }) => { socket.to(roomId).emit('gameState', state); });
  socket.on('clientInput', ({ roomId, role, input }) => { socket.to(roomId).emit('opponentInput', { role, input }); });
  socket.on('gameEvent', (data) => { socket.to(data.roomId).emit('triggerEvent', data); });
  socket.on('chatMessage', (msg) => { io.to(msg.roomId).emit('chatMessage', msg); });

  // ====== LOGIKA ELO (Zakończenie meczu) ======
  socket.on('matchComplete', ({ roomId, winnerTeam }) => {
    const room = rooms[roomId];
    if (room && !room.matchOver) {
        room.matchOver = true; // Zabezpieczenie by liczyć punkty tylko raz
        
        // Segregacja graczy na drużyny
        let teamA = [room.host]; 
        let teamB = [];
        room.clients.forEach(c => {
            if(c.role === 'p3') teamA.push(c.id);
            else teamB.push(c.id); 
        });

        const winners = winnerTeam === 'a' ? teamA : teamB;
        const losers = winnerTeam === 'a' ? teamB : teamA;

        // Średnie ELO dla drużyn (ważne przy 2v2)
        let avgWinnerElo = winners.reduce((sum, id) => sum + (playersDb[id]?.elo || 1200), 0) / winners.length;
        let avgLoserElo = losers.reduce((sum, id) => sum + (playersDb[id]?.elo || 1200), 0) / losers.length;

        const { newWinnerElo, newLoserElo } = updateElo(avgWinnerElo, avgLoserElo);
        const eloGain = newWinnerElo - avgWinnerElo;
        const eloLoss = avgLoserElo - newLoserElo;

        // Aplikujemy punkty z powrotem do poszczególnych graczy
        winners.forEach(id => {
            if(playersDb[id]) {
                playersDb[id].elo += eloGain;
                io.to(id).emit('playerData', playersDb[id]);
            }
        });
        losers.forEach(id => {
            if(playersDb[id]) {
                playersDb[id].elo -= eloLoss;
                io.to(id).emit('playerData', playersDb[id]);
            }
        });

        broadcastLeaderboard();
    }
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.host === socket.id || room.clients.some(c => c.id === socket.id)) {
        io.to(roomId).emit('errorMsg', 'Gr 
