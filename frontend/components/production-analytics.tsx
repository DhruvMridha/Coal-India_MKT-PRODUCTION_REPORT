'use client';

import { useMemo, useState, type ReactNode } from 'react';
import useSWR from 'swr';
import { Activity, CalendarDays, CloudRain, Database, Gauge, Layers3, Mountain, Truck } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { contractors, equipment, shifts, total, sum, type Entries } from '@/lib/report';
import { reports, targets as loadTargets } from '@/lib/report-store';

const fmt = (value: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value);

type Day = {
  date: string;
  label: string;
  coal: number;
  ob: number;
  coalTrips: number;
  obTrips: number;
  rain: number;
  shiftCoal: number[];
  shiftOb: number[];
  contractorCoal: number[];
  contractorOb: number[];
  equipmentCoal: number[];
  equipmentOb: number[];
};

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <section className="chart-card"><div className="chart-heading"><div><h3>{title}</h3><p>{subtitle}</p></div></div>{children}</section>;
}

function Plot({ children, height = 250 }: { children: ReactNode; height?: number }) {
  return <div className="plot" style={{ height }}><ResponsiveContainer width="100%" height="100%">{children as React.ReactElement}</ResponsiveContainer></div>;
}

function subtractDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

export function ProductionAnalytics({ today, targets, userId }: { today: string; targets: { coal: number | null; ob: number | null }; userId?: string }) {
  const [period, setPeriod] = useState('30');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const start = period === 'custom' ? (from || '2000-01-01') : subtractDays(today, Number(period) - 1);
  const end = period === 'custom' ? (to || today) : today;
  const { data: saved = [], error } = useSWR(userId ? ['mtk-analytics', userId, start, end] : null, () => reports(start, end));
  const { data: targetRows = [] } = useSWR(userId ? ['mtk-targets', userId, start, end] : null, () => loadTargets(start, end));

  const days = useMemo<Day[]>(() => saved.map(record => {
    const e = record.entries as Entries;
    const shiftCoal = shifts.map((_, shift) => total(e, [shift], [...contractors, ...equipment], 1) ?? 0);
    const shiftOb = shifts.map((_, shift) => total(e, [shift], [...contractors, ...equipment], 3) ?? 0);
    const contractorCoal = contractors.map(source => total(e, [0, 1, 2], [source], 1) ?? 0);
    const contractorOb = contractors.map(source => total(e, [0, 1, 2], [source], 3) ?? 0);
    const equipmentCoal = equipment.map(source => total(e, [0, 1, 2], [source], 1) ?? 0);
    const equipmentOb = equipment.map(source => total(e, [0, 1, 2], [source], 3) ?? 0);
    const rainValues = [0, 1, 2].map(shift => e[`rain:${shift}`]);
    return {
      date: record.day,
      label: new Date(`${record.day}T12:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' }),
      coal: total(e, [0, 1, 2], [...contractors, ...equipment], 1) ?? 0,
      ob: total(e, [0, 1, 2], [...contractors, ...equipment], 3) ?? 0,
      coalTrips: total(e, [0, 1, 2], [...contractors, ...equipment], 0) ?? 0,
      obTrips: total(e, [0, 1, 2], [...contractors, ...equipment], 2) ?? 0,
      rain: sum(rainValues) ?? 0,
      shiftCoal,
      shiftOb,
      contractorCoal,
      contractorOb,
      equipmentCoal,
      equipmentOb,
    };
  }).sort((a, b) => a.date.localeCompare(b.date)), [saved]);

  const totals = useMemo(() => days.reduce((acc, day) => ({
    coal: acc.coal + day.coal,
    ob: acc.ob + day.ob,
    coalTrips: acc.coalTrips + day.coalTrips,
    obTrips: acc.obTrips + day.obTrips,
    rain: acc.rain + day.rain,
  }), { coal: 0, ob: 0, coalTrips: 0, obTrips: 0, rain: 0 }), [days]);

  const coalGoal = targetRows.find(row => row.day === end)?.coal_qty ?? targets.coal;
  const obGoal = targetRows.find(row => row.day === end)?.ob_qty ?? targets.ob;
  const byShift = shifts.map((name, index) => ({
    name: ['First', 'Second', 'Third'][index],
    coal: days.reduce((value, day) => value + day.shiftCoal[index], 0),
    ob: days.reduce((value, day) => value + day.shiftOb[index], 0),
  }));
  const byContractor = contractors.map((name, index) => ({
    name,
    coal: days.reduce((value, day) => value + day.contractorCoal[index], 0),
    ob: days.reduce((value, day) => value + day.contractorOb[index], 0),
  }));
  const byEquipment = equipment.map((name, index) => ({
    name: name.replace('Payloader198', 'Payloader 198'),
    coal: days.reduce((value, day) => value + day.equipmentCoal[index], 0),
    ob: days.reduce((value, day) => value + day.equipmentOb[index], 0),
  }));
  const cards = [
    { label: 'Coal production', value: fmt(totals.coal), unit: 'Ton', icon: Mountain },
    { label: 'OB production', value: fmt(totals.ob), unit: 'Cum.', icon: Layers3 },
    { label: 'Coal trips', value: fmt(totals.coalTrips), unit: 'trips', icon: Truck },
    { label: 'OB trips', value: fmt(totals.obTrips), unit: 'trips', icon: Activity },
    { label: 'Rainfall', value: totals.rain.toFixed(1), unit: 'MM', icon: CloudRain },
    { label: 'Saved reports', value: String(days.length), unit: 'days', icon: Gauge },
  ];

  return <div className="analytics-content">
    <div className="demo-notice"><div><p>{userId ? 'Database-backed saved report analytics.' : 'Sign in to view database-backed analytics.'}</p></div><div className="range-controls"><label><CalendarDays/><select aria-label="Analytics date range" value={period} onChange={event => setPeriod(event.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="custom">Custom range</option></select></label>{period === 'custom' && <><input aria-label="Start date" type="date" value={from} max={today} onChange={e => setFrom(e.target.value)} /><input aria-label="End date" type="date" value={to} max={today} onChange={e => setTo(e.target.value)} /></>}</div></div>
    {!userId && <div className="inline-alert warning"><Database/><span><strong>Sign-in required.</strong> Analytics are protected by Supabase report access policies.</span></div>}
    {error && <div className="inline-alert error"><Database/><span>Saved reports could not be loaded. No sample data is shown.</span></div>}
    {!error && userId && saved.length === 0 && <div className="history-state"><Database/><h3>No saved reports in this range</h3><p>Analytics will appear after authorized reports are saved.</p></div>}
    <div className="kpi-grid">{cards.map(({ label, value, unit, icon: Icon }) => <article className="metric-card" key={label}><div className="metric-top"><span>{label}</span><Icon/></div><div className="metric-value">{value}<small>{unit}</small></div></article>)}</div>
    {days.length > 0 && <div className="chart-grid">
      <ChartCard title="Coal and OB production" subtitle="Daily totals from saved reports"><Plot><AreaChart data={days}><CartesianGrid stroke="#E7E8EC" vertical={false}/><XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24}/><YAxis tickLine={false} axisLine={false} width={48}/><Tooltip formatter={(value, name) => [`${fmt(Number(value))} ${name === 'coal' ? 'Ton' : 'Cum.'}`, name === 'coal' ? 'Coal' : 'OB']}/><Area dataKey="coal" name="coal" type="monotone" stroke="#2444CF" fill="#DCE3FB"/><Area dataKey="ob" name="ob" type="monotone" stroke="#17191D" fill="#E7E8EC"/></AreaChart></Plot></ChartCard>
      <ChartCard title="Shift-wise production" subtitle="Coal and OB quantity across selected reports"><Plot><BarChart data={byShift}><CartesianGrid stroke="#E7E8EC" vertical={false}/><XAxis dataKey="name" tickLine={false} axisLine={false}/><YAxis tickLine={false} axisLine={false} width={48}/><Tooltip/><Bar dataKey="coal" name="Coal · Ton" fill="#2444CF"/><Bar dataKey="ob" name="OB · Cum." fill="#8790A2"/></BarChart></Plot></ChartCard>
      <ChartCard title="Contractor-wise production" subtitle="MTK-1 totals"><Plot height={280}><BarChart data={byContractor}><CartesianGrid stroke="#E7E8EC" vertical={false}/><XAxis dataKey="name" tickLine={false} axisLine={false}/><YAxis tickLine={false} axisLine={false} width={48}/><Tooltip/><Bar dataKey="coal" name="Coal · Ton" fill="#2444CF"/><Bar dataKey="ob" name="OB · Cum." fill="#8790A2"/></BarChart></Plot></ChartCard>
      <ChartCard title="Equipment-wise production" subtitle="MTK-2 totals"><Plot height={300}><BarChart data={byEquipment} layout="vertical" margin={{ left: 12 }}><CartesianGrid stroke="#E7E8EC" horizontal={false}/><XAxis type="number" tickLine={false} axisLine={false}/><YAxis type="category" dataKey="name" width={95} tickLine={false} axisLine={false} tick={{ fontSize: 10 }}/><Tooltip/><Bar dataKey="coal" name="Coal · Ton" fill="#2444CF"/><Bar dataKey="ob" name="OB · Cum." fill="#8790A2"/></BarChart></Plot></ChartCard>
      <ChartCard title="Rainfall" subtitle="Daily rainfall from saved reports"><Plot><AreaChart data={days}><CartesianGrid stroke="#E7E8EC" vertical={false}/><XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24}/><YAxis tickLine={false} axisLine={false} width={48}/><Tooltip formatter={value => [`${Number(value).toFixed(1)} MM`, 'Rainfall']}/><Area dataKey="rain" type="monotone" stroke="#2444CF" fill="#DCE3FB"/></AreaChart></Plot></ChartCard>
      <ChartCard title="Target comparison" subtitle="Approved database targets, when configured"><div className="paired-plots"><div><strong className="plot-label">Coal · Ton / day</strong><Plot><BarChart data={[{ name: 'Actual', value: days.length ? totals.coal / days.length : 0 }, ...(coalGoal == null ? [] : [{ name: 'Target', value: coalGoal }])]}><XAxis dataKey="name"/><YAxis/><Tooltip/><Bar dataKey="value" fill="#2444CF"/></BarChart></Plot></div><div><strong className="plot-label">OB · Cum. / day</strong><Plot><BarChart data={[{ name: 'Actual', value: days.length ? totals.ob / days.length : 0 }, ...(obGoal == null ? [] : [{ name: 'Target', value: obGoal }])]}><XAxis dataKey="name"/><YAxis/><Tooltip/><Bar dataKey="value" fill="#8790A2"/></BarChart></Plot></div></div></ChartCard>
    </div>}
  </div>;
}
