/**
 * NIVORA AI Companion - Eye Tracking Module
 * 
 * Smoothly interpolates pupils' positions based on cursor location
 * relative to the #nivoraRobot center using requestAnimationFrame (rAF).
 * Enforces strict clamping within visor boundary bounds.
 *
 * Can be used as a standalone ES module or via browser window global (window.NivoraEyeTracker).
 */

(function (root, factory) {
    if (typeof define === "function" && define.amd) {
        define([], factory);
    } else if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        const tracker = factory();
        root.NivoraEyeTracker = tracker;
        // Auto-initialize for #nivoraRobot if element is present in DOM
        if (typeof document !== "undefined") {
            const initTracker = () => {
                const robotEl = document.getElementById("nivoraRobot");
                if (robotEl && !root.nivoraEyeTrackerInstance) {
                    root.nivoraEyeTrackerInstance = new tracker(robotEl);
                }
            };
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", initTracker);
            } else {
                initTracker();
            }
        }
    }
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    class NivoraEyeTracker {
        /**
         * @param {HTMLElement|string} [target] - #nivoraRobot DOM element or selector
         * @param {Object} [options] - Configuration options
         */
        constructor(target, options = {}) {
            this.robot = typeof target === "string" 
                ? document.querySelector(target) 
                : (target || document.getElementById("nivoraRobot"));

            this.options = Object.assign({
                // Strict visor pupil clamping boundaries (in SVG px)
                clampX: 4.2,
                clampY: 3.0,
                // Cursor distance to pupil displacement sensitivity
                sensitivityX: 48,
                sensitivityY: 42,
                // Smooth interpolation (lerp) speed factor (0 = stationary, 1 = instant)
                lerpFactor: 0.16,
                // Subtle head tilt parameters
                enableHeadTilt: true,
                maxHeadTiltDeg: 2.5,
                headSensitivity: 110,
                headLerpFactor: 0.14,
                // Selectors for robot SVG sub-elements
                leftPupilSelector: ".robot-pupil-left",
                rightPupilSelector: ".robot-pupil-right",
                headGroupSelector: ".robot-head-group",
                visorSelector: ".robot-visor"
            }, options);

            // Sub-elements cache
            this.leftPupil = null;
            this.rightPupil = null;
            this.headGroup = null;
            this.visor = null;

            // Coordinates state
            this.targetPupilX = 0;
            this.targetPupilY = 0;
            this.currentPupilX = 0;
            this.currentPupilY = 0;

            this.targetHeadTilt = 0;
            this.currentHeadTilt = 0;

            // Animation & Event State
            this.rafId = null;
            this.isRunning = false;
            this.isPaused = false;
            this.cachedCenter = null;
            this.centerDirty = true;

            // Bound handlers for clean cleanup
            this._handleMouseMove = this.onMouseMove.bind(this);
            this._handleTouchMove = this.onTouchMove.bind(this);
            this._handleMouseLeave = this.onMouseLeave.bind(this);
            this._handleResizeOrScroll = this.invalidateCenter.bind(this);
            this._loop = this.updateFrame.bind(this);

            if (this.robot) {
                this.init();
            }
        }

        /**
         * Initialize element bindings, rAF loop, and pointer listeners
         */
        init() {
            if (!this.robot) return;

            this.leftPupil = this.robot.querySelector(this.options.leftPupilSelector);
            this.rightPupil = this.robot.querySelector(this.options.rightPupilSelector);
            this.headGroup = this.robot.querySelector(this.options.headGroupSelector);
            this.visor = this.robot.querySelector(this.options.visorSelector);

            // Pointer event listeners (passive for maximum 60/120 FPS scroll performance)
            document.addEventListener("mousemove", this._handleMouseMove, { passive: true });
            document.addEventListener("pointermove", this._handleMouseMove, { passive: true });
            document.addEventListener("touchmove", this._handleTouchMove, { passive: true });
            document.addEventListener("mouseleave", this._handleMouseLeave);
            window.addEventListener("blur", this._handleMouseLeave);

            // Center invalidation on window resize or scroll
            window.addEventListener("resize", this._handleResizeOrScroll, { passive: true });
            window.addEventListener("scroll", this._handleResizeOrScroll, { passive: true });

            // Start rAF interpolation loop
            this.startLoop();
        }

        /**
         * Re-compute robot's visual center on demand
         */
        invalidateCenter() {
            this.centerDirty = true;
        }

        getRobotCenter() {
            if (this.centerDirty || !this.cachedCenter) {
                if (!this.robot) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
                const rect = this.robot.getBoundingClientRect();
                this.cachedCenter = {
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2
                };
                this.centerDirty = false;
            }
            return this.cachedCenter;
        }

        /**
         * Calculate clamped pupil offsets from screen coordinates relative to robot center
         * @param {number} clientX
         * @param {number} clientY
         */
        updateTargetCoordinates(clientX, clientY) {
            if (this.isPaused) return;

            // In states where robot is crying, dancing, or hidden, eye tracking should not override
            if (this.robot.classList.contains("robot-hidden") ||
                this.robot.classList.contains("robot-crying") ||
                this.robot.classList.contains("robot-goodbye") ||
                this.robot.classList.contains("robot-dancing") ||
                this.robot.classList.contains("hidden-below")) {
                this.targetPupilX = 0;
                this.targetPupilY = 0;
                this.targetHeadTilt = 0;
                return;
            }

            const center = this.getRobotCenter();
            const deltaX = clientX - center.x;
            const deltaY = clientY - center.y;

            const clampX = this.options.clampX;
            const clampY = this.options.clampY;

            // Strict boundary clamping within visor bounds
            this.targetPupilX = Math.max(-clampX, Math.min(clampX, deltaX / this.options.sensitivityX));
            this.targetPupilY = Math.max(-clampY, Math.min(clampY, deltaY / this.options.sensitivityY));

            // Subtle head tilt
            if (this.options.enableHeadTilt) {
                const maxTilt = this.options.maxHeadTiltDeg;
                this.targetHeadTilt = Math.max(-maxTilt, Math.min(maxTilt, deltaX / this.options.headSensitivity));
            }
        }

        onMouseMove(e) {
            this.centerDirty = true;
            this.updateTargetCoordinates(e.clientX, e.clientY);
        }

        onTouchMove(e) {
            if (e.touches && e.touches.length > 0) {
                this.centerDirty = true;
                this.updateTargetCoordinates(e.touches[0].clientX, e.touches[0].clientY);
            }
        }

        onMouseLeave() {
            // Smoothly return eyes to neutral resting position when cursor departs
            this.targetPupilX = 0;
            this.targetPupilY = 0;
            this.targetHeadTilt = 0;
        }

        /**
         * Single step of requestAnimationFrame interpolation loop
         */
        updateFrame() {
            if (!this.isRunning) return;

            const lerpFactor = this.options.lerpFactor;
            const headLerpFactor = this.options.headLerpFactor;

            // Smooth linear interpolation (lerp) toward target positions
            this.currentPupilX += (this.targetPupilX - this.currentPupilX) * lerpFactor;
            this.currentPupilY += (this.targetPupilY - this.currentPupilY) * lerpFactor;
            this.currentHeadTilt += (this.targetHeadTilt - this.currentHeadTilt) * headLerpFactor;

            // Apply transforms to left and right pupils
            const pupilTransform = `translate(${this.currentPupilX.toFixed(2)}px, ${this.currentPupilY.toFixed(2)}px)`;
            if (this.leftPupil) {
                this.leftPupil.style.transform = pupilTransform;
            }
            if (this.rightPupil) {
                this.rightPupil.style.transform = pupilTransform;
            }

            // Apply subtle head rotation during neutral/idle/hover states
            if (this.headGroup && this.options.enableHeadTilt &&
                !this.robot.classList.contains("robot-crying") &&
                !this.robot.classList.contains("robot-dancing") &&
                !this.robot.classList.contains("robot-thinking") &&
                !this.robot.classList.contains("robot-goodbye")) {
                this.headGroup.style.transform = `rotate(${this.currentHeadTilt.toFixed(2)}deg)`;
            }

            this.rafId = requestAnimationFrame(this._loop);
        }

        /**
         * Start the rAF loop
         */
        startLoop() {
            if (this.isRunning) return;
            this.isRunning = true;
            this.rafId = requestAnimationFrame(this._loop);
        }

        /**
         * Stop the rAF loop
         */
        stopLoop() {
            this.isRunning = false;
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = null;
            }
        }

        /**
         * Direct programmatic command: Make robot gaze at specific screen coordinates
         * @param {number} x
         * @param {number} y
         */
        lookAt(x, y) {
            this.centerDirty = true;
            this.updateTargetCoordinates(x, y);
        }

        /**
         * Direct programmatic command: Make robot gaze at a DOM element (e.g. search box or send button)
         * @param {HTMLElement|string} el
         */
        lookAtElement(el) {
            const targetEl = typeof el === "string" ? document.querySelector(el) : el;
            if (!targetEl) return;
            const rect = targetEl.getBoundingClientRect();
            this.lookAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
        }

        /**
         * Recenter eyes immediately or smoothly
         * @param {boolean} [immediate=false]
         */
        recenter(immediate = false) {
            this.targetPupilX = 0;
            this.targetPupilY = 0;
            this.targetHeadTilt = 0;
            if (immediate) {
                this.currentPupilX = 0;
                this.currentPupilY = 0;
                this.currentHeadTilt = 0;
                if (this.leftPupil) this.leftPupil.style.transform = "translate(0px, 0px)";
                if (this.rightPupil) this.rightPupil.style.transform = "translate(0px, 0px)";
                if (this.headGroup) this.headGroup.style.transform = "rotate(0deg)";
            }
        }

        pause() {
            this.isPaused = true;
            this.recenter();
        }

        resume() {
            this.isPaused = false;
        }

        /**
         * Clean up listeners, cancel rAF, and reset transforms
         */
        destroy() {
            this.stopLoop();
            document.removeEventListener("mousemove", this._handleMouseMove);
            document.removeEventListener("pointermove", this._handleMouseMove);
            document.removeEventListener("touchmove", this._handleTouchMove);
            document.removeEventListener("mouseleave", this._handleMouseLeave);
            window.removeEventListener("blur", this._handleMouseLeave);
            window.removeEventListener("resize", this._handleResizeOrScroll);
            window.removeEventListener("scroll", this._handleResizeOrScroll);
            this.recenter(true);
        }
    }

    return NivoraEyeTracker;
});
