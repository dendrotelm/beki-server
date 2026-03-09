const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

// Tutaj na render.com koniecznie pozwalamy na "*" dla CORS
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const rooms = {};

function generateRoomId() { 
  return Math.random().toString(36).substring(2, 6).toUpperCase(); 
}

io.on('connection', (socket) => {
  console.log('🔗 Połączono gracza:', socket.id);

  socket.on('createRoom', () => {
    const roomId = generateRoomId();
    rooms[roomId] = { 
      id: roomId, 
      host: socket.id, 
      client: null 
    };
    socket.join(roomId);
    socket.emit('roomCreated', { roomId });
    console.log(`🏠 Utworzono pokój: ${roomId}`);
  });

  socket.on('joinRoom', ({ roomId }) => {
    const id = roomId.toUpperCase();
    const room = rooms[id];
    
    if (room && !room.client) {
      room.client = socket.id;
      socket.join(id);
      socket.emit('joinedRoom', { roomId: id });
      
      // Informujemy obu graczy o starcie gry
      io.to(id).emit('gameStarted');
      console.log(`🎮 Gra startuje w pokoju: ${id}`);
    } else {
      socket.emit('errorMsg', 'Pokój pełny lub nie istnieje!');
    }
  });

  // HOST wysyła kompletny stan gry do KLIENTA
  socket.on('hostState', ({ roomId, state }) => {
    socket.to(roomId).emit('gameState', state);
  });

  // KLIENT wysyła swoje klawisze do HOSTA
  socket.on('clientInput', ({ roomId, input }) => {
    socket.to(roomId).emit('opponentInput', input);
  });

  // Wysłanie "efektów" typu dźwięk/trzęsienie z Hosta do Klienta
  socket.on('gameEvent', ({ roomId, type, power }) => {
    socket.to(roomId).emit('triggerEvent', { type, power });
  });

  socket.on('disconnect', () => {
    // Proste czyszczenie pokoju po wyjściu gracza
    for (const roomId in rooms) {
      if (rooms[roomId].host === socket.id || rooms[roomId].client === socket.id) {
        io.to(roomId).emit('errorMsg', 'Przeciwnik opuścił grę!');
        delete rooms[roomId];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Serwer BEKI działa na porcie ${PORT}!`));
