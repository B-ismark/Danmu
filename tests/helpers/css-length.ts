// Resolves the few CSS length functions the scan screen writes into inline styles —
// `calc`, `min`, `max` and `clamp`, over `px` and `%` — against a reference length.
//
// It exists so a test lays out the STRING a component is handed rather than a second
// copy of the arithmetic that wrote it. A model that repeats the arithmetic agrees with
// it by construction, so a wrong sign or a dropped term in the CSS passes every sweep
// that model drives, and only the handful of strings pinned by hand could catch it.
//
// Strict on purpose: `+` and `-` need whitespace on both sides, as CSS requires, and
// anything it does not know — a unit, a function, a trailing character — throws. A
// string the browser would drop must not be one a test can resolve.

export function cssLength(src: string, percentOf: number): number {
  let i = 0;
  const fail = (what: string): never => {
    throw new Error(`cssLength: ${what} at ${i} in "${src}"`);
  };
  const spaces = () => {
    const from = i;
    while (src[i] === ' ') i++;
    return i - from;
  };

  function value(): number {
    spaces();
    const fn = /^(calc|min|max|clamp)\(/.exec(src.slice(i));
    if (fn) {
      i += fn[0].length;
      const args = [sum()];
      spaces();
      while (src[i] === ',') {
        i++;
        args.push(sum());
        spaces();
      }
      if (src[i] !== ')') fail('expected ")"');
      i++;
      if (fn[1] === 'calc' && args.length !== 1) fail('calc() takes one argument');
      if (fn[1] === 'clamp' && args.length !== 3) fail('clamp() takes three arguments');
      if (fn[1] === 'calc') return args[0];
      if (fn[1] === 'min') return Math.min(...args);
      if (fn[1] === 'max') return Math.max(...args);
      return Math.max(args[0], Math.min(args[1], args[2]));
    }
    const n = /^(-?\d+(?:\.\d+)?(?:e-?\d+)?)(px|%)/.exec(src.slice(i));
    if (!n) return fail('expected a length');
    i += n[0].length;
    return n[2] === '%' ? (Number(n[1]) / 100) * percentOf : Number(n[1]);
  }

  function sum(): number {
    let v = value();
    for (;;) {
      const before = spaces();
      const op = src[i];
      if (op !== '+' && op !== '-') return v;
      if (before === 0) fail(`"${op}" needs a space before it`);
      i++;
      if (spaces() === 0) fail(`"${op}" needs a space after it`);
      const r = value();
      v = op === '+' ? v + r : v - r;
    }
  }

  const v = sum();
  spaces();
  if (i !== src.length) fail('unexpected input');
  return v;
}
