// The bundled worked example.
//
// Every other route through this tool asks the user to make a creative decision before they
// have ever seen the pipeline succeed. That is the wrong order: the first run should prove
// the whole chain works -- base model, custom texture, asset in the game, worn by name --
// with nothing to invent along the way. Then they know a failure later is THEIR change and
// not a broken setup.
//
// The skin itself is hand-made and ships with the tool (samples/blueprint/), so this costs
// nothing to offer and gives a beginner a guaranteed-success first result.

export const SAMPLE = {
  id: 'blueprint',
  name: 'mechanic_blueprint',
  character: 'pmc_hum_mechanic',
  dir: 'samples/blueprint/',
  // Only the two body sheets are replaced -- head and hair stay stock on purpose, so the
  // character still reads as a person rather than a shape.
  sheets: [
    { hash: '0x98529145', file: 'pmc_hum_mechanic_ub.png', part: 'upper body' },
    { hash: '0x87F9725E', file: 'pmc_hum_mechanic_lb.png', part: 'lower body' },
  ],
};
