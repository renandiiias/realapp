import { router } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { realTheme } from "../../src/theme/realTheme";
import { Button } from "../../src/ui/components/Button";
import { Card } from "../../src/ui/components/Card";
import { Screen } from "../../src/ui/components/Screen";
import { Body, Kicker, SubTitle, Title } from "../../src/ui/components/Typography";

export default function VideoEditorHubScreen() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card>
          <Kicker>Editor de video</Kicker>
          <Title>Escolha como quer editar</Title>
          <Body>Em um unico lugar: IA automatica ou ajuste manual.</Body>
        </Card>

        <Card>
          <SubTitle>1) Editar com IA</SubTitle>
          <Body style={styles.hint}>Voce envia o video da galeria e a IA corta + coloca legenda.</Body>
          <View style={styles.actions}>
            <Button label="Ir para Editar com IA" onPress={() => router.push("/create/video-editor-ia")} />
          </View>
        </Card>

        <Card>
          <SubTitle>2) Editar sozinho</SubTitle>
          <Body style={styles.hint}>Voce envia o video da galeria e abre o editor manual para ajustar corte final.</Body>
          <View style={styles.actions}>
            <Button label="Ir para Editar sozinho" variant="secondary" onPress={() => router.push("/create/video-editor-manual-hub")} />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 14,
    paddingBottom: 42,
  },
  actions: {
    marginTop: 10,
  },
  hint: {
    marginTop: 6,
    color: realTheme.colors.muted,
  },
});
