module.exports = async function execute(inputs, config) {
  const incoming = Array.isArray(inputs?.items) ? inputs.items : [];
  const configured = config?.files || [];
  return { files: [...configured, ...incoming] };
};
