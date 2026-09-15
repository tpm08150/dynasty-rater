import { loadLeagueData } from './data.js';
import { rateLeague, BENCH_TIERS, QUADRANTS, SKILL_POSITIONS, ordinal } from './rating.js';

const DEFAULT_LEAGUE_ID = '1312979994133139456';
const leagueId = new URLSearchParams(location.search).get('league') || DEFAULT_LEAGUE_ID;
const TEAM_KEY = `dynasty-rater:team:${leagueId}`;

// Blue sequential ramp, steps 100 → 700.
const RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5',
  '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
const SLOT_LABELS = { FLEX: 'FLEX', SUPER_FLEX: 'SF', WRRB_FLEX: 'W/R', REC_FLEX: 'W/T' };
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

const state = { data: null, rating: null, selected: null, sortBy: 'current', heatWhen: 'current' };

const $ = selector => document.querySelector(selector);

// Every string from Sleeper (team names, nicknames) goes in as a text node.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style') Object.assign(node.style, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  node.append(...children.flat().filter(c => c != null && c !== false));
  return node;
}

function svgEl(tag, attrs = {}, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text != null) node.textContent = text;
  return node;
}

const fmtScore = n => String(Math.round(n));
const fmtValue = n => (n ? Math.round(n).toLocaleString() : '—');
const fmtAge = n => (n == null ? '—' : n.toFixed(1));
const pprLabel = rec => ({ 0: 'Standard', 0.5: 'Half PPR', 1: 'PPR' })[rec] ?? `${rec} PPR`;
const teamById = id => state.rating.teams.find(t => t.rosterId === id);
const signedPct = ratio => {
  const pct = Math.round((ratio - 1) * 100);
  return `${pct < 0 ? '−' : '+'}${Math.abs(pct)}%`;
};

function readSavedTeam() {
  try { return Number(localStorage.getItem(TEAM_KEY)) || null; } catch { return null; }
}
function saveTeam(id) {
  try { localStorage.setItem(TEAM_KEY, String(id)); } catch { /* storage blocked; selection just won't persist */ }
}

async function load() {
  const main = $('#app');
  const button = $('#refresh');
  button.disabled = true;
  if (state.rating) main.classList.add('refreshing');
  else showStatus('Loading your league from Sleeper and player values from FantasyCalc…');
  try {
    const data = await loadLeagueData(leagueId);
    state.data = data;
    state.rating = rateLeague(data);
    state.loadedAt = new Date();
    const saved = readSavedTeam();
    const ids = state.rating.teams.map(t => t.rosterId);
    state.selected = [state.selected, saved].find(id => ids.includes(id)) ?? ids[0];
    showNotes();
    main.hidden = false;
    render();
  } catch (err) {
    showStatus(`Error: couldn't load the ratings. ${err.message}`, true);
  } finally {
    button.disabled = false;
    main.classList.remove('refreshing');
  }
}

function showStatus(text, isError = false) {
  const status = $('#status');
  status.textContent = text;
  status.classList.toggle('error', isError);
  status.hidden = !text;
}

function showNotes() {
  const notes = [];
  if (state.data.playersError) notes.push(state.data.playersError);
  if (state.data.projectionsError) {
    notes.push(`${state.data.projectionsError}, so quarterbacks aren’t adjusted for ${state.data.league.scoring_settings.pass_td}-point passing TDs and are underrated.`);
  }
  if (state.rating.unmatchedPicks.length) {
    notes.push(`FantasyCalc has no value for ${state.rating.unmatchedPicks.join(', ')}, so those picks count as 0.`);
  }
  showStatus(notes.length ? `Note: ${notes.join(' ')}` : '');
}

function render() {
  renderHeader();
  renderScatter();
  renderRankings();
  renderHeat();
  renderTeam();
  renderHow();
}

