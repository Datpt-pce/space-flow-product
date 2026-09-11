module.exports = async function execute(inputs, config) {
  const errorType = config.errorType || 'errorMessage';

  let message;
  if (errorType === 'errorObject') {
    const obj = config.errorObject || {};
    message = obj.message || obj.description || obj.error || JSON.stringify(obj);
  } else {
    message = config.errorMessage || 'Stopped by Stop And Error node';
  }

  throw new Error(message);
};
