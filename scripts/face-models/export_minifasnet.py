"""One-time export of the MiniFASNet anti-spoof models to ONNX.

The committed ONNX files in services/hr-service/models/ were produced by this
script. It is kept only so the conversion is reproducible; hr-service never runs
Python.

Upstream: https://github.com/minivision-ai/Silent-Face-Anti-Spoofing (Apache-2.0)
  src/model_lib/MiniFASNet.py
  resources/anti_spoof_models/2.7_80x80_MiniFASNetV2.pth
  resources/anti_spoof_models/4_0_0_80x80_MiniFASNetV1SE.pth

Usage (CPU torch, onnx and onnxruntime in a throwaway venv):
  python export_minifasnet.py --src <dir with MiniFASNet.py + the two .pth> --out <models dir>

The exported graph includes the softmax, so the output is [fake_print, real,
fake_replay] probabilities. Input is 1x3x80x80 float32 BGR in the 0-255 range
(upstream's ToTensor deliberately does not divide by 255).
"""

import argparse
import importlib.util
import os
from collections import OrderedDict

import numpy as np
import onnxruntime as ort
import torch

MODELS = [
    # (pth file, class name, onnx output name)
    ('2.7_80x80_MiniFASNetV2.pth', 'MiniFASNetV2', 'minifasnet_v2_2.7_80x80.onnx'),
    ('4_0_0_80x80_MiniFASNetV1SE.pth', 'MiniFASNetV1SE', 'minifasnet_v1se_4.0_80x80.onnx'),
]


class WithSoftmax(torch.nn.Module):
    def __init__(self, net: torch.nn.Module):
        super().__init__()
        self.net = net

    def forward(self, x):
        return torch.softmax(self.net(x), dim=1)


def load_module(src_dir: str):
    spec = importlib.util.spec_from_file_location('MiniFASNet', os.path.join(src_dir, 'MiniFASNet.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()

    mod = load_module(args.src)
    kernel = ((80 + 15) // 16, (80 + 15) // 16)  # upstream utility.get_kernel(80, 80)

    for pth, cls, onnx_name in MODELS:
        net = getattr(mod, cls)(conv6_kernel=kernel)
        state = torch.load(os.path.join(args.src, pth), map_location='cpu')
        if next(iter(state)).startswith('module.'):
            state = OrderedDict((k[7:], v) for k, v in state.items())
        net.load_state_dict(state)
        model = WithSoftmax(net).eval()

        dummy = torch.rand(1, 3, 80, 80) * 255
        out_path = os.path.join(args.out, onnx_name)
        torch.onnx.export(
            model, dummy, out_path,
            input_names=['input'], output_names=['prob'],
            opset_version=13, dynamo=False,
        )

        # Parity check: ONNX Runtime must reproduce torch on random input.
        with torch.no_grad():
            ref = model(dummy).numpy()
        got = ort.InferenceSession(out_path).run(None, {'input': dummy.numpy()})[0]
        diff = float(np.abs(ref - got).max())
        print(f'{onnx_name}: max |torch - onnx| = {diff:.2e}')
        if diff > 1e-4:
            raise SystemExit(f'parity check failed for {onnx_name}')


if __name__ == '__main__':
    main()
