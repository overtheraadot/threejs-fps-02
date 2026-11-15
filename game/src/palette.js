// BREACHLINE — the look plan, in one place. Six base values plus the two team
// colours the HUD and the bots read from; lighting makes every shade the game
// needs, so no other colour appears in the code. The same names are the CSS
// custom properties in index.html.
export const PALETTE = {
  canvas: '#0e1116', // night concrete, the fog colour
  surface: '#1b1f26', // walls and floor panels
  hairline: '#2e3440', // cover, crates, door frames
  ink: '#ece7db', // HUD text, tracer cores
  muted: '#8b93a1', // secondary HUD text
  accent: '#ffb02e', // hazard amber: objective, buy menu, hit marker
  ally: '#37c8a3', // squadmate VEX
  enemy: '#ff4d3d', // hostiles
  sky: '#4a5262', // hemisphere sky bounce so the rooms read, never a surface
};

export function shade(name) {
  return PALETTE[name];
}
