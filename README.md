# What is Dasy?

The `dasy()` function and the `html`/`svg` template literals were created to make rendering dynamic data-driven HTML pages in the browser easier and simpler (it is like a lightweight React/Redux replacement).

**Please check the live demo collection to understand what is it good for!**

[Example demo collection](https://zedas74.github.io/dasy/examples/examples.html#ex_html)

(If you are not familiar with template literals, [you can find an explanation here](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals))

## How do I use it?

First install the package from NPM:

`npm install @zedas74/dasy`

Then, copy the `node_modules\@zedas74\dasy\dist\dasy.mjs` file to a location accessible by your client-side HTML (e.g. a static js folder).

Finally, include the module in your pages:

```html
<!DOCTYPE html>
<html>
<head>
  <script type="module">

    import { html, dasy } from './js/dasy.mjs';
    …

  </script>
</head>
<body>
</body>
</html>
```

## What exactly is `html` for?

A long-standing problem is that creating DOM elements with events from JavaScript can be done in only two ways: either by creating elements manually using DOM manipulation methods, or by using string-based HTML and adding events afterward (for now, let's ignore classic "onclick" and similar events, as they cause numerous issues and are generally not recommended).

**DOM creation looks roughly like this:**
```js
const msg = 'Alert!';

// Create a DOM button
const button = document.createElement('button');
button.className = 'demo-button';
button.textContent = 'Alert';
document.body.append(button);

// Add the event
button.addEventListener('click', () =>
  input.value = alert(msg);
);
```
**The string-based version looks like this:**
```js
const msg = 'Alert!';

// Create an HTML button
document.body.innerHTML = '<button class="demo-button">Alert</button>';

// Add the event
const button = document.body.querySelector('.demo-button');
button.addEventListener('click', () =>
  input.value = alert(msg);
);
```
There are, of course, simpler solutions, but they either require translation or are extremely cumbersome to use.

**In contrast, `html` offers a simple, fast way to mix HTML text and events (without precompile!):**
```js
const msg = 'Alert!';
document.body.append(html`<button class="demo-button" onClick="${() => alert(msg)}">Alert</button>`);
```
Any event can be inserted this way; the key is that its name must start with `on` followed by an uppercase letter. For example, `onClick` inserts a `click` event.

Attributes and text content can also be inserted naturally:
```js
const text = 'Alert', className = 'demo-button';
document.body.append(html`<button class="${className}">${text}</button>`);
```
The `html` function returns a `DocumentFragment`, which can be inserted, allowing elements to be nested within each other:
```js
const text = 'Alert', className = 'demo-button';
document.body.append(html`<button class="${className}">${html`<b>${text}</b>`}</button>`);
```
It is important not to mix static and dynamic parts within a single attribute. For example, this is problematic:
```js
html`<button class="class_${name}"/>`
```
This is the correct way:
```js
html`<button class="${'class_' + name}"/>`
```

The DOM produced by the `html` function can have multiple roots:
```js
html`<i>A</i><b>B</b>`;
```

There are attributes that are much better set after the children have been created. A good example is `value` on a select. It is applied during parsing before the `option`'s exist, so it has no effect. Here, `psValue` means that the attribute is actually only written at the `</select>`, so the `select` is correctly set to the intended value.

```js
html`<select psValue="2">
  <option value="1">One</option>
  <option value="2">Two</option>
</select>`;
```

It is also worth knowing that if we put a function into the `html` code part, it always receives the current parent DOM element:
```js
let div;
html`<div>${parent => div = parent}</div>`);
```
If the function's return value is not `null` or `undefined`, then it is inserted into the output.

The `html` function also accepts value-less attributes, such as `selected`, and HTML comments.

The `html` function also has an alternative version (imported from the same place): `svg`. It does the same thing, but uses the SVG namespace for every element.

## What is dasy() for?

`dasy()` is a data-synchronization solution related to `html`.

Here is a simple `dasy` example:
```js

// Only dasy is included!
import { dasy } from './js/dasy.mjs';

// …

const data = { counter: { value: 0 } };

control = dasy({ data, container: document.body }, 
  // This is the template function for the provided data. The root is the context
  // which contains multiple methods for the context. Inside the dasy, the html 
  // literal must be accessed through the context!
  (rootData, rootContext) => rootContext.html`
    <article class="counter-box">
      <label>Dasy</label>
      <div class="button-row">${
        rootContext.use('.counter', (counterData, counterContext) => counterContext.html`
          <input type="number" value="${counterData.value}"/>
        `)}
        <button onClick="${() => {
          data.counter.value += 1;
          rootContext.refresh();
        }}">+1</button>
      </div>
    </article>
