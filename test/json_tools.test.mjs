import { test, expect } from 'bun:test';
import {
	JSONPath,
	applyDiffs,
	assertNoReferenceRedundancies,
	cleanDeep,
	diffDeep,
	equalDeep,
	findReferenceRedundancies,
	forceDeep,
	getByPath,
	mapDeep,
	mergeDeep,
	setByPath,
	JSONUndoBuffer,
} from '../source/json_tools.mts';

const normalizeDiff = (diffEntries) => diffEntries.map(entry => {
	const [path, type, key, value, removedValue] = entry;
	if (!(path instanceof JSONPath))
		throw new TypeError(`normalizeDiff: expected JSONPath as first tuple element, got ${typeof path} (${String(path)})`);
	return entry.length > 4 ? [path.asPath(), type, key, value, removedValue] : [path.asPath(), type, key, value];
});

const cloneValue = (value) => structuredClone(value);
const makeObjectItems = () => [
	{ title: 'one', value: 1 },
	{ title: 'two', value: 2 },
	{ title: 'three', value: 3 },
];

const assertRoundTrip = (leftValue, rightValue, label) => {
	const diffEntries = diffDeep(leftValue, rightValue);
	const rebuilt = applyDiffs(cloneValue(leftValue), diffEntries).target;
	expect(rebuilt).toEqual(rightValue);
};

const assertInverseRoundTrip = (leftValue, rightValue, label) => {
	const diffEntries = diffDeep(leftValue, rightValue);
	const { target: rebuilt, inverseDiffs } = applyDiffs(cloneValue(leftValue), diffEntries);
	expect(rebuilt).toEqual(rightValue);

	const restored = applyDiffs(cloneValue(rebuilt), inverseDiffs).target;
	expect(restored).toEqual(leftValue);
};

const assertNoSlip = (leftValue, rightValue, label) => {
	const rawDiff = diffDeep(leftValue, rightValue);
	const normalized = normalizeDiff(rawDiff);
	const equal = equalDeep(leftValue, rightValue);
	if (equal)
		expect(normalized).toEqual([]);
	else
		expect(normalized.length).toBeGreaterThan(0);

	const rebuilt = applyDiffs(cloneValue(leftValue), rawDiff).target;
	expect(rebuilt).toEqual(rightValue);
};

const enumerateArrays = (domainValues, maxLength) => {
	const result = [];
	const walk = (prefix, length) => {
		if (prefix.length === length) {
			result.push(prefix.slice());
			return;
		}
		for (let i = 0; i < domainValues.length; i++) {
			prefix.push(domainValues[i]);
			walk(prefix, length);
			prefix.pop();
		}
	};
	for (let length = 0; length <= maxLength; length++)
		walk([], length);
	return result;
};

const makeSeededRandom = (seed) => {
	let state = seed >>> 0;
	return () => {
		state = (1664525 * state + 1013904223) >>> 0;
		return state / 4294967296;
	};
};

const randomInt = (random, maxExclusive) => Math.floor(random() * maxExclusive);

const randomPrimitive = (random) => {
	const index = randomInt(random, 8);
	if (index === 0) return null;
	if (index === 1) return false;
	if (index === 2) return true;
	if (index === 3) return randomInt(random, 11) - 5;
	if (index === 4) return `s${randomInt(random, 7)}`;
	if (index === 5) return '';
	if (index === 6) return 0;
	return undefined;
};

const randomTree = (random, depth = 0) => {
	if (depth >= 3 || random() < 0.35)
		return randomPrimitive(random);

	if (random() < 0.5) {
		const length = randomInt(random, 5);
		const arrayValue = [];
		for (let i = 0; i < length; i++)
			arrayValue.push(randomTree(random, depth + 1));
		return arrayValue;
	}

	const objectValue = {};
	const keys = ['a', 'b', 'c', 'd'];
	const count = randomInt(random, keys.length + 1);
	for (let i = 0; i < count; i++) {
		const key = keys[i];
		objectValue[key] = randomTree(random, depth + 1);
	}
	return objectValue;
};

test('JSONPath parsing', () => {
	const path = new JSONPath('.a[2]["x.y"]');
	expect([...path]).toEqual(['a', 2, 'x.y']);
	expect(path.asPath()).toBe(".a[2]['x.y']");
	const path2 = new JSONPath(path.asPath());
	expect([...path2]).toEqual(['a', 2, 'x.y']);
	const path3 = new JSONPath(['a', 2, 'x.y']);
	expect([...path3]).toEqual(['a', 2, 'x.y']);

	const path4 = new JSONPath('[0].name');
	expect([...path4]).toEqual([0, 'name']);
	expect(path4.asPath()).toBe('[0].name');
	expect([...new JSONPath(path4.asPath())]).toEqual([0, 'name']);

	const path5 = new JSONPath(".a['x y']");
	expect([...path5]).toEqual(['a', 'x y']);
	expect(path5.asPath()).toBe(".a['x y']");

	const path6 = new JSONPath('.foo');
	expect([...path6]).toEqual(['foo']);
	expect(path6.asPath()).toBe('.foo');

	expect(() => new JSONPath('a')).toThrow(SyntaxError);
});

