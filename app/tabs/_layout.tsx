import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export default function TabLayout() {
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: "#1E3A5F",
      tabBarInactiveTintColor: "#AAAAAA",
      tabBarStyle: { borderTopColor: "#E5E5E5" },
      headerStyle: { backgroundColor: "#1E3A5F" },
      headerTintColor: "#FFFFFF",
      headerTitleStyle: { fontWeight: "700" },
    }}>
      <Tabs.Screen name="index"     options={{ title: "Dashboard", tabBarIcon: ({ color, size }) => <Ionicons name="home-outline"      size={size} color={color} /> }} />
      <Tabs.Screen name="buildings" options={{ title: "Buildings",  tabBarIcon: ({ color, size }) => <Ionicons name="business-outline"  size={size} color={color} /> }} />
      <Tabs.Screen name="sessions"  options={{ title: "Sessions",   tabBarIcon: ({ color, size }) => <Ionicons name="albums-outline"    size={size} color={color} /> }} />
      <Tabs.Screen name="device"    options={{ title: "GLM Device", tabBarIcon: ({ color, size }) => <Ionicons name="bluetooth-outline" size={size} color={color} /> }} />
    </Tabs>
  );
}
