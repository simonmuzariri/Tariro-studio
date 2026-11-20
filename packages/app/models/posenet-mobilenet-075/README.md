# PoseNet (MobileNet v1, width 0.75, output stride 16, 8-bit weights) — body pose

Used by the pose and gesture blocks (Phase 4f): finds 17 body points (nose, eyes, ears, shoulders,
elbows, wrists, hips, knees, ankles) in a camera picture, on this computer.

- Source: https://storage.googleapis.com/tfjs-models/savedmodel/posenet/mobilenet/quant2/075/
  (`model-stride16.json` saved as `model.json`, `group1-shard1of1.bin`), downloaded 2026-11-20 with
  Omorfo Tech Labs' approval. MoveNet was the first choice, but it can only be downloaded from
  Kaggle with a signed-in account.
- Format: TensorFlow.js graph model; input `sub_2` [1, h, w, 3] scaled to −1…1; outputs a heatmap
  (17 channels) and offsets (34 channels) every 16 pixels.
- Licence: Apache License 2.0 (PoseNet, Google / TensorFlow.js models).
- SHA-256:
  - `model.json` 38b860de18e6e48ff274477c2b7207ade6f24fa0ca5509319fa01458ca5884d7
  - `group1-shard1of1.bin` fa9f00dab1468f722f497c06f5c29f60ee3ad9eb1fa81499d0eb16d99290cbd8
- Shipped inside the app and served at `/models/posenet/`, so nothing is fetched at run time.
