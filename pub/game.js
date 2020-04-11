const suitNumber = {
  C: 0,
  D: 1,
  H: 2,
  S: 3,
};

const images = {};
for (const suit in suitNumber) {
  if (!suitNumber.hasOwnProperty(suit)) {
    continue;
  }
  for (let number = 1; number <= 13; number++) {
    const value = `${suit}${number}`;
    images[value] = `url('img/${value}.svg')`;
  }
}

const MIN_DRAG_DISTANCE = 30;
const MAX_ACTIVE_PLAYERS = 4;
const LOCAL_PLAYER = MAX_ACTIVE_PLAYERS - 1;
const GHOST_OPPONENT = 'ghost_opponent';

class Game {
  constructor(container) {
    this.opponents = [];
    this.deck = new Deck();
    this.hand = new Hand();
    this.surface = new Surface();
    this.container = container;
    this.lurkers = new Lurkers();
    this.menu = new Menu(container);
    this.isActivePlayer = false;
    const hand = this.hand.getElement();
    const menu = this.menu.getElement();
    const surface = this.surface.getElement();
    const deck = this.deck.getElement();

    container.appendChild(surface);
    container.appendChild(hand);
    container.appendChild(this.lurkers.getElement());
    container.appendChild(menu);
    container.appendChild(deck);

    container.addEventListener('sit', (event) => {
      if (!this.server) {
        return;
      }
      const payload = {
        type: 'sit'
      };
      if (event.detail !== GHOST_OPPONENT) {
        payload.data = event.detail;
      }
      this.server.send(JSON.stringify(payload));
    });

    surface.addEventListener('rearrangeSurface', (event) => {
      this.server.send(JSON.stringify({
        type: 'rearrangesurface',
        data: event.detail.drag.getMessage(event.detail.x, event.detail.y),
      }));
    });

    surface.addEventListener('takeTurn', (event) => {
      this.hand.removeCards(event.detail.drag.cards);
      this.server.send(JSON.stringify({
        type: 'turn',
        data: event.detail.drag.getMessage(event.detail.x, event.detail.y),
      }));
    });

    surface.addEventListener('startDrag', (event) => {
      this.startDrag(event.detail);
    });

    hand.addEventListener('startDrag', (event) => {
      this.startDrag(event.detail);
    });

    hand.addEventListener('rearrange', (event) => {
      if (!this.server) {
        return;
      }
      this.server.send(JSON.stringify({
        type: 'rearrange',
        data: event.detail.map(card => card.value),
      }));
    });

    hand.addEventListener('pickup', (event) => {
      if (!this.server) {
        return;
      }
      this.server.send(JSON.stringify({
        type: 'pickup',
        data: event.detail,
      }));
    });

    menu.addEventListener('deal', (event) => {
      if (!this.server) {
        return;
      }
      this.server.send(JSON.stringify({
        type: 'deal',
        data: event.detail,
      }));
    });

    menu.addEventListener('newround', () => {
      if (!this.server) {
        return;
      }
      this.server.send(JSON.stringify({
        type: 'newround',
      }));
    });

    deck.addEventListener('draw', () => {
      if (!this.server || !this.isActivePlayer) {
        return;
      }
      this.server.send(JSON.stringify({
        type: 'draw',
      }));
    });
  }

  setServer(server) {
    this.server = server;
    server.addEventListener('message', (event) => {
      let update;
      try {
        const data = JSON.parse(event.data);
        update = data.data;
        if (data.type !== 'update' || !update) {
          return;
        }
      } catch (e) {
        // parse failed;
        return;
      }
      console.log('update received', update);
      this.isActivePlayer = !!update.player;
      this.container.classList.toggle('is-lurking', !this.isActivePlayer);
      if (this.isActivePlayer) {
        this.hand.onStateChange(update.player);
      } else if (this.hand.cards.length > 0) {
        this.hand.setCards([]);
      }
      this.deck.onStateChange(update.deck);
      this.surface.onStateChange(update.round);
      this.lurkers.onStateChange(update.lurkers);
      this.setOpponents(update.opponents);
    });
  }

  reset() {
    if (this.hand.cards.length > 0) {
      this.hand.setCards([]);
    }
    this.surface.onStateChange();
    this.lurkers.onStateChange();
    for (const opponent of this.opponents) {
      this.container.removeChild(opponent.getElement());
    }
    this.opponents = [];
  }

