#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command('bffless').description('BFFless CLI');
program.command('rules').description('Proxy rule sets as code (build, validate, test, pull)');
program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
