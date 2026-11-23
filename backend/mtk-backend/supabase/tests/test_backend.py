"""Behavioural tests for the MTK backend. Run against a DB that has the stub + migration applied.
   usage: python3 test_backend.py <dsn>"""
import sys, json, uuid, itertools, psycopg2
dsn = sys.argv[1] if len(sys.argv) > 1 else "dbname=mtk user=postgres password=pw host=127.0.0.1"
SRC = ['KCCDECO','KCCL','JARPL','PRTPL','Shovel - 314','Shovel - 229','Shovel - 002','Shovel - 003','PC - 180','PC - 249','PC - 250','Payloader198']
SUMP = ['LK-1','LK-2','OLD DIPKA']
passed = failed = 0
def conn(): c = psycopg2.connect(dsn); c.autocommit = False; return c
admin = conn()
def q(sql, args=None):
    with admin.cursor() as cur:
        cur.execute(sql, args); r = cur.fetchall() if cur.description else None
    admin.commit(); return r
def as_user(c, uid, email='u@x.in'):
    cur = c.cursor(); cur.execute("reset role"); 
    if uid is None: cur.execute("set local role anon"); cur.execute("select set_config('request.jwt.claims','{}',true)")
    else:
        cur.execute("set local role authenticated")
        cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'sub': uid, 'email': email, 'role':'authenticated'}),))
    return cur
def call(uid, day, rev, entries, c=None):
    c = c or conn(); cur = as_user(c, uid)
    try:
        cur.execute("select * from public.mtk_save(%s,%s,%s::jsonb)", (day, rev, json.dumps(entries)))
        row = cur.fetchall(); c.commit(); return ('ok', row)
    except psycopg2.Error as e:
        c.rollback(); return ('err', e.pgcode, (e.diag.message_primary or ''))
    finally: c.close()
def check(name, cond, info=''):
    global passed, failed
    if cond: passed += 1; print('  PASS', name)
    else: failed += 1; print('  FAIL', name, info)

# users
q("truncate auth.users, mtk_reports, mtk_audit_logs, mtk_targets cascade")
def mk(email, role):
    uid = str(uuid.uuid4()); q("insert into auth.users(id,email) values (%s,%s)", (uid, email))
    if role: q("select mtk_private.grant_access(%s,%s,%s)", (email, role, email.split('@')[0]))
    return uid
op, op2, adm, vwr, nobody = mk('op@x.in','operator'), mk('op2@x.in','operator'), mk('adm@x.in','admin'), mk('vw@x.in','viewer'), mk('none@x.in', None)
today = q("select mtk_private.reporting_day()")[0][0]
D = str(today)
full = {}
for s in range(3):
    for i, r in enumerate(SRC):
        for m in range(4): full[f'{s}:{r}:{m}'] = str((s+1)*100 + i*10 + m) if m%2==0 else f'{(s+1)*1000+i*10+m}.{m}5'
for s in range(3): full[f'rain:{s}'] = f'{s}.5'
for i, sp in enumerate(SUMP):
    for f in range(4): full[f'pump:{sp}:{f}'] = str(i*10+f)
assert len(full) == 159

print('AUTH')
check('anon cannot execute mtk_save', call(None, D, 0, {})[0:2] == ('err','42501'))
check('signed-in user without profile -> 42501', call(nobody, D, 0, {})[1] == '42501')
check('viewer cannot save -> 42501', call(vwr, D, 0, {})[1] == '42501')
q("update mtk_profiles set active=false where id=%s", (op2,))
check('deactivated operator -> 42501 (immediate)', call(op2, D, 0, {})[1] == '42501')
q("update mtk_profiles set active=true where id=%s", (op2,))

