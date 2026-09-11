const { greet } = require('local-greeter');

module.exports = async function execute(inputs, config) {
  return { items: [{ message: greet() }] };
};
