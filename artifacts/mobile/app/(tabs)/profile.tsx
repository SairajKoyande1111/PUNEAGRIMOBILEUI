import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { phone, signOut } = useAuth();

  const webTopInset = Platform.OS === "web" ? 67 : 0;

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

  const formattedPhone = phone
    ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`
    : "";

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View
        style={{
          paddingTop: insets.top + 16 + webTopInset,
          paddingHorizontal: 20,
        }}
      >
        <Text style={[styles.title, { color: colors.foreground }]}>
          Profile
        </Text>

        {phone ? (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: 16,
              },
            ]}
          >
            <View
              style={[
                styles.avatar,
                { backgroundColor: colors.primary, borderRadius: 28 },
              ]}
            >
              <Feather name="user" size={24} color={colors.primaryForeground} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>
                Mobile number
              </Text>
              <Text style={[styles.cardValue, { color: colors.foreground }]}>
                {formattedPhone}
              </Text>
            </View>
          </View>
        ) : null}

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
    marginBottom: 24,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderWidth: 1,
    gap: 14,
    marginBottom: 16,
  },
  avatar: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  cardLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  cardValue: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
  },
  logoutBtn: {
    height: 54,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  logoutText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
});
