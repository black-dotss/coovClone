/**
 * Polyfills for browser/DOM APIs required by pdfjs-dist / pdf-parse in serverless
 * and edge runtimes (Cloudflare Workers, Vercel, Node.js without native canvas bindings).
 */

export class DOMMatrixPolyfill {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  m11 = 1;
  m12 = 0;
  m21 = 0;
  m22 = 1;
  m41 = 0;
  m42 = 0;

  constructor(init?: number[] | string | DOMMatrixPolyfill | Record<string, number>) {
    if (Array.isArray(init)) {
      if (init.length >= 6) {
        this.a = this.m11 = init[0] ?? 1;
        this.b = this.m12 = init[1] ?? 0;
        this.c = this.m21 = init[2] ?? 0;
        this.d = this.m22 = init[3] ?? 1;
        this.e = this.m41 = init[4] ?? 0;
        this.f = this.m42 = init[5] ?? 0;
      }
    } else if (init && typeof init === "object") {
      const o = init as Record<string, number>;
      this.a = this.m11 = o.a ?? o.m11 ?? 1;
      this.b = this.m12 = o.b ?? o.m12 ?? 0;
      this.c = this.m21 = o.c ?? o.m21 ?? 0;
      this.d = this.m22 = o.d ?? o.m22 ?? 1;
      this.e = this.m41 = o.e ?? o.m41 ?? 0;
      this.f = this.m42 = o.f ?? o.m42 ?? 0;
    }
  }

  translate(tx = 0, ty = 0): this {
    this.e += tx * this.a + ty * this.c;
    this.f += tx * this.b + ty * this.d;
    this.m41 = this.e;
    this.m42 = this.f;
    return this;
  }

  scale(sx = 1, sy = sx): this {
    this.a *= sx;
    this.b *= sx;
    this.c *= sy;
    this.d *= sy;
    this.m11 = this.a;
    this.m12 = this.b;
    this.m21 = this.c;
    this.m22 = this.d;
    return this;
  }

  preMultiplySelf(_other?: unknown): this {
    return this;
  }

  multiplySelf(_other?: unknown): this {
    return this;
  }

  invertSelf(): this {
    const det = this.a * this.d - this.b * this.c;
    if (det !== 0) {
      const a = this.d / det;
      const b = -this.b / det;
      const c = -this.c / det;
      const d = this.a / det;
      const e = (this.c * this.f - this.d * this.e) / det;
      const f = (this.b * this.e - this.a * this.f) / det;
      this.a = this.m11 = a;
      this.b = this.m12 = b;
      this.c = this.m21 = c;
      this.d = this.m22 = d;
      this.e = this.m41 = e;
      this.f = this.m42 = f;
    }
    return this;
  }

  getTransform(): this {
    return this;
  }
}

export class ImageDataPolyfill {
  width: number;
  height: number;
  data: Uint8ClampedArray;

  constructor(widthOrData: number | Uint8ClampedArray, heightOrWidth?: number, height?: number) {
    if (typeof widthOrData === "number") {
      this.width = widthOrData;
      this.height = heightOrWidth || 0;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = widthOrData;
      this.width = heightOrWidth || 0;
      this.height = height || Math.floor(this.data.length / (Math.max(1, this.width) * 4));
    }
  }
}

export class Path2DPolyfill {
  addPath(_path?: unknown, _transform?: unknown): void {}
  rect(_x?: number, _y?: number, _w?: number, _h?: number): void {}
  clip(_rule?: unknown): void {}
  moveTo(_x?: number, _y?: number): void {}
  lineTo(_x?: number, _y?: number): void {}
  closePath(): void {}
}

export function ensurePdfPolyfills(): void {
  const g = globalThis as Record<string, unknown>;
  if (!g.DOMMatrix) {
    g.DOMMatrix = DOMMatrixPolyfill;
  }
  if (!g.ImageData) {
    g.ImageData = ImageDataPolyfill;
  }
  if (!g.Path2D) {
    g.Path2D = Path2DPolyfill;
  }
}

/**
 * Ensures pdfjs-dist worker is available in memory to prevent filesystem lookup errors
 * in serverless runtimes (such as Vercel Lambda /var/task).
 */
export async function ensurePdfWorker(): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  if (!g.pdfjsWorker) {
    try {
      // @ts-expect-error pdfjs-dist worker mjs lacks bundled TypeScript declaration
      const workerModule = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
      g.pdfjsWorker = workerModule;
    } catch {
      try {
        // @ts-expect-error pdfjs-dist worker mjs lacks bundled TypeScript declaration
        const workerModule = await import("pdfjs-dist/build/pdf.worker.mjs");
        g.pdfjsWorker = workerModule;
      } catch {
        // Fallback if dynamic worker loading fails
      }
    }
  }
}

// Automatically ensure polyfills on module evaluation
ensurePdfPolyfills();

