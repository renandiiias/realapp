import { Redirect } from "expo-router";

export default function WelcomeLoadingModalRoute() {
  return <Redirect href="/welcome?modal=loading" />;
}
