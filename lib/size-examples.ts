/** The example searches shown under the Library's search field.
 *
 *  What the field understands is only a feature if somebody knows to type it, so the
 *  catalog host offers a few as chips. They are data, not JSX, so
 *  `tests/size-examples.test.ts` can hold each one to its promise: it ranks
 *  the piece it names first, and a stated size resolves to the numbers it states.
 *  `expect` is a lowercase fragment of the label that must come out on top. */
export const SIZE_EXAMPLES: ReadonlyArray<{
  text: string;
  expect: string;
  /** width × depth in mm the text must resolve to, where it names a size */
  sizeMM?: readonly [number, number];
}> = [
  { text: 'sofa 220cm', expect: 'sofa', sizeMM: [2200, 950] },
  { text: 'dining table 180x90cm', expect: 'dining table', sizeMM: [1800, 900] },
  // Not "king bed": a class word ranks Bed first but `queryNamesSize` is false for
  // it, so the picker would add the preset bed rather than the 1800 the chip implies.
  { text: 'bed 180x200cm', expect: 'bed', sizeMM: [1800, 2000] },
];
