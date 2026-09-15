// Rating logic for a Sleeper dynasty league. No DOM or network code here, so
// node:test can run it against small synthetic leagues.

export const SKILL_POSITIONS = ['QB', 'RB', 'WR', 'TE'];

// Positions each Sleeper lineup slot accepts. K, DEF and IDP slots are left
// out: FantasyCalc doesn't value them, so they can't move a rating.
const SLOT_ELIGIBILITY = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
};

// How much bench players count after the starting lineup. The current rating
// only credits the first few backups (byes, injuries). The future rating
// reaches deeper, because today's young bench players are next year's starters.
export const BENCH_TIERS = {
  current: [{ count: 6, weight: 0.2 }],
  future: [
    { count: 6, weight: 0.6 },
    { count: 6, weight: 0.3 },
    { count: Infinity, weight: 0.1 },
  ],
};

export const QUADRANTS = {
  powerhouse: 'Powerhouse',
  'win-now': 'Win now',
  rising: 'On the rise',
  rebuild: 'Rebuild',
};

export function lineupSlots(rosterPositions) {
  // Narrowest slots first, so a FLEX never takes the only player who could fill RB.
  return rosterPositions
    .filter(slot => SLOT_ELIGIBILITY[slot])
    .sort((a, b) => SLOT_ELIGIBILITY[a].length - SLOT_ELIGIBILITY[b].length);
}

export function bestLineup(players, slots, key) {
  const pool = [...players].sort((a, b) => b[key] - a[key]);
  const used = new Set();
  const lineup = slots.map(slot => {
    const player = pool.find(p => !used.has(p.id) && SLOT_ELIGIBILITY[slot].includes(p.position)) ?? null;
    if (player) used.add(player.id);
    return { slot, player };
  });
  return { lineup, bench: pool.filter(p => !used.has(p.id)) };
}

// Expects the bench already sorted by `key`, as bestLineup returns it.
export function benchValue(bench, key, tiers) {
  let total = 0;
  let i = 0;
  for (const { count, weight } of tiers) {
    for (let n = 0; n < count && i < bench.length; n++, i++) total += bench[i][key] * weight;
  }
  return total;
}

// A position group is its dedicated starters plus one more if a flex slot can
// use it: RB3/WR3 matter in a 2-flex league, QB2 doesn't in a 1QB league.
export function positionDepth(slots) {
  return Object.fromEntries(SKILL_POSITIONS.map(pos => {
    const dedicated = slots.filter(s => s === pos).length;
    const flex = slots.some(s => s !== pos && SLOT_ELIGIBILITY[s].includes(pos)) ? 1 : 0;
    return [pos, dedicated + flex];
  }));
}

// Sleeper allows trading picks three years out, plus this year's picks until
// this year's rookie draft has run.
export function pickSeasons(season, drafts) {
  const current = Number(season);
  const draftDone = drafts.some(d => Number(d.season) === current && d.status === 'complete');
  const seasons = [];
  for (let s = draftDone ? current + 1 : current; s <= current + 3; s++) seasons.push(s);
  return seasons;
}

// Sleeper only lists picks that changed hands; every other pick still belongs
// to its original team.
export function futurePicks({ rosterIds, seasons, rounds, tradedPicks }) {
  const owners = new Map();
  for (const season of seasons) {
    for (let round = 1; round <= rounds; round++) {
      for (const rosterId of rosterIds) owners.set(`${season}-${round}-${rosterId}`, rosterId);
    }
  }
  for (const t of tradedPicks) {
    const key = `${t.season}-${t.round}-${t.roster_id}`;
    if (owners.has(key)) owners.set(key, t.owner_id);
  }
  return [...owners].map(([key, ownerId]) => {
    const [season, round, originalRosterId] = key.split('-').map(Number);
    return { season, round, originalRosterId, ownerId };
  });
}

export function ordinal(n) {
  const suffix = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (suffix[(v - 20) % 10] || suffix[v] || suffix[0]);
}

export function pickTier(slot, numTeams) {
  const third = Math.round(numTeams / 3);
  if (slot <= third) return 'Early';
  if (slot > numTeams - third) return 'Late';
  return 'Mid';
}

