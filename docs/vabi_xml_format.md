# VABI XML Format Reference

**Versie:** 3.0  
**Taal / Language:** Dutch field names, bilingual annotations  
**Scope:** Residential energy survey data (NTA 8800 / RVO compliant)

---

## 1. Document Root

```xml
<?xml version="1.0" encoding="UTF-8"?>
<VabiProject xmlns="http://www.vabi.nl/schema"
             versie="3.0"
             aanmaakdatum="YYYY-MM-DD">
```

| Attribute | Description (EN) | Beschrijving (NL) |
|---|---|---|
| `versie` | Schema version | Schema versie |
| `aanmaakdatum` | Creation date (ISO 8601) | Aanmaakdatum |

---

## 2. Top-Level Structure

```
VabiProject
├── Gebouw              Building identification
├── Rekenzones          Calculation zones
│   └── Rekenzone[]
│       ├── Verdiepingen    Floor levels
│       ├── Gevels          Façades / walls
│       │   └── TransparanteDelen   Windows & doors
│       ├── Vloeren         Floors
│       └── Daken           Roofs
│           └── Dakkapellen Dormers
└── Installaties        Building services
    └── Installatie[]
```

---

## 3. Gebouw (Building)

```xml
<Gebouw>
  <Omschrijving>Cor van Osnabruggelaan 88, 2251 RG Voorschoten</Omschrijving>
  <Bouwjaar>1974</Bouwjaar>
  <Gebouwtype>Vrijstaande woning</Gebouwtype>
  <Opnamedatum>2025-07-18</Opnamedatum>
  <Opnemer>Nils Maronier</Opnemer>
  <Bedrijf>Energeticas</Bedrijf>
</Gebouw>
```

| Element | EN | NL | Example |
|---|---|---|---|
| `Omschrijving` | Address / description | Adres / omschrijving | Cor van Osnabruggelaan 88 |
| `Bouwjaar` | Year of construction | Bouwjaar | 1974 |
| `Gebouwtype` | Building type | Gebouwtype | Vrijstaande woning |
| `Opnamedatum` | Survey date | Datum opname | 2025-07-18 |
| `Opnemer` | Surveyor name | Naam opnemer | Nils Maronier |
| `Bedrijf` | Company | Bedrijfsnaam | Energeticas |

---

## 4. Rekenzones (Calculation Zones)

Each building has one or more thermal zones. Residential buildings typically use a single zone.

```xml
<Rekenzones>
  <Rekenzone id="A">
    <Naam>Zone A - Volledig woning</Naam>
    <Gebruiksoppervlakte>165.78</Gebruiksoppervlakte>
    <Verdiepingen> ... </Verdiepingen>
    <Gevels> ... </Gevels>
    <Vloeren> ... </Vloeren>
    <Daken> ... </Daken>
  </Rekenzone>
</Rekenzones>
```

### 4.1 Verdiepingen (Floor Levels)

```xml
<Verdiepingen>
  <Verdieping id="Bg">
    <Naam>Begane grond</Naam>
    <Gebruiksoppervlakte>74.11</Gebruiksoppervlakte>
  </Verdieping>
  <Verdieping id="V1">
    <Naam>Eerste verdieping</Naam>
    <Gebruiksoppervlakte>67.38</Gebruiksoppervlakte>
  </Verdieping>
  <Verdieping id="V2">
    <Naam>Tweede verdieping / zolder</Naam>
    <Gebruiksoppervlakte>24.29</Gebruiksoppervlakte>
  </Verdieping>
</Verdiepingen>
```

| ID Convention | EN | NL |
|---|---|---|
| `Bg` | Ground floor | Begane grond |
| `V1` | First floor | Eerste verdieping |
| `V2` | Second floor / attic | Tweede verdieping / zolder |
| `Vv1` | Floor above first | Verdieping boven V1 |

---

## 5. Gevels (Façades / Walls)

Each wall surface is a `<Gevel>` element. Transparent elements (windows, doors) are nested within.

