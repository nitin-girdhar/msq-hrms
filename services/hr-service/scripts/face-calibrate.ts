// ─────────────────────────────────────────────────────────────────────────────
// Face-engine calibration: end-to-end comparison on a local photo set.
//
//   npx tsx scripts/face-calibrate.ts <root> [--liveness-min 0.5]
//
// <root> lives OUTSIDE the repo (consented photos never get committed):
//   <root>/genuine/<person>/*.jpg   2–5 live selfies per person (phone front camera,
//                                   the way a punch is taken)
//   <root>/spoof/<person>/*.jpg     optional: that person's photo shown on a phone
//                                   screen / printed, held up to the camera
//   <root>/spoof/*.jpg              optional: spoofs with no known owner
//
// Runs the PRODUCTION code path (OnnxFaceEngine.enroll / .verify), so what it
// measures is exactly what a punch does. Read-only: nothing is stored anywhere.
// Output is numbers only — people are reported as P1..Pn, never by folder name.
//
// It reports:
//   1. Enrolment quality gate: which photos pass, why others fail, and the
//      sharpness / light distribution of the ones that pass (→ quality.ts limits).
//   2. Genuine vs impostor cosine distributions, FAR/FRR across thresholds and the
//      cosine at FAR 1% / 0.1% / EER (→ scoring.ts SCORE_ANCHORS).
//   3. Liveness of live selfies vs spoofs and the error rates at the floor
//      (→ DEFAULT_LIVENESS_MIN / FACE_LIVENESS_MIN).
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { FaceEnrollmentError, type FaceTemplate } from '../src/lib/face/driver.js';
import { OnnxFaceEngine } from '../src/lib/face/onnx.engine.js';
import { SCORE_ANCHORS, similarityToScore } from '../src/lib/face/scoring.js';

const IMG = /\.(jpe?g|png|webp)$/i;
const MODELS = path.resolve(__dirname, '../models');

function listImages(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => IMG.test(f) && statSync(path.join(dir, f)).isFile())
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => statSync(path.join(dir, f)).isDirectory())
      .sort();
  } catch {
    return [];
  }
}

function pct(values: number[], p: number): number {
  if (!values.length) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[i]!;
}

const f3 = (v: number): string => (Number.isFinite(v) ? v.toFixed(3) : '  — ');
const pctStr = (n: number, d: number): string => (d ? `${((100 * n) / d).toFixed(2)}%` : '—');

