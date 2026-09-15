import { html } from '../source/html.mts';
import { withDOM } from './helpers/dom.mjs';

withDOM(() => {
	const a = ' id="9"', b = 2;

	try { // Invalid close element
		html`<div>class="example"${a}</a>${b}</div>`;
	} catch(e) {
		console.error(1, e.message);
	}

	try { // Mixed static and dynamic content in attribute
		html`<html><body><div id="aa${'bb'}">class="example"${a}</div></body></html>`;
	} catch(e) {
		console.error(2, e.message);
	}

	try { // Render function leaked into output (nested function returned without html wrapper)
		html`<div>${() => () => 'leaked'}</div>`;
	} catch(e) {
		console.error(3, e.message);
	}

	try { // Comment not allowed in element declaration
		html`<div <!--comment-->>${a}</div>`;
	} catch(e) {
		console.error(4, e.message);
	}

	try { // Quote missing in attribute value (dynamic value where quote expected)
		html`<div id="value"${a}</div>`;
	} catch(e) {
		console.error(5, e.message);
	}

	try { // Attribute expected (text where attribute expected)
		html`<div hello${a}</div>`;
	} catch(e) {
		console.error(6, e.message);
	}

	try { // Unexpected self-close without open element
		html`</div>`;
	} catch(e) {
		console.error(7, e.message);
	}

	try { // Invalid close element (mismatched tags)
		html`<div></span>`;
	} catch(e) {
		console.error(8, e.message);
	}

	try { // Unexpected close element without open element
		html`<div></div></span>`;
	} catch(e) {
		console.error(9, e.message);
	}

	try { // Unexpected value in element declaration (non-ignorable value after element with no closing >)
		html`<div${a}content</div>`;
	} catch(e) {
		console.error(10, e.message);
	}

	try { // Quote missing at end of template (unclosed attribute)
		html`<div id="unclosed`;
	} catch(e) {
		console.error(11, e.message);
	}

	try { // Element closer missing (unclosed element)
		html`<div`;
	} catch(e) {
		console.error(12, e.message);
	}

	try { // Close element missing (unclosed element, different path)
		html`<div><span>`;
	} catch(e) {
		console.error(13, e.message);
	}

});
