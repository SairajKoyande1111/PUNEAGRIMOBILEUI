# Agent Instructions — PuneAgri Mobile App: Document Upload & Profile Display

## What You Are Building

This mobile app (Expo / React Native) lets farmers upload official Indian government documents (Aadhaar card, Bank Passbook, Form 7/12, Form 8A, Form 12). When uploaded, the server extracts all printed fields using an OCR API (Datalab) and stores the structured data in MongoDB. The same MongoDB database is shared with a companion web application — so data uploaded on mobile is immediately visible on the web and vice versa.

Your job is to implement:
1. Full document upload flow (submit → poll → confirm saved) for all five document types
2. A fully populated Profile screen that displays every extracted field in a clean, mobile-friendly layout matching the design language already in the app

---

## Current Codebase State

The app already has:
- Auth flow: phone entry → OTP → document upload screen → tabs (Home, Application, Grievance, Payments, Profile)
- `AuthContext` (in `context/AuthContext.tsx`) that stores `phone`, `documents`, and `stage` in AsyncStorage
- `upload.tsx` that currently calls `ocrAadhar` and `ocrPassbook` from `@workspace/api-client-react` using a base64 approach — **this is the old API and must be replaced**
- `profile.tsx` that calls `useGetUserByPhone` from `@workspace/api-client-react` — **this targets the old `/api/users/:phone` endpoint and must be replaced**
- Design tokens via `useColors()` from `hooks/useColors.ts`
- `Feather` icons from `@expo/vector-icons`
- Fonts: `Inter_400Regular`, `Inter_500Medium`, `Inter_600SemiBold`, `Inter_700Bold`

The **new** API server (running at `EXPO_PUBLIC_API_URL`) has completely different endpoints (documented in Section 3 below). The old `/api/ocr/aadhar`, `/api/ocr/passbook`, and `/api/users/:phone` routes no longer exist.

---

## Step-by-Step Implementation Plan

### Step 1 — Set the API base URL environment variable

In `artifacts/mobile/.env` (create this file if it does not exist):

```
EXPO_PUBLIC_API_URL=https://YOUR_API_SERVER_DOMAIN
```

> The API server runs on port 8080. In Replit, the value should be the artifact URL for `artifacts/api-server`. Ask the user for the correct URL if unsure, or look for `REPLIT_DEV_DOMAIN` environment variable and use `https://${REPLIT_DEV_DOMAIN}` as a fallback.

In `artifacts/mobile/app/_layout.tsx`, replace the existing `setBaseUrl` block with:

```tsx
// Keep the existing setBaseUrl call for the legacy api-client-react (used by React Query).
// Also expose the new API base URL for direct fetch calls.
const apiDomain = process.env.EXPO_PUBLIC_DOMAIN;
if (apiDomain) {
  setBaseUrl(`https://${apiDomain}`);
}
export const API_BASE: string =
  process.env.EXPO_PUBLIC_API_URL ??
  (apiDomain ? `https://${apiDomain}` : "http://localhost:8080");
```

---

### Step 2 — Create the document extraction utility

Create the file `artifacts/mobile/hooks/useDocumentExtract.ts` with the following content **exactly**:

```ts
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

  // Build multipart/form-data — React Native's fetch handles this natively
  const formData = new FormData();
  const ext = mimeType.split("/")[1] ?? "jpg";
  formData.append("file", {
    uri: imageUri,
    name: `document.${ext}`,
    type: mimeType,
  } as unknown as Blob);
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
```

---

### Step 3 — Update AuthContext to create a profile on OTP verify

In `artifacts/mobile/context/AuthContext.tsx`, update the `verifyOtp` function. Import `ensureProfile`:

```ts
import { ensureProfile } from "@/hooks/useDocumentExtract";
```

Replace the existing `verifyOtp` implementation with:

```ts
const verifyOtp = useCallback(async () => {
  // Ensure a MongoDB profile exists for this phone number
  if (state.phone) {
    await ensureProfile(state.phone);
  }
  await persist({ ...state, stage: "documents" });
}, [persist, state]);
```

---

### Step 4 — Replace upload.tsx completely

Replace the entire content of `artifacts/mobile/app/upload.tsx` with:

```tsx
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  type DocType,
  type ExtractStage,
  extractDocument,
} from "@/hooks/useDocumentExtract";

