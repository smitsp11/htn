"use client";

import { useEffect, useRef } from "react";

/**
 * Hero visual ported from the "Federanorth Hero" design: an aerial map rendered as a
 * Floyd–Steinberg-dithered dot matrix. A procedural scene (forest canopy, shadow,
 * agricultural strips, and a bundle of bezier roads) is sampled onto a dot grid, quantised
 * to a fixed 7-colour brand palette, then error-diffused and drawn as coloured dots. The
 * left/bottom margins dissolve into the espresso background so the copy column blends in.
 *
 * This replaces the earlier static `/federanorth-aerial.png`. The overlays (hairlines,
 * dashed sightlines, coral route squiggle, corner labels) sit above the canvas.
 */

// Tunables from the source design's prop defaults (Dot matrix section).
const CELL = 7; // dot pitch in px
const DISSOLVE = 0.26; // fraction of the grid that fades out at the left/bottom edges
const ROUND_DOTS = false; // false = circles, true = rounded squares

// Brand palette the scene is quantised to. Index 0 (espresso) is treated as the
// background and never drawn, so it reads as transparent over the dark hero.
const PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [33, 29, 23], // espresso shadow (background — not drawn)
  [30, 58, 42], // deep desaturated forest
  [14, 157, 99], // canopy accent
  [200, 88, 31], // rust
  [224, 138, 92], // coral
  [201, 176, 137], // warm tan
  [247, 245, 240], // cream
];

// --- value noise ---------------------------------------------------------------

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x: number, y: number, oct: number): number {
  let amp = 0.5;
  let f = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(x * f, y * f);
    norm += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return sum / norm;
}

// --- roads ---------------------------------------------------------------------

type Road = { pts: Array<[number, number]>; width: number };

function buildRoads(w: number, h: number): Road[] {
  const bez = (
    p: [number, number],
    q: [number, number],
    r: [number, number],
    s: [number, number],
    n: number
  ): Array<[number, number]> => {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const m = 1 - t;
      pts.push([
        m * m * m * p[0] + 3 * m * m * t * q[0] + 3 * m * t * t * r[0] + t * t * t * s[0],
        m * m * m * p[1] + 3 * m * m * t * q[1] + 3 * m * t * t * r[1] + t * t * t * s[1],
      ]);
    }
    return pts;
  };
  const P = (u: number, v: number): [number, number] => [u * w, v * h];
  return [
    // main highway, top-centre sweeping to bottom-right
    { pts: bez(P(0.4, -0.05), P(0.56, 0.28), P(0.62, 0.52), P(1.05, 0.8), 90), width: 0.03 },
    // second carriageway alongside
    { pts: bez(P(0.49, -0.05), P(0.64, 0.26), P(0.7, 0.5), P(1.08, 0.72), 90), width: 0.024 },
    // cross road entering from the left
    { pts: bez(P(-0.05, 0.36), P(0.28, 0.44), P(0.52, 0.58), P(1.05, 0.62), 90), width: 0.026 },
    // cloverleaf loop ramp (upper)
    { pts: bez(P(0.52, 0.1), P(0.86, 0.02), P(0.94, 0.34), P(0.68, 0.4), 90), width: 0.016 },
    // lower connector ramp
    { pts: bez(P(0.34, 0.44), P(0.44, 0.7), P(0.66, 0.74), P(0.86, 0.62), 90), width: 0.015 },
  ];
}

function roadDist(x: number, y: number, w: number, roads: Road[]): number {
  let best = 1e9;
  for (const road of roads) {
    const pts = road.pts;
    const hw = road.width * w * 0.5;
    let d = 1e9;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1][0];
      const ay = pts[i - 1][1];
      const bx = pts[i][0];
      const by = pts[i][1];
      const vx = bx - ax;
      const vy = by - ay;
      const len2 = vx * vx + vy * vy || 1;
      let t = ((x - ax) * vx + (y - ay) * vy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - (ax + t * vx);
      const dy = y - (ay + t * vy);
      const dd = Math.sqrt(dx * dx + dy * dy);
      if (dd < d) d = dd;
    }
    const signed = d - hw;
    if (signed < best) best = signed;
  }
  return best;
}

