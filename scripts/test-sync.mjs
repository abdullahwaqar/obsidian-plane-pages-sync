// Bundles the sticky sync tests with Obsidian replaced by a small mock, then runs them.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import esbuild from "esbuild";

mkdirSync(".test-build", { recursive: true });
await esbuild.build({
    entryPoints: ["test/stickySync.harness.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: ".test-build/stickySync.test.mjs",
    alias: { obsidian: "./test/mocks/obsidian.ts" },
    logLevel: "warning",
});
execFileSync(process.execPath, ["--test", ".test-build/stickySync.test.mjs"], { stdio: "inherit" });
