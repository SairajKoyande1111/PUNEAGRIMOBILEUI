import { Platform } from "react-native";
import { API_BASE } from "@/app/_layout";

export type DocType =
  | "aadhar"
  | "bank_passbook"
  | "form7"
  | "form12"
  | "form8a";

export type ExtractStage = "idle" | "uploading" | "processing" | "done" | "error";

export type ProfileSection = {
  saved: boolean;
  section: string | null;
  error: string | null;
};

/**
 * Submit a document image to the API server for OCR extraction.
 * The server submits the file to Datalab and polls for results.
 * When complete, it auto-saves the extracted data to the MongoDB
 * profile for the given phone number.
 *
 * @param phone       10-digit phone number (no +91 prefix)
 * @param docType     One of: aadhar | bank_passbook | form7 | form12 | form8a
 * @param imageUri    Local file URI from expo-image-picker
 * @param mimeType    MIME type, e.g. "image/jpeg"
 * @param onStage     Optional callback called on each stage change
 * @returns           { saved, section, error }
 */
export async function extractDocument(
  phone: string,
  docType: DocType,
  imageUri: string,
  mimeType: string,
  onStage?: (stage: ExtractStage) => void,
): Promise<ProfileSection> {
  onStage?.("uploading");

  // Build multipart/form-data
  // Web browsers and React Native handle file uploads VERY differently.
  // - On native, fetch() understands a special { uri, name, type } object.
  // - On web, that object is meaningless — the browser's FormData needs a
  //   real Blob/File, so we have to fetch the local URI first.
  const formData = new FormData();
  const ext = mimeType.split("/")[1] ?? "jpg";
  const filename = `document.${ext}`;

  if (Platform.OS === "web") {
    // expo-image-picker on web hands us a `blob:` or `data:` URL
    const res = await fetch(imageUri);
    const blob = await res.blob();
    const file =
      typeof File !== "undefined"
        ? new File([blob], filename, { type: mimeType })
        : blob;
    formData.append("file", file, filename);
  } else {
    formData.append("file", {
      uri: imageUri,
      name: filename,
      type: mimeType,
    } as unknown as Blob);
  }
  formData.append("document_type", docType);
  formData.append("profile_phone", phone);
  formData.append("mode", "accurate");

  // Submit
  const submitRes = await fetch(`${API_BASE}/api/extract`, {
    method: "POST",
    body: formData,
  });

  if (!submitRes.ok) {
    let errMsg = `Upload failed (HTTP ${submitRes.status})`;
    try {
      const j = await submitRes.json();
      if (j?.error) errMsg = j.error;
    } catch (_) {}
    throw new Error(errMsg);
  }

  const submitData = (await submitRes.json()) as { request_id: string };
  const requestId = submitData.request_id;

  onStage?.("processing");

  // Poll every 5 seconds, max 36 attempts = 3 minutes
  for (let attempt = 0; attempt < 36; attempt++) {
    await new Promise<void>((r) => setTimeout(r, 5000));

    let pollData: {
      status: string;
      error?: string;
      profile?: ProfileSection;
    };

    try {
      const pollRes = await fetch(`${API_BASE}/api/extract/${requestId}`);
      pollData = await pollRes.json();
    } catch (_) {
      continue; // network hiccup — keep polling
    }

    if (pollData.status === "complete") {
      onStage?.("done");
      return (
        pollData.profile ?? {
          saved: false,
          section: null,
          error: "No profile info returned by server",
        }
      );
    }

    if (pollData.status === "error") {
      throw new Error(pollData.error ?? "Extraction failed on server");
    }

    // status === "processing" — continue
  }

  throw new Error("Document extraction timed out after 3 minutes. Please try again.");
}

/**
 * Fetch the full user profile from MongoDB.
 */
export async function fetchProfile(phone: string): Promise<UserProfile | null> {
  try {
    const res = await fetch(`${API_BASE}/api/profiles/${phone}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data as { profile: UserProfile }).profile ?? null;
  } catch (_) {
    return null;
  }
}

/**
 * Create or ensure a user profile exists in MongoDB.
 * Call this after OTP verification.
 */
export async function ensureProfile(phone: string, name = ""): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/profiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, name }),
    });
  } catch (_) {
    // Non-critical — profile will be created on first upload if missing
  }
}

// ─── MongoDB Profile Type Definitions ────────────────────────────────────────

export type AadharSection = {
  name?: string | null;
  aadhaarNumber?: string | null;
  vid?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  fathersOrHusbandsName?: string | null;
  address?: string | null;
  pincode?: string | null;
  state?: string | null;
  mobileNumber?: string | null;
  issueDate?: string | null;
  enrolmentNumber?: string | null;
  photoBase64?: string | null;
  photoMimeType?: string | null;
};

export type PassbookSection = {
  bankName?: string | null;
  accountHolderName?: string | null;
  cifNumber?: string | null;
  accountNumber?: string | null;
  accountType?: string | null;
  ifsc?: string | null;
  micr?: string | null;
  branchName?: string | null;
  branchCode?: string | null;
  accountOpeningDate?: string | null;
  transactions?: Array<{
    date?: string | null;
    particulars?: string | null;
    chequeRef?: string | null;
    withdrawal?: string | null;
    deposit?: string | null;
    balance?: string | null;
  }>;
};

export type Form7Section = {
  surveyNumber?: string | null;
  village?: string | null;
  taluka?: string | null;
  district?: string | null;
  ownershipEntries?: Array<{
    srNo?: string | null;
    ownerName?: string | null;
    ownerAddress?: string | null;
    area?: string | null;
    assessedRate?: string | null;
    mutation?: string | null;
    remarks?: string | null;
  }>;
  rawText?: string | null;
};

export type Form12Section = {
  village?: string | null;
  taluka?: string | null;
  district?: string | null;
  cropEntries?: Array<{
    year?: string | null;
    season?: string | null;
    khateNumber?: string | null;
    cropType?: string | null;
    cropName?: string | null;
    irrigatedArea?: string | null;
    unirrigatedArea?: string | null;
    irrigationSource?: string | null;
    area?: string | null;
    remarks?: string | null;
  }>;
  rawText?: string | null;
};

export type Form8aSection = {
  village?: string | null;
  taluka?: string | null;
  district?: string | null;
  khateNumber?: string | null;
  accountHolderName?: string | null;
  totalArea?: string | null;
  holdings?: Array<{
    surveyNumber?: string | null;
    subDivision?: string | null;
    area?: string | null;
    assessedRate?: string | null;
    landRevenue?: string | null;
    localCess?: string | null;
    totalDue?: string | null;
    remarks?: string | null;
  }>;
  rawText?: string | null;
};

export type UserProfile = {
  _id?: string;
  phone: string;
  name?: string | null;
  code?: string | null;
  createdAt: string;
  updatedAt: string;
  aadhar?: AadharSection | null;
  passbook?: PassbookSection | null;
  form7?: Form7Section | null;
  form12?: Form12Section | null;
  form8a?: Form8aSection | null;
};
