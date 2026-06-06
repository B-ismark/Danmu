'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { useCompose, useSettings, useStudio } from '@/lib/store';
import { Icon } from '@/components/ui/Icon';
import { Dot } from '@/components/ui/primitives';
import { SecondaryNav } from '@/components/studio/SecondaryNav';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { renderRoom, ImagenError, type ImagenModel } from '@/lib/imagen';
import { renderHF } from '@/lib/hf';
import { roomStore, type RenderVariant } from '@/lib/storage';
import { composePrompt, estimateRenderCost } from '@/lib/prompt';
import { useScene } from '@/lib/scene-store';
import {
  blobToBase64,
  downscaleBlob,
  cropFromBbox,
} from '@/lib/mask';
import type { ObjectRef } from '@/lib/imagen';
import { v4 as uuid } from 'uuid';

const PHASES = [
  { id: 'read', label: 'Reading your layout', model: 'Furniture + walls' },
  { id: 'light', label: 'Setting the light', model: 'Natural daylight' },
  { id: 'materials', label: 'Dressing surfaces', model: 'Wood · fabric · stone' },
  { id: 'paint', label: 'Painting the scene', model: 'Photo-real pass' },
  { id: 'polish', label: 'Polishing details', model: 'Shadows + texture' },
  { id: 'finish', label: 'Finishing up', model: 'Almost there' },
];

