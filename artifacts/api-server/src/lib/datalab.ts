import { logger } from "./logger";

const BASE_URL = process.env["DATALAB_BASE_URL"] || "https://www.datalab.to";
const API_KEY = process.env["DATALAB_API_KEY"] || "";

export type AadharOcrResult = {
  name: string | null;
  aadhaarNumber: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  address: string | null;
  mobileNumber: string | null;
  photoBase64: string | null;
  photoMimeType: string | null;
  rawText: string | null;
};

type MarkerResult = {
  status: string;
  success?: boolean;
  error?: string | null;
  json?: { children?: Array<{ html?: string; children?: unknown }> } | null;
  images?: Record<string, string> | null;
  markdown?: string | null;
};

/**
 * Submit a document to Datalab's Marker API.
 *
 * We use Marker (not Extract) because Marker:
 *  - Splits the document into typed blocks (text, image, table, etc.)
 *  - When use_llm=true, captions every image with a descriptive alt text
 *    (e.g. "Portrait photo of Aniket Sanjay Rane", "Aadhaar logo")
 *  - Returns each detected image as base64 in the `images` dict
 *
 * That lets us pick out the cardholder's face photo directly instead of
 * guessing crop coordinates.
 */
async function submitMarker(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<string> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
  form.append("file", blob, filename);
  form.append("output_format", "json");
  form.append("use_llm", "true");
  form.append("paginate_output", "false");

  const res = await fetch(`${BASE_URL}/api/v1/marker`, {
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
      "Datalab marker submit failed",
    );
    throw new Error(
      data.error ||
        `Datalab submit failed (HTTP ${res.status}): ${JSON.stringify(data).slice(0, 200)}`,
    );
  }
  return data.request_id;
}

