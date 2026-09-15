import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { html } from '../source/html.mts';
import { withDOM } from './helpers/dom.mjs';

test('html parser treats > in text content as literal text', () => {
	withDOM(() => {
		const fragment = html`<div>2 > 1</div>`;
		const div = fragment.querySelector('div');
		assert.equal(div.textContent, '2 > 1');
	});
});

test('html parser treats " in text content as literal text', () => {
	withDOM(() => {
		const fragment = html`<div>"hello"</div>`;
		const div = fragment.querySelector('div');
		assert.equal(div.textContent, '"hello"');
	});
});

test('html parser treats attribute-like text in content as literal text', () => {
	withDOM(() => {
		const fragment = html`<div>class="example"</div>`;
		const div = fragment.querySelector('div');
		assert.equal(div.textContent, 'class="example"');
		assert.equal(div.getAttribute('class'), null);
	});
});

test('html parser treats self-close-like text in content as literal text', () => {
	withDOM(() => {
		const fragment = html`<div>a / b</div>`;
		const div = fragment.querySelector('div');
		assert.equal(div.textContent, 'a / b');
	});
});

test('html parser still rejects malformed attribute syntax inside tag declaration', () => {
	withDOM(() => {
		assert.throws(() => html`<div class=></div>`, TypeError);
	});
});

test('html throws when dynamic attribute content is mixed with static text', () => {
	withDOM(() => {
		assert.throws(
			() => html`<div class="prefix ${'suffix'}"></div>`,
			error => error instanceof TypeError && /Mixed static and dynamic content in attribute 'class'/.test(error.message)
		);
		assert.throws(
			() => html`<div class="${'prefix'} suffix"></div>`,
			error => error instanceof TypeError && /Mixed static and dynamic content in attribute 'class'/.test(error.message)
		);
	});
});

test('html throws when a nested render function leaks into output', () => {
	withDOM(() => {
		const leakedRenderFn = () => (parent) => (parent) => parent;
		assert.throws(
			() => html`<div>${leakedRenderFn()}</div>`,
			error => error instanceof TypeError && /Render function leaked into output/.test(error.message)
		);
	});
});

test('html throws on mismatched close tags', () => {
	withDOM(() => {
		assert.throws(
			() => html`<div></span>`,
			error => error instanceof TypeError && /Invalid close element/.test(error.message)
		);
	});
});

test('html throws on unexpected close element without open element', () => {
	withDOM(() => {
		assert.throws(
			() => html`</div>`,
			error => error instanceof TypeError && /Unexpected close element/.test(error.message)
		);
	});
});

test('html throws on missing element closer', () => {
	withDOM(() => {
		assert.throws(
			() => html`<div`,
			error => error instanceof TypeError && /Element closer '>' missing/.test(error.message)
		);
	});
});

test('html throws on missing close element', () => {
	withDOM(() => {
		assert.throws(
			() => html`<div>`,
			error => error instanceof TypeError && /Close element missing/.test(error.message)
		);
	});
});

test('html throws on unexpected value in element declaration', () => {
	withDOM(() => {
		const value = 'unexpected';
		assert.throws(
			() => html`<div ${value}></div>`,
			error => error instanceof TypeError && /Unexpected value in element declaration/.test(error.message)
		);
	});
});

test('html supports multiple ps* live attributes on a single element', () => {
	withDOM(() => {
		const firstValue = 'one';
		const secondValue = 'two';
		const fragment = html`<div psFirst="${firstValue}" psSecond="${secondValue}"></div>`;
		const div = fragment.querySelector('div');
		assert.equal(div.getAttribute('first'), 'one');
		assert.equal(div.getAttribute('second'), 'two');
		assert.equal(div.first, 'one');
		assert.equal(div.second, 'two');
	});
});

test('html supports multiple ps* live attributes with function values on a single element', () => {
	withDOM(() => {
		const fragment = html`<div psWidth="${attr => '100'}" psHeight="${attr => '200'}"></div>`;
		const div = fragment.querySelector('div');
		assert.equal(div.getAttribute('width'), '100');
		assert.equal(div.getAttribute('height'), '200');
		assert.equal(div.width, '100');
		assert.equal(div.height, '200');
	});
});

test('html supports ps* live attributes on a self-closing element', () => {
	withDOM(() => {
		const value = 'active';
		const fragment = html`<input psValue="${value}" />`;
		const input = fragment.querySelector('input');
		assert.equal(input.getAttribute('value'), 'active');
		assert.equal(input.value, 'active');
	});
});

test('html removes nullish attribute bindings', () => {
	withDOM(() => {
		const fragment = html`<input value="${null}" psTitle="${undefined}" />`;
		const input = fragment.querySelector('input');
		assert.equal(input.getAttribute('value'), null);
		assert.equal(input.value, '');
		assert.equal(input.getAttribute('title'), null);
		assert.equal(input.title, '');
	});
});

test('html supports ps* live attributes on nested elements', () => {
	withDOM(() => {
		const outerValue = 'outer';
		const innerValue = 'inner';
		const fragment = html`<section psId="${outerValue}"><span psTitle="${innerValue}"></span></section>`;
		const section = fragment.querySelector('section');
		const span = fragment.querySelector('span');
		assert.equal(section.getAttribute('id'), 'outer');
		assert.equal(span.getAttribute('title'), 'inner');
		assert.equal(section.id, 'outer');
		assert.equal(span.title, 'inner');
	});
});
