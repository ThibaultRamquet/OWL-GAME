const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

// --- MOTEUR OCHO CÔTÉ SERVEUR ---
const UNOWL_COLORS = ['red', 'blue', 'green', 'yellow'];
const UNOWL_SPECIALS = ['skip', 'reverse', 'draw2'];

function buildOchoDeck() {
  const cards = [];
  let idCounter = 1;
  UNOWL_COLORS.forEach(color => {
    cards.push({ id: idCounter++, color, value: 0, type: 'number', label: '0' });
    for (let i = 1; i <= 9; i++) {
      cards.push({ id: idCounter++, color, value: i, type: 'number', label: `${i}` });
      cards.push({ id: idCounter++, color, value: i, type: 'number', label: `${i}` });
    }
    UNOWL_SPECIALS.forEach(act => {
      const symbolMap = { skip: '🚫', reverse: '🔁', draw2: '+2' };
      cards.push({ id: idCounter++, color, value: act, type: act, label: symbolMap[act] });
      cards.push({ id: idCounter++, color, value: act, type: act, label: symbolMap[act] });
    });
  });
  for (let i = 0; i < 4; i++) {
    cards.push({ id: idCounter++, color: 'wild', value: 'wild', type: 'wild', label: '🌈' });
    cards.push({ id: idCounter++, color: 'wild', value: 'draw4', type: 'draw4', label: '+4' });
  }
  
  // Mélange du paquet (Algorithme de Fisher-Yates)
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join_room', ({ roomId, user }) => {
    if (currentRoom) socket.leave(currentRoom);
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

    const playerList = Array.from(roomData.players.values());
    io.to(currentRoom).emit('room_players_updated', playerList);
    io.to(currentRoom).emit('chat_message', { sender: 'Système', text: `${user.name} a rejoint le salon !`, isSystem: true });
  });

  socket.on('send_chat', ({ text, user }) => {
    if (!currentRoom || !text) return;
    io.to(currentRoom).emit('chat_message', { sender: user.name, avatar: user.avatar, color: user.color, text: text, isSystem: false, senderId: socket.id });
  });

  // --- DÉMARRER UNE VRAIE PARTIE OCHO MULTIJOUEUR ---
  socket.on('start_ocho_match', () => {
    if (!currentRoom || !rooms.has(currentRoom)) return;
    const roomData = rooms.get(currentRoom);
    const players = Array.from(roomData.players.values());

    // Vérification : Il faut 2 joueurs
    if (players.length < 2) {
      socket.emit('chat_message', { sender: 'Système', text: 'Il faut être 2 joueurs dans le salon pour lancer OCHO !', isSystem: true });
      return;
    }

    // 1. Création et mélange du paquet sur le serveur
    let deck = buildOchoDeck();
    let discardPile = [];
    
    // 2. Distribution (7 cartes chacun)
    const player1 = players[0];
    const player2 = players[1];
    const hand1 = deck.splice(-7, 7);
    const hand2 = deck.splice(-7, 7);

    // 3. Première carte posée au centre
    let initialCard = deck.pop();
    while (initialCard.color === 'wild' || initialCard.type !== 'number') {
      deck.unshift(initialCard);
      initialCard = deck.pop();
    }
    discardPile.push(initialCard);

    // 4. Sauvegarde de la partie dans la mémoire du serveur
    roomData.ochoGame = {
      deck: deck,
      discardPile: discardPile,
      currentColor: initialCard.color,
      turnId: player1.id, // Le joueur 1 commence
      playersData: {
        [player1.id]: { hand: hand1 },
        [player2.id]: { hand: hand2 }
      },
      stackPenalty: 0
    };

    // 5. Envoi des données à chaque joueur de manière individuelle
    io.sockets.sockets.get(player1.id)?.emit('ocho_game_started', {
      myHand: hand1,
      opponentCount: 7,
      topCard: initialCard,
      currentColor: initialCard.color,
      isMyTurn: true,
      deckCount: deck.length
    });

    io.sockets.sockets.get(player2.id)?.emit('ocho_game_started', {
      myHand: hand2,
      opponentCount: 7,
      topCard: initialCard,
      currentColor: initialCard.color,
      isMyTurn: false,
      deckCount: deck.length
    });

    io.to(currentRoom).emit('chat_message', { sender: 'Système', text: 'La partie de OCHO commence !', isSystem: true });
  });

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
          io.to(currentRoom).emit('chat_message', { sender: 'Système', text: `${departingUser.name} a quitté le salon.`, isSystem: true });
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🦉 Serveur OWL Games opérationnel sur http://localhost:${PORT}`);
});