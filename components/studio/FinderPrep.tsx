'use client';

// The furniture finder, offered on the PHOTOS screen. It used to be asked about only
// once the scan had started, in a card the scan's own veil covered, so the one thing
// that costs data and time arrived after the person had already pressed Continue.
// Asked here, it downloads while they take photos, and the scan screen joins the same
// download (`detectorDownloadInFlight`) rather than asking again.
//
// Shows nothing when there is nothing to fetch: already kept, served by this copy of
// the app, offline, or the runtime missing (the scan screen says that one).

import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { onMeteredConnection } from '@/lib/connection';
import {
  detectorDownloadInFlight,
  detectorStatus,
  downloadDetector,
  localDetectorAvailable,
  localRuntimeMissing,
  onDetectorDownload,
  type DetectorStatus,
  type DownloadProgress,
} from '@/lib/local-detect';
import { megabytes } from '@/lib/model-cache';

type Stage =
  | { kind: 'hidden' }
  | { kind: 'ask'; status: DetectorStatus; metered: boolean }
  | { kind: 'getting'; progress: DownloadProgress | null }
  | { kind: 'ready' }
  | { kind: 'failed' };

export function FinderPrep() {
  const [stage, setStage] = useState<Stage>({ kind: 'hidden' });

  function follow(run: Promise<boolean>, total: number) {
    setStage({ kind: 'getting', progress: null });
    onDetectorDownload((p) => setStage({ kind: 'getting', progress: p }), total);
    run
      .then((ok) => setStage(ok ? { kind: 'ready' } : { kind: 'failed' }))
      .catch(() => setStage({ kind: 'failed' }));
  }

  useEffect(() => {
    let gone = false;
    (async () => {
      const pending = detectorDownloadInFlight();
      if (pending) {
        if (!gone) follow(pending, 0);
        return;
      }
      if (!(await localDetectorAvailable()) || (await localRuntimeMissing())) return;
      const status = await detectorStatus('full');
      if (gone || status.owed === 0 || status.unreachable) return;
      setStage({ kind: 'ask', status, metered: onMeteredConnection() });
    })().catch(() => {});
    return () => {
      gone = true;
      // The download itself carries on: the scan screen picks it up.
      onDetectorDownload(null);
    };
  }, []);

  if (stage.kind === 'hidden') return null;

  if (stage.kind === 'ask') {
    const { status, metered } = stage;
    return (
      <section className="finder-prep" aria-label="Furniture finder">
        <Icon name="download" size={16} style={{ flex: '0 0 auto', marginTop: 2, color: 'var(--accent-text)' }} />
        <div className="finder-prep__body">
          <b>{status.update ? 'Update the furniture finder' : 'Get the furniture finder'}</b>
          <span className="t-hint">
            {megabytes(status.owed)}, one time. It finds furniture in your photos, on this device.
            {metered && ' You seem to be on mobile data.'}
          </span>
        </div>
        <div className="finder-prep__actions">
          <button className="ds-btn ds-btn--sm ds-btn--ghost" onClick={() => setStage({ kind: 'hidden' })}>
            Later
          </button>
          <button
            className="ds-btn ds-btn--sm ds-btn--accent"
            onClick={() => follow(downloadDetector('full'), status.owed)}
          >
            {status.update ? 'Update' : 'Download'}
          </button>
        </div>
      </section>
    );
  }

  if (stage.kind === 'getting') {
    const p = stage.progress;
    const share = p && p.total > 0 ? Math.min(1, p.loaded / p.total) : 0;
    return (
      <section className="finder-prep" aria-label="Furniture finder" aria-busy="true">
        <Icon name="download" size={16} style={{ flex: '0 0 auto', marginTop: 2, color: 'var(--accent-text)' }} />
        <div className="finder-prep__body">
          <b>Getting the furniture finder</b>
          <span className="t-hint">
            {p && p.total > 0 ? `${megabytes(p.loaded)} of ${megabytes(p.total)}. ` : ''}Keep adding photos.
          </span>
          <div
            className="lo-card__bar"
            role="progressbar"
            aria-label="Download"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(share * 100)}
          >
            <span style={{ transform: `scaleX(${share})` }} />
          </div>
        </div>
      </section>
    );
  }

  if (stage.kind === 'ready') {
    return (
      <section className="finder-prep finder-prep--done" aria-label="Furniture finder" role="status">
        <Icon name="check" size={16} style={{ flex: '0 0 auto', marginTop: 2, color: 'var(--accent-text)' }} />
        <div className="finder-prep__body">
          <b>Furniture finder ready</b>
        </div>
      </section>
    );
  }

  return (
    <section className="finder-prep" aria-label="Furniture finder" role="status">
      <Icon name="info" size={16} style={{ flex: '0 0 auto', marginTop: 2, color: 'var(--accent-text)' }} />
      <div className="finder-prep__body">
        <b>The download stopped</b>
        <span className="t-hint">You can try again when you continue.</span>
      </div>
      <div className="finder-prep__actions">
        <button className="ds-btn ds-btn--sm ds-btn--ghost" onClick={() => setStage({ kind: 'hidden' })}>
          Close
        </button>
      </div>
    </section>
  );
}
