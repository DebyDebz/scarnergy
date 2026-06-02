# ScanergyV2 — Market & Competitive Analysis

---

## What the Solution Is

**ScanergyV2** is a building energy inspection platform combining a mobile app (Expo/React Native) and a web dashboard (Next.js). Field inspectors use a **Bosch GLM 50C Bluetooth laser sensor** to capture precise on-site measurements of walls, roofs, floors, windows, and doors. The app calculates an **A–G energy performance label** using ML models, syncs data in real time, and generates compliance-ready reports. Supervisors monitor all inspections, data quality, and building portfolios from the web dashboard.

**Core problem it solves:** Energy auditors today use paper forms, spreadsheets, or fragmented tools with no sensor integration — leading to slow, error-prone, and non-compliant workflows. ScanergyV2 closes the loop from physical measurement to certified energy label in one workflow.

---

## Who Is Using It

| User | Role |
|---|---|
| Field Inspectors | Capture measurements on-site with laser sensor via mobile app |
| Supervisors | Monitor sessions, inspect quality, manage inspectors via web dashboard |
| Energy ESCOs | Run multiple inspections across a portfolio |
| Building Owners | Commission inspections for sale, rental compliance, or renovation planning |

**Primary market today:** Dutch energy certification auditors (NTA 8800 standard, A–G label).
**Expansion target:** All EU markets under the EPBD recast directive.

---

## Market Size

| Segment | 2025 Value | Projected 2032 | CAGR |
|---|---|---|---|
| Building Energy Management Software (global) | ~$2.5B | ~$6.5B | 13.9% |
| European segment | ~$1.4B | — | 11.9% |
| Inspection Management Software (global) | ~$12.1B | ~$30.9B | 11% |
| BLE/IoT Sensor enabling layer | $4.3B | $11.8B | 22.5% |

**Key demand driver:** The EU EPBD recast (in force May 2024, national transposition deadline **May 2026**) mandates energy performance certificates across all EU member states, triggering a massive wave of auditor demand.

---

## European Country Markets

| Country | Regulation | Key Demand |
|---|---|---|
| **Netherlands** | NTA 8800 | Existing ScanergyV2 target market; strict label requirements |
| **Germany** | GEG + DIN V 18599 (Jan 2025), EPBD transposition by Jul 2026 | ~40M dwellings; EPC now required on lease renewal and major renovation; fines up to €10,000 |
| **France** | DPE reform (Jan 2025 / 2026) | G-rated homes already banned from rental; F-rated banned Jan 2026; ~7M homes need upgrading; 850,000 re-certifications expected in 2026 |
| **UK** | EPC mandatory for all sales/rentals; minimum C for rentals proposed by 2028 | High-volume EPC market post-Brexit |
| **Spain** | Energy certificate mandatory since 2013 | Spacewell/Dexma serves this market; disruption opportunity |
| **Italy** | EPBD transposition; large dilapidated building stock | One of the largest renovation opportunity markets in EU |

---

## Competition & Pricing

### General Inspection Platforms — Mobile-First but Domain-Generic

| Competitor | Pricing | Target User | Key Weakness |
|---|---|---|---|
| **SafetyCulture (iAuditor)** | Free (≤10 users) / $24/user/month | Field inspectors, safety, facility management | No energy sensor integration; no EPC compliance logic; generic reports; offline sync issues |
| **GoAudits** | $10–$30/user/month | Small inspection teams | Generic, no energy domain; no ML; no sensor pairing |
| **Lumiform** | €112/team/month | European field auditors | General-purpose; no energy sensor integration |

### Enterprise Energy Management Platforms — Desktop/Web, No Field Tool

