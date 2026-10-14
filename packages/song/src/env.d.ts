// The song package is DOM-free but uses two globals that both browsers and Node provide.
declare function structuredClone<T>(value: T): T;
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