```xml
<Gevel id="5ef79c16">
  <Naam>Bg Achtergevel</Naam>
  <Positie>Achtergevel</Positie>
  <Orientatie>Noord-West</Orientatie>
  <Hoogte>2.52</Hoogte>
  <Breedte>8.32</Breedte>
  <Oppervlakte>20.97</Oppervlakte>
  <GrenztAan>Buitenlucht</GrenztAan>
  <DikteVloerBoven>0.10</DikteVloerBoven>
  <DikteVloerOnder>0.00</DikteVloerOnder>
  <DikteAangrezendemuren>0.22</DikteAangrezendemuren>
  <Perimeter>8.10</Perimeter>
  <OrigineleHoogte>2.42</OrigineleHoogte>
  <OrigineleBreedte>8.10</OrigineleBreedte>
  <TransparanteDelen> ... </TransparanteDelen>
</Gevel>
```

### Gevel Field Reference

| Field | EN | NL | Unit |
|---|---|---|---|
| `id` | Unique identifier | Uniek ID | — |
| `Naam` | Wall name | Muurbenaming | — |
| `Positie` | Position on building | Positie op gebouw | — |
| `Orientatie` | Cardinal orientation | Orientatie (windrichting) | — |
| `Hoogte` | Calculated height (incl. floor thicknesses) | Berekende hoogte | m |
| `Breedte` | Width | Breedte | m |
| `Oppervlakte` | Net wall area | Netto wandoppervlak | m² |
| `GrenztAan` | Borders (see values below) | Grenst aan | — |
| `DikteVloerBoven` | Floor thickness above | Dikte vloer boven | m |
| `DikteVloerOnder` | Floor thickness below | Dikte vloer onder | m |
| `DikteAangrezendemuren` | Adjacent wall thickness | Dikte aangrenzende muren | m |
| `Perimeter` | Thermal bridge perimeter | Koudebruglengte | m |
| `OrigineleHoogte` | Original internal height | Originele hoogte | m |
| `OrigineleBreedte` | Original internal width | Originele breedte | m |

### Positie Values

| Value (NL) | EN |
|---|---|
| `Voorgevel` | Front façade |
| `Achtergevel` | Rear façade |
| `Rechtergevel` | Right gable |
| `Linkergevel` | Left gable |

### Orientatie Values

| Value (NL) | EN |
|---|---|
| `Noord` | North |
| `Noord-Oost` | North-East |
| `Oost` | East |
| `Zuid-Oost` | South-East |
| `Zuid` | South |
| `Zuid-West` | South-West |
| `West` | West |
| `Noord-West` | North-West |

### GrenztAan Values

| Value (NL) | EN | Impact on calculation |
|---|---|---|
| `Buitenlucht` | Outside air | Full U-value applied |
| `Kruipruimte` | Crawl space | Reduced heat loss factor |
| `Aangrenzende onverwarmde ruimte` | Adjacent unheated space | bu-factor applied |
| `Aangrenzende sterk geventileerde ruimte` | Adjacent strongly ventilated space | Treated as outside air |
| `Aangrenzende verwarmde ruimte` | Adjacent heated space | No heat loss |

---

## 6. TransparanteDelen (Transparent Parts)

Windows and doors nested inside their parent `<Gevel>`.

```xml
<TransparanteDelen>
  <TransparantDeel id="bfa5a2d7">
    <Type>Raam</Type>
    <Hoogte>2.39</Hoogte>
    <Breedte>2.43</Breedte>
    <Oppervlakte>5.81</Oppervlakte>
    <RaamkozijnMateriaal>Metaal</RaamkozijnMateriaal>
    <ThermischOnderbroken>false</ThermischOnderbroken>
    <Beglazing>Dubbel</Beglazing>
    <Zonwering>
      <Type>Knikarmscherm</Type>
      <Bediening>Handbediening</Bediening>
    </Zonwering>
    <Overstek>0.00</Overstek>
    <Belemmering></Belemmering>
    <Notities></Notities>
  </TransparantDeel>
</TransparanteDelen>
```

### Type Values

| Value (NL) | EN |
|---|---|
| `Raam` | Window |
| `Deur` | Door (opaque) |
| `DeurMetGlas` | Glazed door |
| `Deurglas` | Door glass panel |
| `Paneel` | Panel |

### RaamkozijnMateriaal Values

| Value (NL) | EN | Thermal performance |
|---|---|---|
| `Hout` | Wood | Good insulator |
| `Kunststof` | PVC / plastic | Good insulator |
| `Hout/Kunststof` | Wood-plastic composite | Good insulator |
| `Metaal` | Metal (aluminium) | Poor — thermal bridge risk |

