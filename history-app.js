import { loadLeagueHistory, loadSiteData } from './data.js';
import { buildHistory, withEarlierSeasons, CLOSE_GAME_POINTS } from './history.js';
import { ordinal } from './rating.js';
import { $, el, leagueId, darkQuery, showStatus, withTooltip, rampColor, inkFor, wireNav } from './ui.js';

// Bump when data/*.json changes so browsers don't keep a cached copy.
const DATA_VERSION = '20260915c';

const state = { history: null, deals: null };

const pct = n => `${Math.round(n * 100)}%`;
const pct1 = n => `${(n * 100).toFixed(1)}%`;
const signed = n => `${n < 0 ? '−' : '+'}${Math.abs(n).toFixed(1)}`;
const record = s => `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const managerById = id => state.history.managers.find(m => m.ownerId === id);
const handle = m => (m.userName && m.userName !== m.teamName ? `@${m.userName}` : null);

async function load() {
  showStatus('Loading every season from Sleeper…');
  try {
    const [{ seasons, currentUsers }, earlier, deals] = await Promise.all([
      loadLeagueHistory(leagueId),
      loadSiteData(`data/yahoo-seasons.json?v=${DATA_VERSION}`),
      loadSiteData(`data/deals.json?v=${DATA_VERSION}`),
    ]);
    state.history = buildHistory(withEarlierSeasons(seasons, earlier), currentUsers);
    // Draft and trade grades are built offline for one league; skip them for any other.
    state.deals = deals?.leagueIds?.includes(leagueId) ? deals : null;
  } catch (err) {
    showStatus(`Error: couldn't load league history. ${err.message}`, true);
    return;
  }
  if (!state.history.managers.length) {
    showStatus('No finished seasons on Sleeper yet. History fills in once a season is complete.');
    return;
  }
  showStatus('');
  $('#app').hidden = false;
  render();
}

function render() {
  renderHeader();
  renderAwards();
  renderDeals();
  renderWaivers();
  renderLuck();
  renderChampions();
  renderCareers();
  renderFinishes();
  renderHow();
}

function renderHeader() {
  const { leagueName, firstSeason, lastSeason, seasons, managers } = state.history;
  document.title = `${leagueName} history · Dynasty Rater`;
  $('#history-meta').textContent = [
    leagueName,
    firstSeason === lastSeason ? String(firstSeason) : `${firstSeason}–${lastSeason}`,
    plural(seasons.length, 'season'),
    plural(managers.length, 'manager'),
  ].filter(Boolean).join(' · ');
  const firstSleeper = seasons.find(s => !s.source)?.season;
  $('#coverage').textContent = seasons.some(s => s.source) && firstSleeper
    ? `Covers ${firstSeason} onward. ${firstSeason}–${firstSleeper - 1} come from the commissioner’s records of the league’s Yahoo years; ${firstSleeper} on comes from Sleeper.`
    : `Covers ${firstSeason} onward, every season the league has played on Sleeper. The league’s first years were on Yahoo and aren’t included.`;
}

function thead(columns) {
  return el('thead', {}, el('tr', {}, columns.map(column => {
    const [label, cls] = Array.isArray(column) ? column : [column, null];
    return el('th', { scope: 'col', class: cls }, label);
  })));
}

// ---------- Superlatives ----------

function renderAwards() {
  const { best, worst, luckiest, unluckiest, bestLineup, worstLineup } = state.history;
  const strength = m => `Outscored ${pct(m.strength)} of the league in a typical week`;
  const luck = m => `${Math.abs(m.luck).toFixed(1)} ${m.luck >= 0 ? 'more' : 'fewer'} wins than their scores earned`;
  const resume = m => `${record(m)} · ${plural(m.titles, 'title')} · ${plural(m.playoffTrips, 'playoff trip')}`;
  const lineup = m => `Started ${pct1(m.lineupEfficiency)} of the points their best possible lineups would have scored`;
  const bench = m => `${m.benchPerWeek.toFixed(1)} points a week left on the bench`;
  $('#awards').replaceChildren(
    award('Best manager', best, strength, resume, m => pct(m.strength)),
    award('Worst manager', worst, strength, resume, m => pct(m.strength)),
    award('Luckiest', luckiest, luck, resume, m => signed(m.luck)),
    award('Unluckiest', unluckiest, luck, resume, m => signed(m.luck)),
    ...(bestLineup.manager ? [
      award('Best lineup setter', bestLineup, lineup, bench, m => pct1(m.lineupEfficiency)),
      award('Worst lineup setter', worstLineup, lineup, bench, m => pct1(m.lineupEfficiency)),
    ] : []),
  );
}

