import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { dasy, DasyDataSource } from '../dist/dasy.mjs';
import { html } from '../source/html.mts';
import { JSONPath } from '../source/json_tools.mts';
import { withDOM } from './helpers/dom.mjs';

const getWatcherCountAtPath = (dump, path) => dump.paths.find(entry => entry.path === path)?.count ?? 0;
const assertDumpClean = (dump) => {
	assert.deepEqual(dump.danglingIndexedWatchers, []);
	assert.deepEqual(dump.unindexedReachableWatchers, []);
};

test('dasy renders text and attribute bindings', () => {
	withDOM(() => {
		const data = {
			watched: { value: 1, label: 'one' },
			hidden: { value: 2, label: 'two' },
		};

		const control = dasy({ data, container: document.body }, (oData, oRoot) => oRoot.html`
			<div title="${oRoot.use('.watched', $ => $.label)}">${oRoot.use('.watched', ($, watched) => watched.html`<span>${$.value}</span>`)}</div>
		`);

		data.hidden.value = 3;
		control.refresh();
		assert.equal(document.querySelector('span').textContent, '1');

		data.watched.value = 4;
		data.watched.label = 'four';
		control.refresh();
		assert.equal(document.querySelector('span').textContent, '4');
		assert.equal(document.querySelector('div').getAttribute('title'), 'four');
	});
});

test('html rejects mixed static and dynamic attribute content', () => {
	withDOM(() => {
		assert.throws(() => html`<div class="prefix ${'suffix'}"></div>`, error => error instanceof TypeError && /Mixed static and dynamic content in attribute 'class'/.test(error.message));
		assert.throws(() => html`<div class="${'prefix'} suffix"></div>`, error => error instanceof TypeError && /Mixed static and dynamic content in attribute 'class'/.test(error.message));
	});
});

test('dasy supports live inputs and set()', () => {
	withDOM(() => {
		let control;
		const data = {
			values: { value1: 'one', nested: { value2: 'two' } },
			grid: [['0.0', '0.1'], ['1.0', '1.1']],
		};

		control = dasy({ data, container: document.body }, (oData, oRoot) => oRoot.html`
			<div>
				<input value="${oRoot.use('.values', $ => $.value1)}" onInput="${e => { data.values.value1 = e.target.value; control.refresh(); }}" />
				<input value="${oRoot.use('.values', $ => $.value1)}" onInput="${e => { data.values.value1 = e.target.value; control.refresh(); }}" />
				<b>${oRoot.use('.values', $ => $.value1)}</b>
				<i>${oRoot.use('.values.nested', $ => $.value2)}</i>
				<table>${oRoot.each('.grid', (row, rowRoot) => rowRoot.html`<tr><td>${row[0]}</td><td>${row[1]}</td></tr>`)}</table>
				<button onClick="${() => oRoot.set('.values.nested.value2', 'changed')}">set</button>
			</div>
		`);

		const [firstInput, secondInput] = document.querySelectorAll('input');
		const button = document.querySelector('button');

		firstInput.value = 'alpha';
		firstInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
		assert.equal(firstInput.value, 'alpha');
		assert.equal(secondInput.value, 'alpha');
		assert.equal(document.querySelector('b').textContent, 'alpha');

		secondInput.value = 'beta';
		secondInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
		assert.equal(firstInput.value, 'beta');
		assert.equal(secondInput.value, 'beta');
		assert.equal(document.querySelector('b').textContent, 'beta');

		button.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
		assert.equal(document.querySelector('i').textContent, 'changed');
	});
});

test('dasy supports conditional fragments and disconnect()', () => {
	withDOM(() => {
		const data = { state: { show: false, value: 1 } };
		const control = dasy({ data, container: document.body }, (oData, oRoot) => oRoot.html`<div>${oRoot.use('.state', ($, stateRoot) => $.show ? stateRoot.html`<span>${$.value}</span>` : null)}</div>`);

		assert.equal(document.querySelector('div').children.length, 0);
		data.state.show = true;
		control.refresh();
		assert.equal(document.querySelector('span').textContent, '1');
		data.state.show = false;
		control.refresh();
		assert.equal(document.querySelector('div').children.length, 0);

		data.state.show = true;
		control.refresh();
		assert.doesNotThrow(() => control.disconnect());
		assert.equal(document.querySelector('span'), null);
	});
});

