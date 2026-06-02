# Opname Rapport — Report Structure Reference

**Report type:** Energy survey report (Opname Rapport)  
**Tool:** Opname App (Energeticas)  
**Standard:** NTA 8800 / RVO energy label methodology  
**Language:** Dutch (NL) with English (EN) annotations

---

## Overview

The report captures all physical data of a residential building needed to calculate its energy label under NTA 8800. It is structured in seven major sections.

```
Opname Rapport
│
├── 1. Header / Koptekst
├── 2. Gevel Foto's buitenzijde          Exterior photos
├── 3. Gebruiksoppervlakte               Usable floor areas
├── 4. Overzicht Plattegronden           Floor plan sketches
├── 5. Rekenzones                        Calculation zones
│       ├── Gevels overzichtstabel       Wall surface summary table
│       ├── Vloeren overzichtstabel      Floor surface summary table
│       ├── Daken overzichtstabel        Roof surface summary table
│       └── Gedetailleerde uitwerking    Full element-by-element detail
│           ├── Detail Gevels            Per-wall detail + photos
│           ├── Detail Vloeren           Per-floor detail
│           └── Detail Daken            Per-roof detail + dormers
└── 6. Bijbehorende Installaties         Building services
```

---

## Section 1 — Header (Koptekst)

**EN:** The cover page and identification table.  
**NL:** Voorblad en identificatietabel.

| Field (NL) | Field (EN) | Example |
|---|---|---|
| Locatie | Address | Cor van Osnabruggelaan 88, 2251 RG VOORSCHOTEN |
| Datum opname | Survey date | 7/18/2025 |
| Opname gedaan door | Surveyor | Nils Maronier |
| Bedrijf | Company | Energeticas |

---

## Section 2 — Gevel Foto's buitenzijde (Exterior Photos)

**EN:** Photographs of each building façade taken from the outside. Used to visually verify building condition, façade type, and window placement.  
**NL:** Foto's van de gevels van buitenaf. Dienen als visuele verificatie.

Sub-sections:

| Label (NL) | Label (EN) |
|---|---|
| Voorgevel | Front façade |
| Achtergevel | Rear façade |
| Rechtergevel | Right gable |
| Linkergevel | Left gable |

---

## Section 3 — Gebruiksoppervlakte (Usable Floor Areas)

**EN:** The net usable floor area (GO) per level, measured according to NEN 2580. This is the basis for the energy index calculation.  
**NL:** Netto gebruiksoppervlakte per verdieping conform NEN 2580.

### Example — Cor van Osnabruggelaan 88

| Verdieping | EN | Gebruiksoppervlakte (m²) |
|---|---|---|
| Bg | Ground floor | 74.11 |
| V1 | 1st floor | 67.38 |
| V2 | 2nd floor / attic | 24.29 |
| **Totaal** | **Total** | **165.78** |

> **Note:** Usable area excludes spaces with ceiling height < 1.5 m, stairwells measured as voids, and external spaces.

---

## Section 4 — Overzicht Plattegronden (Floor Plan Sketches)

**EN:** Hand-drawn floor plan sketches photographed on-site. One sketch per floor level. These show the room layout, dimensions, and measurement annotations used to derive usable areas.  
**NL:** Handgetekende plattegrondschetsen op locatie gefotografeerd. Één per verdieping.

Each sketch page is labelled:

```
Verdieping: Bg / V1 / V2
Schets: [photograph of hand-drawn plan]
```

The sketches often show:
- Room names (slaapkamer, badkamer, woonkamer, etc.)
- Measured dimensions in mm or m
- Ridge height annotations (`h = 2.42`, `h = 3.46`)
- Dormer outlines and staircase positions

---

## Section 5 — Rekenzones (Calculation Zones)

**EN:** The core technical section. All building envelope surfaces are assigned to a calculation zone. Residential buildings typically have one zone (Zone A).  
**NL:** De kern van het rapport. Alle schilonderdelen zijn toegewezen aan een rekenzone.

### 5a — Gevels Overzichtstabel (Wall Summary Table)

A compact table listing all wall surfaces with key attributes.

| Column (NL) | Column (EN) | Description |
|---|---|---|
| ID | ID | Unique hex identifier |
| Naam | Name | Wall name / label |
| Positie | Position | Façade position (voor/achter/links/rechts) |
| Afmeting | Dimension | H × W in metres |
| Oppervlakte | Area | Net area in m² |
| Grenzend aan | Borders | What the surface borders |
| Perimeter | Perimeter | Thermal bridge length in m |

### 5b — Vloeren Overzichtstabel (Floor Summary Table)

| Column (NL) | Column (EN) |
|---|---|
| ID | Identifier |
| Naam | Name |
| Grenst aan | Borders |
| Vloerisolatie | Floor insulation (Y/N) |
| Bodemisolatie | Soil insulation (Y/N) |
| Oppervlakte | Area (m²) |

### 5c — Daken Overzichtstabel (Roof Summary Table)

| Column (NL) | Column (EN) |
|---|---|
| ID | Identifier |
| Positie | Position (gable side) |
| Type | HellendDak / PlatDak |
| Bruto Opp | Gross area (m²) |
| Dakkapel | Dormer present (Y/N) |
| Netto Opp | Net area after openings (m²) |

