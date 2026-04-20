/**
 * Session End Hook Test Script
 *
 * Tests the session_end hook functionality by:
 * 1. Mocking session JSONL data
 * 2. Testing parseSessionJsonl function
 * 3. Testing analyzeConversationPatterns function
 * 4. Testing generateSkillMarkdown function
 * 5. Verifying the complete workflow
 */

const path = require('path');

// Import the functions from handler.js (which now includes skill-generator)
const plugin = require('../handler.js');
const { parseSessionJsonl, analyzeConversationPatterns, generateSkillMarkdown } = plugin;

// Test data: simulated session JSONL content
const mockSessionJsonl = `{"role":"user","content":"我需要实现一个功能，把字符串反转"}
{"role":"assistant","content":"好的，我来帮你实现这个功能。","toolCalls":[{"name":"Write","arguments":{"file_path":"/tmp/reverse.js","content":"function reverse(s) { return s.split('').reverse().join(''); }"}}]}
{"role":"tool","content":"File written successfully"}
{"role":"assistant","content":"文件已创建。让我运行测试验证。","toolCalls":[{"name":"Bash","arguments":{"command":"node /tmp/reverse.js"}}]}
{"role":"tool","content":"Error: Cannot find module"}
{\"role\":\"assistant\",\"content\":\"出错了，让我用不同的方式运行。\",\"toolCalls\":[{\"name\":\"Bash\",\"arguments\":{\"command\":\"node -e \\\\\"console.log('test'.split('').reverse().join(''))\\\\\"\"}}]}
{"role":"tool","content":"tset"}
{"role":"assistant","content":"成功了！字符串反转正常工作。"}
{"role":"user","content":"记住以后用 -e 参数运行单行 node 代码"}
{"role":"assistant","content":"好的，我记住了！"}
{"role":"user","content":"现在帮我实现一个计算器功能"}
{"role":"assistant","content":"好的，我来创建计算器。","toolCalls":[{"name":"Write","arguments":{"file_path":"/tmp/calc.js","content":"const calc = (a, op, b) => { switch(op) { case '+': return a+b; case '-': return a-b; case '*': return a*b; case '/': return a/b; } };"}},{"name":"Bash","arguments":{"command":"node -e \"const c = require('/tmp/calc.js'); console.log(c.calc(5, '+', 3))\""}},{"name":"Read","arguments":{"file_path":"/tmp/calc.js"}},{"name":"Edit","arguments":{"file_path":"/tmp/calc.js","old_string":"const calc","new_string":"function calc"}}]}
{"role":"tool","content":"File written successfully"}
{"role":"tool","content":"8"}
{"role":"tool","content":"File content verified"}
{"role":"assistant","content":"计算器完成！4个工具调用成功完成复杂任务。"}`;

// Test results collector
const results = [];

