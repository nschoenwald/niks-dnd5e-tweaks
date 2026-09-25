import { MODULE_ID, debug, log, isFeatureActive } from "../main.js";

/**
 * Enhanced UI for Automated Animations Teleport Preset:
 * - Floating screen banner with live distance readout, max range, item name, and [Cancel] button / [ESC] hotkey
 * - Ghost token preview on canvas snapped to grid under cursor:
 *   - Authentic Dynamic Token Ring representation (background disk, metallic double ring, outer glow)
 *   - Subject Scale Correction support (e.g. 2× sizing bursting over ring)
 *   - Directional mirroring and rotation preservation
 *   - Cyan glowing border and soft tint when valid destination
 *   - Red border with diagonal slash when out of range
 *   - Orange border with X indicator when blocked by collision
 * - Crosshair cursor on canvas
 * - Clean ESC / Cancel button cancellation that aborts targeting, detaches A-A's listener, and terminates the Sequencer effect
 * - Keeps camera position untouched
 * - Does not cancel on right-click (so right-click canvas panning remains functional)
 */

let activeSession = null;
let capturedAAListener = null;
let isInterceptingStage = false;
let originalAddListener = null;
let originalOn = null;
let isUpdatingGhost = false;
let lastMoveErrorLogged = false;
let pendingMoveRAF = null;

/**
 * Initializes the Autoanimations Teleport UI feature.
 */
export function initAutoanimationsTeleportUI() {
    // Only register hooks if Autoanimations is installed and active
    if (!game.modules.get("autoanimations")?.active) {
        debug("Autoanimations module not active, skipping Teleport UI enhancement.");
        return;
    }

    Hooks.on("aa.preDataSanitize", onAAPreDataSanitize);
    Hooks.on("aa.preAnimationStart", onAAPreAnimationStart);

    // Safeguard: if Sequencer ends the teleportation effect externally, clean up UI
    Hooks.on("endedSequencerEffect", (effect) => {
        if (effect?.data?.name === "teleportation" && activeSession) {
            cleanupSession(false);
        }
    });

    // Safeguard: clean up if the canvas tears down (e.g. scene change) or caster token is deleted
    Hooks.on("canvasTearDown", () => {
        if (activeSession) cleanupSession(true);
    });

    Hooks.on("deleteToken", (tokenDoc) => {
        if (activeSession && activeSession.sourceToken?.id === tokenDoc.id) {
            cleanupSession(true);
        }
    });

    debug("Initialized Autoanimations Teleport UI enhancement.");
}

/**
 * Hook: aa.preDataSanitize
 * Fires when Autoanimations is preparing an animation workflow.
 * We inspect whether this is a preset teleportation animation.
 */
function onAAPreDataSanitize(handler, data) {
    if (!isFeatureActive("enableAutoanimationsTeleportUI", "clientEnableAutoanimationsTeleportUI")) return;
    if (!handler || !data) return;

    const isTeleport = data.menu === "preset" && data.presetType === "teleportation";
    if (!isTeleport) return;

    const sourceToken = handler.sourceToken;
    if (!sourceToken || sourceToken.scene?.id !== canvas.scene?.id) return;

    // Only activate for the controlling player or GM
    if (!sourceToken.isOwner && !game.user.isGM) return;

    debug("Detected incoming Autoanimations Teleportation preset in preDataSanitize", handler, data);

    const range = data.data?.options?.range ?? data.options?.range ?? 30;
    const checkCollision = data.data?.options?.checkCollision ?? data.options?.checkCollision ?? false;
    const measureType = data.data?.options?.measureType ?? data.options?.measureType ?? "circle";
    const itemName = handler.itemName || handler.item?.name || "Teleport";

    startTeleportSession({
        sourceToken,
        item: handler.item,
        itemName,
        range,
        checkCollision,
        measureType
    });
}

/**
 * Hook: aa.preAnimationStart
 * Fires right before the animation starts, after sanitization.
 * Used as a fallback or to update range/collision from sanitized data if needed.
 */
function onAAPreAnimationStart(sanitizedData) {
    if (!activeSession) return;
    if (sanitizedData?.primary?.options) {
        const opts = sanitizedData.primary.options;
        if (opts.range !== undefined) activeSession.range = opts.range;
        if (opts.checkCollision !== undefined) activeSession.checkCollision = opts.checkCollision;
        if (opts.measureType !== undefined) activeSession.measureType = opts.measureType;
    }
}

/**
 * Sets up interception on canvas.app.stage to capture Autoanimations' anonymous pointerdown listener.
 * Ignores our own pointerdown handler so it only intercepts Autoanimations.
 */
