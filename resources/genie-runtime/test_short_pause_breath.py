"""Reach the breath a fast speaker leaves in pauses too short for the 450 ms gate.

Every pause in the fixed thirtyseven sample is under 300 ms, so the main gate never
fires for that voice and both of its inhales survive. These tests pin the symptom and
the guards that keep the rule off everything else.
"""
import unittest
import numpy as np
from test_terminal import service

RATE = 32000


def energy(samples):
    """int16 squared overflows; measure in float so the comparison means something."""
    return float(np.linalg.norm(np.asarray(samples, dtype=np.float64)))


def band_noise(count, low, high, seed, level):
    """Nonperiodic noise inside one band, the shape an inhale actually has."""
    spectrum = np.fft.rfft(np.random.default_rng(seed).normal(size=count))
    freqs = np.fft.rfftfreq(count, 1 / RATE)
    spectrum[(freqs < low) | (freqs > high)] = 0
    shaped = np.fft.irfft(spectrum, count)
    return shaped / (np.abs(shaped).max() + 1e-12) * level


def utterance(pause_samples, filler=None, speech_level=.45):
    """Two voiced stretches with one pause between them, the filler dropped inside."""
    speech = int(.8 * RATE)
    total = speech * 2 + pause_samples
    t = np.arange(total) / RATE
    audio = np.zeros(total)
    audio[:speech] = speech_level * np.sin(2 * np.pi * 200 * t[:speech])
    audio[speech + pause_samples:] = speech_level * np.sin(2 * np.pi * 210 * t[speech + pause_samples:])
    if filler is not None:
        start = speech + (pause_samples - len(filler)) // 2
        audio[start:start + len(filler)] = filler
    return (np.clip(audio, -1, 1) * 32767).astype('<i2'), speech, speech + pause_samples


class ShortPauseBreathTests(unittest.TestCase):
    def run_both(self, pcm, **kwargs):
        off = np.frombuffer(service.suppress_pause_noise(pcm.tobytes(), **kwargs), dtype='<i2')
        on = np.frombuffer(
            service.suppress_pause_noise(pcm.tobytes(), short_pause_breath=True, **kwargs),
            dtype='<i2')
        return off, on

    def test_reaches_an_inhale_in_a_pause_the_main_gate_ignores(self):
        # 240 ms is the pause that carries the reported thirtyseven breath; the main
        # gate needs 450 ms, so without this rule nothing happens at all.
        pause = int(.24 * RATE)
        breath = band_noise(int(.14 * RATE), 800, 3000, 11, .004)
        pcm, speech_end, speech_start = utterance(pause, breath)
        off, on = self.run_both(pcm)
        np.testing.assert_array_equal(off, pcm)
        self.assertLess(energy(on[speech_end:speech_start]),
                        energy(pcm[speech_end:speech_start]) * .5)

    def test_never_alters_a_single_speech_sample(self):
        pause = int(.24 * RATE)
        breath = band_noise(int(.14 * RATE), 800, 3000, 12, .004)
        pcm, speech_end, speech_start = utterance(pause, breath)
        _, on = self.run_both(pcm)
        np.testing.assert_array_equal(on[:speech_end], pcm[:speech_end])
        np.testing.assert_array_equal(on[speech_start:], pcm[speech_start:])
        self.assertEqual(len(on), len(pcm))

    def test_keeps_a_quiet_voiced_tail_that_merely_sits_in_a_pause(self):
        # A soft vowel release is weak and can look like breath by level alone; its
        # energy stays low in the spectrum, which is what separates the two.
        pause = int(.24 * RATE)
        tail = .004 * np.sin(2 * np.pi * 190 * np.arange(int(.14 * RATE)) / RATE)
        pcm, _, _ = utterance(pause, tail)
        _, on = self.run_both(pcm)
        np.testing.assert_array_equal(on, pcm)

    def test_keeps_english_unvoiced_consonants(self):
        # s and f put most of their energy above 4 kHz; an inhale does not.
        pause = int(.24 * RATE)
        sibilant = band_noise(int(.14 * RATE), 5000, 12000, 13, .004)
        pcm, _, _ = utterance(pause, sibilant)
        _, on = self.run_both(pcm)
        np.testing.assert_array_equal(on, pcm)

    def test_keeps_audible_aspiration_such_as_the_h_in_hello(self):
        # The measured "H" of Hello sits about 25 dB above the reported breath.
        pause = int(.24 * RATE)
        aspiration = band_noise(int(.14 * RATE), 800, 3000, 14, .08)
        pcm, _, _ = utterance(pause, aspiration)
        _, on = self.run_both(pcm)
        np.testing.assert_array_equal(on, pcm)

    def test_leaves_pauses_too_short_to_hold_a_breath_alone(self):
        # Under 160 ms there is no room for the 40 ms guards plus 80 ms of evidence.
        pause = int(.12 * RATE)
        breath = band_noise(int(.08 * RATE), 800, 3000, 15, .004)
        pcm, _, _ = utterance(pause, breath)
        _, on = self.run_both(pcm)
        np.testing.assert_array_equal(on, pcm)

    def test_ignores_a_leading_or_trailing_region_with_speech_on_one_side_only(self):
        speech = int(.8 * RATE)
        lead = int(.24 * RATE)
        t = np.arange(speech + lead) / RATE
        audio = np.zeros(speech + lead)
        audio[lead:] = .45 * np.sin(2 * np.pi * 200 * t[lead:])
        audio[int(.05 * RATE):int(.19 * RATE)] = band_noise(int(.14 * RATE), 800, 3000, 16, .004)
        pcm = (audio * 32767).astype('<i2')
        _, on = self.run_both(pcm)
        np.testing.assert_array_equal(on, pcm)

    def test_quiet_clips_and_malformed_input_still_short_circuit(self):
        quiet = np.random.default_rng(5).normal(0, 40, RATE).astype('<i2').tobytes()
        self.assertEqual(service.suppress_pause_noise(quiet, short_pause_breath=True), quiet)
        for value in (b'', b'abc', b'\x00\x01' * 400):
            self.assertEqual(service.suppress_pause_noise(value, short_pause_breath=True), value)


if __name__ == '__main__':
    unittest.main()
