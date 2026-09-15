import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allPlayShare, summarizeSeason, buildHistory, withEarlierSeasons } from '../history.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

// Four teams, three regular-season weeks (1 plays 2, 3 plays 4), then a
// one-week final where 3 beats 1. Week 2's 96–95 is the only close game;
// week 3 has teams 2 and 3 tied on 100 without playing each other.
//   Week 1: 100  90  80  70
//   Week 2:  60 110  95  96
//   Week 3: 120 100 100  50
//   Final:  130  10 140  20
function fakeSeason(year, status = 'complete') {
  const regular = pts => pts.map((points, i) => ({ roster_id: i + 1, matchup_id: i < 2 ? 1 : 2, points }));
  return {
    league: { name: 'Test League', season: String(year), status, previous_league_id: null, settings: { playoff_week_start: 4, playoff_round_type: 0 } },
    users: [1, 2, 3, 4].map(n => ({ user_id: `u${n}`, display_name: `user${n}`, metadata: { team_name: null } })),
    rosters: [
      { roster_id: 1, owner_id: 'u1', settings: { wins: 2, losses: 1, ties: 0 } },
      { roster_id: 2, owner_id: 'u2', settings: { wins: 1, losses: 2, ties: 0 } },
      { roster_id: 3, owner_id: 'u3', settings: { wins: 2, losses: 1, ties: 0 } },
      { roster_id: 4, owner_id: 'u4', settings: { wins: 1, losses: 2, ties: 0 } },
    ],
    winnersBracket: [{ r: 1, m: 1, p: 1, t1: 1, t2: 3, w: 3, l: 1 }],
    matchups: {
      1: regular([100, 90, 80, 70]),
      2: regular([60, 110, 95, 96]),
      3: regular([120, 100, 100, 50]),
      4: [
        { roster_id: 1, matchup_id: 1, points: 130 }, { roster_id: 3, matchup_id: 1, points: 140 },
        { roster_id: 2, matchup_id: 2, points: 10 }, { roster_id: 4, matchup_id: 2, points: 20 },
      ],
    },
  };
}

test('all-play share counts ties as half', () => {
  near(allPlayShare(new Map([[1, 100], [2, 100], [3, 50]]), 1), 0.75);
  near(allPlayShare(new Map([[1, 100], [2, 100], [3, 50]]), 3), 0);
});

test('a season rebuilds records, strength, close games, finish and playoff results from scores', () => {
  const s = summarizeSeason(fakeSeason(2020));
  const u = id => s.stats.get(id);

  assert.deepEqual([u('u1').wins, u('u1').losses], [2, 1]);
  assert.equal(u('u1').pointsFor, 280);
  assert.equal(u('u1').pointsAgainst, 300);
  near(u('u1').expectedWins, 1 + 0 + 1);
  near(u('u2').expectedWins, 2 / 3 + 1 + 0.5);
  near(u('u3').expectedWins, 1 / 3 + 1 / 3 + 0.5);
  near(u('u4').expectedWins, 0 + 2 / 3 + 0);

  assert.deepEqual([u('u3').closeWins, u('u3').closeLosses], [0, 1]);
  assert.deepEqual([u('u4').closeWins, u('u4').closeLosses], [1, 0]);
  assert.equal(u('u1').topScoreWeeks, 2);
  assert.equal(u('u4').lowScoreWeeks, 2);

  // u1 and u3 are both 2-1; u1 has more points. u2 and u4 are both 1-2.
  assert.deepEqual(['u1', 'u2', 'u3', 'u4'].map(id => u(id).finish), [1, 3, 2, 4]);

  assert.equal(s.champion, 'u3');
  assert.equal(s.runnerUp, 'u1');
  assert.equal(s.topSeed, 'u1');
  assert.equal(s.lastPlace, 'u4');
  assert.deepEqual([...s.playoffTeams].sort(), ['u1', 'u3']);
  assert.equal(u('u3').playoffWins, 1);
  near(u('u3').playoffExpectedWins, 1);
  assert.equal(u('u1').playoffLosses, 1);
  near(u('u1').playoffExpectedWins, 2 / 3);
  assert.equal(u('u2').playoffWins + u('u2').playoffLosses, 0);
  assert.equal(s.savedRecordsDiffer, false);
});

