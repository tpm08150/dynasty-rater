// League history from finished Sleeper seasons: records rebuilt from weekly
// scores, weekly strength (all-play), luck, and playoff results. No DOM or
// network code, so node:test can run it against small synthetic seasons.

// Games decided by less than this many points count as close.
export const CLOSE_GAME_POINTS = 5;

// Seasons from before the league moved to Sleeper, shipped as data/yahoo-seasons.json.
// They're only added when the Sleeper history reaches the season they precede, so
// another league's history never picks them up.
export function withEarlierSeasons(seasons, earlier) {
  if (!earlier?.seasons?.length) return seasons;
  if (!seasons.some(s => s.league.league_id === earlier.precedesLeagueId)) return seasons;
  const marked = earlier.seasons.map(s => ({ ...s, league: { ...s.league, source: earlier.source } }));
  return [...marked, ...seasons];
}

// Share of the other teams a score beat that week; ties count half.
export function allPlayShare(points, rosterId) {
  const mine = points.get(rosterId);
  let beaten = 0;
  for (const [id, p] of points) {
    if (id !== rosterId) beaten += p < mine ? 1 : p === mine ? 0.5 : 0;
  }
  return points.size > 1 ? beaten / (points.size - 1) : 0;
}

const weekPoints = (games = []) => new Map(games.map(m => [m.roster_id, m.points ?? 0]));

function headToHead(games = []) {
  const byMatchup = new Map();
  for (const m of games) {
    if (m.matchup_id == null) continue;
    byMatchup.set(m.matchup_id, [...(byMatchup.get(m.matchup_id) ?? []), m]);
  }
  return [...byMatchup.values()].filter(pair => pair.length === 2);
}

const blankStats = () => ({
  wins: 0, losses: 0, ties: 0, games: 0, pointsFor: 0, pointsAgainst: 0,
  weeks: 0, expectedWins: 0, closeWins: 0, closeLosses: 0, topScoreWeeks: 0, lowScoreWeeks: 0,
  playoffWins: 0, playoffLosses: 0, playoffExpectedWins: 0,
});

// Wins beyond what the scores earned, counting playoff games too.
const luckOf = s => s.wins + s.ties / 2 - s.expectedWins + s.playoffWins - s.playoffExpectedWins;

export function summarizeSeason({ league, rosters, matchups, winnersBracket = [] }) {
  const start = league.settings.playoff_week_start;
  const owner = new Map(rosters.map(r => [r.roster_id, r.owner_id]));
  const stats = new Map(rosters.map(r => [r.owner_id, blankStats()]));

  for (let week = 1; week < start; week++) {
    const games = matchups[week];
    if (!games?.length) continue;
    const points = weekPoints(games);
    const high = Math.max(...points.values());
    const low = Math.min(...points.values());
    for (const [rosterId, p] of points) {
      const s = stats.get(owner.get(rosterId));
      s.weeks += 1;
      s.expectedWins += allPlayShare(points, rosterId);
      if (p === high) s.topScoreWeeks += 1;
      if (p === low) s.lowScoreWeeks += 1;
    }
    for (const [a, b] of headToHead(games)) {
      for (const [me, opp] of [[a, b], [b, a]]) {
        const s = stats.get(owner.get(me.roster_id));
        const margin = me.points - opp.points;
        s.games += 1;
        s.pointsFor += me.points;
        s.pointsAgainst += opp.points;
        if (margin > 0) s.wins += 1;
        else if (margin < 0) s.losses += 1;
        else s.ties += 1;
        if (margin !== 0 && Math.abs(margin) < CLOSE_GAME_POINTS) {
          if (margin > 0) s.closeWins += 1;
          else s.closeLosses += 1;
        }
      }
    }
  }

  const standings = [...stats].sort(([, a], [, b]) =>
    (b.wins + b.ties / 2) - (a.wins + a.ties / 2) || b.pointsFor - a.pointsFor);
  standings.forEach(([, s], i) => { s.finish = i + 1; });

  // Multi-week playoff rounds would need their weeks summed; only one-week
  // rounds count toward playoff luck.
  const oneWeekRounds = !league.settings.playoff_round_type;
  const playoffTeams = new Set();
  let champion = null;
  let runnerUp = null;
  for (const game of winnersBracket) {
    for (const team of [game.t1, game.t2]) if (Number.isInteger(team)) playoffTeams.add(owner.get(team));
    if (game.p === 1) {
      champion = owner.get(game.w) ?? null;
      runnerUp = owner.get(game.l) ?? null;
    }
    // Placement games (3rd, 5th) don't decide anything that matters.
    const elimination = game.p == null || game.p === 1;
    const points = weekPoints(matchups[start + game.r - 1]);
    if (!elimination || !oneWeekRounds || !points.has(game.w) || !points.has(game.l)) continue;
    for (const [rosterId, won] of [[game.w, true], [game.l, false]]) {
      const s = stats.get(owner.get(rosterId));
      if (won) s.playoffWins += 1;
      else s.playoffLosses += 1;
      s.playoffExpectedWins += allPlayShare(points, rosterId);
    }
  }

  const savedRecordsDiffer = rosters.some(r => {
    const saved = r.settings ?? {};
    const s = stats.get(r.owner_id);
    return saved.wins != null
      && (saved.wins !== s.wins || (saved.losses ?? 0) !== s.losses || (saved.ties ?? 0) !== s.ties);
  });

  return {
    season: Number(league.season),
    source: league.source ?? null,
    teams: rosters.length,
    stats,
    playoffTeams,
    champion,
    runnerUp,
    topSeed: standings[0]?.[0] ?? null,
    lastPlace: standings.at(-1)?.[0] ?? null,
    savedRecordsDiffer,
  };
}

