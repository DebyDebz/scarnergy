import { ActivityIndicator, View, StyleSheet } from "react-native";

/**
 * Root index — shown briefly while the auth state resolves.
 * _layout.tsx redirects to /auth/sign-in or /(tabs) once loading is false.
 */
export default function Index() {
  return (
    <View style={styles.container}>
      <ActivityIndicator color="#FFFFFF" size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1E3A5F", justifyContent: "center", alignItems: "center" },
});
