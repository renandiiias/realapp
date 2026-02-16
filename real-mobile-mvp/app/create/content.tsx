import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { realTheme } from "../../src/theme/realTheme";
import { Button } from "../../src/ui/components/Button";
import { Card } from "../../src/ui/components/Card";
import { Screen } from "../../src/ui/components/Screen";
import { Body, Kicker, Title } from "../../src/ui/components/Typography";

export default function ContentComingSoon() {
  return (
    <Screen>
      <View style={styles.content}>
        <Card>
          <Kicker>Conteúdo</Kicker>
          <Title>Em breve</Title>
          <Body>
            O fluxo de Conteúdo está em finalização. Nesta fase, Tráfego e Site já podem ser usados normalmente.
          </Body>
          <Body style={styles.muted}>
            Assim que liberar, você terá calendário e criativos no mesmo padrão do resto do app.
          </Body>
          <View style={styles.actions}>
            <Button label="Ver serviços disponíveis" variant="secondary" onPress={() => router.navigate("/create")} style={styles.action} />
            <Button label="Ir para Home" onPress={() => router.navigate("/home")} style={styles.action} />
          </View>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    justifyContent: "center",
    gap: 14,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 6,
  },
  action: {
    flex: 1,
  },
  muted: {
    color: realTheme.colors.muted,
  },
});
