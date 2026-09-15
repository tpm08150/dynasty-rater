import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lineupSlots, bestLineup, benchValue, positionDepth, pickSeasons, futurePicks,
  pickTier, pickValue, ordinal, rateLeague, qbScoringBoosts,
} from '../rating.js';
import { fantasyCalcUrl, trimPlayers } from '../data.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

const ROSTER_POSITIONS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'K', 'DEF', 'BN', 'BN'];
const p = (id, position, redraft, dynasty = redraft) => ({ id, position, redraft, dynasty });

test('lineup slots drop K/DEF/bench and put flex after fixed slots', () => {
  assert.deepEqual(lineupSlots(ROSTER_POSITIONS), ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX']);
});

test('best lineup fills fixed slots first and never puts a QB in FLEX', () => {
  const players = [
    p('qb1', 'QB', 9000), p('qb2', 'QB', 8000),
    p('rb1', 'RB', 5000), p('rb2', 'RB', 4000), p('rb3', 'RB', 3000),
    p('wr1', 'WR', 6000), p('wr2', 'WR', 2000), p('wr3', 'WR', 1000),
    p('te1', 'TE', 500), p('te2', 'TE', 400),
  ];
  const { lineup, bench } = bestLineup(players, lineupSlots(ROSTER_POSITIONS), 'redraft');
  assert.deepEqual(lineup.map(s => s.player.id), ['qb1', 'rb1', 'rb2', 'wr1', 'wr2', 'te1', 'rb3', 'wr3']);
  assert.deepEqual(bench.map(b => b.id), ['qb2', 'te2']);
});

test('an empty slot stays empty instead of borrowing an ineligible player', () => {
  const { lineup } = bestLineup([p('qb1', 'QB', 9000), p('qb2', 'QB', 8000)], ['QB', 'TE'], 'redraft');
  assert.equal(lineup[1].player, null);
});

test('bench tiers weight players in order and stop when the bench runs out', () => {
  const bench = [p('a', 'RB', 1000), p('b', 'RB', 1000), p('c', 'RB', 1000)];
  assert.equal(benchValue(bench, 'redraft', [{ count: 2, weight: 0.5 }, { count: Infinity, weight: 0.1 }]), 1100);
});

test('position depth counts one flex spot per eligible position', () => {
  assert.deepEqual(positionDepth(lineupSlots(ROSTER_POSITIONS)), { QB: 1, RB: 3, WR: 3, TE: 2 });
  assert.equal(positionDepth(['QB', 'SUPER_FLEX']).QB, 2);
});

test('pick seasons include this year only until its draft is complete', () => {
  assert.deepEqual(pickSeasons('2026', [{ season: '2026', status: 'complete' }]), [2027, 2028, 2029]);
  assert.deepEqual(pickSeasons('2026', [{ season: '2026', status: 'pre_draft' }]), [2026, 2027, 2028, 2029]);
});

test('traded picks move owners; trades for seasons outside the window are ignored', () => {
  const picks = futurePicks({
    rosterIds: [1, 2],
    seasons: [2027, 2028],
    rounds: 2,
    tradedPicks: [
      { season: '2027', round: 1, roster_id: 1, owner_id: 2 },
      { season: '2026', round: 1, roster_id: 2, owner_id: 1 },
    ],
  });
  assert.equal(picks.length, 8);
  assert.equal(picks.filter(x => x.ownerId === 1).length, 3);
  assert.equal(picks.filter(x => x.ownerId === 2).length, 5);
  assert.deepEqual(picks.find(x => x.season === 2027 && x.round === 1 && x.originalRosterId === 1).ownerId, 2);
});

test('ordinals', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st']);
});

test('pick tiers split the draft into thirds', () => {
  assert.deepEqual([1, 3, 4, 7, 8, 10].map(s => pickTier(s, 10)), ['Early', 'Early', 'Mid', 'Mid', 'Late', 'Late']);
  assert.deepEqual([4, 5, 8, 9].map(s => pickTier(s, 12)), ['Early', 'Mid', 'Mid', 'Late']);
});

test('pick values use the tiered name, fall back to generic, and flag misses', () => {
  const values = new Map([['2027 1st (Early)', 5000], ['2027 1st', 3000], ['2028 1st', 2000]]);
  assert.deepEqual(pickValue({ season: 2027, round: 1 }, 2, 10, values), { name: '2027 1st (Early)', tier: 'Early', value: 5000, matched: true });
  assert.deepEqual(pickValue({ season: 2028, round: 1 }, 2, 10, values), { name: '2028 1st', tier: null, value: 2000, matched: true });
  assert.deepEqual(pickValue({ season: 2028, round: 3 }, null, 10, values), { name: '2028 3rd', tier: null, value: 0, matched: false });
});

