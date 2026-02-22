import unittest

from src.main import parse_silences


class ParseSilencesTests(unittest.TestCase):
    def test_parse_silences_generates_segments(self):
        stderr = """
        [silencedetect @ x] silence_start: 1.0
        [silencedetect @ x] silence_end: 2.0 | silence_duration: 1.0
        [silencedetect @ x] silence_start: 4.0
        [silencedetect @ x] silence_end: 5.0 | silence_duration: 1.0
        """
        out = parse_silences(stderr, total_duration=6.0, padding_before=0.1, padding_after=0.1, min_segment_duration=0.2)
        self.assertTrue(len(out) >= 2)
        self.assertAlmostEqual(out[0][0], 0.0, places=3)

    def test_parse_silences_fallback_full_duration(self):
        out = parse_silences("", total_duration=10.0, padding_before=0.1, padding_after=0.1, min_segment_duration=0.2)
        self.assertEqual(out, [(0.0, 10.0)])


if __name__ == "__main__":
    unittest.main()
