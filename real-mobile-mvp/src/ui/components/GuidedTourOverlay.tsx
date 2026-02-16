import { router, usePathname } from "expo-router";
import { useEffect, useMemo } from "react";
import { Dimensions, Pressable, StyleSheet, View } from "react-native";
import { useAuth } from "../../auth/AuthProvider";
import { realTheme } from "../../theme/realTheme";
import { Body, Kicker, SubTitle } from "./Typography";

type TourStep = {
  id: string;
  route: string;
  title: string;
  description: string;
  spotlightTop: number;
  spotlightHeight: number;
  tabIndex: 0 | 1 | 2 | 3;
};

const TOUR_STEPS: TourStep[] = [
  {
    id: "home",
    route: "/home",
    title: "Início",
    description: "Aqui você descreve seu objetivo em uma frase e o app te leva para o caminho certo.",
    spotlightTop: 200,
    spotlightHeight: 180,
    tabIndex: 0,
  },
  {
    id: "services",
    route: "/create",
    title: "Serviços",
    description: "Escolha entre Tráfego e Site. Conteúdo aparece como em breve.",
    spotlightTop: 180,
    spotlightHeight: 240,
    tabIndex: 1,
  },
  {
    id: "orders",
    route: "/orders",
    title: "Pedidos",
    description: "Acompanhe status, timeline e entregas sem ficar perdido.",
    spotlightTop: 180,
    spotlightHeight: 260,
    tabIndex: 2,
  },
  {
    id: "approvals",
    route: "/approvals",
    title: "Aprovações",
    description: "Você aprova copy e criativo. O resto a Real executa.",
    spotlightTop: 180,
    spotlightHeight: 230,
    tabIndex: 3,
  },
];

function toCanonicalPath(path: string): string {
  return path.replace("/(tabs)", "");
}

function isTabsPath(path: string): boolean {
  const canonical = toCanonicalPath(path);
  return canonical === "/home" || canonical === "/create" || canonical === "/orders" || canonical === "/approvals" || canonical === "/account";
}

export function GuidedTourOverlay() {
  const pathname = usePathname();
  const {
    guidedTourActive,
    guidedTourStep,
    setGuidedTourStep,
    stopGuidedTour,
    completeAppTour,
  } = useAuth();

  const currentStep = useMemo(() => TOUR_STEPS[guidedTourStep] ?? TOUR_STEPS[0], [guidedTourStep]);
  const currentStepCanonical = useMemo(() => toCanonicalPath(currentStep.route), [currentStep.route]);
  const pathnameCanonical = useMemo(() => toCanonicalPath(pathname), [pathname]);
  const width = Dimensions.get("window").width;
  const spotlightLeft = 12;
  const spotlightWidth = width - spotlightLeft * 2;
  const tabWidth = width / 5;
  const tabCenterX = tabWidth * (currentStep.tabIndex + 0.5);
  const lastStep = guidedTourStep >= TOUR_STEPS.length - 1;

  useEffect(() => {
    if (!guidedTourActive) return;
    if (!isTabsPath(pathname)) return;
    if (pathnameCanonical !== currentStepCanonical) {
      router.navigate(currentStep.route as never);
    }
  }, [currentStep.route, currentStepCanonical, guidedTourActive, pathname, pathnameCanonical]);

  if (!guidedTourActive || !isTabsPath(pathname)) {
    return null;
  }

  const next = async () => {
    if (lastStep) {
      await completeAppTour();
      stopGuidedTour();
      router.navigate("/home");
      return;
    }
    const nextStep = guidedTourStep + 1;
    setGuidedTourStep(nextStep);
    router.navigate(TOUR_STEPS[nextStep]!.route as never);
  };

  const skip = async () => {
    await completeAppTour();
    stopGuidedTour();
    router.navigate("/home");
  };

  return (
    <View style={styles.layer} pointerEvents="box-none">
      <View style={styles.dim} pointerEvents="none" />

      <View
        style={[
          styles.spotlight,
          {
            top: currentStep.spotlightTop,
            left: spotlightLeft,
            width: spotlightWidth,
            height: currentStep.spotlightHeight,
          },
        ]}
        pointerEvents="none"
      />

      <View
        style={[
          styles.tabSpotlight,
          {
            left: tabCenterX - 32,
          },
        ]}
        pointerEvents="none"
      />

      <View style={styles.panel}>
        <Kicker>
          Tour guiado · {guidedTourStep + 1}/{TOUR_STEPS.length}
        </Kicker>
        <SubTitle>{currentStep.title}</SubTitle>
        <Body>{currentStep.description}</Body>

        <View style={styles.actions}>
          <Pressable onPress={() => void skip()} style={[styles.btn, styles.secondary]}>
            <Body style={styles.secondaryText}>Pular</Body>
          </Pressable>
          <Pressable onPress={() => void next()} style={[styles.btn, styles.primary]}>
            <Body style={styles.primaryText}>{lastStep ? "Concluir tour" : "Próximo"}</Body>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    zIndex: 999,
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(7, 8, 10, 0.78)",
  },
  spotlight: {
    position: "absolute",
    borderRadius: 22,
    borderWidth: 2,
    borderColor: "rgba(53,226,20,0.92)",
    backgroundColor: "transparent",
    shadowColor: realTheme.colors.green,
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
  },
  tabSpotlight: {
    position: "absolute",
    width: 64,
    height: 38,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "rgba(53,226,20,0.95)",
    bottom: 28,
    shadowColor: realTheme.colors.green,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
  panel: {
    marginHorizontal: 12,
    marginBottom: 96,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(53,226,20,0.45)",
    backgroundColor: "rgba(11, 14, 12, 0.95)",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 8,
  },
  actions: {
    marginTop: 4,
    flexDirection: "row",
    gap: 10,
  },
  btn: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  primary: {
    backgroundColor: realTheme.colors.green,
    borderColor: "rgba(0,0,0,0.25)",
  },
  secondary: {
    backgroundColor: "rgba(18, 19, 22, 0.82)",
    borderColor: "rgba(53,226,20,0.35)",
  },
  primaryText: {
    color: "#050607",
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 14,
  },
  secondaryText: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 14,
  },
});
