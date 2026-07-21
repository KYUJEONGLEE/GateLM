# GateLM LightGBM Dimension-to-Hyperparameter Bridge Report

- Experiment: `difficulty-lightgbm-dimension-tuning.owner-approved-500.2026-07-22.v1`
- Status: `executed`
- Split: `350 / 75 / 75`, family overlap `0`
- Search: `4 feature candidates x 80 hyperparameter candidates x 5 folds`
- Selected feature: `rule_42_plus_semantic_heads_12`
- Selected hyperparameter candidate: `rule_42_plus_semantic_heads_12::lgb-f58cd856b4d655c1`
- Test evaluated candidate count: `1`

| Feature candidate | D | Validation AP | Validation log loss | Validation FN |
|---|---:|---:|---:|---:|
| `rule_42_plus_e5_small_pca_64` | 106 | 0.980011 | 0.179089 | 0 |
| `rule_42_plus_semantic_heads_12` | 54 | 0.986577 | 0.121963 | 1 |
| `e5_base_raw_768` | 768 | 0.975516 | 0.294042 | 0 |
| `rule_42_plus_e5_base_raw_768` | 810 | 0.970791 | 0.210286 | 0 |

Only aggregate evidence is serialized. Prompt text, feature matrices, and per-sample scores are excluded.