function setupStageInterception(ownPointerDownHandler) {
    if (isInterceptingStage || !canvas.app?.stage) return;
    isInterceptingStage = true;
    capturedAAListener = null;

    originalAddListener = canvas.app.stage.addListener;
    originalOn = canvas.app.stage.on;

    const intercept = function(event, fn, context) {
        if (event === "pointerdown" && fn !== ownPointerDownHandler && !capturedAAListener) {
            capturedAAListener = fn;
            debug("Captured Autoanimations pointerdown listener on stage", fn);
            restoreStageInterception();
        }
        return originalAddListener.call(this, event, fn, context);
    };

    canvas.app.stage.addListener = intercept;
    canvas.app.stage.on = intercept;

    // Safety timeout: restore original after 5 seconds if not triggered
    setTimeout(restoreStageInterception, 5000);
}

/**
 * Restores original stage listener functions.
 */
function restoreStageInterception() {
    if (!isInterceptingStage) return;
    isInterceptingStage = false;
    if (originalAddListener && canvas.app?.stage) {
        canvas.app.stage.addListener = originalAddListener;
    }
    if (originalOn && canvas.app?.stage) {
        canvas.app.stage.on = originalOn;
    }
}

/**
 * Starts an enhanced teleport destination picking session.
 */
function startTeleportSession({ sourceToken, item, itemName, range, checkCollision, measureType }) {
    try {
        // Clean up any stale session
        if (activeSession) {
            cleanupSession(false);
        }

        const onPointerMoveBound = (event) => onPointerMove(event);
        const onPointerDownBound = (event) => onPointerDown(event);
        const onKeyDownBound = (event) => onKeyDown(event);

        setupStageInterception(onPointerDownBound);

        // 1. Create Floating HUD Banner
        const hud = createTeleportHud({ itemName, range });
        document.body.appendChild(hud);

        // 2. Create Ghost Token Preview
        const ghost = createGhostToken(sourceToken);
        if (ghost?.container) {
            if (canvas.controls) {
                canvas.controls.addChild(ghost.container);
            } else if (canvas.stage) {
                canvas.stage.addChild(ghost.container);
            }
        }

        // 3. Set crosshair cursor on canvas
        const canvasElement = canvas.app?.canvas ?? canvas.app?.view;
        if (canvasElement) {
            canvasElement.style.cursor = "crosshair";
        }
        document.body.classList.add("nd5t-teleport-active");

        // 4. Bind event handlers
        window.addEventListener("pointermove", onPointerMoveBound, { passive: true });
        canvas.app?.stage?.addListener("pointerdown", onPointerDownBound);
        window.addEventListener("keydown", onKeyDownBound, true);

        lastMoveErrorLogged = false;

        activeSession = {
            sourceToken,
            item,
            itemName,
            range,
            checkCollision,
            measureType,
            hud,
            ghost,
            onPointerMoveBound,
            onPointerDownBound,
            onKeyDownBound
        };

        // Initial update with current cursor position
        if (canvas.mousePosition) {
            updateGhostAndHud(canvas.mousePosition);
        }
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Failed to start Teleport UI session:", err);
        ui.notifications?.error(`Teleport UI Error: ${err.message}`);
        cleanupSession(false);
    }
}

/**
 * Creates the DOM element for the floating screen banner.
 */
function createTeleportHud({ itemName, range }) {
    const unit = canvas.scene?.grid?.units || "ft";
    const hud = document.createElement("div");
    hud.id = "nd5t-teleport-hud";
    hud.className = "nd5t-teleport-hud";

    hud.innerHTML = `
        <div class="nd5t-teleport-hud-content">
            <div class="nd5t-teleport-badge-icon" aria-hidden="true">
                <i class="fa-solid fa-person-walking-dashed-line-arrow-right"></i>
            </div>
            <div class="nd5t-teleport-info">
                <span class="nd5t-teleport-title">${escapeHTML(itemName)}</span>
                <span class="nd5t-teleport-subtitle">Choose destination (Max: ${range} ${unit})</span>
            </div>
            <div class="nd5t-teleport-divider" aria-hidden="true"></div>
            <div class="nd5t-teleport-status-badge in-range" id="nd5t-teleport-distance-badge">
                <i class="fa-solid fa-location-dot"></i>
                <span>0 / ${range} ${unit}</span>
            </div>
            <div class="nd5t-teleport-divider" aria-hidden="true"></div>
            <div class="nd5t-teleport-actions">
                <kbd class="nd5t-teleport-kbd" title="Press Escape to cancel">ESC</kbd>
                <button type="button" class="nd5t-teleport-cancel-btn" title="Cancel Teleport">
                    <i class="fa-solid fa-xmark"></i>
                    <span>Cancel</span>
                </button>
            </div>
        </div>
    `;

    const cancelBtn = hud.querySelector(".nd5t-teleport-cancel-btn");
    if (cancelBtn) {
        cancelBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            cancelTeleport();
        });
    }

    return hud;
}