function award(label, { manager, next }, headline, detail, stat) {
  return el('div', { class: 'tile award' },
    el('div', { class: 'tile-label' }, label),
    el('div', { class: 'award-name' }, manager.teamName),
    handle(manager) ? el('div', { class: 'award-user' }, handle(manager)) : null,
    el('p', { class: 'award-line' }, headline(manager)),
    el('p', { class: 'award-detail' }, detail(manager)),
    next ? el('p', { class: 'award-next' }, `Next closest: ${next.teamName} (${stat(next)})`) : null);
}

// ---------- Draft room and trade table ----------

const pts = n => `${n < 0 ? '−' : '+'}${Math.abs(Math.round(n)).toLocaleString()}`;
const pickName = p => `${p.season} #${p.pick_no}`;
const assetList = side => side.received.map(a => a.label).join(', ') || 'nothing';

function infoTile({ label, name, handle: sub, line, detail, next }) {
  return el('div', { class: 'tile award' },
    el('div', { class: 'tile-label' }, label),
    el('div', { class: 'award-name' }, name),
    sub ? el('div', { class: 'award-user' }, sub) : null,
    el('p', { class: 'award-line' }, line),
    detail ? el('p', { class: 'award-detail' }, detail) : null,
    next ? el('p', { class: 'award-next' }, `Next closest: ${next}`) : null);
}

