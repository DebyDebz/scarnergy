import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../store/authStore";

export default function TabLayout() {
  const profile = useAuthStore(s => s.profile);
  // Roles from the user_role DB enum: inspector | supervisor | admin | service_role.
  // Supervisors monitor sessions but don't take measurements, so the GLM device
  // tab is hidden for them (href: null keeps the route valid, just untabbed).
  // While the profile is still loading, default to the full inspector tab set.
  const role = profile?.role ?? "inspector";
  const showDevice = role !== "supervisor";

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
      <Tabs.Screen name="device"    options={{ href: showDevice ? undefined : null, title: "GLM Device", tabBarIcon: ({ color, size }) => <Ionicons name="bluetooth-outline" size={size} color={color} /> }} />
      {/* Reached only via a link on the GLM Device screen — kept out of the
          tab bar (href: null) same as any hidden-but-navigable route here. */}
      <Tabs.Screen name="esp32-provisioning" options={{ href: null, title: "ESP32 Setup" }} />
      <Tabs.Screen name="profile"   options={{ title: "Profile",    tabBarIcon: ({ color, size }) => <Ionicons name="person-outline"    size={size} color={color} /> }} />
    </Tabs>
  );
}
