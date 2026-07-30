const { getCredential, applyAuth } = require('../../backend/utils/credentials');

module.exports = async function execute(inputs, config) {
  const url = inputs?.url_in || config.url;
  if (!url) throw new Error('Missing URL (config.url hoặc input url_in)');

  const headers = { ...(config.headers || {}) };
  const qs = { ...(config.query || {}) };
  applyAuth(getCredential(config.credentialName), { headers, qs });

  const fullUrl = new URL(url);
  for (const [k, v] of Object.entries(qs)) fullUrl.searchParams.set(k, v);

  const method = config.method || 'GET';
  const hasBody = method !== 'GET' && method !== 'DELETE' && config.body && Object.keys(config.body).length > 0;
  if (hasBody && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const res = await fetch(fullUrl, {
    method,
    headers,
    body: hasBody ? JSON.stringify(config.body) : undefined,
  });

  const rawText = await res.text();
  let json;
  try {
    json = JSON.parse(rawText);
  } catch {
    json = rawText;
  }

  return {
    items: [{ json, binary: undefined }],
    status_code: res.status,
    raw_text: rawText,
  };
};
