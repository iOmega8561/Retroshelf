import { useEffect, useState } from 'react';

function connected(): string[] {
  const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
  return Array.from(pads)
    .filter((pad): pad is Gamepad => Boolean(pad))
    .map((pad) => pad.id);
}

/** Browsers only report a controller after its first button press. */
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

export function shortControllerName(id: string): string {
  const cleaned = id.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
  if (/xbox|xinput/i.test(id)) return 'Xbox controller';
  if (/dualsense/i.test(id)) return 'DualSense';
  if (/dualshock|playstation|054c/i.test(id)) return 'PlayStation controller';
  if (/pro controller|057e/i.test(id)) return 'Switch Pro Controller';
  return cleaned.slice(0, 40) || 'Controller';
}
