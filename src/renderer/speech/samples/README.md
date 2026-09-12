# 本地音色试听素材

下载前试听使用四个固定 WAV 文件：`voice-ireina.wav`、`voice-genie-mika.wav`、`voice-genie-feibi.wav`、`voice-genie-thirtyseven.wav`。它们由本机已有音色生成，播放无需启动引擎或下载模型。

用户于 2026-09-08 确认以非商业用途收尾后，这四段固定短音频纳入源码素材，使干净源码构建也能在下载前试听。没有素材的自定义构建仍可运行，对应试听按钮会显示不可用。音频不会触发引擎启动或下载。

V1.9 基础包包含的是上述四段短试听录音，随包说明位于 `resources/licenses/voice-previews/`，不包含音色权重、训练录音或黑猫模型。`IREINA-LICENSE.txt` 原文来自既有可选资源说明，保留原文供追溯；其中对可选模型包的描述不表示本基础包携带这些模型，也不构成新增的第三方授权。伊蕾娜原音色的公开上游固定来源尚未建立，本项目不能凭自身非商业声明补全第三方权利链，详见 [commit 审查](https://github.com/ph1gros/for-people-no-friend/blob/v1.9.0/docs/V1_9_COMMIT_REVIEW.md)。

伊蕾娜来自项目已有 Style-Bert-VITS2 音色，使用条件见同目录 IREINA-LICENSE.txt。Mika、菲比、37 来自 [High-Logic/Genie 的 v2ProPlus 示例音色](https://huggingface.co/High-Logic/Genie/tree/52b17272e0b7032415e85ad37b551db2386b1810/CharacterModels/v2ProPlus)，固定提交 52b17272e0b7032415e85ad37b551db2386b1810，来源声明见 GENIE-LICENSE.txt。本项目按非商业用途提供试听，角色与声音相关权利归原权利人；模型和引擎许可不额外授予角色权利。

本轮来源为 `.release/tts-benchmark-20260908-rerun/`：伊蕾娜 warm-2、Mika warm-5、菲比 warm-2、37 warm-1。文本见共享资源目录的 `sampleText`。本地 ASR 证据保存在该测量目录的 `preview-asr-results.json`；37 的 was 被识别为 is，尚未人工确认，不能声称发音与听感通过。
