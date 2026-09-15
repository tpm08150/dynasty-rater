import math
import unittest

import deals_lib as lib


class ScoringTest(unittest.TestCase):
    def test_score_ignores_unscored_and_non_numeric_stats(self):
        scoring = {'pass_td': 6, 'pass_yd': 0.04, 'rec': 0.5}
        stats = {'pass_td': 2, 'pass_yd': 250, 'rec': 3, 'adp_half_ppr': 40, 'note': 'x'}
        self.assertAlmostEqual(lib.score(stats, scoring), 12 + 10 + 1.5)

    def test_replacement_level_is_the_nth_player_per_week(self):
        totals = {'q1': 300, 'q2': 200, 'q3': 100, 'r1': 50}
        positions = {'q1': 'QB', 'q2': 'QB', 'q3': 'QB', 'r1': 'RB'}
        levels = lib.replacement_per_week(totals, positions, weeks=10, ranks={'QB': 2, 'RB': 2})
        self.assertAlmostEqual(levels['QB'], 20.0)
        self.assertEqual(levels['RB'], 0.0)  # not enough RBs to reach the rank

    def test_value_over_replacement_skips_missing_weeks_and_floors_at_zero(self):
        weekly = {1: {'p': 30}, 2: {}, 3: {'p': 5}, 4: {'p': 25}}
        levels = {'WR': 10}
        self.assertAlmostEqual(lib.value_over_replacement(weekly, 'p', 'WR', levels), 20 - 5 + 15)
        self.assertAlmostEqual(lib.value_over_replacement(weekly, 'p', 'WR', levels, first_week=3), -5 + 15)
        self.assertEqual(lib.value_over_replacement({1: {'p': 2}}, 'p', 'WR', levels), 0.0)


class DraftCurveTest(unittest.TestCase):
    def test_fit_recovers_a_log_curve_and_expected_is_floored(self):
        picks = []
        for season, mean_scale in ((2020, 1.0), (2021, 3.0)):
            raw = [2.0 - 0.4 * math.log(n) for n in range(1, 21)]
            scale = mean_scale / (sum(raw) / len(raw))
            picks += [{'season': season, 'pick_no': n, 'outcome': r * scale * 100} for n, r in zip(range(1, 21), raw)]
        a, b, class_mean = lib.fit_draft_curve(picks)
        # Outcomes were built as class_mean × (a' + b'·ln pick) with the same shape both years.
        ratio = a / b
        self.assertAlmostEqual(ratio, 2.0 / -0.4, places=6)
        self.assertAlmostEqual(lib.expected_outcome(5, 2021, (a, b, class_mean)), picks[20 + 4]['outcome'], places=6)
        self.assertEqual(lib.expected_outcome(10 ** 6, 2021, (a, b, class_mean)), 0.0)


class TradeTest(unittest.TestCase):
    def test_start_week(self):
        self.assertEqual(lib.trade_start_week(created_ms=100, kickoff_ms=200, leg=1), 1)
        self.assertEqual(lib.trade_start_week(created_ms=300, kickoff_ms=200, leg=6), 7)

    def test_grade_trade_nets_players_and_picks(self):
        trade = {
            'roster_ids': [1, 2],
            'adds': {'star': 1, 'vet': 2},
            'draft_picks': [{'season': '2021', 'round': 1, 'roster_id': 1, 'owner_id': 2, 'previous_owner_id': 1, 'player_id': 'rookie'}],
        }
        values = {'star': (300.0, True), 'vet': (50.0, True)}
        net, received, complete = lib.grade_trade(trade, values.get, lambda pick: (120.0, True))
        self.assertEqual(net, {1: 300 - 50 - 120, 2: 50 + 120 - 300})
        self.assertTrue(complete)
        self.assertEqual([a['id'] for a in received[2]], ['vet', 'rookie'])
        self.assertEqual(received[2][1]['season'], 2021)

    def test_any_unplayed_asset_makes_the_trade_too_early(self):
        trade = {'roster_ids': [1, 2], 'adds': {'star': 1}, 'draft_picks': [
            {'season': '2027', 'round': 2, 'roster_id': 1, 'owner_id': 2, 'previous_owner_id': 1}]}
        _, _, complete = lib.grade_trade(trade, lambda pid: (10.0, True), lambda pick: (0.0, False))
        self.assertFalse(complete)

    def test_three_team_trades_are_rejected(self):
        with self.assertRaises(ValueError):
            lib.grade_trade({'roster_ids': [1, 2, 3]}, None, None)


