#!/usr/bin/env python3
"""Build the synthetic byte-parity fixture (no game art).

The image is deliberately hostile to a block compressor -- smooth ramps, hard checker
edges, noise and flat blocks are the four cases where encoders make different choices --
so a port that differs from the reference will differ HERE rather than silently agreeing
on an easy image.

  python tools/make_synthetic_fixture.py
  python tools/reference-python/png_to_dds.py test/fixtures/synthetic.png test/fixtures/synthetic.dds --size 256
  python tools/reference-python/dds_to_ucfx_texture.py test/fixtures/synthetic.dds synthetic_diffuse test/fixtures/synthetic_container.expected.bin
"""
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "test", "fixtures", "synthetic.png")

np.random.seed(7)                       # fixed seed: the fixture must be reproducible
n = 256
y, x = np.mgrid[0:n, 0:n]
img = np.zeros((n, n, 3), np.uint8)
img[..., 0] = x * 255 // n                                    # smooth ramp
img[..., 1] = ((x // 16 + y // 16) % 2) * 255                  # hard checker edges
img[..., 2] = np.clip(128 + np.random.randn(n, n) * 40, 0, 255)  # noise
img[:32, :32] = 0                                              # flat black block
img[32:64, 32:64] = 255                                        # flat white block
Image.fromarray(img).save(OUT)
print("wrote", OUT, "256x256")
