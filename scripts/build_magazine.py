#!/usr/bin/env python3
"""Build Midwest Dynasty Monthly, the league magazine, as a web page and a print PDF.

Pulls every season from Sleeper, runs the site's own rating engine for current
roster ratings, reads the draft/trade/waiver grades out of data/deals.json, and
lays the whole thing out as a print-ready magazine. Run from the repo root:

    python3 scripts/build_magazine.py                # -> magazine.html + out/Midwest-Dynasty-Monthly-....pdf
    python3 scripts/build_magazine.py --out ~/x.pdf  # somewhere else
    python3 scripts/build_magazine.py --html-only    # skip the PDF, just write the page

The same file is both: it reads as a scrolling page on screen (and on a phone) and
prints as a paginated magazine. magazine.html is published with the site.

Every number regenerates on each run. The prose does not — it lives in
scripts/magazine_copy.py and needs rewriting when the storylines move. The build
stops if any manager is missing an entry there.

Needs Google Chrome for the HTML-to-PDF step; pass --chrome to point at another
copy. Finished seasons are cached in scripts/.cache alongside build_deals.py.
"""
import argparse
import datetime
import html
import json
import subprocess
import sys
import time
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import magazine_copy as copy  # noqa: E402

LEAGUE_ID = '1312979994133139456'
ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(__file__).resolve().parent / '.cache'
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
ACCENT, INK, CREAM, GOLD = '#C8372D', '#141414', '#F7F4EC', '#F2B33D'


# ---------------------------------------------------------------- Sleeper ----

def get(path, cache_name=None):
    file = CACHE / cache_name if cache_name else None
    if file and file.exists():
        return json.loads(file.read_text())
    for attempt in range(5):
        try:
            with urllib.request.urlopen('https://api.sleeper.app' + path, timeout=90) as res:
                data = json.load(res)
            break
        except OSError:
            if attempt == 4:
                raise
            time.sleep(3 * (attempt + 1))
    if file:
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(json.dumps(data))
    return data


def all_play(points, roster_id):
    """Share of the other teams this score beat that week; ties count half."""
    mine = points[roster_id]
    others = [p for r, p in points.items() if r != roster_id]
    return (sum(p < mine for p in others) + 0.5 * sum(p == mine for p in others)) / len(others)


def pairs(games):
    by_matchup = defaultdict(list)
    for m in games:
        if m.get('matchup_id') is not None:
            by_matchup[m['matchup_id']].append(m)
    return [p for p in by_matchup.values() if len(p) == 2]


def league_chain(league_id):
    chain, lid = [], league_id
    while lid and lid != '0':
        league = get(f'/v1/league/{lid}')
        if not league:
            sys.exit(f'Sleeper has no league with ID {lid}')
        chain.append(league)
        lid = league.get('previous_league_id')
    return chain


