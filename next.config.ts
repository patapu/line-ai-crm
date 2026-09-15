import type { NextConfig } from 'next'

// [F] layer 0 contract: see docs/design.md section 1 and section 10.
//
// - reactCompiler: stable in Next 16, opt in.
// - outputFileTracingIncludes: skills/crm-copilot/** is read at runtime by the
//   copilot module (SKILL.md / instructions.md), so it must be traced into the
//   serverless bundle even though nothing imports it as a module.
// - output: 'standalone' is NOT set here. Vercel does not need it. The
//   Dockerfile (Lane D) sets NEXT_OUTPUT=standalone before `next build` for the
//   portable/self-hosted target, and this file reads that env var back.
const nextConfig: NextConfig = {
  reactCompiler: true,
  outputFileTracingIncludes: {
    '/*': ['./skills/crm-copilot/**/*'],
  },
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' as const } : {}),
}

export default nextConfig
