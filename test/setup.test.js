import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '../bin/enforce-package-manager.js');
const LOCAL_BIN = './node_modules/.bin/enforce-package-manager';

function runSetup(args, { cwd } = {}) {
  const result = spawnSync(process.execPath, [BIN, 'setup', ...args], {
    cwd: cwd ?? process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return { exitCode: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function makeTempDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epm-setup-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'test' }));
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

describe('setup subcommand', () => {
  it('creates .claude/settings.json for claude agent with --yes', (t) => {
    const { root, cleanup } = makeTempDir();
    t.after(cleanup);
    const { exitCode } = runSetup(['--agents', 'claude', '--yes'], { cwd: root });
    assert.equal(exitCode, 0);
    const config = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
    assert.ok(config.hooks?.PreToolUse, 'must have PreToolUse hook');
    assert.equal(config.hooks.PreToolUse[0].hooks[0].command, LOCAL_BIN);
  });

  it('creates .gemini/settings.json for gemini agent', (t) => {
    const { root, cleanup } = makeTempDir();
    t.after(cleanup);
    runSetup(['--agents', 'gemini', '--yes'], { cwd: root });
    const config = JSON.parse(fs.readFileSync(path.join(root, '.gemini', 'settings.json'), 'utf8'));
    assert.ok(config.hooks?.BeforeTool, 'Gemini must use BeforeTool event');
    assert.equal(config.hooks.BeforeTool[0].hooks[0].command, LOCAL_BIN);
  });

  it('creates .codex/hooks.json for codex agent', (t) => {
    const { root, cleanup } = makeTempDir();
    t.after(cleanup);
    runSetup(['--agents', 'codex', '--yes'], { cwd: root });
    const config = JSON.parse(fs.readFileSync(path.join(root, '.codex', 'hooks.json'), 'utf8'));
    assert.ok(config.hooks?.PreToolUse);
    assert.equal(config.hooks.PreToolUse[0].hooks[0].command, LOCAL_BIN);
  });

  it('creates hooks.json for copilot agent', (t) => {
    const { root, cleanup } = makeTempDir();
    t.after(cleanup);
    runSetup(['--agents', 'copilot', '--yes'], { cwd: root });
    const config = JSON.parse(fs.readFileSync(path.join(root, 'hooks.json'), 'utf8'));
    assert.equal(config.version, 1);
    assert.equal(config.hooks?.preToolUse[0].bash, LOCAL_BIN);
  });

  it('merges into existing config without overwriting other entries', (t) => {
    const { root, cleanup } = makeTempDir();
    t.after(cleanup);
    const existing = {
      hooks: { PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'other-hook' }] }] },
    };
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify(existing));
    runSetup(['--agents', 'claude', '--yes'], { cwd: root });
    const config = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
    assert.equal(config.hooks.PreToolUse.length, 2, 'must preserve existing entry');
  });

  it('does not duplicate entries when run twice', (t) => {
    const { root, cleanup } = makeTempDir();
    t.after(cleanup);
    runSetup(['--agents', 'claude', '--yes'], { cwd: root });
    runSetup(['--agents', 'claude', '--yes'], { cwd: root });
    const config = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
    assert.equal(config.hooks.PreToolUse.length, 1, 'must not duplicate on re-run');
  });

  it('exits 0 with --yes and no agents specified (defaults to detected/claude)', (t) => {
    const { root, cleanup } = makeTempDir();
    t.after(cleanup);
    const { exitCode } = runSetup(['--yes'], { cwd: root });
    assert.equal(exitCode, 0);
  });

  it('prints install hint when package not in package.json devDependencies', (t) => {
    const { root, cleanup } = makeTempDir();
    t.after(cleanup);
    const { stdout } = runSetup(['--agents', 'claude', '--yes'], { cwd: root });
    assert.ok(stdout.includes('install') || stdout.includes('devDep') || stdout.includes('add'));
  });

  it('does not print install hint when package is already a devDependency', (t) => {
    const { root, cleanup } = makeTempDir();
    t.after(cleanup);
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'test', devDependencies: { 'agent-hook-enforce-package-manager': '*' } }),
    );
    const { stdout } = runSetup(['--agents', 'claude', '--yes'], { cwd: root });
    assert.ok(!stdout.includes('install --save-dev'));
  });
});
