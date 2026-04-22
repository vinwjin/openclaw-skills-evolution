/**
 * session-summarizer.js
 * 读取 session JSONL，生成简短的 session 摘要，供 before_prompt_build 注入
 *
 * v0.4: session_end 时调用，提取 session 主题和关键操作
 */

const fs = require('fs');

class SessionSummarizer {
  /**
   * 读取 session JSONL，生成摘要
   * @param {string} sessionFile - session JSONL 文件路径
   * @returns {object} { topic, tools, keyFindings, skillPrompts }
   */
  async summarize(sessionFile) {
    if (!sessionFile || !fs.existsSync(sessionFile)) {
      return null;
    }

    const lines = (await fs.promises.readFile(sessionFile, 'utf-8'))
      .split('\n')
      .filter(l => l.trim());

    const entries = lines
      .map(l => {
        try { return JSON.parse(l); }
        catch { return null; }
      })
      .filter(Boolean);

    if (entries.length === 0) return null;

    const messages = entries
      .filter(entry => entry.type === 'message' && entry.message)
      .map(entry => entry.message);

    const userMessages = messages.filter(message => message.role === 'user');
    const assistantMessages = messages.filter(message => message.role === 'assistant');
    const toolCalls = assistantMessages.flatMap(message =>
      this.getContentBlocks(message).filter(block => block.type === 'toolCall')
    );

    // 提取主题（第一个用户消息的前80字符）
    const topic = this.extractTopic(userMessages);

    // 提取用到的工具
    const tools = this.extractTools(toolCalls);

    // 提取关键发现/操作
    const keyFindings = this.extractFindings(assistantMessages, toolCalls);

    return { topic, tools, keyFindings, skillPrompts: [] };
  }

  extractTopic(userMessages) {
    if (!userMessages || userMessages.length === 0) return 'Unknown';
    const first = userMessages[0];
    const text = this.extractText(first);
    return text.slice(0, 80).replace(/\n/g, ' ').trim() || 'Unknown';
  }

  extractTools(toolCalls) {
    const tools = new Set();
    for (const tc of toolCalls) {
      const name = tc.name || tc.toolName || tc.tool?.name || '';
      if (name) tools.add(name);
      // 也检查 nested tool calls
      if (tc.toolCalls) {
        for (const nested of tc.toolCalls) {
          const n = nested.name || nested.toolName || '';
          if (n) tools.add(n);
        }
      }
    }
    return Array.from(tools);
  }

  extractFindings(assistantMessages, toolCalls) {
    const findings = [];
    for (const msg of assistantMessages) {
      const text = this.extractText(msg);
      // 提取代码块中的重要内容
      const codeBlocks = text.match(/```[\s\S]*?```/g) || [];
      for (const block of codeBlocks.slice(0, 2)) {
        const firstLine = block.split('\n')[1] || '';
        if (firstLine.length > 0 && firstLine.length < 100) {
          findings.push(firstLine.trim());
        }
      }
    }
    return findings.slice(0, 5);
  }

  getContentBlocks(message) {
    return Array.isArray(message?.content) ? message.content : [];
  }

  extractText(message) {
    return this.getContentBlocks(message)
      .filter(block => block && block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('\n')
      .trim();
  }
}

module.exports = { SessionSummarizer };