function renderDeals() {
  const { deals } = state;
  const section = $('#deals-section');
  const people = deals
    ? state.history.managers.filter(m => deals.managers[m.ownerId]).map(m => ({ ...m, deals: deals.managers[m.ownerId] }))
    : [];
  section.hidden = !people.length;
  if (!people.length) return;

  const teamName = id => managerById(id)?.teamName ?? 'Unknown manager';
  const byDraft = [...people].sort((a, b) => b.deals.draft.surplus - a.deals.draft.surplus);
  const traders = people.filter(m => m.deals.trades.graded > 0);
  const byTrades = [...traders].sort((a, b) => b.deals.trades.net - a.deals.trades.net);
  const bestPickOf = id => deals.picks.filter(p => p.userId === id).sort((a, b) => b.surplus - a.surplus)[0];
  const steals = [...deals.picks].sort((a, b) => b.surplus - a.surplus);
  const graded = deals.trades
    .filter(t => t.graded)
    .map(t => {
      const [winner, loser] = [...t.sides].sort((a, b) => b.net - a.net);
      return { ...t, winner, loser };
    })
    .sort((a, b) => b.winner.net - a.winner.net);
  const early = deals.trades.length - graded.length;

  $('#deals-sub').textContent = `Rookie drafts ${deals.firstSeason}–${deals.throughSeason} and every trade since ${deals.firstSeason}, graded on points above a replacement-level player at the same position.${early ? ` ${plural(early, 'recent trade')} ${early === 1 ? 'is' : 'are'} too early to grade.` : ''}`;

  const drafter = (label, list) => {
    const [m, next] = list;
    const best = bestPickOf(m.ownerId);
    return infoTile({
      label,
      name: m.teamName,
      handle: handle(m),
      line: `${pts(m.deals.draft.surplus)} points compared with what their draft spots usually produce`,
      detail: `${plural(m.deals.draft.picks, 'pick')}${best ? ` · best: ${pickName(best)} ${best.player}` : ''}`,
      next: next && `${next.teamName} (${pts(next.deals.draft.surplus)})`,
    });
  };
  const negotiator = (label, list) => {
    const [m, next] = list;
    const t = m.deals.trades;
    return infoTile({
      label,
      name: m.teamName,
      handle: handle(m),
      line: `${pts(t.net)} points across their graded trades`,
      detail: `${plural(t.graded, 'graded trade')} · won ${t.won}, lost ${t.lost}`,
      next: next && `${next.teamName} (${pts(next.deals.trades.net)})`,
    });
  };
  const [steal, nextSteal] = steals;
  const [lopsided, nextLopsided] = graded;
  $('#deal-awards').replaceChildren(
    drafter('Best drafter', byDraft),
    drafter('Worst drafter', [...byDraft].reverse()),
    ...(byTrades.length ? [negotiator('Best negotiator', byTrades), negotiator('Worst negotiator', [...byTrades].reverse())] : []),
    steal ? infoTile({
      label: 'Biggest draft steal',
      name: steal.player,
      handle: `${pickName(steal)} · ${teamName(steal.userId)}`,
      line: `${Math.round(steal.outcome)} points above replacement, where that pick usually brings ${Math.round(steal.expected)}`,
      next: nextSteal && `${nextSteal.player}, ${pickName(nextSteal)} (${pts(nextSteal.surplus)})`,
    }) : null,
    lopsided ? infoTile({
      label: 'Most lopsided trade',
      name: teamName(lopsided.winner.userId),
      handle: `${lopsided.season} · over ${teamName(lopsided.loser.userId)}`,
      line: `Won by ${Math.round(lopsided.winner.net)} points`,
      detail: `Got ${assetList(lopsided.winner)} for ${assetList(lopsided.loser)}`,
      next: nextLopsided && `${teamName(nextLopsided.winner.userId)} in ${nextLopsided.season} (${pts(nextLopsided.winner.net)})`,
    }) : null,
  );

  const pickRows = list => list.slice(0, 5).map(p => el('tr', {},
    el('td', { class: 'num' }, pickName(p)),
    el('td', {}, el('span', { class: 'pname' }, p.player), el('span', { class: 'pmeta' }, [p.position, teamName(p.userId)].filter(Boolean).join(' · '))),
    el('td', { class: 'num' }, Math.round(p.outcome).toLocaleString()),
    el('td', { class: 'num hide-narrow' }, Math.round(p.expected).toLocaleString()),
    el('td', { class: 'num' }, pts(p.surplus))));
  const pickHead = thead([['Pick', 'num'], 'Player', ['Produced', 'num'], ['Typical', 'num hide-narrow'], ['+/−', 'num']]);
  $('#steals').replaceChildren(el('caption', {}, 'Biggest draft steals'), pickHead, el('tbody', {}, pickRows(steals)));
  $('#busts').replaceChildren(el('caption', {}, 'Biggest draft busts'), pickHead.cloneNode(true), el('tbody', {}, pickRows([...steals].reverse())));

  $('#lopsided').replaceChildren(
    el('caption', {}, 'Most lopsided trades'),
    thead(['Season', 'Winner', 'Got', ['Gave up', 'hide-narrow'], ['Margin', 'num']]),
    el('tbody', {}, graded.slice(0, 5).map(t => el('tr', {},
      el('td', {}, String(t.season)),
      el('td', {}, el('span', { class: 'pname' }, teamName(t.winner.userId)), el('span', { class: 'pmeta' }, `over ${teamName(t.loser.userId)}`)),
      el('td', {}, assetList(t.winner)),
      el('td', { class: 'hide-narrow' }, assetList(t.loser)),
      el('td', { class: 'num' }, pts(t.winner.net))))),
  );

  $('#deal-managers').replaceChildren(
    el('caption', {}, 'Drafting and trading by manager'),
    thead(['Manager', ['Picks', 'num hide-narrow'], ['Draft +/−', 'num'], ['Trades', 'num hide-narrow'], ['Won-lost', 'num hide-narrow'], ['Trade +/−', 'num']]),
    el('tbody', {}, byDraft.map(m => el('tr', {},
      el('td', {}, el('span', { class: 'pname' }, m.teamName), handle(m) ? el('span', { class: 'pmeta' }, handle(m)) : null),
      el('td', { class: 'num hide-narrow' }, String(m.deals.draft.picks)),
      el('td', { class: 'num' }, pts(m.deals.draft.surplus)),
      el('td', { class: 'num hide-narrow' }, `${m.deals.trades.graded} of ${m.deals.trades.total}`),
      el('td', { class: 'num hide-narrow' }, `${m.deals.trades.won}-${m.deals.trades.lost}`),
      el('td', { class: 'num' }, m.deals.trades.graded ? pts(m.deals.trades.net) : '—')))),
  );
}

// ---------- Waiver wire ----------

