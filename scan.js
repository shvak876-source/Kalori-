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

  /* ---------- AI scan (Google Gemini, free tier with the user's own key) ---------- */
  const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'];
  const KEYS = ['kcal', 'protein', 'carbs', 'sugar', 'fat', 'satFat', 'fiber', 'sodium'];
  const PROMPT = `You read nutrition-facts labels (often Hebrew, Israeli format "ערכים תזונתיים").
Return the values PER 100 g (or per 100 ml for drinks).
- If the label only gives values per serving/unit, convert to per 100 g using the serving weight; if the weight is unknown, return null for that value.
- kcal: energy in kilocalories (never kJ).
- protein, carbs (total carbohydrates), sugar, fat (total), satFat (saturated), fiber: grams.
- sodium: milligrams. If only salt is given, sodium = salt(g) * 400.
- Use null for anything not visible or unreadable. Do not guess.
- name: the product name in the language printed (Hebrew if available), or null.
- servingGrams: weight of one unit/package/serving in grams if printed, else null.
- basisMl: true if the table is per 100 ml.`;
  const nNum = { type: 'NUMBER', nullable: true };
  const SCHEMA = {
    type: 'OBJECT',
    properties: Object.assign({}, ...KEYS.map(k => ({ [k]: nNum })), {
      name: { type: 'STRING', nullable: true }, servingGrams: nNum, basisMl: { type: 'BOOLEAN' },
    }),
  };

  function toJpegBase64(file, max) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        res(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image')); };
      img.src = url;
    });
  }

  class AiError extends Error { constructor(kind, msg) { super(msg || kind); this.kind = kind; } }

  async function aiScan(file, key, onProgress) {
    onProgress && onProgress(0.15, 'שולח ל־AI…');
    const data = await toJpegBase64(file, 1400);
    onProgress && onProgress(0.35, 'ה־AI קורא את התווית…');
    const body = JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data } }, { text: PROMPT }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA },
    });
    let lastErr;
    for (const model of GEMINI_MODELS) {
      let res;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body,
        });
      } catch (e) { throw new AiError('network'); }
      if (res.status === 404) { lastErr = new AiError('model'); continue; } // model renamed → try next
      if (res.status === 429) throw new AiError('quota');
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        const t = await res.text();
        if (/API key|API_KEY|permission|PERMISSION/i.test(t)) throw new AiError('key');
        lastErr = new AiError('bad', t.slice(0, 200)); continue;
      }
      if (!res.ok) { lastErr = new AiError('server'); continue; }
      const j = await res.json();
      const txt = j?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
      onProgress && onProgress(1, 'מוכן');
      return normalizeAi(parseJson(txt), 'Gemini');
    }
    throw lastErr || new AiError('server');
  }

  function parseJson(txt) {
    const m = String(txt).match(/\{[\s\S]*\}/);
    try { return JSON.parse(m ? m[0] : txt); } catch (e) { throw new AiError('parse'); }
  }
  function normalizeAi(o, source) {
    const vals = {}, found = {};
    KEYS.forEach(k => {
      const v = Number(o[k]);
      if (o[k] != null && o[k] !== '' && isFinite(v) && v >= 0 && v <= MAX[k]) { vals[k] = Math.round(v * 10) / 10; found[k] = true; }
    });
    let estimated = false;
    if (vals.kcal == null && vals.protein != null && vals.carbs != null && vals.fat != null) {
      vals.kcal = Math.round(4 * vals.protein + 4 * vals.carbs + 9 * vals.fat); estimated = true;
    }
    return { vals, found, estimated, basisMl: !!o.basisMl, name: typeof o.name === 'string' ? o.name : '', servingGrams: Number(o.servingGrams) || null, ai: true, source };
  }

  /* ---------- AI scan via Groq (free tier, OpenAI-compatible API) ---------- */
  const GROQ_MODELS = ['meta-llama/llama-4-scout-17b-16e-instruct', 'qwen/qwen3.6-27b', 'meta-llama/llama-4-maverick-17b-128e-instruct'];
  async function groqScan(file, key, onProgress) {
    onProgress && onProgress(0.15, 'שולח ל־AI (Groq)…');
    const data = await toJpegBase64(file, 1280);
    onProgress && onProgress(0.35, 'ה־AI קורא את התווית…');
    let lastErr;
    for (const model of GROQ_MODELS) {
      let res;
      try {
        res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model, temperature: 0, response_format: { type: 'json_object' },
            messages: [{ role: 'user', content: [
              { type: 'text', text: PROMPT + '\nReply with a single JSON object with exactly these keys: ' + KEYS.join(', ') + ', name, servingGrams, basisMl.' },
              { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + data } },
            ] }],
          }),
        });
      } catch (e) { throw new AiError('network'); }
      if (res.status === 401 || res.status === 403) throw new AiError('key');
      if (res.status === 429) throw new AiError('quota');
      if (!res.ok) { lastErr = new AiError(res.status === 404 || res.status === 400 ? 'model' : 'server'); continue; }
      const j = await res.json();
      onProgress && onProgress(1, 'מוכן');
      return normalizeAi(parseJson(j?.choices?.[0]?.message?.content || ''), 'Groq');
    }
    throw lastErr || new AiError('server');
  }

  /* ---------- barcode ---------- */
  let detectorP = null;
  function getDetector() {
    if (!detectorP) {
      detectorP = (async () => {
        const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
        if ('BarcodeDetector' in root) {
          try {
            const sup = await root.BarcodeDetector.getSupportedFormats();
            if (formats.some(f => sup.includes(f))) return new root.BarcodeDetector({ formats });
          } catch (e) { /* fall through to bundled reader */ }
        }
        if (!root.KaloriBarcodeDetector) await loadScript('vendor/barcode.js');
        return new root.KaloriBarcodeDetector({ formats });
      })().catch(e => { detectorP = null; throw e; });
    }
    return detectorP;
  }
  async function detectBarcode(source) {
    const d = await getDetector();
    let src = source;
    if (source instanceof Blob) src = await createImageBitmap(source);
    const r = await d.detect(src);
    return r && r.length ? r[0].rawValue : null;
  }

  /* Open Food Facts — free, no key. Returns null when the product is unknown. */
  async function lookupBarcode(code) {
    const fields = 'product_name,product_name_he,brands,nutriments,serving_quantity,product_quantity';
    let res;
    try { res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${fields}`); }
    catch (e) { throw new AiError('network'); }
    if (res.status === 404) return null;
    if (!res.ok) throw new AiError('server');
    const j = await res.json();
    if (!j || j.status === 0 || !j.product) return null;
    const p = j.product, n = p.nutriments || {};
    const g = k => (n[k] != null && n[k] !== '' && isFinite(Number(n[k]))) ? Number(n[k]) : null;
    let kcal = g('energy-kcal_100g');
    if (kcal == null && g('energy_100g') != null) kcal = g('energy_100g') / 4.184;
    let sodium = g('sodium_100g');
    if (sodium == null && g('salt_100g') != null) sodium = g('salt_100g') * 0.4;
    const o = {
      kcal, protein: g('proteins_100g'), carbs: g('carbohydrates_100g'), sugar: g('sugars_100g'),
      fat: g('fat_100g'), satFat: g('saturated-fat_100g'), fiber: g('fiber_100g'),
      sodium: sodium != null ? sodium * 1000 : null, // g → mg
    };
    const r = normalizeAi(o, 'Open Food Facts');
    r.ai = false;
    r.name = [p.product_name_he || p.product_name, p.brands && !(p.product_name_he || p.product_name || '').includes(p.brands.split(',')[0]) ? p.brands.split(',')[0] : '']
      .filter(Boolean).join(' · ').trim();
    r.servingGrams = Number(p.serving_quantity) || Number(p.product_quantity) || null;
    r.hasValues = Object.keys(r.found).length > 0;
    return r;
  }

  const api = { parse, consistent, scan, aiScan, groqScan, detectBarcode, getDetector, lookupBarcode };
  root.KaloriScan = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
