# vendor

- `barcode.js`: a bundle of [barcode-detector](https://github.com/Sec-ant/barcode-detector) 3.2.2 (MIT), built with esbuild. It exposes `window.KaloriBarcodeDetector`.
- `zxing_reader.wasm`: from [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) 3.1.3 (MIT, based on zxing-cpp, Apache-2.0).

These files are used only when the browser has no built-in `BarcodeDetector` (for example on iPhone).
