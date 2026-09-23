# Staging retry review candidate

Base: `6f18669601db4ffef00cad4cf09ef2b10d66203e`.
Not an approved release; no production frontend transfer or deployment.

The only shipped change is an uncertainty flag on the existing pending request.
Once any result is ambiguous, a subsequent 4xx cannot clear its frozen body/key.
An initial explicit non-409 4xx still unlocks the fields. Existing explicit edit
confirmation warns about duplicate risk; cancelling preserves the request.
Valid matching 202 clears it. The flag is not serialized into the API body.
CNAME, maxlength, API contract, timestamp and backend admission are unchanged.

## Reproduction and tests (2026-09-23)

Configure `SIRIUS_TEST_PLAYWRIGHT` to the installed Playwright module and
`SIRIUS_TEST_BROWSER` to a local Chrome executable, then run:

```sh
node tests/retry_state.cjs
python -m unittest discover -s tests -v
git diff --check
```

Baseline reproduction (supply the exact git object as stdin, without editing it):

```sh
git show 6f18669601db4ffef00cad4cf09ef2b10d66203e:index.html | node tests/retry_state.cjs --stdin --reproduce
```

BASE: first retry kept K1; after intermediate 401 next submit silently made K2;
mock receipt ledger contained 2 entries. `status=REPRODUCED`.
The complete BASE matrix had 32 PASS / 32 FAIL at ambiguous-state loss.
Fixed candidate: **64 PASS** (four forms x desktop/mobile x eight scenarios).
Existing Python form/service/safe-retry contract tests: **12 PASS**.
Node 24.19.0, local Chrome/Playwright, Python 3.12.10 on Windows.

Scenarios: lost 202 then valid replay; lost 202 then each of 401/403/429 then
replay; initial 422; 409; invalid 202 receipt; explicit edit cancel/confirm.
Assertions include byte-identical body/key/submitted_at, same public number,
one mock ledger entry unless duplicate risk is explicitly confirmed, locked
fields, edit visibility/focus and successful-receipt cleanup.

This is **browser + mock** evidence. All requests are intercepted; no live
API/SMTP/Bitrix is called. 401/403/429 represent an intermediate edge refusal,
not a claim that e602 backend rate limits exact replay: receipt lookup runs
before admission. Durable PostgreSQL proof belongs to the backend PR #7
companion fixture. Full actual staging-tooling/PG17/HTTPS gate remains
**NOT PROVEN** while the local Docker Engine is unavailable.

Only the harness disables animation/smooth scrolling for deterministic clicks;
the shipped CSS is unchanged.
