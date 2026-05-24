const crypto = require('crypto');

const password = process.argv[2];

if (!password) {
  console.error('Uso: npm run hash-password -- "minha-senha"');
  process.exit(1);
}

const iterations = 310000;
const keyLength = 32;
const digest = 'sha256';
const salt = crypto.randomBytes(16).toString('base64url');
const hash = crypto.pbkdf2Sync(password, salt, iterations, keyLength, digest).toString('base64url');

process.stdout.write(`pbkdf2:${iterations}:${salt}:${hash}`);
