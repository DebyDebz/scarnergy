# Measurement Dictionary — Opname Rapport

**Domain:** Dutch residential energy survey (NTA 8800 / NEN 2580)  
**Language:** Bilingual — Dutch (NL) primary, English (EN) translation  
**Scope:** All measured quantities appearing in the Opname Rapport

---

## 1. Area Measurements / Oppervlakten

### 1.1 Gebruiksoppervlakte (GO) — Usable Floor Area

**EN:** The net floor area of heated spaces within the dwelling, measured between the finished internal wall faces at floor level. Defined by NEN 2580.  
**NL:** De netto gebruiksoppervlakte van verwarmde ruimten gemeten tussen de afgewerkte wanden op vloerniveau conform NEN 2580.

| Term (NL) | Term (EN) | Unit | Measurement Rule |
|---|---|---|---|
| Gebruiksoppervlakte | Usable floor area | m² | Internal dimensions at floor level |
| Bg gebruiksoppervlakte | Ground floor usable area | m² | Excludes crawl space |
| V1 gebruiksoppervlakte | 1st floor usable area | m² | Excludes stairwell void |
| V2 gebruiksoppervlakte | Attic usable area | m² | Only areas with h ≥ 1.5 m |

**Inclusions / Exclusions:**

| Include | Exclude |
|---|---|
| All rooms with h ≥ 1.5 m | Areas with ceiling height < 1.5 m |
| Built-in cupboards ≥ 1.5 m depth | Stairwell void areas |
| Internal corridors | External walls (thickness) |
| Attached garage (if heated) | Unheated garage |

### 1.2 Geveloppervlakte — Wall Surface Area

**EN:** The gross wall area calculated from the external dimensions of a façade section, then reduced by the floor/ceiling thicknesses and adjacent wall thicknesses to give the net area used in energy calculations.  
**NL:** Het bruto wandoppervlak berekend vanuit buitenmaten, verminderd met vloer- en muurdiktes.

```
Netto oppervlakte = (Berekende hoogte × Berekende breedte) − Σ transparante delen
```

| Term (NL) | Term (EN) | Unit | Notes |
|---|---|---|---|
| Afmetingen (HxB) | Calculated dimensions H × W | m | After adding floor thicknesses |
| Originele (HxB) | Original / internal dimensions | m | Internal clear dimensions |
| Oppervlakte | Net wall area | m² | After subtracting window/door areas |
| Dikte Vloer Boven | Floor thickness above | m | Added to internal height |
| Dikte Vloer onder | Floor thickness below | m | Added to internal height |
| Dikte aangrenzende muren | Adjacent wall thickness | m | Added to internal width |

**Height calculation:**
```
Berekende hoogte = Originele hoogte + Dikte Vloer Boven + Dikte Vloer onder
Example: 2.42 + 0.10 + 0.00 = 2.52 m
```

### 1.3 Transparante Delen — Window and Door Areas

| Term (NL) | Term (EN) | Unit | Measurement |
|---|---|---|---|
| Afmetingen (HxB) | H × W of opening | m | Frame outer edge to outer edge |
| Oppervlakte | Opening area | m² | H × W |
| Overstek | Overhang depth | m | Horizontal projection of eave / canopy |

**Measurement convention for Afmetingen:**  
Measured to the outer frame edge (buitenkant kozijn), not the glass area. Includes frame width on all sides.

---

## 2. Linear Measurements / Lengtematen

| Term (NL) | Term (EN) | Unit | Used For |
|---|---|---|---|
| Perimeter | Thermal bridge perimeter | m | Floor-wall junction length |
| Hoogte | Height | m | Wall, window, dormer |
| Breedte | Width | m | Wall, window, dormer |
| Diepte | Depth | m | Dormer depth from roof plane |
| Lengte Dak | Roof length | m | Ridge-to-eave horizontal distance |
| Breedte Dak | Roof width | m | Gable-to-gable distance |
| Nokhoogte | Ridge height | m | Height from eave level to ridge |

### Perimeter (Thermal Bridge Length)

**EN:** The length of the wall base measured at the outer face of the external wall. Used to calculate the linear thermal transmittance (Ψ-value) at the floor-wall junction.  
**NL:** De lengte van de gevelvoet gemeten aan de buitenkant van de gevel. Gebruikt voor de lineaire warmtedoorgangscoëfficiënt (Ψ-waarde) bij de vloer-geveljunctie.

