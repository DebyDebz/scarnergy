import { Tabs } from "expo-router";
import { Text } from "react-native";

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
      <Tabs.Screen name="index"    options={{ title: "Dashboard", tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🏠</Text> }} />
      <Tabs.Screen name="buildings" options={{ title: "Buildings",  tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🏗</Text> }} />
      <Tabs.Screen name="sessions"  options={{ title: "Sessions",   tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>📋</Text> }} />
      <Tabs.Screen name="device"    options={{ title: "GLM Device", tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>📡</Text> }} />
    </Tabs>
  );
}
