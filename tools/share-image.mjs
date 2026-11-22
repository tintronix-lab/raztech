// Renders the link preview images (assets/share.png, assets/share-sv.png) and
// the icon PNGs (assets/apple-touch-icon.png, assets/icon-32.png) from tools/share.html.
// Run it after changing the headline, the map or the logo, and after "node build.mjs":
//
//   npm install --no-save playwright && npx playwright install chromium
//   node tools/share-image.mjs
//
// The site itself has no build step and no dependencies. This is the only script file in the repo.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

// A static file server for the repo root, so the template loads the real stylesheet and font.
const server = createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, "http://localhost").pathname));
  const file = join(root, path.endsWith(sep) ? join(path, "index.html") : path);
  if (file !== root && !file.startsWith(root + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((done) => server.listen(0, "127.0.0.1", done));
const { port } = server.address();
const browser = await chromium.launch();

try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 630 },
    deviceScaleFactor: 1,
    colorScheme: "light",
  });
  // One link preview per language: English from index.html, the others from their own page.
  for (const [language, file] of [["", "share.png"], ["sv", "share-sv.png"]]) {
    await page.goto(`http://127.0.0.1:${port}/tools/share.html${language ? `?lang=${language}` : ""}`);
    await page.waitForSelector("body[data-ready=true]", { timeout: 15_000 });
    await page.screenshot({
      path: join(root, "assets", file),
      clip: { x: 0, y: 0, width: 1200, height: 630 },
    });
    console.log(`Wrote assets/${file}`);
  }
  // The square icon as PNGs, for home screens and for browsers that do not take an SVG tab icon.
  await page.locator("#icon").screenshot({ path: join(root, "assets", "apple-touch-icon.png") });
  await page.locator("#icon-small").screenshot({ path: join(root, "assets", "icon-32.png") });
  console.log("Wrote assets/apple-touch-icon.png and assets/icon-32.png");
} finally {
  await browser.close();
  server.close();
}
