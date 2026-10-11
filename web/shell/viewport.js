// The viewport size, read once per resize. Reading innerWidth/innerHeight makes Chrome run any pending
// style and layout work first, so code that runs every frame (or every pointer move) reads this instead.
export const viewport = { w: innerWidth, h: innerHeight };
addEventListener("resize", () => { viewport.w = innerWidth; viewport.h = innerHeight; });