// ─── Document catalogue ───────────────────────────────────────────────────────

type DocItem = {
  id: string;
  apiType: DocType;
  title: string;
  description: string;
  icon: keyof typeof Feather.glyphMap;
  required: boolean;
};

const DOCUMENTS: DocItem[] = [
  {
    id: "aadhar",
    apiType: "aadhar",
    title: "Aadhaar Card",
    description: "Both sides clearly visible",
    icon: "credit-card",
    required: true,
  },
  {
    id: "bank_passbook",
    apiType: "bank_passbook",
    title: "Bank Passbook",
    description: "First page with account number",
    icon: "book",
    required: false,
  },
  {
    id: "form_7",
    apiType: "form7",
    title: "Form 7/12",
    description: "Land ownership record (अधिकार अभिलेख)",
    icon: "file-text",
    required: false,
  },
  {
    id: "form_8a",
    apiType: "form8a",
    title: "Form 8A",
    description: "Holding register (खाते उतारा)",
    icon: "layers",
    required: false,
  },
  {
    id: "form_12",
    apiType: "form12",
    title: "Form 12",
    description: "Crop inspection register (पीक पाहणी)",
    icon: "grid",
    required: false,
  },
];

// ─── Status colours ───────────────────────────────────────────────────────────

function stageColor(
  stage: ExtractStage,
  colors: ReturnType<typeof useColors>,
): string {
  switch (stage) {
    case "uploading":
    case "processing":
      return colors.accent;
    case "done":
      return colors.success;
    case "error":
      return colors.destructive;
    default:
      return colors.mutedForeground;
  }
}

