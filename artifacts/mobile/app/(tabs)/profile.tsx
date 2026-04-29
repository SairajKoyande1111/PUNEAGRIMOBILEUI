import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useGetUserByPhone,
  getGetUserByPhoneQueryKey,
} from "@workspace/api-client-react";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

function maskAadhaar(num?: string | null): string {
  if (!num) return "—";
  const digits = num.replace(/\D/g, "");
  if (digits.length !== 12) return num;
  return `XXXX  XXXX  ${digits.slice(8)}`;
}

function formatPhone(phone?: string | null): string {
  if (!phone) return "—";
  const d = phone.replace(/\D/g, "");
  if (d.length === 10) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  return phone;
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { phone, signOut } = useAuth();

  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const webBottomInset = Platform.OS === "web" ? 84 : 0;

  const { data, isLoading, refetch, isRefetching } = useGetUserByPhone(
    phone ?? "",
    {
      query: {
        enabled: !!phone,
        queryKey: getGetUserByPhoneQueryKey(phone ?? ""),
        refetchOnWindowFocus: true,
      },
    },
  );

  const aadhar = data?.aadhar ?? null;
  const photoUri =
    aadhar?.photoBase64 && aadhar.photoMimeType
      ? `data:${aadhar.photoMimeType};base64,${aadhar.photoBase64}`
      : null;

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

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 16 + webTopInset,
          paddingBottom: insets.bottom + 32 + webBottomInset,
          paddingHorizontal: 20,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Profile
          </Text>
          <Pressable
            onPress={() => refetch()}
            hitSlop={10}
            style={{ padding: 6 }}
          >
            {isRefetching ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Feather name="refresh-cw" size={18} color={colors.primary} />
            )}
          </Pressable>
        </View>

        {/* Hero card */}
        <View
          style={[
            styles.heroCard,
            {
              backgroundColor: colors.primary,
              borderRadius: 20,
            },
          ]}
        >
          <View style={styles.heroRow}>
            {photoUri ? (
              <Image
                source={{ uri: photoUri }}
                style={[styles.heroPhoto, { borderColor: colors.primaryForeground }]}
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
                <Feather
                  name="user"
                  size={32}
                  color={colors.primaryForeground}
                />
              </View>
            )}
            <View style={{ flex: 1, marginLeft: 16 }}>
              <Text
                style={[
                  styles.heroLabel,
                  { color: "rgba(255,255,255,0.75)" },
                ]}
              >
                {aadhar?.name ? "Verified user" : "Welcome"}
              </Text>
              <Text
                style={[styles.heroName, { color: colors.primaryForeground }]}
                numberOfLines={2}
              >
                {aadhar?.name || formatPhone(phone)}
              </Text>
              {aadhar?.aadhaarNumber ? (
                <Text
                  style={[
                    styles.heroSub,
                    { color: "rgba(255,255,255,0.85)" },
                  ]}
                >
                  Aadhaar {maskAadhaar(aadhar.aadhaarNumber)}
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        {/* Loading */}
        {isLoading ? (
          <View style={{ alignItems: "center", paddingVertical: 24 }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}

        {/* Aadhaar details */}
        {aadhar ? (
          <View
            style={[
              styles.section,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.sectionHeader}>
              <Feather name="credit-card" size={16} color={colors.primary} />
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Aadhaar details
              </Text>
            </View>
            <Field label="Full name" value={aadhar.name} colors={colors} />
            <Field
              label="Aadhaar number"
              value={
                aadhar.aadhaarNumber
                  ? aadhar.aadhaarNumber
                      .replace(/\D/g, "")
                      .replace(/(\d{4})(?=\d)/g, "$1 ")
                  : null
              }
              colors={colors}
              mono
            />
            <Field
              label="Date of birth"
              value={aadhar.dateOfBirth}
              colors={colors}
            />
            <Field label="Gender" value={aadhar.gender} colors={colors} />
            <Field
              label="Mobile number"
              value={
                aadhar.mobileNumber
                  ? formatPhone(aadhar.mobileNumber)
                  : formatPhone(phone)
              }
              colors={colors}
            />
            <Field
              label="Address"
              value={aadhar.address}
              colors={colors}
              multiline
            />
          </View>
        ) : !isLoading ? (
          <View
            style={[
              styles.emptyBox,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Feather name="credit-card" size={22} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No Aadhaar on file
            </Text>
            <Text
              style={[styles.emptyBody, { color: colors.mutedForeground }]}
            >
              Upload your Aadhaar card on the documents screen to auto-fill
              your profile.
            </Text>
          </View>
        ) : null}

        {/* Account */}
        <View
          style={[
            styles.section,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.sectionHeader}>
            <Feather name="phone" size={16} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Account
            </Text>
          </View>
          <Field
            label="Login number"
            value={formatPhone(phone)}
            colors={colors}
          />
        </View>

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

function Field({
  label,
  value,
  colors,
  mono,
  multiline,
}: {
  label: string;
  value?: string | null;
  colors: ReturnType<typeof useColors>;
  mono?: boolean;
  multiline?: boolean;
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
            letterSpacing: mono ? 1.5 : 0,
          },
        ]}
        numberOfLines={multiline ? 0 : 1}
      >
        {value || "—"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.6,
  },
  heroCard: {
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
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  heroName: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  heroSub: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    letterSpacing: 1,
  },
  section: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  field: {
    paddingVertical: 8,
  },
  fieldLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  fieldValue: {
    fontSize: 15,
  },
  emptyBox: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    marginBottom: 16,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  emptyBody: {
    fontSize: 13,
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
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
});
