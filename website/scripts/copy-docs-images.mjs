// The docs are read from ../docs at build time; their screenshots are copied beside the page so
// the static export can serve them. One source of truth: the repo's own docs/ directory.
import { copyFileSync, cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("public/docs", { recursive: true, force: true });
mkdirSync("public/docs", { recursive: true });
cpSync("../docs/images", "public/docs/images", { recursive: true });

// The install skill: `set up https://roster.nanocollective.org/SKILL.md` in any coding agent.
// The same file `roster skill install` saves, so the two cannot drift.
copyFileSync("../templates/skill/SKILL.md", "public/SKILL.md");
