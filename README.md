# enforce-package-manager

A **PreToolUse hook** for AI coding agents that prevents the agent from
accidentally using the wrong package manager.

When an agent tries to run a shell command (e.g. `npm install`), the hook
inspects the nearest `package.json` for a
[Corepack `packageManager` field](https://nodejs.org/api/corepack.html).

| Situation | Outcome |
|-----------|---------|
| `packageManager` field is absent | ✅ Allow any package manager |
| Detected package manager **matches** the declared one | ✅ Allow |
| Detected package manager **does not match** | ❌ Block with a clear error message |

Supported package managers: **npm / npx**, **yarn**, **pnpm / pnpx**,
**bun / bunx**, **deno**.

Supported AI coding agents: **Claude Code**, **Gemini CLI**,
**OpenAI Codex CLI**, **GitHub Copilot CLI**.

---

## Quick start

### 1. Install

```bash
# npm
npm install --save-dev claude-hook-enforce-package-manager

# yarn
yarn add --dev claude-hook-enforce-package-manager

# pnpm
pnpm add --save-dev claude-hook-enforce-package-manager

# bun
bun add --dev claude-hook-enforce-package-manager
```

### 2. Declare your package manager in `package.json`

```jsonc
{
  "packageManager": "pnpm@9.0.0"   // or npm, yarn, bun, deno + version
}
```

### 3. Run setup to configure your AI coding agents

```bash
npx enforce-package-manager setup
```

This writes (or merges into) the correct hook config files for each agent you
use, then prints a `git add` + `git commit` command so every contributor
inherits the hook automatically.

Or run it non-interactively:

```bash
# auto-detect which agents are installed
npx enforce-package-manager setup --yes

# configure specific agents only
npx enforce-package-manager setup --agents claude,gemini --yes
```

---

## Setup CLI reference

```
Usage: enforce-package-manager setup [options]

Options:
  --agents <list>   Comma-separated list of agent IDs to configure.
                    Valid IDs: claude, gemini, codex, copilot
  --yes, -y         Non-interactive: skip prompts and auto-detect agents
```

The setup command:
- Detects which agent CLIs are on your PATH and pre-selects them
- Writes/merges hook config files — never overwrites unrelated entries
- Uses `./node_modules/.bin/enforce-package-manager` as the hook path
  (always the local devDep — no global install required)
- Prints an install advisory if the package is not yet in `devDependencies`
- Idempotent — running it twice does not create duplicate entries

---

## Manual configuration

If you prefer to configure agents manually, the generated files look like this:

### Claude Code — `.claude/settings.json`

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "./node_modules/.bin/enforce-package-manager"
          }
        ]
      }
    ]
  }
}
```

> **How it works** – Claude Code pipes a JSON payload describing the Bash
> tool call to the hook's stdin. The hook exits `0` to allow or `2` to block
> (exit code `2` surfaces the error message back to the agent via stderr so it
> can self-correct).

### Gemini CLI — `.gemini/settings.json`

```json
{
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "run_shell_command",
        "hooks": [
          {
            "type": "command",
            "command": "./node_modules/.bin/enforce-package-manager"
          }
        ]
      }
    ]
  }
}
```

> **Note**: Gemini CLI uses the `BeforeTool` event (not `PreToolUse`) and the
> tool name `run_shell_command` (not `Bash`).

### OpenAI Codex CLI — `.codex/hooks.json`

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "./node_modules/.bin/enforce-package-manager"
          }
        ]
      }
    ]
  }
}
```

> **Note**: Codex CLI hooks require `features.codex_hooks = true` in
> `~/.codex/config.toml` (beta feature as of 2026-03-28). Codex uses the same
> `{ tool_name, tool_input }` payload format as Claude Code.

### GitHub Copilot CLI — `hooks.json` (project root)

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "type": "command",
        "bash": "./node_modules/.bin/enforce-package-manager"
      }
    ]
  }
}
```

> **Note**: Copilot CLI loads `hooks.json` from the current working directory.
> The block response is returned as JSON on stdout with exit 0 (Copilot's deny
> protocol differs from the other agents).
>
> **Warning**: check for filename conflicts before committing `hooks.json` into
> an existing repository.

---

## How the hook payload is parsed

The hook accepts **two JSON payload shapes** on stdin, covering all four
supported agents:

```jsonc
// Claude Code / Gemini CLI / OpenAI Codex CLI  (snake_case)
{ "tool_name": "Bash",               "tool_input": { "command": "…" } }
{ "tool_name": "run_shell_command",  "tool_input": { "command": "…" } }

// GitHub Copilot CLI  (camelCase; toolArgs is a JSON string — double-parse required)
{ "toolName": "bash", "toolArgs": "{\"command\":\"…\"}" }
```

Any other payload shape is ignored and the hook exits `0`.

### Block response by agent

| Agent | Block mechanism |
|-------|----------------|
| Claude Code | Exit `2`, message on **stderr** |
| Gemini CLI | Exit `2`, message on **stderr** |
| Codex CLI | Exit `2`, message on **stderr** |
| Copilot CLI | Exit `0`, `{ "permissionDecision": "deny", "permissionDecisionReason": "…" }` on **stdout** |

---

## How package manager detection works

The hook splits the command string on `&&`, `||`, `;`, and newlines, then
inspects the first executable token in each segment (stripping leading
environment-variable assignments and `sudo`/`env`/`time` prefixes).

```
NODE_ENV=prod sudo npm ci   →  detected: npm
cd /app && pnpm install     →  detected: pnpm
bunx some-tool              →  detected: bun   (bunx maps to bun)
npx create-react-app .      →  detected: npm   (npx maps to npm)
```

The hook walks **up** the directory tree from `process.cwd()` until it finds
a `package.json` with a `packageManager` field, allowing the hook to work in
monorepo sub-packages.

---

## Using the JavaScript API directly

```js
import {
  findPackageManager,
  detectPackageManagerInCommand,
  checkCommand,
} from 'claude-hook-enforce-package-manager';

const projectPM = findPackageManager('/path/to/project');
// → 'pnpm'  (or null if not declared)

const detected = detectPackageManagerInCommand('npm install lodash');
// → 'npm'

const result = checkCommand('npm install lodash', '/path/to/project');
// → { blocked: true, detectedPM: 'npm', projectPM: 'pnpm', message: '…' }
```

---

## Contributing

```bash
git clone https://github.com/prometheas/claude-hook-enforce-package-manager.git
cd claude-hook-enforce-package-manager
npm install
npm test
```

## License

MIT © John Lianoglou
