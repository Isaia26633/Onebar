//Imports
const express = require('express');
const app = express();
const path = require('path');
const ejs = require('ejs');
const socketIO = require('socket.io');
const http = require('http');
const server = http.createServer(app);
const io = socketIO(server);
const port = 3000

const {createDeck, shuffle} = require('./cards');

//Middleware
app.set('view engine', 'ejs');
app.use(express.static('public'));

//Routes
app.get('/', (req, res) => {
  res.render('index.ejs')
});

app.get('/game', (req, res) => {
  res.render('game.ejs')
});

const games = {}; // { [gameId]: { players: [{ socketId, id, name, hand: [] }], deck: [], turnIndex: 0 } }

function initGame(gameId = 'default') {
  const deck = createDeck();
  shuffle(deck);
  games[gameId] = {
    players: [],
    deck,
    turnIndex: 0,
    started: false
  };
  return games[gameId];
}

io.on('connection', (socket) => {
  console.log('a user connected:', socket.id);

  socket.on('joinGame', ({ playerName = 'Anonymous', gameId = 'default' }) => {
    const game = games[gameId] || initGame(gameId);
    const player = {
      socketId: socket.id,
      id: socket.id, // use socket id as player id for simplicity until formbar login is added
      name: playerName,
      hand: []
    };
    //Add players to the game
    game.players.push(player);
    socket.join(gameId);
    socket.emit('joined', { playerId: player.id, gameId });
    io.to(gameId).emit('playerList', game.players.map(p => ({ id: p.id, name: p.name })));
    console.log(`${playerName} joined game ${gameId}`);
  });

   socket.on('startGame', ({ gameId = 'default', handSize = 7 } = {}) => {
    const game = games[gameId] || initGame(gameId);
    if (game.started) return;
    if (game.players.length === 0) return;
    // ensure deck is shuffled
    shuffle(game.deck);
    // deal
    for (const player of game.players) {
      player.hand = game.deck.splice(0, handSize);
      io.to(player.socketId).emit('deal', player.hand);
    }
    game.turnIndex = 0;
    game.started = true;
    const currentPlayerId = game.players[game.turnIndex].id;
    io.to(gameId).emit('gameStarted', { currentPlayerId, players: game.players.map(p => ({ id: p.id, name: p.name })) });
    console.log('game started', gameId);
  });

  //Handles playing a card
  socket.on('playCard', ({ gameId = 'default', cardId }) => {
    const game = games[gameId];
    if (!game || !game.started) {
      socket.emit('invalidMove', { reason: 'Game not started' });
      return;
    }
    //Handles turn order and card validation
    const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
    if (playerIndex === -1) {
      socket.emit('invalidMove', { reason: 'Not in game' });
      return;
    }
    if (playerIndex !== game.turnIndex) {
      socket.emit('invalidMove', { reason: 'Not your turn' });
      return;
    }
    const player = game.players[playerIndex];
    const cardIndex = player.hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) {
      socket.emit('invalidMove', { reason: 'Card not in hand' });
      return;
    }
    //Handles putting a card down
    const [card] = player.hand.splice(cardIndex, 1);
    // Example: put card on table (we just broadcast the play)
    io.to(gameId).emit('cardPlayed', { playerId: player.id, card });
    // Handles advancing turn
    game.turnIndex = (game.turnIndex + 1) % game.players.length;
    const nextPlayerId = game.players[game.turnIndex].id;
    io.to(gameId).emit('turnChanged', { currentPlayerId: nextPlayerId });
  });

    socket.on('disconnect', () => {
    console.log('user disconnected', socket.id);
    // remove player from games
    for (const [gameId, game] of Object.entries(games)) {
      const idx = game.players.findIndex(p => p.socketId === socket.id);
      if (idx !== -1) {
        const [removed] = game.players.splice(idx, 1);
        io.to(gameId).emit('playerList', game.players.map(p => ({ id: p.id, name: p.name })));
        // if it was their turn, advance
        if (game.started && game.players.length > 0) {
          game.turnIndex = game.turnIndex % game.players.length;
          io.to(gameId).emit('turnChanged', { currentPlayerId: game.players[game.turnIndex].id });
        } else {
          game.started = false;
        }
      }
    }
  });
});
//Start the server silly
server.listen(port, () => {
  console.log(`app listening at http://localhost:${port}`);
});