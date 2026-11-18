// Ctrl/Cmd + \ — put everything but the room away, and bring it back.
//
// Figma's binding for the same idea, so it is the one a designer's hand already
// reaches for. What it hides is the studio's chrome: the top bar, both rails, the
// floating canvas clusters, the Library card and the phone's toolbar and sheet.
// What it keeps is the room and the gestures on it — select, drag, right-click —
// because hiding the interface is for LOOKING at a room, and a look that cannot
// nudge a chair is a screenshot.
//
// The key is matched two ways on purpose. `e.key` is the character the layout
// produces, which is `\` on a US keyboard; `e.code` is the physical key, which is
// what still says `Backslash` on a German or Nordic layout where the character
// needs AltGr and Ctrl+the-key produces something else. Either is the gesture.

import { useStudio } from './store';
import { announce } from './announce';

/** Is this keydown the hide-interface shortcut? Ctrl on Windows/Linux, Cmd on a Mac,
 *  never with Alt — AltGr arrives as Ctrl+Alt on Windows, and AltGr+the-key is how
 *  some layouts TYPE a backslash. */
export function isHideInterfaceKey(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
  return e.key === '\\' || e.code === 'Backslash';
}

/** The sentence a screen reader hears, because the change is otherwise silent to
 *  it: the controls it was walking through have just left the page. */
export const HIDDEN_SAYS = 'Interface hidden. Press Ctrl and backslash, or Show interface, to bring it back.';
export const SHOWN_SAYS = 'Interface shown.';

/** Hide or show, and say so. Returns the new state. */
export function setInterfaceHidden(hidden: boolean): boolean {
  if (useStudio.getState().uiHidden === hidden) return hidden;
  useStudio.getState().setUiHidden(hidden);
  announce(hidden ? HIDDEN_SAYS : SHOWN_SAYS);
  return hidden;
}

export function toggleInterface(): boolean {
  return setInterfaceHidden(!useStudio.getState().uiHidden);
}
