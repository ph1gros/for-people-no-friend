# FPNF 资源目录样板

公开仓库已于 2026-09-04 创建：[ph1gros/fpnf-resources](https://github.com/ph1gros/fpnf-resources)。
这里保留本地目录样板；本轮已扩展四类七项资源，GitHub 上首次发布的两项目录尚未同步。
`catalog.json` 仅包含说明信息，不含模型、运行时、下载授权记录或私密资产。

应用 Main 的 `FPNF_RESOURCE_CATALOG_URL` 可指向经确认的 HTTPS 目录地址。
本地开发允许回环 HTTP。目录必须通过 `parseResourceCatalog` 的严格字段检查。
下载路由仍使用独立的 `FPNF_SPEECH_ASSET_MANIFEST_URL`，安装校验仍来自源码内的冻结记录。
Genie 引擎、基础模型、圣园未花（日语）三个档位已有本地实测记录；其他四项仍为 `null`。组件尚未上传或配置正式下载源，仅发布目录无法启用下载。

目录入口：`https://raw.githubusercontent.com/ph1gros/fpnf-resources/main/catalog.json`。
首次提交 `2125de35b9e4c6f2dae5ed496b6d50225a9bca26` 仅包含 README.md 与 catalog.json，已匿名读取并逐字节核对。
实际公开资源、许可、哈希和版本必须先确认，不能直接搬入本机音色或模型。
完整工作流与试用方法见 `docs/RESOURCE_CENTER.md`。
