import { describe, it, expect } from "vitest";
import { parseGpl } from "../src/colors/gpl";

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
