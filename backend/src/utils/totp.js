// ============================================================
// TOTP — Time-based One-Time Password (RFC 6238) — Geek0thek
// ------------------------------------------------------------
// Implémentation autonome de l'authentification à deux facteurs
// (Google Authenticator) SANS dépendance externe : elle repose
// uniquement sur le module `crypto` natif de Node.js. C'est
// volontairement le cas pour éviter tout module natif (sodium…)
// qui poserait problème au build Docker Alpine (`npm ci`).
//
//   - generateSecret()      : clé secrète aléatoire encodée en Base32
//   - totp(secret, ts?)     : code à 6 chiffres courant
//   - verifyTotp(secret, c) : vérifie un code (tolérance ±1 fenêtre de 30 s)
//   - buildOtpauthUri(...)  : URI otpauth:// pour le QR / la saisie manuelle
// ============================================================

const crypto = require('crypto');

const TOTP_PERIOD = 30; // durée d'un code (secondes) — standard Google Authenticator
const TOTP_DIGITS = 6;  // nombre de chiffres du code
const TOTP_ALGORITHM = 'sha1';

// Alphabet Base32 (RFC 4648), sans padding.
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Encode un Buffer en chaîne Base32 (sans '='). */
function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += B32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/** Décode une chaîne Base32 en Buffer (ignore padding / espaces / casse). */
function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const output = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = B32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) continue; // caractère invalide : ignoré proprement
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

/** Génère une clé secrète aléatoire encodée en Base32 (défaut 20 octets). */
function generateSecret(byteLength = 20) {
  return base32Encode(crypto.randomBytes(byteLength));
}

/**
 * HOTP (RFC 4226) : code à partir d'un compteur.
 * @param {string} secret  clé Base32
 * @param {number|bigint} counter  compteur (big-endian 64 bits)
 */
function hotp(secret, counter) {
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac(TOTP_ALGORITHM, key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(binCode % Math.pow(10, TOTP_DIGITS)).padStart(TOTP_DIGITS, '0');
}

/** Code TOTP courant pour la clé donnée (à l'instant `timestamp` ms). */
function totp(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 1000 / TOTP_PERIOD);
  return hotp(secret, counter);
}

/**
 * Vérifie un code TOTP saisi. Tolérance de ±`window` fenêtre(s) de 30 s
 * pour absorber les décalages d'horloge entre l'appareil et le serveur.
 */
function verifyTotp(secret, code, window = 1) {
  const normalized = String(code ?? '').replace(/\s/g, '');
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(normalized)) return false;
  const current = Math.floor(Date.now() / 1000 / TOTP_PERIOD);
  for (let i = -window; i <= window; i++) {
    if (hotp(secret, current + i) === normalized) return true;
  }
  return false;
}

/**
 * Construit l'URI `otpauth://totp/…` affichée en QR code (ou saisie
 * manuellement dans Google Authenticator).
 */
function buildOtpauthUri({ secret, accountName, issuer = 'Geek0thek' }) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: TOTP_ALGORITHM.toUpperCase(),
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

module.exports = {
  generateSecret,
  totp,
  verifyTotp,
  buildOtpauthUri,
  base32Encode,
  base32Decode,
  TOTP_PERIOD,
  TOTP_DIGITS,
};
