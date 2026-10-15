'use client';

import { useId, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';
import { Toggle } from '@/components/ui/primitives';
import { useSettings } from '@/lib/store';
import { formatLength } from '@/lib/units';
import { MAX_PIECE_NAME, type MadeSpec } from '@/lib/made-piece';

/** "Save as my piece": name it, see the size it will be saved at, decide whether a
 *  wider copy repeats it. The size is the PACKED one — derived from the blocks, never
 *  typed — and it is shown in the user's own unit. Every line here wraps: the name
 *  ellipsises in its field, and size and block count each get a line of their own,
 *  which is the overflow the first sketch of this card had. */
export function SavePieceDialog({
  spec,
  defaultName = 'My piece',
  onSave,
  onClose,
}: {
  spec: MadeSpec;
  defaultName?: string;
  onSave: (name: string, modular: boolean) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const nameId = useId();
  const unit = useSettings((s) => s.dimUnit);
  const [name, setName] = useState(defaultName);
  const [modular, setModular] = useState(!!spec.modular);
  const [w, d, h] = spec.sizeMM;
  const count = spec.blocks.length;
  const save = () => onSave(name.trim() || defaultName, modular);

  return (
    <Modal
      onClose={onClose}
      labelledBy={titleId}
      width={400}
      footer={
        <>
          <button onClick={onClose} className="ds-btn" style={{ flex: 1, justifyContent: 'center' }}>
            Cancel
          </button>
          <button
            onClick={save}
            className="ds-btn ds-btn--primary"
            style={{ flex: 1, justifyContent: 'center' }}
          >
            <Icon name="check" size={11} />
            Save piece
          </button>
        </>
      }
    >
      <div id={titleId} className="t-title" style={{ marginBottom: 4 }}>
        Save as my piece
      </div>
      <p className="t-body" style={{ margin: '0 0 14px', color: 'var(--ink-2)', overflowWrap: 'anywhere' }}>
        It joins <b>My pieces</b> at the top of the Library, in every room.
      </p>

      <label htmlFor={nameId} className="t-small" style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>
        Name
      </label>
      <input
        id={nameId}
        className="ds-input"
        value={name}
        maxLength={MAX_PIECE_NAME}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
        }}
        style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', textOverflow: 'ellipsis' }}
      />

      <dl className="save-piece-facts">
        <dt>Size</dt>
        <dd>
          {formatLength(w, unit)} × {formatLength(d, unit)} × {formatLength(h, unit)}
        </dd>
        <dt>Made of</dt>
        <dd>
          {count} {count === 1 ? 'block' : 'blocks'}
        </dd>
      </dl>

      <div className="save-piece-modular">
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <div className="t-body" style={{ fontWeight: 600 }}>Repeat when widened</div>
          <div className="t-small" style={{ color: 'var(--ink-2)', overflowWrap: 'anywhere' }}>
            Making it wider adds another whole copy side by side, instead of stretching it.
          </div>
        </div>
        <Toggle on={modular} onClick={() => setModular((m) => !m)} label="Repeat when widened" />
      </div>
    </Modal>
  );
}
