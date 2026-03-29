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
 *   0  – allow the tool use to proceed
 *   2  – block the tool use; stdout message is surfaced to the agent as context
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
 * Extract the shell command from a parsed hook payload.
 *
 * Supported host formats:
 *
 *  Claude Code / Gemini CLI (PreToolUse):
 *    { tool_name: "Bash" | "run_shell_command", tool_input: { command: "…" } }
 *
 *  OpenAI Codex CLI (exec hook):
 *    { type: "function", function: { name: "shell", arguments: { command: "…" } } }
 *
 * @param {unknown} payload  Parsed JSON from stdin.
 * @returns {string|null}    The command string, or null if not found.
 */
function extractCommand(payload) {
  if (!payload || typeof payload !== 'object') return null;

  // ── Claude Code & Gemini CLI ────────────────────────────────────────────
  // { tool_name: "Bash", tool_input: { command: "…" } }
  const toolName = payload.tool_name;
  if (
    typeof toolName === 'string' &&
    /^(bash|run_shell_command)$/i.test(toolName) &&
    payload.tool_input?.command
  ) {
    return String(payload.tool_input.command);
  }

  // ── OpenAI Codex CLI ────────────────────────────────────────────────────
  // { type: "function", function: { name: "shell", arguments: { command: "…" } } }
  if (
    payload.type === 'function' &&
    payload.function?.name === 'shell' &&
    payload.function?.arguments?.command
  ) {
    return String(payload.function.arguments.command);
  }

  return null;
}

async function main() {
  const raw = await readStdin();

  if (!raw.trim()) {
    process.exit(0);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Unparseable input – don't block, just let the tool use proceed.
    process.exit(0);
  }

  const command = extractCommand(payload);

  if (!command) {
    // Not a shell-execution tool call we recognise – allow it.
    process.exit(0);
  }

  const result = checkCommand(command, process.cwd());

  if (result.blocked) {
    process.stdout.write(result.message + '\n');
    // Exit 2 surfaces the message as feedback to the agent so it can correct
    // itself without interrupting the user.
    process.exit(2);
  }

  process.exit(0);
}

main().catch((err) => {
  // Unexpected runtime errors must not block the agent.
  process.stderr.write(`enforce-package-manager: unexpected error: ${err?.message ?? err}\n`);
  process.exit(0);
});
