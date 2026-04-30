import { logger } from "./logger";

const BASE_URL = process.env["DATALAB_BASE_URL"] || "https://www.datalab.to";
const API_KEY = process.env["DATALAB_API_KEY"] || "";

// ---------------------------------------------------------------------------
// Generic Marker submit + poll
// ---------------------------------------------------------------------------

export type AadharOcrResult = {
  name: string | null;
  aadhaarNumber: string | null;
  vid: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  fathersOrHusbandsName: string | null;
  address: string | null;
  pincode: string | null;
  state: string | null;
  mobileNumber: string | null;
  issueDate: string | null;
  enrolmentNumber: string | null;
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

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h1|h2|h3|li|div|tr|table)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, "\t")
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

function pickPortraitImage(
  html: string,
  images: Record<string, string>,
): { base64: string; mimeType: string } | null {
  const imgRe = /<img[^>]*alt="([^"]+)"[^>]*src="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  const candidates: Array<{ alt: string; src: string }> = [];
  while ((match = imgRe.exec(html)) !== null) {
    candidates.push({ alt: match[1]!, src: match[2]! });
  }

  const portrait = candidates.find((c) =>
    /portrait|photo of [a-z]/i.test(c.alt),
  );
  if (portrait && images[portrait.src]) {
    return { base64: images[portrait.src]!, mimeType: "image/jpeg" };
  }
  const faceish = candidates.find((c) =>
    /\b(face|headshot|person|man|woman|boy|girl)\b/i.test(c.alt),
  );
  if (faceish && images[faceish.src]) {
    return { base64: images[faceish.src]!, mimeType: "image/jpeg" };
  }
  return null;
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

// ---------------------------------------------------------------------------
// Aadhaar
// ---------------------------------------------------------------------------

const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
  "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Delhi", "Jammu and Kashmir", "Ladakh", "Puducherry", "Chandigarh",
];

