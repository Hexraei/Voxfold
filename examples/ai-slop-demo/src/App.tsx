import './App.css'

export function App() {
  return (
    <>
      <nav className="nav">
        <div className="wrap nav-inner">
          <div className="logo">
            <span className="logo-mark" />
            Synthara
          </div>
          <div className="nav-links">
            <a href="#features">Product</a>
            <a href="#how-it-works">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="#testimonial">Customers</a>
          </div>
          <div className="nav-cta">
            <button type="button" className="btn btn-ghost">
              Log in
            </button>
            <button type="button" className="btn btn-primary">
              Get started
            </button>
          </div>
        </div>
      </nav>

      <header className="hero">
        <div className="wrap">
          <span className="eyebrow">✨ Introducing Synthara 2.0</span>
          <h1>Bring out your team's full potential with next-level workflow intelligence</h1>
          <p className="hero-sub">
            In today's world, teams need more than just another dashboard , they need a
            partner. Synthara isn't just a productivity tool, it's a complete transformation of how
            your organization gets things done.
          </p>
          <div className="hero-actions">
            <button type="button" className="btn btn-primary">
              Start free trial
            </button>
            <button type="button" className="btn btn-ghost">
              Book a demo
            </button>
          </div>
          <p className="hero-note">No credit card required · Cancel anytime</p>
        </div>
      </header>

      <section className="logo-strip">
        <div className="wrap">
          <p className="logo-strip-label">Trusted by fast-growing teams everywhere</p>
          <div className="logo-row">
            <span>Nimbus</span>
            <span>Havenly</span>
            <span>Orbital</span>
            <span>Fernwood</span>
            <span>Kestrel</span>
          </div>
        </div>
      </section>

      <section className="section" id="features">
        <div className="wrap">
          <div className="section-head">
            <h2>Why teams choose Synthara</h2>
            <p>
              Our cutting-edge platform seamlessly integrates with your existing stack, so you can
              utilize world-class infrastructure effortlessly.
            </p>
          </div>
          <div className="grid">
            <div className="card">
              <div className="card-icon">⚡</div>
              <h3>Real-time collaboration</h3>
              <p>Insights that elevate every conversation, streamlined across your whole team.</p>
            </div>
            <div className="card">
              <div className="card-icon">🧠</div>
              <h3>AI-powered insights</h3>
              <p>A robust engine that quietly syncs your data across every device you own.</p>
            </div>
            <div className="card">
              <div className="card-icon">🎨</div>
              <h3>Bespoke dashboards</h3>
              <p>A meticulously crafted, curated view built for you and your growing team.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="how-it-works">
        <div className="wrap split">
          <div>
            <h2>Say goodbye to scattered spreadsheets</h2>
            <p>
              Whether you're a solo founder or a large enterprise team, Synthara empowers you to
              unlock insights that were previously impossible to reach. At the end of the day, the
              tools you choose shape the way your team works.
            </p>
            <ul className="checklist">
              <li>Unlock a truly holistic view of your workflow</li>
              <li>Onboard in minutes, not weeks</li>
              <li>Not just a tool , a philosophy</li>
            </ul>
          </div>
          <div className="split-visual" />
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="stats">
            <div>
              <div className="stat-num">12k+</div>
              <div className="stat-label">Teams onboarded</div>
            </div>
            <div>
              <div className="stat-num">98%</div>
              <div className="stat-label">Customer satisfaction</div>
            </div>
            <div>
              <div className="stat-num">4.9/5</div>
              <div className="stat-label">Average rating</div>
            </div>
            <div>
              <div className="stat-num">24/7</div>
              <div className="stat-label">Support coverage</div>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="testimonial">
        <div className="wrap">
          <div className="testimonial">
            <blockquote>
              "Synthara didn't just improve our workflow, it revolutionized the way we think about
              productivity. It's fast. It's simple. It's secure."
            </blockquote>
            <div className="testimonial-author">
              <span className="avatar" />
              That's the kind of testament we hear every single day from teams who've embarked on
              the Synthara journey.
            </div>
          </div>
        </div>
      </section>

      <section className="cta" id="pricing">
        <div className="wrap">
          <h2>Ready to get started?</h2>
          <p>
            Let's dive in and see what's possible when you truly unlock your organization's full
            potential , with a little help from Synthara.
          </p>
          <div className="hero-actions">
            <button type="button" className="btn btn-primary">
              Start free trial
            </button>
            <button type="button" className="btn btn-ghost">
              Talk to sales
            </button>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="wrap footer">
          <span>© 2026 Synthara, Inc.</span>
          <div className="footer-links">
            <button type="button">Privacy</button>
            <button type="button">Terms</button>
            <button type="button">Status</button>
          </div>
        </div>
      </footer>
    </>
  )
}