export default function RenderPage() {
  const router = useRouter();
  const { roomId } = useParams<{ roomId: string }>();
  const { styleId, budget, renderModel, variants, customPrompt, setRenderModel } = useCompose();
  const apiKey = useSettings((s) => s.apiKey);
  const viewPreset = useStudio((s) => s.viewPreset);
  const currency = useSettings((s) => s.currency);
  const [phaseIdx, setPhaseIdx] = useState(0);

  const sceneParts = useScene((s) => s.parts);
  const lockedNames = useMemo(
    () => sceneParts.filter((p) => p.locked).map((p) => p.name),
    [sceneParts],
  );
  const ghostNamesRaw = useMemo(
    () => sceneParts.filter((p) => !p.locked).map((p) => p.name),
    [sceneParts],
  );

  const cost = estimateRenderCost(variants, renderModel, currency);

  // Pick "edit-mask edge" dynamically — paid models can absorb a higher-res reference.
  const REF_EDGE = renderModel === 'free' || renderModel === 'exp' ? 1024 : 1536;

  const mutation = useMutation({
    mutationFn: async () => {
      // Whole-render watchdog. HF Kontext-dev frequently hangs past 90s on cold
      // starts; give it 80s before surfacing an error so the user can retry.
      // Gemini/Imagen need longer — the 120s SDK timeout fires first for those.
      const currentModel = useCompose.getState().renderModel;
      const GUARD_MS = currentModel === 'hf' ? 45_000 : 55_000;
      const guard = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new ImagenError(
                'UNKNOWN',
                'The preview took too long and was stopped. The image service is slow or busy right now — try again in a moment.',
              ),
            ),
          GUARD_MS,
        ),
      );
      const work = (async (): Promise<RenderVariant[]> => {
      // Read the model fresh from the store (not the render-time closure) so a
      // mid-flight switch — e.g. the error screen's "Use free Nano Banana" —
      // takes effect on the very next mutate() without a stale value.
      const rm = useCompose.getState().renderModel;

      // Load room context once: detections + base photo for reference.
      const room = await roomStore.loadRoom(roomId);
      const captures = await roomStore.loadCaptures(roomId);
      // Anchor render on the slot with the most edits; fall back to S, then first.
      const allDets = room?.detectedObjects ?? [];
      const slotEditCount: Record<string, number> = {};
      for (const d of allDets) {
        const slot = d.label.match(/__slot:([nesw])$/)?.[1] ?? 's';
        if (d.locked || d.dstBox || d.removed) slotEditCount[slot] = (slotEditCount[slot] ?? 0) + 1;
      }
      const bestSlot = Object.entries(slotEditCount).sort((a, b) => b[1] - a[1])[0]?.[0];
      const baseCap =
        (bestSlot ? captures.find((c) => c.slot === bestSlot) : undefined) ??
        captures.find((c) => c.slot === 's') ??
        captures[0];
      const activeSlot = baseCap?.slot;

      // Only the detections belonging to the anchor capture inform the edit mask + crops —
      // mixing detections from multiple walls would project them into the wrong coord space.
      const slotDets = allDets.filter((d) => {
        const slot = d.label.match(/__slot:([nesw])$/)?.[1] ?? 's';
        return slot === activeSlot;
      });

      let basePngBase64: string | undefined;
      let maskPngBase64: string | undefined;
      let baseMime: string | undefined;
      let objectRefs: ObjectRef[] | undefined;
      let isBlockout = false;

      // Always use the scene snapshot as the base image — it reflects the user's
      // CURRENT camera angle and object arrangement (SceneCapture keeps it live).
      // The captured photo is used only for per-object reference crops (identity
      // preservation) since its pixel coordinates don't map to the snapshot.
      const snap = await roomStore.loadSceneSnap(roomId);
      if (snap) {
        const small = await downscaleBlob(snap, REF_EDGE, 0.92);
        const dataUrl = await blobToBase64(small);
        basePngBase64 = dataUrl.split(',')[1] ?? dataUrl;
        baseMime = small.type || 'image/jpeg';
        isBlockout = true;
      }

      // Build per-object reference crops from the capture for identity preservation
      // (locked items + moved items). Mask is omitted — it's pixel-mapped to the
      // capture photo and would be wrong against the snapshot base.
      const hasIntent = slotDets.some((d) => d.locked || d.dstBox || d.removed);
      if (baseCap && hasIntent) {
        const refsCandidates = slotDets.filter(
          (d) => !d.removed && (d.locked || d.dstBox),
        );
        const built: ObjectRef[] = [];
        for (const d of refsCandidates) {
          if (built.length >= 6) break;
          const cropBlob = await cropFromBbox(baseCap.blob, d.box as [number, number, number, number]);
          const cropDataUrl = await blobToBase64(cropBlob);
          built.push({
            label: d.label.replace(/__slot:[nesw]$/, ''),
            pngBase64: cropDataUrl.split(',')[1] ?? cropDataUrl,
            mime: 'image/png',
            srcBox: d.box as [number, number, number, number],
            dstBox: d.dstBox as [number, number, number, number] | undefined,
            removed: d.removed,
            locked: d.locked,
          });
        }
        objectRefs = built.length > 0 ? built : undefined;
      }

      // Build the final prompt fresh against the room data we just loaded — this
      // closes the race window between component state and mutation.mutate().
      const movedNames = slotDets
        .filter((d) => d.dstBox && !d.removed)
        .map((d) => d.label.replace(/__slot:[nesw]$/, ''));
      const removedNames = slotDets
        .filter((d) => d.removed)
        .map((d) => d.label.replace(/__slot:[nesw]$/, ''));
      const ghostNames = ghostNamesRaw.filter(
        (n) => !movedNames.includes(n) && !removedNames.includes(n),
      );
      const composed =
        customPrompt ??
        composePrompt({ styleId, budget, lockedNames, ghostNames, movedNames, removedNames, viewPreset });

      // Dimension manifest — the model otherwise free-interprets scale, so a 3 m
      // sofa renders as a loveseat and the room loses its real proportions. Feed
      // it the actual room size + a furniture schedule (metric W×D×H) and tell it
      // to honour them exactly. Read parts fresh from the store.
      const manifestParts = useScene.getState().parts;
      const W = room?.width ?? 5.6;
      const D = room?.depth ?? 4.2;
      const H = room?.height ?? 2.8;
      const m = (mm: number) => (mm / 1000).toFixed(2);
      const schedule = manifestParts
        .slice(0, 16)
        .map((p) => `${p.name} ${m(p.dimMM[0])}×${m(p.dimMM[1])}×${m(p.dimMM[2])}m`)
        .join('; ');
      const dimManifest =
        `SCALE & DIMENSIONS — respect these exactly. The room measures ${W.toFixed(2)} m wide × ${D.toFixed(2)} m deep × ${H.toFixed(2)} m floor-to-ceiling. Render every object at correct real-world human scale relative to those measurements; keep the layout, and each item's footprint, proportions, position and orientation exactly as shown in the reference image — do NOT enlarge, shrink, move, rotate, or rearrange anything, and avoid wide-angle/fisheye distortion.` +
        (schedule ? ` This is the COMPLETE and EXCLUSIVE furniture inventory (width×depth×height) — render these items and NOTHING else: ${schedule}. Do NOT invent, add, or duplicate any freestanding furniture, decor, plants, rugs, artwork, or objects that are not in this list.` : '');

      // When rendering from the 3D blockout, tell the model what the base image
      // is so it reimagines rather than copies the flat-shaded primitives.
      const base = isBlockout
        ? `The reference image is a rough, flat-shaded 3D BLOCKOUT that defines the FINAL, COMPLETE layout — it shows the exact camera angle, the exact number of furniture pieces, and the exact position, size, and orientation of each one. Reproduce that layout faithfully: same items, same count, same placement, same facing direction — add nothing and move nothing. Your output must look like a REAL PHOTOGRAPH someone took standing in the finished room from this exact viewpoint — absolutely NOT a 3D render of these primitives. Replace each placeholder with a real, fully detailed version of that same furniture and authentic materials, and relight the whole scene with natural photographic lighting. ${composed}`
        : composed;
      const finalPrompt = `${base}\n\n${dimManifest}`;

      // FLUX.1 has a ~512-token context limit. The full finalPrompt (blockout
      // wrapper + style tokens + dim manifest) easily exceeds that and is silently
      // truncated, causing inconsistent results. Use a compact prompt for HF.
      const hfPrompt = isBlockout
        ? `Photorealistic interior room photograph. ${composed}. Use the reference image as the exact room layout — same camera angle, same furniture placement and count. Replace flat 3D primitives with real, detailed materials. Natural photographic lighting. Not a 3D render.`
        : composed;

      let result;
      if (rm === 'hf') {
        // Hugging Face FLUX path (BYO HF token). img2img when a base image
        // exists (preserves the arrangement), else text-to-image.
        const hfToken = useSettings.getState().hfToken;
        result = await renderHF(hfToken, {
          prompt: hfPrompt,
          model: 'gemini-2.5-flash-image', // ignored by renderHF; field is required on RenderRequest
          aspectRatio: '4:3',
          numberOfImages: variants,
          basePngBase64,
          baseMime,
        });
      } else {
        const model: ImagenModel =
          rm === 'ultra'
            ? 'imagen-4.0-ultra-generate-001'
            : rm === 'eco'
              ? 'imagen-4.0-generate-001'
              : rm === 'exp'
                ? 'gemini-2.0-flash-exp'
                : 'gemini-2.5-flash-image';
        result = await renderRoom(apiKey, {
          prompt: finalPrompt,
          model,
          aspectRatio: '4:3',
          numberOfImages: variants,
          basePngBase64,
          maskPngBase64,
          baseMime,
          objectRefs,
        });
      }

      const seed = Math.floor(Math.random() * 10000);
      const variantsOut: RenderVariant[] = [];
      for (const [i, v] of result.variants.entries()) {
        const finalBlob = base64ToBlob(v.pngBase64, v.mimeType);
        const variant: RenderVariant = {
          id: `${Date.now()}-${i}-${uuid().slice(0, 8)}`,
          blob: finalBlob,
          prompt: finalPrompt,
          seed: seed + i,
          createdAt: Date.now(),
          costAmount: cost.amount / variants,
          costCurrency: currency,
        };
        await roomStore.saveRender(roomId, variant);
        variantsOut.push(variant);
      }
      return variantsOut;
      })();
      return Promise.race([work, guard]);
    },
    onSuccess: () => {
      router.push(`/room/${roomId}/compare`);
    },
  });

  // Kick off + cycle phase visuals while pending. Ref-guarded so React 18
  // StrictMode's double-mount (dev) doesn't fire two billable render calls.
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    mutation.mutate();
    // we deliberately fire once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase theater advances to the real long step ("Generate", idx 4 → 83%) then
  // holds — it used to freeze at idx 3 / 67%, which read as "stuck".
  useEffect(() => {
    if (!mutation.isPending) return;
    const t = setInterval(() => setPhaseIdx((i) => (i < 4 ? i + 1 : 4)), 900);
    return () => clearInterval(t);
  }, [mutation.isPending]);

  // Honest elapsed clock so a slow-but-alive render doesn't look frozen.
  const [elapsed, setElapsed] = useState(0);
  // Wall-clock safety net. setTimeout/setInterval are throttled to ~1/min in
  // background tabs, so the in-promise guard can fail to fire if the user tabs
  // away while waiting — leaving the overlay spinning for minutes. We track a
  // real start timestamp and force a timeout when (a) an interval tick notices
  // we're past the ceiling, or (b) the tab regains focus past the ceiling.
  const [forcedTimeout, setForcedTimeout] = useState(false);
  const startedAt = useRef(0);
  const HARD_CAP_MS = 60_000;
  useEffect(() => {
    if (!mutation.isPending) {
      setElapsed(0);
      setForcedTimeout(false);
      startedAt.current = 0;
      return;
    }
    startedAt.current = Date.now();
    const check = () => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
      if (Date.now() - startedAt.current > HARD_CAP_MS) setForcedTimeout(true);
    };
    const t = setInterval(check, 1000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, [mutation.isPending]);

  const err =
    mutation.error instanceof ImagenError
      ? mutation.error
      : forcedTimeout
        ? new ImagenError('UNKNOWN', 'The preview took too long and was stopped. The image service is slow or busy right now — try again in a moment.')
        : null;

  if (err) {
    return (
      <ErrorView
        err={err}
        onRetry={() => {
          setForcedTimeout(false);
          setPhaseIdx(0);
          mutation.reset();
          mutation.mutate();
        }}
        onBack={() => router.push(`/room/${roomId}/compose`)}
        onUseFree={
          renderModel !== 'free'
            ? () => {
                setForcedTimeout(false);
                setRenderModel('free');
                setPhaseIdx(0);
                mutation.reset();
                mutation.mutate();
              }
            : undefined
        }
      />
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <SecondaryNav eyebrow="Preview" title="Generating" />
    <div
      style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '1fr 360px',
        minHeight: 0,
      }}
    >
      <main
        style={{
          position: 'relative',
          overflow: 'hidden',
          padding: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        className="ds-grid-bg"
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            maxWidth: 1080,
            maxHeight: 720,
            border: '1px solid var(--ink)',
            overflow: 'hidden',
            background: '#0A0A08',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <div style={{ color: 'var(--accent)', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, letterSpacing: '0.02em', display: 'flex', alignItems: 'center' }}>
            <Dot color="var(--accent)" size={6} style={{ marginRight: 8 }} />
            Generating preview · {Math.min(95, 18 + phaseIdx * 18)}%
          </div>
        </div>
      </main>

      <aside
        style={{
          borderLeft: '1px solid var(--hairline)',
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          overflow: 'auto',
        }}
      >
        <div>
          <span className="ds-label">PIPELINE</span>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {PHASES.map((p, i) => {
              const done = i < phaseIdx;
              const active = i === phaseIdx;
              return (
                <div
                  key={p.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '24px 1fr',
                    gap: 10,
                    alignItems: 'center',
                    padding: '8px 10px',
                    border: active ? '1px solid var(--accent)' : '1px solid var(--hairline)',
                    background: active ? 'var(--accent-tint)' : done ? 'var(--paper)' : 'var(--paper-2)',
                  }}
                >
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      border: `1px solid ${done ? 'var(--ink)' : active ? 'var(--accent)' : 'var(--hairline-strong)'}`,
                      background: done ? 'var(--ink)' : active ? 'var(--accent)' : 'transparent',
                      color: done ? 'var(--paper)' : active ? '#fff' : 'var(--ink-3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9,
                      fontWeight: 500,
                    }}
                  >
                    {done ? <Icon name="check" size={10} /> : i + 1}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: done || active ? 'var(--ink)' : 'var(--ink-3)' }}>
                      {p.label}
                    </div>
                    <div className="mono" style={{ fontSize: 9, color: 'var(--ink-3)', letterSpacing: '0.06em', marginTop: 1 }}>
                      {p.model}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="ds-card" style={{ padding: '14px 16px' }}>
          <div className="ds-label" style={{ marginBottom: 6 }}>Preview</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
            {variants} look{variants > 1 ? 's' : ''} of your room
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.45 }}>
            Same layout, real materials and light.
          </div>
        </div>
      </aside>

      {mutation.isPending && (
        <LoadingOverlay
          title="Generating your render"
          step={Math.min(phaseIdx + 1, PHASES.length)}
          totalSteps={PHASES.length}
          description={
            `Turning your 3D layout into ${variants} photo-real look${variants > 1 ? 's' : ''} — same furniture, same arrangement.` +
            ` · ${elapsed}s` +
            (elapsed >= (renderModel === 'hf' ? 20 : 45) ? ' — taking a little longer than usual.' : '')
          }
          onCancel={() => {
            mutation.reset();
            router.push(`/room/${roomId}/compose`);
          }}
        />
      )}
    </div>
    </div>
  );
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bytes = atob(b64);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