// FantasyCalc prices next year's picks as Early/Mid/Late and later years as a
// single generic pick. Try the specific name first, then the generic one.
export function pickValue(pick, slot, numTeams, pickValues) {
  const generic = `${pick.season} ${ordinal(pick.round)}`;
  const tier = slot ? pickTier(slot, numTeams) : null;
  const names = tier ? [`${generic} (${tier})`, generic] : [generic];
  const name = names.find(n => pickValues.has(n));
  return name
    ? { name, tier: name === generic ? null : tier, value: pickValues.get(name), matched: true }
    : { name: generic, tier: null, value: 0, matched: false };
}

// Projections this small (backups, rookies) make a noisy ratio, so those QBs
// get the typical boost instead of their own.
export const RELIABLE_BASELINE_PTS = 150;

// FantasyCalc values assume 4-point passing TDs. For a league that scores them
// differently, scale each QB by how much that changes their projected season:
// league-scoring points ÷ the same points with 4-point passing TDs.
export function qbScoringBoosts(projections, scoring) {
  const passTd = scoring.pass_td ?? 4;
  if (passTd === 4 || !projections?.length) return null;
  const byPlayer = new Map();
  for (const { player_id: id, stats = {} } of projections) {
    const points = Object.entries(stats)
      .reduce((sum, [key, v]) => sum + (typeof v === 'number' ? (scoring[key] ?? 0) * v : 0), 0);
    const baseline = points - (passTd - 4) * (stats.pass_td ?? 0);
    if (baseline >= RELIABLE_BASELINE_PTS) byPlayer.set(String(id), points / baseline);
  }
  if (!byPlayer.size) return null;
  const ratios = [...byPlayer.values()];
  return { passTd, byPlayer, typical: median(ratios), min: Math.min(...ratios), max: Math.max(...ratios) };
}

// Linear map: highest value → 100, lowest → floor. Keeps order and relative gaps.
export function stretchScores(values, floor) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return values.map(v => (max === min ? 100 : floor + ((100 - floor) * (v - min)) / (max - min)));
}

const sumBy = (items, fn) => items.reduce((total, item) => total + fn(item), 0);

function rank(teams, valueOf, assign) {
  [...teams].sort((a, b) => valueOf(b) - valueOf(a)).forEach((team, i) => assign(team, i + 1));
}

