#!/usr/bin/env node
// Import MDC dev chart dumps from data/mdc/*.txt into the dev_recipes table.
// Resolves filmStockId via fuzzy match against the user's film_stocks; rows
// without a match still get inserted (filmStockId left null) for completeness.

import {readFileSync, readdirSync} from 'fs';
import {join, basename} from 'path';
import pg from 'pg';

const DB = {host:'localhost', user:'filmlog', password:'filmlog', database:'filmlog'};
const MDC_DIR = new URL('../data/mdc', import.meta.url).pathname;

// ── Time parsing ──
// "7:30" → 450, "11" → 660, "7-9" → 480 (lower bound), "5:30-6" → 330.
// "#" or "" → null.
function parseTime(s) {
  if (!s) return null;
  const t = s.trim();
  if (!t || t === '#' || t === 'n/a') return null;
  // Take first part of any range (e.g. "7-9" or "5:30-6")
  const head = t.split('-')[0].trim();
  const colon = head.match(/^(\d+):(\d{1,2})$/);
  if (colon) return Number(colon[1])*60 + Number(colon[2]);
  const dec = head.match(/^(\d+(?:\.\d+)?)$/);
  if (dec) return Math.round(Number(dec[1])*60);
  return null;
}

function parseTemp(s) {
  if (!s) return null;
  const m = s.trim().match(/^(\d+(?:\.\d+)?)C$/i);
  if (m) return Number(m[1]);
  // "68F", "105F" — convert
  const f = s.trim().match(/^(\d+(?:\.\d+)?)F$/i);
  if (f) return Math.round((Number(f[1]) - 32) * 5/9 * 10) / 10;
  return null;
}

