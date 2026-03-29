import fs from 'node:fs';
import { AGENTS } from '../agents.js';
import { readJsonFile, writeJsonFile, mergeHookConfig, detectInstalledAgents } from '../installer.js';
import { confirm, multiSelect } from './prompts.js';

const LOCAL_BIN = './node_modules/.bin/enforce-package-manager';
const PACKAGE_NAME = 'agent-hook-enforce-package-manager';

/** Parse CLI args into an options object. */
function parseArgs(args) {
  const opts = { agents: null, yes: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--yes' || arg === '-y') opts.yes = true;
    else if (arg === '--agents') opts.agents = args[++i]?.split(',').map((s) => s.trim());
    else if (arg.startsWith('--agents=')) opts.agents = arg.slice(9).split(',').map((s) => s.trim());
  }
  return opts;
}

/** Check if this package is already listed as a dependency in package.json. */
function isListedAsDep() {
  try {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    return !!(pkg.dependencies?.[PACKAGE_NAME] || pkg.devDependencies?.[PACKAGE_NAME]);
  } catch {
    return false;
  }
}

/**
 * Run the setup flow.
 * @param {string[]} args - process.argv after 'setup'
 */
export async function runSetup(args = []) {
  const opts = parseArgs(args);

  console.log('\nenforce-package-manager setup\n');

  // ── 1. Advisory: suggest adding as devDep if not already listed ───────
  if (!isListedAsDep()) {
    console.log(`Tip: add ${PACKAGE_NAME} as a devDependency so it installs automatically for all contributors:`);
    console.log(`  npm install --save-dev ${PACKAGE_NAME}`);
    console.log(`  pnpm add --save-dev ${PACKAGE_NAME}`);
    console.log(`  yarn add --dev ${PACKAGE_NAME}`);
    console.log(`  bun add --dev ${PACKAGE_NAME}\n`);
  }

  // ── 2. Select agents ───────────────────────────────────────────────────
  let selectedAgentIds;
  if (opts.agents) {
    selectedAgentIds = opts.agents.filter((id) => AGENTS.some((a) => a.id === id));
  } else if (opts.yes) {
    const detected = detectInstalledAgents(AGENTS);
    selectedAgentIds = detected.length > 0 ? detected.map((a) => a.id) : ['claude'];
  } else {
    const detected = detectInstalledAgents(AGENTS);
    const defaults = detected.map((a) => a.id);
    selectedAgentIds = await multiSelect(
      'Which AI coding agents do you want to configure?',
      AGENTS.map((a) => ({ value: a.id, label: a.name })),
      defaults.length > 0 ? defaults : ['claude'],
    );
  }

  const selectedAgents = AGENTS.filter((a) => selectedAgentIds.includes(a.id));
  if (selectedAgents.length === 0) {
    console.log('No agents selected. Nothing to do.');
    return;
  }

  // ── 3. Write/merge each agent's config ────────────────────────────────
  console.log('');
  for (const agent of selectedAgents) {
    const newConfig = agent.generateConfig(LOCAL_BIN);
    const existing = readJsonFile(agent.configPath);
    const merged = mergeHookConfig(existing, newConfig);
    writeJsonFile(agent.configPath, merged);
    console.log(`  ✓  ${agent.name}: ${agent.configPath}`);
  }

  // ── 4. Remind to commit ───────────────────────────────────────────────
  const configFiles = selectedAgents.map((a) => a.configPath).join(' ');
  console.log('\nCommit these files to share the hook config with your team:\n');
  console.log(`  git add ${configFiles}`);
  console.log(`  git commit -m "chore: add enforce-package-manager hook for AI agents"\n`);
}
