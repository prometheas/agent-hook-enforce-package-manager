/**
 * Registry of supported AI coding agents.
 * Each entry describes how to generate the hook config for that agent.
 *
 * @type {Array<{
 *   id: string,
 *   name: string,
 *   detectBinary: string,
 *   configPath: string,
 *   generateConfig: (commandPath: string) => object,
 * }>}
 */
export const AGENTS = [
  {
    id: 'claude',
    name: 'Claude Code',
    detectBinary: 'claude',
    configPath: '.claude/settings.json',
    generateConfig(commandPath) {
      return {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [{ type: 'command', command: commandPath }],
            },
          ],
        },
      };
    },
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    detectBinary: 'gemini',
    configPath: '.gemini/settings.json',
    generateConfig(commandPath) {
      return {
        hooks: {
          BeforeTool: [
            {
              matcher: 'run_shell_command',
              hooks: [{ type: 'command', command: commandPath }],
            },
          ],
        },
      };
    },
  },
  {
    id: 'codex',
    name: 'OpenAI Codex CLI',
    detectBinary: 'codex',
    configPath: '.codex/hooks.json',
    generateConfig(commandPath) {
      return {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [{ type: 'command', command: commandPath }],
            },
          ],
        },
      };
    },
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    detectBinary: 'copilot',
    configPath: 'hooks.json',
    generateConfig(commandPath) {
      return {
        version: 1,
        hooks: {
          preToolUse: [
            {
              type: 'command',
              bash: commandPath,
            },
          ],
        },
      };
    },
  },
];
