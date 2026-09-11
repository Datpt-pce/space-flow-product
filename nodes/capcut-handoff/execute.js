const { runCapcutJob } = require('../../backend/agent/capcutJob');
module.exports = async function execute(inputs, config) {
  const delivery = inputs?.verified_video;
  if (!delivery || delivery.kind !== 'VerifiedVideo' || typeof delivery.path !== 'string' || !/^[a-f0-9]{64}$/.test(delivery.sha256 || '')) {
    throw new Error('Cần VerifiedVideo có đường dẫn và SHA-256 của bản render đã xác minh.');
  }
  const result = await runCapcutJob({ operation: 'prepare', delivery, build: config?.build, name: config?.name, acceptFlattening: config?.acceptFlattening === true });
  return { capcut_package: result, capability_report: result.report };
};
