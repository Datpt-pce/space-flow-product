#!/usr/bin/env node
// Sandbox Host worker entry point — Platform Core Phase 0.2 spike.
//
// SPIKE SCOPE: proves the IPC message shape only. This still `require()`s the executor
// directly in the same OS process, with no bwrap/namespace isolation and no capability
// enforcement — that isolation is Custom Node Platform Phase 3
// (specs/space-flow-master-plan/01-custom-node-platform.md). capabilityGrants is accepted
// and logged so the wire format already matches what Phase 3 needs, without changing the
// protocol when real enforcement is added.

const { writeMessage, MESSAGE_TYPES } = require('./ipc-protocol');

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const raw = await readStdin();
  let request;
  try {
    request = JSON.parse(raw);
  } catch (err) {
    writeMessage(process.stdout, MESSAGE_TYPES.ERROR, { message: `Invalid request JSON: ${err.message}` });
    process.exitCode = 1;
    return;
  }

  const { executorPath, inputs = {}, config = {}, capabilityGrants = {} } = request;

  writeMessage(process.stdout, MESSAGE_TYPES.LOG, {
    message: `worker starting executorPath=${executorPath} capabilityGrants=${JSON.stringify(capabilityGrants)}`,
    level: 'debug',
  });

  const context = {
    log: (message) => writeMessage(process.stdout, MESSAGE_TYPES.LOG, { message, level: 'debug' }),
    progress: (percent, message) => writeMessage(process.stdout, MESSAGE_TYPES.PROGRESS, { percent, message }),
  };

  try {
    const executeFn = require(executorPath);
    const outputs = await executeFn(inputs, config, context);
    writeMessage(process.stdout, MESSAGE_TYPES.OUTPUTS, { outputs });
  } catch (err) {
    writeMessage(process.stdout, MESSAGE_TYPES.ERROR, { message: err.message, stack: err.stack });
    process.exitCode = 1;
  }
}

main();
