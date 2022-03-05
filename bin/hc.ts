#!/usr/bin/env node

import { readFileSync } from 'fs';
import { join } from 'path';

const HEALTH_CHECK_DIR = process.env.HEALTH_CHECK_DIR || "";

interface State {
  healthy: boolean;
  ready: boolean;
  live: boolean;
}

let check: keyof State = <keyof State>(process.argv[2] || "healthy").toLowerCase();

let healthFilePath = join(HEALTH_CHECK_DIR, "__health");

console.log("attempting to read file", healthFilePath);

try {
  let data = readFileSync(healthFilePath, "utf-8");

  console.log("received data:");
  console.log(data);

  if (!data) process.exit(1);
  else {
    let state: State = JSON.parse(data);

    if (state[check]) process.exit(0);
    else process.exit(1);
  }
} catch (e: any) {
  console.log("error reading file");
  console.log(e?.message || JSON.stringify(e));
  process.exit(1);
}