class WaiverTest(unittest.TestCase):
    TX = [
        {'season': 2021, 'leg': 3, 'created': 30, 'status': 'complete', 'type': 'waiver', 'transaction_id': 'w1', 'adds': {'gem': 1}, 'drops': {'dud': 1}},
        {'season': 2021, 'leg': 5, 'created': 50, 'status': 'complete', 'type': 'free_agent', 'transaction_id': 'f1', 'adds': {'dud': 2}, 'drops': None},
        {'season': 2021, 'leg': 6, 'created': 60, 'status': 'complete', 'type': 'trade', 'transaction_id': 't1', 'adds': {'star': 1}, 'drops': {'star': 2}},
        {'season': 2020, 'leg': 9, 'created': 5, 'status': 'complete', 'type': 'waiver', 'transaction_id': 'old', 'adds': {'vet': 1}, 'drops': None},
        {'season': 2021, 'leg': 7, 'created': 70, 'status': 'failed', 'type': 'waiver', 'transaction_id': 'x', 'adds': {'nope': 1}, 'drops': None},
    ]

    def test_acquisition_is_the_latest_completed_add_by_that_week(self):
        index = lib.index_adds(self.TX)
        self.assertIsNone(lib.acquisition(index, 1, 'gem', 2021, 2))
        self.assertEqual(lib.acquisition(index, 1, 'gem', 2021, 3)[4], 'w1')
        self.assertIsNone(lib.acquisition(index, 1, 'nope', 2021, 9))

    def test_pickups_count_that_seasons_starts_and_skip_trades_and_old_pickups(self):
        index = lib.index_adds(self.TX)
        lineups = [(2021, 2, 1, ['gem']), (2021, 3, 1, ['gem', 'vet', '0']), (2021, 4, 1, ['gem']),
                   (2021, 6, 1, ['star']), (2021, 5, 2, ['dud'])]
        values = {('gem', 3): 12.0, ('gem', 4): -2.0, ('dud', 5): -8.0, ('star', 6): 30.0, ('vet', 3): 9.0}
        pickups = lib.waiver_pickups(lineups, index, lambda s, w, pid: values.get((pid, w), 0.0))
        self.assertEqual(set(pickups), {('w1', 'gem'), ('f1', 'dud')})
        self.assertEqual(pickups[('w1', 'gem')]['starts'], 2)  # week 2 came before the claim
        self.assertAlmostEqual(pickups[('w1', 'gem')]['value'], 10.0)
        self.assertEqual(pickups[('f1', 'dud')]['value'], 0.0)  # floored

    def test_drop_cost_goes_to_the_latest_other_team_that_season(self):
        index, drops = lib.index_adds(self.TX), lib.index_drops(self.TX)
        pickups = lib.waiver_pickups([(2021, 5, 2, ['dud'])], index, lambda s, w, pid: 5.0)
        self.assertEqual(lib.dropped_by(drops, pickups[('f1', 'dud')]), 1)
        self.assertIsNone(lib.dropped_by(drops, {'player_id': 'dud', 'season': 2022, 'created': 99, 'roster': 2}))
        self.assertIsNone(lib.dropped_by(drops, {'player_id': 'dud', 'season': 2021, 'created': 99, 'roster': 1}))
        self.assertNotIn('star', drops)  # leaving in a trade isn't a drop


if __name__ == '__main__':
    unittest.main()
