import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const projectUrl = new URL("../", import.meta.url);
const require = createRequire(import.meta.url);
const { PNG } = require("pngjs") as {
  PNG: {
    sync: {
      read(data: Uint8Array): { data: Uint8Array; height: number; width: number };
    };
  };
};

function readProjectFile(path: string): string {
  return readFileSync(new URL(path, projectUrl), "utf8");
}

describe("Art Deco visual theme", () => {
  it("defines the Golden Twenties design tokens and decorative treatment", () => {
    const styles = readProjectFile("src/styles.css");

    expect(styles).toContain("--art-deco-gold: #c39a49");
    expect(styles).toContain("--art-deco-lacquer: #111517");
    expect(styles).toContain(".welcome-copy::before");
    expect(styles).toContain("text-transform: uppercase");
  });

  it("provides an accessible vector icon of an Art Deco table telephone", () => {
    const icon = readProjectFile("public/app-icons/icon.svg");

    expect(icon).toMatch(/<title(?: id="[^"]+")?>Art Deco table telephone<\/title>/u);
    expect(icon).toContain('data-icon="art-deco-table-telephone"');
    expect(icon).toContain("#c39a49");
    expect(icon).toContain("#111517");
  });

  it.each([
    ["icon-192.png", 192],
    ["icon-512.png", 512],
  ] as const)("renders %s in the expected Art Deco palette", (file, size) => {
    const png = PNG.sync.read(readFileSync(new URL(`public/app-icons/${file}`, projectUrl)));
    let goldPixels = 0;
    let lacquerPixels = 0;

    for (let offset = 0; offset < png.data.length; offset += 4) {
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blue = png.data[offset + 2];

      if (red === 195 && green === 154 && blue === 73) {
        goldPixels += 1;
      }
      if (red === 17 && green === 21 && blue === 23) {
        lacquerPixels += 1;
      }
    }

    expect(png.width).toBe(size);
    expect(png.height).toBe(size);
    expect(goldPixels).toBeGreaterThan(size * size * 0.08);
    expect(lacquerPixels).toBeGreaterThan(size * size * 0.25);
  });

  it("uses the matching PWA chrome colors", () => {
    const manifest = JSON.parse(readProjectFile("public/manifest.webmanifest")) as {
      background_color: string;
      theme_color: string;
    };

    expect(manifest.background_color).toBe("#ead9b7");
    expect(manifest.theme_color).toBe("#111517");
  });
});