function summary(label: string, v: number[]): void {
  console.log(
    `  ${label.padEnd(22)} n=${String(v.length).padStart(4)}  min ${f3(Math.min(...v))}  p5 ${f3(pct(v, 5))}  p50 ${f3(pct(v, 50))}  p95 ${f3(pct(v, 95))}  max ${f3(Math.max(...v))}`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith('--'));
  const li = args.indexOf('--liveness-min');
  const livenessMin = li >= 0 ? Number(args[li + 1]) : 0.5;
  if (!root) {
    console.error('usage: tsx scripts/face-calibrate.ts <root> [--liveness-min 0.5]');
    process.exit(2);
  }

  const engine = new OnnxFaceEngine(MODELS, livenessMin);
  const people = subdirs(path.join(root, 'genuine'));
  if (people.length < 2) {
    console.error('Need at least 2 people under <root>/genuine/ (impostor pairs need two identities).');
    process.exit(2);
  }
  const alias = new Map(people.map((p, i) => [p, `P${i + 1}`]));

  // ── 1. Enrolment gate on every genuine photo ────────────────────────────────
  console.log(`\n== 1. Enrolment quality gate (${people.length} people) ==`);
  const rejections = new Map<string, number>();
  const sharp: number[] = [];
  const luma: number[] = [];
  const lumaStd: number[] = [];
  const yaw: number[] = [];
  const interEye: number[] = [];
  const templates = new Map<string, FaceTemplate>();
  const probes = new Map<string, string[]>();
  let total = 0;
  for (const person of people) {
    const imgs = listImages(path.join(root, 'genuine', person));
    total += imgs.length;
    const rest: string[] = [];
    for (const file of imgs) {
      try {
        const { template, quality } = await engine.enroll(readFileSync(file));
        sharp.push(quality.sharpness);
        luma.push(quality.luma_mean);
        lumaStd.push(quality.luma_std);
        yaw.push(Math.abs(quality.yaw_deg));
        interEye.push(quality.inter_eye_px);
        // First photo that passes the gate becomes the reference; the others probe.
        if (!templates.has(person)) templates.set(person, template);
        else rest.push(file);
      } catch (err) {
        if (!(err instanceof FaceEnrollmentError)) throw err;
        rejections.set(err.reason, (rejections.get(err.reason) ?? 0) + 1);
        rest.push(file); // a photo the gate refuses can still be a punch probe
      }
    }
    probes.set(person, rest);
  }
  const passed = sharp.length;
  console.log(`  passed ${passed}/${total} (${pctStr(passed, total)})`);
  for (const [r, n] of [...rejections].sort((a, b) => b[1] - a[1])) console.log(`  rejected ${r.padEnd(16)} ${n}`);
  if (passed) {
    summary('sharpness (lap var)', sharp);
    summary('luma mean', luma);
    summary('luma std', lumaStd);
    summary('|yaw| deg', yaw);
    summary('inter-eye px', interEye);
  }
  const unenrolled = people.filter((p) => !templates.has(p));
  if (unenrolled.length) console.log(`  NOT enrolled (no photo passed): ${unenrolled.map((p) => alias.get(p)).join(', ')}`);

  // ── 2. Genuine vs impostor similarity ───────────────────────────────────────
  console.log('\n== 2. Recognition (cosine similarity, live probes only) ==');
  const genuine: number[] = [];
  const impostor: number[] = [];
  const liveScores: number[] = [];
  let noFace = 0;
  for (const [person, files] of probes) {
    for (const file of files) {
      const buf = readFileSync(file);
      for (const [owner, tpl] of templates) {
        const r = await engine.verify(tpl, buf, 85);
        if (r.diagnostics.similarity == null) {
          if (owner === person) noFace++;
          continue;
        }
        if (owner === person) {
          genuine.push(r.diagnostics.similarity);
          if (r.diagnostics.liveness != null) liveScores.push(r.diagnostics.liveness);
        } else {
          impostor.push(r.diagnostics.similarity);
        }
      }
    }
  }
  if (noFace) console.log(`  probes with no detectable face: ${noFace}`);
  if (!genuine.length || !impostor.length) {
    console.log('  not enough probes for FAR/FRR (need ≥2 photos for some people).');
  } else {
    summary('genuine cosine', genuine);
    summary('impostor cosine', impostor);
    console.log('\n  cosine   FAR (impostor ≥)   FRR (genuine <)   score');
    for (let t = 0.2; t <= 0.701; t += 0.025) {
      const far = impostor.filter((v) => v >= t).length;
      const frr = genuine.filter((v) => v < t).length;
      console.log(`  ${t.toFixed(3)}   ${pctStr(far, impostor.length).padStart(9)}          ${pctStr(frr, genuine.length).padStart(9)}        ${similarityToScore(t).toFixed(1)}`);
    }
    // Smallest cosine whose FAR is at or below a target.
    const atFar = (target: number): number => {
      for (let t = -1; t <= 1; t += 0.001) {
        if (impostor.filter((v) => v >= t).length / impostor.length <= target) return t;
      }
      return 1;
    };
    let eer = 0;
    let best = Infinity;
    for (let t = -1; t <= 1; t += 0.001) {
      const far = impostor.filter((v) => v >= t).length / impostor.length;
      const frr = genuine.filter((v) => v < t).length / genuine.length;
      if (Math.abs(far - frr) < best) { best = Math.abs(far - frr); eer = t; }
    }
    const c1 = atFar(0.01);
    const c01 = atFar(0.001);
    console.log(`\n  cosine at FAR 1%   ${f3(c1)}   (FRR there ${pctStr(genuine.filter((v) => v < c1).length, genuine.length)})`);
    console.log(`  cosine at FAR 0.1% ${f3(c01)}   (FRR there ${pctStr(genuine.filter((v) => v < c01).length, genuine.length)})`);
    console.log(`  equal error rate at cosine ${f3(eer)}`);
    console.log(`  impostor pairs: ${impostor.length} — FAR 0.1% needs ≥1000 to be measured rather than extrapolated`);
    console.log(`  current anchors: ${SCORE_ANCHORS.map(([c, s]) => `${c}→${s}`).join(', ')}`);
  }

  // ── 3. Liveness ─────────────────────────────────────────────────────────────
  console.log(`\n== 3. Liveness (anti-spoof), floor ${livenessMin} ==`);
  if (liveScores.length) {
    summary('live selfies', liveScores);
    const fr = liveScores.filter((v) => v < livenessMin).length;
    console.log(`  live selfies wrongly scored as spoof: ${fr}/${liveScores.length} (${pctStr(fr, liveScores.length)})`);
  }
  const spoofScores: number[] = [];
  const spoofSims: number[] = [];
  const spoofRoot = path.join(root, 'spoof');
  const spoofSets: Array<[string | null, string[]]> = [
    [null, listImages(spoofRoot)],
    ...subdirs(spoofRoot).map((p): [string | null, string[]] => [p, listImages(path.join(spoofRoot, p))]),
  ];
  const anyTemplate = templates.values().next().value as FaceTemplate | undefined;
  for (const [owner, files] of spoofSets) {
    for (const file of files) {
      const tpl = (owner && templates.get(owner)) || anyTemplate;
      if (!tpl) continue;
      const r = await engine.verify(tpl, readFileSync(file), 85);
      if (r.diagnostics.liveness != null) spoofScores.push(r.diagnostics.liveness);
      if (owner && templates.has(owner) && r.diagnostics.similarity != null) spoofSims.push(r.diagnostics.similarity);
    }
  }
  if (spoofScores.length) {
    summary('spoofs', spoofScores);
    const fa = spoofScores.filter((v) => v >= livenessMin).length;
    console.log(`  spoofs that pass as live: ${fa}/${spoofScores.length} (${pctStr(fa, spoofScores.length)})`);
    if (spoofSims.length) summary('spoof→owner cosine', spoofSims);
    for (const floor of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
      const a = spoofScores.filter((v) => v >= floor).length;
      const r = liveScores.filter((v) => v < floor).length;
      console.log(`  floor ${floor.toFixed(1)}: spoofs passing ${pctStr(a, spoofScores.length).padStart(7)}   live rejected ${pctStr(r, liveScores.length).padStart(7)}`);
    }
  } else {
    console.log('  no spoof photos under <root>/spoof — liveness floor not measured.');
  }
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
