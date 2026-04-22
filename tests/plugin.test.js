/**
 * Skills Evolution Plugin — Test Suite
 * Run: node tests/plugin.test.js
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

import { SkillIndex } from '../lib/skill-index.js';
import { SkillLoader } from '../lib/skill-loader.js';
import { SkillSaver } from '../lib/skill-saver.js';
import { SessionSummarizer } from '../lib/session-summarizer.js';
const plugin = require('../index.js');

// ============================================================================
// Helpers
// ============================================================================

let suitePassed = 0, suiteFailed = 0;
function pass(name) { suitePassed++; console.log(`  PASS ${name}`); }
function fail(name, reason) { suiteFailed++; console.log(`  FAIL ${name}: ${reason}`); }
function assertEq(actual, expected, msg) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${msg} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function assertTrue(v, msg) {
  if (!v) throw new Error(`${msg} — got falsy`);
}
function makeSkillDir(suffix) {
  const dir = `/tmp/se-test-${suffix}-${process.pid}`;
  fs.mkdirSync(path.join(dir, 'skills', 't'), { recursive: true });
  return dir;
}
function rmrf(dir) {
  try { fs.rmSync(dir, { recursive: true }); } catch (e) {}
}
function writeSkill(dir, content) {
  fs.writeFileSync(path.join(dir, 'skills', 't', 'SKILL.md'), content);
}
async function loadFrom(dir) {
  const loader = new SkillLoader();
  // dir = /tmp/se-test-xxx-{pid}, loadAll appends /skills
  const skills = await loader.loadAll(dir);
  return skills[0];
}

// ============================================================================
// SkillIndex
// ============================================================================

console.log('\n[SkillIndex]');
{
  const idx = new SkillIndex();

  // Bug: content field was stored but NOT searched
  idx.add({ name: 'A', description: '', triggers: [], actions: [], content: 'deploy database backup' });
  {
    const r = idx.search('database');
    if (r.length > 0 && r[0].name === 'A') pass('search finds content field');
    else fail('search finds content field', `expected match for A, got ${JSON.stringify(r)}`);
  }

  // Multiple terms
  const idx2 = new SkillIndex();
  idx2.add({ name: 'B', description: 'git workflow', triggers: [], actions: [], content: '' });
  {
    const r = idx2.search('git');
    if (r.length > 0) pass('search scores by match count');
    else fail('search scores by match count', 'no results for git');
  }

  {
    const r = idx.search('');
    if (r.length === 0) pass('empty query returns empty');
    else fail('empty query returns empty', `got ${JSON.stringify(r)}`);
  }
}

// ============================================================================
// SkillLoader parseFrontmatter
// ============================================================================

console.log('\n[SkillLoader parseFrontmatter]');
{
  // Bug: sub-items like "  - subitem" were incorrectly captured as triggers,
  // preventing "item2" at the same level as "item1" from being found.
  const dir1 = makeSkillDir('l1');
  writeSkill(dir1, '---\nname: t\ntriggers:\n  - item1\n    - subitem\n  - item2\n---\n');
  {
    const skill = await loadFrom(dir1);
    const triggers = skill?.frontmatter?.triggers;
    if (triggers && JSON.stringify(triggers) === JSON.stringify(['item1', 'item2']))
      pass('nested sub-items excluded — item2 found after sub-item');
    else
      fail('nested sub-items excluded — item2 found after sub-item',
        `got ${JSON.stringify(triggers)}, want ["item1","item2"]`);
  }
  rmrf(dir1);

  // Multiple deeply-nested sub-sub-items
  const dir2 = makeSkillDir('l2');
  writeSkill(dir2, '---\nname: t\ntriggers:\n  - a\n    - b\n      - c\n  - d\n---\n');
  {
    const skill = await loadFrom(dir2);
    const triggers = skill?.frontmatter?.triggers;
    if (triggers && JSON.stringify(triggers) === JSON.stringify(['a', 'd']))
      pass('deeply nested sub-sub-items skipped');
    else
      fail('deeply nested sub-sub-items skipped',
        `got ${JSON.stringify(triggers)}, want ["a","d"]`);
  }
  rmrf(dir2);

  // Multiple sub-items before next top-level
  const dir3 = makeSkillDir('l3');
  writeSkill(dir3, '---\nname: t\ntriggers:\n  - a\n    - b\n    - c\n  - d\n---\n');
  {
    const skill = await loadFrom(dir3);
    const triggers = skill?.frontmatter?.triggers;
    if (triggers && JSON.stringify(triggers) === JSON.stringify(['a', 'd']))
      pass('multiple sub-items all skipped');
    else
      fail('multiple sub-items all skipped',
        `got ${JSON.stringify(triggers)}, want ["a","d"]`);
  }
  rmrf(dir3);

  // Normal indented list (no nesting)
  const dir4 = makeSkillDir('l4');
  writeSkill(dir4, '---\nname: t\ntriggers:\n  - trigger1\n  - trigger2\n---\n');
  {
    const skill = await loadFrom(dir4);
    const triggers = skill?.frontmatter?.triggers;
    if (triggers && JSON.stringify(triggers) === JSON.stringify(['trigger1', 'trigger2']))
      pass('normal indented list works');
    else
      fail('normal indented list works',
        `got ${JSON.stringify(triggers)}, want ["trigger1","trigger2"]`);
  }
  rmrf(dir4);

  // Inline list
  const dir5 = makeSkillDir('l5');
  writeSkill(dir5, '---\nname: t\ntriggers: [a, b]\n---\n');
  {
    const skill = await loadFrom(dir5);
    const triggers = skill?.frontmatter?.triggers;
    if (triggers && JSON.stringify(triggers) === JSON.stringify(['a', 'b']))
      pass('inline list works');
    else
      fail('inline list works',
        `got ${JSON.stringify(triggers)}, want ["a","b"]`);
  }
  rmrf(dir5);

  // Scalar value (no list)
  const dir6 = makeSkillDir('l6');
  writeSkill(dir6, '---\nname: t\ntriggers: single\n---\n');
  {
    const skill = await loadFrom(dir6);
    const triggers = skill?.frontmatter?.triggers;
    if (triggers && JSON.stringify(triggers) === JSON.stringify(['single']))
      pass('scalar value works');
    else
      fail('scalar value works',
        `got ${JSON.stringify(triggers)}, want ["single"]`);
  }
  rmrf(dir6);

  // Empty triggers
  const dir7 = makeSkillDir('l7');
  writeSkill(dir7, '---\nname: t\ntriggers:\n---\n');
  {
    const skill = await loadFrom(dir7);
    const triggers = skill?.frontmatter?.triggers;
    if (Array.isArray(triggers) && triggers.length === 0)
      pass('empty triggers list works');
    else
      fail('empty triggers list works',
        `got ${JSON.stringify(triggers)}`);
  }
  rmrf(dir7);
}

// ============================================================================
// SkillSaver
// ============================================================================

console.log('\n[SkillSaver]');
{
  const saver = new SkillSaver();

  {
    try { saver.validate('---\nname: test\ndescription: ok\n---\n'); pass('valid frontmatter passes'); }
    catch (e) { fail('valid frontmatter passes', e.message); }
  }
  {
    let threw = false;
    try { saver.validate('no frontmatter'); } catch (e) { threw = true; }
    if (threw) pass('missing frontmatter throws'); else fail('missing frontmatter throws', 'no error thrown');
  }
  {
    let threw = false;
    try { saver.validate('---\nname: test\nno close'); } catch (e) { threw = true; }
    if (threw) pass('unclosed frontmatter throws'); else fail('unclosed frontmatter throws', 'no error thrown');
  }
  {
    let threw = false;
    try { saver.validate('---\ndesc: test\n---\n'); } catch (e) { threw = true; }
    if (threw) pass('missing name field throws'); else fail('missing name field throws', 'no error thrown');
  }
  {
    const dir = makeSkillDir('s1');
    const result = await saver.save(dir, {
      name: 'test-save',
      content: '---\nname: test-save\ndescription: saved\n---\nsaved content\n'
    });
    const exists = fs.existsSync(result.filePath);
    rmrf(dir);
    if (exists) pass('save creates skill directory and file');
    else fail('save creates skill directory and file', `file not found: ${result.filePath}`);
  }
}

// ============================================================================
// skill_manage create
// ============================================================================

console.log('\n[skill_manage create]');
{
  const registeredTools = new Map();
  plugin.register({
    on() {},
    registerTool(tool) {
      registeredTools.set(tool.name, tool);
    }
  });

  const skillManage = registeredTools.get('skill_manage');
  const tmpHome = `/tmp/se-home-${process.pid}`;
  const workspace = path.join(tmpHome, '.openclaw', 'workspace');
  const skillPath = path.join(workspace, 'skills', 'release-checklist', 'SKILL.md');
  const previousHome = process.env.HOME;

  rmrf(tmpHome);
  fs.mkdirSync(workspace, { recursive: true });
  process.env.HOME = tmpHome;

  try {
    const result = await skillManage.execute('tc-1', {
      action: 'create',
      name: 'Release Checklist',
      content: '## Steps\n\nShip it.\n',
      description: 'Reusable release workflow',
      triggers: ['release day', 'deploy prep'],
      actions: ['review checklist']
    });

    const created = fs.existsSync(skillPath) ? fs.readFileSync(skillPath, 'utf-8') : '';

    if (result?.isError) {
      fail('create builds frontmatter from body + metadata', result.content?.[0]?.text || 'tool returned error');
    } else if (!created.startsWith('---\nname: "Release Checklist"\ndescription: "Reusable release workflow"\ntriggers:\n  - "release day"\n  - "deploy prep"\nactions:\n  - "review checklist"\n---\n## Steps\n\nShip it.\n')) {
      fail('create builds frontmatter from body + metadata', `unexpected file content: ${JSON.stringify(created)}`);
    } else {
      pass('create builds frontmatter from body + metadata');
    }
  } catch (e) {
    fail('create builds frontmatter from body + metadata', e.message);
  } finally {
    process.env.HOME = previousHome;
    rmrf(tmpHome);
  }
}

// ============================================================================
// SessionSummarizer
// ============================================================================

console.log('\n[SessionSummarizer]');
{
  const summarizer = new SessionSummarizer();
  const tmpFile = `/tmp/se-session-${process.pid}.jsonl`;

  // Write file for all session summarizer tests
  fs.writeFileSync(tmpFile, JSON.stringify({
    type: 'message',
    message: { role: 'user', content: [{ type: 'text', text: 'Hello world test' }] }
  }) + '\n');

  {
    const result = await summarizer.summarize(tmpFile);
    if (result && result.topic && result.topic.includes('Hello'))
      pass('summarizes topic from first user message');
    else
      fail('summarizes topic from first user message',
        `got topic: ${result?.topic}`);
  }
  fs.unlinkSync(tmpFile);

  // Tool extraction
  const tmpFile2 = `/tmp/se-session2-${process.pid}.jsonl`;
  fs.writeFileSync(tmpFile2, JSON.stringify({
    type: 'message',
    message: { role: 'assistant', content: [{ type: 'toolCall', name: 'terminal' }] }
  }) + '\n');
  {
    const result = await summarizer.summarize(tmpFile2);
    if (result && result.tools.includes('terminal'))
      pass('extracts tool names from tool calls');
    else
      fail('extracts tool names from tool calls',
        `got tools: ${JSON.stringify(result?.tools)}`);
  }
  fs.unlinkSync(tmpFile2);

  // Non-existent file
  {
    const result = await summarizer.summarize('/nonexistent/file.jsonl');
    if (result === null) pass('returns null for non-existent file');
    else fail('returns null for non-existent file', `got ${JSON.stringify(result)}`);
  }

  // Empty content
  const tmpFile3 = `/tmp/se-session3-${process.pid}.jsonl`;
  fs.writeFileSync(tmpFile3, JSON.stringify({
    type: 'message', message: { role: 'user', content: [] }
  }) + '\n');
  {
    const result = await summarizer.summarize(tmpFile3);
    if (result && result.topic === 'Unknown')
      pass('handles missing content gracefully');
    else
      fail('handles missing content gracefully',
        `got topic: ${result?.topic}`);
  }
  fs.unlinkSync(tmpFile3);
}

// ============================================================================
// Plugin
// ============================================================================

console.log('\n[Plugin]');
{
  const plugin = (await import('../index.js')).default;
  if (plugin.id === 'skills-evolution' && typeof plugin.register === 'function')
    pass('plugin exports correct structure');
  else
    fail('plugin exports correct structure', `id=${plugin.id}, register=${typeof plugin.register}`);
}

// ============================================================================
// Summary
// ============================================================================
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${suitePassed} passed, ${suiteFailed} failed`);
if (suiteFailed > 0) process.exit(1);
console.log('All tests passed!');
