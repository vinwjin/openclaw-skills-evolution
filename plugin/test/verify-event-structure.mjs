/**
 * OpenClaw before_prompt_build Event Structure Verification Script
 *
 * This script directly tests extractTaskFromEvent with mock events
 * to understand which fields are identified as task descriptions.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Load skill-wall plugin handler (CommonJS)
// ---------------------------------------------------------------------------
const handler = require('../handler.js');
const extractTaskFromEvent = handler.extractTaskFromEvent;

// ---------------------------------------------------------------------------
// Mock Event Builders
// ---------------------------------------------------------------------------

/**
 * Creates a typical before_prompt_build event with various field combinations
 */
function createTypicalEvent() {
  return {
    id: 'evt_abc123xyz',
    type: 'before_prompt_build',
    timestamp: Date.now(),
    context: {
      task: 'Write a Python script that parses JSON files and outputs statistics',
      userId: 'user_12345',
      sessionId: 'sess_def456',
      mode: 'assistant',
      systemPrompt: 'You are a helpful AI assistant.',
      prependContext: 'Previous conversation context...',
      bootstrapFiles: [
        { type: 'text/markdown', content: '# Default bootstrap' }
      ]
    },
    systemPrompt: 'You are a helpful AI assistant.',
    prependContext: 'The user wants to analyze their data.',
    bootstrapFiles: [],
    skills: []
  };
}

/**
 * Creates a comprehensive mock event with ALL possible field combinations
 * Based on OpenClaw hook-runner-global and pi-embedded-runner analysis
 */
function createComprehensiveEvent() {
  return {
    // Core event identity
    id: 'evt_comprehensive_test_001',
    type: 'before_prompt_build',
    timestamp: Date.now(),

    // Session context
    context: {
      // Task description - this is what we want to extract
      task: 'Create a web scraper using Python and BeautifulSoup to extract product prices from e-commerce sites',

      // User info
      userId: 'user_998877',
      username: 'developer_jane',

      // Session info
      sessionId: 'sess_123456789',
      sessionKey: 'session:user_998877:abcd1234',

      // Mode and configuration
      mode: 'assistant',
      status: 'active',

      // System components
      systemPrompt: 'You are Claude Code, an AI programming assistant.',
      prependContext: 'The user is working on a data analysis project.',
      appendContext: null,

      // Bootstrap files
      bootstrapFiles: [],

      // Skills array
      skills: [],

      // Messages
      messages: [],

      // Custom data
      customData: {},

      // Metadata
      metadata: {
        createdAt: new Date().toISOString(),
        version: '1.0'
      }
    },

    // Top-level fields (from various OpenClaw sources)
    systemPrompt: 'You are Claude Code, an AI programming assistant.',
    prependContext: 'Current project: web scraping toolkit.',
    appendContext: null,
    bootstrapFiles: [],
    skills: [],

    // Additional fields seen in OpenClaw events
    prompt: null,
    response: null,
    error: null,

    // Direct task field (alternative to context.task)
    content: null,

    // Input variations
    input: 'Build an image resize function in JavaScript',

    // Description variations
    description: 'I need to create a REST API endpoint for user authentication using JWT tokens',

    // Message content variations
    messageContent: 'Help me write a bash script that processes log files and generates reports',

    // Query variations
    query: 'How do I configure nginx as a reverse proxy with SSL termination?',

    // Instruction variations
    instruction: 'Refactor the database connection pool to support connection multiplexing',

    // Raw message that might contain task
    message: {
      role: 'user',
      content: 'Please generate unit tests for the payment processing module'
    }
  };
}

/**
 * Creates minimal event with only essential fields
 */
function createMinimalEvent() {
  return {
    id: 'evt_minimal',
    type: 'before_prompt_build',
    context: {
      task: 'Fix the authentication bug in the login flow'
    }
  };
}

/**
 * Creates event with nested objects containing task-like strings
 */
function createNestedEvent() {
  return {
    id: 'evt_nested',
    type: 'before_prompt_build',
    context: {
      session: {
        id: 'sess_abc',
        user: {
          id: 'user_123',
          profile: {
            task: 'Implement rate limiting middleware for the Express API',
            priority: 'high'
          }
        }
      },
      path: '/home/user/project/src/api.js'
    }
  };
}

