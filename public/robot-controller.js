/**
 * NIVORA AI Companion Robot Controller
 * Finite State Machine & Animation Interaction System
 *
 * States:
 *   IDLE, GREETING, HOVER, TYPING, THINKING, EXCITED, DANCE, CRY, GOODBYE, HIDDEN, DONE, ERROR
 * Priority:
 *   HIDDEN (105) > GOODBYE (100) > CRY (90) > GREETING (85) > DANCE (80) > DONE (70) > ERROR (60) > EXCITED (50) > THINKING (40) > TYPING (30) > HOVER (20) > IDLE (10)
 */

(function () {
    "use strict";

    const STATES = Object.freeze({
        IDLE: "IDLE",
        GREETING: "GREETING",
        HOVER: "HOVER",
        TYPING: "TYPING",
        THINKING: "THINKING",
        EXCITED: "EXCITED",
        DANCE: "DANCE",
        CRY: "CRY",
        GOODBYE: "GOODBYE",
        HIDDEN: "HIDDEN",
        DONE: "DONE",
        ERROR: "ERROR",
        // Backward-compatibility aliases
        DANCING: "DANCE",
        HIDING: "GOODBYE",
        REAPPEARING: "GREETING",
        SUCCESS: "DONE",
        CURIOUS: "TYPING",
        HAPPY: "EXCITED",
        VISIBLE: "IDLE",
        HIDDEN_BELOW_INPUT: "HIDDEN"
    });

    const STATE_PRIORITY = Object.freeze({
        HIDDEN: 105,
        GOODBYE: 100,
        CRY: 90,
        GREETING: 85,
        DANCE: 80,
        DONE: 70,
        ERROR: 60,
        EXCITED: 50,
        THINKING: 40,
        TYPING: 30,
        HOVER: 20,
        IDLE: 10
    });

    class NivoraRobotCompanion {
        static STATES = STATES;
        static STATE_PRIORITY = STATE_PRIORITY;

        constructor(robotElement) {
            this.robot = robotElement || document.getElementById("nivoraRobot");
            if (!this.robot) return;

            // DOM Sub-elements
            this.speechBubble = document.getElementById("nivoraRobotSpeech");
            this.speechText = document.getElementById("nivoraRobotSpeechText");
            this.leftPupil = this.robot.querySelector(".robot-pupil-left");
            this.rightPupil = this.robot.querySelector(".robot-pupil-right");
            this.leftEye = this.robot.querySelector(".robot-eye-left");
            this.rightEye = this.robot.querySelector(".robot-eye-right");
            this.headGroup = this.robot.querySelector(".robot-head-group");
            this.mouthEl = document.getElementById("robotMouth");
            this.messageInput = document.getElementById("messageInput");
            this.messagesContainer = document.getElementById("messages");
            this.voiceBtn = document.getElementById("voiceBtn");
            this.attachmentTray = document.getElementById("attachmentTray");

            // FSM State Tracking
            this.state = STATES.IDLE;
            this.previousState = null;
            this.stateLockUntil = 0; // Timestamp when current prioritized animation lock expires

            // Dedicated Dance & Blink Timers
            this.danceTimeout = null;
            this.blinkTimer = null;

            // Click Counting & Debounce
            this.clickCount = 0;
            this.clickTimer = null;
            this.clickWindowMs = 290;

            // Eye Tracking & RAF State
            this.targetPupilX = 0;
            this.targetPupilY = 0;
            this.currentPupilX = 0;
            this.currentPupilY = 0;
            this.targetHeadTilt = 0;
            this.currentHeadTilt = 0;
            this.rafId = null;
            this.isTrackingMouse = false;
            this.maxClampX = 4.2; // Visor pupil X clamp in px
            this.maxClampY = 3.0; // Visor pupil Y clamp in px

            // Timers Management
            this.timers = {
                idle: null,
                speech: null,
                stateReset: null,
                typingDebounce: null,
                thinkingCycle: null,
                dance: null,
                blink: null
            };

            // Thinking phrases rotation matching prompt
            this.thinkingPhrases = [
                "Let me think...",
                "Searching knowledge...",
                "Analyzing...",
                "Synthesizing ideas... 🧠",
                "Formulating answer... ✨",
                "Calculating options... 🤖",
                "Reviewing details... 📚",
                "Composing response... 📝"
            ];

            // Managed CSS classes for clean sanitation
            this.managedClasses = [
                "robot-idle",
                "robot-dancing",
                "robot-dance",
                "dance",
                "dancing",
                "robot-blinking",
                "robot-crying",
                "robot-goodbye",
                "robot-hiding",
                "robot-hidden",
                "robot-reappearing",
                "robot-done",
                "robot-error",
                "robot-hover",
                "robot-typing",
                "robot-thinking",
                "robot-excited",
                "robot-greeting",
                "robot-walking",
                "robot-waving",
                "robot-happy",
                "robot-double-blink",
                "robot-sparkle-active",
                "hidden-below",
                "emotion-thinking",
                "emotion-curious",
                "emotion-excited",
                "emotion-happy",
                "emotion-error",
                "emotion-listening",
                "idle",
                "thinking",
                "excited"
            ];

            this.init();
        }

        // ====================================================
        // 1. FSM & PRIORITY MANAGEMENT
        // ====================================================

        getPriority(stateName) {
            const raw = String(stateName).toUpperCase();
            return STATE_PRIORITY[raw] || 10;
        }

        setRobotState(stateName, options = {}) {
            return this.transitionTo(stateName, options);
        }

        canTransition(targetState, force = false) {
            if (force) return true;
            const now = Date.now();
            const currentPrio = this.getPriority(this.state);
            const targetPrio = this.getPriority(targetState);

            // Returning to IDLE is always allowed from any state
            if (targetState === STATES.IDLE) {
                return true;
            }

            // Starting / restarting DANCE is allowed unless hidden or goodbye
            if (targetState === STATES.DANCE) {
                return this.state !== STATES.HIDDEN && this.state !== STATES.GOODBYE;
            }

            // If hidden, only GREETING or showRobot() or direct click can bring it back
            if (this.state === STATES.HIDDEN && targetState !== STATES.GREETING && targetState !== STATES.IDLE) {
                return false;
            }

            // If in active goodbye wave, do not interrupt
            if (this.state === STATES.GOODBYE && targetState !== STATES.HIDDEN) {
                return false;
            }

            // If locked in an active animation, allow transition only if target is higher priority
            if (now < this.stateLockUntil) {
                return targetPrio > currentPrio;
            }

            return true;
        }

        transitionTo(targetState, options = {}) {
            const raw = String(targetState).toUpperCase();
            const mappedState = STATES[raw] || STATES.IDLE;

            const isForced = options.force === true || mappedState === STATES.IDLE;
            if (!isForced && !this.canTransition(mappedState)) {
                return false;
            }

            // Stop thinking phrases cycler if moving away from THINKING
            if (mappedState !== STATES.THINKING) {
                this.stopThinkingCycle();
            }

            // If transitioning away from DANCE, cancel dance timer and clear dance visuals
            if (this.state === STATES.DANCE && mappedState !== STATES.DANCE) {
                if (this.danceTimeout) {
                    clearTimeout(this.danceTimeout);
                    this.danceTimeout = null;
                }
                this.clearDanceVisuals();
            }

            // Clear state reset timer
            if (this.timers.stateReset) {
                clearTimeout(this.timers.stateReset);
                this.timers.stateReset = null;
            }

            this.previousState = this.state;
            this.state = mappedState;

            // Set duration lock if requested (never lock IDLE)
            const lockDuration = mappedState === STATES.IDLE ? 0 : (options.lockDuration || 0);
            this.stateLockUntil = lockDuration > 0 ? Date.now() + lockDuration : 0;

            // Clear all active classes
            this.clearActiveClasses();

            // Apply target state presentation
            this.applyStatePresentation(mappedState, options);

            console.log(`[NIVORA Robot ${new Date().toISOString()}] ${this.previousState} -> ${this.state}`);

            // Auto-revert to IDLE if duration specified
            if (options.duration && options.duration > 0 && mappedState !== STATES.HIDDEN && mappedState !== STATES.IDLE) {
                this.timers.stateReset = setTimeout(() => {
                    if (this.state === mappedState) {
                        this.stateLockUntil = 0;
                        this.transitionTo(STATES.IDLE, { force: true });
                    }
                }, options.duration);
            }

            return true;
        }

        applyStatePresentation(state, options = {}) {
            switch (state) {
                case STATES.DANCE:
                    this.robot.classList.add("robot-dancing", "robot-dance", "dance", "dancing", "robot-happy");
                    this.setMouthShape("happy");
                    this.showSpeech(options.message || "Yay! 🎉", 5000);
                    break;

                case STATES.CRY:
                    this.robot.classList.add("robot-crying");
                    this.setMouthShape("sad");
                    this.showSpeech(options.message || "Aww... 🥺", 3000);
                    break;

                case STATES.GOODBYE:
                    this.robot.classList.add("robot-goodbye", "robot-waving", "robot-happy");
                    this.setMouthShape("happy");
                    this.showSpeech(options.message || "Bye! 👋", 2400);
                    break;

                case STATES.HIDDEN:
                    this.robot.classList.add("robot-hidden", "hidden-below");
                    this.hideSpeech();
                    this.robot.setAttribute("aria-label", "NIVORA AI companion robot (hidden, click to summon back)");
                    this.robot.setAttribute("title", "Click to summon NIVORA back! 🤖");
                    break;

                case STATES.GREETING:
                    this.robot.classList.add("robot-reappearing", "robot-waving", "robot-happy");
                    this.setMouthShape("happy");
                    if (options.message) this.showSpeech(options.message, 2200);
                    break;

                case STATES.DONE:
                    this.robot.classList.add("robot-done", "robot-happy");
                    this.setMouthShape("happy");
                    this.showSpeech(options.message || "Done! ✓", 1600);
                    break;

                case STATES.ERROR:
                    this.robot.classList.add("robot-error");
                    this.setMouthShape("confused");
                    this.showSpeech(options.message || "Hmm... let's try again 🤔", 2500);
                    break;

                case STATES.THINKING:
                    this.robot.classList.add("robot-thinking", "emotion-thinking");
                    this.setMouthShape("thinking");
                    this.startThinkingCycle(options.message);
                    break;

                case STATES.EXCITED:
                    this.robot.classList.add("robot-excited", "robot-happy");
                    this.setMouthShape("excited");
                    if (options.message) this.showSpeech(options.message, 1600);
                    break;

                case STATES.TYPING:
                    this.robot.classList.add("robot-typing", "emotion-curious");
                    this.setMouthShape("curious");
                    this.hideSpeech();
                    break;

                case STATES.HOVER:
                    this.robot.classList.add("robot-hover", "robot-waving");
                    this.setMouthShape("curious");
                    this.showSpeech(options.message || "Hi! 👋", 1500);
                    break;

                case STATES.IDLE:
                default:
                    this.robot.classList.add("robot-idle");
                    this.setMouthShape("idle");
                    this.robot.setAttribute("aria-label", "NIVORA AI companion robot");
                    this.robot.setAttribute("title", "NIVORA AI Companion – Click to interact!");
                    this.scheduleNextIdleAction();
                    break;
            }
        }

        clearActiveClasses() {
            this.managedClasses.forEach((cls) => {
                if (this.robot.classList.contains(cls)) {
                    this.robot.classList.remove(cls);
                }
            });
            this.robot.classList.remove("robot-dancing", "robot-dance", "dance", "dancing", "robot-blinking");
            this.robot.style.animation = "";
            const rootSvg = this.robot.querySelector(".robot-svg-root");
            if (rootSvg) rootSvg.style.animation = "";
        }

        // ====================================================
        // 2. EYE TRACKING (rAF & LERP TO VISOR BOUNDS)
        // ====================================================

        startEyeTrackingLoop() {
            if (this.rafId) return;

            const update = () => {
                // If robot is in states where eyes shouldn't follow cursor
                const skipEyeFollow = (
                    this.state === STATES.HIDDEN ||
                    this.state === STATES.CRY ||
                    this.state === STATES.GOODBYE ||
                    this.state === STATES.DANCE
                );

                if (skipEyeFollow) {
                    this.targetPupilX = 0;
                    this.targetPupilY = 0;
                    this.targetHeadTilt = 0;
                }

                // Smooth interpolation (lerp factor: 0.16)
                const factor = 0.16;
                this.currentPupilX += (this.targetPupilX - this.currentPupilX) * factor;
                this.currentPupilY += (this.targetPupilY - this.currentPupilY) * factor;
                this.currentHeadTilt += (this.targetHeadTilt - this.currentHeadTilt) * factor;

                // Apply to SVG elements
                if (this.leftPupil) {
                    this.leftPupil.style.transform = `translate(${this.currentPupilX.toFixed(2)}px, ${this.currentPupilY.toFixed(2)}px)`;
                }
                if (this.rightPupil) {
                    this.rightPupil.style.transform = `translate(${this.currentPupilX.toFixed(2)}px, ${this.currentPupilY.toFixed(2)}px)`;
                }

                if (this.headGroup && (this.state === STATES.IDLE || this.state === STATES.HOVER || this.state === STATES.TYPING)) {
                    this.headGroup.style.transform = `rotate(${this.currentHeadTilt.toFixed(2)}deg)`;
                }

                // Continue loop while active
                this.rafId = requestAnimationFrame(update);
            };

            this.rafId = requestAnimationFrame(update);
        }

        stopEyeTrackingLoop() {
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = null;
            }
        }

        onMouseMove(e) {
            if (!this.robot || this.state === STATES.HIDDEN) return;

            const rect = this.robot.getBoundingClientRect();
            if (!rect || rect.width === 0) return;

            const robotCenterX = rect.left + rect.width / 2;
            const robotCenterY = rect.top + rect.height / 2;

            const deltaX = e.clientX - robotCenterX;
            const deltaY = e.clientY - robotCenterY;

            // Clamp smoothly within visor bounds
            this.targetPupilX = Math.max(-this.maxClampX, Math.min(this.maxClampX, deltaX / 48));
            this.targetPupilY = Math.max(-this.maxClampY, Math.min(this.maxClampY, deltaY / 42));

            // Subtle head tilt toward cursor (-2.5 to +2.5 deg)
            this.targetHeadTilt = Math.max(-2.5, Math.min(2.5, deltaX / 110));

            // Ensure rAF loop is active
            if (!this.rafId) {
                this.startEyeTrackingLoop();
            }
        }

        onMouseLeaveWindow() {
            this.targetPupilX = 0;
            this.targetPupilY = 0;
            this.targetHeadTilt = 0;
        }

        // ====================================================
        // 3. CLICK DETECTION (SINGLE, DOUBLE, TRIPLE DEBOUNCED)
        // ====================================================

        handleClick(e) {
            if (e) {
                e.stopPropagation();
                e.preventDefault();
            }

            // If hidden, clicking it summons it back!
            if (this.state === STATES.HIDDEN) {
                this.showRobot();
                return;
            }

            this.clickCount++;

            // Triple click reached immediately
            if (this.clickCount >= 3) {
                if (this.clickTimer) {
                    clearTimeout(this.clickTimer);
                    this.clickTimer = null;
                }
                this.clickCount = 0;
                this.triggerTripleClick();
                return;
            }

            // Debounce window to distinguish single click from double click
            if (this.clickTimer) {
                clearTimeout(this.clickTimer);
                this.clickTimer = null;
            }

            this.clickTimer = setTimeout(() => {
                const finalCount = this.clickCount;
                this.clickCount = 0;
                this.clickTimer = null;

                if (finalCount === 1) {
                    this.triggerSingleClick();
                } else if (finalCount === 2) {
                    this.triggerDoubleClick();
                }
            }, this.clickWindowMs);
        }

        // 1. SINGLE MOUSE CLICK = HAPPY DANCE (EXACTLY 5 SECONDS)
        startDance() {
            // Cancel any previous dance timer first
            if (this.danceTimeout) {
                clearTimeout(this.danceTimeout);
                this.danceTimeout = null;
            }

            // Cancel any pending state reset
            if (this.timers.stateReset) {
                clearTimeout(this.timers.stateReset);
                this.timers.stateReset = null;
            }

            // Do not start dance if robot is hidden or waving goodbye
            if (this.state === STATES.HIDDEN || this.state === STATES.GOODBYE) {
                return;
            }

            // Priority check
            if (!this.canTransition(STATES.DANCE)) return;

            // Clear any lingering locks so dance takes over cleanly
            this.stateLockUntil = 0;

            // Transition to DANCE state (dedicated dance timer manages duration)
            this.setRobotState(STATES.DANCE, {
                lockDuration: 5000,
                duration: 0,
                message: "Yay! 🎉",
                force: true
            });

            // Ensure dance classes and expressions are active
            this.robot.classList.remove("robot-idle", "robot-crying", "robot-goodbye", "robot-hiding");
            this.robot.classList.add("robot-dancing", "robot-dance", "dance", "dancing", "robot-happy");

            // Dedicated dance timer: stop dance after EXACTLY 5 seconds (5000ms)
            this.danceTimeout = setTimeout(() => {
                this.stopDance();
                this.danceTimeout = null;
            }, 5000);

            // Mid-dance celebratory double blink at 2.2s
            setTimeout(() => {
                if (this.state === STATES.DANCE) {
                    this.triggerDoubleBlink();
                }
            }, 2200);
        }

        stopDance() {
            // 1. Cancel dedicated dance timer
            if (this.danceTimeout) {
                clearTimeout(this.danceTimeout);
                this.danceTimeout = null;
            }

            // 2. Clear state reset timer if any
            if (this.timers.stateReset) {
                clearTimeout(this.timers.stateReset);
                this.timers.stateReset = null;
            }

            // 3. Clear state lock so robot can smoothly transition to IDLE
            this.stateLockUntil = 0;

            // 4. Dynamically stop animation and remove dance classes
            this.clearDanceVisuals();

            // 5. Hide speech bubble
            this.hideSpeech();

            // 6. Smoothly return robot to IDLE (robot must NOT continue dancing, loop, or restart automatically)
            this.setRobotState(STATES.IDLE, { force: true });
            this.robot.classList.add("robot-idle");
            this.setMouthShape("idle");

            // 7. Reset pupil and head tilt targets
            this.targetPupilX = 0;
            this.targetPupilY = 0;
            this.targetHeadTilt = 0;
        }

        clearDanceVisuals() {
            // Remove all dance classes
            this.robot.classList.remove(
                "robot-dancing",
                "robot-dance",
                "dance",
                "dancing",
                "robot-happy"
            );

            // Dynamically stop CSS animation on robot root
            this.robot.style.animation = "none";
            const rootSvg = this.robot.querySelector(".robot-svg-root");
            if (rootSvg) rootSvg.style.animation = "none";

            const armL = this.robot.querySelector(".robot-arm-left");
            if (armL) armL.style.animation = "none";
            const armR = this.robot.querySelector(".robot-arm-right");
            if (armR) armR.style.animation = "none";
            const head = this.robot.querySelector(".robot-head-group");
            if (head) head.style.animation = "none";
            const antenna = this.robot.querySelector(".robot-antenna-group");
            if (antenna) antenna.style.animation = "none";
            const legL = this.robot.querySelector(".robot-leg-left");
            if (legL) legL.style.animation = "none";
            const legR = this.robot.querySelector(".robot-leg-right");
            if (legR) legR.style.animation = "none";

            const happyEyes = this.robot.querySelectorAll(".robot-eye-happy");
            happyEyes.forEach((el) => { el.style.display = "none"; });

            const normalEyes = this.robot.querySelectorAll(".robot-eye, .robot-pupil");
            normalEyes.forEach((el) => { el.style.display = ""; });

            const particles = this.robot.querySelector(".robot-dance-particles");
            if (particles) particles.style.display = "none";

            // Restore inline styles after animation frame so idle transitions work cleanly
            requestAnimationFrame(() => {
                if (this.state === STATES.IDLE) {
                    if (this.robot) this.robot.style.animation = "";
                    if (rootSvg) rootSvg.style.animation = "";
                    if (armL) armL.style.animation = "";
                    if (armR) armR.style.animation = "";
                    if (head) head.style.animation = "";
                    if (antenna) antenna.style.animation = "";
                    if (legL) legL.style.animation = "";
                    if (legR) legR.style.animation = "";
                    happyEyes.forEach((el) => { el.style.display = ""; });
                    if (particles) particles.style.display = "";
                }
            });
        }

        triggerSingleClick() {
            this.startDance();
        }

        // 2. DOUBLE MOUSE CLICK = CRYING REACTION (~3.0s)
        triggerDoubleClick() {
            // Cancel any running dance immediately (CRY only, NO dance)
            if (this.danceTimeout) {
                clearTimeout(this.danceTimeout);
                this.danceTimeout = null;
            }
            this.stateLockUntil = 0;
            this.clearDanceVisuals();

            this.setRobotState(STATES.CRY, {
                lockDuration: 3000,
                duration: 3000,
                message: "Aww... 🥺",
                force: true
            });
        }

        // 3. TRIPLE MOUSE CLICK = HIDE / GOODBYE
        triggerTripleClick() {
            // Cancel any running dance immediately (GOODBYE + HIDE only, NO dance)
            if (this.danceTimeout) {
                clearTimeout(this.danceTimeout);
                this.danceTimeout = null;
            }
            this.clearAllTimers();
            this.stateLockUntil = 0;
            this.clearDanceVisuals();

            // Look directly at user and wave goodbye
            this.setRobotState(STATES.GOODBYE, {
                lockDuration: 1100,
                message: "Bye! 👋",
                force: true
            });

            // Wave hand 2 times
            setTimeout(() => {
                if (this.state !== STATES.GOODBYE) return;

                // Begin smooth hide transition behind search box (~1050ms)
                this.robot.classList.remove("robot-goodbye");
                this.robot.classList.add("robot-hiding");
                this.hideSpeech();

                setTimeout(() => {
                    this.robot.classList.remove("robot-hiding");
                    this.setRobotState(STATES.HIDDEN, { force: true });
                }, 1050);
            }, 950);
        }

        // ====================================================
        // 4. RETURN / REAPPEAR (showRobot)
        // ====================================================

        showRobot() {
            if (this.state !== STATES.HIDDEN) {
                // If not hidden, gently wake up to idle
                this.transitionTo(STATES.IDLE);
                return;
            }

            // Remove hidden styles and start peeking up
            this.clearAllTimers();
            this.clearActiveClasses();
            this.robot.classList.remove("robot-hidden", "hidden-below");
            this.robot.classList.add("robot-reappearing");

            // Look forward
            this.targetPupilX = 0;
            this.targetPupilY = 0;
            this.currentPupilX = 0;
            this.currentPupilY = 0;

            // Mid-peek blink as eyes clear the search box rim (~420ms)
            setTimeout(() => {
                this.triggerDoubleBlink();
            }, 420);

            // Reappear completes at ~1050ms: wave and return to IDLE
            setTimeout(() => {
                this.robot.classList.remove("robot-reappearing");
                this.transitionTo(STATES.GREETING, {
                    message: "I'm back! 🤖",
                    duration: 1400,
                    lockDuration: 1400
                });

                setTimeout(() => {
                    this.transitionTo(STATES.IDLE);
                }, 1450);
            }, 1050);
        }

        // ====================================================
        // 5. EXTERNAL CHAT EVENT HOOKS
        // ====================================================

        // After every assistant reply generates successfully
        onAssistantResponse() {
            if (this.state === STATES.HIDDEN || this.state === STATES.GOODBYE) return;
            this.transitionTo(STATES.DONE, {
                lockDuration: 1350,
                duration: 1350,
                message: "Done! ✓"
            });
        }

        // When request fails or error occurs
        onErrorResponse() {
            if (this.state === STATES.HIDDEN || this.state === STATES.GOODBYE) return;
            this.transitionTo(STATES.ERROR, {
                lockDuration: 2400,
                duration: 2400,
                message: "Hmm... let's try again 🤔"
            });
        }

        // When user types in message box
        onTyping() {
            if (this.state === STATES.HIDDEN || this.state === STATES.GOODBYE || this.state === STATES.CRY || this.state === STATES.DANCE) return;
            this.hideSpeech();

            // Look toward search / message input
            this.targetPupilX = 0;
            this.targetPupilY = 2.4;

            if (this.state !== STATES.TYPING) {
                this.transitionTo(STATES.TYPING);
            }

            // Tiny excited bounce occasionally while typing
            if (Math.random() < 0.28) {
                this.robot.classList.add("robot-bounce-tiny");
                setTimeout(() => {
                    this.robot.classList.remove("robot-bounce-tiny");
                }, 320);
            }

            if (this.timers.typingDebounce) clearTimeout(this.timers.typingDebounce);
            this.timers.typingDebounce = setTimeout(() => {
                if (this.state === STATES.TYPING) {
                    this.transitionTo(STATES.IDLE);
                }
            }, 1800);
        }

        // When user sends message
        onMessageSent() {
            if (this.state === STATES.HIDDEN || this.state === STATES.GOODBYE) return;
            this.transitionTo(STATES.EXCITED, {
                lockDuration: 1500,
                duration: 1500,
                message: "On it! ⚡"
            });
        }

        // When user hovers / mouses over robot
        onHover(e) {
            if (this.state === STATES.HIDDEN ||
                this.state === STATES.GOODBYE ||
                this.state === STATES.CRY ||
                this.state === STATES.DANCE ||
                this.state === STATES.DONE ||
                this.state === STATES.GREETING) return;

            if (this.state !== STATES.HOVER) {
                this.transitionTo(STATES.HOVER, {
                    message: "Hi! 👋",
                    duration: 1800
                });
            }

            if (e) {
                this.tiltHeadTowardsCursor(e);
            }
        }

        // Tilt robot head dynamically towards the cursor position during hover
        tiltHeadTowardsCursor(e) {
            if (!this.headGroup || this.state !== STATES.HOVER || !e) return;
            const rect = this.robot.getBoundingClientRect();
            if (!rect || !rect.width) return;
            const robotCenterX = rect.left + rect.width / 2;
            const deltaX = e.clientX - robotCenterX;
            // Clamp head tilt angle (-6.5deg to +6.5deg)
            const maxTilt = 6.5;
            const tiltDeg = Math.max(-maxTilt, Math.min(maxTilt, (deltaX / (rect.width / 2)) * maxTilt));
            this.headGroup.style.transform = `rotate(${tiltDeg.toFixed(2)}deg) translateY(-1px)`;
        }

        onHoverLeave() {
            if (this.state === STATES.HOVER) {
                if (this.headGroup) {
                    this.headGroup.style.transform = "rotate(0deg)";
                }
                this.transitionTo(STATES.IDLE);
            }
        }

        // ====================================================
        // 6. SPEECH BUBBLE & THINKING CYCLER
        // ====================================================

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

        startThinkingCycle(initialPhrase = null) {
            this.stopThinkingCycle();
            let lastIdx = -1;
            const pick = () => {
                let idx;
                do {
                    idx = Math.floor(Math.random() * this.thinkingPhrases.length);
                } while (this.thinkingPhrases.length > 1 && idx === lastIdx);
                lastIdx = idx;
                return this.thinkingPhrases[idx];
            };

            this.showSpeech(initialPhrase || pick(), 0);

            this.timers.thinkingCycle = setInterval(() => {
                if (this.state === STATES.THINKING) {
                    this.showSpeech(pick(), 0);
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

        // ====================================================
        // 7. MOUTH & VISOR EXPRESSIONS
        // ====================================================

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
                case "sad":
                    this.mouthEl.setAttribute("d", "M 70 71 Q 76 64 82 71");
                    this.mouthEl.setAttribute("stroke", "#38bdf8");
                    this.mouthEl.setAttribute("stroke-width", "2.0");
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
                case "confused":
                case "error":
                    this.mouthEl.setAttribute("d", "M 69 66 Q 73 69 77 66 Q 81 64 83 67");
                    this.mouthEl.setAttribute("stroke", "#f87171");
                    this.mouthEl.setAttribute("stroke-width", "1.8");
                    break;
                default:
                    this.mouthEl.setAttribute("d", "M 70 67 Q 76 68 82 67");
                    this.mouthEl.setAttribute("stroke", "#38bdf8");
                    this.mouthEl.setAttribute("stroke-width", "1.8");
                    break;
            }
        }

        triggerDoubleBlink(callback) {
            this.robot.classList.add("robot-double-blink");
            setTimeout(() => {
                this.robot.classList.remove("robot-double-blink");
                if (callback) callback();
            }, 600);
        }

        // ====================================================
        // 8. IDLE BEHAVIORS & INTRO
        // ====================================================

        scheduleNextIdleAction() {
            if (this.timers.idle) clearTimeout(this.timers.idle);

            const nextDelay = Math.random() * 4000 + 3500;
            this.timers.idle = setTimeout(() => {
                if (this.state === STATES.IDLE) {
                    this.performRandomIdleAction();
                }
                if (this.state !== STATES.HIDDEN && this.state !== STATES.GOODBYE) {
                    this.scheduleNextIdleAction();
                }
            }, nextDelay);
        }

        performRandomIdleAction() {
            if (this.state !== STATES.IDLE) return;

            const pick = Math.floor(Math.random() * 5);
            switch (pick) {
                case 0:
                case 1:
                    this.triggerDoubleBlink();
                    break;
                case 2:
                    // Look left briefly
                    this.targetPupilX = -3.2;
                    setTimeout(() => {
                        if (this.state === STATES.IDLE) this.targetPupilX = 0;
                    }, 1100);
                    break;
                case 3:
                    // Look right briefly
                    this.targetPupilX = 3.2;
                    setTimeout(() => {
                        if (this.state === STATES.IDLE) this.targetPupilX = 0;
                    }, 1100);
                    break;
                case 4:
                    // Subtle curious tilt
                    this.targetHeadTilt = 3.5;
                    setTimeout(() => {
                        if (this.state === STATES.IDLE) this.targetHeadTilt = 0;
                    }, 1400);
                    break;
            }
        }

        // Trigger 'GREETING' animation when the application finishes loading:
        // Robot walks into the chat area and waves 'Hi 👋'
        triggerGreetingAnimation(force = false) {
            if (this.greetingPlayed && !force) return;
            if (this.state === STATES.HIDDEN) return;

            this.greetingPlayed = true;
            this.clearAllTimers();

            // Transition to GREETING state
            this.transitionTo(STATES.GREETING, {
                lockDuration: 3600,
                duration: 3600
            });

            // Start off-screen/to the right of the chat area
            this.robot.style.transition = "none";
            this.robot.style.opacity = "0";
            this.robot.style.transform = "translateX(80px)";

            // Force browser reflow
            void this.robot.offsetWidth;

            setTimeout(() => {
                // Robot walks smoothly into the chat area
                this.robot.style.transition = "transform 1.6s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.4s ease";
                this.robot.style.opacity = "1";
                this.robot.style.transform = "translateX(0)";
                this.robot.classList.add("robot-walking");

                setTimeout(() => {
                    // Reached the chat area: stop walking and wave 'Hi 👋'
                    this.robot.classList.remove("robot-walking");
                    this.robot.classList.add("robot-waving");
                    this.setMouthShape("happy");
                    this.showSpeech("Hi 👋", 1800);

                    // Happy animated double-blink
                    this.triggerDoubleBlink(() => {
                        setTimeout(() => {
                            this.robot.classList.remove("robot-waving");
                            this.transitionTo(STATES.IDLE);
                        }, 1400);
                    });
                }, 1650);
            }, 120);
        }

        runCinematicIntro() {
            return this.triggerGreetingAnimation();
        }

        clearAllTimers() {
            this.stopThinkingCycle();
            if (this.danceTimeout) {
                clearTimeout(this.danceTimeout);
                this.danceTimeout = null;
            }
            if (this.clickTimer) {
                clearTimeout(this.clickTimer);
                this.clickTimer = null;
            }
            if (this.blinkTimer) {
                clearTimeout(this.blinkTimer);
                this.blinkTimer = null;
            }
            Object.keys(this.timers).forEach((key) => {
                if (this.timers[key]) {
                    clearTimeout(this.timers[key]);
                    this.timers[key] = null;
                }
            });
        }

        // Cleanup / unmount lifecycle method to cancel dedicated dance timer & event listeners
        unmount() {
            this.destroy();
        }

        destroy() {
            // Cancel dedicated dance timer
            if (this.danceTimeout) {
                clearTimeout(this.danceTimeout);
                this.danceTimeout = null;
            }

            // Cancel click timer & debouncers
            if (this.clickTimer) {
                clearTimeout(this.clickTimer);
                this.clickTimer = null;
            }

            // Cancel all other timers
            this.clearAllTimers();

            // Cancel rAF loop
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = null;
            }

            // Disconnect mutation observer
            if (this.messagesObserver) {
                this.messagesObserver.disconnect();
                this.messagesObserver = null;
            }

            // Clear visual animations
            this.clearDanceVisuals();

            // Remove bound listeners if present
            if (this._boundClick && this.robot) {
                this.robot.removeEventListener("click", this._boundClick);
                this._boundClick = null;
            }
            if (this._boundKeydown && this.robot) {
                this.robot.removeEventListener("keydown", this._boundKeydown);
                this._boundKeydown = null;
            }
            if (this._boundMouseEnter && this.robot) {
                this.robot.removeEventListener("mouseenter", this._boundMouseEnter);
                this._boundMouseEnter = null;
            }
            if (this._boundMouseOver && this.robot) {
                this.robot.removeEventListener("mouseover", this._boundMouseOver);
                this._boundMouseOver = null;
            }
            if (this._boundMouseMove && this.robot) {
                this.robot.removeEventListener("mousemove", this._boundMouseMove);
                this._boundMouseMove = null;
            }
            if (this._boundMouseLeave && this.robot) {
                this.robot.removeEventListener("mouseleave", this._boundMouseLeave);
                this._boundMouseLeave = null;
            }
            if (this._boundDocMouseMove) {
                document.removeEventListener("mousemove", this._boundDocMouseMove);
                this._boundDocMouseMove = null;
            }
            if (this._boundDocMouseLeave) {
                document.removeEventListener("mouseleave", this._boundDocMouseLeave);
                this._boundDocMouseLeave = null;
            }
            if (this._boundInputTyping && this.messageInput) {
                this.messageInput.removeEventListener("input", this._boundInputTyping);
                this.messageInput.removeEventListener("focus", this._boundInputTyping);
                this._boundInputTyping = null;
            }

            if (window.nivoraRobotController === this) {
                window.nivoraRobotController = null;
            }
        }

        // ====================================================
        // 9. EVENT LISTENERS INITIALIZATION
        // ====================================================

        init() {
            // Accessible attributes
            this.robot.setAttribute("role", "button");
            this.robot.setAttribute("tabindex", "0");
            this.robot.setAttribute("aria-label", "NIVORA AI companion robot");

            // Click / Tap listener with 1/2/3 debounce
            this._boundClick = (e) => this.handleClick(e);
            this._boundKeydown = (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    this.handleClick(e);
                }
            };
            this.robot.addEventListener("click", this._boundClick);
            this.robot.addEventListener("keydown", this._boundKeydown);

            // Hover / mouse-over interactions: trigger HOVER state, tilt head towards cursor, apply subtle bounce
            this._boundMouseEnter = (e) => this.onHover(e);
            this._boundMouseOver = (e) => this.onHover(e);
            this._boundMouseMove = (e) => {
                if (this.state === STATES.HOVER) {
                    this.tiltHeadTowardsCursor(e);
                }
            };
            this._boundMouseLeave = () => this.onHoverLeave();

            this.robot.addEventListener("mouseenter", this._boundMouseEnter);
            this.robot.addEventListener("mouseover", this._boundMouseOver);
            this.robot.addEventListener("mousemove", this._boundMouseMove);
            this.robot.addEventListener("mouseleave", this._boundMouseLeave);

            // Global mouse move for eye tracking
            this._boundDocMouseMove = (e) => this.onMouseMove(e);
            this._boundDocMouseLeave = () => this.onMouseLeaveWindow();
            document.addEventListener("mousemove", this._boundDocMouseMove, { passive: true });
            document.addEventListener("mouseleave", this._boundDocMouseLeave);

            // Input area typing detection
            if (this.messageInput) {
                this._boundInputTyping = () => this.onTyping();
                this.messageInput.addEventListener("input", this._boundInputTyping);
                this.messageInput.addEventListener("focus", this._boundInputTyping);
            }

            // Message container observer for assistant response
            if (this.messagesContainer && window.MutationObserver) {
                let wasThinking = false;
                this.messagesObserver = new MutationObserver(() => {
                    if (this.state === STATES.HIDDEN || this.state === STATES.GOODBYE) return;

                    const thinkingEl = this.messagesContainer.querySelector(".dynamic-typing-indicator, .thinking-pill, .typing-bubble");
                    const isThinkingNow = !!thinkingEl;

                    if (isThinkingNow && !wasThinking) {
                        wasThinking = true;
                        this.transitionTo(STATES.THINKING);
                    } else if (!isThinkingNow && wasThinking) {
                        wasThinking = false;
                        // Finished generating response!
                        this.onAssistantResponse();
                    }
                });
                this.messagesObserver.observe(this.messagesContainer, { childList: true, subtree: true });
            }

            // Start Eye Tracking via NivoraEyeTracker module if available, or fallback to internal rAF loop
            if (window.NivoraEyeTracker) {
                this.eyeTracker = window.nivoraEyeTrackerInstance || new window.NivoraEyeTracker(this.robot);
                window.nivoraEyeTrackerInstance = this.eyeTracker;
            } else {
                this.startEyeTrackingLoop();
            }

            // Trigger 'GREETING' animation when the application finishes loading
            const runGreetingOnLoad = () => {
                setTimeout(() => {
                    this.triggerGreetingAnimation();
                }, 280);
            };

            if (document.readyState === "complete") {
                runGreetingOnLoad();
            } else {
                window.addEventListener("load", runGreetingOnLoad, { once: true });
            }
        }
    }

    // Expose to window for global integration
    window.NivoraRobotCompanion = NivoraRobotCompanion;
    window.NivoraRobotController = NivoraRobotCompanion;

    // Auto-instantiate singleton companion on DOM ready if not already initialized
    function initNivoraRobotCompanion() {
        const robotEl = document.getElementById("nivoraRobot");
        if (robotEl && !window.nivoraRobotController) {
            window.nivoraRobotController = new NivoraRobotCompanion(robotEl);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initNivoraRobotCompanion);
    } else {
        initNivoraRobotCompanion();
    }
})();