test('JSONPath wildcard (*) parsing', () => {
	// .a[*] — object property wildcard
	const path1 = new JSONPath('.a[*]');
	expect([...path1]).toEqual(['a', null]);
	expect(path1.asPath()).toBe('.a.*');
	const path1b = new JSONPath(path1.asPath());
	expect([...path1b]).toEqual(['a', null]);

	// .a.* — direct wildcard
	const path2 = new JSONPath('.a.*');
	expect([...path2]).toEqual(['a', null]);
	expect(path2.asPath()).toBe('.a.*');
	const path2b = new JSONPath(path2.asPath());
	expect([...path2b]).toEqual(['a', null]);

	// a.*.b — wildcard in the middle
	const path3 = new JSONPath('.a.*.b');
	expect([...path3]).toEqual(['a', null, 'b']);
	expect(path3.asPath()).toBe('.a.*.b');
	const path3b = new JSONPath(path3.asPath());
	expect([...path3b]).toEqual(['a', null, 'b']);

	// *.* — double wildcard
	const path4 = new JSONPath('.*.*');
	expect([...path4]).toEqual([null, null]);
	expect(path4.asPath()).toBe('.*.*');
	const path4b = new JSONPath(path4.asPath());
	expect([...path4b]).toEqual([null, null]);

	// a[0].* — wildcard after bracket index
	const path5 = new JSONPath('.a[0].*');
	expect([...path5]).toEqual(['a', 0, null]);
	expect(path5.asPath()).toBe('.a[0].*');
	const path5b = new JSONPath(path5.asPath());
	expect([...path5b]).toEqual(['a', 0, null]);

	// asKey: null → '*'
	const path6 = new JSONPath('.a.*');
	expect(path6.asKey()).toBe('a\0*\0');

	// round-trip: array with null → string → array
	const path7 = new JSONPath(['a', null, 'b']);
	expect(path7.asPath()).toBe('.a.*.b');
	const path7b = new JSONPath(path7.asPath());
	expect([...path7b]).toEqual(['a', null, 'b']);
});

test('JSONPath selectFrom with wildcard', () => {
	const target = {
		a: { x: 1, y: 2, z: 3 },
		b: [10, 20, 30],
		nested: {
			items: [{ name: 'first' }, { name: 'second' }],
		},
	};

	// selectFrom nem támogatja a wildcard token-eket: TypeError-t dob
	const path1 = new JSONPath('.a.*');
	expect(() => path1.selectFrom(target)).toThrow(TypeError);
	expect(() => path1.selectFrom(target)).toThrow(/path cannot contain wildcards/);

	const path2 = new JSONPath('.a[*]');
	expect(() => path2.selectFrom(target)).toThrow(TypeError);

	const path3 = new JSONPath('.b.*');
	expect(() => path3.selectFrom(target)).toThrow(TypeError);

	const path4 = new JSONPath('.nested.items.*');
	expect(() => path4.selectFrom(target)).toThrow(TypeError);

	// Non-wildcard paths still work normally
	expect(new JSONPath('.a.x').selectFrom(target)).toBe(1);
	expect(new JSONPath('.b[1]').selectFrom(target)).toBe(20);
	expect(new JSONPath('.nested.items[0].name').selectFrom(target)).toBe('first');
});

