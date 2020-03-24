const cardIcon = {
  C1: '🃑',
  C2: '🃒',
  C3: '🃓',
  C4: '🃔',
  C5: '🃕',
  C6: '🃖',
  C7: '🃗',
  C8: '🃘',
  C9: '🃙',
  C10: '🃚',
  C11: '🃛',
  C12: '🃝',
  C13: '🃞',
  D1: '🃁',
  D2: '🃂',
  D3: '🃃',
  D4: '🃄',
  D5: '🃅',
  D6: '🃆',
  D7: '🃇',
  D8: '🃈',
  D9: '🃉',
  D10: '🃊',
  D11: '🃋',
  D12: '🃍',
  D13: '🃎',
  H1: '🂱',
  H2: '🂲',
  H3: '🂳',
  H4: '🂴',
  H5: '🂵',
  H6: '🂶',
  H7: '🂷',
  H8: '🂸',
  H9: '🂹',
  H10: '🂺',
  H11: '🂻',
  H12: '🂽',
  H13: '🂾',
  S1: '🂡',
  S2: '🂢',
  S3: '🂣',
  S4: '🂤',
  S5: '🂥',
  S6: '🂦',
  S7: '🂧',
  S8: '🂨',
  S9: '🂩',
  S10: '🂪',
  S11: '🂫',
  S12: '🂭',
  S13: '🂮',
  BACK: '🂠',
};

const suitNumber = {
  C: 0,
  D: 1,
  H: 2,
  S: 3,
};

const MIN_DRAG_DISTANCE = 30;
const LOCAL_PLAYER = 3;

class Game {
  constructor(container) {
    this.opponents = [];
    this.hand = new Hand();
    this.surface = new Surface();
    this.container = container;
    this.lurkers = new Lurkers();
    this.menu = new Menu(container);

    const hand = this.hand.getElement();
    container.appendChild(hand);
    container.appendChild(this.surface.getElement());
    container.appendChild(this.lurkers.getElement());
    const menu = this.menu.getElement();
    container.appendChild(menu);

    hand.addEventListener('startDrag', (event) => {
      this.startDrag(event.detail);
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
      console.log('game message received', event.data);
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

      this.setOpponents(update.opponents);
      if (update.player) {
        this.hand.onStateChange(update.player);
      }
      this.surface.onStateChange(update.round);
      this.lurkers.onStateChange(update.lurkers);
      this.menu.onStateChange(update.canUndo);
    });
  }

  makeMove(drag) {
    this.hand.removeCards(drag.cards);
    this.server.send(JSON.stringify({
      type: 'turn',
      data: drag.getMessage(),
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

      const element = drag.getElement();
      element.style.transform = `translate(${mouseEvent.pageX - 30}px, ${mouseEvent.pageY - 50}px)`;
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
      drag.getElement()
        .remove();
      if (inSurface) {
        this.makeMove(drag);
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
    while (this.opponents.length > opponentStates.length) {
      const opponent = this.opponents.pop();
      opponent.getElement()
        .remove();
    }
    for (let i = 0; i < opponentStates.length; i++) {
      if (!this.opponents[i]) {
        const opponent = new Opponent(opponentStates[i]);
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

      const clearButton = createElement('button', element);
      clearButton.innerText = 'clear table';
      clearButton.addEventListener('click', () => {
        element.dispatchEvent(new Event('newround'));
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
        console.log('surface drop', event);
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
        round[i].position);
      this.round[i] = update;
      this.getElement()
        .appendChild(update.getElement());
    }
  }
}

class Turn {
  constructor(cards = [], position = 0) {
    this.cards = cards;
    this.position = position;
  }

  equalsState(state) {
    if (state.cards.length != this.cards.length) {
      return false;
    }
    if (state.position != this.position) {
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
      const element = createElement(`turn p${this.position}`);
      for (const card of this.cards) {
        card.setMessy(true);
        element.appendChild(card.getElement());
      }
      this.element = element;
    }
    return this.element;
  }
}

class Opponent {
  constructor(state) {
    this.name = state.name;
    this.updateCount(state.cardCount);
    this.updateIndex(state.position);
  }

  getElement() {
    if (!this.element) {
      const element = createElement('opponent');
      const name = createElement('name', element);
      name.innerText = this.name;
      this.element = element;
      this.nameElement = name;
    }
    return this.element;
  }

  update(state) {
    this.updateCount(state.cardCount);
    this.updateName(state.name);
    this.updateIndex(state.position);
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
        card.innerText = cardIcon.BACK;
      }
    }
    this.cardCount = count;
  }

  updateName(name) {
    if (this.name === name) {
      return;
    }
    this.nameElement.innerText = name;
  }

  updateIndex(index) {
    if (this.index === index) {
      return;
    }
    const element = this.getElement();
    element.className = `opponent p${index}`;
    this.index = index;
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

  getMessage() {
    const message = [];
    for (const card of this.cards) {
      message.push(card.value);
    }
    return message;
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
    this.setCards(newOrder);
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
      element.innerText = cardIcon[this.value];
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
