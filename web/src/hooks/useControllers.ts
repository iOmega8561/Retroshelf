import { useEffect, useState } from 'react';

function connected(): string[] {
  const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
  return Array.from(pads)
    .filter((pad): pad is Gamepad => Boolean(pad))
    .map((pad) => pad.id);
}

/** Browsers only report a controller after its first button press, and only on secure pages. */
export function useControllers(): string[] {
  const [pads, setPads] = useState<string[]>(connected);
  useEffect(() => {
    const update = () => setPads(connected());
    window.addEventListener('gamepadconnected', update);
    window.addEventListener('gamepaddisconnected', update);
    return () => {
      window.removeEventListener('gamepadconnected', update);
      window.removeEventListener('gamepaddisconnected', update);
    };
  }, []);
  return pads;
}

export { controllerName } from '../lib/controllers';
