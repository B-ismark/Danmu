'use client';

// The ideas gallery: several arrangements of this room at once, a page at a time.
// Press one and the room takes it, so the 3D view is the big preview and the card
// is the thumbnail; press another and the room takes that one instead; "Back to
// your room" puts back what was there when the gallery opened. The heart keeps an
// idea as a saved layout, and "Kept in place" names the pieces every idea leaves
// where they are, so keeping the bed and asking again gets new ideas around it.
//
// It replaces the Shuffle button, which applied one arrangement per press and threw
// the rest of each search away. Everything the gallery decides that is not a React
// question is in `lib/layout-ideas.ts`.
//
// ── One session per room, outside the component ────────────────────────────────
//
// `RoomTools` unmounts on a tab switch (3D Model and 2D Plan are different routes),
// which is the lesson `APP_PLACED` there records twice. So the session is a small
// module store keyed by room: switch tabs and the ideas, the page and the running
// search are all still there.
//
// ── What each idea is measured against ─────────────────────────────────────────
//
// `base` is the room as it stood when the ideas were asked for, and every idea is
// arranged against it and applied onto it (see `ideaTransforms`). `origin` is the
// room as it stood when the gallery opened, which is what "Back to your room" means.
// They are the same until a piece is kept in place: then the gallery asks again
// from the room ON SCREEN, so the kept piece stays where the idea just put it, and
// `origin` stays the room the person started from.
//
// The session is `stale` when the room changes under it some other way (a drag, a
// resize, a new piece): its thumbnails describe a room that no longer exists, so it
// says so and offers to look again rather than applying an idea over the edit.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useParams } from 'next/navigation';
import { create } from 'zustand';
import { useScene } from '@/lib/scene-store';
import { currentRoomScene } from '@/lib/room-scene';
import { useSettings, useStudio } from '@/lib/store';
import { analyzeRoom } from '@/lib/clearance';
import { movableFor, type SolveResult } from '@/lib/layout-solve';
import { groupsToUngroup, lockedForShuffle, shuffleBlockers, shuffleRefusal, type ShuffleRoom } from '@/lib/layout-shuffle';
import { shuffleOffThread } from '@/lib/layout-offload';
import { newLayout, roomStore } from '@/lib/storage';
import {
  DRY_SEARCHES,
  freeName,
  IDEAS_PER_PAGE,
  ideaCaption,
  ideaTransforms,
  MAX_IDEAS,
  pageOf,
  pageRange,
  ideaMoved,
  seatsDown,
  transformsKey,
  wantsMore,
  type Idea,
} from '@/lib/layout-ideas';
import type { ScenePart } from '@/lib/scene-spec';
import { IconButton, Spinner } from '@/components/ui/primitives';
import { Select } from '@/components/ui/Select';
import { Icon } from '@/components/ui/Icon';
import { toast } from '@/components/ui/StorageToast';
import { afterPaint } from '@/lib/after-paint';
import { MiniPlan, miniPlanBox } from './MiniPlan';
import { useBesideRail } from './useBesideRail';
import { usePhoneStudio } from './NarrowViewportBanner';
import { isTypingOrDialog } from './KeyboardShortcuts';
import type { AppPlacedRef } from './RoomTools';

type Maps = {
  positions: Record<string, [number, number, number]>;
  rotations: Record<string, number>;
  dims: Record<string, [number, number, number]>;
};

type ShownIdea = Idea & {
  /** Its number in this gallery, for its name: "Idea 3". */
  n: number;
  lead: string | null;
  count: string;
  /** `transformsKey` of the room it produces, which is how "this one is on screen"
   *  is known: by content, so an undo back onto it still counts. */
  key: string;
  /** The saved layout its heart wrote, or null. */
  savedId: string | null;
};

