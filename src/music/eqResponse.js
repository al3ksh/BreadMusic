// @ts-check
// Lavaplayer's 15-band equalizer, modelled closely enough to know how far a set of band gains
// can push a full-scale signal. The equalizer hard-clips its own output, so the bot has to leave
// that much headroom before the signal reaches it.

// [beta, alpha, gamma] per band at 48 kHz, copied from lavaplayer's Equalizer.
const COEFFICIENTS = [
  [9.9847546664e-01, 7.6226668143e-04, 1.9984647656e+00],
  [9.9756184654e-01, 1.2190767289e-03, 1.9975344645e+00],
  [9.9616261379e-01, 1.9186931041e-03, 1.9960947369e+00],
  [9.9391578543e-01, 3.0421072865e-03, 1.9937449618e+00],
  [9.9028307215e-01, 4.8584639242e-03, 1.9898465702e+00],
  [9.8485897264e-01, 7.5705136795e-03, 1.9837962543e+00],
  [9.7588512657e-01, 1.2057436715e-02, 1.9731772447e+00],
  [9.6228521814e-01, 1.8857390928e-02, 1.9556164694e+00],
  [9.4080933132e-01, 2.9595334338e-02, 1.9242054384e+00],
  [9.0702059196e-01, 4.6489704022e-02, 1.8653476166e+00],
  [8.5868004289e-01, 7.0659978553e-02, 1.7600401337e+00],
  [7.8409610788e-01, 1.0795194606e-01, 1.5450725522e+00],
  [6.8332861002e-01, 1.5833569499e-01, 1.1426447155e+00],
  [5.5267518228e-01, 2.2366240886e-01, 4.0186190803e-01],
  [4.1811888447e-01, 2.9094055777e-01, -7.0905944223e-01],
];

const SAMPLE_RATE = 48000;
const FREQUENCIES = [];
for (let f = 20; f <= 20000; f *= 1.01) FREQUENCIES.push(f);

// Each band is a resonator y = alpha(x - x[-2]) + gamma y[-1] - beta y[-2], mixed in as
// out = 4 * (x / 4 + sum(gain * band)), so the overall response is 1 + 4 * sum(gain * H(w)).
function bandResponse(band, w) {
  const [beta, alpha, gamma] = COEFFICIENTS[band];
  const nr = alpha * (1 - Math.cos(2 * w));
  const ni = alpha * Math.sin(2 * w);
  const dr = 1 - gamma * Math.cos(w) + beta * Math.cos(2 * w);
  const di = gamma * Math.sin(w) - beta * Math.sin(2 * w);
  const d = dr * dr + di * di;
  return [(nr * dr + ni * di) / d, (ni * dr - nr * di) / d];
}

/**
 * Largest amplitude gain the equalizer applies at any audible frequency.
 * @param {Array<{ band: number, gain: number }>} bands
 */
function eqPeakGain(bands) {
  const active = (bands || []).filter((entry) => entry && entry.gain && COEFFICIENTS[entry.band]);
  if (!active.length) return 1;
  let peak = 0;
  for (const f of FREQUENCIES) {
    const w = (2 * Math.PI * f) / SAMPLE_RATE;
    let re = 1;
    let im = 0;
    for (const { band, gain } of active) {
      const [r, i] = bandResponse(band, w);
      re += 4 * gain * r;
      im += 4 * gain * i;
    }
    peak = Math.max(peak, Math.hypot(re, im));
  }
  return peak;
}

module.exports = { eqPeakGain };