test('dasy disconnect() aborts template event listeners', () => {
	withDOM(() => {
		let clickCount = 0;
		const control = dasy({ data: {}, container: document.body }, (_, root) => root.html`
			<button onClick="${() => clickCount++}">click</button>
		`);
		const button = document.querySelector('button');

		button.dispatchEvent(new MouseEvent('click'));
		assert.equal(clickCount, 1);

		control.disconnect();
		button.dispatchEvent(new MouseEvent('click'));
		assert.equal(clickCount, 1);
	});
});

test('dasy removes and restores nullish attribute bindings', () => {
	withDOM(() => {
		const data = { field: { value: 'alpha', title: 'ready' } };
		const control = dasy({ data, container: document.body }, (_, oRoot) => oRoot.html`
			<input value="${oRoot.use('.field', $ => $.value)}" title="${oRoot.use('.field', $ => $.title)}" />
		`);

		const input = document.querySelector('input');
		assert.equal(input.getAttribute('value'), 'alpha');
		assert.equal(input.value, 'alpha');
		assert.equal(input.getAttribute('title'), 'ready');
		assert.equal(input.title, 'ready');

		data.field.value = null;
		data.field.title = undefined;
		control.refresh();
		assert.equal(input.getAttribute('value'), null);
		assert.equal(input.value, '');
		assert.equal(input.getAttribute('title'), null);
		assert.equal(input.title, '');

		data.field.value = 'beta';
		data.field.title = 'back';
		control.refresh();
		assert.equal(input.getAttribute('value'), 'beta');
		assert.equal(input.value, 'beta');
		assert.equal(input.getAttribute('title'), 'back');
		assert.equal(input.title, 'back');
	});
});

test('dasy exposes frozen template APIs', () => {
	withDOM(() => {
		const data = { scope: { value: 1 } };
		let rootApi;
		let nestedApi;

		dasy({ data, container: document.body }, (oData, oRoot) => {
			rootApi = oRoot;
		return oRoot.html`<div>${oRoot.use('.scope', ($, scopeApi) => {
				nestedApi = scopeApi;
				return scopeApi.html`<span>${$.value}</span>`;
			})}</div>`;
		});

		assert.deepStrictEqual(Object.keys(rootApi).sort(), ['each', 'html', 'inspect', 'refresh', 'set', 'svg', 'use']);
		assert.deepStrictEqual(Object.keys(nestedApi).sort(), ['each', 'html', 'inspect', 'refresh', 'set', 'svg', 'use']);
		assert.equal(Object.isFrozen(rootApi), true);
		assert.equal(Object.isFrozen(nestedApi), true);
		assert.equal(rootApi.path, undefined);
		assert.equal(rootApi.clear, undefined);
		assert.equal(nestedApi.parent, undefined);
		assert.equal(document.querySelector('span').textContent, '1');
	});
});

test('dasy handles array insertions and each()', () => {
	withDOM(() => {
		const data = { items: [], tail: { label: 'tail' } };
		const control = dasy({ data, container: document.body }, (oData, oRoot) => oRoot.html`<div><span>prefix</span>${oRoot.each('.items', (item, itemRoot) => itemRoot.html`<em>${item.title}</em>`)}<strong>${oData.tail.label}</strong></div>`);

		data.items.splice(0, 0, { title: 'first' });
		control.refresh();
		assert.deepEqual(Array.from(document.querySelector('div').children).map(node => node.textContent), ['prefix', 'first', 'tail']);
	});
});

test('dasy each() renders emptyTemplate when array is empty and updates dynamically', () => {
	withDOM(() => {
		const data = { items: [] };
		const control = dasy({ data, container: document.body }, (oData, oRoot) => oRoot.html`<div>${oRoot.each('.items', (item, itemRoot) => itemRoot.html`<em>${item}</em>`, (_, emptyRoot) => emptyRoot.html`<span class="empty">empty</span>`)}</div>`);

		assert.equal(document.querySelector('span.empty')?.textContent, 'empty');
		assert.equal(document.querySelector('em'), null);

		data.items.push('one', 'two');
		control.refresh();
		assert.equal(document.querySelector('span.empty'), null);
		assert.deepEqual(Array.from(document.querySelectorAll('em')).map(node => node.textContent), ['one', 'two']);

		data.items.length = 0;
		control.refresh();
		assert.equal(document.querySelector('span.empty')?.textContent, 'empty');
		assert.equal(document.querySelector('em'), null);

		data.items.push('three');
		control.refresh();
		assert.equal(document.querySelector('span.empty'), null);
		assert.deepEqual(Array.from(document.querySelectorAll('em')).map(node => node.textContent), ['three']);

		assertDumpClean(control.dump());
	});
});

