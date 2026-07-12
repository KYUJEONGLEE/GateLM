const projectPillToneCount = 6;

export function projectPillTone(value: string | null | undefined) {
  const seed = typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : "unknown-project";

  return stableHash(seed) % projectPillToneCount;
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