test('JSONPath selectAllFrom with wildcard', () => {
	const target = {
		a: { x: 1, y: 2, z: 3 },
		b: [10, 20, 30],
		nested: {
			items: [{ name: 'first' }, { name: 'second' }],
		},
	};

	// .a.* → az összes gyerek értéke
	const path1 = new JSONPath('.a.*');
	expect(path1.selectAllFrom(target)).toEqual([1, 2, 3]);

	// .b.* → tömb elemek
	const path2 = new JSONPath('.b.*');
	expect(path2.selectAllFrom(target)).toEqual([10, 20, 30]);

	// .nested.items.* → objektumok tömbje
	const path3 = new JSONPath('.nested.items.*');
	expect(path3.selectAllFrom(target)).toEqual([{ name: 'first' }, { name: 'second' }]);

	// .nested.items.*.name → mély wildcard traversal
	const path4 = new JSONPath('.nested.items.*.name');
	expect(path4.selectAllFrom(target)).toEqual(['first', 'second']);

	// *.* — double wildcard: az összes property value
	const path5 = new JSONPath('.*');
	expect(path5.selectAllFrom(target)).toEqual([
		{ x: 1, y: 2, z: 3 },
		[10, 20, 30],
		{ items: [{ name: 'first' }, { name: 'second' }] },
	]);

	// a.*.name — nincs találat, mert a.* nem tömb
	const path6 = new JSONPath('.a.*.name');
	expect(path6.selectAllFrom(target)).toEqual([]);

	// Tömb root-on: [*] nem támogatott (root szinten csak .prop vagy [index])
	// De .[*] működik, ha a root objektumot adjuk meg
	const arrayTarget = [{ id: 1 }, { id: 2 }, { id: 3 }];
	const path7 = new JSONPath('[*].id');
	expect([...path7]).toEqual([null, 'id']);
	expect(path7.selectAllFrom(arrayTarget)).toEqual([1, 2, 3]);

	// Üres objektum
	expect(new JSONPath('.a.*').selectAllFrom({})).toEqual([]);

	// Null/undefined intermediate
	expect(new JSONPath('.missing.*').selectAllFrom(target)).toEqual([]);
	expect(new JSONPath('.a.x.*').selectAllFrom(target)).toEqual([]); // x=1 (primitív), nincs gyerek

	// selectAllFrom nem módosítja a target-et
	expect(target.a.x).toBe(1);
	expect(target.b).toEqual([10, 20, 30]);

	// selectAllFrom TypeError üres target-en
	expect(() => new JSONPath('.a.*').selectAllFrom(null)).toThrow(TypeError);
	expect(() => new JSONPath('.a.*').selectAllFrom(undefined)).toThrow(TypeError);
	expect(() => new JSONPath('.a.*').selectAllFrom(42)).toThrow(TypeError);
	expect(() => new JSONPath('.a.*').selectAllFrom('string')).toThrow(TypeError);
});

test('getByPath', () => {
	const target = {
		a: 1,
		nested: {
			level: 9,
			arr: [
				{
					name: 'first',
					'x.y': 123,
					'space key': 'ok',
				},
			],
		},
		7: 'v',
	};

	expect(getByPath(target, '.a')).toBe(1);
	expect(getByPath(target, '.nested.level')).toBe(9);
	expect(getByPath(target, '.nested.arr[0].name')).toBe('first');
	expect(getByPath(target, '.nested.arr[0]["x.y"]')).toBe(123);
	expect(getByPath(target, ".nested.arr[0]['space key']")).toBe('ok');
	expect(getByPath(target, '[7]')).toBe('v');
	expect(getByPath(target, new JSONPath('.nested.arr[0].name'))).toBe('first');
	expect(getByPath(target, new JSONPath(['nested', 'arr', 0, 'space key']))).toBe('ok');
	expect(getByPath(target, new JSONPath())).toBe(target);

	const arrayTarget = [];
	arrayTarget[2] = 'x';
	arrayTarget[3] = { a: [] };
	arrayTarget[3].a[1] = 7;

	expect(getByPath(arrayTarget, '[2]')).toBe('x');
	expect(getByPath(arrayTarget, '[3].a[1]')).toBe(7);
	expect(getByPath(arrayTarget, new JSONPath([3, 'a', 1]))).toBe(7);

	expect(getByPath(target, '.missing')).toBeUndefined();
	expect(getByPath(target, '.nested.missing')).toBeUndefined();
	expect(getByPath(target, '.nested.level.nope')).toBeUndefined();
	expect(getByPath(target, '.nested.arr[2]')).toBeUndefined();
	expect(getByPath(target, new JSONPath(['nested', 'missing']))).toBeUndefined();

	expect(() => getByPath(null, '.a')).toThrow(/target must be an object or array/);
	expect(() => getByPath({}, /** @type {any} */ (12))).toThrow(/path must be a string or JSONPath/);
	expect(() => getByPath({}, '')).toThrow(/path must not be empty/);
	expect(() => getByPath({}, '.')).toThrow(/invalid path segment/);
	expect(() => getByPath({}, '.a[')).toThrow(/invalid path segment/);
	expect(() => getByPath({}, '.a[]')).toThrow(/invalid path segment/);
	expect(() => getByPath({}, '.a[abc]')).toThrow(/invalid path segment/);
	expect(() => getByPath({}, '.a["x"')).toThrow(/invalid path segment/);
	expect(() => getByPath({}, 'rootKey')).toThrow(/invalid path segment/);
});

