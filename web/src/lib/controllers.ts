/** Product name for well-known pads; null means "use the generic, translated label". */
export function controllerName(id: string): string | null {
  if (/xbox|xinput|045e/i.test(id)) return 'Xbox Controller';
  if (/dualsense|0ce6/i.test(id)) return 'DualSense';
  if (/dualshock|playstation|054c/i.test(id)) return 'DualShock';
  if (/pro controller|057e/i.test(id)) return 'Switch Pro Controller';
  const cleaned = id.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
  return cleaned && !/^[0-9a-f-]+$/i.test(cleaned) ? cleaned.slice(0, 40) : null;
}
