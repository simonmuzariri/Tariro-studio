# MobileNet v2 (width 0.35, 224 × 224, no top) — image feature extractor

Used by the AI image classifier (Phase 4b): each camera frame becomes 1,280 numbers, and only a
small classifier on top of them is trained on the learner's computer.

- Source: https://storage.googleapis.com/teachable-machine-models/mobilenet_v2_weights_tf_dim_ordering_tf_kernels_0.35_224_no_top/
  (`model.json`, `group1-shard1of1.bin`), downloaded 2026-11-17 with Omorfo Tech Labs' approval.
- Format: TensorFlow.js layers model (Keras 2.2.4), 155 layers, ends at `out_relu` (7 × 7 × 1280).
- Licence: Apache License 2.0 (MobileNet, Google / Keras Applications).
- SHA-256:
  - `model.json` 743ac7298e845e2c2ef2c361cb2dad84b8bfc67ccbef1fefc20146d529b17030
  - `group1-shard1of1.bin` d366835afb87a9a6915084f00635339c2c8e137760cd891ab234340194ca1913
- Shipped inside the app and served at `/models/mobilenet/`, so nothing is fetched at run time.
