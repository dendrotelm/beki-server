const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const rooms = {};
function generateRoomId() { return Math.random().toString(36).substring(2, 6).toUpperCase(); }

io.on('connection', (socket) => {
  socket.on('createRoom', ({ limit, is2v2 }) => {
    const roomId = generateRoomId();
    rooms[roomId] = { id: roomId, host: socket.id, clients: [], is2v2, limit };
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

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.host === socket.id || room.clients.some(c => c.id === socket.id)) {
        io.to(roomId).emit('errorMsg', 'Gracz opuścił grę! Pokój zamknięty.');
        delete rooms[roomId];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serwer działa na porcie ${PORT}`)); 
