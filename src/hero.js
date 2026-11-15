// The landing hero: one interactive Earth behind six bordered boxes.
//
// The globe is the same globe.gl scene and Blue Marble texture the case page
// uses. The copy sits in fixed boxes at z-index below the canvas, so the sphere
// passes in front of their inner edges and the text itself stays clear of it.

import Globe from "globe.gl";

const BASE_URL = import.meta.env.BASE_URL || "/";

// Open centred on Papua New Guinea, then let the planet turn under a fixed
// camera: the island sits on the disc's midline, with nothing leaning above it.
const START_LAT = -6.5;
const START_LNG = 145.0;
// Lower altitude = larger globe on screen.
const altitudeFor = (width) => (width < 700 ? 2.05 : width < 1080 ? 1.82 : 1.44);
// Earth stands upright here, no axial lean, and spins eastward once per 40 s.
const SPIN_IDLE = (2 * Math.PI) / 40;
const SPIN_HOVER = SPIN_IDLE / 5;
const CASE_URL = "./app.html";

function assetUrl(path) {
  if (!path) return "";
  if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith("data:")) return path;
  return `${BASE_URL}${path.replace(/^\/+/, "")}`;
}

export function initHero() {
  const hero = document.getElementById("hero");
  const scene = document.getElementById("hero-scene");
  const hit = document.getElementById("hero-globe");
  const cursor = document.getElementById("hero-cursor");
  if (!hero || !scene || !hit) return null;

  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  const globe = new Globe(scene, { animateIn: false })
    .globeImageUrl(assetUrl("/textures/earth-blue-marble.jpg"))
    .bumpImageUrl(assetUrl("/textures/earth-topology.jpg"))
    .backgroundColor("rgba(0, 0, 0, 0)")
    .showAtmosphere(true)
    .atmosphereColor("#8fb6c9")
    .atmosphereAltitude(0.1)
    .showGraticules(false)
    .pointOfView({ lat: START_LAT, lng: START_LNG, altitude: altitudeFor(window.innerWidth) }, 0);

  const controls = globe.controls();
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableRotate = false;
  controls.enableDamping = false;
  // OrbitControls orbits the camera about world up, which cannot carry the
  // axial tilt, so the surface itself does the turning.
  controls.autoRotate = false;

  // Keep the fragment budget sane on high-density phones.
  if (globe.renderer) {
    globe.renderer().setPixelRatio?.(Math.min(window.devicePixelRatio || 1, 2));
  }

  /* ----------------------------------------------------------- rotation */

  // The camera keeps the default upright up vector, so the pole is vertical on
  // screen, and the surface spins about that axis.
  const camera = globe.camera();
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);

  // three-globe assembles its globe group only once the texture arrives, so the
  // handle is resolved on first use rather than at init.
  let globeSurface = null;
  function surface() {
    if (!globeSurface) {
      globeSurface = globe.scene()?.getObjectByProperty?.("__globeObjType", "globe") || null;
    }
    return globeSurface;
  }

  let spinSpeed = SPIN_IDLE;
  let spinHandle = 0;
  let lastFrame = 0;

  function spinFrame(now) {
    spinHandle = requestAnimationFrame(spinFrame);
    if (!lastFrame) lastFrame = now;
    // Wall-clock delta, so a throttled tab still turns at one revolution per
    // SPIN seconds rather than slowing down with the frame rate.
    const delta = Math.min((now - lastFrame) / 1000, 2);
    lastFrame = now;
    // +Y turns the near face eastward, the direction Earth turns.
    const ball = surface();
    if (ball) ball.rotation.y += spinSpeed * delta;
  }

  function startSpin() {
    if (spinHandle || prefersReduced.matches || document.hidden) return;
    lastFrame = 0;
    spinHandle = requestAnimationFrame(spinFrame);
  }

  function stopSpin() {
    if (spinHandle) cancelAnimationFrame(spinHandle);
    spinHandle = 0;
    lastFrame = 0;
  }

  /* --------------------------------------------------------------- sizing */

  let width = 0;
  let height = 0;
  let altitudeTier = altitudeFor(window.innerWidth);

  function sizeScene() {
    const rect = scene.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    width = rect.width;
    height = rect.height;
    globe.width(width).height(height);

    // Phones and small laptops get a smaller sphere so the boxes keep their room.
    const nextTier = altitudeFor(window.innerWidth);
    if (nextTier !== altitudeTier) {
      altitudeTier = nextTier;
      const view = globe.pointOfView();
      globe.pointOfView({ lat: view.lat, lng: view.lng, altitude: nextTier }, 0);
    }
  }

  sizeScene();
  const resizeObserver = new ResizeObserver(sizeScene);
  resizeObserver.observe(scene);

  /* --------------------------------------------------------------- motion */

  let hovering = false;

  function setHover(on) {
    if (hovering === on) return;
    hovering = on;
    hero.classList.toggle("is-hovering", on);
    spinSpeed = on ? SPIN_HOVER : SPIN_IDLE;
    globe.atmosphereAltitude(on ? 0.17 : 0.1);
    if (!on && cursor) cursor.hidden = true;
  }

  hit.addEventListener("pointerenter", (event) => {
    setHover(true);
    moveCursor(event);
    if (event.pointerType === "touch") return;
    hit.style.cursor = "pointer";
  });

  hit.addEventListener("pointermove", moveCursor);

  hit.addEventListener("pointerleave", () => {
    setHover(false);
    hit.style.cursor = "";
  });

  function moveCursor(event) {
    if (!cursor || hovering === false) return;
    if (event.pointerType === "touch") return;
    cursor.hidden = false;
    cursor.style.transform = `translate(${Math.round(event.clientX + 16)}px, ${Math.round(
      event.clientY + 18
    )}px)`;
  }

  /* ---------------------------------------------------------- the case page */

  // A click, Enter or Space on the globe goes straight to the case analysis.
  hit.addEventListener("click", () => window.location.assign(CASE_URL));

  /* ------------------------------------------------------- motion + browser */

  function applyMotion() {
    spinSpeed = hovering ? SPIN_HOVER : SPIN_IDLE;
    if (prefersReduced.matches) stopSpin();
    else startSpin();
  }

  const onMotionChange = () => applyMotion();
  if (prefersReduced.addEventListener) prefersReduced.addEventListener("change", onMotionChange);
  else prefersReduced.addListener(onMotionChange);

  function onVisibility() {
    if (document.hidden) {
      globe.pauseAnimation?.();
      stopSpin();
    } else {
      globe.resumeAnimation?.();
      startSpin();
    }
  }

  document.addEventListener("visibilitychange", onVisibility);

  globe.onGlobeReady?.(() => {
    hero.classList.add("is-ready");
  });

  // If the texture never arrives, the copy must still be readable.
  const readyFallback = setTimeout(() => hero.classList.add("is-ready"), 2400);

  startSpin();

  /* ---------------------------------------------------------------- teardown */

  return function destroy() {
    clearTimeout(readyFallback);
    stopSpin();
    resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    if (prefersReduced.removeEventListener) {
      prefersReduced.removeEventListener("change", onMotionChange);
    } else if (prefersReduced.removeListener) {
      prefersReduced.removeListener(onMotionChange);
    }
    globe._destructor?.();
  };
}
