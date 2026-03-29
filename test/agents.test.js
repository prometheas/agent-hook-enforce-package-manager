import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AGENTS } from '../src/agents.js';

const LOCAL_BIN = './node_modules/.bin/enforce-package-manager';

describe('AGENTS registry', () => {
  it('contains entries for all four supported agents', () => {
    const ids = AGENTS.map((a) => a.id);
    assert.ok(ids.includes('claude'));
    assert.ok(ids.includes('gemini'));
    assert.ok(ids.includes('codex'));
    assert.ok(ids.includes('copilot'));
  });

  it('each agent has required fields', () => {
    for (const agent of AGENTS) {
      assert.ok(agent.id, `${agent.id}: missing id`);
      assert.ok(agent.name, `${agent.id}: missing name`);
      assert.ok(agent.detectBinary, `${agent.id}: missing detectBinary`);
      assert.ok(agent.configPath, `${agent.id}: missing configPath`);
      assert.ok(typeof agent.generateConfig === 'function', `${agent.id}: missing generateConfig`);
    }
  });

  it('Claude Code generateConfig produces correct hook structure', () => {
    const claude = AGENTS.find((a) => a.id === 'claude');
    const config = claude.generateConfig(LOCAL_BIN);
    assert.deepEqual(config, {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: LOCAL_BIN }],
          },
        ],
      },
    });
  });

  it('Gemini CLI generateConfig uses BeforeTool event', () => {
    const gemini = AGENTS.find((a) => a.id === 'gemini');
    const config = gemini.generateConfig(LOCAL_BIN);
    assert.ok(config.hooks.BeforeTool, 'must use BeforeTool not PreToolUse');
    assert.equal(config.hooks.BeforeTool[0].matcher, 'run_shell_command');
  });

  it('Codex CLI generateConfig uses PreToolUse/Bash', () => {
    const codex = AGENTS.find((a) => a.id === 'codex');
    const config = codex.generateConfig(LOCAL_BIN);
    assert.ok(config.hooks.PreToolUse, 'must have PreToolUse');
    assert.equal(config.hooks.PreToolUse[0].matcher, 'Bash');
  });

  it('Copilot CLI generateConfig produces version:1 and flat bash entry', () => {
    const copilot = AGENTS.find((a) => a.id === 'copilot');
    const config = copilot.generateConfig(LOCAL_BIN);
    assert.equal(config.version, 1);
    assert.ok(config.hooks.preToolUse, 'must use preToolUse');
    assert.equal(config.hooks.preToolUse[0].bash, LOCAL_BIN);
  });
});
