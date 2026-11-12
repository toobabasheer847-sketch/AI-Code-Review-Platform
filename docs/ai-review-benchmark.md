# AI review benchmark

The benchmark lives in `backend/src/modules/code-review/benchmark`. Dataset version **1.1.0** is 19 synthetic fixtures. Ground truth is checked against the fixture source before the dataset is accepted. A fixture is not allowed to expect a line or excerpt that is not in its file.

Mock mode feeds each fixture's `mockResponse` through the same parser, evidence check, confidence gate, and deterministic scanners as a review. It does not call a provider. Live mode calls the configured OpenAI model and requires a usable `OPENAI_API_KEY`. This session ran mock mode only.

## How to run

From `backend`:

```bash
npm run benchmark
npm test -- src/modules/code-review/benchmark/benchmark.test.ts
```

`npm run benchmark -- --live` calls the configured provider. Do not treat a live run as comparable to the mock numbers below unless the model, temperature, and dataset version are recorded with it.

Invalid locations and line ranges are rejected in `analyzer.test.ts` (`requires exact cited evidence and valid line ranges`). A model location that is not in the supplied file fails that review instead of being stored. Those cases are unit-tested rather than scored as dataset fixtures, because a failed review has no partial finding list.

## Metrics

A detected finding matches an expected finding when the category and file match, the line is within 2 lines, the legacy severity matches when the fixture sets one, and either evidence string contains the other after trimming and lowercasing. Duplicate counting uses repeated raw model findings, before static merging.

`falsePositiveRate` is `falsePositives / detectedFindings`. It is null when nothing was detected. It is not `falsePositives / (falsePositives + trueNegatives)`; the dataset does not count true-negative lines.

## Measured mock run

Command: `npx tsx -e` invoking `runBenchmark({ mode: 'mock', now: () => new Date('2026-10-24T00:00:00.000Z') })` from `backend` on 12 November 2026.

| Metric | Result |
| --- | --- |
| Dataset | 1.1.0, 19 fixtures |
| Expected findings | 11 |
| Detected findings | 12 |
| True positives | 11 |
| False positives | 1 |
| False negatives | 0 |
| Precision | 11/12 (0.9166666666666666) |
| Recall | 1 |
| False-positive rate | 1/12 (0.08333333333333333) |
| Duplicate raw findings | 1 |
| Duplicate rate | 1/13 (0.07692307692307693) |
| Failures | 0 |
| Runtime of that invocation | 650 ms |

The one false positive is fixture `irrelevant-finding`: the mock response cites a real line but does not supply a confidence score, so the pipeline keeps it as a potential quality note. That behavior is intentional for older responses that omit confidence. Fixture `low-confidence-withheld` sends confidence `0.40` and stores nothing.

Category counts from the same run:

| Category | TP | FP | FN | Precision | Recall |
| --- | --- | --- | --- | --- | --- |
| bug | 6 | 0 | 0 | 1 | 1 |
| security | 4 | 0 | 0 | 1 | 1 |
| performance | 1 | 0 | 0 | 1 | 1 |
| quality | 0 | 1 | 0 | 0 | n/a |

Legacy severity counts from the same run: error 8 TP, warning 3 TP, info 1 FP.

These numbers describe the mock harness. They are not a measurement of `gpt-4o-mini` or any other live model. No live benchmark was run in this session, so no live precision, recall, token count, or dollar cost is reported.

## What the fixtures cover

Vulnerable examples include optional-property access, concatenated SQL, a swallowed error, an off-by-one bound, duplicated model findings, `eval`, dynamic `innerHTML`, a query inside a loop, an assignment used as a condition, and an explicit critical finding.

Non-vulnerable examples include a pure function, a parameterized query, a tagged SQL template, `RegExp.exec`, a literal `innerHTML` assignment, a catch that logs and rethrows, and a sub-threshold confidence score. The static scanner and the model report for `static-and-provider-duplicate` are stored once.
