'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { AlertCircle, BarChart3, BookOpen, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Clock3, Database, FileClock, FilePlus2, Gauge, Layers3, LayoutDashboard, Menu, Moon, PanelLeft, Printer, Save, Settings2, ShieldCheck, Sun, Sunrise, Truck, X } from 'lucide-react';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { OperatorAccess } from './operator-access';
import { ProductionSheet } from './production-sheet';
import { ProductionAnalytics } from './production-analytics';
import { useProductionReport } from '@/hooks/use-production-report';
import { db, isSupabaseConfigured, reports, saveTarget, targets as loadTargets } from '@/lib/report-store';
import { contractors, equipment, hours, metrics, rows, shifts, sum, total, display, dayLabel, type Entries } from '@/lib/report';

const sections = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Data Entry', icon: ClipboardList },
  { label: 'Historical Reports', icon: FileClock },
  { label: 'Analytics', icon: BarChart3 },
  { label: 'Settings', icon: Settings2 },
];
const shiftIcons = [Sunrise, Sun, Moon];
const shiftGroup = (n: number) => n === 0 ? 'First' : n === 1 ? 'Second' : 'Third';

export function ReportWorkspace({ today }: { today: string }) {
  const [view, setView] = useState('Dashboard');
  const [date, setDate] = useState(today);
  const [shift, setShift] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [sessionLoading, setSessionLoading] = useState(isSupabaseConfigured);
  const report = useProductionReport(date, user?.id);
  const [savedReport, setSavedReport] = useState<{ date: string; entries: Entries } | null>(null);
  const [clock, setClock] = useState('');
  const [targets, setTargets] = useState<{ coal: number | null; ob: number | null }>({ coal: null, ob: null });

  useEffect(() => {
    const update = () => setClock(new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', weekday: 'short', day: '2-digit', month: 'short' }).format(new Date()));
    update(); const timer = window.setInterval(update, 60_000); return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const client = db();
    client.auth.getSession().then(({ data }: { data: { session: Session | null } }) => setUser(data.session?.user ?? null)).catch(() => setUser(null)).finally(() => setSessionLoading(false));
    const { data: listener } = client.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    const hasUnsaved = report.dirty;
    if (!hasUnsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [report.dirty]);

  const rangeStart = '2000-01-01';
  const { data: history = [], error: historyError, isLoading: historyLoading } = useSWR(user ? ['mtk-range', user.id, rangeStart, today] : null, () => reports(rangeStart, today));
  const entries = report.entries;
  const status = !isSupabaseConfigured ? 'Connection setup required' : !user ? (sessionLoading ? 'Checking session' : 'Sign in required') : report.status;
  const statusTone = report.busy ? 'saving' : report.dirty ? 'draft' : report.ready && report.saved ? 'saved' : 'idle';
  const saveDraft = () => {
    if (!user) { setAccessOpen(true); return; }
    if (report.ready) void report.persist(); else report.retry();
  };
  const changeEntry = (id: string, value: string) => {
    if (report.ready && user) report.change(id, value);
  };
  const openReport = (day: string, reportEntries: Entries) => { setDate(day); setSavedReport({ date: day, entries: reportEntries }); };
  const printReport = () => { if (savedReport) window.print(); };

  return <div className={`workspace ${collapsed ? 'is-collapsed' : ''}`}>
    <aside className="sidebar" aria-label="Main navigation">
      <button className="brand" onClick={() => setView('Dashboard')} aria-label="Coal India Production Report dashboard"><Image className="brand-logo" src="/coal-india-logo.svg" alt="" width={36} height={42} priority/><span className="brand-copy"><strong>COAL INDIA</strong><small>PRODUCTION REPORT</small></span></button>
      <div className="nav-caption">WORKSPACE</div>
      <nav className="side-nav">{sections.map(({ label, icon: Icon }) => <button key={label} title={label} aria-label={label} className={`nav-item ${view === label ? 'active' : ''}`} aria-current={view === label ? 'page' : undefined} onClick={() => { setView(label); setMobileMenu(false); }}><Icon/><span>{label}</span>{view === label && <i/>}</button>)}</nav>
      <div className="sidebar-bottom"><div className={`connection-dot ${report.ready ? 'connected' : ''}`}/><div className="connection-copy"><strong>Database</strong><span>{!isSupabaseConfigured ? 'Missing configuration' : !user ? 'Sign in to verify' : report.ready ? 'Connected' : report.status === 'Load failed' ? 'Schema unavailable' : 'Checking access'}</span></div><Database className="connection-icon"/></div>
      <button className="sidebar-profile" onClick={() => setAccessOpen(true)} aria-label={user ? `Account for ${user.email}` : 'Sign in to operator account'}><span>{user?.email?.slice(0, 2).toUpperCase() ?? 'MT'}</span><div><strong>{user?.email?.split('@')[0] ?? 'Operator account'}</strong><small>{user?.app_metadata.mtk_role ?? (user ? 'Workspace operator' : 'Sign in for report access')}</small></div></button>
    </aside>
    <div className="app-surface">
      <header className="topbar"><button className="icon-button collapse-button" aria-label="Collapse sidebar" onClick={() => setCollapsed(value => !value)}><PanelLeft/></button><button className="icon-button mobile-menu-button" aria-label={mobileMenu ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileMenu} onClick={() => setMobileMenu(value => !value)}>{mobileMenu ? <X/> : <Menu/>}</button><div className="breadcrumb"><span>MTK Operations</span><ChevronRight/><strong>{view}</strong></div><div className="topbar-right"><span className="ist-clock"><Clock3/>{clock || 'IST'} <i>IST</i></span><button className="profile-button" onClick={() => setAccessOpen(true)} aria-label={user ? `Account for ${user.email}` : 'Operator sign in'}><span>{user ? (user.email?.slice(0, 2).toUpperCase() ?? 'MT') : <ShieldCheck/>}</span><small>{user ? user.email?.split('@')[0] : 'Operator access'}</small><ChevronDown/></button></div></header>
      {mobileMenu && <div className="mobile-nav-overlay" onClick={() => setMobileMenu(false)}><nav className="mobile-nav" aria-label="Mobile navigation" onClick={event => event.stopPropagation()}>{sections.map(({ label, icon: Icon }) => <button key={label} className={view === label ? 'active' : ''} onClick={() => { setView(label); setMobileMenu(false); }}><Icon/>{label}</button>)}</nav></div>}
      <main className="main-content">
        <div className="page-heading"><div><div className="eyebrow"><span/> OPERATIONS WORKSPACE</div><h1>{pageTitle(view)}</h1><p>{pageDescription(view)}</p></div>{view === 'Data Entry' && <span className={`save-status ${statusTone}`}><span/>{status}</span>}</div>
        {view === 'Dashboard' && <DashboardPage today={today} setView={setView} targets={targets} userId={user?.id}/>}
        {view === 'Analytics' && <ProductionAnalytics today={today} targets={targets} userId={user?.id}/>}
        {view === 'Data Entry' && <DataEntryPage today={today} date={date} setDate={setDate} shift={shift} setShift={setShift} entries={entries} change={changeEntry} user={user} report={report} onSave={saveDraft} onSignIn={() => setAccessOpen(true)} onPrint={() => setSavedReport({ date, entries })}/>}
        {view === 'Historical Reports' && <HistoryPage today={today} records={history} loading={historyLoading} error={historyError} user={user} onSignIn={() => setAccessOpen(true)} onOpen={day => { setDate(day); setView('Data Entry'); }} onPrint={openReport}/>}
        {view === 'Settings' && <SettingsPage today={today} targets={targets} setTargets={setTargets} user={user} onSignIn={() => setAccessOpen(true)}/>}
      </main>
      <nav className="mobile-tabbar" aria-label="Primary navigation">{sections.map(({ label, icon: Icon }) => <button key={label} className={view === label ? 'active' : ''} aria-current={view === label ? 'page' : undefined} onClick={() => setView(label)}><Icon/><span>{label === 'Historical Reports' ? 'History' : label}</span></button>)}</nav>
    </div>
    <OperatorAccess open={accessOpen} close={() => setAccessOpen(false)} user={user}/>
    {savedReport && <PrintableReport date={savedReport.date} entries={savedReport.entries} onPrint={printReport} onClose={() => setSavedReport(null)}/>}
  </div>;
}

function pageTitle(view: string) { return ({ Dashboard: 'Operations overview', 'Data Entry': 'Daily production report', 'Historical Reports': 'Historical reports', Analytics: 'Production analytics', Settings: 'Workspace settings' } as Record<string, string>)[view] ?? view; }
function pageDescription(view: string) { return ({ Dashboard: 'A clear view of saved daily production and shift activity.', 'Data Entry': 'MTK wise shiftwise daily production report.', 'Historical Reports': 'Find, review, and print saved operational reports.', Analytics: 'Explore database-backed production trends and comparisons.', Settings: 'Application and reporting preferences for this workspace.' } as Record<string, string>)[view] ?? ''; }
function DashboardPage({ today, setView, targets, userId }: { today: string; setView: (view: string) => void; targets: { coal: number | null; ob: number | null }; userId?: string }) {
  return <><div className="dashboard-banner"><div><div className="banner-overline">MTK · DAILY OPERATIONS</div><h2>Production, at a glance.</h2><p>Saved operational reports for {dayLabel(today)}.</p></div><Button className="primary-action" onClick={() => setView('Data Entry')}><FilePlus2/> Create daily report</Button></div><ProductionAnalytics today={today} targets={targets} userId={userId}/><div className="quick-links"><button onClick={() => setView('Historical Reports')}><FileClock/><span><strong>Historical reports</strong><small>Review saved daily production reports</small></span><ChevronRight/></button><button onClick={() => setView('Settings')}><Settings2/><span><strong>Reporting configuration</strong><small>View shifts, targets, and workspace status</small></span><ChevronRight/></button></div></>;
}

function DataEntryPage({ today, date, setDate, shift, setShift, entries, change, user, report, onSave, onSignIn, onPrint }: { today: string; date: string; setDate: (v: string) => void; shift: number; setShift: (v: number) => void; entries: Entries; change: (id: string, value: string) => void; user: User | null; report: ReturnType<typeof useProductionReport>; onSave: () => void; onSignIn: () => void; onPrint: () => void }) {
  const selected = shifts[shift];
  const kpis = [{ name: 'Coal production', unit: 'Ton', value: total(entries, [shift], rows, 1), icon: Layers3 }, { name: 'OB production', unit: 'Cum.', value: total(entries, [shift], rows, 3), icon: Layers3 }, { name: 'Coal trips', unit: 'trips', value: total(entries, [shift], rows, 0), icon: Truck }, { name: 'OB trips', unit: 'trips', value: total(entries, [shift], rows, 2), icon: Gauge }];
  const completion = Math.min(100, Math.round(Object.values(entries).filter(v => v !== '').length / 159 * 100));
  const state = report.status;
  return <>
    <div className="entry-toolbar"><label className="date-field"><CalendarDays/><span>Report date</span><input aria-label="Reporting date" type="date" value={date} max={today} onChange={event => { if (event.target.value && event.target.value <= today) setDate(event.target.value); }}/></label><div className="toolbar-spacer"/><span className="autosave-label"><span className={`status-led ${report.busy ? 'working' : report.dirty ? 'draft' : report.ready ? 'saved' : ''}`}/>{!isSupabaseConfigured ? 'Connection setup required' : !user ? 'Draft stays in this session' : state}</span><button className="outline-action" onClick={onPrint}><Printer/><span>PDF</span></button><Button onClick={onSave} className="primary-action" disabled={report.busy || (user !== null && report.status === 'Loading…')}><Save/>{user ? report.busy ? 'Saving…' : report.ready ? 'Save report' : report.status === 'Loading…' ? 'Loading…' : 'Retry connection' : 'Sign in to save'}</Button></div>
    {!isSupabaseConfigured && <div className="inline-alert warning"><AlertCircle/><span><strong>Supabase environment is not configured.</strong> The report can be drafted in this open session; saving requires a configured Supabase connection.</span></div>}
    {user && report.issue && <div className="inline-alert error"><AlertCircle/><span>{report.issue}</span><button onClick={report.retry}>Retry</button>{report.issue.includes('Another operator') && <button onClick={() => void report.reload()}>Reload latest</button>}</div>}
    {user && !report.ready && !report.issue && report.status === 'Load failed' && <div className="inline-alert warning"><Database/><span><strong>Report database contract is unavailable.</strong> The connected Supabase project has no public report tables at present. No changes will be reported as saved.</span></div>}
    <div className="section-heading"><span>SHIFT SELECTION</span><span>Asia / Kolkata</span></div>
    <div className="shift-picker">{shifts.map((name, index) => { const Icon = shiftIcons[index]; return <button key={name} className={`shift-option ${shift === index ? 'selected' : ''}`} aria-pressed={shift === index} onClick={() => setShift(index)}><span className="shift-symbol"><Icon/></span><span><strong>{name}</strong><small>{hours[index]}</small></span>{shift === index && <CheckCircle2/>}</button>; })}</div>
    <div className="section-heading"><span>{selected.toUpperCase()} OVERVIEW</span><span className="section-heading-side">{completion}% entered</span></div>
    <div className="entry-kpis">{kpis.map(({ name, unit, value, icon: Icon }) => <article key={name}><span className="entry-kpi-icon"><Icon/></span><div><small>{name}</small><strong>{display(value)}</strong><span>{unit}</span></div></article>)}</div>
    <div className="section-heading"><span>PRODUCTION ENTRY</span><span className="section-heading-side"><BookOpen/> Shift sheet</span></div>
    <ProductionSheet shift={shift} entries={entries} change={change}/>
    <div className="entry-footer"><span><Clock3/> {user ? report.saved ? `Last saved ${new Date(report.saved).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST` : 'No confirmed save for this report' : 'Sign in to access authorized report saving'} </span><span>{report.busy ? 'Saving changes…' : report.dirty ? 'Unsaved draft' : report.ready && report.saved ? 'All changes saved' : 'Unsaved changes are preserved while this page is open'}</span></div>
    {!user && isSupabaseConfigured && <button className="auth-hint" onClick={onSignIn}><ShieldCheck/> Operator sign-in is required for database access <ChevronRight/></button>}
  </>;
}
function HistoryPage({ today, records, loading, error, user, onSignIn, onOpen, onPrint }: { today: string; records: Awaited<ReturnType<typeof reports>>; loading: boolean; error: unknown; user: User | null; onSignIn: () => void; onOpen: (day: string) => void; onPrint: (day: string, entries: Entries) => void }) {
  const [query, setQuery] = useState(''); const [start, setStart] = useState(''); const [end, setEnd] = useState('');
  const filtered = records.filter(record => record.day.includes(query) && (!start || record.day >= start) && (!end || record.day <= end)).sort((a, b) => b.day.localeCompare(a.day));
  return <><div className="history-controls"><label className="search-field"><span className="sr-only">Search report date</span><input type="search" placeholder="Search by date (YYYY-MM-DD)" value={query} onChange={e => setQuery(e.target.value)}/></label><label><span>From</span><input type="date" value={start} max={today} onChange={e => setStart(e.target.value)}/></label><label><span>To</span><input type="date" value={end} max={today} onChange={e => setEnd(e.target.value)}/></label></div>
    <div className="history-card"><div className="history-table-wrap"><table className="history-table"><thead><tr><th>REPORT DATE</th><th>COAL · TON</th><th>OB · CUM.</th><th>STATUS</th><th>REVISION</th><th> </th></tr></thead><tbody>{filtered.map(record => { const coal = total(record.entries, [0, 1, 2], rows, 1); const ob = total(record.entries, [0, 1, 2], rows, 3); const complete = Object.values(record.entries).filter(v => v !== '').length >= 159; return <tr key={record.day}><td><strong>{dayLabel(record.day)}</strong></td><td>{display(coal)}</td><td>{display(ob)}</td><td><span className={`report-state ${complete ? 'complete' : 'incomplete'}`}><i/>{complete ? 'Complete' : Object.keys(record.entries).length ? 'Incomplete' : 'Saved'}</span></td><td>r{record.revision}</td><td><div className="row-actions"><button onClick={() => onOpen(record.day)}>Open report</button><button aria-label={`Print report for ${record.day}`} onClick={() => onPrint(record.day, record.entries)}><Printer/></button></div></td></tr>; })}</tbody></table></div>
      {loading && <div className="history-state"><span className="spinner"/> Loading saved reports…</div>}
      {!loading && Boolean(error) && <div className="history-state error-state"><Database/><h3>Reports could not be loaded</h3><p>Verify the connected Supabase report tables and read policies. No demonstration records are shown in history.</p></div>}
      {!loading && !error && !user && <div className="history-state"><ShieldCheck/><h3>Operator sign-in required</h3><p>Sign in to load authorized historical reports. No demonstration records are shown here.</p><button className="history-sign-in" onClick={onSignIn}>Operator sign in <ChevronRight/></button></div>}
      {!loading && !error && user && filtered.length === 0 && <div className="history-state"><FileClock/><h3>{records.length ? 'No reports match these filters' : 'No saved reports yet'}</h3><p>{records.length ? 'Adjust the date or search filter to see other records.' : 'Historical reports will appear here after authorized reports are saved to Supabase.'}</p></div>}
    </div></>;
}

function SettingsPage({ today, targets, setTargets, user, onSignIn }: { today: string; targets: { coal: number | null; ob: number | null }; setTargets: (value: { coal: number | null; ob: number | null }) => void; user: User | null; onSignIn: () => void }) {
  const [targetMessage, setTargetMessage] = useState('');
  useEffect(() => {
    if (!user) return;
    void loadTargets(today, today).then(rows => {
      const row = rows[0];
      setTargets({ coal: row?.coal_qty == null ? null : Number(row.coal_qty), ob: row?.ob_qty == null ? null : Number(row.ob_qty) });
    }).catch(() => setTargetMessage('Database targets could not be loaded.'));
  }, [today, user, setTargets]);
  const saveTargets = async () => {
    if (user?.app_metadata.mtk_role !== 'admin') { setTargetMessage('Only administrators can save targets.'); return; }
    try {
      await saveTarget(today, targets.coal, targets.ob);
      setTargetMessage('Targets saved to Supabase.');
    } catch {
      setTargetMessage('Target save failed. Changes were not confirmed.');
    }
  };
  return <div className="settings-layout"><section className="settings-card"><div className="settings-title"><span><Settings2/></span><div><h2>Application</h2><p>Workspace identity and current setup.</p></div></div><dl><div><dt>Product</dt><dd>MTK Operations</dd></div><div><dt>Report format</dt><dd>MTK WISE SHIFTWISE DAILY PRODUCTION REPORT</dd></div><div><dt>Storage</dt><dd>Linked Supabase operational database</dd></div></dl></section>
    <section className="settings-card"><div className="settings-title"><span><Clock3/></span><div><h2>Reporting configuration</h2><p>Reference schedule from the source production workbook.</p></div></div><div className="shift-settings">{shifts.map((name, i) => <div key={name}><strong>{name}</strong><span>{hours[i]}</span></div>)}</div><div className="rollover-note"><CalendarDays/> Reporting date rollover: needs business confirmation <span>Third-shift convention unresolved</span></div></section>
    <section className="settings-card"><div className="settings-title"><span><Gauge/></span><div><h2>Production targets</h2><p>Per-day coal and OB targets stored in Supabase.</p></div></div><div className="target-form"><label>Coal target <span>Ton / day</span><input type="number" min="0" inputMode="numeric" value={targets.coal ?? ''} onChange={event => setTargets({ ...targets, coal: event.target.value === '' ? null : Math.max(0, Number(event.target.value)) })}/></label><label>OB target <span>Cum. / day</span><input type="number" min="0" inputMode="numeric" value={targets.ob ?? ''} onChange={event => setTargets({ ...targets, ob: event.target.value === '' ? null : Math.max(0, Number(event.target.value)) })}/></label></div><button className="settings-access" disabled={!user || user.app_metadata.mtk_role !== 'admin'} onClick={() => void saveTargets()}>Save targets <ChevronRight/></button>{targetMessage && <div className="config-note">{targetMessage}</div>}</section>
    <section className="settings-card"><div className="settings-title"><span><Database/></span><div><h2>Database connection</h2><p>Operational report storage status.</p></div></div><div className="database-state"><span className="status-led saved"/><div><strong>Connected to the linked Supabase project</strong><small>Report tables and <code>mtk_save</code> are protected by the migration&apos;s RLS and role policies.</small></div></div></section>
    <section className="settings-card"><div className="settings-title"><span><ShieldCheck/></span><div><h2>Operator access</h2><p>Signed-in identity and assigned application role.</p></div></div><div className="database-state"><span className={`status-led ${user ? 'saved' : 'draft'}`}/><div><strong>{user?.email ?? 'No operator signed in'}</strong><small>Role: {user?.app_metadata.mtk_role ?? (user ? 'No role provided' : 'Sign-in required for protected reports')}</small></div></div><button className="settings-access" onClick={onSignIn}>{user ? 'Manage account' : 'Operator sign in'} <ChevronRight/></button></section>
  </div>;
}

function PrintableReport({ date, entries, onPrint, onClose }: { date: string; entries: Entries; onPrint: () => void; onClose: () => void }) {
  const lists = [{ name: 'MTK-1 · Contractor', rows: contractors }, { name: 'MTK-2 · Departmental', rows: equipment }];
  const rainfall = [0, 1, 2].map(i => entries[`rain:${i}`] ?? '');
  return <div className="print-overlay"><div className="print-toolbar"><span>Print-ready · A4 landscape</span><Button className="primary-action" onClick={onPrint}><Printer/> Print / Save as PDF</Button><button aria-label="Close report" onClick={onClose}><X/></button></div><article className="print-page"><h1>MTK WISE SHIFTWISE DAILY PRODUCTION REPORT</h1><p>Report date: {dayLabel(date)}</p><table><thead><tr><th rowSpan={2}>Section / Source</th>{shifts.map((name, i) => <th colSpan={4} key={name}>{name} · {hours[i]}</th>)}</tr><tr>{shifts.flatMap(name => ['Coal trips', 'Coal · Ton', 'OB trips', 'OB · Cum.'].map(col => <th key={`${name}-${col}`}>{col}</th>))}</tr></thead><tbody>{lists.map(section => <FragmentSection key={section.name} section={section} entries={entries}/>) }<tr className="print-grand"><th>Grand Total</th>{shifts.flatMap((_, shiftIndex) => metrics.map((_, metricIndex) => <td key={`${shiftIndex}-${metricIndex}`}>{display(total(entries, [shiftIndex], rows, metricIndex))}</td>))}</tr></tbody></table><div className="print-subtables"><section><h2>Rainfall Report · MM</h2><table><thead><tr><th>Shift</th><th>MM</th></tr></thead><tbody>{shifts.map((name, i) => <tr key={name}><td>{shiftGroup(i)} Shift</td><td>{rainfall[i] || '—'}</td></tr>)}</tbody><tfoot><tr><th>Daily total</th><td>{display(sum(rainfall))}</td></tr></tfoot></table></section><section><h2>Pump Operation Report</h2><table><thead><tr>{['Sump', 'Installed', 'Running', 'Initial', 'Final'].map(col => <th key={col}>{col}</th>)}</tr></thead><tbody>{['LK-1', 'LK-2', 'OLD DIPKA'].map(name => <tr key={name}><th>{name}</th>{[0, 1, 2, 3].map(i => <td key={i}>{entries[`pump:${name}:${i}`] || '—'}</td>)}</tr>)}</tbody></table></section></div></article></div>;
}
function FragmentSection({ section, entries }: { section: { name: string; rows: string[] }; entries: Entries }) {
  return <>{section.rows.map((source, i) => <tr key={source}><th>{i === 0 ? section.name : ''}<br/>{source.replace('Payloader198', 'Payloader 198')}</th>{shifts.flatMap((_, shiftIndex) => metrics.map((_, metricIndex) => <td key={`${shiftIndex}-${metricIndex}`}>{entries[`${shiftIndex}:${source}:${metricIndex}`] || '—'}</td>))}</tr>)}<tr className="print-subtotal"><th>{section.name} total</th>{shifts.flatMap((_, shiftIndex) => metrics.map((_, metricIndex) => <td key={`${shiftIndex}-${metricIndex}`}>{display(total(entries, [shiftIndex], section.rows, metricIndex))}</td>))}</tr></>;
}
