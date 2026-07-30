const path = require('path');
const { spawnPython } = require('../../backend/engine/runner');

module.exports = async function execute(inputs, config, context) {
  if (!Array.isArray(inputs.files_in) || inputs.files_in.length === 0)
    throw new Error('No input files connected');

  const result = await spawnPython(
    path.join(__dirname, 'executor.py'),
    { inputs, config }
  );

  context.log(`Done: ${result.files_out.length} file(s) saved`);
  return result;
};
