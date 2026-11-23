'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import useSWRImmutable from 'swr/immutable';
import { mutate as invalidate } from 'swr';
import { daily, save } from '@/lib/report-store';
import type { Entries } from '@/lib/report';

type Issue = { key: string; message: string } | null;
export function useProductionReport(date: string, uid: string | undefined) {
  const cacheKey = uid ? `mtk:${uid}:${date}` : '';
  const { data, error, mutate } = useSWRImmutable(uid ? ['mtk-day', uid, date] : null, () => daily(date));
  const [drafts, setDrafts] = useState<Record<string, Entries>>({});
  const [busyKey, setBusyKey] = useState('');
  const [issue, setIssue] = useState<Issue>(null);
  const locks = useRef(new Set<string>());
  const draft = drafts[cacheKey] ?? null;
  const currentIssue = issue?.key === cacheKey ? issue.message : '';
  const busy = Boolean(cacheKey && busyKey === cacheKey);

  useEffect(() => {
    if (!cacheKey) return;
    const raw = window.localStorage.getItem(`mtk-draft:${cacheKey}`);
    if (!raw) return;
    try {
      const recovered = JSON.parse(raw) as Entries;
      window.queueMicrotask(() => setDrafts(current => ({ ...current, [cacheKey]: recovered })));
    } catch {
      window.localStorage.removeItem(`mtk-draft:${cacheKey}`);
    }
  }, [cacheKey]);

  const persist = useCallback(async () => {
    if (!uid || !data || !cacheKey || locks.current.has(cacheKey) || currentIssue) return;
    locks.current.add(cacheKey);
    setBusyKey(cacheKey);
    const payload = drafts[cacheKey] ?? data.entries;
    try {
      const updated = await save(date, data.revision, payload);
      await mutate(updated, false);
      setDrafts(current => { const next = { ...current }; delete next[cacheKey]; return next; });
      window.localStorage.removeItem(`mtk-draft:${cacheKey}`);
      setIssue(current => current?.key === cacheKey ? null : current);
      void invalidate(key => Array.isArray(key) && key[0] === 'mtk-range');
    } catch (err) {
      const code = (err as { code?: string })?.code;
      setIssue({ key: cacheKey, message: code === '40001' ? 'Another operator saved this report. Review your draft before reloading.' : 'Save failed. Your draft is still here.' });
    } finally {
      locks.current.delete(cacheKey);
      setBusyKey(current => current === cacheKey ? '' : current);
    }
  }, [uid, data, cacheKey, currentIssue, drafts, date, mutate]);

  useEffect(() => {
    if (!draft || busy || currentIssue) return;
    const timer = window.setTimeout(() => void persist(), 900);
    return () => window.clearTimeout(timer);
  }, [draft, busy, currentIssue, persist]);
  useEffect(() => {
    if (!draft) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft]);

  return {
    entries: draft ?? data?.entries ?? {}, saved: data?.saved, busy, dirty: !!draft,
    ready: !!data && !error,
    status: !uid ? 'Sign in to edit' : error ? 'Load failed' : !data ? 'Loading…' : currentIssue ? 'Save error' : busy ? 'Saving…' : draft ? 'Unsaved changes' : data.revision ? 'Saved' : 'Not started',
    issue: currentIssue,
    change: (id: string, value: string) => {
      if (!data || locks.current.has(cacheKey)) return;
      setDrafts(current => {
        const nextDraft = { ...(current[cacheKey] ?? data.entries), [id]: value };
        window.localStorage.setItem(`mtk-draft:${cacheKey}`, JSON.stringify(nextDraft));
        return { ...current, [cacheKey]: nextDraft };
      });
    },
    persist,
    retry: () => { setIssue(current => current?.key === cacheKey ? null : current); if (error) void mutate(); },
    reload: async () => {
      if (!window.confirm('Discard your unsaved draft and load the latest report?')) return;
      try { await mutate(); setDrafts(current => { const next = { ...current }; delete next[cacheKey]; return next; }); setIssue(current => current?.key === cacheKey ? null : current); }
      catch { setIssue({ key: cacheKey, message: 'Reload failed. Your draft is still here.' }); }
    },
  };
}
