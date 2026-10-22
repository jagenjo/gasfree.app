// devices/midifx.js
// MIDI FX module: effects on the notes, between the keys (or the song, or a GRID 32) and the synths.
// MIDI IN on the back takes the notes; MIDI OUT sends them on to the devices cabled from it. Sections:
// TIMING (GRID, CHANCE), PITCH (TRANSPOSE, HARMONY, SCALE with its ROOT), ARP (MODE, RATE, OCTAVES,
// GATE, LATCH), ECHO (REPEATS, TIME, FEEDBACK, PITCH), VELOCITY (AMOUNT, RANDOM). A screen shows the
// notes in and out. CV: CLOCK IN (the steps), TRANSPOSE (1 V/oct); PITCH, GATE, VELOCITY out (the
// last note out). DSP in midifx-worklet.js.

(function(){

var H = 270;
var T = WR_DSP.midifx.TABLES;
var JACKS = [[["CLOCK", "in", "clock_in"], ["TRANSP", "in", "trans_in"]], [["PITCH", "out", "pitch_out"], ["GATE", "out", "gate_out"], ["VEL", "out", "vel_out"]]];
var REAR_JACKS = [["MIDI OUT", "midiout", "midi_out"]];
// starting points: [name, settings, tooltip]
var BASE = { on: true, tq_on: false, chance: 1, transpose: 0, harm: 0, sc_on: false, arp_on: false, arp_latch: false, echo_on: false, velocity: 1, vel_rand: 0 };
var PRESETS = [
	["THRU", {}, "EVERY SECTION OFF: THE NOTES AS PLAYED"],
	["CHORDS", { harm: 14, sc_on: true, scale: 1 }, "A TRIAD OF THE SCALE ON EACH NOTE (C MINOR)"],
	["ARP", { arp_on: true, arp_mode: 2, arp_div: 4, arp_oct: 2, arp_gate: 0.5 }, "THE NOTES HELD, UP AND DOWN, TWO OCTAVES, IN 1/16"],
	["ECHOES", { echo_on: true, echo_rep: 4, echo_div: 3, echo_fb: 0.6, echo_pitch: 0 }, "EACH NOTE REPEATED FOUR TIMES IN 1/8T, FADING"],
	["RISING", { echo_on: true, echo_rep: 5, echo_div: 4, echo_fb: 0.8, echo_pitch: 7, sc_on: true, scale: 7 }, "ECHOES A FIFTH HIGHER EACH TIME, IN A PENTATONIC SCALE"],
	["SPARKLE", { harm: 1, arp_on: true, arp_mode: 3, arp_div: 6, arp_oct: 2, arp_gate: 0.3, chance: 0.8, vel_rand: 0.5 }, "RANDOM NOTES OF THE CHORD AND ITS OCTAVE IN 1/32, SOME LEFT OUT"]
];

function defaults()
{
	return { on: true, tq_on: false, tq_div: 4, chance: 1, transpose: 0, harm: 0, sc_on: false, root: 0, scale: 0,
		arp_on: false, arp_latch: false, arp_mode: 0, arp_div: 4, arp_oct: 1, arp_gate: 0.5,
		echo_on: false, echo_rep: 3, echo_div: 2, echo_fb: 0.5, echo_pitch: 0, velocity: 1, vel_rand: 0 };
}

function validate( s )
{
	var int = function(v, a, b) { return Math.min( b, Math.max( a, Math.round( +v || 0 ) ) ); };
	s.tq_div = int( s.tq_div, 0, T.DIVS.length - 1 ); s.arp_div = int( s.arp_div, 0, T.DIVS.length - 1 ); s.echo_div = int( s.echo_div, 0, T.DIVS.length - 1 );
	s.harm = int( s.harm, 0, T.CHORDS.length - 1 ); s.scale = int( s.scale, 0, T.SCALES.length - 1 ); s.root = int( s.root, 0, 11 );
	s.arp_mode = int( s.arp_mode, 0, T.ARP_MODES.length - 1 ); s.arp_oct = int( s.arp_oct, 1, 4 );
	s.transpose = int( s.transpose, -24, 24 ); s.echo_rep = int( s.echo_rep, 1, 8 ); s.echo_pitch = int( s.echo_pitch, -12, 12 );
	s.chance = Math.min( 1, Math.max( 0, s.chance ) ); s.arp_gate = Math.min( 1, Math.max( 0.05, s.arp_gate ) );
	s.echo_fb = Math.min( 1, Math.max( 0, s.echo_fb ) ); s.velocity = Math.min( 2, Math.max( 0, s.velocity ) ); s.vel_rand = Math.min( 1, Math.max( 0, s.vel_rand ) );
}

function randomize( s )
{
	var pick = function(n) { return Math.floor( Math.random() * n ); };
	s.harm = Math.random() < 0.5 ? 0 : pick( T.CHORDS.length ); s.sc_on = Math.random() < 0.5; s.scale = pick( T.SCALES.length ); s.root = pick( 12 );
	s.arp_on = Math.random() < 0.5; s.arp_mode = pick( T.ARP_MODES.length ); s.arp_div = 2 + pick( 5 ); s.arp_oct = 1 + pick( 3 ); s.arp_gate = 0.2 + Math.random() * 0.7;
	s.echo_on = Math.random() < 0.5; s.echo_rep = 1 + pick( 6 ); s.echo_div = 1 + pick( 6 ); s.echo_fb = 0.3 + Math.random() * 0.6; s.echo_pitch = Math.random() < 0.6 ? 0 : [-12, -5, 5, 7, 12][ pick( 5 ) ];
	s.chance = Math.random() < 0.7 ? 1 : 0.6 + Math.random() * 0.4;
}

function noteName( n ) { return T.NOTE_N[ ((n % 12) + 12) % 12 ] + (Math.floor( n / 12 ) - 1); }
function semis( v ) { return v == 0 ? "0" : (v > 0 ? "+" : "") + v + " ST"; }
function divName( i ) { return T.DIVS[ i ][0]; }

// a section: a darker area with its title, and its ON switch when it has one
function section( x, y, w, h, title, onKey, s, tooltip )
{
	ctx.fillStyle = "rgba(0,0,0,0.22)";
	ctx.beginPath(); ctx.roundRect( x, y, w, h, 6 ); ctx.fill();
	ctx.strokeStyle = "#30302d"; ctx.lineWidth = 1; ctx.stroke();
	ctx.font = "bold 12px " + FONT; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillStyle = TEXT_COLOR;
	ctx.fillText( title, x + 12, y + 16 );
	if(onKey && tinyButton( onKey, x + w - 48, y + 8, 38, 16, "ON", !!s[ onKey ], tooltip )) s[ onKey ] = !s[ onKey ];
}

// the screen: the notes in, the notes out, what is on
function drawScreen( x, y, w, h, s, st )
{
	ctx.fillStyle = "#070a07"; ctx.beginPath(); ctx.roundRect( x, y, w, h, 4 ); ctx.fill();
	ctx.strokeStyle = "#2b2e2a"; ctx.lineWidth = 1; ctx.stroke();
	var green = "#8cf06a", dim = "#2f5a26";
	ctx.font = "bold 12px " + FONT; ctx.textAlign = "left"; ctx.textBaseline = "middle";
	var line = function(k, label, text, on) {
		ctx.fillStyle = dim; ctx.fillText( label, x + 8, y + 15 + k * 19 );
		ctx.fillStyle = on ? green : dim; ctx.fillText( text, x + 42, y + 15 + k * 19 );
	};
	var ins = st.ins || [], outs = st.outs || [];
	line( 0, "IN", ins.length ? ins.map( noteName ).join( " " ) : "-", ins.length );
	line( 1, "OUT", outs.length ? outs.map( noteName ).join( " " ) : "-", outs.length );
	var fx = [];
	if(!s.on) fx.push( "BYPASSED" );
	else
	{
		if(s.tq_on) fx.push( "GRID " + divName( s.tq_div ) );
		if(s.transpose) fx.push( semis( s.transpose ) );
		if(s.harm) fx.push( T.CHORDS[ s.harm ][0] );
		if(s.sc_on) fx.push( T.NOTE_N[ s.root ] + " " + T.SCALES[ s.scale ][0] );
		if(s.arp_on) fx.push( "ARP " + T.ARP_MODES[ s.arp_mode ] );
		if(s.echo_on) fx.push( "ECHO x" + s.echo_rep );
		if(!fx.length) fx.push( "THRU" );
	}
	ctx.font = "bold 10px " + FONT; ctx.fillStyle = green;
	var t = fx.join( " · " );
	while(t.length > 4 && ctx.measureText( t ).width > w - 16) t = t.substr( 0, t.length - 2 );
	ctx.fillText( t, x + 8, y + 15 + 2 * 19 );
	ctx.fillStyle = dim;
	ctx.fillText( st.clock ? "CLOCK IN" : Math.round( st.tempo || 120 ) + " BPM", x + 8, y + 15 + 3 * 19 );
}

var lights = {};   // module id -> [in, out] activity, held a little longer to be seen

function draw( M )
{
	var size = M.def.size( layout ), w = size[0], h = size[1];
	var s = M.settings, st = M.state || {};
	drawDevicePanel( 0, 0, w, h, "MIDI FX", ["NOTE EFFECTS", "TIMING · HARMONY · ARP · ECHO"] );
	var px = drawDeviceJacks( 0, 0, w, h, JACKS );
	var Y = 16, SH = 206, y1 = 92, y2 = 178;
	// the sections share what is left between the screen and the jacks (narrower in the classic layout)
	var k = (px - 12 - 252) / 1100, X = function(v){ return 252 + (v - 252) * k; };

	// the screen, its activity lights, ON (off: the notes go through as they are)
	drawScreen( 44, Y, 196, 88, s, st );
	var a = lights[ M.id ] = lights[ M.id ] || [0, 0];
	if(st.act) { if(st.act[0]) a[0] = 8; if(st.act[1]) a[1] = 8; }
	drawLed( 56, 122, 4, a[0] > 0, "#6cdc5a" ); drawLabel( "IN", 74, 123, 10 );
	drawLed( 100, 122, 4, a[1] > 0, "#ffb02f" ); drawLabel( "OUT", 122, 123, 10 );
	a[0]--; a[1]--;
	if(button( "on", 160, 110, 80, 26, "ON", s.on ).clicked) s.on = !s.on;
	if(hitRect( 160, 110, 80, 26 )) tip( "OFF: THE NOTES GO THROUGH AS THEY ARE", 200, 146 );
	drawLabel( "PRESETS", 142, 156, 9 );
	PRESETS.forEach(function(p, i){
		var vals = Object.assign( {}, BASE, p[1] );
		var on = Object.keys( vals ).every(function(k){ return s[k] === vals[k]; });
		if(tinyButton( "preset" + i, 44 + (i % 3) * 66, 168 + Math.floor( i / 3 ) * 22, 62, 16, p[0], on, p[2] ))
			Object.keys( vals ).forEach(function(k){ s[k] = vals[k]; });
	});

	// TIMING: note-ons to the grid, CHANCE
	var x = 252;
	section( x, Y, 120 * k, SH, "TIMING", "tq_on", s, "NOTE-ONS MOVED TO THE NEXT STEP OF THE GRID; THE NOTES KEEP THEIR LENGTH" );
	s.tq_div = knob( "tq_div", x + 60 * k, y1, 19, s.tq_div, 0, T.DIVS.length - 1, { label: "GRID", step: 1, def: 4, format: function(v){ return "GRID " + divName( v ); } } );
	s.chance = knob( "chance", x + 60 * k, y2, 19, s.chance, 0, 1, { label: "CHANCE", def: 1, format: function(v){ return Math.round( v * 100 ) + "% OF THE NOTES PLAY"; } } );

	// PITCH: TRANSPOSE, HARMONY, SCALE
	x = X( 384 );
	section( x, Y, 250 * k, SH, "PITCH", null, s );
	s.transpose = knob( "transpose", x + 62 * k, y1, 19, s.transpose, -24, 24, { label: "TRANSPOSE", step: 1, def: 0, bipolar: true, ticks: 11, format: function(v){ return "TRANSPOSE " + semis( v ); } } );
	s.harm = knob( "harm", x + 182 * k, y1, 19, s.harm, 0, T.CHORDS.length - 1, { label: "HARMONY", step: 1, def: 0, format: function(v){ return "HARMONY: " + T.CHORDS[ v ][0]; } } );
	if(tinyButton( "sc_on", x + 12 * k, y2 - 8, 44, 16, "SCALE", s.sc_on, "EVERY NOTE MOVED INTO THE SCALE (THE HARMONY TOO)" )) s.sc_on = !s.sc_on;
	s.root = knob( "root", x + 110 * k, y2, 17, s.root, 0, 11, { label: "ROOT", step: 1, def: 0, format: function(v){ return "ROOT " + T.NOTE_N[ v ]; } } );
	s.scale = knob( "scale", x + 194 * k, y2, 17, s.scale, 0, T.SCALES.length - 1, { label: "SCALE", step: 1, def: 0, format: function(v){ return "SCALE: " + T.SCALES[ v ][0]; } } );

	// ARP
	x = X( 646 );
	section( x, Y, 260 * k, SH, "ARP", "arp_on", s, "THE NOTES HELD, PLAYED ONE AT A TIME" );
	if(tinyButton( "arp_latch", x + 150 * k, Y + 8, 52, 16, "LATCH", s.arp_latch, "THE NOTES KEEP PLAYING AFTER THE KEYS ARE LET GO, UNTIL A NEW CHORD" )) s.arp_latch = !s.arp_latch;
	s.arp_mode = knob( "arp_mode", x + 66 * k, y1, 19, s.arp_mode, 0, T.ARP_MODES.length - 1, { label: "MODE", step: 1, def: 0, format: function(v){ return "MODE: " + T.ARP_MODES[ v ]; } } );
	s.arp_div = knob( "arp_div", x + 194 * k, y1, 19, s.arp_div, 0, T.DIVS.length - 1, { label: "RATE", step: 1, def: 4, format: function(v){ return st.clock ? "A STEP A CLOCK PULSE" : "RATE " + divName( v ); } } );
	s.arp_oct = knob( "arp_oct", x + 66 * k, y2, 17, s.arp_oct, 1, 4, { label: "OCTAVES", step: 1, def: 1, format: function(v){ return v + (v > 1 ? " OCTAVES" : " OCTAVE"); } } );
	s.arp_gate = knob( "arp_gate", x + 194 * k, y2, 17, s.arp_gate, 0.05, 1, { label: "GATE", def: 0.5, format: function(v){ return "GATE " + Math.round( v * 100 ) + "% OF A STEP"; } } );

	// ECHO
	x = X( 918 );
	section( x, Y, 260 * k, SH, "ECHO", "echo_on", s, "EACH NOTE REPEATED, QUIETER EACH TIME" );
	s.echo_rep = knob( "echo_rep", x + 66 * k, y1, 19, s.echo_rep, 1, 8, { label: "REPEATS", step: 1, def: 3, format: function(v){ return v + (v > 1 ? " REPEATS" : " REPEAT"); } } );
	s.echo_div = knob( "echo_div", x + 194 * k, y1, 19, s.echo_div, 0, T.DIVS.length - 1, { label: "TIME", step: 1, def: 2, format: function(v){ return st.clock ? "A CLOCK PULSE" : "TIME " + divName( v ); } } );
	s.echo_fb = knob( "echo_fb", x + 66 * k, y2, 17, s.echo_fb, 0, 1, { label: "FEEDBACK", def: 0.5, format: function(v){ return "EACH REPEAT AT " + Math.round( v * 100 ) + "% VELOCITY"; } } );
	s.echo_pitch = knob( "echo_pitch", x + 194 * k, y2, 17, s.echo_pitch, -12, 12, { label: "PITCH", step: 1, def: 0, bipolar: true, format: function(v){ return v ? "EACH REPEAT " + semis( v ) : "REPEATS AT THE SAME PITCH"; } } );

	// VELOCITY
	x = X( 1190 );
	section( x, Y, px - x - 12, SH, "VELOCITY", null, s );
	var vx = x + (px - x - 12) / 2;
	s.velocity = knob( "velocity", vx, y1, 19, s.velocity, 0, 2, { label: "AMOUNT", def: 1, format: function(v){ return "VELOCITY x" + v.toFixed( 2 ); } } );
	s.vel_rand = knob( "vel_rand", vx, y2, 17, s.vel_rand, 0, 1, { label: "RANDOM", def: 0, format: function(v){ return v < 0.01 ? "AS PLAYED" : "RANDOM " + Math.round( v * 100 ) + "%"; } } );
}

// a new MIDI FX goes between the keys and the last synth that hears them: the keys into it (MASTER
// MIDI), its MIDI OUT into that synth, whose MASTER MIDI goes off
function onAdd( m )
{
	var s = rack.settings, mods = s.modules;
	var synth = null;
	for(var i = mods.length - 1; i >= 0; --i)
	{
		var o = mods[i], d = WR.types[ o.type ];
		if(o === m || !d || !d.midi_in || o.type == "midifx") continue;
		var cabled = s.patches.some(function(p){ return p[0] == "kb_midi" && p[1] == WR.jackId( o.id, d.midi_in ); });
		if(o.settings.midi_master || cabled) { synth = o; break; }
	}
	if(!synth) return;
	rack.connect( WR.jackId( m.id, "midi_out" ), WR.jackId( synth.id, WR.types[ synth.type ].midi_in ), 3 ); // MASTER MIDI off, the keys' cable out
	setStatus( "Added MIDI FX (" + m.id + "): the keys' MIDI goes through it into " + WR.types[ synth.type ].title + " (Tab shows the MIDI cables)" );
}

WR.registerSynth( "midifx", {
	title: "MIDI FX",
	description: "MIDI FX: effects on the notes, between the keys and the synths",
	about: "Moves notes to a grid, transposes them, adds chords, keeps them in a scale, arpeggiates them and repeats them as echoes. MIDI in and out on the back.",
	// keys: 3 played / triggered, 2 often, 1 sometimes, 0 no key (code.js: keyAssign)
	key_prio: [["^on$", 2], ["_on$", 2], ["^arp_latch$", 2], ["^preset", 1], ["", 1]],
	knob_jacks: [["^transpose$", ["trans_in"]], ["^(arp_div|tq_div|echo_div)$", ["clock_in"]]],
	category: "Modulation",
	worklet: "devices/midifx-worklet.js",
	jacks: JACKS,
	rear_jacks: REAR_JACKS,
	midi_in: "midi_in",
	defaults: defaults,
	validate: validate,
	randomize: randomize,
	size: function( layout ) { return [ LAYOUTS[ layout ].w, H ]; },
	draw: draw,
	onAdd: onAdd,
	rear_note: function( s ) { return (!s.on ? "BYPASSED" : [s.arp_on ? "ARP" : "", s.echo_on ? "ECHO" : "", s.harm ? "HARMONY" : "", s.sc_on ? "SCALE" : ""].filter(Boolean).join( " · " ) || "THRU"); }
});

})();
