"""A mutation run may only succeed when its result is actually conclusive."""
import unittest

from verify.mutate import problems

MUTANT = {"file": "portfolio.py", "line": 1, "what": "Gt->GtE"}
LABEL = ("portfolio.py", "Gt->GtE", "x")
line_of = lambda _mutant: "x"


class Verdict(unittest.TestCase):
    def test_all_killed_passes(self):
        self.assertEqual(problems([(MUTANT, "killed")], {}, line_of), [])

    def test_reviewed_survivor_passes(self):
        self.assertEqual(problems([(MUTANT, "survived")], {LABEL: "why"}, line_of), [])

    def test_unreviewed_survivor_fails(self):
        self.assertIn("UNREVIEWED", problems([(MUTANT, "survived")], {}, line_of)[0])

    def test_timeout_fails(self):
        self.assertIn("TIMEOUT", problems([(MUTANT, "timeout")], {}, line_of)[0])

    def test_stale_review_fails(self):
        self.assertIn("STALE", problems([(MUTANT, "killed")], {LABEL: "why"}, line_of)[0])

    def test_empty_run_fails(self):
        self.assertTrue(problems([], {}, line_of))


if __name__ == "__main__":
    unittest.main()
