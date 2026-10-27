// Smoke test : migrate() de config/db.js — « column "acquired_date" does not exist »
// ------------------------------------------------------------
// Reproduit les trois situations de base rencontrées en production et vérifie
// que l'auto-migration « vinyls.added-date » arrive TOUJOURS à créer la
// colonne, même quand :
//   [1] première initialization (table de suivi absente) ;
//   [2] un boot suivant ne ré-exécute PAS les backfills déjà appliqués ;
//   [3] UNE migration antérieure échoue — les suivantes (dont « vinyls.
//       added-date ») doivent malgré tout être appliquées (c'était le
//       cascadeur par lequel la colonne restait absente : un échec antérieur
//       bloquait « vinyls.added-date »).
// La couche PostgreSQL est mockée en mémoire : aucune connexion requise.
process.env.NODE_ENV = 'test';

const { pool, migrate } = require('../src/config/db');

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log('  PASS  ' + name);
  } else {
    failed++;
    console.log('  FAIL  ' + name + (extra ? ' :: ' + extra : ''));
  }
}

// ------------------------------------------------------------
// Faux PostgreSQL en mémoire, assez fidèle pour les instructions de db.js
// ------------------------------------------------------------
function freshDbState() {
  return {
    hasMigrationsTable: false, // base « ancienne » : pas encore de suivi
    applied: new Set(),        // noms des migrations tracées
    columns: new Set(),        // 'table.colonnes' présentes
    notNull: new Set(),        // colonnes NOT NULL
    backfillRuns: 0,           // n° d'exécutions du UPDATE de rétro-remplissage
    injectedFailures: [],      // [{ re, message }] provoqués par instruction
    logError: null,            // last console.error captured (test [3])
  };
}

function installFakePool(state) {
  const exec = async (text, params) => {
    const t = String(text);
    for (const inj of state.injectedFailures) {
      if (inj.re.test(t)) {
        throw new Error(`injected failure :: ${t.replace(/\s+/g, ' ').slice(0, 80)}`);
      }
    }
    if (/^BEGIN$/i.test(t)) return { rows: [] };
    if (/^COMMIT$/i.test(t)) return { rows: [] };
    if (/^ROLLBACK$/i.test(t)) return { rows: [] };
    if (/SELECT 1/i.test(t) && !/information_schema|schema_migrations/.test(t)) {
      return { rows: [{ '1': 1 }] };
    }
    if (/CREATE TABLE IF NOT EXISTS schema_migrations/i.test(t)) {
      state.hasMigrationsTable = true;
      return { rows: [] };
    }
    if (/SELECT name FROM schema_migrations/i.test(t)) {
      const rows = [];
      if (state.hasMigrationsTable) for (const n of state.applied) rows.push({ name: n });
      else {
        const err = new Error('relation "schema_migrations" does not exist');
        err.code = '42P01';
        throw err;
      }
      return { rows };
    }
    if (/INSERT INTO schema_migrations \(name\) VALUES \(\$1\)/i.test(t)) {
      state.applied.add(params[0]);
      return { rows: [] };
    }
    const addCol = t.match(/ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)/i);
    if (addCol) {
      state.columns.add(`${addCol[1].toLowerCase()}.${addCol[2].toLowerCase()}`);
      return { rows: [] };
    }
    const dropCol = t.match(/ALTER TABLE \w+ DROP COLUMN IF EXISTS (\w+)/i);
    if (dropCol) {
      for (const c of [...state.columns]) {
        if (c.endsWith('.' + dropCol[1].toLowerCase())) state.columns.delete(c);
      }
      return { rows: [] };
    }
    if (/SET NOT NULL/i.test(t)) {
      const m = t.match(/ALTER TABLE (\w+) ALTER COLUMN (\w+)/i);
      if (m) state.notNull.add(`${m[1].toLowerCase()}.${m[2].toLowerCase()}`);
      return { rows: [] };
    }
    // Backfill « date d'ajout » (l'instruction dont la répétition à chaque
    // boot était le coût du cascadeur idempotent sans suivi).
    if (/UPDATE vinyls SET acquired_date = CURRENT_DATE WHERE acquired_date IS NULL/i.test(t)) {
      if (!state.columns.has('vinyls.acquired_date')) {
        const err = new Error('column "acquired_date" does not exist');
        err.code = '42703';
        throw err;
      }
      state.backfillRuns++;
      return { rows: [] };
    }
    // DO $$ (backfill year_acquired / contrainte discs_count) : sans effet
    if (/^\s*DO \$\$/i.test(t)) {
      if (/year_acquired/.test(t) && state.columns.has('vinyls.year_acquired')) {
        state.columns.add('vinyls.acquired_date');
      }
      return { rows: [] };
    }
    // ALTER TABLE ... DEFAULT / CHECK / autres UPDATE : sans effet en mémoire
    return { rows: [] };
  };

  pool.query = exec;
  pool.connect = async () => ({ query: exec, release() {} });
  return exec;
}