function select(rosterId, { scroll = false } = {}) {
  state.selected = rosterId;
  saveTeam(rosterId);
  renderScatter();
  renderRankings();
  renderHeat();
  renderTeam();
  if (scroll) $('#team-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function sortedTeams() {
  const key = state.sortBy === 'current' ? 'currentRank' : 'futureRank';
  return [...state.rating.teams].sort((a, b) => a[key] - b[key]);
}

function renderHeader() {
  const { league } = state.data;
  const qbSlots = league.roster_positions.filter(s => s === 'QB' || s === 'SUPER_FLEX').length;
  document.title = `${league.name} · Dynasty Rater`;
  $('#league-name').textContent = league.name;
  $('#league-meta').textContent = [
    `${league.settings.num_teams} teams`,
    league.roster_positions.includes('SUPER_FLEX') ? 'Superflex' : qbSlots >= 2 ? '2QB' : '1QB',
    pprLabel(league.scoring_settings.rec ?? 0),
    `${league.season} season`,
    `values loaded ${state.loadedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
  ].join(' · ');
}

// ---------- Tooltip ----------

function showTooltip(anchor, { title, rows }, event) {
  const tip = $('#tooltip');
  tip.replaceChildren(
    el('div', { class: 'tt-title' }, title),
    ...rows.map(([value, label]) => el('div', { class: 'tt-row' }, el('strong', {}, value), el('span', {}, label))),
  );
  tip.hidden = false;
  let x;
  let y;
  if (event?.clientX != null) {
    x = event.clientX + 14;
    y = event.clientY + 14;
  } else {
    const r = anchor.getBoundingClientRect();
    x = r.right + 8;
    y = r.top;
  }
  const { width, height } = tip.getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.min(x, innerWidth - width - 8))}px`;
  tip.style.top = `${Math.max(8, Math.min(y, innerHeight - height - 8))}px`;
}

function hideTooltip() {
  $('#tooltip').hidden = true;
}

function withTooltip(node, content) {
  node.addEventListener('pointerenter', e => showTooltip(node, content(), e));
  node.addEventListener('pointermove', e => showTooltip(node, content(), e));
  node.addEventListener('pointerleave', hideTooltip);
  node.addEventListener('focus', () => showTooltip(node, content()));
  node.addEventListener('blur', hideTooltip);
}

function teamTooltip(t) {
  return {
    title: t.teamName,
    rows: [
      [`${fmtScore(t.currentScore)} · ${ordinal(t.currentRank)}`, 'this season'],
      [`${fmtScore(t.futureScore)} · ${ordinal(t.futureRank)}`, 'long term'],
      [QUADRANTS[t.quadrant], 'outlook'],
    ],
  };
}

// ---------- Scatter: current vs future ----------

function renderScatter() {
  const box = $('#scatter');
  const { teams, midCurrent, midFuture } = state.rating;
  const width = Math.max(300, box.clientWidth || 600);
  const height = Math.round(width < 520 ? width * 0.95 : Math.min(460, Math.max(300, width * 0.72)));
  const m = { top: 12, right: 12, bottom: 44, left: 44 };
  // Each axis gets its own range: long-term scores bunch up higher than
  // this-season scores (picks lift everyone), and a shared range crowds them.
  const lowBound = values => Math.max(0, Math.floor((Math.min(...values) - 4) / 10) * 10);
  const loX = lowBound(teams.map(t => t.currentScore));
  const loY = lowBound(teams.map(t => t.futureScore));
  const hi = 104; // headroom so the 100 team's dot isn't cut by the frame
  const x = v => m.left + ((v - loX) / (hi - loX)) * (width - m.left - m.right);
  const y = v => height - m.bottom - ((v - loY) / (hi - loY)) * (height - m.top - m.bottom);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': 'Scatter plot of each team: this-season score across, long-term score up.',
  });

  for (let v = loX; v <= 100; v += 10) {
    svg.append(
      svgEl('line', { class: 'gridline', x1: x(v), x2: x(v), y1: m.top, y2: height - m.bottom }),
      svgEl('text', { class: 'tick', x: x(v), y: height - m.bottom + 16, 'text-anchor': 'middle' }, v),
    );
  }
  for (let v = loY; v <= 100; v += 10) {
    svg.append(
      svgEl('line', { class: 'gridline', x1: m.left, x2: width - m.right, y1: y(v), y2: y(v) }),
      svgEl('text', { class: 'tick', x: m.left - 8, y: y(v) + 4, 'text-anchor': 'end' }, v),
    );
  }
  svg.append(
    svgEl('line', { class: 'median', x1: x(midCurrent), x2: x(midCurrent), y1: m.top, y2: height - m.bottom }),
    svgEl('line', { class: 'median', x1: m.left, x2: width - m.right, y1: y(midFuture), y2: y(midFuture) }),
    svgEl('text', { class: 'axis-title', x: (m.left + width - m.right) / 2, y: height - 6, 'text-anchor': 'middle' }, 'This season →'),
    svgEl('text', {
      class: 'axis-title', x: 0, y: 0, 'text-anchor': 'middle',
      transform: `translate(12 ${(m.top + height - m.bottom) / 2}) rotate(-90)`,
    }, 'Long term →'),
  );

  const quadrantLabels = [
    svgEl('text', { class: 'q-label', x: width - m.right - 6, y: m.top + 14, 'text-anchor': 'end' }, QUADRANTS.powerhouse),
    svgEl('text', { class: 'q-label', x: m.left + 6, y: m.top + 14 }, QUADRANTS.rising),
    svgEl('text', { class: 'q-label', x: width - m.right - 6, y: height - m.bottom - 8, 'text-anchor': 'end' }, QUADRANTS['win-now']),
    svgEl('text', { class: 'q-label', x: m.left + 6, y: height - m.bottom - 8 }, QUADRANTS.rebuild),
  ];
  svg.append(...quadrantLabels);

  // Selected team drawn last so its dot sits on top.
  const ordered = [...teams].sort((a, b) => (a.rosterId === state.selected) - (b.rosterId === state.selected));
  const dots = svgEl('g');
  const labels = svgEl('g');
  const hits = svgEl('g');
  svg.append(dots, labels, hits);
  const points = ordered.map(t => {
    const cx = x(t.currentScore);
    const cy = y(t.futureScore);
    const selected = t.rosterId === state.selected;
    dots.append(svgEl('circle', { class: `dot${selected ? ' selected' : ''}`, cx, cy, r: selected ? 7 : 6 }));
    const name = t.teamName.length > 20 ? `${t.teamName.slice(0, 19)}…` : t.teamName;
    const text = svgEl('text', { class: `label${selected ? ' selected' : ''}`, x: cx, y: cy }, name);
    labels.append(text);
    const hit = svgEl('circle', {
      class: 'hit', cx, cy, r: 14, tabindex: 0, role: 'button',
      'aria-label': `${t.teamName}: this season ${fmtScore(t.currentScore)}, long term ${fmtScore(t.futureScore)}`,
    });
    withTooltip(hit, () => teamTooltip(t));
    hit.addEventListener('click', () => select(t.rosterId));
    hit.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(t.rosterId); }
    });
    hits.append(hit);
    return { t, cx, cy, text, selected };
  });

  box.replaceChildren(svg);

  const obstacles = [
    ...quadrantLabels.map(q => q.getBBox()).map(b => ({ x: b.x, y: b.y, w: b.width, h: b.height })),
    ...points.map(p => ({ x: p.cx - 8, y: p.cy - 8, w: 16, h: 16 })),
  ];
  const bounds = { x: m.left, y: 0, w: width - m.left, h: height - m.bottom };
  // Place the selected team's label first so it gets the clearest spot.
  placeLabels([...points].sort((a, b) => b.selected - a.selected), bounds, obstacles);
}

