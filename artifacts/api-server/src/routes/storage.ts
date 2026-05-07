import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError, objectStorageClient } from "../lib/objectStorage";
import { requireStaffAuth } from "../middlewares/staffAuth";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

function storageUnavailable(res: Response) {
  res.status(503).json({ error: "File storage is not available — configure R2 credentials." });
}

/**
 * POST /storage/uploads/request-url
 * Returns a presigned PUT URL for direct client-to-R2 upload.
 */
router.post("/storage/uploads/request-url", requireStaffAuth, async (req: Request, res: Response) => {
  if (!objectStorageClient) { storageUnavailable(res); return; }

  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 * Proxy-serve files from R2 when a public CDN URL is not configured.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  if (!objectStorageClient) { storageUnavailable(res); return; }

  try {
    const raw = req.params.filePath;
    const key = Array.isArray(raw) ? raw.join("/") : raw;
    const response = await objectStorageService.downloadObject(key);

    res.status(response.status);
    response.headers.forEach((value, header) => res.setHeader(header, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve file" });
  }
});

export default router;
