import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

// Cloudflare R2 (S3-compatible) — configured via env vars.
// On Replit without R2 configured, storage endpoints return 503.
const R2_ACCOUNT_ID   = process.env["R2_ACCOUNT_ID"]   ?? "";
const R2_ACCESS_KEY   = process.env["R2_ACCESS_KEY_ID"] ?? "";
const R2_SECRET_KEY   = process.env["R2_SECRET_ACCESS_KEY"] ?? "";
const R2_BUCKET_NAME  = process.env["R2_BUCKET_NAME"]   ?? "";
const R2_PUBLIC_URL   = (process.env["R2_PUBLIC_URL"] ?? "").replace(/\/$/, "");

export const storageAvailable = Boolean(
  R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY && R2_BUCKET_NAME
);

if (!storageAvailable) {
  console.warn(
    "[objectStorage] R2 not configured — file upload/download endpoints will return 503. " +
    "Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME to enable."
  );
}

export const s3 = storageAvailable
  ? new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY,
        secretAccessKey: R2_SECRET_KEY,
      },
    })
  : null;

// Keep exporting objectStorageClient as null so existing route guards work.
export const objectStorageClient = s3;

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  /**
   * Upload a buffer to R2 and return the public URL.
   */
  async uploadFile(key: string, buffer: Buffer, contentType: string): Promise<string> {
    if (!s3 || !R2_BUCKET_NAME) {
      throw new Error("Object storage not configured");
    }
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));
    // If a public R2 URL is configured, return it directly; otherwise use our proxy.
    if (R2_PUBLIC_URL) {
      return `${R2_PUBLIC_URL}/${key}`;
    }
    return `/api/storage/public-objects/${key}`;
  }

  /**
   * Download an object and return a web Response.
   */
  async downloadObject(key: string, cacheTtlSec = 3600): Promise<Response> {
    if (!s3 || !R2_BUCKET_NAME) {
      throw new ObjectNotFoundError();
    }
    let head;
    try {
      head = await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
    } catch {
      throw new ObjectNotFoundError();
    }

    const get = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
    if (!get.Body) throw new ObjectNotFoundError();

    // @aws-sdk returns a Node.js Readable; convert to web ReadableStream
    const { Readable } = await import("stream");
    const nodeStream = get.Body as NodeJS.ReadableStream;
    const webStream = Readable.toWeb(Readable.from(nodeStream)) as ReadableStream;

    return new Response(webStream, {
      headers: {
        "Content-Type": head.ContentType ?? "application/octet-stream",
        "Content-Length": String(head.ContentLength ?? ""),
        "Cache-Control": `public, max-age=${cacheTtlSec}`,
      },
    });
  }

  /**
   * Generate a presigned PUT URL for direct client-to-R2 upload.
   * TTL: 15 minutes.
   */
  async getObjectEntityUploadURL(): Promise<string> {
    if (!s3 || !R2_BUCKET_NAME) {
      throw new Error("Object storage not configured");
    }
    const key = `uploads/${randomUUID()}`;
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }),
      { expiresIn: 900 }
    );
    return url;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    // If it's a presigned R2 URL, extract just the path component.
    try {
      const url = new URL(rawPath);
      const key = url.pathname.replace(/^\//, "");
      return `/api/storage/public-objects/${key}`;
    } catch {
      return rawPath;
    }
  }
}