function placeLabels(points, bounds, obstacles) {
  const placed = [...obstacles];
  const overlap = (a, b) =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inside = b => b.x >= bounds.x && b.x + b.w <= bounds.x + bounds.w && b.y >= bounds.y && b.y + b.h <= bounds.y + bounds.h;

  for (const { text, cx, cy, selected } of points) {
    const w = text.getComputedTextLength();
    const h = 14;
    // Beside, then centered above/below, then above/below hugging one side so
    // dots in a corner of the plot still have somewhere to go.
    const options = [
      { x: cx + 11, y: cy + 4, anchor: 'start', box: { x: cx + 11, y: cy - 9, w, h } },
      { x: cx - 11, y: cy + 4, anchor: 'end', box: { x: cx - 11 - w, y: cy - 9, w, h } },
      { x: cx, y: cy - 12, anchor: 'middle', box: { x: cx - w / 2, y: cy - 24, w, h } },
      { x: cx, y: cy + 22, anchor: 'middle', box: { x: cx - w / 2, y: cy + 10, w, h } },
      { x: cx + 8, y: cy + 22, anchor: 'end', box: { x: cx + 8 - w, y: cy + 10, w, h } },
      { x: cx - 8, y: cy + 22, anchor: 'start', box: { x: cx - 8, y: cy + 10, w, h } },
      { x: cx + 8, y: cy - 12, anchor: 'end', box: { x: cx + 8 - w, y: cy - 24, w, h } },
      { x: cx - 8, y: cy - 12, anchor: 'start', box: { x: cx - 8, y: cy - 24, w, h } },
      { x: cx + 11, y: cy - 8, anchor: 'start', box: { x: cx + 11, y: cy - 21, w, h } },
      { x: cx + 11, y: cy + 16, anchor: 'start', box: { x: cx + 11, y: cy + 3, w, h } },
      { x: cx - 11, y: cy - 8, anchor: 'end', box: { x: cx - 11 - w, y: cy - 21, w, h } },
      { x: cx - 11, y: cy + 16, anchor: 'end', box: { x: cx - 11 - w, y: cy + 3, w, h } },
    ];
    const cost = o => (inside(o.box) ? 0 : 1e6) + placed.reduce((sum, p) => sum + overlap(o.box, p), 0);
    const best = options.reduce((a, b) => (cost(b) < cost(a) ? b : a));
    // Rather than stack unreadable text, drop a label that would mostly sit on
    // others. The dot's tooltip, the rankings and the team picker still name it.
    const clash = placed.reduce((sum, p) => sum + overlap(best.box, p), 0);
    if (!selected && (!inside(best.box) || clash > w * h * 0.35)) {
      text.remove();
      continue;
    }
    text.setAttribute('x', best.x);
    text.setAttribute('y', best.y);
    text.setAttribute('text-anchor', best.anchor);
    placed.push(best.box);
  }
}