function renderWaivers() {
  const { deals } = state;
  const section = $('#waivers-section');
  const people = deals?.pickups
    ? state.history.managers.filter(m => deals.managers[m.ownerId]?.waivers).map(m => ({ ...m, w: deals.managers[m.ownerId].waivers }))
    : [];
  section.hidden = !people.length;
  if (!people.length) return;

  const teamName = id => managerById(id)?.teamName ?? 'Unknown manager';
  const net = m => m.w.value - m.w.dropCost;
  const ranked = [...people].sort((a, b) => net(b) - net(a));
  const pickups = [...deals.pickups].sort((a, b) => b.value - a.value);
  const drops = pickups.filter(p => p.droppedBy);

  $('#waivers-sub').textContent = `Every waiver claim and free-agent pickup ${deals.firstSeason}–${deals.throughSeason}. A pickup earns the points above replacement he scored in that team’s lineup for the rest of the season; what other teams got from players you dropped counts against you.`;

  const wireTile = (label, [m, next]) => infoTile({
    label,
    name: m.teamName,
    handle: handle(m),
    line: `${pts(net(m))} points net on the waiver wire`,
    detail: `Pickups ${pts(m.w.value)}, drops ${pts(-m.w.dropCost)} · ${plural(m.w.adds, 'add')}`,
    next: next && `${next.teamName} (${pts(net(next))})`,
  });
  const [pickup, nextPickup] = pickups;
  const [drop, nextDrop] = drops;
  $('#waiver-awards').replaceChildren(
    wireTile('Best on the waiver wire', ranked),
    wireTile('Worst on the waiver wire', [...ranked].reverse()),
    pickup ? infoTile({
      label: 'Best pickup',
      name: pickup.player,
      handle: `${pickup.season} week ${pickup.week} · ${teamName(pickup.userId)}`,
      line: `${Math.round(pickup.value)} points above replacement over ${plural(pickup.starts, 'start')}`,
      next: nextPickup && `${nextPickup.player}, ${teamName(nextPickup.userId)} ${nextPickup.season} (${pts(nextPickup.value)})`,
    }) : null,
    drop ? infoTile({
      label: 'Costliest drop',
      name: teamName(drop.droppedBy),
      handle: `dropped ${drop.player} in ${drop.season}`,
      line: `${teamName(drop.userId)} picked him up and got ${Math.round(drop.value)} points above replacement over ${plural(drop.starts, 'start')}`,
      next: nextDrop && `${teamName(nextDrop.droppedBy)} dropping ${nextDrop.player} in ${nextDrop.season} (${pts(-nextDrop.value)})`,
    }) : null,
  );

  const playerCell = (p, meta) => [el('span', { class: 'pname' }, p.player), el('span', { class: 'pmeta' }, [p.position, meta].filter(Boolean).join(' · '))];
  $('#pickups').replaceChildren(
    el('caption', {}, 'Best pickups'),
    thead(['When', 'Player', ['Starts', 'num hide-narrow'], ['Value', 'num']]),
    el('tbody', {}, pickups.slice(0, 5).map(p => el('tr', {},
      el('td', {}, `${p.season} wk ${p.week}`),
      el('td', {}, playerCell(p, teamName(p.userId))),
      el('td', { class: 'num hide-narrow' }, String(p.starts)),
      el('td', { class: 'num' }, pts(p.value))))),
  );
  $('#drops').replaceChildren(
    el('caption', {}, 'Costliest drops'),
    thead(['Dropped by', 'Player', ['Starts', 'num hide-narrow'], ['Cost', 'num']]),
    el('tbody', {}, drops.slice(0, 5).map(p => el('tr', {},
      el('td', {}, el('span', { class: 'pname' }, teamName(p.droppedBy)), el('span', { class: 'pmeta' }, String(p.season))),
      el('td', {}, playerCell(p, `to ${teamName(p.userId)}`)),
      el('td', { class: 'num hide-narrow' }, String(p.starts)),
      el('td', { class: 'num' }, pts(-p.value))))),
  );
  $('#waiver-managers').replaceChildren(
    el('caption', {}, 'Waiver wire by manager'),
    thead(['Manager', ['Adds', 'num hide-narrow'], ['Pickups started', 'num hide-narrow'], ['Pickups', 'num'], ['Drops', 'num'], ['Net', 'num']]),
    el('tbody', {}, ranked.map(m => el('tr', {},
      el('td', {}, el('span', { class: 'pname' }, m.teamName), handle(m) ? el('span', { class: 'pmeta' }, handle(m)) : null),
      el('td', { class: 'num hide-narrow' }, m.w.adds.toLocaleString()),
      el('td', { class: 'num hide-narrow' }, m.w.started.toLocaleString()),
      el('td', { class: 'num' }, pts(m.w.value)),
      el('td', { class: 'num' }, pts(-m.w.dropCost)),
      el('td', { class: 'num' }, pts(net(m)))))),
  );
}

// ---------- Luck chart ----------

