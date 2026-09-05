const path = require('path');
const { spawnPython } = require('../../backend/engine/runner');
const { itemToPath, pathToItem } = require('../../backend/utils/items');
const { getCredential } = require('../../backend/utils/credentials');
const { getLinkCatalog } = require('../../backend/utils/linkCatalog');

module.exports = async function execute(inputs, config, context) {
  // backend/routes/execute.js pre-resolves these into config before relaying the workflow to an
  // agent (agent's own DB has no access to the central credentials/resize_link_catalogs tables) —
  // fall back to resolving directly only when running un-relayed (dev/agent mode, same process).
  const asanaPat = config.__resolved_asana_pat !== undefined
    ? config.__resolved_asana_pat
    : (getCredential(config.asana_credential_name, context?.userId)?.data?.token || '');
  const custom_links = config.__resolved_links !== undefined
    ? config.__resolved_links
    : getLinkCatalog(context?.userId);
  const settings = { asana_pat_main: asanaPat };

  const onLine = (line) => {
    if (!line) return;
    if (line.startsWith('PROGRESS\t')) {
      const [, percentStr, message] = line.split('\t');
      context.progress(Number(percentStr) || 0, message || '');
    } else if (line.startsWith('ROWRESULT\t')) {
      try {
        context.rowResult(JSON.parse(line.slice('ROWRESULT\t'.length)));
      } catch { /* ignore malformed row result line */ }
    } else {
      context.log(line);
    }
  };

  // executor.py's stdin contract expects plain folder path strings — unwrap the
  // Item[] at this JS boundary, the Python script itself is untouched.
  const foldersIn = Array.isArray(inputs.folders_in) ? inputs.folders_in.map(it => itemToPath(it)) : inputs.folders_in;

  const result = await spawnPython(
    path.join(__dirname, 'executor.py'),
    { inputs: { ...inputs, folders_in: foldersIn }, config, settings, custom_links },
    onLine
  );

  context.log(`Xong: ${result.files_out.length} video, ${result.unc_links.length} UNC`);
  // unc_links are plain link strings (not files) — left untouched; files_out is a
  // genuine file-path list, wrapped into the standard Item[] envelope.
  return { ...result, files_out: result.files_out.map(p => pathToItem(p)) };
};
