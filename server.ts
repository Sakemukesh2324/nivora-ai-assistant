import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { generateFile, GenerateFileParams } from "./src/fileGenerators";
import JSZip from "jszip";
import * as XLSX from "xlsx";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Canonical Host & Protocol Redirection:
// Redirect http://nivora.org, http://www.nivora.org, https://www.nivora.org -> https://nivora.org/
app.use((req, res, next) => {
  const host = (req.headers.host || "").toLowerCase().split(":")[0];
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || req.protocol || "").toLowerCase();

  if (host === "www.nivora.org") {
    return res.redirect(301, `https://nivora.org${req.originalUrl}`);
  }
  if (host === "nivora.org" && proto === "http") {
    return res.redirect(301, `https://nivora.org${req.originalUrl}`);
  }
  next();
});

// Local persistent store
const DATA_DIR = path.resolve(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const DB_FILE = path.join(DATA_DIR, "nivora_store.json");

interface UserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  profilePicture?: string;
  googleId?: string;
  createdAt: number;
  updatedAt?: number;
}

interface MemoryItem {
  id: string;
  userId: string;
  category: "preference" | "fact" | "instruction";
  content: string;
  createdAt: number;
}

interface ProjectItem {
  id: string;
  userId: string;
  name: string;
  description: string;
  instructions?: string;
  chatIds: string[];
  files: { name: string; size: number; type: string; data?: string }[];
  updatedAt: number;
}

interface DBStore {
  users: UserRecord[];
  memories: MemoryItem[];
  memoryEnabled: Record<string, boolean>;
  projects: ProjectItem[];
  connectors: Record<string, { enabled: boolean; lastSync?: number; account?: string }>;
  chats?: Record<string, any[]>;
  settings?: Record<string, any>;
}

function loadDB(): DBStore {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("Failed to load local store:", err);
  }
  return {
    users: [],
    memories: [],
    memoryEnabled: {},
    projects: [],
    connectors: {
      google_drive: { enabled: false },
      google_docs: { enabled: false },
      google_sheets: { enabled: false },
      gmail: { enabled: false },
      google_calendar: { enabled: false },
      github: { enabled: false },
    },
  };
}

function saveDB(db: DBStore) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to save local store:", err);
  }
}

// Lazy Gemini client helper
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// -------------------------------------------------------------
// AUTH ENDPOINTS
// -------------------------------------------------------------

app.post("/auth/signup", (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password || !name) {
      res.status(400).json({ detail: "Name, email, and password are required." });
      return;
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const db = loadDB();
    const existing = db.users.find((u) => u.email.toLowerCase() === cleanEmail);
    if (existing) {
      res.status(400).json({ detail: "An account with this email already exists." });
      return;
    }

    const userId = "NIV-" + Math.floor(100000 + Math.random() * 900000);
    const newUser: UserRecord = {
      id: userId,
      name: String(name).trim(),
      email: cleanEmail,
      passwordHash: hashPassword(String(password)),
      createdAt: Date.now(),
    };
    db.users.push(newUser);
    saveDB(db);

    res.json({
      message: "Account created successfully.",
      user: {
        user_id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        profile_picture: newUser.profilePicture,
      },
    });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ detail: "Internal server error during signup." });
  }
});

app.post("/auth/login", (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ detail: "Email and password are required." });
      return;
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const db = loadDB();
    let user = db.users.find((u) => u.email.toLowerCase() === cleanEmail);

    if (!user) {
      res.status(401).json({ detail: "Incorrect email or password." });
      return;
    } else {
      let match = false;
      if (user.passwordHash.includes(":")) {
        match = verifyPassword(String(password), user.passwordHash);
      } else {
        match = user.passwordHash === Buffer.from(String(password)).toString("base64");
        if (match) {
          // Upgrade to modern hash
          user.passwordHash = hashPassword(String(password));
          saveDB(db);
        }
      }
      if (!match) {
        res.status(401).json({ detail: "Incorrect email or password." });
        return;
      }
    }

    res.json({
      message: "Login successful.",
      user: {
        user_id: user.id,
        name: user.name,
        email: user.email,
        profile_picture: user.profilePicture,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ detail: "Internal server error during login." });
  }
});

app.post("/auth/reset-password", (req, res) => {
  try {
    const { email, new_password } = req.body;
    if (!email || !new_password) {
      res.status(400).json({ detail: "Email and new password are required." });
      return;
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const db = loadDB();
    const user = db.users.find((u) => u.email.toLowerCase() === cleanEmail);
    if (!user) {
      res.status(404).json({ detail: "No user found with this email." });
      return;
    }

    user.passwordHash = hashPassword(String(new_password));
    saveDB(db);
    res.json({ message: "Password reset successfully." });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ detail: "Could not reset password." });
  }
});

// Password hashing helpers (PBKDF2/scrypt - no plaintext or base64)
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, key] = storedHash.split(":");
  const keyBuffer = Buffer.from(key, "hex");
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
}

// -------------------------------------------------------------
// REAL SECURE OTP EMAIL VERIFICATION SYSTEM
// -------------------------------------------------------------

interface OtpRecord {
  hash: string;
  expiresAt: number;
  attempts: number;
  lastSentAt: number;
}
const otpStore = new Map<string, OtpRecord>();
const verifiedResetTokens = new Map<string, { email: string; expiresAt: number }>();

