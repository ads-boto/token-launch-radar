// Token Radar — the entry point the grader runs (Node 22, standard library only).
//
//   node main.ts --input /input --output /output        (the sandbox defaults)
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// It reads the sealed snapshot, scores every launch candidate with lib/model.ts, writes the ranked
// board to board.json, writes the page's dataset to data.js, copies dashboard/ and screenshots/ into
// the output directory, and writes dossier.json from vendor/makefun-board.ts last. Two runs on the
// same snapshot write the same bytes: nothing here reads a clock or a random source.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/** The dossier's own caps: only text_max_bytes shapes the bytes; the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const DOSSIER_CAPS = {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
};

const MIN_SHOTS = 3;
const MAX_SHOTS = 4;
const MAX_SHOT_BYTES = 524_288;
const MAX_LONG_SIDE = 1440;
const MIN_SHORT_SIDE = 800;
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> from the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((value) => value.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** Width and height of a whole PNG or JPEG, or null when the bytes are neither. */
function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  // PNG: the IHDR chunk's width and height are the two big-endian 32-bit words at byte 16.
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // JPEG: walk the segments to the first start-of-frame, which carries the height then the width.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        at += 2;
        continue;
      }
      const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
      if (length < 2) return null;
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) {
        const height = (bytes[at + 5]! << 8) | bytes[at + 6]!;
        const width = (bytes[at + 7]! << 8) | bytes[at + 8]!;
        return { width, height };
      }
      at += 2 + length;
    }
  }
  return null;
}

/** Copy one directory's plain files into `to`, refusing a missing source. */
function copyFiles(from: string, to: string, what: string): string[] {
  if (!existsSync(from)) {
    process.stderr.write(`token radar: no ${what}/ directory at ${from}\n`);
    process.exit(1);
  }
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

copyFiles(join(HERE, 'dashboard'), join(out, 'dashboard'), 'dashboard');
const shots = copyFiles(join(HERE, 'screenshots'), join(out, 'screenshots'), 'screenshots');
if (shots.length < MIN_SHOTS || shots.length > MAX_SHOTS) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length}; hand in ${MIN_SHOTS} to ${MAX_SHOTS}: the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!PLAIN_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
  const bytes = readFileSync(join(out, 'screenshots', name));
  if (bytes.byteLength > MAX_SHOT_BYTES) {
    process.stderr.write(`token radar: screenshots/${name} is ${bytes.byteLength} bytes, over the ${MAX_SHOT_BYTES} cap\n`);
    process.exit(1);
  }
  const size = imageSize(new Uint8Array(bytes));
  if (size === null) {
    process.stderr.write(`token radar: screenshots/${name} is not a whole PNG or JPEG\n`);
    process.exit(1);
  }
  const longSide = Math.max(size.width, size.height);
  const shortSide = Math.min(size.width, size.height);
  if (longSide > MAX_LONG_SIDE || shortSide < MIN_SHORT_SIDE) {
    process.stderr.write(`token radar: screenshots/${name} is ${size.width}x${size.height}: the gate wants a long side at most ${MAX_LONG_SIDE} and a short side at least ${MIN_SHORT_SIDE}\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, DOSSIER_CAPS));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols read, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} board rows (${radar.early_size} below the floor, ${radar.live_size} live tokens set aside)\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${readdirSync(join(out, 'dashboard')).length} files), ` +
    `screenshots/ (${shots.length} images) and dossier.json to ${out}\n`,
);