```
Perimeter ≈ Originele breedte (internal clear width)
Example: Wall breedte 8.32 m → Perimeter 8.10 m
```

---

## 3. Angle and Pitch Measurements / Hoeken

| Term (NL) | Term (EN) | Unit | Notes |
|---|---|---|---|
| Hoek | Roof pitch angle | ° (degrees) | Measured from horizontal |
| Orientatie | Cardinal orientation | — | 8-point compass |

### Roof Pitch Reference

| Hoek (°) | Type | Solar gain impact |
|---|---|---|
| 0° | Flat roof (Plat Dak) | Horizontal, high summer gain |
| 15–30° | Low pitch | Common for extensions |
| 45° | Standard Dutch pitch | — |
| 55° | Steep pitch (this property) | Higher wall:roof ratio |
| > 60° | Very steep | Near-vertical, low solar gain |

---

## 4. Thermal and Physical Properties / Thermische eigenschappen

These values appear in the report as inputs; U-values are calculated by VABI from the survey data.

| Term (NL) | Term (EN) | Unit | Description |
|---|---|---|---|
| U-waarde | Thermal transmittance | W/m²K | Heat loss per m² per degree difference |
| Rc-waarde | Thermal resistance | m²K/W | Insulation resistance |
| Ψ-waarde (Psi) | Linear thermal transmittance | W/mK | Thermal bridge at junctions |
| λ (lambda) | Thermal conductivity | W/mK | Material property |
| bu-factor | Temperature correction factor | — | For unheated adjacent spaces |

### Indicative U-values by Glazing Type

| Beglazing (NL) | EN | U-waarde (W/m²K) |
|---|---|---|
| Enkel Glas | Single glazing | ~5.8 |
| Dubbel Glas (pre-1990) | Double glazing old | ~2.8–3.2 |
| Dubbel Glas (post-1990) | Double glazing modern | ~2.0–2.8 |
| HR+ | HR+ glazing | ~1.6–1.8 |
| HR++ | HR++ glazing | ~1.0–1.2 |
| Triple | Triple glazing | ~0.6–0.8 |

### Frame Material U-value Contribution

| Materiaal | EN | Notes |
|---|---|---|
| Hout | Wood | Low conductivity, good insulator |
| Kunststof | PVC | Low conductivity, good insulator |
| Hout/Kunststof | Wood-PVC composite | Good insulator |
| Metaal (niet-TO) | Metal (non-TB) | High conductivity — significant heat bridge |
| Metaal (TO) | Metal (thermally broken) | Interrupted thermal bridge — improved |

> **TO = Thermisch Onderbroken (Thermally Broken)**  
> A non-thermally broken metal frame can add 1–2 W/m²K to the effective U-value of the window.

---

## 5. Surface Classification / Oppervlakteclassificatie

### GrenztAan (Borders) — Temperature Correction Factors

The bu-factor (temperature correction) reduces the effective heat loss through surfaces that do not border outside air directly.

| GrenztAan (NL) | EN | bu-factor (approx.) |
|---|---|---|
| Buitenlucht | Outside air | 1.00 |
| Aangrenzende sterk geventileerde ruimte | Strongly ventilated adjacent space | 1.00 |
| Kruipruimte | Crawl space | 0.80 |
| Aangrenzende onverwarmde ruimte | Adjacent unheated space | 0.50–0.70 |
| Aangrenzende verwarmde ruimte | Adjacent heated space | 0.00 |

---

## 6. Solar Shading Measurements / Zonwering en Bezonning

| Term (NL) | Term (EN) | Unit | Description |
|---|---|---|---|
| Overstek | Overhang depth | m | Horizontal projection of eave or canopy above window |
| Belemmering | External obstruction | m or description | Trees, neighbouring buildings blocking solar radiation |
| Zonweringfactor | Shading factor | — | Reduction factor for solar heat gain (0–1) |

### Overstek (Overhang) — Effect on Solar Gain

```
Overstek = horizontal depth of eave / canopy above the window

Example:
  Overstek = 0.00 m → no overhang → full solar gain
  Overstek = 1.35 m → significant overhang → reduced summer overheating
```

