function sharedMode(env = process.env) {
  return env.SPACE_FLOW_MODE === 'server' || env.NODE_ENV === 'production';
}

function preflight(env = process.env) {
  if (env.SPACE_FLOW_MODE && !['agent', 'server'].includes(env.SPACE_FLOW_MODE)) {
    throw new Error('SPACE_FLOW_MODE must be agent or server');
  }
  if (env.PORT && (!/^\d+$/.test(env.PORT) || +env.PORT < 1 || +env.PORT > 65535)) throw new Error('Invalid PORT');
  for (const name of ['SF_ARTIFACT_QUOTA_BYTES', 'SF_MIN_FREE_BYTES', 'SF_BACKUP_MAX_AGE_MS']) {
    if (env[name] !== undefined && (!/^\d+$/.test(env[name]) || !Number.isSafeInteger(Number(env[name])) || (name !== 'SF_MIN_FREE_BYTES' && Number(env[name]) === 0))) {
      throw new Error(`${name} must be a valid integer limit`);
    }
  }
  for (const name of ['SF_ALLOW_PLAINTEXT_CREDENTIALS', 'SF_IMPORT_LEGACY']) {
    if (env[name] !== undefined && !['0', '1'].includes(env[name])) throw new Error(`${name} must be 0 or 1`);
  }
  const key = env.CREDENTIALS_ENCRYPTION_KEY;
  if (key && !/^[a-fA-F0-9]{64}$/.test(key)) throw new Error('CREDENTIALS_ENCRYPTION_KEY must contain exactly 64 hex characters');
  if (sharedMode(env) && !key) throw new Error('CREDENTIALS_ENCRYPTION_KEY is required in server/production mode');
  if (sharedMode(env) && env.SF_ALLOW_PLAINTEXT_CREDENTIALS === '1') throw new Error('Plaintext credentials are forbidden in server/production mode');
}

module.exports = { sharedMode, preflight };