test('setByPath', () => {
	const target = {};
	expect(setByPath(target, '.a', 1)).toBe(target);
	expect(target).toEqual({ a: 1 });

	const path = new JSONPath('.fromPath.value');
	setByPath(target, path, 2);
	expect(target.fromPath.value).toBe(2);

	setByPath(target, '.nested.level', 9);
	expect(target).toEqual({
		a: 1,
		fromPath: { value: 2 },
		nested: { level: 9 },
	});

	setByPath(target, '.nested[0].name', 'first');
	expect(target.nested[0]).toEqual({ name: 'first' });

	setByPath(target, '.nested[0]["x.y"]', 123);
	expect(target.nested[0]['x.y']).toBe(123);

	setByPath(target, ".nested[0]['space key']", 'ok');
	expect(target.nested[0]['space key']).toBe('ok');

	const arrayTarget = [];
	setByPath(arrayTarget, '[2]', 'x');
	expect(arrayTarget[2]).toBe('x');

	setByPath(arrayTarget, '[3].a[1]', 7);
	expect(arrayTarget[3].a.length).toBe(2);
	expect(0 in arrayTarget[3].a).toBe(false);
	expect(arrayTarget[3].a[1]).toBe(7);

	const numericTarget = {};
	setByPath(numericTarget, '[7]', 'v');
	expect(numericTarget[7]).toBe('v');

	expect(() => setByPath(null, '.a', 1)).toThrow(/target must be an object or array/);
	expect(() => setByPath({}, /** @type {any} */ (12), 1)).toThrow(/path must be a string or JSONPath/);
	expect(() => setByPath({}, '', 1)).toThrow(/path must not be empty/);
	expect(() => setByPath({}, new JSONPath(), 1)).toThrow(/path must not be empty/);
	expect(() => setByPath({}, '.', 1)).toThrow(/invalid path segment/);
	expect(() => setByPath({}, '.a[', 1)).toThrow(/invalid path segment/);
	expect(() => setByPath({}, '.a[]', 1)).toThrow(/invalid path segment/);
	expect(() => setByPath({}, '.a[abc]', 1)).toThrow(/invalid path segment/);
	expect(() => setByPath({}, '.a["x"', 1)).toThrow(/invalid path segment/);
	expect(() => setByPath({}, 'rootKey', 1)).toThrow(/invalid path segment/);
});

test('equalDeep', () => {
	expect(equalDeep(1, 1)).toBe(true);
	expect(equalDeep(1, 2)).toBe(false);
	expect(equalDeep(true, false)).toBe(false);
	expect(equalDeep('a', 'a')).toBe(true);
	expect(equalDeep('a', 'b')).toBe(false);
	expect(equalDeep(null, null)).toBe(true);
	expect(equalDeep(null, {})).toBe(false);

	expect(equalDeep([1, { a: 2 }], [1, { a: 2 }])).toBe(true);
	expect(equalDeep([1, { a: 2 }], [1, { a: 3 }])).toBe(false);
	expect(equalDeep({ x: 1, y: 2 }, { y: 2, x: 1 })).toBe(true);
	expect(equalDeep({ x: 1, y: 2 }, { y: 2, x: 2 })).toBe(false);

	const cycleA = { id: 1 };
	cycleA.self = cycleA;
	const cycleB = { id: 1 };
	cycleB.self = cycleB;
	const cycleC = { id: 2 };
	cycleC.self = cycleC;

	expect(equalDeep(cycleA, cycleB)).toBe(false);
	expect(equalDeep(cycleA, cycleC)).toBe(false);
});

test('mergeDeep', () => {
	const target = {
		title: 'A',
		nested: { level: 1, keep: true },
		arr: [1, 2, 3],
	};
	const source = {
		title: 'B',
		nested: { level: 2, added: 'x' },
		arr: [9],
		extra: 42,
	};
	const result = mergeDeep(target, source);
	expect(result).toBe(target);
	expect(target).toEqual({
		title: 'B',
		nested: { level: 2, keep: true, added: 'x' },
		arr: [9, 2, 3],
		extra: 42,
	});

	expect(mergeDeep(10, { a: 1 })).toBe(10);

	const protoSource = Object.create({ inherited: 1 });
	protoSource.own = 2;
	const protoTarget = {};
	mergeDeep(protoTarget, protoSource);
	expect(protoTarget).toEqual({ own: 2 });
});

test('forceDeep', () => {
	const target = {
		title: 'Old',
		nested: { keep: true, removeMe: 'x' },
		arr: [1, 2, 3, 4],
		removeRoot: true,
	};
	const source = {
		title: 'New',
		nested: { keep: false },
		arr: [9, 8],
	};
	const result = forceDeep(target, source);
	expect(result).toBe(target);
	expect(target).toEqual({
		title: 'New',
		nested: { keep: false },
		arr: [9, 8],
	});
});

