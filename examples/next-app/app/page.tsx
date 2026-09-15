// A Server Component (no 'use client') — the default for an App Router page. Verifies
// empirically whether data-vf survives into the browser DOM for RSC-rendered output.
export default function HomePage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>The platform that scales with you</h1>
      <p>
        In today's fast-paced world, teams need better tooling. This isn't just a product, it's a
        complete workflow that empowers everyone on the team, every single day.
      </p>
      <p>
        Our robust dashboard quietly syncs your data across every device you own, giving you a truly
        holistic view of your entire workflow from day one.
      </p>
    </main>
  )
}
