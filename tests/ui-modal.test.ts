// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { createModal } from "../src/ui/modal";

beforeEach(() => {
  document.body.innerHTML = "";
});

const keydown = (key: string) =>
  document.dispatchEvent(new KeyboardEvent("keydown", { key }));

describe("createModal", () => {
  it("mounts a backdrop + card on the body with the modal classes", () => {
    const { backdrop, card } = createModal();
    expect(backdrop.className).toBe("confirm-modal app-modal");
    expect(card.className).toBe("confirm-card");
    expect(backdrop.parentNode).toBe(document.body);
    expect(card.parentNode).toBe(backdrop);
  });

  it("close() removes the backdrop, runs `then`, and detaches the keydown listener", () => {
    const modal = createModal();
    let keyCalls = 0;
    modal.onKey = () => {
      keyCalls++;
    };
    let thenRan = false;
    modal.close(() => {
      thenRan = true;
    });

    expect(document.body.contains(modal.backdrop)).toBe(false);
    expect(thenRan).toBe(true);
    keydown("Escape"); // the listener should be gone -> no leak
    expect(keyCalls).toBe(0);
  });

  it("routes document keydown to onKey", () => {
    const modal = createModal();
    const keys: string[] = [];
    modal.onKey = (e) => keys.push(e.key);
    keydown("Enter");
    keydown("Escape");
    expect(keys).toEqual(["Enter", "Escape"]);
  });

  it("runs onBackdropClose for a click on the backdrop, not on the card", () => {
    const modal = createModal();
    let closed = 0;
    modal.onBackdropClose = () => {
      closed++;
    };
    modal.card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(closed).toBe(0); // inside the card
    modal.backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(closed).toBe(1); // on the backdrop itself
  });
});