/**
 * Helper to escape HTML characters in item names.
 */
function escapeHTML(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Helper to safely parse color strings or numbers into numeric integer for PIXI tinting.
 */
function parseHexColor(colorVal, fallback = 0xe69a28) {
    if (!colorVal) return fallback;
    try {
        if (typeof colorVal === "number") return colorVal;
        if (typeof foundry !== "undefined" && foundry.utils?.Color) {
            return foundry.utils.Color.from(colorVal).valueOf();
        }
        if (typeof Color !== "undefined") {
            return Color.from(colorVal).valueOf();
        }
        return parseInt(String(colorVal).replace("#", ""), 16) || fallback;
    } catch {
        return fallback;
    }
}

/**
 * Converts a Foundry little-endian color (BBGGRR) to a PIXI-compatible big-endian RRGGBB integer.
 * Foundry stores ring colors internally as 0xBBGGRR (R in LSB). PIXI tint expects 0xRRGGBB.
 */
function littleEndianToRGBTint(val) {
    const r = val & 0xFF;
    const g = (val >> 8) & 0xFF;
    const b = (val >> 16) & 0xFF;
    return (r << 16) | (g << 8) | b;
}

/**
 * Lightens a PIXI hex color (0xRRGGBB) by blending it toward white by `factor` (0=original, 1=white).
 * Used to tint ring sprites so the character's ring color is visible while metallic highlights
 * are preserved — darker ring colors need lightening so PIXI multiply-tint doesn't make them black.
 */
function lightenColorForTint(hexColor, factor = 0.35) {
    const r = (hexColor >> 16) & 0xFF;
    const g = (hexColor >> 8) & 0xFF;
    const b = hexColor & 0xFF;
    const nr = Math.round(r + (255 - r) * factor);
    const ng = Math.round(g + (255 - g) * factor);
    const nb = Math.round(b + (255 - b) * factor);
    return (nr << 16) | (ng << 8) | nb;
}

/**
 * Safely resolves the PIXI.Texture for a dynamic token ring frame or background asset.
 * Queries PIXI Assets cache, Pixi TextureCache, Foundry TextureLoader spritesheet cache,
 * and baseTexture frame slicing as reliable fallbacks.
 */
function getDynamicRingTexture(name) {
    if (!name) return null;

    // 1. Direct PIXI.Assets cache
    try {
        const tex = PIXI.Assets?.cache?.get?.(name);
        if (tex && tex.valid && tex !== PIXI.Texture.EMPTY) return tex;
    } catch { /* ignore */ }

    // 2. PIXI TextureCache
    try {
        const tex = PIXI.utils?.TextureCache?.[name];
        if (tex && tex.valid && tex !== PIXI.Texture.EMPTY) return tex;
    } catch { /* ignore */ }

    // 3. Foundry TextureLoader / canvas loader spritesheet cache
    try {
        const sheetPath = CONFIG.Token?.ring?.spritesheet;
        if (sheetPath) {
            const sheet = foundry.canvas?.TextureLoader?.loader?.getCache?.(sheetPath)
                || (typeof TextureLoader !== "undefined" ? TextureLoader.loader?.getCache?.(sheetPath) : null)
                || PIXI.Assets?.cache?.get?.(sheetPath);
            const tex = sheet?.textures?.[name];
            if (tex && tex.valid && tex !== PIXI.Texture.EMPTY) return tex;
        }
    } catch { /* ignore */ }

    // 4. BaseTexture frame slice fallback
    try {
        const ringClass = CONFIG.Token?.ring?.ringClass;
        const sheetPath = CONFIG.Token?.ring?.spritesheet;
        if (ringClass?.baseTexture?.valid && sheetPath) {
            const sheet = foundry.canvas?.TextureLoader?.loader?.getCache?.(sheetPath)
                || (typeof TextureLoader !== "undefined" ? TextureLoader.loader?.getCache?.(sheetPath) : null)
                || PIXI.Assets?.cache?.get?.(sheetPath);
            const frameData = sheet?.data?.frames?.[name]?.frame;
            if (frameData) {
                const rect = new PIXI.Rectangle(frameData.x, frameData.y, frameData.w, frameData.h);
                const sliced = new PIXI.Texture(ringClass.baseTexture, rect);
                if (sliced.valid) return sliced;
            }
        }
    } catch { /* ignore */ }

    console.warn(`Nik's DnD5e Tweaks | Teleport UI: could not resolve ring spritesheet texture "${name}" — using vector fallback.`);
    return null;
}

/**
 * Creates the PIXI Container representing the ghost token preview.
 * When Dynamic Token Rings are enabled, creates an authentic composite preview:
 * - Authentic Dynamic Token Ring background disc (textured or tinted)
 * - Subject artwork enlarged by Subject Scale Correction (e.g. 2× sizing) bursting over the ring
 * - Authentic metallic sculpted Dynamic Token Ring frame tinted with the token's ring color
 * - Directional mirroring and rotation preservation
 * - Target grid footprint indicator
 */
function createGhostToken(sourceToken) {
    if (!sourceToken) return null;

    try {
        const container = new PIXI.Container();
        container.zIndex = 1000;
        container.eventMode = "none";
        container.visible = false;

        const w = sourceToken.w || canvas.grid?.size || 100;
        const h = sourceToken.h || canvas.grid?.size || 100;
        const hasRing = !!(sourceToken.hasDynamicRing || sourceToken.document?.ring?.enabled);

        // Resolve Subject Scale Correction (e.g., 2 for 200% burst scale)
        let subjectScale = 1;
        if (sourceToken.document?.ring?.subject?.scale !== undefined) {
            subjectScale = Math.max(0.1, Number(sourceToken.document.ring.subject.scale) || 1);
        }

        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.min(w, h) / 2;

        let bkgSprite = null;
        let ringSprite = null;
        let bkgGraphics = null;
        let ringGraphics = null;
        let colorBandGraphics = null;

        let ringColor = 0xe69a28;
        let bkgColor = 0xffffff;

        // Spritesheet frames in Foundry include transparent VFX padding (~82.67% of frame is ring outer diameter).
        // Scaling by subjectScaleAdjustment (~1.21) compensates for this padding in grid fit mode.
        const ringScaleFactor = sourceToken.ring?.subjectScaleAdjustment
            || (CONFIG.Token?.ring?.ringClass?.getRingDataBySize?.(Math.min(sourceToken.document?.width ?? 1, sourceToken.document?.height ?? 1))?.subjectScaleAdjustment)
            || 1.21;

        // Spritesheet frames in Foundry include transparent VFX padding (~82.67% of frame is ring outer diameter).
        // Scaling by subjectScaleAdjustment (~1.21) makes the ring's outer rim match the token's 1x1 grid cell.
        const ringW = Math.round(w * ringScaleFactor);
        const ringH = Math.round(h * ringScaleFactor);

        if (hasRing) {
            const dynamicColors = sourceToken.getRingColors?.() || {};
            const ringConfig = sourceToken.document?.ring;
            const ringColorVal = dynamicColors.ring ?? ringConfig?.colors?.ring;
            const bkgColorVal = dynamicColors.background ?? ringConfig?.colors?.background;

            // Ring color: prefer explicit setting, fall back to spritesheet little-endian default (BBGGRR → RRGGBB).
            if (ringColorVal) {
                ringColor = parseHexColor(ringColorVal, 0xe69a28);
            } else if (sourceToken.ring?.ringColorLittleEndian !== undefined) {
                ringColor = littleEndianToRGBTint(sourceToken.ring.ringColorLittleEndian);
            }

            // Determine ring frame and background disc names
            let ringName = sourceToken.ring?.ringName;
            let bkgName = sourceToken.ring?.bkgName;
            if (!ringName) {
                const size = Math.min(sourceToken.document?.width ?? 1, sourceToken.document?.height ?? 1);
                const ringData = CONFIG.Token?.ring?.ringClass?.getRingDataBySize?.(size);
                ringName = ringData?.ringName;
                bkgName = ringData?.bkgName;
            }
            if (!ringName) {
                const size = Math.min(sourceToken.document?.width ?? 1, sourceToken.document?.height ?? 1);
                if (size <= 0.5) ringName = "token-ring-tiny";
                else if (size <= 1) ringName = "token-ring-med";
                else if (size <= 2) ringName = "token-ring-large-huge";
                else ringName = "token-ring-gargantuan";
                bkgName = `${ringName}-bkg`;
            }

            // Color band dimensions from token ring configuration
            const cb = sourceToken.ring?.colorBand || { startRadius: 0.6, endRadius: 0.721 };
            const rInner = cb.startRadius * (ringW / 2);
            const rOuter = cb.endRadius * (ringW / 2);
            const rMid = (rInner + rOuter) / 2;
            const bandThickness = Math.max(2, rOuter - rInner);

            // A. Background disc: ONLY render if background color is explicitly configured (non-null/truthy).
            // When null/unset, tokens have no background fill, preserving transparency around burst features.
            if (bkgColorVal) {
                bkgColor = parseHexColor(bkgColorVal, 0xffffff);
                bkgGraphics = new PIXI.Graphics();
                bkgGraphics.beginFill(bkgColor, 1.0);
                bkgGraphics.drawCircle(cx, cy, rInner);
                bkgGraphics.endFill();
                container.addChild(bkgGraphics);
            }

            // B. Ring frame: authentic sculpted metallic spritesheet frame.
            // Kept at tint 0xFFFFFF to preserve authentic bronze or steel metallic texture.
            const ringTex = getDynamicRingTexture(ringName);
            if (ringTex && ringTex.valid && ringTex !== PIXI.Texture.EMPTY) {
                ringSprite = new PIXI.Sprite(ringTex);
                ringSprite.anchor.set(0.5, 0.5);
                ringSprite.position.set(cx, cy);
                ringSprite.width = ringW;
                ringSprite.height = ringH;
                ringSprite.tint = 0xffffff;
                ringSprite.alpha = 1;
                container.addChild(ringSprite);
            } else {
                // Vector fallback when the spritesheet texture isn’t available
                ringGraphics = new PIXI.Graphics();
                const ringThickness = Math.max(3, Math.round(ringW * 0.12));
                ringGraphics.lineStyle(1.5, 0x111111, 0.85);
                ringGraphics.drawCircle(cx, cy, (ringW / 2) - 1);
                ringGraphics.lineStyle(ringThickness, ringColor, 0.95);
                ringGraphics.drawCircle(cx, cy, (ringW / 2) - 1 - (ringThickness / 2));
                container.addChild(ringGraphics);
            }

            // C. Color band: covers the spritesheet channel with the character's vibrant ring color.
            // Sits directly on top of the metallic ring frame, perfectly masking the default channel color (e.g. red).
            colorBandGraphics = new PIXI.Graphics();
            colorBandGraphics.lineStyle(bandThickness, ringColor, 1.0);
            colorBandGraphics.drawCircle(cx, cy, rMid);
            container.addChild(colorBandGraphics);
        }

        // 2. Resolve Subject Texture safely from active token mesh/texture
        let texture = null;
        if (sourceToken.mesh?.texture && sourceToken.mesh.texture !== PIXI.Texture.EMPTY && sourceToken.mesh.texture.valid) {
            texture = sourceToken.mesh.texture;
        } else if (sourceToken.texture && sourceToken.texture !== PIXI.Texture.EMPTY && sourceToken.texture.valid) {
            texture = sourceToken.texture;
        } else if (sourceToken.document?.ring?.subject?.texture) {
            try {
                texture = foundry.canvas?.getTexture?.(sourceToken.document.ring.subject.texture)
                    || PIXI.Texture.from(sourceToken.document.ring.subject.texture);
            } catch {
                texture = null;
            }
        } else if (sourceToken.document?.texture?.src) {
            try {
                texture = foundry.canvas?.getTexture?.(sourceToken.document.texture.src)
                    || PIXI.Texture.from(sourceToken.document.texture.src);
            } catch {
                texture = null;
            }
        }

        let sprite = null;
        if (texture) {
            // Directional mirroring (scaleX/scaleY < 0)
            const mirrorX = (sourceToken.document?.texture?.scaleX ?? 1) < 0 ? -1 : 1;
            const mirrorY = (sourceToken.document?.texture?.scaleY ?? 1) < 0 ? -1 : 1;

            sprite = new PIXI.Sprite(texture);
            sprite.anchor.set(0.5, 0.5);
            sprite.position.set(cx, cy);

            const texW = texture.orig?.width || texture.width || 0;
            const texH = texture.orig?.height || texture.height || 0;

            if (Number.isFinite(texW) && texW > 0 && Number.isFinite(texH) && texH > 0) {
                const fitScale = hasRing
                    ? Math.min((w * ringScaleFactor * subjectScale) / texW, (h * ringScaleFactor * subjectScale) / texH)
                    : Math.min(w / texW, h / texH);
                const safeScale = (Number.isFinite(fitScale) && fitScale > 0) ? fitScale : 1;
                sprite.scale.set(safeScale * mirrorX, safeScale * mirrorY);
                sprite.visible = true;
            } else {
                // Texture might still be uploading; never assign sprite.width directly when dimensions are 0 (prevents Infinity/NaN crash)
                sprite.scale.set(1 * mirrorX, 1 * mirrorY);
                sprite.visible = false;
                const applyDimensions = () => {
                    if (sprite && !sprite.destroyed) {
                        const nw = texture.orig?.width || texture.width || 0;
                        const nh = texture.orig?.height || texture.height || 0;
                        if (Number.isFinite(nw) && nw > 0 && Number.isFinite(nh) && nh > 0) {
                            const fitScale = hasRing
                                ? Math.min((w * ringScaleFactor * subjectScale) / nw, (h * ringScaleFactor * subjectScale) / nh)
                                : Math.min(w / nw, h / nh);
                            const safeScale = (Number.isFinite(fitScale) && fitScale > 0) ? fitScale : 1;
                            sprite.scale.set(safeScale * mirrorX, safeScale * mirrorY);
                            sprite.visible = true;
                        }
                    }
                };
                if (texture.baseTexture?.valid) {
                    applyDimensions();
                } else {
                    texture.baseTexture?.once?.("loaded", applyDimensions);
                    texture.once?.("update", applyDimensions);
                }
            }
            sprite.alpha = sourceToken.document?.alpha ?? 1.0;

            // Match token facing angle if rotation is unlocked
            if (!sourceToken.document?.lockRotation && sourceToken.document?.rotation) {
                sprite.angle = sourceToken.document.rotation;
            }

            // Subject artwork renders on top of the metallic ring so horns/features burst out
            container.addChild(sprite);
        }

        // 3. Grid target footprint indicator & collision status
        const indicator = new PIXI.Graphics();
        container.addChild(indicator);

        return { container, sprite, indicator, bkgGraphics, bkgSprite, ringGraphics, ringSprite, colorBandGraphics, ringColor, bkgColor };
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Failed to create ghost token preview:", err);
        console.groupEnd();
        ui.notifications?.error(`Preview creation error: ${err.message}`);
        return null;
    }
}

/**
 * Pointer move event handler with requestAnimationFrame and error throttling.
 * Coalesces rapid mouse events to match the display refresh rate (e.g. 60Hz/144Hz).
 */
function onPointerMove() {
    if (!activeSession) return;
    if (pendingMoveRAF) return;

    pendingMoveRAF = requestAnimationFrame(() => {
        pendingMoveRAF = null;
        if (!activeSession || isUpdatingGhost) return;
        try {
            const mousePos = canvas.mousePosition;
            if (!mousePos) return;
            isUpdatingGhost = true;
            updateGhostAndHud(mousePos);
        } catch (err) {
            if (!lastMoveErrorLogged) {
                console.error("Nik's DnD5e Tweaks | Error updating teleport destination preview:", err);
                ui.notifications?.error(`Teleport Preview Error: ${err.message}`);
                lastMoveErrorLogged = true;
            }
        } finally {
            isUpdatingGhost = false;
        }
    });
}

/**
 * Updates ghost token position and visuals along with HUD distance badge.
 */
function updateGhostAndHud(mousePos) {
    if (!mousePos || !activeSession) return;

    const { sourceToken, range, checkCollision, ghost, hud } = activeSession;

    // Calculate snapped grid point matching Autoanimations logic
    const topLeft = canvas.grid.getTopLeftPoint(mousePos);
    if (!topLeft) return;

    // Grid-cell throttle: if cursor moves within the same grid cell, position, distance, and collision are identical
    if (activeSession.lastSnappedX === topLeft.x && activeSession.lastSnappedY === topLeft.y) {
        return;
    }
    activeSession.lastSnappedX = topLeft.x;
    activeSession.lastSnappedY = topLeft.y;

    if (ghost?.container) {
        ghost.container.visible = true;
        ghost.container.position.set(topLeft.x, topLeft.y);
    }

    // Measure distance using grid measurement with fallback
    let distance = 0;
    try {
        distance = canvas.grid.measurePath([sourceToken, topLeft], { gridSpaces: true }).distance;
    } catch {
        const dx = (topLeft.x - sourceToken.x) / (canvas.grid.size || 100);
        const dy = (topLeft.y - sourceToken.y) / (canvas.grid.size || 100);
        distance = Math.round(Math.hypot(dx, dy) * (canvas.scene?.grid?.distance || 5));
    }

    // Test collision against walls if enabled in A-A options
    let isBlocked = false;
    if (checkCollision && typeof sourceToken.checkCollision === "function") {
        try {
            const pointerCenter = canvas.grid.getCenterPoint(mousePos);
            isBlocked = !!sourceToken.checkCollision(pointerCenter);
        } catch {
            isBlocked = false;
        }
    }

    const inRange = distance <= range;
    const isValid = inRange && !isBlocked;

    if (ghost) {
        updateGhostVisuals(ghost, { isValid, inRange, isBlocked, sourceToken });
    }

    if (hud) {
        updateHudVisuals(hud, { distance, range, isValid, inRange, isBlocked });
    }
}

/**
 * Draws PIXI graphics indicator on the ghost token preview.
 */
function updateGhostVisuals(ghost, { isValid, inRange, isBlocked, sourceToken }) {
    if (!ghost) return;
    const { sprite, indicator, bkgGraphics, ringGraphics, ringSprite, colorBandGraphics, ringColor, bkgColor } = ghost;
    if (!indicator) return;

    indicator.clear();
    const w = sourceToken.w || canvas.grid?.size || 100;
    const h = sourceToken.h || canvas.grid?.size || 100;

    if (isValid) {
        if (sprite) sprite.tint = 0xffffff;
        if (ringSprite) {
            ringSprite.tint = 0xffffff; // Preserves authentic bronze/steel metallic highlights
            ringSprite.alpha = 1;
        }
        if (colorBandGraphics) {
            colorBandGraphics.tint = 0xffffff;
            colorBandGraphics.alpha = 1;
        }
        if (ringGraphics) ringGraphics.alpha = 1;
        if (bkgGraphics) bkgGraphics.alpha = 1;

        // Arcane cyan glowing frame & soft fill
        indicator.lineStyle(3, 0x00ffee, 0.9);
        indicator.beginFill(0x00c8bb, 0.18);
        indicator.drawRoundedRect(0, 0, w, h, 6);
        indicator.endFill();
    } else if (!inRange) {
        if (sprite) sprite.tint = 0xff7777;
        if (ringSprite) {
            ringSprite.tint = 0xff8888;
            ringSprite.alpha = 0.8;
        }
        if (colorBandGraphics) {
            colorBandGraphics.tint = 0xff6666;
            colorBandGraphics.alpha = 0.8;
        }
        if (ringGraphics) ringGraphics.alpha = 0.6;
        if (bkgGraphics) bkgGraphics.alpha = 0.5;

        // Red out-of-range frame with diagonal slash
        indicator.lineStyle(3, 0xff3344, 0.9);
        indicator.beginFill(0xcc1122, 0.25);
        indicator.drawRoundedRect(0, 0, w, h, 6);
        indicator.endFill();

        indicator.lineStyle(2.5, 0xff3344, 0.85);
        indicator.moveTo(w * 0.2, h * 0.2);
        indicator.lineTo(w * 0.8, h * 0.8);
    } else if (isBlocked) {
        if (sprite) sprite.tint = 0xff9955;
        if (ringSprite) {
            ringSprite.tint = 0xffaa77;
            ringSprite.alpha = 0.8;
        }
        if (colorBandGraphics) {
            colorBandGraphics.tint = 0xff8844;
            colorBandGraphics.alpha = 0.8;
        }
        if (ringGraphics) ringGraphics.alpha = 0.6;
        if (bkgGraphics) bkgGraphics.alpha = 0.5;

        // Orange blocked frame with X mark
        indicator.lineStyle(3, 0xff6600, 0.9);
        indicator.beginFill(0xbb4400, 0.25);
        indicator.drawRoundedRect(0, 0, w, h, 6);
        indicator.endFill();

        indicator.lineStyle(2.5, 0xff6600, 0.85);
        indicator.moveTo(w * 0.25, h * 0.25);
        indicator.lineTo(w * 0.75, h * 0.75);
        indicator.moveTo(w * 0.75, h * 0.25);
        indicator.lineTo(w * 0.25, h * 0.75);
    }
}

/**
 * Updates distance badge content and styling on the floating HUD.
 */
function updateHudVisuals(hud, { distance, range, isValid, inRange, isBlocked }) {
    const badge = hud.querySelector("#nd5t-teleport-distance-badge");
    if (!badge) return;
    const unit = canvas.scene?.grid?.units || "ft";

    if (isValid) {
        badge.className = "nd5t-teleport-status-badge in-range";
        badge.innerHTML = `<i class="fa-solid fa-location-dot"></i><span>${distance} / ${range} ${unit}</span>`;
    } else if (!inRange) {
        badge.className = "nd5t-teleport-status-badge out-of-range";
        badge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i><span>${distance} / ${range} ${unit} (Out of Range)</span>`;
    } else if (isBlocked) {
        badge.className = "nd5t-teleport-status-badge blocked";
        badge.innerHTML = `<i class="fa-solid fa-ban"></i><span>Path Blocked</span>`;
    }
}

/**
 * Pointer down handler: detects when user left-clicks a valid destination.
 * Right-click is completely ignored so canvas panning works as normal.
 */
function onPointerDown(event) {
    if (!activeSession) return;
    const button = event.data?.button ?? event.button;
    // Only respond to left click (button 0)
    if (button !== 0) return;

    const mousePos = canvas.mousePosition;
    if (!mousePos) return;

    const { sourceToken, range, checkCollision } = activeSession;
    const topLeft = canvas.grid.getTopLeftPoint(mousePos);

    let distance = 0;
    try {
        distance = canvas.grid.measurePath([sourceToken, topLeft], { gridSpaces: true }).distance;
    } catch {
        const dx = (topLeft.x - sourceToken.x) / (canvas.grid.size || 100);
        const dy = (topLeft.y - sourceToken.y) / (canvas.grid.size || 100);
        distance = Math.round(Math.hypot(dx, dy) * (canvas.scene?.grid?.distance || 5));
    }

    let isBlocked = false;
    if (checkCollision && typeof sourceToken.checkCollision === "function") {
        try {
            const pointerCenter = canvas.grid.getCenterPoint(mousePos);
            isBlocked = !!sourceToken.checkCollision(pointerCenter);
        } catch {
            isBlocked = false;
        }
    }

    if (distance <= range && !isBlocked) {
        // Valid destination chosen: A-A's listener will move the token and play the sequence.
        // Clean up our UI elements immediately.
        debug("Valid teleport destination clicked; cleaning up UI for animation sequence.");
        cleanupSession(false);
    }
}

/**
 * Keydown handler: cancels targeting on Escape only.
 */
function onKeyDown(event) {
    if (!activeSession) return;
    if (event.key === "Escape" || event.code === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        cancelTeleport();
    }
}

/**
 * Cancels teleport targeting cleanly without altering character uses or moving token.
 */
export function cancelTeleport() {
    if (!activeSession) return;
    debug("Canceling teleport targeting session via ESC or Cancel button");

    // 1. Remove Autoanimations' listener from canvas.app.stage to disarm the click
    if (capturedAAListener && canvas.app?.stage) {
        try {
            canvas.app.stage.removeListener("pointerdown", capturedAAListener);
            debug("Removed Autoanimations listener from canvas stage");
        } catch (err) {
            console.warn("Nik's DnD5e Tweaks | Failed to remove A-A stage listener", err);
        }
        capturedAAListener = null;
    }

    // 2. End Sequencer border effect named "teleportation"
    if (typeof Sequencer !== "undefined" && Sequencer.EffectManager) {
        try {
            Sequencer.EffectManager.endEffects({ name: "teleportation" });
            debug("Ended Sequencer teleportation border effects");
        } catch (err) {
            console.warn("Nik's DnD5e Tweaks | Failed to end Sequencer teleportation effects", err);
        }
    }

    // 3. Clean up all UI elements
    cleanupSession(true);

    // 4. Display clean notification
    ui.notifications?.info("Teleport canceled.");
}

/**
 * Cleans up all UI elements, listeners, and resets canvas cursor.
 */
function cleanupSession(isCancel = false) {
    if (!activeSession) return;

    const { hud, ghost, onPointerMoveBound, onPointerDownBound, onKeyDownBound } = activeSession;

    // Fade out and remove HUD banner
    if (hud?.parentNode) {
        hud.classList.add("nd5t-teleport-fade-out");
        setTimeout(() => hud.remove(), 220);
    }

    // Destroy ghost token preview container safely
    if (ghost?.container) {
        try {
            if (ghost.container.parent) {
                ghost.container.parent.removeChild(ghost.container);
            }
            ghost.container.destroy({ children: true, texture: false, baseTexture: false });
        } catch (err) {
            console.warn("Nik's DnD5e Tweaks | Failed to destroy ghost token container", err);
        }
    }

    // Restore canvas cursor
    const canvasElement = canvas.app?.canvas ?? canvas.app?.view;
    if (canvasElement) {
        canvasElement.style.cursor = "";
    }
    document.body.classList.remove("nd5t-teleport-active");

    // Remove event listeners
    if (onPointerMoveBound) {
        window.removeEventListener("pointermove", onPointerMoveBound);
    }
    if (onPointerDownBound && canvas.app?.stage) {
        try {
            canvas.app.stage.removeListener("pointerdown", onPointerDownBound);
        } catch {}
    }
    if (onKeyDownBound) {
        window.removeEventListener("keydown", onKeyDownBound, true);
    }

    restoreStageInterception();
    if (pendingMoveRAF) {
        cancelAnimationFrame(pendingMoveRAF);
        pendingMoveRAF = null;
    }
    activeSession = null;
    isUpdatingGhost = false;
    lastMoveErrorLogged = false;
}
