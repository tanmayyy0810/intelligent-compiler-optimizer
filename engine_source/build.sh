#!/bin/bash
{ echo "(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.COE = factory(); })(typeof self !== 'undefined' ? self : this, function () {"; echo "'use strict';"; cat src/1a_types.js src/1b_lex_parse.js src/1c_lower.js src/1d_print.js src/2_analysis.js src/3_opt.js; echo "});"; } > engine.js
