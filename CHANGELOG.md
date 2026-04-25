# Changelog

## 0.6.3 - 2026-04-25

### Added
- 新增 `preferOpenClawAuthModel` 与 `api` 配置项，允许 compaction provider 优先使用 OpenClaw 当前会话的鉴权、provider 与模型配置。
- 新增针对 OpenClaw host 鉴权桥接与 API 传输适配的测试覆盖。
- 新增 `CHANGELOG.md`，并将其加入 npm 打包清单。

### Changed
- compaction provider 在注册时传入 OpenClaw runtime 与 host config，优先解析默认模型、provider 与 `runtime.modelAuth.resolveApiKeyForProvider(...)`。
- 子进程摘要器支持 `openai-completions` 与 `anthropic-messages` 两种传输方式，自动切换 endpoint、headers 与 body。
- README 同步补充 0.6.3 发布说明、最新 compaction 配置示例与版本记录。
- 新增中英双语 GitHub Releases 页面文案：`docs/releases/v0.6.3.md`。

### Verified
- `node tests/plugin.test.js`
- `npm pack --dry-run`

## 0.6.2
- 修复 compaction provider 接入与安装流程中的兼容性问题。

## 0.6.1
- 发布 OpenClaw 插件清单，补齐 compaction 相关入口。

## 0.6.0
- 新增上下文自动压缩与 compaction hooks。

## 0.5.0
- 加固 Prompt 注入、符号链接覆盖、敏感信息泄露与 DoS 风险。

## 0.4.0
- 增加任务中主动沉淀与 session 自动审视双轨机制。

## 0.3.0
- 提供基础 Skills CRUD 与搜索能力。