async function sendOtpEmail(email: string, otp: string): Promise<{ success: boolean; error?: string }> {
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER;
  const smtpPass = process.env.SMTP_PASSWORD || process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD;
  const smtpPort = Number(process.env.SMTP_PORT) || 587;
  const smtpFrom = process.env.SMTP_FROM || `"NIVORA" <${smtpUser || "noreply@nivora.ai"}>`;

  const resendApiKey = process.env.RESEND_API_KEY;
  const resendFrom = process.env.RESEND_FROM || "NIVORA <onboarding@resend.dev>";

  const emailSubject = "NIVORA Password Reset Verification Code";
  const emailText = `Hello,\n\nYour NIVORA password reset verification code is:\n\n${otp}\n\nThis code expires in 10 minutes.\n\nIf you did not request a password reset, ignore this email.\n\nRegards,\nNIVORA`;
  const emailHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; background: #181b22; color: #ffffff; padding: 32px; border-radius: 12px; border: 1px solid #303541;">
      <h2 style="color: #6c63ff; margin-top: 0; letter-spacing: 1px;">NIVORA</h2>
      <h3 style="color: #ffffff; margin-bottom: 8px;">Password Reset Verification</h3>
      <p style="color: #a0a7b5; font-size: 14px; line-height: 1.6;">Hello,</p>
      <p style="color: #a0a7b5; font-size: 14px; line-height: 1.6;">Your NIVORA password reset verification code is:</p>
      <div style="background: #212530; border: 1px solid #3a4153; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
        <span style="font-size: 34px; letter-spacing: 8px; font-weight: bold; color: #6c63ff; font-family: monospace;">${otp}</span>
      </div>
      <p style="color: #a0a7b5; font-size: 13px; line-height: 1.5;">This code expires in 10 minutes.</p>
      <p style="color: #858da0; font-size: 12px; line-height: 1.5;">If you did not request a password reset, ignore this email.</p>
      <p style="color: #a0a7b5; font-size: 13px; margin-top: 24px;">Regards,<br><strong>NIVORA</strong></p>
    </div>
  `;

  // 1. Try Resend if configured
  if (resendApiKey) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: resendFrom,
          to: [email],
          subject: emailSubject,
          text: emailText,
          html: emailHtml,
        }),
      });
      if (response.ok) {
        console.log(`[EMAIL SERVICE] OTP successfully delivered via Resend to ${email}`);
        return { success: true };
      } else {
        const errText = await response.text();
        console.error(`[EMAIL SERVICE] Resend delivery error:`, errText);
        return { success: false, error: "Email delivery provider error. Please try again." };
      }
    } catch (resendErr) {
      console.error("[EMAIL SERVICE] Resend connection exception:", resendErr);
      return { success: false, error: "Failed to connect to email delivery service." };
    }
  }

  // 2. Try SMTP if configured
  if (smtpHost || (smtpUser && smtpPass)) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost || "smtp.gmail.com",
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      await transporter.sendMail({
        from: smtpFrom,
        to: email,
        subject: emailSubject,
        text: emailText,
        html: emailHtml,
      });
      console.log(`[EMAIL SERVICE] OTP successfully delivered via SMTP to ${email}`);
      return { success: true };
    } catch (mailErr: any) {
      console.error("[EMAIL SERVICE] SMTP delivery error:", mailErr?.message || mailErr);
      return { success: false, error: "Unable to send verification code via email. Please check your email address or SMTP configuration." };
    }
  }

  // No email credentials configured
  console.warn(`[EMAIL SERVICE] No SMTP or Resend credentials configured.`);
  return {
    success: false,
    error: "Email delivery service is not configured. Please configure SMTP credentials in Settings, or use Firebase password reset."
  };
}

app.get(["/api/health", "/health", "/healthz"], (req, res) => {
  res.json({
    status: "ok",
    app: "NIVORA",
    timestamp: Date.now(),
    uptime: process.uptime(),
  });
});

app.post("/api/auth/send-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !String(email).includes("@")) {
      res.status(400).json({ error: "Please enter a valid email address." });
      return;
    }
    const cleanEmail = String(email).trim().toLowerCase();

    // Rate limiting: minimum 40s between requests
    const existing = otpStore.get(cleanEmail);
    if (existing && Date.now() - existing.lastSentAt < 40000) {
      const waitSec = Math.ceil((40000 - (Date.now() - existing.lastSentAt)) / 1000);
      res.status(429).json({ error: `Please wait ${waitSec} seconds before requesting a new code.` });
      return;
    }

    // Cryptographically secure random 6-digit code
    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Old OTP invalidated by setting new record
    otpStore.set(cleanEmail, {
      hash: codeHash,
      expiresAt,
      attempts: 0,
      lastSentAt: Date.now(),
    });

    const sendResult = await sendOtpEmail(cleanEmail, code);
    if (!sendResult.success) {
      // Invalidate the record if sending failed
      otpStore.delete(cleanEmail);
      res.status(500).json({ error: sendResult.error || "Unable to send verification code. Please try again." });
      return;
    }

    res.json({ success: true, message: "Verification code sent to your email." });
  } catch (err) {
    console.error("send-otp error:", err);
    res.status(500).json({ error: "Unable to send verification code. Please try again." });
  }
});

app.post("/api/auth/verify-otp", (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      res.status(400).json({ error: "Email and verification code are required." });
      return;
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanCode = String(code).trim();

    const record = otpStore.get(cleanEmail);
    if (!record) {
      res.status(400).json({ error: "No verification code found. Please request a new code." });
      return;
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(cleanEmail);
      res.status(400).json({ error: "Verification code expired. Please request a new code." });
      return;
    }

    record.attempts++;
    if (record.attempts > 5) {
      otpStore.delete(cleanEmail);
      res.status(400).json({ error: "Too many failed attempts. Please request a new code." });
      return;
    }

    const inputHash = crypto.createHash("sha256").update(cleanCode).digest("hex");
    if (inputHash !== record.hash) {
      res.status(400).json({ error: "Invalid verification code." });
      return;
    }

    // Code verified: delete one-time OTP immediately to prevent reuse
    otpStore.delete(cleanEmail);

    // Issue cryptographic verification token for password reset step
    const verifyToken = crypto.randomBytes(32).toString("hex");
    verifiedResetTokens.set(verifyToken, {
      email: cleanEmail,
      expiresAt: Date.now() + 15 * 60 * 1000, // 15 mins
    });

    res.json({
      success: true,
      verifyToken,
      message: "Email verified successfully.",
    });
  } catch (err) {
    console.error("verify-otp error:", err);
    res.status(500).json({ error: "Could not verify code. Please try again." });
  }
});

// -------------------------------------------------------------
// USER PROFILE & AVATAR ENDPOINTS
// -------------------------------------------------------------

app.get("/api/user/profile", (req, res) => {
  try {
    const userId = String(req.query.userId || "");
    const email = String(req.query.email || "").trim().toLowerCase();
    const db = loadDB();
    const user = db.users.find(
      (u) => (userId && u.id === userId) || (email && u.email.toLowerCase() === email)
    );
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    res.json({
      user: {
        user_id: user.id,
        name: user.name,
        email: user.email,
        profile_picture: user.profilePicture || null,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Could not retrieve user profile." });
  }
});

app.post("/api/user/profile", (req, res) => {
  try {
    const { userId, email, name } = req.body;
    if (!name || !String(name).trim()) {
      res.status(400).json({ error: "Display name cannot be empty." });
      return;
    }
    const cleanName = String(name).trim();
    const cleanEmail = email ? String(email).trim().toLowerCase() : "";
    const db = loadDB();
    let user = db.users.find(
      (u) => (userId && u.id === userId) || (cleanEmail && u.email.toLowerCase() === cleanEmail)
    );
    if (!user) {
      user = {
        id: userId || "NIV-" + Math.floor(100000 + Math.random() * 900000),
        name: cleanName,
        email: cleanEmail || "user@nivora.ai",
        passwordHash: "",
        createdAt: Date.now(),
      };
      db.users.push(user);
    } else {
      user.name = cleanName;
      user.updatedAt = Date.now();
    }
    saveDB(db);
    res.json({
      success: true,
      message: "Display name updated successfully.",
      user: {
        user_id: user.id,
        name: user.name,
        email: user.email,
        profile_picture: user.profilePicture || null,
      },
    });
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ error: "Could not update profile name." });
  }
});

app.post("/api/user/avatar", (req, res) => {
  try {
    const userId = req.body.userId || req.body.uid;
    const email = req.body.email;
    const imageBase64 = req.body.imageBase64 || req.body.avatarBase64;
    if (!imageBase64 || typeof imageBase64 !== "string") {
      res.status(400).json({ error: "Image data is required." });
      return;
    }
    if (imageBase64.length > 7 * 1024 * 1024) {
      res.status(400).json({ error: "Image size exceeds maximum limit of 5MB." });
      return;
    }
    if (!imageBase64.startsWith("data:image/")) {
      res.status(400).json({ error: "Invalid image format. Supported: PNG, JPEG, WEBP, GIF." });
      return;
    }
    const cleanEmail = email ? String(email).trim().toLowerCase() : "";
    const db = loadDB();
    let user = db.users.find(
      (u) => (userId && u.id === userId) || (cleanEmail && u.email.toLowerCase() === cleanEmail)
    );
    if (!user) {
      user = {
        id: userId || "NIV-" + Math.floor(100000 + Math.random() * 900000),
        name: "NIVORA User",
        email: cleanEmail || "user@nivora.ai",
        passwordHash: "",
        profilePicture: imageBase64,
        createdAt: Date.now(),
      };
      db.users.push(user);
    } else {
      user.profilePicture = imageBase64;
      user.updatedAt = Date.now();
    }
    saveDB(db);
    res.json({
      success: true,
      message: "Profile photo saved successfully.",
      profile_picture: user.profilePicture,
      user: {
        user_id: user.id,
        name: user.name,
        email: user.email,
        profile_picture: user.profilePicture,
      },
    });
  } catch (err) {
    console.error("Update avatar error:", err);
    res.status(500).json({ error: "Could not update profile picture." });
  }
});

// -------------------------------------------------------------
// CHATS PERSISTENCE API
// -------------------------------------------------------------

app.get("/api/chats", (req, res) => {
  try {
    const userId = String(req.query.userId || "anonymous");
    const db = loadDB();
    const userChats = (db.chats && db.chats[userId]) || [];
    res.json({ chats: userChats });
  } catch (err) {
    res.status(500).json({ error: "Could not load chats." });
  }
});

app.post("/api/chats", (req, res) => {
  try {
    const { userId, chats } = req.body;
    if (!userId || !Array.isArray(chats)) {
      res.status(400).json({ error: "userId and chats array required." });
      return;
    }
    const db = loadDB();
    if (!db.chats) db.chats = {};
    db.chats[userId] = chats;
    saveDB(db);
    res.json({ success: true, count: chats.length });
  } catch (err) {
    res.status(500).json({ error: "Could not save chats." });
  }
});

app.delete("/api/chats/:chatId", (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = String(req.query.userId || req.body.userId || "anonymous");
    const db = loadDB();
    if (db.chats && db.chats[userId]) {
      db.chats[userId] = db.chats[userId].filter((c: any) => String(c.id) !== String(chatId));
      saveDB(db);
    }
    res.json({ success: true, message: "Chat deleted." });
  } catch (err) {
    res.status(500).json({ error: "Could not delete chat." });
  }
});

app.patch("/api/chats/:chatId", (req, res) => {
  try {
    const { chatId } = req.params;
    const { userId, title, pinned, archived } = req.body;
    const uid = String(userId || "anonymous");
    const db = loadDB();
    if (db.chats && db.chats[uid]) {
      const chat = db.chats[uid].find((c: any) => String(c.id) === String(chatId));
      if (chat) {
        if (title !== undefined) chat.title = title;
        if (pinned !== undefined) chat.pinned = pinned;
        if (archived !== undefined) chat.archived = archived;
        chat.updatedAt = Date.now();
        saveDB(db);
        res.json({ success: true, chat });
        return;
      }
    }
    res.status(404).json({ error: "Chat not found." });
  } catch (err) {
    res.status(500).json({ error: "Could not update chat." });
  }
});

function safeIsoDate(ts: any): string | undefined {
  if (!ts) return undefined;
  try {
    const num = typeof ts === "number" ? ts : Number(ts);
    const d = !isNaN(num) && num > 1000000000 ? new Date(num) : new Date(ts);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  } catch {
    return undefined;
  }
}

function safeTimeString(ts: any): string {
  if (!ts) return "";
  try {
    const num = typeof ts === "number" ? ts : Number(ts);
    const d = !isNaN(num) && num > 1000000000 ? new Date(num) : new Date(ts);
    return isNaN(d.getTime()) ? "" : ` [${d.toLocaleTimeString()}]`;
  } catch {
    return "";
  }
}

function safeMdTimeString(ts: any): string {
  if (!ts) return "";
  try {
    const num = typeof ts === "number" ? ts : Number(ts);
    const d = !isNaN(num) && num > 1000000000 ? new Date(num) : new Date(ts);
    return isNaN(d.getTime()) ? "" : ` *(${d.toLocaleTimeString()})*`;
  } catch {
    return "";
  }
}

app.post("/api/export-chat", async (req, res) => {
  try {
    const { format, title, messages } = req.body;
    const chatTitle = title || "NIVORA Conversation";
    const msgList = Array.isArray(messages) ? messages : [];

    if (format === "json") {
      const exportData = {
        title: chatTitle,
        exportedAt: new Date().toISOString(),
        totalMessages: msgList.length,
        messages: msgList.map((m: any) => ({
          role: m.role || (m.sender === "user" ? "user" : "assistant"),
          content: m.content || m.text || "",
          timestamp: safeIsoDate(m.timestamp),
        })),
      };
      res.setHeader("Content-Disposition", `attachment; filename="${chatTitle.replace(/[^a-z0-9_-]/gi, "_")}.json"`);
      res.setHeader("Content-Type", "application/json");
      res.send(JSON.stringify(exportData, null, 2));
      return;
    }

    if (format === "txt") {
      let content = `NIVORA AI CONVERSATION EXPORT\n`;
      content += `Title: ${chatTitle}\n`;
      content += `Exported: ${new Date().toLocaleString()}\n`;
      content += `=======================================================\n\n`;
      msgList.forEach((m: any) => {
        const role = m.role === "user" || m.sender === "user" ? "User" : "NIVORA";
        const time = safeTimeString(m.timestamp);
        content += `${role}${time}:\n${m.content || m.text || ""}\n\n-------------------------------------------------------\n\n`;
      });
      res.setHeader("Content-Disposition", `attachment; filename="${chatTitle.replace(/[^a-z0-9_-]/gi, "_")}.txt"`);
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.send(content);
      return;
    }

    if (format === "md") {
      let content = `# ${chatTitle}\n\n`;
      content += `*Exported from NIVORA AI on ${new Date().toLocaleString()}*\n\n---\n\n`;
      msgList.forEach((m: any) => {
        const isUser = m.role === "user" || m.sender === "user";
        const roleHeader = isUser ? `### 👤 User` : `### 🤖 NIVORA`;
        const timeStr = safeMdTimeString(m.timestamp);
        content += `${roleHeader}${timeStr}\n\n${m.content || m.text || ""}\n\n---\n\n`;
      });
      res.setHeader("Content-Disposition", `attachment; filename="${chatTitle.replace(/[^a-z0-9_-]/gi, "_")}.md"`);
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.send(content);
      return;
    }

    if (format === "pdf") {
      let content = `NIVORA Conversation: ${chatTitle}\nExported: ${new Date().toLocaleDateString()}\n\n`;
      msgList.forEach((m: any) => {
        const isUser = m.role === "user" || m.sender === "user";
        const sender = isUser ? "USER" : "NIVORA";
        const text = String(m.content || m.text || "").replace(/[\r\n]+/g, " ");
        content += `${sender}: ${text.slice(0, 180)}\n`;
      });

      const fileResult = await generateFile({
        format: "pdf",
        title: chatTitle,
        content: content,
        filename: `${chatTitle.replace(/[^a-z0-9_-]/gi, "_")}.pdf`,
      });

      res.setHeader("Content-Disposition", `attachment; filename="${fileResult.filename}"`);
      res.setHeader("Content-Type", fileResult.mimeType);
      res.send(fileResult.buffer);
      return;
    }

    res.status(400).json({ error: "Unsupported export format." });
  } catch (err) {
    console.error("Export chat error:", err);
    res.status(500).json({ error: "Failed to export chat." });
  }
});

// -------------------------------------------------------------
// SIGN OUT & GOOGLE AUTHENTICATION ENDPOINTS
// -------------------------------------------------------------

app.post("/auth/logout", (req, res) => {
  try {
    res.clearCookie("session");
    res.clearCookie("token");
    res.clearCookie("connect.sid");
    res.json({ success: true, message: "Logged out successfully." });
  } catch (err) {
    res.json({ success: true, message: "Logged out successfully." });
  }
});

app.get("/auth/google/config", (req, res) => {
  res.json({
    clientId: process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || "",
  });
});

app.get("/api/firebase-config", (req, res) => {
  try {
    const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return res.json({
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        projectId: config.projectId,
        storageBucket: config.storageBucket,
        messagingSenderId: config.messagingSenderId,
        appId: config.appId,
        firestoreDatabaseId: config.firestoreDatabaseId
      });
    }
  } catch (err) {
    console.warn("Error reading firebase-applet-config.json:", err);
  }
  res.status(500).json({ error: "Firebase config not found" });
});

app.get("/api/auth/firebase-status", async (req, res) => {
  try {
    const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
    if (!fs.existsSync(configPath)) {
      return res.status(500).json({ status: "ERROR", error: "firebase-applet-config.json not found" });
    }
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

    let emailPasswordEnabled = false;
    let providerError = "";
    try {
      const probeResp = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(config.apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "probe_check@example.com",
            password: "__check_provider__",
            returnSecureToken: false,
          }),
        }
      );
      const probeData: any = await probeResp.json();
      if (
        probeData?.error?.message === "PASSWORD_LOGIN_DISABLED" ||
        probeData?.error?.message === "OPERATION_NOT_ALLOWED"
      ) {
        emailPasswordEnabled = false;
        providerError = probeData.error.message;
      } else {
        emailPasswordEnabled = true;
      }
    } catch (probeErr: any) {
      providerError = probeErr?.message || String(probeErr);
    }

    const report = {
      projectId: config.projectId,
      authDomain: config.authDomain,
      emailPasswordEnabled,
      providerError: providerError || null,
      status: emailPasswordEnabled ? "READY" : "CONFIGURATION_REQUIRED",
      message: emailPasswordEnabled
        ? "Firebase Email/Password provider is active and ready."
        : `Email/Password provider is disabled in Firebase project '${config.projectId}'. Enable Email/Password in Firebase Console (Authentication > Sign-in method) so password reset emails can be delivered.`,
    };

    console.log(`[Firebase Status Diagnostic] Project: ${config.projectId} | Email/Password: ${emailPasswordEnabled ? "ENABLED" : "DISABLED (" + providerError + ")"}`);
    return res.json(report);
  } catch (err: any) {
    console.error("Firebase status check failed:", err);
    return res.status(500).json({ status: "ERROR", error: err?.message || String(err) });
  }
});

