'use client';

// Getting a room out of the browser, and back in.
//
// The two halves live together because they are one format's two ends and their
// failure messages have to agree, but they appear in different places: you save
// from inside a room, and you open into the workspace, because an import creates a
// room rather than replacing the one you are standing in.

import { useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { toast } from '@/components/ui/StorageToast';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { roomStore } from '@/lib/storage';
import { downloadBlob } from '@/lib/snapshot';
import {
  buildSceneFile,
  MAX_FILE_BYTES,
  parseSceneFile,
  SCENE_FILE_EXT,
  sceneFileJson,
  sceneFileName,
  sceneFileToRoom,
} from '@/lib/scene-file';

/** Save the current room to a file. Lives in the studio top bar next to Snapshot —
 *  a PNG of the view and the room itself are the two things one might want to keep,
 *  and they belong in the same place. */
export function ExportSceneButton() {
  const { roomId } = useParams<{ roomId: string }>();
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!roomId || busy) return;
    setBusy(true);
    try {
      // The stores are the live truth; `meta` is written on a 300 ms debounce and
      // supplies only the name, which nothing in the studio holds.
      const meta = await roomStore.loadRoom(roomId);
      const { parts, room } = useScene.getState();
      const { positions, rotations, dims, hidden } = useStudio.getState();

      const file = buildSceneFile(
        {
          id: roomId,
          createdAt: meta?.createdAt ?? Date.now(),
          name: meta?.name ?? 'Room',
          layoutId: room.layoutId,
          width: room.width,
          depth: room.depth,
          height: room.height,
          wallColors: room.wallColors,
          // The polygon is written even for a preset shape, not just a customised
          // one. It costs a few hundred bytes and makes the file say what the room
          // IS rather than which preset to re-derive it from — so a room survives
          // `footprintForLayout` ever changing its mind about a preset.
          footprint: room.footprint,
          site: room.site,
        },
        parts,
        { positions, rotations, dims, hidden },
        Date.now(),
      );

      const name = sceneFileName(meta?.name ?? 'room');
      downloadBlob(new Blob([sceneFileJson(file)], { type: 'application/json' }), name);
      toast({ tone: 'success', title: 'Room saved to a file', message: name });
    } catch (e) {
      toast({
        tone: 'danger',
        title: "Couldn't save the file",
        message: 'The room is still here — try again.',
        detail: String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={save}
      disabled={busy}
      className="ds-btn"
      style={{ height: 28, fontSize: 12 }}
      title="Download this room as a file you can keep or send to someone"
    >
      <Icon name="download" size={12} />
      {busy ? 'Saving…' : 'Save file'}
    </button>
  );
}

/** Open a scene file as a NEW room, then go to it.
 *
 *  Never offers to replace the room you have open. Import is additive by
 *  construction (`roomStore.importScene` mints its own id), so the destructive
 *  reading of "open" — the one that would lose work — cannot happen here. */
export function ImportSceneButton({
  size = 'bar',
}: {
  /** `large` matches the empty state's CTA in size only. It stays a plain button
   *  there on purpose: two accent fills side by side read as two primary actions,
   *  and creating a room is the one we are recommending. */
  size?: 'bar' | 'large';
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function open(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file || busy) return;
    setBusy(true);
    try {
      // Checked before reading, so a 2 GB file never becomes a 2 GB string. The
      // parse re-checks the text length as well, for callers that skip this.
      if (file.size > MAX_FILE_BYTES) {
        toast({ tone: 'danger', title: 'That file is too large to be a Danmu room' });
        return;
      }

      const parsed = parseSceneFile(await file.text());
      if (!parsed.ok) {
        toast({ tone: 'danger', title: "Couldn't open that file", message: parsed.error });
        return;
      }

      const { parts, transforms } = sceneFileToRoom(parsed.file);
      const newId = await roomStore.importScene(parsed.file.room, parts, transforms);

      // Say what was lost, if anything was. A silent partial import would leave the
      // user to notice on their own that two pieces are missing.
      toast({
        tone: parsed.dropped.length > 0 ? 'neutral' : 'success',
        title: `Opened “${parsed.file.room.name}”`,
        message:
          parsed.dropped.length > 0
            ? `${parts.length} ${parts.length === 1 ? 'piece' : 'pieces'} came through. ${capitalise(parsed.dropped.join('; '))}.`
            : `${parts.length} ${parts.length === 1 ? 'piece' : 'pieces'} of furniture.`,
        // Sticky when something was left out: "two pieces are missing" is the kind
        // of thing a user must actually read, not catch on its way past.
        ttl: parsed.dropped.length > 0 ? 0 : undefined,
      });

      router.push(`/room/${newId}/model`);
    } catch (e) {
      toast({
        tone: 'danger',
        title: "Couldn't open that file",
        message: 'Nothing was changed.',
        detail: String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  const large = size === 'large';
  return (
    <>
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="ds-btn"
        style={large ? { height: 40, padding: '0 20px', fontSize: 14 } : { height: 32, fontSize: 12 }}
        title="Open a room someone shared with you, or one you saved earlier"
      >
        <Icon name="file" size={large ? 14 : 12} />
        {busy ? 'Opening…' : 'Open a file'}
      </button>
      {/* .sr-only, never display:none — a file input hidden by display is gone from
          the accessibility tree entirely (same reasoning as the capture screen). */}
      <input
        ref={inputRef}
        type="file"
        accept={`${SCENE_FILE_EXT},application/json`}
        className="sr-only"
        aria-label="Choose a Danmu room file to open"
        onChange={(e) => {
          void open(e.target.files);
          // Cleared so picking the same file twice in a row fires onChange again.
          e.target.value = '';
        }}
      />
    </>
  );
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
