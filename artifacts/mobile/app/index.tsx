import { Redirect } from "expo-router";
import { useGuest } from "@/context/GuestContext";
import { View, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/useColors";

export default function IndexScreen() {
  const { guest, isLoading } = useGuest();
  const colors = useColors();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!guest) {
    return <Redirect href="/register" />;
  }

  return <Redirect href="/(tabs)/notifications" />;
}