app.post("/auth/google", async (req, res) => {
  try {
    const { credential, email, name, picture } = req.body;
    let userEmail = "";
    let userName = "";
    let userPicture = "";
    let googleId = "";

    if (credential) {
      try {
        const verifyResp = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
        );
        if (verifyResp.ok) {
          const payload: any = await verifyResp.json();
          userEmail = payload.email || "";
          userName = payload.name || "";
          userPicture = payload.picture || "";
          googleId = payload.sub || "";
        }
      } catch (verr) {
        console.warn("Google token verification error:", verr);
      }
    }

    if (!userEmail && email) {
      userEmail = String(email).trim().toLowerCase();
      userName = name || userEmail.split("@")[0];
      userPicture = picture || "";
    }

    if (!userEmail) {
      res.status(400).json({ detail: "Valid Google email or credential is required." });
      return;
    }

    const cleanEmail = userEmail.toLowerCase();
    const db = loadDB();
    let user = db.users.find((u) => u.email.toLowerCase() === cleanEmail);

    if (!user) {
      const userId = "NIV-" + Math.floor(100000 + Math.random() * 900000);
      user = {
        id: userId,
        name: userName || cleanEmail.split("@")[0] || "NIVORA User",
        email: cleanEmail,
        passwordHash: "",
        profilePicture: userPicture || undefined,
        googleId,
        createdAt: Date.now(),
      };
      db.users.push(user);
    } else {
      if (userPicture && !user.profilePicture) {
        user.profilePicture = userPicture;
      }
      if (userName && (user.name === "NIVORA User" || !user.name)) {
        user.name = userName;
      }
      user.updatedAt = Date.now();
    }
    saveDB(db);

    res.json({
      message: "Google authentication successful.",
      user: {
        user_id: user.id,
        name: user.name,
        email: user.email,
        profile_picture: user.profilePicture || null,
      },
    });
  } catch (err) {
    console.error("Google login error:", err);
    res.status(500).json({ detail: "Google sign-in could not be completed." });
  }
});


// -------------------------------------------------------------
// AI CHAT ORCHESTRATION (Gemini, OpenAI, Claude/LLMsRelay)
// -------------------------------------------------------------

const SYSTEM_INSTRUCTION = `You are NIVORA, an advanced, highly intelligent AI assistant created by Sake Mukesh.

MANDATORY IDENTITY DIRECTIVES:
- Your user-facing name is NIVORA.
- When the user asks "What is your name?", you MUST respond:
  "My name is NIVORA. I'm your intelligent AI assistant."
- When the user asks "Who are you?", you MUST respond:
  "I'm NIVORA, your intelligent AI assistant. I can help with questions, coding, research, files, images, voice, projects, writing, study, and more."
- The initial greeting must also identify you as NIVORA.
- Never introduce or refer to yourself as Claude, Claude Sonnet, Claude Sonnet 4.6, claude-sonnet-4-6, Gemini, OpenAI, ChatGPT, Groq, OpenRouter, or LLMsRelay.
- Do NOT expose or mention the underlying AI provider or model name in normal user conversation.

Your capabilities include:
- Answering questions accurately across mathematics, science, engineering, philosophy, and history
- Deep analysis, creative ideation, and conversational empathy
- Real-time Web Research with factual, verified information and citation links
- High-level Software Engineering and Coding (HTML, CSS, JS, TS, Python, Node, SQL, C++, Java, React, FastAPI, etc.)
- Diagram generation, document structuring, and smart study guides
- Providing code in clean, syntax-highlighted markdown code blocks
- Generating documents in PDF, DOCX, XLSX, PPTX, CSV, TXT, Markdown, and ZIP formats

Always be helpful, articulate, precise, and polite. Never fabricate URLs or sources.
When answering with web search, provide clean, structured markdown and credit sources.`;

interface GroundingSource {
  title: string;
  url: string;
  snippet?: string;
  domain?: string;
}

interface WebImageResult {
  title: string;
  image: string;
  thumbnail?: string;
  url: string;
  source?: string;
}

function cleanSearchQuery(text: string): string {
  let q = (text || "").trim();
  q = q.replace(/^(can you|please|could you|tell me|explain|what is|whats|who is|who are|show me|give me information about|give me info about|give me details about|search for|look up|find me)\s+/i, "");
  q = q.replace(/[?!.]+$/, "").trim();
  return q;
}

function detectDirectTimeOrDateQuery(q: string): { wantsTime: boolean; wantsDate: boolean } | null {
  const norm = (q || "").trim().toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ");
  if (!norm) return null;

  const timeQueries = [
    "what time is it",
    "whats the time",
    "what is the time",
    "what is the time now",
    "what is current time",
    "current time",
    "tell me the time",
    "tell me time",
    "time now",
    "what time is it now",
    "what is local time",
    "whats local time"
  ];
  const dateQueries = [
    "what is the date",
    "whats the date",
    "what is the date today",
    "whats todays date",
    "what is todays date",
    "what date is it",
    "what date is it today",
    "current date",
    "today date",
    "todays date",
    "what day is today",
    "what day is it today",
    "what is today",
    "whats today",
    "which date is today",
    "what is today date"
  ];
  const bothQueries = [
    "what time and date is it",
    "what is the time and date",
    "date and time",
    "time and date",
    "current date and time",
    "current time and date"
  ];

  if (bothQueries.includes(norm)) {
    return { wantsTime: true, wantsDate: true };
  }
  if (timeQueries.includes(norm)) {
    return { wantsTime: true, wantsDate: false };
  }
  if (dateQueries.includes(norm)) {
    return { wantsTime: false, wantsDate: true };
  }
  return null;
}

function shouldSearchWeb(message: string, explicitlyEnabled?: boolean): boolean {
  if (explicitlyEnabled) return true;
  const text = (message || "").trim().toLowerCase();
  if (!text) return false;

  // Direct time and date queries never search the web
  if (detectDirectTimeOrDateQuery(text)) {
    return false;
  }

  // Explicit web search intent
  if (
    text.includes("search web") ||
    text.includes("search the web") ||
    text.includes("search internet") ||
    text.includes("google search") ||
    text.includes("browse the web") ||
    text.includes("check online") ||
    text.includes("look up online") ||
    text.includes("real time") ||
    text.includes("real-time")
  ) {
    return true;
  }

  // Real-world knowledge queries requiring live factual search
  const liveKeywords = [
    "latest news",
    "breaking news",
    "current weather",
    "weather forecast",
    "today's weather",
    "stock price",
    "crypto price",
    "bitcoin price",
    "live score",
    "match score",
    "election results",
    "what happened today",
    "current price of",
    "recent news",
    "latest updates",
    "founder of",
    "who founded",
    "ceo of",
    "who is the ceo",
    "who is the founder",
    "who owns",
    "headquarters of",
    "net worth of",
    "release date of",
  ];

  for (const kw of liveKeywords) {
    if (text.includes(kw)) return true;
  }

  // Casual questions, coding, explanations, calculations, translations, writing do NOT search the web
  return false;
}

function shouldSearchImages(message: string): boolean {
  const text = (message || "").trim().toLowerCase();
  if (!text) return false;

  // Artificial AI image generation prompts should not trigger web image scraping
  if (/^(generate|create|draw|make)\s+(an?\s+)?image/i.test(text)) {
    return false;
  }

  // Analyzing an uploaded image or screenshot should never search web images
  if (
    text.includes("this image") ||
    text.includes("this screenshot") ||
    text.includes("this photo") ||
    text.includes("this diagram") ||
    text.includes("in the image") ||
    text.includes("in this image") ||
    text.includes("uploaded image") ||
    text.includes("attached image") ||
    text.includes("read this image") ||
    text.includes("explain this image") ||
    text.includes("what is in this") ||
    text.includes("what is this image")
  ) {
    return false;
  }

  if (
    text.includes("show me") ||
    text.includes("picture") ||
    text.includes("photo") ||
    text.includes("image") ||
    text.includes("wallpaper") ||
    text.includes("diagram") ||
    text.includes("how it looks") ||
    text.includes("what it looks like") ||
    text.includes("logo of") ||
    text.includes("flag of")
  ) {
    return true;
  }

  const visualKeywords = [
    "taj mahal", "eiffel tower", "monument", "statue", "temple", "palace", "museum", "pyramid",
    "solar system", "planet", "mars", "jupiter", "saturn", "moon", "galaxy", "nebula", "black hole",
    "virat kohli", "messi", "ronaldo", "elon musk", "sundar pichai", "steve jobs",
    "iphone", "macbook", "laptop", "smartphone", "playstation", "car", "tesla",
    "organic farming", "farming", "wildlife", "tiger", "lion", "elephant",
    "rgmcet", "campus"
  ];

  return visualKeywords.some((k) => text.includes(k));
}

