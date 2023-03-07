export const config = {
  runtime: 'edge',
  regions: ['lhr1', 'syd1', 'cpt1', 'bom1', 'gru1', 'cle1'],
};

export default (req: Request) => {
  return new Response(`Hello, from ${req.url} I'm now an Edge Function!`);
};