function stageLabel(stage: ExtractStage): string {
  switch (stage) {
    case "uploading":
      return "Uploading…";
    case "processing":
      return "Reading document…";
    case "done":
      return "Saved ✓";
    case "error":
      return "Failed";
    default:
      return "";
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function UploadScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { phone, documents, setDocument, finishDocuments } = useAuth();

  const [stages, setStages] = useState<Record<string, ExtractStage>>({});
  const [submitting, setSubmitting] = useState(false);

  const setStage = (id: string, stage: ExtractStage) =>
    setStages((prev) => ({ ...prev, [id]: stage }));

  const uploadedCount = useMemo(
    () => DOCUMENTS.filter((d) => documents[d.id]).length,
    [documents],
  );

  const aadharDone = !!documents["aadhar"];
  const anyBusy = Object.values(stages).some(
    (s) => s === "uploading" || s === "processing",
  );

  // ── Pick image and trigger extraction ──────────────────────────────────────

  const handlePick = async (doc: DocItem) => {
    if (!phone) {
      Alert.alert("Error", "No phone number found. Please log in again.");
      return;
    }

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Permission required",
        "Please allow access to your photo library in Settings.",
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.88,
      allowsEditing: false,
      base64: false,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    const mimeType = asset.mimeType ?? "image/jpeg";

    setStage(doc.id, "uploading");

    try {
      const outcome = await extractDocument(
        phone,
        doc.apiType,
        asset.uri,
        mimeType,
        (s) => setStage(doc.id, s),
      );

      if (outcome.saved) {
        await setDocument(doc.id, asset.uri);
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } else {
        setStage(doc.id, "error");
        Alert.alert(
          "Could not save",
          outcome.error ??
            "The document was uploaded but data could not be saved. Please try a clearer photo.",
        );
      }
    } catch (e) {
      setStage(doc.id, "error");
      const msg = e instanceof Error ? e.message : "Upload failed";
      Alert.alert("Upload failed", msg);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    }
  };

  // ── Finish ─────────────────────────────────────────────────────────────────

  const handleFinish = async () => {
    if (!aadharDone || anyBusy || submitting) return;
    setSubmitting(true);
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    await finishDocuments();
    setSubmitting(false);
  };

  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const webBottomInset = Platform.OS === "web" ? 34 : 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 16 + webTopInset,
          paddingBottom: insets.bottom + 120 + webBottomInset,
          paddingHorizontal: 20,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Text style={[styles.title, { color: colors.foreground }]}>
          Upload Documents
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Upload your documents to auto-fill your profile. Aadhaar is required;
          all others are optional.
        </Text>

        {/* Progress pill */}
        <View
          style={[
            styles.progressPill,
            { backgroundColor: colors.secondary },
          ]}
        >
          <Feather
            name="check-circle"
            size={14}
            color={
              uploadedCount === DOCUMENTS.length
                ? colors.success
                : colors.primary
            }
          />
          <Text
            style={[styles.progressText, { color: colors.primary }]}
          >
            {uploadedCount} of {DOCUMENTS.length} uploaded
          </Text>
        </View>

        {/* Document cards */}
        {DOCUMENTS.map((doc) => {
          const isDone = !!documents[doc.id];
          const stage = stages[doc.id] ?? "idle";
          const busy = stage === "uploading" || stage === "processing";

          return (
            <Pressable
              key={doc.id}
              onPress={() => !busy && handlePick(doc)}
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: colors.card,
                  borderColor: isDone
                    ? colors.success
                    : stage === "error"
                      ? colors.destructive
                      : colors.border,
                  borderRadius: 16,
                  opacity: pressed && !busy ? 0.88 : 1,
                },
              ]}
            >
              {/* Icon badge */}
              <View
                style={[
                  styles.iconBadge,
                  {
                    backgroundColor: isDone
                      ? `${colors.success}18`
                      : `${colors.primary}12`,
                  },
                ]}
              >
                {busy ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.accent}
                  />
                ) : (
                  <Feather
                    name={isDone ? "check" : doc.icon}
                    size={22}
                    color={isDone ? colors.success : colors.primary}
                  />
                )}
              </View>

              {/* Text */}
              <View style={{ flex: 1 }}>
                <View style={styles.titleRow}>
                  <Text
                    style={[
                      styles.cardTitle,
                      { color: colors.foreground },
                    ]}
                  >
                    {doc.title}
                  </Text>
                  {doc.required && (
                    <View
                      style={[
                        styles.requiredBadge,
                        { backgroundColor: `${colors.accent}18` },
                      ]}
                    >
                      <Text
                        style={[
                          styles.requiredText,
                          { color: colors.accent },
                        ]}
                      >
                        Required
                      </Text>
                    </View>
                  )}
                </View>
                <Text
                  style={[
                    styles.cardDesc,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {busy ? stageLabel(stage) : doc.description}
                </Text>
                {stage === "error" && (
                  <Text
                    style={[
                      styles.errorHint,
                      { color: colors.destructive },
                    ]}
                  >
                    Tap to retry
                  </Text>
                )}
              </View>

              {/* Chevron */}
              {!busy && (
                <Feather
                  name={isDone ? "refresh-cw" : "chevron-right"}
                  size={18}
                  color={
                    isDone ? colors.mutedForeground : colors.primary
                  }
                />
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Bottom CTA */}
      <View
        style={[
          styles.footer,
          {
            backgroundColor: colors.background,
            paddingBottom: insets.bottom + 16 + webBottomInset,
            borderTopColor: colors.border,
          },
        ]}
      >
        <Pressable
          onPress={handleFinish}
          disabled={!aadharDone || anyBusy || submitting}
          style={({ pressed }) => [
            styles.ctaBtn,
            {
              backgroundColor:
                aadharDone && !anyBusy
                  ? colors.primary
                  : colors.muted,
              borderRadius: 14,
              opacity: pressed ? 0.88 : 1,
            },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text
              style={[
                styles.ctaText,
                {
                  color:
                    aadharDone && !anyBusy
                      ? colors.primaryForeground
                      : colors.mutedForeground,
                },
              ]}
            >
              {aadharDone ? "Continue to Profile" : "Upload Aadhaar to continue"}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  title: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.6,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    marginBottom: 16,
  },
  progressPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 20,
  },
  progressText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1.5,
  },
  iconBadge: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 3,
  },
  cardTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  requiredBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  requiredText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  cardDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  errorHint: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    borderTopWidth: 1,
  },
  ctaBtn: {
    height: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
});
```

---

### Step 5 — Replace profile.tsx completely

Replace the entire content of `artifacts/mobile/app/(tabs)/profile.tsx` with the following. This screen shows all five document sections — Aadhaar, Bank Passbook, Form 7/12, Form 8A, and Form 12 — in a clean card layout:

```tsx
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  fetchProfile,
  type UserProfile,
  type AadharSection,
  type PassbookSection,
  type Form7Section,
  type Form12Section,
  type Form8aSection,
} from "@/hooks/useDocumentExtract";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function maskAadhaar(num?: string | null): string {
  if (!num) return "—";
  const d = num.replace(/\D/g, "");
  if (d.length !== 12) return num;
  return `XXXX  XXXX  ${d.slice(8)}`;
}

