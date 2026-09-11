const { greet } = require('local-evil-dep');

module.exports = async function execute(inputs, config) {
  return { items: [{ json: { message: greet() } }] };
};
