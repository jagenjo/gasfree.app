// devices/subrack.js
// SUBRACK: a rack inside a device. OPEN RACK shows it in a window of its own, drawn by the rack's own
// code (code.js: scopes), with every device but another SUBRACK. Its top row, the SUBRACK I/O, is
// the other side of this panel's jacks:
//   front CV IN 1-4        -> inside CV IN 1-4 (outputs)
//   inside CV OUT 1-4      -> front CV OUT 1-4
//   the 4 MACRO knobs      -> inside MACRO 1-4 (0..+5 V)
//   the 4 toggle BUTTONS   -> inside BUTTON 1-4 (+5 V when on, 0 V off)
//   rear IN L / R          -> inside, on its back: IN L / R
//   inside OUT L / R       -> rear OUT L / R (an unpatched R takes L)
//   rear MIDI IN           -> inside MIDI IN: the devices cabled from it, or with MASTER MIDI on
// Settings: name, panel colour, the macros, the buttons and their labels, and inner = { modules, patches }: the rack inside
// (webrack.js: WRContext.scope, WR.flatten). DSP in subrack-worklet.js.

(function(){

var H = 240, IO_H = 130, N = 4;
var NAME_MAX = 16, LABEL_MAX = 10;

var JACKS = [[
	["IN 1", "in", "cv1"], ["IN 2", "in", "cv2"], ["IN 3", "in", "cv3"], ["IN 4", "in", "cv4"],
	["OUT 1", "out", "out1"], ["OUT 2", "out", "out2"], ["OUT 3", "out", "out3"], ["OUT 4", "out", "out4"]
]];
var REAR = [["IN L", "ain", "in_l"], ["IN R", "ain", "in_r"], ["OUT L", "aout", "out_l"], ["OUT R", "aout", "out_r"]];

// the SUBRACK I/O inside: the rack's own jack names, so the rack's code (audio routing of a new
// device, MIDI FX, MASTER MIDI) works there as it does in the rack
var IO_FRONT = [[]];
for(var k = 1; k <= N; ++k) IO_FRONT[0].push([ "CV IN " + k, "out", "sr_cv" + k ]);
for(var k = 1; k <= N; ++k) IO_FRONT[0].push([ "MACRO " + k, "out", "sr_k" + k ]);
for(var k = 1; k <= N; ++k) IO_FRONT[0].push([ "BUTTON " + k, "out", "sr_b" + k ]);
for(var k = 1; k <= N; ++k) IO_FRONT[0].push([ "CV OUT " + k, "in", "sr_out" + k ]);
var IO_REAR = [["OUT L", "ain", "io_main_l"], ["OUT R", "ain", "io_main_r"], ["IN L", "aout", "io_input_l"], ["IN R", "aout", "io_input_r"], ["MIDI IN", "midiout", "kb_midi"]];
// those names -> this device's own jacks (its DSP)
var MAP = { io_main_l: "ret_l", io_main_r: "ret_r", io_input_l: "src_l", io_input_r: "src_r", kb_midi: "midi_thru" };
for(var k = 1; k <= N; ++k) { MAP[ "sr_cv" + k ] = "i" + k; MAP[ "sr_k" + k ] = "k" + k; MAP[ "sr_b" + k ] = "b" + k; MAP[ "sr_out" + k ] = "o" + k; }
var IO_TYPES = {};
IO_FRONT[0].concat( IO_REAR ).forEach(function(j){ IO_TYPES[ j[2] ] = j[1]; });

// panel colours ("": the rack's black); dark enough for the light lettering
var COLORS = ["", "#2a2d34", "#1f3352", "#244a6b", "#1f4a3c", "#2f4a22", "#5a4a1c", "#6a3a14", "#6b1f1c", "#4f1f3a", "#3d2a5c", "#55524c"];
var COLOR_NAMES = ["BLACK", "SLATE", "NAVY", "BLUE", "TEAL", "GREEN", "OLIVE", "AMBER", "RED", "WINE", "PURPLE", "GREY"];

function defaults()
{
	return { name: "SUBRACK", color: "", macros: [0, 0, 0, 0], labels: ["MACRO 1", "MACRO 2", "MACRO 3", "MACRO 4"],
		toggles: [false, false, false, false], blabels: ["BUTTON 1", "BUTTON 2", "BUTTON 3", "BUTTON 4"], inner: { modules: [], patches: [] } };
}

function cleanText( t, max, def )
{
	t = typeof t == "string" ? t.replace( /[^\x20-\x7e]/g, "" ).trim().toUpperCase().substr( 0, max ) : "";
	return t || def;
}

// what can go inside: not another SUBRACK, nor a custom synth (the Synth Editor works on the rack's)
function allowed( type ) { var d = WR.types[ type ]; return !!d && !d.inner && d.category != "Custom"; }

// the rack inside: the devices allowed there, their settings validated as in the rack, cables between
// jacks that exist there
function validate( s, data )
{
	s.name = cleanText( s.name, NAME_MAX, "SUBRACK" );
	s.labels = s.labels.map(function(l, k){ return cleanText( l, LABEL_MAX, "MACRO " + (k + 1) ); });
	s.blabels = s.blabels.map(function(l, k){ return cleanText( l, LABEL_MAX, "BUTTON " + (k + 1) ); });
	if(COLORS.indexOf( s.color ) < 0) s.color = "";
	s.macros = s.macros.map(function(v){ return Math.max( 0, Math.min( 1, v ) ); });
	var raw = data && data.inner && typeof data.inner == "object" ? data.inner : {};
	var list = [];
	(Array.isArray( raw.modules ) ? raw.modules : []).forEach(function(m){
		if(!m || !allowed( m.type ))
			return;
		var v = WR.validateModule( m, list, /^[a-z][a-z0-9_]*~[a-z][a-z0-9_]*$/, "subrack~" );
		if(v) list.push( v );
	});
	var types = {}, all = WRContext.jackTypes( list );
	for(var id in all)
		if(id.indexOf( "." ) > 0) types[id] = all[id];
	for(var id in IO_TYPES)
		types[id] = IO_TYPES[id];
	var patches = (Array.isArray( raw.patches ) ? raw.patches : []).filter(function(p){
		return Array.isArray( p ) && ((types[ p[0] ] == "out" && types[ p[1] ] == "in") || (types[ p[0] ] == "aout" && types[ p[1] ] == "ain") ||
			(types[ p[0] ] == "midiout" && types[ p[1] ] == "midiin"));
	}).map(function(p){ return [ p[0], p[1], p[2] | 0 ]; });
	s.inner = { modules: list, patches: patches };
}

// after a load, with the device's final id: the devices inside get ids after it (their cables too)
function loaded( m )
{
	var inner = m.settings.inner, prefix = m.id + "~", rename = {};
	var taken = function(id){ return inner.modules.some(function(o){ return o.id == id; }); };
	inner.modules.forEach(function(o){
		if(o.id.indexOf( prefix ) == 0)
			return;
		var base = prefix + o.id.substr( o.id.indexOf( "~" ) + 1 ), id = base;
		for(var n = 2; taken( id ); ++n)
			id = base + n;
		rename[ o.id ] = id;
		o.id = id;
	});
	inner.patches.forEach(function(p){
		for(var k = 0; k < 2; ++k)
		{
			var dot = p[k].indexOf( "." );
			if(dot > 0 && rename[ p[k].substr( 0, dot ) ])
				p[k] = rename[ p[k].substr( 0, dot ) ] + p[k].substr( dot );
		}
	});
}

function randomize( s, r )
{
	s.inner.modules.forEach(function(o){
		var d = WR.types[ o.type ];
		if(d.randomize) d.randomize( o.settings, r );
	});
}

// a prompt after this frame (a dialog in the middle of the draw loop would lose the pointer release)
function askText( question, value, done )
{
	var win = scopeWindow();
	setTimeout(function(){
		ui.down = false;
		ui.active = null;
		var t = win.prompt( question, value );
		if(t !== null) done( t );
	}, 0);
}

// ---------------------------------------------------------------------------
// the panel in the rack

// the panel's colour over the casing, lighter at the top
function drawTint( color, x, y, w, h )
{
	if(!color) return;
	var g = ctx.createLinearGradient( 0, y, 0, y + h );
	g.addColorStop( 0, color );
	g.addColorStop( 1, shade( color, 0.6 ) );
	ctx.fillStyle = g;
	ctx.fillRect( x + 23, y + 1, w - 46, h - 2 );
}
function shade( hex, k )
{
	var n = parseInt( hex.substr( 1 ), 16 );
	var c = [ n >> 16, (n >> 8) & 255, n & 255 ].map(function(v){ return Math.round( v * k ); });
	return "rgb(" + c.join( "," ) + ")";
}

// a name under a control: double click to rename it
function renamable( text, cx, cy, hid, question, done )
{
	drawLabel( text, cx, cy, 11 );
	if(hitRect( cx - 44, cy - 8, 88, 16 ) && !cable_drag && ui.active === null)
	{
		ui.hot = id_prefix + hid;
		tip( "DOUBLE CLICK: RENAME", cx, cy + 16 );
		if(ui.dbl && ui.pressed)
			askText( question, text, done );
	}
}

function askName( s )
{
	askText( "Name of this SUBRACK:", s.name, function(t){ s.name = cleanText( t, NAME_MAX, "SUBRACK" ); } );
}

// the four toggle buttons: +5 V inside while on. Returns nothing; s.toggles changes
function toggleButtons( s, x0, step, y, bw, bh )
{
	for(var k = 0; k < N; ++k)
	{
		var bx = x0 + step * (k + 0.5) - bw * 0.5;
		if(button( "tog" + (k + 1), bx, y, bw, bh, String( k + 1 ), s.toggles[k] ).clicked)
			s.toggles[k] = !s.toggles[k];
		drawLed( bx + bw * 0.5, y - 9, 3.5, s.toggles[k], "#ff3b2f" );
	}
}

function drawPanel( M )
{
	var s = M.settings, st = M.state || {};
	var size = M.def.size( layout ), w = size[0], h = size[1];
	drawCasing( 0, 0, w, h );
	drawTint( s.color, 0, 0, w, h );
	drawScrew( 36, h - 12 ); drawScrew( w - 36, h - 12 );

	// name (double click: rename) and what is inside
	ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
	ctx.font = "bold 26px " + FONT;
	ctx.fillStyle = TEXT_COLOR;
	var nw = ctx.measureText( s.name ).width;
	if(nw > 236) { ctx.font = "bold " + Math.floor( 26 * 236 / nw ) + "px " + FONT; nw = 236; }
	ctx.fillText( s.name, 44, 50 );
	if(hitRect( 40, 24, nw + 8, 32 ) && !cable_drag && ui.active === null)
	{
		ui.hot = id_prefix + "name";
		tip( "DOUBLE CLICK: RENAME", 44 + nw * 0.5, 64 );
		if(ui.dbl && ui.pressed)
			askName( s );
	}
	var inner = s.inner.modules;
	ctx.font = "10px " + FONT;
	ctx.fillStyle = DIM_COLOR;
	ctx.fillText( "SUBRACK \u00b7 " + inner.length + " DEVICE" + (inner.length == 1 ? "" : "S") + " INSIDE", 46, 66 );

	// the devices inside, on a small screen; clicking it opens the rack too
	var sx = 44, sy = 80, sw = 236, sh = 104;
	ctx.fillStyle = "#050505";
	ctx.beginPath(); ctx.roundRect( sx - 3, sy - 3, sw + 6, sh + 6, 5 ); ctx.fill();
	ctx.fillStyle = "#16240f";
	ctx.beginPath(); ctx.roundRect( sx, sy, sw, sh, 3 ); ctx.fill();
	ctx.font = "bold 11px 'Courier New', monospace";
	ctx.textAlign = "left"; ctx.textBaseline = "middle";
	ctx.fillStyle = "#b6f06a";
	if(!inner.length)
	{
		ctx.fillText( "EMPTY RACK", sx + 10, sy + 18 );
		ctx.fillStyle = "#6f9a3f";
		ctx.fillText( "OPEN IT AND ADD DEVICES", sx + 10, sy + 36 );
	}
	var rows = 6, shown = inner.length > rows ? rows - 1 : rows;
	inner.slice( 0, shown ).forEach(function(o, i){
		var d = WR.types[ o.type ];
		ctx.fillText( (i + 1) + " " + d.title, sx + 10, sy + 12 + i * 16 );
	});
	if(inner.length > rows)
		ctx.fillText( "+" + (inner.length - shown) + " MORE", sx + 10, sy + 12 + shown * 16 );
	// MIDI in and audio out, in the screen's corner
	var lv = st.level || 0;
	ctx.font = "bold 9px 'Courier New', monospace";
	ctx.fillStyle = "#6f9a3f";
	ctx.fillText( "MIDI", sx + sw - 74, sy + 12 );
	ctx.fillText( "OUT", sx + sw - 34, sy + 12 );
	drawLed( sx + sw - 46, sy + 12, 3, !!st.midi, "#3bd16f" );
	drawLed( sx + sw - 10, sy + 12, 3, lv > 0.01, lv > 0.95 ? "#ff3b2f" : "#ffb02f" );
	var open = !!(window.SUBRACK && SUBRACK.isOpen( M.id ));
	if(hitRect( sx, sy, sw, sh ) && !cable_drag && ui.active === null)
	{
		ui.hot = id_prefix + "screen";
		tip( open ? "SHOW ITS WINDOW" : "OPEN THE RACK INSIDE", sx + sw * 0.5, sy + sh + 14 );
		if(ui.pressed)
		{
			ui.active = id_prefix + "screen";
			SUBRACK.open( M.id );
		}
	}
	if(button( "open", sx, sy + sh + 14, sw, 30, open ? "SHOW RACK \u2197" : "OPEN RACK \u2197", open ).clicked)
		SUBRACK.open( M.id );

	// macros: knobs out on the front, CVs inside
	var mx = 330, mw = 440, step = mw / N;
	drawSection( "MACROS", mx, mx + mw, 18 );
	for(var k = 0; k < N; ++k)
	{
		var cx = mx + step * (k + 0.5);
		s.macros[k] = knob( "macro" + (k + 1), cx, 74, 25, s.macros[k], 0, 1, {
			def: 0, format: function(v){ return (v * 5).toFixed( 2 ) + " V" }
		} );
		(function(k){ renamable( s.labels[k], cx, 118, "label" + k, "Name of macro " + (k + 1) + ":", function(t){ s.labels[k] = cleanText( t, LABEL_MAX, "MACRO " + (k + 1) ); } ); })(k);
	}

	// buttons: on, +5 V inside; off, 0 V
	var bx = mx + mw + 30, bw = 330, bstep = bw / N;
	drawSection( "BUTTONS", bx, bx + bw, 18 );
	toggleButtons( s, bx, bstep, 58, 50, 34 );
	for(var k = 0; k < N; ++k)
		(function(k){ renamable( s.blabels[k], bx + bstep * (k + 0.5), 118, "blabel" + k, "Name of button " + (k + 1) + ":", function(t){ s.blabels[k] = cleanText( t, LABEL_MAX, "BUTTON " + (k + 1) ); } ); })(k);

	// CV in and out, to the jacks of the SUBRACK I/O inside
	var jx = mx, jw = bx + bw - mx, js = jw / 8;
	ctx.fillStyle = "rgba(0,0,0,0.35)";
	ctx.beginPath(); ctx.roundRect( jx, 150, jw, 80, 6 ); ctx.fill();
	drawLabel( "CV IN", jx + js * 2, 160, 9, false, DIM_COLOR );
	drawLabel( "CV OUT", jx + js * 6, 160, 9, false, DIM_COLOR );
	JACKS[0].forEach(function(j, c){
		drawJack( j[2], jx + js * (c + 0.5), 204, j[0], j[1] );
	});

	// the panel: name and colour
	var px = bx + bw + 30, pw = w - 46 - px;
	drawSection( "PANEL", px, px + pw, 18 );
	if(button( "rename", px, 40, pw, 26, "NAME\u2026" ).clicked)
		askName( s );
	drawLabel( "COLOUR: " + COLOR_NAMES[ COLORS.indexOf( s.color ) ], px + pw * 0.5, 84, 10, false, DIM_COLOR );
	var cols = 6, cs = pw / cols;
	COLORS.forEach(function(c, k){
		var cx = px + cs * (k % cols) + cs * 0.5, cy = 108 + Math.floor( k / cols ) * 32, r = 11;
		var hover = !cable_drag && ui.active === null && hitCircle( cx, cy, r + 2 );
		ctx.fillStyle = c || "#111";
		ctx.beginPath(); ctx.arc( cx, cy, r, 0, Math.PI * 2 ); ctx.fill();
		ctx.strokeStyle = s.color == c ? "#f2eee6" : (hover ? "#9a9a94" : "rgba(255,255,255,0.18)");
		ctx.lineWidth = s.color == c ? 2.5 : 1.2;
		ctx.stroke();
		if(hover)
		{
			ui.hot = id_prefix + "color" + k;
			tip( COLOR_NAMES[k], cx, cy + 22 );
			if(ui.pressed) { ui.active = id_prefix + "color" + k; s.color = c; }
		}
	});
	ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
	ctx.font = "bold 22px " + FONT;
	ctx.fillStyle = TEXT_COLOR;
	if(ctx.letterSpacing !== undefined) ctx.letterSpacing = "4px";
	ctx.fillText( "SUBRACK", px + pw, 214 );
	if(ctx.letterSpacing !== undefined) ctx.letterSpacing = "0px";
	ctx.font = "10px " + FONT;
	ctx.fillStyle = DIM_COLOR;
	ctx.fillText( "A RACK INSIDE A DEVICE", px + pw, 228 );
}

// ---------------------------------------------------------------------------
// the SUBRACK I/O, on top of the rack inside (drawn in the subrack's window)

function ioRow( id )
{
	return {
		id: id + "~io", title: "SUBRACK I/O", h: IO_H, jacks: IO_FRONT, rear: IO_REAR,
		note: "OUT L / R: THE SUBRACK'S OUT · IN L / R: ITS IN · MIDI IN: ITS MIDI",
		draw: function( x, y, w, h ) { drawIO( id, x, y, w, h ); }
	};
}

function drawIO( id, x, y, w, h )
{
	var m = MAIN_RACK.settings.modules.find(function(o){ return o.id == id; });
	if(!m) return;
	var s = m.settings, st = MAIN_RACK.module_state[ id ] || {};
	drawCasing( x, y, w, h );
	drawTint( s.color, x, y, w, h );
	drawScrew( x + 36, y + h - 12 ); drawScrew( x + w - 36, y + 12 ); drawScrew( x + w - 36, y + h - 12 );
	ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
	ctx.font = "bold 22px " + FONT;
	ctx.fillStyle = TEXT_COLOR;
	ctx.fillText( s.name, x + 60, y + 52 );
	ctx.font = "10px " + FONT;
	ctx.fillStyle = DIM_COLOR;
	ctx.fillText( "SUBRACK I/O: THE OTHER SIDE OF ITS PANEL", x + 60, y + 70 );
	ctx.fillText( "AUDIO AND MIDI ON THE BACK (TAB)", x + 60, y + 84 );
	drawLed( x + 66, y + 104, 3, !!st.midi, "#3bd16f" );
	drawLabel( "MIDI", x + 88, y + 105, 8, false, DIM_COLOR );
	var lv = st.level || 0;
	drawLed( x + 116, y + 104, 3, lv > 0.01, lv > 0.95 ? "#ff3b2f" : "#ffb02f" );
	drawLabel( "OUT", x + 136, y + 105, 8, false, DIM_COLOR );

	var plate = function(px, pw, title){
		ctx.fillStyle = "rgba(0,0,0,0.35)";
		ctx.beginPath(); ctx.roundRect( px, y + 8, pw, h - 16, 6 ); ctx.fill();
		drawLabel( title, px + pw * 0.5, y + 20, 10, false, DIM_COLOR );
	};
	var js = 56, pw = js * N + 16, jy = y + 98;
	// CV IN 1-4: from the front's inputs
	var px = x + 330;
	plate( px, pw, "FROM CV IN 1-4" );
	for(var k = 0; k < N; ++k)
		drawJack( "sr_cv" + (k + 1), px + 8 + js * (k + 0.5), jy, "CV IN " + (k + 1), "out" );
	// the macros: their knobs (the same as the front's) and their CVs
	px += pw + 12;
	var ks = 80, mw = ks * N + 16;
	plate( px, mw, "MACROS (THE FRONT'S KNOBS)" );
	for(var k = 0; k < N; ++k)
	{
		var cx = px + 8 + ks * (k + 0.5);
		id_prefix = id + ".";
		s.macros[k] = knob( "macro" + (k + 1), cx, y + 50, 14, s.macros[k], 0, 1, {
			def: 0, format: function(v){ return (v * 5).toFixed( 2 ) + " V" }
		} );
		id_prefix = "";
		drawJack( "sr_k" + (k + 1), cx, jy, s.labels[k], "out" );
	}
	// the buttons: the same as the front's, +5 V while on
	px += mw + 12;
	var bs = 66, bw = bs * N + 16;
	plate( px, bw, "BUTTONS (THE FRONT'S)" );
	id_prefix = id + ".";
	toggleButtons( s, px + 8, bs, y + 42, 36, 20 );
	id_prefix = "";
	for(var k = 0; k < N; ++k)
		drawJack( "sr_b" + (k + 1), px + 8 + bs * (k + 0.5), jy, s.blabels[k], "out" );
	// CV OUT 1-4: to the front's outputs
	px += bw + 12;
	plate( px, pw, "TO CV OUT 1-4" );
	for(var k = 0; k < N; ++k)
		drawJack( "sr_out" + (k + 1), px + 8 + js * (k + 0.5), jy, "CV OUT " + (k + 1), "in" );
}

// ---------------------------------------------------------------------------
// the window: a page of its own with a small toolbar and a canvas, drawn by the rack's code in the
// subrack's scope, on that window's animation frames. Its keys: Tab turns the rack around, the rest
// press the buttons of the device in the middle, or go to the main window (QWERTY notes, Space)

var windows = {}; // module id -> scope

function deviceOptions()
{
	var cats = {};
	WR.order.forEach(function(type){
		var d = WR.types[type];
		if(d.hidden || !allowed( type )) return;
		var c = d.category || "Synths";
		(cats[c] = cats[c] || []).push( type );
	});
	var order = (typeof DEVICE_CATEGORIES != "undefined" ? DEVICE_CATEGORIES : []).concat( Object.keys( cats ) );
	var html = '<option value="">ADD DEVICE…</option>', done = {};
	order.forEach(function(c){
		if(!cats[c] || done[c]) return;
		done[c] = true;
		html += '<optgroup label="' + escHtml( c ) + '">' + cats[c].map(function(t){ return '<option value="' + t + '">' + escHtml( WR.types[t].title ) + '</option>'; }).join( "" ) + '</optgroup>';
	});
	return html;
}

function open( id )
{
	var sc = windows[id];
	if(sc && !sc.win.closed)
	{
		sc.win.focus();
		return sc;
	}
	var w = window.open( "", "gasfree_subrack_" + id, "popup,width=" + Math.min( 1400, Math.round( screen.availWidth * 0.8 ) ) + ",height=" + Math.min( 900, Math.round( screen.availHeight * 0.8 ) ) );
	if(!w)
	{
		setStatus( "The browser blocked the window: allow pop-ups for this page" );
		return null;
	}
	gfTrack( "open-subrack" );
	var links = Array.prototype.map.call( document.querySelectorAll( "link[rel=stylesheet], link[rel=preconnect]" ), function(l){ return l.outerHTML; } ).join( "" );
	var d = w.document;
	d.open();
	d.write( '<!doctype html><html><head><meta charset="utf-8"><title>GASFREE · SUBRACK</title>' + links +
		'<style>html, body { margin: 0; height: 100%; background: #0b0b0b; overflow: hidden; color: #e8e4dc; font: 13px Antonio, Oswald, "Arial Narrow", sans-serif; }' +
		' #bar { display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 10px; background: #161615; border-bottom: 1px solid #2a2a28; box-sizing: border-box; }' +
		' #bar b { font-size: 17px; letter-spacing: 1px; margin-right: 8px; white-space: nowrap; }' +
		' #bar button, #bar select { font: inherit; color: #e8e4dc; background: #2c2c2a; border: 1px solid #3c3c39; border-radius: 4px; height: 26px; padding: 0 10px; cursor: pointer; }' +
		' #bar button:hover, #bar select:hover { background: #3a3a37; } #bar button.on { background: #8a2c24; border-color: #a83a30; }' +
		' #status { flex: 1; color: #8c8a84; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }' +
		' #rack { display: block; width: 100%; height: calc(100% - 38px); touch-action: none; }</style></head>' +
		'<body><div id="bar"><b id="title">SUBRACK</b><select id="add">' + deviceOptions() + '</select>' +
		'<button id="rear">Rear (Tab)</button><button id="zout">−</button><button id="zoom">100%</button><button id="zin">+</button>' +
		'<span id="status"></span></div><canvas id="rack"></canvas></body></html>' );
	d.close();
	var cv = d.getElementById( "rack" );
	sc = { id: id, win: w, status: d.getElementById( "status" ), io: ioRow( id ), vars: newScopeVars( MAIN_RACK.scope( id ), cv ) };
	windows[id] = sc;
	bindCanvas( cv, sc );

	var setRearView = function( rear ){
		inScope( sc, function(){ show_rear = rear; cancelCableDrag(); } );
		d.getElementById( "rear" ).textContent = rear ? "Front (Tab)" : "Rear (Tab)";
		d.getElementById( "rear" ).classList.toggle( "on", rear );
		inScope( sc, function(){ setStatus( rear ? "Rear view: audio and MIDI (Tab for the front)" : "Front view" ); } );
	};
	var zoomTo = function( z ){
		inScope( sc, function(){
			z = clamp( z, ZOOM_MIN, ZOOM_MAX );
			if(Math.abs( z - 1 ) < 0.02) z = 1;
			view.zoom = z;
		} );
		d.getElementById( "zoom" ).textContent = Math.round( z * 100 ) + "%";
	};
	d.getElementById( "add" ).addEventListener( "change", function(e){
		var type = e.target.value;
		e.target.value = "";
		e.target.blur();
		if(type) inScope( sc, function(){ addDevice( type ); } );
	} );
	d.getElementById( "rear" ).addEventListener( "click", function(e){ setRearView( !sc.vars.show_rear ); e.target.blur(); } );
	d.getElementById( "zout" ).addEventListener( "click", function(e){ zoomTo( sc.vars.view.zoom / ZOOM_STEP ); e.target.blur(); } );
	d.getElementById( "zin" ).addEventListener( "click", function(e){ zoomTo( sc.vars.view.zoom * ZOOM_STEP ); e.target.blur(); } );
	d.getElementById( "zoom" ).addEventListener( "click", function(e){ zoomTo( 1 ); e.target.blur(); } );

	var forward = function( type, e ){
		window.dispatchEvent( new KeyboardEvent( type, { key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, repeat: e.repeat } ) );
	};
	w.addEventListener( "keydown", function(e){
		if(isTextField( e.target )) return;
		if(e.target.closest && e.target.closest( "button,select" )) e.target.blur();
		if(e.code == "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey)
		{
			e.preventDefault();
			if(!e.repeat) setRearView( !sc.vars.show_rear );
			return;
		}
		if(e.key == "Shift" && !piano.enabled)
			sc.vars.keyctl.overlay = true;
		var taken = false;
		if(!piano.enabled && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && e.code != "Space")
			taken = inScope( sc, function(){ return keyDown( e.code ); } );
		if(taken)
		{
			e.preventDefault();
			act(function(){});
			return;
		}
		if(e.code == "Space" || e.code == "Backspace") e.preventDefault();
		forward( "keydown", e );
	} );
	w.addEventListener( "keyup", function(e){
		if(e.key == "Shift") sc.vars.keyctl.overlay = false;
		if(!inScope( sc, function(){ return keyUp( e.code ); } ))
			forward( "keyup", e );
	} );
	w.addEventListener( "blur", function(){ inScope( sc, keyReleaseAll ); sc.vars.keyctl.overlay = false; } );
	w.addEventListener( "pagehide", function(){ if(windows[id] === sc) delete windows[id]; } );

	var frame_cb = function(){
		if(w.closed || windows[id] !== sc)
			return;
		if(!sc.vars.rack.exists()) // removed, or a patch without it was loaded
		{
			delete windows[id];
			w.close();
			return;
		}
		var m = MAIN_RACK.settings.modules.find(function(o){ return o.id == id; });
		var title = "GASFREE · " + m.settings.name;
		if(d.title != title) { d.title = title; d.getElementById( "title" ).textContent = m.settings.name; }
		inScope( sc, function(){ draw(); endUiFrame(); } );
		MAIN_RACK.sync(); // the main window may be hidden: its own loop doesn't run then
		w.requestAnimationFrame( frame_cb );
	};
	w.requestAnimationFrame( frame_cb );
	w.focus();
	inScope( sc, function(){ setStatus( "The rack inside " + sc.vars.rack.settings.modules.length + " device(s). ADD DEVICE puts one in; its cables in and out go to the SUBRACK I/O on top" ); } );
	return sc;
}

function closeAll()
{
	for(var id in windows)
		if(!windows[id].win.closed) windows[id].win.close();
	windows = {};
}
window.addEventListener( "pagehide", closeAll );

window.SUBRACK = {
	open: open,
	closeAll: closeAll,
	isOpen: function( id ){ return !!(windows[id] && !windows[id].win.closed); },
	windows: function(){ return windows; },
	ids: function(){ return Object.keys( windows ); }
};

WR.registerSynth( "subrack", {
	title: "SUBRACK",
	description: "SUBRACK: a rack inside a device, with its own window: build a synth from several devices and keep it as one",
	category: "Utility",
	worklet: "devices/subrack-worklet.js",
	jacks: JACKS,
	rear_jacks: REAR,
	midi_in: "midi",
	audio_out: "out_l",
	audio_out_r: "out_r",
	thru: { L: ["in_l"], R: ["in_r"], outL: "out_l", outR: "out_r" },
	inner: { map: MAP, io_front: IO_FRONT, io_rear: IO_REAR, allowed: allowed },
	key_prio: [["^tog\\d$", 3], ["^open$", 1], ["", 0]],
	knob_jacks: [],
	defaults: defaults,
	validate: validate,
	loaded: loaded,
	randomize: randomize,
	size: function( layout ) { return [ LAYOUTS[ layout ].w, H ]; },
	draw: drawPanel,
	rear_note: function(){ return "IN L / R: TO THE RACK INSIDE · OUT L / R: FROM IT · MIDI IN: TO ITS DEVICES"; }
});

})();
