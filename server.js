const uuid = require('uuid');
const express = require('express');
const WebSocket = require('ws');

const MAX_CONNECTIONS = 8;
const PORT = process.env.PORT || 5555;
const sockets = {};
const server = express()
  .use(express.static(__dirname + '/pub/'))
  .listen(PORT, () => console.log(`Listening on ${PORT}`));

const wss = new WebSocket.Server({
  server
});

class Game {
  constructor() {
    this.players = {};
    // List of player ids in join order.
    this.playerIds = [];
    this.MAX_ACTIVE_PLAYERS = 4;
    this.round = [];
    this.graveyard = [];
    this.abandonedHands = [];
    this.abandonedIds = [];
  }

  addPlayer(player) {
    this.playerIds.push(player.id);
    this.players[player.id] = player;
    if (this.abandonedHands.length) {
      player.hand = this.abandonedHands.pop();
      const abandonedId = this.abandonedIds.pop();
      for (const turn of this.round) {
        if (turn.playerId === abandonedId) {
          turn.playerId = player.id;
        }
      }
    }

    this.sendUpdate();
  }

  takeTurn(playerId, cards) {
    const player = this.players[playerId];
    if (!player || this.playerIds.indexOf(playerId) >= this.MAX_ACTIVE_PLAYERS) {
      return;
    }
    const playableCards = player.playCards(cards);
    this.round.push(new Turn(playerId, playableCards));
    this.sendUpdate();
  }

  rearrange(playerId, cards) {
    const player = this.players[playerId];
    if (!player || this.playerIds.indexOf(playerId) >= this.MAX_ACTIVE_PLAYERS) {
      return;
    }
    player.rearrange(cards);
    this.sendUpdate(playerId);
  }

  newRound() {
    if (this.round.length < 1) {
      return;
    }
    this.graveyard.push(this.round);
    this.round = [];
    this.sendUpdate();
  }

  removePlayerById(playerId) {
    let hand = [];
    if (this.players[playerId]) {
      hand = this.players[playerId].hand;
    }
    delete this.players[playerId];
    const index = this.playerIds.indexOf(playerId);
    if (index >= 0) {
      this.playerIds.splice(index, 1);
    }
    if (this.playerIds.length >= this.MAX_ACTIVE_PLAYERS) {
      // Newly joining player gets quitters hand
      const replacementPlayerId = this.playerIds[this.MAX_ACTIVE_PLAYERS - 1];
      this.players[replacementPlayerId].hand = hand;
      for (const turn of this.round) {
        if (turn.playerId === playerId) {
          turn.playerId = replacementPlayerId;
        }
      }
    } else {
      this.abandonedIds.push(playerId);
      this.abandonedHands.push(hand);
    }
    this.sendUpdate();
  }

  deal(count) {
    this.deck = new Deck();
    this.round = [];
    this.graveyard = [];
    const playerCount = Math.min(this.MAX_ACTIVE_PLAYERS, this.playerIds.length);
    for (let i = 0; i < playerCount; i++) {
      const player = this.players[this.playerIds[i]];
      if (player.name == 'birthday boy') {
        return this.easterDeal(player.id, count);
      }
      player.setHand(this.deck.draw(count));
    }
    this.sendUpdate();
  }

  easterDeal(luckyDog, count) {
    this.deck = new Deck();
    const easterHands = [
      ['C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12', 'C13', 'C1', 'C2'],
      ['C3', 'H3', 'S3', 'D13', 'H13', 'S13', 'D1', 'H1', 'S1', 'C2', 'D2', 'H2', 'S2'],
      ['C3', 'C13', 'D13', 'H13', 'S13', 'C1', 'D1', 'H1', 'S1', 'C2', 'D2', 'H2', 'S2'],
      ['C3', 'C4', 'D4', 'H4', 'S4', 'S6', 'S7', 'S8', 'S9', 'C2', 'D2', 'H2', 'S2'],
    ];
    const easterHand = easterHands[Math.floor(Math.random() * easterHands.length)];
    this.players[luckyDog].setHand(easterHand);
    for (const card of easterHand) {
      this.deck.cards.splice(this.deck.cards.indexOf(card), 1);
    }
    const playerCount = Math.min(this.MAX_ACTIVE_PLAYERS, this.playerIds.length);
    for (let i = 0; i < playerCount; i++) {
      const playerId = this.playerIds[i];
      if (playerId === luckyDog) {
        continue;
      }
      const player = this.players[playerId];
      player.setHand(this.deck.draw(count));
    }
    this.sendUpdate();
  }

  undo(playerId) {
    const lastMove = this.round.pop();
    if (!lastMove) {
      return;
    }
    if (lastMove.playerId != playerId) {
      this.round.push(lastMove);
      return;
    }
    this.players[playerId].hand.push(...lastMove.cards);
    this.sendUpdate();
  }

