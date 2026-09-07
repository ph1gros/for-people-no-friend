"""Known voices stay bound to their service and never accept arbitrary characters."""
import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch
from test_terminal import service

class VoiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_known_voice_on_wrong_service_is_rejected_before_synthesis(self):
        incoming = asyncio.Queue()
        await incoming.put({'type': 'http.request', 'body': json.dumps({'character_name': 'feibi', 'text': '你好'}).encode(), 'more_body': False})
        sent = []
        async def send(message):
            sent.append(message)
        scope = {'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1', 'method': 'POST', 'scheme': 'http', 'path': '/tts', 'raw_path': b'/tts', 'query_string': b'', 'headers': [(b'x-fpnf-session', service.TOKEN.encode())]}
        with patch.object(service, 'ready', True), patch.object(service, 'VOICE_ID', 'mika'), patch.object(service, 'generate', new_callable=AsyncMock) as generate:
            await service.app(scope, incoming.get, send)
            self.assertEqual(sent[0]['status'], 400)
            generate.assert_not_called()

    async def test_warmup_uses_each_fixed_voice_language(self):
        for voice in ('mika', 'feibi', 'thirtyseven'):
            with patch.object(service, 'VOICE_ID', voice), patch.object(service, 'lock', asyncio.Lock()), patch.object(service, 'load_engine'), patch.object(service, 'generate', new_callable=AsyncMock) as generate, patch.object(service, 'ready', False):
                await service.prepare()
                generate.assert_awaited_once_with(service.WARMUP_TEXTS[voice], False)
                self.assertTrue(service.ready)

    def test_unknown_character_is_not_a_model_path(self):
        for voice in ('../mika', 'other', 'Mika'):
            with self.assertRaises(ValueError):
                service.SpeechRequest(character_name=voice, text='test')

if __name__ == '__main__':
    unittest.main()
