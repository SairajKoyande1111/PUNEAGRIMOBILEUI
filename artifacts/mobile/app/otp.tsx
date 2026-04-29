import { Feather, FontAwesome } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

const OTP_LENGTH = 6;

export default function OtpScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { phone, verifyOtp } = useAuth();

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [secondsLeft, setSecondsLeft] = useState<number>(30);
  const inputs = useRef<Array<TextInput | null>>([]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  const code = digits.join("");
  const isValid = code.length === OTP_LENGTH;

  const onChange = (index: number, text: string) => {
    const cleaned = text.replace(/\D/g, "");
    if (cleaned.length > 1) {
      // Handle paste
      const next = [...digits];
      for (let i = 0; i < OTP_LENGTH; i++) {
        next[i] = cleaned[i] ?? "";
      }
      setDigits(next);
      const lastIndex = Math.min(cleaned.length, OTP_LENGTH) - 1;
      inputs.current[lastIndex]?.blur();
      return;
    }
    const next = [...digits];
    next[index] = cleaned;
    setDigits(next);
    if (cleaned && index < OTP_LENGTH - 1) {
      inputs.current[index + 1]?.focus();
    }
  };

  const onKeyPress = (index: number, key: string) => {
    if (key === "Backspace" && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
      const next = [...digits];
      next[index - 1] = "";
      setDigits(next);
    }
  };

  const onVerify = async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    await new Promise((r) => setTimeout(r, 350));
    await verifyOtp();
    setSubmitting(false);
  };

  const onResend = () => {
    if (secondsLeft > 0) return;
    setSecondsLeft(30);
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const formattedPhone = phone
    ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`
    : "";

  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const webBottomInset = Platform.OS === "web" ? 34 : 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: insets.top + 16 + webTopInset,
          paddingBottom: insets.bottom + 24 + webBottomInset,
          paddingHorizontal: 24,
          flexGrow: 1,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.backBtn}
        >
          <Feather name="chevron-left" size={26} color={colors.foreground} />
        </Pressable>

        <View
          style={[
            styles.logoBadge,
            { backgroundColor: "#E8F8EE", borderRadius: 22 },
          ]}
        >
          <FontAwesome name="whatsapp" size={28} color={colors.whatsapp} />
        </View>

        <Text style={[styles.title, { color: colors.foreground }]}>
          Verify your number
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          We sent a 6-digit code to your WhatsApp on{" "}
          <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>
            {formattedPhone}
          </Text>
        </Text>

        <View style={{ height: 36 }} />

        <View style={styles.otpRow}>
          {digits.map((d, i) => (
            <TextInput
              key={i}
              ref={(r) => {
                inputs.current[i] = r;
              }}
              value={d}
              onChangeText={(t) => onChange(i, t)}
              onKeyPress={({ nativeEvent }) => onKeyPress(i, nativeEvent.key)}
              keyboardType="number-pad"
              maxLength={1}
              autoFocus={i === 0}
              textContentType="oneTimeCode"
              style={[
                styles.otpBox,
                {
                  backgroundColor: colors.card,
                  borderColor: d ? colors.primary : colors.border,
                  borderRadius: 12,
                  color: colors.foreground,
                },
              ]}
            />
          ))}
        </View>

        <View style={styles.resendRow}>
          {secondsLeft > 0 ? (
            <Text
              style={[styles.resendText, { color: colors.mutedForeground }]}
            >
              Resend code in {secondsLeft}s
            </Text>
          ) : (
            <Pressable onPress={onResend} hitSlop={8}>
              <Text style={[styles.resendActive, { color: colors.primary }]}>
                Resend code
              </Text>
            </Pressable>
          )}
        </View>

        <View style={{ flex: 1 }} />

        <Pressable
          onPress={onVerify}
          disabled={!isValid || submitting}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: isValid ? colors.primary : colors.muted,
              borderRadius: 14,
              opacity: pressed ? 0.9 : 1,
            },
          ]}
        >
          <Text
            style={[
              styles.buttonText,
              {
                color: isValid
                  ? colors.primaryForeground
                  : colors.mutedForeground,
              },
            ]}
          >
            {submitting ? "Verifying..." : "Verify"}
          </Text>
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "flex-start",
    justifyContent: "center",
    marginBottom: 8,
    marginLeft: -6,
  },
  logoBadge: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
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
  },
  otpRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  otpBox: {
    flex: 1,
    height: 60,
    borderWidth: 1.5,
    textAlign: "center",
    fontSize: 24,
    fontFamily: "Inter_700Bold",
  },
  resendRow: {
    marginTop: 20,
    alignItems: "center",
  },
  resendText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  resendActive: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  button: {
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
  },
  buttonText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
});
