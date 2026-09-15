import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tradePartnerships, PARTNER_MIN_TRADES } from '../deals.js';

const trade = (a, aNet, b, graded = true) => ({ graded, sides: [{ userId: a, net: aNet }, { userId: b, net: -aNet }] });

// u1–u2: three graded trades, u1 ahead 130, plus one too early to grade.
// u1–u3: three graded trades that come out 2 points apart.
// u2–u3: one big trade, below the minimum for an award.
const trades = [
  trade('u1', 100, 'u2'), trade('u2', -50, 'u1'), trade('u1', -20, 'u2'), trade('u1', 999, 'u2', false),
  trade('u1', 10, 'u3'), trade('u3', 5, 'u1'), trade('u1', -3, 'u3'),
  trade('u3', 300, 'u2'),
];

test('pairs add up graded trades from both directions and count ungraded ones', () => {
  const { pairs } = tradePartnerships(trades);
  const u1u2 = pairs.find(p => p.users.join() === 'u1,u2');
  assert.equal(u1u2.trades, 4);
  assert.equal(u1u2.graded, 3);
  assert.deepEqual(u1u2.net, { u1: 130, u2: -130 });
  assert.equal(u1u2.winner, 'u1');
  assert.equal(u1u2.margin, 130);
});

test('fair and lopsided awards need the minimum number of graded trades', () => {
  assert.equal(PARTNER_MIN_TRADES, 3);
  const { fair, lopsided } = tradePartnerships(trades);
  assert.deepEqual(fair.map(p => p.users.join()), ['u1,u3', 'u1,u2']);
  assert.equal(fair[0].margin, 2);
  assert.deepEqual([lopsided[0].winner, lopsided[0].loser, lopsided[0].margin], ['u1', 'u2', 130]);
  assert.ok(!lopsided.some(p => p.users.join() === 'u2,u3'));
});

test("each manager's best and worst partner include every graded pairing", () => {
  const { byManager } = tradePartnerships(trades);
  assert.deepEqual(byManager.get('u1').best, { partner: 'u2', net: 130, graded: 3, trades: 4 });
  assert.equal(byManager.get('u1').worst, null);
  assert.equal(byManager.get('u2').best, null);
  assert.equal(byManager.get('u2').worst.partner, 'u3');
  assert.equal(byManager.get('u2').worst.net, -300);
  assert.deepEqual([byManager.get('u3').best.partner, byManager.get('u3').worst.partner], ['u2', 'u1']);
});
