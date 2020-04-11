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
    const surface = this.surface.getElement();

    container.appendChild(surface);
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

  selectAll(selected) {
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
    let addTarget = true;
    for (const el of elements) {
      if (el === dragEvent.target) {
        addTarget = false;
      }
      if (el.__turn) {
        const turn = el.__turn;
        turns.push(turn);
      }
    }
    if (addTarget && dragEvent.target.__turn || dragEvent.target.parentElement.__turn) {
      turns.push(dragEvent.target.__turn || dragEvent.target.parentElement.__turn);
    }
    if (turns.length <= 0) {
      return;
    }
    for (const turn of turns) {
      for (const card of turn.cards) {
        cards.push(card.clone());
      }
      turn.select(false);
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

  encodePosition(x, y) {
    switch (this.position) {
      case 0:
        // rotate 90 cw
        return {
          x: y,
          y: 1 - x
        };
      case 1:
        // rotate 180deg
        return {
          x: 1 - x,
          y: 1 - y
        };
      case 2:
        // rotate 90 ccw
        return {
          x: 1 - y,
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

  setPosition(x, y, offset, width, height, surfaceWidth) {
    const MAX_ROTATION = 50 * (width / surfaceWidth);
    const xPad = (width - surfaceWidth) / 2;
    const yPad = Math.floor(height * .5);
    const pivot = x / width;
    const maxDeg = (pivot * MAX_ROTATION) - (MAX_ROTATION / 2);
    let damper = 1;
    if (y > yPad) {
      damper -= (y - yPad) / (height - yPad);
    }
    const deg = maxDeg * damper;
    const transform = `translate(${x - offset.x}px, ${y - offset.y}px) rotate(${deg}deg)`;
    this.getElement()
      .style.transform = transform;
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
      // handle taking cards from table
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
    this.suit = value.substr(0, 1);
    this.value = value;
    this.isRed = this.suit === 'H' || this.suit === 'D';
  }

  clone() {
    return new Card(this.value);
  }

  select(value) {
    this.getElement()
      .classList.toggle('selected', value);
  }

  get selected() {
    return this.getElement()
      .classList.contains('selected');
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
