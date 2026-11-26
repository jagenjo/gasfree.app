// devices/hammer.js
// HAMMER 88 module: an electric piano made by physical modelling (no samples). Each key is a bar
// struck by a felt hammer and read by a pickup: TINE (a steel tine under a tone bar, an
// electromagnetic pickup: bell to bark) or REED (a steel reed, an electrostatic pickup: the nasal
// growl). The window on top shows the 88 bars moving as they sound. Knobs: HAMMER, DECAY, AGE,
// ALIGN, PICKUP, RELEASE, MECH, DRIVE, BASS, TREBLE, TREMOLO (RATE, DEPTH, STEREO), VOLUME, TUNE.
// Jacks: PITCH / GATE / VEL play a note, SUS holds the dampers off, TREM (depth), TREM OUT.
// DSP in hammer-worklet.js.

(function(){

var H = 300;
var JACKS = [[["PITCH","in","pitch_in"], ["GATE","in","gate_in"], ["VEL","in","vel_in"]], [["SUS","in","sus_in"], ["TREM","in","trem_in"]], [["TREM OUT","out","trem_out"]]];
var REAR_JACKS = [["OUT L","aout","out_l"], ["OUT R","aout","out_r"]];
var MODES = [["tine", "TINE", "TINES UNDER TONE BARS, AN ELECTROMAGNETIC PICKUP: BELL TO BARK"], ["reed", "REED", "STEEL REEDS, AN ELECTROSTATIC PICKUP: NASAL, A GROWL WHEN HIT HARD"]];
// starting points: [name, settings, tooltip]
var PRESETS = [
	["WARM", { mode: "tine", hammer: 0.45, decay: 0.5, align: 0.45, pickup: 0.5, drive: 0.25, bass: 0.55, treble: 0.45, trem_depth: 0 }, "TINES: ROUND, A LITTLE BELL ON TOP"],
	["BELL", { mode: "tine", hammer: 0.8, decay: 0.6, align: 0.12, pickup: 0.35, drive: 0.15, bass: 0.45, treble: 0.65, trem_depth: 0 }, "TINES AIMED AT THE MAGNET: THE OCTAVE, GLASSY"],
	["BARK", { mode: "tine", hammer: 0.7, decay: 0.5, align: 0.6, pickup: 0.85, drive: 0.55, bass: 0.5, treble: 0.55, trem_depth: 0 }, "TINES NEAR THE PICKUP, DRIVEN: IT BARKS WHEN HIT HARD"],
	["PANNER", { mode: "tine", hammer: 0.5, decay: 0.55, align: 0.45, pickup: 0.55, drive: 0.3, bass: 0.55, treble: 0.5, trem_rate: 0.45, trem_depth: 0.65, stereo: true }, "TINES THROUGH THE STEREO TREMOLO: SIDE TO SIDE"],
	["REED", { mode: "reed", hammer: 0.6, decay: 0.5, align: 0.5, pickup: 0.55, drive: 0.35, bass: 0.5, treble: 0.55, trem_rate: 0.55, trem_depth: 0.25, stereo: false }, "REEDS: NASAL, A LITTLE TREMOLO"],
	["GROWL", { mode: "reed", hammer: 0.8, decay: 0.45, align: 0.7, pickup: 0.85, drive: 0.65, bass: 0.45, treble: 0.6, trem_depth: 0 }, "REEDS NEAR THE PLATE, DRIVEN: A GROWL ON THE LOUD NOTES"]
];
var phase = {}; // module id -> the bars' drawing phase

function defaults()
{
	return { mode: "tine", hammer: 0.45, decay: 0.5, age: 0.3, align: 0.45, pickup: 0.5, release: 0.3, mech: 0.25,
		drive: 0.25, bass: 0.55, treble: 0.45, trem_rate: 0.4, trem_depth: 0, stereo: true, volume: 0.75, tune: 0 };
}

function validate( s )
{
	if(!MODES.some(function(m){ return m[0] === s.mode; })) s.mode = "tine";
	["hammer", "decay", "age", "pickup", "release", "mech", "drive", "bass", "treble", "trem_rate", "trem_depth", "volume"].forEach(function(k){ s[k] = clamp( s[k], 0, 1 ); });
	s.align = clamp( s.align, -1, 1 );
	s.tune = clamp( s.tune, -50, 50 );
}

function randomize( s )
{
	var rnd = function(a, b) { return a + Math.random() * (b - a); };
	s.mode = Math.random() < 0.6 ? "tine" : "reed";
	s.hammer = rnd( 0.25, 0.85 ); s.decay = rnd( 0.3, 0.75 ); s.age = rnd( 0, 0.6 ); s.align = rnd( 0.05, 0.8 ); s.pickup = rnd( 0.3, 0.9 );
	s.release = rnd( 0.15, 0.5 ); s.mech = rnd( 0, 0.5 ); s.drive = rnd( 0.1, 0.6 ); s.bass = rnd( 0.35, 0.65 ); s.treble = rnd( 0.35, 0.65 );
	s.trem_depth = Math.random() < 0.5 ? rnd( 0.2, 0.7 ) : 0; s.trem_rate = rnd( 0.25, 0.6 ); s.stereo = Math.random() < 0.6;
}

// the window: the 88 bars (tines under their tone bars, or reeds in their plate), moving as they
// sound, and a strip of keys under them, lit while held
function drawHarp( M, x, y, w, h )
{
	var s = M.settings, st = M.state || {}, reed = s.mode == "reed";
	if(DEV_OFF) { blankScreen( x, y, w, h, 6 ); return; }
	ctx.fillStyle = "#0b0b0b"; ctx.beginPath(); ctx.roundRect( x, y, w, h, 6 ); ctx.fill();
	var lv = {}, held = {}, v = st.v || [];
	for(var i = 0; i + 2 < v.length; i += 3) { lv[ v[i] ] = v[i + 1]; if(v[i + 2]) held[ v[i] ] = true; }
	var ph = phase[ M.id ] = ((phase[ M.id ] || 0) + 1) % 100000;
	var dx = (w - 20) / 88, x0 = x + 10 + dx * 0.5, top = y + 14, len = h - 52, ky = y + h - 30;
	// the rail the bars are fixed to; the felt the hammers come from
	ctx.fillStyle = reed ? "#5b5a55" : "#3c3a36"; ctx.fillRect( x + 6, top - 6, w - 12, 8 );
	ctx.fillStyle = "#5a1f1c"; ctx.fillRect( x + 6, top + len * 0.18, w - 12, 4 );
	for(var k = 0; k < 88; ++k)
	{
		var note = 21 + k, cx = x0 + k * dx, a = lv[ note ] || 0;
		var l = len * (reed ? 0.62 - 0.32 * k / 87 : 0.95 - 0.5 * k / 87); // the bars get shorter up the keys
		var dev = a > 0.005 ? Math.sin( ph * (0.9 + (k % 7) * 0.13) ) * Math.min( 1, a ) * dx * 1.6 : 0;
		if(reed)
		{
			ctx.fillStyle = a > 0.005 ? "#d9d6cc" : "#8f8d86";
			ctx.beginPath(); ctx.moveTo( cx - dx * 0.3, top ); ctx.lineTo( cx + dx * 0.3, top ); ctx.lineTo( cx + dx * 0.3 + dev, top + l ); ctx.lineTo( cx - dx * 0.3 + dev, top + l ); ctx.fill();
			ctx.fillStyle = "#7a6a3a"; ctx.fillRect( cx - dx * 0.32 + dev, top + l - 4, dx * 0.64, 4 ); // the solder at the tip
		}
		else
		{
			// the tone bar (gold), then the tine (steel) along it
			ctx.fillStyle = "#9c7d38"; ctx.fillRect( cx - dx * 0.38, top, dx * 0.76, l * 0.55 );
			ctx.strokeStyle = a > 0.005 ? "#e8e6e0" : "#9a9892"; ctx.lineWidth = Math.max( 1, dx * 0.22 );
			ctx.beginPath(); ctx.moveTo( cx, top + l * 0.2 ); ctx.quadraticCurveTo( cx, top + l * 0.75, cx + dev, top + l ); ctx.stroke();
		}
		// the pickup under each tip: a magnet (TINE), a slot in the charged plate (REED)
		ctx.fillStyle = reed ? "#4d4c47" : "#2d2b28";
		if(reed) ctx.fillRect( cx - dx * 0.48, top + l + 2, dx * 0.96, 4 );
		else { ctx.beginPath(); ctx.arc( cx + (s.align * dx * 0.3), top + l + 6, Math.max( 1.5, dx * 0.32 ), 0, Math.PI * 2 ); ctx.fill(); }
	}
	// the keys: 52 white ones across, the black ones over them; lit red while held (or by the pedal)
	var wk = (w - 20) / 52, wi = 0, blacks = [];
	for(var k = 0; k < 88; ++k)
	{
		var note = 21 + k, b = [1, 3, 6, 8, 10].indexOf( note % 12 ) >= 0;
		if(b) { blacks.push([ x + 10 + wi * wk - wk * 0.32, held[ note ] ]); continue; }
		ctx.fillStyle = held[ note ] ? "#ff4a3a" : "#d8d5cb";
		ctx.fillRect( x + 10 + wi * wk + 0.5, ky, wk - 1, 22 );
		wi++;
	}
	blacks.forEach(function(b){ ctx.fillStyle = b[1] ? "#c0281e" : "#161616"; ctx.fillRect( b[0], ky, wk * 0.64, 13 ); });
}

function draw( M )
{
	var size = M.def.size( layout ), w = size[0], h = size[1];
	var s = M.settings;
	drawDevicePanel( 0, 0, w, h, "HAMMER 88", ["ELECTRIC PIANO", "PHYSICAL MODEL: TINES OR REEDS"] );
	var px = drawDeviceJacks( 0, 0, w, h, JACKS );
	drawHarp( M, 40, 14, px - 56, 140 );
	if(hitRect( 40, 14, px - 56, 140 )) tip( s.mode == "reed" ? "THE REEDS AND THEIR PICKUP PLATE, MOVING AS THEY SOUND" : "THE TINES, THEIR TONE BARS AND PICKUPS, MOVING AS THEY SOUND", (40 + px - 16) / 2, 166 );
	// the knobs, by section
	var y = 228, r = 17, sy = 172;
	var X = function(i){ return 70 + i * ((px - 110) / 14); };
	drawSection( "BAR", X(0) - 34, X(2) + 34, sy );
	MODES.forEach(function(m, i){
		if(tinyButton( "mode_" + m[0], X(0) - 30, y - 26 + i * 30, 60, 20, m[1], s.mode == m[0], "MODE: " + m[1] + ": " + m[2] )) s.mode = m[0];
	});
	s.decay = knob( "decay", X(1), y, r, s.decay, 0, 1, { label: "DECAY", def: 0.5, format: function(v){ return "SUSTAIN x" + Math.pow( 2, v * 3 - 1.5 ).toFixed( 2 ); } } );
	s.age = knob( "age", X(2), y, r, s.age, 0, 1, { label: "AGE", def: 0.3, format: function(v){ return v < 0.01 ? "NEW: EVERY KEY VOICED THE SAME" : "KEY TO KEY FAULTS, TONE BAR BEATING " + fmtPct( v ); } } );
	drawSection( "ACTION", X(3) - 34, X(4) + 34, sy );
	s.hammer = knob( "hammer", X(3), y, r, s.hammer, 0, 1, { label: "HAMMER", def: 0.45, format: function(v){ return v < 0.3 ? "SOFT FELT: ROUND" : (v < 0.7 ? "MEDIUM FELT" : "HARD FELT: BRIGHT"); } } );
	s.release = knob( "release", X(4), y, r, s.release, 0, 1, { label: "DAMPER", def: 0.3, format: function(v){ return "THE DAMPER STOPS A NOTE IN " + Math.round( (0.012 + v * v * 0.6) * 1000 ) + " MS"; } } );
	drawSection( "PICKUP", X(5) - 34, X(7) + 34, sy );
	s.align = knob( "align", X(5), y, r, s.align, -1, 1, { label: "ALIGN", def: 0.45, bipolar: true, format: function(v){ return Math.abs( v ) < 0.15 ? "ON THE MAGNET'S AXIS: THE OCTAVE, A BELL" : "OFF THE AXIS " + Math.round( Math.abs( v ) * 100 ) + "%: MORE FUNDAMENTAL"; } } );
	s.pickup = knob( "pickup", X(6), y, r, s.pickup, 0, 1, { label: "NEAR", def: 0.5, format: function(v){ return "PICKUP DISTANCE: " + (v < 0.35 ? "FAR, CLEAN" : (v < 0.7 ? "MEDIUM" : "NEAR, IT BARKS")); } } );
	s.mech = knob( "mech", X(7), y, r, s.mech, 0, 1, { label: "MECH", def: 0.25, format: function(v){ return "HAMMER AND DAMPER THUMPS " + fmtPct( v ); } } );
	drawSection( "AMP", X(8) - 34, X(10) + 34, sy );
	s.drive = knob( "drive", X(8), y, r, s.drive, 0, 1, { label: "DRIVE", def: 0.25, format: fmtPct } );
	s.bass = knob( "bass", X(9), y, r, s.bass, 0, 1, { label: "BASS", def: 0.55, bipolar: true, format: function(v){ return (v >= 0.5 ? "+" : "") + Math.round( (v - 0.5) * 24 ) / 2 + " (250 HZ SHELF)"; } } );
	s.treble = knob( "treble", X(10), y, r, s.treble, 0, 1, { label: "TREBLE", def: 0.45, bipolar: true, format: function(v){ return (v >= 0.5 ? "+" : "") + Math.round( (v - 0.5) * 24 ) / 2 + " (2.5 KHZ SHELF)"; } } );
	drawSection( "TREMOLO", X(11) - 34, X(12) + 34, sy );
	s.trem_rate = knob( "trem_rate", X(11), y, r, s.trem_rate, 0, 1, { label: "RATE", def: 0.4, format: function(v){ return (0.4 * Math.pow( 25, v )).toFixed( 2 ) + " HZ"; } } );
	s.trem_depth = knob( "trem_depth", X(12), y, r, s.trem_depth, 0, 1, { label: "DEPTH", def: 0, format: function(v){ return v < 0.01 ? "OFF" : fmtPct( v ); } } );
	if(tinyButton( "stereo", X(11) + 8, y + 26, 60, 14, "STEREO", s.stereo, "STEREO: THE SOUND GOES FROM SIDE TO SIDE; OFF: THE LEVEL GOES UP AND DOWN" )) s.stereo = !s.stereo;
	var st = M.state || {};
	drawLed( X(12) + 30, y - 26, 3, s.trem_depth > 0.01 && (st.trem || 0) > 0.5, "#ff3b2f" );
	drawSection( "OUTPUT", X(13) - 34, X(14) + 30, sy );
	s.volume = knob( "volume", X(13), y, r + 3, s.volume, 0, 1, { label: "VOLUME", def: 0.75, format: fmtPct } );
	s.tune = knob( "tune", X(14), y, 12, s.tune, -50, 50, { label: "TUNE", def: 0, bipolar: true, labelSize: 10, format: function(v){ return Math.round( v ) + " CENTS"; } } );
	// presets, along the bottom
	PRESETS.forEach(function(p, i){
		var on = Object.keys( p[1] ).every(function(k){ return s[k] === p[1][k]; });
		if(tinyButton( "preset" + i, 420 + i * 70, h - 30, 64, 16, p[0], on, p[2] ))
			Object.keys( p[1] ).forEach(function(k){ s[k] = p[1][k]; });
	});
}

WR.registerSynth( "hammer", {
	title: "HAMMER 88",
	description: "HAMMER 88: electric piano by physical modelling, tines or reeds",
	about: "An electric piano made by physical modelling, no samples: each key a tine or a reed struck by a felt hammer, read by its pickup, with dampers, a preamp, tone and a stereo tremolo.",
	// keys: 3 played / triggered, 2 often, 1 sometimes, 0 no key (code.js: keyAssign)
	key_prio: [["^mode_", 1], ["^preset", 1], ["^stereo$", 1], ["", 0]],
	knob_jacks: [["^trem_depth$", ["trem_in"]]],
	category: "Synths",
	worklet: "devices/hammer-worklet.js",
	jacks: JACKS,
	rear_jacks: REAR_JACKS,
	audio_out: "out_l",
	audio_out_r: "out_r",
	midi_in: "midi_in",
	knob_skin: "cream",
	defaults: defaults,
	validate: validate,
	randomize: randomize,
	size: function( layout ) { return [ LAYOUTS[ layout ].w, H ]; },
	draw: draw,
	transport: function( mod, action, value ) { if(action == "trigger") mod.post({ type: "trigger", gate: value }); },
	rear_note: function( s ) { return (s.mode == "reed" ? "REEDS" : "TINES") + " · STEREO OUT"; }
});

})();
