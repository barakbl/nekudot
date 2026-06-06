// Brief notification chip centered horizontally, slightly below the vertical
// center. Auto-fades after ~1.5s; clicking dismisses immediately.

const SHOW_MS = 1500;
const FADE_MS = 180;

let activeChip: HTMLElement | null = null;
let dismissTimer: number | null = null;

export function showChip(text: string): void {
  if (activeChip) {
    activeChip.remove();
    activeChip = null;
  }
  if (dismissTimer !== null) {
    window.clearTimeout(dismissTimer);
    dismissTimer = null;
  }

  const chip = document.createElement("div");
  chip.className = "undo-chip";
  chip.textContent = text;
  chip.addEventListener("click", () => dismiss(chip));
  document.body.appendChild(chip);
  activeChip = chip;

  dismissTimer = window.setTimeout(() => dismiss(chip), SHOW_MS);
}

function dismiss(chip: HTMLElement): void {
  if (chip !== activeChip) {
    chip.remove();
    return;
  }
  if (dismissTimer !== null) {
    window.clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  chip.classList.add("undo-chip-out");
  window.setTimeout(() => {
    chip.remove();
    if (activeChip === chip) activeChip = null;
  }, FADE_MS);
}
