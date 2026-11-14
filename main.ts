// Token Radar — entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, scores it with the radar-2 model, and writes
// everything the competition needs into the output directory:
//
//   board.json    the ranked board (one row per protocol)
//   data.js       the dashboard's data, beside the page
//   dashboard/    a copy of this repo's dashboard
//   screenshots/  a copy of this repo's screenshots
//   dossier.json  the dossier the kit's library writes from dashboard/ and
//                 screenshots/, so the gate can compare it byte for byte
//
// Usage:
//   MAKEFUN_OUTPUT_DIR=out node main.ts [--input snapshot.json|dir]
//   node main.ts --input /path/to/snapshot.json
//
// Without --input the snapshot is read from /input/snapshot.json, the path
// the sealed harness mounts it at. Without MAKEFUN_OUTPUT_DIR the output
// goes to /output. The program exits non-zero and writes nothing if the
// board fails validation.

import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = '/input/snapshot.json';
const DEFAULT_OUTPUT = '/output';

function usageError(message: string): never {
  console.error(`token-radar-01: ${message}`);
  console.error('usage: node main.ts [--input <snapshot.json or directory>]');
  process.exit(1);
}

// The --input flag takes either the snapshot file itself or a directory
// holding snapshot.json. Anything else is a user error, reported plainly.
function resolveInput(argv: string[]): string {
  const flag = argv.indexOf('--input');
  if (flag === -1) return DEFAULT_INPUT;
  const value = argv[flag + 1];
  if (value === undefined || value.startsWith('--')) {
    usageError('--input needs a path after it');
  }
  if (!existsSync(value)) usageError(`input not found: ${value}`);
  if (statSync(value).isDirectory()) return join(value, 'snapshot.json');
  return value;
}

function main(): void {
  const inputPath = resolveInput(process.argv.slice(2));
  const outDir = process.env['MAKEFUN_OUTPUT_DIR'] ?? DEFAULT_OUTPUT;
  if (!existsSync(inputPath)) usageError(`snapshot not found: ${inputPath}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(inputPath, 'utf8'));
  } catch (error) {
    usageError(`cannot parse ${inputPath}: ${(error as Error).message}`);
  }
  const snapshot = parseSnapshot(parsed);
  const { board, radar } = buildRadar(snapshot);

  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    console.error(`token-radar-01: board failed validation: ${issue}`);
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`, 'utf8');
  writeFileSync(join(outDir, 'data.js'), dataScript(snapshot, board, radar), 'utf8');
  cpSync(join(REPO_ROOT, 'dashboard'), join(outDir, 'dashboard'), { recursive: true });
  cpSync(join(REPO_ROOT, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
  const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
  writeFileSync(join(outDir, 'dossier.json'), dossier);

  const top = board[0];
  console.log(
    `token-radar-01: wrote ${board.length} rows ` +
      `(${radar.watchlist_size} watchlist + ${radar.early_size} early, ${radar.live_size} live) ` +
      `to ${outDir}; #1 ${top.slug} at $${top.implied_value_usd.toLocaleString('en-US')}`,
  );
}

main();