print('VALIDATION (nothing may be written on failure)')
bad = [('future date', str(today.replace(year=today.year+1)), 0, {}), ('date before 2000', '1999-12-31', 0, {}),
       ('negative revision', D, -1, {}), ('negative qty', D, 0, {'0:KCCL:1':'-5'}),
       ('letters', D, 0, {'0:KCCL:1':'12a'}), ('exponent', D, 0, {'0:KCCL:1':'1e3'}), ('comma decimal', D, 0, {'0:KCCL:1':'1,5'}),
       ('11 digits', D, 0, {'0:KCCL:1':'12345678901'}), ('7 decimals', D, 0, {'0:KCCL:1':'1.1234567'}),
       ('decimal trips', D, 0, {'0:KCCL:0':'1.5'}), ('unknown source', D, 0, {'0:NOPE:1':'1'}),
       ('shift 3', D, 0, {'3:KCCL:1':'1'}), ('metric 4', D, 0, {'0:KCCL:4':'1'}), ('unknown sump', D, 0, {'pump:X:0':'1'}),
       ('garbage key', D, 0, {'hello':'1'}), ('bool value', D, 0, {'0:KCCL:1':True}), ('object value', D, 0, {'0:KCCL:1':{'a':1}}),
       ('negative rain', D, 0, {'rain:0':'-1'}), ('rain:3', D, 0, {'rain:3':'1'}), ('sql-ish', D, 0, {"0:KCCL:1'; drop table mtk_reports;--":'1'})]
for name, d, rev, e in bad:
    r = call(op, d, rev, e); check(name + ' rejected 22023', r[0]=='err' and r[1]=='22023', r)
check('non-object entries rejected', call(op, D, 0, [1,2])[1] == '22023')
check('no report row created by rejected calls', q("select count(*) from mtk_reports")[0][0] == 0)

print('FIRST SAVE / ROUND TRIP')
r = call(op, D, 0, full); check('first save ok, revision 1', r[0]=='ok' and r[1][0][0]==1, r)
check('single row {revision,saved_at}', r[0]=='ok' and len(r[1])==1 and len(r[1][0])==2)
cnt = q("select (select count(*) from mtk_shifts),(select count(*) from mtk_production),(select count(*) from mtk_pumps)")[0]
check('3 shifts, 36 production rows, 3 pump rows', tuple(cnt)==(3,36,3), cnt)
back = q("select mtk_private.report_entries(%s)", (D,))[0][0]
norm = {k: (str(int(v)) if k.split(':')[-1] in '02' and not k.startswith(('rain','pump')) else v) for k, v in full.items()}
from decimal import Decimal
def canon(v): d = Decimal(v); return format(d.normalize(), 'f') if d == d.to_integral() else format(d.normalize(), 'f')
check('all 159 values read back identical (numerically)', {k: canon(v) for k,v in back.items()} == {k: canon(v) for k,v in full.items()}, (len(back),))
check('audit row written', q("select count(*), max(action) from mtk_audit_logs")[0] == (1,'report.create'))

print('REVISIONS / CONFLICTS')
r = call(op, D, 1, {**full, '0:KCCL:1': '99.5'}); check('save with correct revision -> 2', r[0]=='ok' and r[1][0][0]==2, r)
r = call(op2, D, 1, {**full, '0:KCCL:1': '1'}); check('stale revision -> SQLSTATE 40001', r[0]=='err' and r[1]=='40001', r)
check('stale save did not change data', q("select coal_qty from mtk_production p join mtk_shifts s on s.id=p.shift_id where s.shift=0 and p.source='KCCL'")[0][0] == Decimal('99.5'))
r = call(op, D, 0, full); check('re-creating an existing day with revision 0 -> 40001', r[1]=='40001', r)
r = call(op, '2026-01-02', 5, {}); check('unknown day with non-zero revision -> 40001', r[1]=='40001', r)
check('...and that left no phantom report row', q("select count(*) from mtk_reports where day='2026-01-02'")[0][0]==0)
cur_rev = q("select revision, saved_at from mtk_reports where day=%s",(D,))[0]
r = call(op2, D, 2, {**full, '0:KCCL:1': '99.50'}); check('no-op save (99.5 == 99.50) returns same revision 2, saved_at unchanged', r[0]=='ok' and r[1][0][0]==2 and r[1][0][1]==cur_rev[1], r)
check('no-op did not add audit row', q("select count(*) from mtk_audit_logs")[0][0]==2)