### 5d — Gedetailleerde Uitwerking per Gevel (Per-Wall Detail)

Each wall gets its own detail block. Structure:

```
Detail Gevel
├── Gevel metadata (ID, name, position, dimensions, borders, perimeter)
└── Transparante Delen (for each window / door):
    ├── Transparant Deel metadata (ID, type, dimensions, area)
    ├── Materiaal - Glastype
    ├── Zonwering (shading device type + operation)
    ├── Overstek (overhang depth in m)
    ├── Belemmering (external obstruction)
    ├── Notities (surveyor notes)
    ├── Overzicht Foto (overview photo)
    └── Detail Foto (close-up photo)
```

#### Gevel Metadata Fields

| Field (NL) | Field (EN) | Unit |
|---|---|---|
| Gevel ID | Wall identifier | — |
| Gevel Naam | Wall name | — |
| Positie | Façade position + orientation | — |
| Afmetingen (HxB) | Calculated dimensions H × W | m |
| Originele (HxB) | Internal (original) dimensions H × W | m |
| Dikte Vloer Boven | Floor thickness above | m |
| Dikte Vloer onder | Floor thickness below | m |
| Dikte aangrenzende muren | Adjacent wall thickness | m |
| Oppervlakte | Net wall area | m² |
| grenzend aan | Borders | — |

#### Transparant Deel Fields

| Field (NL) | Field (EN) | Notes |
|---|---|---|
| Type Deel | Element type | Raam / Deur / DeurMetGlas / Deurglas / Paneel |
| Afmetingen (HxB) | H × W and area | m and m² |
| Materiaal - Glastype | Frame material - glazing type | e.g. Hout - Dubbel Glas |
| Zonwering | Solar shading | Type + operation method |
| Overstek | Overhang depth | m (0.00 = none) |
| Belemmering | External obstruction | Height of neighbouring building, trees, etc. |
| Notities | Surveyor notes | Free text |
| Overzicht Foto | Overview photo | Interior or exterior view |
| Detail Foto | Detail photo | Frame / glazing close-up |

### 5e — Gedetailleerde Uitwerking per Dak (Per-Roof Detail)

```
Detail Dak
├── DakID
├── Dak Positie (gable side)
├── Berekende Orientatie (cardinal direction)
├── Type Dak (HellendDak / PlatDak)
├── Lengte Dak / Breedte Dak
├── Nokhoogte / Lengte Vloer (ridge height)
├── Hoek (pitch angle in degrees)
├── Bruto Oppervlakte
├── Oppervlakte gaten (area of openings)
├── Netto Oppervlak
├── Notities Dak
└── Dakkapellen (dormers, if present)
    ├── Dakkapel ID + Naam
    ├── Breedte / Diepte / Hoogte
    └── Transparante Delen (windows in dormer)
```

---

## Section 6 — Bijbehorende Installaties (Building Services)

**EN:** Documents the heating, hot water, and ventilation systems present in the building.  
**NL:** Registreert de verwarmings-, tapwater- en ventilatiesystemen.

Each installation entry contains:

| Field (NL) | Field (EN) | Example |
|---|---|---|
| Installatie ID | System identifier | d8386ba6 |
| Type Installatie | System type | Tapwater / Verwarming / Ventilatie |
| Merk/Model | Brand / model | Atag E325EC CW5 |
| Locatie in huis | Location in building | Zolder / Keuken |
| Foto Overzicht | Overview photo | System unit photo |
| Foto Typeplaatje | Type plate photo | Label / nameplate photo |

### Installations Found — Cor van Osnabruggelaan 88

| ID | Type | Merk/Model | Locatie |
|---|---|---|---|
| d8386ba6 | Tapwater (DHW) | Daalderop Close-in 10 | Keuken |
| bf92aa35 | Verwarming (Heating) | Atag E325EC CW5 | Zolder |
| 6eafdfb1 | Ventilatie (Ventilation) | Unknown | Boven keuken |

---

## Report Flow Summary

```
Cover page
    ↓
Exterior photos (visual context)
    ↓
Floor area table (total GO)
    ↓
Floor plan sketches (spatial reference)
    ↓
Summary tables (quick overview of all surfaces)
    ↓
Per-element detail blocks (full technical data + photos)
    ↓
Installations (systems data)
```

---

## Key Observations for This Property

| Issue | Detail | EN |
|---|---|---|
| ⚠ Enkel glas aanwezig | 2 ramen: 0.11 m² + 0.29 m² | Single glazing present |
| ⚠ Geen vloerisolatie | Bg vloer grenst aan kruipruimte | No floor insulation |
| ⚠ Geen bodemisolatie | Bg vloer | No soil insulation |
| ⚠ Metaal niet-thermisch onderbroken | Achtergevel schuifpui (5.81 m²) | Metal non-thermally broken frame |
| ✓ HR-ketel aanwezig | Atag E325EC CW5 (klasse CW5) | High-efficiency condensing boiler |
| ✓ Dubbelglas overwegend | >90% van raamoppervlak | Double glazing dominant |