`;
```

**What do we see here?**

dasy() is a function that expects a `data` object, a `container` object, and a template function.

- `data` can be any JSON object, which means it cannot contain recursion, multiple references, and so on.
- `container` will hold the rendered template.
- Every template function has two parameters by default:
  - In the root template, `rootData` always matches the `data` object passed in as the argument.
  - `rootContext` a special object, whose `use`, `inspect`, `each`, and `html` methods we use in the example.

**Destructured context:** You can destructure any method from either parameter:

```js
dasy({ data, container }, (_, { html, each }) => 
  html`<ul>${each('.items', (_, item) => item.html`<li>...</li>`)}</ul>`)
```

**Constructor options — `beforeRefresh`:** The constructor accepts a `beforeRefresh(data)` callback that runs before every diff computation. This is useful for derived data or computed views:

```js
dasy({ 
  data, container, 
  beforeRefresh: () => { /* compute derived state */ }
}, (_, root) => …);
```

**What is `use` good for?**

`use` runs an inner template function on an object part of `data` (in the example, the inner `.counter` object), and dasy inserts it in place of the `use` call. In addition, it creates a live link between the data and the DOM in the background, so if that object changes, the part described by the template is refreshed in the DOM (**and only that part**).

In the example, pressing the button increments `data.counter.value`, and then we ask the whole dasy instance to refresh itself. dasy then figures out which template part inside the `use` is affected, and rebuilds only that part.

The `counterData` variable in the example is the relevant part of the original JSON object, sliced out by the `.counter` path, which here is `{ value: 0 }`. In the root template `rootData` and `data` are the same, but in a nested `use()`/`each()` callback `counterData` is the selected slice.

**What is `inspect` good for?**

`inspect` works similarly to `use`, but it can watch objects or arrays, and it rerenders when any descendant path changes under the selected subtree. This is useful for aggregate views, summaries, or computed output over an entire array.

```js
const data = {
  rows: [
    { cells: [{ count: 1 }, { count: 2 }] },
    { cells: [{ count: 3 }] },
  ]
};

dasy({ data, container: document.body }, (_, root) => root.html`
  <p>${root.inspect('.rows', rows =>
    rows.map(row => row.cells.reduce((sum, cell) => sum + cell.count, 0)).join(' | ')
  )}</p>
`);
```

If any `count` changes or a cell is inserted/removed anywhere under `.rows`, the `inspect('.rows', ...)` block rerenders.

**What is `each` good for?**

Here is a simple example of using `each`, where we can edit the values of a small table and increase the table size:

```js
const data = {
	grid: [
		['0.0', '0.1'],
		['1.0', '1.1'],
	]
}

const oPage = dasy({ data, container: document.body }, (_, root) => root.html`
  <div>
    <table>${
      root.each('.grid', (_, row) => row.html`<tr>${
        row.each(($, cell) => cell.html`<td><input style="background:transparent; color: inherit; border: none" 
          value="${$}" onChange="${cell.set}"/></td>`)
      }</tr>`)
    }</table><br/>
    <button onClick="${() => { data.grid.push(data.grid[0].map((_, i) => `${data.grid.length}.${i}`)); root.refresh(); }}">Add row</button>
    <button onClick="${() => { data.grid.forEach((a, i) => a.push(`${i}.${a.length}`)); root.refresh(); }}">Add col</button>
  </div>`);
```

**What do we see here?**

