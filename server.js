const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Servir les fichiers du dossier public (HTML, CSS, images)
app.use(express.static(path.join(__dirname, 'public')));

// État en mémoire des salons et des parties OCHO
const rooms = new Map(); // roomId -> { players: Map(socketId -> player), game: null }

io.on('connection', (socket) => {
  let currentRoom = null;

  // 1. Rejoindre un salon
  socket.on('join_room', ({ roomId, user }) => {
    if (currentRoom) {
      socket.leave(currentRoom);
    }

    currentRoom = roomId.toUpperCase().trim();
    socket.join(currentRoom);

    if (!rooms.has(currentRoom)) {
      rooms.set(currentRoom, { players: new Map(), ochoGame: null });
    }

    const roomData = rooms.get(currentRoom);
    roomData.players.set(socket.id, {
      id: socket.id,
      name: user.name || 'Joueur',
      avatar: user.avatar || '🦉',
      color: user.color || '#e6212b',
      level: user.level || 1
    });

    // Informer le salon de la nouvelle composition
    const playerList = Array.from(roomData.players.values());
    io.to(currentRoom).emit('room_players_updated', playerList);

    // Message système dans le chat du salon
    io.to(currentRoom).emit('chat_message', {
      sender: 'Système',
      text: `${user.name} a rejoint le salon !`,
      isSystem: true
    });
  });

  // 2. Chat en direct du salon
  socket.on('send_chat', ({ text, user }) => {
    if (!currentRoom || !text) return;
    io.to(currentRoom).emit('chat_message', {
      sender: user.name,
      avatar: user.avatar,
      color: user.color,
      text: text,
      isSystem: false,
      senderId: socket.id
    });
  });

  // 3. Envoi de défi (Sowlitaire ou OCHO)
  socket.on('send_challenge', ({ gameName, user }) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('incoming_challenge', {
      from: user.name,
      fromAvatar: user.avatar,
      gameName: gameName
    });
  });

  // 4. Synchronisation multijoueur pour OCHO
  socket.on('ocho_sync_action', (actionData) => {
    if (!currentRoom) return;
    // Relayer l'action (carte jouée, pioche, cri OCHO) à l'adversaire
    socket.to(currentRoom).emit('ocho_peer_action', actionData);
  });

  // 5. Déconnexion
  socket.on('disconnect', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      const roomData = rooms.get(currentRoom);
      const departingUser = roomData.players.get(socket.id);
      roomData.players.delete(socket.id);

      if (roomData.players.size === 0) {
        rooms.delete(currentRoom);
      } else {
        const remaining = Array.from(roomData.players.values());
        io.to(currentRoom).emit('room_players_updated', remaining);
        if (departingUser) {
          io.to(currentRoom).emit('chat_message', {
            sender: 'Système',
            text: `${departingUser.name} a quitté le salon.`,
            isSystem: true
          });
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🦉 Serveur OWL Games opérationnel sur http://localhost:${PORT}`);
});