import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const projectUrl = new URL("../", import.meta.url);

function readProjectFile(path: string): string {
  return readFileSync(new URL(path, projectUrl), "utf8");
}

describe("PWA icon assets", () => {
  it("does not expose the reserved public/icons directory", () => {
    expect(existsSync(new URL("public/icons", projectUrl))).toBe(false);
  });

  it("uses the portable app-icons directory throughout the source", () => {
    const files = [
      "index.html",
      "public/manifest.webmanifest",
      "public/sw.js",
      "src/notifications.ts",
      "scripts/generate-icons.mjs",
    ];

    for (const file of files) {
      const content = readProjectFile(file);
      expect(content, file).not.toMatch(/(?:\.\/|public\/)icons\//u);
      expect(content, file).toContain("app-icons");
    }
  });

  it.each(["icon.svg", "icon-192.png", "icon-512.png"])(
    "provides app-icons/%s",
    (icon) => {
      expect(existsSync(new URL(`public/app-icons/${icon}`, projectUrl))).toBe(true);
    },
  );
});