// ---------- Rankings table ----------

function renderRankings() {
  const sortButton = (when, label) => el('button', {
    type: 'button',
    class: 'sort',
    'aria-pressed': String(state.sortBy === when),
    onclick: () => { state.sortBy = when; renderRankings(); renderHeat(); },
  }, label);

  const rows = sortedTeams().map(t => el('tr', {
    class: `clickable${t.rosterId === state.selected ? ' selected' : ''}`,
    onclick: e => { if (!e.target.closest('button')) select(t.rosterId, { scroll: true }); },
  },
  el('td', { class: 'num' }, String(state.sortBy === 'current' ? t.currentRank : t.futureRank)),
  el('td', {}, teamCell(t)),
  el('td', {}, scoreCell(t.currentScore, t.currentRank)),
  el('td', {}, scoreCell(t.futureScore, t.futureRank)),
  el('td', { class: 'num hide-narrow' }, ordinal(t.pickRank)),
  el('td', { class: 'num hide-narrow' }, fmtAge(t.starterAge)),
  el('td', { class: 'hide-narrow' }, QUADRANTS[t.quadrant])));

  $('#rankings').replaceChildren(
    el('thead', {}, el('tr', {},
      el('th', { class: 'num', scope: 'col' }, '#'),
      el('th', { scope: 'col' }, 'Team'),
      el('th', { scope: 'col', 'aria-sort': state.sortBy === 'current' ? 'ascending' : 'none' }, sortButton('current', 'This season')),
      el('th', { scope: 'col', 'aria-sort': state.sortBy === 'future' ? 'ascending' : 'none' }, sortButton('future', 'Long term')),
      el('th', { class: 'num hide-narrow', scope: 'col' }, 'Picks'),
      el('th', { class: 'num hide-narrow', scope: 'col' }, 'Starter age'),
      el('th', { class: 'hide-narrow', scope: 'col' }, 'Outlook'))),
    el('tbody', {}, rows),
  );
}

function teamCell(t) {
  return [
    el('button', { type: 'button', class: 'team-link', onclick: () => select(t.rosterId, { scroll: true }) }, t.teamName),
    t.userName && t.userName !== t.teamName ? el('span', { class: 'team-user' }, `@${t.userName}`) : null,
  ];
}

function scoreCell(score, rank) {
  return el('div', { class: 'score' },
    el('span', { class: 'meter', 'aria-hidden': 'true' }, el('span', { style: { width: `${Math.max(0, Math.min(100, score))}%` } })),
    el('span', { class: 'score-num' }, fmtScore(score)),
    el('span', { class: 'score-rank' }, ordinal(rank)));
}

// ---------- Position heat table ----------

