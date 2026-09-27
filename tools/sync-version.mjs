#!/usr/bin/env node
// Regenerates every version-bearing file from version.json. Run this after
// editing version.json; the build entry points call it automatically.
import { syncRepositoryVersion } from "./version.mjs";

try {
  const { version, updated } = syncRepositoryVersion();
  if (updated.length === 0) {
    console.log(`Version ${version} is already in sync with version.json.`);
  } else {
    console.log(`Synced version ${version} into:`);
    for (const file of updated) {
      console.log(`  ${file}`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
