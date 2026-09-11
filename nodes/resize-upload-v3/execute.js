const path = require('path');
const { spawnPython } = require('../../backend/engine/runner');
const { itemToPath, pathToItem } = require('../../backend/utils/items');

async function run(inputs, config, context, runMode = 'full', action) {
  const catalog = config.__resolved_v3_catalog || require('../../backend/utils/resizeUploadV3Catalog').getCatalogs(context.userId).effective;
  const token = config.__resolved_asana_pat !== undefined ? config.__resolved_asana_pat
    : require('../../backend/utils/credentials').getCredential(config.asana_credential_name, context.userId)?.data?.token || '';
  return spawnPython(path.join(__dirname, 'executor.py'), {
    inputs: { ...inputs, folders_in: (inputs.folders_in || []).map(item => typeof item === 'string' ? item : itemToPath(item)).filter(Boolean) },
    config, catalog, settings: { asana_pat_main: token }, run_mode: runMode, action,
  }, line => {
    if (line.startsWith('PROGRESS\t')) {
      const [, percent, message] = line.split('\t');
      context.progress?.(Number(percent) || 0, message || '');
    } else if (line.startsWith('ROWRESULT\t')) {
      try { context.rowResult?.(JSON.parse(line.slice(10))); } catch { /* malformed progress */ }
    } else if (line) context.log?.(line);
  });
}

module.exports = async function execute(inputs, config, context) {
  const result = await run(inputs, config, context, config.run_mode === 'upload_only' ? 'upload_only' : 'full');
  if (result.needs_confirmation) throw new Error('Có folder dưới 5 video. Mở V3 → Kiểm tra Input → Vẫn chạy tiếp.');
  if (!result.success) throw new Error(Object.values(result.rows).filter(row => row.status === 'error').map(row => row.error).join('; '));
  return { ...result, files_out: result.files_out.map(file => pathToItem(file)), thumbnail_files: result.thumbnail_files.map(file => pathToItem(file)) };
};
module.exports.run = run;
