'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSettings, useRoom } from '@/lib/store';
import { roomStore } from '@/lib/storage';
import { validateKey } from '@/lib/validate-key';
import { Icon } from '@/components/ui/Icon';
import { DanmuMark, Dot } from '@/components/ui/primitives';
import { useConfirm } from '@/components/ui/Confirm';

export default function SettingsPage() {
  const s = useSettings();
  const roomId = useRoom((r) => r.roomId);
  const confirm = useConfirm();
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);

  async function test() {
    setTesting(true);
    s.setKeyValid(null, null);
    const r = await validateKey(s.apiKey);
    s.setKeyValid(r.ok, r.reason ?? null);
    setTesting(false);
  }
  // Auto-validate on blur if user has typed a key and we don't have a result yet.
  async function autoValidate() {
    if (!s.apiKey || s.keyValid !== null) return;
    await test();
  }

  async function clearCache() {
    if (!roomId) return;
    const ok = await confirm({
      title: 'Clear local data?',
      body: 'Captures, detections and edits for the current room will be deleted.',
      confirmLabel: 'Clear',
      danger: true,
    });
    if (!ok) return;
    await roomStore.clearRoom(roomId);
    location.reload();
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)' }}>
      <div
        style={{
          height: 48,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '0 16px',
          borderBottom: '1px solid var(--hairline)',
        }}
      >
        <Link href="/workspace" style={{ display: 'flex' }}>
          <DanmuMark size={12} />
        </Link>
        <div style={{ width: 1, height: 18, background: 'var(--hairline)' }} />
        <span className="ds-label">Settings</span>
        <div style={{ flex: 1 }} />
        <Link href="/workspace" className="ds-btn" style={{ height: 28, fontSize: 12 }}>
          <Icon name="x" size={11} /> Close
        </Link>
      </div>

      <div style={{ padding: '32px 40px', maxWidth: 920 }}>
        <SecHeader eyebrow="Detection" title="Connect your detection key (optional)." desc="Used only to recognise furniture in your photos. Everything else runs on your device, no key needed." />

        <Row label="Access key" hint="Used to recognise furniture in your photos. Stored on this device only.">
          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', border: '1px solid var(--hairline-strong)', background: 'var(--paper)' }}>
              <input
                type={show ? 'text' : 'password'}
                value={s.apiKey}
                onChange={(e) => s.setApiKey(e.target.value)}
                onBlur={autoValidate}
                placeholder="AIza…"
                style={{
                  flex: 1,
                  border: 'none',
                  outline: 'none',
                  height: 36,
                  padding: '0 10px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  background: 'transparent',
                  color: 'var(--ink)',
                }}
              />
              <button
                onClick={() => setShow(!show)}
                style={{ width: 36, height: 36, background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                <Icon name={show ? 'eye-off' : 'eye'} size={13} color="var(--ink-3)" />
              </button>
            </div>
            <button onClick={test} disabled={testing || !s.apiKey} className="ds-btn" style={{ height: 36, fontSize: 12 }}>
              <Icon name="check" size={12} />
              {testing ? 'Testing…' : 'Test'}
            </button>
          </div>
          {s.keyValid !== null && (
            <div style={{ marginTop: 10 }}>
              {s.keyValid ? (
                <span className="ds-chip" style={{ borderColor: 'var(--success)', color: 'var(--success)' }}>
                  <Dot color="var(--success)" size={5} /> Valid · saved
                </span>
              ) : (
                <span className="ds-chip" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
                  ✗ Invalid · {s.keyValidReason?.slice(0, 80)}
                </span>
              )}
            </div>
          )}
          {s.keyValid === null && s.apiKey && !testing && (
            <div style={{ marginTop: 10 }}>
              <span className="ds-chip" style={{ borderColor: 'var(--ink-3)', color: 'var(--ink-3)' }}>
                ◌ untested · blur or click Test
              </span>
            </div>
          )}
          <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 12, lineHeight: 1.5 }}>
            <b>Tip:</b> for safety, restrict this key to this site in your provider&apos;s console.
          </p>
        </Row>

        <SecHeader eyebrow="Workspace" title="Preferences." desc="" />
        <Row label="Measurement units">
          <div style={{ display: 'flex', border: '1px solid var(--hairline-strong)' }}>
            {(['metric', 'imperial'] as const).map((u) => (
              <button
                key={u}
                onClick={() => s.setUnits(u)}
                style={{
                  padding: '8px 18px',
                  background: s.units === u ? 'var(--ink)' : 'transparent',
                  color: s.units === u ? 'var(--paper)' : 'var(--ink-2)',
                  border: 'none',
                  fontSize: 12,
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {u}
              </button>
            ))}
          </div>
        </Row>
        <SecHeader eyebrow="Data" title="Local-first storage." desc="Captures + edits live in this browser only." />
        <Row label="Clear local cache" hint="Removes captures, detections and edits for the current room.">
          <button onClick={clearCache} className="ds-btn" style={{ height: 32, fontSize: 12, color: 'var(--danger)', borderColor: 'var(--danger)' }}>
            <Icon name="trash" size={12} /> Clear room data
          </button>
        </Row>
      </div>
    </div>
  );
}

function SecHeader({ eyebrow, title, desc }: { eyebrow: string; title: string; desc: string }) {
  return (
    <div style={{ marginTop: 32, marginBottom: 4 }}>
      <div className="ds-kicker" style={{ color: 'var(--accent)', marginBottom: 8 }}>
        ↘ {eyebrow}
      </div>
      <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.015em', marginBottom: 6 }}>{title}</div>
      {desc && <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5, maxWidth: 580 }}>{desc}</div>}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '220px 1fr',
        gap: 30,
        padding: '18px 0',
        borderBottom: '1px solid var(--hairline-soft)',
        alignItems: 'flex-start',
      }}
    >
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 4 }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5 }}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}