// Helper: Live Real-Time Web Search
async function searchWeb(query: string): Promise<GroundingSource[]> {
  const results: GroundingSource[] = [];
  const cleanQ = cleanSearchQuery(query) || query;
  const qWords = cleanQ
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["who", "what", "where", "when", "why", "how", "the", "and", "for", "with"].includes(w));

  // 1. DuckDuckGo HTML Search
  try {
    const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(cleanQ);
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    });
    if (resp.ok) {
      const html = await resp.text();
      const blocks = html.split("<div class=\"result results_links");
      for (let i = 1; i < Math.min(blocks.length, 10); i++) {
        const b = blocks[i];
        const urlMatch =
          b.match(/href="([^"]*uddg=[^"]+)"/) ||
          b.match(/class="result__snippet[^"]*"[^>]*href="([^"]+)"/) ||
          b.match(/<a[^>]*class="result__url"[^>]*href="([^"]+)"/);
        const titleMatch = b.match(/<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/);
        const snipMatch = b.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
        if (titleMatch && urlMatch) {
          let rawUrl = urlMatch[1];
          if (rawUrl.startsWith("//")) {
            rawUrl = "https:" + rawUrl;
          }
          if (rawUrl.includes("uddg=")) {
            try {
              const u = new URL(rawUrl.startsWith("http") ? rawUrl : "https://duckduckgo.com" + rawUrl);
              rawUrl = decodeURIComponent(u.searchParams.get("uddg") || rawUrl);
            } catch {}
          }
          if (rawUrl.includes("duckduckgo.com/y.js") || rawUrl.includes("bing.com/aclick")) continue;
          const title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
          const snippet = snipMatch ? snipMatch[1].replace(/<[^>]+>/g, "").trim() : "";
          if (title && rawUrl.startsWith("http")) {
            let domain = "";
            try {
              domain = new URL(rawUrl).hostname.replace(/^www\./, "");
            } catch {}
            results.push({ title, url: rawUrl, snippet, domain });
          }
        }
      }
    }
  } catch (err) {
    console.warn("[NIVORA Web Search] DuckDuckGo search error:", err);
  }

  // 2. Wikipedia Search API as verified supplementary/fallback
  const genericWikiTerms = new Set([
    "founder",
    "entrepreneur",
    "company",
    "software",
    "business",
    "chief executive officer",
    "corporation",
    "technology",
    "enterprise",
    "startup company",
    "board of directors",
    "investor",
    "organization",
  ]);

  try {
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQ)}&format=json&utf8=1&srlimit=4`;
    const wRes = await fetch(wikiUrl, {
      headers: { "User-Agent": "NivoraAssistant/1.0" },
    });
    if (wRes.ok) {
      const wData = await wRes.json();
      for (const item of wData.query?.search || []) {
        const title = (item.title || "").trim();
        const lowerTitle = title.toLowerCase();

        // If searching for a specific brand/company/person, skip generic concept dictionary articles
        if (qWords.length > 0 && genericWikiTerms.has(lowerTitle)) {
          continue;
        }

        const snippet = item.snippet?.replace(/<[^>]+>/g, "").trim();
        const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, "_"))}`;
        if (!results.some((r) => r.url === url)) {
          results.push({
            title: `${title} (Wikipedia)`,
            url,
            snippet,
            domain: "wikipedia.org",
          });
        }
      }
    }
  } catch (err) {
    console.warn("[NIVORA Web Search] Wikipedia search error:", err);
  }

  // 3. DuckDuckGo Instant Answer API for official facts/definitions
  if (results.length < 3) {
    try {
      const iaUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(cleanQ)}&format=json`;
      const iaRes = await fetch(iaUrl);
      if (iaRes.ok) {
        const ia = await iaRes.json();
        if (ia.AbstractText && ia.AbstractURL && !results.some((r) => r.url === ia.AbstractURL)) {
          results.unshift({
            title: ia.Heading || cleanQ,
            url: ia.AbstractURL,
            snippet: ia.AbstractText,
            domain: new URL(ia.AbstractURL).hostname.replace(/^www\./, ""),
          });
        }
      }
    } catch {}
  }

  // Deduplicate and rank by query match relevance & authoritative domains
  const seenUrls = new Set<string>();
  const uniqueResults: GroundingSource[] = [];

  for (const r of results) {
    if (!seenUrls.has(r.url)) {
      seenUrls.add(r.url);
      uniqueResults.push(r);
    }
  }

  uniqueResults.sort((a, b) => {
    // Score based on query keyword matches
    const scoreA = qWords.reduce(
      (acc, w) => acc + (a.title.toLowerCase().includes(w) ? 3 : 0) + ((a.snippet || "").toLowerCase().includes(w) ? 1 : 0),
      0
    );
    const scoreB = qWords.reduce(
      (acc, w) => acc + (b.title.toLowerCase().includes(w) ? 3 : 0) + ((b.snippet || "").toLowerCase().includes(w) ? 1 : 0),
      0
    );
    if (scoreB !== scoreA) return scoreB - scoreA;

    const isOfficialA = Boolean(a.domain?.match(/\.(edu|ac\.in|gov|org)$/i) || a.domain?.includes("rgmcet"));
    const isOfficialB = Boolean(b.domain?.match(/\.(edu|ac\.in|gov|org)$/i) || b.domain?.includes("rgmcet"));
    if (isOfficialA && !isOfficialB) return -1;
    if (!isOfficialA && isOfficialB) return 1;
    return 0;
  });

  return uniqueResults.slice(0, 6);
}

// Helper: Web Image Search
async function searchWebImages(query: string, maxImages = 6): Promise<WebImageResult[]> {
  const images: WebImageResult[] = [];
  const cleanQ = cleanSearchQuery(query) || query;

  try {
    const tokenRes = await fetch("https://duckduckgo.com/?q=" + encodeURIComponent(cleanQ), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    const html = await tokenRes.text();
    const vqdMatch = html.match(/vqd=([\d-]+)/) || html.match(/vqd=\"([\d-]+)\"/);
    if (vqdMatch) {
      const vqd = vqdMatch[1];
      const imgRes = await fetch(
        `https://duckduckgo.com/i.js?q=${encodeURIComponent(cleanQ)}&o=json&vqd=${vqd}`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
          },
        }
      );
      if (imgRes.ok) {
        const data = await imgRes.json();
        for (const r of (data.results || []).slice(0, maxImages)) {
          if (r.image && r.image.startsWith("http")) {
            images.push({
              title: r.title || cleanQ,
              image: r.image,
              thumbnail: r.thumbnail || r.image,
              url: r.url || r.image,
              source: r.source || (new URL(r.url || r.image).hostname.replace(/^www\./, "")),
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn("[NIVORA Image Search] DDG image search warning:", err);
  }

  // Fallback to Wikipedia images if needed
  if (images.length === 0) {
    try {
      const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(cleanQ)}&gsrlimit=4&prop=pageimages|extracts&piprop=original|thumbnail&pithumbsize=600`;
      const res = await fetch(wikiUrl, { headers: { "User-Agent": "NivoraAssistant/1.0" } });
      if (res.ok) {
        const json = await res.json();
        const pages = Object.values(json.query?.pages || {}) as any[];
        for (const p of pages) {
          const imgUrl = p.thumbnail?.source || p.original?.source;
          if (imgUrl) {
            images.push({
              title: p.title || cleanQ,
              image: imgUrl,
              thumbnail: imgUrl,
              url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title || "")}`,
              source: "wikipedia.org",
            });
            if (images.length >= maxImages) break;
          }
        }
      }
    } catch (err) {
      console.warn("[NIVORA Image Search] Wiki image fallback warning:", err);
    }
  }

  return images;
}

// -------------------------------------------------------------
// AI PROVIDER ROUTING & CIRCUIT BREAKER
// -------------------------------------------------------------
const providerCooldown = new Map<string, number>();

function markProviderExhausted(provider: string, durationMs = 1000 * 60 * 15) {
  providerCooldown.set(provider, Date.now() + durationMs);
}

function clearProviderCooldown(provider: string) {
  providerCooldown.delete(provider);
}

function normalizeProvider(name?: string): string {
  const s = String(name || "").trim().toLowerCase();
  if (s === "gemini" || s.includes("google")) return "gemini";
  if (s === "openai" || s.includes("gpt")) return "openai";
  if (s === "claude" || s.includes("anthropic") || s.includes("relay") || s.includes("llmsrelay")) return "claude";
  if (s === "groq") return "groq";
  if (s === "openrouter" || s.includes("router")) return "openrouter";
  return s;
}

function getOpenRouterConfig(): { apiKey: string; model: string } {
  let apiKey = (process.env.OPENROUTER_API_KEY || "").trim();
  let model = (process.env.OPENROUTER_MODEL || "").trim();

  // If user pasted API key into OPENROUTER_MODEL
  if (!apiKey && model.startsWith("sk-or-")) {
    apiKey = model;
    model = "";
  } else if (apiKey.includes("/") && model.startsWith("sk-or-")) {
    const temp = apiKey;
    apiKey = model;
    model = temp;
  }
  // Validate model name - if missing, holds an API key prefix, or invalid/deprecated model, use fast responsive free model
  if (!model || model.startsWith("sk-or-") || model.startsWith("sk-") || model.includes("nemotron") || model.includes("nex-agi")) {
    model = "google/gemini-2.0-flash-exp:free";
  }
  return { apiKey, model };
}

function isProviderConfigured(provider: string): boolean {
  const norm = normalizeProvider(provider);
  if (norm === "gemini") return Boolean(process.env.GEMINI_API_KEY);
  if (norm === "openai") return Boolean(process.env.OPENAI_API_KEY);
  if (norm === "claude") return Boolean(process.env.LLMSRELAY_API_KEY);
  if (norm === "groq") return Boolean(process.env.GROQ_API_KEY);
  if (norm === "openrouter") return Boolean(getOpenRouterConfig().apiKey);
  return false;
}

function isProviderHealthy(provider: string): boolean {
  const norm = normalizeProvider(provider);
  if (!isProviderConfigured(norm)) return false;
  const until = providerCooldown.get(norm);
  if (until && Date.now() < until) {
    return false;
  }
  return true;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, providerName: string): Promise<T> {
  let timeoutHandle: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const err: any = new Error(`${providerName} timed out after ${timeoutMs}ms`);
      err.status = 408;
      err.code = "TIMEOUT";
      err.provider = providerName;
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function extractDocumentText(filename: string, base64OrDataUrl: string): Promise<string> {
  try {
    const rawBase64 = base64OrDataUrl.includes(",") ? base64OrDataUrl.split(",")[1] : base64OrDataUrl;
    const buffer = Buffer.from(rawBase64, "base64");
    const lowerName = filename.toLowerCase();

    if (lowerName.endsWith(".docx")) {
      const zip = await JSZip.loadAsync(buffer);
      const docXml = await zip.file("word/document.xml")?.async("text");
      if (docXml) {
        return docXml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      }
    } else if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
      const wb = XLSX.read(buffer, { type: "buffer" });
      const sheetsText: string[] = [];
      for (const sheetName of wb.SheetNames) {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
        if (csv.trim()) sheetsText.push(`[Sheet: ${sheetName}]\n${csv.trim()}`);
      }
      return sheetsText.join("\n\n");
    } else if (lowerName.endsWith(".pptx")) {
      const zip = await JSZip.loadAsync(buffer);
      const slides: string[] = [];
      const slideFiles = Object.keys(zip.files).filter((f) => f.match(/^ppt\/slides\/slide\d+\.xml$/i)).sort();
      for (const sf of slideFiles) {
        const sXml = await zip.file(sf)?.async("text");
        if (sXml) {
          const text = sXml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          if (text) slides.push(`[Slide ${slides.length + 1}]: ${text}`);
        }
      }
      return slides.join("\n\n");
    }
  } catch (err) {
    console.warn("Document extraction error for", filename, err);
  }
  return "";
}

function detectFileRequest(prompt: string): { requested: boolean; format: GenerateFileParams["format"]; filename?: string; title?: string } {
  const p = prompt.toLowerCase();
  const isIntent = /\b(create|generate|make|build|export|produce|give me|write|prepare|provide)\b/i.test(p);
  if (!isIntent && !/\b(attendance sheet|spreadsheet|slide deck)\b/i.test(p)) {
    return { requested: false, format: "txt" };
  }

  if (/\b(pdf|document in pdf)\b/i.test(p)) return { requested: true, format: "pdf", filename: "NIVORA_Document.pdf", title: "NIVORA Document" };
  if (/\b(excel|spreadsheet|attendance sheet|xlsx|sheet)\b/i.test(p)) return { requested: true, format: "xlsx", filename: "NIVORA_Spreadsheet.xlsx", title: "NIVORA Spreadsheet" };
  if (/\b(word|docx|word doc|word document)\b/i.test(p)) return { requested: true, format: "docx", filename: "NIVORA_Document.docx", title: "NIVORA Document" };
  if (/\b(powerpoint|presentation|ppt|pptx|slide deck|slides)\b/i.test(p)) return { requested: true, format: "pptx", filename: "NIVORA_Presentation.pptx", title: "NIVORA Presentation" };
  if (/\b(zip|archive|compressed)\b/i.test(p)) return { requested: true, format: "zip", filename: "NIVORA_Archive.zip", title: "NIVORA Archive" };
  if (/\b(csv)\b/i.test(p)) return { requested: true, format: "csv", filename: "NIVORA_Data.csv", title: "NIVORA Data" };
  if (/\b(json|json file)\b/i.test(p)) return { requested: true, format: "json", filename: "NIVORA_Data.json", title: "NIVORA JSON" };
  if (/\b(markdown|md file)\b/i.test(p)) return { requested: true, format: "md", filename: "NIVORA_Notes.md", title: "NIVORA Notes" };
  if (/\b(html|webpage file|html file)\b/i.test(p)) return { requested: true, format: "html", filename: "NIVORA_Page.html", title: "NIVORA Page" };
  if (/\b(txt|text file)\b/i.test(p)) return { requested: true, format: "txt", filename: "NIVORA_Text.txt", title: "NIVORA Text" };

  return { requested: false, format: "txt" };
}

