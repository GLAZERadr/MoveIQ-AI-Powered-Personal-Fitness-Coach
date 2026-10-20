// Copies OAuth credentials from .env.auth.local to the Vercel project (production, sensitive),
// then redeploys. Values are never printed. Usage: npm run auth:push
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'];
const env = Object.fromEntries(
  readFileSync('.env.auth.local', 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]),
);
const vercel = (args, input) => spawnSync('npx', ['vercel@latest', ...args], { cwd: 'server', input, encoding: 'utf8' });

let pushed = 0;
for (const k of KEYS) {
  if (!env[k]) {
    console.log(`- ${k}: empty, skipped`);
    continue;
  }
  vercel(['env', 'rm', k, 'production', '--yes']);
  const r = vercel(['env', 'add', k, 'production', '--sensitive'], env[k]);
  console.log(`- ${k}: ${r.status === 0 ? 'saved to Vercel (sensitive)' : 'FAILED'}`);
  if (r.status === 0) pushed++;
}
for (const p of ['GOOGLE', 'GITHUB']) {
  if (!!env[`${p}_CLIENT_ID`] !== !!env[`${p}_CLIENT_SECRET`]) console.log(`! ${p}: need both CLIENT_ID and CLIENT_SECRET, or the provider stays off`);
}
if (pushed) {
  console.log('Redeploying…');
  const d = vercel(['deploy', '--prod', '--yes']);
  console.log(d.status === 0 ? 'Deployed.' : 'Deploy FAILED: ' + (d.stderr || '').trim().split('\n').pop());
  const res = await fetch('https://moveiq-api.vercel.app/v1/auth/providers').then((r) => r.json());
  console.log('Enabled providers:', res.providers.join(', ') || '(none)');
}
