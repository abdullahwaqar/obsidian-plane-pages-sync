// Runs from `npm version <patch|minor|major>`: copies the new version into
// manifest.json and records its minAppVersion in versions.json.
import { readFileSync, writeFileSync } from "node:fs";

const version = process.env.npm_package_version;
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = version;
writeFileSync("manifest.json", `${JSON.stringify(manifest, null, 4)}\n`);

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[version] = manifest.minAppVersion;
writeFileSync("versions.json", `${JSON.stringify(versions, null, 4)}\n`);