def collect(chain, this_season, this_week):
    """Career totals and per-season lines for every manager, from weekly scores."""
    career = defaultdict(Counter)
    seasons = defaultdict(dict)
    efficiency = defaultdict(lambda: [0.0, 0.0, 0])  # scored, potential, weeks
    for league in chain:
        season = int(league['season'])
        finished = league['status'] == 'complete'
        cache = (lambda n: f'{season}-{n}.json') if finished else (lambda n: None)
        last = league['settings'].get('last_scored_leg') or (this_week - 1 if season == this_season else 0)
        if not last:
            continue
        start = league['settings']['playoff_week_start']
        rosters = get(f"/v1/league/{league['league_id']}/rosters", cache('rosters'))
        owner = {r['roster_id']: r['owner_id'] for r in rosters}
        with ThreadPoolExecutor(8) as pool:
            weeks = dict(pool.map(
                lambda w: (w, get(f"/v1/league/{league['league_id']}/matchups/{w}", cache(f'matchups-{w}'))),
                range(1, last + 1)))
        for r in rosters:
            s = r['settings']
            # Sleeper's potential points cover the regular season of finished years only.
            if finished and s.get('ppts') is not None:
                e = efficiency[r['owner_id']]
                e[0] += s.get('fpts', 0) + s.get('fpts_decimal', 0) / 100
                e[1] += s['ppts'] + s.get('ppts_decimal', 0) / 100
                e[2] += start - 1
        for week, games in weeks.items():
            if week >= start:
                continue
            points = {m['roster_id']: m['points'] for m in games}
            for roster_id, scored in points.items():
                user = owner[roster_id]
                row = seasons[user].setdefault(season, Counter())
                for bucket in (career[user], row):
                    bucket['weeks'] += 1
                    bucket['pf'] += scored
                    bucket['expected'] += all_play(points, roster_id)
                    bucket['high'] += scored == max(points.values())
                    bucket['low'] += scored == min(points.values())
            for a, b in pairs(games):
                for me, opp in ((a, b), (b, a)):
                    user = owner[me['roster_id']]
                    result = 'w' if me['points'] > opp['points'] else 'l' if me['points'] < opp['points'] else 't'
                    for bucket in (career[user], seasons[user][season]):
                        bucket[result] += 1
                        bucket['pa'] += opp['points']
        # Sleeper seeds the bracket from week one, so an unfinished season shows
        # provisional playoff teams who have not played a postseason game. Only
        # completed seasons count toward playoff trips and records.
        if not finished:
            continue
        for game in get(f"/v1/league/{league['league_id']}/winners_bracket", cache('bracket')) or []:
            for team in (game.get('t1'), game.get('t2')):
                if isinstance(team, int):
                    career[owner[team]][f'trip_{season}'] = 1
            if not game.get('w') or game.get('p') not in (None, 1):
                continue
            career[owner[game['w']]]['playoff_w'] += 1
            career[owner[game['l']]]['playoff_l'] += 1
            if game.get('p') == 1:
                career[owner[game['w']]]['titles'] += 1
                career[owner[game['l']]]['lost_final'] += 1
    return career, seasons, efficiency


def add_earlier_seasons(career, path):
    """Fold in the pre-Sleeper seasons the History page already ships."""
    if not path.exists():
        return
    for season_data in json.loads(path.read_text())['seasons']:
        season = int(season_data['league']['season'])
        start = season_data['league']['settings']['playoff_week_start']
        owner = {r['roster_id']: r['owner_id'] for r in season_data['rosters']}
        for week, games in season_data['matchups'].items():
            if int(week) >= start:
                continue
            for a, b in pairs(games):
                for me, opp in ((a, b), (b, a)):
                    user = owner[me['roster_id']]
                    career[user]['early_w' if me['points'] > opp['points'] else 'early_l'] += 1
        for game in season_data['winnersBracket']:
            for team in (game['t1'], game['t2']):
                career[owner[team]][f'trip_{season}'] = 1
            if game.get('p') not in (None, 1):
                continue
            career[owner[game['w']]]['playoff_w'] += 1
            career[owner[game['l']]]['playoff_l'] += 1
            if game.get('p') == 1:
                career[owner[game['w']]]['titles'] += 1
                career[owner[game['l']]]['lost_final'] += 1


def power_order(teams, season_rows):
    """Rank by the average of the roster's rating now and what it has actually done.

    One measures talent on hand, the other results, and neither depends on the
    schedule. Returns user ids, strongest first."""
    def score(team):
        row = season_rows[team['ownerId']]
        return (team['current'] + row['strength'] * 100) / 2
    return [t['ownerId'] for t in sorted(teams, key=score, reverse=True)]


# ------------------------------------------------------------------ layout ----

E = html.escape


def stat(label, value, sub=''):
    return (f'<div class="stat"><div class="sl">{E(label)}</div>'
            f'<div class="sv">{E(str(value))}</div>'
            + (f'<div class="ss">{E(sub)}</div>' if sub else '') + '</div>')


def signed(n):
    return f'{"+" if n >= 0 else "−"}{abs(round(n)):,}'