  startDrag(createDrag) {
    const surface = this.surface.getElement();
    const hand = this.hand.getElement();

    let drag;
    let offset = {
      x: 0,
      y: 0
    };
    let firstPosition;
    let currentArea;
    const dropzone = {
      surface: surface.getBoundingClientRect(),
      hand: hand.getBoundingClientRect(),
      table: this.container.getBoundingClientRect(),
    };

    const enterArea = (area) => {
      if (!area || currentArea === area) {
        return;
      }
      leaveArea();
      currentArea = area;
      currentArea.classList.add('dropzone');
    };
    const leaveArea = () => {
      if (!currentArea) {
        return;
      }
      currentArea.classList.remove('dropzone');
      currentArea = undefined;
    };
    const inArea = (bounds, mouseEvent) => {
      return mouseEvent.pageX >= bounds.left && mouseEvent.pageX <= bounds.right &&
        mouseEvent.pageY >= bounds.top && mouseEvent.pageY <= bounds.bottom;
    };

    const onMouseMove = (mouseEvent) => {
      if (!drag) {
        if (!firstPosition) {
          firstPosition = {
            x: mouseEvent.pageX,
            y: mouseEvent.pageY
          };
          return;
        }
        const distance = Math.abs(mouseEvent.pageX - firstPosition.x) + Math.abs(mouseEvent.pageY - firstPosition.y);
        if (distance > MIN_DRAG_DISTANCE) {
          drag = createDrag();
          if (!drag) {
            onMouseUp();
            return;
          }
          const dragElement = drag.getElement();
          this.container.appendChild(dragElement);
          const dragRect = dragElement.getBoundingClientRect();
          offset = {
            x: Math.floor(dragRect.width) / 2,
            y: Math.floor(dragRect.height) / 2
          };
        } else {
          return;
        }
      }


      drag.setPosition(
        mouseEvent.pageX,
        mouseEvent.pageY,
        offset,
        dropzone.table.width,
        dropzone.table.height,
        dropzone.surface.width);
      if (inArea(dropzone.surface, mouseEvent)) {
        enterArea(surface);
      } else if (inArea(dropzone.hand, mouseEvent)) {
        enterArea(hand);
        this.hand.setSortPosition(mouseEvent.pageX - dropzone.hand.x, dropzone.hand.width);
      } else {
        leaveArea();
      }
    };

    const onMouseUp = (mouseEvent) => {
      const inSurface = currentArea === surface;
      const inHand = currentArea === hand;
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('mouseleave', onMouseUp);
      document.removeEventListener('mousemove', onMouseMove);
      leaveArea();

      if (!drag) {
        return;
      }
      this.surface.selectAll(false);
      drag.getElement()
        .remove();
      if (inSurface) {
        const x = (mouseEvent.pageX - dropzone.surface.left) / dropzone.surface.width;
        const y = (mouseEvent.pageY - dropzone.surface.top) / dropzone.surface.height;
        this.surface.drop(drag, x, y);
      }
      if (inHand) {
        this.hand.drop(drag);
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('mouseleave', onMouseUp);
  }

  setOpponents(opponentStates = []) {
    const opponentCount = opponentStates.length;
    if (opponentCount < MAX_ACTIVE_PLAYERS) {
      const openSlots = [];
      for (let i = 0; i < MAX_ACTIVE_PLAYERS; i++) {
        if (opponentStates.find((el) => el.position === i)) {
          continue;
        }
        openSlots.push(i);
      }
      for (let i = 0; i < MAX_ACTIVE_PLAYERS - opponentCount; i++) {
        opponentStates.push({
          name: '',
          id: GHOST_OPPONENT,
          position: openSlots.shift(),
          cardCount: 0
        });
      }
    }
    for (let i = 0; i < opponentStates.length; i++) {
      if (!this.opponents[i]) {
        const opponent = new Opponent(opponentStates[i], this.container);
        this.opponents[i] = opponent;
        this.container.appendChild(opponent.getElement());
      } else {
        this.opponents[i].update(opponentStates[i]);
      }
    }
  }
}

class Menu {
  constructor(container) {
    this.container = container;
  }

  createDealOption(dealValue, dialog, dispatcher) {
    const button = createElement('dialog-button', dialog);
    button.innerText = dealValue;
    button.addEventListener('click', () => {
      dialog.classList.add('hidden');
      dispatcher.dispatchEvent(new CustomEvent('deal', {
        detail: dealValue
      }));
    });
  }

  getElement() {
    if (!this.element) {
      const element = createElement('controls-central');

      const dealMenu = createElement('dialog deal-menu hidden', this.container);
      this.createDealOption(13, dealMenu, element);
      this.createDealOption('д', dealMenu, element);
      const cancelButton = createElement('dialog-button', dealMenu);
      cancelButton.innerText = 'Cancel';
      cancelButton.addEventListener('click', () => {
        dealMenu.classList.add('hidden');
      });

      const clearButton = createElement('button', element);
      clearButton.innerText = 'clear table';
      clearButton.addEventListener('click', () => {
        element.dispatchEvent(new Event('newround'));
      });

      const dealButton = createElement('button', element);
      dealButton.innerText = 'deal';
      dealButton.addEventListener('click', () => {
        dealMenu.classList.remove('hidden');
      });
      this.element = element;
    }
    return this.element;
  }
}

class Surface {
  constructor() {
    this.round = [];
  }

  getElement() {
    if (!this.element) {
      const element = createElement('surface');
      element.addEventListener('drop', (event) => {
        const cards = [];
      });
      this.element = element;
    }
    return this.element;
  }

  selectAll(selected) {
    this.getElement()
      .classList.remove('dragging');
    for (const turn of this.round) {
      turn.select(selected);
    }
  }

  drop(drag, x, y) {
    if (drag.turns && drag.turns.length > 1) {
      // Multiple selected turns do not get moved at once.
      return;
    }

    this.getElement()
      .dispatchEvent(new CustomEvent(
        drag.turns ? 'rearrangeSurface' : 'takeTurn', {
          detail: {
            drag,
            x,
            y
          }
        }));
  }

  createDrag(dragEvent) {
    const element = this.getElement();
    const elements = element.getElementsByClassName('selected');
    const turns = [];
    const cards = [];
    const targetTurn = dragEvent.target.__turn || dragEvent.target.parentElement.__turn;
    let addTarget = true;
    for (const el of elements) {
      if (el.__turn) {
        const turn = el.__turn;
        turns.push(turn);
        if (turn === targetTurn) {
          addTarget = false;
        }
      }
    }
    if (addTarget && targetTurn) {
      turns.push(targetTurn);
      targetTurn.select(true);
    }
    if (turns.length <= 0) {
      return;
    }
    element.classList.add('dragging');
    for (const turn of turns) {
      for (const card of turn.cards) {
        cards.push(card.clone());
      }
    }
    return new Drag(cards, dragEvent.pageX, dragEvent.pageY, turns);
  }

  onStateChange(round = []) {
    const element = this.getElement();
    if (this.round.length > round.length) {
      this.round = [];
      element.innerHTML = '';
    }
    for (let i = 0; i < round.length; i++) {
      const turn = this.round[i];
      if (turn) {
        if (turn.equalsState(round[i])) {
          continue;
        } else {
          turn.getElement()
            .remove();
        }
      }
      const update = new Turn(
        round[i].cards.map(card => new Card(card)),
        round[i].position,
        round[i].id,
        round[i].x,
        round[i].y);
      this.round[i] = update;
      const updateElement = update.getElement();
      element.appendChild(updateElement);
      updateElement.addEventListener('selectAll', (event) => {
        this.selectAll(event.detail);
      });
      updateElement.addEventListener('mousedown', (event) => {
        element.dispatchEvent(new CustomEvent('startDrag', {
          detail: () => {
            return this.createDrag(event);
          }
        }));
      });
    }
  }
}

const rotationInPosition = {
  0: 270,
  1: 180,
  2: 90,
  3: 0,
};

class Deck {
  constructor() {
    this.bottomCard = new Card();
    this.count = 0;
  }

  onStateChange(deck = {}) {
    const last = deck.last;
    let count = deck.count || 0;
    this.bottomCard.updateValue(last);
    if (last) {
      count -= 1;
    }
    const element = this.getElement();
    for (let i = this.count; i > count; i--) {
      element.lastChild.remove();
    }
    for (let i = this.count; i < count; i++) {
      const card = createElement('card-closed card', element);
      card.style.transform = getFussedTransform(i);
    }
    this.count = count;
  }

  getElement() {
    if (!this.element) {
      const element = createElement('deck');
      element.appendChild(this.bottomCard.getElement());
      this.element = element;
      element.addEventListener('click', () => {
        element.dispatchEvent(new Event('draw'));
      });
    }
    return this.element;
  }
}

class Turn {
  constructor(cards = [], position = 0, id, x, y) {
    this.cards = cards;
    this.position = position;
    this.id = id;
    this.x = x;
    this.y = y;
  }

  equalsState(state) {
    if (state.cards.length != this.cards.length) {
      return false;
    }
    if (state.position != this.position) {
      return false;
    }
    if (state.x !== this.x || state.y !== this.y) {
      return false;
    }
    for (let i = 0; i < state.cards.length; i++) {
      if (this.cards[i].value != state.cards[i]) {
        return false;
      }
    }
    return true;
  }

  getElement() {
    if (!this.element) {
      const placed = this.x !== undefined;
      const element = createElement('turn');
      element.id = this.id;
      element.__turn = this;
      if (placed) {
        const placement = this.decodePosition(this.x, this.y);
        if (placement.x > .5) {
          element.style.right = `${(1-placement.x) * 100}%`;
        } else {
          element.style.left = `${placement.x * 100}%`;
        }
        element.style.top = `${placement.y * 100}%`;
        element.style.transform = `translate(${element.style.left ? '-' : ''}50%, ${element.style.top ? '-' : ''}50%) rotate(${this.calculateRotation(this.position, this.x)})`;
      } else {
        element.className += `p${this.position}`;
      }
      for (const card of this.cards) {
        card.setMessy(true);
        element.appendChild(card.getElement());
      }

      onDoubleClick(element, () => {
        this.select();
      }, () => {
        const selected = element.classList.contains('selected');
        element.dispatchEvent(new CustomEvent('selectAll', {
          detail: selected
        }));
      });
      this.element = element;
    }
    return this.element;
  }

  select(selected) {
    this.getElement()
      .classList.toggle('selected', selected);
  }

  decodePosition(x, y) {
    switch (this.position) {
      case 0:
        // rotate 90 ccw
        return {
          x: 1 - y,
          y: x
        };
      case 1:
        // rotate 180deg
        return {
          x: 1 - x,
          y: 1 - y
        };
      case 2:
        // rotate 90 cw
        return {
          x: y,
          y: 1 - x
        };
      case 3:
        // no change.
        return {
          x,
          y
        };
    }
  }

  encodePosition(x, y, xMax = 1, yMax = 1) {
    switch (this.position) {
      case 0:
        // rotate 90 cw
        return {
          x: y,
          y: xMax - x
        };
      case 1:
        // rotate 180deg
        return {
          x: xMax - x,
          y: yMax - y
        };
      case 2:
        // rotate 90 ccw
        return {
          x: yMax - y,
          y: x
        };
      case 3:
        // no change.
        return {
          x,
          y
        };
    }
  }

  setSafePosition(element, styleAttribute, percentage) {
    if (styleAttribute === 'left' && percentage > 50) {
      styleAttribute = 'right';
      percentage = 100 - percentage;
    }
    if (styleAttribute === 'right' && percentage > 50) {
      styleAttribute = 'left';
      percentage = 100 - percentage;
    }
    element.style[styleAttribute] = `${percentage}%`;
  }

  calculateRotation(position, x) {
    const startingRotation = rotationInPosition[position];
    return `${startingRotation - (30 - x * 60)}deg`;
  }
}

class Opponent {
  constructor(state, dispatcher) {
    this.dispatcher = dispatcher;
    this.updateName(state.name, state.id);
    this.updateCount(state.cardCount);
    this.updatePosition(state.position);
  }

  getElement() {
    if (!this.element) {
      const element = createElement('opponent');
      this.element = element;
      this.nameElement = createElement('name', element);
      this.nameElement.addEventListener('click', () => {
        if (this.id) {
          this.dispatcher.dispatchEvent(new CustomEvent('sit', {
            detail: this.id,
          }));
        }
      });
    }
    return this.element;
  }

  update(state) {
    this.updateCount(state.cardCount);
    this.updateName(state.name, state.id);
    this.updatePosition(state.position);
  }

  updateCount(count) {
    if (this.cardCount === count) {
      return;
    }
    const element = this.getElement();
    if (this.cardCount > count) {
      while (element.childElementCount - 1 > count) {
        element.removeChild(element.lastChild);
      }
    } else {
      while (element.childElementCount - 1 < count) {
        const card = createElement('card-closed card', element);
      }
    }
    this.cardCount = count;
  }

  updateName(name, id) {
    if (this.name === name && this.id === id) {
      return;
    }
    this.name = name;
    this.id = id;
    let label = name;
    if (id) {
      label = id === GHOST_OPPONENT ? '(empty seat)' : `(${name}'s empty seat)`;
    }
    this.getElement(); // Create element.
    this.nameElement.innerText = label;
    this.nameElement.classList.toggle('can-sit', !!id);
  }

  updatePosition(position) {
    const element = this.getElement();
    const className = `opponent p${position}${this.id === GHOST_OPPONENT ? ' ghost' : ''}`;
    if (element.className === className) {
      return;
    }
    element.className = className;
  }
}

class Lurkers {
  constructor() {
    this.lurkers = [];
  }

  getElement() {
    if (!this.element) {
      this.element = createElement('lurk-central');
    }
    return this.element;
  }

  onStateChange(lurkers = []) {
    if (this.canSkipUpdate(lurkers)) {
      return;
    }
    this.lurkers = lurkers;
    const element = this.getElement();
    element.innerHTML = lurkers.join('<br/>');
    element.classList.toggle('active', lurkers.length > 0);
  }

  canSkipUpdate(lurkers) {
    if (lurkers.length !== this.lurkers.length) {
      return false;
    }
    for (let i = 0; i < lurkers.length; i++) {
      if (lurkers[i] !== this.lurkers[i]) {
        return false;
      }
    }
    return true;
  }
}

class Drag {
  constructor(cards, x, y, turns) {
    this.cards = cards;
    this.x = x;
    this.y = y;
    this.turns = turns;
  }

  getElement() {
    if (!this.element) {
      const element = createElement('move');
      for (const card of this.cards) {
        card.setMessy(true);
        element.appendChild(card.getElement());
      }
      element.__move = this;
      this.element = element;
    }
    return this.element;
  }

  setPosition(x, y, offset, width, height, surfaceSize) {
    const deg = this.getRotation(x, y, width, height, surfaceSize);
    const transform = `translate(${x - offset.x}px, ${y - offset.y}px) rotate(${deg}deg)`;
    this.getElement()
      .style.transform = transform;
  }

  getRotation(x, y, width, height, surfaceSize) {
    let positionalDeg = 0;
    // Handle rotation for other players' turns.
    if (this.turns && this.turns.length === 1) {
      const turn = this.turns[0];
      positionalDeg = rotationInPosition[turn.position];
      const updatedPositions = turn.encodePosition(x, y, width, height);
      x = updatedPositions.x;
      y = updatedPositions.y;
      if (turn.position === 2 || turn.position === 0) {
        const temp = width;
        width = height;
        height = temp;
      }
    }

    const MAX_ROTATION = 50 * (width / surfaceSize);
    const yPad = Math.floor(height * .5);
    const pivot = x / width;
    const maxDeg = (pivot * MAX_ROTATION) - (MAX_ROTATION / 2);
    let damper = 1;
    if (y > yPad) {
      damper -= (y - yPad) / (height - yPad);
    }
    return positionalDeg + (maxDeg * damper);
  }

  getMessage(surfaceX, surfaceY) {
    if (this.turns) {
      if (this.turns.length !== 1) {
        return {};
      }
      const turn = this.turns[0];
      const payload = turn.encodePosition(surfaceX, surfaceY);
      payload.turnId = turn.id;
      return payload;
    }

    const cards = [];
    for (const card of this.cards) {
      cards.push(card.value);
    }
    return {
      x: surfaceX,
      y: surfaceY,
      cards,
    };
  }
}

class Hand {
  constructor() {
    this.cards = [];
    this.sortPosition = 0;
  }

  onStateChange(state) {
    this.getElement();
    if (state.name !== this.nameElement.textContent) {
      this.nameElement.innerText = state.name;
    }
    if (this.stateEquals(state.hand)) {
      return;
    }
    const cards = [];
    for (const card of state.hand) {
      cards.push(new Card(card));
    }
    this.setCards(cards);
  }

  stateEquals(state) {
    if (this.cards.length !== state.length) {
      return false;
    }
    for (let i = 0; i < state.length; i++) {
      if (this.cards[i].value !== state[i]) {
        return false;
      }
    }
    return true;
  }

  getElement() {
    if (!this.element) {
      this.element = createElement('hand');
      this.sortIndicator = createElement('sort-indicator', this.element);
      this.nameElement = createElement('name', this.element);
    }
    return this.element;
  }

  setSortPosition(offsetX, elementWidth) {
    if (!this.cards.length || !this.sortIndicator) {
      return;
    }
    const cardWidth = elementWidth / this.cards.length;
    let index = Math.floor(offsetX / cardWidth);
    if (offsetX % cardWidth > cardWidth / 2) {
      index += 1;
    }
    if (index !== this.sortPosition) {
      this.sortPosition = index;
      const element = this.getElement();
      if (index >= this.cards.length) {
        element.appendChild(this.sortIndicator);
      } else {
        element.insertBefore(this.sortIndicator, this.cards[index].getElement());
      }
    }
  }

  drop(drag) {
    if (drag.turns) {
      const turnIds = drag.turns.map(turn => turn.id);
      this.getElement()
        .dispatchEvent(new CustomEvent('pickup', {
          detail: {
            index: this.sortPosition,
            turnIds,
          },
        }));
    } else {
      this.rearrange(drag.cards);
    }
  }

  rearrange(cards) {
    const PLACEHOLDER = '';
    const grouping = [];
    const newOrder = [];
    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i];
      if (i === this.sortPosition) {
        newOrder.push(PLACEHOLDER);
      }
      if (cards.find(toRemove => toRemove.value === card.value)) {
        grouping.push(card);
        card.select(false);
      } else {
        newOrder.push(card);
      }
    }
    const insertAt = newOrder.indexOf(PLACEHOLDER);
    if (insertAt >= 0) {
      newOrder.splice(insertAt, 1, ...grouping);
    } else {
      newOrder.push(...grouping);
    }
    this.getElement()
      .dispatchEvent(new CustomEvent('rearrange', {
        detail: newOrder
      }));
  }

