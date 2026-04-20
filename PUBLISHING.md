# 发布指南

---

## 一、_meta.json 格式

```json
{
  "owner": "your-github-username",
  "slug": "skill-wall",
  "displayName": "Skill Wall",
  "latest": {
    "version": "0.1.0",
    "publishedAt": 1745200000000,
    "commit": "https://github.com/you/repo/commit/xxx"
  }
}
```

**必填字段**:
- `owner` — GitHub 用户名
- `slug` — 唯一标识符
- `latest.version` — 语义化版本
- `latest.publishedAt` — 发布时间戳（毫秒）
- `latest.commit` — GitHub commit URL

---

## 二、安全审查清单

详见 [SECURITY.md](SECURITY.md)

- [ ] API keys / tokens / passwords 不硬编码
- [ ] 用户凭证脱敏
- [ ] 无恶意代码
- [ ] 路径遍历防护
- [ ] 内容大小限制

---

## 三、发布检查清单

- [ ] `_meta.json` 填写完整（owner, slug, version）
- [ ] `SECURITY.md` 已编写
- [ ] GitHub 仓库已创建并公开
- [ ] 许可证文件存在（MIT）
- [ ] `latest.commit` 指向正确的 commit

---

## 四、版本管理

语义化版本 (SemVer):
- **MAJOR** — 不兼容的 API 变更
- **MINOR** — 向后兼容的功能添加
- **PATCH** — 向后兼容的问题修复

---

## 五、安装方式

```bash
# 链接到 OpenClaw extensions 目录
ln -s /path/to/openclaw-skill-wall/plugin ~/.openclaw/extensions/skill-wall
```
