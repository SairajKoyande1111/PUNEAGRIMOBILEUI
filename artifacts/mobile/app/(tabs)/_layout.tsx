import { Feather } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { Platform, View } from "react-native";

import { useColors } from "@/hooks/useColors";

type IconName = keyof typeof Feather.glyphMap;

function TabIcon({
  name,
  color,
  focused,
}: {
  name: IconName;
  color: string;
  focused: boolean;
}) {
  return (
    <View
      style={{
        alignItems: "center",
        justifyContent: "center",
        paddingTop: 4,
      }}
    >
      <Feather name={name} size={focused ? 23 : 22} color={color} />
    </View>
  );
}

export default function TabLayout() {
  const colors = useColors();
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarLabelStyle: {
          fontFamily: "Inter_500Medium",
          fontSize: 11,
          marginTop: 2,
        },
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          borderTopWidth: 0.5,
          elevation: 0,
          ...(isWeb ? { height: 84 } : { height: 64, paddingTop: 6 }),
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="home" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="application"
        options={{
          title: "Application",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="file-text" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="grievance"
        options={{
          title: "Grievance",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="alert-circle" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="payments"
        options={{
          title: "Payments",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="credit-card" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="user" color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
