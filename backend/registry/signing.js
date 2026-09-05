// Custom Node Platform Phase 7 (specs/space-flow-master-plan/01-custom-node-platform.md):
// self-managed Ed25519 signing — an admin's approve action signs a Published version's exact
// archive bytes; install-from-registry independently re-verifies against the public key before
// trusting/installing them.
//
// Uses Node's BUILT-IN `crypto` Ed25519 support (generateKeyPairSync/sign/verify — stable since
// Node 12, no external dependency) instead of shelling out to the `cosign` CLI the plan's §3
// research named. This is a deliberate deviation, not a shortcut: with Fulcio/OIDC keyless
// signing and the Rekor transparency log both already rejected by the plan itself as
// over-engineering for a 1-team internal registry, what's left of "cosign" for this use case is
// exactly sign-blob/verify-blob over a self-managed key — which native `crypto` does natively,
// with zero new dependency, identically on native Windows dev, the Docker Linux pipeline host,
// and the pm2-native production server (unlike bwrap/Syft/Grype, all Linux/Docker-only). See
// docs/decisions/0029-registry-signing-key-storage.md.
//
// Private key storage: a local PEM file (signing-key.pem, gitignored, NOT committed, NOT in the
// DB) encrypted at rest with a passphrase from SIGNING_KEY_PASSPHRASE (.env — never the key
// material itself). This project has no actual KMS/secret-manager integration anywhere (checked:
// backend/utils/credentials.js stores credential values as PLAIN JSON in SQLite, no encryption
// at all) — a passphrase-encrypted local file is a real improvement over that existing pattern
// (not queryable via a SQL access bug, not readable without the .env passphrase) without taking
// on a cloud KMS dependency this self-hosted, team-scale app has no infrastructure for. See 0029
// for the full reasoning and what "real KMS" would take instead.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEY_PATH = path.join(__dirname, 'signing-key.pem');

function passphrase() {
  const p = process.env.SIGNING_KEY_PASSPHRASE;
  if (!p) {
    throw new Error('SIGNING_KEY_PASSPHRASE chưa được set trong .env — cần để tạo/mở khoá signing key. Xem .env.example.');
  }
  return p;
}

// keyFingerprint: short, stable identifier for a public key — sha256 of its raw SPKI DER bytes,
// first 16 hex chars (enough to disambiguate a small number of historical keys after rotation,
// not meant as a full hash comparison — node_signatures.key_fingerprint is what a signature
// verification looks up to know WHICH public key it was signed against).
function keyFingerprint(publicKey) {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
}

// getOrCreateSigningKey() -> { publicKey: KeyObject, privateKey: KeyObject, fingerprint }
// Bootstraps a keypair on first call (idempotent after that — reads the existing file). Never
// logs or returns the raw private key material; callers only ever get KeyObjects to sign with.
function getOrCreateSigningKey() {
  if (!fs.existsSync(KEY_PATH)) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const encryptedPem = privateKey.export({
      type: 'pkcs8',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase: passphrase(),
    });
    fs.writeFileSync(KEY_PATH, encryptedPem, { mode: 0o600 });
  }

  const encryptedPem = fs.readFileSync(KEY_PATH, 'utf8');
  const privateKey = crypto.createPrivateKey({ key: encryptedPem, format: 'pem', passphrase: passphrase() });
  const publicKey = crypto.createPublicKey(privateKey);
  return { publicKey, privateKey, fingerprint: keyFingerprint(publicKey) };
}

// getPublicKeyInfo() -> { pem, fingerprint } — safe to expose over HTTP (backend/routes/
// registry-public.js), never touches the private key or requires the passphrase to already be
// correct for anything sensitive (createPublicKey from a KeyObject needs no passphrase).
function getPublicKeyInfo() {
  const { publicKey, fingerprint } = getOrCreateSigningKey();
  return { pem: publicKey.export({ type: 'spki', format: 'pem' }), fingerprint };
}

// signArchive(buffer) -> { signature (base64), fingerprint } — signs the exact archive bytes,
// not a derived checksum, so a 1-byte tamper anywhere in the stored .sfpkg invalidates the
// signature directly (Phase 7 acceptance criteria).
function signArchive(buffer) {
  const { privateKey, fingerprint } = getOrCreateSigningKey();
  const signature = crypto.sign(null, buffer, privateKey).toString('base64');
  return { signature, fingerprint };
}

// verifyArchive(buffer, signatureBase64, publicKeyPem) -> boolean — pure crypto verification
// against a public key PEM string, independent of any local key file. This is the function an
// "install from registry" flow calls after downloading bytes+signature+public key over HTTP
// (backend/routes/registry-public.js) — it does not read KEY_PATH or need the passphrase at all,
// matching what a genuinely separate machine could do with only what it downloaded.
function verifyArchive(buffer, signatureBase64, publicKeyPem) {
  try {
    const publicKey = crypto.createPublicKey(publicKeyPem);
    return crypto.verify(null, buffer, publicKey, Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}

module.exports = { getOrCreateSigningKey, getPublicKeyInfo, signArchive, verifyArchive, keyFingerprint };
