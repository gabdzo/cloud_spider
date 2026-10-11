# Storage: Cloud Spider's own state

Cloud Spider keeps a little state of its own: the Cost Explorer bill cache, SLO history, and Stacks run logs. It goes through one small interface (`src/storage.js`), picked by `storage.backend` in `cloudspider.yaml` (the config file lands in the next PR; until then the file backend under `.cloudspider/`).

## The interface

| Call | Meaning |
|---|---|
| `get(key)` | the JSON value, or `null` (missing or damaged reads as null, never throws) |
| `put(key, value)` | store a JSON value (atomic: temp file + rename) |
| `list(prefix)` | keys under a prefix, sorted |
| `append(key, entry, { max })` | add to a history and keep the last `max` entries |
| `history(key, { limit })` | the last `limit` entries, oldest first |

Keys are slash paths of `[A-Za-z0-9._-]` parts (`cost/bill`, `slo/alb-api`, `runs/eks`). `..`, absolute paths and empty parts are refused, so a key cannot leave the state folder.

## File backend (default, the only one built)

`storage.path` (default `.cloudspider/`, relative to the repo root, gitignored; env `CLOUDSPIDER_STATE_DIR`). One file per key: `<path>/<key>.json` for values, `<path>/<key>.history.json` for histories.

Users today:
- **cost/bill:** the CAPS bill, reused for `cost.cacheTtlMinutes`.
- **SLO history:** `slo-ledger.json`, written by slo-store.js, which still writes it directly. It moves to `append`/`history` when that file is next touched.
- **Stacks run logs:** `runs/`, through upgrade.js.

## No database yet

That was agreed with Gabriel on 2026-10-11. One user and one process on one machine, with small state (kilobytes), makes a folder of JSON the right tool. Revisit when one of these holds:
- several Cloud Spider instances share state (a team server),
- it runs where the disk is not kept (a container without a volume),
- history has to outgrow a file read in full (months of 1-minute SLO points).

## How a DynamoDB backend would map (designed, not built)

`storage.backend: dynamodb` is refused at start today. A backend would implement the same five calls on one table (`storage.table`, on-demand billing):

| Attribute | Value |
|---|---|
| `pk` (partition key, S) | the key's first part: `cost`, `slo`, `runs` |
| `sk` (sort key, S) | `v#<rest of key>` for a value; `h#<rest of key>#<ISO time>#<seq>` for a history entry |
| `value` (S or M) | the JSON value or entry |
| `ttl` (N, optional) | epoch seconds; DynamoDB TTL drops old history entries (replaces `max`) |

- **get** is GetItem `pk, sk="v#…"`. **put** is PutItem.
- **list(prefix)** is Query `pk = first part AND begins_with(sk, "v#<rest>")`. A prefix with no first part is a Scan (only the settings panel would ask).
- **append** is PutItem of a new `h#…` item, so there is no read-modify-write and concurrent writers are safe. `max` becomes a TTL or a periodic trim.
- **history(limit)** is Query `begins_with(sk, "h#<rest>#")`, `ScanIndexForward=false`, `Limit=limit`, reversed to oldest first.
- Items stay far below 400 KB. A bill is ~10 KB; split larger values.
- IAM for the instance role: `dynamodb:GetItem, PutItem, Query` on the one table, plus `Scan` only if a prefix-less list is kept.
- Cost: at Cloud Spider's rate (a few writes a minute) on-demand is well under $1/month.

Building it means adding `createDynamoStorage({ table, client })` to storage.js, using `@aws-sdk/client-dynamodb` (or lib-dynamodb), lifting the refusal in config.js, and running the same tests as test/storage.test.js against DynamoDB Local.