function parseIso(s) {
  if (!s) return null;
  // Strip parenthetical hints like "400 (12)" → 400
  const head = s.split(/[()]/)[0].trim();
  if (head === 'n/a') return null;
  const n = Number(head);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// ── Tokenized fuzzy match against film stocks ──
function tokens(s) {
  return s.toLowerCase().replace(/[+()/]/g, ' ').split(/[^a-z0-9]+/).filter(Boolean);
}

// Best stock match for an MDC film name. Returns null when no candidate scores
// well enough — we'd rather skip the FK than mismatch it.
function matchStock(mdcName, stocks) {
  const qt = tokens(mdcName);
  if (qt.length === 0) return null;

  let best = null;
  let bestScore = 0;

  for (const s of stocks) {
    const ct = tokens(`${s.manufacturer} ${s.name}`);
    let m = 0, matched = 0;
    for (const q of qt) {
      let bScore = 0;
      for (const c of ct) {
        if (c === q) bScore = Math.max(bScore, 2);
        else if (c.includes(q) || q.includes(c)) bScore = Math.max(bScore, 1);
      }
      m += bScore;
      if (bScore > 0) matched++;
    }
    if (matched < Math.min(2, qt.length)) continue; // require ≥2 matched tokens unless query is shorter
    const score = m - Math.max(0, ct.length - matched) * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }

  return bestScore >= 1.5 ? best : null;
}

// ── MDC name aliases for stocks the importer chronically misses ──
// Maps an MDC film name (lowercased) → manufacturer/name pair in user's stocks.
const ALIASES = new Map([
  ['ilford hp5+', {manufacturer:'Ilford', name:'HP5 Plus'}],
  ['ilford fp4+', {manufacturer:'Ilford', name:'FP4 Plus'}],
  ['ilford pan f+', {manufacturer:'Ilford', name:'Pan F Plus'}],
  ['ilford delta 100 pro', {manufacturer:'Ilford', name:'Delta 100'}],
  ['ilford delta 400 pro', {manufacturer:'Ilford', name:'Delta 400'}],
  ['ilford delta 3200 pro', {manufacturer:'Ilford', name:'Delta 3200'}],
  ['eastman double-x (5222)', {manufacturer:'Kodak', name:'Double-X 5222'}],
  ['kodak double-x (5222)', {manufacturer:'Kodak', name:'Double-X 5222'}],
  ['fuji neopan 100 acros ii', {manufacturer:'Fujifilm', name:'Acros II 100'}],
  ['kodak tmax 100', {manufacturer:'Kodak', name:'T-Max 100'}],
  ['kodak tmax 400', {manufacturer:'Kodak', name:'T-Max 400'}],
  ['kodak tmax p3200', {manufacturer:'Kodak', name:'T-Max P3200'}],
  ['kodak tri-x 400', {manufacturer:'Kodak', name:'Tri-X 400'}],
  ['kentmere 100', {manufacturer:'Kentmere', name:'Pan 100'}],
  ['kentmere 200', {manufacturer:'Kentmere', name:'Pan 200'}],
  ['nocolorstudio no.5', {manufacturer:'NoColorStudio', name:'no.5'}],
  ['nocolorstudio no.10', {manufacturer:'NoColorStudio', name:'No.10'}],
  ['catlabs x film 320', {manufacturer:'CatLABS', name:'X Film 320 Pro'}],
  ['ilford pan 100', null], // not in user's collection — skip
  ['ilford pan 400', null],
  ['rollei rpx 25', {manufacturer:'Rollei', name:'RPX 25'}],
  ['rollei retro 400s', {manufacturer:'Rollei', name:'Retro 400S'}],
  ['rollei infrared ir400', {manufacturer:'Rollei', name:'Infrared'}],
  ['fomapan 400', {manufacturer:'Foma', name:'Fomapan 400'}],
  ['ferrania orto', {manufacturer:'Ferrania', name:'Orto'}],
  ['ferrania p33', {manufacturer:'Ferrania', name:'P33'}],
  ['washi - f', {manufacturer:'Film Washi', name:'F'}],
  ['adox cms 20 ii', {manufacturer:'ADOX', name:'CMS 20'}],
  ['adox chs 100 ii', {manufacturer:'ADOX', name:'CHS 100 II'}],
  ['shanghai gp3 pan 100', {manufacturer:'Shanghai', name:'GP3 100'}],
  ['silberra s25', {manufacturer:'Silberra', name:'S25 Limited Edition'}],
  ['jch streetpan 400', {manufacturer:'Japan Camera Hunter', name:'StreetPan 400'}],
  ['ilford ortho plus', {manufacturer:'Ilford', name:'Ortho Plus'}],
  ['ilford xp2 super', {manufacturer:'Ilford', name:'XP2 Super'}],
  ['efke ir820', {manufacturer:'Efke', name:'IR 820'}],
]);

function aliasMatch(mdcName, stocks) {
  const a = ALIASES.get(mdcName.toLowerCase());
  if (a === null) return 'skip'; // explicit "not in collection"
  if (!a) return null;
  const match = stocks.find(s => s.manufacturer === a.manufacturer && s.name === a.name);
  return match ?? null;
}

// ── Main ──
async function main() {
  const c = new pg.Client(DB);
  await c.connect();

  const stocks = (await c.query(
    `SELECT id, manufacturer, name FROM film_stocks WHERE user_id = $1`,
    ['d43eded1-69f1-427d-a695-70dbe56b69ef']
  )).rows;

  // Wipe and reimport so re-runs are idempotent.
  await c.query('DELETE FROM dev_recipes');

  let inserted = 0, matched = 0, unmatched = 0, skipped = 0;
  const unmatchedNames = new Set();

  for (const fname of readdirSync(MDC_DIR).filter(f => f.endsWith('.txt'))) {
    const file = join(MDC_DIR, fname);
    const lines = readFileSync(file, 'utf8').split('\n');
    const source = `MDC ${basename(fname, '.txt')} chart`;

    for (const line of lines) {
      if (!line.trim() || line.startsWith('Source:') || line.startsWith('Scraped:') || line.startsWith('Format:')) continue;
      const cols = line.split('\t');
      if (cols.length < 8) continue;
      const [filmName, developer, dilution, asaRaw, t35, t120, tSheet, temp, ...rest] = cols;
      if (filmName === 'Film' || !filmName.trim()) continue;

      const asaIso = parseIso(asaRaw);
      if (asaIso == null) continue;

      let stockMatch = aliasMatch(filmName.trim(), stocks);
      if (stockMatch === 'skip') { skipped++; continue; }
      if (!stockMatch) stockMatch = matchStock(filmName.trim(), stocks);

      if (stockMatch) matched++;
      else { unmatched++; unmatchedNames.add(filmName.trim()); }

      const hasNotes = (rest.join('\t') + '\t' + temp).includes('[notes]');

      await c.query(`
        INSERT INTO dev_recipes
          (film_name, film_stock_id, developer, dilution, asa_iso,
           time_35mm_sec, time_120_sec, time_sheet_sec, temperature_c,
           has_notes, source)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [
        filmName.trim(), stockMatch?.id ?? null, developer, dilution.trim(), asaIso,
        parseTime(t35), parseTime(t120), parseTime(tSheet), parseTemp(temp),
        hasNotes, source,
      ]);
      inserted++;
    }
  }

  console.log(`Inserted ${inserted} recipes (${matched} matched stocks, ${unmatched} unmatched, ${skipped} skipped by alias)`);
  console.log(`\nUnmatched film names (${unmatchedNames.size}):`);
  for (const n of [...unmatchedNames].sort()) console.log(`  ${n}`);

  await c.end();
}

main().catch(e => { console.error(e); process.exit(1); });
