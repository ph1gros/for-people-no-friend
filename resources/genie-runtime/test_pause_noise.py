"""Protect speech and punctuation while attenuating breath-like pause noise."""
import unittest
import numpy as np
from test_terminal import service

class PauseNoiseTests(unittest.TestCase):
    def test_feibi_weak_breath_after_a_word_is_not_kept_by_the_200ms_guard(self):
        rate = 32000
        t = np.arange(rate*3)/rate
        x = np.zeros(rate*3)
        x[3200:rate] = .35*np.sin(2*np.pi*220*t[3200:rate])
        x[rate*2:rate*3] = .35*np.sin(2*np.pi*220*t[rate*2:rate*3])
        # Low-frequency, nonperiodic mouth/breath noise 60-200 ms after speech.
        rng = np.random.default_rng(12)
        noise = np.convolve(rng.normal(size=4480), np.ones(12)/12, mode='same')*.004
        x[33920:38400] = noise
        pcm = (x*32767).astype('<i2')
        out = np.frombuffer(service.suppress_pause_noise(pcm.tobytes(), tighten_tail=True), dtype='<i2')
        np.testing.assert_array_equal(out[:rate], pcm[:rate])
        np.testing.assert_array_equal(out[rate*2:], pcm[rate*2:])
        self.assertLess(np.linalg.norm(out[35000:38000]), np.linalg.norm(pcm[35000:38000])*.15)

    def test_tighter_tail_keeps_soft_voiced_releases_and_high_frequency_consonants(self):
        rate = 32000
        t = np.arange(rate*3)/rate
        noise = np.random.default_rng(17).normal(size=len(t))
        unvoiced = .001*(noise-np.convolve(noise, np.ones(8)/8, mode='same'))
        for release in (.002*np.sin(2*np.pi*220*t), unvoiced):
            x = np.zeros(rate*3)
            x[:rate] = .35*np.sin(2*np.pi*220*t[:rate])
            x[rate:rate+6000] = release[rate:rate+6000]
            x[rate*2:] = .35*np.sin(2*np.pi*220*t[rate*2:])
            pcm = (x*32767).astype('<i2')
            out = np.frombuffer(service.suppress_pause_noise(pcm.tobytes(), tighten_tail=True), dtype='<i2')
            np.testing.assert_array_equal(out[:rate+6000], pcm[:rate+6000])

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