  sendUpdate(playerId) {
    const playerCount = Math.min(this.MAX_ACTIVE_PLAYERS, this.playerIds.length);
    let c = 0;
    for (const socketId in sockets) {
      if (playerId && playerId !== socketId) {
        continue;
      }
      const socket = sockets[socketId];
      const update = {
        opponents: [],
        player: undefined,
        canUndo: this.round.length > 0 ?
          this.round[this.round.length - 1].playerId === socketId : false,
        lurkers: [],
        round: [],
        graveyard: 0,
      };

      const playerPositions = {};
      const socketIndex = this.playerIds.indexOf(socket.id);
      const isActivePlayer = socketIndex < this.MAX_ACTIVE_PLAYERS;
      const socketPosition = socketIndex % this.MAX_ACTIVE_PLAYERS;
      for (let i = 0; i < playerCount; i++) {
        console.log('updating', i, playerCount);
        const id = this.playerIds[i];
        if (i === socketPosition && isActivePlayer) {
          update.player = this.players[id].getPayload();
          playerPositions[id] = this.MAX_ACTIVE_PLAYERS - 1;
        } else {
          // Keep the same order of players, but vary the orientation to match
          // player's origin.
          const position = (this.MAX_ACTIVE_PLAYERS + (i - socketPosition - 1)) % this.MAX_ACTIVE_PLAYERS;
          playerPositions[id] = position;
          update.opponents.push(this.players[id].getOpponentPayload(position));
        }
      }
      for (let i = playerCount; i < this.playerIds.length; i++) {
        console.log('updating lurks', i);
        update.lurkers.push(this.players[this.playerIds[i]].name);
      }
      for (const turn of this.round) {
        update.round.push({
          cards: turn.cards,
          position: playerPositions[turn.playerId],
        });
      }
      console.log('update', update);
      socket.send(JSON.stringify({
        type: 'update',
        data: update
      }));
    }
  }
}

class Turn {
  constructor(playerId, cards) {
    this.playerId = playerId;
    this.cards = cards;
  }
}

class Deck {
  constructor() {
    this.cards = [];
    for (const suit of ['C', 'D', 'H', 'S']) {
      for (let number = 1; number <= 13; number++) {
        this.cards.push(`${suit}${number}`);
      }
    }
    shuffle(this.cards);
  }

  draw(count) {
    // Take em off the back
    return this.cards.splice(-count, count);
  }
}

class Player {
  constructor(name, id) {
    this.name = name;
    this.id = id;
    this.hand = [];
  }

  setHand(cards = []) {
    this.hand = cards;
  }

  playCards(cards = []) {
    const played = [];
    for (const card of cards) {
      const handIndex = this.hand.indexOf(card);
      if (handIndex >= 0 && played.indexOf(card) < 0) {
        this.hand.splice(handIndex, 1);
        played.push(card);
      }
    }
    played.sort((first, second) => {
      // Get values, adjusted for weight in the game `13`
      const firstValue = (Number(first.substring(1)) + 10) % 13;
      const secondValue = (Number(second.substring(1)) + 10) % 13;
      if (firstValue !== secondValue) {
        return firstValue - secondValue;
      }
      // If the values are equal, compare the suits.
      if (first[0] === second[0]) {
        return 0;
      }
      return first[0] > second[0] ? 1 : -1;
    });
    return played;
  }

  rearrange(cards = []) {
    if (cards.length !== this.hand.length) {
      return;
    }
    const newHand = [];
    for (const card of cards) {
      if (this.hand.indexOf(card) < 0 || newHand.indexOf(card) >= 0) {
        return;
      }
      newHand.push(card);
    }
    this.hand = cards;
  }

  getPayload() {
    return {
      name: this.name,
      hand: this.hand
    };
  }

  getOpponentPayload(position) {
    return {
      name: this.name,
      cardCount: this.hand.length,
      position,
    }
  }
}

function shuffle(array) {
  let currentIndex = array.length;
  let temporaryValue;
  let randomIndex;
  while (currentIndex > 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }
  return array;
}


const game = new Game(wss);
wss.on('connection', (socket) => {
  if (Object.keys(sockets)
    .length >= MAX_CONNECTIONS) {
    socket.terminate();
    return;
  }

  socket.id = uuid.v4();
  console.log('connected', socket.id);
  // Track current connections.
  sockets[socket.id] = socket;

  socket.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data);
    } catch (e) {
      // Bad message syntax
      return;
    }

    switch (message.type) {
      case 'hb':
        socket.send(JSON.stringify({
          type: 'hb',
          data: new Date(),
        }));
        return;
      case 'init':
        console.log('message received', socket.id, message);
        const player = new Player(message.data, socket.id);
        game.addPlayer(player);
        socket.send('init');
        return;
      case 'deal':
        console.log('message received', socket.id, message);
        game.deal(message.data);
        return;
      case 'turn':
        console.log('message received', socket.id, message);
        game.takeTurn(socket.id, message.data);
        return;
      case 'rearrange':
        game.rearrange(socket.id, message.data);
        return;
      case 'undo':
        console.log('message received', socket.id, message);
        game.undo(socket.id);
        return;
      case 'newround':
        console.log('message received', socket.id, message);
        game.newRound();
        return;
    }
  });

  socket.on('error', (error) => {
    console.log('error', error);
  });

  socket.on('close', (data) => {
    console.log('disconnecting');
    delete sockets[socket.id];
    game.removePlayerById(socket.id);
  });
});
