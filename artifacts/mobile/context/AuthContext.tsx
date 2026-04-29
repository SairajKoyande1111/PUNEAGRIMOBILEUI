import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter, useSegments } from "expo-router";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

type Stage = "phone" | "otp" | "documents" | "ready";

type AuthState = {
  stage: Stage;
  phone: string | null;
  documents: Record<string, string | null>;
};

type AuthContextValue = {
  loading: boolean;
  stage: Stage;
  phone: string | null;
  documents: Record<string, string | null>;
  setPhone: (phone: string) => Promise<void>;
  verifyOtp: () => Promise<void>;
  setDocument: (id: string, uri: string) => Promise<void>;
  finishDocuments: () => Promise<void>;
  signOut: () => Promise<void>;
};

const STORAGE_KEY = "@app/auth_state_v1";

const DEFAULT_STATE: AuthState = {
  stage: "phone",
  phone: null,
  documents: {
    form_7a: null,
    form_12a_8a: null,
    aadhar: null,
    bank_passbook: null,
  },
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(DEFAULT_STATE);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as AuthState;
          setState({ ...DEFAULT_STATE, ...parsed });
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const persist = useCallback(async (next: AuthState) => {
    setState(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const setPhone = useCallback(
    async (phone: string) => {
      await persist({ ...state, phone, stage: "otp" });
    },
    [persist, state],
  );

  const verifyOtp = useCallback(async () => {
    await persist({ ...state, stage: "documents" });
  }, [persist, state]);

  const setDocument = useCallback(
    async (id: string, uri: string) => {
      await persist({
        ...state,
        documents: { ...state.documents, [id]: uri },
      });
    },
    [persist, state],
  );

  const finishDocuments = useCallback(async () => {
    await persist({ ...state, stage: "ready" });
  }, [persist, state]);

  const signOut = useCallback(async () => {
    await persist(DEFAULT_STATE);
  }, [persist]);

  return (
    <AuthContext.Provider
      value={{
        loading,
        stage: state.stage,
        phone: state.phone,
        documents: state.documents,
        setPhone,
        verifyOtp,
        setDocument,
        finishDocuments,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function useAuthRedirect() {
  const { loading, stage } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const current = segments[0];

    const targetByStage: Record<Stage, string> = {
      phone: "/login",
      otp: "/otp",
      documents: "/upload",
      ready: "/(tabs)",
    };

    if (stage === "ready") {
      if (current !== "(tabs)") {
        router.replace("/(tabs)");
      }
      return;
    }

    const target = targetByStage[stage];
    const isOnTarget =
      (stage === "phone" && current === "login") ||
      (stage === "otp" && current === "otp") ||
      (stage === "documents" && current === "upload");

    if (!isOnTarget) {
      router.replace(target as never);
    }
  }, [loading, stage, segments, router]);
}
