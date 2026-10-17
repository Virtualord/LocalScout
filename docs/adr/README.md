# Architecture Decision Records

ADRs record decisions that have a tradeoff worth remembering, so a future
reader can see not just what the code does but why.

- Number them sequentially: `0001-short-title.md`.
- Copy `0000-template.md` and fill it in.
- Status is one of Proposed, Accepted, or `Superseded by ADR-NNNN`.
- Merge the ADR in the same commit as the change it explains.

## Index

| ADR                                    | Title                                                 | Status   | Date       |
| -------------------------------------- | ----------------------------------------------------- | -------- | ---------- |
| [0001](0001-stack-choices.md)          | Stack choices and what was left out                   | Accepted | 2026-10-13 |
| [0002](0002-unpinned-dns-in-audits.md) | The SSRF guard checks addresses but does not pin them | Accepted | 2026-10-17 |
