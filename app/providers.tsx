// Root-layout wrapper. It currently provides nothing — and that is deliberate.
//
// This used to instantiate a react-query QueryClient + QueryClientProvider, so
// the whole react-query runtime shipped in the first chunk of an app that makes
// no queries at all: rooms live in IndexedDB, settings in localStorage, and the
// single optional network call (Gemini detection, BYO key) is a direct fetch.
// `useQuery`/`useMutation` appeared nowhere. The dependency is gone.
//
// Kept as a passthrough because app/layout.tsx mounts it and it is the obvious
// place for a real provider later. Intentionally NOT a client component: a
// passthrough must not drag the whole tree across the server/client boundary.

export function Providers({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
