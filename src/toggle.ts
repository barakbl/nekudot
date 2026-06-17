// The shared iOS-style on/off switch - the same look as the help-hint toggle in
// the Shortcuts panel. Use this for every on/off setting/dial instead of a raw
// checkbox. Returns the element plus a `set` to drive it from outside (e.g. when
// the state changes elsewhere).
export function makeToggle(
  checked: boolean,
  onChange: (v: boolean) => void,
): { el: HTMLButtonElement; set: (v: boolean) => void } {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "toggle-switch";
  el.setAttribute("role", "switch");
  const knob = document.createElement("span");
  knob.className = "toggle-switch-knob";
  el.appendChild(knob);

  let state = checked;
  const set = (v: boolean) => {
    state = v;
    el.classList.toggle("on", v);
    el.setAttribute("aria-checked", String(v));
  };
  set(checked);

  el.addEventListener("click", (e) => {
    e.stopPropagation();
    set(!state);
    onChange(state);
  });

  return { el, set };
}
