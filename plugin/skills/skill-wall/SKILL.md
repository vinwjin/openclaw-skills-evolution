---
name: skill-wall
description: OpenClaw plugin that scans ~/.openclaw/workspace/skills/, matches tasks, and injects relevant skills into prompts for OpenClaw agent workflow automation
version: 0.1.0
author: Skill Wall
license: MIT
metadata:
  hermes:
    tags: [openclaw, plugin, skills, hermes, skill-injection]
    related_skills: []
---

# Skill Wall

Use this skill when the task involves the `skill-wall` OpenClaw plugin.

## Overview

Skill Wall replicates Hermes Agent's self-evolving skill system on OpenClaw:

1. **Scans** `~/.openclaw/workspace/skills/` for all `SKILL.md` files
2. **Matches** relevant skills to current task using weighted keyword matching
3. **Injects** matched skill content into the prompt context

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| enabled | boolean | true | Enable/disable skill injection |
| skillsDir | string | auto | Custom Hermes skills path |
| maxSkills | integer | 5 | Max skills to inject |
| matchThreshold | integer | 2 | Minimum match score |

## Architecture

```
OpenClaw Agent (Node.js)
    │
    ▼ before_prompt_build hook
~/.openclaw/extensions/skill-wall/
    │
    ▼ scan ~/.openclaw/workspace/skills/*.SKILL.md
    │
    ▼ match task → weighted keywords
    │
    ▼ inject into prompt context
```

## Key Files

- `openclaw.plugin.json` — Plugin metadata
- `handler.js` — Main entry point with hook handlers

## Testing

```bash
# Link plugin to OpenClaw extensions
ln -s /path/to/openclaw-skill-wall/plugin ~/.openclaw/extensions/skill-wall

# Verify plugin is recognized
# Start new OpenClaw session - plugin should load
```
