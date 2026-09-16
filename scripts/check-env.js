const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) {
  console.error('❌ .env file not found. Copy .env.example → .env and fill in ANTHROPIC_API_KEY');
  process.exit(1);
}

const content = fs.readFileSync(envPath, 'utf8');
if (!content.includes('ANTHROPIC_API_KEY=sk-ant-')) {
  console.warn('⚠️  ANTHROPIC_API_KEY may not be set correctly in .env');
}

console.log('✅ .env found — installing dependencies...');