test('cleanDeep', () => {
	const deep = {
		a: { b: {} },
		c: [],
		d: { e: { f: {} } },
	};
	expect(cleanDeep(deep)).toBe(true);
	expect(deep).toEqual({});

	const nonEmpty = { keep: 1, nested: { child: {} } };
	expect(cleanDeep(nonEmpty)).toBe(false);
	expect(nonEmpty).toEqual({ keep: 1 });

	expect(cleanDeep(null)).toBe(false);
	expect(cleanDeep('x')).toBe(false);
	expect(cleanDeep(undefined)).toBe(false);
});

test('mapDeep', () => {
	const source = {
		a: 1,
		nested: { b: 2, c: 3 },
		arr: [{ z: 1 }, 4],
	};
	const mapped = mapDeep(source, ([key, value]) => {
		if (key === 'c') return null;
		return [`x_${key}`, value];
	});
	expect(mapped).toEqual({
		x_a: 1,
		x_nested: { x_b: 2 },
		x_arr: [{ x_z: 1 }, 4],
	});

	expect(mapDeep([1, { a: 2 }], ([key, value]) => [key.toUpperCase(), value])).toEqual([1, { A: 2 }]);
});

test('findReferenceRedundancies', () => {
	const normalize = (issues) => issues.map(({ firstPath, duplicatePath }) => [firstPath.asPath(), duplicatePath.asPath()]);

	expect(findReferenceRedundancies(1)).toEqual([]);
	expect(findReferenceRedundancies(null)).toEqual([]);
	expect(findReferenceRedundancies({ a: 1, b: [2, 3] })).toEqual([]);

	const shared = { title: 'one' };
	expect(normalize(findReferenceRedundancies({ left: shared, right: shared }))).toEqual([['.left', '.right']]);

	const child = { name: 'doc' };
	expect(normalize(findReferenceRedundancies({ children: { all: [child], documents: [child], timelines: [child] } }))).toEqual([['.children.all[0]', '.children.documents[0]'], ['.children.all[0]', '.children.timelines[0]']]);

	const root = { id: 1 };
	root.self = root;
	expect(findReferenceRedundancies(root)).toEqual([]);

	expect(() => assertNoReferenceRedundancies({ items: [shared], mirrors: [shared] }, 'test data')).toThrow(/test data contains redundant object references: \.mirrors\[0\] -> \.items\[0\]/);
});

