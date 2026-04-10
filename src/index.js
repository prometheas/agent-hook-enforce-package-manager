import fs from 'node:fs';
import path from 'node:path';

/**
 * Maps CLI executable names to their canonical package manager name.
 * Both the primary CLI and any associated runner/executor tools map to
 * the same canonical name so they can be compared to the `packageManager`
 * field in package.json.
 *
 * @type {Record<string, string>}
 */
export const CLI_TO_PACKAGE_MANAGER = {
  npm: 'npm',
  npx: 'npm',
  yarn: 'yarn',
  pnpm: 'pnpm',
  bun: 'bun',
  bunx: 'bun',
  deno: 'deno',
};

/**
 * Walk up the directory tree from `cwd` looking for a `package.json` that
 * contains a `packageManager` field (the Corepack format, e.g. `"pnpm@9.0.0"`).
 *
 * Returns the bare package-manager name (e.g. `"pnpm"`) when found, or
 * `null` when no such field exists anywhere in the ancestor chain.
 *
 * @param {string} cwd  Directory to start searching from.
 * @returns {string|null}
 */
export function findPackageManager(cwd) {
  let dir = path.resolve(cwd);

  while (true) {
    const pkgPath = path.join(dir, 'package.json');

    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.packageManager && typeof pkg.packageManager === 'string') {
          // Strip version and optional hash: "pnpm@9.0.0+sha256.abc" → "pnpm"
          const name = pkg.packageManager.split('@')[0].trim();
          if (name) return name;
        }
      } catch {
        // Ignore JSON parse errors and keep walking up.
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }

  return null;
}

/**
 * Inspect a shell command string and return the canonical package manager name
 * if the command invokes one of the tracked CLIs, or `null` otherwise.
 *
 * Handles:
 *  - Multiple commands joined with `&&`, `||`, `;`, or newlines
 *  - Leading environment-variable assignments (`VAR=value cmd …`)
 *  - Common prefixes such as `sudo`, `env`, and `time`
 *  - Absolute paths (`/usr/local/bin/npm install`)
 *
 * Returns the *first* package-manager CLI found in the command string.
 *
 * @param {string} command  Shell command string to analyse.
 * @returns {string|null}
 */
export function detectPackageManagerInCommand(command) {
  if (!command || typeof command !== 'string') return null;

  // Split on the most common shell command separators.
  const segments = command.split(/&&|\|\||;|\n/);

  for (const segment of segments) {
    let token = segment.trim();
    if (!token || token.startsWith('#')) continue;

    // Iteratively strip leading env-var assignments and common single-word
    // prefixes until the token is stable.  This handles patterns such as
    // `env VAR=value cmd` where stripping `env` exposes a `VAR=value` prefix.
    let prev;
    do {
      prev = token;
      token = token.replace(/^(?:[A-Za-z_]\w*=\S*\s+)+/, '');
      token = token.replace(/^(?:sudo|env|time)\s+/, '');
    } while (token !== prev);

    // The first whitespace-delimited word is the executable.
    const executable = token.trim().split(/\s+/)[0];
    if (!executable) continue;

    // Strip any leading path component to get just the binary name.
    const basename = path.basename(executable);

    if (CLI_TO_PACKAGE_MANAGER[basename] !== undefined) {
      return CLI_TO_PACKAGE_MANAGER[basename];
    }
  }

  return null;
}

/**
 * Determine whether a shell command should be blocked given the project's
 * declared package manager.
 *
 * @param {string} command  The shell command to check.
 * @param {string} cwd      Working directory used to locate `package.json`.
 * @returns {{ blocked: boolean, detectedPM?: string, projectPM?: string, message?: string }}
 */
export function checkCommand(command, cwd) {
  const detectedPM = detectPackageManagerInCommand(command);

  if (!detectedPM) {
    // Command doesn't involve a tracked package manager CLI – allow it.
    return { blocked: false };
  }

  const projectPM = findPackageManager(cwd);

  if (!projectPM) {
    // No `packageManager` field anywhere in the ancestor chain – allow any CLI.
    return { blocked: false };
  }

  if (detectedPM === projectPM) {
    return { blocked: false, detectedPM, projectPM };
  }

  const message =
    `Package manager mismatch: this project requires \`${projectPM}\` ` +
    `(set in the \`packageManager\` field of package.json) ` +
    `but the command uses \`${detectedPM}\`. ` +
    `Please re-run the command with \`${projectPM}\` instead.`;

  return { blocked: true, detectedPM, projectPM, message };
}