function rampColor(rank, count) {
  const strength = count === 1 ? 1 : (count - rank) / (count - 1);
  // Weak cells recede toward the surface: light on the light theme, dark on the dark one.
  const index = Math.round((darkQuery.matches ? 1 - strength : strength) * (RAMP.length - 1));
  return RAMP[index];
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function inkFor(background) {
  const L = luminance(background);
  const onWhite = 1.05 / (L + 0.05);
  const onBlack = (L + 0.05) / (luminance('#0b0b0b') + 0.05);
  return onWhite > onBlack ? '#ffffff' : '#0b0b0b';
}

function groupPlayers(team, pos, key) {
  return team.players
    .filter(p => p.position === pos)
    .sort((a, b) => b[key] - a[key])
    .slice(0, state.rating.depth[pos]);
}

function renderHeat() {
  const when = state.heatWhen;
  const key = when === 'current' ? 'redraft' : 'dynasty';
  const columns = when === 'future' ? [...SKILL_POSITIONS, 'Picks'] : SKILL_POSITIONS;
  const count = state.rating.teams.length;

  for (const button of document.querySelectorAll('.segmented button')) {
    button.setAttribute('aria-pressed', String(button.dataset.when === when));
  }
  $('#pos-sub').textContent = `League rank at each position, 1st is best. ${darkQuery.matches ? 'Lighter' : 'Darker'} cells are stronger.`;

  const rows = sortedTeams().map(t => el('tr', { class: t.rosterId === state.selected ? 'selected' : '' },
    el('td', {}, el('button', { type: 'button', class: 'team-link', onclick: () => select(t.rosterId, { scroll: true }) }, t.teamName)),
    columns.map(col => {
      const isPicks = col === 'Picks';
      const rank = isPicks ? t.pickRank : t.groups[col][`${when}Rank`];
      const value = isPicks ? t.pickValue : t.groups[col][when];
      const background = rampColor(rank, count);
      const cell = el('td', {
        class: 'cell',
        tabindex: '0',
        style: { background, color: inkFor(background) },
        'aria-label': `${t.teamName}, ${col}: ${ordinal(rank)} of ${count}, value ${fmtValue(value)}`,
      }, ordinal(rank));
      withTooltip(cell, () => ({
        title: `${t.teamName} · ${col}`,
        rows: [
          [fmtValue(value), `${isPicks ? 'pick' : when === 'current' ? 'season' : 'dynasty'} value · ${ordinal(rank)} of ${count}`],
          ...(isPicks
            ? [[String(t.picks.length), 'picks owned']]
            : groupPlayers(t, col, key).map(p => [fmtValue(p[key]), p.name])),
        ],
      }));
      return cell;
    })));

  $('#positions').replaceChildren(
    el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Team'), columns.map(c => el('th', { scope: 'col' }, c)))),
    el('tbody', {}, rows),
  );
}

// ---------- Team detail ----------

function renderTeam() {
  const t = teamById(state.selected);
  const count = state.rating.teams.length;
  const { wins, losses, ties } = t.record;
  const played = wins + losses + ties > 0;
  const unvalued = t.players.filter(p => !p.valued);

  $('#team-detail').replaceChildren(
    el('div', { class: 'card-head team-head' },
      el('div', {},
        el('h2', {}, t.teamName),
        el('p', { class: 'sub' }, [
          t.userName ? `@${t.userName}` : null,
          played ? `${wins}-${losses}${ties ? `-${ties}` : ''}` : null,
          QUADRANTS[t.quadrant],
        ].filter(Boolean).join(' · '))),
      el('label', {}, 'Team',
        el('select', { onchange: e => select(Number(e.target.value)) },
          sortedTeams().map(o => {
            const option = el('option', { value: o.rosterId }, o.teamName);
            option.selected = o.rosterId === t.rosterId;
            return option;
          })))),
    el('div', { class: 'tiles' },
      tile('This season', fmtScore(t.currentScore), `${ordinal(t.currentRank)} of ${count}`),
      tile('Long term', fmtScore(t.futureScore), `${ordinal(t.futureRank)} of ${count}`),
      tile('Draft capital', fmtValue(t.pickValue), `${ordinal(t.pickRank)} of ${count} · ${t.picks.length} picks`),
      tile('Starter age', fmtAge(t.starterAge), 'average of this season’s lineup')),
    el('div', { class: 'split' },
      lineupTable('Best lineup this season', t.currentLineup.lineup, 'redraft', 'Season value'),
      lineupTable('Best long-term lineup', t.futureLineup.lineup, 'dynasty', 'Dynasty value')),
    rosterDetails(t),
    picksTable(t),
    unvalued.length
      ? el('p', { class: 'note' }, `${unvalued.length} rostered players (${summarizePositions(unvalued)}) have no FantasyCalc value and don’t count toward either rating.`)
      : null,
  );
}

function tile(label, value, sub) {
  return el('div', { class: 'tile' },
    el('div', { class: 'tile-label' }, label),
    el('div', { class: 'tile-value' }, value),
    el('div', { class: 'tile-sub' }, sub));
}

function playerCell(p) {
  return [
    el('span', { class: 'pname' }, p.name),
    p.taxi ? el('span', { class: 'chip' }, 'Taxi') : null,
    p.ir ? el('span', { class: 'chip' }, 'IR') : null,
    el('span', { class: 'pmeta' }, [
      p.position,
      p.team,
      p.age != null ? `age ${Math.floor(p.age)}` : null,
      // Guard on qbBoost too: for up to 10 minutes after a deploy a browser can
      // pair this file with a cached rating.js that predates the boost.
      p.valued && state.rating.qbBoost && p.boost !== 1 ? `${signedPct(p.boost)} for ${state.rating.qbBoost.passTd}-pt TDs` : null,
    ].filter(Boolean).join(' · ')),
  ];
}

function lineupTable(title, lineup, key, valueLabel) {
  return el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
    el('caption', {}, title),
    el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, 'Slot'),
      el('th', { scope: 'col' }, 'Player'),
      el('th', { scope: 'col', class: 'num' }, valueLabel))),
    el('tbody', {}, lineup.map(({ slot, player }) => el('tr', {},
      el('td', { class: 'slot' }, SLOT_LABELS[slot] ?? slot),
      el('td', {}, player ? playerCell(player) : el('span', { class: 'empty' }, 'Empty')),
      el('td', { class: 'num' }, player ? fmtValue(player[key]) : '—'))))));
}

