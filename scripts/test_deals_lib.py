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


if __name__ == '__main__':
    unittest.main()
