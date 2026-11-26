// Token Radar entry point (Node 22, standard library only).
//
// Reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), scores every
// pre-token protocol with the model in lib/model.ts, and writes to the output directory:
//   board.json    the ranked board the gate reads
//   data.js       the dashboard's data, generated from the same board so page and board agree
//   dashboard/    a copy of this repository's dashboard/
//   screenshots/  a copy of this repository's screenshots/
//   dossier.json  the judge's summary, written last with the vendored make.fun library
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
// The program is deterministic: the same snapshot always writes the same bytes.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The dossier's caps, as the scorer states them (reference/gate.json via the kit's starter). */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> or --name=<value> out of the arguments, else the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
const outDir = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy a directory's regular files (recursively, dot-names skipped) into the output. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  const copied: string[] = [];
  const walk = (src: string, dst: string, rel: string): void => {
    mkdirSync(dst, { recursive: true });
    for (const name of readdirSync(src)) {
      if (name.startsWith('.')) continue;
      const s = join(src, name);
      const r = rel === '' ? name : `${rel}/${name}`;
      if (statSync(s).isDirectory()) walk(s, join(dst, name), r);
      else if (statSync(s).isFile()) {
        copyFileSync(s, join(dst, name));
        copied.push(r);
      }
    }
  };
  walk(from, to, '');
  return copied;
}

const dashFiles = copyTree(join(here, 'dashboard'), join(outDir, 'dashboard'));
if (!dashFiles.includes('index.html')) fail('dashboard/ holds no index.html');
const shots = copyTree(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length !== 3) fail(`screenshots/ holds ${shots.length} images: hand in exactly 3, the board, a detail view and a filtered view`);
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier is written last: the scorer rebuilds it from this output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} rows ranked (${radar.early_size} beyond the watchlist, ${radar.live_size} live tokens set aside)\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${dashFiles.length} files), screenshots/ (${shots.length} images) and dossier.json in ${outDir}\n`,
);
