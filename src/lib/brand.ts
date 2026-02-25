import receiptLogoUrl from "@/assets/themasters-logo.png";

export type BrandConfig = {
  name: string;
  shortName: string;
  receiptTitleLines: string[];
  supportLine?: string;
  receiptLogoUrl?: string;
  receiptLogoAlt?: string;
  receiptLogoMaxWidthPx?: number;
  receiptLogoMaxHeightPx?: number;
  receiptPoweredByLine?: string;
};

export const BRAND: BrandConfig = {
  name: "TheMasters POS",
  shortName: "TheMasters",
  receiptTitleLines: ["THEMASTERS", "POS"],
  supportLine: undefined,
  receiptLogoUrl,
  receiptLogoAlt: "TheMasters POS",
  receiptLogoMaxWidthPx: 150,
  receiptLogoMaxHeightPx: 40,
  receiptPoweredByLine: "POWERED BY THEMASTERS",
};
