// Real products at their published dimensions — the "will it actually fit?"
// catalog. Static, deterministic data from manufacturer spec sheets (mm,
// W × D × H). No AI involved; if a size here is wrong it's a data bug, not a
// hallucination. Rendered through the existing parametric shapes.

import type { LibraryItem } from './scene-spec';

export const PRODUCT_PRESETS: LibraryItem[] = [
  // ── Sofas / seating ───────────────────────────────────────────────────────
  { label: 'IKEA KIVIK · 3-seat sofa', group: 'Real sizes', category: 'sofa', shape: 'sofa', dimMM: [2280, 950, 830] },
  { label: 'IKEA EKTORP · 3-seat sofa', group: 'Real sizes', category: 'sofa', shape: 'sofa', dimMM: [2180, 880, 880] },
  { label: 'IKEA KLIPPAN · 2-seat sofa', group: 'Real sizes', category: 'sofa', shape: 'sofa', dimMM: [1800, 880, 660] },
  { label: 'IKEA POÄNG · armchair', group: 'Real sizes', category: 'chair', shape: 'chair-armchair', dimMM: [680, 820, 1000] },
  { label: 'IKEA STRANDMON · wing chair', group: 'Real sizes', category: 'chair', shape: 'chair-armchair', dimMM: [820, 960, 1010] },

  // ── Storage ───────────────────────────────────────────────────────────────
  { label: 'IKEA PAX · wardrobe 100', group: 'Real sizes', category: 'wardrobe', shape: 'wardrobe', dimMM: [1000, 580, 2364] },
  { label: 'IKEA PAX · wardrobe 150', group: 'Real sizes', category: 'wardrobe', shape: 'wardrobe', dimMM: [1500, 580, 2364] },
  { label: 'IKEA PAX · wardrobe 200', group: 'Real sizes', category: 'wardrobe', shape: 'wardrobe', dimMM: [2000, 580, 2364] },
  { label: 'IKEA BILLY · bookcase', group: 'Real sizes', category: 'shelf', shape: 'bookshelf', dimMM: [800, 280, 2020] },
  { label: 'IKEA KALLAX · 2×2', group: 'Real sizes', category: 'shelf', shape: 'bookshelf', dimMM: [770, 390, 770] },
  { label: 'IKEA KALLAX · 4×4', group: 'Real sizes', category: 'shelf', shape: 'bookshelf', dimMM: [1470, 390, 1470] },
  { label: 'IKEA HEMNES · 8-drawer dresser', group: 'Real sizes', category: 'wardrobe', shape: 'wardrobe', dimMM: [1600, 500, 960] },
  { label: 'IKEA MALM · 6-drawer dresser', group: 'Real sizes', category: 'wardrobe', shape: 'wardrobe', dimMM: [1605, 480, 780] },

  // ── Tables / desks ────────────────────────────────────────────────────────
  { label: 'IKEA LACK · coffee table', group: 'Real sizes', category: 'table', shape: 'coffee-table', dimMM: [900, 550, 450] },
  { label: 'IKEA LACK · side table', group: 'Real sizes', category: 'table', shape: 'side-table', dimMM: [550, 550, 450] },
  { label: 'IKEA MICKE · desk', group: 'Real sizes', category: 'desk', shape: 'desk-standard', dimMM: [1050, 500, 750] },
  { label: 'IKEA BEKANT · desk 160', group: 'Real sizes', category: 'desk', shape: 'desk-standard', dimMM: [1600, 800, 730] },
  { label: 'IKEA EKEDALEN · dining table (6)', group: 'Real sizes', category: 'table', shape: 'coffee-table', dimMM: [1800, 900, 750] },

  // ── Beds (frame footprint incl. headboard) ───────────────────────────────
  { label: 'IKEA MALM · bed queen', group: 'Real sizes', category: 'bed', shape: 'bed-double', dimMM: [1700, 2130, 1000] },
  { label: 'IKEA MALM · bed king', group: 'Real sizes', category: 'bed', shape: 'bed-double', dimMM: [1960, 2130, 1000] },
  { label: 'Mattress · EU single 90×200', group: 'Real sizes', category: 'bed', shape: 'bed-single', dimMM: [900, 2000, 250] },
  { label: 'Mattress · EU double 140×200', group: 'Real sizes', category: 'bed', shape: 'bed-double', dimMM: [1400, 2000, 250] },
  { label: 'Mattress · US queen 60×80in', group: 'Real sizes', category: 'bed', shape: 'bed-double', dimMM: [1524, 2032, 250] },

  // ── Tech / appliances ─────────────────────────────────────────────────────
  { label: 'TV · 55in panel', group: 'Real sizes', category: 'tv', shape: 'tv', dimMM: [1232, 60, 710] },
  { label: 'TV · 65in panel', group: 'Real sizes', category: 'tv', shape: 'tv', dimMM: [1450, 60, 830] },
  { label: 'TV · 75in panel', group: 'Real sizes', category: 'tv', shape: 'tv', dimMM: [1672, 60, 957] },
  { label: 'Monitor · 27in', group: 'Real sizes', category: 'monitor', shape: 'monitor', dimMM: [615, 200, 460] },
  { label: 'Fridge · EU freestanding 60', group: 'Real sizes', category: 'fridge', shape: 'fridge', dimMM: [600, 650, 1860] },
  { label: 'Fridge · French door 36in', group: 'Real sizes', category: 'fridge', shape: 'fridge', dimMM: [910, 720, 1780] },
  { label: 'Washing machine · EU 60', group: 'Real sizes', category: 'other', shape: 'washing-machine', dimMM: [600, 600, 850] },

  // ── Doors / rugs ──────────────────────────────────────────────────────────
  { label: 'Door · 32in / 813mm', group: 'Real sizes', category: 'door', shape: 'door', dimMM: [813, 44, 2032] },
  { label: 'Door · 36in / 914mm', group: 'Real sizes', category: 'door', shape: 'door', dimMM: [914, 44, 2032] },
  { label: 'Rug · 5×8 ft', group: 'Real sizes', category: 'rug', shape: 'rug', dimMM: [1524, 2438, 10] },
  { label: 'Rug · 8×10 ft', group: 'Real sizes', category: 'rug', shape: 'rug', dimMM: [2438, 3048, 10] },
];
