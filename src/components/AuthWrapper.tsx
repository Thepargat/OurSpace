import { createContext, useContext, useEffect, useState } from "react";
import { auth, db, googleProvider } from "../firebase";
import { signInWithPopup, onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { motion } from "motion/react";

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface AuthState {
  user: User | null;
  loading: boolean;
  hasHousehold: boolean;
  householdId: string | null;
  error: string;
}

interface AuthContextType extends AuthState {
  signIn: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}

export default function AuthWrapper({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    loading: true,
    hasHousehold: false,
    householdId: null,
    error: "",
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        const userPath = `users/${currentUser.uid}`;
        try {
          const userDoc = await getDoc(doc(db, "users", currentUser.uid));
          const householdId = userDoc.exists() ? userDoc.data()?.householdId : null;
          const hasHousehold = !!householdId;
          setAuthState({
            user: currentUser,
            loading: false,
            hasHousehold,
            householdId,
            error: "",
          });
        } catch (err: any) {
          console.error("Error checking user doc:", err);
          // If it's a permission error, we still want to let them in but they might need onboarding
          if (err.code === 'permission-denied') {
             setAuthState({
              user: currentUser,
              loading: false,
              hasHousehold: false,
              householdId: null,
              error: "",
            });
          } else {
            handleFirestoreError(err, OperationType.GET, userPath);
          }
        }
      } else {
        setAuthState({
          user: null,
          loading: false,
          hasHousehold: false,
          householdId: null,
          error: "",
        });
      }
    });

    return () => unsubscribe();
  }, []);

  const handleGoogleSignIn = async () => {
    try {
      setAuthState(prev => ({ ...prev, error: "" }));
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      setAuthState(prev => ({ ...prev, error: err.message || "Failed to sign in" }));
    }
  };

  if (authState.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-linen">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-stone border-t-brass" />
      </div>
    );
  }

  if (!authState.user) {
    const springConfig = { type: "spring" as const, stiffness: 280, damping: 22 }

    return (
      <div 
        style={{
          minHeight: "100dvh",
          background: "var(--linen)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 24px"
        }}
      >
        <div className="relative z-10 flex flex-col items-center text-center">
          <motion.h1
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springConfig, delay: 0 }}
            style={{
              fontFamily: "'Fraunces', serif",
              fontSize: "48px",
              fontWeight: 300,
              color: "var(--charcoal)",
              margin: 0,
              letterSpacing: "-1px"
            }}
          >
            OurSpace
          </motion.h1>

          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 18, delay: 0.2 }}
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "var(--brass)",
              margin: "12px auto"
            }}
          />

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springConfig, delay: 0.25 }}
            style={{
              fontFamily: "'Outfit', sans-serif",
              fontSize: "16px",
              color: "var(--warm-grey)",
              margin: 0
            }}
          >
            Your private space together
          </motion.p>
          
          <motion.button
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springConfig, delay: 0.35 }}
            whileTap={{ scale: 0.96 }}
            whileHover={{ scale: 1.02 }}
            onClick={handleGoogleSignIn}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "12px",
              width: "100%",
              maxWidth: "320px",
              height: "52px",
              background: "var(--charcoal)",
              border: "none",
              borderRadius: "999px",
              cursor: "pointer",
              fontFamily: "'Outfit', sans-serif",
              fontSize: "15px",
              fontWeight: 500,
              color: "white",
              marginTop: "48px",
              boxShadow: "0 8px 32px rgba(26,26,26,0.15)"
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </motion.button>

          {authState.error && (
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 text-sm text-red-500"
            >
              {authState.error}
            </motion.p>
          )}
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ ...authState, signIn: handleGoogleSignIn }}>
      {children}
    </AuthContext.Provider>
  );
}