test('dasy use() rejects arrays', () => {
	withDOM(() => {
		const data = { items: [{ title: 'one' }, { title: 'two' }] };
		assert.throws(
			() => dasy({ data, container: document.body }, (_, root) => root.html`<div>${root.use('.items', items => items.length)}</div>`),
			error => error instanceof TypeError && /"use" only usable for objects/.test(error.message),
		);
	});
});

test('dasy inspect() supports arrays and stays in sync beside each()', () => {
	withDOM(() => {
		const data = { items: [{ title: 'one' }, { title: 'two' }] };
		const control = dasy({ data, container: document.body }, (oData, oRoot) => oRoot.html`
			<div>
				<b>${oRoot.inspect('.items', items => items.length)}</b>
				<div>${oRoot.each('.items', (item, itemRoot) => itemRoot.html`<em>${item.title}</em>`)}</div>
			</div>
		`);

		assert.equal(document.querySelector('b').textContent, '2');
		assert.deepEqual(Array.from(document.querySelectorAll('em')).map(node => node.textContent), ['one', 'two']);

		data.items[0].title = 'ONE';
		control.refresh();
		assert.equal(document.querySelector('b').textContent, '2');
		assert.deepEqual(Array.from(document.querySelectorAll('em')).map(node => node.textContent), ['ONE', 'two']);

		data.items.push({ title: 'three' });
		control.refresh();
		assert.equal(document.querySelector('b').textContent, '3');
		assert.deepEqual(Array.from(document.querySelectorAll('em')).map(node => node.textContent), ['ONE', 'two', 'three']);

		data.items.splice(1, 1);
		control.refresh();
		assert.equal(document.querySelector('b').textContent, '2');
		assert.deepEqual(Array.from(document.querySelectorAll('em')).map(node => node.textContent), ['ONE', 'three']);
	});
});

test('dasy inspect() rerenders on deep descendant changes inside a watched subtree', () => {
	withDOM(() => {
		const data = {
			rows: [
				{ cells: [{ count: 0 }, { count: 1 }] },
				{ cells: [{ count: 2 }] },
			],
		};
		const control = dasy({ data, container: document.body }, (_, root) => root.html`
			<div class="summary">${root.inspect('.rows', rows => rows.map(row =>
				row.cells.reduce((sum, cell) => sum + cell.count, 0)).join('|'))}</div>
		`);

		assert.equal(document.querySelector('.summary').textContent, '1|2');

		data.rows[0].cells[1].count = 5;
		control.refresh();
		assert.equal(document.querySelector('.summary').textContent, '5|2');

		data.rows[1].cells.push({ count: 3 });
		control.refresh();
		assert.equal(document.querySelector('.summary').textContent, '5|5');
	});
});

test('dasy reapplies ps* attributes after child option watchers refresh', () => {
	withDOM(() => {
		const data = {
			options: { items: [{ id: 0, text: 'zero' }, { id: 1, text: 'one' }] },
			rows: [{ cells: [1] }],
		};
		const control = dasy({ data, container: document.body }, (_, root) => root.html`
			<table>${root.each('.rows', (_, row) => row.html`<tr>${row.each('.cells', (value, col) =>
				col.html`<td><select psValue="${value}">${root.each('.options.items', (option, optionRoot) => optionRoot.html`<option value="${option.id}">${option.text}</option>`)}</select></td>`
			)}</tr>`)}</table>
		`);

		const select = document.querySelector('select');
		assert.equal(select.value, '1');

		data.options.items.splice(0, 0, { id: 9, text: 'nine' });
		control.refresh();
		assert.equal(select.value, '1');

		data.options.items.splice(1, 1);
		control.refresh();
		assert.equal(select.value, '1');
	});
});

