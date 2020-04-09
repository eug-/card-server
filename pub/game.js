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
images['BACK'] = "url('img/BACK.png')";

const MIN_DRAG_DISTANCE = 30;
const MAX_ACTIVE_PLAYERS = 4;
const LOCAL_PLAYER = MAX_ACTIVE_PLAYERS - 1;
const GHOST_OPPONENT = 'ghost_opponent';

class Game {
  constructor(container) {
    this.opponents = [];
    this.hand = new Hand();
    this.surface = new Surface();
    this.container = container;
    this.lurkers = new Lurkers();
    this.menu = new Menu(container);
    this.isActivePlayer = false;
    const hand = this.hand.getElement();
    const menu = this.menu.getElement();

    container.appendChild(this.surface.getElement());
    container.appendChild(hand);
    container.appendChild(this.lurkers.getElement());
    container.appendChild(menu);

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

    menu.addEventListener('undo', () => {
      if (!this.server) {
        return;
      }
      this.server.send(JSON.stringify({
        type: 'undo',
      }));
    });

    menu.addEventListener('deal', () => {
      if (!this.server) {
        return;
      }
      this.server.send(JSON.stringify({
        type: 'deal',
        data: 13,
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
      this.surface.onStateChange(update.round);
      this.lurkers.onStateChange(update.lurkers);
      this.menu.onStateChange(update.canUndo);
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

  makeMove(drag, x, y) {
    this.hand.removeCards(drag.cards);
    this.server.send(JSON.stringify({
      type: 'turn',
      data: drag.getMessage(x, y),
    }));
  }

  startDrag(drag) {
    const surface = this.surface.getElement();
    const hand = this.hand.getElement();

    let dragging = false;
    let currentArea;
    const dropzone = {
      surface: surface.getBoundingClientRect(),
      hand: hand.getBoundingClientRect(),
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
      if (!dragging) {
        const distance = Math.abs(mouseEvent.pageX - drag.x) + Math.abs(mouseEvent.pageY - drag.y);
        if (distance > MIN_DRAG_DISTANCE) {
          dragging = true;
          this.container.appendChild(drag.getElement());
        } else {
          return;
        }
      }


      drag.setPosition(mouseEvent.pageX - 30, mouseEvent.pageY - 50);
      if (inArea(dropzone.surface, mouseEvent)) {
        enterArea(surface);
        drag.setRotationForPosition((mouseEvent.pageX - dropzone.surface.x) / dropzone.surface.width);
      } else if (inArea(dropzone.hand, mouseEvent)) {
        drag.setRotationForPosition();
        enterArea(hand);
        this.hand.setSortPosition(mouseEvent.pageX - dropzone.hand.x, dropzone.hand.width);
      } else {
        drag.setRotationForPosition();
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
      drag.getElement()
        .remove();
      if (inSurface) {
        const x = (mouseEvent.pageX - dropzone.surface.left) / dropzone.surface.width;
        const y = (mouseEvent.pageY - dropzone.surface.top) / dropzone.surface.height;
        this.makeMove(drag, x, y);
      }
      if (inHand) {
        this.hand.rearrange(drag.cards);
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

  getElement() {
    if (!this.element) {
      const element = createElement('controls-central');

      const dealMenu = createElement('dialog deal-menu hidden', this.container);
      const yesButton = createElement('dialog-button', dealMenu);
      yesButton.innerText = 'Yes';
      yesButton.addEventListener('click', () => {
        dealMenu.classList.add('hidden');
        element.dispatchEvent(new Event('deal'));
      });
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

      const undoButton = createElement('button disabled', element);
      undoButton.innerText = 'undo';
      undoButton.addEventListener('click', () => {
        if (undoButton.classList.contains('disabled')) {
          return;
        }
        element.dispatchEvent(new Event('undo'));
      });

      this.element = element;
      this.undoButton = undoButton;
    }
    return this.element;
  }

  onStateChange(canUndo) {
    this.getElement();
    this.undoButton.classList.toggle('disabled', !canUndo);
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

  onStateChange(round = []) {
    if (this.round.length > round.length) {
      this.round = [];
      this.getElement()
        .innerHTML = '';
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
        round[i].x,
        round[i].y);
      this.round[i] = update;
      this.getElement()
        .appendChild(update.getElement());
    }
  }
}

const xInPosition = {
  0: 'top',
  1: 'right',
  2: 'bottom',
  3: 'left',
};

const yInPosition = {
  0: 'right',
  1: 'bottom',
  2: 'left',
  3: 'top',
};

const rotationInPosition = {
  0: 270,
  1: 180,
  2: 90,
  3: 0,
};

class Turn {
  constructor(cards = [], position = 0, x, y) {
    this.cards = cards;
    this.position = position;
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
      if (placed) {
        this.setSafePosition(element, xInPosition[this.position], this.x * 100);
        this.setSafePosition(element, yInPosition[this.position], this.y * 100);
        element.style.transform = `translate(${element.style.left ? '-' : ''}50%, ${element.style.top ? '-' : ''}50%) rotate(${this.calculateRotation(this.position, this.x)})`;
      } else {
        element.className += `p${this.position}`;
      }
      for (const card of this.cards) {
        card.setMessy(true);
        element.appendChild(card.getElement());
      }
      this.element = element;
    }
    return this.element;
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
        card.style.backgroundImage = images.BACK;
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
  constructor(cards, x, y) {
    this.cards = cards;
    this.x = x;
    this.y = y;
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

  setRotationForPosition(x) {
    if (x === undefined) {
      delete this.rotation;
    } else {
      this.rotation = `rotate(${-(30 - x * 60)}deg)`;
    }
  }

  setPosition(x, y) {
    const element = this.getElement();
    const transform = `translate(${x}px, ${y}px) ${this.rotation ? this.rotation : ''}`;
    console.log(transform);
    element.style.transform = transform;
  }

  getMessage(surfaceX, surfaceY) {
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

  toggle(clickEvent) {
    clickEvent.target.classList.toggle('selected');
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
        card.getElement()
          .classList.remove('selected');
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
      cardElement.onclick = (event) => {
        this.toggle(event);
      };
      cardElement.onmousedown = (event) => {
        element.dispatchEvent(new CustomEvent('startDrag', {
          detail: this.createDrag(event)
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
    this.suit = value.substr(0, 1);
    this.value = value;
    this.isRed = this.suit === 'H' || this.suit === 'D';
    this.selected = false;
  }

  clone() {
    return new Card(this.value);
  }

  getElement() {
    if (!this.element) {
      const element = createElement(`card${this.isRed ? ' red' : ''}`);
      element.__card = this;
      element.style.backgroundImage = images[this.value];
      this.element = element;
    }
    return this.element;
  }

  setMessy(isMessy) {
    const element = this.getElement();
    if (!isMessy) {
      element.style.transform = undefined;
    } else {
      const suit = suitNumber[this.suit];
      const number = Number(this.value.substr(1, 2));
      const x = (2 - ((number + suit) % 5)) / 70;
      const y = (2 - ((number + suit) % 5)) / 70;
      const d = (1 - ((number + suit) % 3));
      element.style.transform = `translate(${x.toFixed(3)}em, ${y.toFixed(3)}em) rotate(${d}deg)`;
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
