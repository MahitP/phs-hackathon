"""Every DOM hook the app's scripts rely on must exist in web/index.html (the app lives there as #app).

The scripts (web/app/*.js and web/sky-local.js) find elements by id ($("x"), getElementById,
querySelector("#x")) and by data-attribute, role and class selectors. If a markup change drops one of
them, nothing fails until someone clicks the right button, so this test checks the markup statically.
The shell's own modules (web/shell/, web/story/) are covered by test_shell_hooks.py.
"""
import re
from html.parser import HTMLParser
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "web"
APP = WEB / "index.html"
APP_JS = sorted((WEB / "app").glob("*.js")) + [WEB / "sky-local.js"]

# A string literal that is the whole first argument: "x" followed by ")" or ",", never by "+".
_LIT = r"""\(\s*(["'])([^"'`]+)\1\s*[,)]"""
ID_CALL = re.compile(r"(?:(?<![\w$])\$|getElementById)" + _LIT)
SELECTOR_CALL = re.compile(r"(?:querySelector(?:All)?|closest|matches|(?<![\w$])qa)" + _LIT)  # qa: app.js's #app-scoped querySelectorAll
GSAP_TARGET = re.compile(r"gsap\.(?:to|from|fromTo|set|killTweensOf)" + _LIT)
# $("x-" + k), getElementById(`...`): ids this test cannot see
DYNAMIC_ID = re.compile(r"""(?:(?<![\w$])\$|getElementById)\(\s*(?:["'][^"']*["']\s*\+|`)""")

SIMPLE = re.compile(r"""#([\w-]+)|\.([\w-]+)|\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*["']?([^"'\]]*)["']?)?\s*\]""")


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.elements = []  # (tag, {attr: value})
        self.inline_js = []
        self._script = None

    def handle_starttag(self, tag, attrs):
        a = {k: (v if v is not None else "") for k, v in attrs}
        self.elements.append((tag, a))
        if tag == "script" and "src" not in a:
            self._script = []

    def handle_startendtag(self, tag, attrs):
        self.elements.append((tag, {k: (v if v is not None else "") for k, v in attrs}))

    def handle_data(self, data):
        if self._script is not None:
            self._script.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self._script is not None:
            self.inline_js.append("".join(self._script))
            self._script = None


def _page():
    p = Page()
    p.feed(APP.read_text(encoding="utf-8"))
    return p


def _scripts(page):
    files = {p.relative_to(WEB).as_posix(): p.read_text(encoding="utf-8") for p in APP_JS}
    for i, js in enumerate(page.inline_js):
        files[f"index.html <script> #{i + 1}"] = js
    return files


def _strip_comments(js):
    js = re.sub(r"/\*.*?\*/", "", js, flags=re.S)
    return re.sub(r"(?m)(^|[^:\"'\\])//.*$", r"\1", js)


def _hooks(page):
    """{kind: {value: [files]}} for ids, classes and attribute selectors used by the scripts."""
    found = {"id": {}, "class": {}, "attr": {}}

    def add(kind, value, where):
        found[kind].setdefault(value, set()).add(where)

    for name, js in _scripts(page).items():
        js = _strip_comments(js)
        for m in ID_CALL.finditer(js):
            add("id", m.group(2), name)
        for m in list(SELECTOR_CALL.finditer(js)) + list(GSAP_TARGET.finditer(js)):
            for s in SIMPLE.finditer(m.group(2)):
                if s.group(1):
                    add("id", s.group(1), name)
                elif s.group(2):
                    add("class", s.group(2), name)
                else:
                    attr, op, val = s.group(3), s.group(4), s.group(5)
                    add("attr", (attr, val if op == "=" else None), name)
    return found


def test_scripts_use_literal_ids_only():
    """Ids built at runtime ("x-" + key) can't be checked, so the scripts spell every id out."""
    page = _page()
    bad = [f"{name}: {m.group(0)}" for name, js in _scripts(page).items()
           for m in DYNAMIC_ID.finditer(_strip_comments(js))]
    assert not bad, "dynamic element ids found (write them out literally):\n" + "\n".join(bad)


