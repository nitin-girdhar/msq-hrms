# Face models (hr-service)

The attendance face engine (`src/lib/face/`) runs these ONNX models in-process
with `onnxruntime-node`. They are committed here so image builds are offline and
reproducible, and they ship inside the image via `package.json` → `"files"`.

The engine checks every file's SHA-256 against `MODEL_FILES` in
`src/lib/face/onnx.engine.ts` before loading it. **If you replace a file, update
that constant and the table below together**, and bump `MODEL_VERSION` if the
recognizer changes: stored templates from another model are never compared, so
every employee must re-enrol.

| File | Role | Source | Licence | SHA-256 |
|---|---|---|---|---|
| `face_detection_yunet_2023mar.onnx` | Face detector, 5 landmarks (1×3×640×640 BGR) | [opencv_zoo/models/face_detection_yunet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) | Apache-2.0 | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` |
| `face_recognition_sface_2021dec.onnx` | Face embedding, 128-d (1×3×112×112 RGB) | [opencv_zoo/models/face_recognition_sface](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) | Apache-2.0 | `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79` |
| `minifasnet_v2_2.7_80x80.onnx` | Anti-spoof, 2.7× context crop (1×3×80×80 BGR) | [minivision-ai/Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing) `2.7_80x80_MiniFASNetV2.pth`, converted | Apache-2.0 | `96b5212b17b8e9937aa78b0e78c88aacf21936495798403ff739745510e58990` |
| `minifasnet_v1se_4.0_80x80.onnx` | Anti-spoof, 4.0× context crop (1×3×80×80 BGR) | same repo, `4_0_0_80x80_MiniFASNetV1SE.pth`, converted | Apache-2.0 | `fddacd4bf415cf9270dd73f125b437dd7b38d28dc0fc2ac0b540951a32d5c8d8` |

Upstream `.pth` SHA-256 (as downloaded 2026-10-10):
`2.7_80x80_MiniFASNetV2.pth` `a5eb02e1843f19b5386b953cc4c9f011c3f985d0ee2bb9819eea9a142099bec0`,
`4_0_0_80x80_MiniFASNetV1SE.pth` `84ee1d37d96894d5e82de5a57df044ef80a58be2b218b5ed7cdfd875ec2f5990`.

## Runtime telemetry

onnxruntime-node 1.30 initialises a telemetry system that attempts HTTPS uploads.
The hr-service image sets `ENV ORT_DISABLE_TELEMETRY=1` (Dockerfile), which stops
it from starting at all (verified: the telemetry init log line disappears). Keep
it when upgrading ONNX Runtime.

## Reproducing the MiniFASNet conversion

`msq-hrms/scripts/face-models/export_minifasnet.py` (CPU torch + onnx +
onnxruntime in a throwaway venv; Python never runs in hr-service):

```bash
python export_minifasnet.py --src <dir with MiniFASNet.py + both .pth> --out services/hr-service/models
```

It folds the softmax into the graph and fails unless ONNX Runtime reproduces
torch to 1e-4 (the committed files matched to ~1e-8).

## Parity with the reference implementations (2026-10-10)

- Detection boxes/landmarks match OpenCV `FaceDetectorYN` to ~0.3 px.
- The aligned 112×112 crop matches OpenCV `FaceRecognizerSF.alignCrop` pixel for
  pixel (mean |diff| 0.0004 levels; embedding cosine 0.9999998).
- Anti-spoof crops match upstream `CropImage` (scores within 0.005).

## Note on training data

The code and weights above are Apache-2.0. Like nearly all public face models,
they were trained on public face datasets that carry research-use terms; whether
that reaches the weights is legally unsettled. Get legal advice if a customer
asks.
