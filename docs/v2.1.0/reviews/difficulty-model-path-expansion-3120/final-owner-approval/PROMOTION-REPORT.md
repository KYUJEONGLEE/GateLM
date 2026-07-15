# Difficulty model-path 5,000 owner promotion

- Status: passed_owner_approved_training_eligible
- Approved new expansion: 3120 records / 624 families
- Reused existing train/calibration model path: 1880 records
- Final target: 5000 records / 855 families

| role | records | families | use |
|---|---:|---:|---|
| Train | 3000 | 490 | Logistic Regression weight fit |
| Calibration | 1000 | 165 | calibrator and threshold selection |
| Evaluation holdout | 750 | 150 | model-combination evaluation |
| Final promotion holdout | 250 | 50 | one-time runtime promotion evidence |

- Actual Go model path: 5,000 / 5,000
- Hard/simple sentinels in model-path target: 0 / 0
- Existing legacy model-path holdout excluded: 477
- Existing deterministic sentinels retained only in original regression datasets: 143
- Family leakage, exact duplicates, strict cross-partition/existing near duplicates and security-pattern hits: 0
- Promotion holdout was frozen before model or threshold selection and has not been used for either.

This owner approval establishes offline training-input eligibility only. It does not approve model quality, model/calibrator/threshold selection, runtime promotion, GA, or release completion.
