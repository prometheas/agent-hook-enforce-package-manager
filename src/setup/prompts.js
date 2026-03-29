import readline from 'node:readline';

/**
 * Ask a yes/no question. Defaults to yes (enter = yes).
 * @param {string} question
 * @returns {Promise<boolean>}
 */
export function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} (Y/n) `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() !== 'n');
    });
  });
}

/**
 * Multi-select from a numbered list. Pre-selected items shown with ●.
 * Pressing Enter with no input accepts the pre-selection.
 * @param {string} question
 * @param {Array<{ value: string, label: string }>} options
 * @param {string[]} preSelected  values pre-checked
 * @returns {Promise<string[]>} selected values
 */
export function multiSelect(question, options, preSelected = []) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const prompt = [
      question,
      ...options.map((o, i) => {
        const mark = preSelected.includes(o.value) ? '●' : '○';
        return `  ${i + 1}) [${mark}] ${o.label}`;
      }),
      'Enter numbers separated by spaces (or press Enter for defaults): ',
    ].join('\n');
    rl.question(prompt, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      if (!trimmed) {
        resolve(preSelected);
        return;
      }
      const selected = trimmed
        .split(/\s+/)
        .map((n) => parseInt(n, 10) - 1)
        .filter((i) => i >= 0 && i < options.length)
        .map((i) => options[i].value);
      resolve(selected.length > 0 ? selected : preSelected);
    });
  });
}