test('fantasycalc query matches league format', () => {
  const league = { roster_positions: ROSTER_POSITIONS, settings: { num_teams: 10 }, scoring_settings: { rec: 0.5 } };
  const url = new URL(fantasyCalcUrl(league));
  assert.equal(url.searchParams.get('numQbs'), '1');
  assert.equal(url.searchParams.get('numTeams'), '10');
  assert.equal(url.searchParams.get('ppr'), '0.5');
  const sf = { ...league, roster_positions: ['QB', 'SUPER_FLEX', 'RB'] };
  assert.equal(new URL(fantasyCalcUrl(sf)).searchParams.get('numQbs'), '2');
});

test('trimPlayers builds defense names from first and last name', () => {
  const trimmed = trimPlayers({
    KC: { first_name: 'Kansas City', last_name: 'Chiefs', position: 'DEF', team: 'KC' },
    4046: { full_name: 'Patrick Mahomes', position: 'QB', team: 'KC', age: 30 },
    999: { full_name: 'No Position' },
  });
  assert.deepEqual(trimmed, {
    KC: { name: 'Kansas City Chiefs', position: 'DEF', team: 'KC', age: null },
    4046: { name: 'Patrick Mahomes', position: 'QB', team: 'KC', age: 30 },
  });
});

// Team A is old and good now; team B is young, weak now, and holds A's 1st.
function twoTeamLeague() {
  const fc = (id, position, redraft, dynasty, age) => ({ player: { sleeperId: id, name: id, position, maybeAge: age, maybeTeam: 'KC' }, value: dynasty, redraftValue: redraft });
  const pick = (name, value) => ({ player: { name, position: 'PICK' }, value, redraftValue: 0 });
  const values = [
    fc('a1', 'QB', 9000, 3000, 33), fc('a2', 'RB', 7000, 2000, 29), fc('a3', 'RB', 6000, 1500, 30),
    fc('a4', 'WR', 7000, 2500, 31), fc('a5', 'WR', 6500, 2000, 30), fc('a6', 'TE', 4000, 1000, 32),
    fc('a7', 'WR', 3000, 800, 29), fc('a8', 'RB', 2500, 600, 28),
    fc('b1', 'QB', 5000, 6000, 23), fc('b2', 'RB', 3000, 7000, 22), fc('b3', 'RB', 2500, 5000, 21),
    fc('b4', 'WR', 4000, 8000, 22), fc('b5', 'WR', 3000, 6000, 23), fc('b6', 'TE', 1500, 3000, 24),
    fc('b7', 'WR', 1000, 4000, 21), fc('b8', 'RB', 900, 3500, 22),
    pick('2027 1st (Early)', 4000), pick('2027 1st (Late)', 2000), pick('2028 1st', 2500), pick('2029 1st', 2400),
  ];
  return {
    league: { season: '2026', roster_positions: ROSTER_POSITIONS, settings: { draft_rounds: 1 } },
    users: [
      { user_id: 'u1', display_name: 'alpha', metadata: { team_name: 'Old Guard' } },
      { user_id: 'u2', display_name: 'bravo', metadata: {} },
    ],
    rosters: [
      { roster_id: 1, owner_id: 'u1', players: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'k1'], taxi: [], reserve: ['a3'], settings: { wins: 1, fpts: 120, fpts_decimal: 50 } },
      { roster_id: 2, owner_id: 'u2', players: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'], taxi: ['b8'], settings: {} },
    ],
    tradedPicks: [{ season: '2027', round: 1, roster_id: 1, owner_id: 2 }],
    drafts: [{ season: '2026', status: 'complete' }],
    values,
    players: { k1: { name: 'Some Kicker', position: 'K', team: 'KC', age: 27 } },
  };
}

