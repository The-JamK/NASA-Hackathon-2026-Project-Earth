// The landing hero: one interactive Earth, three leader lines.
//
// The globe is the same globe.gl scene and Blue Marble texture the case page
// uses. Three callouts sit in fixed slots; each one has a real anchor on the
// surface, and its leader line is redrawn every frame from the callout edge to
// the projected anchor. Anchors that rotate past the limb fade out instead of
// drawing a line to the far side of the globe.

import Globe from "globe.gl";

const BASE_URL = import.meta.env.BASE_URL || "/";

// Real points in the bundle, spread across the initial view.
const ANCHORS = {
  name: { lat: 13.5116, lng: 2.1254 }, // Niamey, Niger
  about: { lat: 14.7167, lng: -17.4677 }, // Dakar, Senegal
  data: { lat: -33.9249, lng: 18.4241 }, // Cape Town, South Africa
};

const START_LAT = 8;
const START_LNG = 16;
// Lower altitude = larger globe on screen.
const altitudeFor = (width) => (width < 700 ? 2.05 : width < 1080 ? 1.82 : 1.62);
const SPEED_IDLE = 0.6; // ≈100 s per revolution
const SPEED_HOVER = 0.12;
const ACCENT = "#ff6b4a";

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
  const callouts = [...hero.querySelectorAll("[data-callout]")]
    .filter((element) => element.classList.contains("callout"))
    .map((element) => ({
      key: element.dataset.callout,
      element,
      line: hero.querySelector(`.hero-line[data-callout="${element.dataset.callout}"]`),
      dot: hero.querySelector(`.hero-dot[data-callout="${element.dataset.callout}"]`),
      anchor: ANCHORS[element.dataset.callout],
    }));

  const globe = new Globe(scene, { animateIn: false })
    .globeImageUrl(assetUrl("/textures/earth-blue-marble.jpg"))
    .bumpImageUrl(assetUrl("/textures/earth-topology.png"))
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

    // Phones and small laptops get a smaller sphere so the copy around it keeps its room.
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

  /* ------------------------------------------------------------ leader lines */

  let frameHandle = 0;
  let heroRect = hero.getBoundingClientRect();
  let sceneRect = scene.getBoundingClientRect();

  function measure() {
    heroRect = hero.getBoundingClientRect();
    sceneRect = scene.getBoundingClientRect();
  }

  function updateLines() {
    measure();
    const offsetX = sceneRect.left - heroRect.left;
    const offsetY = sceneRect.top - heroRect.top;
    const camera = globe.camera().position;
    const cameraLength = Math.hypot(camera.x, camera.y, camera.z) || 1;
    // Globe radius is 100 in scene units, so the horizon sits at 100 / |camera|.
    const horizon = 100 / cameraLength;

    for (const callout of callouts) {
      if (!callout.anchor || !callout.line || !callout.dot) continue;
      const { lat, lng } = callout.anchor;
      const point = globe.getScreenCoords(lat, lng, 0);
      const dotX = point.x + offsetX;
      const dotY = point.y + offsetY;

      // Surface normal against the camera direction: 100 is the limb at radius 100.
      const surface = globe.getCoords(lat, lng, 0);
      const facing =
        (surface.x * camera.x + surface.y * camera.y + surface.z * camera.z) /
        (cameraLength * 100);
      const visible = Math.max(0, Math.min(1, (facing - horizon) / Math.max(0.02, 0.5 - horizon)));

      const box = callout.element.getBoundingClientRect();
      const left = box.left - heroRect.left;
      const top = box.top - heroRect.top;
      const onRight = left > heroRect.width / 2;
      const anchorX = onRight ? left : left + box.width;
      const anchorY = top + Math.min(box.height * 0.5, 48);

      callout.line.setAttribute("d", `M${anchorX.toFixed(1)},${anchorY.toFixed(1)}L${dotX.toFixed(1)},${dotY.toFixed(1)}`);
      callout.line.style.opacity = visible.toFixed(3);
      callout.dot.setAttribute("cx", dotX.toFixed(1));
      callout.dot.setAttribute("cy", dotY.toFixed(1));
      callout.dot.style.opacity = (visible * 0.95).toFixed(3);
    }
  }

  function loop() {
    frameHandle = requestAnimationFrame(loop);
    updateLines();
  }

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

  // A hovered callout holds the globe steady so its dot is easy to read.
  for (const callout of callouts) {
    callout.element.addEventListener("pointerenter", () => setHover(true));
    callout.element.addEventListener("pointerleave", () => setHover(false));
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
    if (prefersReduced.matches) {
      controls.autoRotateSpeed = 0;
    } else {
      controls.autoRotateSpeed = hovering ? SPEED_HOVER : SPEED_IDLE;
    }
    updateLines();
  }

  const onMotionChange = () => applyMotion();
  if (prefersReduced.addEventListener) prefersReduced.addEventListener("change", onMotionChange);
  else prefersReduced.addListener(onMotionChange);

  function onVisibility() {
    if (document.hidden) {
      globe.pauseAnimation?.();
      if (frameHandle) cancelAnimationFrame(frameHandle);
      frameHandle = 0;
    } else {
      globe.resumeAnimation?.();
      if (!frameHandle) frameHandle = requestAnimationFrame(loop);
    }
  }

  document.addEventListener("visibilitychange", onVisibility);

  globe.onGlobeReady?.(() => {
    hero.classList.add("is-ready");
    updateLines();
    // One immediate redraw after layout settles, then hand over to the loop.
    setTimeout(updateLines, 260);
  });

  // If the texture never arrives, the copy must still be readable.
  const readyFallback = setTimeout(() => hero.classList.add("is-ready"), 2400);

  if (!document.hidden) frameHandle = requestAnimationFrame(loop);
  window.addEventListener("scroll", measure, { passive: true });

  /* ---------------------------------------------------------------- teardown */

  return function destroy() {
    clearTimeout(readyFallback);
    if (frameHandle) cancelAnimationFrame(frameHandle);
    frameHandle = 0;
    resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("scroll", measure);
    if (prefersReduced.removeEventListener) {
      prefersReduced.removeEventListener("change", onMotionChange);
    } else if (prefersReduced.removeListener) {
      prefersReduced.removeListener(onMotionChange);
    }
    globe._destructor?.();
  };
}