function renderLuck() {
  const managers = [...state.history.managers].sort((a, b) => b.luck - a.luck);
  const max = Math.max(...managers.map(m => Math.abs(m.luck))) || 1;
  $('#luck').replaceChildren(...managers.map(m => {
    const row = el('div', {
      class: 'luck-row',
      tabindex: '0',
      'aria-label': `${m.teamName}: ${signed(m.luck)} wins compared with what their scores earned`,
    },
    el('span', { class: 'luck-name' }, m.teamName),
    el('span', { class: 'luck-track', 'aria-hidden': 'true' },
      el('span', { class: `luck-bar ${m.luck >= 0 ? 'up' : 'down'}`, style: { width: `${(Math.abs(m.luck) / max) * 50}%` } })),
    el('span', { class: 'luck-value' }, signed(m.luck)));
    withTooltip(row, () => ({
      title: m.teamName,
      rows: [
        [signed(m.regularLuck), 'regular season'],
        [signed(m.playoffLuck), 'playoffs'],
        [`${m.closeWins}-${m.closeLosses}`, `in games decided by under ${CLOSE_GAME_POINTS} points`],
      ],
    }));
    return row;
  }));
}

// ---------- Champions ----------

function renderChampions() {
  const name = id => managerById(id)?.teamName ?? '—';
  const rows = [...state.history.seasons].reverse().map(s => el('tr', {},
    el('td', {}, String(s.season)),
    // Non-breaking space keeps the trophy on the same line as the name.
    el('td', {}, s.champion ? `🏆 ${name(s.champion)}` : '—'),
    el('td', {}, name(s.runnerUp)),
    el('td', { class: 'hide-narrow' }, name(s.topSeed)),
    el('td', { class: 'hide-narrow' }, name(s.lastPlace))));
  $('#champions').replaceChildren(
    thead(['Season', 'Champion', 'Runner-up', ['Best record', 'hide-narrow'], ['Worst record', 'hide-narrow']]),
    el('tbody', {}, rows),
  );
}

// ---------- Career table ----------

function renderCareers() {
  const rows = state.history.managers.map((m, i) => el('tr', {},
    el('td', { class: 'num hide-narrow' }, String(i + 1)),
    el('td', {}, el('span', { class: 'pname' }, m.teamName), handle(m) ? el('span', { class: 'pmeta' }, handle(m)) : null),
    el('td', { class: 'num' }, record(m)),
    el('td', { class: 'num hide-narrow' }, pct(m.winPct)),
    el('td', { class: 'num' }, pct(m.strength)),
    el('td', { class: 'num hide-narrow' }, m.pointsPerWeek.toFixed(1)),
    el('td', { class: 'num hide-narrow' }, m.lineupEfficiency == null ? '—' : pct1(m.lineupEfficiency)),
    el('td', { class: 'num' }, signed(m.luck)),
    el('td', { class: 'num' }, String(m.titles)),
    el('td', { class: 'num hide-narrow' }, String(m.finals)),
    el('td', { class: 'num hide-narrow' }, `${m.playoffTrips} of ${m.seasons.length}`),
    el('td', { class: 'num hide-narrow' }, `${m.closeWins}-${m.closeLosses}`)));
  $('#careers').replaceChildren(
    thead([
      ['#', 'num hide-narrow'], 'Manager', ['Record', 'num'], ['Win %', 'num hide-narrow'],
      ['Strength', 'num'], ['Pts / week', 'num hide-narrow'], ['Lineup %', 'num hide-narrow'], ['Luck', 'num'], ['Titles', 'num'],
      ['Finals', 'num hide-narrow'], ['Playoffs', 'num hide-narrow'], ['Close games', 'num hide-narrow'],
    ]),
    el('tbody', {}, rows),
  );
}

// ---------- Finishes grid ----------

function renderFinishes() {
  const { managers, seasons } = state.history;
  $('#finish-sub').textContent = `Regular-season finish each year. 🏆 won the title, 🥈 lost the final. ${darkQuery.matches ? 'Lighter' : 'Darker'} cells finished higher.`;
  const rows = managers.map(m => el('tr', {},
    el('td', {}, m.teamName),
    seasons.map(({ season }) => {
      const s = m.seasons.find(x => x.season === season);
      if (!s) return el('td', { class: 'cell' }, '—');
      const background = rampColor(s.finish, s.teams);
      const result = s.champion ? 'won the title' : s.runnerUp ? 'lost the final' : s.madePlayoffs ? 'made the playoffs' : 'missed the playoffs';
      const cell = el('td', {
        class: 'cell',
        tabindex: '0',
        style: { background, color: inkFor(background) },
        'aria-label': `${m.teamName}, ${season}: finished ${ordinal(s.finish)} at ${record(s)} and ${result}`,
      }, `${s.champion ? '🏆 ' : s.runnerUp ? '🥈 ' : ''}${ordinal(s.finish)}`);
      withTooltip(cell, () => ({
        title: `${m.teamName} · ${season}`,
        rows: [
          [record(s), `${ordinal(s.finish)} in the regular season`],
          [s.pointsFor.toFixed(1), 'points'],
          [signed(s.luck), 'wins vs. what scores earned'],
          [result[0].toUpperCase() + result.slice(1), ''],
        ],
      }));
      return cell;
    })));
  $('#finishes').replaceChildren(
    thead(['Manager', ...seasons.map(s => String(s.season))]),
    el('tbody', {}, rows),
  );
}

