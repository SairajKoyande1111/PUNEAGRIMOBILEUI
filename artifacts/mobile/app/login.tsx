import { Feather, FontAwesome } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
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

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { setPhone } = useAuth();
  const [value, setValue] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);

  const isValid = value.replace(/\D/g, "").length === 10;

  const onContinue = async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    await setPhone(value.replace(/\D/g, ""));
    setSubmitting(false);
  };

  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const webBottomInset = Platform.OS === "web" ? 34 : 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: insets.top + 24 + webTopInset,
          paddingBottom: insets.bottom + 24 + webBottomInset,
          paddingHorizontal: 24,
          flexGrow: 1,
        }}
      >
        <View
          style={[
            styles.logoBadge,
            { backgroundColor: colors.primary, borderRadius: 22 },
          ]}
        >
          <Feather name="shield" size={28} color={colors.primaryForeground} />
        </View>

        <Text style={[styles.title, { color: colors.foreground }]}>
          Welcome
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Enter your mobile number to continue. We'll send a 6-digit code to
          your WhatsApp.
        </Text>

        <View style={{ height: 36 }} />

        <Text style={[styles.label, { color: colors.mutedForeground }]}>
          Mobile number
        </Text>
        <View
          style={[
            styles.inputRow,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: 14,
            },
          ]}
        >
          <View
            style={[
              styles.countryChip,
              { borderRightColor: colors.border },
            ]}
          >
            <Text style={[styles.countryFlag]}>🇮🇳</Text>
            <Text
              style={[styles.countryCode, { color: colors.foreground }]}
            >
              +91
            </Text>
          </View>
          <TextInput
            value={value}
            onChangeText={setValue}
            keyboardType="phone-pad"
            placeholder="98765 43210"
            placeholderTextColor={colors.mutedForeground}
            maxLength={10}
            style={[styles.input, { color: colors.foreground }]}
            autoFocus
          />
        </View>

        <View style={styles.whatsappRow}>
          <FontAwesome
            name="whatsapp"
            size={16}
            color={colors.whatsapp}
          />
          <Text
            style={[styles.whatsappText, { color: colors.mutedForeground }]}
          >
            OTP will be delivered on WhatsApp
          </Text>
        </View>

        <View style={{ flex: 1 }} />

        <Pressable
          onPress={onContinue}
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
            Continue
          </Text>
          <Feather
            name="arrow-right"
            size={18}
            color={
              isValid ? colors.primaryForeground : colors.mutedForeground
            }
          />
        </Pressable>

        <Text style={[styles.legal, { color: colors.mutedForeground }]}>
          By continuing, you agree to our Terms of Service and Privacy Policy.
        </Text>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  logoBadge: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  title: {
    fontSize: 30,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.6,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  label: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    height: 58,
    overflow: "hidden",
  },
  countryChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    height: "100%",
    borderRightWidth: 1,
    gap: 8,
  },
  countryFlag: { fontSize: 18 },
  countryCode: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  input: {
    flex: 1,
    fontSize: 17,
    fontFamily: "Inter_500Medium",
    paddingHorizontal: 14,
    height: "100%",
  },
  whatsappRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  whatsappText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  button: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 24,
  },
  buttonText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  legal: {
    marginTop: 16,
    fontSize: 12,
    textAlign: "center",
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
});
