# Face Recognition Study Notes

Learnings from the Olivetti-faces PCA/SVM notebook (`test/example code ipynb/`) and how they map to this project. The user's own `test/Friends/` dataset mirrors the Olivetti structure — use it the same way.

## What the Olivetti pipeline does

```
400 images (40 people x 10) -> 64x64 grayscale
  -> PCA to ~150 components ("eigenfaces")
  -> SVM (RBF) + GridSearchCV on the reduced features
  -> leave-one-out-ish stratified CV
```

Key mechanics worth internalizing:

1. **Eigenfaces = PCA on flattened faces.** Each principal component is itself an image; the top ones capture lighting/illumination, later ones capture identity details. `n_components=150` on 64×64 = compression from 4096 dims while keeping discriminative variance.
2. **Classify in reduced space, not pixel space.** SVM on PCA output beats SVM on raw pixels — distance structure survives, noise doesn't.
3. **Hyperparameter search is separate from evaluation data discipline.** GridSearchCV tunes inside a training split only; the held-out set answers "how good is the final system" exactly once.
4. **The interesting errors are systematic**: misclassifications cluster among same-gender/similar-hairlight people — the model confuses *lookalikes*, not randoms.

## Mapping to Cherdocky's needs

Cherdocky currently **detects** faces (BlazeFace via MediaPipe) and redacts them. It does not recognize identity — by design for now: detection quality is the product pain, recognition is a future feature. When it becomes one:

| Notebook concept | Cherdocky application |
|------------------|-----------------------|
| PCA eigenfaces | Cheap closed-set identity check: is this face one of the user's known contacts? Embeddings could be PCA/eigenface-based before jumping to deep embeddings |
| SVM on reduced features | Tiny classifier head per user, trained locally (offline-first constraint) |
| GridSearchCV discipline | Tune on Train/, report once on Test/ — never iterate against Test |
| Lookalike error clusters | Expect confusion within similar demographics; measure per-person recall, not just average |

## The Friends dataset (`test/Friends/`)

- `Train/{Chandler,Joey,Monica,Phoebe,Rachel,Ross}/` — ~50 crops each, single person per image
- `Test/all(*).jpg` — 50 group/mixed photos, no labels

**Overfit hazards** (why the eval harness keeps it informational-only):
1. Single TV series = single domain (studio lighting, makeup, few skin tones). A model tuned here can score 99% while failing on real documents.
2. Train/Test split is by *image*, not by *person-time* — same faces, same scenes leak across the split.
3. Class balance differs wildly from real usage (6 people vs everyone).

**Rule adopted in `test/eval/face-eval.spec.ts`**: Friends numbers are reported but never gate changes. Changes must be justified by construction-based slices (grids/collages/rotations/negatives) whose ground truth comes from geometry, plus ID-document scans that represent actual product input.

## Detection quality results (post-fix baseline)

See [benchmarks.md](./benchmarks.md) for the full table. Headlines:
- Rotations ±15°/±30°: 100% detection — no rotation compensation needed
- Dense grids (12–15 faces): 100% coverage (a 4×4 tiled pass was added after a
  probe showed three small faces in a 900×600 sheet only reach the confidence
  floor at that effective resolution)
- Textured-scene false positives: eliminated via confidence threshold 0.6 (FPs scored 0.51–0.54; all real faces ≥ 0.84)