async function pollMarker(requestId: string): Promise<MarkerResult> {
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${BASE_URL}/api/v1/marker/${requestId}`, {
      headers: { "X-API-Key": API_KEY },
    });
    const data = (await res.json()) as MarkerResult;
    if (data.status === "complete") return data;
    if (data.status === "error" || data.error) {
      throw new Error(data.error || "OCR failed");
    }
  }
  throw new Error("OCR timed out");
}

/** Strip HTML tags / entities to get plain text. */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h1|h2|h3|li|div)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Find the cardholder's portrait photo in Marker's image dict. */
function pickPortraitImage(
  html: string,
  images: Record<string, string>,
): { base64: string; mimeType: string } | null {
  // Match <img alt="..." src="HASH_img.jpg"/> where alt mentions Portrait/face/photo of a person
  const imgRe = /<img[^>]*alt="([^"]+)"[^>]*src="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  const candidates: Array<{ alt: string; src: string }> = [];
  while ((match = imgRe.exec(html)) !== null) {
    candidates.push({ alt: match[1]!, src: match[2]! });
  }

  // Prefer "portrait" or "photo of <name>" — these are the cardholder's face
  const portrait = candidates.find((c) =>
    /portrait|photo of [a-z]/i.test(c.alt),
  );
  if (portrait && images[portrait.src]) {
    return { base64: images[portrait.src]!, mimeType: "image/jpeg" };
  }
  // Fallback: any image whose alt mentions a person/face
  const faceish = candidates.find((c) =>
    /\b(face|headshot|person|man|woman|boy|girl)\b/i.test(c.alt),
  );
  if (faceish && images[faceish.src]) {
    return { base64: images[faceish.src]!, mimeType: "image/jpeg" };
  }
  return null;
}

/**
 * Parse the structured fields out of Marker's HTML output.
 * The e-Aadhaar layout is consistent: Marker emits one <p>...</p> per visual
 * paragraph, with <br/> between visual lines. We rely on that structure.
 */
function parseAadharFields(html: string): {
  name: string | null;
  address: string | null;
  aadhaarNumber: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  mobileNumber: string | null;
} {
  // Pull every <p>...</p> block as a list of newline-separated lines.
  const paragraphs: string[][] = [];
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let pm: RegExpExecArray | null;
  while ((pm = pRe.exec(html)) !== null) {
    const lines = htmlToText(pm[1]!)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length) paragraphs.push(lines);
  }

  const isLatin = (s: string) => /^[\x20-\x7E]+$/.test(s) && /[A-Za-z]/.test(s);
  const isMobile = (s: string) => /^[6-9]\d{9}$/.test(s.replace(/\D/g, ""));

  let name: string | null = null;
  let address: string | null = null;
  let dateOfBirth: string | null = null;
  let gender: string | null = null;
  let mobileNumber: string | null = null;

  // 1) Addressee block: starts with "To", then Hindi name, then English name,
  //    then C/O / building / locality / city / state-PIN / [mobile].
  for (const lines of paragraphs) {
    if (lines[0] && /^to$/i.test(lines[0])) {
      // Find the first Latin-script line — that's the English name.
      const englishLines: string[] = [];
      for (let i = 1; i < lines.length; i++) {
        if (isLatin(lines[i]!)) englishLines.push(lines[i]!);
      }
      if (englishLines.length >= 2) {
        name ??= englishLines[0]!.replace(/^[Tt]o:?\s*/, "").trim();
        // Drop the last line if it's a bare 10-digit mobile.
        const tail = englishLines[englishLines.length - 1]!;
        if (isMobile(tail)) {
          mobileNumber ??= tail.replace(/\D/g, "");
          englishLines.pop();
        }
        // Address = everything after the name line.
        const addrParts = englishLines.slice(1).filter(Boolean);
        if (addrParts.length) {
          address ??= addrParts.join(", ").replace(/\s*,\s*/g, ", ").trim();
        }
      }
      break;
    }
  }

  // 2) Photo-side block: "<Hindi name><br/>English name<br/>DOB: ...<br/>MALE"
  for (const lines of paragraphs) {
    const dobLine = lines.find((l) => /\bDOB\b|जन्म\s*तिथि/i.test(l));
    if (!dobLine) continue;
    const dobMatch = dobLine.match(/(\d{2}[\/-]\d{2}[\/-]\d{4})/);
    if (dobMatch) dateOfBirth ??= dobMatch[1]!.replace(/-/g, "/");
    const genderLine = lines.find((l) =>
      /\b(MALE|FEMALE|Male|Female|Transgender)\b/.test(l),
    );
    if (genderLine) {
      const g = genderLine.match(
        /\b(MALE|FEMALE|Male|Female|Transgender)\b/,
      )?.[1];
      if (g) {
        gender ??=
          g.charAt(0).toUpperCase() + g.slice(1).toLowerCase();
      }
    }
    // English name fallback if addressee block didn't have one
    if (!name) {
      const englishName = lines.find(
        (l) =>
          isLatin(l) &&
          !/DOB|Date of Birth|MALE|FEMALE/i.test(l) &&
          l.split(/\s+/).length >= 2 &&
          l.split(/\s+/).length <= 6,
      );
      if (englishName) name = englishName;
    }
    break;
  }

  // 3) Aadhaar number — "<b>4015 9329 2039</b>" or first 4-4-4 sequence.
  let aadhaarNumber: string | null = null;
  const aadMatch = html.match(/<b>\s*(\d{4})\s+(\d{4})\s+(\d{4})\s*<\/b>/);
  if (aadMatch) {
    aadhaarNumber = aadMatch[1]! + aadMatch[2]! + aadMatch[3]!;
  } else {
    const fallback = htmlToText(html).match(
      /\b(\d{4})\s+(\d{4})\s+(\d{4})\b/,
    );
    if (fallback)
      aadhaarNumber = fallback[1]! + fallback[2]! + fallback[3]!;
  }

  // 4) Mobile fallback if not in addressee block — first 10-digit Indian
  //    number anywhere in the text.
  if (!mobileNumber) {
    const mob = htmlToText(html).match(/(?<!\d)([6-9]\d{9})(?!\d)/);
    if (mob) mobileNumber = mob[1]!;
  }

  return { name, address, aadhaarNumber, dateOfBirth, gender, mobileNumber };
}

function fileExtFor(mimeType: string): string {
  return mimeType.includes("png")
    ? "png"
    : mimeType.includes("webp")
      ? "webp"
      : "jpg";
}

async function runMarker(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  label: string,
): Promise<MarkerResult> {
  if (!API_KEY) throw new Error("DATALAB_API_KEY is not configured");
  const requestId = await submitMarker(buffer, filename, mimeType);
  logger.info({ requestId, label }, "Submitted to Marker");
  return pollMarker(requestId);
}

export async function extractAadhar(
  buffer: Buffer,
  mimeType: string,
): Promise<AadharOcrResult> {
  if (!API_KEY) {
    throw new Error("DATALAB_API_KEY is not configured");
  }

  const ext = fileExtFor(mimeType);
  const requestId = await submitMarker(buffer, `aadhar.${ext}`, mimeType);
  logger.info({ requestId }, "Submitted Aadhaar to Marker");

  const result = await pollMarker(requestId);

  // Concatenate the HTML of every block — gives us one big string to scan.
  const blocks = result.json?.children ?? [];
  const html = blocks.map((b) => b.html ?? "").join("\n");
  const images = result.images ?? {};

  const fields = parseAadharFields(html);
  const photo = pickPortraitImage(html, images);

  if (!photo) {
    logger.warn(
      {
        imageCount: Object.keys(images).length,
        imageAlts: (html.match(/<img[^>]*alt="([^"]+)"/gi) ?? []).slice(0, 10),
      },
      "Could not identify portrait photo from Marker output",
    );
  }

  const cleanedAadhar =
    fields.aadhaarNumber?.replace(/\D/g, "").slice(0, 12) || null;
  const cleanedMobile =
    fields.mobileNumber?.replace(/\D/g, "").slice(0, 10) || null;

  const rawText = htmlToText(html);

  return {
    name: fields.name?.trim() || null,
    aadhaarNumber: cleanedAadhar,
    dateOfBirth: fields.dateOfBirth || null,
    gender: fields.gender || null,
    address: fields.address || null,
    mobileNumber: cleanedMobile,
    photoBase64: photo?.base64 ?? null,
    photoMimeType: photo?.mimeType ?? null,
    rawText: rawText.length > 4000 ? rawText.slice(0, 4000) : rawText,
  };
}

// ---------------------------------------------------------------------------
// Bank passbook
// ---------------------------------------------------------------------------

export type PassbookOcrResult = {
  bankName: string | null;
  accountHolderName: string | null;
  cifNumber: string | null;
  accountNumber: string | null;
  accountType: string | null;
  ifsc: string | null;
  micr: string | null;
  branchName: string | null;
  branchCode: string | null;
  accountOpeningDate: string | null;
  rawText: string | null;
};

/**
 * Map an IFSC code prefix (first 4 letters) to the issuing bank's full name.
 * Covers all major Indian commercial banks. If the prefix is unknown we fall
 * back to whatever text the OCR found near "Bank" on the page.
 */
const IFSC_BANK_MAP: Record<string, string> = {
  SBIN: "State Bank of India",
  HDFC: "HDFC Bank",
  ICIC: "ICICI Bank",
  AXIS: "Axis Bank",
  UTIB: "Axis Bank",
  PUNB: "Punjab National Bank",
  ORBC: "Punjab National Bank",
  UBIN: "Union Bank of India",
  BARB: "Bank of Baroda",
  CNRB: "Canara Bank",
  SYNB: "Canara Bank",
  IBKL: "IDBI Bank",
  IDFB: "IDFC FIRST Bank",
  KKBK: "Kotak Mahindra Bank",
  YESB: "Yes Bank",
  INDB: "IndusInd Bank",
  BKID: "Bank of India",
  IOBA: "Indian Overseas Bank",
  IDIB: "Indian Bank",
  ALLA: "Indian Bank",
  CBIN: "Central Bank of India",
  MAHB: "Bank of Maharashtra",
  PSIB: "Punjab & Sind Bank",
  UCBA: "UCO Bank",
  RATN: "RBL Bank",
  FDRL: "Federal Bank",
  KARB: "Karnataka Bank",
  TMBL: "Tamilnad Mercantile Bank",
  CIUB: "City Union Bank",
  SIBL: "South Indian Bank",
  DBSS: "DBS Bank India",
  CITI: "Citibank",
  HSBC: "HSBC",
  SCBL: "Standard Chartered Bank",
  DEUT: "Deutsche Bank",
  AUBL: "AU Small Finance Bank",
  ESFB: "Equitas Small Finance Bank",
  UJVN: "Ujjivan Small Finance Bank",
  BANDHAN: "Bandhan Bank",
  BDBL: "Bandhan Bank",
};

function bankNameFromIfsc(ifsc: string | null): string | null {
  if (!ifsc || ifsc.length < 4) return null;
  return IFSC_BANK_MAP[ifsc.slice(0, 4).toUpperCase()] ?? null;
}

/** Pick a single value out of "<label>: <value>" lines. Tolerates extra
 *  trailing punctuation in the label (e.g. "Account No.:"). */
function findField(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `(?:^|\\n)\\s*${escaped}[\\.\\s]*[:\\-]\\s*([^\\n]+)`,
      "i",
    );
    const m = text.match(re);
    if (m && m[1]) {
      const value = m[1].trim().replace(/\s{2,}/g, " ");
      if (value && !/^[:\-]+$/.test(value)) return value;
    }
  }
  return null;
}

function parsePassbookFields(html: string): {
  text: string;
  data: Omit<PassbookOcrResult, "rawText">;
} {
  const text = htmlToText(html);

  // IFSC: 4 letters + 0 + 6 alphanumerics — Indian standard.
  const ifscMatch = text.match(/\b([A-Z]{4}0[A-Z0-9]{6})\b/);
  const ifsc = ifscMatch ? ifscMatch[1]! : findField(text, ["IFSC"]);
  const cleanedIfsc = ifsc ? ifsc.replace(/\s+/g, "").toUpperCase() : null;

  // MICR: 9 digits.
  const micrField = findField(text, ["MICR"]);
  const micrMatch = (micrField ?? text).match(/\b(\d{9})\b/);
  const micr = micrMatch ? micrMatch[1]! : null;

  // CIF Number — usually 9-12 digits.
  const cifRaw = findField(text, ["CIF Number", "CIF No", "CIF"]);
  const cif = cifRaw?.match(/\d[\d\s]*\d/)?.[0]?.replace(/\s+/g, "") ?? null;

  // Account Number — varies by bank, 8-18 digits.
  const accRaw = findField(text, ["Account No", "A/c No", "Account Number"]);
  const accountNumber =
    accRaw?.match(/\d[\d\s]*\d/)?.[0]?.replace(/\s+/g, "") ?? null;

  // A/c Type
  const accountType = findField(text, [
    "A/c Type",
    "Account Type",
    "Type of Account",
  ]);

  // Account Holder Name (strip honorifics like "Mr.", "Mrs.")
  const nameRaw = findField(text, ["Name"]);
  const accountHolderName = nameRaw
    ? nameRaw.replace(/^(Mr|Mrs|Ms|Miss|Dr|Shri|Smt)\.?\s+/i, "").trim()
    : null;

  // Branch — keep the first line only (some passbooks show branch + address)
  const branchRaw = findField(text, ["Branch"]);
  const branchName = branchRaw ? branchRaw.split(/\s{2,}|,/)[0]!.trim() : null;

  // Branch code
  const branchCode = findField(text, ["Code", "Branch Code"]);

  // A/c Opening date
  const opening = findField(text, [
    "A/c Opening Dt",
    "Account Opening Date",
    "Opening Date",
    "Date of Opening",
  ]);
  const openMatch = opening?.match(/(\d{2}[\/-]\d{2}[\/-]\d{4})/);
  const accountOpeningDate = openMatch ? openMatch[1]!.replace(/-/g, "/") : null;

  const bankName = bankNameFromIfsc(cleanedIfsc);

  return {
    text,
    data: {
      bankName,
      accountHolderName,
      cifNumber: cif,
      accountNumber,
      accountType,
      ifsc: cleanedIfsc,
      micr,
      branchName,
      branchCode: branchCode ? branchCode.replace(/\D/g, "") || branchCode : null,
      accountOpeningDate,
    },
  };
}

export async function extractPassbook(
  buffer: Buffer,
  mimeType: string,
): Promise<PassbookOcrResult> {
  const ext = fileExtFor(mimeType);
  const result = await runMarker(buffer, `passbook.${ext}`, mimeType, "passbook");

  const blocks = result.json?.children ?? [];
  const html = blocks.map((b) => b.html ?? "").join("\n");

  const { text, data } = parsePassbookFields(html);

  return {
    ...data,
    rawText: text.length > 4000 ? text.slice(0, 4000) : text,
  };
}