type Session = {
  roomId: string;
  origin: Maps & { key: string };
  base: Maps & {
    key: string;
    /** Resolved, index-aligned to every idea's placements — and what the ideas were
     *  arranged against, so a seat standing on a table or a bed is on the floor beside
     *  it here (`seatsDown`). */
    parts: ScenePart[];
    /** The indices `seatsDown` set down. Every idea writes them (`ideaMoved`). */
    down: number[];
    /** The room as it stands, before `seatsDown`. What Room check reports on, so the
     *  empty state reads its findings off this and not off `parts`: a seat set down
     *  beside its table may stand in a walkway the room on screen keeps clear. */
    standing: ScenePart[];
    room: ShuffleRoom;
    pinned: Record<string, boolean>;
    sceneKey: string;
    pinKey: string;
  };
  ideas: ShownIdea[];
  page: number;
  searching: boolean;
  /** Searches in a row that found nothing new. */
  dry: number;
  attempt: number;
  /** Bumped whenever the base changes, so a search that was running for the old
   *  base lands nowhere. */
  run: number;
  numbered: number;
  /** Every idea's key this gallery has produced, across every ask-again, so an undo
   *  back onto one of them is not mistaken for a hand edit after the list moved on. */
  seen: string[];
  /** What `APP_PLACED` said when the gallery opened, and which ids its tries have
   *  written since: "Back to your room" puts the record back with the room, or Fix
   *  would treat a piece it placed itself as one the user placed by hand. */
  originPlaced: [string, { pos: [number, number, number]; rot: number }][];
  touched: string[];
  /** The last search failed. Not a dry search: saying "every layout it tried left
   *  something in the way" about an error would be false. */
  failed: boolean;
};

/** Ideas whose heart is being written, so a double press cannot save one twice. */
const SAVING = new Set<string>();

/** Every session's `run`, never reused: a search still in flight for a session that
 *  has been replaced must find no session with its number, even if the replacement
 *  began from nothing. */
let RUNS = 0;

export const useIdeas = create<{ session: Session | null }>(() => ({ session: null }));

function setSession(patch: Partial<Session>) {
  const s = useIdeas.getState().session;
  if (s) useIdeas.setState({ session: { ...s, ...patch } });
}

/** The authored scene and the room shell, by content. What the ideas were arranged
 *  against; any change to it makes them describe another room. */
function sceneKeyOf(parts: readonly ScenePart[], room: { footprint: unknown; height: number }): string {
  return JSON.stringify([
    parts.map((p) => [p.id, p.pos, p.rot, p.dimMM, p.category, p.shape, p.locked, p.wallMounted]),
    room.footprint,
    room.height,
  ]);
}

const pinKeyOf = (pinned: Record<string, boolean>) =>
  Object.keys(pinned)
    .filter((id) => pinned[id])
    .sort()
    .join('|');

/** A new session on the room as it is now. `from` keeps an existing session's
 *  origin, numbering and memory: that is the keep-a-piece-and-ask-again path. */
function begin(roomId: string, from: Session | null, placed: AppPlacedRef['current']): Session {
  const t = useStudio.getState();
  const room = useScene.getState().room;
  const maps: Maps = { positions: t.positions, rotations: t.rotations, dims: t.dims };
  const key = transformsKey(maps);
  const standing = currentRoomScene();
  const { parts, down } = seatsDown(standing, lockedForShuffle(standing, t.pinned), room.footprint);
  return {
    roomId,
    origin: from?.origin ?? { ...maps, key },
    base: {
      ...maps,
      key,
      parts,
      down,
      standing,
      room: { footprint: room.footprint, height: room.height },
      pinned: t.pinned,
      sceneKey: sceneKeyOf(useScene.getState().parts, room),
      pinKey: pinKeyOf(t.pinned),
    },
    ideas: [],
    page: 0,
    searching: false,
    dry: 0,
    attempt: 1,
    run: ++RUNS,
    numbered: from?.numbered ?? 0,
    seen: from?.seen ?? [],
    originPlaced: from?.originPlaced ?? [...placed.entries()],
    touched: from?.touched ?? [],
    failed: false,
  };
}

