const uuid = require('uuid');
const express = require('express');
const WebSocket = require('ws');

const MAX_CONNECTIONS = 8;
const MAX_ACTIVE_PLAYERS = 4;
const PORT = process.env.PORT || 5555;
const EASTER_NAMES = {
  'lucky dog': 1,
  'its my birthday': 1,
  'it\'s my birthday': 1,
};

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
    this.activePlayers = [];
    this.lurkers = [];
    this.round = [];
    this.graveyard = [];
    this.started = false;
  }

  isActivePlayer(playerId) {
    return this.activePlayers.indexOf(playerId) >= 0;
  }

  addPlayer(player) {
    this.players[player.id] = player;
    if (this.activePlayers.length < MAX_ACTIVE_PLAYERS && !this.started) {
      this.activePlayers.push(player.id);
    } else {
      this.lurkers.push(player.id);
    }
    this.sendUpdate();
  }

  takeTurn(playerId, cards, x, y) {
    const player = this.players[playerId];
    if (!player || !this.isActivePlayer(playerId)) {
      return;
    }
    const playableCards = player.playCards(cards);
    this.round.push(new Turn(playerId, playableCards, x, y));
    this.sendUpdate();
  }

  moveTurn(playerId, turnId, x, y) {
    const player = this.players[playerId];
    if (!player || !this.isActivePlayer(playerId)) {
      return;
    }
    const turn = this.round.find((turn) => turn.id == turnId);
    if (turn) {
      turn.x = x;
      turn.y = y;
    }
    this.sendUpdate();
  }

  rearrange(playerId, cards) {
    const player = this.players[playerId];
    if (!player) {
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

  sit(playerId, abandonedId) {
    const player = this.players[playerId];
    if (!player || this.isActivePlayer(playerId)) {
      console.log(`${playerId} is trying to sit, but ${!player ? 'doesnt exist' : 'is already playing'}`);
      return;
    }

    if (!abandonedId) {
      // Try to join the game, if there's room.
      if (this.activePlayers.length < MAX_ACTIVE_PLAYERS) {
        this.activePlayers.push(playerId);
        const lurkIndex = this.lurkers.indexOf(playerId);
        if (lurkIndex >= 0) {
          this.lurkers.splice(lurkIndex, 1);
        }
        this.sendUpdate();
      }
      return;
    }

    const abandonedPlayer = this.players[abandonedId];
    const abandonedIndex = this.activePlayers.indexOf(abandonedId);
    if (!abandonedPlayer || !abandonedPlayer.abandoned || abandonedIndex < 0) {
      console.log(`${playerId} is trying to sit in a weird spot (${abandonedId}).`);
      return;
    }

    // Take things over from the abandoned spot.
    this.players[playerId].setHand(abandonedPlayer.hand);
    const rounds = [this.round, ...this.graveyard];
    for (const round of rounds) {
      for (const turn of round) {
        if (turn.playerId === abandonedId) {
          turn.playerId = playerId;
        }
      }
    }
    this.activePlayers.splice(abandonedIndex, 1, playerId);
    this.removePlayerById(abandonedId);
    const lurkIndex = this.lurkers.indexOf(playerId);
    if (lurkIndex >= 0) {
      this.lurkers.splice(lurkIndex, 1);
    }
    this.sendUpdate();
  }

  abandon(playerId) {
    const player = this.players[playerId];
    if (!player) {
      return;
    }
    if (this.isActivePlayer(playerId)) {
      player.abandon();
    } else {
      this.removePlayerById(playerId);
    }
    this.sendUpdate();
  }

  removePlayerById(playerId) {
    console.log(`Removing player: ${playerId}`);
    delete this.players[playerId];
    const index = this.lurkers.indexOf(playerId);
    if (index >= 0) {
      this.lurkers.splice(index, 1);
    } else if (this.isActivePlayer(playerId)) {
      this.activePlayers.splice(this.activePlayers.indexOf(playerId), 1);
    }
  }

  deal(gameType) {
    const isDurak = gameType == 'д';
    const count = isDurak ? 6 : Number(gameType);
    this.started = true;
    this.deck = new Deck(isDurak);
    this.round = [];
    this.graveyard = [];
    for (const playerId of this.activePlayers) {
      const player = this.players[playerId];
      if (player.abandoned) {
        this.removePlayerById(playerId);
        this.deal(gameType);
        return;
      }
      player.setHand(this.deck.draw(count));
    }
    this.sendUpdate();
  }

  draw(playerId) {
    const player = this.players[playerId];
    if (!this.isActivePlayer(playerId) || !player || this.deck.cards.length <= 0) {
      return;
    }
    player.hand.push(...this.deck.draw(1));
    this.sendUpdate();
  }

  pickup(playerId, turnIds = [], position) {
    if (!this.isActivePlayer(playerId)) {
      return;
    }
    const turns = this.round.filter((turn) => turnIds.includes(turn.id));
    this.round = this.round.filter((turn) => !turnIds.includes(turn.id));
    const newCards = [];
    for (const turn of turns) {
      newCards.push(...turn.cards);
    }
    const hand = this.players[playerId].hand;
    hand.splice(position, 0, ...newCards);
    this.sendUpdate();
  }

  sendUpdate(playerId) {
    let c = 0;
    for (const socketId in sockets) {
      if (playerId && playerId !== socketId) {
        continue;
      }
      const socket = sockets[socketId];
      const update = {
        opponents: [],
        player: undefined,
        lurkers: [],
        round: [],
        graveyard: [],
      };

      if (this.deck) {
        update.deck = this.deck.getPayload();
      }

      const playerPositions = {};
      const playerIndex = this.activePlayers.indexOf(socket.id);
      for (let i = 0; i < this.activePlayers.length; i++) {
        const id = this.activePlayers[i];
        if (i === playerIndex) {
          update.player = this.players[id].getPayload();
          playerPositions[id] = MAX_ACTIVE_PLAYERS - 1;
        } else {
          // Keep the same order of players, but vary the orientation to match
          // player's origin.
          const position = (MAX_ACTIVE_PLAYERS + (i - playerIndex - 1)) % MAX_ACTIVE_PLAYERS;
          playerPositions[id] = position;
          update.opponents.push(this.players[id].getOpponentPayload(position));
        }
      }
      for (let i = 0; i < this.lurkers.length; i++) {
        update.lurkers.push(this.players[this.lurkers[i]].name);
      }
      for (const turn of this.round) {
        const turnData = {
          cards: turn.cards,
          id: turn.id,
          position: playerPositions[turn.playerId],
        };
        if (turn.x !== undefined) {
          turnData.x = turn.x;
          turnData.y = turn.y;
        }
        update.round.push(turnData);
      }
      socket.send(JSON.stringify({
        type: 'update',
        data: update
      }));
    }
  }
}

class Turn {
  constructor(playerId, cards, x, y) {
    this.playerId = playerId;
    this.cards = cards;
    this.id = cards.join('');
    this.x = x;
    this.y = y;
  }
}

class Deck {
  constructor(durak = false) {
    this.cards = [];
    this.showLastCard = durak;
    for (const suit of ['C', 'D', 'H', 'S']) {
      for (let number = 1; number <= 13; number++) {
        if (durak && number >= 2 && number <= 5) {
          continue;
        }
        this.cards.push(`${suit}${number}`);
      }
    }
    shuffle(this.cards);
  }

  draw(count) {
    // Take em off the back
    return this.cards.splice(-count, count);
  }

  getPayload() {
    const payload = {
      count: this.cards.length
    };

    if (this.showLastCard) {
      payload.last = this.cards[0];
    }

    return payload;
  }
}

class Player {
  constructor(name, id) {
    this.name = name;
    this.id = id;
    this.hand = [];
  }

  abandon() {
    this.abandoned = true;
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
    // Play em as they lay
    // played.sort((first, second) => {
    //   // Get values, adjusted for weight in the game `13`
    //   const firstValue = (Number(first.substring(1)) + 10) % 13;
    //   const secondValue = (Number(second.substring(1)) + 10) % 13;
    //   if (firstValue !== secondValue) {
    //     return firstValue - secondValue;
    //   }
    //   // If the values are equal, compare the suits.
    //   if (first[0] === second[0]) {
    //     return 0;
    //   }
    //   return first[0] > second[0] ? 1 : -1;
    // });
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
      hand: this.hand,
    };
  }

  getOpponentPayload(position) {
    const payload = {
      name: this.name,
      cardCount: this.hand.length,
      position,
    };
    if (this.abandoned) {
      payload.id = this.id;
    }
    return payload;
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

const fullLogMessageTypes = {
  init: true,
  sit: true,
  deal: true,
  draw: true,
  turn: true,
  pickup: true,
  rearrange: false,
  rearrangesurface: true,
  newround: true,
};

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

    if (message.type in fullLogMessageTypes) {
      const logData = fullLogMessageTypes[message.type] ? message : message.type;
      console.log('message received', socket.id, logData);
    }

    switch (message.type) {
      case 'hb':
        socket.send(JSON.stringify({
          type: 'hb',
          data: new Date(),
        }));
        return;
      case 'init':
        const player = new Player(message.data, socket.id);
        socket.send('init');
        game.addPlayer(player);
        return;
      case 'sit':
        game.sit(socket.id, message.data);
        return;
      case 'deal':
        game.deal(message.data);
        return;
      case 'draw':
        game.draw(socket.id);
        return;
      case 'pickup':
        game.pickup(socket.id, message.data.turnIds, message.data.index);
        return;
      case 'turn':
        const turn = message.data;
        game.takeTurn(socket.id, turn.cards, turn.x, turn.y);
        return;
      case 'rearrange':
        game.rearrange(socket.id, message.data);
        return;
      case 'rearrangesurface':
        const moveTurn = message.data;
        game.moveTurn(socket.id, moveTurn.turnId, moveTurn.x, moveTurn.y);
        return;
      case 'newround':
        game.newRound();
        return;
    }
  });

  socket.on('error', (error) => {
    console.log(`error ${socket.id}: `, error);
  });

  socket.on('close', (data) => {
    console.log(`disconnecting ${socket.id}`, data);
    delete sockets[socket.id];
    game.abandon(socket.id);
  });
});