### ThermischOnderbroken

| Value | EN | NL |
|---|---|---|
| `true` | Thermally broken frame | Thermisch onderbroken |
| `false` | Non-thermally broken | Niet thermisch onderbroken |

> ⚠ Metal frames without thermal break (`Metaal` + `false`) have significantly higher U-values and should be flagged for retrofit consideration.

### Beglazing Values

| Value (NL) | EN | Approx. U-value (W/m²K) |
|---|---|---|
| `Enkel` | Single glazing | ~5.8 |
| `Dubbel` | Double glazing | ~2.8 |
| `HRplus` | HR+ glazing | ~1.8 |
| `HRdubbelplus` | HR++ glazing | ~1.2 |
| `Triple` | Triple glazing | ~0.7 |

### Zonwering Types

| Value (NL) | EN |
|---|---|
| `Geen` | None |
| `Knikarmscherm` | Folding arm awning |
| `Uitvalscherm` | Drop-arm awning |
| `Rolluik` | Roller shutter |
| `Markies` | Retractable awning |
| `Zonnecel` | Solar blind (internal) |

---

## 7. Vloeren (Floors)

```xml
<Vloeren>
  <Vloer id="876d7036">
    <Naam>Bg vloer</Naam>
    <GrenztAan>Kruipruimte</GrenztAan>
    <Oppervlakte>76.41</Oppervlakte>
    <Vloerisolatie>false</Vloerisolatie>
    <Bodemisolatie>false</Bodemisolatie>
    <GekoppeldGeveldeel>27c1be06</GekoppeldGeveldeel>
    <Notities>(4.9 * 10.4) + (2.90 * (5.09+3.1)) + ...</Notities>
  </Vloer>
</Vloeren>
```

| Field | EN | NL |
|---|---|---|
| `GrenztAan` | What the floor borders below | Grenst aan onder de vloer |
| `Oppervlakte` | Floor area (m²) | Vloeroppervlak |
| `Vloerisolatie` | Floor insulation present | Vloerisolatie aanwezig |
| `Bodemisolatie` | Soil insulation present | Bodemisolatie aanwezig |
| `GekoppeldGeveldeel` | Linked wall ID (perimeter) | Gekoppeld geveldeel ID |

---

## 8. Daken (Roofs)

```xml
<Daken>
  <Dak id="9ada7739">
    <Positie>Rechtergevel</Positie>
    <Orientatie>Noord-Oost</Orientatie>
    <Type>HellendDak</Type>
    <Lengte>7.57</Lengte>
    <Breedte>10.40</Breedte>
    <Nokhoogte>5.99</Nokhoogte>
    <Hoek>55.00</Hoek>
    <BrutoOppervlakte>78.73</BrutoOppervlakte>
    <OppervlakteGaten>9.37</OppervlakteGaten>
    <NettoOppervlak>69.36</NettoOppervlak>
    <Dakkapellen>
      <Dakkapel id="8ebf743c">
        <Naam>Rechts</Naam>
        <Breedte>3.21</Breedte>
        <Diepte>1.62</Diepte>
        <Hoogte>2.43</Hoogte>
      </Dakkapel>
    </Dakkapellen>
  </Dak>
</Daken>
```

### Dak Type Values

| Value (NL) | EN |
|---|---|
| `HellendDak` | Pitched roof |
| `PlatDak` | Flat roof |
| `Zadeldak` | Saddle / gable roof |

### Dakkapel (Dormer)

| Field | EN | NL |
|---|---|---|
| `Breedte` | Dormer width | Breedte dakkapel |
| `Diepte` | Dormer depth | Diepte dakkapel |
| `Hoogte` | Dormer height | Hoogte dakkapel |

---

## 9. Installaties (Building Services)

