/** Single source of truth for product identity (IDE_DESIGN.md §0, D5). */
export const PRODUCT = {
  name: 'Tariro Studio',
  vendor: 'Omorfo Tech Labs',
  appId: 'zw.co.omorfotech.tariro-studio',
  projectExtension: '.tsp',
  projectFormat: 'tariro-studio',
  projectFormatVersion: 1,
} as const;

export type Product = typeof PRODUCT;