| Competitor | Pricing | Target User | Key Weakness |
|---|---|---|---|
| **Spacewell Energy (Dexma)** | €5,000–€20,000+/year | ESCOs, facility managers, European multi-site | No native mobile app; complex config; not a field tool |
| **EnergyCAP** | $5,000–$15,000/year | Facility managers, utilities (US) | Utility-bill only; no mobile; no sensor integration; US-centric |
| **Deepki** | ~€50,000–€100,000+/year | Large real estate ESG funds | Min viable customer is 100+ buildings; no field tool; no sensor integration |
| **Measurabl** | Custom 5–6 figure/year | CRE investment managers, REITs | US-focused; ESG reporting only; no field capability |
| **Metron** | Custom | Industrial manufacturers | Industrial focus only; not building audit |
| **Enertiv** | Custom enterprise | Large US CRE operators | US-only; persistent IoT only, not portable field sensors |
| **WatchWire** | From $100/month | Corporate sustainability teams | Bill-based only; no field tool |
| **Planon** | 6–7 figure/year | Large enterprise IWMS | Months-long implementation; not field-oriented |

---

## Issues With Existing Solutions

1. **No mobile field tool with energy sensor pairing** — the biggest gap. Every serious energy platform is desktop-only. Every mobile inspection tool is domain-generic.
2. **No real-time ML anomaly detection at point of measurement** — Spacewell detects anomalies server-side after the fact; no tool flags issues while the auditor is still in the building.
3. **No EPC/DPE/GEG-ready report output** — General inspection tools produce generic PDFs. Auditors must manually reformat for regulatory submissions.
4. **Inaccessible pricing for SMEs and individual auditors** — Deepki, Measurabl, Enertiv start at 5–6 figure annual contracts. Individual auditors and small ESCOs are excluded entirely.
5. **Poor offline reliability** — SafetyCulture users report data loss on reconnect. Spacewell has no mobile app at all. Field environments (basements, plant rooms) demand offline-first architecture.
6. **Poor report customization** — EnergyCAP's Report Designer costs extra; SafetyCulture reports require post-export Excel work.

---

## ScanergyV2 Pricing Position

No public pricing yet, but the competitive gap supports:

| Tier | Target | Suggested Range |
|---|---|---|
| Per inspector/month | Individual auditors, freelancers | €20–€35/user/month |
| Team plan | Small ESCO (2–10 inspectors) | €150–€300/month |
| Per inspection | One-off or low-volume users | €30–€100/inspection |
| Enterprise/portfolio | Large ESCOs, building managers | Custom / €500–€2,000+/month |

This positions ScanergyV2 **well below** Spacewell/Deepki and **on par with** SafetyCulture/GoAudits — but with far superior energy-domain intelligence.

---

## Key Differentiators Against All Competitors

| Differentiator | Why It Matters |
|---|---|
| **BLE sensor-to-label pipeline** | First tool to go from physical Bluetooth laser measurement to certified energy label in one mobile workflow |
| **Real-time ML anomaly detection in the field** | Flags measurement errors while the auditor is still on-site — no other tool does this |
| **EPBD / DPE / GEG compliance output** | Directly targets the 2026 transposition wave; competitors produce generic PDFs |
| **Mobile-first + offline-first** | Built for field conditions (poor connectivity); no desktop-first tool can match this |
| **Floor plan drawing on device** | SVG-based room mapping tied to measurements — unique to ScanergyV2 |
| **SME-accessible pricing** | The only energy-domain tool priced for individual auditors and small firms |
| **Multi-org, multi-country architecture** | RLS security model + expandable standard support (NTA 8800 → DPE → GEG) |

---

## Target User Comparison Across Competitors

| Product | Energy Auditors | Facility Managers | ESG/Sustainability Teams | Building Owners (SME) | ESCOs |
|---|---|---|---|---|---|
| SafetyCulture | Partial | Yes | No | Partial | No |
| EnergyCAP | No | Yes | Partial | No | No |
| Spacewell/Dexma | Partial | Yes | Yes | No | Yes |
| Deepki | No | No | Yes (large CRE) | No | No |
| Measurabl | No | No | Yes (CRE) | No | No |
| Lumiform | Partial | Yes | No | Partial | No |
| **ScanergyV2** | **Primary** | **Yes** | **Secondary** | **Yes** | **Yes** |

---

## Bottom Line

ScanergyV2 occupies a white space — the intersection of **mobile-first field inspection** and **energy-domain intelligence** — that no current competitor fills. The 2026 EPBD transposition deadline across all EU member states is the single largest market catalyst, creating urgent demand for exactly this type of tool across Germany, France, Netherlands, Italy, and Spain simultaneously.