/**
 * Creates event with code-like strings mixed with natural language
 */
function createMixedContentEvent() {
  return {
    id: 'evt_mixed',
    type: 'before_prompt_build',
    context: {
      task: 'Refactor the user authentication module to support OAuth2 and JWT refresh tokens',
      path: '/home/user/project/src/auth/index.js',
      env: {
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost:5432/app'
      },
      systemPrompt: 'You are a code review assistant.'
    },
    prependContext: 'Technical debt: the legacy auth system needs modernization with secure token handling'
  };
}

// ---------------------------------------------------------------------------
// Analysis Functions
// ---------------------------------------------------------------------------

function analyzeEvent(event, label) {
  console.log('\n' + '='.repeat(80));
  console.log(`ANALYSIS: ${label}`);
  console.log('='.repeat(80));

  // Print event structure
  console.log('\n--- Event Keys ---');
  console.log(Object.keys(event).join(', '));

  if (event.context) {
    console.log('\n--- Context Keys ---');
    console.log(Object.keys(event.context).join(', '));
  }

  // Extract task
  console.log('\n--- extractTaskFromEvent Result ---');
  const extractedTask = extractTaskFromEvent(event);

  if (extractedTask) {
    console.log(`SUCCESS: Extracted task (${extractedTask.length} chars):`);
    console.log(`  "${extractedTask}"`);
  } else {
    console.log('FAILURE: No task description found');
  }

  // Show all string fields for comparison
  console.log('\n--- All String Fields in Event ---');
  const allStrings = [];

  function collectStrings(obj, prefix = '') {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (typeof val === 'string' && val.trim().length > 0) {
        allStrings.push({ path: prefix + key, value: val, length: val.length });
      } else if (typeof val === 'object' && val !== null) {
        collectStrings(val, prefix + key + '.');
      }
    }
  }

  collectStrings(event);
  allStrings.sort((a, b) => b.length - a.length);

  for (const { path, value, length } of allStrings) {
    const preview = value.length > 60 ? value.slice(0, 60) + '...' : value;
    const isExtracted = value === extractedTask ? ' [EXTRACTED]' : '';
    console.log(`  ${path} (${length}): "${preview}"${isExtracted}`);
  }

  return extractedTask;
}

// ---------------------------------------------------------------------------
// Main Execution
// ---------------------------------------------------------------------------

console.log('\n' + '#'.repeat(80));
console.log('# OpenClaw before_prompt_build Event Structure Verification');
console.log('#'.repeat(80));
console.log(`\nGenerated at: ${new Date().toISOString()}`);

// Run all analyses
const results = {};

results.typical = analyzeEvent(createTypicalEvent(), 'Typical Event');
results.comprehensive = analyzeEvent(createComprehensiveEvent(), 'Comprehensive Event (All Fields)');
results.minimal = analyzeEvent(createMinimalEvent(), 'Minimal Event');
results.nested = analyzeEvent(createNestedEvent(), 'Nested Event');
results.mixed = analyzeEvent(createMixedContentEvent(), 'Mixed Content Event');

// Summary
console.log('\n' + '#'.repeat(80));
console.log('# SUMMARY: Task Extraction Results');
console.log('#'.repeat(80));

const testCases = [
  { name: 'Typical Event', result: results.typical },
  { name: 'Comprehensive Event', result: results.comprehensive },
  { name: 'Minimal Event', result: results.minimal },
  { name: 'Nested Event', result: results.nested },
  { name: 'Mixed Content Event', result: results.mixed }
];

for (const { name, result } of testCases) {
  const status = result ? '✓ EXTRACTED' : '✗ FAILED';
  const preview = result ? result.slice(0, 50) + (result.length > 50 ? '...' : '') : 'N/A';
  console.log(`\n${status}: ${name}`);
  if (result) {
    console.log(`  Task: "${preview}"`);
  }
}

console.log('\n' + '#'.repeat(80));
console.log('# Verification Complete');
console.log('#'.repeat(80));

// Export results for programmatic use
export { results, createTypicalEvent, createComprehensiveEvent, createMinimalEvent, createNestedEvent, createMixedContentEvent };
