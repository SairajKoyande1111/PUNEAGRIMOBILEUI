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
import { ocrAadhar } from "@workspace/api-client-react";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

type DocItem = {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Feather.glyphMap;
};

const DOCUMENTS: DocItem[] = [
  {
    id: "form_7a",
    title: "Form 7/12",
    description: "Land record extract",
    icon: "file-text",
  },
  {
    id: "form_12a_8a",
    title: "Form 8A",
    description: "Khata extract / land details",
    icon: "file-text",
  },
  {
    id: "aadhar",
    title: "Aadhaar Card",
    description: "Both sides clearly visible",
    icon: "credit-card",
  },
  {
    id: "bank_passbook",
    title: "Bank Passbook",
    description: "First page with account number",
    icon: "book",
  },
];

export default function UploadScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { phone, documents, setDocument, finishDocuments } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [aadharStatus, setAadharStatus] =
    useState<"idle" | "scanning" | "done" | "error">("idle");
  const [aadharError, setAadharError] = useState<string | null>(null);

  const uploadedCount = useMemo(
    () => DOCUMENTS.filter((d) => documents[d.id]).length,
    [documents],
  );
  const aadharUploaded = !!documents["aadhar"];
  const canSubmit = aadharUploaded && aadharStatus !== "scanning";

  const runAadharOcr = async (asset: ImagePicker.ImagePickerAsset) => {
    if (!phone) {
      Alert.alert("Error", "Missing phone number, please log in again.");
      return;
    }
    if (!asset.base64) {
      Alert.alert("Error", "Could not read image. Please try a different photo.");
      return;
    }
    setAadharStatus("scanning");
    setAadharError(null);
    try {
      await ocrAadhar({
        phone,
        imageBase64: asset.base64,
        mimeType: asset.mimeType ?? "image/jpeg",
      });
      setAadharStatus("done");
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (e) {
      setAadharStatus("error");
      const msg =
        e instanceof Error ? e.message : "Could not read Aadhaar card.";
      setAadharError(msg);
    }
  };

  const pick = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Permission required",
          "Please allow photo library access to upload documents.",
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.8,
        base64: id === "aadhar",
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        await setDocument(id, asset.uri);
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        if (id === "aadhar") {
          await runAadharOcr(asset);
        }
      }
    } catch (e) {
      Alert.alert("Upload failed", "Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const onContinue = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    await new Promise((r) => setTimeout(r, 200));
    await finishDocuments();
    setSubmitting(false);
  };

  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const webBottomInset = Platform.OS === "web" ? 34 : 0;
  const progress = uploadedCount / DOCUMENTS.length;

  const submitLabel = (() => {
    if (submitting) return "Submitting...";
    if (aadharStatus === "scanning") return "Reading Aadhaar...";
    if (!aadharUploaded) return "Upload Aadhaar to continue";
    return "Submit & Continue";
  })();

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 16 + webTopInset,
          paddingBottom: insets.bottom + 140 + webBottomInset,
          paddingHorizontal: 20,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.eyebrow, { color: colors.primary }]}>
          Step 3 of 3
        </Text>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Upload documents
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Aadhaar card is required — the rest are optional. Make sure all text
          is clearly readable.
        </Text>

        <View
          style={[
            styles.progressTrack,
            { backgroundColor: colors.muted, borderRadius: 999 },
          ]}
        >
          <View
            style={[
              styles.progressFill,
              {
                backgroundColor: colors.primary,
                width: `${progress * 100}%`,
                borderRadius: 999,
              },
            ]}
          />
        </View>
        <Text style={[styles.progressText, { color: colors.mutedForeground }]}>
          {uploadedCount} of {DOCUMENTS.length} uploaded
        </Text>

        <View style={{ height: 24 }} />

        {DOCUMENTS.map((doc) => {
          const uploaded = !!documents[doc.id];
          const isBusy = busyId === doc.id;
          const isAadhar = doc.id === "aadhar";
          let subText = uploaded
            ? "Uploaded · Tap to replace"
            : doc.description;
          let subColor = uploaded ? colors.success : colors.mutedForeground;

          if (isAadhar) {
            if (aadharStatus === "scanning") {
              subText = "Reading details with OCR...";
              subColor = colors.primary;
            } else if (aadharStatus === "done") {
              subText = "Details extracted ✓ Tap to replace";
              subColor = colors.success;
            } else if (aadharStatus === "error") {
              subText = aadharError || "OCR failed · Tap to retry";
              subColor = colors.destructive;
            }
          }

          return (
            <Pressable
              key={doc.id}
              onPress={() => pick(doc.id)}
              disabled={isBusy || (isAadhar && aadharStatus === "scanning")}
              style={({ pressed }) => [
                styles.docCard,
                {
                  backgroundColor: colors.card,
                  borderColor: uploaded ? colors.primary : colors.border,
                  borderRadius: 16,
                  opacity: pressed ? 0.92 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.docIconWrap,
                  {
                    backgroundColor: uploaded
                      ? colors.primary
                      : colors.secondary,
                    borderRadius: 12,
                  },
                ]}
              >
                {isBusy || (isAadhar && aadharStatus === "scanning") ? (
                  <ActivityIndicator
                    color={uploaded ? colors.primaryForeground : colors.primary}
                  />
                ) : (
                  <Feather
                    name={uploaded ? "check" : doc.icon}
                    size={22}
                    color={
                      uploaded ? colors.primaryForeground : colors.primary
                    }
                  />
                )}
              </View>

              <View style={styles.docTextWrap}>
                <View style={styles.titleRow}>
                  <Text
                    style={[styles.docTitle, { color: colors.foreground }]}
                  >
                    {doc.title}
                  </Text>
                  {isAadhar ? (
                    <View
                      style={[
                        styles.requiredBadge,
                        { backgroundColor: colors.primary, borderRadius: 6 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.requiredText,
                          { color: colors.primaryForeground },
                        ]}
                      >
                        REQUIRED
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text
                  style={[styles.docSubtitle, { color: subColor }]}
                  numberOfLines={2}
                >
                  {subText}
                </Text>
              </View>

              <Feather
                name={uploaded ? "edit-2" : "upload"}
                size={18}
                color={colors.mutedForeground}
              />
            </Pressable>
          );
        })}
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            paddingBottom: insets.bottom + 16 + webBottomInset,
            backgroundColor: colors.background,
            borderTopColor: colors.border,
          },
        ]}
      >
        <Pressable
          onPress={onContinue}
          disabled={!canSubmit || submitting}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: canSubmit ? colors.primary : colors.muted,
              borderRadius: 14,
              opacity: pressed ? 0.9 : 1,
            },
          ]}
        >
          <Text
            style={[
              styles.buttonText,
              {
                color: canSubmit
                  ? colors.primaryForeground
                  : colors.mutedForeground,
              },
            ]}
          >
            {submitLabel}
          </Text>
          {canSubmit && !submitting ? (
            <Feather
              name="arrow-right"
              size={18}
              color={colors.primaryForeground}
            />
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  eyebrow: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.6,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
    marginBottom: 24,
  },
  progressTrack: {
    height: 6,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
  },
  progressText: {
    marginTop: 8,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  docCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    marginBottom: 12,
    borderWidth: 1.5,
    gap: 14,
  },
  docIconWrap: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  docTextWrap: { flex: 1 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  docTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  requiredBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  requiredText: {
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.6,
  },
  docSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  button: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
});
