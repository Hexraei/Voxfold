#!/usr/bin/env node
import { run } from '../dist/index.mjs'

const exitCode = await run(process.argv)
process.exit(exitCode)
