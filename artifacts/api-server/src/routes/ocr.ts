import { Router, type IRouter } from "express";
import { extractAadhar } from "../lib/datalab";
import { setAadharOnUser } from "../lib/mongo";

const router: IRouter = Router();

router.post("/ocr/aadhar", async (req, res) => {
  const body = req.body as
    | { phone?: string; imageBase64?: string; mimeType?: string }
    | undefined;
  const phone = String(body?.phone ?? "").replace(/\D/g, "").trim();
  const imageBase64 = body?.imageBase64;
  const mimeType = body?.mimeType ?? "image/jpeg";

  if (!phone || !imageBase64) {
    res.status(400).json({ error: "phone and imageBase64 are required" });
    return;
  }

  try {
    const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(cleanBase64, "base64");
    if (buffer.length === 0) {
      res.status(400).json({ error: "Empty image payload" });
      return;
    }

    req.log.info({ phone, size: buffer.length }, "Running Aadhaar OCR");
    const ocr = await extractAadhar(buffer, mimeType);

    const aadhar = {
      ...ocr,
      photoBase64: cleanBase64,
      photoMimeType: mimeType,
    };

    const doc = await setAadharOnUser(phone, aadhar);

    res.json({
      phone: doc.phone,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      aadhar: doc.aadhar ?? null,
    });
  } catch (e) {
    req.log.error({ err: e }, "OCR failed");
    const message = e instanceof Error ? e.message : "OCR failed";
    res.status(500).json({ error: message });
  }
});

export default router;