function sceneColor(
  x: number,
  y: number,
  w: number,
  h: number,
  roads: Road[]
): [number, number, number] {
  const u = x / w;
  const v = y / h;
  const n = fbm(u * 9, v * 9, 4);
  const coarse = fbm(u * 2.4 + 5, v * 2.4 + 5, 3);

  // forest canopy: deep desaturated green -> accent canopy highlight
  const t = Math.max(0, Math.min(1, (n - 0.18) / 0.5)) * (0.55 + 0.45 * coarse);
  let r = 27 + t * 4;
  let g = 56 + t * 92;
  let b = 40 + t * 52;

  // shadowed forest, mostly in the far left margin and the very bottom
  const shade = Math.max(0, (0.18 - u) / 0.18) * 0.5 + Math.max(0, (v - 0.86) / 0.14) * 0.35;
  r += (33 - r) * shade;
  g += (29 - g) * shade;
  b += (23 - b) * shade;

  // agricultural fields: patchy strips at the right edge and top-right corner
  const parcel = fbm(u * 3.2 + 20, v * 4.6 + 20, 2);
  const strip = Math.max(0, (u - 0.9) / 0.1) * (parcel > 0.5 ? 1 : 0.1);
  const corner =
    Math.max(0, (u - 0.84) / 0.16) * Math.max(0, (0.16 - v) / 0.16) * 1.4 * (parcel > 0.46 ? 1 : 0.15);
  const fm = Math.max(0, Math.min(1, Math.max(strip, corner))) * 0.78;
  const bright = parcel > 0.66 ? 0.8 : 0.1;
  const fr = 201 + bright * 40;
  const fg = 176 + bright * 55;
  const fb = 137 + bright * 85;
  r += (fr - r) * fm;
  g += (fg - g) * fm;
  b += (fb - b) * fm;

  // roads
  const d = roadDist(x, y, w, roads);
  if (d < 2.5) {
    const centre = Math.max(0, Math.min(1, (2.5 - d) / 2.5));
    r += (224 - r) * centre;
    g += (138 - g) * centre;
    b += (92 - b) * centre;
  } else if (d < 5.5) {
    const edge = (5.5 - d) / 3;
    r += (200 - r) * edge;
    g += (88 - g) * edge;
    b += (31 - b) * edge;
  }
  return [r, g, b];
}

function drawMap(canvas: HTMLCanvasElement): void {
  const host = canvas.parentElement;
  if (!host) return;
  const w = Math.round(host.clientWidth);
  const h = Math.round(host.clientHeight);
  if (!w || !h) return;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const roads = buildRoads(w, h);
  const cols = Math.ceil(w / CELL);
  const rows = Math.ceil(h / CELL);

  // Sample the scene into a float buffer (one RGB triple per dot).
  const buf = new Float32Array(cols * rows * 3);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const c = sceneColor(i * CELL + CELL / 2, j * CELL + CELL / 2, w, h, roads);
      const k = (j * cols + i) * 3;
      buf[k] = c[0];
      buf[k + 1] = c[1];
      buf[k + 2] = c[2];
    }
  }

  // Floyd–Steinberg error diffusion over the dot grid.
  const idx = new Uint8Array(cols * rows);
  const push = (i: number, j: number, er: number, eg: number, eb: number, f: number) => {
    if (i < 0 || i >= cols || j < 0 || j >= rows) return;
    const k = (j * cols + i) * 3;
    buf[k] += er * f;
    buf[k + 1] += eg * f;
    buf[k + 2] += eb * f;
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = (j * cols + i) * 3;
      const r = buf[k];
      const g = buf[k + 1];
      const b = buf[k + 2];
      let bi = 0;
      let bd = 1e12;
      for (let p = 0; p < PALETTE.length; p++) {
        const dr = r - PALETTE[p][0];
        const dg = g - PALETTE[p][1];
        const db = b - PALETTE[p][2];
        const dd = dr * dr * 0.9 + dg * dg * 1.2 + db * db * 0.7;
        if (dd < bd) {
          bd = dd;
          bi = p;
        }
      }
      idx[j * cols + i] = bi;
      const er = r - PALETTE[bi][0];
      const eg = g - PALETTE[bi][1];
      const eb = b - PALETTE[bi][2];
      push(i + 1, j, er, eg, eb, 7 / 16);
      push(i - 1, j + 1, er, eg, eb, 3 / 16);
      push(i, j + 1, er, eg, eb, 5 / 16);
      push(i + 1, j + 1, er, eg, eb, 1 / 16);
    }
  }

  // Paint the dots, dissolving the left and bottom margins into the background.
  const radius = CELL * 0.42;
  const fadeW = Math.max(1, cols * DISSOLVE);
  const fadeH = Math.max(1, rows * DISSOLVE * 0.7);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const p = idx[j * cols + i];
      if (p === 0) continue; // espresso dots are the background — leave them out
      let keep = Math.min(1, i / fadeW);
      keep = keep * keep * (3 - 2 * keep);
      let kb = Math.min(1, (rows - 1 - j) / fadeH);
      kb = kb * kb * (3 - 2 * kb);
      keep = Math.min(keep, kb);
      if (keep < 1) {
        const jitter = hash(i * 1.37, j * 2.11);
        const scatter = 0.18 * (vnoise(i * 0.25, j * 0.25) - 0.5);
        if (jitter > keep + scatter) continue;
      }
      const c = PALETTE[p];
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      const cx = i * CELL + CELL / 2;
      const cy = j * CELL + CELL / 2;
      if (ROUND_DOTS) {
        ctx.beginPath();
        ctx.roundRect(cx - radius, cy - radius, radius * 2, radius * 2, radius * 0.45);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

export function HeroMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let raf = 0;
    let cancelled = false;
    const render = () => {
      if (!cancelled) drawMap(canvas);
    };

    // The hero grid can size to zero on the first paint; retry until the host has a box.
    const retry = (n: number) => {
      if (cancelled) return;
      const host = canvas.parentElement;
      if (host && host.clientWidth && host.clientHeight) {
        render();
        return;
      }
      if (n > 120) return;
      raf = requestAnimationFrame(() => retry(n + 1));
    };

    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(render) : null;
    if (ro && canvas.parentElement) ro.observe(canvas.parentElement);

    retry(0);

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="hero-map-canvas" aria-hidden="true" />;
}