```xml
<Installaties>
  <Installatie id="d8386ba6">
    <Type>Tapwater</Type>
    <Merk>Daalderop</Merk>
    <Model>Close-in 10</Model>
    <Locatie>Keuken</Locatie>
  </Installatie>

  <Installatie id="bf92aa35">
    <Type>Verwarming</Type>
    <Merk>Atag</Merk>
    <Model>E325EC CW5</Model>
    <KlasseCV>CW5</KlasseCV>
    <Locatie>Zolder</Locatie>
  </Installatie>

  <Installatie id="6eafdfb1">
    <Type>Ventilatie</Type>
    <Merk>Onbekend</Merk>
    <Locatie>Boven keuken</Locatie>
  </Installatie>
</Installaties>
```

### Installatie Type Values

| Value (NL) | EN |
|---|---|
| `Verwarming` | Space heating system |
| `Tapwater` | Domestic hot water (DHW) |
| `Ventilatie` | Ventilation unit |
| `Koeling` | Cooling system |
| `ZonnePanelen` | Photovoltaic panels |
| `ZonneCollectoren` | Solar thermal collectors |
| `WarmtePomp` | Heat pump |

### CV Klasse (Boiler Class) — Atag E325EC CW5

| Class | Description |
|---|---|
| CW3 | Standard combi boiler |
| CW4 | High-efficiency combi |
| CW5 | High-efficiency condensing (HR107) |
| CW6 | Ultra-high efficiency |

---

## 10. ID Conventions

IDs in the report are short hexadecimal hashes (e.g. `5ef79c16`). These are generated by the survey app and persist across exports for traceability.

```
Gevel ID:        5ef79c16   (8-char hex)
TransparantDeel: bfa5a2d7   (8-char hex)
Dakkapel:        8ebf743c   (8-char hex)
Installatie:     d8386ba6   (8-char hex)
```

---

## 11. Full Minimal Example

```xml
<?xml version="1.0" encoding="UTF-8"?>
<VabiProject xmlns="http://www.vabi.nl/schema" versie="3.0" aanmaakdatum="2025-07-18">

  <Gebouw>
    <Omschrijving>Cor van Osnabruggelaan 88, 2251 RG Voorschoten</Omschrijving>
    <Bouwjaar>1974</Bouwjaar>
    <Gebouwtype>Vrijstaande woning</Gebouwtype>
  </Gebouw>

  <Rekenzones>
    <Rekenzone id="A">
      <Naam>Zone A</Naam>
      <Gebruiksoppervlakte>165.78</Gebruiksoppervlakte>

      <Gevels>
        <Gevel id="5ef79c16">
          <Naam>Bg Achtergevel</Naam>
          <Positie>Achtergevel</Positie>
          <Orientatie>Noord-West</Orientatie>
          <Hoogte>2.52</Hoogte>
          <Breedte>8.32</Breedte>
          <Oppervlakte>20.97</Oppervlakte>
          <GrenztAan>Buitenlucht</GrenztAan>
          <Perimeter>8.10</Perimeter>
          <TransparanteDelen>
            <TransparantDeel id="bfa5a2d7">
              <Type>Raam</Type>
              <Hoogte>2.39</Hoogte>
              <Breedte>2.43</Breedte>
              <Oppervlakte>5.81</Oppervlakte>
              <RaamkozijnMateriaal>Metaal</RaamkozijnMateriaal>
              <ThermischOnderbroken>false</ThermischOnderbroken>
              <Beglazing>Dubbel</Beglazing>
              <Overstek>0.00</Overstek>
            </TransparantDeel>
          </TransparanteDelen>
        </Gevel>
      </Gevels>

      <Vloeren>
        <Vloer id="876d7036">
          <Naam>Bg vloer</Naam>
          <GrenztAan>Kruipruimte</GrenztAan>
          <Oppervlakte>76.41</Oppervlakte>
          <Vloerisolatie>false</Vloerisolatie>
          <Bodemisolatie>false</Bodemisolatie>
        </Vloer>
      </Vloeren>

      <Daken>
        <Dak id="9ada7739">
          <Type>HellendDak</Type>
          <Orientatie>Noord-Oost</Orientatie>
          <Hoek>55.00</Hoek>
          <NettoOppervlak>69.36</NettoOppervlak>
        </Dak>
      </Daken>

    </Rekenzone>
  </Rekenzones>

  <Installaties>
    <Installatie id="bf92aa35">
      <Type>Verwarming</Type>
      <Merk>Atag</Merk>
      <Model>E325EC CW5</Model>
    </Installatie>
  </Installaties>

</VabiProject>
```
