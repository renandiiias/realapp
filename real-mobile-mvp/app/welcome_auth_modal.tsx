import { Redirect } from "expo-router";

export default function WelcomeAuthModalRoute() {
  return <Redirect href="/welcome?modal=auth" />;
}
