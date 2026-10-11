"""The one-page shell (web/index.html and web/app.html: the scroll story and the app).

Checks statically what would otherwise only fail in a browser: the two shell pages are the same
document, every module reachable from shell/boot.js exists, every element id those modules look up
is in the markup, and every ARIA or label reference points at an element that exists.
"""
import re
from pathlib import Path

from test_web_hooks import ID_CALL, Page

WEB = Path(__file__).resolve().parents[1] / "web"
INDEX, APP = WEB / "index.html", WEB / "app.html"
IMPORT = re.compile(r"""(?:^|\n)\s*(?:import|export)\s[^;]*?\bfrom\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)""")
# ids a module creates itself (el.id = "x") rather than finding in the markup
CREATED_ID = re.compile(r"""\.id\s*=\s*["']([\w-]+)["']""")


def page():
    p = Page()
    p.feed(INDEX.read_text(encoding="utf-8"))
    return p


def import_map():
    m = re.search(r'<script type="importmap">(.*?)</script>', INDEX.read_text(encoding="utf-8"), re.S)
    import json
    return json.loads(m.group(1))["imports"]


def resolve(spec, base):
    if spec.startswith("."):
        return (base.parent / spec).resolve()
    imports = import_map()
    if spec in imports:
        return (WEB / imports[spec]).resolve()
    for prefix, target in imports.items():
        if prefix.endswith("/") and spec.startswith(prefix):
            return (WEB / target / spec[len(prefix):]).resolve()
    raise AssertionError(f"{base.relative_to(WEB)} imports {spec!r}, which the import map doesn't cover")


def shell_modules():
    """Every first-party module reachable from shell/boot.js (vendored three.js is not walked)."""
    seen, todo = set(), [(WEB / "shell" / "boot.js").resolve()]
    while todo:
        f = todo.pop()
        if f in seen:
            continue
        assert f.exists(), f"missing module {f}"
        seen.add(f)
        if "vendor" in f.parts:
            continue
        for a, b in IMPORT.findall(f.read_text(encoding="utf-8")):
            todo.append(resolve(a or b, f))
    return sorted(m for m in seen if "vendor" not in m.parts)


def test_shell_pages_are_the_same_document():
    assert INDEX.read_bytes() == APP.read_bytes(), "web/index.html and web/app.html must stay identical"


def test_every_shell_import_resolves():
    mods = shell_modules()
    names = {m.relative_to(WEB).as_posix() for m in mods}
    for expected in ("shell/stage.js", "shell/transition.js", "shell/rewind.js", "shell/dive.js", "shell/app-loader.js",
                     "model/ventilation.js", "story/worlds/room.js", "story/worlds/earth.js"):
        assert expected in names, f"{expected} is no longer reachable from shell/boot.js"
    assert not any(n.startswith("live/") for n in names), "the 3D live window was removed"


def test_the_app_loader_points_at_real_scripts():
    src = (WEB / "shell" / "app-loader.js").read_text(encoding="utf-8")
    scripts = re.findall(r'"((?:vendor|app)/[\w./-]+\.js)"', re.search(r"APP_SCRIPTS = \[(.*?)\]", src, re.S).group(1))
    assert scripts and scripts[-1] == "app/app.js", scripts
    for s in scripts:
        assert (WEB / s).is_file(), f"app-loader.js loads {s}, which doesn't exist"


def test_every_id_the_shell_looks_up_exists():
    ids = {a["id"] for _, a in page().elements if "id" in a}
    missing = []
    for m in shell_modules():
        src = m.read_text(encoding="utf-8")
        created = set(CREATED_ID.findall(src))
        for _, name in ID_CALL.findall(src):
            if name not in ids and name not in created:
                missing.append(f"{m.relative_to(WEB)}: #{name}")
    assert not missing, "ids looked up but not in index.html:\n" + "\n".join(missing)


def test_aria_and_label_references_point_at_real_elements():
    els = page().elements
    ids = {a["id"] for _, a in els if "id" in a}
    bad = []
    for tag, a in els:
        for attr in ("aria-labelledby", "aria-describedby", "aria-controls", "for"):
            for ref in a.get(attr, "").split():
                if ref not in ids:
                    bad.append(f"<{tag} {attr}={ref!r}>")
    assert not bad, "references to missing ids: " + ", ".join(bad)


def test_live_links_work_without_javascript():
    # the hand-off intercepts plain clicks; without JS (or with a modifier key) these must still navigate to the app
    for _, a in page().elements:
        if "data-to-live" in a:
            assert a.get("href") == "app.html"
        if "data-to-story" in a:
            assert a.get("href") in ("./", "index.html")


# ---------------------------------------------------------------- sound

AUDIO = WEB / "assets" / "audio"
CUE_CALL = re.compile(r"""\b(?:cue|buffer|setBed|musicTo)(?:\?\.)?\(\s*["']([\w-]+)["']""")


def built_cues():
    import json
    return json.loads((AUDIO / "cues.json").read_text(encoding="utf-8"))


def test_every_built_sound_file_exists_and_matches_the_manifest():
    import json
    manifest = json.loads((WEB.parent / "scripts" / "audio_manifest.json").read_text(encoding="utf-8"))
    built = built_cues()
    assert set(built["cues"]) == set(manifest["cues"]), "cues.json is stale: run scripts/fetch_audio.py"
    for name, c in built["cues"].items():
        for key in ("file", "fileLow"):
            if key in c:
                assert (AUDIO / c[key]).is_file(), f"{name}: missing {c[key]}"
        if "loop" in c:
            a, b = c["loop"]
            assert 0 < a < b <= c["duration"] + 0.5, f"{name}: loop points {c['loop']}"
        assert c["credit"] in built["sources"], f"{name}: no credit for source {c['credit']}"


def test_every_sound_the_code_asks_for_is_built():
    names = set(built_cues()["cues"])
    src = "\n".join((WEB / "shell" / "audio" / f).read_text(encoding="utf-8") for f in ("engine.js", "cues.js"))
    src += (WEB / "shell" / "transition.js").read_text(encoding="utf-8")
    asked = set(CUE_CALL.findall(src)) | set(re.findall(r'\[[\d.]+,\s*"([\w-]+)"', src))
    asked -= {"sat-beep"}  # the satellite's beeps are the "beep" cue, pitched up
    missing = sorted(asked - names)
    assert not missing, f"cues asked for but not built: {missing}"
    bed_names = re.search(r"export const OUTDOOR = \[([^\]]*)\][\s\S]*?export const INDOOR = \[([^\]]*)\]", src)
    beds = re.findall(r'"([\w-]+)"', bed_names.group(1) + bed_names.group(2))
    assert set(beds) <= names, f"beds without a file: {sorted(set(beds) - names)}"


def test_sound_credits_are_on_the_page():
    html = INDEX.read_text(encoding="utf-8")
    assert "Scott Buckley" in html and "CC BY 4.0" in html and "assets/audio/CREDITS.md" in html
    assert (AUDIO / "CREDITS.md").is_file()
