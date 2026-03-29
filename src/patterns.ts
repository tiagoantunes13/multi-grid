export interface GradientPattern {
  type: 'gradient';
  direction: 'left-to-right' | 'right-to-left' | 'top-to-bottom' | 'bottom-to-top';
  min: number;
  max: number;
}

export interface UniformPattern {
  type: 'uniform';
  value: number;
}

export interface RadialPattern {
  type: 'radial';
  centerRow: number;
  centerCol: number;
  innerValue: number;
  outerValue: number;
}

export interface NoisePattern {
  type: 'noise';
  min: number;
  max: number;
}

export interface StripePattern {
  type: 'stripe';
  direction: 'horizontal' | 'vertical';
  stripeValue: number;
  backgroundValue: number;
  stripeWidth: number;
  spacing: number;
}

export interface RegionPattern {
  type: 'region';
  region: 'left' | 'right' | 'top' | 'bottom' | 'center' | 'corners' | 'edges';
  regionValue: number;
  backgroundValue: number;
}

export type RewardPattern =
  | GradientPattern
  | UniformPattern
  | RadialPattern
  | NoisePattern
  | StripePattern
  | RegionPattern;

function clamp(v: number): number {
  return Math.round(Math.max(0, Math.min(100, v)));
}

function generateGradient(p: GradientPattern, w: number, h: number): number[][] {
  const grid: number[][] = [];
  for (let i = 0; i < h; i++) {
    const row: number[] = [];
    for (let j = 0; j < w; j++) {
      let t: number;
      switch (p.direction) {
        case 'left-to-right': t = j / (w - 1); break;
        case 'right-to-left': t = 1 - j / (w - 1); break;
        case 'top-to-bottom': t = i / (h - 1); break;
        case 'bottom-to-top': t = 1 - i / (h - 1); break;
      }
      row.push(clamp(p.min + (p.max - p.min) * t));
    }
    grid.push(row);
  }
  return grid;
}

function generateUniform(p: UniformPattern, w: number, h: number): number[][] {
  const v = clamp(p.value);
  return Array(h).fill(0).map(() => Array(w).fill(v));
}

function generateRadial(p: RadialPattern, w: number, h: number): number[][] {
  const maxDist = Math.sqrt(h * h + w * w) / 2;
  const grid: number[][] = [];
  for (let i = 0; i < h; i++) {
    const row: number[] = [];
    for (let j = 0; j < w; j++) {
      const dist = Math.sqrt((i - p.centerRow) ** 2 + (j - p.centerCol) ** 2);
      const t = Math.min(1, dist / maxDist);
      row.push(clamp(p.innerValue + (p.outerValue - p.innerValue) * t));
    }
    grid.push(row);
  }
  return grid;
}

function generateNoise(p: NoisePattern, w: number, h: number): number[][] {
  const grid: number[][] = [];
  for (let i = 0; i < h; i++) {
    const row: number[] = [];
    for (let j = 0; j < w; j++) {
      row.push(clamp(p.min + Math.random() * (p.max - p.min)));
    }
    grid.push(row);
  }
  return grid;
}

function generateStripe(p: StripePattern, w: number, h: number): number[][] {
  const period = p.stripeWidth + p.spacing;
  const grid: number[][] = [];
  for (let i = 0; i < h; i++) {
    const row: number[] = [];
    for (let j = 0; j < w; j++) {
      const pos = p.direction === 'horizontal' ? i : j;
      const inStripe = (pos % period) < p.stripeWidth;
      row.push(clamp(inStripe ? p.stripeValue : p.backgroundValue));
    }
    grid.push(row);
  }
  return grid;
}

function generateRegion(p: RegionPattern, w: number, h: number): number[][] {
  const grid: number[][] = [];
  for (let i = 0; i < h; i++) {
    const row: number[] = [];
    for (let j = 0; j < w; j++) {
      let inRegion = false;
      switch (p.region) {
        case 'left': inRegion = j < w / 2; break;
        case 'right': inRegion = j >= w / 2; break;
        case 'top': inRegion = i < h / 2; break;
        case 'bottom': inRegion = i >= h / 2; break;
        case 'center': inRegion = i >= h / 4 && i < 3 * h / 4 && j >= w / 4 && j < 3 * w / 4; break;
        case 'corners': inRegion = (i < h / 4 || i >= 3 * h / 4) && (j < w / 4 || j >= 3 * w / 4); break;
        case 'edges': inRegion = i === 0 || i === h - 1 || j === 0 || j === w - 1; break;
      }
      row.push(clamp(inRegion ? p.regionValue : p.backgroundValue));
    }
    grid.push(row);
  }
  return grid;
}

export function generateFromPattern(pattern: RewardPattern, width: number, height: number): number[][] {
  switch (pattern.type) {
    case 'gradient': return generateGradient(pattern, width, height);
    case 'uniform': return generateUniform(pattern, width, height);
    case 'radial': return generateRadial(pattern, width, height);
    case 'noise': return generateNoise(pattern, width, height);
    case 'stripe': return generateStripe(pattern, width, height);
    case 'region': return generateRegion(pattern, width, height);
  }
}

const VALID_TYPES = ['gradient', 'uniform', 'radial', 'noise', 'stripe', 'region'];
const GRADIENT_DIRS = ['left-to-right', 'right-to-left', 'top-to-bottom', 'bottom-to-top'];
const STRIPE_DIRS = ['horizontal', 'vertical'];
const REGIONS = ['left', 'right', 'top', 'bottom', 'center', 'corners', 'edges'];

export function validatePattern(raw: unknown): RewardPattern | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (!VALID_TYPES.includes(p.type as string)) return null;

  switch (p.type) {
    case 'gradient':
      if (!GRADIENT_DIRS.includes(p.direction as string)) return null;
      if (typeof p.min !== 'number' || typeof p.max !== 'number') return null;
      return { type: 'gradient', direction: p.direction as GradientPattern['direction'], min: clamp(p.min), max: clamp(p.max) };

    case 'uniform':
      if (typeof p.value !== 'number') return null;
      return { type: 'uniform', value: clamp(p.value) };

    case 'radial':
      if (typeof p.centerRow !== 'number' || typeof p.centerCol !== 'number' ||
          typeof p.innerValue !== 'number' || typeof p.outerValue !== 'number') return null;
      return { type: 'radial', centerRow: p.centerRow, centerCol: p.centerCol, innerValue: clamp(p.innerValue), outerValue: clamp(p.outerValue) };

    case 'noise':
      if (typeof p.min !== 'number' || typeof p.max !== 'number') return null;
      return { type: 'noise', min: clamp(p.min), max: clamp(p.max) };

    case 'stripe':
      if (!STRIPE_DIRS.includes(p.direction as string)) return null;
      if (typeof p.stripeValue !== 'number' || typeof p.backgroundValue !== 'number' ||
          typeof p.stripeWidth !== 'number' || typeof p.spacing !== 'number') return null;
      return {
        type: 'stripe', direction: p.direction as StripePattern['direction'],
        stripeValue: clamp(p.stripeValue), backgroundValue: clamp(p.backgroundValue),
        stripeWidth: Math.max(1, Math.min(5, Math.round(p.stripeWidth))),
        spacing: Math.max(1, Math.min(10, Math.round(p.spacing))),
      };

    case 'region':
      if (!REGIONS.includes(p.region as string)) return null;
      if (typeof p.regionValue !== 'number' || typeof p.backgroundValue !== 'number') return null;
      return { type: 'region', region: p.region as RegionPattern['region'], regionValue: clamp(p.regionValue), backgroundValue: clamp(p.backgroundValue) };

    default:
      return null;
  }
}