// Helper: Call Google Gemini
async function callGemini(
  prompt: string,
  history: Array<{ role: string; content: string }>,
  options: {
    imageBase64?: string;
    imageMime?: string;
    images?: Array<{ data: string; mimeType: string; name?: string }>;
    enableWebSearch?: boolean;
    enableNativeSearchGrounding?: boolean;
    systemPrompt?: string;
  }
): Promise<{ text: string; sources?: GroundingSource[] }> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const systemInstruction = options.systemPrompt || SYSTEM_INSTRUCTION;

  // Build contents
  const contents: any[] = [];

  // Add conversation history if available
  if (history && history.length > 0) {
    for (const h of history.slice(-8)) {
      contents.push({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: h.content }],
      });
    }
  }

  // Current turn parts
  const currentParts: any[] = [];

  // Collect all images from options.images or options.imageBase64
  const imageList: Array<{ data: string; mimeType: string }> = [];
  if (Array.isArray(options.images) && options.images.length > 0) {
    for (const img of options.images) {
      if (img && (img.data || (img as any).base64)) {
        imageList.push({
          data: img.data || (img as any).base64,
          mimeType: img.mimeType || (img as any).type || "image/png",
        });
      }
    }
  } else if (options.imageBase64) {
    imageList.push({
      data: options.imageBase64,
      mimeType: options.imageMime || "image/png",
    });
  }

  for (const img of imageList) {
    const rawData = img.data.includes(",")
      ? img.data.split(",")[1]
      : img.data;
    let mime = (img.mimeType || "image/png").toLowerCase().trim();
    if (mime === "image/jpg") mime = "image/jpeg";
    if (mime === "application/pdf" || mime.endsWith("/pdf")) {
      mime = "application/pdf";
    } else if (!mime.startsWith("image/")) {
      mime = "image/png";
    }

    currentParts.push({
      inlineData: {
        mimeType: mime,
        data: rawData,
      },
    });
  }

  currentParts.push({ text: prompt });

  contents.push({
    role: "user",
    parts: currentParts,
  });

  const config: any = {
    systemInstruction,
  };

  // Avoid attaching googleSearch tool to avoid HTTP 429 quota exhaustion;
  // NIVORA already performs live web grounding via its server-side search engine.
  if (options.enableNativeSearchGrounding) {
    config.tools = [{ googleSearch: {} }];
  }

  // Supported model priority hierarchy per @google/genai guidelines:
  // gemini-3.1-flash-lite provides ultra-fast latency & resilient availability
  // gemini-flash-latest and gemini-3.8-flash provide high-tier multimodal vision
  const candidateModels = [
    "gemini-3.1-flash-lite",
    "gemini-flash-latest",
    "gemini-3.8-flash",
    process.env.GEMINI_MODEL,
  ].filter(Boolean) as string[];

  // De-duplicate candidate models list
  const uniqueModels = Array.from(new Set(candidateModels));

  let response: any;
  let lastErr: any;

  for (const model of uniqueModels) {
    try {
      response = await ai.models.generateContent({
        model,
        contents,
        config,
      });
      if (response?.text) break;
    } catch (err: any) {
      lastErr = err;
      const status = err?.status || err?.code || "unknown";
      const safeMsg = String(err?.message || err || "");

      console.warn(`[NIVORA AI Notice] Gemini candidate ${model} error (${status}: ${safeMsg.slice(0, 100)}). Trying next candidate...`);

      // If googleSearch tool was attached, retry cleanly without tools
      if (config.tools) {
        delete config.tools;
        try {
          response = await ai.models.generateContent({
            model,
            contents,
            config,
          });
          if (response?.text) break;
        } catch (retryErr: any) {
          lastErr = retryErr;
        }
      }
    }
  }

  if (!response?.text) {
    markProviderExhausted("gemini", 1000 * 60 * 2);
    if (lastErr) throw lastErr;
    throw new Error("All Gemini models returned empty response.");
  }

  const text = response?.text || "I was unable to generate a response. Please try again.";

  // Extract grounding sources if any
  const sources: GroundingSource[] = [];
  const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (Array.isArray(chunks)) {
    for (const chunk of chunks) {
      if (chunk.web?.uri) {
        sources.push({
          title: chunk.web.title || new URL(chunk.web.uri).hostname,
          url: chunk.web.uri,
        });
      }
    }
  }

  clearProviderCooldown("gemini");
  return { text, sources: sources.length > 0 ? sources : undefined };
}

// Helper: Call OpenAI
async function callOpenAI(
  prompt: string,
  history: Array<{ role: string; content: string }>,
  options: { systemPrompt?: string }
): Promise<{ text: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured.");

  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const messages = [
    { role: "system", content: options.systemPrompt || SYSTEM_INSTRUCTION },
    ...(history || []).slice(-8).map((h) => ({
      role: h.role === "assistant" ? "assistant" : "user",
      content: h.content,
    })),
    { role: "user", content: prompt },
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    let safeMessage = errText;
    try {
      const parsed = JSON.parse(errText);
      safeMessage = parsed?.error?.message || errText;
    } catch {}

    if (
      res.status === 429 ||
      safeMessage.toLowerCase().includes("credits") ||
      safeMessage.toLowerCase().includes("quota")
    ) {
      markProviderExhausted("openai", 1000 * 60 * 15);
      console.log("[NIVORA AI Notice] OpenAI quota or credits reached. Routing traffic to available providers.");
    } else {
      console.warn(`[AI Provider Notice] OpenAI HTTP ${res.status}: ${safeMessage.slice(0, 120)}`);
    }

    const error: any = new Error(`OpenAI API error (${res.status}): ${safeMessage}`);
    error.status = res.status;
    error.provider = "openai";
    throw error;
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  clearProviderCooldown("openai");
  return { text };
}

// Helper: Call Claude through LLMsRelay
async function callClaudeRelay(
  prompt: string,
  history: Array<{ role: string; content: string }>,
  options: { systemPrompt?: string }
): Promise<{ text: string }> {
  const apiKey = process.env.LLMSRELAY_API_KEY;
  if (!apiKey) throw new Error("LLMSRELAY_API_KEY not configured.");

  const baseUrl = (process.env.LLMSRELAY_BASE_URL || "https://api.llmsrelay.com/v1").replace(/\/+$/, "");
  const model = process.env.LLMSRELAY_MODEL || "claude-sonnet-4.6";

  const messages = [
    { role: "system", content: options.systemPrompt || SYSTEM_INSTRUCTION },
    ...(history || []).slice(-8).map((h) => ({
      role: h.role === "assistant" ? "assistant" : "user",
      content: h.content,
    })),
    { role: "user", content: prompt },
  ];

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    let safeMessage = errText;
    try {
      const parsed = JSON.parse(errText);
      safeMessage = parsed?.error?.message || errText;
    } catch {}

    if (
      res.status === 429 ||
      res.status === 402 ||
      safeMessage.toLowerCase().includes("credits") ||
      safeMessage.toLowerCase().includes("quota")
    ) {
      markProviderExhausted("claude", 1000 * 60 * 15);
    }
    console.warn(`[AI Provider Notice] Claude/LLMsRelay HTTP ${res.status}: ${safeMessage.slice(0, 120)}`);
    const error: any = new Error(`Claude/LLMsRelay error (${res.status}): ${safeMessage}`);
    error.status = res.status;
    error.provider = "claude";
    throw error;
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  clearProviderCooldown("claude");
  return { text };
}

// Helper: Call Groq
async function callGroq(
  prompt: string,
  history: Array<{ role: string; content: string }>,
  options: { systemPrompt?: string }
): Promise<{ text: string }> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not configured.");

  const candidateModels = [
    process.env.GROQ_MODEL,
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "llama-3.3-70b-versatile",
    "qwen/qwen3.8-27b",
  ].filter(Boolean) as string[];

  const messages = [
    { role: "system", content: options.systemPrompt || SYSTEM_INSTRUCTION },
    ...(history || []).slice(-8).map((h) => ({
      role: h.role === "assistant" ? "assistant" : "user",
      content: h.content,
    })),
    { role: "user", content: prompt },
  ];

  let lastErr: any = null;
  for (const model of candidateModels) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        let safeMessage = errText;
        try {
          const parsed = JSON.parse(errText);
          safeMessage = parsed?.error?.message || errText;
        } catch {}

        if (res.status === 404 || safeMessage.toLowerCase().includes("model")) {
          console.warn(`[Groq Model Notice] Model '${model}' not available on Groq, trying next candidate.`);
          continue;
        }

        if (
          res.status === 429 ||
          safeMessage.toLowerCase().includes("rate limit") ||
          safeMessage.toLowerCase().includes("quota")
        ) {
          markProviderExhausted("groq", 1000 * 60 * 15);
        }
        console.warn(`[AI Provider Notice] Groq HTTP ${res.status}: ${safeMessage.slice(0, 120)}`);
        const error: any = new Error(`Groq API error (${res.status}): ${safeMessage}`);
        error.status = res.status;
        error.provider = "groq";
        throw error;
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || "";
      clearProviderCooldown("groq");
      return { text };
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error("Groq API call failed.");
}

// Helper: Call OpenRouter
async function callOpenRouter(
  prompt: string,
  history: Array<{ role: string; content: string }>,
  options: { systemPrompt?: string }
): Promise<{ text: string }> {
  const { apiKey, model: primaryModel } = getOpenRouterConfig();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured.");

  const candidateModels = [
    primaryModel,
    "google/gemini-2.0-flash-exp:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "mistralai/mistral-7b-instruct:free",
    "qwen/qwen-2.5-72b-instruct:free",
  ].filter(Boolean);

  const messages = [
    { role: "system", content: options.systemPrompt || SYSTEM_INSTRUCTION },
    ...(history || []).slice(-8).map((h) => ({
      role: h.role === "assistant" ? "assistant" : "user",
      content: h.content,
    })),
    { role: "user", content: prompt },
  ];

  let lastErr: any = null;
  for (const model of candidateModels) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "https://nivora.ai",
          "X-Title": "NIVORA AI",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        let safeMessage = errText;
        try {
          const parsed = JSON.parse(errText);
          safeMessage = parsed?.error?.message || errText;
        } catch {}

        if (res.status === 400 || res.status === 404 || safeMessage.toLowerCase().includes("model")) {
          console.warn(`[OpenRouter Notice] Model '${model}' error (${res.status}): ${safeMessage.slice(0, 100)}, trying fallback model.`);
          continue;
        }

        if (
          res.status === 429 ||
          res.status === 402 ||
          safeMessage.toLowerCase().includes("credits") ||
          safeMessage.toLowerCase().includes("quota")
        ) {
          markProviderExhausted("openrouter", 1000 * 60 * 15);
        }
        console.warn(`[AI Provider Notice] OpenRouter HTTP ${res.status}: ${safeMessage.slice(0, 120)}`);
        const error: any = new Error(`OpenRouter API error (${res.status}): ${safeMessage}`);
        error.status = res.status;
        error.provider = "openrouter";
        throw error;
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || "";
      clearProviderCooldown("openrouter");
      return { text };
    } catch (err: any) {
      if (err?.name === "AbortError") {
        console.warn(`[OpenRouter Notice] Model '${model}' timed out after 8s, trying next candidate.`);
      }
      lastErr = err;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastErr || new Error("OpenRouter API call failed.");
}

