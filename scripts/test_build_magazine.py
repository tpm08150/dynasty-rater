import unittest

import build_magazine as mag
import magazine_copy as copy


class AllPlayTest(unittest.TestCase):
    def test_share_of_teams_beaten_counts_ties_as_half(self):
        points = {1: 100.0, 2: 100.0, 3: 50.0, 4: 10.0}
        self.assertAlmostEqual(mag.all_play(points, 1), (2 + 0.5) / 3)
        self.assertAlmostEqual(mag.all_play(points, 4), 0.0)

    def test_pairs_drops_byes_and_unmatched_rows(self):
        games = [{'roster_id': 1, 'matchup_id': 1, 'points': 9}, {'roster_id': 2, 'matchup_id': 1, 'points': 8},
                 {'roster_id': 3, 'matchup_id': 2, 'points': 7},  # orphan half of a matchup
                 {'roster_id': 4, 'matchup_id': None, 'points': 6}]
        self.assertEqual([[m['roster_id'] for m in p] for p in mag.pairs(games)], [[1, 2]])


class PowerOrderTest(unittest.TestCase):
    # Roster rating is out of 100 and strength is a 0-1 share, so the blend is
    # (rating + strength*100) / 2: talent on hand and results, equally weighted.
    TEAMS = [
        {'ownerId': 'loaded', 'current': 100.0},   # blend 60.0
        {'ownerId': 'winning', 'current': 40.0},   # blend 65.0
        {'ownerId': 'neither', 'current': 30.0},   # blend 25.0
    ]
    ROWS = {'loaded': {'strength': 0.20}, 'winning': {'strength': 0.90}, 'neither': {'strength': 0.20}}

    def test_results_can_outrank_a_better_roster(self):
        self.assertEqual(mag.power_order(self.TEAMS, self.ROWS), ['winning', 'loaded', 'neither'])

    def test_a_team_strong_on_both_counts_leads(self):
        teams = self.TEAMS + [{'ownerId': 'best', 'current': 95.0}]
        rows = dict(self.ROWS, best={'strength': 0.80})
        self.assertEqual(mag.power_order(teams, rows)[0], 'best')


class CopyTest(unittest.TestCase):
    def test_every_entry_has_the_fields_the_layout_reads(self):
        for user, entry in copy.TEAMS.items():
            self.assertEqual(set(entry), {'kicker', 'head', 'body', 'verdict'}, user)
            self.assertTrue(entry['body'] and all(entry['body']), user)

    def test_standings_page_furniture_is_the_right_shape(self):
        self.assertEqual(len(copy.WEEK_NOTES), 3)
        self.assertEqual(len(copy.FLASH), 4)
        self.assertTrue(all(len(h) == 3 for h in copy.HONORS))


if __name__ == '__main__':
    unittest.main()
