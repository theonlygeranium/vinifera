import { Capacitor } from "@capacitor/core";

export function nativeBarcodeScannerAvailable() {
  return Capacitor.isNativePlatform();
}

export async function scanFulfillmentBarcode() {
  if (!nativeBarcodeScannerAvailable()) {
    throw new Error("Barcode scanning is available only in the native app.");
  }
  const {
    CapacitorBarcodeScanner,
    CapacitorBarcodeScannerAndroidScanningLibrary,
    CapacitorBarcodeScannerCameraDirection,
    CapacitorBarcodeScannerScanOrientation,
    CapacitorBarcodeScannerTypeHint,
  } = await import("@capacitor/barcode-scanner");
  const result = await CapacitorBarcodeScanner.scanBarcode({
    hint: CapacitorBarcodeScannerTypeHint.ALL,
    cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
    scanOrientation: CapacitorBarcodeScannerScanOrientation.ADAPTIVE,
    scanInstructions:
      "Center the shipment or bottle barcode inside the camera frame.",
    scanButton: false,
    cancelButtonAccessibilityLabel: "Cancel barcode scan",
    torchButtonOnAccessibilityLabel: "Turn scanner light off",
    torchButtonOffAccessibilityLabel: "Turn scanner light on",
    android: {
      scanningLibrary: CapacitorBarcodeScannerAndroidScanningLibrary.MLKIT,
    },
  });
  const value = result.ScanResult.trim();
  if (!value) throw new Error("No barcode was captured.");
  return value;
}