test('rateLeague separates win-now from rising and values traded picks by projected slot', () => {
  const { teams, seasons, unmatchedPicks } = rateLeague(twoTeamLeague());
  const a = teams.find(t => t.rosterId === 1);
  const b = teams.find(t => t.rosterId === 2);

  assert.deepEqual(seasons, [2027, 2028, 2029]);
  assert.deepEqual(unmatchedPicks, []);

  assert.equal(a.currentValue, 45000);
  assert.equal(b.currentValue, 20900);
  assert.equal(a.currentRank, 1);
  assert.equal(a.currentScore, 100);

  // A is the best current team, so its traded 2027 1st projects late (2000);
  // B's own projects early (4000).
  assert.equal(b.pickValue, 4000 + 2000 + 2500 + 2400);
  assert.equal(a.pickValue, 2500 + 2400);
  assert.equal(a.futureValue, 13400 + 4900);
  assert.equal(b.futureValue, 42500 + 10900);
  assert.equal(b.futureRank, 1);
  assert.ok(Math.abs(a.futureScore - (100 * 18300) / 53400) < 1e-9);

  assert.equal(a.quadrant, 'win-now');
  assert.equal(b.quadrant, 'rising');

  assert.equal(a.teamName, 'Old Guard');
  assert.equal(b.teamName, 'bravo');
  assert.equal(a.record.pointsFor, 120.5);
  assert.equal(a.groups.QB.current, 9000);
  assert.equal(a.groups.QB.currentRank, 1);
  assert.equal(b.groups.WR.futureRank, 1);

  const kicker = a.players.find(x => x.id === 'k1');
  assert.equal(kicker.name, 'Some Kicker');
  assert.equal(kicker.valued, false);
  assert.ok(a.players.find(x => x.id === 'a3').ir);
  assert.ok(b.players.find(x => x.id === 'b8').taxi);
});

test('QB boost is league points over 4-point-TD points; small projections get the typical boost', () => {
  const scoring = { pass_td: 6, pass_yd: 0.04, pass_int: -2, rush_yd: 0.1, rush_td: 6 };
  const projections = [
    // 160 + 180 - 20 + 30 = 350 league points; 290 with 4-point TDs. ADP isn't scored.
    { player_id: 'q1', stats: { pass_yd: 4000, pass_td: 30, pass_int: 10, rush_yd: 300, adp_half_ppr: 20 } },
    // 120 + 120 + 50 + 30 = 320; 280 with 4-point TDs.
    { player_id: 'q2', stats: { pass_yd: 3000, pass_td: 20, rush_yd: 500, rush_td: 5 } },
    // 50-point baseline is under the reliability floor.
    { player_id: 'q3', stats: { pass_yd: 1000, pass_td: 5 } },
  ];
  const boosts = qbScoringBoosts(projections, scoring);
  near(boosts.byPlayer.get('q1'), 350 / 290);
  near(boosts.byPlayer.get('q2'), 320 / 280);
  assert.equal(boosts.byPlayer.has('q3'), false);
  near(boosts.typical, (350 / 290 + 320 / 280) / 2);
  near(boosts.min, 320 / 280);
  near(boosts.max, 350 / 290);

  assert.equal(qbScoringBoosts(projections, { ...scoring, pass_td: 4 }), null);
  assert.equal(qbScoringBoosts([], scoring), null);
});

test('rateLeague applies the QB boost to both values and leaves other positions alone', () => {
  const input = twoTeamLeague();
  input.league.scoring_settings = { pass_td: 6, pass_yd: 0.04 };
  // a1: 160 + 180 = 340 points, 280 with 4-point TDs. b1 has no projection.
  input.projections = [{ player_id: 'a1', stats: { pass_yd: 4000, pass_td: 30 } }];
  const r = 340 / 280;
  const { teams, qbBoost } = rateLeague(input);
  const a = teams.find(t => t.rosterId === 1);
  const b = teams.find(t => t.rosterId === 2);

  near(qbBoost.typical, r);
  const a1 = a.players.find(p => p.id === 'a1');
  near(a1.redraft, 9000 * r);
  near(a1.dynasty, 3000 * r);
  near(b.players.find(p => p.id === 'b1').redraft, 5000 * r);
  assert.equal(a.players.find(p => p.id === 'a2').redraft, 7000);
  near(a.currentValue, 45000 + 9000 * (r - 1));
  near(b.currentValue, 20900 + 5000 * (r - 1));
});

test('no projections means no QB boost', () => {
  const input = twoTeamLeague();
  input.league.scoring_settings = { pass_td: 6 };
  const { teams, qbBoost } = rateLeague(input);
  assert.equal(qbBoost, null);
  assert.equal(teams.find(t => t.rosterId === 1).currentValue, 45000);
});
