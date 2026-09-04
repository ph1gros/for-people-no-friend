"""Protect speech and punctuation while attenuating breath-like pause noise."""
import unittest
import numpy as np
from test_terminal import service

class PauseNoiseTests(unittest.TestCase):
    def test_attenuates_a_low_energy_burst_inside_a_long_pause(self):
        rate = 32000
        t = np.arange(rate * 3) / rate
        pcm = np.zeros(rate * 3)
        pcm[3200:24000] = .45 * np.sin(2 * np.pi * 220 * t[3200:24000])
        pcm[64000:88000] = .45 * np.sin(2 * np.pi * 260 * t[64000:88000])
        pcm[40000:48000] = .025 * np.random.default_rng(4).uniform(-1, 1, 8000)
        before = (pcm * 32767).astype('<i2')
        after = np.frombuffer(service.suppress_pause_noise(before.tobytes()), dtype='<i2')
        self.assertEqual(len(after), len(before))
        np.testing.assert_array_equal(after[3200:24000], before[3200:24000])
        np.testing.assert_array_equal(after[64000:88000], before[64000:88000])
        self.assertLess(np.linalg.norm(after[40000:48000]), np.linalg.norm(before[40000:48000]) * .1)

    def test_preserves_quiet_speech_short_pauses_and_unvoiced_word_edges(self):
        rng = np.random.default_rng(5)
        quiet = (rng.normal(0, 40, 32000)).astype('<i2').tobytes()
        self.assertEqual(service.suppress_pause_noise(quiet), quiet)
        t = np.arange(64000) / 32000
        x = (.35 * np.sin(2 * np.pi * 200 * t) * 32767).astype('<i2')
        x[30000:32000] = 80  # short pause
        x[:2400] = 120  # quiet word onset before the vowel
        x[-4000:] = 120  # quiet release after the vowel
        self.assertEqual(service.suppress_pause_noise(x.tobytes()), x.tobytes())

    def test_empty_short_and_odd_byte_inputs_are_not_reinterpreted(self):
        for value in (b'', b'abc', b'\x00\x01' * 400):
            self.assertEqual(service.suppress_pause_noise(value), value)

if __name__ == '__main__':
    unittest.main()
