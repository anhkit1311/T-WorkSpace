import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
let client: S3Client | null = null;
function s3() {
  if (!process.env.S3_BUCKET) throw new Error("S3_BUCKET is required");
  client ??= new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    maxAttempts: 2,
  });
  return client;
}
export async function putObject(key: string, data: Buffer, mimeType: string) {
  await s3().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: data,
      ContentType: mimeType,
    }),
    { abortSignal: AbortSignal.timeout(10000) },
  );
}
export async function readObject(key: string) {
  const result = await s3().send(
    new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
    { abortSignal: AbortSignal.timeout(10000) },
  );
  if (!result.Body) throw new Error("Storage object missing");
  return Buffer.from(await result.Body.transformToByteArray());
}
export async function deleteObject(key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }), {
    abortSignal: AbortSignal.timeout(10000),
  });
}
