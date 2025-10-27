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


io.on('connection', (socket) => {
  console.log('a user connected');

  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});

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

//socket.io listener start thing

// const socket = io(AUTH_URL, {
//   extraHeaders: {
//     api: API_KEY
//   }
// });


//Start the server silly
app.listen(port, () => {
  console.log(`app listening at http://localhost:${port}`);
});

//add event listeners for socket.io on for listening to (refer to image)