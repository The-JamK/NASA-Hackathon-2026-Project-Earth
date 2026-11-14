# Mission: Case Files

**Project:** Earth System Trend Detective — NASA Space Apps 2026  
**Team:** Gaussian Frontiers  
**Challenge:** Be An Earth System Trend Detective  
**Theme:** The Next Frontier

## Mission statement

Every trend is a claim. Our mission is to turn a question about the planet into a **case file a human can defend** — the variable, the place, the rate, the uncertainty, and the verdict — without letting the AI do the math.

## Why this mission

A trend line is easy to draw and hard to trust. Most tools stop at the line. We start where the line ends: *Is it real? How fast? What would change our mind?*

## One-sentence mission

> Ask the planet a question; get a defensible case file, not just a chart.

## Chain of command

- **Lead detective (human):** asks the question, approves the case plan, owns the verdict.
- **Intake assistant (AI/RAG):** recommends variables, place, and time; cites sources.
- **Forensics lab (stats engine):** computes annual means, OLS + HAC, confidence interval, Sen's slope, Mann–Kendall, and the verdict.
- **Evidence locker (data):** GISTEMP, NASA POWER, Meteomatics live conditions, and Sentinel-2 L2A context imagery via Planetary Computer; cached, cited, reproducible. Blue Marble is the labelled fallback.
- **Case writer (AI):** explains the evidence in plain English; falls back to a template if the LLM is unavailable.

## Rules of engagement

1. AI may propose; it may not compute.
2. Every number comes from code.
3. No causal claims. "Not significant" means "not proven."
4. Below 20 annual observations = exploratory; no significance claim.
5. Show the evidence chain: question → sources → plan → data → stats → verdict.
6. The app must work if the LLM is offline.

## The enemy

The confident line that isn't significant. The black box that says "AI found a trend." The causal claim we can't support.

## Mission success

- A first-time user gets a case file in under 30 seconds.
- Every verdict shows rate, CI, n, p, and source.
- A red-herring case is steep but not proven at the 5% level.
- A judge can ask "why?" and we can show every step.
- The demo lands in two minutes.

## Demo arc

1. **The question:** "Is the Sahel getting drier?"
2. **The intake:** AI proposes variables and a plan, with sources.
3. **The investigation:** deterministic statistics run.
4. **The verdict:** significant / not proven / cold case.
5. **The reveal:** show your work.
6. **The twist:** red herring.
7. **The close:** "AI can write the report. It doesn't get to decide the truth."

## Taglines

- Every trend is a claim. We test it.
- AI writes the case file. The data decides the verdict.
- Don't trust the line. Test it.