function parseAadharFields(html: string): {
  name: string | null;
  address: string | null;
  pincode: string | null;
  state: string | null;
  fathersOrHusbandsName: string | null;
  aadhaarNumber: string | null;
  vid: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  mobileNumber: string | null;
  issueDate: string | null;
  enrolmentNumber: string | null;
} {
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
  let fathersOrHusbandsName: string | null = null;

  for (const lines of paragraphs) {
    if (lines[0] && /^to$/i.test(lines[0])) {
      const englishLines: string[] = [];
      for (let i = 1; i < lines.length; i++) {
        if (isLatin(lines[i]!)) englishLines.push(lines[i]!);
      }
      if (englishLines.length >= 2) {
        name ??= englishLines[0]!.replace(/^[Tt]o:?\s*/, "").trim();
        const tail = englishLines[englishLines.length - 1]!;
        if (isMobile(tail)) {
          mobileNumber ??= tail.replace(/\D/g, "");
          englishLines.pop();
        }
        const addrParts = englishLines.slice(1).filter(Boolean);
        if (addrParts.length) {
          address ??= addrParts.join(", ").replace(/\s*,\s*/g, ", ").trim();
        }
      }
      break;
    }
  }

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
        gender ??= g.charAt(0).toUpperCase() + g.slice(1).toLowerCase();
      }
    }
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

  let aadhaarNumber: string | null = null;
  const aadMatch = html.match(/<b>\s*(\d{4})\s+(\d{4})\s+(\d{4})\s*<\/b>/);
  if (aadMatch) {
    aadhaarNumber = aadMatch[1]! + aadMatch[2]! + aadMatch[3]!;
  } else {
    const fallback = htmlToText(html).match(
      /\b(\d{4})\s+(\d{4})\s+(\d{4})\b/,
    );
    if (fallback) aadhaarNumber = fallback[1]! + fallback[2]! + fallback[3]!;
  }

  const fullText = htmlToText(html);

  if (!mobileNumber) {
    const mob = fullText.match(/(?<!\d)([6-9]\d{9})(?!\d)/);
    if (mob) mobileNumber = mob[1]!;
  }

  // VID: 16 digits, often shown as "VID : 9171 0405 6612 1934"
  let vid: string | null = null;
  const vidMatch = fullText.match(/VID\s*[:\-]?\s*((?:\d{4}\s*){4})/i);
  if (vidMatch) vid = vidMatch[1]!.replace(/\D/g, "");

  // Pincode: 6 digits, near the end of address; pull last 6-digit run.
  let pincode: string | null = null;
  const pinMatches = [...fullText.matchAll(/(?<!\d)(\d{6})(?!\d)/g)].map(
    (m) => m[1]!,
  );
  if (pinMatches.length) pincode = pinMatches[pinMatches.length - 1]!;

  // State: scan for any known Indian state name in the OCR text.
  let state: string | null = null;
  for (const s of INDIAN_STATES) {
    const re = new RegExp(`\\b${s.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (re.test(fullText)) {
      state = s;
      break;
    }
  }

  // S/O, D/O, W/O, C/O — father / husband / guardian
  const careOf = fullText.match(
    /\b(?:S\/O|D\/O|W\/O|C\/O|Son of|Daughter of|Wife of)\s*[:\-]?\s*([A-Z][A-Za-z .'-]+?)(?:[,\n]|\s{2,}|$)/i,
  );
  if (careOf) fathersOrHusbandsName = careOf[1]!.trim();

  // Issue Date
  let issueDate: string | null = null;
  const issueMatch = fullText.match(
    /Issue\s*Date\s*[:\-]?\s*(\d{2}[\/-]\d{2}[\/-]\d{4})/i,
  );
  if (issueMatch) issueDate = issueMatch[1]!.replace(/-/g, "/");

  // Enrolment number — typical format "1129/22324/00123" (28-ish digits/slashes)
  let enrolmentNumber: string | null = null;
  const enrolMatch = fullText.match(
    /Enroll?ment\s*(?:No\.?|Number)\s*[:\-]?\s*([\d\/\s]{12,40})/i,
  );
  if (enrolMatch) enrolmentNumber = enrolMatch[1]!.replace(/\s+/g, "");

  return {
    name,
    address,
    pincode,
    state,
    fathersOrHusbandsName,
    aadhaarNumber,
    vid,
    dateOfBirth,
    gender,
    mobileNumber,
    issueDate,
    enrolmentNumber,
  };
}

export async function extractAadhar(
  buffer: Buffer,
  mimeType: string,
): Promise<AadharOcrResult> {
  if (!API_KEY) throw new Error("DATALAB_API_KEY is not configured");

  const ext = fileExtFor(mimeType);
  const requestId = await submitMarker(buffer, `aadhar.${ext}`, mimeType);
  logger.info({ requestId }, "Submitted Aadhaar to Marker");

  const result = await pollMarker(requestId);

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
  const cleanedVid = fields.vid?.replace(/\D/g, "").slice(0, 16) || null;

  const rawText = htmlToText(html);

  return {
    name: fields.name?.trim() || null,
    aadhaarNumber: cleanedAadhar,
    vid: cleanedVid,
    dateOfBirth: fields.dateOfBirth || null,
    gender: fields.gender || null,
    fathersOrHusbandsName: fields.fathersOrHusbandsName || null,
    address: fields.address || null,
    pincode: fields.pincode || null,
    state: fields.state || null,
    mobileNumber: cleanedMobile,
    issueDate: fields.issueDate || null,
    enrolmentNumber: fields.enrolmentNumber || null,
    photoBase64: photo?.base64 ?? null,
    photoMimeType: photo?.mimeType ?? null,
    rawText: rawText.length > 4000 ? rawText.slice(0, 4000) : rawText,
  };
}

// ---------------------------------------------------------------------------
// Bank passbook
// ---------------------------------------------------------------------------

export type PassbookTransactionResult = {
  date: string | null;
  particulars: string | null;
  withdrawal: string | null;
  deposit: string | null;
  balance: string | null;
};

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
  transactions: PassbookTransactionResult[];
  rawText: string | null;
};

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

function extractTablesFromHtml(html: string): string[][][] {
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  const tables: string[][][] = [];
  let tm: RegExpExecArray | null;
  while ((tm = tableRe.exec(html)) !== null) {
    const rows: string[][] = [];
    let rm: RegExpExecArray | null;
    const tableInner = tm[1]!;
    while ((rm = rowRe.exec(tableInner)) !== null) {
      const cells: string[] = [];
      let cm: RegExpExecArray | null;
      const rowInner = rm[1]!;
      while ((cm = cellRe.exec(rowInner)) !== null) {
        cells.push(htmlToText(cm[1]!).trim());
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

function parsePassbookTransactions(html: string): PassbookTransactionResult[] {
  const tables = extractTablesFromHtml(html);
  const out: PassbookTransactionResult[] = [];
  for (const rows of tables) {
    if (rows.length < 2) continue;
    const header = rows[0]!.map((c) => c.toLowerCase());
    const dateIdx = header.findIndex((h) => /date/.test(h));
    const partIdx = header.findIndex((h) => /particular|description|narrat/.test(h));
    const withIdx = header.findIndex((h) => /withdraw|debit|dr/.test(h));
    const depIdx = header.findIndex((h) => /deposit|credit|cr/.test(h));
    const balIdx = header.findIndex((h) => /balance/.test(h));
    if (dateIdx < 0 || balIdx < 0) continue;
    for (let i = 1; i < rows.length && out.length < 10; i++) {
      const r = rows[i]!;
      const date = dateIdx >= 0 ? r[dateIdx] ?? null : null;
      if (!date || !/\d/.test(date)) continue;
      out.push({
        date,
        particulars: partIdx >= 0 ? r[partIdx] ?? null : null,
        withdrawal: withIdx >= 0 ? r[withIdx] ?? null : null,
        deposit: depIdx >= 0 ? r[depIdx] ?? null : null,
        balance: balIdx >= 0 ? r[balIdx] ?? null : null,
      });
    }
    if (out.length) break;
  }
  return out;
}

function parsePassbookFields(html: string): {
  text: string;
  data: Omit<PassbookOcrResult, "rawText" | "transactions">;
} {
  const text = htmlToText(html);

  const ifscMatch = text.match(/\b([A-Z]{4}0[A-Z0-9]{6})\b/);
  const ifsc = ifscMatch ? ifscMatch[1]! : findField(text, ["IFSC"]);
  const cleanedIfsc = ifsc ? ifsc.replace(/\s+/g, "").toUpperCase() : null;

  const micrField = findField(text, ["MICR"]);
  const micrMatch = (micrField ?? text).match(/\b(\d{9})\b/);
  const micr = micrMatch ? micrMatch[1]! : null;

  const cifRaw = findField(text, ["CIF Number", "CIF No", "CIF"]);
  const cif = cifRaw?.match(/\d[\d\s]*\d/)?.[0]?.replace(/\s+/g, "") ?? null;

  const accRaw = findField(text, ["Account No", "A/c No", "Account Number"]);
  const accountNumber =
    accRaw?.match(/\d[\d\s]*\d/)?.[0]?.replace(/\s+/g, "") ?? null;

  const accountType = findField(text, [
    "A/c Type",
    "Account Type",
    "Type of Account",
  ]);

  const nameRaw = findField(text, ["Name"]);
  const accountHolderName = nameRaw
    ? nameRaw.replace(/^(Mr|Mrs|Ms|Miss|Dr|Shri|Smt)\.?\s+/i, "").trim()
    : null;

  const branchRaw = findField(text, ["Branch"]);
  const branchName = branchRaw ? branchRaw.split(/\s{2,}|,/)[0]!.trim() : null;

  const branchCode = findField(text, ["Code", "Branch Code"]);

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
  const transactions = parsePassbookTransactions(html);

  return {
    ...data,
    transactions,
    rawText: text.length > 4000 ? text.slice(0, 4000) : text,
  };
}

// ---------------------------------------------------------------------------
// Form 7/12, Form 8A, Form 12 — Maharashtra land records
// ---------------------------------------------------------------------------

function extractLocationFields(text: string): {
  village: string | null;
  taluka: string | null;
  district: string | null;
} {
  const grab = (labels: string[]): string | null => {
    for (const l of labels) {
      const v = findField(text, [l]);
      if (v) {
        // Take only the first word/name (ignore trailing junk)
        return v.split(/[,\s]{2,}|\n/)[0]!.trim() || null;
      }
    }
    return null;
  };
  return {
    village: grab(["Village", "गाव", "मौजे", "मौजा"]),
    taluka: grab(["Taluka", "Tehsil", "तालुका", "तहसील"]),
    district: grab(["District", "जिल्हा", "जिला"]),
  };
}

export type Form7Result = {
  surveyNumber: string | null;
  village: string | null;
  taluka: string | null;
  district: string | null;
  ownershipEntries: Array<{
    srNo: string | null;
    ownerName: string | null;
    area: string | null;
    mutation: string | null;
  }>;
  rawText: string | null;
};

export async function extractForm7(
  buffer: Buffer,
  mimeType: string,
): Promise<Form7Result> {
  const ext = fileExtFor(mimeType);
  const result = await runMarker(buffer, `form7.${ext}`, mimeType, "form7");

  const blocks = result.json?.children ?? [];
  const html = blocks.map((b) => b.html ?? "").join("\n");
  const text = htmlToText(html);

  const loc = extractLocationFields(text);

  // Survey number: "Survey No.", "S.No.", "गट क्रमांक"
  const surveyMatch =
    text.match(
      /(?:Survey\s*No\.?|Gat\s*No\.?|S\.\s*No\.?|गट\s*क्रमांक|सर्वे\s*क्रमांक)\s*[:\-]?\s*([A-Z0-9\/\-]+)/i,
    ) ?? null;
  const surveyNumber = surveyMatch ? surveyMatch[1]!.trim() : null;

  // Ownership table — try first table that has at least 3 columns
  const tables = extractTablesFromHtml(html);
  const entries: Form7Result["ownershipEntries"] = [];
  for (const rows of tables) {
    if (rows.length < 2) continue;
    const header = rows[0]!.map((c) => c.toLowerCase());
    const hasOwner = header.some((h) => /name|owner|कब्जेदार|मालक/.test(h));
    if (!hasOwner) continue;
    const srIdx = header.findIndex((h) => /sr|क्र/.test(h));
    const nameIdx = header.findIndex((h) => /name|owner|कब्जेदार|मालक/.test(h));
    const areaIdx = header.findIndex((h) => /area|क्षेत्र/.test(h));
    const mutIdx = header.findIndex((h) => /mutat|फेरफार/.test(h));
    for (let i = 1; i < rows.length && entries.length < 12; i++) {
      const r = rows[i]!;
      const ownerName = nameIdx >= 0 ? r[nameIdx] ?? null : null;
      if (!ownerName || ownerName.length < 2) continue;
      entries.push({
        srNo: srIdx >= 0 ? r[srIdx] ?? null : null,
        ownerName,
        area: areaIdx >= 0 ? r[areaIdx] ?? null : null,
        mutation: mutIdx >= 0 ? r[mutIdx] ?? null : null,
      });
    }
    if (entries.length) break;
  }

  return {
    surveyNumber,
    ...loc,
    ownershipEntries: entries,
    rawText: text.length > 4000 ? text.slice(0, 4000) : text,
  };
}

export type Form8aResult = {
  village: string | null;
  taluka: string | null;
  district: string | null;
  khateNumber: string | null;
  accountHolderName: string | null;
  totalArea: string | null;
  holdings: Array<{
    surveyNumber: string | null;
    area: string | null;
    landRevenue: string | null;
    remarks: string | null;
  }>;
  rawText: string | null;
};

export async function extractForm8a(
  buffer: Buffer,
  mimeType: string,
): Promise<Form8aResult> {
  const ext = fileExtFor(mimeType);
  const result = await runMarker(buffer, `form8a.${ext}`, mimeType, "form8a");

  const blocks = result.json?.children ?? [];
  const html = blocks.map((b) => b.html ?? "").join("\n");
  const text = htmlToText(html);

  const loc = extractLocationFields(text);

  const khateMatch = text.match(
    /(?:Khata\s*No\.?|Khate\s*No\.?|खाते\s*क्रमांक|खाता\s*क्रमांक)\s*[:\-]?\s*([A-Z0-9\/\-]+)/i,
  );
  const khateNumber = khateMatch ? khateMatch[1]!.trim() : null;

  const nameRaw =
    findField(text, ["Account Holder", "Khatedar", "खातेदार", "Name"]) ?? null;
  const accountHolderName = nameRaw
    ? nameRaw.replace(/^(Mr|Mrs|Ms|Shri|Smt)\.?\s+/i, "").trim()
    : null;

  const totalAreaRaw =
    findField(text, ["Total Area", "एकूण क्षेत्र", "एकुण क्षेत्र"]) ?? null;
  const totalArea = totalAreaRaw ?? null;

  const tables = extractTablesFromHtml(html);
  const holdings: Form8aResult["holdings"] = [];
  for (const rows of tables) {
    if (rows.length < 2) continue;
    const header = rows[0]!.map((c) => c.toLowerCase());
    const sIdx = header.findIndex((h) => /survey|gat|s\.\s*no|सर्वे|गट/.test(h));
    if (sIdx < 0) continue;
    const aIdx = header.findIndex((h) => /area|क्षेत्र/.test(h));
    const rIdx = header.findIndex((h) => /revenue|आकार|जमीन\s*महसूल/.test(h));
    const remIdx = header.findIndex((h) => /remark|शेरा/.test(h));
    for (let i = 1; i < rows.length && holdings.length < 20; i++) {
      const r = rows[i]!;
      const sn = r[sIdx] ?? null;
      if (!sn || !/[A-Za-z0-9]/.test(sn)) continue;
      holdings.push({
        surveyNumber: sn,
        area: aIdx >= 0 ? r[aIdx] ?? null : null,
        landRevenue: rIdx >= 0 ? r[rIdx] ?? null : null,
        remarks: remIdx >= 0 ? r[remIdx] ?? null : null,
      });
    }
    if (holdings.length) break;
  }

  return {
    ...loc,
    khateNumber,
    accountHolderName,
    totalArea,
    holdings,
    rawText: text.length > 4000 ? text.slice(0, 4000) : text,
  };
}

export type Form12Result = {
  village: string | null;
  taluka: string | null;
  district: string | null;
  cropEntries: Array<{
    year: string | null;
    season: string | null;
    cropName: string | null;
    area: string | null;
    irrigatedArea: string | null;
    irrigationSource: string | null;
  }>;
  rawText: string | null;
};

export async function extractForm12(
  buffer: Buffer,
  mimeType: string,
): Promise<Form12Result> {
  const ext = fileExtFor(mimeType);
  const result = await runMarker(buffer, `form12.${ext}`, mimeType, "form12");

  const blocks = result.json?.children ?? [];
  const html = blocks.map((b) => b.html ?? "").join("\n");
  const text = htmlToText(html);

  const loc = extractLocationFields(text);

  const tables = extractTablesFromHtml(html);
  const entries: Form12Result["cropEntries"] = [];
  for (const rows of tables) {
    if (rows.length < 2) continue;
    const header = rows[0]!.map((c) => c.toLowerCase());
    const cropIdx = header.findIndex((h) => /crop|पीक|पिक/.test(h));
    if (cropIdx < 0) continue;
    const yearIdx = header.findIndex((h) => /year|वर्ष|साल/.test(h));
    const seasonIdx = header.findIndex(
      (h) => /season|hangam|hangaam|हंगाम/.test(h),
    );
    const areaIdx = header.findIndex((h) => /area|क्षेत्र/.test(h));
    const irrAreaIdx = header.findIndex(
      (h) => /irrig.*area|बागायत/.test(h),
    );
    const irrSrcIdx = header.findIndex(
      (h) => /source|सिंचन\s*साधन|पाण्याचे/.test(h),
    );
    for (let i = 1; i < rows.length && entries.length < 30; i++) {
      const r = rows[i]!;
      const cropName = r[cropIdx] ?? null;
      if (!cropName || cropName.length < 2) continue;
      entries.push({
        year: yearIdx >= 0 ? r[yearIdx] ?? null : null,
        season: seasonIdx >= 0 ? r[seasonIdx] ?? null : null,
        cropName,
        area: areaIdx >= 0 ? r[areaIdx] ?? null : null,
        irrigatedArea: irrAreaIdx >= 0 ? r[irrAreaIdx] ?? null : null,
        irrigationSource: irrSrcIdx >= 0 ? r[irrSrcIdx] ?? null : null,
      });
    }
    if (entries.length) break;
  }

  return {
    ...loc,
    cropEntries: entries,
    rawText: text.length > 4000 ? text.slice(0, 4000) : text,
  };
}
