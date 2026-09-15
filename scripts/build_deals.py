#!/usr/bin/env python3
"""Rebuild data/deals.json, the draft and trade grades on the History page.

Walks every Sleeper season of the league, downloads rookie drafts, trades and
weekly NFL stats (finished seasons are cached in scripts/.cache), scores players
with each season's league rules, and grades picks and trades on points above
replacement. Run from the repo root after a season finishes:

    python3 scripts/build_deals.py
"""
import datetime
import json
import sys
import time
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deals_lib as lib  # noqa: E402

LEAGUE_ID = '1312979994133139456'
ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(__file__).resolve().parent / '.cache'
POSITIONS = ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')
# NFL opening night (UTC). A trade before kickoff counts that whole season.
KICKOFF = {
    2019: '2019-09-06T00:20', 2020: '2020-09-11T00:20', 2021: '2021-09-10T00:20', 2022: '2022-09-09T00:20',
    2023: '2023-09-08T00:20', 2024: '2024-09-06T00:20', 2025: '2025-09-05T00:20', 2026: '2026-09-10T00:20',
}


def get(path, cache_name=None):
    """GET JSON from Sleeper; responses for finished seasons are kept on disk."""
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


def kickoff_ms(season):
    if season not in KICKOFF:
        sys.exit(f'Add the {season} NFL kickoff date to KICKOFF in {Path(__file__).name}.')
    return datetime.datetime.fromisoformat(KICKOFF[season]).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000


def load_season(league):
    season = int(league['season'])
    league_id = league['league_id']
    finished = league['status'] == 'complete'
    cache = (lambda name: f'{season}-{name}.json') if finished else (lambda name: None)
    rosters = get(f'/v1/league/{league_id}/rosters', cache('rosters'))
    drafts = get(f'/v1/league/{league_id}/drafts', cache('drafts'))
    rounds = league['settings'].get('draft_rounds')
    # Rookie drafts only: 2019 also has a 26-round "draft" that imported the Yahoo rosters.
    draft = next((d for d in drafts if d['status'] == 'complete' and d['settings'].get('rounds') == rounds), None)
    picks = get(f"/v1/draft/{draft['draft_id']}/picks", cache('picks')) if draft else []
    with ThreadPoolExecutor(8) as pool:
        weeks = pool.map(lambda w: get(f'/v1/league/{league_id}/transactions/{w}', cache(f'transactions-{w}')), range(19))
    return {
        'season': season,
        'league': league,
        'owner': {r['roster_id']: r['owner_id'] for r in rosters},
        'draft': draft,
        'picks': picks,
        'transactions': [t for week in weeks for t in week],
    }


