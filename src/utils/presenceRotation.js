function shuffle(entries, random) {
  const shuffled = [...entries];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function createPresenceRotation(entries, categoryPrefixes, random = Math.random) {
  const categories = categoryPrefixes
    .map((prefix) => ({
      prefix,
      entries: entries.filter((entry) => entry.name.startsWith(prefix)),
      deck: [],
      previousName: '',
    }))
    .filter((category) => category.entries.length > 0);
  let categoryIndex = 0;

  return function nextPresence() {
    if (!categories.length) return null;

    const category = categories[categoryIndex];
    categoryIndex = (categoryIndex + 1) % categories.length;

    if (!category.deck.length) {
      category.deck = shuffle(category.entries, random);
      if (
        category.deck.length > 1
        && category.deck[0].name === category.previousName
      ) {
        [category.deck[0], category.deck[1]] = [category.deck[1], category.deck[0]];
      }
    }

    const current = category.deck.shift();
    category.previousName = current.name;
    return current;
  };
}

module.exports = {
  createPresenceRotation,
};
