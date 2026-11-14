// The landing hero: one interactive Earth behind six bordered boxes.
//
// The globe is the same globe.gl scene and Blue Marble texture the case page
// uses. The copy sits in fixed boxes at z-index below the canvas, so the sphere
// passes in front of their inner edges and the text itself stays clear of it.

import Globe from "globe.gl";

const BASE_URL = import.meta.env.BASE_URL || "/";

const START_LAT = 8;
const START_LNG = 16;
// Lower altitude = larger globe on screen.
const altitudeFor = (width) => (width < 700 ? 2.05 : width < 1080 ? 1.82 : 1.44);
const SPEED_IDLE = 0.6; // ≈100 s per revolution
const SPEED_HOVER = 0.12;

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
  const dialog = document.getElementById("hero-dialog");
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
  controls.autoRotate = !prefersReduced.matches;
  controls.autoRotateSpeed = SPEED_IDLE;

  // Keep the fragment budget sane on high-density phones.
  if (globe.renderer) {
    globe.renderer().setPixelRatio?.(Math.min(window.devicePixelRatio || 1, 2));
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
    if (!prefersReduced.matches) {
      controls.autoRotateSpeed = on ? SPEED_HOVER : SPEED_IDLE;
    }
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

  /* --------------------------------------------------------------- dialog */

  function openDialog() {
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  hit.addEventListener("click", openDialog);

  if (dialog) {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.querySelector('[data-action="stay"]')?.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => hit.focus());
  }

  /* ------------------------------------------------------- motion + browser */

  function applyMotion() {
    controls.autoRotate = !prefersReduced.matches;
    controls.autoRotateSpeed = prefersReduced.matches ? 0 : hovering ? SPEED_HOVER : SPEED_IDLE;
  }

  const onMotionChange = () => applyMotion();
  if (prefersReduced.addEventListener) prefersReduced.addEventListener("change", onMotionChange);
  else prefersReduced.addListener(onMotionChange);

  function onVisibility() {
    if (document.hidden) globe.pauseAnimation?.();
    else globe.resumeAnimation?.();
  }

  document.addEventListener("visibilitychange", onVisibility);

  globe.onGlobeReady?.(() => {
    hero.classList.add("is-ready");
  });

  // If the texture never arrives, the copy must still be readable.
  const readyFallback = setTimeout(() => hero.classList.add("is-ready"), 2400);

  /* ---------------------------------------------------------------- teardown */

  return function destroy() {
    clearTimeout(readyFallback);
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
