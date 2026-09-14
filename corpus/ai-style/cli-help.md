# 📸 snaptool — Your Snapshot Companion

Welcome to snaptool — the effortless way to safeguard your work. This isn't just a CLI tool, it's
peace of mind for every risky change you're about to make. Whether you're a solo hacker or part
of a large enterprise team, snaptool has you covered.

## Why snaptool?

Say goodbye to "I wish I hadn't done that." Our seamless snapshot engine quietly, reliably
captures your filesystem state so you can experiment fearlessly. It's not just a safety net —
it's a superpower.

## Getting Started

Getting started is refreshingly simple:

```
snaptool take <name> [path]
```

That's it! No complicated configuration, no steep learning curve. Just fast, reliable snapshots,
every single time.

## ✨ Core Commands

- **take:** effortlessly capture your current state
- **restore:** seamlessly roll back when things go wrong
- **list:** get a beautiful, at-a-glance view of every snapshot
- **diff:** instantly see what's changed, down to the byte

Our cutting-edge diffing engine doesn't just show you changes, it empowers you to make informed
decisions before you commit to anything.

## 🛡️ Restore With Confidence

Restoring isn't just fast, it's bulletproof. Our robust restore pipeline gracefully handles edge
cases behind the scenes, so you can focus on what matters: moving forward.

## 🧹 Pruning Made Effortless

At the end of the day, disk space matters. That's why our intelligent pruning system helps you
reclaim space effortlessly, without ever risking data you actually need.

```
snaptool prune --older-than 30d --keep-last 5
```

## Configuration

Whether you're working solo or across a large team, snaptool's flexible configuration adapts to
your workflow, not the other way around. Simply drop a `.snaptoolrc` in your project and you're
ready to go.

## 🌍 Built for Everyone

From individual developers to enterprise engineering teams, snaptool scales seamlessly to meet
your needs. It's more than a tool — it's a foundation you can build on with confidence.

Ready to experiment fearlessly? Dive in today and experience true peace of mind.
