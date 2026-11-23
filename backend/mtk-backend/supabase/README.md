# MTK backend (Supabase / PostgreSQL 15+)

No frontend changes are required: the schema and `mtk_save` match `lib/report-store.ts` exactly.

## Install
1. Supabase Dashboard → SQL Editor → paste and run `migrations/20261119000000_mtk_backend.sql`
   (or `supabase db push` if you use the CLI).
2. Authentication → Users → create each operator (email + password, confirmed).
3. **Grant access** (nobody can read or save until this is done):
   ```sql
   select mtk_private.grant_access('operator@example.com', 'operator', 'Display Name');
   select mtk_private.grant_access('boss@example.com',     'admin',    'Display Name');
   select mtk_private.grant_access('viewer@example.com',   'viewer');
   -- remove access:
   select mtk_private.revoke_access('operator@example.com');
   ```
   Roles: `admin` (everything, targets, audit log), `operator` (read + save reports), `viewer` (read only).
   The user signs out/in once so the UI picks up the role label from `app_metadata.mtk_role`.
4. Put the two values from `.env.example` into `.env.local` (and Vercel env vars).

## Contract
- Entry keys: `<shift 0-2>:<source>:<metric 0-3>`, `rain:<0-2>`, `pump:<sump>:<0-3>`
  (metrics: coal trips, coal qty, OB trips, OB qty · pump: installed, running, initial, final).
- `mtk_save` takes the full snapshot; absent or `''` = NULL (never 0). Revision `0` = new report.
- Errors: `40001` conflict · `22023` bad date/key/value · `42501` role · `28000` signed out · `55000` locked.
- Report tables are write-protected; the only write path is `mtk_save`. Every save is audited (`mtk_audit_logs`, admin-readable) with old/new per changed cell.
- Views: `mtk_shift_totals` (MTK-1 / MTK-2 / GRAND per shift) and `mtk_daily_summary`.

## Tests (plain PostgreSQL 15+, no Supabase needed)
```
createdb mtk && psql -d mtk -f tests/00_supabase_stub.sql && psql -d mtk -1 -f migrations/20261119000000_mtk_backend.sql
python3 tests/test_backend.py      # 88 behavioural checks
python3 tests/test_concurrency.py  # parallel-writer races
```
`tests/e2e/` runs the real `lib/report-store.ts` against PostgREST.
