/**
 * NIVORA - Advanced AI Assistant Client Controller
 * Preserves 100% of existing functionality, storage keys, and styling,
 * while implementing all 20 roadmap features.
 */

(function () {
    "use strict";

    // Storage Keys
    const CHAT_STORAGE_KEY = "nivora_chats_v1";
    const ACTIVE_CHAT_KEY = "nivora_active_chat_v1";
    const USER_STORAGE_KEY = "nivora_user";
    const MEMORY_STORAGE_KEY = "nivora_memory_v1";
    const SETTINGS_STORAGE_KEY = "nivora_settings_v1";

    let currentAuthenticatedUser = null;

    window.addEventListener("nivora:auth-state-changed", (e) => {
        const u = e.detail?.user || null;
        currentAuthenticatedUser = u;
        if (u) {
            const overlay = $("startupAnimation");
            const isStartupActive = overlay && !overlay.classList.contains("hidden") && overlay.style.display !== "none";
            if (!isStartupActive) {
                openApp(u);
            }
        }
    });

    function getUser() {
        if (window.NivoraAuth?.getCurrentUser) {
            const fbUser = window.NivoraAuth.getCurrentUser();
            if (fbUser) return fbUser;
        }
        if (currentAuthenticatedUser) return currentAuthenticatedUser;
        try {
            return JSON.parse(localStorage.getItem(USER_STORAGE_KEY) || "{}");
        } catch {
            return {};
        }
    }

    function saveUser(user) {
        currentAuthenticatedUser = user || null;
        safeSetItem(USER_STORAGE_KEY, JSON.stringify(user || {}));
    }

    // DOM Utility
    const $ = (id) => document.getElementById(id);

    // ----------------------------------------------------
    // STORAGE HELPERS & INDEXEDDB ENGINE (ZERO QUOTA ERRORS)
    // ----------------------------------------------------

    const IDB_NAME = "nivora_storage_db";
    const IDB_VERSION = 1;
    let idbInstance = null;

    function getIDB() {
        if (idbInstance) return Promise.resolve(idbInstance);
        if (!window.indexedDB) return Promise.resolve(null);

        return new Promise((resolve) => {
            try {
                const request = indexedDB.open(IDB_NAME, IDB_VERSION);
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains("attachments")) {
                        db.createObjectStore("attachments", { keyPath: "id" });
                    }
                    if (!db.objectStoreNames.contains("chats")) {
                        db.createObjectStore("chats", { keyPath: "id" });
                    }
                };
                request.onsuccess = (e) => {
                    idbInstance = e.target.result;
                    resolve(idbInstance);
                };
                request.onerror = (e) => {
                    console.warn("[NIVORA Storage] IndexedDB open notice:", e);
                    resolve(null);
                };
            } catch (err) {
                console.warn("[NIVORA Storage] IndexedDB init notice:", err);
                resolve(null);
            }
        });
    }

    const nivoraDb = {
        async saveAttachment(att) {
            if (!att || !att.id || !att.data) return;
            try {
                const db = await getIDB();
                if (!db) return;
                const tx = db.transaction("attachments", "readwrite");
                const store = tx.objectStore("attachments");
                store.put({
                    id: att.id,
                    name: att.name || "attachment",
                    type: att.type || "application/octet-stream",
                    isImage: Boolean(att.isImage),
                    data: att.data,
                    savedAt: Date.now()
                });
            } catch (e) {
                console.debug("[NIVORA Storage] saveAttachment notice:", e);
            }
        },

        async getAttachment(id) {
            if (!id) return null;
            try {
                const db = await getIDB();
                if (!db) return null;
                return new Promise((resolve) => {
                    try {
                        const tx = db.transaction("attachments", "readonly");
                        const store = tx.objectStore("attachments");
                        const req = store.get(id);
                        req.onsuccess = () => resolve(req.result || null);
                        req.onerror = () => resolve(null);
                    } catch {
                        resolve(null);
                    }
                });
            } catch {
                return null;
            }
        },

        async saveFullChat(chat) {
            if (!chat || !chat.id) return;
            try {
                const db = await getIDB();
                if (!db) return;
                const tx = db.transaction("chats", "readwrite");
                const store = tx.objectStore("chats");
                store.put(chat);
            } catch (e) {
                console.debug("[NIVORA Storage] saveFullChat notice:", e);
            }
        },

        async getFullChat(id) {
            if (!id) return null;
            try {
                const db = await getIDB();
                if (!db) return null;
                return new Promise((resolve) => {
                    try {
                        const tx = db.transaction("chats", "readonly");
                        const store = tx.objectStore("chats");
                        const req = store.get(id);
                        req.onsuccess = () => resolve(req.result || null);
                        req.onerror = () => resolve(null);
                    } catch {
                        resolve(null);
                    }
                });
            } catch {
                return null;
            }
        }
    };

    // Object URL lifecycle manager (prevents memory leaks)
    const activeObjectUrls = new Set();
    function createTrackedObjectUrl(blobOrFile) {
        try {
            const url = URL.createObjectURL(blobOrFile);
            activeObjectUrls.add(url);
            return url;
        } catch {
            return null;
        }
    }

    function revokeTrackedObjectUrl(url) {
        if (url && activeObjectUrls.has(url)) {
            try {
                URL.revokeObjectURL(url);
            } catch (_) {}
            activeObjectUrls.delete(url);
        }
    }

    function revokeAllTrackedUrls() {
        activeObjectUrls.forEach((url) => {
            try {
                URL.revokeObjectURL(url);
            } catch (_) {}
        });
        activeObjectUrls.clear();
    }

    // Clean lightweight serializer for localStorage (strips all heavy base64 strings)
    function sanitizeChatsForLocalStorage(chatsList, maxChats = 30) {
        if (!Array.isArray(chatsList)) return [];
        const slice = chatsList.slice(-maxChats);
        return slice.map((c) => {
            if (!c) return null;
            return {
                id: c.id,
                title: c.title || "Chat",
                createdAt: c.createdAt || Date.now(),
                updatedAt: c.updatedAt || Date.now(),
                messages: Array.isArray(c.messages)
                    ? c.messages.slice(-50).map((m) => {
                          if (!m) return null;
                          const cleanMsg = {
                              role: m.role,
                              content: m.content || "",
                              timestamp: m.timestamp || Date.now(),
                              sources: m.sources,
                              artifact: m.artifact ? { type: m.artifact.type, title: m.artifact.title } : undefined
                          };

                          if (m.attachment) {
                              cleanMsg.attachment = {
                                  id: m.attachment.id,
                                  name: m.attachment.name,
                                  type: m.attachment.type,
                                  isImage: Boolean(m.attachment.isImage),
                                  size: m.attachment.size
                              };
                          }

                          if (Array.isArray(m.attachments)) {
                              cleanMsg.attachments = m.attachments.map((a) => ({
                                  id: a.id,
                                  name: a.name,
                                  type: a.type,
                                  isImage: Boolean(a.isImage),
                                  size: a.size
                              }));
                          }

                          if (m.generatedFile) {
                              cleanMsg.generatedFile = {
                                  name: m.generatedFile.name,
                                  type: m.generatedFile.type,
                                  size: m.generatedFile.size
                              };
                          }

                          if (Array.isArray(m.images)) {
                              cleanMsg.images = m.images.map((img) => {
                                  if (typeof img === "string" && img.startsWith("data:")) {
                                      return "[Image preview cached]";
                                  }
                                  return img;
                              });
                          }

                          return cleanMsg;
                      }).filter(Boolean)
                    : []
            };
        }).filter(Boolean);
    }

    let isCleaningStorage = false;
    let storageQuotaExceededWarned = false;

    function cleanLocalStorageQuota() {
        if (isCleaningStorage) return;
        isCleaningStorage = true;
        try {
            // 1. Remove temporary cache keys
            const toRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && (k.startsWith("nivora_cache_") || k.startsWith("nivora_temp_") || k.includes("search_cache") || k.includes("audio_cache"))) {
                    toRemove.push(k);
                }
            }
            toRemove.forEach((k) => {
                try { localStorage.removeItem(k); } catch (_) {}
            });

            // 2. Scan and sanitize any legacy bloated nivora_chats_* entries in localStorage
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith("nivora_chats_")) {
                    try {
                        const raw = localStorage.getItem(k);
                        if (raw && (raw.includes(";base64,") || raw.length > 200000)) {
                            const parsed = JSON.parse(raw);
                            const sanitized = sanitizeChatsForLocalStorage(parsed, 10);
                            localStorage.setItem(k, JSON.stringify(sanitized));
                        }
                    } catch (_) {}
                }
            }
        } catch (e) {
            console.debug("[NIVORA Storage] Cache cleaning note:", e);
        } finally {
            isCleaningStorage = false;
        }
    }

    function safeSetItem(key, value) {
        try {
            localStorage.setItem(key, value);
            storageQuotaExceededWarned = false;
            return true;
        } catch (err) {
            const isQuota = err && (
                err.name === "QuotaExceededError" ||
                err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
                err.code === 22 ||
                err.code === 1014 ||
                String(err).toLowerCase().includes("quota")
            );

            if (isQuota) {
                if (!storageQuotaExceededWarned) {
                    console.warn("[NIVORA Storage] LocalStorage quota reached. Pruning temporary caches safely and falling back to IndexedDB.");
                    storageQuotaExceededWarned = true;
                }
                cleanLocalStorageQuota();

                try {
                    localStorage.setItem(key, value);
                    return true;
                } catch (_) {
                    // If still full and it is chat storage, heavily prune to top 5 chats
                    if (key.startsWith("nivora_chats_")) {
                        try {
                            const parsed = JSON.parse(value);
                            const compact = sanitizeChatsForLocalStorage(parsed, 5);
                            localStorage.setItem(key, JSON.stringify(compact));
                            return true;
                        } catch (__) {
                            return false;
                        }
                    }
                    return false;
                }
            }
            return false;
        }
    }

    function getChatStorageKey(userId) {
        return "nivora_chats_" + (userId || "anonymous");
    }

    function getActiveChatKey(userId) {
        return "nivora_active_chat_" + (userId || "anonymous");
    }

    function formatMessageTimestamp(rawTs) {
        const timeFormatter = new Intl.DateTimeFormat(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true
        });

        if (!rawTs) {
            return timeFormatter.format(new Date());
        }

        try {
            let d;
            if (typeof rawTs === "number") {
                d = new Date(rawTs);
            } else if (typeof rawTs === "string") {
                const num = Number(rawTs);
                if (!isNaN(num) && num > 1000000000) {
                    d = new Date(num);
                } else {
                    d = new Date(rawTs);
                }
            } else if (rawTs && typeof rawTs.toDate === "function") {
                d = rawTs.toDate();
            } else if (rawTs && typeof rawTs.seconds === "number") {
                d = new Date(rawTs.seconds * 1000);
            } else if (rawTs instanceof Date) {
                d = rawTs;
            } else {
                d = new Date();
            }

            if (isNaN(d.getTime())) {
                return timeFormatter.format(new Date());
            }
            return timeFormatter.format(d);
        } catch (_) {
            return timeFormatter.format(new Date());
        }
    }

    function formatMessageDate(rawTs) {
        const dateFormatter = new Intl.DateTimeFormat(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric"
        });

        if (!rawTs) {
            return dateFormatter.format(new Date());
        }

        try {
            let d;
            if (typeof rawTs === "number") {
                d = new Date(rawTs);
            } else if (typeof rawTs === "string") {
                const num = Number(rawTs);
                if (!isNaN(num) && num > 1000000000) {
                    d = new Date(num);
                } else {
                    d = new Date(rawTs);
                }
            } else if (rawTs && typeof rawTs.toDate === "function") {
                d = rawTs.toDate();
            } else if (rawTs && typeof rawTs.seconds === "number") {
                d = new Date(rawTs.seconds * 1000);
            } else if (rawTs instanceof Date) {
                d = rawTs;
            } else {
                d = new Date();
            }

            if (isNaN(d.getTime())) {
                return dateFormatter.format(new Date());
            }
            return dateFormatter.format(d);
        } catch (_) {
            return dateFormatter.format(new Date());
        }
    }

    function loadChats(userId) {
        if (!userId) {
            const u = getUser();
            userId = u.uid || u.user_id || "anonymous";
        }
        try {
            const userKey = getChatStorageKey(userId);
            let raw = localStorage.getItem(userKey);
            if (!raw && userId !== "anonymous") {
                raw = localStorage.getItem(CHAT_STORAGE_KEY);
            }
            const parsed = raw ? JSON.parse(raw) : [];
            if (Array.isArray(parsed)) {
                let hasBloatedData = false;
                parsed.forEach((c) => {
                    if (c && Array.isArray(c.messages)) {
                        c.messages.forEach((m) => {
                            if (m) {
                                m.timestamp = m.timestamp || new Date().getTime();
                                // Migrate legacy base64 data to IndexedDB to instantly clean localStorage
                                if (m.attachment && m.attachment.data && m.attachment.data.length > 500) {
                                    hasBloatedData = true;
                                    if (!m.attachment.id) {
                                        m.attachment.id = "att-" + Date.now() + "-" + Math.random().toString(36).substr(2, 6);
                                    }
                                    nivoraDb.saveAttachment(m.attachment);
                                }
                                if (Array.isArray(m.attachments)) {
                                    m.attachments.forEach((a) => {
                                        if (a && a.data && a.data.length > 500) {
                                            hasBloatedData = true;
                                            if (!a.id) {
                                                a.id = "att-" + Date.now() + "-" + Math.random().toString(36).substr(2, 6);
                                            }
                                            nivoraDb.saveAttachment(a);
                                        }
                                    });
                                }
                            }
                        });
                    }
                });

                // Immediately clean bloated localStorage on startup
                if (hasBloatedData) {
                    const clean = sanitizeChatsForLocalStorage(parsed);
                    safeSetItem(userKey, JSON.stringify(clean));
                }

                return parsed;
            }
            return [];
        } catch (e) {
            console.error("Failed to parse chats from storage:", e);
            return [];
        }
    }

    // State
    let chats = loadChats();
    let activeChatId = localStorage.getItem(ACTIVE_CHAT_KEY);
    let currentAttachment = null; // { name, type, data, isImage }
    let currentAttachments = []; // Array of { id, name, type, data, isImage, previewUrl }
    let webSearchEnabled = false;
    let isSpeaking = false;
    let speechSynthUtterance = null;
    let recognitionInstance = null;
    let isListening = false;
    let currentArtifact = null;

    let saveChatsDebounceTimer = null;
    let syncChatTimeout = null;
    let isSavingChats = false;
    let lastSaveHash = "";

    function saveChats() {
        const user = getUser();
        const userId = user.uid || user.user_id || "anonymous";

        // Save active chat ID
        if (activeChatId) {
            safeSetItem(getActiveChatKey(userId), activeChatId);
            safeSetItem(ACTIVE_CHAT_KEY, activeChatId);
        }

        renderRecentChats();

        clearTimeout(saveChatsDebounceTimer);
        saveChatsDebounceTimer = setTimeout(async () => {
            if (isSavingChats) return;
            isSavingChats = true;

            try {
                // 1. Asynchronously persist full chats & attachments to IndexedDB
                for (const c of chats) {
                    if (c) {
                        nivoraDb.saveFullChat(c);
                        if (Array.isArray(c.messages)) {
                            for (const m of c.messages) {
                                if (m && m.attachment && m.attachment.data) {
                                    nivoraDb.saveAttachment(m.attachment);
                                }
                                if (m && Array.isArray(m.attachments)) {
                                    for (const a of m.attachments) {
                                        if (a && a.data) nivoraDb.saveAttachment(a);
                                    }
                                }
                            }
                        }
                    }
                }

                // 2. Prepare lightweight sanitized copy for LocalStorage
                const sanitized = sanitizeChatsForLocalStorage(chats);
                const serialized = JSON.stringify(sanitized);

                // Prevent duplicate saving loops
                if (serialized !== lastSaveHash) {
                    lastSaveHash = serialized;
                    safeSetItem(getChatStorageKey(userId), serialized);
                }
            } catch (err) {
                console.debug("[NIVORA Storage] Save notice (safe):", err);
            } finally {
                isSavingChats = false;
            }
        }, 120);

        // Remote sync (debounced 800ms)
        clearTimeout(syncChatTimeout);
        syncChatTimeout = setTimeout(async () => {
            try {
                if (window.NivoraAuth?.saveChatToFirestore && userId !== "anonymous") {
                    const activeChat = chats.find((c) => c.id === activeChatId);
                    if (activeChat) {
                        const sanitizedActive = sanitizeChatsForLocalStorage([activeChat])[0];
                        if (sanitizedActive) {
                            window.NivoraAuth.saveChatToFirestore(sanitizedActive).catch(console.warn);
                        }
                    }
                }
                const sanitizedAll = sanitizeChatsForLocalStorage(chats, 15);
                await fetch("/api/chats", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId, chats: sanitizedAll })
                });
            } catch (e) {
                console.debug("Backend chat sync error:", e);
            }
        }, 800);
    }

    function showToast(text, type = "success") {
        const old = document.querySelector(".nivora-toast");
        if (old) old.remove();
        const toast = document.createElement("div");
        toast.className = `nivora-toast ${type}`;
        const icon = type === "success" ? "✅" : "⚠️";
        toast.innerHTML = `<span>${icon}</span> <span>${escapeHTML(text)}</span>`;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = "0";
            setTimeout(() => toast.remove(), 250);
        }, 3200);
    }

    function updateUserUI(user) {
        if (!user) user = getUser();
        const name = user.name || "NIVORA User";
        const email = user.email || "user@nivora.ai";
        const pic = user.profile_picture || null;

        const nameEl = $("sidebarUserName");
        const emailEl = $("sidebarUserEmail");
        const avatarEl = $("sidebarUserAvatar");
        if (nameEl) nameEl.textContent = name;
        if (emailEl) emailEl.textContent = email;
        if (avatarEl) {
            if (pic) {
                avatarEl.innerHTML = `<img src="${pic}" alt="${escapeHTML(name)}" />`;
            } else {
                const initial = name.charAt(0).toUpperCase() || "👤";
                avatarEl.innerHTML = `<span>${initial}</span>`;
            }
        }
        updateAccountItem();
    }

    async function loadServerChats() {
        const user = getUser();
        const userId = user.uid || user.user_id || "anonymous";
        if (!userId || userId === "anonymous") return;
        try {
            let remoteChats = [];
            if (window.NivoraAuth?.getChatsFromFirestore) {
                try {
                    const fsChats = await window.NivoraAuth.getChatsFromFirestore();
                    if (Array.isArray(fsChats) && fsChats.length > 0) {
                        remoteChats = fsChats;
                    }
                } catch (fsErr) {
                    console.warn("Firestore chats load warning:", fsErr);
                }
            }

            if (remoteChats.length === 0) {
                try {
                    const res = await fetch(`/api/chats?userId=${encodeURIComponent(userId)}`);
                    const contentType = res.headers.get("content-type") || "";
                    if (res.ok && contentType.includes("application/json")) {
                        const data = await res.json().catch(() => null);
                        if (data && Array.isArray(data.chats)) remoteChats = data.chats;
                    }
                } catch (remoteChatsErr) {
                    console.warn("Could not fetch remote chats:", remoteChatsErr);
                }
            }

            // Verify the user hasn't changed while awaiting
            const currentU = getUser();
            const currentUid = currentU.uid || currentU.user_id;
            if (currentUid !== userId) return;

            if (remoteChats.length > 0) {
                const localMap = new Map(chats.map((c) => [c.id, c]));
                let changed = false;
                for (const sc of remoteChats) {
                    if (!localMap.has(sc.id)) {
                        chats.push(sc);
                        changed = true;
                    } else {
                        const existing = localMap.get(sc.id);
                        if ((sc.updatedAt || 0) > (existing.updatedAt || 0)) {
                            Object.assign(existing, sc);
                            changed = true;
                        }
                    }
                }
                if (changed) {
                    saveChats();
                    renderRecentChats();
                    renderChatMessages();
                }
            }
        } catch (e) {
            console.debug("Could not fetch remote chats:", e);
        }
    }

    async function handleContinueWithGoogle() {
        const googleBtns = [document.getElementById("googleLoginBtn"), document.getElementById("googleSignupBtn")].filter(Boolean);
        googleBtns.forEach(btn => { if (btn) { btn.disabled = true; btn.style.opacity = "0.7"; } });

        try {
            if (window.NivoraAuth) {
                const user = await window.NivoraAuth.loginWithGoogle();
                if (user) {
                    showToast(`Signed in as ${user.name}! 🎉`);
                    openApp(user);
                }
            } else {
                throw new Error("Authentication service is initializing. Please try again in a moment.");
            }
        } catch (err) {
            const errCode = (err && (err.code || err.message)) ? String(err.code || err.message) : "";
            const isCancelled = errCode.includes("popup-closed-by-user") || errCode.includes("cancelled-popup-request");
            if (isCancelled) {
                console.info("Google sign-in popup was closed by user.");
                showToast("Google sign-in was cancelled.", "info");
            } else {
                console.warn("Google Auth notice:", err);
                const msg = window.NivoraAuth?.formatAuthError(err) || (err && err.message) || "Google sign in failed.";
                showToast(msg, "error");
            }
        } finally {
            googleBtns.forEach(btn => { if (btn) { btn.disabled = false; btn.style.opacity = "1"; } });
        }
    }

    function makeTitle(text) {
        text = (text || "").trim();
        if (!text) return "New Chat";
        return text.length <= 26 ? text : text.substring(0, 26) + "...";
    }

    function getActiveChat() {
        if (!activeChatId) return null;
        return chats.find((c) => c.id === activeChatId) || null;
    }

    function createChat(firstMessage = "") {
        const newChat = {
            id: Date.now().toString(),
            title: firstMessage ? makeTitle(firstMessage) : "New Chat",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            pinned: false,
            messages: []
        };
        chats.unshift(newChat);
        saveChats();
        activeChatId = newChat.id;
        safeSetItem(ACTIVE_CHAT_KEY, activeChatId);
        renderRecentChats();
        return newChat;
    }

    // ----------------------------------------------------
    // AUTH CONTROLLER
    // ----------------------------------------------------

    function hide(el) {
        if (!el) return;
        el.style.setProperty("display", "none", "important");
        el.style.setProperty("pointer-events", "none", "important");
    }

    function show(el, mode = "flex") {
        if (!el) return;
        el.style.setProperty("display", mode, "important");
        el.style.setProperty("pointer-events", "auto", "important");
    }

    let activeResetCode = null;

    function openLogin() {
        hide($("signupScreen"));
        hide($("forgotScreen"));
        hide($("resetPasswordScreen"));
        hide(document.querySelector(".app"));
        show($("loginScreen"), "flex");
        const err = $("loginErrorMessage");
        if (err) { err.style.display = "none"; err.textContent = ""; }
    }

    function openSignup() {
        hide($("loginScreen"));
        hide($("forgotScreen"));
        hide($("resetPasswordScreen"));
        hide(document.querySelector(".app"));
        show($("signupScreen"), "flex");
        const err = $("signupErrorMessage");
        if (err) { err.style.display = "none"; err.textContent = ""; }
    }

    function openForgot() {
        hide($("loginScreen"));
        hide($("signupScreen"));
        hide($("resetPasswordScreen"));
        hide(document.querySelector(".app"));
        show($("forgotScreen"), "flex");

        // Reset to Step 1
        const step1 = $("forgotStep1");
        const step2 = $("forgotStep2");
        if (step1) step1.style.display = "block";
        if (step2) step2.style.display = "none";

        const otpInput = $("otpCodeInput");
        if (otpInput) otpInput.value = "";
        const otpErr = $("otpErrorMessage");
        if (otpErr) { otpErr.style.display = "none"; otpErr.textContent = ""; }
        const otpSucc = $("otpSuccessMessage");
        if (otpSucc) { otpSucc.style.display = "none"; otpSucc.textContent = ""; }

        const loginEmailVal = ($("loginEmail")?.value || "").trim();
        if (loginEmailVal && $("forgotEmail")) {
            $("forgotEmail").value = loginEmailVal;
        }
        const msgEl = $("forgotMessage");
        if (msgEl) {
            msgEl.style.display = "none";
            msgEl.textContent = "";
        }
        const successEl = $("forgotSuccessMessage");
        if (successEl) {
            successEl.style.display = "none";
            successEl.textContent = "";
        }
    }

    function openResetPassword(oobCode = "", email = "") {
        hide($("loginScreen"));
        hide($("signupScreen"));
        hide($("forgotScreen"));
        hide(document.querySelector(".app"));
        show($("resetPasswordScreen"), "flex");

        activeResetCode = oobCode;
        const codeInput = $("resetActionCode");
        const codeGroup = $("resetActionCodeGroup");
        if (codeInput) codeInput.value = oobCode;
        if (codeGroup) {
            codeGroup.style.display = oobCode ? "none" : "block";
        }

        const sub = $("resetPasswordSubtitle");
        if (sub) {
            sub.textContent = email ? `Create a new password for ${email}` : "Enter your new password below";
        }

        const errEl = $("resetErrorMessage");
        const successEl = $("resetSuccessMessage");
        if (errEl) { errEl.style.display = "none"; errEl.textContent = ""; }
        if (successEl) { successEl.style.display = "none"; successEl.textContent = ""; }

        const fields = $("resetFormFields");
        if (fields) fields.style.display = "block";
    }

    function renderChatMessages() {
        if (activeChatId && chats.some((c) => c.id === activeChatId)) {
            loadChat(activeChatId);
        } else if (chats && chats.length > 0) {
            loadChat(chats[0].id);
        } else {
            const messages = $("messages");
            if (messages) messages.innerHTML = "";
            const welcome = $("welcome");
            if (welcome) welcome.style.display = "flex";
        }
    }

    function openApp(user) {
        hide($("loginScreen"));
        hide($("signupScreen"));
        hide($("forgotScreen"));
        hide($("resetPasswordScreen"));
        show(document.querySelector(".app"), "flex");
        if (user) saveUser(user);
        updateUserUI(user);

        const uid = (user && (user.uid || user.user_id)) || "anonymous";
        chats = loadChats(uid);
        activeChatId = localStorage.getItem(getActiveChatKey(uid)) || (chats[0] ? chats[0].id : null);
        if (!activeChatId && chats.length === 0) {
            startNewChat();
        } else {
            renderRecentChats();
            renderChatMessages();
        }
        renderProjectsList();
        loadServerChats();
        setTimeout(() => {
            window.nivoraRobotController?.triggerGreetingAnimation?.();
        }, 400);
    }

    async function login() {
        const emailEl = $("loginEmail");
        const passEl = $("loginPassword");
        const btn = $("loginBtn");
        const errBanner = $("loginErrorMessage");
        const email = emailEl ? emailEl.value.trim() : "";
        const password = passEl ? passEl.value : "";

        if (errBanner) {
            errBanner.style.display = "none";
            errBanner.textContent = "";
        }

        if (!email) {
            const msg = "Please enter your email.";
            if (errBanner) { errBanner.textContent = msg; errBanner.style.display = "block"; }
            showToast(msg, "error");
            emailEl?.focus();
            return;
        }
        if (!password) {
            const msg = "Please enter your password.";
            if (errBanner) { errBanner.textContent = msg; errBanner.style.display = "block"; }
            showToast(msg, "error");
            passEl?.focus();
            return;
        }

        const oldText = btn?.textContent || "Login";
        if (btn) { btn.disabled = true; btn.textContent = "Logging in..."; }

        try {
            if (window.NivoraAuth) {
                const user = await window.NivoraAuth.loginWithEmail(email, password);
                if (!user || !user.uid) {
                    throw new Error("Authentication failed.");
                }
                showToast(`Welcome back, ${user.name || "User"}! 🎉`);
                openApp(user);
            } else {
                throw new Error("Authentication system is initializing. Please try again.");
            }
        } catch (err) {
            console.error("Firebase login error:", err);
            const msg = window.NivoraAuth?.formatAuthError(err) || "Incorrect email or password.";
            if (errBanner) {
                errBanner.textContent = msg;
                errBanner.style.display = "block";
            }
            showToast(msg, "error");
            // Remain on the login page! Do not navigate!
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = oldText; }
        }
    }

    async function signup() {
        const nameEl = $("signupName");
        const emailEl = $("signupEmail");
        const passEl = $("signupPassword");
        const confirmEl = $("signupConfirmPassword");
        const btn = $("signupBtn");
        const errBanner = $("signupErrorMessage");

        if (errBanner) {
            errBanner.style.display = "none";
            errBanner.textContent = "";
        }

        const name = nameEl ? nameEl.value.trim() : "";
        const email = emailEl ? emailEl.value.trim() : "";
        const password = passEl ? passEl.value : "";
        const confirm = confirmEl ? confirmEl.value : "";

        if (!name) {
            const msg = "Please enter your full name.";
            if (errBanner) { errBanner.textContent = msg; errBanner.style.display = "block"; }
            showToast(msg, "error");
            nameEl?.focus();
            return;
        }
        if (!email) {
            const msg = "Please enter your email.";
            if (errBanner) { errBanner.textContent = msg; errBanner.style.display = "block"; }
            showToast(msg, "error");
            emailEl?.focus();
            return;
        }
        if (password.length < 6) {
            const msg = "Password must be at least 6 characters.";
            if (errBanner) { errBanner.textContent = msg; errBanner.style.display = "block"; }
            showToast(msg, "error");
            passEl?.focus();
            return;
        }
        if (password !== confirm) {
            const msg = "Passwords do not match.";
            if (errBanner) { errBanner.textContent = msg; errBanner.style.display = "block"; }
            showToast(msg, "error");
            confirmEl?.focus();
            return;
        }

        const oldText = btn?.textContent || "Create Account";
        if (btn) { btn.disabled = true; btn.textContent = "Creating account..."; }

        try {
            if (window.NivoraAuth) {
                const user = await window.NivoraAuth.signupWithEmail(name, email, password);
                showToast("Account created successfully! 🎉");
                openApp(user);
            } else {
                throw new Error("Authentication system is initializing. Please try again.");
            }
        } catch (err) {
            console.error("Firebase signup error:", err);
            const msg = window.NivoraAuth?.formatAuthError(err) || (err && err.message) || "Signup failed.";
            if (errBanner) {
                errBanner.textContent = msg;
                errBanner.style.display = "block";
            }
            showToast(msg, "error");
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = oldText; }
        }
    }

    let resendCountdownTimer = null;
    function startResendCountdown(seconds = 60) {
        const resendBtn = $("resendOtpBtn");
        const countdownWrap = $("resendCountdown");
        const countSpan = $("countdownSeconds");

        if (resendCountdownTimer) clearInterval(resendCountdownTimer);

        if (resendBtn) {
            resendBtn.disabled = true;
            resendBtn.style.opacity = "0.5";
            resendBtn.style.pointerEvents = "none";
        }
        if (countdownWrap) countdownWrap.style.display = "block";

        let remaining = seconds;
        if (countSpan) countSpan.textContent = remaining;

        resendCountdownTimer = setInterval(() => {
            remaining--;
            if (countSpan) countSpan.textContent = remaining;
            if (remaining <= 0) {
                clearInterval(resendCountdownTimer);
                resendCountdownTimer = null;
                if (countdownWrap) countdownWrap.style.display = "none";
                if (resendBtn) {
                    resendBtn.disabled = false;
                    resendBtn.style.opacity = "1";
                    resendBtn.style.pointerEvents = "auto";
                    resendBtn.textContent = "Resend Reset Link";
                }
            }
        }, 1000);
    }

    async function sendPasswordReset() {
        const emailEl = $("forgotEmail");
        const btn = $("sendResetBtn");
        const resendBtn = $("resendOtpBtn");
        const msgEl = $("forgotMessage");
        const successEl = $("forgotSuccessMessage");
        const otpErrMsg = $("otpErrorMessage");
        const otpSuccessMsg = $("otpSuccessMessage");
        const sentDetailEl = $("forgotSentDetail");
        const email = emailEl ? emailEl.value.trim() : "";
        const isStep2 = $("forgotStep2")?.style.display === "block";

        const targetErr = isStep2 ? otpErrMsg : msgEl;
        const targetSuccess = isStep2 ? otpSuccessMsg : successEl;

        if (msgEl) { msgEl.style.display = "none"; msgEl.textContent = ""; }
        if (successEl) { successEl.style.display = "none"; successEl.textContent = ""; }
        if (otpErrMsg) { otpErrMsg.style.display = "none"; otpErrMsg.textContent = ""; }
        if (otpSuccessMsg) { otpSuccessMsg.style.display = "none"; otpSuccessMsg.textContent = ""; }

        if (!email || !email.includes("@")) {
            const msg = "Please enter your Gmail or a valid email address.";
            if (targetErr) {
                targetErr.textContent = msg;
                targetErr.style.display = "block";
            }
            showToast(msg, "error");
            emailEl?.focus();
            return;
        }

        const activeBtn = isStep2 ? resendBtn : btn;
        const oldText = activeBtn?.textContent || (isStep2 ? "Resend Reset Link" : "Send Reset Link");
        if (activeBtn) { activeBtn.disabled = true; activeBtn.textContent = "Sending reset link..."; }

        try {
            if (!window.NivoraAuth) {
                throw new Error("Authentication system is initializing. Please try again in a moment.");
            }

            // Real Firebase password reset email delivery
            await window.NivoraAuth.resetPassword(email);

            // Transition to Step 2 ONLY after Firebase confirms the email was successfully requested!
            const step1 = $("forgotStep1");
            const step2 = $("forgotStep2");
            if (step1) step1.style.display = "none";
            if (step2) step2.style.display = "block";

            if (sentDetailEl) {
                sentDetailEl.innerHTML = `Password reset email sent to <strong>${escapeHTML(email)}</strong>.<br>Check your inbox, Spam and Promotions folders.`;
            }

            // Start 60s countdown for resend
            startResendCountdown(60);

            showToast(`Password reset link sent to ${email}! 📬`, "success");
        } catch (err) {
            console.error("Firebase password reset error:", err);
            const msg = window.NivoraAuth?.formatAuthError(err, "reset") || (err && err.message) || "Could not send password reset email. Please verify your email address.";
            if (targetErr) {
                targetErr.textContent = msg;
                targetErr.style.display = "block";
            }
            showToast(msg, "error");
        } finally {
            if (activeBtn) { activeBtn.disabled = false; activeBtn.textContent = oldText; }
        }
    }

    async function verifyOtpCode() {
        const emailEl = $("forgotEmail");
        const codeEl = $("otpCodeInput");
        const btn = $("verifyOtpBtn");
        const errEl = $("otpErrorMessage");
        const successEl = $("otpSuccessMessage");

        const email = emailEl ? emailEl.value.trim() : "";
        let code = codeEl ? codeEl.value.trim() : "";

        if (errEl) { errEl.style.display = "none"; errEl.textContent = ""; }
        if (successEl) { successEl.style.display = "none"; successEl.textContent = ""; }

        // Automatically extract code if user pasted the full reset link from email
        if (code.includes("oobCode=")) {
            const m = code.match(/oobCode=([^&]+)/);
            if (m) code = decodeURIComponent(m[1]);
        } else if (code.includes("code=")) {
            const m = code.match(/code=([^&]+)/);
            if (m) code = decodeURIComponent(m[1]);
        }

        if (!code) {
            const msg = "Please enter the verification code or paste the link from your email.";
            if (errEl) { errEl.textContent = msg; errEl.style.display = "block"; }
            showToast(msg, "error");
            codeEl?.focus();
            return;
        }

        const oldText = btn?.textContent || "Verify & Create New Password";
        if (btn) { btn.disabled = true; btn.textContent = "Verifying..."; }

        try {
            if (!window.NivoraAuth) {
                throw new Error("Authentication system is initializing. Please try again.");
            }

            // Verify the Firebase action code
            const verifiedEmail = await window.NivoraAuth.verifyResetCode(code);

            // Open the Create New Password screen with the verified code and email
            openResetPassword(code, verifiedEmail || email);
            showToast("Verification code confirmed! Set your new password.", "success");
        } catch (err) {
            console.error("Firebase reset code verification error:", err);
            const msg = window.NivoraAuth?.formatAuthError(err, "reset") || (err && err.message) || "Invalid or expired verification code.";
            if (errEl) {
                errEl.textContent = msg;
                errEl.style.display = "block";
            }
            showToast(msg, "error");
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = oldText; }
        }
    }

    async function submitNewPassword() {
        const passEl = $("newResetPassword");
        const confirmEl = $("confirmResetPassword");
        const codeEl = $("resetActionCode");
        const btn = $("submitNewPasswordBtn");
        const errorEl = $("resetErrorMessage");
        const successEl = $("resetSuccessMessage");
        const fieldsContainer = $("resetFormFields");

        if (errorEl) { errorEl.style.display = "none"; errorEl.textContent = ""; }
        if (successEl) { successEl.style.display = "none"; successEl.textContent = ""; }

        const newPass = passEl ? passEl.value : "";
        const confirmPass = confirmEl ? confirmEl.value : "";
        const actionCode = activeResetCode || (codeEl ? codeEl.value.trim() : "");

        if (!actionCode) {
            const err = "No valid reset code found. Please request a new password reset link.";
            if (errorEl) { errorEl.textContent = err; errorEl.style.display = "block"; }
            showToast(err, "error");
            return;
        }

        if (newPass.length < 6) {
            const err = "Password must be at least 6 characters.";
            if (errorEl) { errorEl.textContent = err; errorEl.style.display = "block"; }
            showToast(err, "error");
            passEl?.focus();
            return;
        }

        if (newPass !== confirmPass) {
            const err = "Passwords do not match.";
            if (errorEl) { errorEl.textContent = err; errorEl.style.display = "block"; }
            showToast(err, "error");
            confirmEl?.focus();
            return;
        }

        const oldText = btn?.textContent || "Save New Password";
        if (btn) { btn.disabled = true; btn.textContent = "Saving new password..."; }

        try {
            if (!window.NivoraAuth) {
                throw new Error("Authentication service is initializing. Please try again.");
            }
            await window.NivoraAuth.confirmNewPassword(actionCode, newPass);
            if (fieldsContainer) fieldsContainer.style.display = "none";
            if (successEl) {
                successEl.textContent = "Password updated successfully! You can now log in with your new password.";
                successEl.style.display = "block";
            }
            showToast("Password updated successfully! 🎉", "success");
            // Automatically switch back to login with new password ready
            setTimeout(() => {
                openLogin();
                const loginEmail = $("loginEmail");
                if (loginEmail && $("forgotEmail")?.value) {
                    loginEmail.value = $("forgotEmail").value.trim();
                }
                const loginPass = $("loginPassword");
                if (loginPass) {
                    loginPass.value = "";
                    loginPass.focus();
                }
            }, 2500);
        } catch (err) {
            console.error("Confirm new password error:", err);
            const msg = window.NivoraAuth?.formatAuthError(err, "reset") || (err && err.message) || "Failed to reset password.";
            if (errorEl) {
                errorEl.textContent = msg;
                errorEl.style.display = "block";
            }
            showToast(msg, "error");
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = oldText; }
        }
    }

    // ----------------------------------------------------
    // CHAT & MESSAGING SYSTEM
    // ----------------------------------------------------

    // ====================================================
    // MESSAGE INTERCEPTOR & CHAT RESPONSE STREAM PARSER
    // ====================================================

    // Strips out any JSON object that contains 'action', 'action_input', or 'thought' keys
    function removeToolJSONObjects(str) {
        if (!str || typeof str !== "string") return "";
        let result = "";
        let i = 0;
        while (i < str.length) {
            if (str[i] === "{") {
                let depth = 0;
                let inString = false;
                let escape = false;
                const start = i;
                let end = -1;
                for (let j = i; j < str.length; j++) {
                    const ch = str[j];
                    if (escape) {
                        escape = false;
                        continue;
                    }
                    if (ch === "\\" && inString) {
                        escape = true;
                        continue;
                    }
                    if (ch === '"') {
                        inString = !inString;
                        continue;
                    }
                    if (!inString) {
                        if (ch === "{") depth++;
                        else if (ch === "}") {
                            depth--;
                            if (depth === 0) {
                                end = j + 1;
                                break;
                            }
                        }
                    }
                }

                if (end !== -1) {
                    const candidate = str.substring(start, end);
                    const hasToolKeys = /"(?:action|action_input|thought)"\s*:/i.test(candidate);
                    if (hasToolKeys) {
                        i = end;
                        continue;
                    } else {
                        try {
                            const parsed = JSON.parse(candidate);
                            if (parsed && typeof parsed === "object" && ("action" in parsed || "action_input" in parsed || "thought" in parsed)) {
                                i = end;
                                continue;
                            }
                        } catch (_) {}
                    }
                }
            }
            result += str[i];
            i++;
        }
        return result;
    }

    // =========================================================================
    // MESSAGE PARSING FUNCTION
    // Filters out all incoming chat stream chunks containing 'action',
    // 'action_input', or 'thought' keys, ensuring only final text responses
    // are rendered to the DOM.
    // =========================================================================
    function parseChatStreamChunk(chunk) {
        if (chunk === null || chunk === undefined) return "";

        // If chunk is already an object
        if (typeof chunk === "object") {
            if ("action" in chunk || "action_input" in chunk || "thought" in chunk) {
                return "";
            }
            if (chunk.type === "delta" && typeof chunk.text === "string") {
                return parseChatStreamChunk(chunk.text);
            }
            if (chunk.reply && typeof chunk.reply === "string") {
                return parseChatStreamChunk(chunk.reply);
            }
            return "";
        }

        let clean = typeof chunk === "string" ? chunk : String(chunk);

        // Handle SSE data: format
        if (clean.trim().startsWith("data:")) {
            const dataPayload = clean.replace(/^data:\s*/, "").trim();
            try {
                const parsed = JSON.parse(dataPayload);
                if (parsed && typeof parsed === "object") {
                    if ("action" in parsed || "action_input" in parsed || "thought" in parsed) {
                        return "";
                    }
                    if (parsed.type === "delta" && typeof parsed.text === "string") {
                        return parseChatStreamChunk(parsed.text);
                    }
                    if (parsed.type === "done" && parsed.reply) {
                        return parseChatStreamChunk(parsed.reply);
                    }
                    if (parsed.reply) {
                        return parseChatStreamChunk(parsed.reply);
                    }
                    if (parsed.type === "status") {
                        return "";
                    }
                }
            } catch (_) {}
        }

        // Try parsing entire chunk as JSON
        try {
            const parsedObj = JSON.parse(clean.trim());
            if (parsedObj && typeof parsedObj === "object") {
                if ("action" in parsedObj || "action_input" in parsedObj || "thought" in parsedObj) {
                    return "";
                }
                if (parsedObj.type === "delta" && typeof parsedObj.text === "string") {
                    return parseChatStreamChunk(parsedObj.text);
                }
                if (parsedObj.reply && typeof parsedObj.reply === "string") {
                    return parseChatStreamChunk(parsedObj.reply);
                }
            }
        } catch (_) {}

        // 1. Strip markdown code blocks containing tool JSON
        clean = clean.replace(/```(?:json)?\s*\{[\s\S]*?(?:"action"|"action_input"|"thought")[\s\S]*?\}\s*```/gi, "");

        // 2. Strip balanced JSON objects containing 'action', 'action_input', or 'thought'
        clean = removeToolJSONObjects(clean);

        // 3. Strip any single-line or nested JSON objects containing 'action', 'action_input', or 'thought' keys
        clean = clean.replace(/\{[\s\S]*?"(?:action|tool|function)"\s*:\s*"[^"]*"[\s\S]*?\}/gi, "");
        clean = clean.replace(/\{[\s\S]*?"action_input"\s*:[\s\S]*?\}/gi, "");
        clean = clean.replace(/\{[\s\S]*?"thought"\s*:\s*"[^"]*"[\s\S]*?\}/gi, "");

        // 4. Strip ReAct tokens
        clean = clean.replace(/^Thought:\s*.*$/gim, "");
        clean = clean.replace(/^Action:\s*.*$/gim, "");
        clean = clean.replace(/^Action Input:\s*.*$/gim, "");
        clean = clean.replace(/^Observation:\s*.*$/gim, "");

        // 5. Strip XML-style tool tags
        clean = clean.replace(/<thought>[\s\S]*?<\/thought>/gi, "");
        clean = clean.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");
        clean = clean.replace(/<function_call>[\s\S]*?<\/function_call>/gi, "");
        clean = clean.replace(/<tool_response>[\s\S]*?<\/tool_response>/gi, "");

        return clean;
    }

    const parseAndFilterStreamChunk = parseChatStreamChunk;
    window.parseChatStreamChunk = parseChatStreamChunk;
    window.parseStreamChunk = parseChatStreamChunk;
    window.filterChatStreamChunk = parseChatStreamChunk;
    window.filterStreamChunk = parseChatStreamChunk;

    // Strips raw tool call structures, action/thought JSON, and ReAct tokens completely
    function stripToolCallJSON(input) {
        if (!input || typeof input !== "string") return "";
        return parseAndFilterStreamChunk(input).trim();
    }

    // Update dynamic typing indicator text in place with user-friendly status update
    function updateTypingIndicatorLabel(aiMsgElement, newLabel) {
        if (!aiMsgElement || !newLabel) return;
        aiMsgElement._typingCurrentBase = newLabel.replace(/\.+$/, "");
        const textSpan = aiMsgElement.querySelector(".typing-text-span");
        if (textSpan) {
            textSpan.textContent = newLabel;
        }
    }

    // Render live streaming text into aiMsgElement - ensuring ONLY final text responses are rendered to the DOM
    function renderStreamingText(aiMsgElement, text) {
        if (!aiMsgElement) return;
        const cleanText = parseAndFilterStreamChunk(text);
        const content = aiMsgElement.querySelector(".message-content");
        if (!content) return;

        let streamBody = content.querySelector(".streaming-text-body");
        if (!streamBody) {
            content.innerHTML = `
                <div class="formatted-markdown-body streaming-text-body"></div>
                <span class="streaming-cursor-beacon" style="display:inline-block;width:7px;height:14px;background:#6366f1;border-radius:2px;margin-left:4px;vertical-align:middle;animation:streamBlink 0.8s infinite;"></span>
            `;
            streamBody = content.querySelector(".streaming-text-body");
        }

        if (window.marked && typeof window.marked.parse === "function") {
            try {
                streamBody.innerHTML = window.marked.parse(cleanText, { gfm: true, breaks: true });
            } catch (_) {
                streamBody.textContent = cleanText;
            }
        } else {
            streamBody.textContent = cleanText;
        }

        scrollToBottom();
    }

    // Message interceptor for detecting and suppressing raw tool call structures in the stream
    class MessageInterceptor {
        constructor(callbacks = {}) {
            this.onStatusUpdate = callbacks.onStatusUpdate || (() => {});
            this.onTextDelta = callbacks.onTextDelta || (() => {});
            this.onDone = callbacks.onDone || (() => {});
        }

        consumeEventString(eventStr) {
            const lines = eventStr.split("\n");
            let dataStr = "";

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith("data:")) {
                    const dataPart = trimmed.slice(5).trim();
                    dataStr += (dataStr ? "\n" : "") + dataPart;
                }
            }

            if (!dataStr) return;

            // Try parsing JSON payload in data:
            try {
                const parsed = JSON.parse(dataStr);
                this.handleParsedObject(parsed);
                return;
            } catch (_) {}

            // Raw chunk: intercept and filter out any JSON objects containing 'action', 'action_input', or 'thought'
            this.interceptRawChunk(dataStr);
        }

        handleParsedObject(obj) {
            if (!obj || typeof obj !== "object") return;

            // Detect raw tool call structures: contains 'action', 'action_input', or 'thought' keys
            const isToolCall = ("action" in obj) || ("action_input" in obj) || ("thought" in obj);
            if (isToolCall) {
                // SUPPRESS RAW TOOL CALL COMPLETELY
                const action = (obj.action || "").toString().toLowerCase();
                const thought = (obj.thought || "").toString();

                if (action.includes("dalle") || action.includes("image") || action.includes("text2im")) {
                    this.onStatusUpdate("Generating image with NIVORA... 🎨");
                } else if (action.includes("search") || action.includes("duckduckgo") || action.includes("web")) {
                    this.onStatusUpdate("Searching verified sources... 🔍");
                } else if (action.includes("python") || action.includes("code")) {
                    this.onStatusUpdate("Running code analysis... ⚡");
                } else if (thought) {
                    this.onStatusUpdate("NIVORA is thinking...");
                }
                return;
            }

            // Server-emitted user-friendly status update
            if (obj.type === "status" && obj.message) {
                this.onStatusUpdate(obj.message);
                return;
            }

            // Server-emitted text delta
            if (obj.type === "delta" && typeof obj.text === "string") {
                const cleanDelta = parseAndFilterStreamChunk(obj.text);
                if (cleanDelta) {
                    this.onTextDelta(cleanDelta);
                }
                return;
            }

            // Server-emitted done event
            if (obj.type === "done") {
                if (obj.reply) {
                    obj.reply = parseAndFilterStreamChunk(obj.reply).trim();
                }
                this.onDone(obj);
                return;
            }

            // Object with reply
            if (obj.reply) {
                obj.reply = parseAndFilterStreamChunk(obj.reply).trim();
                this.onDone(obj);
            }
        }

        interceptRawChunk(raw) {
            // Filter all chunks containing 'action', 'action_input', or 'thought' keys
            if (/(?:"action"|"action_input"|"thought")\s*:/i.test(raw)) {
                // Suppress raw tool call completely and trigger friendly status if helpful
                if (/dalle|image|text2im/i.test(raw)) {
                    this.onStatusUpdate("Generating image with NIVORA... 🎨");
                } else if (/search|duckduckgo|web/i.test(raw)) {
                    this.onStatusUpdate("Searching verified sources... 🔍");
                } else {
                    this.onStatusUpdate("NIVORA is thinking...");
                }
                const clean = parseAndFilterStreamChunk(raw);
                if (clean) {
                    this.onTextDelta(clean);
                }
            } else {
                const clean = parseAndFilterStreamChunk(raw);
                if (clean) {
                    this.onTextDelta(clean);
                }
            }
        }

        flush() {}
    }

    // Chat response parser to intercept all incoming API stream chunks
    const ChatResponseParser = {
        async parseStreamResponse(response, aiMsgElement, abortSignal) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let sseBuffer = "";
            let displayedText = "";
            let doneData = null;

            const interceptor = new MessageInterceptor({
                onStatusUpdate: (status) => {
                    updateTypingIndicatorLabel(aiMsgElement, status);
                },
                onTextDelta: (cleanDelta) => {
                    displayedText += cleanDelta;
                    renderStreamingText(aiMsgElement, displayedText);
                },
                onDone: (data) => {
                    doneData = data;
                }
            });

            try {
                while (true) {
                    if (abortSignal?.aborted) {
                        await reader.cancel().catch(() => {});
                        break;
                    }
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    sseBuffer += chunk;

                    const events = sseBuffer.split("\n\n");
                    sseBuffer = events.pop() || "";

                    for (const eventStr of events) {
                        if (!eventStr.trim()) continue;
                        interceptor.consumeEventString(eventStr);
                    }
                }

                if (sseBuffer.trim()) {
                    interceptor.consumeEventString(sseBuffer);
                }
                interceptor.flush();
            } finally {
                reader.releaseLock?.();
            }

            const cleanFinalReply = parseAndFilterStreamChunk(doneData?.reply || displayedText).trim();

            return {
                reply: cleanFinalReply || "I'm here to help with your questions, coding, research, files, and images. What would you like to explore?",
                sources: Array.isArray(doneData?.sources) ? doneData.sources : [],
                images: Array.isArray(doneData?.images) ? doneData.images : [],
                artifact: doneData?.artifact || null,
                generatedFile: doneData?.generatedFile || null,
                creation: doneData?.creation || null,
                generatedImage: doneData?.generatedImage || null,
                provider: doneData?.provider || "NIVORA AI"
            };
        },

        async parseJsonResponse(response) {
            const raw = await response.json();
            return this.sanitizePayload(raw);
        },

        sanitizePayload(data) {
            if (!data || typeof data !== "object") return data;
            let reply = data.reply || "";
            reply = parseAndFilterStreamChunk(reply).trim();
            return {
                ...data,
                reply: reply || "I'm here to help with your questions, coding, research, files, and images. What would you like to explore?"
            };
        }
    };

    function shouldQuerySearchWeb(text) {
        if (!text || text.trim().length < 2) return false;
        const t = text.toLowerCase().trim();
        // Skip current date and time queries - browser provides exact local time & date
        if (/^(what(\s+is|\s+'s|\s+was)?\s+(the\s+)?(time|date|day)|current\s+(time|date)|today(\s*'s|\s+is)?\s+date|tell\s+me\s+the\s+(time|date))\b/i.test(t)) {
            return false;
        }
        // Skip pure casual greetings
        if (/^(hi|hello|hey|hola|sup|greetings|good\s*(morning|afternoon|evening)|how\s*are\s*you|who\s*are\s*you|what\s*is\s*your\s*name)\b[!?.]*$/i.test(t)) {
            return false;
        }
        // Skip pure short math calculations like "2 + 2" or "100 / 4"
        if (/^\s*\d+[\s\+\-\*\/\^\%\(\)\.]+\d+[\s\d\+\-\*\/\^\%\(\)\.]*\s*$/.test(t)) {
            return false;
        }
        // Explicit web search intent
        if (
            t.includes("search web") ||
            t.includes("search the web") ||
            t.includes("search internet") ||
            t.includes("google search") ||
            t.includes("browse the web") ||
            t.includes("browse online") ||
            t.includes("check online") ||
            t.includes("look up online") ||
            t.includes("real time") ||
            t.includes("real-time") ||
            t.includes("deep research")
        ) {
            return true;
        }
        // Pure code / math / basic concepts / self-identity queries should NOT search the web
        if (/^(write a (python|java|c\+\+|javascript|typescript|c#|rust|go|sql) program|2\s*\+\s*2|what is machine learning\??|explain python\??|explain this project\??|explain this error(\:.*)?\??|ml ante enti\??|hello|hi|hey|greetings|who are you)$/i.test(t.trim())) {
            return false;
        }

        // Academic leadership & faculty (worldwide colleges, universities, departments)
        if (/\b(hod|hods|head of department|principal|principals|dean|deans|director|directors|faculty|professor|professors|prof|who teaches|teaches|lecturer|lecturers|staff|chancellor|vice chancellor|\bvc\b|teacher|teachers|mentor)\b/i.test(t)) {
            return true;
        }

        // Academic institutions, universities, colleges worldwide
        if (/\b(college|colleges|university|universities|school|schools|institute|institutes|campus|campuses|academy|\biit\b|\bnit\b|\biiit\b|\bbits\b|\bmit\b|stanford|harvard|oxford|cambridge|caltech|cmu|berkeley|rgm|rgmcet|nandyal|jntu|jntua|jntuh|anna university|vtu|osmania|delhi university|iisc|bits pilani)\b/i.test(t)) {
            return true;
        }

        // Academic operational info, admissions, syllabus, cutoffs, rankings
        if (/\b(admission|admissions|cutoff|cut-off|ranking|rankings|\bnirf\b|\bnaac\b|\bnba\b|accreditation|fee structure|fees for|placements|placement record|syllabus|curriculum|exam date|exam schedule|hall ticket|results of|schedule of|counseling|course details|courses offered)\b/i.test(t)) {
            return true;
        }

        // Movies, box office, collections, entertainment & reviews
        if (/\b(box office|boxoffice|collection|collections|gross|distributor share|\bshare\b|day 1|day \d+|opening day|opening weekend|worldwide collection|closing collection|hit or flop|budget of|verdict|blockbuster|theater|theatre|cinema|movie|film|trailer|teaser|ott release|imdb rating|cast of|release date of|actor|actress|hero|heroine|director)\b/i.test(t)) {
            return true;
        }

        // Sports, cricket, football, scores, matches, tournaments, players
        if (/\b(cricket|football|ipl|world cup|olympics|live score|match score|points table|winner of|runner up|goals|runs|wickets|batsman|bowler|player|championship|tournament)\b/i.test(t)) {
            return true;
        }

        // Company leadership, business entities, CEOs, founders
        if (/\b(ceo|founder|co-founder|cofounder|chairman|chairperson|managing director|\bmd\b|president of|cfo|cto|coo|leadership of|who is the ceo|who is the founder|ceo name|founder name|pvt ltd|pvt\. ltd\.|private limited|solutions pvt|technologies pvt|\bllc\b|\binc\b|\bcorp\b|startup|company|firm|corporation)\b/i.test(t)) {
            return true;
        }

        // Government, politics & public officials
        if (/\b(minister|prime minister|chief minister|governor|president of|cabinet minister|politician|government organization|secretariat|mpp|mla|mp|collector|commissioner)\b/i.test(t)) {
            return true;
        }

        // Gadgets, prices, specifications, reviews, software versions, products
        if (/\b(price of|cost of|specifications of|specs of|review of|how much is|current price|stock price|crypto price|bitcoin|latest version|latest release|new version of|current version of|documentation of)\b/i.test(t)) {
            return true;
        }

        // Temporal triggers requiring fresh search
        if (/\b(current|today|todays|latest|now|recently|present|currently|this year|2026|2025|latest update|breaking news|recent news|what happened today|today's news|latest news|news today|election results)\b/i.test(t)) {
            return true;
        }

        // Inquiries asking for specific person, role, or organization details
        if (/^(who (is|was|are)|what is the current|give (me )?(details|info) (of|about)|tell me about)\s+[a-z0-9\s]+$/i.test(t)) {
            return true;
        }

        return false;
    }

    async function sendMessage() {
        const input = $("messageInput");
        if (!input) return;
        const messageText = input.value.trim();

        if (!messageText && (!currentAttachments || currentAttachments.length === 0) && !currentAttachment) {
            return;
        }

        // Gather all attachments
        const attachmentsToSend = (currentAttachments && currentAttachments.length > 0)
            ? currentAttachments.slice()
            : (currentAttachment ? [currentAttachment] : []);
        const imageAttachments = attachmentsToSend.filter(a => a.isImage);
        const fileAttachments = attachmentsToSend.filter(a => !a.isImage);

        // Create or get active chat
        let chat = getActiveChat();
        if (!chat) {
            chat = createChat(messageText || attachmentsToSend[0]?.name || "New Chat");
        } else if (chat.messages.length === 0) {
            chat.title = makeTitle(messageText || attachmentsToSend[0]?.name || "New Chat");
        }

        const welcome = $("welcome");
        if (welcome) welcome.style.display = "none";

        clearAttachmentTray();

        // Save User Message with browser's current local timestamp
        const userNow = new Date();
        const userTimestamp = userNow.getTime();
        const userMsg = {
            role: "user",
            content: messageText,
            timestamp: userTimestamp,
            attachment: attachmentsToSend[0] ? {
                id: attachmentsToSend[0].id,
                name: attachmentsToSend[0].name,
                type: attachmentsToSend[0].type,
                isImage: attachmentsToSend[0].isImage,
                isPdf: attachmentsToSend[0].isPdf,
                previewUrl: attachmentsToSend[0].previewUrl,
                data: attachmentsToSend[0].data
            } : undefined,
            attachments: attachmentsToSend.map((a) => ({
                id: a.id,
                name: a.name,
                type: a.type,
                isImage: a.isImage,
                isPdf: a.isPdf,
                previewUrl: a.previewUrl,
                data: a.data
            }))
        };
        chat.messages.push(userMsg);
        chat.updatedAt = userTimestamp;
        saveChats();

        // Render User Message
        addUserMessage(userMsg);
        input.value = "";
        adjustMessageInputHeight(input);

        // Natural language AI Creation & Generation Intent Detection
        const creationIntent = parseGenerationIntent(messageText, imageAttachments);
        const isImageGen = Boolean(creationIntent && (creationIntent.type === "image" || creationIntent.type === "logo" || creationIntent.type === "poster"));
        const queryNeedsSearch = !creationIntent && shouldQuerySearchWeb(messageText);

        // Add Thinking / Dynamic Typing Indicator Animation
        let thinkingLabel = "NIVORA is thinking...";
        if (creationIntent) {
            if (creationIntent.type === "image_edit") {
                thinkingLabel = "Applying AI transformation to image...";
            } else if (creationIntent.type === "presentation") {
                thinkingLabel = "Structuring presentation slide deck & PPTX...";
            } else if (creationIntent.type === "qr") {
                thinkingLabel = "Generating high-resolution QR code...";
            } else if (creationIntent.type === "logo") {
                thinkingLabel = "Designing brand logo with NIVORA AI...";
            } else if (creationIntent.type === "poster") {
                thinkingLabel = "Designing high-contrast poster with NIVORA AI...";
            } else {
                thinkingLabel = `Generating ${creationIntent.style || "AI"} image with NIVORA...`;
            }
        } else if (imageAttachments.length > 1) {
            thinkingLabel = `Understanding & analyzing ${imageAttachments.length} images...`;
        } else if (imageAttachments.length === 1) {
            thinkingLabel = "Understanding & analyzing image...";
        } else if (fileAttachments.length > 0) {
            thinkingLabel = `Reading & analyzing ${fileAttachments[0].name}...`;
        } else if (webSearchEnabled || queryNeedsSearch) {
            thinkingLabel = "Searching the web & verifying sources...";
        }

        const aiMsgElement = addAIMessageSkeleton(thinkingLabel);

        let searchInterval = null;
        if (webSearchEnabled || queryNeedsSearch) {
            const labelEl = aiMsgElement ? (aiMsgElement.querySelector(".typing-text-span") || aiMsgElement.querySelector(".thinking-pill > span:first-child")) : null;
            const stages = [
                "Searching the web...",
                "Reading sources...",
                "Analyzing information...",
                "Preparing answer..."
            ];
            let stageIdx = 0;
            if (labelEl) labelEl.textContent = stages[0];
            searchInterval = setInterval(() => {
                stageIdx = (stageIdx + 1) % stages.length;
                if (labelEl) labelEl.textContent = stages[stageIdx];
            }, 1200);
        }

        // AbortController for Stop Generating feature
        const abortController = new AbortController();
        window._activeChatAbortController = abortController;

        const sendBtn = $("sendButton");
        const stopBtn = $("stopGenerateBtn");
        if (sendBtn) sendBtn.style.display = "none";
        if (stopBtn) {
            stopBtn.style.display = "inline-flex";
            stopBtn.onclick = () => {
                if (window._activeChatAbortController) {
                    window._activeChatAbortController.abort();
                    showToast("Generation stopped.", "info");
                }
            };
        }

        const submittedMessageText = messageText;

        // Robot companion reaction on user send
        window.nivoraRobotController?.onMessageSent?.();
        setTimeout(() => {
            if (window.nivoraRobotController && window.nivoraRobotController.state !== "HIDDEN") {
                window.nivoraRobotController.transitionTo("THINKING");
            }
        }, 320);

        try {
            let replyText = "";
            let sources = [];
            let images = [];
            let artifactData = null;
            let generatedFileData = null;
            let creationResult = null;

            if (creationIntent) {
                // Route to dedicated creation pipelines
                if (creationIntent.type === "image_edit") {
                    const editRes = await fetch("/api/generate-image", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            editPrompt: creationIntent.editPrompt,
                            originalImage: creationIntent.originalImage
                        }),
                        signal: abortController.signal
                    });
                    const editData = await editRes.json().catch(() => null);
                    if (editRes.ok && editData && editData.imageUrl) {
                        replyText = `Here is your transformed image with: **${creationIntent.editPrompt}**\n\n![Edited Image](${editData.imageUrl})`;
                        creationResult = {
                            type: "image_edit",
                            original: creationIntent.originalImage,
                            edited: editData.imageUrl,
                            prompt: creationIntent.editPrompt
                        };
                        saveToCreationGallery({
                            type: "image",
                            title: `Edited: ${creationIntent.editPrompt}`,
                            url: editData.imageUrl,
                            timestamp: Date.now()
                        });
                    } else {
                        throw new Error(editData?.error || "Image editing failed.");
                    }
                } else if (creationIntent.type === "presentation") {
                    const deckRes = await fetch("/api/generate-presentation", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ topic: creationIntent.topic, slideCount: 6 }),
                        signal: abortController.signal
                    });
                    const deckData = await deckRes.json().catch(() => null);
                    if (deckRes.ok && deckData && deckData.downloadUrl) {
                        replyText = `I have generated a ${deckData.slideCount}-slide presentation deck on **${deckData.topic}**.\n\nYou can review the key slide structure or download the complete presentation (.pptx) file below.`;
                        generatedFileData = {
                            name: deckData.filename,
                            type: "PPTX",
                            size: "Ready",
                            data: deckData.downloadUrl
                        };
                        creationResult = {
                            type: "presentation",
                            topic: deckData.topic,
                            slides: deckData.slides,
                            downloadUrl: deckData.downloadUrl
                        };
                        saveToCreationGallery({
                            type: "presentation",
                            title: deckData.topic,
                            downloadUrl: deckData.downloadUrl,
                            timestamp: Date.now()
                        });
                    } else {
                        throw new Error(deckData?.error || "Presentation generation failed.");
                    }
                } else if (creationIntent.type === "qr") {
                    const qrRes = await fetch("/api/generate-qr", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ text: creationIntent.payload, size: 400 }),
                        signal: abortController.signal
                    });
                    const qrData = await qrRes.json().catch(() => null);
                    if (qrRes.ok && qrData && qrData.qrDataUrl) {
                        replyText = `Here is your high-resolution QR code for: **${creationIntent.payload}**\n\n![QR Code](${qrData.qrDataUrl})`;
                        creationResult = {
                            type: "qr",
                            payload: creationIntent.payload,
                            qrDataUrl: qrData.qrDataUrl,
                            svgString: qrData.svgString
                        };
                        saveToCreationGallery({
                            type: "qr",
                            title: creationIntent.payload,
                            url: qrData.qrDataUrl,
                            timestamp: Date.now()
                        });
                    } else {
                        throw new Error(qrData?.error || "QR code generation failed.");
                    }
                } else {
                    // Image, Logo, or Poster generation
                    const imgRes = await fetch("/api/generate-image", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            prompt: creationIntent.prompt,
                            aspectRatio: creationIntent.aspectRatio || "1:1",
                            style: creationIntent.style || "photorealistic",
                            variations: creationIntent.variations || 1
                        }),
                        signal: abortController.signal
                    });
                    const imgData = await imgRes.json().catch(() => null);
                    if (imgRes.ok && imgData && imgData.imageUrl) {
                        const count = (imgData.variations && imgData.variations.length) || 1;
                        if (count > 1) {
                            replyText = `Here are ${count} generated variations for: **${creationIntent.prompt}** (Style: *${imgData.style}*)\n\n` +
                                imgData.variations.map((v, i) => `![Variation ${i + 1}](${v.url})`).join("\n\n");
                            creationResult = {
                                type: "image_variations",
                                prompt: creationIntent.prompt,
                                style: imgData.style,
                                variations: imgData.variations
                            };
                        } else {
                            const subj = (creationIntent.prompt || "artwork").replace(/^(a|an|the)\s+/i, "");
                            const emoji = getSubjectEmoji(subj);
                            replyText = `Here is your generated ${subj} image. ${emoji}`;
                            creationResult = {
                                type: "image",
                                prompt: creationIntent.prompt,
                                style: imgData.style,
                                imageUrl: imgData.imageUrl
                            };
                        }
                        saveToCreationGallery({
                            type: "image",
                            title: creationIntent.prompt,
                            url: imgData.imageUrl,
                            timestamp: Date.now()
                        });
                    } else {
                        let errDetail = "I can generate images, but the image-generation service is currently unavailable. Please try again.";
                        throw new Error(errDetail);
                    }
                }
            } else {
                // Standard Chat endpoint with client local time & date context
                const user = getUser();
                const clientDateObj = new Date();
                const clientTimeFormatted = new Intl.DateTimeFormat(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true
                }).format(clientDateObj);
                const clientDateFormatted = new Intl.DateTimeFormat(undefined, {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric"
                }).format(clientDateObj);
                const clientTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

                const payload = {
                    message: messageText,
                    history: chat.messages.slice(-8).map((m) => ({ role: m.role, content: m.content })),
                    webSearch: Boolean(webSearchEnabled || queryNeedsSearch),
                    userId: user.user_id || user.email || "anonymous",
                    clientTime: clientTimeFormatted,
                    clientDate: clientDateFormatted,
                    clientTimezone: clientTimezone,
                    clientTimestamp: clientDateObj.getTime(),
                    imageBase64: imageAttachments[0]?.data,
                    imageMime: imageAttachments[0]?.type,
                    images: imageAttachments.map(img => ({
                        data: img.data,
                        mimeType: img.type,
                        name: img.name
                    })),
                    file: fileAttachments[0] ? { name: fileAttachments[0].name, type: fileAttachments[0].type, content: fileAttachments[0].data } : undefined,
                    files: fileAttachments.map(f => ({ name: f.name, type: f.type, content: f.data }))
                };

                const response = await fetch("/chat", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "text/event-stream, application/json"
                    },
                    body: JSON.stringify({ ...payload, stream: true }),
                    signal: abortController.signal
                });

                if (!response.ok) {
                    let errMsg = null;
                    try {
                        const errJson = await response.json();
                        errMsg = errJson?.error || errJson?.message || errJson?.reply;
                    } catch (_) {}
                    if (!errMsg) {
                        if (response.status === 429) {
                            errMsg = "NIVORA AI service rate limit reached. Please wait a moment and try again.";
                        } else if (response.status === 503 || response.status === 502 || response.status === 504) {
                            errMsg = "NIVORA AI is temporarily unavailable. Please try again.";
                        } else {
                            errMsg = `Server returned status ${response.status}`;
                        }
                    }
                    throw new Error(errMsg);
                }

                const resContentType = response.headers.get("content-type") || "";
                let parsedResult = null;
                if (resContentType.includes("text/event-stream") && response.body) {
                    parsedResult = await ChatResponseParser.parseStreamResponse(response, aiMsgElement, abortController.signal);
                } else {
                    parsedResult = await ChatResponseParser.parseJsonResponse(response);
                }

                if (!parsedResult) {
                    throw new Error("NIVORA received an unexpected response format. Please try again.");
                }

                replyText = parsedResult.reply;
                sources = Array.isArray(parsedResult.sources) ? parsedResult.sources : [];
                images = Array.isArray(parsedResult.images) ? parsedResult.images : [];
                artifactData = parsedResult.artifact || null;
                generatedFileData = parsedResult.generatedFile || null;

                if (parsedResult.creation) {
                    creationResult = parsedResult.creation;
                } else if (parsedResult.generatedImage) {
                    creationResult = {
                        type: "image",
                        prompt: parsedResult.generatedImage.prompt || parsedResult.generatedImage.subject || "AI Artwork",
                        style: parsedResult.generatedImage.style,
                        imageUrl: parsedResult.generatedImage.url
                    };
                }

                // Intercept & ensure no raw tool calls or action JSON are displayed
                replyText = stripToolCallJSON(replyText);

                if (!replyText) {
                    replyText = "I'm here to help with your questions, coding, research, files, and images. What would you like to explore?";
                }

                if (parsedResult.provider) {
                    const providerEl = $("providerName");
                    if (providerEl) providerEl.textContent = parsedResult.provider;
                }
            }

            if (searchInterval) {
                clearInterval(searchInterval);
                searchInterval = null;
            }

            // Generate AI response timestamp using current local time
            const aiNow = new Date();
            const aiTimestamp = aiNow.getTime();
            // Render AI Response with creation payload if available
            renderAIResponse(aiMsgElement.querySelector(".message-content"), replyText, sources, artifactData, images, aiTimestamp, generatedFileData, creationResult);
            window.nivoraRobotController?.onAssistantResponse?.();

            // Save AI message to history
            chat.messages.push({
                role: "assistant",
                content: replyText,
                sources: sources.length > 0 ? sources : undefined,
                images: images.length > 0 ? images : undefined,
                artifact: artifactData || undefined,
                generatedFile: generatedFileData || undefined,
                creation: creationResult || undefined,
                timestamp: aiTimestamp
            });
            chat.updatedAt = aiTimestamp;
            saveChats();

        } catch (error) {
            if (aiMsgElement && aiMsgElement._typingEllipsisInterval) {
                clearInterval(aiMsgElement._typingEllipsisInterval);
            }
            if (error.name === "AbortError") {
                const contentDiv = aiMsgElement.querySelector(".message-content");
                if (contentDiv) {
                    contentDiv.innerHTML = `<span style="color:#94a3b8;font-style:italic;">⏹ Generation stopped by user.</span>`;
                }
            } else {
                console.error("Chat error:", error);
                let errorText = "Sorry, I couldn't process that request right now. Please try again.";
                if (error && error.message) {
                    if (error.message.includes("image-generation service is currently unavailable")) {
                        errorText = "I can generate images, but the image-generation service is currently unavailable. Please try again.";
                    } else if (error.message.includes("rate limit")) {
                        errorText = "NIVORA AI service rate limit reached. Please wait a moment and try again.";
                    }
                }

                const contentDiv = aiMsgElement.querySelector(".message-content");
                if (contentDiv) {
                    contentDiv.innerHTML = `
                        <div style="display:flex;flex-direction:column;gap:10px;align-items:flex-start;">
                            <span style="color:#e2e8f0;">${escapeHTML(errorText)}</span>
                            <button type="button" class="nivora-retry-btn" id="retryMsgBtn">🔄 Retry</button>
                        </div>
                    `;
                    const retryBtn = contentDiv.querySelector("#retryMsgBtn");
                    if (retryBtn) {
                        retryBtn.onclick = () => {
                            aiMsgElement.remove();
                            const input = $("messageInput");
                            if (input && submittedMessageText) {
                                input.value = submittedMessageText;
                                sendMessage();
                            }
                        };
                    }
                }
                const errTime = new Date().getTime();
                chat.messages.push({
                    role: "assistant",
                    content: errorText,
                    timestamp: errTime
                });
                chat.updatedAt = errTime;
                saveChats();
                window.nivoraRobotController?.onErrorResponse?.();
            }
        } finally {
            if (searchInterval) {
                clearInterval(searchInterval);
                searchInterval = null;
            }
            window._activeChatAbortController = null;
            if (sendBtn) sendBtn.style.display = "inline-flex";
            if (stopBtn) stopBtn.style.display = "none";
        }

        scrollToBottom();
    }

    // Auto-resize textarea for multi-line paste & typing
    function adjustMessageInputHeight(el) {
        if (!el) el = $("messageInput");
        if (!el) return;
        el.style.height = "auto";
        const scHeight = el.scrollHeight;
        const targetHeight = Math.min(Math.max(scHeight, 38), 280);
        el.style.height = targetHeight + "px";
        el.style.overflowY = scHeight > 280 ? "auto" : "hidden";
    }

    // Convert pasted rich HTML (from ChatGPT, Word, Docs, web) into clean Markdown
    function convertHtmlToMarkdown(html) {
        if (!html || typeof html !== "string") return "";
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const body = doc.body;
            if (!body) return "";

            function walk(node) {
                if (!node) return "";
                if (node.nodeType === Node.TEXT_NODE) {
                    return node.nodeValue || "";
                }
                if (node.nodeType !== Node.ELEMENT_NODE) {
                    return "";
                }

                const tag = node.tagName.toLowerCase();

                // Markdown tables
                if (tag === "table") {
                    const rows = Array.from(node.querySelectorAll("tr"));
                    if (rows.length === 0) return "";
                    let mdTable = "\n\n";
                    const firstRowCells = Array.from(rows[0].querySelectorAll("th, td"));
                    const colCount = firstRowCells.length;
                    if (colCount === 0) return "";

                    const headers = firstRowCells.map(c => (c.textContent || "").trim().replace(/\|/g, "\\|"));
                    mdTable += "| " + headers.join(" | ") + " |\n";
                    mdTable += "| " + headers.map(() => "---").join(" | ") + " |\n";

                    const isFirstHeader = rows[0].querySelector("th");
                    const dataRows = isFirstHeader ? rows.slice(1) : rows.slice(1);
                    dataRows.forEach(r => {
                        const cells = Array.from(r.querySelectorAll("td, th")).map(c => (c.textContent || "").trim().replace(/\|/g, "\\|"));
                        while (cells.length < colCount) cells.push("");
                        mdTable += "| " + cells.slice(0, colCount).join(" | ") + " |\n";
                    });
                    return mdTable + "\n";
                }

                // Code block
                if (tag === "pre") {
                    const codeEl = node.querySelector("code") || node;
                    const langClass = (codeEl.className || "").match(/language-([a-zA-Z0-9_-]+)/i);
                    const lang = langClass ? langClass[1].toLowerCase() : "";
                    const codeText = (codeEl.textContent || "").trim();
                    return "\n```" + lang + "\n" + codeText + "\n```\n";
                }

                // Numbered / Ordered list
                if (tag === "ol") {
                    let res = "\n";
                    let idx = 1;
                    Array.from(node.children).forEach(child => {
                        if (child.tagName.toLowerCase() === "li") {
                            res += `${idx}. ` + Array.from(child.childNodes).map(walk).join("").trim() + "\n";
                            idx++;
                        }
                    });
                    return res + "\n";
                }

                // Bullet / Unordered list
                if (tag === "ul") {
                    let res = "\n";
                    Array.from(node.children).forEach(child => {
                        if (child.tagName.toLowerCase() === "li") {
                            res += "- " + Array.from(child.childNodes).map(walk).join("").trim() + "\n";
                        }
                    });
                    return res + "\n";
                }

                // Headings
                if (/^h[1-6]$/.test(tag)) {
                    const level = parseInt(tag[1], 10);
                    return "\n\n" + "#".repeat(level) + " " + Array.from(node.childNodes).map(walk).join("").trim() + "\n\n";
                }

                // Paragraphs & Divs
                if (tag === "p" || tag === "div") {
                    const inner = Array.from(node.childNodes).map(walk).join("");
                    return inner ? "\n" + inner.trim() + "\n" : "\n";
                }

                if (tag === "br") return "\n";
                if (tag === "strong" || tag === "b") return "**" + Array.from(node.childNodes).map(walk).join("") + "**";
                if (tag === "em" || tag === "i") return "*" + Array.from(node.childNodes).map(walk).join("") + "*";
                if (tag === "code") return "`" + (node.textContent || "") + "`";
                if (tag === "blockquote") {
                    const inner = Array.from(node.childNodes).map(walk).join("").trim();
                    return "\n\n> " + inner.split("\n").join("\n> ") + "\n\n";
                }
                if (tag === "a") {
                    const href = node.getAttribute("href") || "";
                    const text = Array.from(node.childNodes).map(walk).join("").trim();
                    return href ? `[${text || href}](${href})` : text;
                }

                return Array.from(node.childNodes).map(walk).join("");
            }

            return walk(body).trim();
        } catch (e) {
            console.warn("convertHtmlToMarkdown error:", e);
            return "";
        }
    }

    // Detect if pasted/rendered text is raw source code without backticks
    function detectCodeSnippet(text) {
        if (!text || typeof text !== "string") return null;
        const trimmed = text.trim();
        const lines = trimmed.split("\n");
        if (lines.length < 2) return null;

        // C / C++
        if (/#include\s*[<"][^>"]+[>"]/.test(trimmed) || (/\bint\s+main\s*\(/.test(trimmed) && /[{};]/.test(trimmed)) || (/\bprintf\s*\(/.test(trimmed) && /[{};]/.test(trimmed))) {
            return "c";
        }
        // Python
        if (/^\s*(def\s+[a-zA-Z0-9_]+\s*\(|from\s+[a-zA-Z0-9_\.]+\s+import|import\s+[a-zA-Z0-9_]+|class\s+[a-zA-Z0-9_]+(\(.*?\))?:)/m.test(trimmed) && /:\s*$/m.test(trimmed)) {
            return "python";
        }
        // JavaScript / TypeScript
        if ((/\b(const|let|var)\s+[a-zA-Z0-9_$]+\s*=/.test(trimmed) || /\bfunction\s+[a-zA-Z0-9_$]+\s*\(/.test(trimmed) || /\bconsole\.(log|error|warn)\s*\(/.test(trimmed)) && /[{};]/.test(trimmed)) {
            return "javascript";
        }
        // HTML / XML
        if (/^\s*<(!DOCTYPE|html|svg|div|p|span|table|head|body)/i.test(trimmed) && /<\/[a-zA-Z0-9]+>\s*$/i.test(trimmed)) {
            return "html";
        }
        // SQL
        if (/^\s*(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE)\b/i.test(trimmed) && /;\s*$/m.test(trimmed)) {
            return "sql";
        }
        // Java / C#
        if (/\b(public\s+class|private\s+class|public\s+static\s+void\s+main|System\.out\.println)/.test(trimmed) && /[{};]/.test(trimmed)) {
            return "java";
        }
        return null;
    }

    // Auto-wrap raw code snippets into markdown code fences
    function autoFenceCodeBlocks(rawText) {
        if (!rawText || rawText.includes("```")) return rawText;
        const trimmed = rawText.trim();
        const detected = detectCodeSnippet(trimmed);
        if (detected) {
            return "```" + detected + "\n" + trimmed + "\n```";
        }
        return rawText;
    }

    // Resilient fallback markdown parser if marked is unavailable
    function fallbackMarkdownParse(text) {
        if (!text) return "";
        let html = escapeHTML(text);

        // Code blocks
        html = html.replace(/```([a-zA-Z0-9_+-]*)\s*\n?([\s\S]*?)```/g, (m, lang, code) => {
            return `<pre><code class="language-${lang || 'plaintext'}">${code}</code></pre>`;
        });

        // Inline code
        html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

        // Headers
        html = html.replace(/^###### (.*$)/gim, "<h6>$1</h6>");
        html = html.replace(/^##### (.*$)/gim, "<h5>$1</h5>");
        html = html.replace(/^#### (.*$)/gim, "<h4>$1</h4>");
        html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
        html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
        html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");

        // Blockquotes
        html = html.replace(/^\> (.*$)/gim, "<blockquote>$1</blockquote>");

        // Bold & Italic
        html = html.replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>");
        html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
        html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
        html = html.replace(/~~(.*?)~~/g, "<del>$1</del>");

        // Numbered / ordered lists
        html = html.replace(/(?:^|\n)(\d+\.\s+[^\n]+(?:\n\d+\.\s+[^\n]+)*)/g, (m, listBlock) => {
            const items = listBlock.trim().split("\n").map(li => li.replace(/^\d+\.\s+/, "").trim());
            return "\n<ol>" + items.map(it => `<li>${it}</li>`).join("") + "</ol>\n";
        });

        // Unordered bullet lists
        html = html.replace(/(?:^|\n)([-*]\s+[^\n]+(?:\n[-*]\s+[^\n]+)*)/g, (m, listBlock) => {
            const items = listBlock.trim().split("\n").map(li => li.replace(/^[-*]\s+/, "").trim());
            return "\n<ul>" + items.map(it => `<li>${it}</li>`).join("") + "</ul>\n";
        });

        // Tables
        html = html.replace(/(?:^|\n)(\|[^\n]+\|\r?\n\|[-:\s|]+\|\r?\n(?:\|[^\n]+\|\r?\n?)+)/g, (m, tableBlock) => {
            const lines = tableBlock.trim().split("\n");
            if (lines.length < 2) return tableBlock;
            const headers = lines[0].split("|").slice(1, -1).map(h => `<th>${h.trim()}</th>`).join("");
            const bodyRows = lines.slice(2).map(row => {
                const cells = row.split("|").slice(1, -1).map(c => `<td>${c.trim()}</td>`).join("");
                return `<tr>${cells}</tr>`;
            }).join("");
            return `<table><thead><tr>${headers}</tr></thead><tbody>${bodyRows}</tbody></table>`;
        });

        // Horizontal rules
        html = html.replace(/^---$/gim, "<hr>");

        // Line breaks & paragraphs
        html = html.replace(/\n\n+/g, "</p><p>");
        html = html.replace(/\n/g, "<br>");

        return "<p>" + html + "</p>";
    }

    // Enhance code blocks with language header, copy button, Live Canvas preview, and highlight.js
    function enhanceCodeBlocksInContainer(container) {
        if (!container) return;
        const preEls = container.querySelectorAll("pre");
        preEls.forEach((pre) => {
            if (pre.parentElement && pre.parentElement.classList.contains("code-block-wrapper")) {
                return;
            }
            const codeEl = pre.querySelector("code") || pre;
            let lang = "plaintext";
            const langMatch = (codeEl.className || "").match(/language-([a-zA-Z0-9_+-]+)/i);
            if (langMatch) {
                lang = langMatch[1].toLowerCase();
            } else {
                const detected = detectCodeSnippet(codeEl.textContent || "");
                if (detected) lang = detected;
            }

            const codeText = (codeEl.textContent || "").trim();

            const wrapper = document.createElement("div");
            wrapper.className = "code-block-wrapper";

            const header = document.createElement("div");
            header.className = "code-header";

            const langSpan = document.createElement("span");
            langSpan.textContent = lang.toUpperCase();
            header.appendChild(langSpan);

            const headerActions = document.createElement("div");
            headerActions.style.display = "flex";
            headerActions.style.gap = "8px";

            // Live Canvas preview for web / SVG code
            if (["html", "svg", "jsx", "tsx", "xml"].includes(lang) || codeText.includes("<html") || codeText.includes("<svg") || codeText.includes("<!DOCTYPE")) {
                const canvasBtn = document.createElement("button");
                canvasBtn.type = "button";
                canvasBtn.className = "code-copy-btn";
                canvasBtn.innerHTML = "▶ Preview in Canvas";
                canvasBtn.onclick = () => {
                    openArtifactCanvas({
                        type: lang,
                        title: "Code Preview",
                        code: codeText
                    });
                };
                headerActions.appendChild(canvasBtn);
            }

            const copyBtn = document.createElement("button");
            copyBtn.type = "button";
            copyBtn.className = "code-copy-btn";
            copyBtn.innerHTML = "📋 Copy";
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(codeText);
                copyBtn.innerHTML = "✅ Copied!";
                setTimeout(() => { copyBtn.innerHTML = "📋 Copy"; }, 2000);
            };
            headerActions.appendChild(copyBtn);
            header.appendChild(headerActions);

            if (window.hljs) {
                try {
                    hljs.highlightElement(codeEl);
                } catch (err) {}
            }

            if (pre.parentNode) {
                pre.parentNode.insertBefore(wrapper, pre);
                wrapper.appendChild(header);
                wrapper.appendChild(pre);
            }
        });
    }

    // Unified formatted markdown & code renderer for both user and assistant messages
    function renderFormattedContent(container, rawText, options = {}) {
        if (!container) return;
        rawText = (rawText || "").trim();
        if (!rawText) {
            container.innerHTML = "";
            return;
        }

        const processedText = autoFenceCodeBlocks(rawText);

        let html = "";
        if (window.marked && typeof window.marked.parse === "function") {
            try {
                html = window.marked.parse(processedText, {
                    gfm: true,
                    breaks: true,
                    pedantic: false
                });
            } catch (err) {
                console.warn("marked.parse failed, using fallback:", err);
                html = fallbackMarkdownParse(processedText);
            }
        } else {
            html = fallbackMarkdownParse(processedText);
        }

        if (window.DOMPurify && typeof window.DOMPurify.sanitize === "function") {
            html = window.DOMPurify.sanitize(html, {
                ADD_ATTR: ["target", "rel", "class", "style"]
            });
        }

        const wrapper = document.createElement("div");
        wrapper.className = "formatted-markdown-body";
        wrapper.innerHTML = html;

        enhanceCodeBlocksInContainer(wrapper);

        wrapper.querySelectorAll("a").forEach((a) => {
            a.setAttribute("target", "_blank");
            a.setAttribute("rel", "noopener noreferrer");
        });

        container.appendChild(wrapper);
    }

    function addUserMessage(msg) {
        const messages = $("messages");
        if (!messages) return;

        const row = document.createElement("div");
        row.className = "message user-message";

        const content = document.createElement("div");
        content.className = "message-content";

        const attList = (Array.isArray(msg.attachments) && msg.attachments.length > 0)
            ? msg.attachments
            : (msg.attachment ? [msg.attachment] : []);

        if (attList.length > 0) {
            const attWrap = document.createElement("div");
            attWrap.className = "user-attachments-grid";
            attWrap.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;";
            for (const att of attList) {
                if (att.isImage) {
                    const imgWrap = document.createElement("div");
                    imgWrap.className = "user-attachment-preview";
                    const img = document.createElement("img");
                    img.alt = att.name || "Attached photo";

                    if (att.previewUrl) {
                        img.src = att.previewUrl;
                    } else if (att.data) {
                        img.src = att.data;
                    } else if (att.id) {
                        // Hydrate from IndexedDB seamlessly
                        nivoraDb.getAttachment(att.id).then((saved) => {
                            if (saved && saved.data) {
                                img.src = saved.data;
                                att.data = saved.data;
                            }
                        }).catch(() => {});
                    }

                    img.onclick = () => {
                        openImagePreview({
                            src: img.src || att.data || att.previewUrl,
                            title: att.name || "Attached Image",
                            sourceUrl: "",
                            domain: "User Upload"
                        });
                    };

                    imgWrap.appendChild(img);
                    attWrap.appendChild(imgWrap);
                } else {
                    const fileTag = document.createElement("div");
                    fileTag.style.cssText = "font-size:11px;opacity:0.85;display:flex;align-items:center;gap:6px;background:rgba(255,255,255,0.06);padding:4px 8px;border-radius:6px;";
                    const icon = (att.isPdf || att.type?.includes("pdf") || att.name?.endsWith(".pdf")) ? "📄" : "📁";
                    fileTag.innerHTML = `${icon} <strong>${escapeHTML(att.name || "File")}</strong>`;
                    attWrap.appendChild(fileTag);
                }
            }
            content.appendChild(attWrap);
        }

        if (msg.content) {
            const textWrap = document.createElement("div");
            textWrap.className = "user-text-content";
            renderFormattedContent(textWrap, msg.content, { isUser: true });
            content.appendChild(textWrap);
        }

        // Add Timestamp
        const rawTime = (msg && msg.timestamp) ? msg.timestamp : new Date().getTime();
        const timeStr = formatMessageTimestamp(rawTime);
        const timeSpan = document.createElement("span");
        timeSpan.className = "message-timestamp";
        timeSpan.textContent = timeStr;
        timeSpan.title = formatMessageDate(rawTime);
        content.appendChild(timeSpan);

        const user = getUser();
        const avatarDiv = document.createElement("div");
        avatarDiv.className = "user-msg-avatar";
        if (user.profile_picture) {
            avatarDiv.innerHTML = `<img src="${user.profile_picture}" alt="${escapeHTML(user.name || 'User')}">`;
        } else {
            const initial = (user.name || user.email || "U").charAt(0).toUpperCase();
            avatarDiv.innerHTML = `<span>${initial}</span>`;
        }

        row.appendChild(content);
        row.appendChild(avatarDiv);
        messages.appendChild(row);
        scrollToBottom();
    }

    function addAIMessageSkeleton(label = "NIVORA is thinking...") {
        const messages = $("messages");
        if (!messages) return null;

        const row = document.createElement("div");
        row.className = "message ai-message typing-indicator-active";

        const icon = document.createElement("div");
        icon.className = "ai-icon";
        const iconImg = document.createElement("img");
        iconImg.src = "/assets/nivora-logo.png";
        iconImg.alt = "NIVORA";
        icon.appendChild(iconImg);

        const content = document.createElement("div");
        content.className = "message-content";

        content.innerHTML = `
            <div class="dynamic-typing-indicator thinking-container" id="dynamicTypingIndicator" role="status" aria-live="polite">
                <div class="typing-bubble thinking-pill">
                    <div class="typing-pulse-beacon">
                        <span class="beacon-core"></span>
                        <span class="beacon-ring"></span>
                    </div>
                    <span class="typing-label-text">
                        <span class="typing-text-span">${label}</span>
                    </span>
                    <div class="typing-dots-wave thinking-dots" aria-hidden="true">
                        <span class="typing-wave-dot thinking-dot"></span>
                        <span class="typing-wave-dot thinking-dot"></span>
                        <span class="typing-wave-dot thinking-dot"></span>
                    </div>
                </div>
            </div>
        `;

        row.appendChild(icon);
        row.appendChild(content);
        messages.appendChild(row);
        scrollToBottom();

        // Dynamic typing ellipsis cycle (e.g. . -> .. -> ...)
        const textSpan = content.querySelector(".typing-text-span");
        if (textSpan && (label.includes("thinking") || label.includes("NIVORA"))) {
            const cleanBase = label.replace(/\.+$/, "");
            let dotCycle = 3;
            const ellipsisInterval = setInterval(() => {
                if (!document.body.contains(row) || !row.isConnected) {
                    clearInterval(ellipsisInterval);
                    return;
                }
                dotCycle = (dotCycle % 3) + 1;
                if (textSpan && textSpan.textContent.startsWith(cleanBase)) {
                    textSpan.textContent = `${cleanBase}${'.'.repeat(dotCycle)}`;
                }
            }, 450);
            row._typingEllipsisInterval = ellipsisInterval;
        }

        return row;
    }

    function getSubjectEmoji(subject) {
        const s = (subject || "").toLowerCase();
        if (s.includes("lion")) return "🦁";
        if (s.includes("cat") || s.includes("kitten")) return "🐱";
        if (s.includes("dog") || s.includes("puppy")) return "🐶";
        if (s.includes("tiger")) return "🐯";
        if (s.includes("bear")) return "🐻";
        if (s.includes("wolf")) return "🐺";
        if (s.includes("fox")) return "🦊";
        if (s.includes("bird") || s.includes("eagle") || s.includes("parrot")) return "🦅";
        if (s.includes("horse")) return "🐎";
        if (s.includes("elephant")) return "🐘";
        if (s.includes("dragon")) return "🐉";
        if (s.includes("robot") || s.includes("cyborg") || s.includes("ai")) return "🤖";
        if (s.includes("car") || s.includes("ferrari") || s.includes("lamborghini") || s.includes("tesla")) return "🏎️";
        if (s.includes("flower") || s.includes("rose")) return "🌹";
        if (s.includes("space") || s.includes("galaxy") || s.includes("planet") || s.includes("star")) return "🌌";
        if (s.includes("city") || s.includes("building") || s.includes("skyline")) return "🏙️";
        if (s.includes("mountain") || s.includes("landscape") || s.includes("nature")) return "🏔️";
        if (s.includes("beach") || s.includes("ocean") || s.includes("sea")) return "🌊";
        return "🎨";
    }

    function renderNivoraImageCard(container, data) {
        if (!container || !data || (!data.imageUrl && !data.url)) return;
        const imgUrl = data.imageUrl || data.url;
        const prompt = (data.prompt || "AI Artwork").trim();
        const cleanPrompt = prompt.replace(/^(a|an|the)\s+/i, "");
        const style = data.style || "Photorealistic";
        const downloadName = cleanPrompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30) || "generated";

        const card = document.createElement("div");
        card.className = "nivora-image-card";
        card.innerHTML = `
            <div class="nivora-image-preview-wrapper" title="Click to view full screen">
                <img src="${escapeHTML(imgUrl)}" alt="${escapeHTML(cleanPrompt)}" loading="lazy">
            </div>
            <div class="nivora-image-card-bar">
                <div class="nivora-image-card-info">
                    <span class="nivora-image-card-title">${escapeHTML(cleanPrompt)}</span>
                    <span class="nivora-image-card-badge">✨ ${escapeHTML(style.toUpperCase())}</span>
                </div>
                <div class="nivora-image-card-actions">
                    <a href="${escapeHTML(imgUrl)}" download="nivora-${escapeHTML(downloadName)}.png" class="nivora-img-action-btn primary" title="Download image">
                        ⬇ Download
                    </a>
                    <button type="button" class="nivora-img-action-btn nivora-open-view-btn" title="Open full view">
                        🔍 Open/View
                    </button>
                    <button type="button" class="nivora-img-action-btn nivora-regenerate-btn" title="Regenerate image">
                        🔄 Regenerate
                    </button>
                    <button type="button" class="nivora-img-action-btn nivora-copy-prompt-btn" title="Copy prompt">
                        📋 Copy Prompt
                    </button>
                    <button type="button" class="nivora-img-action-btn nivora-share-img-btn" title="Share image">
                        🔗 Share
                    </button>
                </div>
            </div>
        `;

        card.querySelector(".nivora-image-preview-wrapper")?.addEventListener("click", () => {
            openImagePreview({ src: imgUrl, title: cleanPrompt, domain: "NIVORA AI Generator" });
        });

        card.querySelector(".nivora-open-view-btn")?.addEventListener("click", () => {
            openImagePreview({ src: imgUrl, title: cleanPrompt, domain: "NIVORA AI Generator" });
        });

        card.querySelector(".nivora-regenerate-btn")?.addEventListener("click", () => {
            const input = $("messageInput");
            if (input) {
                input.value = `generate ${cleanPrompt} image`;
                input.focus();
                sendMessage();
            }
        });

        card.querySelector(".nivora-copy-prompt-btn")?.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(cleanPrompt);
                showToast("Prompt copied to clipboard! 📋", "success");
            } catch (_) {
                showToast("Could not copy prompt.", "warning");
            }
        });

        card.querySelector(".nivora-share-img-btn")?.addEventListener("click", async () => {
            if (navigator.share) {
                try {
                    await navigator.share({
                        title: `NIVORA AI Artwork: ${cleanPrompt}`,
                        text: `Check out this AI image generated with NIVORA: "${cleanPrompt}"`,
                        url: imgUrl
                    });
                    return;
                } catch (_) {}
            }
            try {
                await navigator.clipboard.writeText(imgUrl);
                showToast("Image link copied to clipboard! 🔗", "success");
            } catch (_) {
                showToast("Could not copy image link.", "warning");
            }
        });

        container.appendChild(card);
    }

    function renderAIResponse(container, text, sources = [], artifact = null, images = [], msgTimestamp = null, generatedFile = null, creation = null) {
        if (!container) return;
        const parentRow = container.closest(".message");
        if (parentRow && parentRow._typingEllipsisInterval) {
            clearInterval(parentRow._typingEllipsisInterval);
            delete parentRow._typingEllipsisInterval;
        }
        container.innerHTML = "";

        // Extract any inline generated file data URLs from text if generatedFile wasn't passed explicitly
        if (!generatedFile && text) {
            const fileDataMatch = text.match(/data:(application\/[a-z0-9\.\-\+]+|text\/[a-z0-9\.\-\+]+);base64,([A-Za-z0-9+/=]{40,})/i);
            if (fileDataMatch) {
                const mime = fileDataMatch[1].toLowerCase();
                const rawB64 = fileDataMatch[0];
                let ext = "file";
                if (mime.includes("pdf")) ext = "pdf";
                else if (mime.includes("json")) ext = "json";
                else if (mime.includes("csv")) ext = "csv";
                else if (mime.includes("zip")) ext = "zip";
                else if (mime.includes("sheet") || mime.includes("excel")) ext = "xlsx";
                else if (mime.includes("word") || mime.includes("document")) ext = "docx";
                else if (mime.includes("text")) ext = "txt";

                generatedFile = {
                    name: `generated-document.${ext}`,
                    type: ext.toUpperCase(),
                    size: `${(rawB64.length * 0.75 / 1024).toFixed(1)} KB`,
                    data: rawB64
                };
            }
        }

        // Check if image markdown is present
        const imgRegex = /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[^)]+|https?:\/\/[^)]+)\)/g;
        let processedText = text || "";
        const generatedImages = [];
        let imgMatch;

        while ((imgMatch = imgRegex.exec(processedText)) !== null) {
            generatedImages.push({ alt: imgMatch[1], src: imgMatch[2] });
        }
        processedText = processedText.replace(imgRegex, "").trim();

        // Clean text of all data URLs, raw base64 blobs, raw download tags, and stray HTML tags
        processedText = processedText
            .replace(/<a\s+[^>]*href=["']data:[^"']+["'][^>]*>[\s\S]*?<\/a>/gi, "")
            .replace(/\[([^\]]*)\]\(data:[^)]+\)/gi, "$1")
            .replace(/data:(application|text|image)\/[^;]+;base64,[A-Za-z0-9+/=]{30,}/gi, "")
            .replace(/<a\s+[^>]*download[^>]*>[\s\S]*?<\/a>/gi, "")
            .replace(/<\/?(iframe|embed|object|script|style)[^>]*>/gi, "")
            .trim();

        // Never display raw tool calls, action JSON, or internal reasoning in UI
        processedText = stripToolCallJSON(processedText);

        // Render Code Blocks, Tables & Full Markdown
        renderFormattedContent(container, processedText, { isUser: false });

        // Render Generated Images if any
        if (generatedImages.length > 0) {
            generatedImages.forEach((imgObj) => {
                renderNivoraImageCard(container, {
                    imageUrl: imgObj.src,
                    prompt: imgObj.alt || "AI Image",
                    style: "Photorealistic"
                });
            });
        }

        // Render Web Image Search Results in responsive grid
        if (images && images.length > 0) {
            const galleryWrap = document.createElement("div");
            galleryWrap.className = "web-images-gallery";
            galleryWrap.innerHTML = `
                <div class="web-images-header">
                    <span>🖼️ Web Images</span>
                    <span class="images-count-badge">${images.length}</span>
                </div>
                <div class="web-images-grid"></div>
            `;
            const grid = galleryWrap.querySelector(".web-images-grid");
            images.forEach((img) => {
                if (!img || (!img.image && !img.thumbnail)) return;
                const card = document.createElement("div");
                card.className = "web-image-card";
                card.title = "Click to view image preview";

                const imgSrc = img.thumbnail || img.image;
                const fullSrc = img.image || img.thumbnail;
                const title = img.title || "Web Image";
                let domain = "";
                try {
                    domain = new URL(img.sourceUrl || fullSrc).hostname.replace(/^www\./, "");
                } catch {
                    domain = "";
                }

                card.innerHTML = `
                    <div class="web-image-thumb-wrap">
                        <img src="${escapeHTML(imgSrc)}" alt="${escapeHTML(title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.web-image-card').style.display='none'">
                    </div>
                    <div class="web-image-info">
                        <span class="web-image-title">${escapeHTML(title)}</span>
                        ${domain ? `<span class="web-image-source">${escapeHTML(domain)}</span>` : ""}
                    </div>
                `;

                card.onclick = () => {
                    openImagePreview({
                        src: fullSrc,
                        title: title,
                        sourceUrl: img.sourceUrl || fullSrc,
                        domain: domain
                    });
                };

                grid.appendChild(card);
            });
            container.appendChild(galleryWrap);
        }

        // Render Artifact Card if artifact detected
        if (artifact) {
            const banner = document.createElement("div");
            banner.className = "artifact-banner";
            banner.innerHTML = `
                <div class="artifact-info">
                    <span>⚡ Generated Live Artifact: <strong>${escapeHTML(artifact.title || "Interactive View")}</strong></span>
                </div>
                <button type="button" class="open-canvas-btn">Open in Canvas</button>
            `;
            banner.querySelector(".open-canvas-btn").onclick = () => {
                openArtifactCanvas(artifact);
            };
            container.appendChild(banner);
        }

        // Render Grounding Sources with Favicons, Site Name, Article Title and direct link
        if (sources && sources.length > 0) {
            const sourcesWrap = document.createElement("div");
            sourcesWrap.className = "grounding-sources";
            sourcesWrap.innerHTML = `
                <div class="sources-header">
                    <span>🌐 Verified Sources</span>
                    <span class="sources-count-badge">${sources.length}</span>
                </div>
                <div class="sources-grid"></div>
            `;
            const grid = sourcesWrap.querySelector(".sources-grid");
            sources.forEach((s) => {
                if (!s || !s.url) return;
                const a = document.createElement("a");
                a.className = "source-card";
                a.href = s.url;
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                let domain = "";
                try {
                    domain = new URL(s.url).hostname.replace(/^www\./, "");
                } catch {
                    domain = s.domain || "";
                }
                const displayTitle = s.title || domain || s.url;
                a.title = `${displayTitle}${domain ? " (" + domain + ")" : ""}`;
                a.innerHTML = `
                    <div class="source-card-header">
                        <img class="source-favicon" src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32" alt="" width="14" height="14" loading="lazy" onerror="this.style.display='none'">
                        <span class="source-domain">${escapeHTML(domain)}</span>
                    </div>
                    <div class="source-card-title">${escapeHTML(displayTitle)}</div>
                `;
                grid.appendChild(a);
            });
            container.appendChild(sourcesWrap);
        }

        // Render Generated File Download Card if present
        if (generatedFile && generatedFile.data) {
            const ext = (generatedFile.name || "").split(".").pop()?.toLowerCase() || (generatedFile.type || "").toLowerCase();
            let icon = "📄";
            if (ext.includes("pdf")) icon = "📄";
            else if (ext.includes("doc")) icon = "📝";
            else if (ext.includes("xls") || ext.includes("sheet")) icon = "📊";
            else if (ext.includes("ppt")) icon = "📽️";
            else if (ext.includes("csv")) icon = "📑";
            else if (ext.includes("json")) icon = "{}";
            else if (ext.includes("zip")) icon = "🗜️";
            else if (ext.includes("txt") || ext.includes("md")) icon = "📃";

            const fileCard = document.createElement("div");
            fileCard.className = "nivora-generated-file-card";
            fileCard.innerHTML = `
                <div class="file-icon">${icon}</div>
                <div class="file-details">
                    <div class="file-title">${escapeHTML(generatedFile.name || "Generated File")}</div>
                    <div class="file-subtext">${escapeHTML(generatedFile.type || ext.toUpperCase())} • ${escapeHTML(generatedFile.size || "Ready")}</div>
                </div>
                <div class="file-card-actions">
                    <button type="button" class="file-card-preview-btn">👁️ Preview</button>
                    <a href="${escapeHTML(generatedFile.data)}" download="${escapeHTML(generatedFile.name || "download")}" class="file-download-btn">
                        ⬇ Download
                    </a>
                </div>
            `;
            fileCard.querySelector(".file-card-preview-btn")?.addEventListener("click", () => {
                openFilePreview(generatedFile);
            });
            container.appendChild(fileCard);
        }

        // Render Creation Card if specialized generation payload exists
        if (creation) {
            renderCreationCard(container, creation);
        }

        // Render Mermaid Diagrams if present in markdown code blocks
        if (window.mermaid) {
            container.querySelectorAll("pre code.language-mermaid, .language-mermaid").forEach((el, idx) => {
                const rawDiagram = el.textContent || "";
                if (rawDiagram.trim()) {
                    const diagId = "mermaid-diag-" + Date.now() + "-" + idx;
                    const wrap = document.createElement("div");
                    wrap.className = "in-chat-mermaid-wrap";
                    wrap.style.cssText = "background:#0f121a;border:1px solid rgba(108,99,255,0.25);border-radius:12px;padding:16px;margin:12px 0;overflow-x:auto;";
                    try {
                        window.mermaid.render(diagId, rawDiagram).then(({ svg }) => {
                            wrap.innerHTML = `
                                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                                    <span style="font-size:12px;color:#38bdf8;font-weight:600;">🔀 Interactive Flowchart</span>
                                    <div style="display:flex;gap:6px;">
                                        <button type="button" class="msg-action-pill copy-diag-btn" style="font-size:11px;">📋 Copy</button>
                                    </div>
                                </div>
                                <div class="mermaid-svg-container">${svg}</div>
                            `;
                            wrap.querySelector(".copy-diag-btn")?.addEventListener("click", () => {
                                navigator.clipboard.writeText(rawDiagram);
                                showToast("Diagram code copied! 📋", "success");
                            });
                            const pre = el.closest("pre") || el;
                            if (pre && pre.parentNode) {
                                pre.parentNode.replaceChild(wrap, pre);
                            }
                        }).catch(console.warn);
                    } catch (mErr) {
                        console.warn("Mermaid render error:", mErr);
                    }
                }
            });
        }

        // Add Message Action Bar (Copy, Regenerate, Like, Dislike, Share, Speak, Timestamp)
        const actionBar = document.createElement("div");
        actionBar.className = "message-action-bar";

        // Copy button
        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "msg-action-pill";
        copyBtn.innerHTML = "📋 Copy";
        copyBtn.title = "Copy response to clipboard";
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(text);
            copyBtn.innerHTML = "✅ Copied!";
            showToast("Copied to clipboard!", "success");
            setTimeout(() => { copyBtn.innerHTML = "📋 Copy"; }, 2000);
        };
        actionBar.appendChild(copyBtn);

        // Regenerate button
        const regenBtn = document.createElement("button");
        regenBtn.type = "button";
        regenBtn.className = "msg-action-pill";
        regenBtn.innerHTML = "🔄 Regenerate";
        regenBtn.title = "Regenerate this response";
        regenBtn.onclick = () => handleRegenerateResponse();
        actionBar.appendChild(regenBtn);

        // Like button
        const likeBtn = document.createElement("button");
        likeBtn.type = "button";
        likeBtn.className = "msg-action-pill";
        likeBtn.innerHTML = "👍";
        likeBtn.title = "Helpful response";
        likeBtn.onclick = () => {
            likeBtn.classList.toggle("active");
            if (likeBtn.classList.contains("active")) {
                dislikeBtn.classList.remove("disliked");
                showToast("Thanks for your feedback! 👍", "success");
            }
        };
        actionBar.appendChild(likeBtn);

        // Dislike button
        const dislikeBtn = document.createElement("button");
        dislikeBtn.type = "button";
        dislikeBtn.className = "msg-action-pill";
        dislikeBtn.innerHTML = "👎";
        dislikeBtn.title = "Needs improvement";
        dislikeBtn.onclick = () => {
            dislikeBtn.classList.toggle("disliked");
            if (dislikeBtn.classList.contains("disliked")) {
                likeBtn.classList.remove("active");
                showToast("Feedback recorded. NIVORA will improve! 👎", "info");
            }
        };
        actionBar.appendChild(dislikeBtn);

        // Share button
        const shareBtn = document.createElement("button");
        shareBtn.type = "button";
        shareBtn.className = "msg-action-pill";
        shareBtn.innerHTML = "🔗 Share";
        shareBtn.title = "Share this response";
        shareBtn.onclick = async () => {
            if (navigator.share) {
                try {
                    await navigator.share({
                        title: "NIVORA AI Response",
                        text: text
                    });
                } catch (_) {}
            } else {
                navigator.clipboard.writeText(text);
                showToast("Response copied to share! 📋", "success");
            }
        };
        actionBar.appendChild(shareBtn);

        // Speak button
        const speakBtn = document.createElement("button");
        speakBtn.type = "button";
        speakBtn.className = "msg-action-pill";
        speakBtn.innerHTML = "🔊 Read";
        speakBtn.title = "Read response aloud";
        speakBtn.onclick = () => speakText(text);
        actionBar.appendChild(speakBtn);

        container.appendChild(actionBar);

        // Message Timestamp
        const rawTime = msgTimestamp || new Date().getTime();
        const timeStr = formatMessageTimestamp(rawTime);
        const timeSpan = document.createElement("span");
        timeSpan.className = "message-timestamp";
        timeSpan.textContent = timeStr;
        timeSpan.title = formatMessageDate(rawTime);
        container.appendChild(timeSpan);

        scrollToBottom();
    }

    function openImagePreview({ src, title, sourceUrl, domain }) {
        const modal = $("imagePreviewModal");
        const img = $("imagePreviewImg");
        const titleEl = $("imagePreviewTitle");
        const sourceEl = $("imagePreviewSource");
        const linkEl = $("imagePreviewLink");
        const downloadEl = $("imageDownloadBtn");

        if (!modal || !img) return;

        img.src = src;
        img.alt = title || "Preview";
        if (titleEl) titleEl.textContent = title || "NIVORA Image";
        if (sourceEl) sourceEl.textContent = domain ? `Source: ${domain}` : (sourceUrl ? `Source: ${sourceUrl}` : "NIVORA Image");
        if (linkEl) {
            if (sourceUrl && sourceUrl !== "#" && !sourceUrl.startsWith("data:")) {
                linkEl.href = sourceUrl;
                linkEl.style.display = "inline-flex";
            } else {
                linkEl.style.display = "none";
            }
        }
        if (downloadEl) {
            downloadEl.href = src;
            downloadEl.download = "nivora-" + (title || "image").toLowerCase().replace(/[^a-z0-9]/g, "-") + ".png";
        }

        modal.style.display = "flex";
    }

    function openFilePreview(file) {
        if (!file || !file.data) return;
        const modal = $("filePreviewModal");
        if (!modal) return;
        const iconEl = $("filePreviewIcon");
        const titleEl = $("filePreviewTitle");
        const sizeEl = $("filePreviewSize");
        const stageEl = $("filePreviewStage");
        const dlBtn = $("fileDownloadModalBtn");

        const ext = (file.name || "").split(".").pop()?.toLowerCase() || (file.type || "").toLowerCase();
        let icon = "📄";
        if (ext.includes("pdf")) icon = "📄";
        else if (ext.includes("doc")) icon = "📝";
        else if (ext.includes("xls") || ext.includes("sheet")) icon = "📊";
        else if (ext.includes("ppt")) icon = "📽️";
        else if (ext.includes("csv")) icon = "📑";
        else if (ext.includes("json")) icon = "{}";
        else if (ext.includes("zip")) icon = "🗜️";
        else if (ext.includes("txt") || ext.includes("md")) icon = "📃";

        if (iconEl) iconEl.textContent = icon;
        if (titleEl) titleEl.textContent = file.name || "Generated File";
        if (sizeEl) sizeEl.textContent = `${file.type || ext.toUpperCase()} • ${file.size || "Ready"}`;
        if (dlBtn) {
            dlBtn.href = file.data;
            dlBtn.download = file.name || "download";
        }

        if (stageEl) {
            stageEl.innerHTML = "";
            if (ext === "pdf") {
                const iframe = document.createElement("iframe");
                iframe.src = file.data;
                iframe.title = file.name || "PDF Document Preview";
                stageEl.appendChild(iframe);
            } else if (["txt", "json", "csv", "md", "xml", "html", "js", "ts", "py"].includes(ext)) {
                let decoded = "";
                try {
                    const b64 = file.data.includes(",") ? file.data.split(",")[1] : file.data;
                    decoded = atob(b64);
                } catch {
                    decoded = "File ready for download.";
                }
                const pre = document.createElement("pre");
                pre.className = "file-preview-text-container";
                pre.textContent = decoded;
                stageEl.appendChild(pre);
            } else {
                const wrap = document.createElement("div");
                wrap.style.cssText = "display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;min-height:300px;text-align:center;gap:14px;color:#94a3b8;";
                wrap.innerHTML = `
                    <div style="font-size:56px;line-height:1;">${icon}</div>
                    <div style="font-size:16px;color:#ffffff;font-weight:600;">${escapeHTML(file.name || "File Preview")}</div>
                    <p style="max-width:380px;margin:0;font-size:13px;line-height:1.5;">This file format is generated and ready to be downloaded.</p>
                `;
                stageEl.appendChild(wrap);
            }
        }

        modal.style.display = "flex";
    }

    function addFormattedMarkdown(container, text) {
        renderFormattedContent(container, text, { isUser: false });
    }

    function loadChat(chatId) {
        const chat = chats.find((c) => c.id === chatId);
        if (!chat) return;

        activeChatId = chat.id;
        safeSetItem(ACTIVE_CHAT_KEY, activeChatId);

        const messages = $("messages");
        if (messages) messages.innerHTML = "";

        const welcome = $("welcome");
        if (welcome) welcome.style.display = "none";

        chat.messages.forEach((msg) => {
            if (!msg) return;
            msg.timestamp = msg.timestamp || new Date().getTime();
            if (msg.role === "user") {
                addUserMessage(msg);
            } else {
                const row = document.createElement("div");
                row.className = "message ai-message";

                const icon = document.createElement("div");
                icon.className = "ai-icon";
                const iconImg = document.createElement("img");
                iconImg.src = "/assets/nivora-logo.png";
                iconImg.alt = "NIVORA";
                icon.appendChild(iconImg);

                const content = document.createElement("div");
                content.className = "message-content";

                row.appendChild(icon);
                row.appendChild(content);
                messages.appendChild(row);

                renderAIResponse(content, msg.content, msg.sources, msg.artifact, msg.images, msg.timestamp, msg.generatedFile, msg.creation);
            }
        });

        renderRecentChats();
        scrollToBottom();
    }

    function startNewChat() {
        activeChatId = null;
        localStorage.removeItem(ACTIVE_CHAT_KEY);

        const messages = $("messages");
        if (messages) messages.innerHTML = "";

        const welcome = $("welcome");
        if (welcome) welcome.style.display = "flex";

        const input = $("messageInput");
        if (input) {
            input.value = "";
            adjustMessageInputHeight(input);
            input.focus();
        }

        clearAttachmentTray();
        renderRecentChats();
    }

    function renderRecentChats() {
        const chatList = $("chatList");
        if (!chatList) return;

        chatList.innerHTML = "";
        const sorted = [...chats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

        if (sorted.length === 0) {
            chatList.innerHTML = '<div class="empty-chats">No recent chats</div>';
            return;
        }

        sorted.forEach((chat) => {
            const item = document.createElement("div");
            item.className = "chat-item" + (chat.id === activeChatId ? " active" : "");

            const title = document.createElement("span");
            title.className = "chat-title";
            title.textContent = (chat.pinned ? "📌 " : "") + (chat.title || "New Chat");

            const quickDelBtn = document.createElement("button");
            quickDelBtn.type = "button";
            quickDelBtn.className = "chat-quick-del-btn";
            quickDelBtn.innerHTML = "🗑️";
            quickDelBtn.title = "Delete conversation";
            quickDelBtn.onclick = (e) => {
                e.stopPropagation();
                openDeleteChatModal(chat);
            };

            const menuBtn = document.createElement("button");
            menuBtn.type = "button";
            menuBtn.className = "chat-menu-btn";
            menuBtn.textContent = "⋮";
            menuBtn.title = "Chat options";

            menuBtn.onclick = (e) => {
                e.stopPropagation();
                showChatMenu(chat, menuBtn);
            };

            item.appendChild(title);
            item.appendChild(quickDelBtn);
            item.appendChild(menuBtn);

            item.onclick = () => loadChat(chat.id);
            chatList.appendChild(item);
        });
    }

    function showChatMenu(chat, button) {
        document.querySelectorAll(".nivora-final-chat-menu").forEach((m) => m.remove());

        const menu = document.createElement("div");
        menu.className = "nivora-final-chat-menu";

        // 1. PIN / UNPIN
        const pinBtn = document.createElement("button");
        pinBtn.type = "button";
        pinBtn.textContent = chat.pinned ? "📌 Unpin" : "📌 Pin";
        pinBtn.onclick = async (e) => {
            e.stopPropagation();
            menu.remove();
            chat.pinned = !chat.pinned;
            chat.updatedAt = Date.now();
            saveChats();
            renderRecentChats();
            showToast(chat.pinned ? "Conversation pinned to top! 📌" : "Conversation unpinned.");
            try {
                if (window.NivoraAuth?.saveChatToFirestore) {
                    await window.NivoraAuth.saveChatToFirestore(chat);
                }
                const user = getUser();
                await fetch(`/api/chats/${chat.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId: user.user_id || "anonymous", pinned: chat.pinned })
                });
            } catch (err) {
                console.warn("Pin sync warning:", err);
            }
        };

        // 2. RENAME
        const renameBtn = document.createElement("button");
        renameBtn.type = "button";
        renameBtn.textContent = "✏️ Rename";
        renameBtn.onclick = (e) => {
            e.stopPropagation();
            menu.remove();
            openRenameChatModal(chat);
        };

        // 3. EXPORT CHAT
        const exportBtn = document.createElement("button");
        exportBtn.type = "button";
        exportBtn.textContent = "📥 Export Chat";
        exportBtn.onclick = (e) => {
            e.stopPropagation();
            menu.remove();
            openExportChatModal(chat);
        };

        // 4. DELETE
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.textContent = "🗑 Delete";
        delBtn.style.color = "#ff7777";
        delBtn.onclick = (e) => {
            e.stopPropagation();
            menu.remove();
            openDeleteChatModal(chat);
        };

        menu.appendChild(pinBtn);
        menu.appendChild(renameBtn);
        menu.appendChild(exportBtn);
        menu.appendChild(delBtn);
        document.body.appendChild(menu);

        const rect = button.getBoundingClientRect();
        menu.style.position = "fixed";
        menu.style.left = `${Math.max(8, rect.right - 155)}px`;
        menu.style.top = `${rect.bottom + 6}px`;

        setTimeout(() => {
            document.addEventListener("pointerdown", function outside(e) {
                if (!menu.contains(e.target) && e.target !== button) {
                    menu.remove();
                    document.removeEventListener("pointerdown", outside);
                }
            });
        }, 10);
    }

    function openRenameChatModal(chat) {
        const modal = $("renameChatModal");
        const input = $("renameChatInput");
        const errorEl = $("renameChatError");
        const saveBtn = $("saveRenameChatBtn");
        const cancelBtn = $("cancelRenameChatBtn");
        const closeBtn = $("closeRenameChat");

        if (!modal || !input) return;
        if (errorEl) { errorEl.style.display = "none"; errorEl.textContent = ""; }
        input.value = chat.title || "";
        modal.classList.add("active");
        input.focus();

        const doSave = async () => {
            const val = input.value.trim();
            if (!val) {
                if (errorEl) {
                    errorEl.textContent = "Please enter a conversation title.";
                    errorEl.style.display = "block";
                }
                input.focus();
                return;
            }

            chat.title = val;
            chat.updatedAt = Date.now();
            saveChats();
            renderRecentChats();

            const topTitle = $("chatTitle") || $("currentChatTitle");
            if (topTitle && activeChatId === chat.id) {
                topTitle.textContent = val;
            }

            modal.classList.remove("active");
            showToast("Conversation renamed.");

            try {
                if (window.NivoraAuth?.saveChatToFirestore) {
                    await window.NivoraAuth.saveChatToFirestore(chat);
                }
                const user = getUser();
                await fetch(`/api/chats/${chat.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId: user.user_id || "anonymous", title: val })
                });
            } catch (err) {
                console.warn("Rename sync warning:", err);
            }
        };

        if (saveBtn) saveBtn.onclick = (e) => { e.preventDefault(); doSave(); };
        input.onkeydown = (e) => {
            if (e.key === "Enter") { e.preventDefault(); doSave(); }
            if (e.key === "Escape") { modal.classList.remove("active"); }
        };
        if (cancelBtn) cancelBtn.onclick = () => modal.classList.remove("active");
        if (closeBtn) closeBtn.onclick = () => modal.classList.remove("active");
    }

    function openExportChatModal(chat) {
        const modal = $("exportChatModal");
        const closeBtn = $("closeExportChat");
        const cancelBtn = $("cancelExportChatBtn");

        if (!modal) return;
        modal.classList.add("active");

        const exportAs = async (format) => {
            modal.classList.remove("active");
            showToast(`Generating ${format.toUpperCase()} export... 📥`);
            try {
                const cleanTitle = (chat.title || "NIVORA Conversation").replace(/[^a-zA-Z0-9_\-\s]/g, "").trim() || "NIVORA_Chat";
                const res = await fetch("/api/export-chat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        format,
                        title: cleanTitle,
                        messages: chat.messages || []
                    })
                });

                if (!res.ok) throw new Error(`Export failed with status ${res.status}`);
                const blob = await res.blob();
                const ext = format === "markdown" ? "md" : format;
                const filename = `${cleanTitle.replace(/\s+/g, "_")}.${ext}`;

                const url = window.URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
                showToast(`Exported as ${filename}! 📄`, "success");
            } catch (err) {
                console.error("Export error:", err);
                try {
                    let mime = "text/plain";
                    let textContent = "";
                    const ext = format === "markdown" ? "md" : format;
                    if (format === "json") {
                        mime = "application/json";
                        textContent = JSON.stringify({ title: chat.title, messages: chat.messages }, null, 2);
                    } else if (format === "md") {
                        mime = "text/markdown";
                        textContent = `# ${chat.title}\n\n` + (chat.messages || []).map(m => `### ${m.role === 'user' ? 'User' : 'NIVORA'}\n\n${m.content}\n`).join("\n---\n\n");
                    } else {
                        mime = "text/plain";
                        textContent = `NIVORA EXPORT: ${chat.title}\n\n` + (chat.messages || []).map(m => `[${m.role === 'user' ? 'User' : 'NIVORA'}]:\n${m.content}\n`).join("\n\n");
                    }
                    const blob = new Blob([textContent], { type: `${mime};charset=utf-8` });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${(chat.title || "NIVORA_Chat").replace(/[^a-zA-Z0-9_-]/g, "_")}.${ext}`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                    showToast(`Exported chat successfully! 📥`, "success");
                } catch (fallbackErr) {
                    showToast("Could not export chat.", "error");
                }
            }
        };

        const pBtn = $("exportPdfBtn");
        const tBtn = $("exportTxtBtn");
        const mBtn = $("exportMdBtn");
        const jBtn = $("exportJsonBtn");

        if (pBtn) pBtn.onclick = () => exportAs("pdf");
        if (tBtn) tBtn.onclick = () => exportAs("txt");
        if (mBtn) mBtn.onclick = () => exportAs("md");
        if (jBtn) jBtn.onclick = () => exportAs("json");

        if (cancelBtn) cancelBtn.onclick = () => modal.classList.remove("active");
        if (closeBtn) closeBtn.onclick = () => modal.classList.remove("active");
    }

    function openDeleteChatModal(chat) {
        const modal = $("deleteChatModal");
        const confirmBtn = $("confirmDeleteChatBtn");
        const cancelBtn = $("cancelDeleteChatBtn");
        const closeBtn = $("closeDeleteChat");

        if (!modal) return;
        modal.classList.add("active");

        if (confirmBtn) {
            confirmBtn.onclick = async () => {
                modal.classList.remove("active");
                chats = chats.filter((c) => c.id !== chat.id);
                saveChats();

                if (activeChatId === chat.id) {
                    if (chats.length > 0) {
                        loadChat(chats[0].id);
                    } else {
                        startNewChat();
                    }
                }

                renderRecentChats();
                showToast("Conversation permanently deleted.");

                try {
                    if (window.NivoraAuth?.deleteChatFromFirestore) {
                        await window.NivoraAuth.deleteChatFromFirestore(chat.id);
                    }
                    const user = getUser();
                    await fetch(`/api/chats/${chat.id}?userId=${encodeURIComponent(user.user_id || "anonymous")}`, {
                        method: "DELETE"
                    });
                } catch (err) {
                    console.warn("Delete chat sync warning:", err);
                }
            };
        }

        if (cancelBtn) cancelBtn.onclick = () => modal.classList.remove("active");
        if (closeBtn) closeBtn.onclick = () => modal.classList.remove("active");
    }

    // ----------------------------------------------------
    // ATTACH (+) MENU WITH ALL 7 OPTIONS
    // ----------------------------------------------------

    function setupAttachMenu() {
        const attachBtn = $("attachBtn");
        const attachMenu = $("attachMenu");
        const fileInput = $("hiddenFileInput");

        if (!attachBtn || !attachMenu) return;

        attachBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const isOpen = attachMenu.classList.contains("show");
            if (isOpen) {
                attachMenu.classList.remove("show");
                attachBtn.classList.remove("open");
            } else {
                attachMenu.classList.add("show");
                attachBtn.classList.add("open");
            }
        };

        document.addEventListener("click", (e) => {
            if (!attachMenu.contains(e.target) && e.target !== attachBtn) {
                attachMenu.classList.remove("show");
                attachBtn.classList.remove("open");
            }
        });

        // 1. Add files or photos
        $("attachOptionFiles")?.addEventListener("click", () => {
            attachMenu.classList.remove("show");
            fileInput?.click();
        });

        fileInput?.addEventListener("change", () => {
            const files = fileInput.files;
            if (!files || files.length === 0) return;
            Array.from(files).forEach(handleSelectedFile);
            fileInput.value = "";
        });

        // 2. Take a screenshot
        $("attachOptionScreenshot")?.addEventListener("click", async () => {
            attachMenu.classList.remove("show");
            try {
                if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                    showToast("Screen capture is not supported in this browser.", "warning");
                    return;
                }
                const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                const track = stream.getVideoTracks()[0];
                const imageCapture = new ImageCapture(track);
                const bitmap = await imageCapture.grabFrame();
                track.stop();

                const canvas = document.createElement("canvas");
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(bitmap, 0, 0);
                const base64 = canvas.toDataURL("image/png");

                const item = {
                    id: "att-" + Date.now() + "-" + Math.random().toString(36).substr(2, 5),
                    name: `screenshot-${Date.now()}.png`,
                    type: "image/png",
                    data: base64,
                    isImage: true
                };
                currentAttachments.push(item);
                currentAttachment = currentAttachments[0] || null;
                renderAttachmentTray();
            } catch (err) {
                console.warn("Screenshot canceled or failed:", err);
            }
        });

        // 0. Creation Studio
        $("attachOptionCreationHub")?.addEventListener("click", () => {
            attachMenu.classList.remove("show");
            openCreationStudio();
        });

        // 3. Add to project
        $("attachOptionProject")?.addEventListener("click", () => {
            attachMenu.classList.remove("show");
            openProjectsPanel();
        });

        // 4. Skills
        $("attachOptionSkills")?.addEventListener("click", () => {
            attachMenu.classList.remove("show");
            openSkillsModal();
        });

        // 5. Add connector
        $("attachOptionConnector")?.addEventListener("click", () => {
            attachMenu.classList.remove("show");
            openConnectorsModal();
        });

        // 6. Add plugin
        $("attachOptionPlugin")?.addEventListener("click", () => {
            attachMenu.classList.remove("show");
            openPluginsModal();
        });

        // 7. Web search toggle
        $("attachOptionWebSearch")?.addEventListener("click", () => {
            attachMenu.classList.remove("show");
            webSearchEnabled = !webSearchEnabled;
            renderAttachmentTray();
            const input = $("messageInput");
            if (webSearchEnabled && input) {
                input.placeholder = "Search the web with NIVORA...";
            } else if (input) {
                input.placeholder = "Message NIVORA...";
            }
        });

        // Paste handling: single controlled paste handler for #messageInput and image/file attachment
        let isPastingMessageInput = false;

        function handleMessageInputPaste(e) {
            if (isPastingMessageInput) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            const targetEl = e.target || $("messageInput");
            if (!targetEl) return;

            // 1. Check if clipboard contains images/files
            const items = e.clipboardData?.items;
            let fileFound = false;
            if (items) {
                for (let i = 0; i < items.length; i++) {
                    if (items[i].type && (items[i].type.startsWith("image/") || items[i].type === "application/pdf")) {
                        const file = items[i].getAsFile();
                        if (file) {
                            fileFound = true;
                            handleSelectedFile(file);
                        }
                    }
                }
            }
            if (fileFound) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            // 2. Controlled text paste insertion (EXACTLY ONCE)
            if (e.clipboardData) {
                // Prevent browser native paste AND prevent bubbling to window
                e.preventDefault();
                e.stopPropagation();

                isPastingMessageInput = true;
                try {
                    const html = e.clipboardData.getData("text/html");
                    const plain = e.clipboardData.getData("text/plain");

                    let textToInsert = plain || "";
                    // If rich formatted HTML exists (e.g. from ChatGPT, Word, Docs, web) with tables, lists, or headers
                    if (html && (html.includes("<table") || html.includes("<ol") || html.includes("<ul") || /<h[1-6]/i.test(html) || html.includes("<pre"))) {
                        try {
                            const converted = convertHtmlToMarkdown(html);
                            if (converted && converted.trim().length > 0) {
                                textToInsert = converted;
                            }
                        } catch (err) {
                            console.warn("HTML to Markdown paste fallback:", err);
                        }
                    }

                    if (textToInsert) {
                        // Normalize Windows CRLF to standard newline, preserving multiline, tabs, spaces, code, emojis
                        textToInsert = textToInsert.replace(/\r\n/g, "\n");
                        const start = targetEl.selectionStart ?? targetEl.value.length;
                        const end = targetEl.selectionEnd ?? targetEl.value.length;
                        const currentVal = targetEl.value || "";
                        targetEl.value = currentVal.substring(0, start) + textToInsert + currentVal.substring(end);
                        const newPos = start + textToInsert.length;
                        targetEl.setSelectionRange(newPos, newPos);
                        adjustMessageInputHeight(targetEl);
                        targetEl.dispatchEvent(new Event("input", { bubbles: true }));
                    }
                } finally {
                    isPastingMessageInput = false;
                }
            }
        }

        // Global paste handler: ONLY for capturing image/file paste when user is not typing in an input
        function handleGlobalPaste(e) {
            // Never process if already prevented or handled
            if (e.defaultPrevented) return;

            const activeEl = document.activeElement;
            const targetEl = e.target;

            // If user is inside an input or textarea (including #messageInput), do not process at window level
            if (targetEl && (targetEl.tagName === "INPUT" || targetEl.tagName === "TEXTAREA" || targetEl.isContentEditable)) {
                return;
            }
            if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable)) {
                return;
            }

            // Only capture image or file attachment pasted globally in window/chat area
            const items = e.clipboardData?.items;
            if (items) {
                for (let i = 0; i < items.length; i++) {
                    if (items[i].type && (items[i].type.startsWith("image/") || items[i].type === "application/pdf")) {
                        const file = items[i].getAsFile();
                        if (file) {
                            e.preventDefault();
                            e.stopPropagation();
                            handleSelectedFile(file);
                            return;
                        }
                    }
                }
            }
        }

        // ====================================================
        // CLIPBOARD MANAGER FOR CHAT INPUT
        // ====================================================
        const CLIPBOARD_STORAGE_KEY = "nivora_chat_clipboard_history";
        const MAX_CLIPBOARD_ITEMS = 5;

        function getClipboardHistory() {
            try {
                const raw = localStorage.getItem(CLIPBOARD_STORAGE_KEY);
                const list = raw ? JSON.parse(raw) : [];
                return Array.isArray(list) ? list : [];
            } catch {
                return [];
            }
        }

        function saveClipboardHistory(list) {
            try {
                localStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify(list.slice(0, MAX_CLIPBOARD_ITEMS)));
            } catch (e) {
                console.warn("Could not save clipboard history:", e);
            }
        }

        function addClipboardItem(text) {
            if (!text || typeof text !== "string") return;
            const trimmed = text.trim();
            if (!trimmed) return;

            const current = getClipboardHistory();
            const filtered = current.filter(item => {
                const itemText = typeof item === "string" ? item : item.text;
                return itemText !== trimmed;
            });

            const newItem = {
                text: trimmed,
                timestamp: Date.now()
            };

            const updated = [newItem, ...filtered].slice(0, MAX_CLIPBOARD_ITEMS);
            saveClipboardHistory(updated);
        }

        function formatRelativeTime(ts) {
            if (!ts) return "";
            const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
            if (diff < 60) return "Just now";
            if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
            if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
            return `${Math.floor(diff / 86400)}d ago`;
        }

        let activeClipboardMenu = null;

        function closeClipboardMenu() {
            if (activeClipboardMenu) {
                activeClipboardMenu.remove();
                activeClipboardMenu = null;
            }
        }

        function showClipboardMenu(x, y) {
            closeClipboardMenu();

            const history = getClipboardHistory();
            const menu = document.createElement("div");
            menu.className = "nivora-clipboard-menu";

            const countBadge = `${history.length}/${MAX_CLIPBOARD_ITEMS}`;

            let listHtml = "";
            if (history.length === 0) {
                listHtml = `
                    <div class="nivora-clipboard-empty">
                        <p style="margin:0 0 4px;font-weight:600;color:#cbd5e1;">Clipboard is empty</p>
                        <p style="margin:0;font-size:11.5px;color:#64748b;">Copy text inside the chat input (Ctrl+C / Cmd+C) to save up to 5 items here.</p>
                    </div>
                `;
            } else {
                listHtml = `<div class="nivora-clipboard-list">` +
                    history.map((item, idx) => {
                        const itemText = typeof item === "string" ? item : item.text;
                        const itemTs = typeof item === "string" ? null : item.timestamp;
                        const previewText = itemText.length > 70 ? itemText.slice(0, 70) + "…" : itemText;
                        const lines = itemText.split("\n").length;
                        const metaLabel = `${itemText.length} chars${lines > 1 ? ` • ${lines} lines` : ""}`;
                        const timeLabel = formatRelativeTime(itemTs);

                        return `
                            <div class="nivora-clipboard-item" data-index="${idx}" title="Click to insert into input">
                                <div class="nivora-clipboard-item-text">${escapeHTML(previewText)}</div>
                                <div class="nivora-clipboard-item-meta">
                                    <span>${metaLabel}</span>
                                    <span>${timeLabel}</span>
                                </div>
                            </div>
                        `;
                    }).join("") +
                `</div>`;
            }

            menu.innerHTML = `
                <div class="nivora-clipboard-header">
                    <div class="nivora-clipboard-title">
                        <span>📋</span>
                        <span>Clipboard Manager</span>
                    </div>
                    <span class="nivora-clipboard-count">${countBadge}</span>
                </div>
                ${listHtml}
                <div class="nivora-clipboard-footer">
                    ${history.length > 0 ? `<button type="button" class="nivora-clipboard-btn clear-history-btn">🗑️ Clear All</button>` : ""}
                    <button type="button" class="nivora-clipboard-btn close-menu-btn">✕ Close</button>
                </div>
            `;

            document.body.appendChild(menu);
            activeClipboardMenu = menu;

            const menuRect = menu.getBoundingClientRect();
            const padding = 12;
            let posX = x;
            let posY = y;

            if (posX + menuRect.width > window.innerWidth - padding) {
                posX = window.innerWidth - menuRect.width - padding;
            }
            if (posX < padding) posX = padding;

            if (posY + menuRect.height > window.innerHeight - padding) {
                posY = Math.max(padding, y - menuRect.height);
            }
            if (posY < padding) posY = padding;

            menu.style.left = `${posX}px`;
            menu.style.top = `${posY}px`;

            menu.querySelectorAll(".nivora-clipboard-item").forEach((el) => {
                el.addEventListener("click", () => {
                    const idx = parseInt(el.getAttribute("data-index") || "0", 10);
                    const selected = history[idx];
                    const textToInsert = typeof selected === "string" ? selected : selected?.text;
                    if (textToInsert) {
                        const input = $("messageInput");
                        if (input) {
                            const start = input.selectionStart ?? input.value.length;
                            const end = input.selectionEnd ?? input.value.length;
                            const currentVal = input.value || "";
                            input.value = currentVal.substring(0, start) + textToInsert + currentVal.substring(end);
                            const newPos = start + textToInsert.length;
                            input.setSelectionRange(newPos, newPos);
                            adjustMessageInputHeight(input);
                            input.focus();
                            input.dispatchEvent(new Event("input", { bubbles: true }));
                            showToast("Inserted from Clipboard Manager! 📋", "success");
                        }
                    }
                    closeClipboardMenu();
                });
            });

            menu.querySelector(".clear-history-btn")?.addEventListener("click", () => {
                saveClipboardHistory([]);
                showToast("Clipboard history cleared.", "info");
                closeClipboardMenu();
            });

            menu.querySelector(".close-menu-btn")?.addEventListener("click", () => {
                closeClipboardMenu();
            });

            function onPointerDown(e) {
                if (!menu.contains(e.target)) {
                    closeClipboardMenu();
                    cleanup();
                }
            }

            function onKeyDown(e) {
                if (e.key === "Escape") {
                    closeClipboardMenu();
                    cleanup();
                }
            }

            function cleanup() {
                document.removeEventListener("pointerdown", onPointerDown);
                document.removeEventListener("keydown", onKeyDown);
                window.removeEventListener("resize", closeClipboardMenu);
                window.removeEventListener("scroll", closeClipboardMenu, true);
            }

            setTimeout(() => {
                document.addEventListener("pointerdown", onPointerDown);
                document.addEventListener("keydown", onKeyDown);
                window.addEventListener("resize", closeClipboardMenu, { once: true });
                window.addEventListener("scroll", closeClipboardMenu, { capture: true, once: true });
            }, 10);
        }

        function initClipboardManager() {
            const input = $("messageInput");
            if (!input) return;

            function handleCopyFromInput() {
                const start = input.selectionStart;
                const end = input.selectionEnd;
                let copied = "";
                if (start !== undefined && end !== undefined && start !== end) {
                    copied = input.value.substring(start, end);
                }
                if (!copied && window.getSelection) {
                    copied = window.getSelection()?.toString() || "";
                }
                if (copied && copied.trim()) {
                    addClipboardItem(copied);
                }
            }

            input.addEventListener("copy", handleCopyFromInput);
            input.addEventListener("cut", handleCopyFromInput);

            function onContextMenu(e) {
                e.preventDefault();
                e.stopPropagation();
                showClipboardMenu(e.clientX, e.clientY);
            }

            input.addEventListener("contextmenu", onContextMenu);
            const container = input.closest(".input-box") || input.closest(".input-container");
            if (container && container !== input) {
                container.addEventListener("contextmenu", (e) => {
                    if (e.target.closest("button") || e.target.closest(".action-btn")) return;
                    e.preventDefault();
                    e.stopPropagation();
                    showClipboardMenu(e.clientX, e.clientY);
                });
            }
        }

        const messageBox = $("messageInput");
        if (messageBox) {
            messageBox.addEventListener("paste", handleMessageInputPaste);
            messageBox.addEventListener("input", () => adjustMessageInputHeight(messageBox));
            initClipboardManager();
        }
        window.addEventListener("paste", handleGlobalPaste);

        // Drag & drop files/images into input area and chat messages area
        const dropZones = [document.querySelector(".input-container"), document.querySelector(".chat-container"), document.getElementById("messages")].filter(Boolean);
        dropZones.forEach((zone) => {
            zone.addEventListener("dragover", (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            zone.addEventListener("drop", (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
                    Array.from(e.dataTransfer.files).forEach(handleSelectedFile);
                }
            });
        });
    }

    function handleSelectedFile(file) {
        if (!file) return;

        // Size check (15MB limit)
        if (file.size > 15 * 1024 * 1024) {
            showToast(`"${file.name}" exceeds the 15MB file size limit.`, "warning");
            return;
        }

        const fileName = file.name || "uploaded-file";
        const lowerName = fileName.toLowerCase();
        const isImage = file.type.startsWith("image/") || /\.(jpg|jpeg|png|webp|gif|bmp|svg)$/i.test(lowerName);
        const isPdf = lowerName.endsWith(".pdf") || file.type === "application/pdf";

        // Normalize image MIME types for Gemini multimodal vision
        let mimeType = file.type || "application/octet-stream";
        if (isImage) {
            if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg") || mimeType === "image/jpg") {
                mimeType = "image/jpeg";
            } else if (lowerName.endsWith(".png") || mimeType === "image/png") {
                mimeType = "image/png";
            } else if (lowerName.endsWith(".webp") || mimeType === "image/webp") {
                mimeType = "image/webp";
            } else if (!mimeType.startsWith("image/")) {
                mimeType = "image/png";
            }
        } else if (isPdf) {
            mimeType = "application/pdf";
        }

        const previewUrl = (isImage || isPdf) ? createTrackedObjectUrl(file) : null;
        const attachmentId = "att-" + Date.now() + "-" + Math.random().toString(36).substr(2, 6);

        const reader = new FileReader();
        if (isImage || isPdf) {
            reader.onload = () => {
                const item = {
                    id: attachmentId,
                    name: fileName,
                    type: mimeType,
                    data: reader.result, // Preserved full original quality for Gemini API
                    previewUrl: previewUrl,
                    isImage: isImage,
                    isPdf: isPdf,
                    size: `${(file.size / 1024).toFixed(1)} KB`
                };
                // Persist attachment into IndexedDB asynchronously
                nivoraDb.saveAttachment(item);

                currentAttachments.push(item);
                currentAttachment = currentAttachments[0] || null;
                renderAttachmentTray();
            };
            reader.onerror = () => {
                showToast(`Could not read file "${fileName}".`, "error");
            };
            reader.readAsDataURL(file);
        } else {
            reader.onload = () => {
                const item = {
                    id: attachmentId,
                    name: fileName,
                    type: file.type || "text/plain",
                    data: reader.result,
                    previewUrl: null,
                    isImage: false,
                    isPdf: false,
                    size: `${(file.size / 1024).toFixed(1)} KB`
                };
                nivoraDb.saveAttachment(item);

                currentAttachments.push(item);
                currentAttachment = currentAttachments[0] || null;
                renderAttachmentTray();
            };
            reader.onerror = () => {
                showToast(`Could not read file "${fileName}".`, "error");
            };
            reader.readAsText(file);
        }
    }

    function renderAttachmentTray() {
        const tray = $("attachmentTray");
        if (!tray) return;
        tray.innerHTML = "";

        if (webSearchEnabled) {
            const searchBadge = document.createElement("div");
            searchBadge.className = "tray-chip web-search-badge";
            searchBadge.innerHTML = `<span>🌐 Web Search Active</span> <button type="button" title="Disable web search">×</button>`;
            searchBadge.querySelector("button").onclick = () => {
                webSearchEnabled = false;
                renderAttachmentTray();
            };
            tray.appendChild(searchBadge);
        }

        if (currentAttachments && currentAttachments.length > 0) {
            currentAttachments.forEach((att, idx) => {
                const chip = document.createElement("div");
                chip.className = "tray-chip";
                const icon = att.isImage ? "🖼️" : (att.isPdf ? "📄" : "📁");
                chip.innerHTML = `<span>${icon} ${escapeHTML(att.name)}</span> <button type="button" title="Remove attachment">×</button>`;
                chip.querySelector("button").onclick = () => {
                    const removed = currentAttachments.splice(idx, 1)[0];
                    if (removed && removed.previewUrl) {
                        revokeTrackedObjectUrl(removed.previewUrl);
                    }
                    currentAttachment = currentAttachments[0] || null;
                    renderAttachmentTray();
                };
                tray.appendChild(chip);
            });
        }
    }

    function clearAttachmentTray() {
        if (Array.isArray(currentAttachments)) {
            currentAttachments.forEach((att) => {
                if (att && att.previewUrl) {
                    revokeTrackedObjectUrl(att.previewUrl);
                }
            });
        }
        currentAttachments = [];
        currentAttachment = null;
        renderAttachmentTray();
    }

    // ----------------------------------------------------
    // VOICE ASSISTANT (STT & TTS)
    // ----------------------------------------------------

    function setupVoiceAssistant() {
        const voiceBtn = $("voiceBtn");
        const stopBtn = $("stopSpeakBtn");
        const input = $("messageInput");

        // Web Speech API for Speech-To-Text
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition && voiceBtn) {
            recognitionInstance = new SpeechRecognition();
            recognitionInstance.continuous = false;
            recognitionInstance.interimResults = true;
            recognitionInstance.lang = "en-US";

            recognitionInstance.onstart = () => {
                isListening = true;
                voiceBtn.classList.add("listening");
                voiceBtn.title = "Listening... Speak now";
            };

            recognitionInstance.onresult = (e) => {
                let transcript = "";
                for (let i = e.resultIndex; i < e.results.length; ++i) {
                    transcript += e.results[i][0].transcript;
                }
                if (input) input.value = transcript;
            };

            recognitionInstance.onend = () => {
                isListening = false;
                voiceBtn.classList.remove("listening");
                voiceBtn.title = "Voice assistant (Dictate)";
                // Auto-send if non-empty
                if (input && input.value.trim().length > 3) {
                    sendMessage();
                }
            };

            recognitionInstance.onerror = (err) => {
                console.warn("Speech recognition error:", err);
                isListening = false;
                voiceBtn.classList.remove("listening");
            };

            voiceBtn.onclick = (e) => {
                e.preventDefault();
                if (isListening) {
                    recognitionInstance.stop();
                } else {
                    try { recognitionInstance.start(); } catch {}
                }
            };
        } else if (voiceBtn) {
            voiceBtn.onclick = () => {
                showToast("Speech recognition is not supported in this browser. Please use Chrome or Edge.", "info");
            };
        }

        if (stopBtn) {
            stopBtn.onclick = (e) => {
                e.preventDefault();
                stopSpeaking();
            };
        }
    }

    function speakText(text) {
        if (!window.speechSynthesis) {
            showToast("Text-to-speech is not supported in your browser.", "info");
            return;
        }

        stopSpeaking();

        // Strip code blocks and Markdown syntax for cleaner speech
        const cleanText = text
            .replace(/```[\s\S]*?```/g, "Code block omitted.")
            .replace(/[*#_`>]/g, "")
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
            .substring(0, 1000);

        speechSynthUtterance = new SpeechSynthesisUtterance(cleanText);
        speechSynthUtterance.rate = 1.0;
        speechSynthUtterance.pitch = 1.0;

        speechSynthUtterance.onstart = () => {
            isSpeaking = true;
            const stopBtn = $("stopSpeakBtn");
            if (stopBtn) stopBtn.classList.add("active");
        };

        speechSynthUtterance.onend = () => {
            stopSpeaking();
        };

        speechSynthUtterance.onerror = () => {
            stopSpeaking();
        };

        window.speechSynthesis.speak(speechSynthUtterance);
    }

    function stopSpeaking() {
        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
        isSpeaking = false;
        const stopBtn = $("stopSpeakBtn");
        if (stopBtn) stopBtn.classList.remove("active");
    }

    // ----------------------------------------------------
    // LIVE CANVAS / ARTIFACTS SYSTEM
    // ----------------------------------------------------

    function openArtifactCanvas(artifact) {
        currentArtifact = artifact;
        const panel = $("artifactCanvasPanel");
        const titleEl = $("canvasTitle");
        const iframe = $("canvasIframe");
        const codeView = $("canvasCodeView");

        if (!panel || !iframe) return;

        panel.classList.add("open");
        if (titleEl) titleEl.textContent = artifact.title || "Live Canvas Artifact";

        // Render code inside iframe
        let htmlContent = artifact.code || "";
        if (artifact.type === "svg") {
            htmlContent = `<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#181b22;">${artifact.code}</body></html>`;
        } else if (!htmlContent.includes("<!DOCTYPE") && !htmlContent.includes("<html")) {
            htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><style>body{font-family:sans-serif;padding:20px;color:#333;}</style></head><body>${htmlContent}</body></html>`;
        }

        iframe.srcdoc = htmlContent;
        if (codeView) codeView.textContent = artifact.code;

        // Ensure Preview tab is active
        setCanvasTab("preview");
    }

    function closeArtifactCanvas() {
        const panel = $("artifactCanvasPanel");
        if (panel) panel.classList.remove("open");
    }

    function setCanvasTab(tab) {
        const iframe = $("canvasIframe");
        const codeView = $("canvasCodeView");
        const tabPreview = $("canvasTabPreview");
        const tabCode = $("canvasTabCode");

        if (tab === "code") {
            if (iframe) iframe.style.display = "none";
            if (codeView) codeView.style.display = "block";
            tabPreview?.classList.remove("active");
            tabCode?.classList.add("active");
        } else {
            if (iframe) iframe.style.display = "block";
            if (codeView) codeView.style.display = "none";
            tabPreview?.classList.add("active");
            tabCode?.classList.remove("active");
        }
    }

    function setupCanvasControls() {
        $("closeCanvasBtn")?.addEventListener("click", closeArtifactCanvas);
        $("canvasTabPreview")?.addEventListener("click", () => setCanvasTab("preview"));
        $("canvasTabCode")?.addEventListener("click", () => setCanvasTab("code"));

        $("canvasCopyBtn")?.addEventListener("click", () => {
            if (currentArtifact?.code) {
                navigator.clipboard.writeText(currentArtifact.code);
                alert("Artifact code copied! ✅");
            }
        });

        $("canvasPopoutBtn")?.addEventListener("click", () => {
            if (currentArtifact?.code) {
                const blob = new Blob([currentArtifact.code], { type: "text/html" });
                const url = URL.createObjectURL(blob);
                window.open(url, "_blank");
            }
        });
    }

    // ----------------------------------------------------
    // PROJECTS SYSTEM
    // ----------------------------------------------------

    async function openProjectsPanel() {
        const panel = $("projectsPanel");
        if (!panel) return;
        panel.classList.add("active");
        renderProjectsList();
    }

    async function renderProjectsList() {
        const list = $("projectsList");
        if (!list) return;
        list.innerHTML = "<div style='color:#858da0;padding:10px;'>Loading projects...</div>";

        try {
            const user = getUser();
            let projects = [];

            if (window.NivoraAuth?.getProjectsFromFirestore) {
                try {
                    const fsProjects = await window.NivoraAuth.getProjectsFromFirestore();
                    if (Array.isArray(fsProjects) && fsProjects.length > 0) {
                        projects = fsProjects;
                    }
                } catch (fsErr) {
                    console.warn("Firestore projects load warning:", fsErr);
                }
            }

            if (projects.length === 0) {
                try {
                    const res = await fetch(`/api/projects?userId=${encodeURIComponent(user.user_id || "anonymous")}`);
                    const contentType = res.headers.get("content-type") || "";
                    if (res.ok && contentType.includes("application/json")) {
                        const data = await res.json().catch(() => null);
                        if (data && Array.isArray(data.projects)) projects = data.projects;
                    }
                } catch (projFetchErr) {
                    console.warn("Could not fetch remote projects:", projFetchErr);
                }
            }

            list.innerHTML = "";
            if (projects.length === 0) {
                list.innerHTML = `
                    <div class="empty-panel">
                        <div class="empty-icon">📁</div>
                        <h4>No projects created yet</h4>
                        <p>Create a project to organize conversations and files with dedicated context.</p>
                    </div>
                `;
            } else {
                projects.forEach((proj) => {
                    const item = document.createElement("div");
                    item.className = "chat-item";
                    item.style.marginBottom = "8px";
                    item.style.display = "flex";
                    item.style.alignItems = "center";
                    item.style.justifyContent = "space-between";
                    item.style.padding = "10px 12px";
                    item.innerHTML = `
                        <div style="flex:1;overflow:hidden;margin-right:8px;cursor:pointer;">
                            <strong style="color:#fff;display:block;font-size:13px;">📁 ${escapeHTML(proj.name)}</strong>
                            <span style="font-size:11px;color:#858da0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;">${escapeHTML(proj.description || "No description")}</span>
                            <span style="font-size:10px;color:#6c63ff;margin-top:3px;display:inline-block;">${(proj.files || []).length} file(s) • ${(proj.chatIds || proj.conversations || []).length} chat(s)</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:4px;">
                            <button type="button" class="edit-proj-btn" style="border:none;background:none;color:#858da0;cursor:pointer;font-size:14px;padding:4px;" title="Edit Project">✏️</button>
                            <button type="button" class="del-proj-btn" style="border:none;background:none;color:#ff7777;cursor:pointer;font-size:14px;padding:4px;" title="Delete Project">🗑</button>
                        </div>
                    `;
                    item.querySelector(".edit-proj-btn").onclick = (e) => {
                        e.stopPropagation();
                        openEditProjectModal(proj, () => renderProjectsList());
                    };
                    item.querySelector(".del-proj-btn").onclick = (e) => {
                        e.stopPropagation();
                        openDeleteProjectModal(proj, () => renderProjectsList());
                    };
                    item.onclick = () => {
                        renderProjectDetail(proj);
                    };
                    list.appendChild(item);
                });
            }
        } catch (err) {
            list.innerHTML = "<div style='color:#ff7777;'>Could not load projects.</div>";
        }
    }

    function renderProjectDetail(proj) {
        const list = $("projectsList");
        if (!list) return;
        const filesCount = (proj.files || []).length;
        const convCount = (proj.chatIds || proj.conversations || []).length;

        list.innerHTML = `
            <div style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;">
                <button type="button" class="nivora-detail-btn" id="backToProjectsBtn">← All Projects</button>
                <div style="display:flex;gap:6px;">
                    <button type="button" class="nivora-detail-btn" id="editCurrentProjBtn">✏️ Edit</button>
                    <button type="button" class="nivora-detail-btn danger" id="deleteCurrentProjBtn">🗑 Delete</button>
                </div>
            </div>
            <div style="background:#1b1e28;border:1px solid #2d3342;border-radius:10px;padding:14px;margin-bottom:14px;">
                <h3 style="margin:0 0 6px 0;color:#fff;font-size:15px;display:flex;align-items:center;gap:8px;">📁 ${escapeHTML(proj.name)}</h3>
                <p style="margin:0;font-size:12px;color:#858da0;line-height:1.5;">${escapeHTML(proj.description || "No description provided.")}</p>
                <div style="margin-top:10px;display:flex;gap:12px;font-size:11px;color:#6c63ff;">
                    <span>📄 ${filesCount} File(s)</span>
                    <span>💬 ${convCount} Chat(s)</span>
                </div>
            </div>

            <div style="display:flex;gap:8px;margin-bottom:14px;">
                <button type="button" class="primary-btn" id="startProjChatBtn" style="flex:1;padding:8px;font-size:12px;border-radius:6px;">💬 Chat in Project</button>
                <button type="button" class="sidebar-btn" id="uploadProjFileBtn" style="padding:8px 12px;font-size:12px;border-radius:6px;">➕ Attach File</button>
                <input type="file" id="projFileInput" style="display:none;" />
            </div>

            <h4 style="font-size:12px;color:#858da0;margin:0 0 8px 0;text-transform:uppercase;letter-spacing:0.5px;">Project Files</h4>
            <div id="projFilesList" style="display:flex;flex-direction:column;gap:6px;">
                ${filesCount === 0
                    ? `<div style="color:#777;font-size:12px;padding:8px;background:#13151b;border-radius:6px;">No files uploaded yet. Click "Attach File" to give NIVORA persistent knowledge for this project.</div>`
                    : proj.files.map((f) => `
                        <div style="display:flex;align-items:center;justify-content:space-between;background:#151821;padding:8px 12px;border-radius:6px;border:1px solid #252a36;font-size:12px;">
                            <span>📄 <strong>${escapeHTML(f.name)}</strong></span>
                            <span style="font-size:10px;color:#858da0;">${new Date(f.uploadedAt || Date.now()).toLocaleDateString()}</span>
                        </div>
                    `).join("")
                }
            </div>
        `;

        $("backToProjectsBtn")?.addEventListener("click", () => renderProjectsList());

        $("editCurrentProjBtn")?.addEventListener("click", () => {
            openEditProjectModal(proj, (updatedProj) => {
                renderProjectDetail(updatedProj);
            });
        });

        $("deleteCurrentProjBtn")?.addEventListener("click", () => {
            openDeleteProjectModal(proj, () => {
                renderProjectsList();
            });
        });

        $("uploadProjFileBtn")?.addEventListener("click", () => {
            $("projFileInput")?.click();
        });

        $("projFileInput")?.addEventListener("change", async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async () => {
                try {
                    showToast("Uploading project file...");
                    const res = await fetch(`/api/projects/${proj.id}/files`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            name: file.name,
                            type: file.type,
                            data: reader.result
                        })
                    });
                    let updated = null;
                    const contentType = res.headers.get("content-type") || "";
                    if (contentType.includes("application/json")) {
                        updated = await res.json().catch(() => null);
                    }
                    if (res.ok) {
                        showToast(`Uploaded ${file.name} to project! 📄`);
                        const updatedProj = updated?.project || { ...proj, files: [...(proj.files || []), { name: file.name, uploadedAt: Date.now() }] };
                        if (window.NivoraAuth?.saveProjectToFirestore) {
                            window.NivoraAuth.saveProjectToFirestore(updatedProj).catch(console.warn);
                        }
                        renderProjectDetail(updatedProj);
                    } else {
                        showToast(updated?.error || "Upload failed.", "error");
                    }
                } catch (err) {
                    console.error("Project file upload error:", err);
                    showToast("Upload failed.", "error");
                }
            };
            reader.readAsDataURL(file);
        });

        $("startProjChatBtn")?.addEventListener("click", async () => {
            const newChat = createChat(`Project: ${proj.name}`);
            if (!proj.chatIds) proj.chatIds = [];
            proj.chatIds.push(newChat.id);
            try {
                if (window.NivoraAuth?.saveProjectToFirestore) {
                    window.NivoraAuth.saveProjectToFirestore(proj).catch(console.warn);
                }
                await fetch(`/api/projects/${proj.id}/conversations`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ conversationId: newChat.id })
                });
            } catch {}
            closeModals();
            loadChat(newChat.id);
            const input = $("messageInput");
            if (input) {
                input.placeholder = `Ask anything about project: ${proj.name}...`;
                input.focus();
            }
            showToast(`Started conversation for ${proj.name}! 💬`);
        });
    }

    function openCreateProjectModal() {
        const modal = $("createProjectModal");
        const nameInput = $("newProjectNameInput");
        const descInput = $("newProjectDescInput");
        const errorEl = $("createProjectError");
        const submitBtn = $("submitCreateProjectBtn");
        const cancelBtn = $("cancelCreateProjectBtn");
        const closeBtn = $("closeCreateProject");

        if (!modal) return;
        if (nameInput) nameInput.value = "";
        if (descInput) descInput.value = "";
        if (errorEl) { errorEl.style.display = "none"; errorEl.textContent = ""; }

        modal.classList.add("active");
        nameInput?.focus();

        const doCreate = async () => {
            const name = nameInput ? nameInput.value.trim() : "";
            const desc = descInput ? descInput.value.trim() : "";

            if (!name) {
                if (errorEl) {
                    errorEl.textContent = "Please enter a project name.";
                    errorEl.style.display = "block";
                }
                nameInput?.focus();
                return;
            }

            const user = getUser();
            const proj = {
                id: "proj_" + Date.now(),
                userId: user.user_id || "anonymous",
                name,
                description: desc,
                files: [],
                chatIds: [],
                createdAt: Date.now(),
                updatedAt: Date.now()
            };

            const oldText = submitBtn?.textContent || "Create Project";
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Creating..."; }

            try {
                if (window.NivoraAuth?.saveProjectToFirestore) {
                    await window.NivoraAuth.saveProjectToFirestore(proj);
                }

                await fetch("/api/projects", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(proj)
                });

                modal.classList.remove("active");
                showToast(`Project "${proj.name}" created! 📁`);
                renderProjectsList();
            } catch (err) {
                console.error("Create project error:", err);
                if (errorEl) {
                    errorEl.textContent = "Could not create project. Please try again.";
                    errorEl.style.display = "block";
                }
            } finally {
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = oldText; }
            }
        };

        if (submitBtn) submitBtn.onclick = (e) => { e.preventDefault(); doCreate(); };
        nameInput.onkeydown = (e) => {
            if (e.key === "Enter") { e.preventDefault(); doCreate(); }
            if (e.key === "Escape") { modal.classList.remove("active"); }
        };
        if (cancelBtn) cancelBtn.onclick = () => modal.classList.remove("active");
        if (closeBtn) closeBtn.onclick = () => modal.classList.remove("active");
    }

    function openEditProjectModal(proj, onSaved) {
        const modal = $("editProjectModal");
        const nameInput = $("editProjectNameInput");
        const descInput = $("editProjectDescInput");
        const errorEl = $("editProjectError");
        const submitBtn = $("submitEditProjectBtn");
        const cancelBtn = $("cancelEditProjectBtn");
        const closeBtn = $("closeEditProject");

        if (!modal) return;
        if (nameInput) nameInput.value = proj.name || "";
        if (descInput) descInput.value = proj.description || "";
        if (errorEl) { errorEl.style.display = "none"; errorEl.textContent = ""; }

        modal.classList.add("active");
        nameInput?.focus();

        const doSave = async () => {
            const name = nameInput ? nameInput.value.trim() : "";
            const desc = descInput ? descInput.value.trim() : "";

            if (!name) {
                if (errorEl) {
                    errorEl.textContent = "Please enter a project name.";
                    errorEl.style.display = "block";
                }
                nameInput?.focus();
                return;
            }

            proj.name = name;
            proj.description = desc;
            proj.updatedAt = Date.now();

            const oldText = submitBtn?.textContent || "Save Changes";
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Saving..."; }

            try {
                if (window.NivoraAuth?.saveProjectToFirestore) {
                    await window.NivoraAuth.saveProjectToFirestore(proj);
                }

                await fetch(`/api/projects/${proj.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name, description: desc })
                });

                modal.classList.remove("active");
                showToast("Project updated.");
                if (onSaved) onSaved(proj);
                else renderProjectsList();
            } catch (err) {
                console.error("Edit project error:", err);
                if (errorEl) {
                    errorEl.textContent = "Could not update project.";
                    errorEl.style.display = "block";
                }
            } finally {
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = oldText; }
            }
        };

        if (submitBtn) submitBtn.onclick = (e) => { e.preventDefault(); doSave(); };
        nameInput.onkeydown = (e) => {
            if (e.key === "Enter") { e.preventDefault(); doSave(); }
            if (e.key === "Escape") { modal.classList.remove("active"); }
        };
        if (cancelBtn) cancelBtn.onclick = () => modal.classList.remove("active");
        if (closeBtn) closeBtn.onclick = () => modal.classList.remove("active");
    }

    function openDeleteProjectModal(proj, onDeleted) {
        const modal = $("deleteProjectModal");
        const targetNameEl = $("deleteProjectTargetName");
        const confirmBtn = $("confirmDeleteProjectBtn");
        const cancelBtn = $("cancelDeleteProjectBtn");
        const closeBtn = $("closeDeleteProject");

        if (!modal) return;
        if (targetNameEl) targetNameEl.textContent = `"${proj.name}"`;
        modal.classList.add("active");

        if (confirmBtn) {
            confirmBtn.onclick = async () => {
                confirmBtn.disabled = true;
                confirmBtn.textContent = "Deleting...";

                try {
                    if (window.NivoraAuth?.deleteProjectFromFirestore) {
                        await window.NivoraAuth.deleteProjectFromFirestore(proj.id);
                    }
                    await fetch(`/api/projects/${proj.id}`, { method: "DELETE" });
                    modal.classList.remove("active");
                    showToast("Project deleted.");
                    if (onDeleted) onDeleted();
                    else renderProjectsList();
                } catch (err) {
                    console.error("Delete project error:", err);
                    showToast("Could not delete project.", "error");
                    modal.classList.remove("active");
                } finally {
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = "Delete Project";
                }
            };
        }

        if (cancelBtn) cancelBtn.onclick = () => modal.classList.remove("active");
        if (closeBtn) closeBtn.onclick = () => modal.classList.remove("active");
    }

    function setupProjectModal() {
        $("closeProjects")?.addEventListener("click", () => {
            $("projectsPanel")?.classList.remove("active");
        });

        $("createProjectBtn")?.addEventListener("click", () => {
            openCreateProjectModal();
        });
    }

    // ----------------------------------------------------
    // CONNECTORS & SKILLS MODALS
    // ----------------------------------------------------

    function openConnectorsModal() {
        const modal = $("connectorsModal");
        if (modal) modal.classList.add("active");
    }

    function openSkillsModal() {
        const modal = $("skillsModal");
        if (modal) modal.classList.add("active");
    }

    function openPluginsModal() {
        const modal = $("pluginsModal");
        if (modal) {
            modal.classList.add("active");
        } else {
            alert("NIVORA Plugins:\n- Code Sandbox: Enabled\n- Web Research: Enabled\n- Multimodal OCR: Enabled\n- Image Generator: Enabled\n\nAll plugins are running server-side.");
        }
    }

    function closeModals() {
        document.querySelectorAll(".feature-panel, .search-panel").forEach((p) => p.classList.remove("active"));
    }

    // ----------------------------------------------------
    // SETTINGS ACCORDION (PROFILE, ACCOUNT, CHAT HISTORY, MEMORY)
    // ----------------------------------------------------

    function openSettings() {
        const p = $("settingsPanel");
        if (!p) return;
        p.classList.add("nivora-settings-open");
        p.style.setProperty("display", "block", "important");
        p.scrollTop = 0;
        updateAccountItem();
    }

    function closeSettings() {
        const p = $("settingsPanel");
        if (!p) return;
        p.classList.remove("nivora-settings-open");
        p.style.setProperty("display", "none", "important");
        // Hide details
        p.querySelectorAll(".nivora-setting-detail").forEach((d) => { d.hidden = true; });
        p.querySelectorAll(".nivora-accordion-open").forEach((b) => { b.classList.remove("nivora-accordion-open"); });
    }

    function updateAccountItem() {
        const button = $("googleSignInBtn");
        if (!button) return;
        const user = getUser();
        const email = user.email || "Account details";
        const strong = button.querySelector(".settings-item-text strong");
        const span = button.querySelector(".settings-item-text span");
        if (strong) strong.textContent = "Account";
        if (span) span.textContent = email;
    }

    function toggleAccordionItem(item, key, contentHtml) {
        if (!item) return;
        const panel = $("settingsPanel");
        const oldDetail = item.nextElementSibling;
        const isOpen = oldDetail && oldDetail.classList.contains("nivora-setting-detail") && !oldDetail.hidden;

        // Close other accordion tabs
        panel?.querySelectorAll(".nivora-setting-detail").forEach((d) => { d.hidden = true; });
        panel?.querySelectorAll(".nivora-accordion-open").forEach((b) => { b.classList.remove("nivora-accordion-open"); });

        if (isOpen) return;

        let detail = oldDetail;
        if (!detail || !detail.classList.contains("nivora-setting-detail")) {
            detail = document.createElement("div");
            detail.className = "nivora-setting-detail";
            item.parentNode.insertBefore(detail, item.nextSibling);
        }

        detail.innerHTML = contentHtml;
        detail.hidden = false;
        item.classList.add("nivora-accordion-open");
    }

    const THEME_STORAGE_KEY = "nivora_theme";
    const VALID_THEMES = ["light", "dark", "ghost"];
    const CUSTOM_THEME_STORAGE_KEY = "nivora_custom_theme";
    const VALID_CUSTOM_THEMES = ["oceanic-blue", "cyberpunk-neon", "minimalist-slate"];

    const CUSTOM_THEME_PRESETS = {
        "oceanic-blue": {
            id: "oceanic-blue",
            name: "Oceanic Blue",
            label: "Oceanic Blue",
            subtitle: "Deep Azure & Cyan",
            badge: "Deep Azure",
            swatchClass: "preview-oceanic",
            vars: {
                "--custom-theme": "'Oceanic Blue'",
                "--custom-primary": "#0ea5e9",
                "--custom-primary-hover": "#38bdf8",
                "--liquid-user-msg-bg": "linear-gradient(135deg, rgba(14, 165, 233, 0.92) 0%, rgba(2, 132, 199, 0.88) 100%)",
                "--liquid-accent-glow": "0 0 24px rgba(14, 165, 233, 0.35)",
                "--liquid-glass-border-focus": "rgba(14, 165, 233, 0.5)",
                "--theme-accent": "#0ea5e9",
                "--theme-accent-glow": "rgba(14, 165, 233, 0.4)",
                "--theme-pill-active": "#0ea5e9"
            }
        },
        "cyberpunk-neon": {
            id: "cyberpunk-neon",
            name: "Cyberpunk Neon",
            label: "Cyberpunk Neon",
            subtitle: "Electric Magenta & Cyan",
            badge: "Electric Glow",
            swatchClass: "preview-cyberpunk",
            vars: {
                "--custom-theme": "'Cyberpunk Neon'",
                "--custom-primary": "#ec4899",
                "--custom-primary-hover": "#f43f5e",
                "--liquid-user-msg-bg": "linear-gradient(135deg, rgba(236, 72, 153, 0.92) 0%, rgba(139, 92, 246, 0.88) 100%)",
                "--liquid-accent-glow": "0 0 26px rgba(236, 72, 153, 0.45), 0 0 40px rgba(6, 182, 212, 0.25)",
                "--liquid-glass-border-focus": "rgba(236, 72, 153, 0.6)",
                "--theme-accent": "#ec4899",
                "--theme-accent-glow": "rgba(236, 72, 153, 0.45)",
                "--theme-pill-active": "#ec4899"
            }
        },
        "minimalist-slate": {
            id: "minimalist-slate",
            name: "Minimalist Slate",
            label: "Minimalist Slate",
            subtitle: "Clean Monochromatic Slate",
            badge: "Monochrome",
            swatchClass: "preview-slate",
            vars: {
                "--custom-theme": "'Minimalist Slate'",
                "--custom-primary": "#94a3b8",
                "--custom-primary-hover": "#cbd5e1",
                "--liquid-user-msg-bg": "linear-gradient(135deg, rgba(71, 85, 105, 0.95) 0%, rgba(51, 65, 85, 0.9) 100%)",
                "--liquid-accent-glow": "0 0 16px rgba(148, 163, 184, 0.25)",
                "--liquid-glass-border-focus": "rgba(148, 163, 184, 0.45)",
                "--theme-accent": "#94a3b8",
                "--theme-accent-glow": "rgba(148, 163, 184, 0.25)",
                "--theme-pill-active": "#94a3b8"
            }
        }
    };

    function getSavedCustomTheme() {
        try {
            const t = localStorage.getItem(CUSTOM_THEME_STORAGE_KEY);
            if (t && VALID_CUSTOM_THEMES.includes(t.toLowerCase())) {
                return t.toLowerCase();
            }
        } catch (e) {}
        return "";
    }

    function applyCustomTheme(customThemeId, save = true) {
        const validId = VALID_CUSTOM_THEMES.includes(customThemeId) ? customThemeId : "";
        if (save) {
            try {
                if (validId) {
                    localStorage.setItem(CUSTOM_THEME_STORAGE_KEY, validId);
                } else {
                    localStorage.removeItem(CUSTOM_THEME_STORAGE_KEY);
                }
            } catch (e) {}
        }

        if (validId && CUSTOM_THEME_PRESETS[validId]) {
            document.documentElement.setAttribute("data-custom-theme", validId);
            if (document.body) {
                document.body.setAttribute("data-custom-theme", validId);
            }
            const vars = CUSTOM_THEME_PRESETS[validId].vars;
            for (const [key, val] of Object.entries(vars)) {
                document.documentElement.style.setProperty(key, val);
            }
        } else {
            document.documentElement.removeAttribute("data-custom-theme");
            if (document.body) {
                document.body.removeAttribute("data-custom-theme");
            }
            for (const key of [
                "--custom-theme",
                "--custom-primary",
                "--custom-primary-hover",
                "--liquid-user-msg-bg",
                "--liquid-accent-glow",
                "--liquid-glass-border-focus",
                "--theme-accent",
                "--theme-accent-glow",
                "--theme-pill-active"
            ]) {
                document.documentElement.style.removeProperty(key);
            }
        }

        const sub = typeof $ === "function" ? $("settingsThemeSubtitle") : (typeof document !== "undefined" && document.getElementById ? document.getElementById("settingsThemeSubtitle") : null);
        if (sub) {
            const labels = {
                light: "☀️ Light Mode",
                dark: "🌙 Dark Mode",
                ghost: "👻 Ghost Mode"
            };
            const custom = getSavedCustomTheme();
            const customSuffix = custom && CUSTOM_THEME_PRESETS[custom] ? ` • ${CUSTOM_THEME_PRESETS[custom].name}` : "";
            sub.textContent = (labels[getSavedTheme()] || "🌙 Dark Mode") + customSuffix;
        }
    }

    window.applyCustomTheme = applyCustomTheme;
    window.getSavedCustomTheme = getSavedCustomTheme;

    function getSavedTheme() {
        try {
            const t = localStorage.getItem(THEME_STORAGE_KEY);
            if (t && VALID_THEMES.includes(t.toLowerCase())) {
                return t.toLowerCase();
            }
        } catch (e) {}
        return "dark";
    }

    function ensureGhostThemeStylesheet(enable) {
        let link = typeof document !== "undefined" && document.getElementById ? document.getElementById("ghostThemeStylesheet") : null;
        if (enable) {
            if (!link && typeof document !== "undefined") {
                link = document.createElement("link");
                link.id = "ghostThemeStylesheet";
                link.rel = "stylesheet";
                link.href = "/ghost-theme.css";
                document.head.appendChild(link);
            } else if (link) {
                link.disabled = false;
            }
        } else {
            if (link) {
                link.disabled = true;
                link.remove();
            }
        }
    }

    function applyTheme(theme, save = true) {
        const validTheme = VALID_THEMES.includes(theme) ? theme : "dark";
        if (save) {
            try {
                localStorage.setItem(THEME_STORAGE_KEY, validTheme);
            } catch (e) {}
        }
        document.documentElement.setAttribute("data-theme", validTheme);
        if (document.body) {
            document.body.setAttribute("data-theme", validTheme);
        }

        // Dynamically apply or detach ghost-theme.css without affecting Light or Dark mode
        ensureGhostThemeStylesheet(validTheme === "ghost");

        const sub = typeof $ === "function" ? $("settingsThemeSubtitle") : (typeof document !== "undefined" && document.getElementById ? document.getElementById("settingsThemeSubtitle") : null);
        if (sub) {
            const labels = {
                light: "☀️ Light Mode",
                dark: "🌙 Dark Mode",
                ghost: "👻 Ghost Mode"
            };
            const custom = getSavedCustomTheme();
            const customSuffix = custom && CUSTOM_THEME_PRESETS[custom] ? ` • ${CUSTOM_THEME_PRESETS[custom].name}` : "";
            sub.textContent = (labels[validTheme] || "🌙 Dark Mode") + customSuffix;
        }
    }

    function setupSettingsAccordion() {
        // Synchronize initial theme preference
        applyTheme(getSavedTheme(), false);
        applyCustomTheme(getSavedCustomTheme(), false);
        $("settingsBtn")?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const panel = $("settingsPanel");
            if (panel?.classList.contains("nivora-settings-open")) {
                closeSettings();
            } else {
                openSettings();
            }
        });

        $("closeSettings")?.addEventListener("click", closeSettings);

        // Profile Tab
        $("profileBtn")?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const user = getUser();
            const name = user.name || "NIVORA User";
            const email = user.email || "No email";
            const userId = user.user_id || "NIV-000000";
            const pic = user.profile_picture || "";

            const html = `
                <div class="nivora-detail-title">👤 Profile Details</div>
                <div class="nivora-avatar-preview-wrap">
                    <div class="nivora-avatar-large" id="profileLargeAvatar">
                        ${pic ? `<img src="${pic}" alt="${escapeHTML(name)}" />` : `<span>${name.charAt(0).toUpperCase()}</span>`}
                    </div>
                    <div>
                        <button type="button" class="nivora-detail-btn" id="changeAvatarBtn">📷 Change Photo</button>
                    </div>
                </div>

                <div id="profileViewMode">
                    <div class="nivora-detail-row">
                        <span class="nivora-detail-label">Display Name</span>
                        <span class="nivora-detail-value" id="profileDisplayName">${escapeHTML(name)}</span>
                    </div>
                    <div class="nivora-detail-row">
                        <span class="nivora-detail-label">Email</span>
                        <span class="nivora-detail-value">${escapeHTML(email)}</span>
                    </div>
                    <div class="nivora-detail-row">
                        <span class="nivora-detail-label">NIVORA ID</span>
                        <span class="nivora-detail-value">${escapeHTML(userId)}</span>
                    </div>
                    <div class="nivora-detail-actions">
                        <button type="button" class="nivora-detail-btn" id="startEditNameBtn">✏️ Edit Name</button>
                    </div>
                </div>

                <div class="nivora-inline-edit" id="profileEditMode" style="display:none;">
                    <label style="font-size:11px;color:#858da0;font-weight:600;">Edit Display Name</label>
                    <input type="text" id="editNameInput" value="${escapeHTML(name)}" maxlength="50" placeholder="Enter display name">
                    <div class="nivora-detail-actions">
                        <button type="button" class="nivora-detail-btn" id="cancelEditNameBtn">Cancel</button>
                        <button type="button" class="nivora-detail-btn" id="saveEditNameBtn" style="border-color:#6c63ff;color:#6c63ff;">Save Changes</button>
                    </div>
                </div>
            `;
            toggleAccordionItem($("profileBtn"), "profile", html);

            setTimeout(() => {
                $("changeAvatarBtn")?.addEventListener("click", () => {
                    $("profileAvatarInput")?.click();
                });

                $("startEditNameBtn")?.addEventListener("click", () => {
                    const vm = $("profileViewMode");
                    const em = $("profileEditMode");
                    if (vm) vm.style.display = "none";
                    if (em) em.style.display = "flex";
                    $("editNameInput")?.focus();
                });

                $("cancelEditNameBtn")?.addEventListener("click", () => {
                    const vm = $("profileViewMode");
                    const em = $("profileEditMode");
                    if (em) em.style.display = "none";
                    if (vm) vm.style.display = "block";
                });

                $("saveEditNameBtn")?.addEventListener("click", async () => {
                    const input = $("editNameInput");
                    const newName = input ? input.value.trim() : "";
                    if (!newName || newName.length < 2) {
                        alert("Please enter a valid display name (at least 2 characters).");
                        input?.focus();
                        return;
                    }

                    try {
                        const res = await fetch("/api/user/profile", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                userId: user.user_id,
                                email: user.email,
                                name: newName
                            })
                        });
                        let data = null;
                        const contentType = res.headers.get("content-type") || "";
                        if (contentType.includes("application/json")) {
                            data = await res.json().catch(() => null);
                        }
                        if (!res.ok) throw new Error(data?.error || "Profile update failed");

                        user.name = newName;
                        saveUser(user);
                        updateUserUI(user);

                        const disp = $("profileDisplayName");
                        if (disp) disp.textContent = newName;

                        const vm = $("profileViewMode");
                        const em = $("profileEditMode");
                        if (em) em.style.display = "none";
                        if (vm) vm.style.display = "block";

                        showToast("Display name updated successfully! ✅");
                    } catch (err) {
                        console.error("Profile save error:", err);
                        alert("Could not update name. Please try again.");
                    }
                });
            }, 50);
        });

        // Account Tab
        $("googleSignInBtn")?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const user = getUser();
            const html = `
                <div class="nivora-detail-title">🔐 Account & Security</div>
                <p class="nivora-detail-text">Connected Account: <strong>${escapeHTML(user.email || "Guest Session")}</strong></p>
                <p class="nivora-detail-text" style="margin-top:6px;">Your session is authenticated and secured with server-side secrets.</p>
            `;
            toggleAccordionItem($("googleSignInBtn"), "account", html);
        });

        // Chat History Tab
        $("historyBtn")?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const html = `
                <div class="nivora-detail-title">🕘 Saved Conversations</div>
                <p class="nivora-detail-text">You have <strong>${chats.length}</strong> conversation(s) stored.</p>
                <div class="nivora-detail-actions">
                    <button type="button" class="nivora-detail-btn" id="openLibFromSettings">📚 Open Library</button>
                </div>
            `;
            toggleAccordionItem($("historyBtn"), "history", html);
            setTimeout(() => {
                $("openLibFromSettings")?.addEventListener("click", () => {
                    closeSettings();
                    showLibrary();
                });
            }, 50);
        });

        // Memory Management Tab
        $("memoryBtn")?.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const user = getUser();
            let memories = [];
            try {
                const res = await fetch(`/api/memory?userId=${user.user_id || "anonymous"}`);
                const contentType = res.headers.get("content-type") || "";
                if (res.ok && contentType.includes("application/json")) {
                    const data = await res.json().catch(() => null);
                    if (data && Array.isArray(data.memories)) memories = data.memories;
                }
            } catch {}

            const memList = memories.length > 0
                ? memories.map((m) => `<li style="padding:4px 0;border-bottom:1px solid #292d37;">${escapeHTML(m.content)}</li>`).join("")
                : "<li style='color:#7f8798;'>No saved memories yet.</li>";

            const html = `
                <div class="nivora-detail-title">🧠 Safe Memory System</div>
                <p class="nivora-detail-text">NIVORA remembers your preferences to personalize responses.</p>
                <ul style="margin:8px 0;padding-left:16px;font-size:11px;color:#cdd4e2;max-height:100px;overflow-y:auto;">
                    ${memList}
                </ul>
                <div class="nivora-detail-actions">
                    <button type="button" class="nivora-detail-btn" id="addMemoryBtn">➕ Add Preference</button>
                    <button type="button" class="nivora-detail-btn danger" id="clearMemoryBtn">🗑 Clear Memory</button>
                </div>
            `;
            toggleAccordionItem($("memoryBtn"), "memory", html);

            setTimeout(() => {
                $("addMemoryBtn")?.addEventListener("click", async () => {
                    const pref = window.prompt("What preference or instruction should NIVORA remember?");
                    if (pref && pref.trim()) {
                        await fetch("/api/memory", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ userId: user.user_id || "anonymous", content: pref.trim() })
                        });
                        alert("Memory saved! ✅");
                        closeSettings();
                    }
                });
                $("clearMemoryBtn")?.addEventListener("click", async () => {
                    if (confirm("Clear all remembered preferences?")) {
                        await fetch("/api/memory/clear", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ userId: user.user_id || "anonymous" })
                        });
                        alert("Memories cleared.");
                        closeSettings();
                    }
                });
            }, 50);
        });

        // Appearance & Theme Tab with Theme Customizer
        function renderAppearanceDetail() {
            const currentTheme = getSavedTheme();
            const currentCustomTheme = getSavedCustomTheme();
            const themes = [
                { id: "light", icon: "☀️", name: "Light", desc: "Clean bright look with dark readable text" },
                { id: "dark", icon: "🌙", name: "Dark", desc: "Default dark interface with glowing accents" },
                { id: "ghost", icon: "👻", name: "Ghost", desc: "Premium black & red cyber glass" }
            ];

            const optionsHtml = themes.map(t => {
                const isSelected = currentTheme === t.id;
                return `
                    <button type="button" class="theme-option-row ${isSelected ? 'active' : ''}" data-theme-target="${t.id}">
                        <div class="theme-option-icon">${t.icon}</div>
                        <div class="theme-option-info">
                            <span class="theme-option-title">${t.name}</span>
                            <span class="theme-option-subtitle">${t.desc}</span>
                        </div>
                        ${isSelected ? '<span class="theme-checkmark">✓</span>' : ''}
                    </button>
                `;
            }).join("");

            const customThemes = Object.values(CUSTOM_THEME_PRESETS);
            const customOptionsHtml = customThemes.map(ct => {
                const isSelected = currentCustomTheme === ct.id;
                return `
                    <button type="button" class="theme-customizer-card ${isSelected ? 'active' : ''}" data-custom-target="${ct.id}">
                        <div class="theme-customizer-preview-circle ${ct.swatchClass}"></div>
                        <span class="theme-customizer-label">${ct.name}</span>
                        <span class="theme-customizer-hint">${ct.badge}</span>
                        ${isSelected ? '<span class="theme-customizer-check">✓</span>' : ''}
                    </button>
                `;
            }).join("");

            return `
                <div class="nivora-detail-title">🎨 Appearance</div>
                <div class="theme-options-container">
                    ${optionsHtml}
                </div>
                <div class="theme-customizer-section">
                    <div class="theme-customizer-title">✨ Theme Customizer</div>
                    <p class="theme-customizer-desc">Toggle color aesthetics using dynamic CSS variables:</p>
                    <div class="theme-customizer-grid">
                        ${customOptionsHtml}
                    </div>
                </div>
            `;
        }

        function attachThemeOptionListeners() {
            setTimeout(() => {
                const panel = $("settingsPanel");
                if (!panel) return;

                // Base theme buttons (Light / Dark / Ghost)
                const baseButtons = panel.querySelectorAll("[data-theme-target]");
                baseButtons.forEach(btn => {
                    btn.addEventListener("click", (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const targetTheme = btn.getAttribute("data-theme-target");
                        if (targetTheme) {
                            applyTheme(targetTheme, true);
                            const names = { light: "Light Mode ☀️", dark: "Dark Mode 🌙", ghost: "Ghost Mode 👻" };
                            showToast(`Switched to ${names[targetTheme] || targetTheme}`, "success");
                            const detail = $("appearanceBtn")?.nextElementSibling;
                            if (detail && detail.classList.contains("nivora-setting-detail")) {
                                detail.innerHTML = renderAppearanceDetail();
                                attachThemeOptionListeners();
                            }
                        }
                    });
                });

                // Theme Customizer cards (Oceanic Blue / Cyberpunk Neon / Minimalist Slate)
                const customButtons = panel.querySelectorAll("[data-custom-target]");
                customButtons.forEach(btn => {
                    btn.addEventListener("click", (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const targetCustom = btn.getAttribute("data-custom-target");
                        if (targetCustom) {
                            const current = getSavedCustomTheme();
                            if (current === targetCustom) {
                                // Toggle off back to default
                                applyCustomTheme("", true);
                                showToast("Reset to default colorway", "info");
                            } else {
                                applyCustomTheme(targetCustom, true);
                                const preset = CUSTOM_THEME_PRESETS[targetCustom];
                                showToast(`Theme Customizer: ${preset ? preset.name : targetCustom} ✨`, "success");
                            }
                            const detail = $("appearanceBtn")?.nextElementSibling;
                            if (detail && detail.classList.contains("nivora-setting-detail")) {
                                detail.innerHTML = renderAppearanceDetail();
                                attachThemeOptionListeners();
                            }
                        }
                    });
                });
            }, 30);
        }

        $("appearanceBtn")?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const html = renderAppearanceDetail();
            toggleAccordionItem($("appearanceBtn"), "appearance", html);
            attachThemeOptionListeners();
        });

        // Clear History Tab
        $("clearHistoryBtn")?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const html = `
                <div class="nivora-detail-title">🗑 Clear All Chats</div>
                <p class="nivora-detail-text">This will remove all saved chat sessions from this browser.</p>
                <div class="nivora-detail-actions">
                    <button type="button" class="nivora-detail-btn danger" id="confirmClearHistory">Clear all chats</button>
                </div>
            `;
            toggleAccordionItem($("clearHistoryBtn"), "clear", html);
            setTimeout(() => {
                $("confirmClearHistory")?.addEventListener("click", () => {
                    if (confirm("Are you sure you want to delete all conversations?")) {
                        chats = [];
                        activeChatId = null;
                        localStorage.removeItem(CHAT_STORAGE_KEY);
                        localStorage.removeItem(ACTIVE_CHAT_KEY);
                        startNewChat();
                        closeSettings();
                        alert("All chats have been cleared.");
                    }
                });
            }, 50);
        });

        // Sign Out Button
        $("signOutBtn")?.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log("NIVORA sign out clicked");

            const btn = $("signOutBtn");
            if (btn) btn.style.opacity = "0.6";

            try {
                if (window.NivoraAuth && window.NivoraAuth.signOut) {
                    await window.NivoraAuth.signOut();
                } else {
                    await fetch("/auth/logout", { method: "POST" });
                }
                console.log("Firebase sign out successful");
                showToast("Signed out successfully.", "success");
            } catch (err) {
                console.error("Firebase sign out error:", err);
                const safeMsg = (err && err.message) || "Failed to sign out. Please try again.";
                showToast(safeMsg, "error");
            } finally {
                if (btn) btn.style.opacity = "1";
                currentAuthenticatedUser = null;
                if ($("loginPassword")) $("loginPassword").value = "";
                localStorage.removeItem(USER_STORAGE_KEY);
                localStorage.removeItem(ACTIVE_CHAT_KEY);
                sessionStorage.removeItem("nivora_user");
                chats = [];
                activeChatId = null;
                renderRecentChats();
                const chatContainer = $("chatMessages");
                if (chatContainer) chatContainer.innerHTML = "";
                const list = $("projectsList");
                if (list) list.innerHTML = "";
                if (window.google?.accounts?.id) {
                    try {
                        window.google.accounts.id.disableAutoSelect();
                    } catch (_) {}
                }
                stopSpeaking();
                closeSettings();
                closeModals();
                openLogin();
            }
        });
    }

    // ----------------------------------------------------
    // SEARCH & LIBRARY MODALS
    // ----------------------------------------------------

    function searchChats(query) {
        const resultsEl = $("searchResults");
        if (!resultsEl) return;
        resultsEl.innerHTML = "";

        const q = (query || "").trim().toLowerCase();
        if (!q) {
            resultsEl.innerHTML = "<div style='color:#777;padding:10px;'>Type to search your chats...</div>";
            return;
        }

        const filtered = chats.filter((c) => {
            const titleMatch = (c.title || "").toLowerCase().includes(q);
            const msgMatch = (c.messages || []).some((m) => (m.content || "").toLowerCase().includes(q));
            return titleMatch || msgMatch;
        });

        if (filtered.length === 0) {
            resultsEl.innerHTML = `<div class="empty-chats">No matching chats found for "${escapeHTML(q)}".</div>`;
            return;
        }

        filtered.forEach((chat) => {
            const item = document.createElement("div");
            item.className = "chat-item";
            item.textContent = chat.title || "New Chat";
            item.onclick = () => {
                closeModals();
                loadChat(chat.id);
            };
            resultsEl.appendChild(item);
        });
    }

    function showLibrary() {
        const panel = $("libraryPanel");
        const list = $("libraryList");
        if (!panel || !list) return;

        panel.classList.add("active");
        list.innerHTML = "";

        if (chats.length === 0) {
            list.innerHTML = `
                <div class="empty-panel">
                    <div class="empty-icon">📚</div>
                    <h4>Your Library is empty</h4>
                    <p>Your saved conversations and files will appear here.</p>
                </div>
            `;
            return;
        }

        chats.forEach((chat) => {
            const item = document.createElement("div");
            item.className = "chat-item";
            item.textContent = (chat.pinned ? "📌 " : "") + (chat.title || "New Chat");
            item.onclick = () => {
                panel.classList.remove("active");
                loadChat(chat.id);
            };
            list.appendChild(item);
        });
    }

    function showPinned() {
        const panel = $("pinnedPanel");
        const list = $("pinnedList");
        if (!panel || !list) return;

        panel.classList.add("active");
        list.innerHTML = "";

        const pinnedChats = chats.filter((c) => c.pinned);
        if (pinnedChats.length === 0) {
            list.innerHTML = `
                <div class="empty-panel">
                    <div class="empty-icon">📌</div>
                    <h4>No pinned chats</h4>
                    <p>Pin important conversations from the three-dots menu.</p>
                </div>
            `;
            return;
        }

        pinnedChats.forEach((chat) => {
            const item = document.createElement("div");
            item.className = "chat-item";
            item.textContent = "📌 " + (chat.title || "New Chat");
            item.onclick = () => {
                panel.classList.remove("active");
                loadChat(chat.id);
            };
            list.appendChild(item);
        });
    }

    // ----------------------------------------------------
    // SIDEBAR CONTROLS, KEYBOARD SHORTCUTS & RESIZING
    // ----------------------------------------------------

    function toggleSidebar() {
        const app = document.querySelector(".app");
        const sidebar = $("sidebar");
        const backdrop = $("nivoraMobileBackdrop");
        if (!app || !sidebar) return false;
        if (app.style.display === "none") return false;

        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
            const isMobileOpen = sidebar.classList.contains("mobile-open");
            if (isMobileOpen) {
                sidebar.classList.remove("mobile-open");
                backdrop?.classList.remove("show");
                return false;
            } else {
                app.classList.remove("sidebar-closed");
                sidebar.classList.add("mobile-open");
                backdrop?.classList.add("show");
                return true;
            }
        } else {
            const isClosed = app.classList.contains("sidebar-closed");
            if (isClosed) {
                app.classList.remove("sidebar-closed");
                return true;
            } else {
                app.classList.add("sidebar-closed");
                return false;
            }
        }
    }

    function focusChatInput() {
        const app = document.querySelector(".app");
        if (!app || app.style.display === "none") return false;

        const input = $("messageInput");
        if (!input) return false;

        input.focus();
        try {
            const len = input.value.length;
            input.setSelectionRange(len, len);
        } catch (e) {}

        const box = input.closest(".input-box");
        if (box) {
            box.classList.remove("shortcut-highlight");
            void box.offsetWidth;
            box.classList.add("shortcut-highlight");
            setTimeout(() => box.classList.remove("shortcut-highlight"), 650);
        }
        return true;
    }

    function setupSidebar() {
        const app = document.querySelector(".app");
        const sidebar = $("sidebar");
        const closeBtn = $("sidebarClose");
        const openBtn = $("sidebarOpen");
        const backdrop = $("nivoraMobileBackdrop");

        closeBtn?.addEventListener("click", (e) => {
            e.preventDefault();
            app?.classList.add("sidebar-closed");
            sidebar?.classList.remove("mobile-open");
            backdrop?.classList.remove("show");
        });

        openBtn?.addEventListener("click", (e) => {
            e.preventDefault();
            app?.classList.remove("sidebar-closed");
            if (window.innerWidth <= 768) {
                sidebar?.classList.add("mobile-open");
                backdrop?.classList.add("show");
            }
        });

        backdrop?.addEventListener("click", () => {
            sidebar?.classList.remove("mobile-open");
            backdrop?.classList.remove("show");
        });

        // Sidebar resizer drag
        let resizer = sidebar?.querySelector(".nivora-sidebar-resizer");
        if (!resizer && sidebar) {
            resizer = document.createElement("div");
            resizer.className = "nivora-sidebar-resizer";
            sidebar.appendChild(resizer);
        }

        if (resizer) {
            let isDragging = false;
            resizer.addEventListener("pointerdown", (e) => {
                e.preventDefault();
                isDragging = true;
                document.body.style.userSelect = "none";
                document.body.style.cursor = "col-resize";
            });

            window.addEventListener("pointermove", (e) => {
                if (!isDragging || !sidebar) return;
                const newWidth = Math.max(180, Math.min(440, e.clientX));
                sidebar.style.width = `${newWidth}px`;
                sidebar.style.minWidth = `${newWidth}px`;
            });

            window.addEventListener("pointerup", () => {
                if (!isDragging) return;
                isDragging = false;
                document.body.style.userSelect = "";
                document.body.style.cursor = "";
            });
        }
    }

    function setupKeyboardShortcuts() {
        const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
        const kbdBadge = $("chatInputShortcutBadge");
        if (kbdBadge) {
            kbdBadge.textContent = isMac ? "⌘K" : "Ctrl K";
            kbdBadge.title = `Focus chat input (${isMac ? "⌘K" : "Ctrl+K"})`;
            kbdBadge.addEventListener("click", (e) => {
                e.preventDefault();
                focusChatInput();
            });
        }

        // Update modal shortcut modifier labels for Mac vs Windows/Linux
        document.querySelectorAll(".shortcut-mod").forEach((el) => {
            el.textContent = isMac ? "⌘" : "Ctrl";
        });

        const sidebarCloseBtn = $("sidebarClose");
        if (sidebarCloseBtn) {
            sidebarCloseBtn.title = `Close sidebar (${isMac ? "⌘⇧L" : "Ctrl+Shift+L"})`;
        }
        const sidebarOpenBtn = $("sidebarOpen");
        if (sidebarOpenBtn) {
            sidebarOpenBtn.title = `Open sidebar (${isMac ? "⌘⇧L" : "Ctrl+Shift+L"})`;
        }
        const chatInput = $("messageInput");
        if (chatInput) {
            chatInput.title = `Message NIVORA (${isMac ? "⌘K" : "Ctrl+K"} to focus)`;
        }

        // Global keydown handler for app navigation
        window.addEventListener("keydown", (e) => {
            const app = document.querySelector(".app");
            // Do not intercept if app is hidden (e.g. during login/signup/reset or startup video)
            if (!app || app.style.display === "none") return;

            const isCmdOrCtrl = e.metaKey || e.ctrlKey;
            const key = (e.key || "").toLowerCase();

            // 1. Cmd/Ctrl + K -> Focus chat input
            if (isCmdOrCtrl && !e.shiftKey && !e.altKey && (key === "k" || e.code === "KeyK")) {
                e.preventDefault();
                focusChatInput();
                return;
            }

            // 2. Cmd/Ctrl + Shift + L -> Toggle sidebar
            if (isCmdOrCtrl && e.shiftKey && !e.altKey && (key === "l" || e.code === "KeyL")) {
                e.preventDefault();
                toggleSidebar();
                return;
            }
        });
    }

    // ----------------------------------------------------
    // NIVORA AI ROBOT COMPANION — ADVANCED ANIMATION ENGINE
    // Complete character animation system with cinematic intro,
    // walking physics, finite state machine (FSM), emotion engine,
    // intelligent idle, cursor tracking, and duck/peek interactions.
    // ----------------------------------------------------
    class NivoraRobotController {
        static STATES = Object.freeze({
            IDLE: "IDLE",
            DANCING: "DANCING",
            GOODBYE: "GOODBYE",
            HIDING: "HIDING",
            HIDDEN: "HIDDEN",
            REAPPEARING: "REAPPEARING",
            // Backward-compatible aliases
            VISIBLE: "IDLE",
            HIDDEN_BELOW_INPUT: "HIDDEN",
            DUCKING: "HIDING",
            PEEKING_UP: "REAPPEARING",
            THINKING: "THINKING",
            EXCITED: "EXCITED",
            HAPPY: "HAPPY",
            CURIOUS: "CURIOUS",
            CONFUSED: "CONFUSED",
            SURPRISED: "SURPRISED",
            SLEEPY: "SLEEPY",
            LISTENING: "LISTENING",
            ERROR: "ERROR",
            SUCCESS: "SUCCESS",
            WALKING: "WALKING"
        });

        constructor(robotElement) {
            this.robot = robotElement || $("nivoraRobot");
            if (!this.robot) return;

            this.speechBubble = $("nivoraRobotSpeech");
            this.speechText = $("nivoraRobotSpeechText");
            this.leftPupil = this.robot.querySelector(".robot-pupil-left");
            this.rightPupil = this.robot.querySelector(".robot-pupil-right");
            this.leftEye = this.robot.querySelector(".robot-eye-left");
            this.rightEye = this.robot.querySelector(".robot-eye-right");
            this.headGroup = this.robot.querySelector(".robot-head-group");
            this.mouthEl = $("robotMouth");
            this.messageInput = $("messageInput");
            this.messagesContainer = $("messages");
            this.voiceBtn = $("voiceBtn");
            this.attachmentTray = $("attachmentTray");

            // FSM State Tracking
            this.state = NivoraRobotController.STATES.IDLE;
            this.previousState = null;
            this.currentEmotion = "idle";
            this.isInteracting = false;
            this.isIntroRunning = false;
            this.isTypingWatching = false;

            // Timer management for clean cancellation of overlapping animations
            this.timers = {
                idle: null,
                speech: null,
                actionReset: null,
                tapSequence: null,
                ducking: null,
                peeking: null,
                interaction: null,
                typing: null,
                scroll: null,
                thinkingCycle: null
            };

            // Rotating pool of thinking phrases displayed in speech bubble every 2s
            this.thinkingPhrases = [
                "Thinking… 🤔",
                "Analyzing… ⚡",
                "Processing… 💡",
                "Connecting ideas… 🔍",
                "Synthesizing thoughts… 🧠",
                "Formulating answer… ✨",
                "Calculating options… 🤖",
                "Exploring possibilities… 🌌",
                "Reviewing details… 📚",
                "Composing response… 📝"
            ];

            // Comprehensive list of managed animation/emotion CSS classes
            this.managedClasses = [
                "robot-dancing",
                "robot-goodbye",
                "robot-hiding",
                "robot-hidden",
                "robot-reappearing",
                "hidden-below",
                "robot-peeking-up",
                "robot-active",
                "robot-walking",
                "robot-waving",
                "robot-double-blink",
                "robot-happy",
                "robot-sleepy",
                "robot-dance",
                "robot-stretch",
                "robot-salute",
                "robot-peekaboo",
                "robot-sparkle-active",
                "emotion-thinking",
                "emotion-curious",
                "emotion-confused",
                "emotion-surprised",
                "emotion-excited",
                "emotion-error",
                "emotion-listening",
                "emotion-happy",
                "emotion-sleepy",
                "idle",
                "thinking",
                "excited"
            ];

            // Random dialogue choice pool for friendly user clicks
            this.clickReactions = [
                { first: "Hey! 👋", second: "How can I help you?" },
                { first: "Hi again! 👋", second: "Need something?" },
                { first: "Hey! 🤖", second: "I'm ready!" },
                { first: "What's up? ✨", second: "How can I help?" },
                { first: "Ready! 🚀", second: "Let's do it!" },
                { first: "Hello! 👋", second: "Ask me anything!" }
            ];

            this.init();
        }

        // ------------------------------------------------
        // 1. TIMER & CLASS SANITATION
        // ------------------------------------------------
        clearAllTimers() {
            this.stopThinkingCycle();
            Object.keys(this.timers).forEach((key) => {
                if (this.timers[key]) {
                    clearTimeout(this.timers[key]);
                    this.timers[key] = null;
                }
            });
        }

        clearActiveAnimations(keepClasses = []) {
            if (!this.robot) return;
            const toKeep = new Set(keepClasses);
            this.managedClasses.forEach((cls) => {
                if (!toKeep.has(cls) && this.robot.classList.contains(cls)) {
                    this.robot.classList.remove(cls);
                }
            });
            this.robot.style.animation = "";
        }

        clearAnimationClasses(keepClasses = []) {
            return this.clearActiveAnimations(keepClasses);
        }

        // ------------------------------------------------
        // 2. STATE GETTERS & QUERIES
        // ------------------------------------------------
        getState() {
            return this.state;
        }

        isState(queryState) {
            return this.state === queryState;
        }

        // ------------------------------------------------
        // 3. SPEECH BUBBLE CONTROLLER
        // ------------------------------------------------
        showSpeech(text, duration = 2400) {
            if (!this.speechBubble || !this.speechText) return;
            if (this.timers.speech) clearTimeout(this.timers.speech);

            this.speechText.textContent = text;
            this.speechBubble.classList.add("visible");

            if (duration > 0) {
                this.timers.speech = setTimeout(() => {
                    this.hideSpeech();
                }, duration);
            }
        }

        hideSpeech() {
            if (!this.speechBubble) return;
            this.speechBubble.classList.remove("visible");
            if (this.timers.speech) {
                clearTimeout(this.timers.speech);
                this.timers.speech = null;
            }
        }

        // ------------------------------------------------
        // 3B. THINKING PHRASE CYCLER (EVERY 2 SECONDS)
        // ------------------------------------------------
        startThinkingCycle(initialPhrase = null) {
            this.stopThinkingCycle();
            let lastIndex = -1;
            const pickNextPhrase = () => {
                let idx;
                do {
                    idx = Math.floor(Math.random() * this.thinkingPhrases.length);
                } while (this.thinkingPhrases.length > 1 && idx === lastIndex);
                lastIndex = idx;
                return this.thinkingPhrases[idx];
            };

            const firstPhrase = initialPhrase || pickNextPhrase();
            this.showSpeech(firstPhrase, 0);

            this.timers.thinkingCycle = setInterval(() => {
                if (this.state === NivoraRobotController.STATES.THINKING) {
                    this.showSpeech(pickNextPhrase(), 0);
                } else {
                    this.stopThinkingCycle();
                }
            }, 2000);
        }

        stopThinkingCycle() {
            if (this.timers.thinkingCycle) {
                clearInterval(this.timers.thinkingCycle);
                this.timers.thinkingCycle = null;
            }
        }

        // ------------------------------------------------
        // 4. MOUTH & VISOR EXPRESSIONS
        // ------------------------------------------------
        setMouthShape(emotion) {
            if (!this.mouthEl) return;
            switch (emotion) {
                case "happy":
                case "excited":
                case "success":
                    this.mouthEl.setAttribute("d", "M 68 67 Q 76 74 84 67");
                    this.mouthEl.setAttribute("stroke", "#38bdf8");
                    this.mouthEl.setAttribute("stroke-width", "2.2");
                    break;
                case "curious":
                    this.mouthEl.setAttribute("d", "M 70 68 Q 75 66 80 67");
                    this.mouthEl.setAttribute("stroke", "#38bdf8");
                    this.mouthEl.setAttribute("stroke-width", "1.8");
                    break;
                case "thinking":
                    this.mouthEl.setAttribute("d", "M 71 67 Q 76 66 81 67");
                    this.mouthEl.setAttribute("stroke", "#38bdf8");
                    this.mouthEl.setAttribute("stroke-width", "1.6");
                    break;
                case "surprised":
                    this.mouthEl.setAttribute("d", "M 73 68 A 3 3 0 1 1 79 68 A 3 3 0 1 1 73 68");
                    this.mouthEl.setAttribute("stroke", "#38bdf8");
                    this.mouthEl.setAttribute("stroke-width", "1.8");
                    break;
                case "confused":
                case "error":
                    this.mouthEl.setAttribute("d", "M 69 66 Q 73 69 77 66 Q 81 64 83 67");
                    this.mouthEl.setAttribute("stroke", "#f87171");
                    this.mouthEl.setAttribute("stroke-width", "1.8");
                    break;
                case "sleepy":
                    this.mouthEl.setAttribute("d", "M 72 68 Q 76 72 80 68");
                    this.mouthEl.setAttribute("stroke", "#818cf8");
                    this.mouthEl.setAttribute("stroke-width", "1.8");
                    break;
                default:
                    this.mouthEl.setAttribute("d", "M 70 67 Q 76 68 82 67");
                    this.mouthEl.setAttribute("stroke", "#38bdf8");
                    this.mouthEl.setAttribute("stroke-width", "1.8");
                    break;
            }
        }

        // ------------------------------------------------
        // 5. FINITE STATE MACHINE (FSM) TRANSITION ENGINE
        // Handles transitions between IDLE, THINKING, EXCITED,
        // and HIDDEN_BELOW_INPUT while clearing active CSS animations
        // on #nivoraRobot before applying the new state class.
        // ------------------------------------------------
        transitionTo(targetState, payload = {}) {
            if (!targetState) return;
            const { STATES } = NivoraRobotController;
            const raw = String(targetState).toUpperCase();

            // Clear any active reset timers
            if (this.timers.actionReset) {
                clearTimeout(this.timers.actionReset);
                this.timers.actionReset = null;
            }

            // Stop thinking phrase cycle if moving to any state other than THINKING
            if (raw !== "THINKING") {
                this.stopThinkingCycle();
            }

            // Clear active CSS animations on #nivoraRobot before applying the new state class
            this.clearActiveAnimations();

            console.log(`[NIVORA Robot ${new Date().toISOString()}] State: ${this.previousState || "NONE"} -> ${raw}`, payload || "");

            switch (raw) {
                case "DANCING":
                    this.state = STATES.DANCING;
                    this.currentEmotion = "dancing";
                    this.robot.classList.add("robot-dancing");
                    break;

                case "GOODBYE":
                    this.state = STATES.GOODBYE;
                    this.currentEmotion = "goodbye";
                    this.robot.classList.add("robot-goodbye", "robot-happy");
                    break;

                case "HIDING":
                case "DUCKING":
                    this.state = STATES.HIDING;
                    this.currentEmotion = "hiding";
                    this.robot.classList.add("robot-hiding");
                    break;

                case "HIDDEN":
                case "HIDDEN_BELOW_INPUT":
                    this.state = STATES.HIDDEN;
                    this.currentEmotion = "hidden";
                    this.robot.classList.add("robot-hidden", "hidden-below");
                    this.hideSpeech();
                    this.robot.setAttribute("aria-label", "NIVORA AI companion (hidden, click to summon back)");
                    this.robot.setAttribute("title", "Click to summon NIVORA back! 🤖");
                    break;

                case "REAPPEARING":
                case "PEEKING_UP":
                    this.state = STATES.REAPPEARING;
                    this.currentEmotion = "reappearing";
                    this.robot.classList.add("robot-reappearing");
                    break;

                case "THINKING":
                    this.state = STATES.THINKING;
                    this.currentEmotion = "thinking";
                    this.robot.classList.add("emotion-thinking", "thinking");
                    if (this.leftPupil) this.leftPupil.style.transform = "translate(0, -3.5px)";
                    if (this.rightPupil) this.rightPupil.style.transform = "translate(0, -3.5px)";
                    this.setMouthShape("thinking");
                    // Cycle random thinking phrases in speech bubble every 2 seconds
                    this.startThinkingCycle(payload && payload.message ? payload.message : null);
                    if (payload && payload.duration > 0) {
                        this.timers.actionReset = setTimeout(() => {
                            if (this.state === STATES.THINKING) {
                                this.transitionTo(STATES.IDLE);
                            }
                        }, payload.duration);
                    }
                    break;

                case "EXCITED":
                    this.state = STATES.EXCITED;
                    this.currentEmotion = "excited";
                    this.robot.classList.add("emotion-excited", "excited", "robot-happy");
                    if (this.leftPupil) this.leftPupil.style.transform = "translate(0, 0)";
                    if (this.rightPupil) this.rightPupil.style.transform = "translate(0, 0)";
                    this.setMouthShape("excited");
                    if (payload && payload.message) {
                        this.showSpeech(payload.message, payload.duration || 1800);
                    }
                    if (payload && payload.duration > 0) {
                        this.timers.actionReset = setTimeout(() => {
                            if (this.state === STATES.EXCITED) {
                                this.transitionTo(STATES.IDLE);
                            }
                        }, payload.duration);
                    }
                    break;

                case "VISIBLE":
                    if (this.previousState === STATES.HIDDEN || this.previousState === STATES.HIDING) {
                        this.reappear();
                        return;
                    }
                    this.transitionTo(STATES.IDLE, payload);
                    break;

                case "SUCCESS":
                    this.state = STATES.SUCCESS;
                    this.currentEmotion = "success";
                    this.robot.classList.add("emotion-happy", "robot-happy");
                    this.setMouthShape("success");
                    if (payload && payload.message) this.showSpeech(payload.message, payload.duration || 2200);
                    if (payload && payload.duration > 0) {
                        this.timers.actionReset = setTimeout(() => {
                            if (this.state === STATES.SUCCESS) this.transitionTo(STATES.IDLE);
                        }, payload.duration);
                    }
                    break;

                case "CURIOUS":
                    this.state = STATES.CURIOUS;
                    this.currentEmotion = "curious";
                    this.robot.classList.add("emotion-curious");
                    this.setMouthShape("curious");
                    if (this.leftPupil) this.leftPupil.style.transform = "translate(0, 2.5px)";
                    if (this.rightPupil) this.rightPupil.style.transform = "translate(0, 2.5px)";
                    if (payload && payload.message) this.showSpeech(payload.message, payload.duration || 1800);
                    if (payload && payload.duration > 0) {
                        this.timers.actionReset = setTimeout(() => {
                            if (this.state === STATES.CURIOUS) this.transitionTo(STATES.IDLE);
                        }, payload.duration);
                    }
                    break;

                case "CONFUSED":
                    this.state = STATES.CONFUSED;
                    this.currentEmotion = "confused";
                    this.robot.classList.add("emotion-confused");
                    this.setMouthShape("confused");
                    if (payload && payload.message) this.showSpeech(payload.message, payload.duration || 2000);
                    if (payload && payload.duration > 0) {
                        this.timers.actionReset = setTimeout(() => {
                            if (this.state === STATES.CONFUSED) this.transitionTo(STATES.IDLE);
                        }, payload.duration);
                    }
                    break;

                case "SURPRISED":
                    this.state = STATES.SURPRISED;
                    this.currentEmotion = "surprised";
                    this.robot.classList.add("emotion-surprised");
                    this.setMouthShape("surprised");
                    if (payload && payload.message) this.showSpeech(payload.message, payload.duration || 1800);
                    if (payload && payload.duration > 0) {
                        this.timers.actionReset = setTimeout(() => {
                            if (this.state === STATES.SURPRISED) this.transitionTo(STATES.IDLE);
                        }, payload.duration);
                    }
                    break;

                case "LISTENING":
                    this.state = STATES.LISTENING;
                    this.currentEmotion = "listening";
                    this.robot.classList.add("emotion-listening");
                    if (payload && payload.message) this.showSpeech(payload.message, payload.duration || 0);
                    break;

                case "ERROR":
                    this.state = STATES.ERROR;
                    this.currentEmotion = "error";
                    this.robot.classList.add("emotion-error");
                    this.setMouthShape("error");
                    if (payload && payload.message) this.showSpeech(payload.message, payload.duration || 2400);
                    if (payload && payload.duration > 0) {
                        this.timers.actionReset = setTimeout(() => {
                            if (this.state === STATES.ERROR) this.transitionTo(STATES.IDLE);
                        }, payload.duration);
                    }
                    break;

                case "SLEEPY":
                    this.state = STATES.SLEEPY;
                    this.currentEmotion = "sleepy";
                    this.robot.classList.add("emotion-sleepy", "robot-sleepy");
                    this.setMouthShape("sleepy");
                    if (payload && payload.message) this.showSpeech(payload.message, payload.duration || 2500);
                    if (payload && payload.duration > 0) {
                        this.timers.actionReset = setTimeout(() => {
                            if (this.state === STATES.SLEEPY) this.transitionTo(STATES.IDLE);
                        }, payload.duration);
                    }
                    break;

                case "WALKING":
                    this.state = STATES.WALKING;
                    this.robot.classList.add("robot-walking");
                    break;

                case "IDLE":
                default:
                    this.state = STATES.IDLE;
                    this.currentEmotion = "idle";
                    this.robot.classList.add("robot-idle", "idle");
                    if (this.leftPupil) this.leftPupil.style.transform = "translate(0, 0)";
                    if (this.rightPupil) this.rightPupil.style.transform = "translate(0, 0)";
                    this.setMouthShape("idle");
                    this.robot.setAttribute("aria-label", "NIVORA AI companion");
                    this.robot.setAttribute("title", "NIVORA AI Companion – Click to interact!");
                    this.scheduleNextIdleAction();
                    break;
            }
        }

        applyEmotionState(emotion, message = null, duration = null) {
            this.setEmotion(emotion, message, duration);
        }

        setEmotion(emotion, message = null, duration = null) {
            const { STATES } = NivoraRobotController;
            const emotionToState = {
                idle: STATES.IDLE,
                thinking: STATES.THINKING,
                excited: STATES.EXCITED,
                success: STATES.SUCCESS,
                curious: STATES.CURIOUS,
                confused: STATES.CONFUSED,
                surprised: STATES.SURPRISED,
                error: STATES.ERROR,
                listening: STATES.LISTENING,
                happy: STATES.HAPPY,
                sleepy: STATES.SLEEPY
            };
            const targetState = emotionToState[emotion] || STATES.IDLE;
            this.transitionTo(targetState, { message, duration });
        }

        // ------------------------------------------------
        // 6. ROBOT TAP INTERACTION SEQUENCE
        // Transitions: IDLE -> DANCING -> GOODBYE -> HIDING -> HIDDEN
        // 1. Robot Notice (eyes look, double-blink, happy eyes, glowing antenna, surprised mouth)
        // 2. Short Cute Dance (1.5-2.0s AI futuristic celebration dance)
        // 3. Happy Expression (stops naturally, big happy expression, hand raises)
        // 4. Goodbye Message ("Bye! 👋" -> "See you soon! 🤖")
        // 5. Goodbye Wave (waves hand 2 times, blinks, tilts head, cute smile)
        // 6. Hide / Exit Animation (smoothly descends behind search box, completely disappears)
        // ------------------------------------------------
        startTapInteractionSequence() {
            const { STATES } = NivoraRobotController;
            if (this.state !== STATES.IDLE) return;

            this.isInteracting = true;
            if (this.timers.idle) clearTimeout(this.timers.idle);

            // STEP 1: ROBOT NOTICE (~450ms)
            // Look directly at user
            if (this.leftPupil) this.leftPupil.style.transform = "translate(0, 0)";
            if (this.rightPupil) this.rightPupil.style.transform = "translate(0, 0)";
            if (this.headGroup) this.headGroup.style.transform = "rotate(0deg)";

            // Blink twice and show surprised expression
            this.robot.classList.add("robot-double-blink");
            this.setMouthShape("surprised");

            setTimeout(() => {
                this.robot.classList.remove("robot-double-blink");
                this.robot.classList.add("robot-happy");
                this.setMouthShape("excited");

                // STEP 2: SHORT CUTE DANCE (~1.8 seconds)
                // State: DANCING
                this.transitionTo(STATES.DANCING);
                this.robot.classList.add("robot-dancing");

                // Rhythmic blink during dance at ~900ms
                setTimeout(() => {
                    if (this.state === STATES.DANCING) {
                        this.robot.classList.add("robot-double-blink");
                        setTimeout(() => this.robot.classList.remove("robot-double-blink"), 260);
                    }
                }, 900);

                // Dance completes naturally after 1800ms
                setTimeout(() => {
                    if (this.state !== STATES.DANCING) return;
                    this.robot.classList.remove("robot-dancing");

                    // STEP 3: HAPPY EXPRESSION & STEP 4: GOODBYE MESSAGE & STEP 5: GOODBYE WAVE
                    // State: GOODBYE
                    this.transitionTo(STATES.GOODBYE);
                    this.robot.classList.add("robot-goodbye", "robot-happy");
                    this.setMouthShape("happy");
                    if (this.headGroup) this.headGroup.style.transform = "rotate(5.5deg) translateY(-1px)";

                    // Show small speech bubble: "Bye! 👋"
                    this.showSpeech("Bye! 👋", 3000);

                    // Wave hand and double-blink
                    setTimeout(() => {
                        if (this.state === STATES.GOODBYE) {
                            this.robot.classList.add("robot-double-blink");
                            setTimeout(() => this.robot.classList.remove("robot-double-blink"), 280);
                        }
                    }, 450);

                    // After approximately 1000ms (within 800-1200ms), change to "See you soon! 🤖"
                    setTimeout(() => {
                        if (this.state !== STATES.GOODBYE) return;
                        this.showSpeech("See you soon! 🤖", 2500);

                        // Keep bubble visible briefly (900ms), then begin hide animation
                        setTimeout(() => {
                            if (this.state !== STATES.GOODBYE) return;

                            // STEP 6: HIDE / EXIT ANIMATION (~1050ms)
                            // State: HIDING
                            // Takes 1-2 tiny steps back, looks at user, final wave, slowly moves DOWN behind search box
                            this.transitionTo(STATES.HIDING);
                            this.hideSpeech();
                            this.robot.classList.remove("robot-goodbye");
                            this.robot.classList.add("robot-hiding");

                            setTimeout(() => {
                                this.robot.classList.remove("robot-hiding", "robot-happy");
                                if (this.headGroup) this.headGroup.style.transform = "";

                                // State: HIDDEN
                                this.transitionTo(STATES.HIDDEN);
                                this.robot.classList.add("robot-hidden", "hidden-below");
                                this.isInteracting = false;
                                this.robot.setAttribute("aria-label", "NIVORA AI companion (hidden, click to summon back)");
                                this.robot.setAttribute("title", "Click to summon NIVORA back! 🤖");
                            }, 1050);

                        }, 900);
                    }, 1000);

                }, 1800);

            }, 450);
        }

        // ------------------------------------------------
        // 7. RETURN / REAPPEAR ANIMATION
        // Transitions: HIDDEN -> REAPPEARING -> IDLE
        // 1. Robot peeks from underneath search box
        // 2. Shows eyes and blinks
        // 3. Slowly raises head and body
        // 4. Gives small wave ("I'm back! 🤖")
        // 5. Returns to normal position & resumes idle animation
        // ------------------------------------------------
        reappear() {
            const { STATES } = NivoraRobotController;
            if (this.state === STATES.REAPPEARING ||
                this.state === STATES.DANCING ||
                this.state === STATES.GOODBYE ||
                this.state === STATES.HIDING) return;

            this.isInteracting = true;
            this.transitionTo(STATES.REAPPEARING);

            this.robot.classList.remove("robot-hidden", "hidden-below");
            this.robot.classList.add("robot-reappearing");

            if (this.leftPupil) this.leftPupil.style.transform = "translate(0, 0)";
            if (this.rightPupil) this.rightPupil.style.transform = "translate(0, 0)";

            // Mid-peek blink (~420ms) as eyes appear above search box rim
            setTimeout(() => {
                if (this.state !== STATES.REAPPEARING) return;
                this.robot.classList.add("robot-double-blink");
                setTimeout(() => this.robot.classList.remove("robot-double-blink"), 260);
            }, 420);

            // Reappear animation completes at ~1050ms
            setTimeout(() => {
                if (this.state !== STATES.REAPPEARING) return;
                this.robot.classList.remove("robot-reappearing");
                this.robot.classList.add("robot-waving", "robot-happy");
                this.setMouthShape("happy");
                this.showSpeech("I'm back! 🤖", 1400);

                setTimeout(() => {
                    this.robot.classList.remove("robot-waving", "robot-happy");
                    this.setMouthShape("idle");
                    this.transitionTo(STATES.IDLE);
                    this.isInteracting = false;
                    this.robot.setAttribute("aria-label", "NIVORA AI companion");
                    this.robot.setAttribute("title", "NIVORA AI Companion – Click to interact!");
                    this.scheduleNextIdleAction();
                }, 1200);
            }, 1050);
        }

        // Backward compatibility helpers
        duckUnderneath() {
            this.startTapInteractionSequence();
        }

        peekUp() {
            this.reappear();
        }

        // ------------------------------------------------
        // 8. USER INTERACTION DISPATCHER (CLICK / TAP / KEY)
        // Disable additional clicks while DANCING / GOODBYE / HIDING.
        // ------------------------------------------------
        handleUserClick(e) {
            if (e && e.stopPropagation) e.stopPropagation();
            if (this.isIntroRunning) return;

            const { STATES } = NivoraRobotController;

            // Prevent interruption while animations are actively executing
            if (this.state === STATES.DANCING ||
                this.state === STATES.GOODBYE ||
                this.state === STATES.HIDING ||
                this.state === STATES.REAPPEARING) {
                return;
            }

            // If hidden, return/reappear; if visible/idle, run full tap interaction sequence
            if (this.state === STATES.HIDDEN) {
                this.reappear();
            } else {
                this.startTapInteractionSequence();
            }
        }

        // ------------------------------------------------
        // 9. BLINK ENGINES
        // ------------------------------------------------
        triggerDoubleBlink(callback) {
            this.robot.classList.add("robot-double-blink");
            setTimeout(() => {
                this.robot.classList.remove("robot-double-blink");
                if (callback) callback();
            }, 620);
        }

        // ------------------------------------------------
        // 10. INTELLIGENT IDLE ANIMATION ENGINE
        // ------------------------------------------------
        scheduleNextIdleAction() {
            if (this.timers.idle) clearTimeout(this.timers.idle);

            // Randomized interval: 3.5 to 7.5 seconds
            const nextDelay = Math.random() * 4000 + 3500;

            this.timers.idle = setTimeout(() => {
                if (!this.isInteracting &&
                    !this.isTypingWatching &&
                    !this.isIntroRunning &&
                    this.state === NivoraRobotController.STATES.IDLE &&
                    this.currentEmotion === "idle") {
                    this.performRandomIdleAction();
                }
                if (this.state !== NivoraRobotController.STATES.HIDDEN && this.state !== NivoraRobotController.STATES.HIDING) {
                    this.scheduleNextIdleAction();
                }
            }, nextDelay);
        }

        performRandomIdleAction() {
            if (this.state !== NivoraRobotController.STATES.IDLE) return;

            const isSecret = Math.random() < 0.12;

            if (isSecret) {
                const secretPick = Math.floor(Math.random() * 8);
                switch (secretPick) {
                    case 0:
                        this.robot.classList.add("robot-waving");
                        setTimeout(() => this.robot.classList.remove("robot-waving"), 1700);
                        break;
                    case 1:
                        this.robot.classList.add("robot-stretch");
                        setTimeout(() => this.robot.classList.remove("robot-stretch"), 1900);
                        break;
                    case 2:
                        this.robot.classList.add("robot-salute");
                        setTimeout(() => this.robot.classList.remove("robot-salute"), 1600);
                        break;
                    case 3:
                        this.robot.classList.add("robot-peekaboo");
                        setTimeout(() => this.robot.classList.remove("robot-peekaboo"), 1700);
                        break;
                    case 4:
                        this.setEmotion("sleepy", null, 2500);
                        break;
                    case 5:
                        this.robot.classList.add("robot-dance");
                        setTimeout(() => this.robot.classList.remove("robot-dance"), 1800);
                        break;
                    case 6:
                        this.robot.classList.add("robot-salute");
                        setTimeout(() => this.robot.classList.remove("robot-salute"), 1500);
                        break;
                    case 7:
                        if (this.headGroup) {
                            this.headGroup.style.transform = "rotate(-18deg) scale(0.96)";
                            setTimeout(() => {
                                if (this.headGroup) this.headGroup.style.transform = "";
                            }, 1400);
                        }
                        break;
                }
            } else {
                const actionPick = Math.floor(Math.random() * 9);
                switch (actionPick) {
                    case 0:
                    case 1:
                        this.triggerDoubleBlink();
                        break;
                    case 2:
                        if (this.leftPupil) this.leftPupil.style.transform = "translate(-3.2px, 0)";
                        if (this.rightPupil) this.rightPupil.style.transform = "translate(-3.2px, 0)";
                        setTimeout(() => {
                            if (this.leftPupil) this.leftPupil.style.transform = "translate(0, 0)";
                            if (this.rightPupil) this.rightPupil.style.transform = "translate(0, 0)";
                        }, 1200);
                        break;
                    case 3:
                        if (this.leftPupil) this.leftPupil.style.transform = "translate(3.2px, 0)";
                        if (this.rightPupil) this.rightPupil.style.transform = "translate(3.2px, 0)";
                        setTimeout(() => {
                            if (this.leftPupil) this.leftPupil.style.transform = "translate(0, 0)";
                            if (this.rightPupil) this.rightPupil.style.transform = "translate(0, 0)";
                        }, 1200);
                        break;
                    case 4:
                        if (this.leftPupil) this.leftPupil.style.transform = "translate(0, -3.2px)";
                        if (this.rightPupil) this.rightPupil.style.transform = "translate(0, -3.2px)";
                        setTimeout(() => {
                            if (this.leftPupil) this.leftPupil.style.transform = "translate(0, 0)";
                            if (this.rightPupil) this.rightPupil.style.transform = "translate(0, 0)";
                        }, 1400);
                        break;
                    case 5:
                        if (this.leftPupil) this.leftPupil.style.transform = "translate(0, 2.5px)";
                        if (this.rightPupil) this.rightPupil.style.transform = "translate(0, 2.5px)";
                        setTimeout(() => {
                            if (this.leftPupil) this.leftPupil.style.transform = "translate(0, 0)";
                            if (this.rightPupil) this.rightPupil.style.transform = "translate(0, 0)";
                        }, 1200);
                        break;
                    case 6:
                        this.setEmotion("curious", null, 1800);
                        break;
                    case 7:
                        this.setEmotion("happy", null, 1500);
                        break;
                    case 8:
                        this.robot.classList.add("robot-active");
                        setTimeout(() => this.robot.classList.remove("robot-active"), 700);
                        break;
                }
            }
        }

        // ------------------------------------------------
        // 11. CINEMATIC PAGE ENTRY & WALKING INTRO
        // ------------------------------------------------
        runCinematicIntro() {
            try {
                if (sessionStorage.getItem("nivora_robot_intro_played")) {
                    this.state = NivoraRobotController.STATES.IDLE;
                    this.setEmotion("idle");
                    this.scheduleNextIdleAction();
                    return;
                }
            } catch (_) {}

            this.isIntroRunning = true;
            this.robot.style.transition = "none";
            this.robot.style.opacity = "0";
            this.robot.style.transform = "translateX(110px)";

            setTimeout(() => {
                this.robot.style.transition = "transform 0.6s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease";
                this.robot.style.opacity = "1";
                this.robot.style.transform = "translateX(75px)";

                setTimeout(() => {
                    if (this.leftPupil) this.leftPupil.style.transform = "translate(-3.2px, 0)";
                    if (this.rightPupil) this.rightPupil.style.transform = "translate(-3.2px, 0)";

                    setTimeout(() => {
                        if (this.leftPupil) this.leftPupil.style.transform = "translate(3.2px, 0)";
                        if (this.rightPupil) this.rightPupil.style.transform = "translate(3.2px, 0)";

                        setTimeout(() => {
                            if (this.leftPupil) this.leftPupil.style.transform = "translate(0, 0)";
                            if (this.rightPupil) this.rightPupil.style.transform = "translate(0, 0)";

                            this.setEmotion("happy");

                            setTimeout(() => {
                                this.transitionTo(NivoraRobotController.STATES.WALKING);
                                this.robot.style.transition = "transform 2.2s cubic-bezier(0.25, 1, 0.5, 1)";
                                this.robot.style.transform = "translateX(0)";

                                setTimeout(() => {
                                    this.robot.classList.remove("robot-walking");

                                    const legL = $("robotLegLeft");
                                    if (legL) {
                                        legL.style.transform = "translateY(-2px)";
                                        setTimeout(() => { legL.style.transform = ""; }, 180);
                                    }

                                    this.triggerDoubleBlink(() => {
                                        this.robot.classList.add("robot-waving");
                                        this.showSpeech("Hi 👋", 1200);

                                        setTimeout(() => {
                                            this.showSpeech("I'm NIVORA 🤖", 1800);
                                            setTimeout(() => {
                                                this.robot.classList.remove("robot-waving");
                                                this.state = NivoraRobotController.STATES.IDLE;
                                                this.setEmotion("idle");
                                                this.isIntroRunning = false;
                                                try {
                                                    sessionStorage.setItem("nivora_robot_intro_played", "1");
                                                } catch (_) {}
                                                this.scheduleNextIdleAction();
                                            }, 2000);
                                        }, 1300);
                                    });
                                }, 2250);
                            }, 500);
                        }, 500);
                    }, 500);
                }, 500);
            }, 650);
        }

        // ------------------------------------------------
        // 12. CURSOR TRACKING
        // ------------------------------------------------
        handleMouseMove(e) {
            const { STATES } = NivoraRobotController;
            if (this.isInteracting ||
                this.isIntroRunning ||
                this.isTypingWatching ||
                this.state === STATES.HIDDEN ||
                this.state === STATES.HIDING ||
                this.state === STATES.DANCING ||
                this.state === STATES.GOODBYE ||
                this.state === STATES.REAPPEARING) return;

            if (["thinking", "waving"].includes(this.currentEmotion)) return;

            const rect = this.robot.getBoundingClientRect();
            if (!rect || rect.width === 0) return;

            const robotCenterX = rect.left + rect.width / 2;
            const robotCenterY = rect.top + rect.height / 2;

            const deltaX = e.clientX - robotCenterX;
            const deltaY = e.clientY - robotCenterY;

            const maxShiftX = 3.2;
            const maxShiftY = 2.2;
            const shiftX = Math.max(-maxShiftX, Math.min(maxShiftX, deltaX / 55));
            const shiftY = Math.max(-maxShiftY, Math.min(maxShiftY, deltaY / 50));

            if (this.leftPupil) this.leftPupil.style.transform = `translate(${shiftX}px, ${shiftY}px)`;
            if (this.rightPupil) this.rightPupil.style.transform = `translate(${shiftX}px, ${shiftY}px)`;

            if (this.headGroup && this.currentEmotion === "idle") {
                const headTilt = Math.max(-2.5, Math.min(2.5, deltaX / 120));
                this.headGroup.style.transform = `rotate(${headTilt}deg)`;
            }
        }

        // ------------------------------------------------
        // 13. EVENT LISTENERS INITIALIZATION
        // ------------------------------------------------
        init() {
            const { STATES } = NivoraRobotController;

            // Click, touch, and keyboard interactions
            this.robot.addEventListener("click", (e) => this.handleUserClick(e));
            this.robot.addEventListener("touchend", (e) => this.handleUserClick(e), { passive: false });
            this.robot.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
                    e.preventDefault();
                    this.handleUserClick(e);
                }
            });

            // Hover interactions: trigger EXCITED state on mouseenter, return to IDLE on mouseleave
            this.robot.addEventListener("mouseenter", () => {
                if (this.isIntroRunning ||
                    this.isInteracting ||
                    this.state === STATES.HIDDEN ||
                    this.state === STATES.HIDING ||
                    this.state === STATES.DANCING ||
                    this.state === STATES.GOODBYE ||
                    this.state === STATES.REAPPEARING ||
                    this.state === STATES.THINKING) return;

                this.transitionTo(STATES.EXCITED);
            });

            this.robot.addEventListener("mouseleave", () => {
                if (this.isIntroRunning ||
                    this.isInteracting ||
                    this.state === STATES.HIDDEN ||
                    this.state === STATES.HIDING ||
                    this.state === STATES.DANCING ||
                    this.state === STATES.GOODBYE ||
                    this.state === STATES.REAPPEARING ||
                    this.state === STATES.THINKING) return;

                if (this.state === STATES.EXCITED) {
                    this.transitionTo(STATES.IDLE);
                }
            });

            // Pointer move cursor following
            let ticking = false;
            document.addEventListener("mousemove", (e) => {
                if (!ticking) {
                    requestAnimationFrame(() => {
                        this.handleMouseMove(e);
                        ticking = false;
                    });
                    ticking = true;
                }
            }, { passive: true });

            // UI Typing Detection
            if (this.messageInput) {
                this.messageInput.addEventListener("input", () => {
                    if (this.isIntroRunning || this.state === NivoraRobotController.STATES.HIDDEN_BELOW_INPUT) return;
                    this.hideSpeech();

                    if (!this.isTypingWatching) {
                        this.isTypingWatching = true;
                        this.setEmotion("curious");
                        if (this.leftPupil) this.leftPupil.style.transform = "translate(0, 2.5px)";
                        if (this.rightPupil) this.rightPupil.style.transform = "translate(0, 2.5px)";
                    }

                    if (this.timers.typing) clearTimeout(this.timers.typing);
                    this.timers.typing = setTimeout(() => {
                        this.isTypingWatching = false;
                        if (this.currentEmotion === "curious") {
                            this.setEmotion("idle");
                        }
                    }, 1800);
                });
            }

            // UI Message Send Reaction
            const sendBtn = $("sendButton");
            const onMessageSent = () => {
                if (this.isIntroRunning || this.state === NivoraRobotController.STATES.HIDDEN_BELOW_INPUT) return;
                this.isTypingWatching = false;
                this.setEmotion("excited", "On it! ⚡", 1800);
            };

            if (sendBtn) sendBtn.addEventListener("click", onMessageSent);
            if (this.messageInput) {
                this.messageInput.addEventListener("keydown", (e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                        onMessageSent();
                    }
                });
            }

            // Messages Container Observer (Thinking and Response Arrival)
            if (this.messagesContainer && window.MutationObserver) {
                let wasThinking = false;
                const messagesObserver = new MutationObserver(() => {
                    if (this.isIntroRunning ||
                        this.state === NivoraRobotController.STATES.HIDDEN ||
                        this.state === NivoraRobotController.STATES.HIDING ||
                        this.state === NivoraRobotController.STATES.DANCING ||
                        this.state === NivoraRobotController.STATES.GOODBYE ||
                        this.state === NivoraRobotController.STATES.REAPPEARING) return;

                    const thinkingEl = this.messagesContainer.querySelector(".typing-bubble, .thinking-pill, .ai-message.streaming, .streaming-cursor");
                    const isCurrentlyThinking = !!thinkingEl;

                    if (isCurrentlyThinking && !wasThinking) {
                        wasThinking = true;
                        this.transitionTo(NivoraRobotController.STATES.THINKING, { message: "Thinking… 🤔", duration: 0 });
                    } else if (!isCurrentlyThinking && wasThinking) {
                        wasThinking = false;
                        this.transitionTo(NivoraRobotController.STATES.SUCCESS, { message: "Done! ✨", duration: 2200 });
                    }
                });
                messagesObserver.observe(this.messagesContainer, { childList: true, subtree: true });
            }

            // Voice Assistant Observer
            if (this.voiceBtn) {
                const voiceObserver = new MutationObserver(() => {
                    if (this.voiceBtn.classList.contains("listening")) {
                        this.transitionTo(NivoraRobotController.STATES.LISTENING, { message: "I'm listening 🎙️", duration: 0 });
                    } else if (this.currentEmotion === "listening") {
                        this.transitionTo(NivoraRobotController.STATES.IDLE);
                        this.hideSpeech();
                    }
                });
                voiceObserver.observe(this.voiceBtn, { attributes: true, attributeFilter: ["class"] });
            }

            // Attachment Tray Observer
            if (this.attachmentTray && window.MutationObserver) {
                const trayObserver = new MutationObserver(() => {
                    if (this.state === NivoraRobotController.STATES.HIDDEN ||
                        this.state === NivoraRobotController.STATES.HIDING ||
                        this.state === NivoraRobotController.STATES.DANCING ||
                        this.state === NivoraRobotController.STATES.GOODBYE ||
                        this.state === NivoraRobotController.STATES.REAPPEARING) return;
                    const chips = this.attachmentTray.querySelectorAll(".tray-chip, .tray-item, img");
                    if (chips.length > 0 && this.currentEmotion !== "analyzing") {
                        this.setEmotion("curious", "Interesting! 👀", 2200);
                    }
                });
                trayObserver.observe(this.attachmentTray, { childList: true, subtree: true });
            }

            // Start Intro or Idle
            this.runCinematicIntro();
        }
    }

    function setupNivoraRobot() {
        const robot = $("nivoraRobot");
        if (!robot) return null;
        if (window.nivoraRobotController) {
            return window.nivoraRobotController;
        }
        const CompanionClass = window.NivoraRobotCompanion || window.NivoraRobotController || NivoraRobotController;
        const controller = new CompanionClass(robot);
        window.nivoraRobotController = controller;
        window.NivoraRobotController = CompanionClass;
        return controller;
    }

    // ====================================================
    // NIVORA AI CREATION & GENERATION SYSTEM
    // ====================================================

    const CREATION_GALLERY_KEY = "nivora_creation_gallery";

    function getCreationGallery() {
        try {
            const raw = localStorage.getItem(CREATION_GALLERY_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    }

    function saveToCreationGallery(item) {
        if (!item || !item.url && !item.downloadUrl && !item.data) return;
        try {
            const gallery = getCreationGallery();
            const newItem = {
                id: "cr-" + Date.now() + "-" + Math.random().toString(36).substr(2, 5),
                type: item.type || "image",
                title: item.title || item.prompt || "AI Creation",
                url: item.url || item.downloadUrl || item.data || "",
                thumbnail: item.thumbnail || item.url || "",
                prompt: item.prompt || item.title || "",
                style: item.style || "",
                timestamp: item.timestamp || Date.now()
            };
            // Limit to most recent 40 creations
            const updated = [newItem, ...gallery.filter(g => g.url !== newItem.url)].slice(0, 40);
            localStorage.setItem(CREATION_GALLERY_KEY, JSON.stringify(updated));
            renderCreationStudioGallery();
        } catch (e) {
            console.warn("Could not save to creation gallery:", e);
        }
    }

    function parseGenerationIntent(text, attachments = []) {
        if (!text && attachments.length === 0) return null;
        const raw = (text || "").trim();
        const lower = raw.toLowerCase();

        // 1. Image Editing Intent (Upload present OR edit instructions)
        const imageAttachments = attachments.filter(a => a.isImage);
        const hasAttachedImage = imageAttachments.length > 0;
        const isEditInstruction = /^(remove\s+(the\s+)?background|change\s+(the\s+)?(clothes|clothing|outfit|background)|make\s+it\s+(cinematic|anime|3d|photorealistic|cyberpunk)|improve\s+quality|upscale|add\s+a\s+robot|remove\s+this|turn\s+this\s+into|restore\s+this|change\s+(the\s+)?lighting|edit\s+this|transform\s+this|modify\s+this)/i.test(lower);

        if (hasAttachedImage && (isEditInstruction || lower.includes("edit") || lower.includes("remove") || lower.includes("change") || lower.includes("turn") || lower.includes("make it"))) {
            return {
                type: "image_edit",
                editPrompt: raw,
                originalImage: imageAttachments[0].data
            };
        }

        // 2. Variations Intent
        if (/^(generate|create|make|show(\s+me)?)\s+(variations|different\s+versions|alternatives)\b/i.test(lower) || /variations\s+of\b/i.test(lower)) {
            const cleanPrompt = raw.replace(/^(generate|create|make|show(\s+me)?)\s+(variations\s+(of)?|different\s+versions\s+(of)?)/i, "").trim() || "modern concept";
            return {
                type: "image",
                variations: 4,
                prompt: cleanPrompt,
                style: "cinematic",
                aspectRatio: "1:1"
            };
        }

        // 3. Presentation / Slide Deck Intent
        const presMatch = lower.match(/^(create|generate|make|build|design)\s+(a\s+)?(presentation|slide\s*deck|slides|pitch\s*deck|powerpoint|pptx)\s+(on|about|for)\s+(.+)/i);
        if (presMatch) {
            return {
                type: "presentation",
                topic: presMatch[5].trim(),
                slideCount: 6
            };
        }

        // 4. QR Code Intent
        const qrMatch = lower.match(/^(create|generate|make)\s+(a\s+)?qr\s*code\s+(for|to|with)\s+(.+)/i);
        if (qrMatch) {
            return {
                type: "qr",
                payload: qrMatch[4].trim()
            };
        }

        // 5. Logo Intent
        const logoMatch = lower.match(/^(create|generate|design|make)\s+(a\s+)?(modern\s+|minimal\s+|3d\s+|futuristic\s+|tech\s+|gaming\s+|luxury\s+|mascot\s+)?logo\s+(for|of)\s+(.+)/i);
        if (logoMatch) {
            const styleModifier = (logoMatch[3] || "").trim() || "minimal";
            const brand = logoMatch[5].trim();
            return {
                type: "logo",
                prompt: `modern ${styleModifier} logo for ${brand}, vector, iconic, sleek, premium brand mark`,
                style: "logo",
                aspectRatio: "1:1"
            };
        }

        // 6. Poster Intent
        const posterMatch = lower.match(/^(create|generate|design|make)\s+(a\s+)?(event\s+|college\s+|hackathon\s+|movie\s+|gaming\s+|social\s+|ad\s+)?poster\s+(for|of|about)\s+(.+)/i);
        if (posterMatch) {
            const pType = (posterMatch[3] || "").trim() || "event";
            const subject = posterMatch[5].trim();
            return {
                type: "poster",
                prompt: `High-impact ${pType} poster for ${subject}, typography, bold composition, dynamic lighting`,
                style: "poster",
                aspectRatio: "3:4"
            };
        }

        // 7. Social Media Asset Intent
        const socialMatch = lower.match(/^(create|generate|make|design)\s+(an?\s+)?(instagram\s+post|instagram\s+story|reels?\s+cover|youtube\s+thumbnail|youtube\s+banner|linkedin\s+banner|twitter\s+header)\s+(for|of|about)\s+(.+)/i);
        if (socialMatch) {
            const format = socialMatch[3].toLowerCase();
            const desc = socialMatch[5].trim();
            let ar = "1:1";
            if (format.includes("story") || format.includes("reel")) ar = "9:16";
            else if (format.includes("youtube") || format.includes("banner") || format.includes("header")) ar = "16:9";

            return {
                type: "image",
                prompt: `Eye-catching ${format} graphic: ${desc}, vibrant, ultra-high resolution`,
                style: "cinematic",
                aspectRatio: ar
            };
        }

        // 8. General AI Image Generation Intent
        const subjectBeforeMatch = lower.match(/^(?:can\s+you\s+)?(?:please\s+)?(?:generate|create|make|draw|paint|render)\s+(?:an?\s+)?(.+?)\s+(?:image|picture|photo|wallpaper|portrait|illustration|artwork|graphic|visual)s?$/i);
        const subjectAfterMatch = lower.match(/^(?:can\s+you\s+)?(?:please\s+)?(?:generate|create|make|draw|paint|render)\s+(?:an?\s+)?(?:image|picture|photo|wallpaper|portrait|illustration|artwork|graphic|visual)s?\s+(?:of|about|with|showing|for)\s+(.+)$/i);
        const drawVerbMatch = lower.match(/^(?:can\s+you\s+)?(?:please\s+)?(?:draw|paint)\s+(?:an?\s+)?(.+)$/i);
        const showMeMatch = lower.match(/^(?:can\s+you\s+)?(?:please\s+)?(?:show\s+me|give\s+me)\s+(?:an?\s+)?(?:image|picture|photo|wallpaper)\s+(?:of|about|for)\s+(.+)$/i);
        const isImageVerb = /^(create|generate|paint|draw|render|make)\s+(an?\s+)?(image|picture|photo|wallpaper|portrait|illustration|artwork|visual|graphic|scene)\s+(of|about|with)?/i.test(lower);
        const hasArtKeyword = /^(create|generate)\s+(a\s+)?(futuristic\s+city|realistic\s+portrait|gaming\s+wallpaper|cinematic|cyberpunk\s+scene|nivora\s+ai\s+robot)/i.test(lower);

        if (subjectBeforeMatch || subjectAfterMatch || drawVerbMatch || showMeMatch || isImageVerb || hasArtKeyword) {
            // Determine Aspect Ratio
            let ar = "1:1";
            if (lower.includes("16:9") || lower.includes("landscape") || lower.includes("wallpaper") || lower.includes("banner") || lower.includes("wide")) {
                ar = "16:9";
            } else if (lower.includes("9:16") || lower.includes("portrait") || lower.includes("story") || lower.includes("vertical") || lower.includes("mobile")) {
                ar = "9:16";
            } else if (lower.includes("4:3")) {
                ar = "4:3";
            } else if (lower.includes("3:4")) {
                ar = "3:4";
            }

            // Determine Style
            let style = "photorealistic";
            if (lower.includes("cinematic")) style = "cinematic";
            else if (lower.includes("anime")) style = "anime";
            else if (lower.includes("3d") || lower.includes("render")) style = "3d";
            else if (lower.includes("cartoon")) style = "cartoon";
            else if (lower.includes("illustration")) style = "illustration";
            else if (lower.includes("digital art")) style = "digital art";
            else if (lower.includes("watercolor")) style = "watercolor";
            else if (lower.includes("oil painting")) style = "oil painting";
            else if (lower.includes("cyberpunk")) style = "cyberpunk";
            else if (lower.includes("minimalist")) style = "minimalist";
            else if (lower.includes("product") || lower.includes("photography")) style = "product photography";
            else if (lower.includes("wallpaper")) style = "wallpaper";

            let cleanedPrompt = "";
            if (subjectBeforeMatch && subjectBeforeMatch[1] && subjectBeforeMatch[1] !== "this" && subjectBeforeMatch[1] !== "new") {
                cleanedPrompt = subjectBeforeMatch[1].trim().replace(/^(an?|the)\s+/i, "");
            } else if (subjectAfterMatch && subjectAfterMatch[1]) {
                cleanedPrompt = subjectAfterMatch[1].trim().replace(/^(an?|the)\s+/i, "");
            } else if (drawVerbMatch && drawVerbMatch[1] && !drawVerbMatch[1].startsWith("diagram") && !drawVerbMatch[1].startsWith("chart")) {
                cleanedPrompt = drawVerbMatch[1].trim().replace(/^(an?|the)\s+/i, "");
                if (style === "photorealistic") style = "illustration";
            } else if (showMeMatch && showMeMatch[1]) {
                cleanedPrompt = showMeMatch[1].trim().replace(/^(an?|the)\s+/i, "");
            } else {
                cleanedPrompt = raw
                    .replace(/^(create|generate|paint|draw|render|make)\s+(an?\s+)?(image|picture|photo|wallpaper|portrait|illustration|artwork|visual|graphic|scene)\s+(of|about|with)?\s*/i, "")
                    .trim() || raw;
            }

            return {
                type: "image",
                prompt: cleanedPrompt,
                style: style,
                aspectRatio: ar,
                variations: 1
            };
        }

        return null;
    }

    function renderCreationCard(container, creation) {
        if (!container || !creation) return;

        const card = document.createElement("div");
        card.className = "nivora-creation-card";

        if (creation.type === "image_edit") {
            card.innerHTML = `
                <div class="creation-card-header">
                    <span class="creation-type-badge">🪄 AI Image Transformation</span>
                    <span class="creation-instruction">${escapeHTML(creation.prompt || "Edited Image")}</span>
                </div>
                <div class="creation-comparison-grid">
                    <div class="comparison-column">
                        <span class="comparison-tag">Original</span>
                        <div class="comparison-thumb">
                            <img src="${creation.original}" alt="Original" class="comparison-img" loading="lazy">
                        </div>
                    </div>
                    <div class="comparison-arrow">➜</div>
                    <div class="comparison-column">
                        <span class="comparison-tag edited">Edited with AI</span>
                        <div class="comparison-thumb">
                            <img src="${creation.edited}" alt="Edited" class="comparison-img" loading="lazy">
                        </div>
                    </div>
                </div>
                <div class="creation-card-actions">
                    <a href="${creation.edited}" download="nivora-edited.png" class="creation-action-pill primary">⬇ Download Edited</a>
                    <button type="button" class="creation-action-pill view-edited-btn">🔍 Full View</button>
                    <button type="button" class="creation-action-pill open-editor-btn">🪄 Edit Again</button>
                </div>
            `;
            card.querySelector(".view-edited-btn")?.addEventListener("click", () => {
                openImagePreview({ src: creation.edited, title: creation.prompt || "Edited Image", domain: "NIVORA AI" });
            });
            card.querySelector(".open-editor-btn")?.addEventListener("click", () => {
                openCreationStudio("editor", { image: creation.edited });
            });
        } else if (creation.type === "image_variations" && Array.isArray(creation.variations)) {
            const tiles = creation.variations.map((v, i) => `
                <div class="variation-item" data-idx="${i}">
                    <img src="${v.url}" alt="Variation ${i + 1}" class="variation-img" loading="lazy">
                    <div class="variation-label">Variation ${i + 1}</div>
                </div>
            `).join("");

            card.innerHTML = `
                <div class="creation-card-header">
                    <span class="creation-type-badge">✨ Generated Variations (${creation.variations.length})</span>
                    <span class="creation-style-pill">${escapeHTML(creation.style || "Photorealistic")}</span>
                </div>
                <div class="creation-variations-chat-grid">
                    ${tiles}
                </div>
                <div class="creation-card-actions">
                    <span style="font-size:12px;color:#94a3b8;">Click any variation to inspect or download</span>
                </div>
            `;

            card.querySelectorAll(".variation-item").forEach((item) => {
                item.addEventListener("click", () => {
                    const idx = parseInt(item.getAttribute("data-idx") || "0", 10);
                    const sel = creation.variations[idx];
                    if (sel) {
                        openImagePreview({ src: sel.url, title: `${creation.prompt} (Variation ${idx + 1})`, domain: "NIVORA AI" });
                    }
                });
            });
        } else if (creation.type === "presentation") {
            const slideBullets = (creation.slides || []).map((s, idx) => `
                <div class="deck-preview-slide-chip">
                    <strong>Slide ${idx + 1}: ${escapeHTML(s.title || "Slide")}</strong>
                    <span>${(s.bullets || []).length} topics</span>
                </div>
            `).join("");

            card.innerHTML = `
                <div class="creation-card-header">
                    <span class="creation-type-badge">📽️ AI Presentation Deck</span>
                    <span class="creation-style-pill">${(creation.slides || []).length || 6} Slides</span>
                </div>
                <h4 style="margin:4px 0 10px;color:#fff;font-size:15px;">${escapeHTML(creation.topic || "Presentation Deck")}</h4>
                <div class="deck-preview-carousel-mini">
                    ${slideBullets}
                </div>
                <div class="creation-card-actions" style="margin-top:12px;">
                    <a href="${creation.downloadUrl}" download class="creation-action-pill primary">⬇ Download Complete PPTX (.pptx)</a>
                </div>
            `;
        } else if (creation.type === "qr") {
            card.innerHTML = `
                <div class="creation-card-header">
                    <span class="creation-type-badge">📱 High-Resolution QR Code</span>
                </div>
                <div class="qr-chat-frame">
                    <img src="${creation.qrDataUrl}" alt="QR Code" style="width:200px;height:200px;background:#fff;padding:8px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.4);">
                </div>
                <div class="creation-card-actions" style="margin-top:12px;">
                    <a href="${creation.qrDataUrl}" download="nivora-qr.png" class="creation-action-pill primary">⬇ Download PNG</a>
                    <button type="button" class="creation-action-pill copy-qr-svg-btn">📋 Copy SVG</button>
                </div>
            `;
            card.querySelector(".copy-qr-svg-btn")?.addEventListener("click", () => {
                if (creation.svgString) {
                    navigator.clipboard.writeText(creation.svgString);
                    showToast("QR code SVG copied to clipboard! 📋", "success");
                }
            });
        } else {
            // Standard Image, Logo, Poster
            renderNivoraImageCard(container, creation);
            return;
        }

        container.appendChild(card);
    }

    // Modal Controller
    function openCreationStudio(initialTab = "images", prefillData = null) {
        const modal = $("creationStudioModal");
        if (!modal) return;
        modal.style.display = "flex";

        setCreationStudioTab(initialTab);

        if (prefillData) {
            if (prefillData.prompt && $("studioImagePrompt")) {
                $("studioImagePrompt").value = prefillData.prompt;
            }
            if (prefillData.style && $("studioImageStylesGrid")) {
                $("studioImageStylesGrid").querySelectorAll(".studio-style-chip").forEach(c => {
                    if (c.getAttribute("data-style") === prefillData.style) c.click();
                });
            }
            if (prefillData.image && $("studioEditorSourceImg") && $("studioEditorSourcePreview")) {
                $("studioEditorSourceImg").src = prefillData.image;
                $("studioEditorSourcePreview").style.display = "block";
                const uploadPrompt = $("studioEditorUploadPrompt");
                if (uploadPrompt) uploadPrompt.style.display = "none";
                window._studioCurrentOriginalImage = prefillData.image;
            }
        }
    }

    function closeCreationStudio() {
        const modal = $("creationStudioModal");
        if (modal) modal.style.display = "none";
    }

    function setCreationStudioTab(tabName) {
        const navBar = $("studioNavBar");
        if (!navBar) return;

        navBar.querySelectorAll(".studio-nav-item").forEach(item => {
            if (item.getAttribute("data-tab") === tabName) {
                item.classList.add("active");
            } else {
                item.classList.remove("active");
            }
        });

        const panelMap = {
            "images": "studioPanelImages",
            "logos": "studioPanelLogos",
            "editor": "studioPanelEditor",
            "social": "studioPanelSocial",
            "presentations": "studioPanelPresentations",
            "sheets": "studioPanelSheets",
            "diagrams": "studioPanelDiagrams",
            "3d-audio": "studioPanel3dAudio",
            "qr": "studioPanelQr",
            "gallery": "studioPanelGallery"
        };

        Object.values(panelMap).forEach(id => {
            const p = $(id);
            if (p) p.style.display = "none";
        });

        const activeId = panelMap[tabName] || "studioPanelImages";
        const activePanel = $(activeId);
        if (activePanel) activePanel.style.display = "block";

        if (tabName === "gallery") {
            renderCreationStudioGallery();
        } else if (tabName === "3d-audio") {
            initThreeJsScene();
        }
    }

    function renderCreationStudioGallery(filter = "all") {
        const grid = $("studioGalleryGrid");
        if (!grid) return;

        const gallery = getCreationGallery();
        let filtered = gallery;
        if (filter === "images") filtered = gallery.filter(g => g.type === "image" || g.type === "logo" || g.type === "poster");
        else if (filter === "docs") filtered = gallery.filter(g => g.type === "presentation" || g.type === "sheet");
        else if (filter === "diagrams") filtered = gallery.filter(g => g.type === "diagram" || g.type === "qr" || g.type === "3d");

        if (filtered.length === 0) {
            grid.innerHTML = `
                <div class="studio-empty-state" style="grid-column:1/-1;">
                    <span class="studio-empty-icon">📁</span>
                    <h4>No creations found</h4>
                    <p>Generated items from your prompts and studio tools will appear here.</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = filtered.map(item => `
            <div class="studio-gallery-card" data-url="${escapeHTML(item.url)}">
                <div class="gallery-thumb-wrap">
                    ${item.type === "image" || item.type === "qr" || item.url.startsWith("data:image")
                        ? `<img src="${item.url}" alt="${escapeHTML(item.title)}" loading="lazy">`
                        : `<div class="gallery-doc-placeholder">📄 ${escapeHTML(item.type.toUpperCase())}</div>`
                    }
                </div>
                <div class="gallery-card-info">
                    <span class="gallery-card-title">${escapeHTML(item.title || "Untitled Creation")}</span>
                    <span class="gallery-card-meta">${new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
            </div>
        `).join("");

        grid.querySelectorAll(".studio-gallery-card").forEach(c => {
            c.addEventListener("click", () => {
                const u = c.getAttribute("data-url");
                if (u && (u.startsWith("http") || u.startsWith("data:image"))) {
                    openImagePreview({ src: u, title: "Gallery Creation", domain: "NIVORA Creation Studio" });
                }
            });
        });
    }

    // Three.js Procedural 3D Scene Controller
    let threeSceneInstance = null;
    function initThreeJsScene() {
        const canvas = $("studioThreeCanvas");
        const container = $("studio3DCanvasWrap");
        if (!canvas || !container || !window.THREE) return;

        if (threeSceneInstance) {
            threeSceneInstance.resize();
            return;
        }

        const width = container.clientWidth || 450;
        const height = container.clientHeight || 340;

        const scene = new window.THREE.Scene();
        scene.background = new window.THREE.Color(0x0c0e14);

        const camera = new window.THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        camera.position.set(0, 3, 7);

        const renderer = new window.THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // Ambient & Directional Lights
        const ambLight = new window.THREE.AmbientLight(0xffffff, 0.7);
        scene.add(ambLight);

        const dirLight1 = new window.THREE.DirectionalLight(0x6c63ff, 2.5);
        dirLight1.position.set(5, 10, 7);
        scene.add(dirLight1);

        const dirLight2 = new window.THREE.DirectionalLight(0x00f5ff, 2);
        dirLight2.position.set(-5, -5, -5);
        scene.add(dirLight2);

        // Grid helper
        const gridHelper = new window.THREE.GridHelper(10, 20, 0x6c63ff, 0x242838);
        gridHelper.position.y = -1.5;
        scene.add(gridHelper);

        // Asset Mesh Group
        const meshGroup = new window.THREE.Group();
        scene.add(meshGroup);

        function buildAsset(assetType, wireframe = false) {
            while (meshGroup.children.length > 0) {
                const obj = meshGroup.children[0];
                meshGroup.remove(obj);
            }

            const mat = new window.THREE.MeshStandardMaterial({
                color: 0x6c63ff,
                roughness: 0.2,
                metalness: 0.8,
                wireframe: wireframe
            });

            if (assetType === "crystal") {
                const geom = new window.THREE.OctahedronGeometry(1.8, 1);
                const mesh = new window.THREE.Mesh(geom, mat);
                meshGroup.add(mesh);
            } else if (assetType === "sphere") {
                const geom = new window.THREE.IcosahedronGeometry(1.7, 3);
                const mesh = new window.THREE.Mesh(geom, mat);
                meshGroup.add(mesh);
            } else if (assetType === "city") {
                for (let x = -2; x <= 2; x++) {
                    for (let z = -2; z <= 2; z++) {
                        const h = 0.5 + Math.random() * 2.5;
                        const bGeom = new window.THREE.BoxGeometry(0.6, h, 0.6);
                        const bMat = new window.THREE.MeshStandardMaterial({
                            color: ((x + z) % 2 === 0) ? 0x6c63ff : 0x00f5ff,
                            metalness: 0.9,
                            roughness: 0.2,
                            wireframe: wireframe
                        });
                        const bMesh = new window.THREE.Mesh(bGeom, bMat);
                        bMesh.position.set(x * 0.9, (h / 2) - 1.5, z * 0.9);
                        meshGroup.add(bMesh);
                    }
                }
            } else {
                // Default: NIVORA Robot Model
                // Head
                const headGeom = new window.THREE.BoxGeometry(1.4, 1.2, 1.2);
                const head = new window.THREE.Mesh(headGeom, mat);
                head.position.y = 0.8;
                meshGroup.add(head);

                // Eyes
                const eyeMat = new window.THREE.MeshBasicMaterial({ color: 0x00f5ff });
                const eyeGeom = new window.THREE.SphereGeometry(0.18, 16, 16);
                const leftEye = new window.THREE.Mesh(eyeGeom, eyeMat);
                leftEye.position.set(-0.35, 0.9, 0.62);
                const rightEye = new window.THREE.Mesh(eyeGeom, eyeMat);
                rightEye.position.set(0.35, 0.9, 0.62);
                meshGroup.add(leftEye);
                meshGroup.add(rightEye);

                // Antenna
                const antStem = new window.THREE.CylinderGeometry(0.04, 0.04, 0.5);
                const stemMesh = new window.THREE.Mesh(antStem, mat);
                stemMesh.position.set(0, 1.6, 0);
                meshGroup.add(stemMesh);

                const antOrb = new window.THREE.SphereGeometry(0.15, 16, 16);
                const orbMesh = new window.THREE.Mesh(antOrb, eyeMat);
                orbMesh.position.set(0, 1.85, 0);
                meshGroup.add(orbMesh);

                // Body
                const bodyGeom = new window.THREE.CylinderGeometry(0.8, 0.9, 1.4, 24);
                const body = new window.THREE.Mesh(bodyGeom, mat);
                body.position.y = -0.5;
                meshGroup.add(body);
            }
        }

        buildAsset("robot");

        let autoRotate = true;
        let isWireframe = false;
        let currentAsset = "robot";

        // OrbitControls if available
        let controls = null;
        if (window.THREE.OrbitControls) {
            controls = new window.THREE.OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;
        }

        let animationFrameId;
        function animate() {
            animationFrameId = requestAnimationFrame(animate);
            if (autoRotate && meshGroup) {
                meshGroup.rotation.y += 0.01;
            }
            if (controls) controls.update();
            renderer.render(scene, camera);
        }
        animate();

        threeSceneInstance = {
            resize: () => {
                const w = container.clientWidth || 450;
                const h = container.clientHeight || 340;
                camera.aspect = w / h;
                camera.updateProjectionMatrix();
                renderer.setSize(w, h);
            },
            setAsset: (type) => {
                currentAsset = type;
                buildAsset(type, isWireframe);
            },
            toggleWireframe: () => {
                isWireframe = !isWireframe;
                buildAsset(currentAsset, isWireframe);
                return isWireframe;
            },
            toggleRotate: () => {
                autoRotate = !autoRotate;
                return autoRotate;
            }
        };
    }

    // Web Audio Synthesizer Controller
    function synthesizeSoundEffect(type = "laser") {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) {
                showToast("Web Audio API is not supported in this browser.", "warning");
                return;
            }
            const ctx = new AudioCtx();
            const now = ctx.currentTime;

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const filter = ctx.createBiquadFilter();

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);

            if (type === "laser") {
                osc.type = "sawtooth";
                osc.frequency.setValueAtTime(880, now);
                osc.frequency.exponentialRampToValueAtTime(110, now + 0.35);
                filter.type = "lowpass";
                filter.frequency.setValueAtTime(3000, now);
                gain.gain.setValueAtTime(0.4, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
                osc.start(now);
                osc.stop(now + 0.36);
            } else if (type === "chime") {
                osc.type = "sine";
                osc.frequency.setValueAtTime(523.25, now);
                osc.frequency.setValueAtTime(659.25, now + 0.12);
                osc.frequency.setValueAtTime(783.99, now + 0.24);
                osc.frequency.setValueAtTime(1046.50, now + 0.36);
                gain.gain.setValueAtTime(0.3, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
                osc.start(now);
                osc.stop(now + 1.25);
            } else if (type === "ambient") {
                osc.type = "triangle";
                osc.frequency.setValueAtTime(130.81, now);
                osc.frequency.linearRampToValueAtTime(146.83, now + 1.5);
                osc.frequency.linearRampToValueAtTime(130.81, now + 3.0);
                filter.type = "bandpass";
                filter.frequency.setValueAtTime(400, now);
                gain.gain.setValueAtTime(0.01, now);
                gain.gain.linearRampToValueAtTime(0.35, now + 0.5);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 3.0);
                osc.start(now);
                osc.stop(now + 3.05);
            } else if (type === "warp") {
                osc.type = "sine";
                osc.frequency.setValueAtTime(80, now);
                osc.frequency.exponentialRampToValueAtTime(900, now + 0.6);
                gain.gain.setValueAtTime(0.35, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
                osc.start(now);
                osc.stop(now + 0.72);
            } else {
                // Sonar ping
                osc.type = "sine";
                osc.frequency.setValueAtTime(1200, now);
                gain.gain.setValueAtTime(0.4, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
                osc.start(now);
                osc.stop(now + 1.45);
            }

            // Draw visual waveform simulation on canvas
            const waveCanvas = $("waveformCanvas");
            if (waveCanvas) {
                const wCtx = waveCanvas.getContext("2d");
                wCtx.clearRect(0, 0, waveCanvas.width, waveCanvas.height);
                wCtx.lineWidth = 2;
                wCtx.strokeStyle = "#00f5ff";
                wCtx.beginPath();
                for (let x = 0; x < waveCanvas.width; x++) {
                    const y = (waveCanvas.height / 2) + Math.sin(x * 0.15) * Math.sin(x * 0.05) * 40 * Math.random();
                    if (x === 0) wCtx.moveTo(x, y);
                    else wCtx.lineTo(x, y);
                }
                wCtx.stroke();
            }

            showToast(`Synthesizing ${type.toUpperCase()} audio 🔊`, "info");
        } catch (err) {
            console.warn("Audio synthesis warning:", err);
        }
    }

    // Master Setup for Creation Studio UI
    function setupCreationStudio() {
        const modal = $("creationStudioModal");
        if (!modal) return;

        // Open triggers
        $("topCreationHubBtn")?.addEventListener("click", () => openCreationStudio("images"));
        $("creationHubSidebarBtn")?.addEventListener("click", () => openCreationStudio("images"));
        $("attachOptionCreationHub")?.addEventListener("click", () => openCreationStudio("images"));
        $("studioQuickGalleryBtn")?.addEventListener("click", () => setCreationStudioTab("gallery"));

        // Close triggers
        $("closeCreationStudioBtn")?.addEventListener("click", closeCreationStudio);
        modal.addEventListener("click", (e) => {
            if (e.target === modal) closeCreationStudio();
        });

        // Tab Navigation
        const navBar = $("studioNavBar");
        if (navBar) {
            navBar.querySelectorAll(".studio-nav-item").forEach(item => {
                item.addEventListener("click", () => {
                    const tab = item.getAttribute("data-tab");
                    if (tab) setCreationStudioTab(tab);
                });
            });
        }

        // ==========================================
        // 1. IMAGE GENERATION PANEL
        // ==========================================
        let selectedImageStyle = "photorealistic";
        const stylesGrid = $("studioImageStylesGrid");
        if (stylesGrid) {
            stylesGrid.querySelectorAll(".studio-style-chip").forEach(chip => {
                chip.addEventListener("click", () => {
                    stylesGrid.querySelectorAll(".studio-style-chip").forEach(c => c.classList.remove("active"));
                    chip.classList.add("active");
                    selectedImageStyle = chip.getAttribute("data-style") || "photorealistic";
                });
            });
        }

        // Prompt Enhancer
        $("studioImageEnhanceBtn")?.addEventListener("click", async () => {
            const promptInput = $("studioImagePrompt");
            if (!promptInput) return;
            const originalPrompt = promptInput.value.trim();
            if (!originalPrompt) {
                showToast("Please enter an initial prompt to enhance.", "warning");
                return;
            }

            showToast("Enhancing prompt with AI detail... ✨");
            try {
                const res = await fetch("/api/enhance-prompt", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ prompt: originalPrompt, type: "image", style: selectedImageStyle })
                });
                const data = await res.json().catch(() => null);
                if (res.ok && data && data.enhancedPrompt) {
                    promptInput.value = data.enhancedPrompt;
                    showToast("Prompt enhanced! Ready to generate.", "success");
                } else {
                    promptInput.value = `${originalPrompt}, ultra-detailed, cinematic atmospheric lighting, masterpiece 8k, award winning composition`;
                    showToast("Prompt expanded with visual keywords!", "success");
                }
            } catch (err) {
                promptInput.value = `${originalPrompt}, ultra-detailed, cinematic atmospheric lighting, 8k resolution`;
                showToast("Prompt expanded!", "info");
            }
        });

        // Image Generate Action
        $("studioImageGenerateBtn")?.addEventListener("click", async () => {
            const promptInput = $("studioImagePrompt");
            const prompt = promptInput?.value.trim();
            if (!prompt) {
                showToast("Please describe the image you want to create.", "warning");
                promptInput?.focus();
                return;
            }

            const ar = $("studioImageAspectRatio")?.value || "1:1";
            const variationsCount = parseInt($("studioImageVariations")?.value || "1", 10);

            const emptyState = $("studioImageEmptyState");
            const loadingState = $("studioImageLoadingState");
            const resultStage = $("studioImageResultStage");
            const varGrid = $("studioVariationsGrid");

            if (emptyState) emptyState.style.display = "none";
            if (resultStage) resultStage.style.display = "none";
            if (loadingState) loadingState.style.display = "flex";

            try {
                const res = await fetch("/api/generate-image", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        prompt: prompt,
                        aspectRatio: ar,
                        style: selectedImageStyle,
                        variations: variationsCount
                    })
                });
                const data = await res.json().catch(() => null);

                if (loadingState) loadingState.style.display = "none";

                if (res.ok && data && (data.imageUrl || (data.variations && data.variations.length > 0))) {
                    if (resultStage) resultStage.style.display = "flex";
                    if (varGrid) varGrid.innerHTML = "";

                    const list = (data.variations && data.variations.length > 0) ? data.variations : [{ url: data.imageUrl, prompt: prompt }];

                    list.forEach((item, idx) => {
                        const tile = document.createElement("div");
                        tile.className = "studio-var-tile" + (idx === 0 ? " active" : "");
                        tile.innerHTML = `
                            <img src="${item.url}" alt="Variation ${idx + 1}" class="studio-var-img">
                            <span class="studio-var-num">#${idx + 1}</span>
                        `;
                        tile.onclick = () => {
                            varGrid.querySelectorAll(".studio-var-tile").forEach(t => t.classList.remove("active"));
                            tile.classList.add("active");
                            window._studioSelectedImageUrl = item.url;
                        };
                        varGrid.appendChild(tile);
                    });

                    window._studioSelectedImageUrl = list[0].url;

                    // Wire Actions
                    const dlBtn = $("studioDownloadBtn");
                    if (dlBtn) {
                        dlBtn.onclick = () => {
                            const u = window._studioSelectedImageUrl || list[0].url;
                            const a = document.createElement("a");
                            a.href = u;
                            a.download = `nivora-${selectedImageStyle}.png`;
                            a.click();
                        };
                    }

                    const copyBtn = $("studioCopyImageBtn");
                    if (copyBtn) {
                        copyBtn.onclick = async () => {
                            const u = window._studioSelectedImageUrl || list[0].url;
                            try {
                                const response = await fetch(u);
                                const blob = await response.blob();
                                await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                                showToast("Image copied to clipboard! 📋", "success");
                            } catch {
                                navigator.clipboard.writeText(u);
                                showToast("Image URL copied! 📋", "success");
                            }
                        };
                    }

                    const sendChatBtn = $("studioSendToChatBtn");
                    if (sendChatBtn) {
                        sendChatBtn.onclick = () => {
                            closeCreationStudio();
                            const u = window._studioSelectedImageUrl || list[0].url;
                            const input = $("messageInput");
                            if (input) {
                                input.value = `Here is the generated ${selectedImageStyle} artwork for: "${prompt}"`;
                                sendMessage();
                            }
                        };
                    }

                    const regenBtn = $("studioRegenBtn");
                    if (regenBtn) {
                        regenBtn.onclick = () => {
                            $("studioImageGenerateBtn")?.click();
                        };
                    }

                    saveToCreationGallery({
                        type: "image",
                        title: prompt,
                        url: list[0].url,
                        style: selectedImageStyle
                    });

                    showToast("AI Artwork generated successfully! ✨", "success");
                } else {
                    throw new Error(data?.error || "Generation request failed");
                }
            } catch (err) {
                if (loadingState) loadingState.style.display = "none";
                if (emptyState) emptyState.style.display = "flex";
                console.error("Studio image generation error:", err);
                showToast("Could not generate image. Please try again.", "error");
            }
        });

        // ==========================================
        // 2. LOGOS & POSTERS PANEL
        // ==========================================
        let isPosterMode = false;
        let selectedLogoStyle = "minimal";
        let selectedPosterStyle = "event";

        $("studioToggleLogoMode")?.addEventListener("click", () => {
            isPosterMode = false;
            $("studioToggleLogoMode")?.classList.add("active");
            $("studioTogglePosterMode")?.classList.remove("active");
            const logoWrap = $("studioLogoStylesWrap");
            const posterWrap = $("studioPosterStylesWrap");
            if (logoWrap) logoWrap.style.display = "block";
            if (posterWrap) posterWrap.style.display = "none";
            const label = $("studioBrandPromptLabel");
            if (label) label.textContent = "Brand Name & Logo Concept";
        });

        $("studioTogglePosterMode")?.addEventListener("click", () => {
            isPosterMode = true;
            $("studioTogglePosterMode")?.classList.add("active");
            $("studioToggleLogoMode")?.classList.remove("active");
            const logoWrap = $("studioLogoStylesWrap");
            const posterWrap = $("studioPosterStylesWrap");
            if (logoWrap) logoWrap.style.display = "none";
            if (posterWrap) posterWrap.style.display = "block";
            const label = $("studioBrandPromptLabel");
            if (label) label.textContent = "Poster Event Title & Theme";
        });

        $("studioLogoStylesGrid")?.querySelectorAll(".studio-style-chip").forEach(chip => {
            chip.addEventListener("click", () => {
                $("studioLogoStylesGrid")?.querySelectorAll(".studio-style-chip").forEach(c => c.classList.remove("active"));
                chip.classList.add("active");
                selectedLogoStyle = chip.getAttribute("data-logostyle") || "minimal";
            });
        });

        $("studioPosterStylesGrid")?.querySelectorAll(".studio-style-chip").forEach(chip => {
            chip.addEventListener("click", () => {
                $("studioPosterStylesGrid")?.querySelectorAll(".studio-style-chip").forEach(c => c.classList.remove("active"));
                chip.classList.add("active");
                selectedPosterStyle = chip.getAttribute("data-posterstyle") || "event";
            });
        });

        $("studioLogoGenerateBtn")?.addEventListener("click", async () => {
            const prompt = $("studioLogoPrompt")?.value.trim();
            if (!prompt) {
                showToast(isPosterMode ? "Please enter poster theme." : "Please enter brand name or logo concept.", "warning");
                return;
            }

            const emptyState = $("studioLogoEmptyState");
            const loadingState = $("studioLogoLoadingState");
            const resultStage = $("studioLogoResultStage");
            const varGrid = $("studioLogoVariationsGrid");

            if (emptyState) emptyState.style.display = "none";
            if (resultStage) resultStage.style.display = "none";
            if (loadingState) loadingState.style.display = "flex";

            try {
                const fullPrompt = isPosterMode
                    ? `High-impact ${selectedPosterStyle} poster for: ${prompt}, vector composition, typography, bold art`
                    : `Iconic modern ${selectedLogoStyle} logo for ${prompt}, vector emblem, minimalist, sleek`;

                const ar = isPosterMode ? "3:4" : "1:1";

                const res = await fetch("/api/generate-image", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        prompt: fullPrompt,
                        aspectRatio: ar,
                        style: isPosterMode ? "poster" : "logo",
                        variations: 2
                    })
                });
                const data = await res.json().catch(() => null);

                if (loadingState) loadingState.style.display = "none";

                if (res.ok && data && (data.imageUrl || data.variations)) {
                    if (resultStage) resultStage.style.display = "flex";
                    if (varGrid) varGrid.innerHTML = "";

                    const list = data.variations || [{ url: data.imageUrl }];
                    list.forEach((item, idx) => {
                        const tile = document.createElement("div");
                        tile.className = "studio-var-tile" + (idx === 0 ? " active" : "");
                        tile.innerHTML = `<img src="${item.url}" class="studio-var-img">`;
                        tile.onclick = () => {
                            varGrid.querySelectorAll(".studio-var-tile").forEach(t => t.classList.remove("active"));
                            tile.classList.add("active");
                            window._studioSelectedLogoUrl = item.url;
                        };
                        varGrid.appendChild(tile);
                    });

                    window._studioSelectedLogoUrl = list[0].url;

                    $("studioDownloadLogoBtn")?.addEventListener("click", () => {
                        const a = document.createElement("a");
                        a.href = window._studioSelectedLogoUrl || list[0].url;
                        a.download = `nivora-${isPosterMode ? 'poster' : 'logo'}.png`;
                        a.click();
                    });

                    $("studioSendLogoToChatBtn")?.addEventListener("click", () => {
                        closeCreationStudio();
                        const input = $("messageInput");
                        if (input) {
                            input.value = `Here is the designed ${isPosterMode ? 'poster' : 'logo'} for "${prompt}"`;
                            sendMessage();
                        }
                    });

                    saveToCreationGallery({
                        type: isPosterMode ? "poster" : "logo",
                        title: prompt,
                        url: list[0].url
                    });

                    showToast(`${isPosterMode ? 'Poster' : 'Logo'} design ready! ✨`, "success");
                } else {
                    throw new Error("Design generation failed");
                }
            } catch (err) {
                if (loadingState) loadingState.style.display = "none";
                if (emptyState) emptyState.style.display = "flex";
                showToast("Could not generate design. Please try again.", "error");
            }
        });

        // ==========================================
        // 3. IMAGE EDITOR PANEL (Original -> Edited)
        // ==========================================
        const editorDropZone = $("studioEditorDropZone");
        const editorFileInput = $("studioEditorFileInput");

        editorDropZone?.addEventListener("click", () => editorFileInput?.click());
        editorFileInput?.addEventListener("change", (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const base64 = ev.target.result;
                window._studioCurrentOriginalImage = base64;
                const previewWrap = $("studioEditorSourcePreview");
                const previewImg = $("studioEditorSourceImg");
                const uploadPrompt = $("studioEditorUploadPrompt");
                if (previewImg) previewImg.src = base64;
                if (previewWrap) previewWrap.style.display = "block";
                if (uploadPrompt) uploadPrompt.style.display = "none";
            };
            reader.readAsDataURL(file);
        });

        $("studioEditorClearSourceBtn")?.addEventListener("click", (e) => {
            e.stopPropagation();
            window._studioCurrentOriginalImage = null;
            const previewWrap = $("studioEditorSourcePreview");
            const uploadPrompt = $("studioEditorUploadPrompt");
            if (previewWrap) previewWrap.style.display = "none";
            if (uploadPrompt) uploadPrompt.style.display = "flex";
            if (editorFileInput) editorFileInput.value = "";
        });

        $("studioEditorPresetsGrid")?.querySelectorAll(".studio-style-chip").forEach(chip => {
            chip.addEventListener("click", () => {
                const editPrompt = chip.getAttribute("data-edit") || "";
                const instructionInput = $("studioEditorInstruction");
                if (instructionInput) instructionInput.value = editPrompt;
            });
        });

        $("studioEditorRunBtn")?.addEventListener("click", async () => {
            const origImg = window._studioCurrentOriginalImage;
            if (!origImg) {
                showToast("Please upload an image to edit first.", "warning");
                return;
            }
            const instruction = $("studioEditorInstruction")?.value.trim();
            if (!instruction) {
                showToast("Please provide an edit instruction.", "warning");
                return;
            }

            const emptyState = $("studioEditorEmptyState");
            const loadingState = $("studioEditorLoadingState");
            const compWrap = $("studioEditorComparisonWrap");
            const actions = $("studioEditorActions");

            if (emptyState) emptyState.style.display = "none";
            if (compWrap) compWrap.style.display = "none";
            if (actions) actions.style.display = "none";
            if (loadingState) loadingState.style.display = "flex";

            try {
                const res = await fetch("/api/generate-image", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        editPrompt: instruction,
                        originalImage: origImg
                    })
                });
                const data = await res.json().catch(() => null);

                if (loadingState) loadingState.style.display = "none";

                if (res.ok && data && data.imageUrl) {
                    if (compWrap) compWrap.style.display = "flex";
                    if (actions) actions.style.display = "flex";

                    const origPreview = $("comparisonOriginalImg");
                    const editedPreview = $("comparisonEditedImg");
                    if (origPreview) origPreview.src = origImg;
                    if (editedPreview) editedPreview.src = data.imageUrl;

                    window._studioCurrentEditedImage = data.imageUrl;

                    $("studioDownloadEditedBtn")?.addEventListener("click", () => {
                        const a = document.createElement("a");
                        a.href = data.imageUrl;
                        a.download = "nivora-edited.png";
                        a.click();
                    });

                    $("studioSendEditedToChatBtn")?.addEventListener("click", () => {
                        closeCreationStudio();
                        const input = $("messageInput");
                        if (input) {
                            input.value = `Applied edit: "${instruction}"`;
                            sendMessage();
                        }
                    });

                    saveToCreationGallery({
                        type: "image",
                        title: `Edited: ${instruction}`,
                        url: data.imageUrl
                    });

                    showToast("Transformation complete! ✨", "success");
                } else {
                    throw new Error("Edit request failed");
                }
            } catch (err) {
                if (loadingState) loadingState.style.display = "none";
                if (emptyState) emptyState.style.display = "flex";
                showToast("Could not process image edit. Please try again.", "error");
            }
        });

        // ==========================================
        // 4. SOCIAL MEDIA PANEL
        // ==========================================
        let selectedSocialPreset = "instagram-post";
        let selectedSocialAr = "1:1";

        $("socialPresetsGrid")?.querySelectorAll(".social-preset-card").forEach(card => {
            card.addEventListener("click", () => {
                $("socialPresetsGrid")?.querySelectorAll(".social-preset-card").forEach(c => c.classList.remove("active"));
                card.classList.add("active");
                selectedSocialPreset = card.getAttribute("data-preset") || "instagram-post";
                selectedSocialAr = card.getAttribute("data-ar") || "1:1";
            });
        });

        $("studioSocialGenerateBtn")?.addEventListener("click", async () => {
            const prompt = $("studioSocialPrompt")?.value.trim();
            if (!prompt) {
                showToast("Please enter topic or content description for the social graphic.", "warning");
                return;
            }

            const emptyState = $("studioSocialEmptyState");
            const loadingState = $("studioSocialLoadingState");
            const resultStage = $("studioSocialResultStage");
            const resultImg = $("studioSocialResultImg");

            if (emptyState) emptyState.style.display = "none";
            if (resultStage) resultStage.style.display = "none";
            if (loadingState) loadingState.style.display = "flex";

            try {
                const res = await fetch("/api/generate-image", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        prompt: `High-engagement ${selectedSocialPreset.replace('-', ' ')} visual: ${prompt}, 8k octane, vivid graphics`,
                        aspectRatio: selectedSocialAr,
                        style: "cinematic"
                    })
                });
                const data = await res.json().catch(() => null);

                if (loadingState) loadingState.style.display = "none";

                if (res.ok && data && data.imageUrl) {
                    if (resultStage) resultStage.style.display = "flex";
                    if (resultImg) resultImg.src = data.imageUrl;

                    $("studioDownloadSocialBtn")?.addEventListener("click", () => {
                        const a = document.createElement("a");
                        a.href = data.imageUrl;
                        a.download = `nivora-${selectedSocialPreset}.png`;
                        a.click();
                    });

                    saveToCreationGallery({
                        type: "image",
                        title: `${selectedSocialPreset}: ${prompt}`,
                        url: data.imageUrl
                    });

                    showToast("Social asset generated! 📱", "success");
                }
            } catch (err) {
                if (loadingState) loadingState.style.display = "none";
                if (emptyState) emptyState.style.display = "flex";
                showToast("Social generation failed.", "error");
            }
        });

        // ==========================================
        // 5. PRESENTATIONS & DOCS PANEL
        // ==========================================
        $("studioGenerateDeckBtn")?.addEventListener("click", async () => {
            const topic = $("studioPresentationTopic")?.value.trim();
            if (!topic) {
                showToast("Please enter presentation topic.", "warning");
                return;
            }

            const slideCount = parseInt($("studioPresentationSlidesCount")?.value || "6", 10);
            const style = $("studioPresentationStyle")?.value || "Modern Tech Dark";

            const emptyState = $("studioDeckEmptyState");
            const loadingState = $("studioDeckLoadingState");
            const resultStage = $("studioDeckResultStage");
            const slidesContainer = $("studioDeckSlidesContainer");

            if (emptyState) emptyState.style.display = "none";
            if (resultStage) resultStage.style.display = "none";
            if (loadingState) loadingState.style.display = "flex";

            try {
                const res = await fetch("/api/generate-presentation", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ topic, slideCount, style })
                });
                const data = await res.json().catch(() => null);

                if (loadingState) loadingState.style.display = "none";

                if (res.ok && data && data.downloadUrl) {
                    if (resultStage) resultStage.style.display = "flex";
                    if (slidesContainer) {
                        slidesContainer.innerHTML = (data.slides || []).map((s, idx) => `
                            <div class="deck-slide-card">
                                <div class="deck-slide-num">Slide ${idx + 1}</div>
                                <h4 class="deck-slide-title">${escapeHTML(s.title || "Topic")}</h4>
                                <ul class="deck-slide-bullets">
                                    ${(s.bullets || []).map(b => `<li>${escapeHTML(b)}</li>`).join("")}
                                </ul>
                            </div>
                        `).join("");
                    }

                    const dlBtn = $("studioDownloadDeckBtn");
                    if (dlBtn) {
                        dlBtn.href = data.downloadUrl;
                        dlBtn.download = data.filename || "presentation.pptx";
                    }

                    saveToCreationGallery({
                        type: "presentation",
                        title: topic,
                        url: data.downloadUrl
                    });

                    showToast("Presentation deck ready for download! 📽️", "success");
                }
            } catch (err) {
                if (loadingState) loadingState.style.display = "none";
                if (emptyState) emptyState.style.display = "flex";
                showToast("Presentation generation failed.", "error");
            }
        });

        // ==========================================
        // 6. SHEETS & DATA PANEL
        // ==========================================
        $("studioSheetTemplateGrid")?.querySelectorAll(".studio-style-chip").forEach(chip => {
            chip.addEventListener("click", () => {
                $("studioSheetTemplateGrid")?.querySelectorAll(".studio-style-chip").forEach(c => c.classList.remove("active"));
                chip.classList.add("active");
                const template = chip.getAttribute("data-sheet") || "";
                const promptInput = $("studioSheetPrompt");
                if (promptInput) promptInput.value = template;
            });
        });

        $("studioGenerateSheetBtn")?.addEventListener("click", async () => {
            const prompt = $("studioSheetPrompt")?.value.trim() || "Monthly budget planner";

            const emptyState = $("studioSheetEmptyState");
            const loadingState = $("studioSheetLoadingState");
            const resultStage = $("studioSheetResultStage");
            const tableViewer = $("studioTableViewer");

            if (emptyState) emptyState.style.display = "none";
            if (resultStage) resultStage.style.display = "none";
            if (loadingState) loadingState.style.display = "flex";

            try {
                const res = await fetch("/api/generate-spreadsheet", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ prompt, template: "custom" })
                });
                const data = await res.json().catch(() => null);

                if (loadingState) loadingState.style.display = "none";

                if (res.ok && data && data.rows && data.columns) {
                    if (resultStage) resultStage.style.display = "flex";
                    if (tableViewer) {
                        const headerHtml = `<tr>${data.columns.map(c => `<th>${escapeHTML(c)}</th>`).join("")}</tr>`;
                        const rowsHtml = data.rows.map(r => `<tr>${data.columns.map(c => `<td>${escapeHTML(r[c] ?? "")}</td>`).join("")}</tr>`).join("");
                        tableViewer.innerHTML = `<table class="studio-data-table"><thead>${headerHtml}</thead><tbody>${rowsHtml}</tbody></table>`;
                    }

                    const xlsxBtn = $("studioDownloadXlsxBtn");
                    if (xlsxBtn && data.xlsxUrl) {
                        xlsxBtn.href = data.xlsxUrl;
                        xlsxBtn.download = "nivora-dataset.xlsx";
                    }

                    const csvBtn = $("studioDownloadCsvBtn");
                    if (csvBtn && data.csvUrl) {
                        csvBtn.href = data.csvUrl;
                        csvBtn.download = "nivora-dataset.csv";
                    }

                    saveToCreationGallery({
                        type: "sheet",
                        title: prompt,
                        url: data.xlsxUrl || data.csvUrl
                    });

                    showToast("Spreadsheet generated with formulas & data! 📊", "success");
                }
            } catch (err) {
                if (loadingState) loadingState.style.display = "none";
                if (emptyState) emptyState.style.display = "flex";
                showToast("Spreadsheet generation failed.", "error");
            }
        });

        // ==========================================
        // 7. DIAGRAMS & FLOWCHARTS PANEL
        // ==========================================
        let selectedDiagType = "flowchart";
        $("studioDiagramTypesGrid")?.querySelectorAll(".studio-style-chip").forEach(chip => {
            chip.addEventListener("click", () => {
                $("studioDiagramTypesGrid")?.querySelectorAll(".studio-style-chip").forEach(c => c.classList.remove("active"));
                chip.classList.add("active");
                selectedDiagType = chip.getAttribute("data-diag") || "flowchart";
            });
        });

        $("studioGenerateDiagramBtn")?.addEventListener("click", async () => {
            const prompt = $("studioDiagramPrompt")?.value.trim();
            if (!prompt) {
                showToast("Please describe the diagram flow or system architecture.", "warning");
                return;
            }

            const emptyState = $("studioDiagramEmptyState");
            const loadingState = $("studioDiagramLoadingState");
            const resultStage = $("studioDiagramResultStage");
            const stage = $("studioMermaidStage");

            if (emptyState) emptyState.style.display = "none";
            if (resultStage) resultStage.style.display = "none";
            if (loadingState) loadingState.style.display = "flex";

            try {
                const res = await fetch("/api/generate-diagram", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ prompt, type: selectedDiagType })
                });
                const data = await res.json().catch(() => null);

                if (loadingState) loadingState.style.display = "none";

                if (res.ok && data && data.mermaidCode) {
                    if (resultStage) resultStage.style.display = "flex";
                    window._lastMermaidCode = data.mermaidCode;

                    if (window.mermaid && stage) {
                        const diagId = "diag-" + Date.now();
                        const { svg } = await window.mermaid.render(diagId, data.mermaidCode);
                        stage.innerHTML = svg;
                        window._lastMermaidSvg = svg;
                    }

                    $("studioCopyDiagramSvgBtn")?.addEventListener("click", () => {
                        if (window._lastMermaidSvg) {
                            navigator.clipboard.writeText(window._lastMermaidSvg);
                            showToast("Diagram SVG copied! 📋", "success");
                        }
                    });

                    $("studioDownloadDiagramSvgBtn")?.addEventListener("click", () => {
                        if (window._lastMermaidSvg) {
                            const blob = new Blob([window._lastMermaidSvg], { type: "image/svg+xml" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = "nivora-diagram.svg";
                            a.click();
                        }
                    });

                    showToast("Vector diagram rendered! 🔀", "success");
                }
            } catch (err) {
                if (loadingState) loadingState.style.display = "none";
                if (emptyState) emptyState.style.display = "flex";
                showToast("Diagram rendering failed.", "error");
            }
        });

        // ==========================================
        // 8. 3D & AUDIO PANEL
        // ==========================================
        $("toggleMode3D")?.addEventListener("click", () => {
            $("toggleMode3D")?.classList.add("active");
            $("toggleModeAudio")?.classList.remove("active");
            const c3d = $("studio3DControls");
            const cAudio = $("studioAudioControls");
            const s3d = $("studio3DCanvasWrap");
            const sAudio = $("studioAudioStage");
            if (c3d) c3d.style.display = "block";
            if (cAudio) cAudio.style.display = "none";
            if (s3d) s3d.style.display = "block";
            if (sAudio) sAudio.style.display = "none";
            initThreeJsScene();
        });

        $("toggleModeAudio")?.addEventListener("click", () => {
            $("toggleModeAudio")?.classList.add("active");
            $("toggleMode3D")?.classList.remove("active");
            const c3d = $("studio3DControls");
            const cAudio = $("studioAudioControls");
            const s3d = $("studio3DCanvasWrap");
            const sAudio = $("studioAudioStage");
            if (c3d) c3d.style.display = "none";
            if (cAudio) cAudio.style.display = "block";
            if (s3d) s3d.style.display = "none";
            if (sAudio) sAudio.style.display = "block";
        });

        // 3D asset selection
        $("studio3dAssetGrid")?.querySelectorAll(".studio-style-chip").forEach(chip => {
            chip.addEventListener("click", () => {
                $("studio3dAssetGrid")?.querySelectorAll(".studio-style-chip").forEach(c => c.classList.remove("active"));
                chip.classList.add("active");
                const asset = chip.getAttribute("data-asset") || "robot";
                if (threeSceneInstance) threeSceneInstance.setAsset(asset);
            });
        });

        $("studioToggleWireframe")?.addEventListener("click", (e) => {
            if (threeSceneInstance) {
                const wf = threeSceneInstance.toggleWireframe();
                e.target.textContent = `Wireframe: ${wf ? 'ON' : 'OFF'}`;
            }
        });

        $("studioToggleAutoRotate")?.addEventListener("click", (e) => {
            if (threeSceneInstance) {
                const rot = threeSceneInstance.toggleRotate();
                e.target.textContent = `Auto-Rotate: ${rot ? 'ON' : 'OFF'}`;
            }
        });

        $("studioRender3DBtn")?.addEventListener("click", () => {
            initThreeJsScene();
            showToast("3D scene active! Orbit with mouse & scroll to zoom. 🧊", "success");
        });

        // Audio Presets
        let selectedAudioPreset = "laser";
        $("studioAudioPresetsGrid")?.querySelectorAll(".studio-style-chip").forEach(chip => {
            chip.addEventListener("click", () => {
                $("studioAudioPresetsGrid")?.querySelectorAll(".studio-style-chip").forEach(c => c.classList.remove("active"));
                chip.classList.add("active");
                selectedAudioPreset = chip.getAttribute("data-sound") || "laser";
                const titleEl = $("audioPlayingSoundTitle");
                if (titleEl) titleEl.textContent = `Preset: ${selectedAudioPreset.toUpperCase()}`;
            });
        });

        $("studioPlaySoundBtn")?.addEventListener("click", () => {
            synthesizeSoundEffect(selectedAudioPreset);
        });

        $("audioStagePlayBtn")?.addEventListener("click", () => {
            synthesizeSoundEffect(selectedAudioPreset);
        });

        // ==========================================
        // 9. QR CODE PANEL
        // ==========================================
        $("studioGenerateQrBtn")?.addEventListener("click", async () => {
            const input = $("studioQrPayloadInput");
            const text = input ? input.value.trim() : "https://nivora.org";
            const fgColor = $("studioQrFgColor")?.value || "#0d0e15";
            const bgColor = $("studioQrBgColor")?.value || "#ffffff";

            showToast("Generating high-resolution QR code... 📱");
            try {
                const res = await fetch("/api/generate-qr", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text, color: fgColor, bgColor: bgColor, size: 420 })
                });
                const data = await res.json().catch(() => null);

                if (res.ok && data && data.qrDataUrl) {
                    const img = $("studioQrResultImg");
                    if (img) img.src = data.qrDataUrl;

                    const dlPng = $("studioDownloadQrPngBtn");
                    if (dlPng) {
                        dlPng.href = data.qrDataUrl;
                        dlPng.download = "nivora-qr.png";
                    }

                    $("studioDownloadQrSvgBtn")?.addEventListener("click", () => {
                        if (data.svgString) {
                            const blob = new Blob([data.svgString], { type: "image/svg+xml" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = "nivora-qr.svg";
                            a.click();
                        }
                    });

                    saveToCreationGallery({
                        type: "qr",
                        title: text,
                        url: data.qrDataUrl
                    });

                    showToast("QR code ready! 📱", "success");
                }
            } catch (err) {
                showToast("QR generation failed.", "error");
            }
        });

        // Initialize default QR Code on load
        $("studioGenerateQrBtn")?.click();
    }

    // ----------------------------------------------------
    // UTILS
    // ----------------------------------------------------

    function scrollToBottom() {
        const messages = $("messages");
        if (messages) {
            setTimeout(() => {
                messages.scrollTop = messages.scrollHeight;
            }, 60);
        }
    }

    function escapeHTML(str) {
        return String(str ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    // ----------------------------------------------------
    // CHAT ACTIONS & CONVERSATION SEARCH
    // ----------------------------------------------------

    async function handleRegenerateResponse() {
        const chat = getActiveChat();
        if (!chat || !chat.messages || chat.messages.length === 0) return;

        // Find last user message
        let lastUserIdx = -1;
        for (let i = chat.messages.length - 1; i >= 0; i--) {
            if (chat.messages[i].role === "user") {
                lastUserIdx = i;
                break;
            }
        }
        if (lastUserIdx === -1) return;

        const targetUserMsg = chat.messages[lastUserIdx];
        // Trim messages to re-run from that user prompt
        chat.messages = chat.messages.slice(0, lastUserIdx);
        saveChats();
        renderChatMessages();

        // Populate and send
        const input = $("messageInput");
        if (input) {
            input.value = targetUserMsg.content || "";
            if (targetUserMsg.attachment) {
                currentAttachment = targetUserMsg.attachment;
            }
            sendMessage();
        }
    }

    function clearCurrentChat() {
        const chat = getActiveChat();
        if (!chat || !chat.messages || chat.messages.length === 0) {
            showToast("Chat is already empty.", "info");
            return;
        }
        if (confirm("Are you sure you want to clear this conversation?")) {
            chat.messages = [];
            chat.updatedAt = Date.now();
            saveChats();
            renderChatMessages();
            showToast("Conversation cleared.", "success");
        }
    }

    function filterConversation(query) {
        query = (query || "").trim().toLowerCase();
        const messages = document.querySelectorAll("#messages .message");
        const countEl = $("convSearchCount");

        if (!query) {
            messages.forEach(m => { m.style.display = "flex"; });
            if (countEl) countEl.textContent = "";
            return;
        }

        let matches = 0;
        messages.forEach(m => {
            const text = (m.textContent || "").toLowerCase();
            if (text.includes(query)) {
                m.style.display = "flex";
                matches++;
            } else {
                m.style.display = "none";
            }
        });
        if (countEl) countEl.textContent = `${matches} found`;
    }

    // ----------------------------------------------------
    // INITIALIZATION
    // ----------------------------------------------------

    function init() {
        // Setup buttons
        $("newChatButton")?.addEventListener("click", startNewChat);
        $("newChatTopBtn")?.addEventListener("click", startNewChat);
        $("clearChatTopBtn")?.addEventListener("click", clearCurrentChat);

        // Search Conversation in active chat
        $("searchConvTopBtn")?.addEventListener("click", () => {
            const bar = $("convSearchBar");
            if (!bar) return;
            if (bar.style.display === "none" || !bar.style.display) {
                bar.style.display = "flex";
                const input = $("convSearchInput");
                if (input) {
                    input.value = "";
                    input.focus();
                }
            } else {
                bar.style.display = "none";
                filterConversation("");
            }
        });

        $("closeConvSearchBtn")?.addEventListener("click", () => {
            const bar = $("convSearchBar");
            if (bar) bar.style.display = "none";
            const input = $("convSearchInput");
            if (input) input.value = "";
            filterConversation("");
        });

        $("convSearchInput")?.addEventListener("input", (e) => {
            filterConversation(e.target.value);
        });

        $("sendButton")?.addEventListener("click", sendMessage);
        $("messageInput")?.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            } else if (e.key === "Enter" && e.shiftKey) {
                setTimeout(() => adjustMessageInputHeight(e.target), 0);
            }
        });
        $("messageInput")?.addEventListener("input", (e) => {
            adjustMessageInputHeight(e.target);
        });

        // Modals & Panels
        $("searchChats")?.addEventListener("click", () => {
            $("searchPanel")?.classList.add("active");
            $("chatSearchInput")?.focus();
        });
        $("closeSearch")?.addEventListener("click", () => $("searchPanel")?.classList.remove("active"));
        $("chatSearchInput")?.addEventListener("input", (e) => searchChats(e.target.value));

        $("libraryBtn")?.addEventListener("click", showLibrary);
        $("closeLibrary")?.addEventListener("click", () => $("libraryPanel")?.classList.remove("active"));

        $("pinnedBtn")?.addEventListener("click", showPinned);
        $("closePinned")?.addEventListener("click", () => $("pinnedPanel")?.classList.remove("active"));

        $("projectsBtn")?.addEventListener("click", openProjectsPanel);

        // Creation Studio Buttons
        $("creationHubSidebarBtn")?.addEventListener("click", () => openCreationStudio("images"));
        $("topCreationHubBtn")?.addEventListener("click", () => openCreationStudio("images"));

        // Top bar Canvas Toggle
        $("topCanvasToggle")?.addEventListener("click", () => {
            const panel = $("artifactCanvasPanel");
            if (panel?.classList.contains("open")) {
                closeArtifactCanvas();
            } else {
                openArtifactCanvas(currentArtifact || {
                    type: "html",
                    title: "Live Canvas",
                    code: "<!DOCTYPE html><html><body style='font-family:sans-serif;padding:30px;text-align:center;'><h2>Welcome to NIVORA Live Canvas</h2><p>Ask NIVORA to build a website, component, SVG, or interactive chart, and preview it here live!</p></body></html>"
                });
            }
        });

        // Welcome screen shortcuts
        document.querySelectorAll(".shortcut-chip").forEach((chip) => {
            chip.addEventListener("click", () => {
                const prompt = chip.getAttribute("data-prompt") || chip.textContent;
                const input = $("messageInput");
                if (input) {
                    input.value = prompt;
                    sendMessage();
                }
            });
        });

        // Auth
        $("loginBtn")?.addEventListener("click", (e) => { e.preventDefault(); login(); });
        $("createAccountBtn")?.addEventListener("click", (e) => { e.preventDefault(); openSignup(); });
        $("backToLoginBtn")?.addEventListener("click", (e) => { e.preventDefault(); openLogin(); });
        $("signupBtn")?.addEventListener("click", (e) => { e.preventDefault(); signup(); });
        $("forgotPasswordBtn")?.addEventListener("click", (e) => { e.preventDefault(); openForgot(); });
        $("sendResetBtn")?.addEventListener("click", (e) => { e.preventDefault(); sendPasswordReset(); });
        $("verifyOtpBtn")?.addEventListener("click", (e) => { e.preventDefault(); verifyOtpCode(); });
        $("resendOtpBtn")?.addEventListener("click", (e) => { e.preventDefault(); sendPasswordReset(); });
        $("backToStep1Btn")?.addEventListener("click", (e) => {
            e.preventDefault();
            const step1 = $("forgotStep1");
            const step2 = $("forgotStep2");
            if (step1) step1.style.display = "block";
            if (step2) step2.style.display = "none";
        });
        $("otpCodeInput")?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); verifyOtpCode(); }
        });
        $("backToLoginFromForgotBtn")?.addEventListener("click", (e) => { e.preventDefault(); openLogin(); });
        $("googleLoginBtn")?.addEventListener("click", (e) => { e.preventDefault(); handleContinueWithGoogle(); });
        $("googleSignupBtn")?.addEventListener("click", (e) => { e.preventDefault(); handleContinueWithGoogle(); });

        // Image Preview Modal events
        $("closeImagePreviewBtn")?.addEventListener("click", () => {
            const modal = $("imagePreviewModal");
            if (modal) modal.style.display = "none";
        });
        $("imagePreviewModal")?.addEventListener("click", (e) => {
            if (e.target === $("imagePreviewModal")) {
                $("imagePreviewModal").style.display = "none";
            }
        });

        // File Preview Modal events
        $("closeFilePreviewBtn")?.addEventListener("click", () => {
            const modal = $("filePreviewModal");
            if (modal) modal.style.display = "none";
        });
        $("filePreviewModal")?.addEventListener("click", (e) => {
            if (e.target === $("filePreviewModal")) {
                $("filePreviewModal").style.display = "none";
            }
        });
        $("toggleManualCodeBtn")?.addEventListener("click", (e) => {
            e.preventDefault();
            const form = $("manualCodeForm");
            if (form) form.style.display = form.style.display === "none" ? "block" : "none";
        });

        // Reset password events
        $("submitNewPasswordBtn")?.addEventListener("click", (e) => { e.preventDefault(); submitNewPassword(); });
        $("backToLoginFromResetBtn")?.addEventListener("click", (e) => { e.preventDefault(); openLogin(); });
        $("toggleNewResetPassword")?.addEventListener("click", () => {
            const el = $("newResetPassword");
            if (el) el.type = el.type === "password" ? "text" : "password";
        });
        $("toggleConfirmResetPassword")?.addEventListener("click", () => {
            const el = $("confirmResetPassword");
            if (el) el.type = el.type === "password" ? "text" : "password";
        });
        $("confirmResetPassword")?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); submitNewPassword(); }
        });

        $("loginPassword")?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); login(); }
        });
        $("signupConfirmPassword")?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); signup(); }
        });
        $("forgotEmail")?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); sendPasswordReset(); }
        });

        $("toggleLoginPassword")?.addEventListener("click", () => {
            const el = $("loginPassword");
            if (el) el.type = el.type === "password" ? "text" : "password";
        });
        $("toggleSignupPassword")?.addEventListener("click", () => {
            const el = $("signupPassword");
            if (el) el.type = el.type === "password" ? "text" : "password";
        });
        $("toggleSignupConfirmPassword")?.addEventListener("click", () => {
            const el = $("signupConfirmPassword");
            if (el) el.type = el.type === "password" ? "text" : "password";
        });

        // Sidebar user profile card trigger
        $("sidebarUser")?.addEventListener("click", () => {
            openSettings();
            setTimeout(() => {
                $("profileBtn")?.click();
            }, 50);
        });

        // Profile avatar file input change listener
        $("profileAvatarInput")?.addEventListener("change", async (e) => {
            const input = e.target;
            const file = input.files && input.files[0];
            if (!file) return;

            if (!file.type.startsWith("image/")) {
                showToast("Please select a valid image file (PNG, JPG, WebP).", "error");
                input.value = "";
                return;
            }

            try {
                showToast("Optimizing avatar image...");
                const compressedBase64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        const img = new Image();
                        img.onload = () => {
                            const maxSize = 512;
                            let w = img.width;
                            let h = img.height;
                            if (w > maxSize || h > maxSize) {
                                if (w > h) {
                                    h = Math.round((h * maxSize) / w);
                                    w = maxSize;
                                } else {
                                    w = Math.round((w * maxSize) / h);
                                    h = maxSize;
                                }
                            }
                            const canvas = document.createElement("canvas");
                            canvas.width = w;
                            canvas.height = h;
                            const ctx = canvas.getContext("2d");
                            ctx.drawImage(img, 0, 0, w, h);
                            resolve(canvas.toDataURL("image/jpeg", 0.85));
                        };
                        img.onerror = () => resolve(ev.target.result);
                        img.src = ev.target.result;
                    };
                    reader.onerror = (readErr) => reject(readErr);
                    reader.readAsDataURL(file);
                });

                showToast("Uploading avatar...");
                const user = getUser();
                const uid = user.uid || user.user_id || "anonymous";

                const res = await fetch("/api/user/avatar", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        userId: uid,
                        email: user.email,
                        imageBase64: compressedBase64,
                        avatarBase64: compressedBase64
                    })
                });

                let newPic = compressedBase64;
                try {
                    const contentType = res.headers.get("content-type") || "";
                    if (contentType.includes("application/json")) {
                        const data = await res.json().catch(() => null);
                        if (data && data.profile_picture) {
                            newPic = data.profile_picture;
                        }
                    }
                } catch (jsonErr) {
                    console.warn("Avatar JSON parse warning:", jsonErr);
                }

                user.profile_picture = newPic;
                saveUser(user);
                updateUserUI(user);

                const largeAv = $("profileLargeAvatar");
                if (largeAv) {
                    largeAv.innerHTML = `<img src="${newPic}" alt="${escapeHTML(user.name || 'User')}" />`;
                }

                document.querySelectorAll(".user-msg-avatar").forEach(el => {
                    el.innerHTML = `<img src="${newPic}" alt="${escapeHTML(user.name || 'User')}">`;
                });

                if (window.NivoraAuth?.saveUserProfileToFirestore) {
                    window.NivoraAuth.saveUserProfileToFirestore(user).catch(console.warn);
                }

                showToast("Avatar updated successfully! 📷", "success");
            } catch (err) {
                console.error("Avatar upload error:", err);
                showToast("Could not update avatar image. Please try again.", "error");
            } finally {
                input.value = "";
            }
        });

        $("profileLargeAvatar")?.addEventListener("click", () => {
            $("profileAvatarInput")?.click();
        });

        $("closePlugins")?.addEventListener("click", () => {
            $("pluginsModal")?.classList.remove("active");
        });

        // Close on Escape
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                closeSettings();
                closeModals();
                closeArtifactCanvas();
                closeCreationStudio();
                const fileModal = $("filePreviewModal");
                if (fileModal) fileModal.style.display = "none";
            }
        });

        // Setup subsystems
        setupSidebar();
        setupAttachMenu();
        setupVoiceAssistant();
        setupCanvasControls();
        setupProjectModal();
        setupSettingsAccordion();
        setupKeyboardShortcuts();
        setupNivoraRobot();
        setupCreationStudio();

        // ----------------------------------------------------
        // STARTUP ANIMATION
        // Plays the uploaded NIVORA logo reveal video full-screen on initial app load,
        // then smoothly fades out and reveals the existing NIVORA login page.
        // ----------------------------------------------------
        function setupStartupAnimation() {
            const overlay = $("startupAnimation");
            const video = $("startupVideo");
            const loginScreen = $("loginScreen");

            let animationFinished = false;
            let fallbackTimer = null;

            // Prevent scrolling while startup video is visible
            document.documentElement.classList.add("startup-active");
            document.body.classList.add("startup-active");

            // Ensure all screens remain completely hidden while video is playing
            hide(loginScreen);
            hide($("signupScreen"));
            hide($("forgotScreen"));
            hide($("resetPasswordScreen"));
            hide(document.querySelector(".app"));

            function finishStartupAndRevealLogin() {
                if (animationFinished) return;
                animationFinished = true;

                if (fallbackTimer) {
                    clearTimeout(fallbackTimer);
                    fallbackTimer = null;
                }

                // Unlock scrolling
                document.documentElement.classList.remove("startup-active");
                document.body.classList.remove("startup-active");

                // Check if user came from a password reset email link
                const urlParams = new URLSearchParams(window.location.search);
                const mode = urlParams.get("mode");
                const oobCode = urlParams.get("oobCode") || urlParams.get("code");
                if (mode === "resetPassword" || (oobCode && !mode)) {
                    openResetPassword(oobCode || "");
                    if (oobCode && window.NivoraAuth) {
                        window.NivoraAuth.verifyResetCode(oobCode).then((email) => {
                            const sub = $("resetPasswordSubtitle");
                            if (sub && email) sub.textContent = `Create a new password for ${email}`;
                        }).catch((err) => {
                            const msg = window.NivoraAuth?.formatAuthError(err, "reset") || "This password reset link is invalid or has expired.";
                            const errEl = $("resetErrorMessage");
                            if (errEl) { errEl.textContent = msg; errEl.style.display = "block"; }
                        });
                    }
                } else {
                    const existingUser = (window.NivoraAuth?.getCurrentUser && window.NivoraAuth.getCurrentUser()) || currentAuthenticatedUser;
                    if (existingUser) {
                        openApp(existingUser);
                    } else if (window.NivoraAuth?.waitForReady) {
                        window.NivoraAuth.waitForReady().then((readyUser) => {
                            if (readyUser) {
                                openApp(readyUser);
                            } else {
                                openLogin();
                            }
                        }).catch(() => {
                            openLogin();
                        });
                    } else {
                        openLogin();
                    }
                }

                // Smoothly fade out the video screen overlay
                if (overlay) {
                    overlay.classList.add("fade-out");
                    setTimeout(() => {
                        overlay.classList.add("hidden");
                        overlay.style.display = "none";
                        try {
                            if (video) video.pause();
                        } catch (_) {}
                    }, 800);
                }
            }

            const isBot = /bot|crawler|spider|googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|facebot|facebookexternalhit|lighthouse/i.test(navigator.userAgent || "") || navigator.webdriver;
            const prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

            if (!overlay || !video || isBot || prefersReducedMotion) {
                finishStartupAndRevealLogin();
                return;
            }

            // Configure video: strictly muted, playsinline, single playback without controls
            video.muted = true;
            video.defaultMuted = true;
            video.volume = 0;

            // 1. Natural end event
            video.addEventListener("ended", () => {
                finishStartupAndRevealLogin();
            }, { once: true });

            // 2. Near-end timeupdate check (guarantees completion even if ended event lags)
            const checkNearEnd = () => {
                if (video.duration > 0 && video.currentTime >= video.duration - 0.15) {
                    video.removeEventListener("timeupdate", checkNearEnd);
                    finishStartupAndRevealLogin();
                }
            };
            video.addEventListener("timeupdate", checkNearEnd);

            // 3. Error handling: automatically skip video and reveal existing login page
            video.addEventListener("error", () => {
                console.warn("Startup video error; smoothly skipping to login page.");
                finishStartupAndRevealLogin();
            }, { once: true });

            const sources = video.querySelectorAll("source");
            sources.forEach((src) => {
                src.addEventListener("error", () => {
                    if (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
                        console.warn("Startup video source error; skipping to login page.");
                        finishStartupAndRevealLogin();
                    }
                });
            });

            // 4. Safety fallback timeout (video length is 9.2s)
            fallbackTimer = setTimeout(() => {
                if (!animationFinished) {
                    console.warn("Startup video safety timeout reached; revealing login page.");
                    finishStartupAndRevealLogin();
                }
            }, 10500);

            // 5. Allow tap/click/key to finish seamlessly so user is never stuck
            overlay.addEventListener("click", () => {
                finishStartupAndRevealLogin();
            }, { once: true });

            const onKeySkip = (e) => {
                if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
                    window.removeEventListener("keydown", onKeySkip);
                    finishStartupAndRevealLogin();
                }
            };
            window.addEventListener("keydown", onKeySkip);

            // 6. Autoplay attempt
            try {
                const playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise.catch((err) => {
                        console.warn("Autoplay was prevented by browser policy:", err);
                        finishStartupAndRevealLogin();
                    });
                }
            } catch (e) {
                console.warn("Video playback execution error:", e);
                finishStartupAndRevealLogin();
            }
        }

        // Initialize startup animation flow
        setupStartupAnimation();

        // Load active chat or initial state
        if (activeChatId) {
            loadChat(activeChatId);
        } else {
            renderRecentChats();
        }

        const providerEl = $("providerName");
        if (providerEl) {
            providerEl.textContent = "NIVORA AI";
        }

        console.log("NIVORA Assistant loaded successfully.");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }

    // Expose global helpers for backward compatibility
    window.showLibrary = showLibrary;
    window.renderRecentChats = renderRecentChats;
    window.renderChatMessages = renderChatMessages;
    window.loadChat = loadChat;
    window.openCreationStudio = openCreationStudio;
    window.closeCreationStudio = closeCreationStudio;
})();
