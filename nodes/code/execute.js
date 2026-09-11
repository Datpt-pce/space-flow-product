const vm = require('vm');
const { toItems, fromItems } = require('../../backend/utils/items');

module.exports = async function execute(inputs, config, context) {
  const code = config.code || '';
  const log = context?.log || (() => {});

  // Item[] envelope applies only when the connected data is actually an item list —
  // input/output stay raw ("any") for scalar values (docs/product/nodes/code.md).
  const rawInput = inputs.input;
  const sandboxInput = Array.isArray(rawInput) ? fromItems(rawInput) : rawInput;

  const sandbox = {
    input: sandboxInput,
    config,
    log,
    console: { log: (...args) => log(args.map(String).join(' ')) },
  };
  vm.createContext(sandbox);

  let output;
  try {
    output = vm.runInContext(`(function(){\n${code}\n})()`, sandbox, { timeout: 5000 });
    if (output && typeof output.then === 'function') output = await output;
  } catch (err) {
    throw new Error(`Code node error: ${err.message}`);
  }

  return { output: Array.isArray(output) ? toItems(output) : output };
};
