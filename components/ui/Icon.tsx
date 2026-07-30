import type { CSSProperties } from 'react';
import {
  ArrowRight, ArrowLeft, ArrowUpRight, Check, X, Plus, Minus,
  Camera, Lock, Unlock, Grid3x3, Layers, Ruler, Settings, Sparkles, Box,
  Download, Share2, FileText, FileArchive, ChevronRight, ChevronLeft, ChevronDown, ChevronUp,
  Zap, Leaf, Crosshair, Sofa, Bed, Tv, Lamp, Table, Sprout, KeyRound,
  Eye, EyeOff, Info, BarChart3, ExternalLink, Pencil, Trash2, RefreshCw,
  Image, Play, Replace, Circle, Sun, Moon, Cloud, Compass, type LucideIcon,
} from 'lucide-react';

// Single icon surface for the whole app. Backed by Lucide (MIT, free) — a
// consistent rounded-stroke set that matches the warm, soft aesthetic. The
// `name` API is unchanged so call sites stay the same. Two glyphs stay custom:
// WhatsApp (Lucide dropped brand marks) and the snap-* placement cues (domain).
// Any unmapped name falls back to a neutral dot, so a button is NEVER empty.

export type IconName =
  | 'arrow-right' | 'arrow-left' | 'arrow-up-right'
  | 'check' | 'x' | 'plus' | 'minus'
  | 'camera' | 'lock' | 'unlock'
  | 'grid' | 'layers' | 'ruler'
  | 'settings' | 'sparkles' | 'cube'
  | 'download' | 'share' | 'whatsapp'
  | 'file' | 'zip'
  | 'chevron-right' | 'chevron-left' | 'chevron-down' | 'chevron-up'
  | 'zap' | 'leaf' | 'crosshair'
  | 'sofa' | 'bed' | 'tv' | 'lamp' | 'table' | 'plant'
  | 'key' | 'eye' | 'eye-off'
  | 'info' | 'chart' | 'external'
  | 'edit' | 'trash' | 'refresh'
  | 'image' | 'play'
  | 'sun' | 'moon' | 'cloud' | 'compass'
  | 'swap' | 'snap-wall' | 'snap-floor' | 'snap-surface';

const MAP: Record<Exclude<IconName, 'whatsapp' | 'snap-wall' | 'snap-floor' | 'snap-surface'>, LucideIcon> = {
  'arrow-right': ArrowRight, 'arrow-left': ArrowLeft, 'arrow-up-right': ArrowUpRight,
  check: Check, x: X, plus: Plus, minus: Minus,
  camera: Camera, lock: Lock, unlock: Unlock,
  grid: Grid3x3, layers: Layers, ruler: Ruler,
  settings: Settings, sparkles: Sparkles, cube: Box,
  download: Download, share: Share2,
  file: FileText, zip: FileArchive,
  'chevron-right': ChevronRight, 'chevron-left': ChevronLeft, 'chevron-down': ChevronDown, 'chevron-up': ChevronUp,
  zap: Zap, leaf: Leaf, crosshair: Crosshair,
  sofa: Sofa, bed: Bed, tv: Tv, lamp: Lamp, table: Table, plant: Sprout,
  key: KeyRound, eye: Eye, 'eye-off': EyeOff,
  info: Info, chart: BarChart3, external: ExternalLink,
  edit: Pencil, trash: Trash2, refresh: RefreshCw,
  image: Image, play: Play, swap: Replace,
  sun: Sun, moon: Moon, cloud: Cloud, compass: Compass,
};

type Props = { name: IconName; size?: number; color?: string; strokeWidth?: number; style?: CSSProperties };

export function Icon({ name, size = 16, color = 'currentColor', strokeWidth = 1.75, style }: Props) {
  // `display:block` + `flex-shrink:0` fixes two chronic glyph bugs at the source:
  // Lucide's inline SVG baseline (which sat icons slightly low next to text) and
  // icons getting squished in tight flex rows. Callers can still override.
  const base: CSSProperties = { display: 'block', flexShrink: 0, ...style };

  // Custom: WhatsApp brand mark (filled).
  if (name === 'whatsapp') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={base}>
        <path d="M17.5 14.4c-.3-.2-1.8-.9-2-1s-.5-.2-.7.1c-.2.3-.8 1-1 1.2-.2.2-.4.2-.7.1-.3-.2-1.3-.5-2.5-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6.2-.2.3-.4.5-.6.1-.2.2-.4.3-.6.1-.2 0-.4 0-.6-.1-.2-.7-1.7-.9-2.3-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.8 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.2-.3-.3-.6-.4zM12 2C6.5 2 2 6.5 2 12c0 1.9.5 3.7 1.4 5.2L2 22l4.9-1.4c1.5.8 3.2 1.2 5.1 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z" />
      </svg>
    );
  }
  // Custom: domain-specific placement cues (no good Lucide equivalent).
  if (name === 'snap-wall' || name === 'snap-floor' || name === 'snap-surface') {
    const common = {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none' as const,
      stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, style: base,
    };
    if (name === 'snap-wall') return <svg {...common}><path d="M5 4v16M21 12H10M13 8l-3 4 3 4" /></svg>;
    if (name === 'snap-floor') return <svg {...common}><path d="M12 3v10M8 11l4 4 4-4M4 20h16" /></svg>;
    return <svg {...common}><path d="M12 3v7M9 8l3 3 3-3M5 14h14" /></svg>;
  }

  const Cmp = MAP[name] ?? Circle;
  return <Cmp size={size} color={color} strokeWidth={strokeWidth} style={base} />;
}
