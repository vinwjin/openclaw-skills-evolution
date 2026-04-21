/**
 * Skill Generator Library
 *
 * Functions for parsing session JSONL files and analyzing conversations
 * to identify patterns worth documenting as skills.
 */

/**
 * Parse YAML frontmatter from markdown content.
 * @param {string} content - Full file content
 * @returns {{frontmatter: object, body: string}}
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const yamlStr = match[1];
  const body = match[2];
  const frontmatter = {};

  for (const line of yamlStr.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    if (key === 'metadata') {
      continue;
    }

    if (value === '' || value === null) {
      frontmatter[key] = null;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      frontmatter[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim());
    } else {
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

/**
 * Parse session JSONL content into an array of message objects.
 * @param {string} jsonlContent - Raw JSONL content
 * @returns {Array} Array of parsed message objects
 */
function parseSessionJsonl(jsonlContent) {
  if (!jsonlContent || typeof jsonlContent !== 'string') {
    return [];
  }

  const messages = [];
  const lines = jsonlContent.split('\n');
  let i = 0;

  function tryParse(str) {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { i++; continue; }

    // Try to parse current line
    let parsed = tryParse(trimmed);
    if (parsed) {
      messages.push(parsed);
      i++;
      continue;
    }

    // Multi-line JSON: keep merging until we get valid JSON or run out of lines
    let merged = trimmed;
    let j = i + 1;
    let found = false;
    while (j < lines.length) {
      merged += '\n' + lines[j];
      parsed = tryParse(merged);
      if (parsed) {
        messages.push(parsed);
        i = j + 1;
        found = true;
        break;
      }
      j++;
    }
    if (!found) {
      i++;
    }
  }

  return messages;
}

/**
 * Analyze conversation patterns from messages.
 * @param {Array} messages - Array of message objects from session
 * @returns {Array} Array of pattern objects worth documenting
 */
