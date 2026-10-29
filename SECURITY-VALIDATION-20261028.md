# Security candidate — October 28, 2026

Based on runtime checkpoint 6afa4cebfe450a21c1d96a575c6ff3322609ee89, itself based on live production aa8d38d12cec24c5bb567622f3cd85db18173554. Preserves the Node 26.12.1 pin. Applies the exact previously prepared body-parser 1.20.9 manifest, lockfile and regression harness from private Mud Room checkpoint 92f50c6; their Git blob hashes were verified before testing.

New validation: Node v26.12.1, `node --test --test-concurrency=2 test/*.test.js tests/security-body-parser.cjs`: 132 passed, zero failed, cancelled or skipped. Includes existing application/module, membership/session, database, payment/email mock and UI tests plus parser tests. Dependencies reused from the previously installed candidate; this turn did not perform a clean npm ci. No live payments, email or production data used.

Not deployed. Production latest deployment remains aa8d38d (October 15). Render sign-in was completed afterward. Live shell confirms production Node v26.12.0, Express4.22.1 and body-parser1.20.4. Independent encrypted production backup, isolated restore, rollback verification and live post-deployment checks remain required. Historical 117 runtime-only checks are not the new result; the 132 checks above cover the combined parser/runtime candidate.
