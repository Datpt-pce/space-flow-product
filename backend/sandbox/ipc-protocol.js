// IPC protocol between the Sandbox Host and a worker process — Platform Core Phase 0.2 spike.
// See specs/space-flow-master-plan/00-platform-core.md Phase 0.2 and
// docs/decisions/0008-custom-node-sandbox-architecture.md.
//
// Parent -> child: one JSON object written to stdin, then stdin is closed.
//   { executorPath, inputs, config, capabilityGrants }
// Child -> parent: newline-delimited JSON messages on stdout, one per line.
//   { type: 'log', message, level }
//   { type: 'progress', percent, message }
//   { type: 'outputs', outputs }  -- terminal, at most one
//   { type: 'error', message, stack? }  -- terminal, at most one

const MESSAGE_TYPES = Object.freeze({
  LOG: 'log',
  PROGRESS: 'progress',
  OUTPUTS: 'outputs',
  ERROR: 'error',
});

function encodeLine(type, payload) {
  return JSON.stringify({ type, ...payload }) + '\n';
}

function writeMessage(stream, type, payload) {
  stream.write(encodeLine(type, payload));
}

// Incremental line splitter — a child process's stdout can deliver partial lines
// split across 'data' chunk boundaries, so messages can't be parsed chunk-by-chunk directly.
class LineDecoder {
  constructor(onMessage) {
    this._buffer = '';
    this._onMessage = onMessage;
  }

  push(chunk) {
    this._buffer += chunk.toString('utf8');
    let idx;
    while ((idx = this._buffer.indexOf('\n')) !== -1) {
      const line = this._buffer.slice(0, idx);
      this._buffer = this._buffer.slice(idx + 1);
      if (!line.trim()) continue;
      try {
        this._onMessage(JSON.parse(line));
      } catch (err) {
        this._onMessage({ type: MESSAGE_TYPES.ERROR, message: `Malformed IPC line: ${err.message}` });
      }
    }
  }
}

module.exports = { MESSAGE_TYPES, encodeLine, writeMessage, LineDecoder };
