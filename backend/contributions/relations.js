const { hash } = require('./policy');
const { TERMINAL } = require('./jobs');
const { safeName } = require('./source');

function tokens(title) {
  const stop = new Set(['the', 'and', 'for', 'with', 'feat', 'fix', 'them', 'sua', 'cho', 'cua', 'mot', 'trong', 'va', 'khi']);
  return new Set(title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase()
    .split(/[^a-z0-9]+/).filter(word => word.length > 2 && !stop.has(word)));
}
function area(filename) {
  const parts = filename.split('/');
  if (parts[0] === 'nodes') return parts.slice(0, 2).join('/');
  if (parts[0] === 'frontend') return parts.slice(0, 3).join('/');
  return parts.slice(0, 2).join('/');
}
function relationContext(job, all) {
  const active = all.filter(item => !TERMINAL.has(item.status) && item.sourceState !== 'closed');
  const peers = active.filter(item => item.id !== job.id);
  const filesOf = item => [...new Set((item.source?.files || []).flatMap(file => [file.filename, file.previousFilename]).filter(name => safeName(name) && !name.startsWith('docs/')))];
  const ownFiles = filesOf(job); const ownAreas = new Set(ownFiles.map(area)); const ownTokens = tokens(job.title);
  const related = [];
  for (const peer of peers.slice(0, 200)) {
    const peerFiles = filesOf(peer); const overlap = peerFiles.filter(name => ownFiles.includes(name));
    const sharedAreas = [...new Set(peerFiles.map(area).filter(name => ownAreas.has(name)))];
    const words = tokens(peer.title); const intersection = [...words].filter(word => ownTokens.has(word)).length;
    const similarity = intersection / Math.max(1, new Set([...ownTokens, ...words]).size);
    const possibleDuplicate = intersection >= 3 && similarity >= 0.55;
    if (overlap.length || sharedAreas.length || possibleDuplicate) related.push({ id: peer.id, title: peer.title,
      number: peer.source?.number || null, revision: peer.revision, overlap: overlap.slice(0, 20),
      overlapCount: overlap.length, sharedAreas: sharedAreas.slice(0, 10), possibleDuplicate,
      reasons: [...(possibleDuplicate ? ['Mục tiêu có thể trùng (ước tính từ tiêu đề)'] : []),
        ...(overlap.length ? [`Cùng sửa ${overlap.length} file; cần kiểm tra cách ghép thay đổi`] : sharedAreas.length ? ['Cùng khu vực chức năng; có thể ảnh hưởng nhau'] : [])] });
  }
  const fingerprint = hash(active.map(item => [item.id, item.revision, item.fingerprint]).sort(([a], [b]) => a.localeCompare(b)));
  return { comparedCount: Math.min(peers.length, 200), totalOpen: active.length, truncated: peers.length > 200,
    fingerprint, reviewChanged: !!job.comparisonSnapshot && job.comparisonSnapshot.fingerprint !== fingerprint,
    related: related.sort((a, b) => b.overlapCount - a.overlapCount || Number(b.possibleDuplicate) - Number(a.possibleDuplicate)),
    checkedAt: Date.now(), combinedTested: false,
    limitation: 'Đối chiếu tiêu đề và file của các yêu cầu đã đồng bộ. Chưa kiểm thử kết hợp; phụ thuộc gián tiếp, API và dữ liệu chung có thể chưa được phát hiện.' };
}
function comparisonSnapshot(job, all) {
  const context = relationContext(job, all); const relatedIds = new Set(context.related.map(item => item.id));
  const peers = all.filter(item => item.id !== job.id && !TERMINAL.has(item.status) && item.sourceState !== 'closed')
    .sort((a, b) => Number(relatedIds.has(b.id)) - Number(relatedIds.has(a.id)));
  return { fingerprint: context.fingerprint, capturedAt: Date.now(), total: peers.length, truncated: peers.length > 20,
    requests: peers.slice(0, 20).map(item => ({ id: item.id, number: item.source?.number || null, title: item.title,
      description: (item.description || '').slice(0, 800), revision: item.revision,
      files: (item.source?.files || []).slice(0, 20).map(file => file.filename) })) };
}
module.exports = { relationContext, comparisonSnapshot };
