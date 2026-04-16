import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const htmlPath = path.join(repoRoot, "tools", "community-assets", "web-assets-generator.html");
const outputDir = path.join(repoRoot, "assets");

const chromeCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

const chromePath = chromeCandidates.find((candidate) => existsSync(candidate));

if (!chromePath) {
  throw new Error(
    "No supported Chromium browser found. Expected one of: " + chromeCandidates.join(", "),
  );
}

if (!existsSync(htmlPath)) {
  throw new Error("Missing asset generator page: " + htmlPath);
}

mkdirSync(outputDir, { recursive: true });

const scenes = [
  { scene: "cover", file: "cover-v2.png" },
  { scene: "result", file: "carousel-1.png" },
  { scene: "conversation", file: "carousel-2.png" },
];

const htmlUrl = pathToFileURL(htmlPath);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runChrome(outputPath, targetUrl) {
  const sessionRoot = mkdtempSync(
    path.join(os.tmpdir(), "genable-community-assets-"),
  );
  const userDataDir = path.join(sessionRoot, "profile");
  const tempOutputPath = path.join(sessionRoot, "capture.png");
  mkdirSync(userDataDir, { recursive: true });
  rmSync(outputPath, { force: true });

  try {
    const child = spawn(
      chromePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--allow-file-access-from-files",
        `--user-data-dir=${userDataDir}`,
        "--window-size=1920,1080",
        "--virtual-time-budget=1500",
        `--screenshot=${tempOutputPath}`,
        targetUrl,
      ],
      {
        stdio: "ignore",
        env: process.env,
      },
    );

    let childClosed = false;
    child.on("close", () => {
      childClosed = true;
    });

    const deadline = Date.now() + 15000;
    let stableSize = -1;
    let screenshotReady = false;

    while (Date.now() < deadline) {
      if (existsSync(tempOutputPath)) {
        const currentSize = statSync(tempOutputPath).size;
        if (currentSize > 0 && currentSize === stableSize) {
          screenshotReady = true;
          break;
        }
        stableSize = currentSize;
      }

      if (childClosed) {
        break;
      }

      await sleep(250);
    }

    if (!screenshotReady && !(existsSync(tempOutputPath) && statSync(tempOutputPath).size > 0)) {
      child.kill("SIGTERM");
      await once(child, "close").catch(() => {});
      throw new Error("Chrome did not produce a screenshot for " + path.basename(outputPath));
    }

    if (!childClosed) {
      child.kill("SIGTERM");
      await Promise.race([
        once(child, "close").catch(() => {}),
        sleep(2000).then(() => {
          if (!childClosed) {
            child.kill("SIGKILL");
          }
        }),
      ]);
    }

    renameSync(tempOutputPath, outputPath);
  } finally {
    rmSync(sessionRoot, { recursive: true, force: true });
  }
}

for (const item of scenes) {
  const sceneUrl = new URL(htmlUrl);
  sceneUrl.searchParams.set("scene", item.scene);

  const outputPath = path.join(outputDir, item.file);
  console.log(`Exporting ${item.file} from ${item.scene} ...`);
  await runChrome(outputPath, sceneUrl.toString());
}

console.log("Community assets exported to " + outputDir);