def load_points(league):
    """Weekly fantasy points, positions and names for every player in a finished season."""
    season = int(league['season'])
    file = CACHE / f'{season}-points.json'
    if file.exists():
        data = json.loads(file.read_text())
    else:
        query = '&'.join(f'position[]={p}' for p in POSITIONS)
        weeks, positions, names = {}, {}, {}

        def fetch(week):
            return week, get(f'/stats/nfl/{season}/{week}?season_type=regular&{query}')

        with ThreadPoolExecutor(6) as pool:
            for week, rows in pool.map(fetch, range(1, league['settings']['last_scored_leg'] + 1)):
                points = {}
                for row in rows:
                    stats = row.get('stats') or {}
                    if not stats:
                        continue
                    pid = row['player_id']
                    player = row.get('player') or {}
                    points[pid] = round(lib.score(stats, league['scoring_settings']), 2)
                    positions.setdefault(pid, 'DEF' if pid.isalpha() else (player.get('fantasy_positions') or [None])[0])
                    names.setdefault(pid, ' '.join(filter(None, (player.get('first_name'), player.get('last_name')))))
                weeks[week] = points
        data = {'weeks': weeks, 'positions': positions, 'names': names}
        CACHE.mkdir(parents=True, exist_ok=True)
        file.write_text(json.dumps(data))
    data['weeks'] = {int(w): pts for w, pts in data['weeks'].items()}
    return data


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def main():
    chain, league_id = [], LEAGUE_ID
    while league_id and league_id != '0':
        league = get(f'/v1/league/{league_id}')
        chain.append(league)
        league_id = league.get('previous_league_id')
    chain.reverse()
    seasons = {s['season']: s for s in map(load_season, chain)}
    finished = [lg for lg in chain if lg['status'] == 'complete']
    points = {int(lg['season']): load_points(lg) for lg in finished}
    positions = {pid: pos for p in points.values() for pid, pos in p['positions'].items()}
    names = {pid: name for p in points.values() for pid, name in p['names'].items()}
    for info in seasons.values():
        for pick in info['picks']:
            meta = pick.get('metadata') or {}
            names.setdefault(pick['player_id'], f"{meta.get('first_name', '')} {meta.get('last_name', '')}".strip())
    levels = {
        season: lib.replacement_per_week(_season_totals(p['weeks']), positions, len(p['weeks']))
        for season, p in points.items()
    }

    def season_value(pid, season, first_week=1):
        if season not in points:
            return 0.0, False
        return lib.value_over_replacement(points[season]['weeks'], pid, positions.get(pid), levels[season], first_week), True

    def span_value(pid, first_season, first_week, count):
        parts = [season_value(pid, first_season, first_week)] + [season_value(pid, first_season + k) for k in range(1, count)]
        return sum(v for v, _ in parts), all(done for _, done in parts)

    def drafted_player(season, rnd, original_roster):
        info = seasons.get(season)
        if not info or not info['draft']:
            return None
        slot = (info['draft'].get('draft_order') or {}).get(info['owner'].get(original_roster))
        return next((p['player_id'] for p in info['picks'] if p['round'] == rnd and p['draft_slot'] == slot), None)

    managers = defaultdict(lambda: {
        'draft': {'picks': 0, 'surplus': 0.0},
        'trades': {'total': 0, 'graded': 0, 'won': 0, 'lost': 0, 'net': 0.0},
        'adds': 0,
    })

    # ---- Drafts ----
    picks = []
    for season, info in sorted(seasons.items()):
        if season not in points:
            continue  # no games played yet for this class
        for pick in info['picks']:
            outcome, _ = span_value(pick['player_id'], season, 1, lib.DRAFT_SEASONS)
            picks.append({
                'season': season, 'pick_no': pick['pick_no'], 'round': pick['round'],
                'userId': info['owner'][pick['roster_id']], 'playerId': pick['player_id'],
                'player': names.get(pick['player_id'], ''), 'position': positions.get(pick['player_id']),
                'outcome': outcome, 'seasonsPlayed': sum(season + k in points for k in range(lib.DRAFT_SEASONS)),
            })
    curve = lib.fit_draft_curve(picks)
    for pick in picks:
        pick['expected'] = lib.expected_outcome(pick['pick_no'], pick['season'], curve)
        pick['surplus'] = pick['outcome'] - pick['expected']
        m = managers[pick['userId']]['draft']
        m['picks'] += 1
        m['surplus'] += pick['surplus']

    # ---- Trades and waiver moves ----
    trades = []
    for season, info in sorted(seasons.items()):
        owner = info['owner']
        for t in info['transactions']:
            if t['status'] != 'complete':
                continue
            if t['type'] in ('waiver', 'free_agent'):
                for roster in (t.get('adds') or {}).values():
                    managers[owner[roster]]['adds'] += 1
                continue
            if t['type'] != 'trade':
                continue
            start = lib.trade_start_week(t['created'], kickoff_ms(season), t['leg'])

            def player_value(pid, season=season, start=start):
                return span_value(pid, season, start, lib.TRADE_SEASONS)

            def pick_value(pick):
                pick['player_id'] = drafted_player(int(pick['season']), pick['round'], pick['roster_id'])
                if not pick['player_id']:
                    return 0.0, False
                return span_value(pick['player_id'], int(pick['season']), 1, lib.TRADE_SEASONS)

            net, received, graded = lib.grade_trade(t, player_value, pick_value)
            sides = []
            for roster in t['roster_ids']:
                user = owner[roster]
                assets = []
                for a in received.get(roster, []):
                    if a['kind'] == 'player':
                        label = names.get(a['id']) or f"Player {a['id']}"
                    else:
                        label = f"{a['season']} {ordinal(a['round'])}" + (f" → {names.get(a['id'], 'unknown')}" if a['id'] else '')
                    assets.append({'kind': a['kind'], 'label': label, 'position': positions.get(a['id']), 'value': round(a['value'], 1)})
                sides.append({'userId': user, 'net': round(net.get(roster, 0.0), 1), 'received': assets})
                m = managers[user]['trades']
                side_net = net.get(roster, 0.0)
                m['total'] += 1
                if graded:
                    m['graded'] += 1
                    m['net'] += side_net
                    if side_net > 0:
                        m['won'] += 1
                    elif side_net < 0:
                        m['lost'] += 1
            trades.append({
                'season': season, 'week': t['leg'],
                'date': datetime.datetime.fromtimestamp(t['created'] / 1000, datetime.timezone.utc).date().isoformat(),
                'graded': graded, 'sides': sides,
            })

    out = {
        'leagueIds': [lg['league_id'] for lg in chain],
        'generated': datetime.date.today().isoformat(),
        'firstSeason': int(chain[0]['season']),
        'throughSeason': max(points),
        'method': {
            'replacementRank': lib.REPLACEMENT_RANK,
            'draftSeasons': lib.DRAFT_SEASONS,
            'tradeSeasons': lib.TRADE_SEASONS,
        },
        'managers': {
            user: {
                'draft': {'picks': m['draft']['picks'], 'surplus': round(m['draft']['surplus'], 1)},
                'trades': {**m['trades'], 'net': round(m['trades']['net'], 1)},
                'adds': m['adds'],
            }
            for user, m in managers.items()
        },
        'picks': [{**p, 'outcome': round(p['outcome'], 1), 'expected': round(p['expected'], 1), 'surplus': round(p['surplus'], 1)} for p in picks],
        'trades': trades,
    }
    target = ROOT / 'data' / 'deals.json'
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(out, separators=(',', ':')))
    print(f"wrote {target.relative_to(ROOT)}: {len(picks)} picks, {len(trades)} trades "
          f"({sum(t['graded'] for t in trades)} graded) through {out['throughSeason']}, {target.stat().st_size // 1024} KB")


def _season_totals(weeks):
    totals = defaultdict(float)
    for pts in weeks.values():
        for pid, p in pts.items():
            totals[pid] += p
    return totals


if __name__ == '__main__':
    main()