// ---------- How it works ----------

function renderHow() {
  const { firstSeason, seasons } = state.history;
  const differ = seasons.filter(s => s.savedRecordsDiffer).map(s => s.season);
  const item = (label, text) => el('li', {}, el('strong', {}, label), text);
  $('#how').replaceChildren(
    el('summary', {}, 'How these are figured'),
    el('ul', {},
      item('Weekly strength: ', 'each week, the share of the other teams your score beat — the record you’d have if you played everyone every week. Your schedule can’t help or hurt it, so it decides best and worst manager.'),
      item('Luck: ', 'actual wins minus the wins your scores earned (your weekly strength added up), over regular-season games plus playoff elimination games and the final. Placement games like 3rd place don’t count.'),
      item('Finish: ', 'regular-season standings by wins, then total points.'),
      item('Close games: ', `decided by less than ${CLOSE_GAME_POINTS} points.`),
      state.history.lineupSeasons.length
        ? item('Lineup setting: ', `regular-season points a team scored divided by Sleeper’s potential points, the score of the best lineup it could have set from its roster each week, over ${state.history.lineupSeasons[0]}–${state.history.lineupSeasons.at(-1)} (the Yahoo records don’t include benches). It’s judged with hindsight, so nobody gets close to 100%.`)
        : null,
      seasons.some(s => s.source)
        ? item('Coverage: ', `${firstSeason} onward. The Yahoo years come from the commissioner’s records of each week’s scores and playoff games; in those playoff weeks, weekly strength compares only the teams whose games were recorded. Sleeper seasons show up here once they finish.`)
        : item('Coverage: ', `${firstSeason} onward, every season on Sleeper. The league’s first years were on Yahoo and aren’t included. New seasons show up here once they finish.`),
      differ.length
        ? item('Records: ', `rebuilt from each week’s scores. In ${differ.join(', ')}, a few differ slightly from the standings Sleeper saved at the time, likely because of later stat corrections.`)
        : null,
      ...dealsHowItems(item)),
  );
}

function dealsHowItems(item) {
  const { deals } = state;
  if (!deals) return [];
  const { replacementRank: r, draftSeasons, tradeSeasons } = deals.method;
  return [
    item('Points above replacement: ', `each week, a player’s points minus what a replacement-level player at his position scores — the ${ordinal(r.QB)}-best QB, ${ordinal(r.TE)}-best TE and ${ordinal(r.RB)}-best RB and WR that season, about the best a 10-team league leaves on waivers. A player who ends up below that counts as zero. Without it, quarterbacks would win every comparison, since 6-point passing TDs give them the most raw points while every team only starts one.`),
    item('Drafting: ', `each rookie pick is judged on the points above replacement the player scored in his first ${draftSeasons} NFL seasons, compared with what that draft spot usually produces, scaled to the rest of the same draft class so newer classes aren’t penalized for having played fewer seasons. Credit goes to whoever made the pick.`),
    item('Trading: ', `each side gets the points above replacement of what it received minus what it gave up, from the trade through the next season. A traded pick counts as the player drafted with it, over his first ${tradeSeasons} seasons. Trades with any of those seasons still unplayed aren’t graded yet.`),
    item('Waiver wire: ', 'a waiver claim or free-agent pickup earns the points above replacement the player scored in the weeks that team started him, from the pickup through the end of that season. When another team picks up a player you dropped that same season, what they get from him counts against you (only the last team to drop him is charged). Net is pickups minus drops.'),
    item('Updated: ', `draft, trade and waiver grades run through the ${deals.throughSeason} season and are rebuilt after each season (last built ${deals.generated}).`),
  ];
}

// ---------- Wiring ----------

darkQuery.addEventListener('change', () => state.history && renderFinishes());
wireNav();
load();
