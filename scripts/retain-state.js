require('../backend/utils/runtimeConfig').preflight();
const db = require('../backend/db');
try { console.log(JSON.stringify(require('../backend/services/retention').retention(db, { apply: process.argv.includes('--apply') }))); }
finally { db.close(); }
