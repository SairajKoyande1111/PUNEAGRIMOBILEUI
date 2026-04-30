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
      <View style={[styles.cardHeader, { borderBottomColor: colors.border }]}>
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
                style={[
                  styles.heroPhoto,
                  { borderColor: "rgba(255,255,255,0.4)" },
                ]}
              />
            ) : (
              <View
                style={[
                  styles.heroPhoto,
                  {
                    backgroundColor: "rgba(255,255,255,0.18)",
                    borderColor: "rgba(255,255,255,0.4)",
                    alignItems: "center",
                    justifyContent: "center",
                  },
                ]}
              >
                <Feather name="user" size={32} color="#fff" />
              </View>
            )}
            <View style={{ flex: 1, marginLeft: 16 }}>
              <Text
                style={[styles.heroLabel, { color: "rgba(255,255,255,0.7)" }]}
              >
                FARMER PROFILE
              </Text>
              <Text
                style={[styles.heroName, { color: "#fff" }]}
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
