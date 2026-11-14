// Canonical provider links for the data behind every case file. Shared by the
// app's source strip and the landing page's data section so they cannot drift.

export const SOURCE_LINKS = {
  gistemp: { label: "NASA GISTEMP v4", url: "https://data.giss.nasa.gov/gistemp/" },
  power: { label: "NASA POWER", url: "https://power.larc.nasa.gov/" },
  meteomatics: { label: "Meteomatics", url: "https://www.meteomatics.com/" },
  earthdata: { label: "NASA Earthdata", url: "https://www.earthdata.nasa.gov/" },
  planetary: {
    label: "Sentinel-2 L2A via Microsoft Planetary Computer",
    url: "https://planetarycomputer.microsoft.com/",
  },
  "blue-marble": {
    label: "NASA Blue Marble",
    url: "https://visibleearth.nasa.gov/collection/1484/blue-marble",
  },
};

// Reading order used on the landing page, which follows the narrative rather
// than the source-check order in data/sources.json.
export const SOURCE_ORDER = [
  "gistemp",
  "power",
  "meteomatics",
  "earthdata",
  "planetary",
  "blue-marble",
];
