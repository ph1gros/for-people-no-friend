"""Offline regression tests for the pinned Genie 2.0.2 decoder boundary."""
import os
from pathlib import Path
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np

os.environ['GENIE_DATA_DIR'] = str(Path(__file__).parent)
os.environ['FPNF_GENIE_VOICE_ROOT'] = str(Path(__file__).parent)
os.environ['FPNF_GENIE_SESSION_TOKEN'] = 'fake-unit-test-session-no-real-credential'
import fpnf_genie_service as service


class TerminalTokenTests(unittest.TestCase):
    def test_drops_only_the_decoder_inserted_terminal_placeholder(self):
        # The pinned decoder overwrites its EOS with 0. Earlier zeroes are valid speech.
        tokens = np.array([[[53, 0, 1003, 357, 0]]], dtype=np.int64)
        original = tokens.copy()
        decoder = Mock(return_value=tokens)
        client = SimpleNamespace(t2s_cpu=decoder)
        service.install_genie_terminal_fix(client)
        result = client.t2s_cpu('fake-input', language='Japanese')
        np.testing.assert_array_equal(result, original[..., :-1])
        np.testing.assert_array_equal(tokens, original)
        decoder.assert_called_once_with('fake-input', language='Japanese')

    def test_installing_twice_does_not_remove_another_speech_token(self):
        client = SimpleNamespace(t2s_cpu=lambda: np.array([[[5, 0, 0]]]))
        service.install_genie_terminal_fix(client)
        service.install_genie_terminal_fix(client)
        np.testing.assert_array_equal(client.t2s_cpu(), [[[5, 0]]])

    def test_keeps_cancellation_and_rejects_unexpected_decoder_results(self):
        client = SimpleNamespace(t2s_cpu=lambda: None)
        service.install_genie_terminal_fix(client)
        self.assertIsNone(client.t2s_cpu())
        for tokens in [np.array([[[5, 4]]]), np.array([[[0]]]), np.array([5, 0])]:
            with self.subTest(shape=tokens.shape):
                client = SimpleNamespace(t2s_cpu=lambda: tokens)
                service.install_genie_terminal_fix(client)
                with self.assertRaises(RuntimeError):
                    client.t2s_cpu()


if __name__ == '__main__':
    unittest.main()
