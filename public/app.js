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
        currentAuthenticatedUser = e.detail?.user || null;
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
            t.includes("real-time")
        ) {
            return true;
        }
        // Real-time live keywords only
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
            "latest updates"
        ];
        for (let i = 0; i < liveKeywords.length; i++) {
            if (t.includes(liveKeywords[i])) return true;
        }
        // Normal questions, coding, math, essays, summaries, brainstorms, definitions DO NOT search the web
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

        // Check if message is direct image generation request
        const isImageGen = /^(generate|create|draw|make)\s+(an?\s+)?image/i.test(messageText);
        const queryNeedsSearch = shouldQuerySearchWeb(messageText);

        // Add Thinking / Response Animation
        let thinkingLabel = "NIVORA is thinking";
        if (isImageGen) {
            thinkingLabel = "Generating image with NIVORA";
        } else if (imageAttachments.length > 1) {
            thinkingLabel = `Understanding & analyzing ${imageAttachments.length} images with Gemini vision`;
        } else if (imageAttachments.length === 1) {
            thinkingLabel = "Understanding & analyzing image with Gemini vision";
        } else if (fileAttachments.length > 0) {
            thinkingLabel = `Reading & analyzing ${fileAttachments[0].name}`;
        } else if (webSearchEnabled || queryNeedsSearch) {
            thinkingLabel = "Searching the web & verifying sources";
        } else if (/(code|function|class|component|html|react|python)/i.test(messageText)) {
            thinkingLabel = "Analyzing architecture & coding";
        }

        const aiMsgElement = addAIMessageSkeleton(thinkingLabel);

        let searchInterval = null;
        if (webSearchEnabled || queryNeedsSearch) {
            const labelEl = aiMsgElement ? aiMsgElement.querySelector(".thinking-pill > span:first-child") : null;
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

        try {
            let replyText = "";
            let sources = [];
            let images = [];
            let artifactData = null;
            let generatedFileData = null;

            if (isImageGen) {
                // Call dedicated image generation endpoint
                const imagePrompt = messageText.replace(/^(generate|create|draw|make)\s+(an?\s+)?image\s*(of|about|for)?\s*/i, "").trim() || messageText;
                const imgRes = await fetch("/api/generate-image", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ prompt: imagePrompt, aspectRatio: "1:1" }),
                    signal: abortController.signal
                });
                let imgData = null;
                const imgContentType = imgRes.headers.get("content-type") || "";
                if (imgContentType.includes("application/json")) {
                    imgData = await imgRes.json().catch(() => null);
                }
                if (imgRes.ok && imgData && imgData.imageUrl) {
                    replyText = `Here is your generated image for: **${imagePrompt}**\n\n![Generated Image](${imgData.imageUrl})`;
                } else {
                    let errDetail = imgData?.error || imgData?.message;
                    if (!errDetail) {
                        if (imgRes.status === 429) errDetail = "Image generation quota exceeded. Please wait a moment and try again.";
                        else if (imgRes.status === 503) errDetail = "Image generation service is temporarily unavailable. Please try again.";
                        else errDetail = `Image generation service returned status ${imgRes.status}`;
                    }
                    throw new Error(errDetail);
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
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                    signal: abortController.signal
                });

                let data = null;
                const resContentType = response.headers.get("content-type") || "";
                if (resContentType.includes("application/json")) {
                    data = await response.json().catch(() => null);
                }

                if (!response.ok) {
                    let errMsg = data?.error || data?.message || data?.reply;
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

                if (!data) {
                    throw new Error("NIVORA received an unexpected response format. Please try again.");
                }

                replyText = data.reply || "I didn't receive a response.";
                sources = Array.isArray(data.sources) ? data.sources : [];
                images = Array.isArray(data.images) ? data.images : [];
                artifactData = data.artifact || null;
                generatedFileData = data.generatedFile || null;

                if (data.provider) {
                    const providerEl = $("providerName");
                    if (providerEl) providerEl.textContent = data.provider;
                }
            }

            if (searchInterval) {
                clearInterval(searchInterval);
                searchInterval = null;
            }

            // Generate AI response timestamp using current local time
            const aiNow = new Date();
            const aiTimestamp = aiNow.getTime();
            // Render AI Response
            renderAIResponse(aiMsgElement.querySelector(".message-content"), replyText, sources, artifactData, images, aiTimestamp, generatedFileData);

            // Save AI message to history
            chat.messages.push({
                role: "assistant",
                content: replyText,
                sources: sources.length > 0 ? sources : undefined,
                images: images.length > 0 ? images : undefined,
                artifact: artifactData || undefined,
                generatedFile: generatedFileData || undefined,
                timestamp: aiTimestamp
            });
            chat.updatedAt = aiTimestamp;
            saveChats();

        } catch (error) {
            if (error.name === "AbortError") {
                const contentDiv = aiMsgElement.querySelector(".message-content");
                if (contentDiv) {
                    contentDiv.innerHTML = `<span style="color:#94a3b8;font-style:italic;">⏹ Generation stopped by user.</span>`;
                }
            } else {
                console.error("Chat error:", error);
                const isUnavailable = error?.message && (
                    error.message.includes("temporarily unavailable") ||
                    error.message.includes("ALL_AI_PROVIDERS_UNAVAILABLE") ||
                    error.message.includes("503")
                );
                const errorText = isUnavailable
                    ? "NIVORA AI is temporarily unavailable. Please try again."
                    : (error?.message || "NIVORA AI is temporarily unavailable. Please try again.");

                const contentDiv = aiMsgElement.querySelector(".message-content");
                if (contentDiv) {
                    contentDiv.innerHTML = `
                        <div style="display:flex;flex-direction:column;gap:10px;align-items:flex-start;">
                            <span style="color:#ff7777;">⚠️ ${escapeHTML(errorText)}</span>
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
            const textSpan = document.createElement("span");
            textSpan.textContent = msg.content;
            content.appendChild(textSpan);
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

    function addAIMessageSkeleton(label = "NIVORA is thinking") {
        const messages = $("messages");
        if (!messages) return null;

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

        content.innerHTML = `
            <div class="thinking-container">
                <span class="thinking-pill">
                    <span>${label}</span>
                    <span class="thinking-dots">
                        <span class="thinking-dot"></span>
                        <span class="thinking-dot"></span>
                        <span class="thinking-dot"></span>
                    </span>
                </span>
            </div>
        `;

        row.appendChild(icon);
        row.appendChild(content);
        messages.appendChild(row);
        scrollToBottom();
        return row;
    }

    function renderAIResponse(container, text, sources = [], artifact = null, images = [], msgTimestamp = null, generatedFile = null) {
        if (!container) return;
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

        // Render Code Blocks & Markdown
        const codeBlockRegex = /```([a-zA-Z0-9_+-]*)\s*\n?([\s\S]*?)```/g;
        let lastIdx = 0;
        let match;

        while ((match = codeBlockRegex.exec(processedText)) !== null) {
            const normalText = processedText.substring(lastIdx, match.index);
            if (normalText.trim()) {
                addFormattedMarkdown(container, normalText);
            }

            const lang = (match[1] || "plaintext").toLowerCase();
            const code = match[2].trim();

            const codeWrapper = document.createElement("div");
            codeWrapper.className = "code-block-wrapper";

            const header = document.createElement("div");
            header.className = "code-header";

            const langSpan = document.createElement("span");
            langSpan.textContent = lang.toUpperCase();
            header.appendChild(langSpan);

            const headerActions = document.createElement("div");
            headerActions.style.display = "flex";
            headerActions.style.gap = "8px";

            // If HTML/SVG or interactive web code, add Live Canvas preview button
            if (["html", "svg", "jsx", "tsx", "xml"].includes(lang) || code.includes("<html") || code.includes("<svg") || code.includes("<!DOCTYPE")) {
                const canvasBtn = document.createElement("button");
                canvasBtn.type = "button";
                canvasBtn.className = "code-copy-btn";
                canvasBtn.innerHTML = "▶ Preview in Canvas";
                canvasBtn.onclick = () => {
                    openArtifactCanvas({
                        type: lang,
                        title: "Code Preview",
                        code: code
                    });
                };
                headerActions.appendChild(canvasBtn);
            }

            const copyBtn = document.createElement("button");
            copyBtn.type = "button";
            copyBtn.className = "code-copy-btn";
            copyBtn.innerHTML = "📋 Copy";
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(code);
                copyBtn.innerHTML = "✅ Copied!";
                setTimeout(() => { copyBtn.innerHTML = "📋 Copy"; }, 2000);
            };
            headerActions.appendChild(copyBtn);
            header.appendChild(headerActions);

            const pre = document.createElement("pre");
            const codeEl = document.createElement("code");
            codeEl.className = `language-${lang}`;
            codeEl.textContent = code;

            pre.appendChild(codeEl);
            codeWrapper.appendChild(header);
            codeWrapper.appendChild(pre);
            container.appendChild(codeWrapper);

            // Trigger Highlight.js if loaded
            if (window.hljs) {
                try { hljs.highlightElement(codeEl); } catch {}
            }

            lastIdx = codeBlockRegex.lastIndex;
        }

        const remaining = processedText.substring(lastIdx);
        if (remaining.trim()) {
            addFormattedMarkdown(container, remaining);
        }

        // Render Generated Images if any
        if (generatedImages.length > 0) {
            generatedImages.forEach((imgObj) => {
                const imgWrap = document.createElement("div");
                imgWrap.className = "generated-image-wrap";

                const img = document.createElement("img");
                img.src = imgObj.src;
                img.alt = imgObj.alt || "Generated Image";
                img.style.cursor = "pointer";
                img.onclick = () => {
                    openImagePreview({
                        src: imgObj.src,
                        title: imgObj.alt || "Generated Image",
                        sourceUrl: "",
                        domain: "NIVORA AI Generator"
                    });
                };

                const actions = document.createElement("div");
                actions.className = "image-actions";

                const info = document.createElement("span");
                info.textContent = imgObj.alt || "NIVORA Image";

                const previewBtn = document.createElement("button");
                previewBtn.type = "button";
                previewBtn.style.cssText = "background:none;border:none;color:#6c63ff;font-size:12px;cursor:pointer;margin-right:8px;";
                previewBtn.textContent = "🔍 Full View";
                previewBtn.onclick = () => {
                    openImagePreview({
                        src: imgObj.src,
                        title: imgObj.alt || "Generated Image",
                        sourceUrl: "",
                        domain: "NIVORA AI Generator"
                    });
                };

                const downloadLink = document.createElement("a");
                downloadLink.href = imgObj.src;
                downloadLink.download = "nivora-generated.png";
                downloadLink.textContent = "⬇ Download";

                actions.appendChild(info);
                actions.appendChild(previewBtn);
                actions.appendChild(downloadLink);
                imgWrap.appendChild(img);
                imgWrap.appendChild(actions);
                container.appendChild(imgWrap);
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
        const div = document.createElement("div");
        div.style.lineHeight = "1.65";

        let html = escapeHTML(text);

        // Bold
        html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

        // Italics
        html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");

        // Headers
        html = html.replace(/^### (.*$)/gim, "<h4 style='color:#fff;margin:12px 0 6px;'>$1</h4>");
        html = html.replace(/^## (.*$)/gim, "<h3 style='color:#fff;margin:14px 0 6px;'>$1</h3>");
        html = html.replace(/^# (.*$)/gim, "<h2 style='color:#fff;margin:16px 0 8px;'>$1</h2>");

        // Bullet lists
        html = html.replace(/^\s*[-*]\s+(.*$)/gim, "<li style='margin-left:18px;'>$1</li>");

        // Inline code
        html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

        // Line breaks
        html = html.replace(/\n/g, "<br>");

        div.innerHTML = html;
        container.appendChild(div);
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

                renderAIResponse(content, msg.content, msg.sources, msg.artifact, msg.images, msg.timestamp, msg.generatedFile);
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

        // Paste image directly from clipboard (on input and global chat window)
        function handleClipboardPaste(e) {
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA") && activeEl.id !== "messageInput") {
                return; // Do not intercept paste in other form inputs (e.g. login/signup)
            }
            const items = e.clipboardData?.items;
            if (!items) return;
            let found = false;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type && (items[i].type.startsWith("image/") || items[i].type === "application/pdf")) {
                    const file = items[i].getAsFile();
                    if (file) {
                        found = true;
                        handleSelectedFile(file);
                    }
                }
            }
            if (found && e.target !== $("messageInput")) {
                e.preventDefault();
            }
        }

        const messageBox = $("messageInput");
        if (messageBox) {
            messageBox.addEventListener("paste", handleClipboardPaste);
        }
        window.addEventListener("paste", handleClipboardPaste);

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

    function setupSettingsAccordion() {
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
    // SIDEBAR CONTROLS & DRAG RESIZING
    // ----------------------------------------------------

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
            }
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
                    // Reveal the existing NIVORA login page
                    openLogin();
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
})();
