"use client";
import { useState } from "react";

// Every third-party source the page displays. Keep in sync with the README "Credits" section.
const GROUPS: { label: string; sources: { name: string; href: string; title: string }[] }[] = [
  { label: "Events", sources: [
    { name: "USGS", href: "https://earthquake.usgs.gov/earthquakes/feed/", title: "U.S. Geological Survey earthquake feeds (public domain)" },
    { name: "NASA FIRMS", href: "https://firms.modaps.eosdis.nasa.gov/", title: "NASA Fire Information for Resource Management System" },
    { name: "GDACS", href: "https://www.gdacs.org/", title: "Global Disaster Alert and Coordination System" },
    { name: "GDELT", href: "https://www.gdeltproject.org/", title: "The GDELT Project event data" },
    { name: "GNews", href: "https://gnews.io/", title: "Headlines via the GNews API" },
    { name: "Wikipedia", href: "https://en.wikipedia.org/wiki/Portal:Current_events", title: "Wikipedia Current events, CC BY-SA 4.0" },
  ] },
  { label: "Satellite", sources: [
    { name: "NASA GIBS", href: "https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api", title: "VIIRS true color and active fire imagery via NASA Global Imagery Browse Services" },
    { name: "JRC GHSL", href: "https://human-settlement.emergency.copernicus.eu/ghs_pop2023.php", title: "GHS-POP R2023A population grid, European Commission JRC (CC BY 4.0)" },
  ] },
  { label: "Map", sources: [
    { name: "Natural Earth", href: "https://www.naturalearthdata.com/", title: "Natural Earth country shapes (public domain)" },
    { name: "three-globe", href: "https://github.com/vasturiano/three-globe", title: "Elevation heightmap from the three-globe examples (MIT)" },
  ] },
  { label: "Stars", sources: [
    { name: "Yale BSC5 / CDS", href: "https://cdsarc.cds.unistra.fr/viz-bin/cat/V/50", title: "Yale Bright Star Catalogue, 5th Revised Ed. (Hoffleit & Warren 1991), CDS Strasbourg" },
  ] },
];

/** Small corner credit line, as on most web maps. Collapses to a toggle on narrow screens. */
export default function DataAttribution() {
  const [open, setOpen] = useState(false);
  return <footer className="data-attribution" data-open={open || undefined}>
    <button type="button" className="data-attribution-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>Data sources</button>
    <p>{GROUPS.map(group => <span key={group.label} className="data-attribution-group">
      {group.label}: {group.sources.map((source, index) => <span key={source.name}>
        {index > 0 && " · "}<a href={source.href} title={source.title} target="_blank" rel="noreferrer">{source.name}</a>
      </span>)}
    </span>)}</p>
  </footer>;
}
