"""Two operators saving simultaneously. usage: python3 test_concurrency.py [dsn]"""
import sys, json, uuid, threading, time, psycopg2
dsn = sys.argv[1] if len(sys.argv) > 1 else "dbname=mtk user=postgres password=pw host=127.0.0.1"
def run(sql, args=None, c=None):
    own = c is None; c = c or psycopg2.connect(dsn)
    cur = c.cursor(); cur.execute(sql, args); r = cur.fetchall() if cur.description else None; c.commit()
    if own: c.close()
    return r
run("truncate auth.users, mtk_reports, mtk_audit_logs cascade")
users = []
for e in ('a@x.in', 'b@x.in', 'c@x.in'):
    u = str(uuid.uuid4()); run("insert into auth.users(id,email) values (%s,%s)", (u, e)); run("select mtk_private.grant_access(%s,'operator')", (e,)); users.append(u)
day = str(run("select mtk_private.reporting_day()")[0][0])

def save(uid, rev, entries, out, hold=0.0):
    c = psycopg2.connect(dsn); cur = c.cursor()
    cur.execute("set local role authenticated"); cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'sub': uid, 'email': uid[:4]}),))
    try:
        cur.execute("select * from public.mtk_save(%s,%s,%s::jsonb)", (day, rev, json.dumps(entries)))
        row = cur.fetchone()
        if hold: time.sleep(hold)           # keep the transaction (and the row lock) open
        c.commit(); out.append(('ok', row[0]))
    except psycopg2.Error as e: c.rollback(); out.append(('err', e.pgcode))
    finally: c.close()

def race(label, calls):
    outs = [[] for _ in calls]; ts = []
    for i, (uid, rev, ent, hold) in enumerate(calls):
        t = threading.Thread(target=save, args=(uid, rev, ent, outs[i], hold)); ts.append(t)
    ts[0].start(); time.sleep(0.3)          # A grabs the lock first and sits on it
    for t in ts[1:]: t.start()
    for t in ts: t.join()
    print(label, [o[0] for o in outs]); return [o[0] for o in outs]

ok = True
# 1. three operators create the SAME new day with revision 0 while the first holds its transaction open
r = race('create race     ', [(users[0], 0, {'0:KCCL:1': '1'}, 1.5), (users[1], 0, {'0:KCCL:1': '2'}, 0), (users[2], 0, {'0:KCCL:1': '3'}, 0)])
ok &= r[0] == ('ok', 1) and r[1] == ('err', '40001') and r[2] == ('err', '40001')
ok &= run("select count(*) from mtk_reports where day=%s", (day,))[0][0] == 1
ok &= run("select revision from mtk_reports where day=%s", (day,))[0][0] == 1
ok &= run("select p.coal_qty from mtk_production p join mtk_shifts s on s.id=p.shift_id where s.shift=0")[0][0] == 1   # winner's data, untouched by losers
# 2. two operators edit the same revision of an existing report
r = race('update race     ', [(users[0], 1, {'0:KCCL:1': '10'}, 1.5), (users[1], 1, {'0:KCCL:1': '20'}, 0)])
ok &= r[0] == ('ok', 2) and r[1] == ('err', '40001')
ok &= run("select p.coal_qty from mtk_production p join mtk_shifts s on s.id=p.shift_id where s.shift=0")[0][0] == 10
# 3. loser re-reads (revision 2) and retries -> succeeds
r = []; save(users[1], 2, {'0:KCCL:1': '20'}, r); print('retry after reload', r)
ok &= r == [('ok', 3)]
# 4. many parallel writers, same revision: exactly one winner, all others 40001, no deadlock
outs = [[] for _ in range(8)]; ts = [threading.Thread(target=save, args=(users[i % 3], 3, {'0:KCCL:1': str(100 + i)}, outs[i])) for i in range(8)]
[t.start() for t in ts]; [t.join() for t in ts]
res = sorted(o[0][0] + ':' + str(o[0][1]) for o in outs); print('8 parallel writers', res)
ok &= sum(1 for o in outs if o[0][0] == 'ok') == 1 and sum(1 for o in outs if o[0] == ('err', '40001')) == 7
ok &= run("select revision from mtk_reports where day=%s", (day,))[0][0] == 4
ok &= run("select count(*) from mtk_audit_logs where report_day=%s", (day,))[0][0] == 4
print('ALL CONCURRENCY CHECKS PASSED' if ok else 'CONCURRENCY CHECKS FAILED'); sys.exit(0 if ok else 1)