export function buildHistory(seasons, currentUsers = []) {
  const finished = seasons
    .filter(s => s.league.status === 'complete')
    .sort((a, b) => Number(a.league.season) - Number(b.league.season));

  // Latest names win: older seasons carry old display names.
  const names = new Map();
  for (const u of [...finished.flatMap(s => s.users), ...currentUsers]) {
    names.set(u.user_id, {
      userName: u.display_name ?? '',
      teamName: u.metadata?.team_name || u.display_name || 'Unknown manager',
    });
  }

  const summaries = finished.map(summarizeSeason);
  const careers = new Map();
  for (const summary of summaries) {
    for (const [ownerId, s] of summary.stats) {
      const career = careers.get(ownerId)
        ?? { ownerId, ...blankStats(), titles: 0, finals: 0, playoffTrips: 0, seasons: [] };
      for (const key of Object.keys(blankStats())) career[key] += s[key];
      const champion = summary.champion === ownerId;
      const runnerUp = summary.runnerUp === ownerId;
      const madePlayoffs = summary.playoffTeams.has(ownerId);
      career.titles += Number(champion);
      career.finals += Number(champion || runnerUp);
      career.playoffTrips += Number(madePlayoffs);
      career.seasons.push({ ...s, season: summary.season, teams: summary.teams, champion, runnerUp, madePlayoffs, luck: luckOf(s) });
      careers.set(ownerId, career);
    }
  }

  const managers = [...careers.values()].map(c => {
    const regularLuck = c.wins + c.ties / 2 - c.expectedWins;
    const playoffLuck = c.playoffWins - c.playoffExpectedWins;
    return {
      ...c,
      ...(names.get(c.ownerId) ?? { userName: '', teamName: 'Unknown manager' }),
      winPct: c.games ? (c.wins + c.ties / 2) / c.games : 0,
      strength: c.weeks ? c.expectedWins / c.weeks : 0,
      pointsPerWeek: c.games ? c.pointsFor / c.games : 0,
      regularLuck,
      playoffLuck,
      luck: regularLuck + playoffLuck,
    };
  }).sort((a, b) => b.strength - a.strength);

  const leader = (key, direction) => {
    const sorted = [...managers].sort((a, b) => direction * (b[key] - a[key]));
    return { manager: sorted[0] ?? null, next: sorted[1] ?? null };
  };

  return {
    leagueName: finished.at(-1)?.league.name ?? '',
    firstSeason: summaries[0]?.season ?? null,
    lastSeason: summaries.at(-1)?.season ?? null,
    seasons: summaries.map(({ season, source, champion, runnerUp, topSeed, lastPlace, savedRecordsDiffer }) =>
      ({ season, source, champion, runnerUp, topSeed, lastPlace, savedRecordsDiffer })),
    managers,
    best: leader('strength', 1),
    worst: leader('strength', -1),
    luckiest: leader('luck', 1),
    unluckiest: leader('luck', -1),
  };
}