function ErrorView({
  err,
  onRetry,
  onBack,
  onUseFree,
}: {
  err: ImagenError;
  onRetry: () => void;
  onBack: () => void;
  /** Present only when the current model is paid — one-click switch to free Nano Banana. */
  onUseFree?: () => void;
}) {
  // For a per-minute cap, honor Google's own retryDelay (falls back to a full
  // 60s window) and gate the Retry button on a countdown — an instant re-click
  // just re-trips the same limit.
  const initialWait = err.code === 'RATE_LIMIT' ? (err.retryAfterSec ?? 60) : 0;
  const [wait, setWait] = useState(initialWait);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearInterval(t);
  }, [wait]);

  const map = {
    NO_KEY: { title: 'Connect an image service', accent: '#C8472A', body: 'Add your access key in Settings to generate previews.' },
    INVALID_KEY: { title: 'That key didn’t work', accent: '#C8472A', body: 'Double-check the key in Settings and try again.' },
    SAFETY: { title: 'Couldn’t generate that look', accent: 'var(--warn)', body: 'Try a different style and generate again.' },
    OFFLINE: { title: 'You’re offline', accent: 'var(--warn)', body: 'Your device lost connection, so the preview stopped. Reconnect and try again — nothing was used.' },
    IMAGE_QUOTA_ZERO: {
      title: 'Preview unavailable on this key',
      accent: '#C8472A',
      body: 'Your current key can’t generate images. Open Settings to switch to a key that can, then try again.',
    },
    RATE_LIMIT: {
      title: 'Going a little too fast',
      accent: '#3A78C2',
      body: `Too many previews in a short window${err.retryAfterSec ? ` — wait ${err.retryAfterSec}s` : ''}. The button unlocks shortly.`,
    },
    DAILY_QUOTA: {
      title: 'Daily preview limit reached',
      accent: 'var(--warn)',
      body: 'You’ve hit today’s preview limit. It resets overnight — or adjust your key in Settings for more.',
    },
    PAID_PLAN_REQUIRED: {
      title: 'This option needs an upgrade',
      accent: 'var(--warn)',
      body: 'The selected quality needs a paid key. Try the standard preview, or update your key in Settings.',
    },
    UNKNOWN: { title: 'Something went wrong', accent: '#C8472A', body: err.message },
  } as const;
  const e = map[err.code];
  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center', padding: 40 }}>
      <div style={{ maxWidth: 480, width: '100%', border: '1px solid var(--hairline-strong)', background: 'var(--paper)' }}>
        <div style={{ height: 4, background: e.accent }} />
        <div style={{ padding: '22px 24px' }}>
          <div className="ds-kicker" style={{ color: e.accent, marginBottom: 6 }}>Couldn’t preview</div>
          <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>{e.title}</div>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>{e.body}</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 24px', background: 'var(--paper-2)', borderTop: '1px solid var(--hairline)' }}>
          {onUseFree && (
            <button
              className="ds-btn ds-btn--primary"
              style={{ height: 36, fontSize: 12.5, width: '100%', justifyContent: 'center', background: 'var(--success)', borderColor: 'var(--success)' }}
              onClick={onUseFree}
            >
              <Icon name="image" size={12} />
              Try the standard preview
            </button>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="ds-btn" style={{ height: 32, fontSize: 12, flex: 1, justifyContent: 'center' }} onClick={onBack}>
              <Icon name="arrow-left" size={11} />
              Back to compose
            </button>
            <button
              className={onUseFree ? 'ds-btn' : 'ds-btn ds-btn--primary'}
              style={{
                height: 32,
                fontSize: 12,
                flex: 1,
                justifyContent: 'center',
                ...(onUseFree ? {} : { background: e.accent, borderColor: e.accent }),
                opacity: wait > 0 ? 0.5 : 1,
                cursor: wait > 0 ? 'not-allowed' : 'pointer',
              }}
              disabled={wait > 0}
              onClick={onRetry}
            >
              <Icon name="refresh" size={11} />
              {wait > 0 ? `Retry in ${wait}s` : 'Retry'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