test('diffDeep and applyDiffs', () => {
	expect(normalizeDiff(diffDeep(7, 7))).toEqual([]);
	expect(normalizeDiff(diffDeep(7, 8))).toEqual([['', 'val', undefined, 8]]);
	expect(normalizeDiff(diffDeep('7', 7))).toEqual([['', 'val', undefined, 7]]);
	expect(normalizeDiff(diffDeep(null, {}))).toEqual([['', 'val', undefined, {}]]);

	expect(normalizeDiff(diffDeep({ a: 1 }, { a: 1, b: 2 }))).toEqual([['', 'set', 'b', 2]]);
	expect(normalizeDiff(diffDeep({ a: 1 }, { b: 1 }))).toEqual([['', 'rem', 'a', undefined], ['', 'set', 'b', 1]]);
	expect(normalizeDiff(diffDeep({ a: { b: 2 } }, { a: { b: 3 } }))).toEqual([['.a', 'val', 'b', 3]]);
	expect(normalizeDiff(diffDeep({ counters: { first: 1 } }, { counters: { first: 2 } }))).toEqual([['.counters', 'val', 'first', 2]]);

	expect(normalizeDiff(diffDeep([], []))).toEqual([]);
	expect(normalizeDiff(diffDeep([1, 2, 3], [1, 9, 3]))).toEqual([['', 'val', 1, 9]]);
	expect(normalizeDiff(diffDeep([1], ['1']))).toEqual([['', 'val', 0, '1']]);
	expect(normalizeDiff(diffDeep([1, 2], [1, 2, 3]))).toEqual([['', 'ins', 2, [3]]]);
	expect(normalizeDiff(diffDeep([1], [1, 2, 3, 4]))).toEqual([['', 'ins', 1, [2, 3, 4]]]);
	expect(normalizeDiff(diffDeep([2, 3], [1, 2, 3]))).toEqual([['', 'ins', 0, [1]]]);
	expect(normalizeDiff(diffDeep([3, 4], [1, 2, 3, 4]))).toEqual([['', 'ins', 0, [1, 2]]]);
	expect(normalizeDiff(diffDeep([1, 3], [1, 2, 3]))).toEqual([['', 'ins', 1, [2]]]);
	expect(normalizeDiff(diffDeep([1, 5], [1, 2, 3, 4, 5]))).toEqual([['', 'ins', 1, [2, 3, 4]]]);
	expect(normalizeDiff(diffDeep([1, 2, 3], [1, 3]))).toEqual([['', 'del', 1, 1, [2]]]);
	expect(normalizeDiff(diffDeep([1, 2, 3, 4, 5], [1, 5]))).toEqual([['', 'del', 1, 3, [2, 3, 4]]]);
	expect(normalizeDiff(diffDeep([1, 2, 3], [1, 2]))).toEqual([['', 'del', 2, 1, [3]]]);
	expect(normalizeDiff(diffDeep([1, 2, 4, 5], [1, 2, 3, 4, 5]))).toEqual([['', 'ins', 2, [3]]]);
	expect(normalizeDiff(diffDeep([{ a: [1, 2] }], [{ a: [1, 3] }]))).toEqual([['[0].a', 'val', 1, 3]]);
	expect(normalizeDiff(diffDeep([1], [2]))).toEqual([['', 'val', 0, 2]]);

	{
		const current = { items: makeObjectItems() };
		const backup = structuredClone(current);
		current.items.push({ title: 'new', value: 4 });
		expect(normalizeDiff(diffDeep(backup, current))).toEqual([['.items', 'ins', 3, [{ title: 'new', value: 4 }]]]);
	}

	{
		const current = { items: makeObjectItems() };
		const backup = structuredClone(current);
		current.items.splice(0, 1);
		expect(normalizeDiff(diffDeep(backup, current))).toEqual([['.items', 'del', 0, 1, [{ title: 'one', value: 1 }]]]);
	}

	{
		const current = { items: makeObjectItems() };
		const backup = structuredClone(current);
		current.items.splice(1, 0, { title: 'new', value: 9 });
		expect(normalizeDiff(diffDeep(backup, current))).toEqual([['.items', 'ins', 1, [{ title: 'new', value: 9 }]]]);
	}

	assertRoundTrip([0, 1, 2, 4], [0, 9, 2, 3, 4], 'array roundtrip val+ins');
	assertInverseRoundTrip([0, 1, 2, 4], [0, 9, 4], 'array inverse roundtrip');
	assertInverseRoundTrip({ list: [0, 1, 2, 4], meta: { ok: true } }, { list: [0, 9, 2, 3, 4], meta: {} }, 'nested inverse roundtrip');

	{
		const backup = { grid: [['0.0', '0.1'], ['1.0', '1.1']] };
		const current = structuredClone(backup);
		current.grid.push(current.grid[0].map((_, index) => `${current.grid.length}.${index}`));
		const rebuilt = applyDiffs(structuredClone(backup), diffDeep(backup, current)).target;
		expect(rebuilt.grid[2]).not.toBe(current.grid[2]);
		current.grid.forEach((row, index) => row.push(`${index}.${row.length}`));
		expect(normalizeDiff(diffDeep(rebuilt, current))).toEqual([
			['.grid[0]', 'ins', 2, ['0.2']],
			['.grid[1]', 'ins', 2, ['1.2']],
			['.grid[2]', 'ins', 2, ['2.2']],
		]);
	}

	const diff = diffDeep(1, 2);
	expect(normalizeDiff(diff)).toEqual([['', 'val', undefined, 2]]);
	expect(applyDiffs(1, diff).target).toBe(2);
	{
		const { target, inverseDiffs } = applyDiffs(1, diff);
		expect(target).toBe(2);
		expect(normalizeDiff(inverseDiffs)).toEqual([['', 'val', undefined, 1]]);
	}

	const shared = { n: 1 };
	const refA = { left: shared, right: shared };
	const refB = { left: { n: 1 }, right: { n: 1 } };
	expect(normalizeDiff(diffDeep(refA, refB))).toEqual([]);

	const sameA = { x: shared, y: shared };
	const sameB = { x: shared, y: shared };
	expect(normalizeDiff(diffDeep(sameA, sameB))).toEqual([]);

	const json1 = {
		title: 'Párkák',
		hotkeys: [{ type: 'style', param: 'Time0', ctrl: false, alt: true, shift: true, code: 'KeyI', key: 'I' }],
		blocks: { block_1: { characters: '…' }, block_2: { characters: ' ' }, block_3: { characters: '–' } },
		aa: [1, 2, 3],
	};
	const json2 = {
		title: 'Párkák',
		hotkeys: [{ type: 'style', param: 'Time0', ctrl: false, alt: true, shift: true, code: 'KeyI', key: 'Iz' }],
		blocks: { block_1: { characters: '…' }, block_2: { characters: ' ' }, block_3: null },
		aa: [1, 2, 3, 4],
	};

	{
		const diffValue = normalizeDiff(diffDeep(json1, json2));
		const sortFn = (left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : (left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0);
		diffValue.sort(sortFn);
		const expected = [['.aa', 'ins', 3, [4]], ['.blocks', 'val', 'block_3', null], ['.hotkeys[0]', 'val', 'key', 'Iz']];
		expected.sort(sortFn);
		expect(diffValue).toEqual(expected);
	}

	expect(normalizeDiff(diffDeep({ a: 1 }, { a: '1' }))).toEqual([['', 'val', 'a', '1']]);
	expect(normalizeDiff(diffDeep({ a: [1, 2, 3] }, { a: [1, 99, 3] }))).toEqual([['.a', 'val', 1, 99]]);
	expect(normalizeDiff(diffDeep({ a: [1, 2] }, { a: [1, 2, 3] }))).toEqual([['.a', 'ins', 2, [3]]]);
	expect(normalizeDiff(diffDeep({ a: { x: 1, y: 2 } }, { a: { x: 1, z: 2 } }))).toEqual([['.a', 'rem', 'y', undefined], ['.a', 'set', 'z', 2]]);
	expect(normalizeDiff(diffDeep({ a: null }, { a: {} }))).toEqual([['', 'val', 'a', {}]]);
	expect(normalizeDiff(diffDeep(undefined, null))).toEqual([['', 'val', undefined, null]]);
	expect(normalizeDiff(diffDeep(undefined, []))).toEqual([['', 'val', undefined, []]]);
	expect(normalizeDiff(diffDeep(null, []))).toEqual([['', 'val', undefined, []]]);
	expect(normalizeDiff(diffDeep([], {}))).toEqual([['', 'val', undefined, {}]]);

	expect(normalizeDiff(diffDeep({ a: undefined }, { a: null }))).toEqual([['', 'val', 'a', null]]);
	expect(normalizeDiff(diffDeep({ a: undefined }, {}))).toEqual([['', 'rem', 'a', undefined]]);
	expect(normalizeDiff(diffDeep({}, { a: undefined }))).toEqual([['', 'set', 'a', undefined]]);
	expect(normalizeDiff(diffDeep({ a: [] }, { a: {} }))).toEqual([['', 'val', 'a', {}]]);

	const cycleA = { id: 1 };
	cycleA.self = cycleA;
	const cycleB = { id: 2 };
	cycleB.self = cycleB;
	expect(normalizeDiff(diffDeep(cycleA, cycleB))).toEqual([['', 'val', 'id', 2]]);

	// Function values in the second parameter are evaluated as computed values.
	expect(normalizeDiff(diffDeep(1, () => 2))).toEqual([['', 'val', undefined, 2]]);
	expect(normalizeDiff(diffDeep({ a: 1 }, { a: () => 2 }))).toEqual([['', 'val', 'a', 2]]);
	expect(normalizeDiff(diffDeep({ a: 1, b: 2 }, { a: 1, b: (b, path) => { expect(path).toBe('.b'); return 2; } }))).toEqual([]);
	{
		const received = [];
		const rightValue = {
			x: 1,
			nested: {
				y: (b, path) => {
					received.push([path, b.x]);
					return 3;
				},
			},
		};
		expect(normalizeDiff(diffDeep({ x: 1, nested: { y: 2 } }, rightValue))).toEqual([['.nested', 'val', 'y', 3]]);
		expect(received).toEqual([['.nested.y', 1]]);
	}
	expect(normalizeDiff(diffDeep({ a: { b: 1 } }, { a: () => ({ b: 2 }) }))).toEqual([['.a', 'val', 'b', 2]]);

	const domain = [0, 1, 2];
	const allArrays = enumerateArrays(domain, 5);
	for (let i = 0; i < allArrays.length; i++)
		for (let j = 0; j < allArrays.length; j++)
			assertNoSlip(allArrays[i], allArrays[j], `array-pair #${i}-${j}`);

	const random = makeSeededRandom(0xC0FFEE);
	for (let i = 0; i < 6000; i++) {
		const left = randomTree(random);
		const right = randomTree(random);
		assertNoSlip(left, right, `random-tree #${i}`);
	}
});

test('JSONUndoBuffer', () => {
	const makeState = () => ({
		title: 'Draft',
		flags: { published: false },
		items: [
			{ id: 1, text: 'one' },
			{ id: 2, text: 'two' },
			{ id: 3, text: 'three' },
		],
	});

	{
		const state = makeState();
		const undo = new JSONUndoBuffer(state);
		expect(undo.snapshot()).toBe(false);
		expect(undo.canUndo).toBe(false);
		expect(undo.canRedo).toBe(false);

		state.title = 'Draft v2';
		state.items.splice(1, 1, { id: 4, text: 'four' });
		expect(undo.snapshot()).toBe(true);

		const afterFirst = structuredClone(state);

		delete state.title;
		state.flags.published = true;
		state.items.splice(1, 1);
		state.items.push({ id: 5, text: 'five' });
		expect(undo.snapshot()).toBe(true);

		const afterSecond = structuredClone(state);

		expect(undo.undoDepth).toBe(2);
		expect(undo.redoDepth).toBe(0);
		expect(undo.undo()).toBe(true);
		expect(undo.target).toBe(state);
		expect(state).toEqual(afterFirst);

		expect(undo.undo()).toBe(true);
		expect(state).toEqual(makeState());
		expect(undo.canUndo).toBe(false);
		expect(undo.canRedo).toBe(true);

		expect(undo.redo()).toBe(true);
		expect(state).toEqual(afterFirst);
		expect(undo.redo()).toBe(true);
		expect(state).toEqual(afterSecond);
		expect(undo.redo()).toBe(false);
	}

	{
		const state = { items: [1, 2, 3, 4], meta: { ready: false } };
		const undo = new JSONUndoBuffer(state);

		state.items.splice(1, 2);
		expect(undo.snapshot()).toBe(true);
		expect(state).toEqual({ items: [1, 4], meta: { ready: false } });

		expect(undo.undo()).toBe(true);
		expect(state).toEqual({ items: [1, 2, 3, 4], meta: { ready: false } });
		expect(undo.redo()).toBe(true);
		expect(state).toEqual({ items: [1, 4], meta: { ready: false } });

		expect(undo.undo()).toBe(true);
		state.meta.ready = true;
		expect(undo.snapshot()).toBe(true);
		expect(undo.canRedo).toBe(false);
	}

	expect(() => new JSONUndoBuffer(null)).toThrow(/target must be an object or array/);
});

test('JSONPath.matches — exact match', () => {
	const path1 = new JSONPath('.a.b.c');
	const path2 = new JSONPath('.a.b.c');
	const path3 = new JSONPath('.a.b.d');
	const path4 = new JSONPath('.a.b');
	const path5 = new JSONPath('.a.*');

	expect(path1.matches(path2)).toBe(true);
	expect(path1.matches(path3)).toBe(false);
	expect(path1.matches(path4)).toBe(false);
	expect(path5.matches(path1)).toBe(true);
	expect(path5.matches(path4)).toBe(true);
	expect(path4.matches(path1)).toBe(false);
});

test('JSONPath.matches — wildcard in this path', () => {
	const path1 = new JSONPath('.a.*.name');
	const pathExact = new JSONPath('.a.b.name');
	const pathOther = new JSONPath('.a.x.name');
	const pathDiff = new JSONPath('.a.b.age');

	expect(path1.matches(pathExact)).toBe(true);
	expect(path1.matches(pathOther)).toBe(true);
	expect(path1.matches(pathDiff)).toBe(false);
});

test('JSONPath.matches — wildcard in compared path throws', () => {
	const path1 = new JSONPath('.a.b.c');
	const pathWildcard = new JSONPath('.a.*.c');

	expect(() => path1.matches(pathWildcard)).toThrow(TypeError);
	expect(() => path1.matches(pathWildcard)).toThrow(/wildcards not allowed in compared path/);
});

test('JSONPath.matches — different lengths', () => {
	const path1 = new JSONPath('.a.b');
	const path2 = new JSONPath('.a.b.c');
	const path3 = new JSONPath('.a');

	expect(path1.matches(path2)).toBe(false);
	expect(path2.matches(path1)).toBe(false);
	expect(path1.matches(path3)).toBe(false);
});

test('JSONPath.matches — numeric tokens', () => {
	const path1 = new JSONPath('.items[0].name');
	const path2 = new JSONPath('.items[0].name');
	const path3 = new JSONPath('.items[1].name');

	expect(path1.matches(path2)).toBe(true);
	expect(path1.matches(path3)).toBe(false);
});

test('JSONPath.matches — quoted string tokens', () => {
	const path1 = new JSONPath('.a["b-c"].d');
	const path2 = new JSONPath('.a["b-c"].d');
	const path3 = new JSONPath('.a["b-c"].e');
	const path4 = new JSONPath('.a["b_c"].d');

	expect(path1.matches(path2)).toBe(true);
	expect(path1.matches(path3)).toBe(false);
	expect(path1.matches(path4)).toBe(false);
});

test('JSONPath.matches — empty paths', () => {
	const path1 = new JSONPath([]);
	const path2 = new JSONPath([]);
	const path3 = new JSONPath('.a');

	expect(path1.matches(path2)).toBe(true);
	expect(path1.matches(path3)).toBe(false);
	expect(path3.matches(path1)).toBe(false);
});

test('JSONPath.matches — mixed wildcards', () => {
	const path1 = new JSONPath('.a.*.items.*.name');
	const path2 = new JSONPath('.a.b.items[0].name');
	const path3 = new JSONPath('.a.x.items[5].age');

	expect(path1.matches(path2)).toBe(true);
	expect(path1.matches(path3)).toBe(false);
});
