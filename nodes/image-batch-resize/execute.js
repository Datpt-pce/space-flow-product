const path = require('path');
const { spawnPython } = require('../../backend/engine/runner');
const { itemToPath, pathToItem } = require('../../backend/utils/items');

module.exports = async function execute(inputs, config, context) {
  if (!Array.isArray(inputs.files_in) || inputs.files_in.length === 0)
    throw new Error('No input files connected');

  // executor.py's stdin contract expects plain path strings — unwrap the Item[] at
  // this JS boundary, the Python script itself is untouched.
  const filesIn = inputs.files_in.map(it => itemToPath(it));
  const result = await spawnPython(
    path.join(__dirname, 'executor.py'),
    { inputs: { ...inputs, files_in: filesIn }, config }
  );

  context.log(`Done: ${result.files_out.length} file(s) saved`);
  const mimeType = config.output_format === 'jpg' ? 'image/jpeg' : 'image/png';
  return { files_out: result.files_out.map(p => pathToItem(p, { mimeType })) };
};