def team_page(rank, team, prof, text):
    row, grades = prof['season'], prof['grades']
    swing = rank - team['futureRank']
    label, css = ('Rising', 'up') if swing > 1 else (('Falling', 'down') if swing < -1 else ('Holding', 'flat'))
    core = ''.join(
        f'<li><span class="pn">{E(p["name"])}</span>'
        f'<span class="pp">{E(p["position"])} · {p["age"]:.0f}</span></li>'
        for p in team['core'] if p.get('age') is not None)
    positions = ''.join(
        f'<div class="pos"><span>{pos}</span><b>{team["positionRanks"][pos]["current"]}</b></div>'
        for pos in ('QB', 'RB', 'WR', 'TE') if pos in team['positionRanks'])
    body = ''.join(f'<p>{E(p)}</p>' for p in text['body'])
    waiver = grades['waivers']['value'] - grades['waivers']['dropCost'] if grades else 0
    ledger = ''.join([
        stat('All-time', f"{prof['all_w']}-{prof['all_l']}"),
        stat('Titles', str(prof['titles']) + (f" · {prof['lost_final']} finals lost" if prof['lost_final'] else '')),
        stat('Playoffs', f"{prof['playoffs']} in {prof['trips']} trips"),
        stat('Drafting', signed(grades['draft']['surplus']), f"{grades['draft']['picks']} picks") if grades else '',
        stat('Trading', signed(grades['trades']['net']),
             f"{grades['trades']['graded']} graded · {grades['trades']['won']}-{grades['trades']['lost']}") if grades else '',
        stat('Waiver wire', signed(waiver), f"{grades['waivers']['adds']} adds") if grades else '',
        stat('Lineup setting', f"{prof['efficiency']}%", f"{prof['bench']} pts/wk benched") if prof['efficiency'] else '',
    ])
    return f'''
<section class="page team">
  <div class="thead">
    <div class="rankbox"><span class="rk">{rank}</span></div>
    <div class="tid">
      <div class="kicker">{E(text['kicker'])}</div>
      <h2>{E(team['team'])}</h2>
      <div class="handle">@{E(team['user'])} &nbsp;·&nbsp; {row['w']}-{row['l']} &nbsp;·&nbsp; {row['ppw']} pts/game</div>
    </div>
    <div class="trend {css}"><span>Dynasty stock</span><b>{label}</b><i>long-term #{team['futureRank']}</i></div>
  </div>
  <div class="tbody">
    <div class="story"><h3>{E(text['head'])}</h3>{body}
      <div class="verdict"><span>The verdict</span><p>{E(text['verdict'])}</p></div>
    </div>
    <aside class="rail">
      <div class="railblock"><h4>{row['season']} so far</h4>
        {stat('Record', f"{row['w']}-{row['l']}")}
        {stat('Points per game', row['ppw'])}
        {stat('Weekly strength', f"{round(row['strength'] * 100)}%", 'share of league outscored')}
      </div>
      <div class="railblock"><h4>Roster rating</h4>
        {stat('This season', f"{team['current']} · #{team['currentRank']}")}
        {stat('Long term', f"{team['future']} · #{team['futureRank']}")}
        {stat('Starter age', team['starterAge'])}
        <div class="posrow">{positions}</div>
        <div class="poslab">position rank, this season</div>
      </div>
      <div class="railblock"><h4>Core pieces</h4><ul class="players">{core}</ul></div>
      <div class="railblock"><h4>The ledger</h4>{ledger}</div>
    </aside>
  </div>
  <div class="foot"><span>Midwest Dynasty Monthly · {row['season']} Power Rankings</span><span>{rank} of {prof['teams']}</span></div>
</section>'''


def build_html(snapshot, profiles, order, today):
    season, week = snapshot['season'], snapshot['week']
    teams = {t['ownerId']: t for t in snapshot['teams']}
    standings = sorted(profiles.items(), key=lambda kv: (-kv[1]['season']['w'], -kv[1]['season']['ppw']))
    rows = ''
    for i, (uid, prof) in enumerate(standings, 1):
        t, row = teams[uid], prof['season']
        rows += (f'<tr><td class="n">{i}</td><td class="tm">{E(t["team"])}<i>@{E(t["user"])}</i></td>'
                 f'<td class="n">{row["w"]}-{row["l"]}</td><td class="n">{row["ppw"]}</td>'
                 f'<td class="n">{round(row["strength"] * 100)}%</td><td class="n">{t["current"]}</td>'
                 f'<td class="n">{t["future"]}</td><td class="n">{order.index(uid) + 1}</td></tr>')
    teaser = ''.join(f'<div class="t3"><span>{i}</span><b>{E(teams[u]["team"])}</b></div>'
                     for i, u in enumerate(order[:3], 1))
    notes = ''.join(f'<div class="note"><h4>{E(h)}</h4><p>{E(p)}</p></div>' for h, p in copy.WEEK_NOTES)
    flash = ''.join(f'<div class="fl"><b>{n}</b><span>{t}</span></div>' for n, t in copy.FLASH)
    honors = ''.join(f'<div class="aw"><div class="l">{E(l)}</div><div class="w">{E(w)}</div>'
                     f'<div class="d">{E(d)}</div></div>' for l, w, d in copy.HONORS)
    pages = ''.join(team_page(i, teams[u], profiles[u], copy.TEAMS[u]) for i, u in enumerate(order, 1))
    first = min(p['first_season'] for p in profiles.values())
    return f'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Midwest Dynasty Monthly — {season} Power Rankings</title><style>
