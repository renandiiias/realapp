import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  loginWithPassword as loginWithPasswordRequest,
  registerWithPassword as registerWithPasswordRequest,
} from "./authApi";
import { uuidv4 } from "../utils/uuid";
import {
  computeProfileReadiness,
  type CompanyProfile as CompanyProfileModel,
  type RayXData as RayXDataModel,
  type ReadinessFieldKey,
} from "./profileReadiness";

const KEY_LOGGED = "real:auth:logged_in";
const KEY_TOKEN = "real:auth:token";
const KEY_USER_EMAIL = "real:auth:user_email";
const KEY_MINIMUM_ONBOARDING_DONE = "real:onboarding:tour_done";
const KEY_APP_TOUR_DONE = "real:onboarding:app_tour_done";
const KEY_RAY_X = "real:onboarding:rayx";
const KEY_COMPANY_PROFILE = "real:onboarding:company_profile";
const KEY_FEEDBACKS = "real:account:feedbacks";
const KEY_REFERRAL_COUPON = "real:account:referral_coupon";

export type RayXData = RayXDataModel;
export type CompanyProfile = CompanyProfileModel;

export type FeedbackEntry = {
  id: string;
  message: string;
  createdAt: string;
};

export type ReferralCoupon = {
  code: string;
  createdAt: string;
};

type SaveInitialOnboardingInput = {
  rayX: Partial<RayXData>;
  companyProfile: Partial<CompanyProfile>;
};

