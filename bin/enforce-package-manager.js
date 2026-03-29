#!/usr/bin/env node
/**
 * enforce-package-manager
 *
 * A PreToolUse hook for AI coding agents (Claude Code, Gemini CLI, etc.) that
 * prevents the agent from invoking the wrong package manager when the project
 * declares one in its package.json `packageManager` field.
 *
 * The hook reads a JSON payload from stdin (format varies by host agent – see
 * README for details), extracts any shell command contained within it, and
 * blocks execution when the command uses a different package manager than the
 * one declared in package.json.
 *
 * Exit codes:
 *   0  – allow the tool use to proceed (also used by Copilot CLI denials)
 *   2  – block the tool use (Claude Code / Gemini CLI / Codex CLI);
 *         stderr message is surfaced to the agent as context
 */

import { checkCommand } from '../src/index.js';

/**
 * Accumulate all bytes from stdin and return them as a UTF-8 string.
 * @returns {Promise<string>}
 */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Extract shell command and agent format from hook payload.
 *
 * Supported formats:
 *  Claude Code / Gemini CLI / Codex CLI (snake_case):
 *    { tool_name: "Bash"|"run_shell_command", tool_input: { command } }
 *
 *  GitHub Copilot CLI (camelCase; toolArgs is a JSON string):
 *    { toolName: "bash", toolArgs: '{"command":"..."}' }
 *
 * @param {unknown} payload
 * @returns {{ command: string, format: 'standard'|'copilot' } | null}
 */
function extractCommand(payload) {
  if (!payload || typeof payload !== 'object') return null;

  // ── Claude Code, Gemini CLI, Codex CLI ──────────────────────────────────
  const toolName = payload.tool_name;
  if (
    typeof toolName === 'string' &&
    /^(bash|run_shell_command)$/i.test(toolName) &&
    payload.tool_input?.command
  ) {
    return { command: String(payload.tool_input.command), format: 'standard' };
  }

  // ── GitHub Copilot CLI ──────────────────────────────────────────────────
  if (
    typeof payload.toolName === 'string' &&
    /^bash$/i.test(payload.toolName) &&
    typeof payload.toolArgs === 'string'
  ) {
    let args;
    try {
      args = JSON.parse(payload.toolArgs);
    } catch {
      return null;
    }
    if (args?.command) {
      return { command: String(args.command), format: 'copilot' };
    }
  }

  return null;
}

async function main() {
  // Setup subcommand — lazy-loaded so hook startup stays lean
  if (process.argv[2] === 'setup') {
    const { runSetup } = await import('../src/setup/index.js');
    await runSetup(process.argv.slice(3));
    return;
  }

  const raw = await readStdin();
  if (!raw.trim()) process.exit(0);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const extracted = extractCommand(payload);
  if (!extracted) process.exit(0);

  const { command, format } = extracted;
  const result = checkCommand(command, process.cwd());

  if (result.blocked) {
    if (format === 'copilot') {
      // Copilot CLI: deny via stdout JSON, exit 0
      process.stdout.write(
        JSON.stringify({
          permissionDecision: 'deny',
          permissionDecisionReason: result.message,
        }) + '\n',
      );
      process.exit(0);
    } else {
      // Claude Code, Gemini CLI, Codex CLI: deny via stderr, exit 2
      process.stderr.write(result.message + '\n');
      process.exit(2);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  // Unexpected runtime errors must not block the agent.
  process.stderr.write(`enforce-package-manager: unexpected error: ${err?.message ?? err}\n`);
  process.exit(0);
});