print('NULL vs ZERO / snapshot semantics')
part = {k: v for k, v in full.items() if not k.startswith('1:')}      # operator cleared the whole second shift
part['0:KCCDECO:0'] = ''                                              # UI sends '' for a cleared cell
part['0:KCCDECO:2'] = '0'                                             # explicit zero must stay 0
part['0:KCCDECO:1'] = '12.'                                           # mid-typing value the UI allows
r = call(op2, D, 2, part); check('partial snapshot saves', r[0]=='ok' and r[1][0][0]==3, r)
b = q("select mtk_private.report_entries(%s)",(D,))[0][0]
check("cleared cell is NULL (absent), not 0", '0:KCCDECO:0' not in b)
check("explicit 0 stays 0", b.get('0:KCCDECO:2') == '0')
check("'12.' stored as 12", b.get('0:KCCDECO:1') == '12')
check('cleared second shift has no production rows', q("select count(*) from mtk_production p join mtk_shifts s on s.id=p.shift_id where s.shift=1")[0][0]==0)
check('shift row still exists with rainfall', q("select rainfall from mtk_shifts where shift=1")[0][0]==Decimal('1.5'))
check('no row is all-NULL', q("select count(*) from mtk_production where num_nonnulls(coal_trips,coal_qty,ob_trips,ob_qty)=0")[0][0]==0)
r = call(op, D, 3, {}); check('clearing everything works', r[0]=='ok' and r[1][0][0]==4, r)
check('nothing left but report+3 empty shifts', tuple(q("select (select count(*) from mtk_shifts),(select count(*) from mtk_production),(select count(*) from mtk_pumps)")[0])==(3,0,0))

print('AUDIT')
a = q("select action, revision_from, revision_to, actor_email, actor_role, changes -> '0:KCCL:1' from mtk_audit_logs order by id")
check('audit has create + 3 saves', [x[0] for x in a]==['report.create','report.save','report.save','report.save'], a)
check('audit records old/new for a changed cell', a[1][5]['new']=='99.5' and a[1][5]['old']==canon(full['0:KCCL:1']), a[1][5])
check('audit records actor', a[1][3]=='u@x.in' and a[1][4]=='operator')

print('LOCK')
q("update mtk_reports set status='locked' where day=%s",(D,))
r = call(op, D, 4, full); check('locked report rejected 55000', r[1]=='55000', r)
q("update mtk_reports set status='draft' where day=%s",(D,))

print('RLS / PRIVILEGES')
def sel(uid, sql):
    c = conn(); cur = as_user(c, uid)
    try: cur.execute(sql); return cur.fetchall()
    except psycopg2.Error as e: return ('err', e.pgcode)
    finally: c.rollback(); c.close()
call(op, D, 4, full)
check('viewer can read reports', len(sel(vwr, "select * from mtk_reports"))==1)
check('operator can read nested data', len(sel(op, "select * from mtk_production"))==36)
check('user without profile reads nothing', sel(nobody, "select * from mtk_reports")==[])
check('anon has no table access', sel(None, "select * from mtk_reports")[0]=='err')
check('anon cannot read views', sel(None, "select * from mtk_daily_summary")[0]=='err')
for who, uid in [('operator', op), ('admin', adm), ('viewer', vwr)]:
    for stmt in ["insert into mtk_reports(day) values ('2020-01-01')", "update mtk_reports set revision=99", "delete from mtk_production", "update mtk_pumps set running=1", "delete from mtk_shifts"]:
        res = sel(uid, stmt+" returning 1") if stmt.startswith(('insert','update')) else sel(uid, stmt)
        check(f'{who}: direct "{stmt[:32]}" blocked', res[0]=='err' or res==[] , res)
