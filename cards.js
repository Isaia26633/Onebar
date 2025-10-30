module.exports = {
    createDeck,
    shuffle
};

function createDeck() {
    const colors = ['blue', 'red', 'green', 'yellow'];
    const values = [
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
        'Skip', 'Reverse', 'Draw Two'
    ];

    const deck = [];
    let idx = 0; // unique id counter for duplicate cards

    for (const color of colors) {
        // UNO-style: one '0' per color
        deck.push(makeCard(color, '0', idx++));

        // numbers 1-9 twice per color
        for (let n = 1; n <= 9; n++) {
            deck.push(makeCard(color, String(n), idx++));
            deck.push(makeCard(color, String(n), idx++));
        }

        // action cards (Skip, Reverse, Draw Two) twice per color
        ['Skip', 'Reverse', 'Draw Two'].forEach(action => {
            deck.push(makeCard(color, action, idx++));
            deck.push(makeCard(color, action, idx++));
        });
    }

    return deck;
}

function makeCard(color, value, uniqueIndex) {
    const safeValue = value.replace(/\s+/g, '_'); //"Draw_Two" is proper filename
    const id = `${color}_${safeValue}_${uniqueIndex}`;
    return {
        id,
        color,
        value,
        // this points to public/img/cards/<color>_<value>.png
        img: `/img/cards/${color}_${safeValue}.png`
    };
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}