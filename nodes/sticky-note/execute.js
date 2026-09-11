module.exports = async function execute(inputs, config) {
  return { text: config?.content || '' };
};
