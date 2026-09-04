import type { SpeechAssetTierId } from '../../shared/speech-asset-ipc';

/** Fixed application-owned layout. No archive may choose another component's destination. */
export const SPEECH_ASSET_TARGETS = {
  'voice-runtime': 'voice-runtime',
  'speech-input': 'speech-input-runtime',
  'bert-japanese': 'bert-japanese',
  'voice-ireina': 'voice-ireina',
  'genie-tts': 'genie-tts',
  'genie-data': 'genie-data',
  'voice-genie-mika': 'voice-genie-mika',
} as const satisfies Record<SpeechAssetTierId, string>;
export type SpeechAssetTarget = (typeof SPEECH_ASSET_TARGETS)[SpeechAssetTierId];
export const REQUIRED_TARGET_FILES: Readonly<Record<SpeechAssetTarget, readonly string[]>> = {
  'voice-runtime': ['python/python.exe', 'ireina_tts_service.py'],
  'speech-input-runtime': ['models/sensevoice/model.int8.onnx', 'models/sensevoice/tokens.txt'],
  'bert-japanese': ['model_fp16.onnx', 'config.json', 'tokenizer.json'],
  'voice-ireina': ['ireina_e100_s16040.onnx', 'config.json', 'style_vectors.npy', 'LICENSE.txt'],
  'genie-tts': [
    'python/python.exe',
    'fpnf_genie_service.py',
    'python/Lib/site-packages/genie_tts/__init__.py',
    'LICENSE.txt',
  ],
  'genie-data': [
    'chinese-hubert-base/chinese-hubert-base.onnx',
    'chinese-hubert-base/chinese-hubert-base_weights_fp16.bin',
    'speaker_encoder.onnx',
    'LICENSE.txt',
  ],
  'voice-genie-mika': [
    'tts_models/t2s_encoder_fp32.onnx',
    'tts_models/t2s_encoder_fp32.bin',
    'tts_models/t2s_first_stage_decoder_fp32.onnx',
    'tts_models/t2s_stage_decoder_fp32.onnx',
    'tts_models/t2s_shared_fp16.bin',
    'tts_models/vits_fp32.onnx',
    'tts_models/vits_fp16.bin',
    'tts_models/prompt_encoder_fp32.onnx',
    'tts_models/prompt_encoder_fp16.bin',
    'prompt_wav.json',
    'prompt_wav/917575.wav',
    'LICENSE.txt',
  ],
};
