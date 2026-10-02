/** Equippable items. `size` scales the base SWORD dimensions; `damage` is per hit. */
export const ITEMS = {
  sword: { name: 'Sword', size: 1, damage: 20 },
  greatsword: { name: 'Greatsword', size: 1.5, damage: 35 },
} as const;

export type ItemId = keyof typeof ITEMS;
export type Slot = 'back' | 'hand';

export interface Loadout {
  item: ItemId | 'none';
  slot: Slot;
}

const STORAGE_KEY = 'loadout';
const SLOTS: Record<Slot, string> = { back: 'Back', hand: 'Hand' };

/**
 * Item + position selectors, bottom-left. Calls `onChange` immediately with
 * the saved loadout, then again on every change.
 */
export function createLoadoutPanel(onChange: (l: Loadout) => void): void {
  const loadout: Loadout = { item: 'sword', slot: 'back' };
  try {
    Object.assign(loadout, JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    /* storage unavailable: keep defaults */
  }
  if (loadout.item !== 'none' && !(loadout.item in ITEMS)) loadout.item = 'sword';
  if (!(loadout.slot in SLOTS)) loadout.slot = 'back';

  const panel = document.createElement('div');
  panel.id = 'loadout';

  const select = (label: string, options: Record<string, string>, value: string, set: (v: string) => void) => {
    const wrap = document.createElement('label');
    wrap.textContent = label;
    const el = document.createElement('select');
    for (const [v, text] of Object.entries(options)) el.add(new Option(text, v, false, v === value));
    el.addEventListener('change', () => {
      set(el.value);
      el.blur(); // hand keyboard focus back to the game
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(loadout));
      } catch {
        /* ignore */
      }
      onChange(loadout);
    });
    wrap.append(el);
    panel.append(wrap);
  };

  const items = { none: 'None', ...Object.fromEntries(Object.entries(ITEMS).map(([id, it]) => [id, it.name])) };
  select('Item', items, loadout.item, (v) => (loadout.item = v as Loadout['item']));
  select('Position', SLOTS, loadout.slot, (v) => (loadout.slot = v as Slot));
  document.body.append(panel);

  onChange(loadout);
}
