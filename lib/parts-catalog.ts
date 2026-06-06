// Slim shared utilities. Scene state lives in lib/scene-store.ts.
// This module survives only for ROOM dimensions, currency formatting + types.

export type Currency = 'GHS' | 'USD' | 'NGN';

export type Cost = { amount: number; currency: Currency } | 'included' | 'existing';

export const ROOM = {
  /** width in meters (X axis) */
  width: 5.6,
  /** depth in meters (Z axis) */
  depth: 4.2,
  /** ceiling height in meters */
  height: 2.8,
};

const CURRENCY_SYMBOL: Record<Currency, string> = {
  GHS: '₵',
  USD: '$',
  NGN: '₦',
};

export function formatCost(c: Cost, displayCurrency: Currency = 'GHS'): string {
  if (c === 'existing') return '—';
  if (c === 'included') return 'incl.';
  const sym = CURRENCY_SYMBOL[displayCurrency];
  return `${sym} ${c.amount.toLocaleString()}`;
}

export function currencySymbol(c: Currency): string {
  return CURRENCY_SYMBOL[c];
}
