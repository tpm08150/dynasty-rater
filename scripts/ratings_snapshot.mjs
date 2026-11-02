// Prints the site's live roster ratings as JSON so the magazine builder uses the
// exact same engine as the Ratings page. Run from the repo root:
//     node scripts/ratings_snapshot.mjs [leagueId]
import { rateLeague } from '../rating.js';
import { fantasyCalcUrl } from '../data.js';

const LEAGUE_ID = process.argv[2] || '1312979994133139456';
const SLEEPER = 'https://api.sleeper.app/v1';

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${new URL(url).host} answered HTTP ${res.status}`);
  return res.json();
}

const [league, users, rosters, tradedPicks, drafts] = await Promise.all(
  ['', '/users', '/rosters', '/traded_picks', '/drafts'].map(p => getJSON(`${SLEEPER}/league/${LEAGUE_ID}${p}`)));
if (!league) throw new Error(`Sleeper has no league with ID ${LEAGUE_ID}`);

const needsQbBoost = (league.scoring_settings.pass_td ?? 4) !== 4;
const [values, projections] = await Promise.all([
  getJSON(fantasyCalcUrl(league)),
  needsQbBoost
    ? getJSON(`https://api.sleeper.app/projections/nfl/${league.season}?season_type=regular&position[]=QB`)
    : [],
]);

const rating = rateLeague({ league, users, rosters, tradedPicks, drafts, values, projections });

console.log(JSON.stringify({
  season: Number(league.season),
  week: league.settings.leg,
  leagueName: league.name,
  qbBoost: rating.qbBoost,
  teams: rating.teams.map(t => ({
    ownerId: t.ownerId,
    team: t.teamName,
    user: t.userName,
    current: +t.currentScore.toFixed(1),
    currentRank: t.currentRank,
    future: +t.futureScore.toFixed(1),
    futureRank: t.futureRank,
    starterAge: t.starterAge == null ? null : +t.starterAge.toFixed(1),
    pickValue: Math.round(t.pickValue),
    pickRank: t.pickRank,
    positionRanks: Object.fromEntries(Object.entries(t.groups)
      .map(([pos, g]) => [pos, { current: g.currentRank, future: g.futureRank }])),
    // The most valuable long-term pieces in the starting lineup, best first.
    core: t.futureLineup.lineup.filter(s => s.player).map(s => s.player)
      .sort((a, b) => b.dynasty - a.dynasty)
      .slice(0, 5)
      .map(p => ({ name: p.name, position: p.position, age: p.age })),
  })),
}));
