import { Suspense, lazy, type ComponentType } from 'react';

// Drop-in replacement for next/dynamic() with { ssr: false }.
// There is no SSR in this app, so a dynamic import is exactly React.lazy()
// wrapped in a Suspense boundary (fallback null = renders nothing until
// loaded, identical to the previous behaviour).
export function dynamic<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T } | T>,
  ..._args: unknown[]
): ComponentType<React.ComponentProps<T>> {
  const Lazy: ComponentType<any> = lazy(() =>
    loader().then((m) => ('default' in (m as object) ? (m as { default: T }) : { default: m as T })),
  );
  return function DynamicWrapper(props: React.ComponentProps<T>) {
    return (
      <Suspense fallback={null}>
        <Lazy {...(props as object)} />
      </Suspense>
    );
  };
}