test('flags a season whose saved standings disagree with the weekly scores', () => {
  const season = fakeSeason(2020);
  season.rosters[1].settings.wins = 2;
  assert.equal(summarizeSeason(season).savedRecordsDiffer, true);
});

test('history adds up finished seasons only and picks superlatives with a runner-up', () => {
  const currentUsers = [{ user_id: 'u1', display_name: 'alpha', metadata: { team_name: 'Old Guard' } }];
  const h = buildHistory([fakeSeason(2021), fakeSeason(2020), fakeSeason(2022, 'in_season')], currentUsers);
  const m = id => h.managers.find(x => x.ownerId === id);

  assert.equal(h.firstSeason, 2020);
  assert.equal(h.lastSeason, 2021);
  assert.deepEqual(h.seasons.map(s => s.season), [2020, 2021]);
  assert.equal(h.leagueName, 'Test League');

  assert.deepEqual([m('u3').titles, m('u3').finals, m('u3').playoffTrips], [2, 2, 2]);
  assert.deepEqual([m('u1').titles, m('u1').finals, m('u1').playoffTrips], [0, 2, 2]);
  assert.equal(m('u2').playoffTrips, 0);
  near(m('u1').winPct, 4 / 6);

  // Per season: u3 won 2 against 7/6 earned and held serve in the final; u1
  // matched their 2 earned wins but lost a final they were 2/3 likely to win.
  near(m('u3').luck, 2 * (2 - 7 / 6));
  near(m('u1').luck, 2 * (0 - 2 / 3));
  near(m('u1').regularLuck, 0);
  near(m('u2').luck, 2 * (1 - 13 / 6));
  near(m('u4').luck, 2 * (1 - 2 / 3));
  near(m('u1').seasons[0].luck, -2 / 3);

  near(m('u2').strength, 13 / 18);
  assert.deepEqual(h.managers.map(x => x.ownerId), ['u2', 'u1', 'u3', 'u4']);
  assert.deepEqual([h.best.manager.ownerId, h.best.next.ownerId], ['u2', 'u1']);
  assert.deepEqual([h.worst.manager.ownerId, h.worst.next.ownerId], ['u4', 'u3']);
  assert.deepEqual([h.luckiest.manager.ownerId, h.luckiest.next.ownerId], ['u3', 'u4']);
  assert.deepEqual([h.unluckiest.manager.ownerId, h.unluckiest.next.ownerId], ['u2', 'u1']);

  assert.deepEqual([m('u1').teamName, m('u1').userName], ['Old Guard', 'alpha']);
  assert.equal(m('u2').teamName, 'user2');
});

test('no finished seasons means no managers or superlatives', () => {
  const h = buildHistory([fakeSeason(2026, 'in_season')]);
  assert.deepEqual(h.managers, []);
  assert.equal(h.best.manager, null);
  assert.equal(h.firstSeason, null);
});

test('earlier seasons are prepended and labeled only for the league they precede', () => {
  const sleeper = [{ ...fakeSeason(2019), league: { ...fakeSeason(2019).league, league_id: 'first-sleeper' } }];
  const earlier = { source: 'Yahoo records', precedesLeagueId: 'first-sleeper', seasons: [fakeSeason(2018)] };

  const merged = withEarlierSeasons(sleeper, earlier);
  assert.deepEqual(merged.map(s => s.league.season), ['2018', '2019']);
  assert.equal(merged[0].league.source, 'Yahoo records');
  assert.equal(merged[1].league.source, undefined);
  assert.deepEqual(buildHistory(merged).seasons.map(s => s.source), ['Yahoo records', null]);

  assert.equal(withEarlierSeasons(sleeper, { ...earlier, precedesLeagueId: 'other-league' }), sleeper);
  assert.equal(withEarlierSeasons(sleeper, null), sleeper);
});