// Primary chat endpoint supporting both legacy /chat and modern /api/chat
async function handleChatRequest(req: express.Request, res: express.Response) {
  try {
    const message = req.body.message || "";
    const history = Array.isArray(req.body.history) ? req.body.history : [];
    const imageBase64 = req.body.image || req.body.imageBase64;
    const imageMime = req.body.imageMime || "image/png";
    const rawImages = req.body.images;
    const file = req.body.file;
    const webSearch = Boolean(req.body.webSearch);
    const userId = req.body.userId || "anonymous";
    const clientTime: string = (req.body.clientTime || "").trim();
    const clientDate: string = (req.body.clientDate || "").trim();
    const clientTimezone: string = (req.body.clientTimezone || "").trim();

    // Collect all attached visual inputs (images and PDFs)
    const imagesList: Array<{ data: string; mimeType: string; name?: string }> = [];
    if (Array.isArray(rawImages) && rawImages.length > 0) {
      for (const img of rawImages) {
        if (img && (img.data || img.base64)) {
          let mime = img.mimeType || img.type || "image/png";
          if (img.name?.toLowerCase().endsWith(".pdf") || mime.includes("pdf")) {
            mime = "application/pdf";
          }
          imagesList.push({
            data: img.data || img.base64,
            mimeType: mime,
            name: img.name || "image",
          });
        }
      }
    } else if (imageBase64) {
      let mime = imageMime || "image/png";
      imagesList.push({
        data: imageBase64,
        mimeType: mime,
        name: "uploaded-image",
      });
    }

    // Also check if req.body.file or req.body.files contains PDF or image data
    const incomingFiles: any[] = [];
    if (file && file.content) incomingFiles.push(file);
    if (Array.isArray(req.body.files)) {
      for (const f of req.body.files) {
        if (f && f.content) incomingFiles.push(f);
      }
    }

    for (const f of incomingFiles) {
      const fName = (f.name || "").toLowerCase();
      const fType = (f.type || "").toLowerCase();
      if (fType.startsWith("image/") || fName.match(/\.(png|jpe?g|webp|gif|bmp|svg)$/)) {
        let m = fType.startsWith("image/") ? fType : "image/png";
        if (m === "image/jpg") m = "image/jpeg";
        imagesList.push({
          data: f.content,
          mimeType: m,
          name: f.name || "image",
        });
      } else if (fType.includes("pdf") || fName.endsWith(".pdf")) {
        imagesList.push({
          data: f.content,
          mimeType: "application/pdf",
          name: f.name || "document.pdf",
        });
      }
    }

    const hasImages = imagesList.length > 0;

    if (!message && !hasImages && !file && (!req.body.files || req.body.files.length === 0)) {
      res.status(400).json({ error: "Empty message provided." });
      return;
    }

    // Direct match for identity queries (only if no images are attached)
    const normalizedPrompt = message.trim().toLowerCase().replace(/[^\w\s]/g, "");
    if (!hasImages) {
      if (
        normalizedPrompt === "what is your name" ||
        normalizedPrompt === "whats your name" ||
        normalizedPrompt === "what is ur name" ||
        normalizedPrompt === "tell me your name" ||
        normalizedPrompt === "what are you called"
      ) {
        return res.json({
          reply: "My name is NIVORA. I'm your intelligent AI assistant.",
          provider: "NIVORA AI",
        });
      } else if (
        normalizedPrompt === "who are you" ||
        normalizedPrompt === "who r u" ||
        normalizedPrompt === "introduce yourself"
      ) {
        return res.json({
          reply: "I'm NIVORA, your intelligent AI assistant. I can help with questions, coding, research, files, images, voice, projects, writing, study, and more.",
          provider: "NIVORA AI",
        });
      } else if (
        normalizedPrompt === "who created you" ||
        normalizedPrompt === "who made you" ||
        normalizedPrompt === "who developed you" ||
        normalizedPrompt === "who is your developer" ||
        normalizedPrompt === "who are your creators"
      ) {
        return res.json({
          reply: "I am NIVORA, an intelligent AI assistant developed by Sake Mukesh.",
          provider: "NIVORA AI",
        });
      }

      // Direct check for local time or date question (only if no images are attached)
      const timeQueryMatch = detectDirectTimeOrDateQuery(message);
      if (timeQueryMatch) {
        const nowD = new Date();
        const resolvedTime = clientTime || new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: true }).format(nowD);
        const resolvedDate = clientDate || new Intl.DateTimeFormat(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(nowD);
        const tzNote = clientTimezone ? ` (${clientTimezone})` : "";

        if (timeQueryMatch.wantsTime && timeQueryMatch.wantsDate) {
          return res.json({
            reply: `The current time is **${resolvedTime}** and today's date is **${resolvedDate}**${tzNote}.`,
            provider: "NIVORA AI",
          });
        } else if (timeQueryMatch.wantsTime) {
          return res.json({
            reply: `The current time is **${resolvedTime}**${tzNote}.`,
            provider: "NIVORA AI",
          });
        } else if (timeQueryMatch.wantsDate) {
          return res.json({
            reply: `Today's date is **${resolvedDate}**${tzNote}.`,
            provider: "NIVORA AI",
          });
        }
      }
    }

    // Build context with files, current time, and memory
    let effectivePrompt = message || (hasImages ? "Please carefully read, analyze, and describe all content in the attached image(s)." : "Please review and analyze the attached item.");

    // Inject multimodal vision instructions when images are attached
    if (hasImages) {
      const visionPromptGuidance = `[VISUAL MULTIMODAL CONTEXT: ${imagesList.length} image(s) attached]:
You are analyzing the visual content, graphics, and text visible in the attached image(s) using Gemini native multimodal vision.
- Thoroughly inspect all visual elements, diagrams, UI components, charts, and visible text in the image(s).
- Read and transcribe any text, questions, code, mathematical equations, data tables, labels, or error messages visible in the image(s).
- If the image contains interview questions, test questions, exercises, or exam problems:
  * Extract and list each question accurately from the image.
  * Provide complete, comprehensive, and well-reasoned answers and solutions for each question.
- If the user asks "What is in this image?" or a general question, describe the visual elements, context, and visible content thoroughly.
- If the user asks a question about text visible in the image, answer using the exact visual content.
- Do NOT treat the image filename, URL, metadata, or alt text as the image content. Rely strictly on the actual visual pixels.
- If any part of the image is blurry, cropped, low-resolution, or unreadable, clearly tell the user which specific part cannot be read instead of guessing or hallucinating.`;

      effectivePrompt = `${visionPromptGuidance}\n\nUser Question/Prompt: ${effectivePrompt}`;
    }

    // Inject accurate current local time & date into the context for any temporal prompt
    const nowD = new Date();
    const resolvedTime = clientTime || new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: true }).format(nowD);
    const resolvedDate = clientDate || new Intl.DateTimeFormat(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(nowD);
    const tzNote = clientTimezone ? ` (${clientTimezone})` : "";
    effectivePrompt = `[CURRENT LOCAL TIME & DATE]: Local Time: ${resolvedTime}${tzNote}, Local Date: ${resolvedDate}\n(User device accurate local time and date. Answer any time/date inquiries using this information. Never state you lack real-time clock access.)\n\n${effectivePrompt}`;
    if (file && file.name && file.content) {
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith(".docx") || lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls") || lowerName.endsWith(".pptx")) {
        const extracted = await extractDocumentText(file.name, file.content);
        if (extracted) {
          effectivePrompt = `[Uploaded Document: ${file.name}]\n${extracted}\n\nUser Question: ${effectivePrompt}`;
        } else {
          effectivePrompt = `[Uploaded File: ${file.name}]\n${file.content}\n\nUser Question: ${effectivePrompt}`;
        }
      } else {
        effectivePrompt = `[Uploaded File: ${file.name}]\n${file.content}\n\nUser Question: ${effectivePrompt}`;
      }
    }

    // Include user memories if enabled
    const db = loadDB();
    const isMemEnabled = db.memoryEnabled[userId] !== false;
    if (isMemEnabled) {
      const userMems = db.memories.filter((m) => m.userId === userId);
      if (userMems.length > 0) {
        const memContext = userMems.map((m) => `- ${m.content}`).join("\n");
        effectivePrompt = `[User Context/Memory]:\n${memContext}\n\n${effectivePrompt}`;
      }
    }

    const hasVisualInputs = hasImages;
    const webSearchExplicit = Boolean(req.body.webSearch);
    const doWebSearch = webSearchExplicit || (!hasVisualInputs && shouldSearchWeb(message, false));
    const doImageSearch = !hasVisualInputs && shouldSearchImages(message);

    let sources: GroundingSource[] | undefined;
    let images: WebImageResult[] | undefined;

    if (doWebSearch) {
      try {
        const cleanQ = cleanSearchQuery(message) || message;
        const [liveSources, liveImages] = await Promise.all([
          searchWeb(cleanQ),
          doImageSearch ? searchWebImages(cleanQ, 6) : Promise.resolve([]),
        ]);
        if (liveSources && liveSources.length > 0) {
          sources = liveSources;
          const searchContext = liveSources
            .map((s, idx) => `[Source ${idx + 1} - ${s.domain || "Web"}]: "${s.title}" (${s.url})\nSummary: ${s.snippet || "N/A"}`)
            .join("\n\n");
          effectivePrompt = `[VERIFIED LIVE WEB SEARCH RESULTS]:\n${searchContext}\n\n[USER QUESTION]: ${effectivePrompt}\n\n[INSTRUCTIONS FOR NIVORA]:
- You are NIVORA, an intelligent, web-connected AI assistant created by Sake Mukesh.
- Answer the user's actual question directly and authoritatively based on the verified search findings.
- When asked who the founder, CEO, or leadership of an entity is (e.g. ReshApp Software Solutions), state their name clearly and synthesize their background from the verified findings (e.g. Deva Nagendra Madineni).
- NEVER say "none of the search results you supplied contain information" or "based on the provided results" — the user did not supply the search results; you are an AI assistant with live search capabilities.
- Format your response cleanly using markdown headings and bullet points.
- NEVER fabricate sources or URLs.`;
        }
        if (liveImages && liveImages.length > 0) {
          images = liveImages;
        }
      } catch (searchErr) {
        console.warn("[NIVORA Web Search] Search failed:", searchErr);
      }
    } else if (doImageSearch) {
      try {
        const cleanQ = cleanSearchQuery(message) || message;
        const liveImages = await searchWebImages(cleanQ, 6);
        if (liveImages && liveImages.length > 0) {
          images = liveImages;
        }
      } catch (imgErr) {
        console.warn("[NIVORA Image Search] Image search failed:", imgErr);
      }
    }

    // Priority list: Gemini, Groq, OpenAI, Claude, OpenRouter
    const priorityList = ["gemini", "groq", "openai", "claude", "openrouter"];
    const configuredList: string[] = [];
    if (process.env.GEMINI_API_KEY) configuredList.push("gemini");
    if (process.env.GROQ_API_KEY) configuredList.push("groq");
    if (process.env.OPENAI_API_KEY) configuredList.push("openai");
    if (process.env.LLMSRELAY_API_KEY) configuredList.push("claude");
    if (getOpenRouterConfig().apiKey) configuredList.push("openrouter");

    const envPrimary = normalizeProvider(process.env.NIVORA_PRIMARY_PROVIDER || (configuredList[0] || "gemini"));
    const userChoice = normalizeProvider(req.body.provider || "");
    const primaryChoice = (userChoice && configuredList.includes(userChoice)) ? userChoice : envPrimary;

    const providersToTry: string[] = [];

    // 1. Add primary provider ONLY IF it is healthy
    if (configuredList.includes(primaryChoice) && isProviderHealthy(primaryChoice)) {
      providersToTry.push(primaryChoice);
    }

    // 2. Add other healthy configured providers in priority order
    for (const p of priorityList) {
      if (configuredList.includes(p) && !providersToTry.includes(p) && isProviderHealthy(p)) {
        providersToTry.push(p);
      }
    }

    // 3. If vision / image is attached, prioritize Gemini for native multimodal image understanding
    if (hasImages) {
      providerCooldown.delete("gemini");
      if (providersToTry.includes("gemini")) {
        const idx = providersToTry.indexOf("gemini");
        providersToTry.splice(idx, 1);
        providersToTry.unshift("gemini");
      } else {
        providersToTry.unshift("gemini");
      }
    }

    // 4. ONLY if ALL providers are in cooldown, add them as last resort
    if (providersToTry.length === 0) {
      for (const p of priorityList) {
        if (configuredList.includes(p) && !providersToTry.includes(p)) {
          providersToTry.push(p);
        }
      }
    }

    let replyText = "";
    let success = false;
    let lastError: any = null;

    for (const provider of providersToTry) {
      try {
        if (provider === "gemini" && process.env.GEMINI_API_KEY) {
          const timeoutMs = hasImages ? 40000 : 8000;
          const result = await withTimeout(
            callGemini(effectivePrompt, history, {
              imageBase64: imagesList[0]?.data,
              imageMime: imagesList[0]?.mimeType,
              images: imagesList,
              enableWebSearch: doWebSearch,
            }),
            timeoutMs,
            "gemini"
          );
          replyText = result.text;
          if (result.sources && result.sources.length > 0) {
            const existingUrls = new Set((sources || []).map((s) => s.url));
            const newSources = (sources || []).slice();
            for (const s of result.sources) {
              if (!existingUrls.has(s.url)) {
                newSources.push(s);
                existingUrls.add(s.url);
              }
            }
            sources = newSources;
          }
          success = true;
          break;
        } else if (provider === "groq" && process.env.GROQ_API_KEY) {
          const result = await withTimeout(callGroq(effectivePrompt, history, {}), 8000, "groq");
          replyText = result.text;
          success = true;
          break;
        } else if (provider === "openai" && process.env.OPENAI_API_KEY) {
          const result = await withTimeout(callOpenAI(effectivePrompt, history, {}), 8000, "openai");
          replyText = result.text;
          success = true;
          break;
        } else if (provider === "claude" && process.env.LLMSRELAY_API_KEY) {
          const result = await withTimeout(callClaudeRelay(effectivePrompt, history, {}), 8000, "claude");
          replyText = result.text;
          success = true;
          break;
        } else if (provider === "openrouter" && getOpenRouterConfig().apiKey) {
          const result = await withTimeout(callOpenRouter(effectivePrompt, history, {}), 8000, "openrouter");
          replyText = result.text;
          success = true;
          break;
        }
      } catch (err: any) {
        lastError = err;
        const status = err?.status || err?.code || "error";
        const safeMsg = String(err?.message || err || "").toLowerCase();

        if (status === 429 || safeMsg.includes("quota") || safeMsg.includes("rate limit")) {
          markProviderExhausted(provider, 1000 * 60 * 15);
          console.warn(`[NIVORA AI Fallback] Provider '${provider}' (429), routing to next configured provider...`);
        } else if (status === 503 || status === 504 || safeMsg.includes("demand") || safeMsg.includes("unavailable")) {
          markProviderExhausted(provider, 1000 * 60 * 2);
          console.warn(`[NIVORA AI Fallback] Provider '${provider}' (503), routing to next configured provider...`);
        } else if (status === 401 || status === 402 || status === 403 || safeMsg.includes("credit") || safeMsg.includes("payment")) {
          markProviderExhausted(provider, 1000 * 60 * 60);
          console.warn(`[NIVORA AI Fallback] Provider '${provider}' (${status}), routing to next configured provider...`);
        } else {
          markProviderExhausted(provider, 1000 * 30);
          console.warn(`[NIVORA AI Fallback] Provider '${provider}' (${status}), routing to next configured provider...`);
        }
      }
    }

    if (!success) {
      console.warn("[NIVORA AI] All configured providers failed. Last status:", lastError?.message || lastError);
      return res.status(503).json({
        success: false,
        code: "ALL_AI_PROVIDERS_UNAVAILABLE",
        error: "NIVORA AI is temporarily unavailable. Please try again.",
        reply: "NIVORA AI is temporarily unavailable. Please try again.",
      });
    }

    // Sanitize any underlying model self-introduction leaks
    replyText = replyText
      .replace(/\b(I am|I'm|I am an AI assistant developed by Anthropic named) (Claude( Sonnet( 4\.6)?)?|Gemini|ChatGPT|GPT-4|GPT-5|Llama|Groq|OpenRouter)\b/gi, "$1 NIVORA")
      .replace(/\b(created|trained|developed) by (Anthropic|OpenAI|Google|Meta|OpenRouter)\b/gi, "$1 by Sake Mukesh")
      .replace(/\bclaude-sonnet-4-6\b/gi, "NIVORA")
      .replace(/\bLLMsRelay\b/gi, "NIVORA")
      .replace(/\bAnthropic\b/g, "NIVORA");

    // Detect if the answer includes an artifact (HTML, React, SVG, interactive app)
    let artifact: { type: string; title: string; code: string } | undefined;
    const htmlBlockRegex = /```(html|xml|svg)\s*\n([\s\S]*?)```/i;
    const match = replyText.match(htmlBlockRegex);
    if (match && (match[2].includes("<!DOCTYPE") || match[2].includes("<html") || match[2].includes("<svg") || match[2].includes("<div"))) {
      artifact = {
        type: match[1].toLowerCase(),
        title: "Generated Artifact",
        code: match[2].trim(),
      };
    }

    // Check if user requested a generated file
    let generatedFile: { name: string; type: string; size: string; data: string } | undefined;
    const fileReq = detectFileRequest(message);
    if (fileReq.requested) {
      try {
        const fileResult = await generateFile({
          format: fileReq.format,
          title: fileReq.title || "NIVORA Document",
          content: replyText,
          filename: fileReq.filename,
        });
        const mime = fileResult.mimeType.split(";")[0];
        const b64 = fileResult.buffer.toString("base64");
        generatedFile = {
          name: fileResult.filename,
          type: fileReq.format.toUpperCase(),
          size: `${(fileResult.buffer.length / 1024).toFixed(1)} KB`,
          data: `data:${mime};base64,${b64}`,
        };
      } catch (fErr) {
        console.warn("[NIVORA File Generation] Error:", fErr);
      }
    }

    // Sanitize replyText to prevent raw base64, raw data URIs, or stray HTML tags from being displayed
    replyText = replyText
      .replace(/<a\s+[^>]*href=["']data:[^"']+["'][^>]*>[\s\S]*?<\/a>/gi, "")
      .replace(/\[([^\]]*)\]\(data:[^)]+\)/gi, "$1")
      .replace(/data:(application|text|image)\/[^;]+;base64,[A-Za-z0-9+/=]{30,}/gi, "")
      .replace(/<\/?(iframe|embed|object|script|style)[^>]*>/gi, "")
      .trim();

    if (fileReq.requested && (!replyText || replyText.length < 5)) {
      replyText = `Done — I generated the ${fileReq.format.toUpperCase()} file (${fileReq.filename || "document"}). You can preview or download it below.`;
    }

    const isStream = Boolean(req.body.stream || req.headers.accept?.includes("text/event-stream"));
    if (isStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      res.write(`data: ${JSON.stringify({ type: "delta", text: replyText })}\n\n`);
      res.write(
        `data: ${JSON.stringify({
          type: "done",
          reply: replyText,
          provider: "NIVORA AI",
          sources,
          images,
          artifact,
          generatedFile,
        })}\n\n`
      );
      return res.end();
    }

    res.json({
      reply: replyText,
      provider: "NIVORA AI",
      sources,
      images,
      artifact,
      generatedFile,
    });
  } catch (err: any) {
    console.error("Chat handler error:", err);
    res.status(500).json({
      reply: "Something went wrong while processing your request. Please try again.",
      error: "Internal server error",
    });
  }
}