test('dasy keeps nested each() watchers in sync', () => {
	withDOM(() => {
		const data = { items: [{ title: 'one', value: 1 }, { title: 'two', value: 2 }] };
		const control = dasy({ data, container: document.body }, (oData, oRoot) => oRoot.html`<table>${oRoot.each('.items', (item, itemRoot) => itemRoot.html`<tr><td>${item.title}</td><td>${item.value}</td></tr>`)}</table>`);

		data.items.splice(0, 0, { title: 'zero', value: 0 });
		control.refresh();
		data.items[1].value = 11;
		control.refresh();
		assert.deepEqual(Array.from(document.querySelectorAll('tr')).map(row => row.textContent), ['zero0', 'one11', 'two2']);

		data.items.splice(0, 1);
		control.refresh();
		data.items[1].value = 22;
		control.refresh();
		assert.deepEqual(Array.from(document.querySelectorAll('tr')).map(row => row.textContent), ['one11', 'two22']);
	});
});

test('dasy rebuilds nested row each() watchers after adding a row then a column', () => {
	withDOM(() => {
		const data = { grid: [['0.0', '0.1'], ['1.0', '1.1']] };
		const control = dasy({ data, container: document.body }, (oData, oRoot) => oRoot.html`
			<table>${oRoot.each('.grid', (_, row) => row.html`<tr>${row.each((cell, cellRoot) => cellRoot.html`<td>${cell}</td>`)}</tr>`)}</table>
		`);

		const firstRow = document.querySelectorAll('tr')[0];
		const firstCell = firstRow.querySelectorAll('td')[0];

		data.grid.push(data.grid[0].map((_, index) => `${data.grid.length}.${index}`));
		control.refresh();
		data.grid.forEach((row, index) => row.push(`${index}.${row.length}`));
		control.refresh();

		assert.equal(document.querySelectorAll('tr')[0], firstRow);
		assert.equal(document.querySelectorAll('tr')[0].querySelectorAll('td')[0], firstCell);

		assert.deepEqual(
			Array.from(document.querySelectorAll('tr')).map(row => Array.from(row.querySelectorAll('td')).map(cell => cell.textContent)),
			[
				['0.0', '0.1', '0.2'],
				['1.0', '1.1', '1.2'],
				['2.0', '2.1', '2.2'],
			],
		);
	});
});

test('dasy tracks watcher dumps', () => {
	withDOM(() => {
		const data = { items: [{ title: 'one', value: 1 }, { title: 'two', value: 2 }], counters: { second: { value: 2 } } };
		const control = dasy({ data, container: document.body }, (oData, oRoot) => oRoot.html`<table>${oRoot.each('.items', (item, itemRoot) => itemRoot.html`<tr><td>${item.title}</td><td><u>${oRoot.use('.counters.second', $ => $.value)}</u></td></tr>`)}</table>`);

		assert.equal(getWatcherCountAtPath(control.dump(), '.counters.second'), 2);
		data.items.splice(0, 1);
		control.refresh();
		const dump = control.dump();
		assert.equal(getWatcherCountAtPath(dump, '.counters.second'), 1);
		assertDumpClean(dump);
	});
});

test('dasy cleans up redundant references and leaked render functions', () => {
	withDOM(() => {
		const shared = { title: 'one' };
		const data = { items: [shared], mirrors: [shared] };
		assert.throws(() => dasy({ data, container: document.body }, (oData, oRoot) => oRoot.html`<div>${oRoot.each('.items', (item, itemRoot) => itemRoot.html`<span>${item.title}</span>`)}</div>`), /redundant object references/);
	});

	withDOM(() => {
		const data = { shared: { lexicon: [{ name: 'alice' }] } };
		dasy({ data, container: document.body }, (oData, oRoot) => oRoot.html`<div>${oRoot.use('.shared', (oShared, oSharedRoot) => oSharedRoot.each('.lexicon', (share, shareRoot) => shareRoot.html`<span>${share.name}</span>`))}</div>`);
		assert.deepEqual(Array.from(document.querySelectorAll('span')).map(node => node.textContent), ['alice']);
	});

	withDOM(() => {
		const data = { shared: { lexicon: [{ name: 'alice' }] } };
		assert.throws(
			() => dasy({ data, container: document.body }, (oData, oRoot) => oRoot.html`<div>${oRoot.use('.shared', (oShared, oSharedRoot) => () => oSharedRoot.each('.lexicon', (share, shareRoot) => shareRoot.html`<span>${share.name}</span>`))}</div>`),
			/Render function leaked into output/,
		);
	});
});

