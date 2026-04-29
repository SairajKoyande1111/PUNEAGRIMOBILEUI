import { logger } from "./logger";

const BASE_URL = process.env["DATALAB_BASE_URL"] || "https://www.datalab.to";
const API_KEY = process.env["DATALAB_API_KEY"] || "";

const AADHAR_SCHEMA = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description: "Full name of the cardholder as printed on the Aadhaar card",
    },
    aadhaar_number: {
      type: "string",
      description:
        "12-digit Aadhaar number. Return digits only with no spaces.",
    },
    date_of_birth: {
      type: "string",
      description: "Date of birth in DD/MM/YYYY format if visible",
    },
    gender: {
      type: "string",
      description: "Gender (Male / Female / Other)",
    },
    address: {
      type: "string",
      description:
        "Full address as printed on the back of the card. Single line, comma separated.",
    },
    mobile_number: {
      type: "string",
      description:
        "10-digit mobile number if visible on the card. Otherwise empty string.",
    },
  },
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