  createDrag(dragEvent) {
    const element = this.getElement();
    const elements = element.getElementsByClassName('selected');
    const cards = [];
    for (const el of elements) {
      cards.push(el.__card.clone());
    }
    if (!cards.find(card => card.value == dragEvent.target.__card.value)) {
      cards.push(dragEvent.target.__card.clone());
    }
    return new Drag(cards, dragEvent.pageX, dragEvent.pageY);
  }

  setCards(cards = []) {
    const element = this.getElement();
    for (const card of this.cards) {
      card.getElement()
        .remove();
    }
    this.cards = cards;
    for (const card of this.cards) {
      const cardElement = card.getElement();
      element.appendChild(cardElement);
      cardElement.onclick = () => {
        card.select();
      };
      cardElement.onmousedown = (event) => {
        element.dispatchEvent(new CustomEvent('startDrag', {
          detail: () => {
            return this.createDrag(event);
          }
        }));
      };
    }
  }

  removeCards(cards = []) {
    this.setCards(this.cards.filter((card) => {
      return !cards.find(toRemove => toRemove.value === card.value);
    }));
  }
}

class Card {
  constructor(value = '') {
    this.updateValue(value);
  }

  clone() {
    return new Card(this.value);
  }

  select(value) {
    this.getElement()
      .classList.toggle('selected', value);
  }