The shading factor depends on overstek, window height, and solar altitude. VABI calculates this automatically from the geometry.

### Zonwering Types and Performance

| Type (NL) | Type (EN) | Typical shading factor |
|---|---|---|
| Geen | None | 1.00 (no reduction) |
| Uitvalscherm | Drop-arm awning | 0.25–0.35 |
| Knikarmscherm | Folding arm awning | 0.25–0.35 |
| Rolluik | Roller shutter | 0.10–0.15 |
| Markies | Retractable awning | 0.25–0.40 |
| Interne zonnecel | Internal solar blind | 0.60–0.75 |

---

## 7. Roof Measurements / Dakmaten

### Hellend Dak (Pitched Roof) — Area Calculation

```
Bruto Oppervlakte = Lengte Dak × Breedte Dak

Netto Oppervlak = Bruto Oppervlakte − Oppervlakte Gaten

Oppervlakte Gaten = area of rooflights, dormers, and other penetrations
```

**Example — this property:**
```
Bruto:  7.57 × 10.40 = 78.73 m²
Gaten:  9.37 m²  (two dormer openings)
Netto:  69.36 m²
```

### Dakkapel (Dormer) Dimensions

| Term (NL) | Term (EN) | Measured at |
|---|---|---|
| Breedte dakkapel | Dormer width | External face, parallel to ridge |
| Diepte dakkapel | Dormer depth | Perpendicular to roof slope, from roof plane |
| Hoogte dakkapel | Dormer height | External face height of front wall |

---

## 8. Installation Measurements / Installatiegegevens

| Term (NL) | Term (EN) | Unit | Description |
|---|---|---|---|
| Vermogen | Power output | kW | Heating / DHW capacity |
| COP | Coefficient of Performance | — | Heat pump efficiency ratio |
| Rendement | Efficiency | % or — | Boiler / system efficiency |
| CV-klasse | Boiler class | CW1–CW6 | Dutch boiler classification |
| Opwekkingsrendement | Generation efficiency | — | From NTA 8800 system tables |

### CV Klasse Reference

| Klasse | Type | Typical seasonal efficiency |
|---|---|---|
| CW3 | Conventional boiler | 70–80% |
| CW4 | Improved efficiency | 80–90% |
| CW5 | High-efficiency condensing (HR107) | 90–107% |
| CW6 | Ultra-high efficiency | > 107% |

> The **Atag E325EC CW5** in this property is a high-efficiency condensing boiler, one of the best standard classes for gas heating in the Netherlands.

---

## 9. Quick Reference — Units Summary

| Quantity | Unit (NL) | Symbol |
|---|---|---|
| Area | vierkante meter | m² |
| Length / width / height / depth | meter | m |
| Roof pitch | graden | ° |
| Temperature | graden Celsius | °C |
| Thermal transmittance | Watt per m² Kelvin | W/m²K |
| Thermal resistance | m² Kelvin per Watt | m²K/W |
| Linear thermal transmittance | Watt per meter Kelvin | W/mK |
| Power | kilowatt | kW |
| Energy | kilowattuur per m² per jaar | kWh/m²·yr |

---

## 10. Abbreviation Glossary

| Abbreviation | Full (NL) | Full (EN) |
|---|---|---|
| GO | Gebruiksoppervlakte | Usable floor area |
| Bg | Begane grond | Ground floor |
| V1, V2 | Verdieping 1, 2 | Floor 1, 2 |
| DKK | Dakkapel | Dormer |
| TO | Thermisch Onderbroken | Thermally Broken |
| HR | Hoog Rendement | High Efficiency |
| CW | Comfortklasse Warm water | Comfort class (DHW) |
| NTA | Nederlandse Technische Afspraak | Dutch Technical Agreement |
| NEN | Nederlandse norm | Dutch standard |
| RVO | Rijksdienst voor Ondernemend Nederland | Netherlands Enterprise Agency |
| EP | Energieprestatie | Energy performance |
| EPC | Energieprestatie Coëfficiënt | Energy Performance Coefficient |
| BENG | Bijna Energie Neutrale Gebouwen | Nearly Zero Energy Buildings |