function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function rateLeague({ league, users, rosters, tradedPicks, drafts, values, players = {}, projections = [] }) {
  const qbBoost = qbScoringBoosts(projections, league.scoring_settings ?? {});
  const slots = lineupSlots(league.roster_positions);
  const depth = positionDepth(slots);
  const numTeams = rosters.length;
  const seasons = pickSeasons(league.season, drafts);

  const bySleeperId = new Map();
  const pickValues = new Map();
  for (const v of values) {
    if (v.player.position === 'PICK') pickValues.set(v.player.name, v.value);
    else if (v.player.sleeperId) bySleeperId.set(String(v.player.sleeperId), v);
  }
  const usersById = new Map(users.map(u => [u.user_id, u]));

  const teams = rosters.map(roster => {
    const taxi = new Set(roster.taxi ?? []);
    const reserve = new Set(roster.reserve ?? []);
    const rosterPlayers = (roster.players ?? []).map(id => {
      const fc = bySleeperId.get(id);
      const sleeper = players[id];
      const position = fc?.player.position ?? sleeper?.position ?? '?';
      const boost = position === 'QB' && qbBoost ? qbBoost.byPlayer.get(id) ?? qbBoost.typical : 1;
      return {
        id,
        name: fc?.player.name ?? sleeper?.name ?? `Player ${id}`,
        position,
        team: fc?.player.maybeTeam ?? sleeper?.team ?? null,
        age: fc?.player.maybeAge ?? sleeper?.age ?? null,
        redraft: (fc?.redraftValue ?? 0) * boost,
        dynasty: (fc?.value ?? 0) * boost,
        boost,
        valued: Boolean(fc),
        taxi: taxi.has(id),
        ir: reserve.has(id),
      };
    });

    const skill = rosterPlayers.filter(p => SKILL_POSITIONS.includes(p.position));
    const now = bestLineup(skill, slots, 'redraft');
    const later = bestLineup(skill, slots, 'dynasty');
    const starters = now.lineup.map(s => s.player).filter(Boolean);
    const aged = starters.filter(p => p.age != null);
    const futureStarterValue = sumBy(later.lineup.filter(s => s.player), s => s.player.dynasty);

    const groups = Object.fromEntries(SKILL_POSITIONS.map(pos => {
      const atPos = skill.filter(p => p.position === pos);
      const top = key => sumBy([...atPos].sort((a, b) => b[key] - a[key]).slice(0, depth[pos]), p => p[key]);
      return [pos, { current: top('redraft'), future: top('dynasty') }];
    }));

    const user = usersById.get(roster.owner_id);
    const s = roster.settings ?? {};
    return {
      rosterId: roster.roster_id,
      ownerId: roster.owner_id,
      teamName: user?.metadata?.team_name || user?.display_name || `Team ${roster.roster_id}`,
      userName: user?.display_name ?? '',
      record: {
        wins: s.wins ?? 0,
        losses: s.losses ?? 0,
        ties: s.ties ?? 0,
        pointsFor: (s.fpts ?? 0) + (s.fpts_decimal ?? 0) / 100,
      },
      players: rosterPlayers,
      currentLineup: now,
      futureLineup: later,
      currentValue: sumBy(starters, p => p.redraft) + benchValue(now.bench, 'redraft', BENCH_TIERS.current),
      futureStarterValue,
      futurePlayerValue: futureStarterValue + benchValue(later.bench, 'dynasty', BENCH_TIERS.future),
      starterAge: aged.length ? sumBy(aged, p => p.age) / aged.length : null,
      groups,
    };
  });

  rank(teams, t => t.currentValue, (t, r) => { t.currentRank = r; });

  // Weakest current roster projects to the first pick. That only matters for
  // the nearest draft, the one year the market prices early/mid/late.
  const projectedSlot = new Map(teams.map(t => [t.rosterId, numTeams + 1 - t.currentRank]));
  const picks = futurePicks({
    rosterIds: teams.map(t => t.rosterId),
    seasons,
    rounds: league.settings.draft_rounds,
    tradedPicks,
  });
  const unmatchedPicks = new Set();
  for (const pick of picks) {
    const slot = pick.season === seasons[0] ? projectedSlot.get(pick.originalRosterId) : null;
    Object.assign(pick, { projectedSlot: slot }, pickValue(pick, slot, numTeams, pickValues));
    if (!pick.matched) unmatchedPicks.add(pick.name);
  }

  for (const team of teams) {
    team.picks = picks
      .filter(p => p.ownerId === team.rosterId)
      .sort((a, b) => a.season - b.season || a.round - b.round || b.value - a.value);
    team.pickValue = sumBy(team.picks, p => p.value);
    team.futureValue = team.futurePlayerValue + team.pickValue;
  }
  rank(teams, t => t.futureValue, (t, r) => { t.futureRank = r; });
  rank(teams, t => t.pickValue, (t, r) => { t.pickRank = r; });
  for (const pos of SKILL_POSITIONS) {
    for (const when of ['current', 'future']) {
      rank(teams, t => t.groups[pos][when], (t, r) => { t.groups[pos][`${when}Rank`] = r; });
    }
  }

  const maxCurrent = Math.max(...teams.map(t => t.currentValue)) || 1;
  // Picks and bench depth add a similar amount to every roster, which bunches
  // long-term totals near the top. Stretch them so best-to-worst spans the same
  // gap the long-term starting lineups do; order and relative gaps are kept.
  const starterValues = teams.map(t => t.futureStarterValue);
  const futureFloor = (100 * Math.min(...starterValues)) / (Math.max(...starterValues) || 1);
  const futureScores = stretchScores(teams.map(t => t.futureValue), futureFloor);
  teams.forEach((team, i) => {
    team.currentScore = (100 * team.currentValue) / maxCurrent;
    team.futureScore = futureScores[i];
  });
  const midCurrent = median(teams.map(t => t.currentScore));
  const midFuture = median(teams.map(t => t.futureScore));
  for (const team of teams) {
    const now = team.currentScore >= midCurrent;
    const later = team.futureScore >= midFuture;
    team.quadrant = now && later ? 'powerhouse' : now ? 'win-now' : later ? 'rising' : 'rebuild';
  }

  return {
    teams: teams.sort((a, b) => a.currentRank - b.currentRank),
    slots,
    depth,
    seasons,
    midCurrent,
    midFuture,
    futureFloor,
    qbBoost: qbBoost && { passTd: qbBoost.passTd, typical: qbBoost.typical, min: qbBoost.min, max: qbBoost.max },
    unmatchedPicks: [...unmatchedPicks],
  };
}
