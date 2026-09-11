import unittest
import numpy as np
from worker import split_words, replace_regions


class SpeechTests(unittest.TestCase):
    def test_sentence_and_gap_boundaries_preserve_words(self):
        words = [{'word': word, 'startMs': start, 'endMs': end} for word, start, end in
                 [(' Hello', 0, 500), (' world.', 500, 1000), (' Keep', 2000, 2300), (' this.', 2300, 3000)]]
        cues = split_words(words)
        self.assertEqual([c['content'] for c in cues], ['Hello world.', 'Keep this.'])
        self.assertEqual([c['startMs'] for c in cues], [0, 2000])
        self.assertEqual([w for c in cues for w in c['words']], words)
        self.assertTrue(all(c['action'] == 'keep' for c in cues))

    def test_only_selected_sample_ranges_change(self):
        original = np.arange(20000, dtype=np.int16).reshape(10000, 2)
        before = original.copy()
        output = replace_regions(original, [(1000, 3000, np.full((2000, 2), -1000)), (5000, 6000, np.zeros((1000, 2)))], 1000)
        self.assertTrue(np.array_equal(original, before))
        for a, b in [(0, 1000), (3000, 5000), (6000, 10000)]:
            self.assertTrue(np.array_equal(output[a:b], original[a:b]))
        self.assertEqual(output.shape, original.shape)
        self.assertEqual(output[1500, 0], -1000)
        self.assertEqual(output[1000, 0], original[1000, 0], 'fade stays inside replacement')

    def test_wrong_sample_count_rejected(self):
        with self.assertRaises(ValueError):
            replace_regions(np.zeros((10000, 2), dtype=np.int16), [(1000, 3000, np.zeros((1000, 2)))], 1000)


if __name__ == '__main__':
    unittest.main()
