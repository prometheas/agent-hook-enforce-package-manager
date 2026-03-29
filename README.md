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
**OpenAI Codex CLI**.

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

### 3. Configure your AI coding agent (see sections below)

---

## Claude Code

Add (or merge) the following into your project's `.claude/settings.json`:

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
> tool call to the hook's stdin.  The hook exits `0` to allow or `2` to block
> (exit code `2` surfaces the error message back to the agent as context so it
> can self-correct).

---

## Gemini CLI

Add (or merge) the following into your project's `.gemini/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
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

---

## OpenAI Codex CLI

The hook also handles Codex CLI's function-call format automatically.  Add
the hook command to your Codex CLI configuration:

```toml
# ~/.codex/config.toml  (example – refer to Codex CLI docs for exact format)
[hooks]
pre_exec = "./node_modules/.bin/enforce-package-manager"
```

The hook recognises Codex's `{ type: "function", function: { name: "shell", … } }`
payload and enforces the same rules.

---

## How the hook payload is parsed

The hook accepts **three JSON payload shapes** on stdin, covering the known
AI coding agent formats:

```jsonc
// Claude Code / Gemini CLI
{ "tool_name": "Bash",               "tool_input": { "command": "…" } }
{ "tool_name": "run_shell_command",  "tool_input": { "command": "…" } }

// OpenAI Codex CLI
{ "type": "function", "function": { "name": "shell", "arguments": { "command": "…" } } }
```

Any other payload is ignored and the hook exits `0`.

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
