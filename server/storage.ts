import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env.js';

/**
 * Neon Object Storage via the AWS S3 client. Credentials, endpoint and region come from the
 * AWS-standard env vars that `neon deploy` pulls (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
 * AWS_ENDPOINT_URL_S3, AWS_REGION). Neon requires path-style addressing.
 */
let client: S3Client | null = null;
function s3(): S3Client {
  client ??= new S3Client({ forcePathStyle: true });
  return client;
}

export async function putObject(key: string, body: Uint8Array | string, contentType: string): Promise<void> {
  await s3().send(new PutObjectCommand({ Bucket: env.bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function getObjectBytes(key: string): Promise<{ bytes: Uint8Array; contentType: string | undefined } | null> {
  try {
    const r = await s3().send(new GetObjectCommand({ Bucket: env.bucket, Key: key }));
    if (!r.Body) return null;
    return { bytes: await r.Body.transformToByteArray(), contentType: r.ContentType };
  } catch (e) {
    if ((e as { name?: string }).name === 'NoSuchKey') return null;
    throw e;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: env.bucket, Key: key }));
}

/** Time-limited download URL for a private object (the bucket stays private). */
export async function presignGet(key: string, expiresInSec = 600): Promise<string> {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: env.bucket, Key: key }), { expiresIn: expiresInSec });
}

export async function storageHealth(): Promise<void> {
  await s3().send(new HeadBucketCommand({ Bucket: env.bucket }));
}
