import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { buildTable, flattenedBuildTable } from "../../src/client/hud/layers/BuildMenu";
import { UnitType } from "../../src/core/game/Game";

const RESOURCES_DIR = path.join(__dirname, "../../resources");

function entryFor(unitType: UnitType) {
  return flattenedBuildTable.find((item) => item.unitType === unitType);
}

function assetPathFor(iconUrl: string): string {
  // assetUrl() resolves to "/images/Foo.svg" in the absence of a CDN/manifest.
  return path.join(RESOURCES_DIR, iconUrl.replace(/^\//, ""));
}

describe("BuildMenu", () => {
  it("includes all buildable unit types exactly once", () => {
    const seen = new Set<UnitType>();
    for (const item of flattenedBuildTable) {
      expect(seen.has(item.unitType), `${item.unitType} listed twice`).toBe(
        false,
      );
      seen.add(item.unitType);
    }
  });

  it("lists Airport as a countable structure with a working icon", () => {
    const entry = entryFor(UnitType.Airport);
    expect(entry).toBeDefined();
    expect(entry?.countable).toBe(true);
    expect(entry?.key).toBe("unit_type.airport");
    expect(entry?.description).toBe("build_menu.desc.airport");
    expect(fs.existsSync(assetPathFor(entry!.icon))).toBe(true);
  });

  it("lists Air Defence as a countable structure with a working icon", () => {
    const entry = entryFor(UnitType.AirDefence);
    expect(entry).toBeDefined();
    expect(entry?.countable).toBe(true);
    expect(entry?.key).toBe("unit_type.air_defence");
    expect(entry?.description).toBe("build_menu.desc.air_defence");
    expect(fs.existsSync(assetPathFor(entry!.icon))).toBe(true);
  });

  it("lists Bomber as a non-countable attack (target-tile) unit with a working icon", () => {
    const entry = entryFor(UnitType.Bomber);
    expect(entry).toBeDefined();
    expect(entry?.countable).toBe(false);
    expect(entry?.key).toBe("unit_type.bomber");
    expect(entry?.description).toBe("build_menu.desc.bomber");
    expect(fs.existsSync(assetPathFor(entry!.icon))).toBe(true);
  });

  it("every icon file referenced by the build table is a valid, non-empty SVG", () => {
    for (const item of flattenedBuildTable) {
      const iconPath = assetPathFor(item.icon);
      expect(fs.existsSync(iconPath), `${item.icon} missing on disk`).toBe(
        true,
      );
      const content = fs.readFileSync(iconPath, "utf8");
      expect(content).toContain("<svg");
      expect(content.length).toBeGreaterThan(20);
    }
  });

  it("keeps the build table structure sane (buildTable flattens to flattenedBuildTable)", () => {
    expect(buildTable.flat()).toEqual(flattenedBuildTable);
  });
});