/** A search's answer, added to the session it was asked for and nowhere else. */
function land(run: number, attempt: number, found: SolveResult[] | 'failed') {
  const s = useIdeas.getState().session;
  if (!s || s.run !== run) return;
  if (found === 'failed') {
    setSession({ failed: true, searching: false, attempt: attempt + 1 });
    return;
  }
  let n = s.numbered;
  const fresh = found.slice(0, MAX_IDEAS - s.ideas.length).map((r): ShownIdea => {
    n += 1;
    const idea = { id: `${run}-${n}`, placements: r.placements, moved: ideaMoved(r.moved, s.base.down) };
    const t = ideaTransforms(s.base, s.base.parts, idea);
    return {
      ...idea,
      ...ideaCaption(s.base.parts, s.base.room.footprint, idea),
      n,
      key: transformsKey({ ...t, dims: s.base.dims }),
      savedId: null,
    };
  });
  setSession({
    ideas: [...s.ideas, ...fresh],
    seen: [...s.seen, ...fresh.map((i) => i.key)],
    numbered: n,
    dry: fresh.length > 0 ? 0 : s.dry + 1,
    attempt: attempt + 1,
    searching: false,
  });
}

type Status = 'ok' | 'stale' | 'rebase';

export function IdeasPanel({
  anchorRef,
  onClose,
  appPlaced,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  appPlaced: AppPlacedRef;
}) {
  const { roomId: routeRoom } = useParams<{ roomId: string }>();
  // One shared bucket without a route param, the safe direction for the reason
  // the old Shuffle history gave: the worst it does is carry ideas across.
  const roomId = routeRoom ?? '~';
  const phone = usePhoneStudio();
  const size = phone ? IDEAS_PER_PAGE.phone : IDEAS_PER_PAGE.wide;
  const pos = useBesideRail(anchorRef, true, { width: 344, tall: phone ? 380 : 520, fullWidth: phone });
  // On a phone there is no room beside anything, so the card rests on the studio's
  // bottom bar and grows upward, rather than hanging from its trigger and covering
  // the Room / Add / View buttons. `useBesideRail` still answers for the tablet.
  const dock = useDockTop(phone);

  const session = useIdeas((s) => (s.session?.roomId === roomId ? s.session : null));
  // Nothing is asked of a room that has not finished loading: a session begun on the
  // starter room would be marked stale the moment the real one arrived, and would
  // blame "your last edit" for it.
  const hydrated = useScene((s) => routeRoom === undefined || s.hydratedRoomId === routeRoom);
  const parts = useScene((s) => s.parts);
  const room = useScene((s) => s.room);
  const positions = useStudio((s) => s.positions);
  const rotations = useStudio((s) => s.rotations);
  const dims = useStudio((s) => s.dims);
  const pinned = useStudio((s) => s.pinned);
  const loadTransforms = useStudio((s) => s.loadTransforms);
  const togglePinned = useStudio((s) => s.togglePinned);

  const sceneKey = useMemo(() => sceneKeyOf(parts, room), [parts, room]);
  const tKey = useMemo(() => transformsKey({ positions, rotations, dims }), [positions, rotations, dims]);
  const pinKey = pinKeyOf(pinned);

  // A hand edit is checked BEFORE a pin change, because asking again keeps the
  // origin: after a drag, "Back to your room" would undo the drag.
  let status: Status = 'ok';
  if (session) {
    const handEdited = tKey !== session.origin.key && tKey !== session.base.key && !session.seen.includes(tKey);
    if (session.base.sceneKey !== sceneKey || handEdited) status = 'stale';
    else if (session.base.pinKey !== pinKey) status = 'rebase';
  }

  // Opening starts a session, or a fresh one when the room moved on while the
  // gallery was shut: there is nobody to show a "you changed the room" note to.
  const opened = useRef(false);
  useEffect(() => {
    if (!hydrated || opened.current) return;
    opened.current = true;
    if (!session || status === 'stale') useIdeas.setState({ session: begin(roomId, null, appPlaced.current) });
  }, [hydrated, session, status, roomId, appPlaced]);

  // A piece kept in place, or let go: ask again, from the room on screen.
  useEffect(() => {
    if (hydrated && status === 'rebase') useIdeas.setState({ session: begin(roomId, session, appPlaced.current) });
  }, [hydrated, status, roomId, session, appPlaced]);

  // A heart whose layout was deleted in the Layouts tab is not a heart.
  useEffect(() => {
    if (!routeRoom) return;
    let live = true;
    roomStore
      .listLayouts(routeRoom)
      .then((saved) => {
        const s = useIdeas.getState().session;
        if (!live || !s || s.roomId !== roomId) return;
        const ids = new Set(saved.map((l) => l.id));
        if (s.ideas.some((i) => i.savedId && !ids.has(i.savedId)))
          setSession({ ideas: s.ideas.map((i) => (i.savedId && !ids.has(i.savedId) ? { ...i, savedId: null } : i)) });
      })
      // Storage unreadable (a private window, blocked site data): the hearts stay
      // as this session last knew them, which is the most it can say.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [routeRoom, roomId]);

  const base = session?.base ?? null;
  const anyMovable = useMemo(
    () => (base ? movableFor(base.parts, lockedForShuffle(base.parts, base.pinned)).some(Boolean) : false),
    [base],
  );

  // The search: while this page and the next are not full. One at a time, since
  // each is up to twelve solves in the arranging worker.
  const searchable =
    session !== null &&
    hydrated &&
    status === 'ok' &&
    anyMovable &&
    !session.searching &&
    !session.failed &&
    wantsMore(session.ideas.length, session.page, size, session.dry);
  useEffect(() => {
    if (!searchable) return;
    const s = useIdeas.getState().session;
    // Re-read, not trusted from the render: a second run of this effect (React's
    // development double-mount) must not start a second search.
    if (!s || s.searching) return;
    const { run, attempt } = s;
    const ids = s.base.parts.map((p) => p.id);
    setSession({ searching: true });
    // After a paint, so "Finding more…" is on screen first. With the arranging
    // worker that costs two frames; on the inline fallback (no module workers) the
    // search holds the thread for seconds, and without the yield the panel would
    // freeze before it had said anything.
    afterPaint(() => {
      if (useIdeas.getState().session?.run !== run) return;
      shuffleOffThread({
        parts: s.base.parts,
        room: s.base.room,
        locked: lockedForShuffle(s.base.parts, s.base.pinned),
        opts: { attempt, history: s.ideas.map((i) => ({ ids, placements: i.placements })) },
      })
        .then((outcome) => land(run, attempt, outcome?.ideas ?? []))
        .catch((err) => {
          console.error('[ideas] the search failed', err);
          land(run, attempt, 'failed');
        });
    });
  }, [searchable]);

  // Esc closes it, yielding to a field or a dialog like the room panel does.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || isTypingOrDialog(e.target)) return;
      e.stopPropagation();
      onClose();
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const tryIdea = useCallback(
    (idea: ShownIdea) => {
      if (!base) return;
      const t = ideaTransforms(base, base.parts, idea);
      // dims carried through untouched: ideas move and turn, never resize.
      loadTransforms({ ...t, dims: base.dims });
      // The app moved these, so Fix may move them again freely (see `APP_PLACED`).
      const ids = idea.moved.map((i) => base.parts[i].id);
      for (const id of ids) appPlaced.current.set(id, { pos: t.positions[id], rot: t.rotations[id] });
      const s = useIdeas.getState().session;
      if (s) setSession({ touched: [...new Set([...s.touched, ...ids])] });
    },
    [base, loadTransforms, appPlaced],
  );

  /** The room as it was when the gallery opened, and the app's record of which of
   *  its pieces the app placed, as it was then too. */
  function backToRoom() {
    if (!session) return;
    loadTransforms(session.origin);
    const was = new Map(session.originPlaced);
    for (const id of session.touched) {
      const w = was.get(id);
      if (w) appPlaced.current.set(id, w);
      else appPlaced.current.delete(id);
    }
  }

  async function toggleSaved(idea: ShownIdea) {
    if (!routeRoom || !base || SAVING.has(idea.id)) return;
    SAVING.add(idea.id);
    try {
      await writeSaved(routeRoom, base, idea);
    } catch {
      toast({
        tone: 'danger',
        title: idea.savedId ? `Idea ${idea.n} is still in Layouts` : `Idea ${idea.n} was not saved`,
        message: 'This browser would not let Danmu write to its storage.',
      });
    } finally {
      SAVING.delete(idea.id);
    }
  }

  async function writeSaved(routeRoom: string, base: Session['base'], idea: ShownIdea) {
    const name = `Idea ${idea.n}`;
    if (idea.savedId) {
      await roomStore.deleteLayout(routeRoom, idea.savedId);
      patchIdea(idea.id, { savedId: null });
      toast({ title: `${name} removed from Layouts`, ttl: 4000 });
      return;
    }
    const t = ideaTransforms(base, base.parts, idea);
    const taken = (await roomStore.listLayouts(routeRoom)).map((l) => l.name);
    // The authored parts, with the idea as the override layer: the same two layers
    // "Save current" stores, so Apply resolves it the same way.
    const v = newLayout(
      freeName(name, taken),
      useScene.getState().parts,
      { ...t, dims: base.dims, parentIds: useStudio.getState().parentIds },
      { favourite: true },
    );
    await roomStore.saveLayout(routeRoom, v);
    patchIdea(idea.id, { savedId: v.id });
    toast({ title: `${v.name} saved to Layouts`, ttl: 4000 });
  }

  function patchIdea(id: string, patch: Partial<ShownIdea>) {
    const s = useIdeas.getState().session;
    if (s) setSession({ ideas: s.ideas.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  }

  const found = session?.ideas.length ?? 0;
  const exhausted = session !== null && session.dry >= DRY_SEARCHES;
  const failed = session?.failed ?? false;
  const lastPage = Math.max(0, Math.ceil(found / size) - 1);
  // A page past the last idea is only worth showing while more are coming. Pressed
  // Next into a search that then ran dry, it would be a blank card.
  const page = Math.min(session?.page ?? 0, exhausted || failed ? lastPage : Infinity);
  const shown = session ? pageOf(session.ideas, page, size) : [];
  const onScreen = session?.ideas.find((i) => i.key === tKey) ?? null;
  const expecting =
    session !== null && hydrated && anyMovable && status === 'ok' && !failed && wantsMore(found, page, size, session.dry);
  const placeholders = expecting ? size - shown.length : 0;
  const canNext = page < lastPage || (expecting && shown.length === size);
  const range = pageRange(page, size, found);
  const plan = miniPlanBox(room.footprint);

  // Pieces a person can keep or let go: everything an idea could move.
  const keepable = base ? base.parts.filter((p) => !p.wallMounted && !p.locked) : [];
  const kept = keepable.filter((p) => pinned[p.id]);
  const free = keepable.filter((p) => !pinned[p.id]);

  // Why the room has no ideas at all, asked only once it has run dry: the same two
  // sentences, from the same room check, that Shuffle's refusal used.
  const stepFree = useSettings((s) => s.stepFree);
  const dimUnit = useSettings((s) => s.dimUnit);
  const refusal = useMemo(() => {
    if (!base || !exhausted || found > 0) return null;
    const blockers = shuffleBlockers(analyzeRoom(base.standing, base.room, { accessibility: stepFree, dimUnit }).issues);
    const groups = groupsToUngroup(base.parts, lockedForShuffle(base.parts, base.pinned));
    return { ...shuffleRefusal(blockers, groups), blocked: blockers.length > 0 };
  }, [base, exhausted, found, stepFree, dimUnit]);

  return (
    <div
      className="ds-card ideas-panel"
      role="region"
      aria-label="Ideas for this room"
      style={{
        position: 'fixed',
        ...(dock === null
          ? { left: pos.left, width: pos.width, top: pos.top, maxHeight: `calc(100dvh - ${pos.top + 12}px)` }
          : {
              // A sheet over the Room sheet, edge to edge and flush with the bar, so
              // no strip of what it covers shows around it.
              left: 0,
              width: '100%',
              bottom: `calc(100dvh - ${dock}px)`,
              maxHeight: dock - 12,
              borderRadius: 'var(--r-card) var(--r-card) 0 0',
            }),
      }}
    >
      <div className="ideas-panel__head">
        <span className="ideas-panel__title">Ideas</span>
        {range && (
          <span className="mono t-micro">
            {range} of {found}
          </span>
        )}
        <span role="status" className="t-micro ideas-panel__status">
          {session?.searching && status === 'ok' && (
            <>
              <Spinner size={10} /> Finding more…
            </>
          )}
        </span>
        <IconButton icon="x" label="Close ideas" onClick={onClose} size={24} iconSize={12} />
      </div>

      {!hydrated ? (
        <div className="ideas-panel__note">
          <div className="t-hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Spinner size={10} /> Opening your room…
          </div>
        </div>
      ) : status === 'stale' ? (
        <div className="ideas-panel__note">
          <div className="t-small" style={{ fontWeight: 700 }}>The room changed</div>
          <div className="t-hint">These ideas were for the room before your last edit.</div>
          <button
            className="ds-btn ds-btn--xs"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => useIdeas.setState({ session: begin(roomId, null, appPlaced.current) })}
          >
            Find new ideas
          </button>
        </div>
      ) : base && !anyMovable ? (
        <div className="ideas-panel__note">
          <div className="t-small" style={{ fontWeight: 700 }}>Nothing here can move</div>
          {/* A group moves whole or not at all (`movableFor`), so a chair grouped with
              the TV on the wall is held by it — the third way a piece stays put. */}
          <div className="t-hint">Every piece is kept in place, fixed to a wall, or grouped with one that is.</div>
        </div>
      ) : failed && found === 0 ? (
        <div className="ideas-panel__note">
          <div className="t-small" style={{ fontWeight: 700 }}>The search stopped</div>
          <div className="t-hint">Something went wrong while looking for ideas. Your room is unchanged.</div>
          <button className="ds-btn ds-btn--xs" style={{ alignSelf: 'flex-start' }} onClick={() => setSession({ failed: false })}>
            Try again
          </button>
        </div>
      ) : refusal ? (
        <div className="ideas-panel__note">
          <div className="t-small" style={{ fontWeight: 700 }}>{refusal.title}</div>
          <div className="t-hint">{refusal.message}</div>
          {!refusal.blocked && (
            <button className="ds-btn ds-btn--xs" style={{ alignSelf: 'flex-start' }} onClick={() => setSession({ dry: 0 })}>
              Look again
            </button>
          )}
        </div>
      ) : (
        <div className={`ideas-grid ideas-grid--${phone ? 'phone' : 'wide'}`}>
          {shown.map((idea) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              base={base!}
              on={onScreen?.id === idea.id}
              onTry={() => tryIdea(idea)}
              onHeart={() => void toggleSaved(idea)}
            />
          ))}
          {/* Placeholders for the ideas being looked for: the header's live
              region says so in words, so these are decoration. */}
          {Array.from({ length: placeholders }, (_, i) => (
            <div key={`wait-${i}`} className="idea-card ds-skeleton" aria-hidden="true">
              <span className="ds-skeleton__block" style={{ aspectRatio: `${plan.W} / ${plan.H}` }} />
              <span className="ds-skeleton__line" />
              <span className="ds-skeleton__line ds-skeleton__line--short" />
            </div>
          ))}
          {exhausted && !failed && found > 0 && page === lastPage && shown.length < size && (
            <div className="t-hint ideas-grid__end">No more ideas for this room.</div>
          )}
          {failed && (
            <div className="t-hint ideas-grid__end">
              The search stopped.{' '}
              <button className="ds-btn ds-btn--xs" onClick={() => setSession({ failed: false })}>
                Try again
              </button>
            </div>
          )}
        </div>
      )}

      {base && keepable.length > 0 && status !== 'stale' && (
        <div className="ideas-panel__kept">
          <span className="ds-label">Kept in place</span>
          {kept.map((p) => (
            <span key={p.id} className="ds-chip ideas-chip">
              <span className="truncate">{p.name}</span>
              <IconButton icon="x" label={`Let ideas move ${p.name}`} onClick={() => togglePinned(p.id)} size={24} iconSize={10} />
            </span>
          ))}
          {free.length > 0 && (
            <Select
              options={free.map((p) => ({ value: p.id, label: p.name }))}
              value=""
              onChange={(id) => togglePinned(id)}
              placeholder={kept.length === 0 ? 'Keep a piece where it is…' : 'Keep another…'}
              ariaLabel="Keep a piece where it is"
              height={28}
              fontSize="var(--fs-small)"
            />
          )}
        </div>
      )}

      {status !== 'stale' && (found > 0 || onScreen || tKey !== session?.origin.key) && (
        <div className="ideas-panel__foot">
          {session && tKey !== session.origin.key && (
            <button className="ds-btn ds-btn--xs" onClick={backToRoom}>
              <Icon name="rotate-ccw" size={10} /> Back to your room
            </button>
          )}
          <span style={{ flex: 1 }} />
          <IconButton
            icon="chevron-left"
            label="Previous ideas"
            disabled={page === 0}
            onClick={() => setSession({ page: page - 1 })}
            size={28}
            iconSize={14}
          />
          <IconButton
            icon="chevron-right"
            label="More ideas"
            disabled={!canNext}
            onClick={() => setSession({ page: page + 1 })}
            size={28}
            iconSize={14}
          />
        </div>
      )}
    </div>
  );
}

/** The top of the phone's bottom bar, in viewport pixels, or null off a phone.
 *  Measured, like everything else that floats here, and kept true on resize. */
function useDockTop(phone: boolean): number | null {
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    if (!phone) {
      setTop(null);
      return;
    }
    const measure = () => {
      const bar = document.querySelector('.phone-toolbar');
      setTop(bar ? bar.getBoundingClientRect().top : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [phone]);
  return top;
}

function IdeaCard({
  idea,
  base,
  on,
  onTry,
  onHeart,
}: {
  idea: ShownIdea;
  base: Session['base'];
  on: boolean;
  onTry: () => void;
  onHeart: () => void;
}) {
  // The thumbnail draws the idea's room, with what it moves in the accent.
  const { parts, moved } = useMemo(() => {
    const at = new Set(idea.moved);
    return {
      parts: base.parts.map((p, i) =>
        at.has(i) ? { ...p, pos: [idea.placements[i].x, p.pos[1], idea.placements[i].z] as [number, number, number], rot: idea.placements[i].yaw } : p,
      ),
      moved: new Set(idea.moved.map((i) => base.parts[i].id)),
    };
  }, [idea, base]);
  const name = `Idea ${idea.n}`;
  return (
    <div className={`idea-card${on ? ' idea-card--on' : ''}`}>
      <button
        type="button"
        className="idea-card__pick"
        aria-pressed={on}
        aria-label={`${name}: ${idea.lead ? `${idea.lead}. ` : ''}${idea.count}`}
        onClick={onTry}
      >
        <MiniPlan parts={parts} footprint={base.room.footprint} fluid moved={moved} />
        {idea.lead && <span className="idea-card__lead">{idea.lead}</span>}
        <span className="idea-card__count">{idea.count}</span>
      </button>
      <button
        type="button"
        className="icon-btn idea-card__heart"
        aria-label={`Save ${name} to Layouts`}
        aria-pressed={idea.savedId !== null}
        onClick={onHeart}
      >
        <Icon name="heart" size={14} filled={idea.savedId !== null} />
      </button>
    </div>
  );
}
