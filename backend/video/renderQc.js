// Unsupported motion must be caught before enqueue/worker dispatch, not silently
// replaced by static transforms in the exported file. Constant markers are safe.
function renderCapabilityIssues(document) {
  const issues = [];
  for (const track of document.tracks || []) {
    if (track.visible === false) continue;
    for (const clip of track.clips || []) {
      for (const key of ['scaleX', 'scaleY', 'rotation', 'pivotX', 'pivotY']) {
        const keys = (clip.keyframes || []).filter(k => k.propertyPath === `transform.${key}`);
        const base = clip.transform?.[key] ?? ({ scaleX: 1, scaleY: 1, rotation: 0, pivotX: .5, pivotY: .5 })[key];
        if (keys.some(k => k.value !== base)) issues.push({ type: 'capability', severity: 'error', source: 'renderer', owner: 'timeline-owner', path: `/tracks/${track.id}/clips/${clip.id}/transform/${key}`, timeMs: clip.timelineInMs, clipId: clip.id, property: key,
          message: `Chuyển động ${key} chưa xuất được chính xác. Bỏ keyframe của thuộc tính này hoặc dùng clip đã dựng chuyển động trước khi xuất.`, remediation: 'edit-keyframes' });
      }
    }
  }
  return issues;
}
function assertRenderable(document) {
  const issues = renderCapabilityIssues(document);
  if (issues.length) throw Object.assign(new Error(issues.map(i => i.message).join(' ')), { status: 422, issues });
}
module.exports = { renderCapabilityIssues, assertRenderable };
