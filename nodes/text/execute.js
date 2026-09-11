module.exports = async function execute(inputs, config) {
  const content = inputs?.text_in || config?.content || '';
  return { text: content };
};
