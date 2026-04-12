import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import admin from "firebase-admin";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import { GoogleGenerativeAI } from "@google/generative-ai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Initialize Firebase Admin
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccount) {
    try {
      const parsedAccount = JSON.parse(serviceAccount);
      admin.initializeApp({
        credential: admin.credential.cert(parsedAccount),
      });
    } catch (error) {
      console.error("Error parsing FIREBASE_SERVICE_ACCOUNT:", error);
    }
  } else {
    console.warn("FIREBASE_SERVICE_ACCOUNT not found. FCM v1 will not work.");
  }

  // API Routes
  app.post("/api/refresh-google-token", async (req, res) => {
    const { refreshToken } = req.body;
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!refreshToken || !clientId || !clientSecret) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    try {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        return res.status(response.status).json(error);
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Error refreshing Google token:", error);
      res.status(500).json({ error: "Failed to refresh token" });
    }
  });

  app.post("/api/notify", async (req, res) => {
    const { token, title, body, icon, click_action } = req.body;

    if (!admin.apps.length) {
      return res.status(500).json({ error: "Firebase Admin not initialized" });
    }

    try {
      const message = {
        token: token,
        notification: {
          title: title,
          body: body,
        },
        webpush: {
          notification: {
            icon: icon || "/icons/icon-192.png",
          },
          fcm_options: {
            link: click_action || process.env.APP_URL || "http://localhost:3000",
          },
        },
      };

      const response = await admin.messaging().send(message);
      res.json({ success: true, messageId: response });
    } catch (error) {
      console.error("Error sending FCM message:", error);
      res.status(500).json({ error: "Failed to send notification" });
    }
  });

  // Gemini text generation (all prompt-only AI calls)
  app.post("/api/gemini/text", async (req, res) => {
    const { model = "gemini-2.5-flash-preview", prompt, jsonMode = false } = req.body as {
      model?: string; prompt: string; jsonMode?: boolean;
    };
    if (!prompt) return res.status(400).json({ error: "prompt required" });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY not configured" });

    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        ...(jsonMode ? { config: { responseMimeType: "application/json" } } : {}),
      });
      res.json({ text: response.text });
    } catch (err) {
      console.error("Gemini text generation failed:", err);
      res.status(500).json({ error: "Gemini API call failed" });
    }
  });

  // Gemini vision (receipt scanning — multimodal)
  app.post("/api/gemini/vision", async (req, res) => {
    const { model = "gemini-2.0-flash", prompt, base64Data, mimeType } = req.body as {
      model?: string; prompt: string; base64Data: string; mimeType: string;
    };
    if (!prompt || !base64Data || !mimeType) {
      return res.status(400).json({ error: "prompt, base64Data, and mimeType required" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY not configured" });

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const genModel = genAI.getGenerativeModel({ model });
      const result = await genModel.generateContent([
        { text: prompt },
        { inlineData: { data: base64Data, mimeType } },
      ]);
      res.json({ text: result.response.text() });
    } catch (err) {
      console.error("Gemini vision generation failed:", err);
      res.status(500).json({ error: "Gemini API call failed" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
  });
}

startServer();
