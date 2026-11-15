# Research Annotations

Index, search, and browse the Zotero annotations already imported into your Obsidian literature notes. The plugin works entirely on local Markdown — it does not connect to Zotero or require a separate database.

It is designed to work with the **Zotero Integration** plugin and the **Highlightr** plugin (which provides the `hltr-*` highlight classes).

![Research Annotations explorer showing annotation cards, filters, and paper grouping](assets/annotation-explorer.png)

> **Why it helps:** It brings every research annotation scattered across your vault into one searchable, filterable index. While you brainstorm and link notes, the evidence you need stays one click away — so you spend less time locating highlights and more time thinking about the research.

## Features

- Sidebar annotation explorer for all indexed papers.
- Search highlights, comments, tags, and paper titles.
- Filter by semantic category, original highlight color, tag, paper, project, page, comment, and image presence.
- Sort by paper, page, category, or note order; group by paper, category, or project.
- Open the source note at the exact annotation line from the paper title or **Open in note** button.
- Open matching Zotero annotations, pages, PDFs, or items directly from each card.
- Configurable semantic names for Zotero colors (for example, Yellow → “Core ideas”).
- Project views via frontmatter links, with optional follow-active-note behavior.
- Incremental indexing: only notes containing annotations are stored, and changed notes are re-parsed automatically.

## Installation

1. Create the folder `.obsidian/plugins/research-annotations/` in your vault.
2. Copy `main.js`, `manifest.json`, and `styles.css` into that folder.
3. Enable **Research Annotations** in **Settings → Community plugins**.
4. Reload Obsidian after updating the plugin files.

### Building from source

```bash
npm install
npm run build
```

The build watches for changes and writes `dist/main.js`. To build directly into a vault:

```bash
OBSIDIAN_PLUGIN_DIR="/path/to/vault/.obsidian/plugins/research-annotations" npm run build
```

## Usage

1. Import Zotero annotations into your literature notes using **Zotero Integration** and the template below.
2. Open the explorer with:
   - the highlighter ribbon icon,
   - the command **Open annotation explorer (all papers)**,
   - **Open annotations for current paper**, or
   - **Open annotations for current project**.
3. Use **This paper**, **Project…**, and the filter controls to narrow the list.
4. Click a paper title or **Open in note** to jump to the annotation in its source note.

### Note properties (frontmatter)

For the explorer to show papers and projects correctly, give each literature note frontmatter like this:

```yaml
---
title: "Paper or note title"
authors:
  - "Author One"
  - "Author Two"
projects:
  - "[[VG-01 Project Name]]"
---
```

- `title` is the name shown in the explorer. It falls back to the filename.
- `authors` (or `author`) is shown on annotation cards. Both a YAML list and a single string work.
- `projects` links the paper to one or more project notes. Use `projects: []` when the paper has no project. The property name is configurable in **Settings → Research Annotations**.

The note body must also contain the imported Zotero annotations. The template below wraps every annotation in `%% ra:begin … %%` / `%% ra:end %%` markers and includes the `zotero://` links the plugin uses for stable annotation IDs and Zotero buttons.

### Annotation format

Every annotation must be inside an explicit `ra:` block:

```text
%% ra:begin id="ZOTEROKEY" color="Cyan" type="highlight" %%
<mark class="hltr-cyan">Quoted text</mark>
**Comment:** optional comment
**Tags:** #tag-one #tag-two
[Page 5](zotero://open-pdf/library/items/ITEMKEY?page=5&annotation=ZOTEROKEY)
%% ra:end %%
```

- `id` is the stable Zotero annotation key. It is used for navigation and deduplication.
- `color` is authoritative when present; it maps to the `hltr-*` classes and the configurable semantic aliases.
- `type` is stored for future use; it does not affect filtering yet.
- All tags on the configured tags line are indexed and filterable.
- Category filters use the highlight color; tag filters use every tag on the tags line.
- Annotations outside `ra:` blocks are ignored. Legacy heuristic parsing has been removed.
- The comment and tags line labels are configurable in **Settings → Research Annotations**. Defaults are `Comment, My comment` and `Tags, Annotation tags`.

## Zotero Integration template

This template is known to work well with the plugin and with Highlightr’s `hltr-*` classes:

<details>
<summary>Show template</summary>

```jinja
{% persist "annotations" %}
{%- for annotation in annotations %}

%% ra:begin id="{{ annotation.id }}" color="{{ annotation.colorCategory }}" type="{{ annotation.type }}" %%
{% if annotation.annotatedText %}
{%- if annotation.colorCategory == "Yellow" %}
<mark class="hltr-yellow">❝{{ annotation.annotatedText }}❞</mark>
{%- elif annotation.colorCategory == "Blue" %}
<mark class="hltr-blue">❝{{ annotation.annotatedText }}❞</mark>
{%- elif annotation.colorCategory == "Green" %}
<mark class="hltr-green">❝{{ annotation.annotatedText }}❞</mark>
{%- elif annotation.color == "#00ffff" %}
<mark class="hltr-cyan">❝{{ annotation.annotatedText }}❞</mark>
{%- elif annotation.colorCategory == "Purple" %}
<mark class="hltr-purple">❝{{ annotation.annotatedText }}❞</mark>
{%- elif annotation.colorCategory == "Red" %}
<mark class="hltr-red">❝{{ annotation.annotatedText }}❞</mark>
{%- elif annotation.colorCategory == "Orange" %}
<mark class="hltr-orange">❝{{ annotation.annotatedText }}❞</mark>
{%- elif annotation.colorCategory == "Magenta" %}
<mark class="hltr-pink">❝{{ annotation.annotatedText }}❞</mark>
{%- else %}
<mark class="hltr-grey">❝{{ annotation.annotatedText }}❞</mark>
{%- endif %}
{%- endif %}

{%- if annotation.imageRelativePath %}
![[{{ annotation.imageRelativePath }}]]
{%- endif %}

{%- if annotation.comment %}
**Comment:** {{ annotation.comment }}
{%- endif %}

{%- if annotation.tags %}
**Tags:** {% for tag in annotation.tags %}#{{ tag.tag }}{% if not loop.last %} {% endif %}{% endfor %}
{%- endif %}

{%- if annotation.pageLabel and annotation.desktopURI %}
[Page {{ annotation.pageLabel }}]({{ annotation.desktopURI }})
{%- endif %}

%% ra:end %%
{% endfor %}
{% endpersist %}
```

</details>

## Settings

- **Folders to index** — limit indexing to specific folders; leave empty for the whole vault.
- **Comment label(s)** — comma-separated labels used before comments, without the colon. Defaults: `Comment, My comment`.
- **Tags label(s)** — comma-separated labels used before tags, without the colon. Defaults: `Tags, Annotation tags`.
- **Project property** — frontmatter key containing project links.
- **Infer color from tag emoji** — infer a color for annotations without a highlight color, such as image annotations.
- **Semantic color aliases** — rename Zotero colors for filtering, grouping, and display.
- **Explorer defaults** — default sort and grouping.

## Customizing

You can use Claude — or any AI coding assistant — to edit and alter the plugin as you wish: change the parser, adjust the sidebar UI, add settings, or adapt the Zotero template to your own workflow. The source is split into small modules for parsing, indexing, querying, rendering, and navigation.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, the project structure, tests, coding guidelines, and the pull-request process. By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
