"""Exercise cancellation through the real ASGI middleware and request receive path."""
import asyncio
import contextlib
import json
import unittest
import queue
import threading
from types import SimpleNamespace
from unittest.mock import Mock
from test_terminal import service

class DisconnectTests(unittest.IsolatedAsyncioTestCase):
    def test_stop_discards_old_text_before_a_restarted_worker_can_dequeue_it(self):
        text = queue.Queue()
        audio = queue.Queue()
        text.put('cancelled sentence')
        audio.put(b'cancelled audio')
        def upstream_stop():
            # Genie 2.0.2 stops/joins workers but appends sentinels behind pending work.
            text.put(None)
            audio.put(None)
        player = SimpleNamespace(stop=upstream_stop, _api_lock=threading.Lock(),
                                 _text_queue=text, _audio_queue=audio)
        service.install_genie_session_fix(player)
        service.install_genie_session_fix(player)
        player.stop()
        # start_session starts its new worker before its own clear_queue call.
        with self.assertRaises(queue.Empty):
            text.get_nowait()
        with self.assertRaises(queue.Empty):
            audio.get_nowait()
        text.put('new sentence')
        self.assertEqual(text.get_nowait(), 'new sentence')

    async def test_disconnect_releases_synthesis_lock_before_the_next_request(self):
        old = service.engine, service.ready, service.lock
        started = asyncio.Event()
        stopped = asyncio.Event()
        class Engine:
            async def tts_async(self, *args, **kwargs):
                started.set()
                await asyncio.Event().wait()
                yield b'\x00\x00'
            def stop(self):
                stopped.set()
        service.engine = Engine()
        service.ready = True
        service.lock = asyncio.Lock()
        incoming = asyncio.Queue()
        await incoming.put({'type':'http.request','body':json.dumps({'character_name':'mika','text':'test'}).encode(),'more_body':False})
        async def send(_message):
            pass
        scope = {'type':'http','asgi':{'version':'3.0'},'http_version':'1.1','method':'POST','scheme':'http','path':'/tts','raw_path':b'/tts','query_string':b'','headers':[(b'x-fpnf-session',service.TOKEN.encode())],'client':('127.0.0.1',12345),'server':('127.0.0.1',9882)}
        task = asyncio.create_task(service.app(scope,incoming.get,send))
        try:
            await asyncio.wait_for(started.wait(),1)
            await incoming.put({'type':'http.disconnect'})
            await asyncio.wait_for(stopped.wait(),1)
            await asyncio.wait_for(task,1)
            self.assertFalse(service.lock.locked())
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
            service.engine,service.ready,service.lock = old

    async def test_authorization_rejection_does_not_consume_the_request_body(self):
        receive = Mock(side_effect=AssertionError('Unauthorized request must not be read'))
        sent = []
        async def send(message):
            sent.append(message)
        scope={'type':'http','asgi':{'version':'3.0'},'http_version':'1.1','method':'POST','scheme':'http','path':'/tts','raw_path':b'/tts','query_string':b'','headers':[]}
        await service.app(scope,receive,send)
        self.assertEqual(sent[0]['status'],403)
        receive.assert_not_called()

if __name__ == '__main__':
    unittest.main()
