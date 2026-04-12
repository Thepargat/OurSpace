import { createContext, useContext, useEffect, useState } from "react";
import { auth, db } from "../firebase";
import { signInWithPopup, onAuthStateChanged, User, GoogleAuthProvider } from "firebase/auth";
import { doc, getDoc, updateDoc, deleteDoc, setDoc, onSnapshot } from "firebase/firestore";
import { motion } from "framer-motion";

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
  userData?: any;
  googleAccessToken: string | null;
}

interface AuthContextType extends AuthState {
  signIn: () => Promise<void>;
  connectGoogleCalendar: () => Promise<boolean>;
  clearGoogleToken: () => void;
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
    googleAccessToken: null,
  });

  const connectGoogleCalendar = async () => {
    if (!authState.user) return false;
    
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/calendar.events');
    provider.addScope('https://www.googleapis.com/auth/calendar.readonly');
    
    // Request offline access to get a refresh token
    provider.setCustomParameters({
      access_type: 'offline',
      prompt: 'consent'
    });
    
    try {
      const result = await signInWithPopup(auth, provider);
      
      // The credential only contains the short-lived accessToken
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const accessToken = credential?.accessToken;
      
      // The refreshToken is found in the _tokenResponse for signInWithPopup
      // when access_type=offline and prompt=consent are used
      const tokenResponse = (result as any)._tokenResponse;
      const refreshToken = tokenResponse?.refreshToken;
      
      if (accessToken) {
        const tokenData: any = {
          accessToken,
          expiresAt: Date.now() + 3500 * 1000, // 3500 to be safe (Google is 3600)
          updatedAt: new Date().toISOString()
        };

        // ONLY update refreshToken if it's present (usually only on first consent)
        if (refreshToken) {
          tokenData.refreshToken = refreshToken;
        }

        // Store in Firestore
        await setDoc(doc(db, "users", authState.user.uid, "googleCalendarToken", "current"), tokenData, { merge: true });
        
        // Update user document
        await updateDoc(doc(db, "users", authState.user.uid), {
          calendarConnected: true,
          calendarEmail: result.user.email,
          updatedAt: new Date().toISOString()
        });
        
        setAuthState(prev => ({
          ...prev,
          googleAccessToken: accessToken,
          userData: { ...prev.userData, calendarConnected: true, calendarEmail: result.user.email }
        }));
        
        return true;
      }
    } catch (error) {
      console.error("Error connecting Google Calendar:", error);
      return false;
    }
    return false;
  };

  const clearGoogleToken = async () => {
    if (authState.user) {
      try {
        await deleteDoc(doc(db, "users", authState.user.uid, "googleCalendarToken", "current"));
        await updateDoc(doc(db, "users", authState.user.uid), {
          calendarConnected: false
        });
      } catch (err) {
        console.error("Error clearing token:", err);
      }
    }
    setAuthState(prev => ({ ...prev, googleAccessToken: null }));
  };

  useEffect(() => {
    let userDocUnsubscribe: (() => void) | null = null;

    const authUnsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        // First, set the user so we can show the loading state for the doc
        setAuthState(prev => ({ ...prev, user: currentUser, loading: true }));

        // Listen to the user document in real-time
        const userDocRef = doc(db, "users", currentUser.uid);
        
        if (userDocUnsubscribe) userDocUnsubscribe();
        
        userDocUnsubscribe = onSnapshot(userDocRef, async (snapshot) => {
          if (snapshot.exists()) {
            const userData = snapshot.data();
            const householdId = userData?.householdId || null;
            const hasHousehold = !!householdId;

            // Fetch token from Firestore (one-time fetch is fine here, or we could listen too)
            const tokenDoc = await getDoc(doc(db, "users", currentUser.uid, "googleCalendarToken", "current"));
            const googleAccessToken = tokenDoc.exists() ? tokenDoc.data().accessToken : null;

            setAuthState(prev => ({
              ...prev,
              loading: false,
              hasHousehold,
              householdId,
              userData,
              googleAccessToken,
              error: "",
            }));
          } else {
            // Create user doc if it doesn't exist
            const newUser = {
              uid: currentUser.uid,
              email: currentUser.email,
              displayName: currentUser.displayName,
              photoURL: currentUser.photoURL,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            await setDoc(userDocRef, newUser);
            
            setAuthState(prev => ({
              ...prev,
              loading: false,
              hasHousehold: false,
              householdId: null,
              userData: newUser,
              googleAccessToken: null,
              error: "",
            }));
          }
        }, (err: any) => {
          console.error("Error listening to user doc:", err);
          setAuthState(prev => ({ ...prev, loading: false, error: "Failed to load user data" }));
        });
      } else {
        if (userDocUnsubscribe) {
          userDocUnsubscribe();
          userDocUnsubscribe = null;
        }
        setAuthState(prev => ({
          ...prev,
          user: null,
          loading: false,
          hasHousehold: false,
          householdId: null,
          userData: null,
          googleAccessToken: null,
          error: "",
        }));
      }
    });

    return () => {
      authUnsubscribe();
      if (userDocUnsubscribe) userDocUnsubscribe();
    };
  }, []);

  const handleGoogleSignIn = async () => {
    try {
      setAuthState(prev => ({ ...prev, error: "" }));
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      setAuthState(prev => ({ ...prev, error: err.message || "Failed to sign in" }));
    }
  };

  if (authState.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8F4EE]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#D4CEC4] border-t-[#B8955A]" />
      </div>
    );
  }

  if (!authState.user) {
    const springConfig = { type: "spring" as const, stiffness: 280, damping: 22 };

    return (
      <div 
        style={{
          minHeight: "100dvh",
          background: "#F8F4EE",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 24px",
          position: "relative",
          overflow: "hidden"
        }}
      >
        {/* Grain Texture Overlay */}
        <div 
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.03,
            pointerEvents: "none",
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
            zIndex: 1
          }}
        />

        <div className="relative z-10 flex flex-col items-center text-center w-full">
          <motion.h1
            initial={{ opacity: 0, y: 40, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ ...springConfig, delay: 0 }}
            style={{
              fontFamily: "'Fraunces', serif",
              fontSize: "52px",
              fontWeight: 300,
              color: "#1A1A1A",
              margin: 0,
              letterSpacing: "-2px"
            }}
          >
            OurSpace
          </motion.h1>

          <motion.div
            initial={{ opacity: 0, y: 40, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ ...springConfig, delay: 0.08 }}
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              background: "#B8955A",
              marginTop: "12px"
            }}
          />

          <motion.p
            initial={{ opacity: 0, y: 40, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ ...springConfig, delay: 0.16 }}
            style={{
              fontFamily: "'Outfit', sans-serif",
              fontSize: "16px",
              color: "#6B6560",
              marginTop: "16px",
              marginRight: 0,
              marginBottom: 0,
              marginLeft: 0
            }}
          >
            Your private space together
          </motion.p>
          
          <div style={{ height: "80px" }} />

          <motion.button
            initial={{ opacity: 0, y: 40, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ type: "spring", stiffness: 280, damping: 22, delay: 0.24 }}
            whileTap={{ scale: 0.96 }}
            onClick={handleGoogleSignIn}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "12px",
              width: "100%",
              maxWidth: "300px",
              height: "56px",
              background: "#1A1A1A",
              border: "none",
              borderRadius: "999px",
              cursor: "pointer",
              fontFamily: "'Outfit', sans-serif",
              fontSize: "15px",
              fontWeight: 500,
              color: "#FFFFFF",
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

          <motion.p
            initial={{ opacity: 0, y: 40, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ ...springConfig, delay: 0.32 }}
            style={{
              fontFamily: "'Outfit', sans-serif",
              fontSize: "12px",
              color: "#D4CEC4",
              textAlign: "center",
              marginTop: "16px"
            }}
          >
            Private & secure — just for two
          </motion.p>

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
    <AuthContext.Provider value={{ ...authState, signIn: handleGoogleSignIn, connectGoogleCalendar, clearGoogleToken }}>
      {children}
    </AuthContext.Provider>
  );
}
