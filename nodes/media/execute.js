module.exports = async function execute(inputs, config) {
  return { file: config?.file_path || '' };
};