app.post("/chat", handleChatRequest);
app.post("/api/chat", handleChatRequest);

// Safe provider info endpoint (never exposes secret keys)
app.get("/api/provider-info", (req, res) => {
  const primary = normalizeProvider(process.env.NIVORA_PRIMARY_PROVIDER || "gemini");
  res.json({
    primaryProvider: primary,
    providers: [
      {
        id: "gemini",
        name: "Google Gemini",
        model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
        configured: Boolean(process.env.GEMINI_API_KEY),
      },
      {
        id: "openai",
        name: "OpenAI",
        model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
        configured: Boolean(process.env.OPENAI_API_KEY),
      },
      {
        id: "claude",
        name: "Claude (LLMsRelay)",
        model: process.env.LLMSRELAY_MODEL || "claude-sonnet-4.6",
        configured: Boolean(process.env.LLMSRELAY_API_KEY),
      },
      {
        id: "groq",
        name: "Groq",
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        configured: Boolean(process.env.GROQ_API_KEY),
      },
      {
        id: "openrouter",
        name: "OpenRouter",
        model: getOpenRouterConfig().model,
        configured: Boolean(getOpenRouterConfig().apiKey),
      },
    ],
  });
});

// -------------------------------------------------------------
// IMAGE GENERATION ENDPOINT
// -------------------------------------------------------------

