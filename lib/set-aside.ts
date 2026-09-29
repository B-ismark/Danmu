// What the detect screen says about rows a cloud reply named and `cloudRows` refused
// (§ 49.19). Here rather than in the page so the words are tested with the count
// they are about: a sentence that miscounts its own pieces is the displayed-number
// rule broken in prose.

const pieces = (n: number) => `${n} ${n === 1 ? 'piece' : 'pieces'}`;

/** The one sentence, for the notice's body and for the empty scan's. */
export function setAsideSentence(n: number): string {
  return `Google named ${pieces(n)} that Danmu couldn’t place: filed under a wall you didn’t photograph, or with no name or no box inside the photo.`;
}

/** The notice's title. It starts with the count, so it needs no capital. */
export function setAsideTitle(n: number): string {
  return `${pieces(n)} left out`;
}
