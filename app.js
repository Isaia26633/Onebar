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
// 172.16.3.147:3000 is the url for others at the moment

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

const games = {};// { [gameId]: { players: [{ socketId, id, name, hand: [] }], deck: [], turnIndex: 0 } }

function initGame(gameId = 'default') {
  const deck = createDeck();
  shuffle(deck);
  games[gameId] = {
    players: [],
    deck,
    discardPile: [],
    turnIndex: 0,
    direction: 1, // 1 for clockwise, -1 for counter-clockwise
    started: false
  };
  return games[gameId];
}

// Draw cards from the deck, refilling from discard pile if needed
function drawFromDeck(game, count = 1) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (game.deck.length === 0) {
      // Refill deck from discard pile, but keep the top card on the table
      if (game.discardPile.length > 1) {
        const top = game.discardPile.pop(); // removes the top, shuffles the rest, puts the top back
        const rest = game.discardPile.splice(0);
        game.deck = shuffle(rest);
        game.discardPile = [top];
      } else {
        // No cards to draw
        break;
      }
    }
    if (game.deck.length === 0) break;
    drawn.push(game.deck.pop());
  }
  return drawn;
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
    // validate hand size
    handSize = Number(handSize) || 7;
    if (handSize < 1) handSize = 1;
    // ensure deck is shuffled
    shuffle(game.deck);
    // deal
    for (const player of game.players) {
      player.hand = game.deck.splice(0, handSize);
      io.to(player.socketId).emit('deal', player.hand);
    }
    // Start discard pile with top card (if available)
    if (game.deck.length > 0) {
      const top = game.deck.pop();
      game.discardPile = [top];
      io.to(gameId).emit('cardPlacedOnTable', top);
    } else {
      game.discardPile = [];
    }
    game.turnIndex = 0;
    game.started = true;
    const currentPlayerId = game.players[game.turnIndex].id;
    io.to(gameId).emit('gameStarted', { currentPlayerId, players: game.players.map(p => ({ id: p.id, name: p.name })) });
    console.log('game started', gameId);
  });

  //Handles playing a card
  socket.on('playCard', ({ gameId = 'default', cardId, chosenColor } = {}) => {
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
    const topCard = game.discardPile.length > 0 ? game.discardPile[game.discardPile.length - 1] : null;
    const topActiveColor = topCard ? (topCard.activeColor || topCard.color) : null;

    // Make wilds playable anytime; otherwise gets matched by color/value
    const isWild = card.color === 'wild';
    const matchesColor = topActiveColor && card.color === topActiveColor;
    const matchesValue = topCard && String(card.value) === String(topCard.value);
    const isValidPlay = !topCard || isWild || matchesColor || matchesValue;
    if (!isValidPlay) {
      player.hand.push(card);
      socket.emit('invalidMove', { reason: 'Card doesnt match color or value twin' });
      return;
    }

    if (isWild) {
      const allowed = ['red', 'green', 'blue', 'yellow'];
      if (!chosenColor || !allowed.includes(String(chosenColor).toLowerCase())) {
        chosenColor = 'red';
      } else {
        chosenColor = String(chosenColor).toLowerCase();
      }
      card.activeColor = chosenColor;
    } else {
      card.activeColor = card.color;
    }

    //discards and then plays
    game.discardPile.push(card);
    io.to(gameId).emit('cardPlayed', { playerId: player.id, playerName: player.name, card });
    
    //determines direction
    const playerCount = game.players.length;
    const step = game.direction;
    let nextIndex = ((playerIndex + step ) % playerCount + playerCount ) % playerCount;

    // Handle special cards
    const special = String(card.value).toLowerCase();
    if (special === 'skip' || special === 'skip_2') {
      nextIndex = ((nextIndex + step ) % playerCount + playerCount ) % playerCount;
    } else if ( special === 'draw two' || special === 'draw_two' || special.includes('draw')) {
      const victim = game.players[nextIndex];
      const drawn = drawFromDeck(game, 2);
      victim.hand.push(...drawn);
      io.to(victim.socketId).emit('deal', victim.hand);
      io.to(gameId).emit('playerDrewCards', { playerId: victim.id, count: drawn.length });
      nextIndex = ((nextIndex + step ) % playerCount + playerCount ) % playerCount;
    } else if (special === 'reverse') {
      game.direction = -game.direction;
      if (playerCount === 2) {
        nextIndex = ((playerIndex + game.direction ) % playerCount + playerCount ) % playerCount;
      } else {
        //one step in new direction after reverse
        nextIndex = ((playerIndex + game.direction ) % playerCount + playerCount ) % playerCount;
      }
    } else if (special === 'wild draw four' || special === 'wild_draw_four' || special.includes('draw four')) {
      const victim = game.players[nextIndex];
      const drawn = drawFromDeck(game, 4);
      victim.hand.push(...drawn);
      io.to(victim.socketId).emit('deal', victim.hand);
      io.to(gameId).emit('playerDrew', { playerId: victim.id, count: drawn.length });
      nextIndex = ((nextIndex + step ) % playerCount + playerCount ) % playerCount;
    }
  
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