// ─────────────────────────────────────────────────────────────────────────────
// Enrollment quality gate.
//
// The reference photo is compared against every punch for months, so a poor one
// (dark, blurred, turned away, tiny) turns into a stream of false mismatches.
// The gate rejects it up front with a reason the employee can act on.
//
// Pure: it takes the detector output and the aligned 112×112 crop, never runs a
// model, and is unit-tested on synthetic inputs. Limits are named constants; the
// values marked (calibrated) were set from the face-calibrate run documented in
// docs/FACE_VERIFICATION.md.
// ─────────────────────────────────────────────────────────────────────────────

import {
  FaceEnrollmentError,
  type FaceEnrollmentRejection,
  type FaceQualityMetrics,
} from './driver.js';
import { type Point, type RgbImage, laplacianVariance, meanStd, toGray } from './image.js';
import type { DetectedFace } from './yunet.js';

/** Detector confidence the reference face must reach. */
export const ENROLL_MIN_DET_SCORE = 0.9;
/** A second face at least this fraction of the main face's area makes the
 *  photo ambiguous (whose face is the reference?). */
export const SECOND_FACE_AREA_RATIO = 0.5;
export const MIN_INTER_EYE_PX = 40;
export const MIN_FACE_SHORT_SIDE_PX = 112;
export const MAX_ROLL_DEG = 15;
export const MAX_YAW_DEG = 20;
/** Nose height between the eye line (0) and the mouth line (1). A frontal face
 *  sits near 0.49 (the SFace template); tilting up/down moves it. */
export const PITCH_RATIO_MIN = 0.3;
export const PITCH_RATIO_MAX = 0.7;
/** Variance of the Laplacian on the aligned grey crop (calibrated). */
export const SHARPNESS_MIN = 25;
export const LUMA_MIN = 60;
export const LUMA_MAX = 200;
export const LUMA_STD_MIN = 25;
/** Nose-tip depth relative to inter-eye distance, used to turn the nose's
 *  sideways offset into an approximate yaw angle: offset/eyes ≈ k·tan(yaw). */
const NOSE_DEPTH_RATIO = 0.35;

export const REJECTION_MESSAGES: Record<FaceEnrollmentRejection, string> = {
  no_face: 'We could not find a clear face in your photo. Retake it looking straight at the camera.',
  multiple_faces: 'Your photo shows more than one face. Retake it with only you in the frame.',
  face_too_small: 'Your face is too small in the photo. Hold the camera closer and retake it.',
  not_frontal: 'Your face is turned or tilted. Look straight at the camera and retake it.',
  blurry: 'Your photo is blurry. Hold the camera still and retake it.',
  too_dark: 'Your photo is too dark. Retake it facing a light.',
  too_bright: 'Your photo is too bright. Move away from direct light and retake it.',
  low_contrast: 'Your photo is washed out. Retake it in even lighting.',
};

export function reject(reason: FaceEnrollmentRejection): FaceEnrollmentError {
  return new FaceEnrollmentError(reason, REJECTION_MESSAGES[reason]);
}

export interface PoseEstimate {
  rollDeg: number;
  yawDeg: number;
  pitchRatio: number;
}

/** Head pose from the 5 landmarks. Roll is the eye-line angle; yaw and pitch are
 *  measured after undoing the roll, about the eye midpoint. */
export function estimatePose(lm: readonly [Point, Point, Point, Point, Point]): PoseEstimate {
  const [re, le, nose, rm, lmo] = lm;
  const dx = le[0] - re[0];
  const dy = le[1] - re[1];
  const roll = Math.atan2(dy, dx);
  const eyeDist = Math.hypot(dx, dy) || 1;
  const mid: Point = [(re[0] + le[0]) / 2, (re[1] + le[1]) / 2];
  const cos = Math.cos(-roll);
  const sin = Math.sin(-roll);
  const unroll = (p: Point): Point => {
    const x = p[0] - mid[0];
    const y = p[1] - mid[1];
    return [x * cos - y * sin, x * sin + y * cos];
  };
  const n = unroll(nose);
  const mouthY = (unroll(rm)[1] + unroll(lmo)[1]) / 2;
  return {
    rollDeg: (roll * 180) / Math.PI,
    yawDeg: (Math.atan(n[0] / eyeDist / NOSE_DEPTH_RATIO) * 180) / Math.PI,
    pitchRatio: mouthY > 0 ? n[1] / mouthY : 0,
  };
}

/**
 * Run every check in a fixed order and either return the measurements or throw
 * FaceEnrollmentError with the FIRST failing reason (the one most worth fixing).
 * `faces` is every detection above the detector floor; `aligned` is the main
 * face warped to 112×112.
 */
export function assessEnrollment(faces: DetectedFace[], main: DetectedFace | null, aligned: RgbImage | null): FaceQualityMetrics {
  if (!main || !aligned || main.score < ENROLL_MIN_DET_SCORE) throw reject('no_face');

  const mainArea = main.w * main.h;
  const rivals = faces.filter((f) => f !== main && f.w * f.h >= SECOND_FACE_AREA_RATIO * mainArea);
  if (rivals.length > 0) throw reject('multiple_faces');

  const [re, le] = main.landmarks;
  const interEye = Math.hypot(le[0] - re[0], le[1] - re[1]);
  const shortSide = Math.min(main.w, main.h);
  if (interEye < MIN_INTER_EYE_PX || shortSide < MIN_FACE_SHORT_SIDE_PX) throw reject('face_too_small');

  const pose = estimatePose(main.landmarks);
  if (
    Math.abs(pose.rollDeg) > MAX_ROLL_DEG ||
    Math.abs(pose.yawDeg) > MAX_YAW_DEG ||
    pose.pitchRatio < PITCH_RATIO_MIN ||
    pose.pitchRatio > PITCH_RATIO_MAX
  ) {
    throw reject('not_frontal');
  }

  const gray = toGray(aligned);
  const sharpness = laplacianVariance(gray, aligned.width, aligned.height);
  const { mean, std } = meanStd(gray);
  if (mean < LUMA_MIN) throw reject('too_dark');
  if (mean > LUMA_MAX) throw reject('too_bright');
  if (std < LUMA_STD_MIN) throw reject('low_contrast');
  if (sharpness < SHARPNESS_MIN) throw reject('blurry');

  return {
    det_score: round(main.score, 4),
    face_count: faces.length,
    inter_eye_px: round(interEye, 1),
    face_short_side_px: round(shortSide, 1),
    yaw_deg: round(pose.yawDeg, 1),
    roll_deg: round(pose.rollDeg, 1),
    pitch_ratio: round(pose.pitchRatio, 3),
    sharpness: round(sharpness, 1),
    luma_mean: round(mean, 1),
    luma_std: round(std, 1),
  };
}

function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
