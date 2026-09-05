// Sheet Phase 4 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 4 task checklist):
// "backend/routes/google-oauth.js (tách khỏi auth.js): GET /connect ... GET /callback ...".
// Separate router from backend/routes/auth.js on purpose — auth.js's POST /google verifies a
// Google Identity Services ID token (no refresh token, no offline access); this is a completely
// different OAuth flow (authorization-code, access_type=offline) for a different purpose
// (reading the user's OWN Google Sheets later, not identifying who they are).

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const googleOAuthClient = require('../services/googleOAuthClient');

const router = express.Router();

// In-memory only, same acceptable-for-this-scope tradeoff as backend/engine/scheduler.js's
// `active` Map — a server restart mid-flow just means the user retries "Connect Google Sheets"
// from scratch, no data loss. Prevents a stray/forged `state` from completing someone else's
// OAuth flow (the actual CSRF-hardening purpose of the `state` param).
const pendingStates = new Map(); // state -> { userId, expiresAt }
const STATE_TTL_MS = 5 * 60 * 1000;

function pruneExpiredStates() {
  const now = Date.now();
  for (const [state, entry] of pendingStates) {
    if (entry.expiresAt < now) pendingStates.delete(state);
  }
}

function appOrigin() {
  const first = (process.env.CORS_ORIGINS || 'http://localhost:5174').split(',')[0].trim();
  return first || 'http://localhost:5174';
}

const connectLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user.id,
  message: { error: 'Quá nhiều lần thử kết nối Google, vui lòng thử lại sau.' },
});

router.get('/status', (req, res) => {
  res.json({ connected: googleOAuthClient.isConnected(req.user.id) });
});

router.get('/connect', connectLimiter, (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({ error: 'Server chưa cấu hình GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET — xem .env.example.' });
  }
  pruneExpiredStates();
  const state = crypto.randomBytes(24).toString('hex');
  pendingStates.set(state, { userId: req.user.id, expiresAt: Date.now() + STATE_TTL_MS });

  const authUrl = googleOAuthClient.buildClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // always return a refresh_token, even on a re-connect
    scope: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    state,
  });
  res.redirect(authUrl);
});

router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const redirectBase = appOrigin();

  if (error) {
    return res.redirect(`${redirectBase}/?googleSheetsConnect=denied`);
  }

  const entry = state && pendingStates.get(String(state));
  if (!entry) {
    return res.redirect(`${redirectBase}/?googleSheetsConnect=invalid_state`);
  }
  pendingStates.delete(String(state));
  if (entry.expiresAt < Date.now() || entry.userId !== req.user.id) {
    return res.redirect(`${redirectBase}/?googleSheetsConnect=invalid_state`);
  }

  try {
    const client = googleOAuthClient.buildClient();
    const { tokens } = await client.getToken(String(code));
    if (!tokens.refresh_token) {
      // Shouldn't happen with prompt=consent, but Google can still omit it in edge cases
      // (e.g. an app already authorized under a Google Cloud org policy) — fail clearly instead
      // of silently storing an access-only credential that can't survive past its short TTL.
      return res.redirect(`${redirectBase}/?googleSheetsConnect=no_refresh_token`);
    }
    googleOAuthClient.saveRefreshToken(req.user.id, tokens.refresh_token);
    res.redirect(`${redirectBase}/?googleSheetsConnect=success`);
  } catch (err) {
    console.error('[google-oauth] callback lỗi:', err.message);
    res.redirect(`${redirectBase}/?googleSheetsConnect=error`);
  }
});

router.delete('/disconnect', (req, res) => {
  googleOAuthClient.disconnect(req.user.id);
  res.json({ success: true });
});

module.exports = router;
