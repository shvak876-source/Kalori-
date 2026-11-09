'use strict';
/* =========================================================
   חיבור ליומן האימון (automatic-guacamole)
   Both apps live on the same GitHub Pages site
   (shvak876-source.github.io), so they share localStorage.
   Kalori only READS the workout data and never changes it.
   ========================================================= */
(function (root) {
  const SITE = 'https://shvak876-source.github.io/automatic-guacamole/';
  const SOURCES = [
    { key: 'gymAB.v1', path: '',             app: 'A/B' },
    { key: 'gymHY.v1', path: 'hybrid/',      app: 'אימון וריצה' },
    { key: 'gymUL.v1', path: 'upper-lower/', app: 'Upper/Lower' },
  ];
  const HY_DAYS = { 1: 'יום א', 2: 'יום ב', 3: 'יום ג', 4: 'יום ד', 5: 'יום ה' };
  const UL_DAYS = { A: 'Upper', B: 'Lower' };

  // MET values (Compendium of Physical Activities, rounded)
  const MET_STRENGTH = 4.5;
  const MET_CARDIO = { 'הליכון': 4.3, 'אופניים': 7, 'אליפטיקל': 5, 'ריצה': 9.8, 'מדרגות': 8.8, 'חתירה': 7, 'שחייה': 7, 'אחר': 5 };
  const RUN_KCAL_PER_KG_KM = 1.0; // running costs ~1 kcal per kg per km

  const n = v => { const x = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(x) ? x : 0; };
  function localKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function read(src) {
    try {
      const s = JSON.parse(localStorage.getItem(src.key));
      return s && Array.isArray(s.sessions) ? s.sessions : [];
    } catch (e) { return []; }
  }

  /* every finished session from every program, newest first */
  function all() {
    const out = [];
    SOURCES.forEach(src => read(src).forEach(s => { if (s && s.date) out.push({ src, s }); }));
    return out.sort((a, b) => new Date(b.s.date) - new Date(a.s.date));
  }

  function setsCount(s) { return Object.values(s.ex || {}).reduce((a, sets) => a + (Array.isArray(sets) ? sets.length : 0), 0); }

  function describe({ src, s }, kg) {
    const sets = setsCount(s);
    let title, kcal = 0, icon = '🏋️';
    const parts = [];

    if (s.day === 'C') { // cardio
      icon = '🏃';
      title = s.type || 'אירובי';
      const min = n(s.min), km = n(s.km);
      if (s.type === 'ריצה' && km) kcal = RUN_KCAL_PER_KG_KM * kg * km;
      else {
        let met = MET_CARDIO[s.type] || 5;
        if (s.type === 'הליכון' && n(s.inc)) met += Math.min(5, n(s.inc) * 0.35); // incline walking costs more
        kcal = met * kg * (min / 60);
      }
      if (min) parts.push(`${min} דק׳`);
      if (km) parts.push(`${km} ק״מ`);
    } else {
      title = src.key === 'gymHY.v1' ? (HY_DAYS[s.day] || `אימון ${s.day}`)
        : src.key === 'gymUL.v1' ? (UL_DAYS[s.day] || `אימון ${s.day}`)
        : `אימון ${s.day}`;
      if (sets) {
        const strengthMin = s.min || sets * 2.5; // no timer → ~2.5 min per set incl. rest
        kcal += MET_STRENGTH * kg * (strengthMin / 60);
        parts.push(`${sets} סטים`);
      }
      if (s.min) parts.push(`${s.min} דק׳`);
      if (s.run) {
        icon = sets ? '🏋️' : '🏃';
        const km = s.run.laps ? s.run.laps.length * 0.4 : n(s.run.km);
        if (km) kcal += RUN_KCAL_PER_KG_KM * kg * km;
        parts.push(s.run.laps ? `${s.run.laps.length}×400` : `ריצה${km ? ' ' + km + ' ק״מ' : ''}`);
        if (!sets) title = s.run.name || 'ריצה';
      }
    }
    return { id: s.id, icon, title, detail: parts.join(' · '), kcal: Math.round(kcal / 5) * 5, app: src.app, url: SITE + src.path };
  }

  function onDay(dayKey, kg) {
    return all().filter(x => localKey(new Date(x.s.date)) === dayKey).map(x => describe(x, kg || 75));
  }

  /* link to the program used most recently (default: the A/B one) */
  function appUrl() {
    const last = all()[0];
    return SITE + (last ? last.src.path : '');
  }
  function connected() { return SOURCES.some(src => { try { return localStorage.getItem(src.key) != null; } catch (e) { return false; } }); }

  root.KaloriWorkouts = { onDay, appUrl, connected, all };
})(window);
