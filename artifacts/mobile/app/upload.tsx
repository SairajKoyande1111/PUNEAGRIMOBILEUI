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
                    {
                      color: busy
                        ? stageColor(stage, colors)
                        : colors.mutedForeground,
                    },
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