function rosterDetails(t) {
  const starting = new Set(t.currentLineup.lineup.map(s => s.player?.id).filter(Boolean));
  const players = [...t.players].sort((a, b) => b.dynasty - a.dynasty || b.redraft - a.redraft || a.name.localeCompare(b.name));
  return el('details', { class: 'roster' },
    el('summary', {}, `Full roster · ${players.length} players`),
    el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Player'),
        el('th', { scope: 'col', class: 'hide-narrow' }, 'Role'),
        el('th', { scope: 'col', class: 'num' }, 'Season value'),
        el('th', { scope: 'col', class: 'num' }, 'Dynasty value'))),
      el('tbody', {}, players.map(p => el('tr', {},
        el('td', {}, playerCell(p)),
        el('td', { class: 'hide-narrow' }, starting.has(p.id) ? 'Starting' : 'Bench'),
        el('td', { class: 'num' }, p.valued ? fmtValue(p.redraft) : '—'),
        el('td', { class: 'num' }, p.valued ? fmtValue(p.dynasty) : '—')))))));
}

function picksTable(t) {
  const seasons = state.rating.seasons;
  return el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
    el('caption', {}, `Draft picks · ${seasons[0]}–${seasons[seasons.length - 1]}`),
    el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, 'Pick'),
      el('th', { scope: 'col' }, 'Original team'),
      el('th', { scope: 'col', class: 'num' }, 'Value'))),
    el('tbody', {}, t.picks.map(p => el('tr', {},
      el('td', {}, `${p.season} ${ordinal(p.round)}`,
        p.tier ? el('span', { class: 'pmeta' }, `projects ${p.tier.toLowerCase()} (${ordinal(p.projectedSlot)} pick)`) : null),
      el('td', {}, p.originalRosterId === t.rosterId ? 'Own' : teamById(p.originalRosterId)?.teamName ?? `Team ${p.originalRosterId}`),
      el('td', { class: 'num' }, p.matched ? fmtValue(p.value) : 'No value'))))));
}

function summarizePositions(players) {
  const counts = {};
  for (const p of players) counts[p.position] = (counts[p.position] ?? 0) + 1;
  return Object.entries(counts).map(([pos, n]) => `${n} ${pos}`).join(', ');
}

// ---------- How it works ----------

