// devices/minimix.js
// MINIMIX: a very simple mixer in a thin row, just tall enough for a knob and its name. 8 mono inputs
// on the back (Tab), a LEVEL knob each (its name is what is cabled into it), MASTER, and the mix on
// MAIN L / MAIN R on the back. No front jacks. DSP in minimix-worklet.js.

(function(){

var H = 70, CHANNELS = 8;

var REAR_JACKS = [];
for(var k = 1; k <= CHANNELS; ++k)
	REAR_JACKS.push([ "IN " + k, "ain", "in" + k ]);
REAR_JACKS.push( ["MAIN L", "aout", "main_l"], ["MAIN R", "aout", "main_r"] );

function clampTo( v, a, b ) { return v < a ? a : (v > b ? b : v); } // validate() runs without code.js too

function defaults()
{
	var level = [];
	for(var i = 0; i < CHANNELS; ++i)
		level.push( 0.75 );
	return { level: level, master: 0.75 };
}

function validate( s )
{
	s.level = s.level.map(function(v){ return clampTo( v, 0, 1 ); });
	s.master = clampTo( s.master, 0, 1 );
}

// knob 0..1 -> dB, as in the DSP (gain = (v / 0.75)^2)
function db( v ) { return v > 0 ? 40 * Math.log10( v / 0.75 ) : -Infinity; }
function fmt( v ) { var d = db( v ); return d == -Infinity ? "-inf dB" : (d > 0 ? "+" : "") + d.toFixed( 1 ) + " dB"; }

// what is cabled into channel k (on the back): the device's name, or the channel number
function sourceName( M, k )
{
	var dst = WR.jackId( M.id, "in" + (k + 1) );
	var src = rack.settings.patches.filter(function(p){ return p[1] == dst; });
	if(!src.length)
		return "CH " + (k + 1);
	var name = src.length > 1 ? src.length + " SOURCES" : jackDevice( src[0][0] );
	return name.length > 11 ? name.substr( 0, 10 ) + "…" : name;
}

function draw( M )
{
	var s = M.settings, w = M.def.size( layout )[0], st = M.state || {};
	drawCasing( 0, 0, w, H );
	ctx.textAlign = "left"; ctx.textBaseline = "middle";
	ctx.font = "bold 20px " + FONT;
	ctx.fillStyle = TEXT_COLOR;
	ctx.fillText( "MINIMIX", 70, H * 0.5 + 6 );
	var x0 = 270, dx = (w - 22 - 250 - x0 - 100) / (CHANNELS - 1), cy = 45;
	for(var i = 0; i < CHANNELS; ++i)
		s.level[i] = knob( "level" + i, x0 + dx * i, cy, 14, s.level[i], 0, 1, {
			label: sourceName( M, i ), labelSize: 10, def: 0.75, format: fmt
		} );
	var mx = x0 + dx * (CHANNELS - 1) + 110;
	ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1;
	ctx.beginPath(); ctx.moveTo( mx - 55, 10 ); ctx.lineTo( mx - 55, H - 10 ); ctx.stroke();
	s.master = knob( "master", mx, cy, 16, s.master, 0, 1, { label: "MASTER", labelSize: 11, def: 0.75, format: fmt } );
	var lv = st.level || 0;
	drawLed( mx + 38, cy - 2, 3.5, lv > 0.01, lv > 0.95 ? "#ff3b2f" : "#3bd16f" );
}

WR.registerSynth( "minimix", {
	title: "MINIMIX",
	description: "MINIMIX: a very simple 8 channel mixer in a thin row, a level knob each and a master",
	about: "Eight mono inputs on the back, a level knob each named after what is cabled into it, a master, and the mix on MAIN L and MAIN R.",
	key_prio: [],
	knob_jacks: [],
	worklet: "devices/minimix-worklet.js",
	jacks: [],
	rear_jacks: REAR_JACKS,
	category: "Mixing",
	midi_in: null,
	audio_out: null,
	mixer: true,
	channels: CHANNELS,
	defaults: defaults,
	validate: validate,
	size: function( layout ) { return [ LAYOUTS[ layout ].w, H ]; },
	draw: draw,
	rear_note: function(){ return "8 MONO LINE INPUTS TO THE MIX · MAIN L / R"; }
});

})();
