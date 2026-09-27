// The docs are read from ../docs at build time; their screenshots are copied beside the page so
// the static export can serve them. One source of truth: the repo's own docs/ directory.
import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("public/docs", { recursive: true, force: true });
mkdirSync("public/docs", { recursive: true });
cpSync("../docs/images", "public/docs/images", { recursive: true });