def test_every_script_hook_exists_in_index_html():
    page = _page()
    ids = {a["id"] for _, a in page.elements if "id" in a}
    classes = {c for _, a in page.elements for c in a.get("class", "").split()}
    hooks = _hooks(page)
    assert hooks["id"], "no hooks found: the parser is broken"

    missing = [f"#{i} (used in {', '.join(sorted(w))})" for i, w in sorted(hooks["id"].items()) if i not in ids]
    missing += [f".{c} (used in {', '.join(sorted(w))})" for c, w in sorted(hooks["class"].items()) if c not in classes]
    for (attr, val), where in sorted(hooks["attr"].items(), key=lambda kv: (kv[0][0], kv[0][1] or "")):
        ok = any(attr in a and (val is None or a[attr] == val) for _, a in page.elements)
        if not ok:
            missing.append(f"[{attr}{'=' + val if val is not None else ''}] (used in {', '.join(sorted(where))})")
    assert not missing, "web/index.html is missing elements the app's scripts use:\n" + "\n".join(missing)


def test_known_hooks_are_still_queried():
    """Guards the parser itself: these hooks are definitely used, so they must be found."""
    hooks = _hooks(_page())
    for i in ("verdict-label", "reasons", "aqi", "aqi-cat", "stale", "stale-bar", "app",
              "local-card", "explore-card", "fire-line", "btn-announce", "btn-sound", "btn-orbit",
              "mode-chip", "clock", "x-aqi", "c-aqi", "wx-cond", "l-aqi", "pi-stale", "po-aqi", "localmap", "globe",
              "btn-device-replay", "fc-strip", "fc-best"):
        assert i in hooks["id"], f"#{i} is no longer looked up by the scripts"
    attrs = {a for a, _ in hooks["attr"]}
    for a in ("data-cal", "data-label", "data-mock", "data-region", "role"):  # map buttons moved onto the map (local.js)
        assert a in attrs, f"[{a}] is no longer queried by the scripts"
    for c in ("server-only", "mock-only", "panel"):
        assert c in hooks["class"], f".{c} is no longer queried by the scripts"


def test_ids_are_unique():
    seen, dupes = set(), set()
    for _, a in _page().elements:
        if "id" in a:
            (dupes if a["id"] in seen else seen).add(a["id"])
    assert not dupes, f"duplicate ids in index.html (the story and the app share it): {sorted(dupes)}"


def test_every_tab_has_a_panel():
    """selectTab(name) shows the .panel with id tab-<name>, so each data-tab needs one."""
    els = _page().elements
    ids = {a["id"] for _, a in els if "id" in a}
    panels = {a["id"] for _, a in els if "panel" in a.get("class", "").split() and "id" in a}
    tabs = [a for _, a in els if a.get("role") == "tab"]
    assert tabs and any(a.get("role") == "tablist" for _, a in els)
    for a in tabs:
        assert a.get("data-tab"), f"role=tab without data-tab: {a}"
        assert f"tab-{a['data-tab']}" in ids & panels, f"no .panel#tab-{a['data-tab']} for data-tab={a['data-tab']}"
        assert a.get("aria-selected") in ("true", "false"), f"tab {a['data-tab']} needs aria-selected"


def test_the_app_has_four_tabs_and_nothing_the_story_already_tells():
    """NOW, PHS CAMPUS, FORECAST, EARTH. The 2023 record, the how-it-works tab, the splash and the hero
    were removed: the scroll story covers them."""
    els = _page().elements
    tabs = [a["data-tab"] for _, a in els if a.get("role") == "tab"]
    assert tabs == ["now", "local", "sky", "explore"], tabs
    ids = {a["id"] for _, a in els if "id" in a}
    for gone in ("tab-replay", "tab-system", "splash", "hero", "btn-initiate", "scrub", "btn-replay"):
        assert gone not in ids, f"#{gone} should be gone"
    js = "\n".join(_scripts(_page()).values())
    for gone in ("loadReplay", "showHour", "lockNJ", "setSmoke", "SkyAudio"):
        assert gone not in js, f"{gone} should be gone from the app's scripts"
