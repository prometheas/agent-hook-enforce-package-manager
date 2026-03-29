import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Read and parse a JSON file. Returns {} on any error (missing, malformed).
 * @param {string} filePath
 * @returns {object}
 */
export function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Write an object as pretty-printed JSON to filePath, creating parent dirs as needed.
 * @param {string} filePath
 * @param {object} obj
 */
export function writeJsonFile(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/**
 * Return true if `entry` references `commandPath` as its executable.
 * Handles both:
 *  - Standard format: { matcher, hooks: [{ command }] }
 *  - Copilot format:  { type, bash }
 *
 * @param {object} entry
 * @param {string} commandPath
 * @returns {boolean}
 */
function entryReferencesCommand(entry, commandPath) {
  if (entry.bash !== undefined) return entry.bash === commandPath;
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some((h) => h.command === commandPath);
  }
  return false;
}

/**
 * Deep-merge newConfig's hook entries into existing without creating duplicates.
 * Existing entries for unrelated commands are preserved.
 * The `version` field from newConfig is propagated if existing lacks one.
 *
 * @param {object} existing
 * @param {object} newConfig
 * @returns {object}
 */
export function mergeHookConfig(existing, newConfig) {
  const result = { ...existing };

  if (newConfig.version !== undefined && result.version === undefined) {
    result.version = newConfig.version;
  }

  if (!newConfig.hooks) return result;

  result.hooks = { ...existing.hooks };

  for (const [event, newEntries] of Object.entries(newConfig.hooks)) {
    const existingEntries = result.hooks[event] ?? [];
    const combined = [...existingEntries];

    for (const newEntry of newEntries) {
      let commandPath;
      if (newEntry.bash) commandPath = newEntry.bash;
      else if (Array.isArray(newEntry.hooks)) commandPath = newEntry.hooks[0]?.command;

      const isDuplicate =
        commandPath !== undefined &&
        combined.some((e) => entryReferencesCommand(e, commandPath));

      if (!isDuplicate) combined.push(newEntry);
    }

    result.hooks[event] = combined;
  }

  return result;
}

/**
 * Detect which agents from the registry appear to be installed on PATH.
 * Uses `which` (macOS/Linux) or `where` (Windows).
 *
 * @param {Array<{ id: string, detectBinary: string }>} agents
 * @returns {Array<{ id: string, detectBinary: string }>}
 */
export function detectInstalledAgents(agents) {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  return agents.filter((agent) => {
    const result = spawnSync(whichCmd, [agent.detectBinary], { stdio: 'pipe' });
    return result.status === 0;
  });
}
