import { router } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuth } from "../src/auth/AuthProvider";
import { realTheme } from "../src/theme/realTheme";
import { Button } from "../src/ui/components/Button";
import { Card } from "../src/ui/components/Card";
import { RealLogo } from "../src/ui/components/RealLogo";
import { Screen } from "../src/ui/components/Screen";
import { Body, Kicker, SubTitle, Title } from "../src/ui/components/Typography";

type ServiceRoute = "/create/ads" | "/create/site" | "/create/video-editor";

function routeLabel(route: ServiceRoute): string {
  if (route === "/create/site") return "Site";
  if (route === "/create/video-editor") return "Editor de Vídeo";
  return "Tráfego";
}

export default function Welcome() {
  const { loginWithPassword, registerWithPassword } = useAuth();

  const [prompt, setPrompt] = useState("");
  const [chosenRoute, setChosenRoute] = useState<ServiceRoute | null>(null);

  const [loadingFlow, setLoadingFlow] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showServiceModal, setShowServiceModal] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const canStart = useMemo(() => prompt.trim().length > 0, [prompt]);

  const startFlow = async () => {
    if (!canStart) return;
    setLoadingFlow(true);
    await new Promise((resolve) => setTimeout(resolve, 2200));
    setLoadingFlow(false);
    setShowAuthModal(true);
  };

  const finishAuth = async (mode: "login" | "register") => {
    const clean = prompt.trim();
    if (!clean) return;
    if (!email.trim() || !password.trim()) {
      setAuthError("Preencha e-mail e senha.");
      return;
    }
    if (password.trim().length < 8) {
      setAuthError("Use uma senha com pelo menos 8 caracteres.");
      return;
    }

    try {
      setAuthLoading(true);
      setAuthError(null);

      if (mode === "register") {
        await registerWithPassword(email.trim(), password.trim());
      } else {
        await loginWithPassword(email.trim(), password.trim());
      }

      setShowAuthModal(false);
      if (mode === "register") {
        router.replace({ pathname: "/onboarding/ray-x", params: { mode: "initial", prompt: clean } });
        return;
      }
      if (chosenRoute) {
        router.replace({ pathname: chosenRoute, params: { prompt: clean } });
        return;
      }
      router.replace("/(tabs)/home");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao autenticar. Tente novamente.";
      setAuthError(message);
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <Screen>
      <View style={styles.layout}>
        <View style={styles.logoWrap}>
          <RealLogo width={205} />
        </View>

        <Title style={styles.heroTitle}>Descreva seu objetivo</Title>

        <View style={styles.formBlock}>
          <View style={styles.magicInputGlow}>
            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              placeholder="Ex.: quero mais leads para minha clínica"
              placeholderTextColor="rgba(166,173,185,0.84)"
              style={styles.magicInput}
              multiline
            />
          </View>

          <Button label="Começar agora" onPress={startFlow} disabled={!canStart || loadingFlow} />

          <Pressable onPress={() => setShowServiceModal(true)}>
            <Text style={styles.link}>Não sabe por onde começar? Ver serviços.</Text>
          </Pressable>

          {chosenRoute ? <Body style={styles.selected}>Sugestão selecionada: {routeLabel(chosenRoute)}</Body> : null}
        </View>
      </View>

      <Modal visible={loadingFlow} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.overlay}>
          <Card style={styles.overlayCard}>
            <ActivityIndicator color={realTheme.colors.green} />
            <SubTitle>Lendo seu pedido…</SubTitle>
            <Body>Preparando o melhor caminho para você.</Body>
          </Card>
        </View>
      </Modal>

      <Modal visible={showAuthModal} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.overlay}>
          <Card style={styles.authCard}>
            <Kicker>Entrar</Kicker>
            <Title>Para continuar, acesse sua conta</Title>

            <View style={styles.fieldWrap}>
              <Text style={styles.fieldLabel}>E-mail</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="seu@email.com"
                placeholderTextColor="rgba(166,173,185,0.84)"
                keyboardType="email-address"
                autoCapitalize="none"
                style={styles.fieldInput}
              />
            </View>

            <View style={styles.fieldWrap}>
              <Text style={styles.fieldLabel}>Senha</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor="rgba(166,173,185,0.84)"
                secureTextEntry
                style={styles.fieldInput}
              />
            </View>

            <View style={styles.authActions}>
              <Button
                label={authLoading ? "Entrando..." : "Logar"}
                onPress={() => void finishAuth("login")}
                style={styles.authBtn}
                disabled={authLoading}
              />
              <Button
                label={authLoading ? "Criando..." : "Criar conta"}
                variant="secondary"
                onPress={() => void finishAuth("register")}
                style={styles.authBtn}
                disabled={authLoading}
              />
            </View>

            {authError ? <Body style={styles.authError}>{authError}</Body> : null}
          </Card>
        </View>
      </Modal>

      <Modal visible={showServiceModal} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.overlay}>
          <Card style={styles.serviceCard}>
            <Kicker>Serviços</Kicker>
            <Title>Escolha a direção inicial</Title>

            <TouchableOpacity
              style={styles.serviceItem}
              activeOpacity={0.9}
              onPress={() => {
                setChosenRoute("/create/ads");
                setShowServiceModal(false);
              }}
            >
              <SubTitle style={styles.serviceTitle}>Tráfego</SubTitle>
              <Body>Campanha de anúncios para leads e vendas.</Body>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.serviceItem}
              activeOpacity={0.9}
              onPress={() => {
                setChosenRoute("/create/site");
                setShowServiceModal(false);
              }}
            >
              <SubTitle style={styles.serviceTitle}>Site</SubTitle>
              <Body>Landing page para conversão.</Body>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.serviceItem}
              activeOpacity={0.9}
              onPress={() => {
                setChosenRoute("/create/video-editor");
                setShowServiceModal(false);
              }}
            >
              <SubTitle style={styles.serviceTitle}>Editor de Vídeo</SubTitle>
              <Body>Envie ou grave um vídeo curto para edição.</Body>
            </TouchableOpacity>

            <View style={[styles.serviceItem, styles.serviceDisabled]}>
              <View style={styles.comingSoonRow}>
                <SubTitle style={styles.serviceTitle}>Conteúdo</SubTitle>
                <Text style={styles.soonBadge}>Em breve</Text>
              </View>
              <Body>Calendário e criativos serão liberados no próximo ciclo.</Body>
            </View>

            <Pressable onPress={() => setShowServiceModal(false)}>
              <Text style={styles.link}>Fechar</Text>
            </Pressable>
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  layout: {
    flex: 1,
    justifyContent: "center",
    paddingBottom: 44,
    gap: 14,
  },
  logoWrap: {
    alignItems: "center",
    marginBottom: 10,
  },
  heroTitle: {
    textAlign: "center",
    marginBottom: 2,
  },
  formBlock: {
    gap: 14,
  },
  magicInputGlow: {
    borderRadius: 18,
    shadowColor: realTheme.colors.green,
    shadowOpacity: 0.28,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 9,
  },
  magicInput: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: "rgba(53,226,20,0.4)",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlignVertical: "top",
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 17,
    lineHeight: 24,
    backgroundColor: "rgba(11,12,14,0.76)",
  },
  link: {
    color: "rgba(166,173,185,0.95)",
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 13,
    textDecorationLine: "underline",
    textAlign: "center",
  },
  selected: {
    textAlign: "center",
    fontSize: 13,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    padding: 16,
  },
  overlayCard: {
    alignItems: "center",
    gap: 12,
  },
  authCard: {
    gap: 12,
  },
  authActions: {
    flexDirection: "row",
    gap: 10,
  },
  authBtn: {
    flex: 1,
  },
  fieldWrap: {
    gap: 6,
  },
  fieldLabel: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 13,
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: realTheme.colors.line,
    borderRadius: realTheme.radius.sm,
    backgroundColor: realTheme.colors.panelSoft,
    paddingVertical: 12,
    paddingHorizontal: 12,
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 15,
  },
  authError: {
    color: "#ff8080",
    fontSize: 13,
    lineHeight: 18,
  },
  serviceCard: {
    gap: 10,
  },
  serviceItem: {
    gap: 2,
    borderWidth: 1,
    borderColor: realTheme.colors.line,
    borderRadius: realTheme.radius.sm,
    backgroundColor: "rgba(18,19,22,0.85)",
    padding: 12,
  },
  serviceDisabled: {
    opacity: 0.78,
    borderColor: "rgba(237,237,238,0.18)",
  },
  serviceTitle: {
    fontSize: 16,
  },
  comingSoonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  soonBadge: {
    color: realTheme.colors.green,
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
});