app.post("/api/generate-image", async (req, res) => {
  try {
    const { prompt, aspectRatio } = req.body;
    if (!prompt) {
      res.status(400).json({ error: "Prompt is required." });
      return;
    }

    let imageUrl = "";

    const ai = getGeminiClient();
    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.1-flash-lite-image",
          contents: {
            parts: [{ text: String(prompt) }],
          },
          config: {
            imageConfig: {
              aspectRatio: aspectRatio || "1:1",
            },
          },
        });

        if (response.candidates?.[0]?.content?.parts) {
          for (const part of response.candidates[0].content.parts) {
            if (part.inlineData && part.inlineData.data) {
              const mime = part.inlineData.mimeType || "image/png";
              imageUrl = `data:${mime};base64,${part.inlineData.data}`;
              break;
            }
          }
        }
      } catch (geminiImgErr: any) {
        console.warn("[Image Engine] Gemini image quota unavailable, falling back to high-resolution AI engine...");
      }
    }

    if (!imageUrl) {
      let width = 1024;
      let height = 1024;
      if (aspectRatio === "16:9") {
        width = 1280;
        height = 720;
      } else if (aspectRatio === "9:16") {
        width = 720;
        height = 1280;
      } else if (aspectRatio === "4:3") {
        width = 1024;
        height = 768;
      } else if (aspectRatio === "3:4") {
        width = 768;
        height = 1024;
      }

      const seed = Math.floor(Math.random() * 1000000);
      const pollUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true`;
      try {
        const fetchResp = await fetch(pollUrl);
        if (fetchResp.ok) {
          const arrayBuf = await fetchResp.arrayBuffer();
          const base64 = Buffer.from(arrayBuf).toString("base64");
          const mime = fetchResp.headers.get("content-type") || "image/jpeg";
          imageUrl = `data:${mime};base64,${base64}`;
        } else {
          imageUrl = pollUrl;
        }
      } catch {
        imageUrl = pollUrl;
      }
    }

    if (!imageUrl) {
      throw new Error("No image data returned from model.");
    }

    res.json({ imageUrl, prompt });
  } catch (err: any) {
    console.warn("Image generation notice:", err?.message || err);
    res.status(500).json({
      error: "Image generation failed. Please try a different prompt or verify your API key.",
    });
  }
});

// -------------------------------------------------------------
// MEMORY SYSTEM ENDPOINTS
// -------------------------------------------------------------

app.get("/api/memory", (req, res) => {
  const userId = String(req.query.userId || "anonymous");
  const db = loadDB();
  const list = db.memories.filter((m) => m.userId === userId);
  const enabled = db.memoryEnabled[userId] !== false;
  res.json({ memories: list, enabled });
});

app.post("/api/memory", (req, res) => {
  const { userId, content, category, enabled } = req.body;
  const uid = userId || "anonymous";
  const db = loadDB();

  if (typeof enabled === "boolean") {
    db.memoryEnabled[uid] = enabled;
  }

  if (content) {
    const newMem: MemoryItem = {
      id: "mem_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
      userId: uid,
      category: category || "preference",
      content: String(content).trim(),
      createdAt: Date.now(),
    };
    db.memories.push(newMem);
  }

  saveDB(db);
  res.json({ success: true, memories: db.memories.filter((m) => m.userId === uid), enabled: db.memoryEnabled[uid] !== false });
});

app.delete("/api/memory/:id", (req, res) => {
  const { id } = req.params;
  const db = loadDB();
  db.memories = db.memories.filter((m) => m.id !== id);
  saveDB(db);
  res.json({ success: true });
});

app.post("/api/memory/clear", (req, res) => {
  const { userId } = req.body;
  const uid = userId || "anonymous";
  const db = loadDB();
  db.memories = db.memories.filter((m) => m.userId !== uid);
  saveDB(db);
  res.json({ success: true, message: "Memory cleared successfully." });
});

// -------------------------------------------------------------
// PROJECTS SYSTEM ENDPOINTS
// -------------------------------------------------------------

app.get("/api/projects", (req, res) => {
  const userId = String(req.query.userId || "anonymous");
  const db = loadDB();
  const list = db.projects.filter((p) => p.userId === userId);
  res.json({ projects: list });
});

app.post("/api/projects", (req, res) => {
  const { id, userId, name, description, instructions, chatIds } = req.body;
  const uid = userId || "anonymous";
  const db = loadDB();

  if (id) {
    const existing = db.projects.find((p) => p.id === id);
    if (existing) {
      if (name) existing.name = name;
      if (description !== undefined) existing.description = description;
      if (instructions !== undefined) existing.instructions = instructions;
      if (chatIds) existing.chatIds = chatIds;
      existing.updatedAt = Date.now();
      saveDB(db);
      res.json({ project: existing });
      return;
    }
  }

  const newProject: ProjectItem = {
    id: "proj_" + Date.now(),
    userId: uid,
    name: name || "New Project",
    description: description || "",
    instructions: instructions || "",
    chatIds: Array.isArray(chatIds) ? chatIds : [],
    files: [],
    updatedAt: Date.now(),
  };
  db.projects.unshift(newProject);
  saveDB(db);
  res.json({ project: newProject });
});

app.delete("/api/projects/:id", (req, res) => {
  const { id } = req.params;
  const db = loadDB();
  db.projects = db.projects.filter((p) => p.id !== id);
  saveDB(db);
  res.json({ success: true });
});

app.patch("/api/projects/:id", (req, res) => {
  const { id } = req.params;
  const { name, description, instructions } = req.body;
  const db = loadDB();
  const proj = db.projects.find((p) => p.id === id);
  if (!proj) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  if (name !== undefined && name.trim()) proj.name = name.trim();
  if (description !== undefined) proj.description = description.trim();
  if (instructions !== undefined) proj.instructions = instructions;
  proj.updatedAt = Date.now();
  saveDB(db);
  res.json({ success: true, project: proj });
});

app.get("/api/projects/:id", (req, res) => {
  const { id } = req.params;
  const db = loadDB();
  const proj = db.projects.find((p) => p.id === id);
  if (!proj) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  res.json({ project: proj });
});

app.post("/api/projects/:id/files", (req, res) => {
  const { id } = req.params;
  const { name, size, type, data } = req.body;
  if (!name) {
    res.status(400).json({ error: "File name is required." });
    return;
  }
  const db = loadDB();
  const proj = db.projects.find((p) => p.id === id);
  if (!proj) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  if (!proj.files) proj.files = [];
  proj.files.push({
    name,
    size: size || 0,
    type: type || "application/octet-stream",
    data: data ? String(data).slice(0, 50000) : undefined,
  });
  proj.updatedAt = Date.now();
  saveDB(db);
  res.json({ success: true, project: proj });
});

app.post("/api/projects/:id/conversations", (req, res) => {
  const { id } = req.params;
  const { chatId } = req.body;
  if (!chatId) {
    res.status(400).json({ error: "Chat ID is required." });
    return;
  }
  const db = loadDB();
  const proj = db.projects.find((p) => p.id === id);
  if (!proj) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  if (!proj.chatIds) proj.chatIds = [];
  if (!proj.chatIds.includes(chatId)) {
    proj.chatIds.push(chatId);
  }
  proj.updatedAt = Date.now();
  saveDB(db);
  res.json({ success: true, project: proj });
});

// -------------------------------------------------------------
// CHATS PERSISTENCE ENDPOINTS
// -------------------------------------------------------------

app.get("/api/chats", (req, res) => {
  const userId = String(req.query.userId || "anonymous");
  const db = loadDB();
  if (!db.chats) db.chats = {};
  res.json({ chats: db.chats[userId] || [] });
});

app.post("/api/chats", (req, res) => {
  const { userId, chats } = req.body;
  const uid = userId || "anonymous";
  if (!Array.isArray(chats)) {
    res.status(400).json({ error: "Chats must be an array." });
    return;
  }
  const db = loadDB();
  if (!db.chats) db.chats = {};
  db.chats[uid] = chats;
  saveDB(db);
  res.json({ success: true, count: chats.length });
});

// -------------------------------------------------------------
// FILE GENERATION & EXPORT ENDPOINT (PDF, DOCX, XLSX, PPTX, CSV, TXT, MD, ZIP)
// -------------------------------------------------------------

app.post("/api/generate-file", async (req, res) => {
  try {
    const { format, filename, title, content, files, responseType } = req.body;
    if (!format || (!content && (!files || files.length === 0))) {
      return res.status(400).json({
        success: false,
        code: "MISSING_PARAMETERS",
        error: "Format and content are required.",
      });
    }
    const result = await generateFile({
      format,
      filename,
      title,
      content,
      files,
    });

    const wantsJson = responseType === "json" || req.headers.accept?.includes("application/json");
    if (wantsJson) {
      const b64 = result.buffer.toString("base64");
      const mime = result.mimeType.split(";")[0];
      return res.json({
        success: true,
        filename: result.filename,
        mimeType: result.mimeType,
        base64: b64,
        downloadUrl: `data:${mime};base64,${b64}`,
      });
    }

    res.setHeader("Content-Type", result.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
  } catch (err: any) {
    console.error("File generation error:", err);
    res.status(500).json({
      success: false,
      code: "FILE_GENERATION_FAILED",
      error: err.message || "Failed to generate file.",
    });
  }
});


// -------------------------------------------------------------
// CONNECTORS ENDPOINT
// -------------------------------------------------------------

app.get("/api/connectors", (req, res) => {
  const db = loadDB();
  res.json({ connectors: db.connectors });
});

app.post("/api/connectors/:id", (req, res) => {
  const { id } = req.params;
  const { enabled, account } = req.body;
  const db = loadDB();
  if (!db.connectors[id]) {
    db.connectors[id] = { enabled: false };
  }
  db.connectors[id].enabled = Boolean(enabled);
  if (account) db.connectors[id].account = account;
  db.connectors[id].lastSync = Date.now();
  saveDB(db);
  res.json({ success: true, connector: db.connectors[id] });
});

// -------------------------------------------------------------
// SMART STUDY & DEEP RESEARCH
// -------------------------------------------------------------

app.post("/api/study/generate", async (req, res) => {
  try {
    const { topic, content, type } = req.body;
    const ai = getGeminiClient();
    if (!ai) {
      res.status(500).json({ error: "Gemini client unavailable." });
      return;
    }

    const prompt = `You are NIVORA's Smart Study Assistant.
Based on the following topic/content, generate study material:
Topic/Content: ${topic || ""}
${content || ""}

Requirement: Generate output for type: "${type || "all"}" (explanation, summary, flashcards, and 5 MCQs with answer choices and explanations).
Format cleanly in Markdown with bold headers.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
    });

    res.json({ result: response.text || "No study guide generated." });
  } catch (err: any) {
    console.error("Study generator error:", err);
    res.status(500).json({ error: "Could not generate study material." });
  }
});

// -------------------------------------------------------------
// LOGO & STARTUP VIDEO ASSET HANDLING
// -------------------------------------------------------------
app.get(["/assets/nivora-logo.png", "/assets/nivora-logo.svg"], (req, res, next) => {
  const filePath = path.resolve(process.cwd(), "public/assets/nivora-logo.png");
  if (fs.existsSync(filePath)) {
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-cache");
    return res.sendFile(filePath);
  }
  next();
});

app.get("/assets/nivora-logo-reveal.mp4", (req, res, next) => {
  const filePath = path.resolve(process.cwd(), "public/assets/nivora-logo-reveal.mp4");
  if (fs.existsSync(filePath)) {
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Accept-Ranges", "bytes");
    return res.sendFile(filePath);
  }
  next();
});

// Dedicated SEO Routes for Search Engine Crawlers
function getCanonicalOrigin(): string {
  const envUrl = process.env.CUSTOM_DOMAIN || process.env.CANONICAL_URL;
  if (envUrl && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, "");
  }
  return "https://nivora.org";
}

app.get("/robots.txt", (req, res) => {
  const origin = getCanonicalOrigin();
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  return res.send(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`);
});

app.get("/sitemap.xml", (req, res) => {
  const origin = getCanonicalOrigin();
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  return res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${origin}/</loc>\n    <lastmod>2026-09-19</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>\n</urlset>`);
});

// Ensure any unhandled /api/* or /chat requests return valid JSON 404, never falling into Vite HTML SPA
app.all(["/api/*", "/chat", "/auth/*"], (req, res) => {
  res.status(404).json({
    success: false,
    error: `API route '${req.method} ${req.originalUrl}' not found.`,
    code: "NOT_FOUND",
  });
});

// Global API error handler ensuring any uncaught API errors return JSON, never HTML
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.path.startsWith("/api/") || req.path === "/chat" || req.path.startsWith("/auth/")) {
    console.error(`[API Error] ${req.method} ${req.path}:`, err);
    res.status(err.status || 500).json({
      success: false,
      error: err.message || "Internal server error occurred.",
      code: err.code || "INTERNAL_ERROR",
    });
    return;
  }
  next(err);
});

// -------------------------------------------------------------
// VITE MIDDLEWARE & STATIC SERVING
// -------------------------------------------------------------

async function startServer() {
  const distPath = path.join(process.cwd(), "dist");
  const isProduction =
    process.env.NODE_ENV === "production" ||
    (!process.env.npm_lifecycle_event?.includes("dev") &&
      fs.existsSync(path.join(distPath, "index.html")));

  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: process.env.DISABLE_HMR === "true" ? false : undefined,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Always bind to port 3000 for local proxy / dev environment
  const primaryServer = app.listen(PORT, "0.0.0.0", () => {
    console.log(`NIVORA Full-Stack Server running on http://0.0.0.0:${PORT}`);
    // Async diagnostic check for Firebase Email/Password provider
    fetch(`http://127.0.0.1:${PORT}/api/auth/firebase-status`)
      .then((r) => r.json())
      .then((status: any) => {
        if (status.emailPasswordEnabled) {
          console.log(`[Firebase Diagnostic] Email/Password Provider: ENABLED for project ${status.projectId}. Password reset email delivery is ready.`);
        } else {
          console.warn(`[Firebase Diagnostic WARNING] Project ${status.projectId}: Email/Password Provider is DISABLED (${status.providerError}). Password reset emails cannot be delivered until Email/Password is enabled in the Firebase Console (Authentication > Sign-in method).`);
        }
      })
      .catch((err) => {
        console.warn("[Firebase Diagnostic] Startup check error:", err.message);
      });
  });

  primaryServer.on("error", (err: any) => {
    console.error(`Primary server port ${PORT} error:`, err.message);
  });

  // If deployed to Cloud Run where PORT is set (e.g. 8080) and not equal to 3000,
  // also bind to process.env.PORT to satisfy Cloud Run's port health probe.
  const cloudRunPort = process.env.PORT ? parseInt(process.env.PORT, 10) : null;
  if (cloudRunPort && cloudRunPort !== PORT) {
    try {
      const crServer = app.listen(cloudRunPort, "0.0.0.0", () => {
        console.log(`NIVORA Cloud Run ingress listener active on http://0.0.0.0:${cloudRunPort}`);
      });
      crServer.on("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          console.log(`Port ${cloudRunPort} already managed by infrastructure proxy; dev server active on ${PORT}.`);
        } else {
          console.warn(`Cloud Run port ${cloudRunPort} warning:`, err.message);
        }
      });
    } catch (err: any) {
      console.warn(`Could not bind to Cloud Run port ${cloudRunPort}:`, err.message);
    }
  }
}

startServer();
