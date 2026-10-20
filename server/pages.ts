/**
 * Public pages required for Google OAuth publishing: home page, privacy policy, terms of service.
 * The privacy policy describes what this codebase actually does; update it whenever data handling changes.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export const POLICY_UPDATED = '2026-10-21 (rev. 3)';

function supportEmail(): string {
  return process.env.SUPPORT_EMAIL || 'support@example.com';
}

function layout(title: string, body: string): string {
  const verification = process.env.GOOGLE_SITE_VERIFICATION
    ? `<meta name="google-site-verification" content="${esc(process.env.GOOGLE_SITE_VERIFICATION)}">`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${verification}
<meta name="description" content="MoveIQ: AI bodyweight training, cutting, running and swimming tracker.">
<link rel="icon" href="/logo.png">
<style>
:root{--bg:#F5F7F6;--fg:#0E1512;--muted:#5B6762;--card:#fff;--accent:#17A858;--border:#DCE3DF}
@media (prefers-color-scheme:dark){:root{--bg:#0A0F0C;--fg:#ECF3EF;--muted:#97A59E;--card:#131A16;--accent:#1FC96B;--border:#26322B}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px 64px}a{color:var(--accent)}
header{display:flex;align-items:center;gap:12px;margin-bottom:24px}header img{width:48px;height:48px;border-radius:12px}
header a{text-decoration:none;color:var(--fg);font-weight:800;font-size:22px}
h1{font-size:30px;line-height:1.2;margin:8px 0 12px}h2{font-size:20px;margin-top:32px}
.card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:16px 20px;margin:12px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.muted{color:var(--muted)}footer{margin-top:48px;padding-top:16px;border-top:1px solid var(--border);color:var(--muted);font-size:14px}
footer a{margin-right:16px}
</style></head><body><main>
<header><img src="/logo.png" alt="MoveIQ logo"><a href="/">MoveIQ</a></header>
${body}
<footer><a href="/">Home</a><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a>
<p>Contact: <a href="mailto:${esc(supportEmail())}">${esc(supportEmail())}</a></p></footer>
</main></body></html>`;
}

export function homePage(): string {
  return layout(
    'MoveIQ: Train Smarter. Live Stronger.',
    `<h1>Train smarter. Live stronger.</h1>
<p>MoveIQ is a mobile fitness app for Android and iOS that brings four things together:</p>
<div class="grid">
  <div class="card"><strong>AI bodyweight training</strong><p class="muted">On-device camera pose detection counts push-ups and squats and gives short form cues. Video never leaves your phone.</p></div>
  <div class="card"><strong>Cutting &amp; nutrition</strong><p class="muted">Weight trend with a 7-day average, calorie and protein tracking, and body measurements.</p></div>
  <div class="card"><strong>Running analytics</strong><p class="muted">Record runs with your phone's GPS (route on an OpenStreetMap map, auto splits) or log them manually, then see pace, weekly distance and records.</p></div>
  <div class="card"><strong>Swimming analytics</strong><p class="muted">Pool and open-water sessions with pace per 100 m, weekly volume and stroke comparison.</p></div>
</div>
<h2>Privacy first</h2>
<p>Your records, including GPS routes, are stored on your device and work offline. Signing in with Google or GitHub is optional and is used for your MoveIQ account and share links. Read the <a href="/privacy">Privacy Policy</a>.</p>
<h2>Sign-in with Google</h2>
<p>When you choose “Continue with Google”, MoveIQ receives only your name, email address and profile picture (scopes <code>openid</code>, <code>email</code>, <code>profile</code>) to create your account. MoveIQ does not access your Gmail, contacts, Drive, or any other Google data.</p>`,
  );
}

export function privacyPage(): string {
  const email = esc(supportEmail());
  return layout(
    'Privacy Policy · MoveIQ',
    `<h1>Privacy Policy</h1>
<p class="muted">Last updated: ${POLICY_UPDATED}</p>
<p>This policy explains what data the MoveIQ mobile app and its cloud service (“MoveIQ”, “we”) collect, how it is used, and your choices.</p>

<h2>1. Data that stays on your device</h2>
<p>Your profile (optional name, height, birth year, sex, activity level, units), goals, workouts, nutrition logs, body weight and measurements, and running and swimming activities are stored in a local database on your phone. They are not sent to us.</p>

<h2>2. Food data</h2>
<p>Food nutrition values come from the USDA FoodData Central database (public domain), bundled in the app. Searching foods happens on your device; your searches and food log are not sent to us.</p>

<h2>3. Camera</h2>
<p>Camera coaching analyses the camera feed <strong>on your device</strong> to estimate body landmark positions. <strong>Video and images are never recorded, stored, or uploaded.</strong> Only compact landmark coordinates (13 body points) may be kept on your device for post-workout analysis. They are deleted automatically after the period you choose (default 14 days, or not kept at all) and are never uploaded.</p>

<h2>4. Location (GPS run recording)</h2>
<p>MoveIQ uses your precise location <strong>only while you are recording a run</strong> that you started. While recording, Android shows a “MoveIQ is recording your run” notification; recording stops when you pause or finish. MoveIQ never requests “allow all the time” background location and does not track you outside a recording.</p>
<p>Your route is stored <strong>only on your device</strong>. It is not uploaded to our servers, and it is excluded from data exports and share links. Deleting the run deletes its route.</p>
<p><strong>Map images:</strong> to show a map behind your route, the app downloads map tiles from OpenStreetMap's tile servers. Like any website, those servers receive your IP address and which map area is being displayed. See the <a href="https://osmfoundation.org/wiki/Privacy_Policy">OpenStreetMap Foundation Privacy Policy</a>. Without internet, the route is drawn without a map.</p>

<h2>5. Data we receive (only when you use these features)</h2>
<ul>
<li><strong>Sign-in with Google or GitHub (optional):</strong> your name, email address, profile picture URL, and the provider's account identifier. We use them only to create and identify your MoveIQ account. We request only basic profile scopes (Google: <code>openid email profile</code>; GitHub: <code>read:user user:email</code>). We do not access any other data in your Google or GitHub account.</li>
<li><strong>Share links (optional):</strong> when you create a public link, the summary card image and the stats shown on it are stored and are viewable by anyone with the link until you revoke it.</li>
<li><strong>Device key:</strong> if you create share links without signing in, the app generates a random key; we store only a one-way hash of it, to keep your items separate from other users'.</li>
<li><strong>Technical logs:</strong> our hosting provider records standard request logs (such as IP address and time) for security and reliability.</li>
</ul>

<h2>6. How we use data</h2>
<p>Only to provide the features you use: signing you in and serving your share links. We do <strong>not</strong> sell personal data, show ads, use data for advertising, or use it to train AI models. MoveIQ's use of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>

<h2>7. Where data is stored</h2>
<p>Account data and share links are stored with our service providers: Vercel (application hosting) and Neon (Postgres database and object storage, hosted on AWS in the United States). Data is encrypted in transit (HTTPS).</p>

<h2>8. Retention and deletion</h2>
<ul>
<li>Revoke a share link at any time in the app (Share screen).</li>
<li>Delete your account in the app (Profile → Account → Delete account). This permanently removes your account, sessions, linked sign-in providers, and all share links owned by the account.</li>
<li>Delete a run (including its GPS route) from the run's screen. Delete all on-device data in the app (Profile → Delete all data) or by uninstalling the app.</li>
<li>You can also request deletion by emailing <a href="mailto:${email}">${email}</a>.</li>
</ul>

<h2>9. Health information</h2>
<p>MoveIQ provides fitness information and estimates, not medical advice. Do not rely on it for diagnosis or treatment.</p>

<h2>10. Children</h2>
<p>MoveIQ is not directed to children under 13, and we do not knowingly collect their personal information.</p>

<h2>11. Changes</h2>
<p>We will update this page and the date above when this policy changes.</p>

<h2>12. Contact</h2>
<p><a href="mailto:${email}">${email}</a></p>`,
  );
}

export function termsPage(): string {
  const email = esc(supportEmail());
  return layout(
    'Terms of Service · MoveIQ',
    `<h1>Terms of Service</h1>
<p class="muted">Last updated: ${POLICY_UPDATED}</p>
<p>By using MoveIQ you agree to these terms.</p>
<h2>1. Not medical advice</h2>
<p>MoveIQ provides general fitness tracking and estimates. Form feedback is an approximate estimate from a phone camera and does not guarantee correct technique or prevent injury. Consult a qualified professional before starting a new exercise or nutrition program, and stop exercising if you feel pain or discomfort. You exercise at your own risk.</p>
<h2>2. Your account</h2>
<p>You are responsible for activity under your account. You may delete your account at any time in the app.</p>
<h2>3. Your content</h2>
<p>You keep ownership of the data you enter. You grant us only the rights needed to store and serve it for the features you use (for example, displaying a share link you create).</p>
<h2>4. Acceptable use</h2>
<p>Do not misuse the service: no attempts to disrupt it, access other users' data, upload unlawful content, or use share links to distribute content that isn't your own activity summary.</p>
<h2>5. Availability</h2>
<p>The app's core features work offline. Cloud features are provided “as is” and may change or be unavailable at times. Keep your own exports of important data.</p>
<h2>6. Limitation of liability</h2>
<p>To the extent permitted by law, MoveIQ is provided without warranties, and we are not liable for indirect or consequential damages arising from its use.</p>
<h2>7. Changes</h2>
<p>We may update these terms; continued use after changes means you accept them.</p>
<h2>8. Contact</h2>
<p><a href="mailto:${email}">${email}</a></p>`,
  );
}