test('dasy throws when each/use is rendered inside imported html instead of context html', () => {
	withDOM(() => {
		const data = { items: [{ title: 'one' }] };
		assert.throws(
			() => dasy({ data, container: document.body }, (oData, oRoot) => html`<div>${oRoot.each('.items', item => item.title)}</div>`),
			error => error instanceof TypeError && /require context html\/svg templates/.test(error.message),
		);
	});
});

test('dasy calls beforeRefresh and afterRefresh around refresh', () => {
	withDOM(() => {
		const data = { value: 1 };
		const calls = [];
		const control = dasy({
			data,
			container: document.body,
			beforeRefresh: d => calls.push({ phase: 'before', value: d.value }),
			afterRefresh: d => calls.push({ phase: 'after', value: d.value }),
		}, (oData, oRoot) => oRoot.html`<div>${oData.value}</div>`);

		assert.deepEqual(calls, []);

		data.value = 2;
		control.refresh();
		assert.deepEqual(calls, [{ phase: 'before', value: 2 }, { phase: 'after', value: 2 }]);

		data.value = 3;
		control.refresh();
		assert.deepEqual(calls, [
			{ phase: 'before', value: 2 },
			{ phase: 'after', value: 2 },
			{ phase: 'before', value: 3 },
			{ phase: 'after', value: 3 },
		]);
	});
});

test('DasyDataSource constructor rejects redundant references', () => {
	const shared = { value: 1 };
	assert.throws(() => new DasyDataSource({ a: shared, b: shared }), /redundant object references/);
});

test('DasyDataSource shares data and notifies subscribers', () => {
	withDOM(() => {
		const data = { items: [{ title: 'one' }] };
		const source = new DasyDataSource(data);

		assert.equal(source.data, data);

		const calls = [];
		const control = dasy({
			dataSource: source,
			container: document.body,
			beforeRefresh: d => calls.push({ phase: 'before', value: d.items[0].title }),
			afterRefresh: d => calls.push({ phase: 'after', value: d.items[0].title }),
		}, (items, root) => root.html`<div>${root.each('.items', (item, itemRoot) => itemRoot.html`<span>${item.title}</span>`)}</div>`);

		assert.equal(document.querySelector('span').textContent, 'one');

		data.items[0].title = 'two';
		source.refresh();
		assert.equal(document.querySelector('span').textContent, 'two');
		assert.deepEqual(calls, [{ phase: 'before', value: 'two' }, { phase: 'after', value: 'two' }]);

		control.disconnect();
	});
});

test('DasyDataSource optionally scopes diffs by dataPath', () => {
	withDOM(() => {
		const data = { a: { value: 1 }, b: { value: 2 } };
		const source = new DasyDataSource(data);

		const aCalls = [];
		const bCalls = [];
		const controlA = dasy({
			dataSource: source,
			dataPath: '.a',
			container: document.body,
			beforeRefresh: d => aCalls.push(d.a.value),
			afterRefresh: d => aCalls.push(d.a.value),
		}, (_, root) => root.html`<span class="a">${root.use('.a', $ => $.value)}</span>`);

		const controlB = dasy({
			dataSource: source,
			dataPath: '.b',
			container: document.body,
			beforeRefresh: d => bCalls.push(d.b.value),
			afterRefresh: d => bCalls.push(d.b.value),
		}, (_, root) => root.html`<span class="b">${root.use('.b', $ => $.value)}</span>`);

		assert.equal(document.querySelector('.a').textContent, '1');
		assert.equal(document.querySelector('.b').textContent, '2');

		data.a.value = 10;
		source.refresh();
		assert.equal(document.querySelector('.a').textContent, '10');
		assert.equal(document.querySelector('.b').textContent, '2');
		assert.deepEqual(aCalls, [10, 10]);
		assert.deepEqual(bCalls, [2]);

		data.b.value = 20;
		source.refresh();
		assert.equal(document.querySelector('.b').textContent, '20');
		assert.deepEqual(aCalls, [10, 10, 10]);
		assert.deepEqual(bCalls, [2, 20, 20]);
	});
});

