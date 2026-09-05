// Security-corpus fixture — attempts to read a file outside the sandbox's scratch bind-mount.
// Expected under real bwrap confinement: fails (ENOENT), because nothing besides /usr, /proc,
// /dev, /tmp and the scratch dir is bound into the mount namespace. Returns the outcome
// instead of throwing so the orchestrating test can assert on it either way.
module.exports = async function execute(inputs) {
  const fs = require('fs');
  const targetPath = inputs.targetPath;
  try {
    const content = fs.readFileSync(targetPath, 'utf8');
    return { read: true, content };
  } catch (err) {
    return { read: false, errorCode: err.code };
  }
};