function logTest(name, passed, details = '') {
  const status = passed ? 'PASS' : 'FAIL';
  const line = `[${status}] ${name}${details ? ': ' + details : ''}`;
  results.push({ name, passed, details, line });
  console.log(line);
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('Session End Hook - Test Suite');
  console.log('='.repeat(60));
  console.log();

  // Test 1: parseSessionJsonl with valid JSONL
  console.log('--- parseSessionJsonl Tests ---');
  const messages = parseSessionJsonl(mockSessionJsonl);
  logTest(
    'parseSessionJsonl parses JSONL correctly',
    messages.length === 16,
    `parsed ${messages.length} messages (expected 16)`
  );

  // Test 2: parseSessionJsonl handles empty content
  const emptyMessages = parseSessionJsonl('');
  logTest(
    'parseSessionJsonl handles empty string',
    emptyMessages.length === 0,
    `got ${emptyMessages.length} messages`
  );

  // Test 3: parseSessionJsonl handles null/undefined
  const nullMessages = parseSessionJsonl(null);
  logTest(
    'parseSessionJsonl handles null',
    nullMessages.length === 0
  );

  // Test 4: parseSessionJsonl skips malformed lines
  const malformedJsonl = '{"valid": true}\nnot json\n{"also": "valid"}';
  const partialMessages = parseSessionJsonl(malformedJsonl);
  logTest(
    'parseSessionJsonl skips malformed lines',
    partialMessages.length === 2,
    `parsed ${partialMessages.length} valid messages`
  );

  console.log();
  console.log('--- analyzeConversationPatterns Tests ---');

  // Test 5: Detects complex tasks (3+ different tools)
  const complexPatterns = analyzeConversationPatterns(messages);
  const hasComplexTask = complexPatterns.some(p => p.type === 'complex-task');
  logTest(
    'Detects complex task (3+ tool calls)',
    hasComplexTask
  );

  // Test 6: Detects error recovery patterns
  const errorRecoveryPatterns = complexPatterns.filter(p => p.type === 'error-recovery');
  logTest(
    'Detects error recovery pattern',
    errorRecoveryPatterns.length > 0,
    `found ${errorRecoveryPatterns.length} recovery pattern(s)`
  );

  // Test 7: Detects user "remember" requests
  const userRememberPatterns = complexPatterns.filter(p => p.type === 'user-requested');
  logTest(
    'Detects user remember request',
    userRememberPatterns.length > 0,
    `found ${userRememberPatterns.length} user request(s)`
  );

  // Test 8: Unique tools detection
  const complexPattern = complexPatterns.find(p => p.type === 'complex-task');
  if (complexPattern) {
    const hasMultipleTools = complexPattern.uniqueTools && complexPattern.uniqueTools.length >= 3;
    logTest(
      'Complex task has 3+ unique tools',
      hasMultipleTools,
      `found ${complexPattern.uniqueTools?.length || 0} unique tools`
    );
  }

  console.log();
  console.log('--- generateSkillMarkdown Tests ---');

  // Test 9: Generates valid SKILL.md with frontmatter
  if (complexPatterns.length > 0) {
    const skillMarkdown = generateSkillMarkdown(complexPatterns[0]);
    const hasFrontmatter = skillMarkdown.includes('---');
    logTest(
      'Generates SKILL.md with frontmatter',
      hasFrontmatter
    );

    // Test 10: Has required frontmatter fields
    const hasName = skillMarkdown.includes('name:');
    const hasDescription = skillMarkdown.includes('description:');
    const hasVersion = skillMarkdown.includes('version:');
    const hasTags = skillMarkdown.includes('tags:');
    logTest(
      'Has required frontmatter fields (name, description, version, tags)',
      hasName && hasDescription && hasVersion && hasTags
    );

    // Test 11: Has content sections
    const hasSections = skillMarkdown.includes('## 什么情况下适用') &&
                        skillMarkdown.includes('## 怎么做');
    logTest(
      'Has content sections',
      hasSections
    );

    // Test 12: Description length limit (200 chars)
    const descMatch = skillMarkdown.match(/description:\s*(.+)/);
    if (descMatch) {
      const descLine = descMatch[1].split('\n')[0];
      const descTooLong = descLine.length > 200;
      logTest(
        'Description under 200 characters',
        !descTooLong,
        `length: ${descLine.length}`
      );
    }
  }

  console.log();
  console.log('--- Integration Test: Full Workflow ---');

  // Test 13: Full workflow from JSONL to skill markdown
  const fullWorkflowPatterns = analyzeConversationPatterns(parseSessionJsonl(mockSessionJsonl));
  if (fullWorkflowPatterns.length > 0) {
    const generatedSkill = generateSkillMarkdown(fullWorkflowPatterns[0]);
    const workflowWorks = generatedSkill.includes('---') && generatedSkill.includes('# ');
    logTest(
      'Full workflow: JSONL -> patterns -> SKILL.md',
      workflowWorks
    );
  }

  console.log();
  console.log('='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log();

  if (failed > 0) {
    console.log('Failed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.details}`);
    });
  }

  // Write results to output file
  const fs = require('fs');
  const outputPath = path.join(__dirname, 'session-end-test-output.txt');
  const outputContent = [
    'Session End Hook - Test Output',
    '='.repeat(60),
    `Date: ${new Date().toISOString()}`,
    '',
    ...results.map(r => r.line),
    '',
    `Summary: ${passed}/${results.length} tests passed`,
    failed > 0 ? `FAILED: ${failed} test(s)` : 'ALL TESTS PASSED'
  ].join('\n');

  fs.writeFileSync(outputPath, outputContent, 'utf-8');
  console.log(`Results written to: ${outputPath}`);

  // Return exit code based on test results
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});