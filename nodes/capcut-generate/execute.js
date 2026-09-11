const path = require('path');
const { spawnPython } = require('../../backend/engine/runner');

module.exports = async function execute(inputs, config, context) {
  const onLine = (line) => {
    if (!line) return;
    if (line.startsWith('PROGRESS\t')) {
      const [, percentStr, message] = line.split('\t');
      context.progress(Number(percentStr) || 0, message || '');
    } else {
      context.log(line);
    }
  };

  const result = await spawnPython(
    path.join(__dirname, 'executor.py'),
    { inputs, config },
    onLine
  );

  context.log(`CapCut project created: ${result.project_path}`);
  return result;
};
