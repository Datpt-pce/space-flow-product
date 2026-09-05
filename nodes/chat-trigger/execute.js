module.exports = async function execute(inputs, config) {
  return { message: config.message || '' };
};
