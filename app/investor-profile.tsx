import { router } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import InvestorProfileOnboarding from "@/components/InvestorProfileOnboarding";

export default function InvestorProfileScreen() {
  function handleComplete() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/insights");
    }
  }

  function handleSkip() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/insights");
    }
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <InvestorProfileOnboarding onComplete={handleComplete} onSkip={handleSkip} />
    </SafeAreaProvider>
  );
}
