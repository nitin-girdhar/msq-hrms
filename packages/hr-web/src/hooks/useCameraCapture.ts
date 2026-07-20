// Camera capture — no JSX. Manages a getUserMedia video stream, captures a
// frame to an offscreen canvas, and re-encodes it as a compressed JPEG
// (~<500KB) data URL. Falls back gracefully when getUserMedia is unavailable
// (isSupported=false) — the consumer should render <input type="file"
// accept="image/*" capture="user"> instead in that case.

import { useCallback, useEffect, useRef, useState } from 'react';

const TARGET_MAX_BYTES = 500_000;

export type CameraCaptureState =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'streaming' }
  | { status: 'captured'; dataUrl: string }
  | { status: 'error'; message: string };

interface UseCameraCaptureResult {
  state: CameraCaptureState;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isSupported: boolean;
  start: () => Promise<void>;
  capture: () => void;
  retake: () => void;
  stop: () => void;
  fromFile: (file: File) => Promise<void>;
}

function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.ceil((base64.length * 3) / 4);
}

async function compressToJpeg(source: CanvasImageSource, width: number, height: number): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(source, 0, 0, width, height);

  let quality = 0.9;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrlBytes(dataUrl) > TARGET_MAX_BYTES && quality > 0.3) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  return dataUrl;
}

export function useCameraCapture(): UseCameraCaptureResult {
  const [state, setState] = useState<CameraCaptureState>({ status: 'idle' });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const isSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stop(), [stop]);

  const start = useCallback(async () => {
    if (!isSupported) {
      setState({ status: 'error', message: 'Camera capture is not supported on this device.' });
      return;
    }
    setState({ status: 'starting' });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setState({ status: 'streaming' });
    } catch {
      setState({ status: 'error', message: 'Could not access the camera. Please allow camera access, or upload a photo instead.' });
    }
  }, [isSupported]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    compressToJpeg(video, video.videoWidth, video.videoHeight)
      .then((dataUrl) => {
        stop();
        setState({ status: 'captured', dataUrl });
      })
      .catch(() => setState({ status: 'error', message: 'Failed to capture photo.' }));
  }, [stop]);

  const retake = useCallback(() => {
    setState({ status: 'idle' });
    void start();
  }, [start]);

  const fromFile = useCallback(async (file: File) => {
    try {
      const bitmap = await createImageBitmap(file);
      const dataUrl = await compressToJpeg(bitmap, bitmap.width, bitmap.height);
      setState({ status: 'captured', dataUrl });
    } catch {
      setState({ status: 'error', message: 'Failed to read the selected photo.' });
    }
  }, []);

  return { state, videoRef, isSupported, start, capture, retake, stop, fromFile };
}
