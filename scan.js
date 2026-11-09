'use strict';
/* =========================================================
   סריקת תווית ערכים תזונתיים
   OCR in the browser (Tesseract.js, Hebrew + English) and a
   parser that turns the label text into numbers per 100 g.
   The engine (~5MB) is downloaded only on first scan.
   ========================================================= */
(function (root) {
  const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

  // Order matters: specific labels are checked before generic ones
  // ("מתוכן סוכרים" before "פחמימות", "שומן רווי" before "שומנים").
  const LABELS = [
    { k: 'satFat',  re: /רוו[יו]|saturat/i },
    { k: 'sugar',   re: /סוכר|sugar/i },
    { k: 'fiber',   re: /סיב[יו]|fib(er|re)/i },
    { k: 'sodium',  re: /נתר[ןו]|sodium/i },
    { k: 'protein', re: /חלבו[ןנ]|protein/i },
    { k: 'carbs',   re: /פחמי|carbo/i },
    { k: 'fat',     re: /שומ[ןנ]|(^|\s)fat/i },
    { k: 'kcal',    re: /אנרגי|קלורי|קק["״'׳]?ל|energy|kcal|calor/i },
  ];
  const SKIP = /טראנס|trans|כולסטרול|cholest|רכיבים|ingredient|עלול להכיל|may contain/i;
  const MAX = { kcal: 900, protein: 100, carbs: 100, sugar: 100, fat: 100, satFat: 100, fiber: 100, sodium: 40000 };

  function numbersIn(s) {
    // 3.6 / 3,6 / <0.5 / 0.5> — OCR sometimes turns "." into "," or "·"
    const out = [];
    const re = /(\d+(?:[.,·]\d+)?)/g;
    let m;
    while ((m = re.exec(s))) {
      out.push(parseFloat(m[1].replace(/[,·]/, '.')));
    }
    return out;
  }

  function parse(text) {
    const lines = String(text || '').split(/\n+/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const vals = {};
    const found = {};
    const basisMl = /100\s*(מ["״'׳]?ל|ml)/i.test(text);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (SKIP.test(line)) continue;
      if (line.split(' ').length > 9) continue; // long sentences are not table rows
      const hit = LABELS.find(L => L.re.test(line));
      if (!hit || found[hit.k]) continue;

      // numbers after removing "100 גרם"/"100 מ"ל" column headers
      const clean = line.replace(/(ל\s*[-–]?\s*)?100\s*(גר?ם|גר['׳]?|ג['׳]|מ["״'׳]?ל|ml|g)\b/gi, ' ');
      let nums = numbersIn(clean);
      if (!nums.length && lines[i + 1] && !LABELS.some(L => L.re.test(lines[i + 1]))) nums = numbersIn(lines[i + 1]);
      if (!nums.length) continue;

      let v;
      if (hit.k === 'kcal') {
        // label may show kJ next to kcal: pick the kcal value (kJ ≈ 4.18 × kcal)
        const pair = nums.find(a => nums.some(b => b > a && Math.abs(b / a - 4.184) < 0.15));
        v = pair != null ? pair : (/k?j|ג['׳]?אול/i.test(clean) && nums.length === 1 ? nums[0] / 4.184 : nums[0]);
      } else {
        v = nums.find(n => n <= MAX[hit.k]);
      }
      if (v == null || !(v <= MAX[hit.k])) continue;
      vals[hit.k] = Math.round(v * 10) / 10;
      found[hit.k] = true;
    }

    // sanity: part can't exceed whole (OCR often drops the decimal point)
    if (vals.sugar > vals.carbs && vals.sugar / 10 <= vals.carbs) vals.sugar = vals.sugar / 10;
    if (vals.satFat > vals.fat && vals.satFat / 10 <= vals.fat) vals.satFat = vals.satFat / 10;

    // calories missing but macros present → estimate
    let estimated = false;
    if (vals.kcal == null && vals.protein != null && vals.carbs != null && vals.fat != null) {
      vals.kcal = Math.round(4 * vals.protein + 4 * vals.carbs + 9 * vals.fat);
      estimated = true;
    }
    return { vals, found, estimated, basisMl };
  }

  /* does the label add up? 4/4/9 rule, generous tolerance */
  function consistent(v) {
    if (v.kcal == null || v.protein == null || v.carbs == null || v.fat == null) return true;
    const est = 4 * v.protein + 4 * v.carbs + 9 * v.fat + 2 * (v.fiber || 0);
    return Math.abs(est - v.kcal) <= Math.max(40, v.kcal * 0.25);
  }

  /* ---------- OCR ---------- */
  let workerP = null;
  let progressCb = null;

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('script'));
      document.head.appendChild(s);
    });
  }
  function getWorker() {
    if (!workerP) {
      workerP = (async () => {
        if (!root.Tesseract) await loadScript(TESS_URL);
        return root.Tesseract.createWorker(['heb', 'eng'], 1, {
          logger: m => progressCb && progressCb(m),
        });
      })().catch(e => { workerP = null; throw e; });
    }
    return workerP;
  }

  /* grayscale + contrast stretch, ~1800px on the long side */
  function prepare(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(2, 1800 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const d = ctx.getImageData(0, 0, c.width, c.height), p = d.data;
        let lo = 255, hi = 0;
        const g = new Uint8ClampedArray(p.length / 4);
        for (let i = 0, j = 0; i < p.length; i += 4, j++) {
          const v = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
          g[j] = v; if (v < lo) lo = v; if (v > hi) hi = v;
        }
        const span = Math.max(1, hi - lo);
        for (let i = 0, j = 0; i < p.length; i += 4, j++) {
          const v = ((g[j] - lo) / span) * 255;
          p[i] = p[i + 1] = p[i + 2] = v;
        }
        ctx.putImageData(d, 0, 0);
        URL.revokeObjectURL(url);
        res(c);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image')); };
      img.src = url;
    });
  }

  /* onProgress(fraction 0..1, phaseText) */
  async function scan(file, onProgress) {
    progressCb = m => {
      if (!onProgress) return;
      if (m.status === 'recognizing text') onProgress(0.3 + 0.7 * m.progress, 'קורא את התווית…');
      else if (/load|download|initializ/i.test(m.status)) onProgress(0.3 * (m.progress || 0), 'מכין את הסורק (רק בפעם הראשונה לוקח קצת)…');
    };
    onProgress && onProgress(0.02, 'מכין את הסורק…');
    const [worker, canvas] = await Promise.all([getWorker(), prepare(file)]);
    const { data } = await worker.recognize(canvas);
    progressCb = null;
    return Object.assign(parse(data.text), { text: data.text });
  }

  const api = { parse, consistent, scan };
  root.KaloriScan = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