  getElement() {
    if (!this.element) {
      const element = createElement('card');
      element.__card = this;
      this.setImage(element, this.value);
      this.element = element;
    }
    return this.element;
  }

  updateValue(value = '') {
    if (value === this.value) {
      return;
    }
    this.suit = value.substr(0, 1);
    this.value = value;
    if (this.element) {
      const element = this.getElement();
      this.setImage(element, value);
      if (element.style.transform) {
        this.setMessy(true);
      }
    }
  }

  setImage(element, value) {
    if (value) {
      element.style.backgroundImage = images[value];
      element.style.display = '';
    } else {
      element.style.display = 'none';
    }
  }

  setMessy(isMessy) {
    const element = this.getElement();
    if (!isMessy) {
      element.style.transform = undefined;
    } else {
      const suit = suitNumber[this.suit];
      const number = Number(this.value.substr(1, 2));
      element.style.transform = getFussedTransform(suit + number);
    }
  }
}

function createElement(className, parent) {
  const element = document.createElement('div');
  element.className = className;
  if (parent) {
    parent.appendChild(element);
  }
  return element;
}

function onDoubleClick(element, singleClick, doubleClick) {
  let clickTimeout = 0;
  let clicks = 0;
  element.addEventListener('click', () => {
    clicks++;
    clearTimeout(clickTimeout);
    if (clicks <= 1) {
      singleClick();
      clickTimeout = setTimeout(() => {
        clicks = 0;
      }, 300);
    } else {
      doubleClick();
      clicks = 0;
    }
  });
}

function getFussedTransform(number) {
  const x = (2 - (number % 5)) / 70;
  const y = (2 - (number % 5)) / 70;
  const d = (1 - (number % 3));
  return `translate(${x.toFixed(3)}em, ${y.toFixed(3)}em) rotate(${d}deg)`;
}
