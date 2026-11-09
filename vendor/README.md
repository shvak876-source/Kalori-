# vendor

- `barcode.js`: a bundle of [barcode-detector](https://github.com/Sec-ant/barcode-detector) 3.2.2 (MIT), built with esbuild. It exposes `window.KaloriBarcodeDetector`.
- `zxing_reader.wasm`: from [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) 3.1.3 (MIT, based on zxing-cpp, Apache-2.0).

These files are used only when the browser has no built-in `BarcodeDetector` (for example on iPhone).
- `tesseract/`: [tesseract.js](https://github.com/naptha/tesseract.js) 5.1.1 (`tesseract.min.js`, `worker.min.js`) and [tesseract.js-core](https://github.com/naptha/tesseract.js-core) 5.1.1 (`tesseract-core-lstm.wasm.js`), both Apache-2.0. The `lang/` folder holds Hebrew and English data from [tessdata_best](https://github.com/tesseract-ocr/tessdata_best) (Apache-2.0, via @tesseract.js-data `4.0.0_best_int`). It's bundled here so label reading also works offline.