test('DasyDataSource sends all diffs by default', () => {
	withDOM(() => {
		const data = { a: { value: 1 }, b: { value: 2 } };
		const source = new DasyDataSource(data);
		const aCalls = [];
		const bCalls = [];
		const controlA = dasy({
			dataSource: source,
			container: document.body,
			afterRefresh: d => aCalls.push(d.a.value),
		}, (_, root) => root.html`<span class="a">${root.use('.a', $ => $.value)}</span>`);
		const controlB = dasy({
			dataSource: source,
			container: document.body,
			afterRefresh: d => bCalls.push(d.b.value),
		}, (_, root) => root.html`<span class="b">${root.use('.b', $ => $.value)}</span>`);

		data.a.value = 10;
		source.refresh();
		assert.equal(document.querySelector('.a').textContent, '10');
		assert.equal(document.querySelector('.b').textContent, '2');
		assert.deepEqual(aCalls, [10]);
		assert.deepEqual(bCalls, [2]);

		data.b.value = 20;
		source.refresh();
		assert.equal(document.querySelector('.b').textContent, '20');
		assert.deepEqual(aCalls, [10, 10]);
		assert.deepEqual(bCalls, [2, 20]);

		controlA.disconnect();
		controlB.disconnect();
	});
});

test('DasyDataSource unsubscribe stops notifications', () => {
	withDOM(() => {
		const data = { value: 1 };
		const source = new DasyDataSource(data);
		const control = dasy({
			dataSource: source,
			container: document.body,
		}, ($, root) => root.html`<span>${$.value}</span>`);

		control.disconnect();
		data.value = 2;
		assert.doesNotThrow(() => source.refresh());
	});
});

test('dasy set() refreshes shared dataSource', () => {
	withDOM(() => {
		const data = { state: { value: 1 } };
		const source = new DasyDataSource(data);
		const control = dasy({
			dataSource: source,
			container: document.body,
		}, (_, root) => root.html`<button>${root.use('.state', (state, stateRoot) => stateRoot.html`
			<span onClick="${() => stateRoot.set('.value', 5)}">${state.value}</span>
		`)}</button>`);

		const span = document.querySelector('span');
		span.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
		assert.equal(data.state.value, 5);
		assert.equal(document.querySelector('span').textContent, '5');
		control.disconnect();
	});
});

test('dasy constructor requires data or dataSource', () => {
	withDOM(() => {
		assert.throws(
			() => dasy({ container: document.body }, () => ''),
			/Constructor parameter "dataSource" or "data" required/,
		);
	});
});

test('dasy refresh() no-ops when using dataSource', () => {
	withDOM(() => {
		const data = { state: { value: 1 } };
		const source = new DasyDataSource(data);
		const control = dasy({
			dataSource: source,
			container: document.body,
		}, (_, root) => root.html`<span>${root.use('.state', $ => $.value)}</span>`);

		data.state.value = 2;
		control.refresh();
		assert.equal(document.querySelector('span').textContent, '1');

		source.refresh();
		assert.equal(document.querySelector('span').textContent, '2');
	});
});

test('dasy rebuilds each() on val diff with non-numeric or missing index', () => {
	withDOM(() => {
		const data = { items: ['a', 'b'] };
		const control = dasy({ data, container: document.body }, (_, root) => root.html`<div>${root.each('.items', (item, itemRoot) => itemRoot.html`<span>${item}</span>`)}</div>`);

		assert.deepEqual(Array.from(document.querySelectorAll('span')).map(node => node.textContent), ['a', 'b']);

		control.receiveDiffs([[new JSONPath('.items'), 'val', 'foo', 'bar']]);
		assert.deepEqual(Array.from(document.querySelectorAll('span')).map(node => node.textContent), ['a', 'b']);

		control.receiveDiffs([[new JSONPath('.items'), 'val', 5, 'x']]);
		assert.deepEqual(Array.from(document.querySelectorAll('span')).map(node => node.textContent), ['a', 'b']);
	});
});

test('dasy supports svg templates', () => {
	withDOM(() => {
		const data = { shape: { radius: 25 } };
		const control = dasy({ data, container: document.body }, (_, root) => root.svg`<svg>${root.use('.shape', (shape, shapeRoot) => shapeRoot.svg`<circle r="${shape.radius}" />`)}</svg>`);

		const circle = document.querySelector('circle');
		assert.equal(circle.namespaceURI, 'http://www.w3.org/2000/svg');
		assert.equal(circle.getAttribute('r'), '25');

		data.shape.radius = 50;
		control.refresh();
		assert.equal(document.querySelector('circle').getAttribute('r'), '50');
	});
});