function maskAccount(num?: string | null): string {
  if (!num) return "—";
  const d = num.replace(/\D/g, "");
  if (d.length <= 4) return num;
  return `${"X".repeat(d.length - 4)}${d.slice(-4)}`;
}

function fmtPhone(phone?: string | null): string {
  if (!phone) return "—";
  const d = phone.replace(/\D/g, "");
  if (d.length === 10) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  return phone;
}

// ─── Reusable field row ───────────────────────────────────────────────────────

function Field({
  label,
  value,
  mono = false,
  multiline = false,
  colors,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  multiline?: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <Text
        style={[
          styles.fieldValue,
          {
            color: value ? colors.foreground : colors.mutedForeground,
            fontFamily: mono ? "Inter_700Bold" : "Inter_600SemiBold",
            letterSpacing: mono ? 1.2 : 0,
          },
        ]}
        numberOfLines={multiline ? 0 : 1}
        ellipsizeMode="tail"
      >
        {value || "—"}
      </Text>
    </View>
  );
}

// ─── Section card wrapper ─────────────────────────────────────────────────────

function SectionCard({
  icon,
  title,
  children,
  colors,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.cardIconBadge,
            { backgroundColor: `${colors.primary}12` },
          ]}
        >
          <Feather name={icon} size={16} color={colors.primary} />
        </View>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

// ─── Empty state card ─────────────────────────────────────────────────────────

