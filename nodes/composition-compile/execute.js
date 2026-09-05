module.exports = async function execute(inputs, config, context) {
  if (!context?.userId) throw new Error('Thiếu người dùng thực thi workflow.');
  const ref = inputs?.creative_variant;
  if (ref != null && (ref.kind !== 'CreativeVariantVersionRef' || typeof ref.versionId !== 'string')) throw new Error('Cần CreativeVariantVersionRef có versionId.');
  const id = config?.creativeVersionId || ref?.versionId;
  if (!id) throw new Error('Chọn mã phiên bản biến thể đã tạo trong Video Editor.');
  const service = require('../../backend/routes/video-automation').service;
  const creative = service.input(context.userId, id, 'creative-variant');
  const result = service.materializeVersion(context.userId, { creativeVersionId: id, name: creative.name, idempotencyKey: `workflow-compile:${id}` });
  return {
    timeline_collection: { kind: 'TimelineCollectionRef', projectId: result.projectId, versionId: result.versionId },
    composition_plan: result.plan,
    compile_report: result.report,
  };
};
