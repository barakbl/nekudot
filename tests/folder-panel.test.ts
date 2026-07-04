// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { createFolderPanel, type FolderHost } from "../src/app/folder-panel";

function host(over: Partial<FolderHost>): FolderHost {
  return {
    isConnected: () => false,
    folderName: () => null,
    pendingFolderName: () => null,
    currentFile: () => null,
    onConnect: () => {},
    onDisconnect: () => {},
    onSaveArtwork: () => {},
    onSaveSettings: () => {},
    onLoadSettings: () => {},
    ...over,
  };
}

const buttonByText = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent === text);

describe("folder box", () => {
  it("shows a plain Connect when nothing is remembered", () => {
    const box = createFolderPanel(host({}));
    const text = box.el.textContent ?? "";
    expect(text).toContain("Connect folder");
    expect(text).not.toContain("Reconnect");
  });

  it("offers Reconnect <name> when a grant has lapsed, wired to onConnect", () => {
    let connects = 0;
    const box = createFolderPanel(
      host({ pendingFolderName: () => "My Folder", onConnect: () => connects++ }),
    );
    const text = box.el.textContent ?? "";
    expect(text).toContain("My Folder"); // names the prior folder
    expect(text).toContain("Reconnect");
    expect(buttonByText(box.el, "Connect folder")).toBeUndefined();

    buttonByText(box.el, "Reconnect")?.click();
    expect(connects).toBe(1);
  });

  it("shows the connected layout once a folder is attached", () => {
    const box = createFolderPanel(
      host({ isConnected: () => true, folderName: () => "Pics", currentFile: () => null }),
    );
    const text = box.el.textContent ?? "";
    expect(text).toContain("Pics");
    expect(buttonByText(box.el, "Save")).toBeDefined();
    expect(buttonByText(box.el, "Export")).toBeDefined(); // settings bundle out
    expect(buttonByText(box.el, "Import")).toBeDefined(); // settings bundle in
    expect(buttonByText(box.el, "Reconnect")).toBeUndefined();
  });
});
