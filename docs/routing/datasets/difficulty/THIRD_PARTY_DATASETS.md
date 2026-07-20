# Third-party dataset notices

`data/public-prompts-7000.jsonl` and `data/initial-routing-difficulty-15000.jsonl` contain extracted or transformed fields from third-party datasets. The GateLM repository license does not replace the license carried by each source record. Every public record includes source identity, license, URL, revision, prompt kind, transformation and authorship metadata.

## KLUE MRC

- Source: https://huggingface.co/datasets/klue/klue
- Revision: `349481ec73fff722f88e0453ca05c77a447d967c`
- License stated by the project: `CC-BY-SA-4.0`
- Changes: answers and contexts were omitted. Only the published `question` field was safety-filtered and labeled as an unreviewed difficulty candidate. No KLUE record is serialized as a RAG prompt.

## KITE

- Source: https://huggingface.co/datasets/junkim100/KITE
- Revision: `b02c5cf191a1fd2691b7154875fef46e2aeedc95`
- License: Apache-2.0
- Changes: only `instruction` was retained. The Korean-original and human-reviewed translated subsets are distinguished in record-level direct-authorship metadata.

## Aya Dataset

- Source: https://huggingface.co/datasets/CohereLabs/aya_dataset
- Revision: `f9ea04583f02a8f86404ff6c58bf75fe637df8a2`
- License: Apache-2.0
- Changes: Korean and English `inputs` from original annotations and re-annotations were extracted. Targets and other response-side fields were omitted.

## K2-Eval

- Source: https://huggingface.co/datasets/HAERAE-HUB/K2-Eval
- Revision: `14bbbc9ee6eef17368508735700465eedc9ec4c5`
- License: MIT
- Changes: the 90 handwritten instructions in the generation split were extracted. Rubrics, knowledge questions, references and model responses were omitted.

## HRM8K KSM

- Source: https://huggingface.co/datasets/HAERAE-HUB/HRM8K
- Revision: `c360cabf8d733a82455565358b3dc965aab9ba8d`
- License stated by the project: MIT
- Changes: KSM `question` fields only; answers and English-original fields omitted. The dataset card describes source math problems, GPT-4o translation and human review, so records are marked human-origin machine-translated rather than directly human-authored Korean prompts.

## HAE-RAE BENCH 2.0

- Source: https://huggingface.co/datasets/HAERAE-HUB/HAE_RAE_BENCH_2.0
- Revision: `87bf691006fbd6c3440238802fd8cb4e9bdbcffe`
- License: MIT
- Changes: question fields from date, context-definition, proverb and arithmetic configs were extracted; answers omitted. These records are benchmark-derived and do not count toward direct-human-authorship coverage.

## OpenAssistant OASST1

- Source: https://huggingface.co/datasets/OpenAssistant/oasst1
- Revision: `fdf72ae0827c1cda404aff25b6603abec9e3399b`
- License: Apache-2.0
- Changes: only English `prompter` text passing source moderation/PII labels and local safety filters was retained. Assistant messages and source user identifiers were omitted.

## Databricks Dolly 15k

- Source: https://huggingface.co/datasets/databricks/databricks-dolly-15k
- Revision: `bdd27f4d94b9c1f951818a7da7fd7aeea5dbff1a`
- License: `CC-BY-SA-3.0`
- Changes: employee-authored `instruction` and optional request `context` were retained; responses were omitted. Context is serialized only when required to make the user request complete.

## KULLM-v2 Dolly-derived subset

- Source: https://huggingface.co/datasets/nlpai-lab/kullm-v2
- Revision: `cddcb73c259269928e974e0ce141f123eb068030`
- Distribution license stated by KULLM-v2: Apache-2.0
- Conservative source-chain license recorded by GateLM: `CC-BY-SA-3.0`, inherited from Dolly
- Changes: only the documented Dolly-derived row range `52002..67012` was considered. Translated `instruction` and optional `input` were retained; outputs omitted. Alpaca, GPT4All, Vicuna and ShareGPT-derived rows were excluded. English Dolly and Korean KULLM rows share a semantic-origin key and are not simultaneously selected.

This notice is informational and is not legal advice. Review attribution and share-alike obligations, underlying source rights and machine-translation service terms before redistribution or commercial use.
