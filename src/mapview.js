// A small, offline 2D map for the map panel.
//
// The base image is the same NASA Blue Marble equirectangular texture the globe
// uses, cropped to the search area, so the panel behaves like a map application
// without a tile server or an API key. It is linked to the globe both ways: a
// station selected on the globe becomes the map's marker, and a click on the map
// resolves to the nearest record and moves the globe there.

const MIN_SPAN = 1.2;
const MAX_SPAN = 360;
const GRATICULE_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 45];

const COLORS = {
  accent: "#5fd3e0",
  text: "#e6edf3",
  dim: "#8b98a3",
  target: "#ffd166",
  nearest: "#ffffff",
  ocean: "#061019",
  grid: "rgba(174, 216, 255, 0.14)",
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function wrapLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function lonDelta(from, to) {
  return ((((to - from + 180) % 360) + 360) % 360) - 180;
}

// Google's documented Maps URLs scheme needs no API key and opens in a new tab.
export function googleMapsUrl(lat, lon) {
  const query = `${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export class MapView {
  constructor({ canvas, textureUrl, points = [], colorFor, onPick }) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext("2d") : null;
    this.points = points;
    this.colorFor = colorFor || (() => COLORS.accent);
    this.onPick = onPick || (() => {});
    this.view = { lat: 12, lon: 8, span: 120 };
    this.selected = null;
    this.target = null;
    this.nearest = null;
    this.cell = null;
    this.image = null;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.drag = null;
    if (!this.ctx) return;
    this.bind();
    this.load(textureUrl);
    if (typeof ResizeObserver === "function") {
      this.observer = new ResizeObserver(() => this.draw());
      this.observer.observe(canvas);
    }
    this.draw();
  }

  load(url) {
    if (!url) return;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      this.image = image;
      this.draw();
    };
    image.onerror = () => {
      this.image = null;
      this.draw();
    };
    image.src = url;
  }

  bind() {
    const canvas = this.canvas;
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const point = this.localPoint(event);
      this.drag = { ...point, moved: 0 };
      if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener("pointermove", (event) => {
      if (!this.drag) return;
      const point = this.localPoint(event);
      const dx = point.x - this.drag.x;
      const dy = point.y - this.drag.y;
      this.drag.x = point.x;
      this.drag.y = point.y;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      const degreesPerPixel = this.view.span / Math.max(1, this.width);
      this.view.lon = wrapLon(this.view.lon - dx * degreesPerPixel);
      this.view.lat = clamp(this.view.lat + dy * degreesPerPixel, -85, 85);
      this.draw();
    });

    const finish = (event) => {
      if (!this.drag) return;
      const moved = this.drag.moved;
      this.drag = null;
      if (event.type !== "pointerup" || moved >= 4) return;
      const point = this.localPoint(event);
      const { lat, lon } = this.latLonAt(point.x, point.y);
      this.onPick(lat, lon);
    };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", () => {
      this.drag = null;
    });

    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.zoomBy(event.deltaY > 0 ? 1.3 : 0.77);
      },
      { passive: false }
    );
    canvas.addEventListener("dblclick", (event) => {
      event.preventDefault();
      this.zoomBy(0.6);
    });
  }

  localPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  latLonAt(x, y) {
    const degreesPerPixel = this.view.span / Math.max(1, this.width);
    return {
      lat: clamp(this.view.lat - (y - this.height / 2) * degreesPerPixel, -90, 90),
      lon: wrapLon(this.view.lon + (x - this.width / 2) * degreesPerPixel),
    };
  }

  screenAt(lat, lon) {
    const degreesPerPixel = this.view.span / Math.max(1, this.width);
    return {
      x: this.width / 2 + lonDelta(this.view.lon, lon) / degreesPerPixel,
      y: this.height / 2 - (clamp(lat, -90, 90) - this.view.lat) / degreesPerPixel,
    };
  }

  setPoints(points) {
    this.points = points || [];
  }

  setSelected(point) {
    this.selected = point || null;
  }

  setTarget(target, nearest, cell) {
    this.target = target || null;
    this.nearest = nearest || null;
    this.cell = cell || null;
  }

  centerOn(lat, lon, span) {
    this.view.lat = clamp(lat, -85, 85);
    this.view.lon = wrapLon(lon);
    if (Number.isFinite(span)) this.view.span = clamp(span, MIN_SPAN, MAX_SPAN);
    this.draw();
  }

  zoomBy(factor) {
    this.view.span = clamp(this.view.span * factor, MIN_SPAN, MAX_SPAN);
    this.draw();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const backingWidth = Math.round(this.width * this.dpr);
    const backingHeight = Math.round(this.height * this.dpr);
    if (this.canvas.width !== backingWidth) this.canvas.width = backingWidth;
    if (this.canvas.height !== backingHeight) this.canvas.height = backingHeight;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  draw() {
    if (!this.ctx) return;
    this.resize();
    const { ctx, width, height } = this;
    if (!width || !height) return;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = COLORS.ocean;
    ctx.fillRect(0, 0, width, height);

    const degreesPerPixel = this.view.span / width;
    if (this.image) {
      const worldWidth = width * (360 / this.view.span);
      const worldHeight = worldWidth / 2;
      const originX = width / 2 - ((this.view.lon + 180) / 360) * worldWidth;
      const originY = height / 2 - ((90 - this.view.lat) / 180) * worldHeight;
      for (const offset of [-worldWidth, 0, worldWidth]) {
        ctx.drawImage(this.image, originX + offset, originY, worldWidth, worldHeight);
      }
    }

    // Keep the panel's dark instrument look over the photograph.
    ctx.fillStyle = "rgba(4, 9, 15, 0.28)";
    ctx.fillRect(0, 0, width, height);

    this.drawGraticule(degreesPerPixel);
    this.drawStations();
    this.drawLink();
    this.drawTarget();
    this.drawScale(degreesPerPixel);
  }

  drawGraticule(degreesPerPixel) {
    const { ctx, width, height } = this;
    const step =
      GRATICULE_STEPS.find((candidate) => this.view.span / candidate <= 7) ||
      GRATICULE_STEPS[GRATICULE_STEPS.length - 1];
    ctx.save();
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const topLeft = this.latLonAt(0, 0);
    const bottomRight = this.latLonAt(width, height);
    const firstLon = Math.ceil(topLeft.lon / step) * step;
    for (let lon = firstLon; lon <= bottomRight.lon + step; lon += step) {
      const { x } = this.screenAt(0, lon);
      if (x < -1 || x > width + 1) continue;
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, height);
    }
    const topLat = Math.min(90, topLeft.lat);
    const bottomLat = Math.max(-90, bottomRight.lat);
    const firstLat = Math.ceil(bottomLat / step) * step;
    for (let lat = firstLat; lat <= topLat + step; lat += step) {
      const { y } = this.screenAt(lat, 0);
      if (y < -1 || y > height + 1) continue;
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(width, Math.round(y) + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawStations() {
    const { ctx, width, height } = this;
    ctx.save();
    for (const point of this.points) {
      const { x, y } = this.screenAt(point.lat, point.lon);
      if (x < -8 || x > width + 8 || y < -8 || y > height + 8) continue;
      const isSelected = this.selected && this.selected.id === point.id;
      ctx.beginPath();
      ctx.arc(x, y, isSelected ? 4 : 2.4, 0, Math.PI * 2);
      ctx.fillStyle = this.colorFor(point);
      ctx.globalAlpha = isSelected ? 1 : 0.85;
      ctx.fill();
      if (isSelected) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, 6.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawLink() {
    const { ctx } = this;
    if (!this.target || !this.nearest?.point) return;
    const from = this.screenAt(this.target.lat, this.target.lon);
    const to = this.screenAt(this.nearest.point.lat, this.nearest.point.lon);
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = "rgba(255, 209, 102, 0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255, 209, 102, 0.9)";
    ctx.font = `600 8.5px ${this.fontStack()}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(this.distanceLabel(this.nearest.km), mid.x, mid.y - 2);
    ctx.restore();
  }

  drawTarget() {
    const { ctx } = this;
    const target = this.target;
    if (!target) return;
    const { x, y } = this.screenAt(target.lat, target.lon);
    ctx.save();
    ctx.strokeStyle = COLORS.target;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 10, y);
    ctx.lineTo(x - 3, y);
    ctx.moveTo(x + 3, y);
    ctx.lineTo(x + 10, y);
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x, y - 3);
    ctx.moveTo(x, y + 3);
    ctx.lineTo(x, y + 10);
    ctx.stroke();
    ctx.fillStyle = COLORS.target;
    ctx.beginPath();
    ctx.arc(x, y, 1.6, 0, Math.PI * 2);
    ctx.fill();
    this.label(target.label, x + 11, y - 8, COLORS.target);
    ctx.restore();

    if (this.cell?.cell && this.nearest?.point) {
      const cell = this.screenAt(this.cell.cell.lat, this.cell.cell.lon);
      ctx.save();
      ctx.strokeStyle = "rgba(95, 211, 224, 0.75)";
      ctx.lineWidth = 1;
      ctx.strokeRect(cell.x + 0.5, cell.y + 0.5, 6, 6);
      ctx.restore();
    }
  }

  label(text, x, y, color) {
    if (!text) return;
    const { ctx } = this;
    ctx.save();
    ctx.font = `600 9px ${this.fontStack()}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(3, 7, 12, 0.85)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  drawScale(degreesPerPixel) {
    const { ctx, width, height } = this;
    const kmPerDegree = 111.32 * Math.cos((this.view.lat * Math.PI) / 180);
    const kmPerPixel = Math.max(0.01, kmPerDegree * degreesPerPixel);
    const targetPixels = width * 0.28;
    const km = kmPerPixel * targetPixels;
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(km, 1)));
    const nice = [1, 2, 5, 10].map((step) => step * magnitude).find((value) => value >= km) || magnitude * 10;
    const length = nice / kmPerPixel;
    const x = width - length - 10;
    const y = height - 12;
    ctx.save();
    ctx.strokeStyle = "rgba(230, 237, 243, 0.75)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + length, y);
    ctx.moveTo(x, y - 3);
    ctx.lineTo(x, y + 3);
    ctx.moveTo(x + length, y - 3);
    ctx.lineTo(x + length, y + 3);
    ctx.stroke();
    ctx.fillStyle = "rgba(230, 237, 243, 0.85)";
    ctx.font = `600 8px ${this.fontStack()}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(this.distanceLabel(nice), x + length / 2, y - 3);
    ctx.restore();
  }

  distanceLabel(km) {
    if (!Number.isFinite(km)) return "";
    if (km < 1) return "< 1 km";
    if (km < 10) return `${km.toFixed(1)} km`;
    return `${Math.round(km).toLocaleString()} km`;
  }

  fontStack() {
    return "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  }
}
