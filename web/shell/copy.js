// Verdict words, reasons, colours and widths: defined once for the story and the live window.
// Archivo's width axis carries the verdict: wide and open, narrow and shut.
export const VERDICT_KEYS = ["open", "either", "shut", "ventilate"];

export const LABEL = { open: "Open the window.", either: "Either way.", shut: "Keep it shut.", ventilate: "Ventilate now." };
export const WHY = {
  open: "The sky is cleaner than the room. Let it in.",
  either: "Inside and outside are about the same, so it makes little difference.",
  shut: "The air outside is worse than the room. Keep the windows shut.",
  ventilate: "The room just spiked. Open up until it clears.",
};
export const STRETCH = { open: 125, either: 94, shut: 62, ventilate: 112 };
// on the painted wall (OKLCH lightness ~0.5) and on dark scenes
export const COLOR = { open: "#0B7643", either: "#825B0C", shut: "#AC3227", ventilate: "#7D45A2" };
export const COLOR_ON_DARK = { open: "#4AC27F", either: "#E5B54A", shut: "#F0675A", ventilate: "#B78AE0" };
// chart marks (verdict ribbon, shading): checked with the dataviz palette validator (lightness band,
// chroma, colour-blind separation >= 10 dE, contrast >= 3:1); the text colours above are darker for AA text
export const MARK = { open: "#0B7643", either: "#B08400", shut: "#A3241C", ventilate: "#7D45A2" };
// the device's 16x2 RGB LCD, same text as server/decide.py
export const LCD = {
  open: ["OPEN THE WINDOW", "Sky is cleaner", [0, 200, 60]],
  either: ["EITHER WAY", "In ~ out", [230, 170, 0]],
  shut: ["KEEP IT SHUT", "Sky is hazy", [230, 0, 0]],
  ventilate: ["VENTILATE NOW!", "Indoor spike", [150, 0, 220]],
};
// how far the lower sash is raised for each verdict, in metres (it travels 0 to 0.78 m)
export const RAISE = { open: 0.34, either: 0.08, shut: 0, ventilate: 0.64 };

export const verdictKey = (k) => (LABEL[k] ? k : "either");
