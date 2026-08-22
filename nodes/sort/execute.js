const vm = require('vm');
const { getPath } = require('../../backend/utils/dotPath');
const { toItems, fromItems } = require('../../backend/utils/items');

function compareValues(av, bv) {
  if (av === bv) return 0;
  if (av === undefined || av === null) return -1;
  if (bv === undefined || bv === null) return 1;
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  return String(av).localeCompare(String(bv));
}

module.exports = async function execute(inputs, config, context) {
  const items = fromItems(inputs.items || []);
  const type = config.type || 'simple';

  if (type === 'random') {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return { items: toItems(result) };
  }

  if (type === 'code') {
    const code = config.code || 'return 0;';
    const log = context?.log || (() => {});
    // Sort itself runs *inside* the vm (not just the comparator factory), so the
    // 5s timeout bounds the whole operation — a runaway comparator can't hang
    // the process the way it would if only the function creation were sandboxed.
    const sandbox = {
      items: [...items],
      log,
      console: { log: (...args) => log(args.map(String).join(' ')) },
    };
    vm.createContext(sandbox);

    const script = `items.sort(function(a, b) {\n${code}\n}); items;`;
    let result;
    try {
      result = vm.runInContext(script, sandbox, { timeout: 5000 });
    } catch (err) {
      throw new Error(`Sort code error: ${err.message}`);
    }
    return { items: toItems(result) };
  }

  const sortFields = config.sortFields || [];
  const result = [...items].sort((a, b) => {
    for (const { field, order } of sortFields) {
      if (!field) continue;
      const cmp = compareValues(getPath(a, field), getPath(b, field));
      if (cmp !== 0) return order === 'desc' ? -cmp : cmp;
    }
    return 0;
  });

  return { items: toItems(result) };
};
