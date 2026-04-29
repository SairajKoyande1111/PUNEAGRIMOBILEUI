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

  const [code, setCode] = useState<string>("");
  const [focused, setFocused] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [secondsLeft, setSecondsLeft] = useState<number>(30);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  const isValid = code.length === OTP_LENGTH;

  const handleChange = (text: string) => {
    const cleaned = text.replace(/\D/g, "").slice(0, OTP_LENGTH);
    setCode(cleaned);
    if (
      Platform.OS !== "web" &&
      cleaned.length > code.length &&
      cleaned.length <= OTP_LENGTH
    ) {
      Haptics.selectionAsync();
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

  const focusInput = () => {
    inputRef.current?.focus();
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
          <Text
            style={{
              color: colors.foreground,
              fontFamily: "Inter_600SemiBold",
            }}
          >
            {formattedPhone}
          </Text>
        </Text>

        <View style={{ height: 36 }} />

        <Pressable onPress={focusInput} style={styles.otpWrap}>
          <View style={styles.otpRow} pointerEvents="none">
            {Array.from({ length: OTP_LENGTH }).map((_, i) => {
              const digit = code[i] ?? "";
              const isCurrent = focused && i === code.length;
              const filled = !!digit;
              return (
                <View
                  key={i}
                  style={[
                    styles.otpBox,
                    {
                      backgroundColor: colors.card,
                      borderColor: isCurrent
                        ? colors.primary
                        : filled
                          ? colors.primary
                          : colors.border,
                      borderWidth: isCurrent || filled ? 2 : 1.5,
                      borderRadius: 12,
                    },
                  ]}
                >
                  <Text
                    style={[styles.otpDigit, { color: colors.foreground }]}
                  >
                    {digit}
                  </Text>
                </View>
              );
            })}
          </View>

          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={handleChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            keyboardType="number-pad"
            maxLength={OTP_LENGTH}
            autoFocus
            textContentType="oneTimeCode"
            autoComplete={Platform.OS === "android" ? "sms-otp" : "one-time-code"}
            caretHidden
            style={styles.hiddenInput}
          />
        </Pressable>

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
  otpWrap: {
    position: "relative",
    width: "100%",
  },
  otpRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
  },
  otpBox: {
    width: 48,
    height: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  otpDigit: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
  },
  hiddenInput: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    fontSize: 24,
    color: "transparent",
    ...(Platform.OS === "web" ? { outlineWidth: 0 } : {}),
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
