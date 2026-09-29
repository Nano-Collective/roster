/* How many requests the page has open. The setup dialog waits for this to reach zero before it
 * shows itself, because the list it draws is only final once every answer is back. */

let open = 0;

if (typeof globalThis.fetch === "function" && !globalThis.fetch.counted) {
  const real = globalThis.fetch.bind(globalThis);
  const counted = (...args) => {
    open++;
    return real(...args).finally(() => {
      open--;
    });
  };
  counted.counted = true;
  globalThis.fetch = counted;
}

export const pending = () => open;
