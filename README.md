# Fast CSV reader — csv-reader-speed-01

[![csv-reader-speed-01](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/andryrohul/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/andryrohul/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` exports
`run({text, header})` returning exactly `{columns, rows, errors}` — the
same broken-CSV policy (BOM dropped, LF/CRLF record ends, stray CRs,
quoted fields with `""` escapes and LF-normalised line breaks, junk after
a closing quote, unterminated quotes re-read as unquoted, short/long row
padding and cutting) — but built on bulk `indexOf` scans and `slice`
instead of reading one character at a time.

## Run it

```sh
node main.ts
```

`main.ts` reads the cases from `$MAKEFUN_INPUT_DIR/cases.json`
(`/input/cases.json` by default), answers each one with `run()`, and
writes `$MAKEFUN_OUTPUT_DIR/answers.json` (`/output/answers.json` by
default). Node 22 or later, nothing to install, no dependencies.
