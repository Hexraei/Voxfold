import { withVoxfold } from '@voxfold/next'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Next writes AGENTS.md/CLAUDE.md into every project by default — not real project content.
  agentRules: false,
}

export default withVoxfold(nextConfig)
