import sharp from "sharp";
import { logger } from "./logger";

const BASE_URL = process.env["DATALAB_BASE_URL"] || "https://www.datalab.to";
const API_KEY = process.env["DATALAB_API_KEY"] || "";

const AADHAR_SCHEMA = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description:
        "Full name of the Aadhaar cardholder, in English, exactly as printed (e.g. 'Aniket Sanjay Rane'). The name appears in two places on an Indian e-Aadhaar: (1) at the top after 'To' / addressee block, and (2) on the photo side just above 'DOB' / 'Date of Birth'. Return the English-language version, not the Hindi one. Do NOT return the recipient salutation or 'To'.",
    },
    aadhaar_number: {
      type: "string",
      description:
        "12-digit Aadhaar number, printed in the format 'XXXX XXXX XXXX' near the bottom of each half of the card. Return digits only, no spaces (e.g. '401593292039').",
    },
    date_of_birth: {
      type: "string",
      description:
        "Date of birth printed as 'DOB:' or 'जन्म तिथि / Date of Birth :' on the photo side. Return in DD/MM/YYYY format (e.g. '23/03/2001').",
    },
    gender: {
      type: "string",
      description:
        "Gender printed below the date of birth on the photo side. Return one of: Male, Female, Transgender.",
    },
    address: {
      type: "string",
      description:
        "Full postal address from the addressee block at the top half of the card (after 'To' / 'पता'). Includes street/flat, building, locality, city, district, state, and PIN code. Return as a single line with parts separated by commas (e.g. 'Flat No 305, A Wing, B Floor, Hubtown Greenwood A CHS, Vartak Nagar, Thane West, Thane, Maharashtra - 400606'). Do NOT include the recipient name in the address.",
    },
    mobile_number: {
      type: "string",
      description:
        "10-digit Indian mobile number if visible anywhere on the card. Otherwise return empty string.",
    },
  },
  required: ["name", "aadhaar_number", "date_of_birth", "gender", "address"],
};

type ExtractFields = {
  name?: string;
  aadhaar_number?: string;
  date_of_birth?: string;
  gender?: string;
  address?: string;
  mobile_number?: string;
};

export type AadharOcrResult = {
  name: string | null;
  aadhaarNumber: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  address: string | null;
  mobileNumber: string | null;
  rawText: string | null;
};

async function submitDoc(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<string> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
  form.append("file", blob, filename);
  form.append("mode", "accurate");
  form.append("output_format", "markdown");
  form.append("page_schema", JSON.stringify(AADHAR_SCHEMA));

  const res = await fetch(`${BASE_URL}/api/v1/extract`, {
    method: "POST",
    headers: { "X-API-Key": API_KEY },
    body: form,
  });

  const rawText = await res.text();
  let data: { request_id?: string; error?: string; success?: boolean } = {};
  try {
    data = JSON.parse(rawText);
  } catch {
    logger.error(
      { status: res.status, body: rawText.slice(0, 500) },
      "Datalab returned non-JSON response",
    );
    throw new Error(
      `Datalab returned HTTP ${res.status}: ${rawText.slice(0, 200)}`,
    );
  }

  if (!res.ok || !data.request_id) {
    logger.error(
      { status: res.status, datalab: data },
      "Datalab submit failed",
    );
    throw new Error(
      data.error ||
        `Datalab submit failed (HTTP ${res.status}): ${JSON.stringify(data).slice(0, 200)}`,
    );
  }
  return data.request_id;
}