function EmptyCard({
  icon,
  title,
  body,
  colors,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  body: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={[
        styles.emptyCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Feather name={icon} size={22} color={colors.mutedForeground} />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
        {title}
      </Text>
      <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
        {body}
      </Text>
    </View>
  );
}

// ─── Table component ──────────────────────────────────────────────────────────

function DataTable({
  headers,
  rows,
  colors,
}: {
  headers: string[];
  rows: (string | null | undefined)[][];
  colors: ReturnType<typeof useColors>;
}) {
  if (!rows.length) return null;
  const colWidth = Math.floor(320 / headers.length);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        {/* Header row */}
        <View
          style={[
            styles.tableRow,
            { backgroundColor: `${colors.primary}10` },
          ]}
        >
          {headers.map((h) => (
            <Text
              key={h}
              style={[
                styles.tableHeader,
                { color: colors.primary, width: colWidth },
              ]}
            >
              {h}
            </Text>
          ))}
        </View>
        {/* Data rows */}
        {rows.map((row, i) => (
          <View
            key={i}
            style={[
              styles.tableRow,
              {
                backgroundColor:
                  i % 2 === 0 ? colors.card : `${colors.muted}80`,
                borderTopColor: colors.border,
                borderTopWidth: 0.5,
              },
            ]}
          >
            {row.map((cell, j) => (
              <Text
                key={j}
                style={[
                  styles.tableCell,
                  { color: colors.foreground, width: colWidth },
                ]}
                numberOfLines={2}
              >
                {cell || "—"}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { phone, signOut } = useAuth();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const webBottomInset = Platform.OS === "web" ? 84 : 0;

  const load = useCallback(async () => {
    if (!phone) return;
    const p = await fetchProfile(phone);
    setProfile(p);
  }, [phone]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    await load();
    setRefreshing(false);
  }, [load]);

  const onLogout = () => {
    const doLogout = async () => {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      await signOut();
    };
    if (Platform.OS === "web") {
      doLogout();
      return;
    }
    Alert.alert("Log out?", "You'll need to sign in again with your number.", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: doLogout },
    ]);
  };

  const aadhar = profile?.aadhar ?? null;
  const passbook = profile?.passbook ?? null;
  const form7 = profile?.form7 ?? null;
  const form8a = profile?.form8a ?? null;
  const form12 = profile?.form12 ?? null;

  const photoUri =
    aadhar?.photoBase64 && aadhar.photoMimeType
      ? `data:${aadhar.photoMimeType};base64,${aadhar.photoBase64}`
      : null;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 16 + webTopInset,
          paddingBottom: insets.bottom + 32 + webBottomInset,
          paddingHorizontal: 20,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Page title + refresh */}
        <View style={styles.titleRow}>
          <Text style={[styles.pageTitle, { color: colors.foreground }]}>
            Profile
          </Text>
          <Pressable
            onPress={onRefresh}
            hitSlop={12}
            style={{ padding: 6 }}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Feather name="refresh-cw" size={18} color={colors.primary} />
            )}
          </Pressable>
        </View>

        {/* ── Hero card ───────────────────────────────────────────────────── */}
        <View
          style={[
            styles.hero,
            { backgroundColor: colors.primary, borderRadius: 20 },
          ]}
        >
          <View style={styles.heroRow}>
            {photoUri ? (
              <Image
                source={{ uri: photoUri }}
                style={[
                  styles.heroPhoto,
                  { borderColor: colors.primaryForeground },
                ]}
                resizeMode="cover"
              />
            ) : (
              <View
                style={[
                  styles.heroPhoto,
                  {
                    backgroundColor: "rgba(255,255,255,0.18)",
                    borderColor: colors.primaryForeground,
                    alignItems: "center",
                    justifyContent: "center",
                  },
                ]}
              >
                <Feather name="user" size={32} color={colors.primaryForeground} />
              </View>
            )}
            <View style={{ flex: 1, marginLeft: 16 }}>
              <Text
                style={[
                  styles.heroLabel,
                  { color: "rgba(255,255,255,0.7)" },
                ]}
              >
                {aadhar?.name ? "VERIFIED USER" : "WELCOME"}
              </Text>
              <Text
                style={[styles.heroName, { color: colors.primaryForeground }]}
                numberOfLines={2}
              >
                {aadhar?.name || fmtPhone(phone)}
              </Text>
              {profile?.code ? (
                <Text
                  style={[
                    styles.heroSub,
                    { color: "rgba(255,255,255,0.8)" },
                  ]}
                >
                  {profile.code}
                </Text>
              ) : null}
              {aadhar?.aadhaarNumber ? (
                <Text
                  style={[
                    styles.heroSub,
                    { color: "rgba(255,255,255,0.8)", marginTop: 2 },
                  ]}
                >
                  Aadhaar {maskAadhaar(aadhar.aadhaarNumber)}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Section status pills */}
          <View style={styles.pillRow}>
            {[
              { key: "aadhar", label: "Aadhaar", val: aadhar },
              { key: "passbook", label: "Bank", val: passbook },
              { key: "form7", label: "Form 7/12", val: form7 },
              { key: "form8a", label: "Form 8A", val: form8a },
              { key: "form12", label: "Form 12", val: form12 },
            ].map(({ key, label, val }) => (
              <View
                key={key}
                style={[
                  styles.pill,
                  {
                    backgroundColor: val
                      ? "rgba(255,255,255,0.22)"
                      : "rgba(255,255,255,0.08)",
                  },
                ]}
              >
                <Feather
                  name={val ? "check-circle" : "circle"}
                  size={10}
                  color={
                    val ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.4)"
                  }
                />
                <Text
                  style={[
                    styles.pillText,
                    {
                      color: val
                        ? "rgba(255,255,255,0.95)"
                        : "rgba(255,255,255,0.4)",
                    },
                  ]}
                >
                  {label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Loading spinner */}
        {loading && (
          <View style={{ alignItems: "center", paddingVertical: 24 }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}

        {/* ── Aadhaar ─────────────────────────────────────────────────────── */}
        {aadhar ? (
          <SectionCard icon="credit-card" title="Aadhaar Card" colors={colors}>
            <Field label="Full Name" value={aadhar.name} colors={colors} />
            <Field
              label="Aadhaar Number"
              value={
                aadhar.aadhaarNumber
                  ? aadhar.aadhaarNumber
                      .replace(/\D/g, "")
                      .replace(/(\d{4})(?=\d)/g, "$1 ")
                  : null
              }
              mono
              colors={colors}
            />
            {aadhar.vid && (
              <Field label="VID" value={aadhar.vid} mono colors={colors} />
            )}
            <Field label="Date of Birth" value={aadhar.dateOfBirth} colors={colors} />
            <Field label="Gender" value={aadhar.gender} colors={colors} />
            {aadhar.fathersOrHusbandsName && (
              <Field
                label="Father / Husband"
                value={aadhar.fathersOrHusbandsName}
                colors={colors}
              />
            )}
            <Field
              label="Address"
              value={aadhar.address}
              multiline
              colors={colors}
            />
            {aadhar.pincode && (
              <Field label="PIN Code" value={aadhar.pincode} mono colors={colors} />
            )}
            {aadhar.state && (
              <Field label="State" value={aadhar.state} colors={colors} />
            )}
            <Field
              label="Linked Mobile"
              value={fmtPhone(aadhar.mobileNumber)}
              colors={colors}
            />
            {aadhar.issueDate && (
              <Field label="Issue Date" value={aadhar.issueDate} colors={colors} />
            )}
            {aadhar.enrolmentNumber && (
              <Field
                label="Enrolment No."
                value={aadhar.enrolmentNumber}
                mono
                colors={colors}
              />
            )}
          </SectionCard>
        ) : !loading ? (
          <EmptyCard
            icon="credit-card"
            title="No Aadhaar on file"
            body="Upload your Aadhaar card from the Documents screen to auto-fill your profile."
            colors={colors}
          />
        ) : null}

        {/* ── Bank Passbook ────────────────────────────────────────────────── */}
        {passbook ? (
          <SectionCard icon="book" title="Bank Passbook" colors={colors}>
            <Field label="Bank Name" value={passbook.bankName} colors={colors} />
            <Field
              label="Account Holder"
              value={passbook.accountHolderName}
              colors={colors}
            />
            <Field
              label="CIF Number"
              value={passbook.cifNumber}
              mono
              colors={colors}
            />
            <Field
              label="Account Number"
              value={maskAccount(passbook.accountNumber)}
              mono
              colors={colors}
            />
            <Field
              label="Account Type"
              value={passbook.accountType}
              colors={colors}
            />
            <Field label="IFSC Code" value={passbook.ifsc} mono colors={colors} />
            {passbook.micr && (
              <Field label="MICR" value={passbook.micr} mono colors={colors} />
            )}
            <Field
              label="Branch"
              value={
                passbook.branchName && passbook.branchCode
                  ? `${passbook.branchName} (${passbook.branchCode})`
                  : passbook.branchName ?? passbook.branchCode
              }
              colors={colors}
            />
            {passbook.accountOpeningDate && (
              <Field
                label="Opened On"
                value={passbook.accountOpeningDate}
                colors={colors}
              />
            )}
            {passbook.transactions && passbook.transactions.length > 0 && (
              <View style={{ marginTop: 12 }}>
                <Text
                  style={[
                    styles.subHeading,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Recent Transactions
                </Text>
                <DataTable
                  headers={["Date", "Particulars", "Withdrawal", "Deposit", "Balance"]}
                  rows={passbook.transactions.map((t) => [
                    t.date,
                    t.particulars,
                    t.withdrawal,
                    t.deposit,
                    t.balance,
                  ])}
                  colors={colors}
                />
              </View>
            )}
          </SectionCard>
        ) : !loading ? (
          <EmptyCard
            icon="book"
            title="No bank passbook on file"
            body="Upload the first page of your bank passbook from the Documents screen."
            colors={colors}
          />
        ) : null}

        {/* ── Form 7/12 ────────────────────────────────────────────────────── */}
        {form7 ? (
          <SectionCard icon="file-text" title="Form 7/12 — Land Record" colors={colors}>
            <Field label="Survey Number" value={form7.surveyNumber} mono colors={colors} />
            <Field label="Village" value={form7.village} colors={colors} />
            <Field label="Taluka" value={form7.taluka} colors={colors} />
            <Field label="District" value={form7.district} colors={colors} />
            {form7.ownershipEntries && form7.ownershipEntries.length > 0 && (
              <View style={{ marginTop: 12 }}>
                <Text
                  style={[styles.subHeading, { color: colors.mutedForeground }]}
                >
                  Ownership Entries
                </Text>
                <DataTable
                  headers={["Sr.", "Owner Name", "Area", "Mutation"]}
                  rows={form7.ownershipEntries.map((e) => [
                    e.srNo,
                    e.ownerName,
                    e.area,
                    e.mutation,
                  ])}
                  colors={colors}
                />
              </View>
            )}
          </SectionCard>
        ) : !loading ? (
          <EmptyCard
            icon="file-text"
            title="No Form 7/12 on file"
            body="Upload your Form 7/12 land record from the Documents screen."
            colors={colors}
          />
        ) : null}

        {/* ── Form 8A ──────────────────────────────────────────────────────── */}
        {form8a ? (
          <SectionCard icon="layers" title="Form 8A — Holding Register" colors={colors}>
            <Field label="Village" value={form8a.village} colors={colors} />
            <Field label="Taluka" value={form8a.taluka} colors={colors} />
            <Field label="District" value={form8a.district} colors={colors} />
            <Field label="Khate Number" value={form8a.khateNumber} mono colors={colors} />
            <Field
              label="Account Holder"
              value={form8a.accountHolderName}
              colors={colors}
            />
            {form8a.totalArea && (
              <Field label="Total Area" value={form8a.totalArea} colors={colors} />
            )}
            {form8a.holdings && form8a.holdings.length > 0 && (
              <View style={{ marginTop: 12 }}>
                <Text
                  style={[styles.subHeading, { color: colors.mutedForeground }]}
                >
                  Holdings
                </Text>
                <DataTable
                  headers={["Survey No.", "Area", "Land Revenue", "Remarks"]}
                  rows={form8a.holdings.map((h) => [
                    h.surveyNumber,
                    h.area,
                    h.landRevenue,
                    h.remarks,
                  ])}
                  colors={colors}
                />
              </View>
            )}
          </SectionCard>
        ) : !loading ? (
          <EmptyCard
            icon="layers"
            title="No Form 8A on file"
            body="Upload your Form 8A holding register from the Documents screen."
            colors={colors}
          />
        ) : null}

        {/* ── Form 12 ──────────────────────────────────────────────────────── */}
        {form12 ? (
          <SectionCard icon="grid" title="Form 12 — Crop Record" colors={colors}>
            <Field label="Village" value={form12.village} colors={colors} />
            <Field label="Taluka" value={form12.taluka} colors={colors} />
            <Field label="District" value={form12.district} colors={colors} />
            {form12.cropEntries && form12.cropEntries.length > 0 && (
              <View style={{ marginTop: 12 }}>
                <Text
                  style={[styles.subHeading, { color: colors.mutedForeground }]}
                >
                  Crop Entries
                </Text>
                <DataTable
                  headers={["Year", "Season", "Crop", "Area", "Irrigation"]}
                  rows={form12.cropEntries.map((e) => [
                    e.year,
                    e.season,
                    e.cropName,
                    e.area ?? e.irrigatedArea,
                    e.irrigationSource,
                  ])}
                  colors={colors}
                />
              </View>
            )}
          </SectionCard>
        ) : !loading ? (
          <EmptyCard
            icon="grid"
            title="No Form 12 on file"
            body="Upload your Form 12 crop inspection register from the Documents screen."
            colors={colors}
          />
        ) : null}

        {/* ── Account ──────────────────────────────────────────────────────── */}
        <SectionCard icon="phone" title="Account" colors={colors}>
          <Field label="Login Number" value={fmtPhone(phone)} colors={colors} />
          {profile?.name ? (
            <Field label="Name" value={profile.name} colors={colors} />
          ) : null}
          {profile?.code ? (
            <Field label="Profile Code" value={profile.code} mono colors={colors} />
          ) : null}
          {profile?.createdAt ? (
            <Field
              label="Registered"
              value={new Date(profile.createdAt).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              colors={colors}
            />
          ) : null}
        </SectionCard>

        {/* Logout */}
        <Pressable
          onPress={onLogout}
          style={({ pressed }) => [
            styles.logoutBtn,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: 14,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Feather name="log-out" size={18} color={colors.destructive} />
          <Text style={[styles.logoutText, { color: colors.destructive }]}>
            Log out
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  pageTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.6,
  },
  hero: {
    padding: 18,
    marginBottom: 16,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  heroPhoto: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
  },
  heroLabel: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  heroName: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.4,
    marginBottom: 3,
  },
  heroSub: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.8,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 14,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cardIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.2,
  },
  field: {
    paddingVertical: 7,
  },
  fieldLabel: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  fieldValue: {
    fontSize: 15,
  },
  subHeading: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  tableHeader: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    paddingHorizontal: 6,
  },
  tableCell: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    paddingHorizontal: 6,
    lineHeight: 16,
  },
  emptyCard: {
    borderWidth: 1,
    borderRadius: 16,
    borderStyle: "dashed",
    padding: 20,
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  emptyBody: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 18,
  },
  logoutBtn: {
    height: 54,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginBottom: 8,
  },
  logoutText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
});
```

---

### Step 6 — Remove old API client imports from both files

After replacing both files, search the entire `artifacts/mobile/` directory for any remaining imports of:
- `ocrAadhar`
- `ocrPassbook`
- `useGetUserByPhone`
- `getGetUserByPhoneQueryKey`

from `@workspace/api-client-react` and remove them. The new code uses direct `fetch` calls defined in `hooks/useDocumentExtract.ts`.

---

## API Reference (for the Agent)

### Submit document for extraction
```
POST /api/extract
Content-Type: multipart/form-data

Fields:
  file           (File/Blob)   — the image file
  document_type  (string)      — aadhar | bank_passbook | form7 | form12 | form8a
  profile_phone  (string)      — 10-digit phone, no +91
  mode           (string)      — accurate (recommended)

Response 200:
  { "request_id": "abc123", "document_type": "aadhar", ... }
```

### Poll for result
```
GET /api/extract/:requestId

Response while processing:
  { "status": "processing", ... }

Response on success:
  {
    "status": "complete",
    "profile": {
      "phone": "9876543210",
      "section": "aadhar",
      "saved": true,
      "error": null
    }
  }

Response on failure:
  { "status": "error", "error": "OCR timed out" }
```

### Get user profile
```
GET /api/profiles/:phone

Response 200:
  { "profile": { phone, name, code, aadhar, passbook, form7, form12, form8a, ... } }

Response 404: profile not found (create one first)
```

### Create profile
```
POST /api/profiles
Content-Type: application/json
Body: { "phone": "9876543210", "name": "" }

Response 200 or 201:
  { "profile": { ... }, "created": true }
```

---

## Final Checklist for the Agent

- [ ] `artifacts/mobile/hooks/useDocumentExtract.ts` created with all types and functions
- [ ] `artifacts/mobile/app/_layout.tsx` exports `API_BASE` constant
- [ ] `artifacts/mobile/context/AuthContext.tsx` calls `ensureProfile` in `verifyOtp`
- [ ] `artifacts/mobile/app/upload.tsx` replaced — uses `extractDocument()`, supports all 5 document types, shows per-card status (uploading / processing / done / error)
- [ ] `artifacts/mobile/app/(tabs)/profile.tsx` replaced — fetches via `fetchProfile()`, shows Aadhaar, Bank Passbook, Form 7/12, Form 8A, Form 12 sections, data tables for tabular data, empty-state cards for missing sections, photo in hero, status pills on hero card
- [ ] No remaining imports of `ocrAadhar`, `ocrPassbook`, `useGetUserByPhone` from `@workspace/api-client-react`
- [ ] `EXPO_PUBLIC_API_URL` is configured to point to the API server

Once these changes are in place, the mobile app will:
1. Accept all five document types on the upload screen
2. Submit each document to the API server which sends it to Datalab OCR
3. Poll until the extraction is complete
4. Auto-save all extracted fields to MongoDB
5. Show every saved field in the profile screen in a structured, mobile-optimised layout
6. Share the same MongoDB data with the web application — data uploaded on mobile appears on the web instantly
