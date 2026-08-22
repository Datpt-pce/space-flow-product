const path = require('path');
const { spawnPython } = require('../../backend/engine/runner');

module.exports = async function execute(inputs, config, context) {
  const result = await spawnPython(path.join(__dirname, 'executor.py'), { inputs, config });
  const appliedCount = result.mapping?.filter(m => m.applied).length || 0;
  context.log(`Đổi tên ${appliedCount} mục`);
  return { files_out: result.files_out, mapping: result.mapping };
};