async function pollResult(requestId: string): Promise<{
  status: string;
  markdown?: string;
  extraction_schema_json?: unknown;
  error?: string;
}> {
  const maxAttempts = 40;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${BASE_URL}/api/v1/extract/${requestId}`, {
      headers: { "X-API-Key": API_KEY },
    });
    const data = (await res.json()) as {
      status: string;
      markdown?: string;
      extraction_schema_json?: unknown;
      error?: string;
    };
    if (data.status === "complete") return data;
    if (data.status === "error" || data.error) {
      throw new Error(data.error || "OCR failed");
    }
  }
  throw new Error("OCR timed out");
}

function pickFromText(text: string): ExtractFields {
  const fields: ExtractFields = {};
  const aadhaarMatch = text.match(/\b(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})\b/);
  if (aadhaarMatch) {
    fields.aadhaar_number = aadhaarMatch[1]! + aadhaarMatch[2]! + aadhaarMatch[3]!;
  }
  const mobileMatch = text.match(/(?<![\d])([6-9]\d{9})(?![\d])/);
  if (mobileMatch) fields.mobile_number = mobileMatch[1];
  const dobMatch = text.match(
    /\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/,
  );
  if (dobMatch) fields.date_of_birth = dobMatch[1];
  const maleFemale = text.match(/\b(male|female)\b/i);
  if (maleFemale) {
    fields.gender =
      maleFemale[1]!.charAt(0).toUpperCase() +
      maleFemale[1]!.slice(1).toLowerCase();
  }
  return fields;
}

/**
 * Crop the cardholder's face photo from the e-Aadhaar card image.
 *
 * The standard e-Aadhaar layout is portrait, with the addressee block on the
 * top half and the photo card on the bottom half. The passport-size photo
 * sits in the bottom-left of that lower half.
 *
 * Returns a JPEG base64 string of just the face region, or null if the crop
 * fails (e.g. unusual image). The caller can fall back to the full card image.
 */
export async function cropAadharFace(
  buffer: Buffer,
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const image = sharp(buffer, { failOn: "none" }).rotate(); // auto-orient via EXIF
    const meta = await image.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width < 100 || height < 100) return null;

    // Layout assumption: portrait e-Aadhaar.
    // Bottom half = bottom 50% of the image.
    // Photo region within the bottom half:
    //   x: 4% to 32% of width  (≈ 28% wide)
    //   y: 56% to 80% of height (≈ 24% tall, in the upper part of the bottom half)
    let left = Math.round(width * 0.04);
    let top = Math.round(height * 0.56);
    let cropW = Math.round(width * 0.28);
    let cropH = Math.round(height * 0.24);

    // For landscape uploads (rare), fall back to a centered square in the
    // upper-right region where the printed face usually sits.
    if (width > height) {
      left = Math.round(width * 0.04);
      top = Math.round(height * 0.18);
      cropW = Math.round(width * 0.18);
      cropH = Math.round(height * 0.55);
    }

    // Clamp to image bounds.
    cropW = Math.min(cropW, width - left);
    cropH = Math.min(cropH, height - top);
    if (cropW <= 0 || cropH <= 0) return null;

    const out = await image
      .extract({ left, top, width: cropW, height: cropH })
      .jpeg({ quality: 85 })
      .toBuffer();

    return { base64: out.toString("base64"), mimeType: "image/jpeg" };
  } catch (err) {
    logger.warn({ err }, "cropAadharFace failed");
    return null;
  }
}

export async function extractAadhar(
  buffer: Buffer,
  mimeType: string,
): Promise<AadharOcrResult> {
  if (!API_KEY) {
    throw new Error("DATALAB_API_KEY is not configured");
  }

  const ext = mimeType.includes("png")
    ? "png"
    : mimeType.includes("webp")
      ? "webp"
      : "jpg";
  const requestId = await submitDoc(buffer, `aadhar.${ext}`, mimeType);
  logger.info({ requestId }, "Submitted Aadhaar to OCR");

  const result = await pollResult(requestId);
  const rawText =
    result.markdown ?? JSON.stringify(result.extraction_schema_json ?? "");

  let fields: ExtractFields = {};
  if (result.extraction_schema_json) {
    const raw = result.extraction_schema_json;
    if (Array.isArray(raw)) {
      for (const page of raw) {
        if (page && typeof page === "object") {
          fields = { ...fields, ...(page as ExtractFields) };
        }
      }
    } else if (raw && typeof raw === "object") {
      fields = { ...fields, ...(raw as ExtractFields) };
    }
  }

  const fromText = pickFromText(rawText);
  fields = {
    aadhaar_number: fields.aadhaar_number ?? fromText.aadhaar_number,
    name: fields.name,
    address: fields.address,
    mobile_number: fields.mobile_number ?? fromText.mobile_number,
    date_of_birth: fields.date_of_birth ?? fromText.date_of_birth,
    gender: fields.gender ?? fromText.gender,
  };

  const cleanedAadhar = fields.aadhaar_number?.replace(/\D/g, "") || null;
  const cleanedMobile = fields.mobile_number?.replace(/\D/g, "") || null;

  return {
    name: fields.name?.trim() || null,
    aadhaarNumber:
      cleanedAadhar && cleanedAadhar.length === 12 ? cleanedAadhar : cleanedAadhar,
    dateOfBirth: fields.date_of_birth?.trim() || null,
    gender: fields.gender?.trim() || null,
    address: fields.address?.trim() || null,
    mobileNumber:
      cleanedMobile && cleanedMobile.length === 10 ? cleanedMobile : cleanedMobile,
    rawText: rawText.length > 4000 ? rawText.slice(0, 4000) : rawText,
  };
}
