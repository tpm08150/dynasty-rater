// Helpers shared by the ratings page (app.js) and the history page (history-app.js).

export const DEFAULT_LEAGUE_ID = '1312979994133139456';
export const leagueId = new URLSearchParams(location.search).get('league') || DEFAULT_LEAGUE_ID;

// Blue sequential ramp, steps 100 → 700.
export const RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5',
  '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
export const darkQuery = matchMedia('(prefers-color-scheme: dark)');

export const $ = selector => document.querySelector(selector);

// Every string from Sleeper (team names, nicknames) goes in as a text node.
export function el(tag, props = {}, ...children) {
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

export function svgEl(tag, attrs = {}, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text != null) node.textContent = text;
  return node;
}

export function showStatus(text, isError = false) {
  const status = $('#status');
  status.textContent = text;
  status.classList.toggle('error', isError);
  status.hidden = !text;
}

export function showTooltip(anchor, { title, rows }, event) {
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

export function hideTooltip() {
  $('#tooltip').hidden = true;
}

export function withTooltip(node, content) {
  node.addEventListener('pointerenter', e => showTooltip(node, content(), e));
  node.addEventListener('pointermove', e => showTooltip(node, content(), e));
  node.addEventListener('pointerleave', hideTooltip);
  node.addEventListener('focus', () => showTooltip(node, content()));
  node.addEventListener('blur', hideTooltip);
}

export function rampColor(rank, count) {
  const strength = count === 1 ? 1 : (count - rank) / (count - 1);
  // Weak cells recede toward the surface: light on the light theme, dark on the dark one.
  const index = Math.round((darkQuery.matches ? 1 - strength : strength) * (RAMP.length - 1));
  return RAMP[index];
}

export function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function inkFor(background) {
  const L = luminance(background);
  const onWhite = 1.05 / (L + 0.05);
  const onBlack = (L + 0.05) / (luminance('#0b0b0b') + 0.05);
  return onWhite > onBlack ? '#ffffff' : '#0b0b0b';
}

// Carry ?league= across the page links so another league stays selected.
export function wireNav() {
  for (const link of document.querySelectorAll('.site-nav a')) {
    const url = new URL(link.getAttribute('href'), location.href);
    url.search = location.search;
    link.href = url;
  }
}
