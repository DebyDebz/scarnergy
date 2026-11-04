import { Stack } from "expo-router";

export default function SessionsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="flow" options={{ headerShown: true, title: 'Inspection Setup', headerTintColor: '#1E3A5F', headerStyle: { backgroundColor: '#fff' } }} />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="inspect" />
      <Stack.Screen name="roomscan" />
      <Stack.Screen name="floorplan" />
      <Stack.Screen name="results" options={{ headerShown: true, title: 'Energy Results', headerTintColor: '#1E3A5F', headerStyle: { backgroundColor: '#fff' } }} />
    </Stack>
  );
}
