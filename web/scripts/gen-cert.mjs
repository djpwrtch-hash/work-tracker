import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import selfsigned from 'selfsigned';

const certsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'certs');
const keyPath = path.join(certsDir, 'key.pem');
const certPath = path.join(certsDir, 'cert.pem');
const ipsPath = path.join(certsDir, 'lan-ips.json');

function getLanIps() {
  const ips = new Set();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) ips.add(net.address);
    }
  }
  return [...ips].sort();
}

const lanIps = getLanIps();
let cached = null;
try {
  cached = JSON.parse(fs.readFileSync(ipsPath, 'utf8'));
} catch {}

const ipsChanged = JSON.stringify(cached ?? []) !== JSON.stringify(lanIps);
const certsMissing = !fs.existsSync(keyPath) || !fs.existsSync(certPath);

if (!certsMissing && !ipsChanged) {
  console.log('[CERT] Certificates up to date.');
  process.exit(0);
}

const altNames = [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }];
for (const ip of lanIps) altNames.push({ type: 7, ip });

const pems = await selfsigned.generate(
  [{ name: 'commonName', value: 'localhost' }],
  {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }],
  },
);

fs.mkdirSync(certsDir, { recursive: true });
fs.writeFileSync(keyPath, pems.private);
fs.writeFileSync(certPath, pems.cert);
fs.writeFileSync(ipsPath, JSON.stringify(lanIps, null, 2));

console.log(`[CERT] Generated HTTPS certificate for localhost + ${lanIps.join(', ') || '(none)'} in ${certsDir}`);
console.log('');
console.log('[CERT] To use GPS on a phone:');
console.log('  Android: Settings -> Security -> More security settings -> Encryption & credentials ->');
console.log('           Install a certificate -> CA certificate -> select cert.pem, then restart Chrome.');
console.log('  iOS:     Open cert.pem in Safari -> install profile -> Settings -> Profile Downloaded -> Install ->');
console.log('           Settings -> General -> About -> Certificate Trust Settings -> enable full trust for the cert.');
console.log('  Then browse to https://<pc-lan-ip>:42780 and check in.');
