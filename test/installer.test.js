import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readJsonFile, writeJsonFile, mergeHookConfig } from '../src/installer.js';

const CMD = './node_modules/.bin/enforce-package-manager';

describe('readJsonFile', () => {
  it('returns {} for a non-existent file', () => {
    assert.deepEqual(readJsonFile('/tmp/does-not-exist-epm.json'), {});
  });

  it('parses a valid JSON file', () => {
    const tmp = path.join(os.tmpdir(), `epm-read-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify({ foo: 'bar' }));
    try {
      assert.deepEqual(readJsonFile(tmp), { foo: 'bar' });
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  it('returns {} for malformed JSON', () => {
    const tmp = path.join(os.tmpdir(), `epm-bad-${Date.now()}.json`);
    fs.writeFileSync(tmp, 'not json');
    try {
      assert.deepEqual(readJsonFile(tmp), {});
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });
});

describe('writeJsonFile', () => {
  it('creates parent directories and writes pretty JSON ending with newline', () => {
    const tmp = path.join(os.tmpdir(), `epm-write-${Date.now()}`, 'nested', 'config.json');
    try {
      writeJsonFile(tmp, { hooks: { PreToolUse: [] } });
      const content = fs.readFileSync(tmp, 'utf8');
      assert.ok(content.endsWith('\n'), 'must end with newline');
      assert.deepEqual(JSON.parse(content), { hooks: { PreToolUse: [] } });
    } finally {
      fs.rmSync(path.dirname(path.dirname(tmp)), { recursive: true, force: true });
    }
  });
});

describe('mergeHookConfig', () => {
  it('merges into empty config (standard format)', () => {
    const newCfg = {
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: CMD }] }],
      },
    };
    assert.deepEqual(mergeHookConfig({}, newCfg), newCfg);
  });

  it('preserves existing unrelated hook entries', () => {
    const existing = {
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/other/cmd' }] }],
      },
    };
    const newCfg = {
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: CMD }] }],
      },
    };
    const result = mergeHookConfig(existing, newCfg);
    assert.equal(result.hooks.PreToolUse.length, 2);
  });

  it('avoids duplicate entries (standard format)', () => {
    const entry = { matcher: 'Bash', hooks: [{ type: 'command', command: CMD }] };
    const cfg = { hooks: { PreToolUse: [entry] } };
    const result = mergeHookConfig(cfg, cfg);
    assert.equal(result.hooks.PreToolUse.length, 1);
  });

  it('merges Copilot-style flat entries without duplication', () => {
    const copilotCfg = {
      version: 1,
      hooks: { preToolUse: [{ type: 'command', bash: CMD }] },
    };
    const result = mergeHookConfig(copilotCfg, copilotCfg);
    assert.equal(result.hooks.preToolUse.length, 1);
    assert.equal(result.version, 1);
  });

  it('preserves version field from new config when existing has none', () => {
    const newCfg = { version: 1, hooks: { preToolUse: [{ type: 'command', bash: CMD }] } };
    const result = mergeHookConfig({}, newCfg);
    assert.equal(result.version, 1);
  });
});
