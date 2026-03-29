import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  CLI_TO_PACKAGE_MANAGER,
  findPackageManager,
  detectPackageManagerInCommand,
  checkCommand,
} from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '../bin/enforce-package-manager.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temporary directory tree for testing findPackageManager.
 * Returns the root temp dir path.
 *
 * @param {Record<string, unknown>} rootPkg   Content of root package.json (optional)
 * @param {string[]} [subdirs]                Additional subdirectories to create
 * @returns {{ root: string, cleanup: () => void }}
 */
function makeTempProject(rootPkg, subdirs = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epm-test-'));
  if (rootPkg !== null) {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(rootPkg));
  }
  for (const sub of subdirs) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
  return {
    root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Invoke the hook binary synchronously, piping `payload` to its stdin.
 * Returns `{ exitCode, stdout, stderr }`.
 *
 * @param {unknown} payload
 * @param {{ cwd?: string }} [opts]
 */
function runHook(payload, { cwd = process.cwd() } = {}) {
  const result = spawnSync(process.execPath, [BIN], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd,
  });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

// ---------------------------------------------------------------------------
// CLI_TO_PACKAGE_MANAGER
// ---------------------------------------------------------------------------

describe('CLI_TO_PACKAGE_MANAGER', () => {
  it('maps npm and npx to npm', () => {
    assert.equal(CLI_TO_PACKAGE_MANAGER.npm, 'npm');
    assert.equal(CLI_TO_PACKAGE_MANAGER.npx, 'npm');
  });

  it('maps yarn to yarn', () => {
    assert.equal(CLI_TO_PACKAGE_MANAGER.yarn, 'yarn');
  });

  it('maps pnpm and pnpx to pnpm', () => {
    assert.equal(CLI_TO_PACKAGE_MANAGER.pnpm, 'pnpm');
    assert.equal(CLI_TO_PACKAGE_MANAGER.pnpx, 'pnpm');
  });

  it('maps bun and bunx to bun', () => {
    assert.equal(CLI_TO_PACKAGE_MANAGER.bun, 'bun');
    assert.equal(CLI_TO_PACKAGE_MANAGER.bunx, 'bun');
  });

  it('maps deno to deno', () => {
    assert.equal(CLI_TO_PACKAGE_MANAGER.deno, 'deno');
  });
});

// ---------------------------------------------------------------------------
// findPackageManager
// ---------------------------------------------------------------------------

describe('findPackageManager', () => {
  let tmp, cleanup;

  afterEach(() => cleanup?.());

  it('returns null when no package.json exists', () => {
    ({ root: tmp, cleanup } = makeTempProject(null));
    assert.equal(findPackageManager(tmp), null);
  });

  it('returns null when package.json has no packageManager field', () => {
    ({ root: tmp, cleanup } = makeTempProject({ name: 'my-project' }));
    assert.equal(findPackageManager(tmp), null);
  });

  it('returns the package manager name from the root package.json', () => {
    ({ root: tmp, cleanup } = makeTempProject({ packageManager: 'pnpm@9.0.0' }));
    assert.equal(findPackageManager(tmp), 'pnpm');
  });

  it('strips version and hash suffixes', () => {
    ({ root: tmp, cleanup } = makeTempProject({
      packageManager: 'yarn@4.1.0+sha256.abc123def456',
    }));
    assert.equal(findPackageManager(tmp), 'yarn');
  });

  it('finds packageManager in an ancestor directory', () => {
    ({ root: tmp, cleanup } = makeTempProject(
      { packageManager: 'npm@10.0.0' },
      ['packages/my-lib/src'],
    ));
    const deepDir = path.join(tmp, 'packages', 'my-lib', 'src');
    assert.equal(findPackageManager(deepDir), 'npm');
  });

  it('stops at the nearest package.json with a packageManager field', () => {
    ({ root: tmp, cleanup } = makeTempProject(
      { packageManager: 'npm@10.0.0' },
      ['packages/my-lib'],
    ));
    // Nested package.json with its own packageManager
    fs.writeFileSync(
      path.join(tmp, 'packages', 'my-lib', 'package.json'),
      JSON.stringify({ packageManager: 'pnpm@9.0.0' }),
    );
    assert.equal(findPackageManager(path.join(tmp, 'packages', 'my-lib')), 'pnpm');
  });

  it('skips package.json files that have no packageManager field and keeps walking', () => {
    ({ root: tmp, cleanup } = makeTempProject(
      { packageManager: 'bun@1.0.0' },
      ['packages/my-lib'],
    ));
    // Nested package.json WITHOUT a packageManager field
    fs.writeFileSync(
      path.join(tmp, 'packages', 'my-lib', 'package.json'),
      JSON.stringify({ name: 'my-lib' }),
    );
    // Should fall through to the root and find 'bun'
    assert.equal(findPackageManager(path.join(tmp, 'packages', 'my-lib')), 'bun');
  });

  it('ignores malformed package.json files and keeps walking', () => {
    ({ root: tmp, cleanup } = makeTempProject(
      { packageManager: 'pnpm@9.0.0' },
      ['packages/bad'],
    ));
    fs.writeFileSync(path.join(tmp, 'packages', 'bad', 'package.json'), '{not json}');
    assert.equal(findPackageManager(path.join(tmp, 'packages', 'bad')), 'pnpm');
  });
});

// ---------------------------------------------------------------------------
// detectPackageManagerInCommand
// ---------------------------------------------------------------------------

describe('detectPackageManagerInCommand', () => {
  const cases = [
    // [description, command, expected]
    ['npm install', 'npm install lodash', 'npm'],
    ['npx', 'npx create-react-app my-app', 'npm'],
    ['yarn add', 'yarn add lodash', 'yarn'],
    ['pnpm install', 'pnpm install', 'pnpm'],
    ['pnpx', 'pnpx create-react-app', 'pnpm'],
    ['bun install', 'bun install', 'bun'],
    ['bunx', 'bunx create-react-app', 'bun'],
    ['deno', 'deno install lodash', 'deno'],
    ['absolute path', '/usr/local/bin/npm install', 'npm'],
    ['sudo prefix', 'sudo npm install -g typescript', 'npm'],
    ['env var prefix', 'NODE_ENV=production npm run build', 'npm'],
    ['multiple env vars', 'FOO=bar BAZ=qux npm ci', 'npm'],
    ['chained &&', 'cd /tmp && npm install', 'npm'],
    ['chained ||', 'npm install || echo failed', 'npm'],
    ['semicolon', 'echo start; yarn install', 'yarn'],
    ['multiline', 'echo start\npnpm install', 'pnpm'],
    ['time prefix', 'time bun install', 'bun'],
    ['env prefix', 'env VAR=1 npm install', 'npm'],
  ];

  for (const [desc, command, expected] of cases) {
    it(`detects ${expected} in: ${desc}`, () => {
      assert.equal(detectPackageManagerInCommand(command), expected);
    });
  }

  it('returns null for unrelated commands', () => {
    assert.equal(detectPackageManagerInCommand('echo hello'), null);
    assert.equal(detectPackageManagerInCommand('ls -la'), null);
    assert.equal(detectPackageManagerInCommand('git commit -m "fix"'), null);
  });

  it('returns null for empty/falsy input', () => {
    assert.equal(detectPackageManagerInCommand(''), null);
    assert.equal(detectPackageManagerInCommand(null), null);
    assert.equal(detectPackageManagerInCommand(undefined), null);
  });

  it('returns null for shell comment lines', () => {
    assert.equal(detectPackageManagerInCommand('# npm install'), null);
  });

  it('returns the first PM found when multiple appear', () => {
    // In practice this would be weird, but the function is deterministic.
    const result = detectPackageManagerInCommand('npm run prebuild && yarn build');
    assert.equal(result, 'npm');
  });
});

// ---------------------------------------------------------------------------
// checkCommand
// ---------------------------------------------------------------------------

describe('checkCommand', () => {
  let tmp, cleanup;

  afterEach(() => cleanup?.());

  it('allows when no package.json exists in the tree', () => {
    ({ root: tmp, cleanup } = makeTempProject(null));
    const r = checkCommand('npm install', tmp);
    assert.equal(r.blocked, false);
  });

  it('allows when package.json has no packageManager field', () => {
    ({ root: tmp, cleanup } = makeTempProject({ name: 'project' }));
    const r = checkCommand('yarn add lodash', tmp);
    assert.equal(r.blocked, false);
  });

  it('allows when the detected PM matches the declared one', () => {
    ({ root: tmp, cleanup } = makeTempProject({ packageManager: 'pnpm@9.0.0' }));
    const r = checkCommand('pnpm install', tmp);
    assert.equal(r.blocked, false);
    assert.equal(r.detectedPM, 'pnpm');
    assert.equal(r.projectPM, 'pnpm');
  });

  it('allows when the command has no PM', () => {
    ({ root: tmp, cleanup } = makeTempProject({ packageManager: 'pnpm@9.0.0' }));
    const r = checkCommand('echo hello', tmp);
    assert.equal(r.blocked, false);
  });

  it('blocks when the detected PM differs from the declared one', () => {
    ({ root: tmp, cleanup } = makeTempProject({ packageManager: 'pnpm@9.0.0' }));
    const r = checkCommand('npm install lodash', tmp);
    assert.equal(r.blocked, true);
    assert.equal(r.detectedPM, 'npm');
    assert.equal(r.projectPM, 'pnpm');
    assert.ok(r.message?.includes('pnpm'));
    assert.ok(r.message?.includes('npm'));
  });

  it('blocks npx when the project uses yarn', () => {
    ({ root: tmp, cleanup } = makeTempProject({ packageManager: 'yarn@4.1.0' }));
    const r = checkCommand('npx some-tool', tmp);
    assert.equal(r.blocked, true);
    assert.equal(r.detectedPM, 'npm');
    assert.equal(r.projectPM, 'yarn');
  });

  it('blocks bun when the project uses npm', () => {
    ({ root: tmp, cleanup } = makeTempProject({ packageManager: 'npm@10.0.0' }));
    const r = checkCommand('bun install', tmp);
    assert.equal(r.blocked, true);
  });
});

// ---------------------------------------------------------------------------
// Hook binary (integration)
// ---------------------------------------------------------------------------

describe('hook binary', () => {
  let tmp, cleanup;

  afterEach(() => cleanup?.());

  it('exits 0 for empty stdin', () => {
    const result = spawnSync(process.execPath, [BIN], {
      input: '',
      encoding: 'utf8',
    });
    assert.equal(result.status, 0);
  });

  it('exits 0 for unparseable stdin', () => {
    const result = spawnSync(process.execPath, [BIN], {
      input: 'not json',
      encoding: 'utf8',
    });
    assert.equal(result.status, 0);
  });

  it('exits 0 for non-Bash tool calls (Claude Code format)', () => {
    ({ root: tmp, cleanup } = makeTempProject({ packageManager: 'pnpm@9.0.0' }));
    const { exitCode } = runHook(
      { tool_name: 'Read', tool_input: { path: '/tmp/foo' } },
      { cwd: tmp },
    );
    assert.equal(exitCode, 0);
  });

  // ── Claude Code format ────────────────────────────────────────────────────

  it('exits 0 when Bash command uses the correct PM (Claude Code)', () => {
    ({ root: tmp, cleanup } = makeTempProject({ packageManager: 'pnpm@9.0.0' }));
    const { exitCode } = runHook(
      { tool_name: 'Bash', tool_input: { command: 'pnpm install' } },
      { cwd: tmp },
    );
    assert.equal(exitCode, 0);
  });

  it('exits 2 and prints message when wrong PM is used (Claude Code)', () => {
    ({ root: tmp, cleanup } = makeTempProject({ packageManager: 'pnpm@9.0.0' }));
    const { exitCode, stderr } = runHook(
      { tool_name: 'Bash', tool_input: { command: 'npm install lodash' } },
      { cwd: tmp },
    );
    assert.equal(exitCode, 2);
    assert.ok(stderr.includes('pnpm'));
    assert.ok(stderr.includes('npm'));
  });

  it('exits 0 when package.json has no packageManager field (Claude Code)', () => {
    ({ root: tmp, cleanup } = makeTempProject({ name: 'project' }));
    const { exitCode } = runHook(
      { tool_name: 'Bash', tool_input: { command: 'npm install lodash' } },
      { cwd: tmp },
    );
    assert.equal(exitCode, 0);
  });

  // ── Gemini CLI format (run_shell_command) ─────────────────────────────────

  it('exits 0 when run_shell_command uses correct PM (Gemini CLI)', () => {
    ({ root: tmp, cleanup } = makeTempProject({ packageManager: 'yarn@4.1.0' }));
    const { exitCode } = runHook(
      { tool_name: 'run_shell_command', tool_input: { command: 'yarn add lodash' } },
      { cwd: tmp },
    );
    assert.equal(exitCode, 0);
  });

  it('exits 2 when run_shell_command uses wrong PM (Gemini CLI)', () => {
    ({ root: tmp, cleanup } = makeTempProject({ packageManager: 'yarn@4.1.0' }));
    const { exitCode, stderr } = runHook(
      { tool_name: 'run_shell_command', tool_input: { command: 'pnpm install' } },
      { cwd: tmp },
    );
    assert.equal(exitCode, 2);
    assert.ok(stderr.includes('yarn'));
  });

  // ── OpenAI Codex CLI format ───────────────────────────────────────────────
  // Codex uses { tool_name, tool_input } like Claude Code (not OpenAI chat format)

  it('exits 0 when Codex Bash tool uses correct PM', () => {
    ({ root: tmp, cleanup } = makeTempProject({ packageManager: 'bun@1.0.0' }));
    const { exitCode } = runHook(
      { tool_name: 'Bash', tool_input: { command: 'bun install' } },
      { cwd: tmp },
    );
    assert.equal(exitCode, 0);
  });

  it('exits 2 when Codex Bash tool uses wrong PM', () => {
    ({ root: tmp, cleanup } = makeTempProject({ packageManager: 'bun@1.0.0' }));
    const { exitCode, stderr } = runHook(
      { tool_name: 'Bash', tool_input: { command: 'npm ci' } },
      { cwd: tmp },
    );
    assert.equal(exitCode, 2);
    assert.ok(stderr.includes('bun'));
  });

  it('exits 0 for Codex non-Bash tool calls', () => {
    ({ root: tmp, cleanup } = makeTempProject({ packageManager: 'pnpm@9.0.0' }));
    const { exitCode } = runHook(
      { tool_name: 'read_file', tool_input: { path: '/tmp/x' } },
      { cwd: tmp },
    );
    assert.equal(exitCode, 0);
  });

  // ── GitHub Copilot CLI format ─────────────────────────────────────────────

  it('exits 0 when Copilot CLI bash tool uses correct PM', (t) => {
    const { root, cleanup } = makeTempProject({ packageManager: 'bun@1.0.0' });
    t.after(cleanup);
    const { exitCode } = runHook(
      { toolName: 'bash', toolArgs: JSON.stringify({ command: 'bun install' }) },
      { cwd: root },
    );
    assert.equal(exitCode, 0);
  });

  it('exits 0 and writes deny JSON to stdout when Copilot CLI uses wrong PM', (t) => {
    const { root, cleanup } = makeTempProject({ packageManager: 'bun@1.0.0' });
    t.after(cleanup);
    const { exitCode, stdout } = runHook(
      { toolName: 'bash', toolArgs: JSON.stringify({ command: 'npm install' }) },
      { cwd: root },
    );
    assert.equal(exitCode, 0);
    const response = JSON.parse(stdout);
    assert.equal(response.permissionDecision, 'deny');
    assert.ok(typeof response.permissionDecisionReason === 'string');
    assert.ok(response.permissionDecisionReason.includes('bun'));
  });

  it('exits 0 for Copilot CLI non-bash tools', (t) => {
    const { root, cleanup } = makeTempProject({ packageManager: 'pnpm@9.0.0' });
    t.after(cleanup);
    const { exitCode } = runHook(
      { toolName: 'view', toolArgs: JSON.stringify({ path: '/tmp/x' }) },
      { cwd: root },
    );
    assert.equal(exitCode, 0);
  });

  it('handles malformed toolArgs JSON gracefully (Copilot CLI)', (t) => {
    const { root, cleanup } = makeTempProject({ packageManager: 'pnpm@9.0.0' });
    t.after(cleanup);
    const { exitCode } = runHook(
      { toolName: 'bash', toolArgs: 'not json' },
      { cwd: root },
    );
    assert.equal(exitCode, 0);
  });
});
