"""Grading logic for the draft and trade superlatives. No network access, so
test_deals_lib.py can check it against small made-up seasons."""
import math
from collections import defaultdict

# Replacement level is the first player at each position a 10-team league with
# 1 QB, 2 RB, 2 WR, 1 TE, 2 FLEX, K and DEF wouldn't start. Grading on points
# above that keeps quarterbacks, who score the most raw points under 6-point
# passing TDs but are the easiest position to fill in a 1-QB league, from
# winning every comparison.
REPLACEMENT_RANK = {'QB': 11, 'RB': 31, 'WR': 31, 'TE': 11, 'K': 11, 'DEF': 11}
DRAFT_SEASONS = 3  # a rookie pick is judged on the player's first three seasons
TRADE_SEASONS = 2  # a trade is judged on the rest of that season plus the next


def score(stats, scoring):
    """Fantasy points for one stat line under a league's scoring settings."""
    return sum(v * scoring[k] for k, v in stats.items() if k in scoring and isinstance(v, (int, float)))


def replacement_per_week(season_totals, positions, weeks, ranks=REPLACEMENT_RANK):
    """Points per week scored by the replacement-level player at each position."""
    levels = {}
    for pos, rank in ranks.items():
        totals = sorted((p for pid, p in season_totals.items() if positions.get(pid) == pos), reverse=True)
        levels[pos] = totals[rank - 1] / weeks if weeks and len(totals) >= rank else 0.0
    return levels


def value_over_replacement(weekly, pid, position, levels, first_week=1):
    """Points above replacement from first_week on, counting only weeks the player
    recorded stats. Floored at zero: a player below replacement would sit on a bench,
    not cost his team points."""
    level = levels.get(position, 0.0)
    total = sum(pts[pid] - level for week, pts in weekly.items() if week >= first_week and pid in pts)
    return max(0.0, total)


def fit_draft_curve(picks):
    """Least-squares fit of each pick's outcome, as a share of its draft class's
    average, against ln(pick number). Returns (a, b, class_mean)."""
    by_class = defaultdict(list)
    for p in picks:
        by_class[p['season']].append(p['outcome'])
    class_mean = {season: sum(v) / len(v) for season, v in by_class.items()}
    points = [(math.log(p['pick_no']), p['outcome'] / class_mean[p['season']])
              for p in picks if class_mean[p['season']] > 0]
    if not points:
        return 0.0, 0.0, class_mean
    mean_x = sum(x for x, _ in points) / len(points)
    mean_y = sum(y for _, y in points) / len(points)
    sxx = sum((x - mean_x) ** 2 for x, _ in points)
    b = sum((x - mean_x) * (y - mean_y) for x, y in points) / sxx if sxx else 0.0
    return mean_y - b * mean_x, b, class_mean


def expected_outcome(pick_no, season, curve):
    """What a pick in this spot of this draft class typically produced."""
    a, b, class_mean = curve
    return max(0.0, a + b * math.log(pick_no)) * class_mean.get(season, 0.0)


PICKUP_TYPES = ('waiver', 'free_agent')


def index_adds(transactions):
    """Every completed add, by (roster_id, player_id), in time order. Transactions
    need a 'season' key; Sleeper's own objects don't carry one."""
    index = defaultdict(list)
    for t in transactions:
        if t['status'] != 'complete':
            continue
        for pid, roster in (t.get('adds') or {}).items():
            index[(roster, pid)].append((t['season'], t['leg'], t['created'], t['type'], t['transaction_id']))
    for events in index.values():
        events.sort()
    return dict(index)


def index_drops(transactions):
    """Players let go in waiver or free-agent moves: {player_id: [(season, created, roster_id)]}.
    Players leaving in trades aren't drops."""
    drops = defaultdict(list)
    for t in transactions:
        if t['status'] != 'complete' or t['type'] not in PICKUP_TYPES:
            continue
        for pid, roster in (t.get('drops') or {}).items():
            drops[pid].append((t['season'], t['created'], roster))
    return dict(drops)


def acquisition(index, roster, pid, season, week):
    """The latest move that put this player on this roster by that week, or None
    if he got there by the rookie draft or was on the original roster."""
    for event in reversed(index.get((roster, pid), [])):
        if (event[0], event[1]) <= (season, week):
            return event
    return None


def waiver_pickups(lineups, index, weekly_value):
    """Value of each waiver or free-agent pickup to the team that made it.

    lineups: (season, week, roster_id, starter ids) for every lineup set.
    weekly_value(season, week, player_id): points above replacement that week.
    A pickup is judged on the weeks that team started him in the season it was
    made, floored at zero. Returns {(transaction_id, player_id): pickup}."""
    pickups = {}
    for season, week, roster, starters in lineups:
        for pid in starters:
            if not pid or pid == '0':
                continue
            event = acquisition(index, roster, pid, season, week)
            if not event or event[3] not in PICKUP_TYPES or event[0] != season:
                continue
            pickup = pickups.setdefault((event[4], pid), {
                'roster': roster, 'player_id': pid, 'season': season,
                'week': event[1], 'created': event[2], 'starts': 0, 'value': 0.0,
            })
            pickup['starts'] += 1
            pickup['value'] += weekly_value(season, week, pid)
    for pickup in pickups.values():
        pickup['value'] = max(0.0, pickup['value'])
    return pickups


def dropped_by(drops, pickup):
    """The team that most recently dropped this player earlier the same season,
    unless that was the team picking him back up."""
    earlier = [d for d in drops.get(pickup['player_id'], [])
               if d[0] == pickup['season'] and d[1] < pickup['created']]
    if not earlier:
        return None
    roster = max(earlier)[2]
    return None if roster == pickup['roster'] else roster


def trade_start_week(created_ms, kickoff_ms, leg):
    """Offseason trades count the whole season; in-season trades start the next week."""
    return 1 if created_ms < kickoff_ms else leg + 1


def grade_trade(trade, player_value, pick_value):
    """Net value for each side of a two-team Sleeper trade.

    player_value(player_id) and pick_value(pick) each return (points, complete),
    where complete is False if any season the asset is judged on hasn't been played.
    Returns ({roster_id: net points}, {roster_id: [assets received]}, complete)."""
    if len(trade['roster_ids']) != 2:
        raise ValueError(f"only two-team trades are graded, got {trade['roster_ids']}")
    net = defaultdict(float)
    received = defaultdict(list)
    complete = True
    for pid, to in (trade.get('adds') or {}).items():
        giver = next(r for r in trade['roster_ids'] if r != to)
        value, done = player_value(pid)
        net[to] += value
        net[giver] -= value
        received[to].append({'kind': 'player', 'id': pid, 'value': value})
        complete = complete and done
    for pick in trade.get('draft_picks') or []:
        value, done = pick_value(pick)
        net[pick['owner_id']] += value
        net[pick['previous_owner_id']] -= value
        received[pick['owner_id']].append({
            'kind': 'pick', 'season': int(pick['season']), 'round': pick['round'],
            'id': pick.get('player_id'), 'value': value,
        })
        complete = complete and done
    return dict(net), dict(received), complete
