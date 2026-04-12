npx vercel env add VITE_FIREBASE_AUTH_DOMAIN production --value ourspace-898d8.firebaseapp.com --yes --scope thepargats-projects | Out-Host
npx vercel env add VITE_FIREBASE_PROJECT_ID production --value ourspace-898d8 --yes --scope thepargats-projects | Out-Host
npx vercel env add VITE_FIREBASE_STORAGE_BUCKET production --value ourspace-898d8.firebasestorage.app --yes --scope thepargats-projects | Out-Host
npx vercel env add VITE_FIREBASE_MESSAGING_SENDER_ID production --value 315282314755 --yes --scope thepargats-projects | Out-Host
npx vercel env add VITE_FIREBASE_APP_ID production --value 1:315282314755:web:e01f8872da498151aa6036 --yes --scope thepargats-projects | Out-Host
npx vercel --prod --scope thepargats-projects --yes | Out-Host