check('revision untouched after direct-write attempts', q("select revision from mtk_reports where day=%s",(D,))[0][0]==5)
check('operator cannot read audit log', sel(op, "select * from mtk_audit_logs")==[])
check('admin can read audit log', len(sel(adm, "select * from mtk_audit_logs"))>=5)
q("insert into mtk_targets(day,coal_qty,ob_qty) values ('2026-11-18',1,1)")
check('operator cannot insert targets', sel(op, "insert into mtk_targets(day,coal_qty) values ('2026-11-19',10500) returning 1")[0]=='err' )
check('admin can insert target (null shift/source)', len(sel(adm, "insert into mtk_targets(day,coal_qty,ob_qty) values ('2026-11-19',10500,32000) returning id"))==1)
try:
    q("insert into mtk_targets(day,coal_qty) values ('2026-11-18',2)"); dup=False
except psycopg2.Error as e: admin.rollback(); dup = e.pgcode=='23505'
check('duplicate (day,NULL,NULL) target rejected (NULLS NOT DISTINCT)', dup)
check('operator cannot call grant_access', sel(op, "select mtk_private.grant_access('x@y.z','admin')")[0]=='err')
check('mtk_private helpers not callable by anon', sel(None, "select mtk_private.app_role()")[0]=='err')
check('viewer sees own profile only', len(sel(vwr, "select * from mtk_profiles"))==1 and len(sel(adm, "select * from mtk_profiles"))==5-1)

print('VIEWS (totals = Excel SUM logic, NULL when empty)')
call(op, D, 5, full)
tot = {(r[0], r[1]): r[2:] for r in q("select shift, section, coal_trips, coal_qty, ob_trips, ob_qty from mtk_shift_totals where day=%s",(D,))}
def exp(shift, rows, m): return sum(Decimal(canon(full[f'{shift}:{r}:{m}'])) for r in rows)
okv = True
for s in range(3):
    for sec, rows in [('MTK-1', SRC[:4]), ('MTK-2', SRC[4:]), ('GRAND', SRC)]:
        got = tot[(s, sec)]
        if tuple(Decimal(x) for x in got) != tuple(exp(s, rows, m) for m in range(4)): okv = False; print('   mismatch', s, sec, got)
check('shift totals for MTK-1 / MTK-2 / GRAND match independent computation', okv)
ds = q("select entries_filled, entries_expected, rainfall_total from mtk_daily_summary where day=%s",(D,))[0]
check('daily summary: 159/159 entered, rainfall total 4.5', ds[0]==159 and ds[1]==159 and ds[2]==Decimal('4.5'), ds)
call(op, D, 5, {'0:KCCL:1':'5'})
t2 = q("select section, coal_qty, ob_qty from mtk_shift_totals where day=%s and shift=1",(D,))
check('no data -> totals are NULL, not 0', t2==[], t2)
t3 = q("select section, coal_qty, ob_qty from mtk_shift_totals where day=%s and shift=0 order by section",(D,))
check('only KCCL coal qty entered: MTK-1 coal=5, ob=NULL; MTK-2 absent', t3==[('GRAND',Decimal('5'),None),('MTK-1',Decimal('5'),None)], t3)

print('ONBOARDING')
q("select mtk_private.revoke_access('op@x.in')")
check('revoke_access deactivates + strips app_metadata role', q("select active from mtk_profiles where email='op@x.in'")[0][0]==False and q("select raw_app_meta_data ? 'mtk_role' from auth.users where email='op@x.in'")[0][0]==False)
check('revoked operator cannot save', call(op, D, 6, {})[1]=='42501')
q("select mtk_private.grant_access('OP@x.in','operator')")
check('grant_access is case-insensitive and sets app_metadata.mtk_role', q("select raw_app_meta_data->>'mtk_role' from auth.users where email='op@x.in'")[0][0]=='operator')

print(f'\n{passed} passed, {failed} failed'); sys.exit(1 if failed else 0)
