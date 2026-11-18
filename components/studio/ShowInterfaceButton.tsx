'use client';

// The one control left on screen while the interface is hidden.
//
// Figma leaves nothing and trusts the keyboard. That works where everyone has one,
// and this studio runs on tablets and phones too, where Ctrl+\ does not exist and
// a hidden interface with no way back is a room you cannot leave. So one quiet pill
// stays, bottom centre, out of the way of the piece being looked at, and it names
// the shortcut so the next time it is not needed.
//
// It is the ONLY thing rendered while hidden, so it is also the thing a keyboard or
// screen-reader user lands on: everything else they could have tabbed to is gone.

import { useStudio } from '@/lib/store';
import { setInterfaceHidden } from '@/lib/hide-interface';
import { Icon } from '@/components/ui/Icon';
import { focusStudioSurface } from './KeyboardShortcuts';

export function ShowInterfaceButton() {
  const hidden = useStudio((s) => s.uiHidden);
  if (!hidden) return null;
  return (
    <button
      type="button"
      className="ds-btn ds-btn--sm show-ui"
      aria-keyshortcuts="Control+Backslash Meta+Backslash"
      onClick={() => {
        setInterfaceHidden(false);
        // The button has just removed itself, which would leave focus on <body> and
        // the single-key shortcuts disarmed. The room is where they belong.
        focusStudioSurface();
      }}
    >
      <Icon name="eye" size={14} />
      Show interface
      {/* The shortcut, for a hand on a keyboard. Hidden on touch, where there is no
          such key to press and the hint would be a promise the device cannot keep. */}
      <span className="show-ui__keys" aria-hidden="true">
        <kbd className="help-kb">Ctrl</kbd>
        <kbd className="help-kb">\</kbd>
      </span>
    </button>
  );
}
