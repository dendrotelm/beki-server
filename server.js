const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const rooms = {};
const playersDb = {}; 

function generateRoomId() { return Math.random().toString(36).substring(2, 6).toUpperCase(); }
function generateGuestName() { return 'Gracz_' + Math.floor(Math.random() * 10000); }

function updateElo(winnerElo, loserElo) {
    const k = 32; 
    const expectedWin = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
    const newWinnerElo = Math.round(winnerElo + k * (1 - expectedWin));
    const newLoserElo = Math.round(loserElo + k * (0 - (1 - expectedWin)));
    return { newWinnerElo, newLoserElo: Math.max(0, newLoserElo) };
}

function broadcastLeaderboard() {
    const topPlayers = Object.values(playersDb).sort((a, b) => b.elo - a.elo).slice(0, 10);
    io.emit('leaderboardData', topPlayers);
}

io.on('connection', (socket) => {
  try {
      if (!playersDb[socket.id]) {
          playersDb[socket.id] = { id: socket.id, name: generateGuestName(), elo: 1200 };
      }

      socket.on('getPlayerData', () => {
        if (playersDb[socket.id]) socket.emit('playerData', playersDb[socket.id]);
      });

      socket.on('getLeaderboard', () => { broadcastLeaderboard(); });

      socket.on('createRoom', (data = {}) => {
        const roomId = generateRoomId();
        const limit = data.limit || 5;
        const is2v2 = !!data.is2v2;
        rooms[roomId] = { id: roomId, host: socket.id, clients: [], is2v2, limit, matchOver: false };
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, role: 'p1' });
      });

      socket.on('joinRoom', (data) => {
        if (!data || !data.roomId) return socket.emit('errorMsg', 'Brak kodu pokoju!');
        const id = data.roomId.toUpperCase();
        const room = rooms[id];
        
        if (room) {
          const maxClients = room.is2v2 ? 3 : 1;
          if (room.clients.length < maxClients) {
            const role = room.is2v2 ? ['p2', 'p3', 'p4'][room.clients.length] : 'p2';
            room.clients.push({ id: socket.id, role });
            socket.join(id);
            socket.emit('joinedRoom', { roomId: id, role });
            io.to(id).emit('lobbyUpdate', { joined: room.clients.length + 1, max: maxClients + 1 });
            if (room.clients.length === maxClients) { io.to(id).emit('gameStarted', { limit: room.limit, is2v2: room.is2v2 }); }
          } else { socket.emit('errorMsg', 'Pokój pełny!'); }
        } else { socket.emit('errorMsg', 'Pokój nie istnieje!'); }
      });

      socket.on('hostState', (data) => { if(data && data.roomId && data.state) socket.to(data.roomId).emit('gameState', data.state); });
      socket.on('clientInput', (data) => { if(data && data.roomId) socket.to(data.roomId).emit('opponentInput', { role: data.role, input: data.input }); });
      socket.on('gameEvent', (data) => { if(data && data.roomId) socket.to(data.roomId).emit('triggerEvent', data); });
      socket.on('chatMessage', (msg) => { if(msg && msg.roomId) io.to(msg.roomId).emit('chatMessage', msg); });

      socket.on('matchComplete', (data) => {
        if (!data || !data.roomId || !data.winnerTeam) return;
        const room = rooms[data.roomId];
        if (room && !room.matchOver) {
            room.matchOver = true; 
            let teamA = [room.host]; let teamB = [];
            room.clients.forEach(c => { if(c.role === 'p3') teamA.push(c.id); else teamB.push(c.id); });
            const winners = data.winnerTeam === 'a' ? teamA : teamB;
            const losers = data.winnerTeam === 'a' ? teamB : teamA;

            let avgWinnerElo = winners.length > 0 ? winners.reduce((sum, id) => sum + (playersDb[id]?.elo || 1200), 0) / winners.length : 1200;
            let avgLoserElo = losers.length > 0 ? losers.reduce((sum, id) => sum + (playersDb[id]?.elo || 1200), 0) / losers.length : 1200;

            const { newWinnerElo, newLoserElo } = updateElo(avgWinnerElo, avgLoserElo);
            winners.forEach(id => { if(playersDb[id]) { playersDb[id].elo += (newWinnerElo - avgWinnerElo); io.to(id).emit('playerData', playersDb[id]); } });
            losers.forEach(id => { if(playersDb[id]) { playersDb[id].elo -= (avgLoserElo - newLoserElo); io.to(id).emit('playerData', playersDb[id]); } });
            broadcastLeaderboard();
        }
      });

      socket.on('disconnect', () => {
        for (const roomId in rooms) {
          const room = rooms[roomId];
          if (room.host === socket.id || room.clients.some(c => c.id === socket.id)) {
            io.to(roomId).emit('errorMsg', 'Gracz opuścił grę! Pokój zamknięty.');
            delete rooms[roomId];
          }
        }
      });
  } catch(err) { console.error("Critical Socket Error: ", err); }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serwer działa na porcie ${PORT}`)); 
