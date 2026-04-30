import { Router, type IRouter } from "express";
import multer from "multer";
import {
  extractAadhar,
  extractPassbook,
  extractForm7,
  extractForm8a,
  extractForm12,
} from "../lib/datalab";
import {
  ensureProfileDoc,
  setProfileSection,
  type ProfileSection,
} from "../lib/mongo";
import {
  createExtractRequest,
  getExtractRequest,
  completeExtractRequest,
  failExtractRequest,
} from "../lib/extractStore";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// 25 MB cap matches the express.json limit elsewhere
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const VALID_TYPES = new Set([
  "aadhar",
  "bank_passbook",
  "form7",
  "form8a",
  "form12",
]);

function sectionFor(docType: string): ProfileSection {
  if (docType === "bank_passbook") return "passbook";
  return docType as ProfileSection;
}

async function runExtraction(
  requestId: string,
  docType: string,
  phone: string,
  buffer: Buffer,
  mimeType: string,
): Promise<void> {
  try {
    let parsed: unknown;
    if (docType === "aadhar") {
      const a = await extractAadhar(buffer, mimeType);
      // Fallback portrait: full image if Marker didn't isolate one
      parsed = {
        ...a,
        photoBase64: a.photoBase64 ?? buffer.toString("base64"),
        photoMimeType: a.photoMimeType ?? mimeType,
      };
    } else if (docType === "bank_passbook") {
      parsed = await extractPassbook(buffer, mimeType);
    } else if (docType === "form7") {
      parsed = await extractForm7(buffer, mimeType);
    } else if (docType === "form8a") {
      parsed = await extractForm8a(buffer, mimeType);
    } else if (docType === "form12") {
      parsed = await extractForm12(buffer, mimeType);
    } else {
      throw new Error(`Unknown document_type: ${docType}`);
    }

    const section = sectionFor(docType);
    await ensureProfileDoc(phone);
    await setProfileSection(
      phone,
      section,
      parsed as Parameters<typeof setProfileSection>[2],
    );

    completeExtractRequest(requestId, {
      saved: true,
      section,
      error: null,
    });
    logger.info({ requestId, phone, docType }, "Extraction complete");
  } catch (e) {
    const message = e instanceof Error ? e.message : "Extraction failed";
    logger.error({ err: e, requestId, docType, phone }, "Extraction failed");
    failExtractRequest(requestId, message);
  }
}

router.post("/extract", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    const body = req.body as {
      document_type?: string;
      profile_phone?: string;
    };

    if (!file) {
      res.status(400).json({ error: "file is required" });
      return;
    }

    const docType = String(body.document_type ?? "").trim();
    if (!VALID_TYPES.has(docType)) {
      res.status(400).json({
        error: `document_type must be one of: ${Array.from(VALID_TYPES).join(", ")}`,
      });
      return;
    }

    const phone = String(body.profile_phone ?? "").replace(/\D/g, "").trim();
    if (phone.length !== 10) {
      res.status(400).json({ error: "profile_phone must be a 10-digit phone" });
      return;
    }

    const mimeType = file.mimetype || "image/jpeg";
    if (!/^image\/(jpe?g|png|webp|heic|heif)$/i.test(mimeType)) {
      res.status(400).json({
        error: `Unsupported file type: ${mimeType}`,
      });
      return;
    }

    // Make sure a profile exists so the polling client can fetch it later
    await ensureProfileDoc(phone);

    const rec = createExtractRequest(docType, phone);

    // Fire-and-forget — extraction runs in the background; mobile polls.
    void runExtraction(rec.id, docType, phone, file.buffer, mimeType);

    res.json({
      request_id: rec.id,
      document_type: docType,
      status: "processing",
    });
  } catch (e) {
    req.log.error({ err: e }, "POST /extract failed");
    const message = e instanceof Error ? e.message : "Failed to start extraction";
    res.status(500).json({ error: message });
  }
});

router.get("/extract/:requestId", (req, res) => {
  const id = String(req.params.requestId).trim();
  const rec = getExtractRequest(id);
  if (!rec) {
    res.status(404).json({ error: "request not found" });
    return;
  }

  if (rec.status === "processing") {
    res.json({ status: "processing" });
    return;
  }

  if (rec.status === "error") {
    res.json({ status: "error", error: rec.error ?? "Extraction failed" });
    return;
  }

  // complete
  res.json({
    status: "complete",
    profile: {
      phone: rec.phone,
      section: rec.result?.section ?? null,
      saved: rec.result?.saved ?? false,
      error: rec.result?.error ?? null,
    },
  });
});

export default router;