(async () => {
  // ============================================================
  console.log('\n[1] 1er boot — base sans « schema_migrations » ni acquired_date');
  let state = freshDbState();
  state.columns.add('vinyls.year_acquired'); // ancienne colonne encore là (rétro-remplissage)
  installFakePool(state);
  await migrate();
  check('table de suivi créée', state.hasMigrationsTable);
  check('colonne acquired_date créée', state.columns.has('vinyls.acquired_date'));
  check('acquired_date rendue NOT NULL', state.notNull.has('vinyls.acquired_date'));
  check('ancienne year_acquired supprimée', !state.columns.has('vinyls.year_acquired'));
  check('backfill exécuté une fois', state.backfillRuns === 1, `runs=${state.backfillRuns}`);
  check('toutes les migrations tracées (dont vinyls.added-date)',
    state.applied.has('vinyls.added-date') && state.applied.has('meta.schema-migrations')
      && state.applied.size >= 12,
    `applied=${[...state.applied].join(', ')}`);

  console.log('\n[2] boot suivant — migrations déjà tracées : NE RIEN ré-exécuter');
  const runsBefore = state.backfillRuns;
  await migrate();
  check('backfill NON ré-exécuté', state.backfillRuns === runsBefore, `runs=${state.backfillRuns}`);
  check('suivi inchangé', state.applied.has('vinyls.added-date'));

  // ============================================================
  console.log('\n[3] UN échec antérieur ne bloque plus « vinyls.added-date »');
  state = freshDbState();
  installFakePool(state);
  const errCalls = [];
  const realError = console.error;
  console.error = (...args) => { errCalls.push(args.join(' ')); };
  // Simule l'échec historique : la migration « vinyls.mbid » (index) échoue,
  // et la colonne acquired_date est ABSENTE de la base.
  state.injectedFailures.push({
    re: /CREATE INDEX IF NOT EXISTS idx_vinyls_mbid/i,
  });
  let threw = false;
  try {
    await migrate();
  } catch (e) {
    threw = true;
  }
  console.error = realError;
  check('migrate() ne THROW pas sur un échec intermédiaire', !threw);
  check('échec journalisé avec le NOM de la migration',
    errCalls.some((l) => l.includes('vinyls.mbid') && l.includes('échec') || l.includes('ÉCHEC')),
    `logs=${errCalls.join(' | ').slice(0, 200)}`);
  check('acquired_date créée malgré l’échec antérieur', state.columns.has('vinyls.acquired_date'));
  check('migrations postérieures appliquées (options + discs-count)',
    state.applied.has('vinyls.options') && state.applied.has('vinyls.discs-count-1-to-5'),
    `applied=${[...state.applied].join(', ')}`);
  check('la migration en échec n’est PAS tracée comme appliquée', !state.applied.has('vinyls.mbid'));

  // ============================================================
  console.log('\nPASS: ' + passed + '   FAIL: ' + failed);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
