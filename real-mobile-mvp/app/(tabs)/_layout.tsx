import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, Image, View } from "react-native";
import { useAuth } from "../../src/auth/AuthProvider";
import { realTheme } from "../../src/theme/realTheme";
import { GuidedTourOverlay } from "../../src/ui/components/GuidedTourOverlay";

export default function TabsLayout() {
  const { ready, loggedIn, profileMinimumComplete, appTourCompleted, guidedTourActive } = useAuth();

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: realTheme.colors.bg }}>
        <ActivityIndicator color={realTheme.colors.green} />
      </View>
    );
  }
  if (!loggedIn) return <Redirect href="/welcome" />;
  if (!profileMinimumComplete) return <Redirect href="/onboarding/ray-x?mode=initial" />;
  if (!appTourCompleted && !guidedTourActive) return <Redirect href="/onboarding/app-tour" />;

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: "#080A0D",
            borderTopWidth: 0,
            height: 84,
            paddingTop: 10,
            paddingBottom: 14,
          },
          tabBarActiveTintColor: realTheme.colors.green,
          tabBarInactiveTintColor: realTheme.colors.muted,
          tabBarLabelStyle: { fontFamily: realTheme.fonts.bodySemiBold, fontSize: 11, marginTop: -2 },
          tabBarItemStyle: {
            paddingVertical: 4,
          },
        }}
      >
        <Tabs.Screen
          name="home"
          options={{
            title: "Início",
            tabBarIcon: ({ focused, size }) => (
              <Image
                source={require("../../assets/real-symbol-source.png")}
                style={{
                  width: size + 6,
                  height: size + 6,
                  opacity: focused ? 1 : 0.58,
                  tintColor: focused ? realTheme.colors.green : realTheme.colors.muted,
                }}
                resizeMode="contain"
              />
            ),
          }}
        />
        <Tabs.Screen
          name="create"
          options={{
            title: "Serviços",
            tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="orders"
          options={{
            title: "Ver resultados",
            tabBarIcon: ({ color, size }) => <Ionicons name="pulse-outline" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="approvals"
          options={{
            title: "Aprovar",
            tabBarIcon: ({ color, size }) => <Ionicons name="checkmark-done-outline" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="account"
          options={{
            title: "Conta",
            tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} />,
          }}
        />
      </Tabs>
      <GuidedTourOverlay />
    </View>
  );
}
