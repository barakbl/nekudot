import { describe, it, expect } from "vitest";
import { parseGpl, toGpl } from "../src/colors/gpl";

describe("parseGpl", () => {
  it("parses a well-formed palette: header name + colour rows", () => {
    const text = [
      "GIMP Palette",
      "Name: Test",
      "Columns: 4",
      "# a comment",
      "255 0 0 Red",
      "0 255 0\tGreen",
      "0   0 255 Blue",
    ].join("\n");
    const p = parseGpl(text);
    expect(p).not.toBeNull();
    expect(p?.name).toBe("Test");
    expect(p?.colors).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
  });

  it("skips malformed/out-of-range rows and salvages the valid ones", () => {
    const text = [
      "GIMP Palette",
      "255 0 0 Red",
      "300 0 0 TooBig",
      "0 0 abc NotNumeric",
      "0 255", // too few channels
      "0 255 0 Green",
    ].join("\n");
    const p = parseGpl(text);
    expect(p?.colors).toEqual(["#ff0000", "#00ff00"]);
  });

  it("returns null when the GIMP Palette header is missing", () => {
    expect(parseGpl("255 0 0 Red")).toBeNull();
  });

  it("returns null when there are no usable colours", () => {
    expect(parseGpl("GIMP Palette\n# only comments\nColumns: 2")).toBeNull();
  });

  it("falls back to the given name when there's no Name: header", () => {
    const p = parseGpl("GIMP Palette\n1 2 3", "myfile");
    expect(p?.name).toBe("myfile");
    expect(p?.colors).toEqual(["#010203"]);
  });

  it("tolerates a leading BOM on the magic line", () => {
    const p = parseGpl("﻿GIMP Palette\n10 20 30");
    expect(p?.colors).toEqual(["#0a141e"]);
  });
});

describe("toGpl (export)", () => {
  it("emits a valid header + R G B rows", () => {
    const text = toGpl({ name: "Mine", colors: ["#ff0000", "#00ff00"] });
    const lines = text.trim().split("\n");
    expect(lines[0]).toBe("GIMP Palette");
    expect(lines[1]).toBe("Name: Mine");
    expect(lines[2]).toBe("Columns: 2");
    expect(text).toContain("255   0   0\t#ff0000");
  });

  it("round-trips through parseGpl (name + colours preserved)", () => {
    const pal = { name: "Sunset", colors: ["#ff5e62", "#ff9966", "#ffd194"] };
    const back = parseGpl(toGpl(pal));
    expect(back?.name).toBe("Sunset");
    expect(back?.colors).toEqual(pal.colors);
  });

  it("skips invalid colours and names an empty palette sensibly", () => {
    const text = toGpl({ name: "", colors: ["#abc", "nope"] });
    expect(text).toContain("Name: Palette");
    expect(text).toContain("#aabbcc"); // #abc expanded
    expect(text).not.toContain("nope");
  });
});
