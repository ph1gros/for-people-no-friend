For People No Friend V1.6 bundled voice runtime

This directory is staged into the Windows release as resources/voice-runtime.
It contains a local-only Style-Bert-VITS2 ONNX service. The application starts it
with fixed arguments on 127.0.0.1:9881; Renderer input cannot select an executable,
host, port or command-line argument.

The public release must include Style-Bert-VITS2's AGPL-3.0 and LGPL-3.0 notices
and a voice authorization note. API keys, conversation history, memory, raw training
recordings and local absolute paths must never be staged here.
