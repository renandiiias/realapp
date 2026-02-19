import { Redirect } from "expo-router";

export default function WelcomeServicesModalRoute() {
  return <Redirect href="/welcome?modal=services" />;
}
