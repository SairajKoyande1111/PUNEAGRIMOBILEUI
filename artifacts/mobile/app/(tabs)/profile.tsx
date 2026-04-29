import { View } from "react-native";
import { useColors } from "@/hooks/useColors";

export default function ProfileScreen() {
  const colors = useColors();
  return <View style={{ flex: 1, backgroundColor: colors.background }} />;
}
