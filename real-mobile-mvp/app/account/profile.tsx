import { router } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useAuth } from "../../src/auth/AuthProvider";
import { realTheme } from "../../src/theme/realTheme";
import { Button } from "../../src/ui/components/Button";
import { Card } from "../../src/ui/components/Card";
import { Field } from "../../src/ui/components/Field";
import { Screen } from "../../src/ui/components/Screen";
import { Body, Kicker, SubTitle, Title } from "../../src/ui/components/Typography";

export default function AccountProfileScreen() {
  const auth = useAuth();

  const [companyName, setCompanyName] = useState(auth.companyProfile?.companyName ?? "");
  const [instagram, setInstagram] = useState(auth.companyProfile?.instagram ?? "");
  const [whatsappBusiness, setWhatsappBusiness] = useState(auth.companyProfile?.whatsappBusiness ?? "");
  const [targetAudience, setTargetAudience] = useState(auth.companyProfile?.targetAudience ?? "");
  const [city, setCity] = useState(auth.companyProfile?.city ?? "");
  const [website, setWebsite] = useState(auth.companyProfile?.website ?? "");
  const [googleBusinessLink, setGoogleBusinessLink] = useState(auth.companyProfile?.googleBusinessLink ?? "");

  const canSave = useMemo(
    () => [companyName, instagram, whatsappBusiness, targetAudience, city].every((v) => v.trim().length >= 2),
    [companyName, instagram, whatsappBusiness, targetAudience, city],
  );

  const save = async () => {
    await auth.updateCompanyProfile({
      companyName: companyName.trim(),
      instagram: instagram.trim(),
      whatsappBusiness: whatsappBusiness.trim(),
      targetAudience: targetAudience.trim(),
      city: city.trim(),
      website: website.trim(),
      googleBusinessLink: googleBusinessLink.trim(),
    });
    router.back();
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Card>
          <Kicker>Conta</Kicker>
          <Title>Cadastro da empresa</Title>
          <Body>Edite seus dados principais de empresa e contato.</Body>
        </Card>

        <Card>
          <SubTitle>Dados básicos</SubTitle>
          <Field label="Nome da empresa" value={companyName} onChangeText={setCompanyName} />
          <Field label="Instagram" value={instagram} onChangeText={setInstagram} placeholder="@suaempresa" />
          <Field label="WhatsApp da empresa" value={whatsappBusiness} onChangeText={setWhatsappBusiness} />
          <Field label="Público-alvo" value={targetAudience} onChangeText={setTargetAudience} />
          <Field label="Cidade principal" value={city} onChangeText={setCity} />
          <Field label="Site" value={website} onChangeText={setWebsite} placeholder="https://seusite.com" />
          <Field label="Ficha do Google" value={googleBusinessLink} onChangeText={setGoogleBusinessLink} />

          <View style={styles.actions}>
            <Button label="Voltar" variant="secondary" onPress={() => router.back()} style={styles.action} />
            <Button label="Salvar cadastro" onPress={() => void save()} disabled={!canSave} style={styles.action} />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 42,
    gap: 14,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  action: {
    flex: 1,
  },
});
