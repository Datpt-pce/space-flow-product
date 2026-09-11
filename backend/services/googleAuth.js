const { OAuth2Client } = require('google-auth-library');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Verify a Google Identity Services ID token from the frontend and return the
// profile fields we care about. Throws if the token is invalid/expired/wrong audience.
async function verifyGoogleIdToken(idToken) {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name || payload.email,
    avatarUrl: payload.picture || null,
  };
}

module.exports = { verifyGoogleIdToken };
