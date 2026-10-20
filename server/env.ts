/**
 * Environment for the MoveIQ cloud service. Values come from Neon (`neon deploy` writes them to
 * .env.local): DATABASE_URL (pooled), DATABASE_URL_UNPOOLED (direct, for migrations), and the
 * AWS-standard S3 variables for Neon Object Storage.
 */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}. Run \`neon deploy\` or \`neon env pull\` to populate .env.local.`);
  return v;
}

export const env = {
  get databaseUrl() {
    return required('DATABASE_URL');
  },
  get databaseUrlUnpooled() {
    return process.env.DATABASE_URL_UNPOOLED || required('DATABASE_URL');
  },
  get bucket() {
    return process.env.MOVEIQ_BUCKET || 'assets';
  },
  get port() {
    return Number(process.env.PORT || 8787);
  },
  /** Public origin used in share links, e.g. https://moveiq.example.com. Defaults to the request origin. */
  get publicBaseUrl() {
    return process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '') || null;
  },
};
