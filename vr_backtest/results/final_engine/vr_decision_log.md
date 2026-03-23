# VR Final Engine Decision Log

Generated: 2026-03-22T02:19:33.103Z

## Decision: **ACCEPT**

## Criteria

### Criterion 1 — 2022 Episode (2021-12): C.final >= A.final
- A (v1.3): 22384.34
- C (v1.5 ON): 22384.34
- Result: **PASS**

### Criterion 2 — MC Tail Loss: C.tail_p5 >= A.tail_p5 * 0.95
- A tail_p5: 2013.7
- C tail_p5: 2013.7
- Threshold: 1913.015
- Result: **PASS**

### Criterion 3 — No Degradation in 2011/2020/2025: C.final >= A.final * 0.95
- 2011-06: A=12122.65  C=12122.65  => **PASS**
- 2020-02: A=16487.52  C=16487.52  => **PASS**
- 2025-01: A=21113.05  C=21113.05  => **PASS**
- Overall: **PASS**

### Criterion 4 — MC Snapback Success Rate: C.rate >= A.rate * 0.70
- A rate: 79.6%
- C rate: 79%
- Threshold: 55.72%
- Result: **PASS**

## Conclusion

v1.5 macro ON is **ACCEPTED** as production engine. All 4 criteria passed.
