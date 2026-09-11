// Shared naming for Lab timelines, downloads and ZIP entries. Keep within the
// existing 120-character timeline limit and portable filesystem byte limits.
function batchOutputName(names) {
  let stem = names.map(name => String(name || 'asset').split(/[\\/]/).pop()
    .replace(/\.(mp4|mov|mkv|webm|avi|m4v|png|jpe?g|webp|gif|wav|mp3|aac|m4a|ogg|flac)$/i, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')).join('_').replace(/[. ]+$/, '') || 'video';
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(stem)) stem = `_${stem}`;
  while (stem.length > 120 || Buffer.byteLength(stem, 'utf8') > 200) stem = Array.from(stem).slice(0, -1).join('');
  return stem.replace(/[. ]+$/, '') || 'video';
}
module.exports = { batchOutputName };