- `(_, root)` swallows the template data object; we do not need it, because we can access it through the original `data` variable.
- `root.each` works similarly to `root.use`, but the object addressed by the path must be an array, and the template is rendered for every array element.
- Each array item can also have its own context with nested `html`/`svg`:

```js
dasy({ data, container: document.body }, (_, root) => 
  root.html`<ul>${root.each('.items', ($item, ctx) => 
    ctx.html`<li>Name: ${ctx.use('name', $ => $.value)}</li>`
  )}</ul>`)
```

- The inner `row.each` does not contain a path, because it uses the parent data directly (it would be equivalent to calling `row.each('', ($, cell) => … )`).
- The `cell.set` shorthand is actually equivalent to this: `e => cell.set(e)`, which is in fact this: `e => cell.set('', e)`. And that is equivalent to this: `e => set('', e.target.value)`.
- `set` really just writes the value back into the data and calls `dasy.refresh()`. Obviously, if multiple fields change at once, that is not economical, and it is better to call `refresh()` separately, as you can also see with the buttons.
- You can also pass an event object directly: `root.set('.form.value', e)` reads `e.target.value`.
- Or pass a modifier function: `root.set('.form.counter', i => i + 1)`.
- `each()` accepts an optional second template that is rendered when the array is empty.
- dasy makes it possible, for example, when adding columns, for the other rendered <td> elements not to change.

## Nested contexts

`use()`, `inspect()` and `each()` return a context object that works like `root` but is bound to the selected path. You can nest them:

```js
root.use('.counters', ($, outer) => outer.html`
  <p>Outer: <b>${$.first}</b></p>
  <p>Inner: <b>${outer.use('.second', $ => $.value)}</b></p>
`)
```

**Context-level `refresh()`:** Every context also exposes a `.refresh()` method, so you can trigger updates from any nesting level without referencing the outer variable. You can destructure it directly in your callback:

```js
root.each('.items', (_, { html, refresh }) => 
  html`<button onClick="${() => { data.items[0].value++; refresh(); }}">Update</button>`
)
```

## Destroying a dasy instance

A `dasy()` instance can be removed with `disconnect()`, which cleans up its DOM and watchers:

```js
const page = dasy({ data, container }, template);
page.disconnect();
```

## Undo / Redo

`dasy.mjs` exports a `JSONUndoBuffer` helper. Create it from your data, call `snapshot()` after changes, then use `undo()` / `redo()` and refresh:

```js
import { JSONUndoBuffer } from './dasy.mjs';

const undoBuffer = new JSONUndoBuffer(data);

const page = dasy({ data, container }, …)

// after a change
undoBuffer.snapshot();

// later
undoBuffer.undo(); // or .redo()
page.refresh();
```

## Sharing data across multiple dasy instances

Instead of passing a `data` object directly, you can hand a `DasyDataSource` to the constructor. The data source owns the model and the diff computation, so several `dasy()` instances can observe the same data and only re-render their own slices.

```js
import { html, dasy, DasyDataSource } from './dasy.mjs';

const shared = new DasyDataSource({
  form: { counter: 1 }
});

// First view
const page1 = dasy({ dataSource: shared, container: document.body }, (_, root) => root.html`
  <p>First counter: ${root.use('.form', o => o.counter)}</p>
`);

// Second view on the same data
const page2 = dasy({ dataSource: shared, container: document.body }, (_, root) => root.html`
  <p>Second counter: ${root.use('.form', o => o.counter)}</p>
`);

// Changing shared data and refreshing the source updates both views
shared.data.form.counter++;
shared.refresh();
```

When the data source is used, the `dasy()` constructor accepts:

- `dataSource` — a `DasyDataSource` instance.
- `dataPath` — an optional JSONPath string that scopes the instance to a subtree of the shared data. For example, `{ dataSource: shared, dataPath: '.form' }` makes the template's root data the `.form` object.

## Highlight in VSCode

The HTML code inside `html` is not highlighted automatically by VSCode, but there are extensions that can handle this, for example [es6-string-html](https://marketplace.visualstudio.com/items?itemName=Tobermory.es6-string-html).