function renderHow() {
  const { league } = state.data;
  const { seasons, slots } = state.rating;
  const lineup = slots.map(s => SLOT_LABELS[s] ?? s).join(', ');
  const future = BENCH_TIERS.future;
  const current = BENCH_TIERS.current[0];
  const percent = w => `${Math.round(w * 100)}%`;
  const { qbBoost } = state.rating;
  const caveats = [];
  if (qbBoost) {
    caveats.push(['Quarterbacks: ',
      `FantasyCalc values assume 4-point passing TDs. Your league gives ${qbBoost.passTd}, so each QB’s values change by the share of points that adds to their projected season (from ${state.data.projectionSource}): typically ${signedPct(qbBoost.typical)}, ranging from ${signedPct(qbBoost.min)} for running QBs to ${signedPct(qbBoost.max)} for high-volume passers. Backups with small projections get the typical change.`]);
  } else if ((league.scoring_settings.pass_td ?? 4) !== 4) {
    caveats.push(['Quarterbacks: ',
      `Your league gives ${league.scoring_settings.pass_td} points per passing TD, but the projections needed to adjust for it didn’t load, so QBs use FantasyCalc’s 4-point values.`]);
  }
  if (league.scoring_settings.bonus_rec_te) {
    caveats.push(['Tight ends: ', 'Your league gives tight ends a reception bonus that FantasyCalc values don’t include, so tight ends are probably underrated.']);
  }

  $('#how').replaceChildren(
    el('summary', {}, 'How the ratings work'),
    el('ul', {},
      el('li', {}, el('strong', {}, 'This season: '),
        `the best legal lineup (${lineup}) using FantasyCalc’s redraft values — what each player is worth for this season alone — plus ${percent(current.weight)} of the next ${current.count} bench players to cover byes and injuries.`),
      el('li', {}, el('strong', {}, 'Long term: '),
        `the same lineup built from dynasty values, which price in age and multi-year outlook, plus deeper bench credit (${percent(future[0].weight)} for the next ${future[0].count}, ${percent(future[1].weight)} for the ${future[1].count} after, ${percent(future[2].weight)} for everyone else) and every draft pick owned for ${seasons.join(', ')}.`),
      el('li', {}, el('strong', {}, `${seasons[0]} picks `),
        'are priced early, mid or late by where the original team ranks this season, weakest roster picking first. Later picks use FantasyCalc’s generic value for that round.'),
      el('li', {}, el('strong', {}, 'Scores: '),
        `100 is the best roster in the league. This season, 85 means 85% of the best roster’s value. Long-term scores still count starters, bench depth and every draft pick. Because picks and depth add a similar amount to every roster, those totals would bunch together near the top, so they’re spread onto a wider scale: the best long-term total gets 100 and the lowest gets ${Math.round(state.rating.futureFloor)}, which is how the weakest long-term starting lineup compares with the best one. Every other team lands in between in proportion to its full total. Outlook splits the league at the median of each score.`),
      el('li', {}, el('strong', {}, 'Not counted: '), 'kickers and defenses, which have no trade market to value them.'),
      el('li', {}, el('strong', {}, 'Updates: '),
        'everything reloads each time the page opens or you press Refresh. Rosters, trades and picks come from Sleeper and are at most about 5 minutes old. Player values are FantasyCalc’s latest, which shift as they recalculate from new trades, and QB projections change when Sleeper updates them.'),
      caveats.map(([label, text]) => el('li', {}, el('strong', {}, label), text))),
    el('p', {}, 'Rosters and picks come live from ',
      el('a', { href: 'https://sleeper.com', target: '_blank', rel: 'noopener' }, 'Sleeper'),
      '; values from ',
      el('a', { href: 'https://www.fantasycalc.com', target: '_blank', rel: 'noopener' }, 'FantasyCalc'),
      ', which builds them from real dynasty trades. Press Refresh after trades or waiver moves.'),
  );
}

// ---------- Wiring ----------

$('#refresh').addEventListener('click', load);
for (const button of document.querySelectorAll('.segmented button')) {
  button.addEventListener('click', () => { state.heatWhen = button.dataset.when; renderHeat(); });
}
darkQuery.addEventListener('change', () => state.rating && renderHeat());

let lastWidth = 0;
new ResizeObserver(([entry]) => {
  const width = Math.round(entry.contentRect.width);
  if (state.rating && width !== lastWidth) {
    lastWidth = width;
    renderScatter();
  }
}).observe($('#scatter'));

load();
