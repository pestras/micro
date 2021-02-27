import { readFileSync } from 'fs';
import { join } from 'path';

interface State {
  healthy: boolean;
  ready: boolean;
  live: boolean;
}

let check: keyof State = <keyof State>process.argv[2] || "healthy";

let healthFilePath = join(process.cwd(), "__health");

try {
  let data = readFileSync(healthFilePath, "utf-8");
  if (!data) process.exit(1);
  else {
    let state: State = JSON.parse(data);

    if (state[check]) process.exit(0);
    else process.exit(1);
  }
} catch (e) {
  process.exit(1);
}