// Trade relationships from data/deals.json: how each pair of managers has done
// trading with each other. No DOM code, so node:test can check it.

// A partnership needs this many graded trades to win an award, so one deal
// can't make a relationship (single trades have their own award).
export const PARTNER_MIN_TRADES = 3;

export function tradePartnerships(trades) {
  const pairs = new Map();
  for (const trade of trades) {
    if (trade.sides.length !== 2) continue;
    const [a, b] = [...trade.sides].sort((x, y) => (x.userId < y.userId ? -1 : 1));
    const key = `${a.userId}|${b.userId}`;
    const pair = pairs.get(key) ?? { users: [a.userId, b.userId], trades: 0, graded: 0, net: { [a.userId]: 0, [b.userId]: 0 } };
    pair.trades += 1;
    if (trade.graded) {
      pair.graded += 1;
      pair.net[a.userId] += a.net;
      pair.net[b.userId] += b.net;
    }
    pairs.set(key, pair);
  }

  const list = [...pairs.values()].map(pair => {
    const [x, y] = pair.users;
    const [winner, loser] = pair.net[x] >= pair.net[y] ? [x, y] : [y, x];
    // Grades are zero-sum, so this is how far ahead the winner came out.
    return { ...pair, winner, loser, margin: (pair.net[winner] - pair.net[loser]) / 2 };
  });
  const qualified = list.filter(p => p.graded >= PARTNER_MIN_TRADES);

  const byManager = new Map();
  for (const pair of list.filter(p => p.graded > 0)) {
    for (const [me, other] of [pair.users, [...pair.users].reverse()]) {
      const entry = byManager.get(me) ?? { best: null, worst: null };
      const row = { partner: other, net: pair.net[me], graded: pair.graded, trades: pair.trades };
      if (row.net > 0 && (!entry.best || row.net > entry.best.net)) entry.best = row;
      if (row.net < 0 && (!entry.worst || row.net < entry.worst.net)) entry.worst = row;
      byManager.set(me, entry);
    }
  }

  return {
    pairs: list,
    // Closest to even first; more trades breaks ties.
    fair: [...qualified].sort((a, b) => a.margin - b.margin || b.graded - a.graded),
    lopsided: [...qualified].sort((a, b) => b.margin - a.margin || b.graded - a.graded),
    byManager,
  };
}
