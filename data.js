// Network layer: Sleeper for the league, FantasyCalc for player and pick values.
// Both send `Access-Control-Allow-Origin: *`, so the page needs no server of its own.

const SLEEPER = 'https://api.sleeper.app/v1';
const PLAYERS_KEY = 'dynasty-rater:sleeper-players:v1';
const DAY_MS = 24 * 60 * 60 * 1000;

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${new URL(url).host} answered HTTP ${res.status}`);
  return res.json();
}

export async function loadLeagueData(leagueId) {
  const [league, users, rosters, tradedPicks, drafts] = await Promise.all([
    getJSON(`${SLEEPER}/league/${leagueId}`),
    getJSON(`${SLEEPER}/league/${leagueId}/users`),
    getJSON(`${SLEEPER}/league/${leagueId}/rosters`),
    getJSON(`${SLEEPER}/league/${leagueId}/traded_picks`),
    getJSON(`${SLEEPER}/league/${leagueId}/drafts`),
  ]);
  // Sleeper answers an unknown league ID with 200 and a null body.
  if (!league) throw new Error(`Sleeper has no league with ID ${leagueId}`);

  const [values, playerInfo] = await Promise.all([
    getJSON(fantasyCalcUrl(league)),
    loadPlayers(),
  ]);
  return { league, users, rosters, tradedPicks, drafts, values, ...playerInfo };
}

// Values must match the league's format: a 1QB value for a superflex league
// underrates every quarterback by roughly half.
export function fantasyCalcUrl(league) {
  const qbSlots = league.roster_positions.filter(s => s === 'QB' || s === 'SUPER_FLEX').length;
  const params = new URLSearchParams({
    isDynasty: 'true',
    numQbs: qbSlots >= 2 ? '2' : '1',
    numTeams: String(league.settings.num_teams),
    ppr: String(league.scoring_settings.rec ?? 0),
  });
  return `https://api.fantasycalc.com/values/current?${params}`;
}

// Sleeper's full player list is ~15 MB and they ask callers to fetch it at most
// daily. It's only needed for names FantasyCalc lacks (K, DEF, deep bench), so
// keep a trimmed copy for a day and carry on without it if it can't load.
async function loadPlayers() {
  const cached = readPlayerCache();
  if (cached && Date.now() - cached.fetchedAt < DAY_MS) return { players: cached.players };
  try {
    const players = trimPlayers(await getJSON(`${SLEEPER}/players/nfl`));
    writePlayerCache({ fetchedAt: Date.now(), players });
    return { players };
  } catch (err) {
    if (cached) return { players: cached.players };
    return { players: {}, playersError: `Couldn't load Sleeper's player list (${err.message}), so some kickers, defenses and deep-bench players show as IDs.` };
  }
}

export function trimPlayers(raw) {
  const players = {};
  for (const [id, p] of Object.entries(raw)) {
    if (!p.position) continue;
    const name = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ');
    players[id] = { name, position: p.position, team: p.team ?? null, age: p.age ?? null };
  }
  return players;
}

function readPlayerCache() {
  try {
    return JSON.parse(localStorage.getItem(PLAYERS_KEY));
  } catch {
    return null;
  }
}

function writePlayerCache(entry) {
  try {
    localStorage.setItem(PLAYERS_KEY, JSON.stringify(entry));
  } catch {
    // Private windows and full storage throw; the list just reloads next visit.
  }
}
