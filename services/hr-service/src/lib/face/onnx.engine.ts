// ─────────────────────────────────────────────────────────────────────────────
// In-process face engine: YuNet (detect) → MiniFASNet (liveness) → SFace (embed).
//
// Runs inside hr-service on onnxruntime-node — no external service, no network
// call, no images leave the process. Models live in services/hr-service/models/
// (see models/MODELS.md for sources, licences and how they were produced). Each
// file's SHA-256 is pinned below; a mismatch makes the engine unavailable, which
// the punch flow treats as fail-open.
//
// Sessions are created lazily on first use (once, shared), so a broken model or a
// missing native binary never blocks service startup — it only surfaces when an
// org with require_face_match punches or enrolls.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { InferenceSession } from 'onnxruntime-node';
import {
  type FaceDiagnostics,
  type FaceEngine,
  type FaceEnrollment,
  type FaceTemplate,
  type FaceVerifyResult,
  FaceServiceUnavailableError,
} from './driver.js';
import { type AntiSpoofModel, liveness } from './antispoof.js';
import { type RgbImage, decodeImage } from './image.js';
import { assessEnrollment, reject } from './quality.js';
import { similarityToScore } from './scoring.js';
import { alignFace, cosine, embedAligned } from './sface.js';
import { detectFaces, largestFace } from './yunet.js';

/** Stored with every template; a template from another model is never compared. */
export const MODEL_VERSION = 'sface-2021dec+yunet-2023mar';

/** Below this mean "real" probability the probe is treated as a photo/screen
 *  (calibrated; see docs/FACE_VERIFICATION.md). */
export const DEFAULT_LIVENESS_MIN = 0.5;

export const MODEL_FILES = {
  yunet: {
    file: 'face_detection_yunet_2023mar.onnx',
    sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4',
  },
  sface: {
    file: 'face_recognition_sface_2021dec.onnx',
    sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',
  },
  fasV2: {
    file: 'minifasnet_v2_2.7_80x80.onnx',
    sha256: '96b5212b17b8e9937aa78b0e78c88aacf21936495798403ff739745510e58990',
  },
  fasV1se: {
    file: 'minifasnet_v1se_4.0_80x80.onnx',
    sha256: 'fddacd4bf415cf9270dd73f125b437dd7b38d28dc0fc2ac0b540951a32d5c8d8',
  },
} as const;

type OrtModule = typeof import('onnxruntime-node');

interface Loaded {
  ort: OrtModule;
  yunet: InferenceSession;
  sface: InferenceSession;
  antiSpoof: AntiSpoofModel[];
}

export class OnnxFaceEngine implements FaceEngine {
  private loading: Promise<Loaded> | null = null;

  constructor(
    private readonly modelsDir: string,
    private readonly livenessMin: number = DEFAULT_LIVENESS_MIN,
  ) {}

  private load(): Promise<Loaded> {
    if (!this.loading) {
      this.loading = this.doLoad().catch((err: unknown) => {
        // Do not cache a failure: the next request retries (e.g. after a volume
        // mount appears). The error itself becomes UNAVAILABLE → fail open.
        this.loading = null;
        throw err instanceof FaceServiceUnavailableError
          ? err
          : new FaceServiceUnavailableError(`face models failed to load: ${(err as Error).message}`);
      });
    }
    return this.loading;
  }

  private async doLoad(): Promise<Loaded> {
    const mod = (await import('onnxruntime-node')) as OrtModule & { default?: OrtModule };
    const ort = mod.default ?? mod;
    // logSeverityLevel 3: SFace's graph lists its initializers as inputs, which makes
    // ORT print a harmless warning per weight on every load.
    const opts: InferenceSession.SessionOptions = { intraOpNumThreads: 2, graphOptimizationLevel: 'all', logSeverityLevel: 3 };
    const open = async (spec: { file: string; sha256: string }): Promise<InferenceSession> => {
      const bytes = await readFile(path.join(this.modelsDir, spec.file));
      const digest = crypto.createHash('sha256').update(bytes).digest('hex');
      if (digest !== spec.sha256) {
        throw new FaceServiceUnavailableError(`model ${spec.file} failed its SHA-256 check`);
      }
      return ort.InferenceSession.create(bytes, opts);
    };
    const [yunet, sface, fasV2, fasV1se] = await Promise.all([
      open(MODEL_FILES.yunet),
      open(MODEL_FILES.sface),
      open(MODEL_FILES.fasV2),
      open(MODEL_FILES.fasV1se),
    ]);
    return {
      ort,
      yunet,
      sface,
      antiSpoof: [
        { session: fasV2, scale: 2.7 },
        { session: fasV1se, scale: 4.0 },
      ],
    };
  }

  async enroll(image: Buffer): Promise<FaceEnrollment> {
    const m = await this.load();
    const img = await decodeOrNull(image);
    if (!img) throw reject('no_face');
    const faces = await this.run(() => detectFaces(m.ort, m.yunet, img));
    const main = largestFace(faces);
    const aligned = main ? alignFace(img, main) : null;
    const quality = assessEnrollment(faces, main, aligned);
    const embedding = await this.run(() => embedAligned(m.ort, m.sface, aligned!));
    return { template: { modelVersion: MODEL_VERSION, embedding }, quality };
  }

  async verify(template: FaceTemplate, image: Buffer, thresholdPct: number): Promise<FaceVerifyResult> {
    if (template.modelVersion !== MODEL_VERSION) {
      throw new FaceServiceUnavailableError(
        `template model ${template.modelVersion} does not match engine ${MODEL_VERSION}; re-enroll required`,
      );
    }
    const m = await this.load();
    const noFace = (): FaceVerifyResult => ({
      score: 0,
      matched: false,
      diagnostics: { similarity: null, liveness: null, det_score: null, model_version: MODEL_VERSION },
    });

    // An undecodable or faceless probe is the client's problem, not an outage:
    // it scores 0 (a real mismatch), exactly as the previous engine did.
    const img = await decodeOrNull(image);
    if (!img) return noFace();
    const face = largestFace(await this.run(() => detectFaces(m.ort, m.yunet, img)));
    if (!face) return noFace();

    const live = await this.run(() => liveness(m.ort, m.antiSpoof, img, face));
    const embedding = await this.run(() => embedAligned(m.ort, m.sface, alignFace(img, face)));
    const similarity = cosine(template.embedding, embedding);

    const diagnostics: FaceDiagnostics = {
      similarity: round4(similarity),
      liveness: round4(live),
      det_score: round4(face.score),
      model_version: MODEL_VERSION,
    };
    // A presentation attack (photo / screen) is recorded as a mismatch with score
    // 0; the real numbers stay in diagnostics for the reviewer.
    const score = live < this.livenessMin ? 0 : similarityToScore(similarity);
    return { score, matched: score >= thresholdPct, diagnostics };
  }

  /** Inference errors are engine faults (UNAVAILABLE), never client errors. */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof FaceServiceUnavailableError) throw err;
      throw new FaceServiceUnavailableError(`face inference failed: ${(err as Error).message}`);
    }
  }
}

async function decodeOrNull(buf: Buffer): Promise<RgbImage | null> {
  try {
    return await decodeImage(buf);
  } catch {
    return null;
  }
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
