import { useColors } from "@/hooks/useColors";
import { ActivityIndicator, View } from "react-native";

export default function IndexScreen() {
  const colors = useColors();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}