function analyzeConversationPatterns(messages) {
  const patterns = [];

  if (!messages || messages.length === 0) {
    return patterns;
  }

  // Track tool usage patterns
  const toolCallsByType = {};
  const errorRecoverySequences = [];
  const complexTasks = [];
  const userRememberRequests = [];

  let currentSequence = [];
  let lastWasError = false;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Look for tool calls
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const toolCall of msg.toolCalls) {
        const toolName = toolCall.name || toolCall.function?.name || 'unknown';
        const args = toolCall.arguments || toolCall.function?.arguments || {};

        // Track tool type usage
        if (!toolCallsByType[toolName]) {
          toolCallsByType[toolName] = [];
        }
        toolCallsByType[toolName].push({ msg, toolCall, index: i });

        // Track for complex task detection
        currentSequence.push({ toolName, msg, toolCall });

        // Check for error recovery patterns
        if (lastWasError) {
          errorRecoverySequences.push({
            errorTool: currentSequence[currentSequence.length - 2]?.toolName,
            recoveryTool: toolName,
            sequence: [...currentSequence]
          });
          lastWasError = false;
        }
      }
    }

    // Look for errors (in tool output or assistant content)
    if ((msg.role === 'tool' || msg.role === 'assistant') && msg.content) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      if (content.toLowerCase().includes('error') || content.toLowerCase().includes('failed')) {
        lastWasError = true;
      }
    }

    // Look for user "remember" requests
    if (msg.role === 'user' && msg.content) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      if (content.match(/remember|记住|以后这样做|save.*skill|沉淀/i)) {
        userRememberRequests.push({ msg, index: i, content });
      }

      // Reset sequence on new user message (new turn)
      // Check for 3+ unique tools in current sequence
      const uniqueToolNames = new Set(currentSequence.map(t => t.toolName));
      if (uniqueToolNames.size >= 3) {
        complexTasks.push([...currentSequence]);
      }
      currentSequence = [];
    }
  }

  // Check remaining sequence
  const remainingUniqueTools = new Set(currentSequence.map(t => t.toolName));
  if (remainingUniqueTools.size >= 3) {
    complexTasks.push([...currentSequence]);
  }

  // Pattern 1: Complex tasks (3+ different tool calls)
  for (const task of complexTasks) {
    const uniqueTools = [...new Set(task.map(t => t.toolName))];
    if (uniqueTools.length >= 3) {
      patterns.push({
        type: 'complex-task',
        toolCount: task.length,
        uniqueTools,
        sampleSequence: task.slice(0, 5),
        title: `Complex task using ${uniqueTools.length} tools`,
        description: `Task that successfully used ${uniqueTools.length} different tools: ${uniqueTools.slice(0, 5).join(', ')}`
      });
    }
  }

  // Pattern 2: Error recovery
  for (const recovery of errorRecoverySequences) {
    patterns.push({
      type: 'error-recovery',
      errorTool: recovery.errorTool,
      recoveryTool: recovery.recoveryTool,
      title: `Error recovery: ${recovery.errorTool} -> ${recovery.recoveryTool}`,
      description: `Successfully recovered from ${recovery.errorTool} failure by using ${recovery.recoveryTool}`
    });
  }

  // Pattern 3: User remember requests (highest priority)
  for (const req of userRememberRequests) {
    const content = req.content;
    // Extract key topic from context
    const topicMatch = content.match(/(?:when|if|how to|whenever).*?(?=remember|记住|$)/i);
    const topic = topicMatch ? topicMatch[0].slice(0, 100) : 'User-requested skill';

    patterns.push({
      type: 'user-requested',
      priority: 'high',
      topic,
      content: content.slice(0, 200),
      title: `User request: ${topic}`,
      description: content.slice(0, 150)
    });
  }

  // Deduplicate patterns by type+title
  const seen = new Set();
  return patterns.filter(p => {
    const key = `${p.type}:${p.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Generate SKILL.md formatted content from a pattern.
 * @param {object} pattern - Pattern object from analyzeConversationPatterns
 * @returns {string} SKILL.md formatted content
 */
function generateSkillMarkdown(pattern) {
  // Generate skill name from pattern
  const timestamp = new Date().toISOString().slice(0, 10);
  const safeName = pattern.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);

  const skillName = `auto-${safeName}-${timestamp}`;
  const description = pattern.description?.slice(0, 200) || pattern.title.slice(0, 200);

  // Determine tags based on pattern type
  let tags = [];
  switch (pattern.type) {
    case 'complex-task':
      tags = ['workflow', 'multi-step', 'productivity'];
      if (pattern.uniqueTools) {
        if (pattern.uniqueTools.includes('Bash')) tags.push('shell');
        if (pattern.uniqueTools.includes('Read') || pattern.uniqueTools.includes('Edit')) tags.push('file-ops');
      }
      break;
    case 'error-recovery':
      tags = ['error-handling', 'debugging', 'resilience'];
      if (pattern.recoveryTool) tags.push(pattern.recoveryTool.toLowerCase());
      break;
    case 'user-requested':
      tags = ['user-priority', 'best-practice'];
      break;
    default:
      tags = ['auto-generated'];
  }

  // Build SKILL.md content
  let content = `---
name: ${skillName}
description: ${description}
version: 0.1.0
metadata:
  hermes:
    tags: [${tags.join(', ')}]
    related_skills: []
---

# ${pattern.title}

## 什么情况下适用
`;

  // Add scenario description based on pattern type
  switch (pattern.type) {
    case 'complex-task':
      content += `当需要完成一个复杂任务，涉及多个工具调用和步骤时。\n`;
      content += `本 skill 记录了成功完成此类任务的最佳实践。\n`;
      break;
    case 'error-recovery':
      content += `当遇到 ${pattern.errorTool || '某工具'} 执行失败时。\n`;
      content += `本 skill 记录了从错误中恢复的有效方法。\n`;
      break;
    case 'user-requested':
      content += `根据用户在会话中明确提出的需求沉淀。\n`;
      break;
    default:
      content += `通用场景。\n`;
  }

  content += `\n## 怎么做\n`;

  switch (pattern.type) {
    case 'complex-task':
      content += `1. 分析任务，确定所需工具\n`;
      content += `2. 制定执行计划\n`;
      if (pattern.sampleSequence && pattern.sampleSequence.length > 0) {
        content += `3. 参考以下成功序列：\n`;
        for (const step of pattern.sampleSequence.slice(0, 5)) {
          content += `   - 使用 ${step.toolName}\n`;
        }
      }
      break;
    case 'error-recovery':
      content += `1. 识别错误类型\n`;
      content += `2. 分析错误原因\n`;
      content += `3. 使用 ${pattern.recoveryTool || '替代方案'} 进行恢复\n`;
      content += `4. 验证恢复结果\n`;
      break;
    case 'user-requested':
      content += `${pattern.content || '按照用户要求的方式执行。'}\n`;
      break;
    default:
      content += `按照标准流程执行。\n`;
  }

  content += `\n## 避坑提示\n`;

  switch (pattern.type) {
    case 'error-recovery':
      content += `遇到 ${pattern.errorTool || '类似错误'} 时，不要慌张。\n`;
      content += `尝试使用 ${pattern.recoveryTool || '替代方法'} 可以有效解决问题。\n`;
      break;
    case 'complex-task':
      content += `复杂任务建议分步执行，每步验证后再继续。\n`;
      break;
    default:
      content += `根据实际情况调整应用方式。\n`;
  }

  return content;
}

module.exports = {
  parseFrontmatter,
  parseSessionJsonl,
  analyzeConversationPatterns,
  generateSkillMarkdown,
};