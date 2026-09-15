import { loadLeagueHistory } from './data.js';
import { buildHistory, CLOSE_GAME_POINTS } from './history.js';
import { ordinal } from './rating.js';
import { $, el, leagueId, darkQuery, showStatus, withTooltip, rampColor, inkFor, wireNav } from './ui.js';

const state = { history: null };

const pct = n => `${Math.round(n * 100)}%`;
const signed = n => `${n < 0 ? '−' : '+'}${Math.abs(n).toFixed(1)}`;
const record = s => `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const managerById = id => state.history.managers.find(m => m.ownerId === id);
const handle = m => (m.userName && m.userName !== m.teamName ? `@${m.userName}` : null);

async function load() {
  showStatus('Loading every season from Sleeper…');
  try {
    const { seasons, currentUsers } = await loadLeagueHistory(leagueId);
    state.history = buildHistory(seasons, currentUsers);
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
  $('#coverage').textContent = `Covers ${firstSeason} onward, every season the league has played on Sleeper. The league’s first years were on Yahoo and aren’t included.`;
}

function thead(columns) {
  return el('thead', {}, el('tr', {}, columns.map(column => {
    const [label, cls] = Array.isArray(column) ? column : [column, null];
    return el('th', { scope: 'col', class: cls }, label);
  })));
}

// ---------- Superlatives ----------

function renderAwards() {
  const { best, worst, luckiest, unluckiest } = state.history;
  const strength = m => `Outscored ${pct(m.strength)} of the league in a typical week`;
  const luck = m => `${Math.abs(m.luck).toFixed(1)} ${m.luck >= 0 ? 'more' : 'fewer'} wins than their scores earned`;
  const resume = m => `${record(m)} · ${plural(m.titles, 'title')} · ${plural(m.playoffTrips, 'playoff trip')}`;
  $('#awards').replaceChildren(
    award('Best manager', best, strength, resume, m => pct(m.strength)),
    award('Worst manager', worst, strength, resume, m => pct(m.strength)),
    award('Luckiest', luckiest, luck, resume, m => signed(m.luck)),
    award('Unluckiest', unluckiest, luck, resume, m => signed(m.luck)),
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
    el('td', { class: 'num' }, signed(m.luck)),
    el('td', { class: 'num' }, String(m.titles)),
    el('td', { class: 'num hide-narrow' }, String(m.finals)),
    el('td', { class: 'num hide-narrow' }, `${m.playoffTrips} of ${m.seasons.length}`),
    el('td', { class: 'num hide-narrow' }, `${m.closeWins}-${m.closeLosses}`)));
  $('#careers').replaceChildren(
    thead([
      ['#', 'num hide-narrow'], 'Manager', ['Record', 'num'], ['Win %', 'num hide-narrow'],
      ['Strength', 'num'], ['Pts / week', 'num hide-narrow'], ['Luck', 'num'], ['Titles', 'num'],
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
      item('Coverage: ', `${firstSeason} onward, every season on Sleeper. The league’s first years were on Yahoo and aren’t included. New seasons show up here once they finish.`),
      differ.length
        ? item('Records: ', `rebuilt from each week’s scores. In ${differ.join(', ')}, a few differ slightly from the standings Sleeper saved at the time, likely because of later stat corrections.`)
        : null),
  );
}

// ---------- Wiring ----------

darkQuery.addEventListener('change', () => state.history && renderFinishes());
wireNav();
load();
