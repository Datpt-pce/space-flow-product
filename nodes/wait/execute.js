function toMs(amount, unit) {
  const n = Number(amount) || 0;
  switch (unit) {
    case 'minutes': return n * 60 * 1000;
    case 'hours': return n * 60 * 60 * 1000;
    default: return n * 1000;
  }
}

module.exports = async function execute(inputs, config) {
  const ms = toMs(config.amount ?? 1, config.unit || 'seconds');
  if (ms > 0) await new Promise(resolve => setTimeout(resolve, ms));
  return { items: inputs.items || [] };
};
