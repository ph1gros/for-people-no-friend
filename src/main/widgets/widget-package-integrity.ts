export interface WidgetPackageIntegrity {
  readonly version: string;
  readonly target: string;
  readonly sha256: string;
  readonly compressedBytes: number;
  readonly extractedBytes: number;
  readonly maxEntries: number;
}

// Application-owned trust anchors. No file, environment, IPC or remote hash may fill this table.
// Packages remain unavailable until their actual bytes have been reviewed and measured.
export const WIDGET_PACKAGE_INTEGRITY: Readonly<
  Record<string, Readonly<WidgetPackageIntegrity> | null>
> = Object.freeze({
  clock: Object.freeze({
    version: '1.0.0',
    target: 'clock',
    sha256: '4ab596b68bb1f725fd8f0ef7ddb47cf88bf212e0a9707e3548ff562d376b0762',
    compressedBytes: 490,
    extractedBytes: 675,
    maxEntries: 1,
  }),
});
