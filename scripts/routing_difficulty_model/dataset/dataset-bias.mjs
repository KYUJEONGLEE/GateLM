export const LENGTH_BUCKET_THRESHOLDS = Object.freeze({
  short_max_exclusive: 160,
  medium_max_exclusive: 800,
});

export function characterLength(value) {
  return [...value].length;
}

export function lengthBucket(value) {
  const length = characterLength(value);
  if (length < LENGTH_BUCKET_THRESHOLDS.short_max_exclusive) return "short";
  if (length < LENGTH_BUCKET_THRESHOLDS.medium_max_exclusive) return "medium";
  return "long";
}

export function countBy(records, selector) {
  const counts = {};
  for (const record of records) {
    const key = String(selector(record));
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

export function lengthLabelDistribution(records) {
  return Object.fromEntries(
    ["short", "medium", "long"].map((bucket) => [
      bucket,
      countBy(records.filter((record) => record.length_bucket === bucket), (record) => record.label),
    ]),
  );
}

export function lengthOnlyRocAuc(records) {
  const ranked = records
    .map((record) => ({ label: record.label, score: characterLength(record.redacted_prompt) }))
    .sort((left, right) => left.score - right.score);
  const positives = ranked.filter((row) => row.label === "complex").length;
  const negatives = ranked.length - positives;
  if (positives === 0 || negatives === 0) return 0.5;

  let positiveRankSum = 0;
  let index = 0;
  while (index < ranked.length) {
    let end = index + 1;
    while (end < ranked.length && ranked[end].score === ranked[index].score) end += 1;
    const averageRank = ((index + 1) + end) / 2;
    for (let cursor = index; cursor < end; cursor += 1) {
      if (ranked[cursor].label === "complex") positiveRankSum += averageRank;
    }
    index = end;
  }

  return (positiveRankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

export function validateLengthGuardrails(records, {
  minimumBucketLabelShare = 0.35,
  maximumBucketLabelShare = 0.65,
  minimumLongRecords = 1500,
  maximumLengthOnlyRocAuc = 0.6,
} = {}) {
  const failures = [];
  const distribution = lengthLabelDistribution(records);
  for (const [bucket, labels] of Object.entries(distribution)) {
    const total = (labels.simple ?? 0) + (labels.complex ?? 0);
    if (total === 0) {
      failures.push(`length_bucket ${bucket}: empty`);
      continue;
    }
    for (const label of ["simple", "complex"]) {
      const share = (labels[label] ?? 0) / total;
      if (share < minimumBucketLabelShare || share > maximumBucketLabelShare) {
        failures.push(
          `length_bucket ${bucket}/${label}: share ${share.toFixed(4)} outside ${minimumBucketLabelShare.toFixed(2)}..${maximumBucketLabelShare.toFixed(2)}`,
        );
      }
    }
  }
  const longRecords = (distribution.long.simple ?? 0) + (distribution.long.complex ?? 0);
  if (longRecords < minimumLongRecords) {
    failures.push(`length_bucket long: expected at least ${minimumLongRecords}, got ${longRecords}`);
  }
  const auc = lengthOnlyRocAuc(records);
  if (auc > maximumLengthOnlyRocAuc) {
    failures.push(`length-only ROC-AUC: expected <= ${maximumLengthOnlyRocAuc}, got ${auc.toFixed(4)}`);
  }
  return failures;
}