@page {{ size: Letter; margin: 0; }}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{ font-family: Georgia, 'Times New Roman', serif; color: {INK}; background: {CREAM}; }}
.page {{ width: 8.5in; height: 11in; padding: 0.55in 0.6in 0.45in; position: relative;
         page-break-after: always; overflow: hidden; background: {CREAM}; }}
.page:last-child {{ page-break-after: auto; }}
h1,h2,h3,h4,.kicker,.rk,.sl,.ss,.handle,.foot,.trend,th,.poslab,.pp,.verdict span,.t3,.fl b,.aw .l,.aw .w
  {{ font-family: 'SF Compact Display','Futura','Helvetica Neue',Arial,sans-serif; }}
.cover {{ background: {INK}; color: {CREAM}; padding: 0.7in 0.7in 0.5in; display: flex; flex-direction: column; }}
.masthead {{ border-bottom: 5px solid {ACCENT}; padding-bottom: 10px; }}
.masthead h1 {{ font-size: 46pt; font-weight: 900; letter-spacing: -1.5px; line-height: .9; text-transform: uppercase; }}
.masthead h1 em {{ font-style: normal; color: {ACCENT}; }}
.masthead .sub {{ font-family: Georgia, serif; font-style: italic; color: #B9B2A4; font-size: 11.5pt; margin-top: 9px; }}
.issue {{ display: flex; justify-content: space-between; font-size: 8.5pt; letter-spacing: 2.4px;
          text-transform: uppercase; color: #8C867A; margin-top: 12px; font-family: 'SF Compact Display',Arial,sans-serif; }}
.covermain {{ margin-top: 1.1in; flex: 1; }}
.covermain .eyebrow {{ color: {ACCENT}; font-size: 12pt; letter-spacing: 4px; font-weight: 800;
                       text-transform: uppercase; font-family:'SF Compact Display',Arial,sans-serif; }}
.covermain h2 {{ font-size: 96pt; font-weight: 900; line-height: .85; letter-spacing: -4px;
                 text-transform: uppercase; margin: 14px 0 0; }}
.covermain h2 em {{ font-style: normal; color: {ACCENT}; }}
.deck {{ font-size: 14pt; line-height: 1.5; color: #D8D2C6; margin-top: 26px; max-width: 5.6in; }}
.t3row {{ display: flex; gap: 14px; border-top: 1px solid #39342C; padding-top: 16px; }}
.t3 {{ flex: 1; }}
.t3 span {{ display: block; font-size: 30pt; font-weight: 900; color: {ACCENT}; line-height: 1; }}
.t3 b {{ display: block; font-size: 12pt; font-weight: 700; margin-top: 4px; }}
.coverfoot {{ display: flex; margin-top: 14px; padding-top: 12px; border-top: 1px solid #39342C;
              justify-content: space-between; font-size: 8pt; letter-spacing: 2px; text-transform: uppercase;
              color: #6E685D; font-family:'SF Compact Display',Arial,sans-serif; }}
.shead {{ border-bottom: 3px solid {INK}; padding-bottom: 8px; margin-bottom: 20px; }}
.shead .kicker {{ color: {ACCENT}; font-size: 9pt; letter-spacing: 3px; font-weight: 800; text-transform: uppercase; }}
.shead h2 {{ font-size: 34pt; font-weight: 900; letter-spacing: -1.2px; text-transform: uppercase; line-height: 1; margin-top: 5px; }}
.shead p {{ font-size: 10.5pt; color: #4A463E; margin-top: 8px; max-width: 6.4in; line-height: 1.45; }}
table.std {{ width: 100%; border-collapse: collapse; font-size: 10pt; }}
table.std th {{ font-size: 7.5pt; letter-spacing: 1.4px; text-transform: uppercase; color: #6E685D;
                text-align: right; padding: 0 6px 7px; border-bottom: 2px solid {INK}; }}
table.std th:nth-child(2) {{ text-align: left; }}
table.std td {{ padding: 8px 6px; border-bottom: 1px solid #DCD6C8; }}
table.std td.n {{ text-align: right; font-variant-numeric: tabular-nums; }}
table.std td.tm {{ font-weight: 700; }}
table.std td.tm i {{ display: block; font-style: normal; font-size: 8pt; color: #807A6D;
                     font-family:'SF Compact Display',Arial,sans-serif; font-weight: 400; }}
table.std tr:nth-child(even) td {{ background: #F0ECE1; }}
.notes {{ display: flex; gap: 18px; margin-top: 26px; }}
.note {{ flex: 1; border-top: 3px solid {ACCENT}; padding-top: 10px; }}
.note h4 {{ font-size: 10pt; text-transform: uppercase; letter-spacing: 1.4px; margin-bottom: 6px; }}
.note p {{ font-size: 9.5pt; line-height: 1.5; color: #45413A; }}
.flash {{ display: flex; gap: 14px; margin-top: 30px; background: {INK}; color: {CREAM}; padding: 18px 16px; }}
.fl {{ flex: 1; }}
.fl b {{ display: block; font-size: 23pt; font-weight: 900; color: {GOLD}; line-height: 1; letter-spacing: -1px; }}
.fl span {{ display: block; font-size: 7.8pt; line-height: 1.5; color: #B9B2A4; margin-top: 7px; }}
.thead {{ display: flex; align-items: flex-start; gap: 16px; border-bottom: 3px solid {INK}; padding-bottom: 14px; }}
.rankbox {{ width: 1.15in; flex: none; }}
.rk {{ font-size: 76pt; font-weight: 900; line-height: .78; color: {ACCENT}; letter-spacing: -5px; }}
.tid {{ flex: 1; padding-top: 4px; }}
.tid .kicker {{ color: #807A6D; font-size: 8.5pt; letter-spacing: 2.6px; text-transform: uppercase; font-weight: 700; }}
.tid h2 {{ font-size: 31pt; font-weight: 900; letter-spacing: -1.1px; line-height: 1.02; margin: 4px 0 5px; }}
.handle {{ font-size: 9.5pt; color: #45413A; letter-spacing: .4px; }}
.trend {{ flex: none; text-align: right; padding-top: 6px; }}
.trend span {{ display: block; font-size: 7.5pt; letter-spacing: 1.8px; text-transform: uppercase; color: #807A6D; }}
.trend b {{ display: block; font-size: 15pt; font-weight: 900; text-transform: uppercase; letter-spacing: -.3px; margin-top: 2px; }}
.trend i {{ display: block; font-style: normal; font-size: 8pt; color: #807A6D; margin-top: 1px; }}
.trend.up b {{ color: #1E7A3C; }} .trend.down b {{ color: {ACCENT}; }} .trend.flat b {{ color: #6E685D; }}
.tbody {{ display: flex; gap: 0.32in; margin-top: 18px; }}
.story {{ flex: 1; display: flex; flex-direction: column; }}
.story h3 {{ font-size: 25pt; font-weight: 900; line-height: 1.02; letter-spacing: -.8px; margin-bottom: 12px; }}
.story p {{ font-size: 10.5pt; line-height: 1.62; margin-bottom: 11px; text-align: justify; hyphens: auto; }}
.story > p:first-of-type::first-letter {{ float: left; font-family:'SF Compact Display',Arial,sans-serif;
  font-size: 40pt; font-weight: 900; line-height: .78; padding: 3px 7px 0 0; color: {ACCENT}; }}
.verdict {{ border-left: 4px solid {ACCENT}; padding: 11px 0 11px 14px; margin-top: auto; background: #F0ECE1; }}
.verdict span {{ font-size: 7.5pt; letter-spacing: 2.2px; text-transform: uppercase; color: #807A6D; font-weight: 700; }}
.verdict p {{ font-size: 12.5pt; font-style: italic; line-height: 1.38; margin-top: 4px; text-align: left; }}
.rail {{ width: 2.5in; flex: none; }}
.railblock {{ border-top: 2px solid {INK}; padding: 9px 0 13px; }}
.railblock h4 {{ font-size: 8.5pt; letter-spacing: 2.2px; text-transform: uppercase; color: {ACCENT};
                 font-weight: 800; margin-bottom: 8px; }}
.stat {{ display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 8px;
         padding: 3px 0; border-bottom: 1px dotted #CFC8B8; }}
.stat:last-child {{ border-bottom: 0; }}
.sl {{ font-size: 8.5pt; color: #5A554B; letter-spacing: .3px; }}
.sv {{ font-size: 11pt; font-weight: 700; font-family: Georgia, serif; text-align: right;
       font-variant-numeric: tabular-nums; white-space: nowrap; }}
.ss {{ font-size: 7pt; color: #908A7C; width: 100%; text-align: right; margin-top: -2px; }}
.posrow {{ display: flex; gap: 5px; margin-top: 9px; }}
.pos {{ flex: 1; text-align: center; background: {INK}; color: {CREAM}; padding: 5px 0 4px; border-radius: 3px; }}
.pos span {{ display: block; font-size: 7pt; letter-spacing: 1.4px; color: #A9A295; }}
.pos b {{ display: block; font-size: 13pt; font-weight: 900; line-height: 1.1; }}
.poslab {{ font-size: 7pt; color: #908A7C; text-align: center; margin-top: 4px; letter-spacing: .6px; }}
ul.players {{ list-style: none; }}
ul.players li {{ padding: 4px 0; border-bottom: 1px dotted #CFC8B8; }}
ul.players li:last-child {{ border-bottom: 0; }}
.pn {{ display: block; font-size: 10pt; font-weight: 700; }}
.pp {{ display: block; font-size: 7.5pt; color: #807A6D; letter-spacing: 1px; text-transform: uppercase; }}
.foot {{ position: absolute; left: .6in; right: .6in; bottom: .3in; display: flex; justify-content: space-between;
         font-size: 7.5pt; letter-spacing: 1.6px; text-transform: uppercase; color: #908A7C;
         border-top: 1px solid #DCD6C8; padding-top: 7px; }}
.awards {{ display: flex; flex-wrap: wrap; gap: 14px; }}
.aw {{ width: calc(50% - 7px); border-top: 3px solid {INK}; padding-top: 9px; }}
.aw .l {{ font-size: 8pt; letter-spacing: 2.2px; text-transform: uppercase; color: {ACCENT}; font-weight: 800; }}
.aw .w {{ font-size: 15pt; font-weight: 900; margin: 3px 0; }}
.aw .d {{ font-size: 9pt; color: #45413A; line-height: 1.45; }}
.method {{ margin-top: 26px; border-top: 3px solid {ACCENT}; padding-top: 12px; }}
.method h4 {{ font-size: 11pt; text-transform: uppercase; letter-spacing: 1.6px; margin-bottom: 8px; }}
.method p {{ font-size: 9pt; line-height: 1.55; color: #45413A; margin-bottom: 7px; }}
.colophon {{ color: #908A7C; font-size: 8pt; margin-top: 10px; }}

/* The same markup is a paginated magazine in print and a scrolling page on screen. */
@media screen {{
  body {{ background: #E6E1D5; padding: 18px 12px 60px; }}
  .page {{ width: 100%; max-width: 8.5in; height: auto; min-height: 0; margin: 0 auto 18px;
           border-radius: 6px; box-shadow: 0 4px 18px rgba(0,0,0,.14); padding: 36px 32px 30px; }}
  .foot {{ position: static; margin-top: 26px; }}
  .covermain {{ margin-top: 48px; }}
  .t3row {{ margin-top: 42px; }}
  @media (max-width: 640px) {{
    body {{ padding: 10px 8px 40px; }}
    .page {{ padding: 22px 18px 20px; }}
    .masthead h1 {{ font-size: 30pt; }}
    .covermain h2 {{ font-size: 54pt; letter-spacing: -2px; }}
    .covermain {{ margin-top: 26px; }}
    .t3row {{ margin-top: 26px; }}
    .deck {{ font-size: 12pt; }}
    .shead h2 {{ font-size: 25pt; }}
    .thead {{ flex-wrap: wrap; gap: 10px; }}
    .rankbox {{ width: auto; }}
    .rk {{ font-size: 46pt; letter-spacing: -3px; }}
    .tid {{ flex: 1 1 60%; }}
    .tid h2 {{ font-size: 23pt; }}
    .trend {{ flex: 1 1 100%; text-align: left; padding-top: 0; }}
    .tbody {{ flex-direction: column; gap: 22px; }}
    .rail {{ width: 100%; }}
    .story h3 {{ font-size: 21pt; }}
    .story p {{ text-align: left; }}
    .notes, .flash, .awards {{ flex-direction: column; gap: 16px; }}
    .aw {{ width: 100%; }}
    table.std {{ font-size: 9pt; }}
    table.std th:nth-child(n+5), table.std td:nth-child(n+5) {{ display: none; }}
  }}
}}
@media print {{
  .page {{ box-shadow: none; border-radius: 0; }}
}}
</style></head><body>

<section class="page cover">
  <div class="masthead">
    <h1>Midwest<br>Dynasty<br><em>Monthly</em></h1>
    <div class="sub">The official magazine of a ten-team, one-quarterback, half-PPR dynasty league</div>
    <div class="issue"><span>{today:%B %Y}</span><span>Through week {week}</span></div>
  </div>
  <div class="covermain">
    <div class="eyebrow">Power Rankings</div>
    <h2>All Ten<br>Teams,<br><em>Ranked</em></h2>
    <div class="deck">{E(copy.DECK)}</div>
  </div>
  <div class="t3row">{teaser}</div>
  <div class="coverfoot"><span>{first}&ndash;{season}</span><span>Data: Sleeper &amp; FantasyCalc</span></div>
</section>

<section class="page">
  <div class="shead"><div class="kicker">The League at a Glance</div><h2>Where Everyone Stands</h2>
    <p>Through week {week} of the {season} season. Strength is the share of the league a team would beat in a
       typical week, which removes schedule luck. Roster ratings are out of 100 against the best roster in
       the league — one for this season, one for the years ahead.</p></div>
  <table class="std">
    <thead><tr><th>#</th><th>Team</th><th>Record</th><th>Pts/G</th><th>Strength</th>
      <th>Roster now</th><th>Long term</th><th>Power rank</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
  <div class="notes">{notes}</div>
  <div class="flash">{flash}</div>
</section>

{pages}

<section class="page">
  <div class="shead"><div class="kicker">Hardware &amp; Honors</div><h2>Ten Years of Receipts</h2>
    <p>Career marks across every season, {first} through {season}. The pre-Sleeper years come from the
       commissioner's records; everything from 2019 on comes from Sleeper.</p></div>
  <div class="awards">{honors}</div>
  <div class="method">
    <h4>How we ranked them</h4>
    <p><b>Power rank</b> is the average of two numbers: the roster's rating for this season, and the share
      of the league that team has outscored in a typical week of {season}. One measures the talent on hand,
      the other measures what it has actually done. Neither is affected by who a team happened to play.</p>
    <p><b>Roster ratings</b> build the best legal lineup from each roster using FantasyCalc trade values, add
      credit for bench depth, and — for the long-term number — every draft pick owned over the next three
      drafts. Quarterback values are adjusted upward for this league's six-point passing touchdowns.</p>
    <p><b>Manager grades</b> for drafting, trading and the waiver wire are measured in points above a
      replacement-level player at the same position, so a quarterback's raw scoring advantage does not
      distort them. Drafting judges each pick on its player's first three seasons; trading judges each side
      from the deal through the next season.</p>
    <p class="colophon">Compiled {today:%B %d, %Y} from Sleeper league {LEAGUE_ID} and FantasyCalc dynasty
      values. Live ratings at tpm08150.github.io/dynasty-rater</p>
  </div>
</section>
</body></html>'''


# -------------------------------------------------------------------- main ----

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--league', default=LEAGUE_ID)
    ap.add_argument('--out', type=Path, help='PDF path (default out/MWDL-<season>-Week<n>-Power-Rankings.pdf)')
    ap.add_argument('--page', type=Path, default=ROOT / 'magazine.html',
                    help='hosted HTML page (default magazine.html, published with the site)')
    ap.add_argument('--chrome', default=CHROME, help='Chrome binary used to print the PDF')
    ap.add_argument('--html-only', action='store_true', help='write the HTML and stop')
    args = ap.parse_args()

    snapshot = json.loads(subprocess.run(
        ['node', str(ROOT / 'scripts' / 'ratings_snapshot.mjs'), args.league],
        cwd=ROOT, check=True, capture_output=True, text=True).stdout)
    season, week = snapshot['season'], snapshot['week']

    missing = [t['team'] for t in snapshot['teams'] if t['ownerId'] not in copy.TEAMS]
    if missing:
        sys.exit('No copy in scripts/magazine_copy.py for: ' + ', '.join(missing))

    chain = league_chain(args.league)
    career, seasons, efficiency = collect(chain, season, week)
    add_earlier_seasons(career, ROOT / 'data' / 'yahoo-seasons.json')
    grades = json.loads((ROOT / 'data' / 'deals.json').read_text())['managers'] \
        if (ROOT / 'data' / 'deals.json').exists() else {}

    profiles = {}
    for team in snapshot['teams']:
        uid = team['ownerId']
        c, rows = career[uid], seasons[uid]
        if season not in rows:
            sys.exit(f'No {season} games played yet for {team["team"]} — nothing to rank.')
        row = rows[season]
        scored, potential, weeks = efficiency[uid]
        profiles[uid] = dict(
            season=dict(season=season, w=row['w'], l=row['l'], ppw=round(row['pf'] / row['weeks'], 1),
                        strength=row['expected'] / row['weeks']),
            all_w=c['w'] + c['early_w'], all_l=c['l'] + c['early_l'],
            titles=c['titles'], lost_final=c['lost_final'],
            playoffs=f"{c['playoff_w']}-{c['playoff_l']}",
            trips=sum(1 for k in c if k.startswith('trip_')),
            efficiency=round(100 * scored / potential, 1) if potential else None,
            bench=round((potential - scored) / weeks, 1) if weeks else None,
            grades=grades.get(uid), teams=len(snapshot['teams']),
            first_season=min(int(l['season']) for l in chain))
    if (ROOT / 'data' / 'yahoo-seasons.json').exists():
        earliest = min(int(s['league']['season'])
                       for s in json.loads((ROOT / 'data' / 'yahoo-seasons.json').read_text())['seasons'])
        for p in profiles.values():
            p['first_season'] = min(p['first_season'], earliest)

    order = power_order(snapshot['teams'], {u: p['season'] for u, p in profiles.items()})
    today = datetime.date.today()
    page = build_html(snapshot, profiles, order, today)

    out = args.out or ROOT / 'out' / f'Midwest-Dynasty-Monthly-{today:%Y-%m}.pdf'
    out.parent.mkdir(parents=True, exist_ok=True)
    args.page.parent.mkdir(parents=True, exist_ok=True)
    args.page.write_text(page)
    print(f'wrote {args.page}')
    teams = {t['ownerId']: t['team'] for t in snapshot['teams']}
    for i, uid in enumerate(order, 1):
        r = profiles[uid]['season']
        print(f"  {i:2}. {teams[uid]:24} {r['w']}-{r['l']}  {r['ppw']:6.1f} pts/game")
    if args.html_only:
        return
    if not Path(args.chrome).exists():
        sys.exit(f'Chrome not found at {args.chrome}. Pass --chrome, or use --html-only.')
    subprocess.run([args.chrome, '--headless', '--disable-gpu', '--no-pdf-header-footer',
                    f'--print-to-pdf={out}', args.page.resolve().as_uri()], check=True, capture_output=True)
    print(f'wrote {out} ({out.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main()