type AuthContextValue = {
  ready: boolean;
  loggedIn: boolean;
  hasSeenTour: boolean;
  appTourCompleted: boolean;
  guidedTourActive: boolean;
  guidedTourStep: number;
  profileMinimumComplete: boolean;
  profileProductionComplete: boolean;
  companyProfileComplete: boolean;
  missingForMinimum: ReadinessFieldKey[];
  missingForProduction: ReadinessFieldKey[];
  userEmail: string | null;
  rayX: Partial<RayXData> | null;
  companyProfile: Partial<CompanyProfile> | null;
  feedbacks: FeedbackEntry[];
  referralCoupon: ReferralCoupon | null;
  loginWithPassword(email: string, password: string): Promise<void>;
  registerWithPassword(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  completeTour(rayXData: RayXData, companyProfileData: CompanyProfile): Promise<void>;
  completeAppTour(): Promise<void>;
  startGuidedTour(step?: number): void;
  setGuidedTourStep(step: number): void;
  stopGuidedTour(): void;
  saveInitialOnboarding(input: SaveInitialOnboardingInput): Promise<void>;
  saveProductionProfile(rayXData: RayXData, companyProfileData: CompanyProfile): Promise<void>;
  updateRayX(rayXData: Partial<RayXData>): Promise<void>;
  updateCompanyProfile(companyProfileData: Partial<CompanyProfile>): Promise<void>;
  topUpAdPrepaidBalance(amount: number): Promise<void>;
  submitFeedback(message: string): Promise<void>;
  generateReferralCoupon(): Promise<ReferralCoupon>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [hasSeenTour, setHasSeenTour] = useState(false);
  const [appTourCompleted, setAppTourCompleted] = useState(false);
  const [guidedTourActive, setGuidedTourActive] = useState(false);
  const [guidedTourStep, setGuidedTourStepState] = useState(0);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [rayX, setRayX] = useState<Partial<RayXData> | null>(null);
  const [companyProfile, setCompanyProfile] = useState<Partial<CompanyProfile> | null>(null);
  const [feedbacks, setFeedbacks] = useState<FeedbackEntry[]>([]);
  const [referralCoupon, setReferralCoupon] = useState<ReferralCoupon | null>(null);

  const readiness = useMemo(() => computeProfileReadiness({ rayX, companyProfile }), [rayX, companyProfile]);

  useEffect(() => {
    (async () => {
      const [
        loggedRaw,
        minimumOnboardingRaw,
        appTourRaw,
        userEmailRaw,
        rayXRaw,
        companyProfileRaw,
        feedbacksRaw,
        referralCouponRaw,
      ] = await Promise.all([
        AsyncStorage.getItem(KEY_LOGGED),
        AsyncStorage.getItem(KEY_MINIMUM_ONBOARDING_DONE),
        AsyncStorage.getItem(KEY_APP_TOUR_DONE),
        AsyncStorage.getItem(KEY_USER_EMAIL),
        AsyncStorage.getItem(KEY_RAY_X),
        AsyncStorage.getItem(KEY_COMPANY_PROFILE),
        AsyncStorage.getItem(KEY_FEEDBACKS),
        AsyncStorage.getItem(KEY_REFERRAL_COUPON),
      ]);

      const parsedRayX = parseJson<Partial<RayXData>>(rayXRaw);
      const parsedCompany = parseJson<Partial<CompanyProfile>>(companyProfileRaw);
      const parsedFeedbacks = parseJson<FeedbackEntry[]>(feedbacksRaw) ?? [];
      const parsedCoupon = parseJson<ReferralCoupon>(referralCouponRaw);

      const loadedReadiness = computeProfileReadiness({
        rayX: parsedRayX,
        companyProfile: parsedCompany,
      });

      const minimumDone = minimumOnboardingRaw === "true" || loadedReadiness.profileMinimumComplete;
      // Keep onboarding sequence strict: if app tour has never been marked as done,
      // require it once before releasing full tab navigation.
      const appTourDone = appTourRaw === "true";

      setLoggedIn(loggedRaw === "true");
      setHasSeenTour(minimumDone);
      setAppTourCompleted(appTourDone);
      setUserEmail(userEmailRaw);
      setRayX(parsedRayX);
      setCompanyProfile(parsedCompany);
      setFeedbacks(parsedFeedbacks);
      setReferralCoupon(parsedCoupon);
      setReady(true);
    })().catch(() => {
      setReady(true);
    });
  }, []);

  const persistSession = useCallback(async (token: string, email: string) => {
    await Promise.all([
      AsyncStorage.setItem(KEY_LOGGED, "true"),
      AsyncStorage.setItem(KEY_TOKEN, token),
      AsyncStorage.setItem(KEY_USER_EMAIL, email),
    ]);
    setLoggedIn(true);
    setUserEmail(email);
  }, []);

  const persistProfile = useCallback(
    async (
      nextRayX: Partial<RayXData>,
      nextCompanyProfile: Partial<CompanyProfile>,
      opts?: { forceMinimumDone?: boolean },
    ) => {
      const nextReadiness = computeProfileReadiness({
        rayX: nextRayX,
        companyProfile: nextCompanyProfile,
      });

      const minimumDone = Boolean(opts?.forceMinimumDone) || hasSeenTour || nextReadiness.profileMinimumComplete;

      await Promise.all([
        AsyncStorage.setItem(KEY_RAY_X, JSON.stringify(nextRayX)),
        AsyncStorage.setItem(KEY_COMPANY_PROFILE, JSON.stringify(nextCompanyProfile)),
        AsyncStorage.setItem(KEY_MINIMUM_ONBOARDING_DONE, minimumDone ? "true" : "false"),
      ]);

      setRayX(nextRayX);
      setCompanyProfile(nextCompanyProfile);
      setHasSeenTour(minimumDone);

      return nextReadiness;
    },
    [hasSeenTour],
  );

  const loginWithPassword = useCallback(
    async (email: string, password: string) => {
      const session = await loginWithPasswordRequest(email, password);
      await persistSession(session.token, session.user.email);
    },
    [persistSession],
  );

  const registerWithPassword = useCallback(
    async (email: string, password: string) => {
      const session = await registerWithPasswordRequest(email, password);
      await persistSession(session.token, session.user.email);
    },
    [persistSession],
  );

  const completeAppTour = useCallback(async () => {
    await AsyncStorage.setItem(KEY_APP_TOUR_DONE, "true");
    setAppTourCompleted(true);
    setGuidedTourActive(false);
  }, []);

  const startGuidedTour = useCallback((step = 0) => {
    setGuidedTourStepState(step);
    setGuidedTourActive(true);
  }, []);

  const setGuidedTourStep = useCallback((step: number) => {
    setGuidedTourStepState(step);
  }, []);

  const stopGuidedTour = useCallback(() => {
    setGuidedTourActive(false);
  }, []);

  const saveInitialOnboarding = useCallback(
    async (input: SaveInitialOnboardingInput) => {
      const nextRayX = { ...(rayX ?? {}), ...input.rayX };
      const nextCompanyProfile = { ...(companyProfile ?? {}), ...input.companyProfile };
      const nextReadiness = computeProfileReadiness({
        rayX: nextRayX,
        companyProfile: nextCompanyProfile,
      });

      if (!nextReadiness.profileMinimumComplete) {
        throw new Error("Preencha as informações mínimas para continuar.");
      }

      await persistProfile(nextRayX, nextCompanyProfile, { forceMinimumDone: true });
      if (!appTourCompleted) {
        await AsyncStorage.setItem(KEY_APP_TOUR_DONE, "false");
        setAppTourCompleted(false);
      }
    },
    [appTourCompleted, companyProfile, persistProfile, rayX],
  );

  const saveProductionProfile = useCallback(
    async (rayXData: RayXData, companyProfileData: CompanyProfile) => {
      const nextReadiness = computeProfileReadiness({
        rayX: rayXData,
        companyProfile: companyProfileData,
      });

      if (!nextReadiness.profileProductionComplete) {
        throw new Error("Complete o cadastro de produção para enviar para a Real.");
      }

      await persistProfile(rayXData, companyProfileData, { forceMinimumDone: true });
    },
    [persistProfile],
  );

  const completeTour = useCallback(
    async (rayXData: RayXData, companyProfileData: CompanyProfile) => {
      await saveProductionProfile(rayXData, companyProfileData);
      await completeAppTour();
    },
    [completeAppTour, saveProductionProfile],
  );

  const updateRayX = useCallback(
    async (rayXData: Partial<RayXData>) => {
      const nextRayX = { ...(rayX ?? {}), ...rayXData };
      const nextCompanyProfile = companyProfile ?? {};
      await persistProfile(nextRayX, nextCompanyProfile);
    },
    [companyProfile, persistProfile, rayX],
  );

  const updateCompanyProfile = useCallback(
    async (companyProfileData: Partial<CompanyProfile>) => {
      const nextRayX = rayX ?? {};
      const nextCompanyProfile = { ...(companyProfile ?? {}), ...companyProfileData };
      await persistProfile(nextRayX, nextCompanyProfile);
    },
    [companyProfile, persistProfile, rayX],
  );

  const topUpAdPrepaidBalance = useCallback(
    async (amount: number) => {
      if (!Number.isFinite(amount) || amount <= 0) return;
      const currentBalance = typeof companyProfile?.adPrepaidBalance === "number" ? companyProfile.adPrepaidBalance : 0;
      const nextRayX = rayX ?? {};
      const nextCompanyProfile = {
        ...(companyProfile ?? {}),
        adPrepaidBalance: Number((currentBalance + amount).toFixed(2)),
      };
      await persistProfile(nextRayX, nextCompanyProfile);
    },
    [companyProfile, persistProfile, rayX],
  );

  const logout = useCallback(async () => {
    await AsyncStorage.multiRemove([
      KEY_LOGGED,
      KEY_MINIMUM_ONBOARDING_DONE,
      KEY_APP_TOUR_DONE,
      KEY_TOKEN,
      KEY_USER_EMAIL,
      KEY_RAY_X,
      KEY_COMPANY_PROFILE,
      KEY_FEEDBACKS,
      KEY_REFERRAL_COUPON,
    ]);
    await Promise.all([
      AsyncStorage.setItem(KEY_LOGGED, "false"),
      AsyncStorage.setItem(KEY_MINIMUM_ONBOARDING_DONE, "false"),
      AsyncStorage.setItem(KEY_APP_TOUR_DONE, "false"),
    ]);
    setLoggedIn(false);
    setHasSeenTour(false);
    setAppTourCompleted(false);
    setGuidedTourActive(false);
    setGuidedTourStepState(0);
    setUserEmail(null);
    setRayX(null);
    setCompanyProfile(null);
    setFeedbacks([]);
    setReferralCoupon(null);
  }, []);

  const submitFeedback = useCallback(
    async (message: string) => {
      const clean = message.trim();
      if (!clean) return;
      const next: FeedbackEntry = {
        id: uuidv4(),
        message: clean,
        createdAt: new Date().toISOString(),
      };
      const merged = [next, ...feedbacks].slice(0, 20);
      await AsyncStorage.setItem(KEY_FEEDBACKS, JSON.stringify(merged));
      setFeedbacks(merged);
    },
    [feedbacks],
  );

  const generateReferralCoupon = useCallback(async () => {
    if (referralCoupon) return referralCoupon;
    const base =
      (userEmail ?? "cliente")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 6)
        .toUpperCase() || "CLIENT";
    const random = Math.floor(1000 + Math.random() * 9000);
    const next: ReferralCoupon = {
      code: `REAL-${base}-${random}`,
      createdAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(KEY_REFERRAL_COUPON, JSON.stringify(next));
    setReferralCoupon(next);
    return next;
  }, [referralCoupon, userEmail]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      loggedIn,
      hasSeenTour,
      appTourCompleted,
      guidedTourActive,
      guidedTourStep,
      profileMinimumComplete: readiness.profileMinimumComplete,
      profileProductionComplete: readiness.profileProductionComplete,
      companyProfileComplete: readiness.profileProductionComplete,
      missingForMinimum: readiness.missingForMinimum,
      missingForProduction: readiness.missingForProduction,
      userEmail,
      rayX,
      companyProfile,
      feedbacks,
      referralCoupon,
      loginWithPassword,
      registerWithPassword,
      logout,
      completeTour,
      completeAppTour,
      startGuidedTour,
      setGuidedTourStep,
      stopGuidedTour,
      saveInitialOnboarding,
      saveProductionProfile,
      updateRayX,
      updateCompanyProfile,
      topUpAdPrepaidBalance,
      submitFeedback,
      generateReferralCoupon,
    }),
    [
      ready,
      loggedIn,
      hasSeenTour,
      appTourCompleted,
      guidedTourActive,
      guidedTourStep,
      readiness,
      userEmail,
      rayX,
      companyProfile,
      feedbacks,
      referralCoupon,
      loginWithPassword,
      registerWithPassword,
      logout,
      completeTour,
      completeAppTour,
      startGuidedTour,
      setGuidedTourStep,
      stopGuidedTour,
      saveInitialOnboarding,
      saveProductionProfile,
      updateRayX,
      updateCompanyProfile,
      topUpAdPrepaidBalance,
      submitFeedback,
      generateReferralCoupon,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
